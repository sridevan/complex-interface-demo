#!/usr/bin/env python3
"""Build the chain-correspondence dataset (complex_chain_class + complex_chain_instance) for a
PDBe-KB complex from the per-assembly pairwise chain-correspondence CSVs.

Approach (representative-anchored star graph — NOT global connected components, which collapse
under D2 symmetry ambiguity where every alpha chain looks equivalent to every other):

  1. The PDBe complex API names a representative assembly and the participant UniProt accessions.
  2. The representative's chains DEFINE the chain classes: each chain is mapped to its accession
     (SIFTS, stripping the assembly copy suffix "-N" to reach the deposited chain), and the copies
     of one accession are numbered 1..n by chain order -> component_label "<accession>-<index>".
  3. Every other assembly inherits classes by following the pairwise cc.csv that links it DIRECTLY
     to the representative (bidirectional lookup: the unique-pair CSV may live under either folder).
     This is the "exactly one representative chain per component" rule from the ingestion schema.

Inputs : <raw_dir>/<entry>_<assembly>/<a>-<b>_cc.csv   (cols: pdb_complex_id,asm_id1,asym_id1,asm_id2,asym_id2)
Outputs: <out>/complex_chain_class.json, <out>/complex_chain_instance.json

Usage:
    python scripts/build_chain_correspondence.py --complex PDB-CPX-131443 \
        --raw-dir PDB-CPX-131443 --out data/processed/PDB-CPX-131443
"""
import argparse
import csv
import glob
import json
import os
import sys

import requests

DETAILS = "https://www.ebi.ac.uk/pdbe/api/v2/complex/details/{cx}?id_type=pdb_complex_id"
SIFTS = "https://www.ebi.ac.uk/pdbe/api/mappings/uniprot/{pdb}"


def log(*a):
    print(*a, file=sys.stderr)


def base_chain(asym):
    """Assembly chain label -> deposited (struct_asym) chain: strip a trailing copy suffix "-N"."""
    return asym.split("-")[0]


def chain_sort_key(asym):
    """Order chains of one accession deterministically: by base label, then numeric copy suffix."""
    b, _, suf = asym.partition("-")
    return (b, int(suf) if suf.isdigit() else 0)


def index_cc(raw_dir):
    """Index every pairwise cc.csv by the unordered assembly pair -> list of (chainA, asmA, chainB, asmB)."""
    pairs = {}
    for f in glob.glob(os.path.join(raw_dir, "*", "*_cc.csv")):
        for r in csv.DictReader(open(f)):
            a1, c1, a2, c2 = r["asm_id1"], r["asym_id1"], r["asm_id2"], r["asym_id2"]
            pairs.setdefault(frozenset((a1, a2)), []).append((a1, c1, a2, c2))
    return pairs


def rep_to_other(pairs, rep, other):
    """Map {representative chain -> corresponding chain in `other`} from the rep<->other cc.csv."""
    rows = pairs.get(frozenset((rep, other)))
    if not rows:
        return None
    m = {}
    for a1, c1, a2, c2 in rows:
        if a1 == rep and a2 == other:
            m[c1] = c2
        elif a1 == other and a2 == rep:
            m[c2] = c1
    return m


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--complex", default="PDB-CPX-131443")
    ap.add_argument("--raw-dir", default="PDB-CPX-131443")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()
    CX = args.complex
    NUM = CX.split("-")[-1]
    out = args.out or f"data/processed/{CX}"

    details = requests.get(DETAILS.format(cx=CX), timeout=30).json()[CX][0]
    rep = details["representative_structure"]
    rep_folder = f"{rep['pdb_id']}_{rep['assembly_id']}"
    # Participant order fixes the accession ordering used for class ids / chain_order.
    part_order = {p["accession"]: i for i, p in enumerate(details["participants"])}
    log(f"complex {CX}: representative {rep_folder}; accessions {list(part_order)}")

    assemblies = sorted(d for d in os.listdir(args.raw_dir)
                        if os.path.isdir(os.path.join(args.raw_dir, d)))
    pairs = index_cc(args.raw_dir)

    # Representative chains (union of both sides of every cc.csv touching the rep folder).
    rep_chains = set()
    for pair, rows in pairs.items():
        if rep_folder not in pair:
            continue
        for a1, c1, a2, c2 in rows:
            if a1 == rep_folder:
                rep_chains.add(c1)
            if a2 == rep_folder:
                rep_chains.add(c2)
    if not rep_chains:
        sys.exit(f"no cc.csv found touching representative {rep_folder}")

    # Map each representative chain to a UniProt accession via SIFTS on the deposited (base) chain.
    sifts = requests.get(SIFTS.format(pdb=rep["pdb_id"]), timeout=30).json()[rep["pdb_id"]]["UniProt"]
    base_to_acc = {}
    for acc, info in sifts.items():
        for s in info["mappings"]:
            base_to_acc[s.get("struct_asym_id")] = acc
    chain_acc = {}
    for ch in rep_chains:
        acc = base_to_acc.get(base_chain(ch))
        if acc is None:
            log(f"  WARN: representative chain {ch} has no UniProt mapping; skipping")
            continue
        chain_acc[ch] = acc

    # Number copies of each accession (1..n by chain order) -> chain class definitions.
    rep_chain_class = {}    # rep chain -> chain_class_id
    class_meta = {}         # chain_class_id -> record (filled after ordering)
    tmp = []                # (participant_index, component_index, accession, rep_chain)
    by_acc = {}
    for ch in sorted(chain_acc, key=chain_sort_key):
        by_acc.setdefault(chain_acc[ch], []).append(ch)
    for acc, chs in by_acc.items():
        for idx, ch in enumerate(chs, start=1):
            tmp.append((part_order.get(acc, 99), idx, acc, ch))
    tmp.sort(key=lambda t: (t[0], t[1]))
    classes = []
    for order, (_, comp_idx, acc, ch) in enumerate(tmp, start=1):
        cid = f"CC_{NUM}_{order:04d}"
        rep_chain_class[ch] = cid
        classes.append({
            "chain_class_id": cid, "pdb_complex_id": CX, "accession": acc,
            "component_index": comp_idx, "component_label": f"{acc}-{comp_idx}", "chain_order": order,
        })
        class_meta[cid] = classes[-1]
    log(f"  {len(classes)} chain classes: " + ", ".join(c["component_label"] for c in classes))

    # Instances: representative maps directly; every other assembly follows its rep<->X cc.csv.
    instances = []
    for asm in assemblies:
        entry, _, aid = asm.rpartition("_")
        row = lambda ch, cid: {"pdb_complex_id": CX, "entry_id": entry,
                               "assembly_id": aid, "asym_id": ch, "chain_class_id": cid}
        if asm == rep_folder:
            emitted = {rep_chain_class[ch]: ch for ch in rep_chain_class}
        else:
            m = rep_to_other(pairs, rep_folder, asm)
            if m is None:
                log(f"  WARN: no cc.csv links representative to {asm}; skipping")
                continue
            emitted = {}
            for rep_ch, cid in rep_chain_class.items():
                x = m.get(rep_ch)
                if x is None:
                    log(f"  WARN: {asm} has no correspondence for representative chain {rep_ch} ({cid})")
                    continue
                emitted[cid] = x
        if len(emitted) != len(classes):
            log(f"  WARN: {asm} mapped {len(emitted)}/{len(classes)} classes")
        for cid in sorted(emitted, key=lambda c: class_meta[c]["chain_order"]):
            instances.append(row(emitted[cid], cid))

    os.makedirs(out, exist_ok=True)
    json.dump(classes, open(f"{out}/complex_chain_class.json", "w"), indent=1)
    json.dump(instances, open(f"{out}/complex_chain_instance.json", "w"), indent=1)
    log(f"wrote {len(classes)} classes + {len(instances)} instances "
        f"({len(assemblies)} assemblies) -> {out}")


if __name__ == "__main__":
    main()
