#!/usr/bin/env python3
"""
flag_multidomain_antibodies.py — flag antibody chains that carry MORE THAN ONE
variable domain (tandem scFv, bispecific, tribody, tandem-VHH ...).

Why: IMGT numbering is defined per V-domain (positions 1-128, CDRs at fixed spots),
so a multi-domain chain has several independent 1-128 blocks. Our pipeline numbers
only ONE domain per chain (single query_start/end in run_anarcii.walk_chain) and has
no domain-id column, so a chain with >=2 variable domains has its paratope IMGT
positions conflated / partly unmapped. The EPITOPE side (PISA + antigen mapping) is
unaffected — this only caveats the antibody-side IMGT annotation.

Detection: iteratively number each chain's observed sequence with ANARCII, then
re-number the tail after each numbered domain. A Fab's CH1 / a VHH's trimerization
scaffold does NOT number as a variable domain, so those correctly count as 1 (the
constant/scaffold tail is expected and not flagged).

  python scripts/flag_multidomain_antibodies.py
      [--processed data/processed/residue_level_interactions.json]
      [--out data/processed/multidomain_antibody_chains.json]

Output: data/processed/multidomain_antibody_chains.json
  { "{pdb}|{chain}": {"n_variable_domains": int, "n_residues": int}, ... }  (only chains with >=2)
"""

import argparse
import json
import os

from collections import defaultdict

import run_anarcii as ra
from common import CHAIN_TYPE_COLLAPSE, get_logger, observed_residues

log = get_logger("flag_multidomain")

MIN_DOMAIN_LEN = 65   # a variable domain needs at least this many observed residues to detect


def _valid(res):
    return res is not None and res.get("error") is None and res.get("chain_type") in CHAIN_TYPE_COLLAPSE


def count_variable_domains(sequences, model):
    """sequences: {key: seq}. Returns {key: n_variable_domains} via iterative ANARCII
    numbering of each sequence and its post-domain tails (batched per round)."""
    ndom = {k: 0 for k in sequences}
    active = {k: sequences[k] for k in sequences if len(sequences[k]) >= MIN_DOMAIN_LEN}
    for _ in range(6):                                    # 6 rounds >> any real domain count
        keys = [k for k, t in active.items() if len(t) >= MIN_DOMAIN_LEN]
        if not keys:
            break
        results = ra.number_sequences([active[k] for k in keys], model=model)
        nxt = {}
        for k, res in zip(keys, results):
            if _valid(res):
                ndom[k] += 1
                rem = active[k][res["query_end"] + 1:]
                if len(rem) >= MIN_DOMAIN_LEN:
                    nxt[k] = rem
        active = nxt
    return ndom


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--processed", default="data/processed/residue_level_interactions.json")
    ap.add_argument("--structures", default="data/raw/structures")
    ap.add_argument("--out", default="data/processed/multidomain_antibody_chains.json")
    args = ap.parse_args()

    R = json.load(open(args.processed))
    ab_chains = sorted({(r["pdb_id"], r["antibody_chain_id"]) for r in R})

    # observed sequence per antibody chain; dedupe identical sequences to save ANARCII calls
    seq_of, uniq = {}, defaultdict(list)
    for pdb, ch in ab_chains:
        cif = os.path.join(args.structures, f"{pdb}_updated.cif")
        if not os.path.exists(cif):
            continue
        s = "".join(o[3] for o in observed_residues(cif, ch))
        if s:
            seq_of[(pdb, ch)] = s
            uniq[s].append((pdb, ch))

    model = ra.get_model()
    ndom_seq = count_variable_domains({s: s for s in uniq}, model)

    out = {}
    for s, chains in uniq.items():
        n = ndom_seq.get(s, 0)
        if n >= 2:
            for pdb, ch in chains:
                out[f"{pdb}|{ch}"] = {"n_variable_domains": n, "n_residues": len(s)}

    with open(args.out, "w") as fh:
        json.dump(out, fh, indent=1)

    npairs = sum(1 for r in R if f"{r['pdb_id']}|{r['antibody_chain_id']}" in out)
    log.info("flagged %d multi-domain antibody chains across %d PDBs (%d/%d contact pairs, %.1f%%)",
             len(out), len({k.split('|')[0] for k in out}), npairs, len(R), 100 * npairs / max(1, len(R)))
    log.info("wrote %s", args.out)


if __name__ == "__main__":
    main()
