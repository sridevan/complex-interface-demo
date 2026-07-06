#!/usr/bin/env python3
"""
build_structure_quality.py — per-assembly experimental method + resolution, joined
onto our interface instances by (pdb_id, assembly_id).

The dataset is ~99% cryo-EM (median ~3.3 A), so interface *residue-level* footprints
are the trustworthy unit; atomic/bond-level detail (H-bond vs salt-bridge, min_distance)
is only reliable on the high-resolution subset. This table carries resolution as a
per-structure QUALITY ATTRIBUTE — used to gate bond-level analyses, to drive a
resolution control in the app, and to sensitivity-check aggregates — never as a hard
filter (a >=3.0 A cut would gut the cryo-EM trimers that carry the conformational state).

Source: the PDB-Complex API payload already fetched by fetch_complex_details — each
assembly carries `experimental_method` + `resolution`. No extra network call in-pipeline;
`main()` re-fetches so the table can be regenerated standalone.

  python scripts/build_structure_quality.py [--complex-id PDB-CPX-140202]
      [--processed data/processed/residue_level_interactions.json]
      [--out data/processed/structure_quality.json]

Output: data/processed/structure_quality.json
  { "{pdb}|{assembly}": {"resolution": float|null, "method": str}, ... }
"""

import argparse
import json

import fetch_complex_details as fcd
from common import get_logger

log = get_logger("structure_quality")

# normalise the API's method strings to short tags for display
METHOD_TAG = {
    "Electron microscopy": "cryo-EM",
    "Electron Microscopy": "cryo-EM",
    "X-ray diffraction": "X-ray",
    "Solution NMR": "NMR",
}


def build(assemblies, keep_keys=None):
    """assemblies: extract_assemblies() output (dicts with pdb_id, assembly_id,
    resolution, experimental_method). keep_keys: optional set of '{pdb}|{asm}' to
    restrict to (e.g. the assemblies actually processed). Returns the lookup dict."""
    out = {}
    for a in assemblies:
        key = f"{a['pdb_id']}|{a['assembly_id']}"
        if keep_keys is not None and key not in keep_keys:
            continue
        method = a.get("experimental_method") or ""
        out[key] = {
            "resolution": a.get("resolution"),
            "method": METHOD_TAG.get(method, method),
        }
    return out


def _summary(lookup):
    res = sorted(v["resolution"] for v in lookup.values() if v["resolution"] is not None)
    from collections import Counter
    methods = Counter(v["method"] for v in lookup.values())
    med = res[len(res) // 2] if res else None
    le30 = sum(1 for r in res if r <= 3.0)
    le35 = sum(1 for r in res if r <= 3.5)
    log.info("%d assemblies | methods=%s | median=%.2f A | <=3.0A: %d (%d%%) | <=3.5A: %d (%d%%)",
             len(lookup), dict(methods), med or 0.0,
             le30, 100 * le30 // max(1, len(res)), le35, 100 * le35 // max(1, len(res)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--complex-id", default="PDB-CPX-140202")
    ap.add_argument("--processed", default="data/processed/residue_level_interactions.json")
    ap.add_argument("--out", default="data/processed/structure_quality.json")
    args = ap.parse_args()

    payload = fcd.fetch(args.complex_id)
    _, assemblies = fcd.extract_assemblies(args.complex_id, payload)

    # restrict to assemblies actually present in the processed dataset
    keep = {f"{r['pdb_id']}|{r['assembly_id']}" for r in json.load(open(args.processed))}
    lookup = build(assemblies, keep_keys=keep)
    _summary(lookup)

    with open(args.out, "w") as fh:
        json.dump(lookup, fh, indent=1)
    log.info("wrote %s (%d/%d processed assemblies matched)", args.out, len(lookup), len(keep))


if __name__ == "__main__":
    main()
