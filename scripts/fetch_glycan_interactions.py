#!/usr/bin/env python3
"""
fetch_glycan_interactions.py — cache PDBe's PRE-COMPUTED glycan interactions for every entry.

PDBe (Arpeggio) already computes, per bound molecule, its residue-level interactions with the
structure — including the `covalent` bond to the glycosylation-site residue and any `hbond`/
`hydrophobic`/`vdw` contacts with other chains (e.g. an antibody paratope). We just cache those
records; the join to interface residues happens in build_aggregations. No geometry is computed here.

Per entry: GET bound_molecules/{pdb} (one call) -> keep bound molecules that are glycans (contain a
sugar monomer) -> GET bound_molecule_interactions/{pdb}/{bm_id} for each (one call each).

  python fetch_glycan_interactions.py [--processed ...] [--out-dir data/raw/glycans] [--skip-existing]

Output: data/raw/glycans/{pdb}.json = [ {bm_id, composition, interactions:[...]}, ... ]  (glycans only)
"""

import argparse
import json
import os

import requests

BM = "https://www.ebi.ac.uk/pdbe/graph-api/pdb/bound_molecules/{pdb}"
BMI = "https://www.ebi.ac.uk/pdbe/graph-api/pdb/bound_molecule_interactions/{pdb}/{bm}"

# Common carbohydrate monomer chem_comp_ids — a bound molecule containing any of these is a glycan.
SUGARS = {"NAG", "NDG", "BMA", "MAN", "FUC", "FUL", "GAL", "GLA", "SIA", "NGA", "A2G",
          "BGC", "GLC", "XYP", "RAM", "GCU", "MAL", "KDN", "NGZ", "BM3", "BM7"}


def is_glycan(bm):
    ligs = (bm.get("composition") or {}).get("ligands") or []
    return any((l.get("chem_comp_id") in SUGARS) for l in ligs)


def load_pdb_ids(processed):
    return sorted({r["pdb_id"] for r in json.load(open(processed))})


def fetch_entry(pdb, session, timeout=60):
    r = session.get(BM.format(pdb=pdb), timeout=timeout)
    if r.status_code == 404:
        return []
    r.raise_for_status()
    bms = r.json().get(pdb, [])
    out = []
    for bm in bms:
        if not is_glycan(bm):
            continue
        ri = session.get(BMI.format(pdb=pdb, bm=bm["bm_id"]), timeout=timeout)
        if ri.status_code == 404:
            continue
        ri.raise_for_status()
        recs = ri.json().get(pdb, [])
        if not recs:
            continue
        out.append({"bm_id": bm["bm_id"], "composition": recs[0].get("composition"),
                    "interactions": recs[0].get("interactions", [])})
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--processed", default="data/processed/processed_antibody_antigen_interfaces.json")
    ap.add_argument("--out-dir", default="data/raw/glycans")
    ap.add_argument("--skip-existing", action="store_true")
    args = ap.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)
    session = requests.Session()
    total_glycans = 0
    for pdb in load_pdb_ids(args.processed):
        dest = os.path.join(args.out_dir, f"{pdb}.json")
        if args.skip_existing and os.path.exists(dest):
            continue
        try:
            recs = fetch_entry(pdb, session)
        except Exception as e:
            print(f"[{pdb}] FAILED: {type(e).__name__}: {e}")
            continue
        json.dump(recs, open(dest, "w"), indent=1)
        total_glycans += len(recs)
        print(f"[{pdb}] {len(recs)} glycan bound-molecules cached")
    print(f"done: {total_glycans} glycan bound-molecules across all entries -> {args.out_dir}")


if __name__ == "__main__":
    main()
