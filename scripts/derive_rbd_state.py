#!/usr/bin/env python3
"""
derive_rbd_state.py — derive the SARS-CoV-2 spike RBD up/down conformational state
per protomer, per assembly, straight from coordinates (no external state annotation).

Metric: for each trimer assembly, fit the 3-fold axis as the principal axis of the
antigen-chain Cα cloud, then measure each protomer's RBD-centroid (UniProt 331-528)
radial distance from that axis. A DOWN RBD is tucked against the trimer core (low
radial); an UP RBD splays outward (high radial). Calibrated + validated against known
states (6wps closed = 21 Å ×3; 6zdg = 16/18/33 = 1-up; 6xcn = 40 ×3 = 3-up) and against
biology (class-1/ACE2-site-bound RBDs are radially displaced, MWU p≈2e-4). Threshold 30 Å.

Only full trimers (>=3 antigen chains, RBD modelled) get a state; isolated RBD / 1-2 chain
assemblies are labelled 'isolated_or_partial'.

  python scripts/derive_rbd_state.py [--threshold 30] [--out data/processed/rbd_conformational_state.json]

Output: data/processed/rbd_conformational_state.json
  { "<pdb>_<asm>": {state, n_up, n_down, per_chain:{chain:{radial, state}}}, ... }
"""

import argparse
import json
import os
from collections import defaultdict

import gemmi
import numpy as np

from common import get_logger

log = get_logger("rbd_state")
RBD_LO, RBD_HI = 331, 528


def rbd_radials(cif_path, antigen_chains):
    """Per antigen chain -> RBD-centroid radial distance from the trimer principal axis."""
    if not os.path.exists(cif_path):
        return {}
    model = gemmi.read_structure(cif_path)[0]
    chain_ca, allca = {}, []
    for ch in model:
        if ch.name in antigen_chains:
            d = {res.seqid.num: np.array([a.pos.x, a.pos.y, a.pos.z])
                 for res in ch for a in res if a.name == "CA"}
            if d:
                chain_ca[ch.name] = d
                allca += list(d.values())
    if len(allca) < 300:                       # need a real trimer, not a fragment
        return {}
    P = np.array(allca); center = P.mean(0)
    axis = np.linalg.svd(P - center)[2][0]     # principal axis = spike 3-fold
    out = {}
    for c, d in chain_ca.items():
        rbd = [p for n, p in d.items() if RBD_LO <= n <= RBD_HI]
        if len(rbd) < 50:
            continue
        rc = np.array(rbd).mean(0) - center
        h = rc @ axis
        out[c] = float(np.linalg.norm(rc - h * axis))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--processed", default="data/processed/residue_level_interactions.json")
    ap.add_argument("--structures", default="data/raw/structures")
    ap.add_argument("--threshold", type=float, default=30.0, help="radial Å: >= is 'up'")
    ap.add_argument("--out", default="data/processed/rbd_conformational_state.json")
    args = ap.parse_args()

    R = json.load(open(args.processed))
    asm_ag = defaultdict(set)
    for r in R:
        asm_ag[(r["pdb_id"], str(r["assembly_id"]))].add(r["antigen_chain_id"])

    out = {}
    state_counts = defaultdict(int)
    for (pdb, asm), chains in sorted(asm_ag.items()):
        key = f"{pdb}_{asm}"
        if len(chains) < 3:
            out[key] = {"state": "isolated_or_partial", "n_up": None, "n_down": None, "per_chain": {}}
            state_counts["isolated_or_partial"] += 1
            continue
        rad = rbd_radials(os.path.join(args.structures, f"{pdb}_updated.cif"), chains)
        if len(rad) < 3:
            out[key] = {"state": "isolated_or_partial", "n_up": None, "n_down": None, "per_chain": {}}
            state_counts["isolated_or_partial"] += 1
            continue
        per = {c: {"radial": round(v, 1), "state": "up" if v >= args.threshold else "down"}
               for c, v in rad.items()}
        n_up = sum(1 for v in per.values() if v["state"] == "up")
        state = {0: "closed (all-down)", 1: "1-up", 2: "2-up", 3: "3-up (open)"}.get(n_up, f"{n_up}-up")
        out[key] = {"state": state, "n_up": n_up, "n_down": len(per) - n_up, "per_chain": per}
        state_counts[state] += 1

    with open(args.out, "w") as fh:
        json.dump(out, fh, indent=1)
    log.info("wrote %s", args.out)
    for s, n in sorted(state_counts.items(), key=lambda x: -x[1]):
        log.info("  %-20s %d assemblies", s, n)


if __name__ == "__main__":
    main()
