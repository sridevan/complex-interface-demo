#!/usr/bin/env python3
"""
fetch_complex_details.py — Step 1 of the spec.

Query the PDBe-KB complex-details API for a PDB-Complex ID and emit the list of
assemblies belonging to the complex.

Verified API shape (2026, against PDB-CPX-140202):
  GET https://www.ebi.ac.uk/pdbe/api/v2/complex/details/{ID}?id_type=pdb_complex_id
  -> { "<ID>": [ { name, participants, assemblies:[ {pdb_id, assembly_id(int),
                    preferred_assembly, title, experimental_method, resolution,
                    bound_macromolecules:[...] }, ... ], ... } ] }

`assemblies` is the field that lists assemblies (NOT assumed to be assembly1). We keep the
API's own assembly_id. Antibody-bound assemblies are those with a non-empty
`bound_macromolecules` (in PDB-CPX-140202: 458 'antibody' + 4 'peptide' of 890 total).

Outputs:
  data/raw/complex/complex_details_{ID}.json    raw API response (cache)
  data/raw/complex/assemblies_for_complex.json  [ {pdb_complex_id, pdb_id, assembly_id,
                                                   bound_macromolecules, ...}, ... ]

Usage:
  python fetch_complex_details.py --complex-id PDB-CPX-140202 \
      [--only-bound] [--only-pdb 6wps] [--out-dir data/raw/complex]
"""

import argparse
import json
import os

import requests

from common import get_logger

log = get_logger("fetch_complex")

API = "https://www.ebi.ac.uk/pdbe/api/v2/complex/details/{cid}?id_type=pdb_complex_id"


def fetch(complex_id, timeout=60):
    url = API.format(cid=complex_id)
    log.info("GET %s", url)
    r = requests.get(url, timeout=timeout)
    r.raise_for_status()
    return r.json()


def extract_assemblies(complex_id, payload, only_bound=False, only_pdb=None):
    entries = payload.get(complex_id) or []
    if not entries:
        raise ValueError(f"No entry for {complex_id} in API response")
    entry = entries[0]
    name = entry.get("name")
    assemblies = entry.get("assemblies", []) or []
    log.info("complex '%s': %d assemblies total", name, len(assemblies))

    out = []
    skipped_ext = 0
    for a in assemblies:
        pdb_id = str(a.get("pdb_id", "")).lower()
        if len(pdb_id) != 4:  # extended 12-char ids are out of scope for v1 (spec)
            skipped_ext += 1
            log.warning("skipping non-4-char pdb id (out of scope): %s", pdb_id)
            continue
        bound = a.get("bound_macromolecules") or []
        if only_bound and not bound:
            continue
        if only_pdb and pdb_id != only_pdb.lower():
            continue
        out.append({
            "pdb_complex_id": complex_id,
            "pdb_id": pdb_id,
            "assembly_id": str(a.get("assembly_id")),
            "preferred_assembly": a.get("preferred_assembly", False),
            "title": a.get("title"),
            "experimental_method": a.get("experimental_method"),
            "resolution": a.get("resolution"),
            "bound_macromolecules": bound,
        })

    n_bound = sum(1 for a in out if a["bound_macromolecules"])
    log.info("kept %d assemblies (%d antibody/peptide-bound); skipped %d extended ids",
             len(out), n_bound, skipped_ext)
    return name, out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--complex-id", default="PDB-CPX-140202")
    ap.add_argument("--out-dir", default="data/raw/complex")
    ap.add_argument("--only-bound", action="store_true",
                    help="keep only assemblies with bound macromolecules (antibody/peptide)")
    ap.add_argument("--only-pdb", default=None, help="restrict to a single pdb id (e.g. 6wps) for validation")
    args = ap.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)
    payload = fetch(args.complex_id)
    with open(os.path.join(args.out_dir, f"complex_details_{args.complex_id}.json"), "w") as fh:
        json.dump(payload, fh, indent=1)

    name, assemblies = extract_assemblies(
        args.complex_id, payload, only_bound=args.only_bound, only_pdb=args.only_pdb)
    out_path = os.path.join(args.out_dir, "assemblies_for_complex.json")
    with open(out_path, "w") as fh:
        json.dump(assemblies, fh, indent=1)
    log.info("wrote %d assemblies -> %s", len(assemblies), out_path)


if __name__ == "__main__":
    main()
