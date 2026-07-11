#!/usr/bin/env python3
"""
fetch_sabdab2_ids.py — cache SAbDab2's canonical antibody IDs for every entry and
build a per-chain lookup joinable onto our interface instances.

SAbDab2 (OPIG) assigns each variable region a sequence-derived ID (`sabdab2_H....L....`)
from its IMGT numbering, grouping identical antibodies across PDB IDs, formats, and bound
states. We POST one query per PDB to its public API and cache the returned summary; the
join to our interface rows happens client-side by (pdb_id, antibody_chain, chain_type).
No numbering is computed here — this is a membership join, like the variant/glycan overlays.

Per entry: POST /api/download/search-summary {"pdb_entry": "pdb_0000<pdb>"} -> CSV of Fv
instances (one row per H/L pair or single domain), each carrying SABDAB_ID / HEAVY_ID /
LIGHT_ID / Hchain / Lchain plus antibody metadata (type, V-gene subclass, species).

  python fetch_sabdab2_ids.py [--processed data/processed/residue_level_interactions.json]
                              [--raw-dir data/raw/sabdab2] [--out data/processed/sabdab2_ids.json]
                              [--skip-existing]

Output:
  data/raw/sabdab2/{pdb}.csv            raw per-entry summary (cache)
  data/processed/sabdab2_ids.json       flat lookup "{pdb}|{chain}|{heavy|light}" -> {...}
"""

import argparse
import csv
import io
import json
import os
import time

import requests

API = "https://sabdab.opig.stats.ox.ac.uk/api/download/search-summary"
UA = "complex-interface-demo (research; contact asridevan86@gmail.com)"


def twelve(pdb):
    """4-char PDB code -> 12-char deposition id (e.g. 6wps -> pdb_00006wps)."""
    return "pdb_" + pdb.zfill(8)


def load_pdb_ids(processed):
    return sorted({r["pdb_id"] for r in json.load(open(processed))})


def fetch_entry(pdb, session, timeout=60):
    """Return raw CSV text for a PDB, or '' if SAbDab2 has no matching instances."""
    r = session.post(API, json={"pdb_entry": twelve(pdb)}, timeout=timeout)
    if r.status_code == 404:
        return ""              # not in SAbDab2 / no antibody instances
    r.raise_for_status()
    return r.text


# columns we carry onto each chain-level lookup entry
KEEP = {
    "ab_type": "type",
    "heavy_subclass": "heavy_subclass",
    "light_subclass": "light_subclass",
    "light_ctype": "light_ctype",
    "compound": "compound",
}


def rows_to_lookup(pdb, csv_text, lookup):
    """Expand each Fv-instance row into per-chain lookup entries keyed by
    '{pdb}|{author_chain}|{heavy|light}'."""
    if not csv_text.strip() or csv_text.lstrip().startswith("{"):
        return 0
    n = 0
    for row in csv.DictReader(io.StringIO(csv_text)):
        sab = row.get("SABDAB_ID") or ""
        if not sab:
            continue
        meta_common = {
            "sabdab_id": sab,
            "ab_type": row.get("type") or "",
            "heavy_subclass": row.get("heavy_subclass") or "",
            "light_subclass": row.get("light_subclass") or "",
            "light_ctype": row.get("light_ctype") or "",
            "authors": (row.get("authors") or "").split(",")[0],
        }
        hchain, lchain = row.get("Hchain"), row.get("Lchain")
        hid, lid = row.get("HEAVY_ID"), row.get("LIGHT_ID")
        if hchain and hchain != "NA":
            lookup[f"{pdb}|{hchain}|heavy"] = {**meta_common, "chain_id": hid, "partner_id": lid}
            n += 1
        if lchain and lchain != "NA":
            lookup[f"{pdb}|{lchain}|light"] = {**meta_common, "chain_id": lid, "partner_id": hid}
            n += 1
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--processed", default="data/processed/residue_level_interactions.json")
    ap.add_argument("--raw-dir", default="data/raw/sabdab2")
    ap.add_argument("--out", default="data/processed/sabdab2_ids.json")
    ap.add_argument("--skip-existing", action="store_true",
                    help="reuse cached data/raw/sabdab2/{pdb}.csv instead of re-fetching")
    ap.add_argument("--sleep", type=float, default=0.3, help="courtesy delay between requests (s)")
    args = ap.parse_args()

    os.makedirs(args.raw_dir, exist_ok=True)
    pdb_ids = load_pdb_ids(args.processed)
    session = requests.Session()
    session.headers.update({"User-Agent": UA, "Content-Type": "application/json"})

    lookup = {}
    missing, matched = [], 0
    for i, pdb in enumerate(pdb_ids, 1):
        cache = os.path.join(args.raw_dir, f"{pdb}.csv")
        if args.skip_existing and os.path.exists(cache):
            csv_text = open(cache).read()
        else:
            try:
                csv_text = fetch_entry(pdb, session)
            except Exception as e:
                print(f"[{i}/{len(pdb_ids)}] {pdb}: ERROR {e}")
                missing.append(pdb)
                continue
            with open(cache, "w") as fh:
                fh.write(csv_text)
            time.sleep(args.sleep)
        added = rows_to_lookup(pdb, csv_text, lookup)
        if added:
            matched += 1
        else:
            missing.append(pdb)
        print(f"[{i}/{len(pdb_ids)}] {pdb}: {added} chain entries")

    # Fallback for multi-domain constructs: SAbDab2 splits an author chain that carries
    # several numerable domains (e.g. a tandem VHH "D" -> "D1","D2","D3"), while our
    # pipeline keeps the original author chain. Alias the base chain to its SAbDab2 ID
    # when every split of that (pdb, base, type) agrees and no exact key already exists.
    import re
    from collections import defaultdict
    split_groups = defaultdict(list)
    for key, val in list(lookup.items()):
        pdb, chain, ctype = key.split("|")
        m = re.fullmatch(r"([A-Za-z]+)\d+", chain)
        if m:
            split_groups[(pdb, m.group(1), ctype)].append(val)
    aliased = 0
    for (pdb, base, ctype), vals in split_groups.items():
        bkey = f"{pdb}|{base}|{ctype}"
        if bkey in lookup:
            continue
        if len({v["sabdab_id"] for v in vals}) == 1:
            lookup[bkey] = {**vals[0], "chain_split": True}
            aliased += 1
    if aliased:
        print(f"aliased {aliased} multi-domain base chains to their SAbDab2 ID")

    with open(args.out, "w") as fh:
        json.dump(lookup, fh)

    n_sab = len({v["sabdab_id"] for v in lookup.values()})
    print(f"\n{matched}/{len(pdb_ids)} PDBs matched in SAbDab2; "
          f"{len(lookup)} chain entries -> {n_sab} unique SAbDab2 IDs")
    if missing:
        print(f"no SAbDab2 match ({len(missing)}): {missing}")
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
