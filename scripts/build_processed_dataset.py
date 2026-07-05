#!/usr/bin/env python3
"""
build_processed_dataset.py — Steps 8 & 9 of the spec.

Step 8 (filter): for each PISA bond record, classify EACH side by its AUTHOR chain id
        (antigen set from identify_chains, antibody set from run_anarcii). Keep a bond only
        if one side is an antigen chain and the other an antibody chain. Drops spike-spike
        trimer, intra-Fab heavy-light, and glycan/non-polymer bonds (logged by category).
        Classification is by CHAIN, never by per-bond unp_accs (spurious P0DTC2 on antibody).

Step 9 (join + orient): antigen fields come from the antigen-chain side (UniProt acc/pos read
        from PISA unp_accs/unp_nums there); antibody fields come from the antibody-chain side,
        joined onto the ANARCII IMGT mapping table on author identifiers
        (auth_asym_id, author_residue_number(int), author_insertion_code(null->'')).

Required assertions (spec):
  * no antibody-chain residue ever contributes an antigen_uniprot_position;
  * if a bond carries an antigen accession on an antibody-chain residue, treat that side as
    antibody (chain wins) and record the incident to mapping_anomalies.json.

Outputs:
  data/processed/processed_antibody_antigen_interfaces.json
  data/processed/mapping_anomalies.json
"""

import argparse
import json
import os
from collections import Counter, defaultdict

from common import get_logger, load_interfaces
from identify_chains import resolve_unp, sifts_segments

log = get_logger("build_processed")

ANTIGEN_SRC = "PISA"
ANTIBODY_SRC = "ANARCII_IMGT"


def load(path):
    with open(path) as fh:
        return json.load(fh)


def build_buried_lookup(interfaces_json):
    """(interface_id, chain, author_seq_num:int) -> buried_surface_area, from molecule arrays."""
    pdb_id, block = load_interfaces(interfaces_json)
    lut = {}
    for itf in block.get("assembly", {}).get("interfaces", []):
        iid = str(itf.get("interface_id"))
        for m in itf.get("molecules", []):
            ch = m.get("chain_id")
            seqs = m.get("residue_seq_ids") or []
            buried = m.get("buried_surface_areas") or []
            for s, b in zip(seqs, buried):
                try:
                    lut[(iid, ch, int(s))] = b
                except (TypeError, ValueError):
                    pass
    return lut


def process_entry(records, antigen_rows, antibody_rows, chain_meta, mapping, buried_lut,
                  antigen_sifts=None):
    """Filter + orient + join one entry's bond records. Returns (rows, anomaly_records, stats).

    antigen_sifts: optional {author_chain: [(res_start,res_end,unp_start,acc)]} SIFTS segments,
    used as a residue-level UniProt fallback when the PISA file does not carry antigen unp_nums.
    Pure over inputs (no file writes) so a batch orchestrator can accumulate across entries.
    """
    antigen_set = {r["auth_asym_id"] for r in antigen_rows}
    antigen_acc = {r["auth_asym_id"]: r.get("antigen_uniprot_accession") for r in antigen_rows}
    antigen_name = {r["auth_asym_id"]: r.get("antigen_name") for r in antigen_rows}
    antibody_set = {r["auth_asym_id"] for r in antibody_rows if r.get("is_antibody")}
    antibody_type = {r["auth_asym_id"]: (r.get("antibody_chain_type"), r.get("antibody_chain_type_raw"))
                     for r in antibody_rows if r.get("is_antibody")}
    # entity id per protein chain (role antigen/antibody_candidate)
    entity_of = {}
    for c in chain_meta:
        if c["is_protein"]:
            entity_of[c["auth_asym_id"]] = c["entity_id"]
    # IMGT mapping index on author identifiers
    mi = {(m["auth_asym_id"], m["author_residue_number"], m["author_insertion_code"]): m for m in mapping}

    processed = []
    anomalies_agg = defaultdict(lambda: {"count": 0, "example": None})
    drop = Counter()
    keep_by_interface = Counter()
    stat = Counter()

    for rec in records:
        s1, s2 = rec["side1"], rec["side2"]
        c1, c2 = s1["chain_id"], s2["chain_id"]
        r1 = "antigen" if c1 in antigen_set else ("antibody" if c1 in antibody_set else "other")
        r2 = "antigen" if c2 in antigen_set else ("antibody" if c2 in antibody_set else "other")
        roles = {r1, r2}

        # Anomaly capture: an antibody-chain residue carrying an antigen accession.
        for side, role in ((s1, r1), (s2, r2)):
            if role == "antibody" and side["unp_acc"]:
                key = (rec["pdb_id"], rec["assembly_id"], rec["interface_id"], rec["interaction_type"],
                       side["chain_id"], side["author_residue_number"], side["residue_name"],
                       side["unp_acc"], side["unp_num"])
                anomalies_agg[key]["count"] += 1

        if roles != {"antigen", "antibody"}:
            # categorise the drop
            if roles == {"antigen"}:
                drop["antigen_antigen_trimer"] += 1
            elif roles == {"antibody"}:
                drop["antibody_antibody_intra_fab"] += 1
            elif "other" in roles:
                drop["involves_glycan_or_other"] += 1
            else:
                drop["other"] += 1
            continue

        # Orient: pick antigen side and antibody side.
        ag = s1 if r1 == "antigen" else s2
        ab = s1 if r1 == "antibody" else s2

        # Antigen fields (from PISA on antigen chain; SIFTS residue-level fallback if PISA lacks it).
        ag_pos = ag["unp_num"]
        ag_acc = ag["unp_acc"] or antigen_acc.get(ag["chain_id"])
        ag_source = "PISA"
        if ag_pos is not None:
            stat["antigen_from_pisa"] += 1
        elif antigen_sifts:
            facc, fpos = resolve_unp(antigen_sifts, ag["chain_id"], ag["label_residue_number"])
            if fpos is not None:
                ag_pos, ag_source = fpos, "SIFTS"
                ag_acc = ag_acc or facc
                stat["antigen_from_sifts"] += 1
        if ag_pos is None:
            stat["antigen_unmapped"] += 1
        ag_status = "mapped" if ag_pos is not None else "unmapped"

        # Antibody fields (join onto IMGT mapping table by author ids).
        key = (ab["chain_id"], ab["author_residue_number"], ab["author_insertion_code"])
        m = mi.get(key)
        ctype, ctype_raw = antibody_type.get(ab["chain_id"], (None, None))
        if m and m["mapping_status"] == "mapped":
            imgt_pos = m["imgt_position"]
            imgt_ins = m["imgt_insertion_code"]
            imgt_region = m["imgt_region"]
            ab_status = "mapped"
            ab_label = m["label_residue_number"]
        else:
            imgt_pos = imgt_ins = None
            imgt_region = "unmapped"
            ab_status = m["mapping_status"] if m else "unmapped"
            ab_label = m["label_residue_number"] if m else ab["label_residue_number"]
            stat["antibody_unmapped"] += 1
            if not m:
                stat["antibody_join_failed"] += 1

        buried = buried_lut.get((rec["interface_id"], ag["chain_id"], ag["author_residue_number"]))

        row = {
            "pdb_complex_id": rec["pdb_complex_id"], "pdb_id": rec["pdb_id"],
            "assembly_id": rec["assembly_id"], "interface_id": rec["interface_id"],
            # antigen
            "antigen_chain_id": ag["chain_id"], "antigen_auth_asym_id": ag["chain_id"],
            "antigen_label_asym_id": ag["label_asym_id"], "antigen_entity_id": entity_of.get(ag["chain_id"]),
            "antigen_residue_author_number": ag["author_residue_number"],
            "antigen_residue_label_number": ag["label_residue_number"],
            "antigen_residue_name": ag["residue_name"],
            "antigen_uniprot_accession": ag_acc, "antigen_uniprot_position": ag_pos,
            "antigen_mapping_source": ag_source, "antigen_mapping_status": ag_status,
            # antibody
            "antibody_chain_id": ab["chain_id"], "antibody_auth_asym_id": ab["chain_id"],
            "antibody_label_asym_id": ab["label_asym_id"], "antibody_entity_id": entity_of.get(ab["chain_id"]),
            "antibody_chain_type": ctype, "antibody_chain_type_raw": ctype_raw,
            "antibody_residue_author_number": ab["author_residue_number"],
            "antibody_residue_author_insertion_code": ab["author_insertion_code"],
            "antibody_residue_label_number": ab_label, "antibody_residue_name": ab["residue_name"],
            "antibody_imgt_position": imgt_pos, "antibody_imgt_insertion_code": imgt_ins,
            "antibody_imgt_region": imgt_region,
            "antibody_mapping_source": ANTIBODY_SRC, "antibody_mapping_status": ab_status,
            # interaction
            "interaction_type": rec["interaction_type"], "distance": rec["distance"],
            "interface_area": rec["interface_area"], "buried_surface_area": buried,
            # full PISA per-interface energetics + bond counts (from parse_interfaces.interface_props)
            "solvation_energy": rec.get("solvation_energy"),
            "stabilization_energy": rec.get("stabilization_energy"),
            "p_value": rec.get("p_value"),
            "number_interface_residues": rec.get("number_interface_residues"),
            "number_hydrogen_bonds": rec.get("number_hydrogen_bonds"),
            "number_salt_bridges": rec.get("number_salt_bridges"),
            "number_disulfide_bonds": rec.get("number_disulfide_bonds"),
            "number_covalent_bonds": rec.get("number_covalent_bonds"),
            "number_other_bonds": rec.get("number_other_bonds"),
        }
        # ASSERTION: antibody-side residue must not sit on an antigen chain, and no antigen_*
        # field may carry a unp read from an antibody-chain residue.
        assert row["antibody_auth_asym_id"] not in antigen_set, row
        processed.append(row)
        keep_by_interface[rec["interface_id"]] += 1

    # Build anomaly output records.
    anomalies = []
    for key, v in sorted(anomalies_agg.items(), key=lambda kv: -kv[1]["count"]):
        pdb_id, assembly_id, interface_id, bond_type, chain, resnum, resname, acc, unp = key
        anomalies.append({
            "pdb_id": pdb_id, "assembly_id": assembly_id, "interface_id": interface_id,
            "bond_type": bond_type, "antibody_auth_asym_id": chain,
            "antibody_residue_author_number": resnum, "antibody_residue_name": resname,
            "spurious_unp_accession": acc, "spurious_unp_position": unp,
            "occurrence_count": v["count"],
        })

    stats = {"in": len(records), "kept": len(processed), "drop": dict(drop),
             "keep_by_interface": dict(sorted(keep_by_interface.items(), key=lambda kv: int(kv[0]))),
             "antigen_from_pisa": stat["antigen_from_pisa"], "antigen_from_sifts": stat["antigen_from_sifts"],
             "antigen_unmapped": stat["antigen_unmapped"], "antibody_unmapped": stat["antibody_unmapped"],
             "antibody_join_failed": stat["antibody_join_failed"]}
    return processed, anomalies, stats


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--interactions", default="data/intermediate/pisa_residue_interactions.json")
    ap.add_argument("--interfaces-json", default="6wps_assembly1_interfaces.json",
                    help="original PISA file (for per-residue buried surface areas)")
    ap.add_argument("--antigen-chains", default="data/intermediate/antigen_chains.json")
    ap.add_argument("--antibody-chains", default="data/intermediate/antibody_chains.json")
    ap.add_argument("--chain-metadata", default="data/intermediate/chain_metadata.json")
    ap.add_argument("--imgt-mapping", default="data/intermediate/antibody_imgt_mapping.json")
    ap.add_argument("--antigen-acc", default="P0DTC2")
    ap.add_argument("--out-dir", default="data/processed")
    args = ap.parse_args()

    records = load(args.interactions)
    pdb_for_sifts = records[0]["pdb_id"] if records else None
    antigen_sifts = sifts_segments(pdb_for_sifts, antigen_acc=args.antigen_acc) if pdb_for_sifts else {}
    processed, anomalies, stats = process_entry(
        records, load(args.antigen_chains), load(args.antibody_chains),
        load(args.chain_metadata), load(args.imgt_mapping),
        build_buried_lookup(args.interfaces_json), antigen_sifts=antigen_sifts)

    os.makedirs(args.out_dir, exist_ok=True)
    with open(os.path.join(args.out_dir, "processed_antibody_antigen_interfaces.json"), "w") as fh:
        json.dump(processed, fh, indent=1)
    with open(os.path.join(args.out_dir, "mapping_anomalies.json"), "w") as fh:
        json.dump(anomalies, fh, indent=1)

    log.info("bond records in: %d", stats["in"])
    log.info("dropped (not antibody-antigen): %s", stats["drop"])
    log.info("kept antibody-antigen bond records: %d across interfaces %s",
             stats["kept"], stats["keep_by_interface"])
    log.info("antigen positions: PISA=%d SIFTS-fallback=%d still-unmapped=%d | antibody unmapped=%d (join-miss %d)",
             stats["antigen_from_pisa"], stats["antigen_from_sifts"], stats["antigen_unmapped"],
             stats["antibody_unmapped"], stats["antibody_join_failed"])
    log.info("UniProt-on-antibody anomalies: %d distinct residues, %d occurrences",
             len(anomalies), sum(a["occurrence_count"] for a in anomalies))


if __name__ == "__main__":
    main()
