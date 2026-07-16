#!/usr/bin/env python3
"""build_viewer_contacts.py — atom-level interface contacts for the 3D "Show contacts" overlay.

The shipped residue_level_interactions.json is aggregated to the residue-pair level (bond-type
counts + min distance, no atom ids), which is not enough to draw atom-to-atom contact lines. This
script returns to the raw PISA bond arrays, extracts every atom–atom bond, classifies the two sides
as antigen vs antibody using the chain sets already established in residue_level_interactions.json,
and writes a compact per-interface contacts object for the antibody–antigen viewer:

  { "<pdb>|<assembly>|<interface>": {
      "specific": [ {chain1,resi1,atom1,res1, chain2,resi2,atom2,res2, type, distance}, ... ],
      "vdw":      [ ...one shortest line per residue pair (other_bond, collapsed)... ] } }

chain1/resi1/… = antigen side, chain2/resi2/… = antibody side (matching the viewer's ag/ab colours).
Specific bonds (hydrogen/salt/disulfide/covalent) are kept at atom resolution; van der Waals
("other") bonds are collapsed to one shortest line per residue pair so packing contacts don't become
a hairball — mirroring how the viewer already treats them, and keeping the shipped file small.

Raw PISA "*_interfaces.json" files are downloaded on demand from the PDBe split FTP (skip-existing;
data/raw/ is gitignored, so they are not committed).

Usage:
  python scripts/build_viewer_contacts.py
"""
import argparse
import json
import logging
import os
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import PISA_SPLIT_DIR, load_interfaces, pisa_split_mid          # noqa: E402
from parse_pisa_interfaces import parse_interfaces                          # noqa: E402

logging.getLogger("parse_pisa").setLevel(logging.WARNING)   # silence per-structure info spam

RAW_DIR = "data/raw/pisa"


def ensure_raw(pdb, asm):
    """Return the local path to <pdb>_assembly<asm>_interfaces.json, downloading it if absent.
    None if the id is out of scope or the file is 404/unreachable."""
    pdb = pdb.lower()
    try:
        mid = pisa_split_mid(pdb)
    except ValueError:
        return None
    dest_dir = os.path.join(RAW_DIR, pdb)
    os.makedirs(dest_dir, exist_ok=True)
    fname = f"{pdb}_assembly{asm}_interfaces.json"
    dest = os.path.join(dest_dir, fname)
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return dest
    url = PISA_SPLIT_DIR.format(mid=mid) + fname
    try:
        r = requests.get(url, timeout=120)
        if r.status_code == 404:
            return None
        r.raise_for_status()
        with open(dest, "wb") as fh:
            fh.write(r.content)
        return dest
    except Exception as e:  # noqa: BLE001
        print(f"  fetch fail {pdb} {asm}: {repr(e)[:80]}")
        return None


def contacts_for(path, agc, abc):
    """Parse one raw PISA file → {interface_id: {'specific': [...], 'vdw': [...]}} for ab–ag bonds."""
    pid, block = load_interfaces(path)
    recs = parse_interfaces(pid, block)
    spec = defaultdict(list)
    vdw = defaultdict(dict)  # interface_id -> {residue-pair key: shortest rec}
    for rec in recs:
        s1, s2 = rec["side1"], rec["side2"]
        c1, c2 = s1["chain_id"], s2["chain_id"]
        if c1 in agc and c2 in abc:
            ag, ab = s1, s2
        elif c2 in agc and c1 in abc:
            ag, ab = s2, s1
        else:
            continue  # not an antibody–antigen bond (ag–ag, ab–ab, or off-interface chain)
        try:
            dist = round(float(rec["distance"]), 2) if rec["distance"] is not None else None
        except (TypeError, ValueError):
            dist = None
        crec = {
            "chain1": ag["chain_id"], "resi1": ag["author_residue_number"],
            "atom1": ag["atom_id"] or None, "res1": ag["residue_name"],
            "chain2": ab["chain_id"], "resi2": ab["author_residue_number"],
            "atom2": ab["atom_id"] or None, "res2": ab["residue_name"],
            "type": rec["interaction_type"], "distance": dist,
        }
        iid = str(rec["interface_id"])
        if rec["interaction_type"] == "other_bond":
            vk = (ag["author_residue_number"], ab["chain_id"], ab["author_residue_number"])
            cur = vdw[iid].get(vk)
            if cur is None or (dist is not None and (cur["distance"] is None or dist < cur["distance"])):
                vdw[iid][vk] = crec
        else:
            spec[iid].append(crec)
    out = {}
    for iid in set(spec) | set(vdw):
        out[iid] = {"specific": spec.get(iid, []), "vdw": list(vdw.get(iid, {}).values())}
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--residue", default="data/processed/residue_level_interactions.json")
    ap.add_argument("--out", default="data/processed/viewer_contacts.json")
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()

    res = json.load(open(args.residue))
    ag_chains, ab_chains = defaultdict(set), defaultdict(set)
    for r in res:
        k = (r["pdb_id"], str(r["assembly_id"]))
        ag_chains[k].add(r["antigen_chain_id"])
        ab_chains[k].add(r["antibody_chain_id"])
    keys = sorted(ag_chains)
    print(f"{len(keys)} (pdb,assembly) pairs to process")

    # Download raw PISA files in parallel (skip-existing), then parse serially.
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        paths = list(ex.map(lambda k: (k, ensure_raw(k[0], k[1])), keys))

    out, missing, failed = {}, 0, 0
    for i, ((pdb, asm), path) in enumerate(paths, 1):
        if not path:
            missing += 1
            continue
        try:
            per_iface = contacts_for(path, ag_chains[(pdb, asm)], ab_chains[(pdb, asm)])
        except Exception as e:  # noqa: BLE001
            print(f"  parse fail {pdb} {asm}: {repr(e)[:80]}")
            failed += 1
            continue
        for iid, obj in per_iface.items():
            if obj["specific"] or obj["vdw"]:
                out[f"{pdb}|{asm}|{iid}"] = obj
        if i % 50 == 0:
            print(f"  {i}/{len(keys)} processed · {len(out)} interfaces so far")

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    json.dump(out, open(args.out, "w"))
    nspec = sum(len(v["specific"]) for v in out.values())
    nvdw = sum(len(v["vdw"]) for v in out.values())
    sz = os.path.getsize(args.out) / 1e6
    print(f"wrote {len(out)} interfaces ({nspec} specific + {nvdw} vdw lines) -> {args.out} ({sz:.1f} MB)")
    print(f"missing raw PISA: {missing} · parse failures: {failed}")


if __name__ == "__main__":
    main()
