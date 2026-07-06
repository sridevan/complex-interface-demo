import React, { useEffect, useState } from 'react'
import { loadAll } from './data.js'
import DataTable from './components/DataTable.jsx'
import Explorer from './components/Explorer.jsx'
import ComplexOverview from './components/ComplexOverview.jsx'

const COMPLEX_ID = 'PDB-CPX-140202'
const TABS = ['Complex overview', 'Interface explorer', 'Data provenance']

export default function App() {
  const [data, setData] = useState(null)
  const [tab, setTab] = useState(0)
  useEffect(() => { loadAll().then(setData) }, [])
  if (!data) return <div className="wrap">Loading…</div>

  const epitope = data.aggregated_antigen_epitope_contacts || []
  const abImgt = data.aggregated_antibody_imgt_contacts || []
  const regions = data.imgt_region_contribution || []
  const residue = data.residue_level_interactions || []
  const variants = data.antigen_interface_variants || []
  const glycans = data.antigen_interface_glycans || []
  const interfaces = data.interface_summary || []
  const sabdab = data.sabdab2_ids || {}
  const quality = data.structure_quality || {}
  const multidomain = data.multidomain_antibody_chains || {}
  const anomalies = data.mapping_anomalies || []
  const coverage = data.antigen_unp_coverage || []
  const report = data.batch_report || {}

  // Two display rules keep the epitope/paratope views to genuine antibody recognition:
  //  1. PARATOPE-ONLY: count only IMGT-mapped (variable-domain) antibody contacts. Contacts from
  //     constant domains (Fab CH1/CL) or scaffolds/linkers (unmapped, antibody_imgt_position == null)
  //     aren't recognition — drop them everywhere. Matches build_aggregations' epitope aggregators.
  //  2. Multi-domain antibody constructs (>=2 variable domains) also get their interfaces hidden from
  //     the instances table, since our single-domain numbering can't disambiguate their paratopes.
  // Raw data keeps everything (see DataNotes). NB a geometric-span flag was evaluated to catch
  // mis-numbered single-domain chains (e.g. 8w4f) but rejected: 8w4f is not separable from ~100 legit
  // large/quaternary paratopes by any distance threshold, so it stays visible.
  const mdKeys = new Set(Object.keys(multidomain))
  const isMultiDomain = (pdb, chain) => mdKeys.has(`${pdb}|${chain}`)
  const isParatope = (r) => r.antibody_imgt_position != null
  const interfacesShown = interfaces.filter((i) => !isMultiDomain(i.pdb_id, i.antibody_chain))
  const residueShown = residue.filter((r) => isParatope(r) && !isMultiDomain(r.pdb_id, r.antibody_chain_id))
  const nMdInterfaces = interfaces.length - interfacesShown.length
  const nNonParatope = residue.filter((r) => !isParatope(r) && r.antigen_uniprot_position != null).length

  const heavy = epitope.reduce((s, r) => s + (r.heavy_chain_contacts || 0), 0)
  const light = epitope.reduce((s, r) => s + (r.light_chain_contacts || 0), 0)
  const nAssemblies = report.processed ?? new Set(residue.map((r) => `${r.pdb_id}/${r.assembly_id}`)).size
  const nPdb = report.unique_pdb_entries ?? new Set(residue.map((r) => r.pdb_id)).size
  const uniqueImgt = new Set(residue.filter((r) => r.antibody_imgt_position != null)
    .map((r) => `${r.antibody_chain_type}:${r.antibody_imgt_position}`)).size
  const anomalyOcc = anomalies.reduce((s, a) => s + (a.occurrence_count || 0), 0)
  const uniqueAntibodies = new Set(Object.values(sabdab).map((v) => v.sabdab_id)).size
  const resVals = Object.values(quality).map((q) => q.resolution).filter((x) => x != null).sort((a, b) => a - b)
  const medRes = resVals.length ? resVals[Math.floor(resVals.length / 2)] : null

  return (
    <div className="wrap">
      <h1>Aggregated antibody–antigen interfaces</h1>
      <p className="subtitle">
        {COMPLEX_ID} · antigen residues normalised by UniProt (PISA), antibody residues by IMGT (ANARCII)
      </p>

      {nPdb === 1 && (
        <div className="banner warn">⚠️ A single PDB entry was processed — cross-structure aggregate
          counts reflect one entry only.</div>
      )}
      {anomalyOcc > 0 && (
        <div className="banner info">ℹ️ {anomalyOcc} upstream UniProt-on-antibody mapping anomalies
          detected and excluded by chain-based classification ({anomalies.length} distinct residue
          occurrences). See “Data provenance”.</div>
      )}
      {nMdInterfaces > 0 && (
        <div className="banner info">ℹ️ {nMdInterfaces} interface{nMdInterfaces > 1 ? 's' : ''} from{' '}
          {mdKeys.size} multi-domain antibody chain{mdKeys.size > 1 ? 's' : ''} (tribody / bispecific /
          tandem&nbsp;scFv) excluded from the interface &amp; paratope views — per-domain IMGT numbering is
          unreliable for these. They remain in the dataset; see “Data provenance”.</div>
      )}

      <div className="metrics">
        <Metric label="Assemblies processed" value={nAssemblies} />
        <Metric label="PDB entries" value={nPdb} />
        <Metric label="Antibody–antigen interfaces" value={interfaces.length} />
        {uniqueAntibodies > 0 && <Metric label="Unique antibodies (SAbDab2)" value={uniqueAntibodies} />}
        {medRes != null && <Metric label="Median resolution (Å)" value={medRes.toFixed(1)} />}
        <Metric label="Unique antigen residues" value={epitope.length} />
        <Metric label="Unique antibody IMGT positions" value={uniqueImgt} />
        <Metric label="Heavy-chain contacts" value={heavy} />
        <Metric label="Light-chain contacts" value={light} />
      </div>

      <div className="tabs">
        {TABS.map((t, i) => (
          <div key={t} className={'tab' + (i === tab ? ' active' : '')} onClick={() => setTab(i)}>{t}</div>
        ))}
      </div>

      {tab === 0 && <ComplexOverview residue={residueShown} variants={variants} glycans={glycans} sabdab={sabdab} />}
      {tab === 1 && <Explorer interfaces={interfacesShown} residue={residueShown} sabdab={sabdab} quality={quality} />}
      {tab === 2 && <DataNotes anomalies={anomalies} coverage={coverage} multidomain={multidomain} nNonParatope={nNonParatope} />}
    </div>
  )
}

const Metric = ({ label, value }) => (
  <div className="metric"><div className="label">{label}</div><div className="value">{value}</div></div>
)

function DataNotes({ anomalies, coverage, multidomain = {}, nNonParatope = 0 }) {
  const mdRows = Object.entries(multidomain)
    .map(([k, v]) => ({ chain: k, pdb_id: k.split('|')[0], ab_chain: k.split('|')[1], ...v }))
  const mdCols = [
    { key: 'pdb_id', label: 'PDB' }, { key: 'ab_chain', label: 'Ab chain' },
    { key: 'n_variable_domains', label: 'Variable domains', num: true },
    { key: 'n_residues', label: 'Chain length', num: true },
  ]
  const anomalyCols = [
    { key: 'pdb_id', label: 'PDB' }, { key: 'interface_id', label: 'Itf' },
    { key: 'bond_type', label: 'Bond' }, { key: 'antibody_auth_asym_id', label: 'Ab chain' },
    { key: 'antibody_residue_author_number', label: 'Ab resnum', num: true },
    { key: 'antibody_residue_name', label: 'Residue' },
    { key: 'spurious_unp_accession', label: 'Spurious acc' },
    { key: 'spurious_unp_position', label: 'Spurious pos', num: true },
    { key: 'occurrence_count', label: 'Count', num: true },
  ]
  const covCols = [
    { key: 'pdb_id', label: 'PDB' }, { key: 'assembly_id', label: 'Asm' },
    { key: 'antigen_contacts', label: 'Antigen contacts', num: true },
    { key: 'unp_from_pisa', label: 'From PISA', num: true },
    { key: 'unp_from_sifts_fallback', label: 'From SIFTS fallback', num: true },
    { key: 'unp_still_unmapped', label: 'Still unmapped', num: true },
    { key: 'pisa_provides_antigen_unp', label: 'PISA has UniProt?',
      render: (v) => v ? 'yes' : <b style={{ color: '#b56b17' }}>no</b> },
    { key: 'pct_mapped', label: '% mapped', num: true, render: (v) => `${v}%` },
  ]
  const missing = coverage.filter((c) => !c.pisa_provides_antigen_unp)
  return (
    <>
      <div className="card">
        <h2>Antigen UniProt coverage per assembly</h2>
        <p className="note">
          The demo normalises antigen residues by UniProt position from PISA. <b>{missing.length} of
          {' '}{coverage.length} assemblies</b> do not carry antigen UniProt numbering in their PISA
          file; these are recovered residue-by-residue from the SIFTS mapping (validated to match PISA
          exactly where both exist). Rows flagged “no” below relied on the SIFTS fallback.
        </p>
        {coverage.length > 0
          ? <DataTable columns={covCols} rows={coverage} initialSort="unp_from_sifts_fallback" />
          : <p className="note">No coverage report found.</p>}
      </div>

      <div className="card">
        <h2>UniProt-on-antibody anomalies</h2>
        <p className="note">
          Antigen/antibody classification is by <b>chain</b> (SIFTS UniProt + ANARCII), never by
          per-bond UniProt accession — antibody residues carry spurious P0DTC2 tags, listed below and
          excluded from all antigen aggregation.
        </p>
        {anomalies.length > 0
          ? <DataTable columns={anomalyCols} rows={anomalies} initialSort="occurrence_count" />
          : <p className="note">No anomalies detected.</p>}
      </div>

      <div className="card">
        <h2>Paratope-only aggregation</h2>
        <p className="note">
          Epitope &amp; paratope aggregates count only <b>IMGT-mapped (variable-domain)</b> antibody
          contacts. Contacts made by an antibody's <b>constant domain</b> (Fab CH1/CL) or a
          <b> scaffold / linker</b> (e.g. a VHH trimerization tag) are structurally real but are not
          antigen <i>recognition</i>, so they are excluded from the maps. <b>{nNonParatope}</b> such
          non-paratope contacts (~1.7% of antigen contacts) are dropped; they remain in the
          residue-level data, labelled <code>unmapped</code>.
        </p>
      </div>

      <div className="card">
        <h2>Multi-domain antibody chains (excluded from interface &amp; paratope views)</h2>
        <p className="note">
          IMGT numbering is defined <b>per variable domain</b> (positions 1–128). These chains carry
          <b> ≥2 variable domains</b> (tribody / bispecific / tandem&nbsp;scFv), so our single-domain
          ANARCII numbering conflates their paratope — their antibody-side IMGT positions are unreliable.
          The epitope side (PISA contacts + antigen UniProt mapping) is unaffected. Their interfaces are
          hidden from the interface and paratope <b>displays only</b>; the contacts remain in the dataset
          (<code>multidomain_antibody_chains.json</code>). {mdRows.length} chain{mdRows.length === 1 ? '' : 's'} flagged.
        </p>
        {mdRows.length > 0
          ? <DataTable columns={mdCols} rows={mdRows} initialSort="n_variable_domains" />
          : <p className="note">No multi-domain antibody chains flagged.</p>}
      </div>
    </>
  )
}
