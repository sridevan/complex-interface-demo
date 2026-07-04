#!/usr/bin/env python3
"""
check_unp_anomalies.py

Scan a PDBe PISA "*_interfaces.json" file for spurious UniProt accessions attached
to residues in the bond arrays. This catches the class of upstream SIFTS/UniProt
mapping artefact observed in 6wps assembly 1, where a small, deterministic set of
antibody residues carry an antigen (e.g. P0DTC2) accession that is not real biology.

Two detection modes (both run by default):

  1. COVERAGE HEURISTIC (no metadata needed)
     On a genuine antigen chain, essentially every interface residue is UniProt-mapped
     (~100% of interface residues carry an accession). On an antibody chain, only a
     stray handful do. So any accession-bearing residue on a chain whose overall
     accession coverage is below a threshold (default 90%) is flagged. This is
     metadata-free and works on any interfaces file. (In 6wps: antigen chains A/B/E are
     100% covered; antibody chains C/D/F/G/H/L are 4-18% covered.)

  2. CHAIN-AWARE (optional, most precise)
     If you pass --antibody-chains and/or --antigen-acc, any bond residue on a known
     antibody chain that nonetheless carries the antigen accession is flagged directly.
     This mirrors the pipeline's chain-based classification rule.

Usage:
  python check_unp_anomalies.py 6wps_assembly1_interfaces.json
  python check_unp_anomalies.py 6wps_assembly1_interfaces.json \
      --antigen-acc P0DTC2 --antibody-chains C,D,F,G,H,L
  python check_unp_anomalies.py 6wps_assembly1_interfaces.json --out mapping_anomalies.json

Exit code is 0 if no anomalies, 1 if anomalies were found (handy for CI).
"""

import argparse
import json
import sys
from collections import defaultdict

BOND_TYPES = [
    "hydrogen_bonds",
    "salt_bridges",
    "disulfide_bonds",
    "covalent_bonds",
    "other_bonds",
]


def load_interfaces(path):
    with open(path) as fh:
        data = json.load(fh)
    # Top-level key is the PDB id; grab the single entry.
    if len(data) != 1:
        # Fall back: find the first value that looks like {assembly: {...}}
        for k, v in data.items():
            if isinstance(v, dict) and "assembly" in v:
                return k, v
        raise ValueError("Unexpected top-level structure; no 'assembly' block found.")
    pdb_id = next(iter(data))
    return pdb_id, data[pdb_id]


def iter_bond_sides(interfaces):
    """Yield one dict per (bond, side) with the fields we care about."""
    for itf in interfaces:
        iid = itf.get("interface_id")
        for bt in BOND_TYPES:
            bd = itf.get(bt)
            if not isinstance(bd, dict) or not bd:
                continue
            n = len(bd.get("bond_distances", []))
            for i in range(n):
                for side in (1, 2):
                    yield {
                        "interface_id": iid,
                        "bond_type": bt,
                        "bond_index": i,
                        "side": side,
                        "chain": _get(bd, f"atom_site_{side}_chains", i),
                        "residue": _get(bd, f"atom_site_{side}_residues", i),
                        "auth_num": _get(bd, f"atom_site_{side}_seq_nums", i),
                        "label_num": _get(bd, f"atom_site_{side}_label_seq_ids", i),
                        "unp_acc": _get(bd, f"atom_site_{side}_unp_accs", i),
                        "unp_num": _get(bd, f"atom_site_{side}_unp_nums", i),
                        "inscode": _get(bd, f"atom_site_{side}_inscodes", i),
                    }


def _get(bd, key, i):
    arr = bd.get(key)
    if arr is None or i >= len(arr):
        return None
    return arr[i]


def detect(pdb_id, assembly_id, interfaces, antigen_acc=None, antibody_chains=None,
           antigen_frac_threshold=0.90):
    antibody_chains = set(antibody_chains or [])

    # Gather per-residue accession behaviour.
    # key = (chain, auth_num) -> {"accs": set(), "unp_nums": set(), "residue": str}
    residues = defaultdict(
        lambda: {"accs": set(), "unp_nums": set(), "residue": None}
    )
    # Per-chain coverage: how many interface residues on the chain, and how many carry an accession.
    chain_residues = defaultdict(set)
    chain_acc_residues = defaultdict(set)
    occurrences = []  # list of the per-(bond,side) dicts

    for rec in iter_bond_sides(interfaces):
        if rec["chain"] is None or rec["auth_num"] is None:
            continue
        key = (rec["chain"], str(rec["auth_num"]))
        r = residues[key]
        r["residue"] = rec["residue"]
        chain_residues[rec["chain"]].add(str(rec["auth_num"]))
        if rec["unp_acc"]:
            r["accs"].add(rec["unp_acc"])
            chain_acc_residues[rec["chain"]].add(str(rec["auth_num"]))
            if rec["unp_num"] is not None:
                r["unp_nums"].add(str(rec["unp_num"]))
        occurrences.append(rec)

    # Per-chain accession coverage fraction. Genuine antigen chains are ~100% mapped;
    # antibody chains carrying stray accessions sit far below the threshold.
    chain_frac = {
        ch: (len(chain_acc_residues[ch]) / len(chain_residues[ch]) if chain_residues[ch] else 0.0)
        for ch in chain_residues
    }
    antigen_like = {ch for ch, fr in chain_frac.items() if fr >= antigen_frac_threshold}

    anomalies = []  # aggregated, one per (chain, auth_num, spurious_acc)

    # --- Mode 1: coverage heuristic (metadata-free) ---
    # An accession-bearing residue on a chain that is NOT antigen-like is anomalous:
    # the chain is overwhelmingly unmapped, so the few accessions on it are stray.
    coverage_flagged_keys = set()
    for key, r in residues.items():
        chain, _ = key
        if r["accs"] and chain not in antigen_like:
            coverage_flagged_keys.add(key)

    # --- Mode 2: chain-aware (antibody chain carrying the antigen accession) ---
    chain_flagged_keys = set()
    if antibody_chains or antigen_acc:
        for key, r in residues.items():
            chain, _ = key
            if antibody_chains and chain not in antibody_chains:
                continue
            for acc in r["accs"]:
                if antigen_acc is None or acc == antigen_acc:
                    chain_flagged_keys.add(key)
                    break

    flagged_keys = coverage_flagged_keys | chain_flagged_keys

    # Build aggregated anomaly records with occurrence counts and example locations.
    counts = defaultdict(int)
    locations = defaultdict(list)
    for rec in occurrences:
        if rec["chain"] is None or rec["auth_num"] is None or not rec["unp_acc"]:
            continue
        key = (rec["chain"], str(rec["auth_num"]))
        if key not in flagged_keys:
            continue
        akey = (rec["chain"], str(rec["auth_num"]), rec["unp_acc"], str(rec["unp_num"]))
        counts[akey] += 1
        if len(locations[akey]) < 5:
            locations[akey].append(
                {
                    "interface_id": rec["interface_id"],
                    "bond_type": rec["bond_type"],
                    "bond_index": rec["bond_index"],
                }
            )

    for (chain, auth_num, acc, unp_num), cnt in sorted(
        counts.items(), key=lambda kv: (-kv[1], kv[0])
    ):
        key = (chain, auth_num)
        reasons = []
        if key in coverage_flagged_keys:
            reasons.append("accession_on_low_coverage_chain")
        if key in chain_flagged_keys:
            reasons.append("antigen_accession_on_antibody_chain")
        anomalies.append(
            {
                "pdb_id": pdb_id,
                "assembly_id": assembly_id,
                "antibody_auth_asym_id": chain,
                "antibody_residue_author_number": auth_num,
                "antibody_residue_name": residues[key]["residue"],
                "spurious_unp_accession": acc,
                "spurious_unp_position": unp_num,
                "occurrence_count": cnt,
                "reasons": reasons,
                "example_locations": locations[(chain, auth_num, acc, unp_num)],
            }
        )

    return anomalies


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("interfaces_json", help="Path to a *_interfaces.json PISA file")
    ap.add_argument("--antigen-acc", default=None,
                    help="Antigen UniProt accession (e.g. P0DTC2) for chain-aware mode")
    ap.add_argument("--antibody-chains", default=None,
                    help="Comma-separated author chain ids known to be antibody (e.g. C,D,F,G,H,L)")
    ap.add_argument("--antigen-frac-threshold", type=float, default=0.90,
                    help="Chains with accession coverage >= this are treated as antigen-like "
                         "(default 0.90); accession-bearing residues on other chains are flagged")
    ap.add_argument("--out", default=None,
                    help="Write anomalies to this JSON path (default: stdout summary only)")
    args = ap.parse_args()

    antibody_chains = (
        [c.strip() for c in args.antibody_chains.split(",") if c.strip()]
        if args.antibody_chains
        else None
    )

    pdb_id, block = load_interfaces(args.interfaces_json)
    assembly_id = block.get("assembly_id")
    interfaces = block.get("assembly", {}).get("interfaces", [])

    anomalies = detect(
        pdb_id, assembly_id, interfaces,
        antigen_acc=args.antigen_acc,
        antibody_chains=antibody_chains,
        antigen_frac_threshold=args.antigen_frac_threshold,
    )

    total_occurrences = sum(a["occurrence_count"] for a in anomalies)
    print(f"PDB {pdb_id} assembly {assembly_id}: {len(interfaces)} interfaces scanned")
    print(f"Distinct anomalous residues: {len(anomalies)}")
    print(f"Total anomalous bond-record occurrences: {total_occurrences}")
    if anomalies:
        print("\nDistinct anomalous residues:")
        print(f"  {'chain':>5} {'resnum':>6} {'res':>4} {'acc':>8} {'unp#':>5} {'count':>6}  reasons")
        for a in anomalies:
            print(f"  {a['antibody_auth_asym_id']:>5} "
                  f"{a['antibody_residue_author_number']:>6} "
                  f"{str(a['antibody_residue_name']):>4} "
                  f"{a['spurious_unp_accession']:>8} "
                  f"{str(a['spurious_unp_position']):>5} "
                  f"{a['occurrence_count']:>6}  {','.join(a['reasons'])}")

    if args.out:
        with open(args.out, "w") as fh:
            json.dump(anomalies, fh, indent=2)
        print(f"\nWrote {len(anomalies)} anomaly records to {args.out}")

    # Exit non-zero if anomalies found (useful in CI / batch scans).
    sys.exit(1 if anomalies else 0)


if __name__ == "__main__":
    main()
