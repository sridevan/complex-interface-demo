#!/usr/bin/env python3
"""
identify_chains.py — Steps 4 & 5 of the spec.

Step 4: build per-chain metadata for a PDB entry from PDBe APIs
        (entity id, author chains, molecule name, sequence, chain-level UniProt via SIFTS).
Step 5: classify ANTIGEN chains — a chain is antigen if SIFTS maps it to the spike
        accession P0DTC2 (authoritative, chain-level) or its molecule name clearly says spike.

We deliberately use SIFTS chain-level UniProt (mappings/uniprot), NOT the per-bond PISA
unp_accs, because PISA carries spurious P0DTC2 tags on antibody residues. In 6wps SIFTS gives
P0DTC2 -> {A,B,E} only; antibody chains C/D/F/G/H/L have no chain-level UniProt.

Antibody chains are NOT decided here — every non-antigen PROTEIN chain becomes an antibody
*candidate*; ANARCII is the actual antibody test in run_anarcii.py (Step 6).

Outputs (per pdb entry, keyed under data/intermediate/):
  chain_metadata.json   [ {pdb_id, assembly_id, auth_asym_id, entity_id, molecule_name,
                           sequence, length, is_protein, uniprot_accession, role} ]
  antigen_chains.json   [ {pdb_id, assembly_id, auth_asym_id, entity_id,
                           antigen_uniprot_accession, antigen_name} ]

Usage:
  python identify_chains.py --pdb-id 6wps --assembly-id 1 [--antigen-acc P0DTC2]
"""

import argparse
import json
import os

import requests

from common import PDBE_MOLECULES_API, get_logger

log = get_logger("identify_chains")

SIFTS_UNP = "https://www.ebi.ac.uk/pdbe/api/mappings/uniprot/{pdb_id}"
ANTIGEN_NAME_HINTS = ("spike", "sars-cov-2", "sars-cov")


def fetch_json(url, timeout=60):
    r = requests.get(url, timeout=timeout)
    r.raise_for_status()
    return r.json()


def sifts_segments(pdb_id, antigen_acc=None):
    """author chain -> list of (res_start, res_end, unp_start, acc) SIFTS segments.

    res_* are PDBe residue_numbers (== mmCIF label_seq_id). Used as a residue-level UniProt
    fallback for antigen positions when the PISA file does not populate unp_nums: for an antigen
    residue with LABEL seq id L on that chain, uniprot_pos = unp_start + (L - res_start).
    """
    try:
        data = fetch_json(SIFTS_UNP.format(pdb_id=pdb_id)).get(pdb_id, {}).get("UniProt", {})
    except requests.HTTPError:
        return {}
    segs = {}
    for acc, info in data.items():
        if antigen_acc and acc != antigen_acc:
            continue
        for m in info.get("mappings", []):
            ch = m.get("chain_id")
            try:
                rs = int(m["start"]["residue_number"])
                re_ = int(m["end"]["residue_number"])
                us = int(m["unp_start"])
            except (TypeError, ValueError, KeyError):
                continue
            segs.setdefault(ch, []).append((rs, re_, us, acc))
    return segs


def resolve_unp(segments, chain, label_seq):
    """Return (accession, uniprot_pos) for a label_seq on chain, or (None, None)."""
    if label_seq is None:
        return None, None
    for rs, re_, us, acc in segments.get(chain, []):
        if rs <= label_seq <= re_:
            return acc, us + (label_seq - rs)
    return None, None


def chain_uniprot_map(pdb_id):
    """auth_chain_id -> (accession, name) from SIFTS. Antibody chains simply won't appear."""
    try:
        data = fetch_json(SIFTS_UNP.format(pdb_id=pdb_id)).get(pdb_id, {}).get("UniProt", {})
    except requests.HTTPError:
        return {}
    out = {}
    for acc, info in data.items():
        name = info.get("name")
        for m in info.get("mappings", []):
            out[m["chain_id"]] = (acc, name)
    return out


def build_metadata(pdb_id, assembly_id, antigen_acc="P0DTC2"):
    mols = fetch_json(PDBE_MOLECULES_API.format(pdb_id=pdb_id)).get(pdb_id, [])
    unp = chain_uniprot_map(pdb_id)

    chains = []
    for m in mols:
        seq = m.get("sequence")
        is_protein = bool(seq) and str(m.get("molecule_type", "")).lower().startswith("polypeptide") \
            or (bool(seq) and m.get("molecule_type") is None)
        name = (m.get("molecule_name") or [None])
        name = name[0] if isinstance(name, list) else name
        entity_id = m.get("entity_id")
        for ch in m.get("in_chains", []):
            acc, acc_name = unp.get(ch, (None, None))
            # Antibody-ness is decided downstream by ANARCII (run_anarcii.map_entry) — the SOLE
            # authority. Every protein chain is an ANARCII candidate; molecule titles are NOT used to
            # pre-classify, because a nanobody named e.g. "Nanobody against SARS-CoV-2" would
            # otherwise be mislabelled as antigen and never tested (see antigen_rows_from_anarcii).
            role = "antibody_candidate" if is_protein else "other"
            chains.append({
                "pdb_id": pdb_id, "assembly_id": str(assembly_id),
                "auth_asym_id": ch, "entity_id": entity_id, "molecule_name": name,
                "sequence": seq, "length": len(seq) if seq else None,
                "is_protein": is_protein,
                "uniprot_accession": acc, "uniprot_name": acc_name,
                "role": role,
            })
    return chains


def antigen_rows_from_anarcii(chain_meta, antibody_chains, antigen_acc="P0DTC2"):
    """Derive antigen chains AFTER ANARCII has decided antibody-ness.

    ANARCII (via run_anarcii.map_entry -> antibody_chains) is the sole authority on whether a chain
    is antibody-like; titles are never used for that. Antigen = a protein chain ANARCII did NOT call
    an antibody that carries the antigen UniProt accession (chain-level SIFTS). The antigen name hint
    is a fallback used ONLY among these confirmed non-antibody chains, so it can never misclassify an
    antibody. Returns (antigen_rows, antigen_auth, antibody_auth).
    """
    antibody_auth = {c["auth_asym_id"] for c in antibody_chains if c.get("is_antibody")}
    non_ab = [c for c in chain_meta
              if c["role"] == "antibody_candidate" and c["auth_asym_id"] not in antibody_auth]

    def _is_antigen(c):
        name_l = (c.get("molecule_name") or "").lower()
        return c.get("uniprot_accession") == antigen_acc or any(h in name_l for h in ANTIGEN_NAME_HINTS)

    antigen = [c for c in non_ab if _is_antigen(c)]
    rows = [{
        "pdb_id": c["pdb_id"], "assembly_id": c["assembly_id"], "auth_asym_id": c["auth_asym_id"],
        "entity_id": c["entity_id"], "antigen_uniprot_accession": c.get("uniprot_accession"),
        "antigen_name": c.get("molecule_name"),
    } for c in antigen]
    return rows, {c["auth_asym_id"] for c in antigen}, antibody_auth


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pdb-id", required=True)
    ap.add_argument("--assembly-id", required=True)
    ap.add_argument("--antigen-acc", default="P0DTC2")
    ap.add_argument("--out-dir", default="data/intermediate")
    args = ap.parse_args()

    chains = build_metadata(args.pdb_id.lower(), args.assembly_id, antigen_acc=args.antigen_acc)
    candidates = [c for c in chains if c["role"] == "antibody_candidate"]

    os.makedirs(args.out_dir, exist_ok=True)
    with open(os.path.join(args.out_dir, "chain_metadata.json"), "w") as fh:
        json.dump(chains, fh, indent=1)

    log.info("pdb=%s chains=%d protein=%d", args.pdb_id, len(chains),
             sum(1 for c in chains if c["is_protein"]))
    log.info("protein chains (all ANARCII candidates): %s", sorted(c["auth_asym_id"] for c in candidates))
    log.info("antibody vs antigen split is determined by ANARCII downstream "
             "(run_anarcii.map_entry + antigen_rows_from_anarcii), not from titles here.")


if __name__ == "__main__":
    main()
