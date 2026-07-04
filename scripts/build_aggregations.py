#!/usr/bin/env python3
"""
build_aggregations.py — Aggregation requirements 1-5 of the spec.

Reads processed_antibody_antigen_interfaces.json (bond-level rows) and produces:

  0. residue_level_interactions.json            one row per (antigen residue, antibody residue)
                                                contact pair; carries bond_count.
  1. aggregated_antigen_epitope_contacts.json   group by antigen UniProt acc/pos/name.
  2. frequency_contacts_by_heavy_light.json     HEADLINE: antigen UniProt x heavy/light.
  3. aggregated_antibody_imgt_contacts.json     group by chain_type/imgt_pos/region/residue.
  4. imgt_region_contribution.json              group by chain_type/imgt_region.

Counting units (spec): the default headline unit is `contact_pairs` = distinct
(antigen residue, antibody residue) pairs. `bond_count` (raw bond records) is carried as a
secondary column. Aggregation counts are at the contact-pair level so a close-packed residue
with many `other_bonds` is not over-counted.
"""

import argparse
import json
import os
from collections import Counter, defaultdict

from common import get_logger

log = get_logger("build_agg")


def most_common(counter, n=5):
    return [{"value": v, "count": c} for v, c in counter.most_common(n)]


def load(path):
    with open(path) as fh:
        return json.load(fh)


def build_contact_pairs(rows):
    """Collapse bond-level rows to distinct (antigen residue, antibody residue) pairs."""
    groups = defaultdict(lambda: {"bonds": [], "interaction_types": Counter(), "distances": []})
    for r in rows:
        key = (
            r["pdb_id"], r["assembly_id"], r["interface_id"],
            r["antigen_auth_asym_id"], r["antigen_residue_author_number"],
            r["antibody_auth_asym_id"], r["antibody_residue_author_number"],
            r["antibody_residue_author_insertion_code"],
        )
        g = groups[key]
        g["bonds"].append(r)
        g["interaction_types"][r["interaction_type"]] += 1
        if r["distance"] is not None:
            g["distances"].append(r["distance"])
        g["row"] = r  # representative (identity fields identical within a pair)

    pairs = []
    for key, g in groups.items():
        r = g["row"]
        pairs.append({
            "pdb_id": r["pdb_id"], "assembly_id": r["assembly_id"], "interface_id": r["interface_id"],
            "antigen_chain_id": r["antigen_auth_asym_id"],
            "antigen_uniprot_accession": r["antigen_uniprot_accession"],
            "antigen_uniprot_position": r["antigen_uniprot_position"],
            "antigen_residue_name": r["antigen_residue_name"],
            "antigen_residue_author_number": r["antigen_residue_author_number"],
            "antigen_mapping_status": r["antigen_mapping_status"],
            "antibody_chain_id": r["antibody_auth_asym_id"],
            "antibody_chain_type": r["antibody_chain_type"],
            "antibody_residue_name": r["antibody_residue_name"],
            "antibody_residue_author_number": r["antibody_residue_author_number"],
            "antibody_imgt_position": r["antibody_imgt_position"],
            "antibody_imgt_insertion_code": r["antibody_imgt_insertion_code"],
            "antibody_imgt_region": r["antibody_imgt_region"],
            "antibody_mapping_status": r["antibody_mapping_status"],
            "bond_count": len(g["bonds"]),
            "interaction_types": dict(g["interaction_types"]),
            "min_distance": min(g["distances"]) if g["distances"] else None,
        })
    return pairs


def agg_antigen_epitope(pairs):
    # Only aggregate residues with a UniProt position; unmapped ones can't be cross-structure
    # aggregated by position (they stay in the residue-level table, labelled unmapped).
    groups = defaultdict(list)
    for p in pairs:
        if p["antigen_uniprot_position"] is None:
            continue
        groups[(p["antigen_uniprot_accession"], p["antigen_uniprot_position"], p["antigen_residue_name"])].append(p)
    out = []
    for (acc, pos, name), ps in groups.items():
        heavy = [p for p in ps if p["antibody_chain_type"] == "heavy"]
        light = [p for p in ps if p["antibody_chain_type"] == "light"]
        out.append({
            "antigen_uniprot_accession": acc, "antigen_uniprot_position": pos,
            "antigen_residue_name": name,
            "total_contacts": len(ps),
            "assemblies_contacted": len({(p["pdb_id"], p["assembly_id"]) for p in ps}),
            "pdb_entries_contacted": len({p["pdb_id"] for p in ps}),
            "unique_antibody_chains": len({(p["pdb_id"], p["antibody_chain_id"]) for p in ps}),
            "unique_antibody_imgt_positions": len({p["antibody_imgt_position"] for p in ps if p["antibody_imgt_position"] is not None}),
            "heavy_chain_contacts": len(heavy), "light_chain_contacts": len(light),
            "heavy_chain_assemblies": len({(p["pdb_id"], p["assembly_id"]) for p in heavy}),
            "light_chain_assemblies": len({(p["pdb_id"], p["assembly_id"]) for p in light}),
            "most_common_antibody_imgt_regions": most_common(Counter(p["antibody_imgt_region"] for p in ps if p["antibody_imgt_region"] != "unmapped")),
            "most_common_heavy_chain_imgt_regions": most_common(Counter(p["antibody_imgt_region"] for p in heavy if p["antibody_imgt_region"] != "unmapped")),
            "most_common_light_chain_imgt_regions": most_common(Counter(p["antibody_imgt_region"] for p in light if p["antibody_imgt_region"] != "unmapped")),
        })
    out.sort(key=lambda r: (-r["total_contacts"], r["antigen_uniprot_position"] or 0))
    return out


def agg_frequency_heavy_light(pairs):
    groups = defaultdict(list)
    for p in pairs:
        if p["antigen_uniprot_position"] is None:
            continue
        groups[(p["antigen_uniprot_accession"], p["antigen_uniprot_position"], p["antigen_residue_name"])].append(p)
    out = []
    for (acc, pos, name), ps in groups.items():
        heavy = [p for p in ps if p["antibody_chain_type"] == "heavy"]
        light = [p for p in ps if p["antibody_chain_type"] == "light"]
        out.append({
            "antigen_uniprot_accession": acc, "antigen_uniprot_position": pos,
            "antigen_residue_name": name,
            "total_contacts": len(ps),
            "heavy_chain_contacts": len(heavy), "light_chain_contacts": len(light),
            "assemblies_contacted": len({(p["pdb_id"], p["assembly_id"]) for p in ps}),
            "heavy_chain_assemblies": len({(p["pdb_id"], p["assembly_id"]) for p in heavy}),
            "light_chain_assemblies": len({(p["pdb_id"], p["assembly_id"]) for p in light}),
            "most_common_heavy_chain_imgt_regions": most_common(Counter(p["antibody_imgt_region"] for p in heavy if p["antibody_imgt_region"] != "unmapped")),
            "most_common_light_chain_imgt_regions": most_common(Counter(p["antibody_imgt_region"] for p in light if p["antibody_imgt_region"] != "unmapped")),
        })
    out.sort(key=lambda r: -r["total_contacts"])
    return out


def agg_antibody_imgt(pairs):
    groups = defaultdict(list)
    for p in pairs:
        if p["antibody_imgt_position"] is None:  # unmapped: not aggregated by IMGT position
            continue
        groups[(p["antibody_chain_type"], p["antibody_imgt_position"], p["antibody_imgt_region"], p["antibody_residue_name"])].append(p)
    out = []
    for (ctype, pos, region, resname), ps in groups.items():
        out.append({
            "antibody_chain_type": ctype, "antibody_imgt_position": pos,
            "antibody_imgt_region": region, "antibody_residue_name": resname,
            "total_antigen_contacts": len(ps),
            "assemblies_contacted": len({(p["pdb_id"], p["assembly_id"]) for p in ps}),
            "unique_antigen_positions_contacted": len({(p["antigen_uniprot_accession"], p["antigen_uniprot_position"]) for p in ps}),
            "most_common_contacted_antigen_residues": most_common(
                Counter(f"{p['antigen_residue_name']}{p['antigen_uniprot_position']}" for p in ps)),
        })
    out.sort(key=lambda r: -r["total_antigen_contacts"])
    return out


def agg_region_contribution(pairs):
    groups = defaultdict(list)
    total_mapped = 0
    for p in pairs:
        if p["antibody_imgt_region"] == "unmapped" or p["antibody_chain_type"] is None:
            continue
        groups[(p["antibody_chain_type"], p["antibody_imgt_region"])].append(p)
        total_mapped += 1
    out = []
    for (ctype, region), ps in groups.items():
        out.append({
            "antibody_chain_type": ctype, "antibody_imgt_region": region,
            "total_contacts": len(ps),
            "percentage_of_total_contacts": round(100.0 * len(ps) / total_mapped, 2) if total_mapped else 0.0,
            "assemblies_contacted": len({(p["pdb_id"], p["assembly_id"]) for p in ps}),
            "unique_antigen_positions_contacted": len({(p["antigen_uniprot_accession"], p["antigen_uniprot_position"]) for p in ps}),
        })
    out.sort(key=lambda r: -r["total_contacts"])
    return out


def agg_interface_summary(rows):
    """One row per antibody-antigen interface (for the 3D interface list / viewer)."""
    groups = defaultdict(list)
    for r in rows:
        groups[(r["pdb_id"], r["assembly_id"], r["interface_id"])].append(r)
    out = []
    for (pdb, asm, iid), g in groups.items():
        pairs = {(x["antigen_residue_author_number"], x["antibody_auth_asym_id"],
                  x["antibody_residue_author_number"], x["antibody_residue_author_insertion_code"]) for x in g}
        out.append({
            "pdb_id": pdb, "assembly_id": asm, "interface_id": iid,
            "antigen_chain": ",".join(sorted({x["antigen_auth_asym_id"] for x in g})),
            "antibody_chain": ",".join(sorted({x["antibody_auth_asym_id"] for x in g})),
            "antibody_chain_type": ",".join(sorted({x["antibody_chain_type"] for x in g if x["antibody_chain_type"]})),
            "interface_area": g[0].get("interface_area"),
            "residue_contacts": len(pairs),
            "hbonds": sum(1 for x in g if x["interaction_type"] == "hydrogen_bond"),
            "mvsj": f"{pdb}_assembly{asm}_interface{iid}.mvsj",
        })
    out.sort(key=lambda r: (r["pdb_id"], int(r["assembly_id"]), int(r["interface_id"])))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--processed", default="data/processed/processed_antibody_antigen_interfaces.json")
    ap.add_argument("--out-dir", default="data/processed")
    args = ap.parse_args()

    rows = load(args.processed)
    pairs = build_contact_pairs(rows)
    log.info("bond rows=%d -> contact pairs=%d", len(rows), len(pairs))

    outputs = {
        "residue_level_interactions.json": pairs,
        "aggregated_antigen_epitope_contacts.json": agg_antigen_epitope(pairs),
        "frequency_contacts_by_heavy_light.json": agg_frequency_heavy_light(pairs),
        "aggregated_antibody_imgt_contacts.json": agg_antibody_imgt(pairs),
        "imgt_region_contribution.json": agg_region_contribution(pairs),
        "interface_summary.json": agg_interface_summary(rows),
    }
    os.makedirs(args.out_dir, exist_ok=True)
    for fname, data in outputs.items():
        with open(os.path.join(args.out_dir, fname), "w") as fh:
            json.dump(data, fh, indent=1)
        log.info("wrote %s (%d rows)", fname, len(data))

    # Headline sanity: heavy + light contacts should reconcile with total mapped pairs.
    total = len(pairs)
    heavy = sum(1 for p in pairs if p["antibody_chain_type"] == "heavy")
    light = sum(1 for p in pairs if p["antibody_chain_type"] == "light")
    unmapped = sum(1 for p in pairs if p["antibody_chain_type"] is None)
    log.info("contact pairs: total=%d heavy=%d light=%d unmapped_chaintype=%d (heavy+light+unmapped=%d)",
             total, heavy, light, unmapped, heavy + light + unmapped)


if __name__ == "__main__":
    main()
