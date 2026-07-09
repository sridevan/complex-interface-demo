#!/usr/bin/env python3
"""Fetch short UniProt summaries (name, gene, organism, length, function) for a set of
accessions and write them keyed by accession, for display on a complex interface page.

Usage:
    python scripts/fetch_uniprot_summary.py --out data/processed/PDB-CPX-131443/uniprot_summary.json P01958 P02062
"""
import argparse
import json
import sys
import urllib.request

API = "https://rest.uniprot.org/uniprotkb/{acc}.json"


def fetch(acc):
    with urllib.request.urlopen(API.format(acc=acc), timeout=30) as r:
        d = json.load(r)
    name = (d.get("proteinDescription", {}).get("recommendedName", {})
            .get("fullName", {}).get("value"))
    genes = d.get("genes", [])
    gene = genes[0].get("geneName", {}).get("value") if genes else None
    # Capture ALL function texts (some entries have several FUNCTION blocks).
    function_texts = []
    for c in d.get("comments", []):
        if c.get("commentType") == "FUNCTION":
            function_texts += [t["value"] for t in c.get("texts", [])]
    return {
        "accession": d.get("primaryAccession", acc),
        "name": name,
        "gene": gene,
        "organism": d.get("organism", {}).get("scientificName"),
        "length": d.get("sequence", {}).get("length"),
        "function": " ".join(
            t if t.endswith((".", "!", "?")) else t + "." for t in function_texts) or None,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("accessions", nargs="+")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    out = {}
    for acc in args.accessions:
        try:
            out[acc] = fetch(acc)
            print(f"  {acc}: {out[acc]['name']}", file=sys.stderr)
        except Exception as e:  # noqa: BLE001
            print(f"  {acc}: FAILED ({e})", file=sys.stderr)
    with open(args.out, "w") as f:
        json.dump(out, f, indent=1)
    print(f"wrote {len(out)} summaries -> {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
