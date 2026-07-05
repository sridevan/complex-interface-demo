#!/usr/bin/env python3
"""
fetch_mutations.py — cache PDBe `mutated_AA_or_NA` records for every entry in the dataset.

We only ever SHOW mutations of `type == "Variant"` that land on an antigen interface residue
(the join happens in build_aggregations). Here we just pull the raw API data and cache it — no
geometry, no filtering by position. The endpoint accepts a POST body of comma-separated PDB ids,
so the whole batch is a handful of chunked requests.

  python fetch_mutations.py [--processed data/processed/processed_antibody_antigen_interfaces.json]
      [--out data/raw/mutations/mutations.json] [--chunk 50]

Output: {pdb_id: [ {entity_id, chain_id, residue_number, chem_comp_id,
                    mutation_details:{from,to,type}}, ... ], ...}
Entries with no mutations are simply absent from the API response (and thus the cache).
"""

import argparse
import json
import os

import requests

MUTATED_API = "https://www.ebi.ac.uk/pdbe/api/pdb/entry/mutated_AA_or_NA/"


def load_pdb_ids(processed):
    with open(processed) as fh:
        rows = json.load(fh)
    return sorted({r["pdb_id"] for r in rows})


def fetch(pdb_ids, chunk, timeout=120):
    merged = {}
    for i in range(0, len(pdb_ids), chunk):
        batch = pdb_ids[i:i + chunk]
        r = requests.post(MUTATED_API, data=",".join(batch), timeout=timeout,
                          headers={"Content-Type": "application/x-www-form-urlencoded"})
        if r.status_code == 404:
            continue  # none of this chunk carries mutation records
        r.raise_for_status()
        data = r.json()
        if isinstance(data, dict) and "message" in data and len(data) == 1:
            continue  # "Requested endpoint does not contain any data"
        merged.update(data)
    return merged


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--processed", default="data/processed/processed_antibody_antigen_interfaces.json")
    ap.add_argument("--out", default="data/raw/mutations/mutations.json")
    ap.add_argument("--chunk", type=int, default=50)
    args = ap.parse_args()

    pdb_ids = load_pdb_ids(args.processed)
    muts = fetch(pdb_ids, args.chunk)
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w") as fh:
        json.dump(muts, fh, indent=1)

    n_variant = sum(1 for recs in muts.values() for m in recs
                    if (m.get("mutation_details") or {}).get("type") == "Variant")
    print(f"fetched mutations for {len(muts)}/{len(pdb_ids)} entries "
          f"({sum(len(v) for v in muts.values())} records, {n_variant} of type Variant) -> {args.out}")


if __name__ == "__main__":
    main()
