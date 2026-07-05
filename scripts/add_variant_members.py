#!/usr/bin/env python3
"""
add_variant_members.py — process a few EXTRA antibody-bound member assemblies of the complex
(specifically variant-carrying ones) through the same pipeline as run_batch and MERGE them into the
existing processed dataset. Used to populate the natural-variant overlay without running the full
458 batch. These are genuine PDB-CPX-140202 members (confirmed antibody-bound in the cached payload),
so aggregates stay honest — just a larger sample.

  python scripts/add_variant_members.py 7wpf 7q9f 7fjo ...

After running, refresh the variant join:
  python scripts/fetch_mutations.py && python scripts/build_aggregations.py
"""

import json
import os
import sys

import fetch_complex_details as fcd
from build_processed_dataset import build_buried_lookup, process_entry
from common import get_logger, load_interfaces
from identify_chains import antigen_rows_from_anarcii, build_metadata, sifts_segments
from parse_pisa_interfaces import parse_interfaces
from run_anarcii import get_model, map_entry
from run_batch import ensure_cif, ensure_pisa

log = get_logger("add_variants")

COMPLEX_ID = "PDB-CPX-140202"
ANTIGEN_ACC = "P0DTC2"
PROCESSED = "data/processed/processed_antibody_antigen_interfaces.json"
ANOMALIES = "data/processed/mapping_anomalies.json"


def member_assemblies(pdb_ids):
    payload = json.load(open(f"data/raw/complex/complex_details_{COMPLEX_ID}.json"))
    _, asms = fcd.extract_assemblies(COMPLEX_ID, payload, only_bound=True)
    asms = [a for a in asms if "antibody" in (a.get("bound_macromolecules") or [])]
    want = set(pdb_ids)
    picked, seen = [], set()
    for a in asms:
        if a["pdb_id"] in want and a["pdb_id"] not in seen:
            picked.append(a)          # preferred/first assembly per requested pdb
            seen.add(a["pdb_id"])
    missing = want - seen
    if missing:
        log.warning("not antibody-bound members of %s (skipped): %s", COMPLEX_ID, sorted(missing))
    return picked


def process_one(a, model):
    pdb_id, asm = a["pdb_id"], a["assembly_id"]
    tag = f"{pdb_id}/assembly{asm}"
    pisa = ensure_pisa(pdb_id, asm)
    if not pisa:
        log.warning("[%s] PISA missing -> skip", tag); return [], []
    _, block = load_interfaces(pisa)
    records = parse_interfaces(pdb_id, block, pdb_complex_id=COMPLEX_ID)
    cif = ensure_cif(pdb_id)
    if not cif:
        log.warning("[%s] cif missing -> skip", tag); return [], []
    chain_meta = build_metadata(pdb_id, asm, antigen_acc=ANTIGEN_ACC)
    # ANARCII decides antibody-ness (all protein chains tested); antigen is derived from its verdict.
    antibody_rows, mapping = map_entry(pdb_id, asm, cif, chain_meta, model=model)
    antigen_rows, antigen_auth, antibody_auth = antigen_rows_from_anarcii(
        chain_meta, antibody_rows, antigen_acc=ANTIGEN_ACC)
    if not antigen_auth or not antibody_auth:
        log.warning("[%s] no antigen/antibody chain -> skip", tag); return [], []
    antigen_sifts = sifts_segments(pdb_id, antigen_acc=ANTIGEN_ACC)
    buried = build_buried_lookup(pisa)
    rows, anomalies, stats = process_entry(records, antigen_rows, antibody_rows, chain_meta,
                                           mapping, buried, antigen_sifts=antigen_sifts)
    log.info("[%s] kept %d rows (antigen UniProt PISA=%d SIFTS=%d unmapped=%d)",
             tag, len(rows), stats["antigen_from_pisa"], stats["antigen_from_sifts"], stats["antigen_unmapped"])
    return rows, anomalies


def main():
    pdb_ids = [p.lower() for p in sys.argv[1:]]
    if not pdb_ids:
        log.error("give one or more PDB ids to add"); sys.exit(1)

    existing = json.load(open(PROCESSED))
    have = {(r["pdb_id"], str(r["assembly_id"])) for r in existing}
    picked = member_assemblies(pdb_ids)

    # Consensus antigen residue name per UniProt position (from the existing, trusted dataset) — used
    # to reject a newly-added structure whose antigen numbering is offset/mis-mapped (the SIFTS
    # fallback can shift positions; a shifted structure disagrees with consensus at most positions,
    # whereas a genuine variant disagrees at only ~15-20%). See the 7yqx off-by-3 case.
    from collections import Counter, defaultdict
    consensus_votes = defaultdict(Counter)
    for r in existing:
        p = r.get("antigen_uniprot_position")
        if p is not None:
            consensus_votes[p][r["antigen_residue_name"]] += 1
    consensus = {p: c.most_common(1)[0][0] for p, c in consensus_votes.items()}

    def mismatch_fraction(rows):
        seen, mm, tot = set(), 0, 0
        for r in rows:
            p = r.get("antigen_uniprot_position")
            if p is None or p not in consensus or (r["pdb_id"], p) in seen:
                continue
            seen.add((r["pdb_id"], p)); tot += 1
            if r["antigen_residue_name"] != consensus[p]:
                mm += 1
        return (mm / tot) if tot else 0.0

    model = get_model()
    new_rows, new_anom = [], []
    for a in picked:
        if (a["pdb_id"], str(a["assembly_id"])) in have:
            log.info("[%s/assembly%s] already in dataset -> skip", a["pdb_id"], a["assembly_id"]); continue
        try:
            rows, anom = process_one(a, model)
            frac = mismatch_fraction(rows)
            if frac > 0.40:
                log.warning("[%s] antigen numbering disagrees with consensus at %.0f%% of positions "
                            "-> likely mis-mapped, SKIPPING", a["pdb_id"], 100 * frac)
                continue
            new_rows.extend(rows); new_anom.extend(anom)
        except Exception as e:
            log.error("[%s] FAILED: %s: %s", a["pdb_id"], type(e).__name__, e)

    if not new_rows:
        log.warning("no new rows added"); return
    existing.extend(new_rows)
    json.dump(existing, open(PROCESSED, "w"), indent=1)
    anom = json.load(open(ANOMALIES)) if os.path.exists(ANOMALIES) else []
    anom.extend(new_anom)
    json.dump(anom, open(ANOMALIES, "w"), indent=1)

    # Keep the batch report's counts consistent with the merged dataset (App reads these for the
    # "Assemblies processed" / "PDB entries" tiles).
    report_path = "data/processed/batch_report.json"
    if os.path.exists(report_path):
        rep = json.load(open(report_path))
        rep["processed"] = len({(r["pdb_id"], str(r["assembly_id"])) for r in existing})
        rep["unique_pdb_entries"] = len({r["pdb_id"] for r in existing})
        json.dump(rep, open(report_path, "w"), indent=1)

    added = sorted({(r["pdb_id"]) for r in new_rows})
    log.info("added %d rows from %d entries: %s. Now run fetch_mutations + build_aggregations.",
             len(new_rows), len(added), added)


if __name__ == "__main__":
    main()
