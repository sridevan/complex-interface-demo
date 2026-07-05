#!/usr/bin/env python3
"""
parse_pisa_interfaces.py — Step 3 of the spec.

Parse the *bond groups* (hydrogen_bonds, salt_bridges, disulfide_bonds, covalent_bonds,
other_bonds) inside each interface of a PISA "*_interfaces.json" file. This is the ONLY
reliable source of residue-residue pairing AND UniProt data (spec §3a). We deliberately do
NOT parse molecules[].residue_* — those arrays carry no UniProt and no pairing.

For each bond we emit ONE record capturing both sides (author + label ids, residue names,
unp acc/num, distance) and interaction_type = the bond-group name. Numeric strings are cast
to int; null insertion codes become blank. Antigen/antibody orientation is NOT decided here
(that is Step 8, by chain) — this step is a faithful, side-agnostic dump of the bond arrays.

Output: data/intermediate/pisa_residue_interactions.json

Usage:
  python parse_pisa_interfaces.py <interfaces.json> [--out PATH] [--pdb-complex-id ID]
"""

import argparse
import json
import os
from collections import Counter

from common import (
    BOND_TYPES,
    INTERACTION_TYPE,
    arr_get,
    blank_ins,
    get_logger,
    load_interfaces,
    to_int,
)

log = get_logger("parse_pisa")


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def interface_props(itf):
    """Per-interface PISA properties (constant across the interface's bond records): PISA energetics
    (interface area / solvation & stabilisation energy / interface P-value) and bond/residue counts.
    Emitted on every bond record so agg_interface_summary can read them from any row of the group."""
    return {
        "interface_area": _num(itf.get("interface_area")),
        "solvation_energy": _num(itf.get("solvation_energy")),
        "stabilization_energy": _num(itf.get("stabilization_energy")),
        "p_value": _num(itf.get("p_value")),
        "number_interface_residues": _int(itf.get("number_interface_residues")),
        "number_hydrogen_bonds": _int(itf.get("number_hydrogen_bonds")),
        "number_salt_bridges": _int(itf.get("number_salt_bridges")),
        "number_disulfide_bonds": _int(itf.get("number_disulfide_bonds")),
        "number_covalent_bonds": _int(itf.get("number_covalent_bonds")),
        "number_other_bonds": _int(itf.get("number_other_bonds")),
    }


def parse_side(bd, s, i):
    """Extract one side (s in {1,2}) of bond i as a dict, using the confirmed §3a mapping."""
    return {
        "chain_id": arr_get(bd, f"atom_site_{s}_chains", i),          # AUTHOR chain id
        "residue_name": arr_get(bd, f"atom_site_{s}_residues", i),
        "author_residue_number": to_int(arr_get(bd, f"atom_site_{s}_seq_nums", i)),
        "author_insertion_code": blank_ins(arr_get(bd, f"atom_site_{s}_inscodes", i)),
        "label_asym_id": arr_get(bd, f"atom_site_{s}_label_asym_ids", i),  # LABEL chain id
        "label_residue_number": to_int(arr_get(bd, f"atom_site_{s}_label_seq_ids", i)),
        "unp_acc": arr_get(bd, f"atom_site_{s}_unp_accs", i),         # UniProt acc (SPARSE/unreliable)
        "unp_num": to_int(arr_get(bd, f"atom_site_{s}_unp_nums", i)),  # UniProt position
    }


def parse_interfaces(pdb_id, block, pdb_complex_id=None):
    assembly_id = str(block.get("assembly_id"))
    interfaces = block.get("assembly", {}).get("interfaces", [])
    records = []
    per_type = Counter()
    per_interface = Counter()

    for itf in interfaces:
        interface_id = str(itf.get("interface_id"))
        props = interface_props(itf)
        for bt in BOND_TYPES:
            bd = itf.get(bt)
            if not isinstance(bd, dict) or not bd:
                continue
            n = len(bd.get("bond_distances", []) or [])
            for i in range(n):
                side1 = parse_side(bd, 1, i)
                side2 = parse_side(bd, 2, i)
                # Skip bonds with no chain on either side (non-polymer / malformed).
                if side1["chain_id"] is None and side2["chain_id"] is None:
                    continue
                rec = {
                    "pdb_complex_id": pdb_complex_id,
                    "pdb_id": pdb_id,
                    "assembly_id": assembly_id,
                    "interface_id": interface_id,
                    **props,
                    "interaction_type": INTERACTION_TYPE[bt],
                    "distance": arr_get(bd, "bond_distances", i),
                    "side1": side1,
                    "side2": side2,
                }
                records.append(rec)
                per_type[INTERACTION_TYPE[bt]] += 1
                per_interface[interface_id] += 1

    log.info("pdb=%s assembly=%s interfaces=%d bond records parsed=%d",
             pdb_id, assembly_id, len(interfaces), len(records))
    log.info("bond records by interaction_type: %s", dict(per_type))
    log.info("bond records by interface_id: %s", dict(sorted(per_interface.items(), key=lambda kv: int(kv[0]))))
    return records


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("interfaces_json")
    ap.add_argument("--out", default="data/intermediate/pisa_residue_interactions.json")
    ap.add_argument("--pdb-complex-id", default="PDB-CPX-140202")
    args = ap.parse_args()

    pdb_id, block = load_interfaces(args.interfaces_json)
    records = parse_interfaces(pdb_id, block, pdb_complex_id=args.pdb_complex_id)

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w") as fh:
        json.dump(records, fh, indent=1)
    log.info("wrote %d records -> %s", len(records), args.out)


if __name__ == "__main__":
    main()
