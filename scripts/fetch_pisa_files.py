#!/usr/bin/env python3
"""
fetch_pisa_files.py — Step 2 of the spec.

For each (pdb_id, assembly_id) in assemblies_for_complex.json, build the PDBe FTP path
(split by the middle two chars of the lowercased pdb id) and download BOTH PISA files:

  {pdb_id}_assembly{assembly_id}.json             (assembly summary)
  {pdb_id}_assembly{assembly_id}_interfaces.json  (MAIN source)

into data/raw/pisa/{pdb_id}/. Missing files are recorded and skipped (spec). Extended
12-char PDB ids are logged and skipped.

Usage:
  python fetch_pisa_files.py [--assemblies data/raw/complex/assemblies_for_complex.json]
      [--out-dir data/raw/pisa] [--skip-existing]
"""

import argparse
import json
import os

import requests

from common import PISA_SPLIT_DIR, get_logger, pisa_split_mid

log = get_logger("fetch_pisa")


def download(url, dest, timeout=120):
    r = requests.get(url, timeout=timeout)
    if r.status_code == 404:
        return False, "404"
    r.raise_for_status()
    with open(dest, "wb") as fh:
        fh.write(r.content)
    return True, len(r.content)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--assemblies", default="data/raw/complex/assemblies_for_complex.json")
    ap.add_argument("--out-dir", default="data/raw/pisa")
    ap.add_argument("--skip-existing", action="store_true")
    args = ap.parse_args()

    with open(args.assemblies) as fh:
        assemblies = json.load(fh)

    missing = []
    downloaded = 0
    for a in assemblies:
        pdb_id = a["pdb_id"].lower()
        asm = a["assembly_id"]
        try:
            mid = pisa_split_mid(pdb_id)
        except ValueError as e:
            log.warning("%s", e)
            missing.append({"pdb_id": pdb_id, "assembly_id": asm, "reason": "extended_id"})
            continue
        base = PISA_SPLIT_DIR.format(mid=mid)
        dest_dir = os.path.join(args.out_dir, pdb_id)
        os.makedirs(dest_dir, exist_ok=True)
        for suffix in (f"_assembly{asm}.json", f"_assembly{asm}_interfaces.json"):
            fname = f"{pdb_id}{suffix}"
            url = base + fname
            dest = os.path.join(dest_dir, fname)
            if args.skip_existing and os.path.exists(dest) and os.path.getsize(dest) > 0:
                log.info("skip existing %s", dest)
                downloaded += 1
                continue
            ok, info = download(url, dest)
            if ok:
                downloaded += 1
                log.info("downloaded %s (%s bytes)", dest, info)
            else:
                log.warning("MISSING %s (%s)", url, info)
                missing.append({"pdb_id": pdb_id, "assembly_id": asm, "file": fname, "reason": info})

    os.makedirs(args.out_dir, exist_ok=True)
    with open(os.path.join(args.out_dir, "missing_pisa_files.json"), "w") as fh:
        json.dump(missing, fh, indent=1)
    log.info("PISA download complete: %d files present, %d missing", downloaded, len(missing))


if __name__ == "__main__":
    main()
