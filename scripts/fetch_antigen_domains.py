#!/usr/bin/env python3
"""
fetch_antigen_domains.py — label antigen (epitope) residues with their structural
domain, from PDBe, so the clustering display needs NO hardcoded domain knowledge and
generalises to any antibody-antigen complex.

Strategy (robust to heavily-deposited antigens):
  1. Fast path: PDBe v2 `uniprot/domains/{acc}` -> domains already in UniProt coords.
     Fails (HTTP 500) for very over-deposited entries like SARS-CoV-2 spike (P0DTC2),
     because it aggregates across every structure of that UniProt.
  2. Fallback: PDB-keyed `mappings/pfam` (+ `mappings/cath_b`) on a REPRESENTATIVE
     structure -> domains in author numbering; convert author->UniProt with the offset
     from `mappings/uniprot/{pdb}`. This does not aggregate, so it works for spike.

The representative structure + antigen accession are read from the processed dataset
(most epitope-position coverage). Output is a UniProt-position -> domain-name map plus
the domain ranges.

  python scripts/fetch_antigen_domains.py [--out data/processed/antigen_domains.json]

Output: data/processed/antigen_domains.json
  { accession, reference_pdb, source, domains:[{name,accession,unp_start,unp_end}],
    position_domain: {"<unp_pos>": "<domain name>"} }
"""

import argparse
import json
from collections import Counter, defaultdict

import requests

from common import get_logger

log = get_logger("antigen_domains")
API = "https://www.ebi.ac.uk/pdbe/api"


def representative(processed):
    """Antigen accession + the PDB covering the most distinct epitope UNP positions."""
    R = json.load(open(processed))
    acc = Counter(r["antigen_uniprot_accession"] for r in R if r.get("antigen_uniprot_accession")).most_common(1)[0][0]
    cov = defaultdict(set)
    for r in R:
        if r.get("antigen_uniprot_accession") == acc and r["antigen_uniprot_position"] is not None:
            cov[r["pdb_id"]].add(r["antigen_uniprot_position"])
    pdb = max(cov, key=lambda p: len(cov[p]))
    positions = sorted({p for s in cov.values() for p in s})
    return acc, pdb, positions


def from_uniprot_v2(acc):
    """Fast path — domains already in UniProt coordinates. Returns [] on failure."""
    try:
        r = requests.get(f"{API}/v2/uniprot/domains/{acc}", timeout=60)
        if not r.ok:
            return []
        out = []
        for d in r.json().get(acc, {}).get("data", []):
            for seg in d.get("residues", []):
                if seg.get("indexType") == "UNIPROT" and seg.get("startIndex") and seg.get("endIndex"):
                    out.append({"name": d["name"], "accession": d.get("accession", ""),
                                "unp_start": seg["startIndex"], "unp_end": seg["endIndex"]})
        return out
    except Exception as e:
        log.warning("v2 uniprot/domains failed: %s", e)
        return []


def author_to_unp_offset(pdb, acc):
    """Offset so that unp = author + offset, from mappings/uniprot (0 for most spike chains)."""
    d = requests.get(f"{API}/mappings/uniprot/{pdb}", timeout=30).json()
    for m in d[pdb]["UniProt"].get(acc, {}).get("mappings", []):
        a = m["start"].get("author_residue_number"); u = m.get("unp_start")
        if a is not None and u is not None:
            return u - a
    return 0


def from_pdb_pfam_cath(pdb, acc):
    """Fallback — Pfam + CATH domains on one structure, converted to UniProt coords."""
    offset = author_to_unp_offset(pdb, acc)
    out = []
    for kind, key in [("mappings/pfam", "Pfam"), ("mappings/cath_b", "CATH-B")]:
        try:
            block = requests.get(f"{API}/{kind}/{pdb}", timeout=30).json()[pdb].get(key, {})
        except Exception:
            continue
        for dacc, info in block.items():
            desc = info.get("description") or info.get("name") or dacc
            for m in info.get("mappings", []):
                s = m["start"].get("author_residue_number"); e = m["end"].get("author_residue_number")
                if s is None or e is None:
                    continue
                out.append({"name": desc, "accession": dacc,
                            "unp_start": s + offset, "unp_end": e + offset})
        if out:      # prefer Pfam if it yielded domains; CATH is the backup
            break
    return out, offset


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--processed", default="data/processed/residue_level_interactions.json")
    ap.add_argument("--out", default="data/processed/antigen_domains.json")
    args = ap.parse_args()

    acc, pdb, positions = representative(args.processed)
    log.info("antigen=%s reference=%s (%d epitope positions)", acc, pdb, len(positions))

    domains = from_uniprot_v2(acc)
    source = "PDBe v2 uniprot/domains"
    if not domains:
        domains, offset = from_pdb_pfam_cath(pdb, acc)
        source = f"PDBe mappings/pfam+cath on {pdb} (author->unp offset {offset})"
    # dedupe identical ranges
    seen, uniq = set(), []
    for d in sorted(domains, key=lambda d: d["unp_start"]):
        k = (d["accession"], d["unp_start"], d["unp_end"])
        if k not in seen:
            seen.add(k); uniq.append(d)
    domains = uniq

    def domain_of(p):
        hits = [d["name"] for d in domains if d["unp_start"] <= p <= d["unp_end"]]
        return hits[0] if hits else None

    position_domain = {str(p): domain_of(p) for p in positions if domain_of(p)}
    artifact = {"accession": acc, "reference_pdb": pdb, "source": source,
                "domains": domains, "position_domain": position_domain}
    with open(args.out, "w") as fh:
        json.dump(artifact, fh, indent=1)
    log.info("source: %s", source)
    for d in domains:
        log.info("  %d-%d  %s  %s", d["unp_start"], d["unp_end"], d["accession"], d["name"])
    log.info("labelled %d/%d epitope positions -> %s", len(position_domain), len(positions), args.out)


if __name__ == "__main__":
    main()
