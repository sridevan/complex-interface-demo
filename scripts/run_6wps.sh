#!/usr/bin/env bash
# End-to-end validation run for the 6wps reference entry (spec's "start with one entry").
set -euo pipefail
cd "$(dirname "$0")/.."

PISA=data/raw/pisa/6wps/6wps_assembly1_interfaces.json

python scripts/fetch_complex_details.py --complex-id PDB-CPX-140202 --only-pdb 6wps
python scripts/fetch_pisa_files.py --skip-existing
python scripts/parse_pisa_interfaces.py "$PISA"
python scripts/identify_chains.py --pdb-id 6wps --assembly-id 1
python scripts/run_anarcii.py --pdb-id 6wps --assembly-id 1
python scripts/build_processed_dataset.py --interfaces-json "$PISA"
python scripts/build_aggregations.py
# standalone anomaly scanner writes its own report (does not clobber the pipeline's
# mapping_anomalies.json emitted by build_processed_dataset.py above)
python scripts/check_unp_anomalies.py "$PISA" --antigen-acc P0DTC2 \
    --antibody-chains C,D,F,G,H,L --out data/processed/unp_anomaly_scan.json || true
python scripts/build_mvs.py "$PISA" --out-dir app/public/mvs \
    --antigen-chains A,B,E --antibody-chains C,D,F,G,H,L

echo
echo "Done. Launch the app with:  streamlit run app/app.py"
