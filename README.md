# Antibody–antigen interface demo — PDB-CPX-140202

A proof-of-concept pipeline **and** web app for displaying **aggregated antibody–antigen
interface contacts** in the style of PDBe-KB Complexes, using the SARS-CoV-2 spike complex
**`PDB-CPX-140202`** as the worked example.

The core idea: make antibody–antigen interfaces comparable *across many structures* by
normalising both sides to conserved coordinates —

- **Antigen (spike)** residues → **UniProt position** (from PISA, with a SIFTS fallback).
- **Antibody** residues → **IMGT position / region** (CDR-H1/2/3, CDR-L1/2/3, Framework-H/L)
  via **ANARCII**.

The pipeline is validated end-to-end on the reference entry **6wps** (spike + the S309
neutralizing Fab) and generalises to the whole complex (≈458 antibody-bound assemblies). On
6wps it reproduces the known S309 biology: the epitope centres on the RBD **N343-glycan
region** and is dominated by **CDR-H3**.

---

## What it produces

A React dashboard (Vite + Recharts, Mol\* from CDN) that reads the processed tables:

- **Interface explorer** — heavy/light selector cards (median interface BSA + instance count)
  driving an instances table, an embedded **Mol\*** 3D viewer, a per-interface **Sankey** of
  paratope→epitope contacts (antigen coloured by residue class, antibody by IMGT region, with a
  hover breakdown of interaction types / distance), and an aggregated contact table + heatmap.
- **Epitope map** — a PDBe-KB-style **Nightingale canvas track** of per-residue antibody
  contacts along the spike UniProt sequence; click a residue to filter the tables.
- **Contact map** — an epitope × paratope-region contact-frequency **heatmap** (colour-blind-safe).
- Aggregated **epitope residues**, **paratope (IMGT) positions**, a filterable **residue
  contacts** table, **summary charts**, a **structure viewer**, and a **data-provenance** panel
  (antigen-UniProt coverage + upstream mapping anomalies).

A lightweight **Streamlit** app (`app/app.py`) covers the same tables.

---

## Repository layout

```
scripts/                pipeline (all Python)
  fetch_complex_details.py   Step 1  — assemblies for the complex (PDBe API)
  fetch_pisa_files.py        Step 2  — PISA interface files (EBI FTP)
  parse_pisa_interfaces.py   Step 3  — parse bond groups -> residue interactions
  identify_chains.py         Steps 4-5 — chain metadata + antigen chains (SIFTS)
  run_anarcii.py             Steps 6-7 — ANARCII antibody test + author<->IMGT mapping
  build_processed_dataset.py Steps 8-9 — filter/orient/join + anomaly capture
  build_aggregations.py      5 aggregation tables + interface summary
  run_batch.py               orchestrate many assemblies (ANARCII model reused, per-pdb caching)
  build_mvs.py               one Mol* .mvsj scene per antibody-antigen interface
  check_unp_anomalies.py     scan PISA for spurious UniProt-on-antibody tags
  common.py                  shared constants + helpers
  run_6wps.sh                one-command 6wps validation run
data/
  samples/                committed real samples + NOTES.md (verified PISA structure)
  processed/              processed dataset + aggregation tables (consumed by the apps)
  raw/, intermediate/     downloaded / regenerable (gitignored)
app/                      Streamlit app + public/mvs (pre-built scenes)
app-react/               Vite + React dashboard
spec_revised.md          the source-of-truth spec
```

---

## Quick start

### Run the app (uses the committed processed data)

```bash
cd app-react
npm install
npm run dev            # predev copies data/processed + app/public/mvs into public/, then serves
```

Open the printed local URL. The 3D viewer streams structures from PDBe, so it needs internet.
The Streamlit alternative: `pip install -r requirements.txt && streamlit run app/app.py`.

### Re-run the pipeline

```bash
pip install -r requirements.txt         # anarcii>=2.0.5, molviewspec, pandas, requests, streamlit, gemmi
bash scripts/run_6wps.sh                # validate on the 6wps reference entry
python scripts/run_batch.py --limit 20 --build-mvs   # a 20-assembly tranche
python scripts/run_batch.py --all --build-mvs        # the whole complex (~458 antibody-bound)
```

Requires network access to `ftp.ebi.ac.uk` (PISA) and `www.ebi.ac.uk` (PDBe/SIFTS/mmCIF).

---

## Key design rules (getting these wrong silently corrupts results)

- **Classify antigen vs antibody by CHAIN, never by per-bond UniProt accession.** Antibody
  residues carry spurious `P0DTC2` tags in the PISA bond arrays (an upstream SIFTS artefact);
  antigen chains come from SIFTS UniProt (`P0DTC2 → A,B,E` in 6wps), antibody chains from a
  successful ANARCII numbering. Every such anomaly is logged to
  `data/processed/mapping_anomalies.json`.
- **Antigen UniProt position** is read from `atom_site_N_unp_nums` on antigen chains; where a
  PISA file omits it (≈half the complex), it is recovered residue-by-residue from **SIFTS**
  (validated to match PISA exactly, 3664 residues, 0 mismatches). `antigen_mapping_source` is
  `PISA` or `SIFTS`; per-assembly coverage is in `data/processed/antigen_unp_coverage.json`.
- **Antibody IMGT** is joined onto PISA on **author** identifiers (chain + residue number +
  insertion code). ANARCII numbers observed residues (extracted with gemmi); its result dict is
  keyed positionally (`"Sequence 1"…`), not by sequence string.
- **Mol\* / MolViewSpec selectors use LABEL ids**, taken straight from the PISA bond arrays —
  never derived from author numbers.
- **VHH / nanobodies** are handled as heavy-only (ANARCII `chain_type` H). 6wps is a Fab.

See `spec_revised.md` for the full specification and `data/samples/NOTES.md` for the verified
PISA JSON structure.

---

## Tooling

- **ANARCII** (`pip install anarcii`, ≥2.0.5) — transformer-based IMGT numbering. https://github.com/oxpig/ANARCII
- **gemmi** — mmCIF parsing (observed residues). **molviewspec** — Mol\* scene generation.
- **@nightingale-elements/nightingale-track-canvas** — PDBe-KB-style sequence feature track.
- **Recharts** — charts + Sankey. **Mol\*** 5.x (CDN) — 3D interface viewer.

## Status

Validated on 6wps; a 20-assembly tranche processed (19/20; one entry skipped — no antibody
chain classified). The full ≈458-assembly batch and atom-level contact detail in the Sankey
tooltip are the main outstanding items.

## License

MIT — see [LICENSE](LICENSE). Note that the **ANARCII** dependency is BSD-3-Clause and
**Mol\*** is MIT; the demo streams structures/metadata from the PDBe and EBI web services.
