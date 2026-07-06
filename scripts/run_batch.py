#!/usr/bin/env python3
"""
run_batch.py — process many assemblies of a PDB-Complex through the whole pipeline.

Generalises the single-entry chain to N assemblies. Key efficiencies / correctness:
  * ANARCII model is loaded ONCE and reused across all entries (run_anarcii.get_model()).
  * Chain metadata + ANARCII IMGT mapping are cached PER pdb_id (they don't depend on the
    biological assembly), so a PDB entry with several assemblies numbers its chains once.
  * Each entry is isolated in try/except: missing PISA files, mmCIF failures, or entries with
    no antibody-antigen interface are logged and skipped, never aborting the batch.

Outputs (combined across all processed entries):
  data/processed/processed_antibody_antigen_interfaces.json
  data/processed/mapping_anomalies.json
  data/processed/{5 aggregation tables}
  data/processed/batch_report.json
  app/public/mvs/*.mvsj + mvs_manifest.json          (with --build-mvs)

Usage:
  python scripts/run_batch.py --limit 20                 # first 20 antibody-bound assemblies
  python scripts/run_batch.py --limit 20 --offset 20     # next tranche
  python scripts/run_batch.py --all --build-mvs          # the whole complex
"""

import argparse
import json
import os

import requests

import build_aggregations as agg
import build_mvs
import build_structure_quality as bsq
import fetch_complex_details as fcd
from build_processed_dataset import build_buried_lookup, process_entry
from common import PDBE_CIF_URL, PISA_SPLIT_DIR, get_logger, load_interfaces, pisa_split_mid
from identify_chains import antigen_rows_from_anarcii, build_metadata, sifts_segments
from parse_pisa_interfaces import parse_interfaces
from run_anarcii import get_model, map_entry

log = get_logger("run_batch")


def download(url, dest, timeout=180):
    r = requests.get(url, timeout=timeout)
    if r.status_code == 404:
        return False
    r.raise_for_status()
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "wb") as fh:
        fh.write(r.content)
    return True


def ensure_pisa(pdb_id, assembly_id):
    mid = pisa_split_mid(pdb_id)
    fname = f"{pdb_id}_assembly{assembly_id}_interfaces.json"
    dest = os.path.join("data/raw/pisa", pdb_id, fname)
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return dest
    ok = download(PISA_SPLIT_DIR.format(mid=mid) + fname, dest)
    return dest if ok else None


def ensure_cif(pdb_id):
    dest = f"data/raw/structures/{pdb_id}_updated.cif"
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return dest
    ok = download(PDBE_CIF_URL.format(pdb_id=pdb_id), dest)
    return dest if ok else None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--complex-id", default="PDB-CPX-140202")
    ap.add_argument("--antigen-acc", default="P0DTC2")
    ap.add_argument("--limit", type=int, default=20)
    ap.add_argument("--offset", type=int, default=0)
    ap.add_argument("--all", action="store_true", help="process every antibody-bound assembly")
    ap.add_argument("--build-mvs", action="store_true")
    ap.add_argument("--out-dir", default="data/processed")
    args = ap.parse_args()

    # Assembly list: antibody-bound assemblies for the complex (fetched fresh).
    payload = fcd.fetch(args.complex_id)
    _, assemblies = fcd.extract_assemblies(args.complex_id, payload, only_bound=True)
    assemblies = [a for a in assemblies if "antibody" in (a.get("bound_macromolecules") or [])]
    if not args.all:
        assemblies = assemblies[args.offset:args.offset + args.limit]
    log.info("processing %d antibody-bound assemblies (offset %d)", len(assemblies), args.offset)

    model = get_model()  # load ANARCII weights once
    pdb_cache = {}       # pdb_id -> (chain_meta, antigen_rows, antibody_rows, mapping, antigen_auth, antibody_auth)

    all_rows, all_anomalies, manifest = [], [], []
    report = {"requested": len(assemblies), "processed": 0, "skipped": [],
              "rows_by_entry": [], "entries_no_interface": 0, "antigen_unp_coverage": []}

    for a in assemblies:
        pdb_id, asm = a["pdb_id"], a["assembly_id"]
        tag = f"{pdb_id}/assembly{asm}"
        try:
            pisa = ensure_pisa(pdb_id, asm)
            if not pisa:
                log.warning("[%s] PISA interfaces file missing -> skip", tag)
                report["skipped"].append({"entry": tag, "reason": "pisa_missing"})
                continue
            _, block = load_interfaces(pisa)
            records = parse_interfaces(pdb_id, block, pdb_complex_id=args.complex_id)

            if pdb_id not in pdb_cache:
                cif = ensure_cif(pdb_id)
                if not cif:
                    log.warning("[%s] mmCIF missing -> skip pdb", tag)
                    report["skipped"].append({"entry": tag, "reason": "cif_missing"})
                    continue
                chain_meta = build_metadata(pdb_id, asm, antigen_acc=args.antigen_acc)
                # ANARCII decides antibody-ness (all protein chains tested); derive antigen from it.
                antibody_rows, mapping = map_entry(pdb_id, asm, cif, chain_meta, model=model)
                antigen_rows, antigen_auth, antibody_auth = antigen_rows_from_anarcii(
                    chain_meta, antibody_rows, antigen_acc=args.antigen_acc)
                antigen_sifts = sifts_segments(pdb_id, antigen_acc=args.antigen_acc)
                pdb_cache[pdb_id] = (chain_meta, antigen_rows, antibody_rows, mapping,
                                     antigen_auth, antibody_auth, antigen_sifts)
            (chain_meta, antigen_rows, antibody_rows, mapping,
             antigen_auth, antibody_auth, antigen_sifts) = pdb_cache[pdb_id]

            if not antigen_auth or not antibody_auth:
                log.warning("[%s] no antigen (%s) or antibody (%s) chains -> skip",
                            tag, sorted(antigen_auth), sorted(antibody_auth))
                report["skipped"].append({"entry": tag, "reason": "no_antigen_or_antibody_chain"})
                continue

            buried = build_buried_lookup(pisa)
            rows, anomalies, stats = process_entry(records, antigen_rows, antibody_rows,
                                                   chain_meta, mapping, buried,
                                                   antigen_sifts=antigen_sifts)
            all_rows.extend(rows)
            all_anomalies.extend(anomalies)
            report["processed"] += 1
            report["rows_by_entry"].append({"entry": tag, "rows": len(rows), "kept": stats["kept"]})
            if not rows:
                report["entries_no_interface"] += 1

            # Per-assembly antigen UniProt coverage (flag PISA-missing entries).
            n_ag = stats["antigen_from_pisa"] + stats["antigen_from_sifts"] + stats["antigen_unmapped"]
            report["antigen_unp_coverage"].append({
                "pdb_id": pdb_id, "assembly_id": str(asm),
                "antigen_contacts": n_ag,
                "unp_from_pisa": stats["antigen_from_pisa"],
                "unp_from_sifts_fallback": stats["antigen_from_sifts"],
                "unp_still_unmapped": stats["antigen_unmapped"],
                "pisa_provides_antigen_unp": stats["antigen_from_pisa"] > 0,
                "recovered_by_sifts": stats["antigen_from_pisa"] == 0 and stats["antigen_from_sifts"] > 0,
                "pct_mapped": round(100 * (n_ag - stats["antigen_unmapped"]) / n_ag, 1) if n_ag else 0.0,
            })
            log.info("[%s] kept %d rows | antigen UniProt: PISA=%d SIFTS=%d unmapped=%d",
                     tag, len(rows), stats["antigen_from_pisa"], stats["antigen_from_sifts"],
                     stats["antigen_unmapped"])

            if args.build_mvs and rows:
                for itf in block.get("assembly", {}).get("interfaces", []):
                    state = build_mvs.build_interface_mvsj(pdb_id, asm, itf, antigen_auth, antibody_auth)
                    if state is None:
                        continue
                    fname = f"{pdb_id}_assembly{asm}_interface{itf.get('interface_id')}.mvsj"
                    os.makedirs("app/public/mvs", exist_ok=True)
                    with open(os.path.join("app/public/mvs", fname), "w") as fh:
                        fh.write(state.dumps(indent=2))
                    manifest.append({"pdb_id": pdb_id, "assembly_id": str(asm),
                                     "interface_id": str(itf.get("interface_id")), "mvsj": fname})
        except Exception as e:  # isolate per-entry failures
            log.error("[%s] FAILED: %s", tag, e)
            report["skipped"].append({"entry": tag, "reason": f"error: {type(e).__name__}: {e}"})

    # Write combined outputs.
    os.makedirs(args.out_dir, exist_ok=True)
    with open(os.path.join(args.out_dir, "processed_antibody_antigen_interfaces.json"), "w") as fh:
        json.dump(all_rows, fh, indent=1)
    with open(os.path.join(args.out_dir, "mapping_anomalies.json"), "w") as fh:
        json.dump(all_anomalies, fh, indent=1)

    # Natural-variant overlay: PDBe mutated_AA_or_NA (type == "Variant") on antigen interface
    # residues. Pure membership intersection — cache the raw API data, join in build_aggregations.
    try:
        import fetch_mutations as fm
        mutations = fm.fetch(sorted({r["pdb_id"] for r in all_rows}), chunk=50)
        os.makedirs("data/raw/mutations", exist_ok=True)
        with open("data/raw/mutations/mutations.json", "w") as fh:
            json.dump(mutations, fh, indent=1)
    except Exception as e:
        log.warning("mutation fetch failed (%s) -> variant overlay empty", e)
        mutations = {}
    variant_index = agg.build_variant_index(all_rows, mutations)
    log.info("antigen interface Variant substitutions: %d position(s)", len(variant_index))

    # Glycan overlay: PDBe pre-computed glycan interactions (cached separately by
    # fetch_glycan_interactions.py — one call per glycan, not run inline here). Membership join only.
    glycans = agg.load_glycans("data/raw/glycans", {r["pdb_id"] for r in all_rows})
    glycan_index = agg.build_glycan_index(all_rows, glycans)
    log.info("antigen interface N-glycosylation sites: %d position(s)", len(glycan_index))

    # Aggregations over the combined dataset.
    pairs = agg.build_contact_pairs(all_rows)
    tables = {
        "residue_level_interactions.json": pairs,
        "aggregated_antigen_epitope_contacts.json": agg.agg_antigen_epitope(pairs, variant_index),
        "antigen_interface_variants.json": agg.agg_antigen_interface_variants(variant_index),
        "antigen_interface_glycans.json": agg.agg_antigen_interface_glycans(glycan_index),
        "frequency_contacts_by_heavy_light.json": agg.agg_frequency_heavy_light(pairs),
        "aggregated_antibody_imgt_contacts.json": agg.agg_antibody_imgt(pairs),
        "imgt_region_contribution.json": agg.agg_region_contribution(pairs),
    }
    for fname, data in tables.items():
        with open(os.path.join(args.out_dir, fname), "w") as fh:
            json.dump(data, fh, indent=1)

    # Per-assembly experimental method + resolution (quality attribute), from the complex
    # payload already in hand — joined to the assemblies we actually kept.
    keep_keys = {f"{r['pdb_id']}|{r['assembly_id']}" for r in all_rows}
    with open(os.path.join(args.out_dir, "structure_quality.json"), "w") as fh:
        json.dump(bsq.build(assemblies, keep_keys=keep_keys), fh, indent=1)

    if args.build_mvs:
        with open("app/public/mvs/mvs_manifest.json", "w") as fh:
            json.dump(manifest, fh, indent=2)

    report["total_rows"] = len(all_rows)
    report["contact_pairs"] = len(pairs)
    report["unique_pdb_entries"] = len({r["pdb_id"] for r in all_rows})
    report["heavy_pairs"] = sum(1 for p in pairs if p["antibody_chain_type"] == "heavy")
    report["light_pairs"] = sum(1 for p in pairs if p["antibody_chain_type"] == "light")
    report["anomaly_occurrences"] = sum(x["occurrence_count"] for x in all_anomalies)

    # Dedicated antigen-UniProt coverage report: which assemblies lack PISA antigen numbering.
    cov = report["antigen_unp_coverage"]
    missing = [c for c in cov if not c["pisa_provides_antigen_unp"]]
    recovered = [c for c in cov if c["recovered_by_sifts"]]
    report["antigen_unp_summary"] = {
        "assemblies_total": len(cov),
        "assemblies_pisa_missing_antigen_unp": len(missing),
        "assemblies_recovered_by_sifts": len(recovered),
        "assemblies_pisa_missing_list": [c["pdb_id"] + "/" + c["assembly_id"] for c in missing],
    }
    with open(os.path.join(args.out_dir, "antigen_unp_coverage.json"), "w") as fh:
        json.dump(cov, fh, indent=1)
    with open(os.path.join(args.out_dir, "batch_report.json"), "w") as fh:
        json.dump(report, fh, indent=1)

    log.info("=== BATCH DONE ===")
    log.info("processed %d/%d assemblies (%d unique PDB entries); skipped %d",
             report["processed"], report["requested"], report["unique_pdb_entries"], len(report["skipped"]))
    log.info("total rows=%d contact_pairs=%d (heavy=%d light=%d); anomaly occ=%d",
             report["total_rows"], report["contact_pairs"], report["heavy_pairs"],
             report["light_pairs"], report["anomaly_occurrences"])
    s = report["antigen_unp_summary"]
    log.info("antigen UniProt: %d/%d assemblies LACK PISA numbering (%d recovered via SIFTS fallback): %s",
             s["assemblies_pisa_missing_antigen_unp"], s["assemblies_total"],
             s["assemblies_recovered_by_sifts"], s["assemblies_pisa_missing_list"])
    if report["skipped"]:
        log.info("skipped entries: %s", report["skipped"][:10])


if __name__ == "__main__":
    main()
