#!/usr/bin/env python3
"""
run_anarcii.py — Steps 6 & 7 of the spec.

Step 6 (antibody test): run ANARCII on every non-antigen PROTEIN chain (the antibody
        candidates from identify_chains.py). A chain is an antibody iff ANARCII returns
        error is None AND a chain_type in {H, K, L}. chain_type H -> heavy; K/L -> light.
        VHH/nanobodies type as H -> heavy (heavy-only, no light) and flow through normally.

Step 7 (author <-> IMGT mapping): recover author residue numbers by reading observed
        residues from the mmCIF with gemmi (ANARCII numbering carries IMGT positions and the
        author *chain*, but NOT author residue numbers). We build each candidate chain's
        observed one-letter sequence, feed it to ANARCII (sequence mode), then positionally
        walk ANARCII's non-gap numbering onto the observed residues using query_start/end.

  VERIFIED against 6wps: file-mode output does not expose author residue numbers, so the
  gemmi-anchored sequence-mode walk is used (deterministic input order). ANARCII's result
  dict for list input is keyed "Sequence 1".. by INPUT ORDER, not by the sequence string —
  we map back by order. numbering elements are ((imgt_pos:int, ins:str), aa); '-' = gap, skip.

Outputs:
  data/intermediate/antibody_chains.json        Step 6 classification (incl. non-antibody 'other')
  data/intermediate/antibody_imgt_mapping.json  Step 7 mapping table (all spec columns)

Usage:
  python run_anarcii.py --pdb-id 6wps --assembly-id 1 \
      [--cif data/raw/structures/6wps_updated.cif] [--out-dir data/intermediate]
"""

import argparse
import json
import os

import requests

from common import (
    CHAIN_TYPE_COLLAPSE,
    PDBE_CIF_URL,
    get_logger,
    imgt_region,
    observed_residues,
)
from identify_chains import antigen_rows_from_anarcii

log = get_logger("run_anarcii")


def ensure_cif(pdb_id, cif_path):
    if os.path.exists(cif_path) and os.path.getsize(cif_path) > 0:
        return cif_path
    os.makedirs(os.path.dirname(cif_path) or ".", exist_ok=True)
    url = PDBE_CIF_URL.format(pdb_id=pdb_id)
    log.info("downloading mmCIF %s", url)
    r = requests.get(url, timeout=180)
    r.raise_for_status()
    with open(cif_path, "wb") as fh:
        fh.write(r.content)
    return cif_path


def label_ids(cif_path, chain_id):
    """auth (seqnum,icode) -> (label_asym_id, label_seq) for debugging columns."""
    import gemmi
    st = gemmi.read_structure(cif_path)
    out = {}
    for res in st[0][chain_id]:
        out[(res.seqid.num, (res.seqid.icode or "").strip())] = (
            res.subchain or None, res.label_seq)
    return out


_MODEL = None


def get_model():
    """Lazy ANARCII model singleton so batch runs load the weights only once per process."""
    global _MODEL
    if _MODEL is None:
        from anarcii import Anarcii
        _MODEL = Anarcii(seq_type="antibody", mode="accuracy", verbose=False)
    return _MODEL


def number_sequences(seqs, model=None):
    """Run ANARCII once on a list of unique sequences; return list aligned to input order."""
    if not seqs:
        return []
    model = model or get_model()
    res = model.number(seqs)
    # Keyed "Sequence 1".. by input order (verified); map back positionally.
    return [res[k] for k in res.keys()]


def walk_chain(observed, result):
    """Positional walk: assign IMGT to each observed residue using query_start/end.
    Returns (rows_partial, stats) where rows_partial is a list of dicts per residue with
    imgt_position/imgt_insertion_code/mapping_status/sequence_position."""
    nongap = [((p[0], (p[1] or "").strip()), aa) for (p, aa) in result["numbering"] if aa != "-"]
    qs, qe = result["query_start"], result["query_end"]
    domain = observed[qs:qe + 1]
    aligned = len(domain) == len(nongap)
    rows = []
    mismatches = 0
    for idx, obs in enumerate(observed):
        auth_num, ins, resname, one = obs
        status = "not_applicable"      # outside the numbered variable domain
        imgt_pos = imgt_ins = None
        if qs <= idx <= qe and aligned:
            (imgt_pos, imgt_ins), exp_aa = nongap[idx - qs]
            if exp_aa != one:
                status = "unmapped"    # sequence disagreement -> don't trust it
                mismatches += 1
                imgt_pos = imgt_ins = None
            else:
                status = "mapped"
        elif qs <= idx <= qe and not aligned:
            status = "unmapped"        # length mismatch -> couldn't align this residue safely
        rows.append({
            "sequence_position": idx, "author_residue_number": auth_num,
            "author_insertion_code": ins, "residue_name": resname, "one_letter_code": one,
            "imgt_position": imgt_pos, "imgt_insertion_code": imgt_ins, "mapping_status": status,
        })
    return rows, {"aligned": aligned, "mismatches": mismatches,
                  "domain_len": len(domain), "nongap_len": len(nongap)}


def map_entry(pdb_id, assembly_id, cif_path, chain_meta, model=None):
    """Run the ANARCII antibody test + author<->IMGT walk for one entry.

    Returns (antibody_chains, mapping_rows). Pure function over inputs (no file writes) so a
    batch orchestrator can reuse a single loaded model and cache results per pdb_id.
    """
    candidates = [c for c in chain_meta if c["role"] == "antibody_candidate"]
    log.info("[%s/%s] antibody candidate chains: %s", pdb_id, assembly_id,
             sorted(c["auth_asym_id"] for c in candidates))

    # Extract observed residues per candidate chain; dedupe ANARCII by sequence string.
    chain_obs = {}
    for c in candidates:
        obs = observed_residues(cif_path, c["auth_asym_id"])
        chain_obs[c["auth_asym_id"]] = obs
    uniq_seqs = []
    seq_index = {}
    for ch, obs in chain_obs.items():
        s = "".join(o[3] for o in obs)
        if s and s not in seq_index:
            seq_index[s] = len(uniq_seqs)
            uniq_seqs.append(s)

    results = number_sequences(uniq_seqs, model=model) if uniq_seqs else []
    seq_result = {s: results[seq_index[s]] for s in seq_index}

    antibody_chains = []
    mapping_rows = []
    counts = {"heavy": 0, "light": 0, "other": 0}
    for c in candidates:
        ch = c["auth_asym_id"]
        obs = chain_obs[ch]
        s = "".join(o[3] for o in obs)
        result = seq_result.get(s)
        raw = result["chain_type"] if result else None
        err = result["error"] if result else "no_sequence"
        is_ab = result is not None and err is None and raw in CHAIN_TYPE_COLLAPSE
        chain_type = CHAIN_TYPE_COLLAPSE.get(raw) if is_ab else None
        classification = chain_type if is_ab else "other"
        counts[classification if is_ab else "other"] += 1

        antibody_chains.append({
            "pdb_id": pdb_id, "assembly_id": str(assembly_id), "auth_asym_id": ch,
            "entity_id": c["entity_id"], "molecule_name": c["molecule_name"],
            "antibody_chain_type": chain_type, "antibody_chain_type_raw": raw,
            "is_antibody": is_ab, "classification_method": "ANARCII",
            "anarcii_error": err, "anarcii_score": result["score"] if result else None,
        })
        if not is_ab:
            log.warning("chain %s NOT an antibody (raw=%s err=%s) -> classified 'other'", ch, raw, err)
            continue

        labels = label_ids(cif_path, ch)
        rows, stats = walk_chain(obs, result)
        chain_class = chain_type  # heavy/light
        for r in rows:
            lab = labels.get((r["author_residue_number"], r["author_insertion_code"]), (None, None))
            region = imgt_region(r["imgt_position"], chain_class) if r["mapping_status"] == "mapped" else \
                ("not_applicable" if r["mapping_status"] == "not_applicable" else "unmapped")
            mapping_rows.append({
                "pdb_id": pdb_id, "assembly_id": str(assembly_id),
                "antibody_chain_id": ch, "antibody_chain_type": chain_type,
                "antibody_chain_type_raw": raw, "auth_asym_id": ch,
                "label_asym_id": lab[0], "author_residue_number": r["author_residue_number"],
                "author_insertion_code": r["author_insertion_code"],
                "label_residue_number": lab[1], "residue_name": r["residue_name"],
                "one_letter_code": r["one_letter_code"], "sequence_position": r["sequence_position"],
                "imgt_position": r["imgt_position"], "imgt_insertion_code": r["imgt_insertion_code"],
                "imgt_region": region, "mapping_status": r["mapping_status"],
            })
        log.info("chain %s -> %s (raw %s) numbered %d/%d residues, aligned=%s mismatches=%d",
                 ch, chain_type, raw, stats["nongap_len"], len(obs), stats["aligned"], stats["mismatches"])

    log.info("[%s/%s] antibody chains: heavy=%d light=%d other=%d; mapping rows=%d",
             pdb_id, assembly_id, counts["heavy"], counts["light"], counts["other"], len(mapping_rows))
    return antibody_chains, mapping_rows


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pdb-id", required=True)
    ap.add_argument("--assembly-id", required=True)
    ap.add_argument("--cif", default=None)
    ap.add_argument("--chain-metadata", default="data/intermediate/chain_metadata.json")
    ap.add_argument("--out-dir", default="data/intermediate")
    args = ap.parse_args()

    pdb_id = args.pdb_id.lower()
    cif_path = args.cif or f"data/raw/structures/{pdb_id}_updated.cif"
    ensure_cif(pdb_id, cif_path)
    with open(args.chain_metadata) as fh:
        chain_meta = json.load(fh)

    antibody_chains, mapping_rows = map_entry(pdb_id, args.assembly_id, cif_path, chain_meta)
    # Antigen is derived from ANARCII's verdict (non-antibody protein chains), NOT from titles.
    antigen_chains, _, _ = antigen_rows_from_anarcii(chain_meta, antibody_chains)

    os.makedirs(args.out_dir, exist_ok=True)
    with open(os.path.join(args.out_dir, "antibody_chains.json"), "w") as fh:
        json.dump(antibody_chains, fh, indent=1)
    with open(os.path.join(args.out_dir, "antigen_chains.json"), "w") as fh:
        json.dump(antigen_chains, fh, indent=1)
    with open(os.path.join(args.out_dir, "antibody_imgt_mapping.json"), "w") as fh:
        json.dump(mapping_rows, fh, indent=1)


if __name__ == "__main__":
    main()
