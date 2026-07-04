#!/usr/bin/env python3
"""
Streamlit demo: Aggregated antibody-antigen interfaces for PDB-CPX-140202.

Reads the pre-built processed tables in data/processed/ and the pre-built Mol* scenes in
app/public/mvs/. The antigen side is normalised by UniProt (from PISA); the antibody side by
IMGT (from ANARCII). The headline output is the heavy/light frequency contact table.

Run:  streamlit run app/app.py
"""

import json
import os

import pandas as pd
import streamlit as st
import streamlit.components.v1 as components

# ---------------------------------------------------------------------------
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PROC = os.path.join(ROOT, "data", "processed")
MVS_DIR = os.path.join(HERE, "public", "mvs")
COMPLEX_ID = "PDB-CPX-140202"
MOLSTAR_VERSION = "5.10.1"  # pinned (spec: Mol* 5.x)

ANTIGEN_COLOR = "#4b7fcc"
ANTIBODY_COLOR = "#e19039"

st.set_page_config(page_title=f"Antibody-antigen interfaces · {COMPLEX_ID}", layout="wide")


@st.cache_data
def load_json(name):
    path = os.path.join(PROC, name)
    if not os.path.exists(path):
        return None
    with open(path) as fh:
        return json.load(fh)


def df(name):
    data = load_json(name)
    return pd.DataFrame(data) if data else pd.DataFrame()


def fmt_regions(cell):
    if isinstance(cell, list):
        return ", ".join(f"{d['value']} ({d['count']})" for d in cell) if cell else "—"
    return cell


# ---------------------------------------------------------------------------
processed = df("processed_antibody_antigen_interfaces.json")
residue = df("residue_level_interactions.json")
epitope = df("aggregated_antigen_epitope_contacts.json")
freq = df("frequency_contacts_by_heavy_light.json")
imgt = df("aggregated_antibody_imgt_contacts.json")
region = df("imgt_region_contribution.json")
anomalies = load_json("mapping_anomalies.json") or []

if processed.empty:
    st.error("No processed data found. Run the pipeline scripts first (see README).")
    st.stop()

# ---- 1. Complex summary panel --------------------------------------------------
st.title("Aggregated antibody–antigen interfaces")
st.caption(f"{COMPLEX_ID} — SARS-CoV-2 spike · antigen normalised by UniProt (PISA), "
           f"antibody normalised by IMGT (ANARCII)")

assemblies = processed[["pdb_id", "assembly_id"]].drop_duplicates()
n_assemblies = len(assemblies)
n_pdb = processed["pdb_id"].nunique()
n_interfaces = processed[["pdb_id", "assembly_id", "interface_id"]].drop_duplicates().shape[0]
unique_spike = epitope.shape[0] if not epitope.empty else 0
unique_imgt = residue.loc[residue["antibody_imgt_position"].notna(), "antibody_imgt_position"].nunique() \
    if not residue.empty else 0
heavy_contacts = int((residue["antibody_chain_type"] == "heavy").sum()) if not residue.empty else 0
light_contacts = int((residue["antibody_chain_type"] == "light").sum()) if not residue.empty else 0

if n_pdb == 1:
    st.warning(f"⚠️ v1 processed a single PDB entry ({assemblies.iloc[0]['pdb_id']}). "
               "Cross-structure aggregate counts (assemblies/PDB entries contacted) reflect one entry only.")

c = st.columns(6)
c[0].metric("Assemblies processed", n_assemblies)
c[1].metric("Antibody–antigen interfaces", n_interfaces)
c[2].metric("Unique spike residues", unique_spike)
c[3].metric("Unique antibody IMGT positions", unique_imgt)
c[4].metric("Heavy-chain contacts", heavy_contacts)
c[5].metric("Light-chain contacts", light_contacts)
if anomalies:
    st.info(f"ℹ️ {sum(a['occurrence_count'] for a in anomalies)} upstream UniProt-on-antibody "
            f"mapping anomalies detected and excluded (chain-based classification; "
            f"{len(anomalies)} distinct residue occurrences). See 'Data notes' below.")

tabs = st.tabs([
    "🎯 Heavy/Light frequency (headline)", "🧬 Spike epitope", "📋 Residue-level",
    "🔬 Antibody IMGT", "📊 Charts", "🧊 3D interfaces", "ℹ️ Data notes",
])

# ---- 4. Frequency table by heavy/light (headline) -----------------------------
with tabs[0]:
    st.subheader("Frequency of spike-residue contacts, split by antibody heavy/light chain")
    st.caption("Antigen grouped by UniProt position (from PISA); antibody split by chain type "
               "(IMGT via ANARCII). Default sort: total contacts. Unit: contact pairs.")
    filt = st.radio("Filter", ["All", "Heavy-dominated (H>L)", "Light-dominated (L>H)",
                               "Both (H>0 and L>0)"], horizontal=True)
    fdf = freq.copy()
    if filt.startswith("Heavy"):
        fdf = fdf[fdf["heavy_chain_contacts"] > fdf["light_chain_contacts"]]
    elif filt.startswith("Light"):
        fdf = fdf[fdf["light_chain_contacts"] > fdf["heavy_chain_contacts"]]
    elif filt.startswith("Both"):
        fdf = fdf[(fdf["heavy_chain_contacts"] > 0) & (fdf["light_chain_contacts"] > 0)]
    show = fdf.copy()
    for col in ("most_common_heavy_chain_imgt_regions", "most_common_light_chain_imgt_regions"):
        show[col] = show[col].apply(fmt_regions)
    st.dataframe(show, use_container_width=True, hide_index=True)

# ---- 3. Aggregated spike epitope view -----------------------------------------
with tabs[1]:
    st.subheader("Aggregated spike epitope (by UniProt position)")
    show = epitope.copy()
    for col in [c for c in show.columns if c.startswith("most_common")]:
        show[col] = show[col].apply(fmt_regions)
    st.dataframe(show, use_container_width=True, hide_index=True)

# ---- 2. Residue-level interaction table ---------------------------------------
with tabs[2]:
    st.subheader("Residue-level antibody–antigen contacts (one row per residue pair)")
    r = residue.copy()
    cc = st.columns(4)
    hl = cc[0].multiselect("Heavy/Light", sorted(r["antibody_chain_type"].dropna().unique()))
    reg_opts = sorted(r["antibody_imgt_region"].dropna().unique())
    rsel = cc[1].multiselect("IMGT region", reg_opts)
    pos_opts = sorted(r["antigen_uniprot_position"].dropna().unique())
    psel = cc[2].multiselect("Spike UniProt position", pos_opts)
    itypes = sorted({t for d in r["interaction_types"] for t in (d or {})})
    isel = cc[3].multiselect("Interaction type", itypes)
    if hl:
        r = r[r["antibody_chain_type"].isin(hl)]
    if rsel:
        r = r[r["antibody_imgt_region"].isin(rsel)]
    if psel:
        r = r[r["antigen_uniprot_position"].isin(psel)]
    if isel:
        r = r[r["interaction_types"].apply(lambda d: any(t in (d or {}) for t in isel))]
    cols = ["pdb_id", "assembly_id", "interface_id", "antigen_chain_id", "antigen_residue_name",
            "antigen_uniprot_accession", "antigen_uniprot_position", "antibody_chain_id",
            "antibody_chain_type", "antibody_residue_name", "antibody_imgt_position",
            "antibody_imgt_region", "bond_count", "interaction_types", "min_distance"]
    view = r[cols].copy()
    view["interaction_types"] = view["interaction_types"].apply(
        lambda d: ", ".join(f"{k}×{v}" for k, v in (d or {}).items()))
    st.caption(f"{len(view)} contact pairs")
    st.dataframe(view, use_container_width=True, hide_index=True)

# ---- 5. Aggregated antibody IMGT view -----------------------------------------
with tabs[3]:
    st.subheader("Aggregated antibody IMGT positions")
    show = imgt.copy()
    if not show.empty:
        show["most_common_contacted_antigen_residues"] = \
            show["most_common_contacted_antigen_residues"].apply(fmt_regions)
    st.dataframe(show, use_container_width=True, hide_index=True)

# ---- 6. Charts ----------------------------------------------------------------
with tabs[4]:
    st.subheader("Contacts by IMGT region")
    if not region.empty:
        rc = region.copy()
        rc["label"] = rc["antibody_chain_type"] + " · " + rc["antibody_imgt_region"]
        st.bar_chart(rc.set_index("label")["total_contacts"])

    st.subheader("Heavy vs light contribution")
    hl_tot = pd.DataFrame({
        "chain_type": ["heavy", "light"],
        "contacts": [heavy_contacts, light_contacts],
    }).set_index("chain_type")
    st.bar_chart(hl_tot)

    st.subheader("Top contacted spike residues (by UniProt position)")
    if not freq.empty:
        top = freq.sort_values("total_contacts", ascending=False).head(20).copy()
        top["residue"] = top["antigen_residue_name"] + top["antigen_uniprot_position"].astype(str)
        st.bar_chart(top.set_index("residue")[["heavy_chain_contacts", "light_chain_contacts"]])

# ---- 7. Interface list + 3D viewer --------------------------------------------
with tabs[5]:
    st.subheader("Antibody–antigen interfaces (click a row to view in 3D)")
    # Per-interface summary from processed rows.
    summ = []
    manifest_path = os.path.join(MVS_DIR, "mvs_manifest.json")
    manifest = json.load(open(manifest_path)) if os.path.exists(manifest_path) else []
    have = {(m["pdb_id"], str(m["assembly_id"]), str(m["interface_id"])) for m in manifest}
    for (pdb, asm, iid), g in processed.groupby(["pdb_id", "assembly_id", "interface_id"]):
        pairs = g.drop_duplicates(["antigen_residue_author_number", "antibody_auth_asym_id",
                                   "antibody_residue_author_number", "antibody_residue_author_insertion_code"])
        summ.append({
            "pdb_id": pdb, "assembly_id": asm, "interface_id": iid,
            "antigen_chain": ",".join(sorted(g["antigen_auth_asym_id"].unique())),
            "antibody_chain": ",".join(sorted(g["antibody_auth_asym_id"].unique())),
            "interface_area": g["interface_area"].iloc[0],
            "residue_contacts": len(pairs),
            "hbonds": int((g["interaction_type"] == "hydrogen_bond").sum()),
            "has_scene": (pdb, str(asm), str(iid)) in have,
        })
    sdf = pd.DataFrame(summ).sort_values("interface_id", key=lambda s: s.astype(int))
    st.dataframe(sdf, use_container_width=True, hide_index=True)

    options = [f"Interface {r.interface_id}  ({r.antigen_chain}↔{r.antibody_chain})"
               for r in sdf.itertuples() if r.has_scene]
    id_by_opt = {f"Interface {r.interface_id}  ({r.antigen_chain}↔{r.antibody_chain})": str(r.interface_id)
                 for r in sdf.itertuples() if r.has_scene}
    if options:
        choice = st.selectbox("Interface to view", options)
        iid = id_by_opt[choice]
        pdb = sdf.iloc[0]["pdb_id"]
        asm = sdf.iloc[0]["assembly_id"]
        mvsj_path = os.path.join(MVS_DIR, f"{pdb}_assembly{asm}_interface{iid}.mvsj")
        with open(mvsj_path) as fh:
            mvsj_text = fh.read()
        st.caption(f"Antigen (blue) ↔ antibody (amber), interface residues in ball-and-stick. "
                   f"Structure streams from PDBe; the viewer needs internet access.")
        html = f"""
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/molstar@{MOLSTAR_VERSION}/build/viewer/molstar.css"/>
<script src="https://cdn.jsdelivr.net/npm/molstar@{MOLSTAR_VERSION}/build/viewer/molstar.js"></script>
<div id="mvs-app" style="position:relative;width:100%;height:560px"></div>
<script>
  const mvsjText = {json.dumps(mvsj_text)};
  (async function() {{
    const viewer = await molstar.Viewer.create('mvs-app',
      {{ layoutIsExpanded:false, layoutShowControls:false, pdbProvider:'pdbe' }});
    const mvsData = molstar.PluginExtensions.mvs.MVSData.fromMVSJ(mvsjText);
    await molstar.PluginExtensions.mvs.loadMVS(viewer.plugin, mvsData,
      {{ replaceExisting:true, sanityChecks:true }});
  }})();
</script>
"""
        components.html(html, height=580)
    else:
        st.info("No pre-built Mol* scenes found. Run scripts/build_mvs.py.")

# ---- Data notes ---------------------------------------------------------------
with tabs[6]:
    st.subheader("Data provenance & notes")
    st.markdown(f"""
- **Antigen numbering:** UniProt position from the PISA bond arrays (`atom_site_N_unp_nums`),
  read only on antigen chains. **Antibody numbering:** IMGT via ANARCII (transformer model).
- **Chain-based classification:** antigen vs antibody is decided by chain (SIFTS UniProt +
  ANARCII), never by per-bond UniProt accession — antibody residues carry spurious P0DTC2 tags.
- **Counting unit:** contact pairs (distinct antigen-residue ↔ antibody-residue pairs);
  `bond_count` retained per pair as a secondary metric.
- **UniProt-on-antibody anomalies:** {len(anomalies)} distinct residue occurrences
  ({sum(a['occurrence_count'] for a in anomalies)} bond records) carrying spurious P0DTC2
  accessions on antibody chains — excluded by chain-wins classification, logged to
  `mapping_anomalies.json` for upstream reporting.
""")
    if anomalies:
        st.dataframe(pd.DataFrame(anomalies), use_container_width=True, hide_index=True)
