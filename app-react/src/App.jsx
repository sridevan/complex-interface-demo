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
  const interfaces = data.interface_summary || []
  const anomalies = data.mapping_anomalies || []
  const coverage = data.antigen_unp_coverage || []
  const report = data.batch_report || {}

  const heavy = epitope.reduce((s, r) => s + (r.heavy_chain_contacts || 0), 0)
  const light = epitope.reduce((s, r) => s + (r.light_chain_contacts || 0), 0)
  const nAssemblies = report.processed ?? new Set(residue.map((r) => `${r.pdb_id}/${r.assembly_id}`)).size
  const nPdb = report.unique_pdb_entries ?? new Set(residue.map((r) => r.pdb_id)).size
  const uniqueImgt = new Set(residue.filter((r) => r.antibody_imgt_position != null)
    .map((r) => `${r.antibody_chain_type}:${r.antibody_imgt_position}`)).size
  const anomalyOcc = anomalies.reduce((s, a) => s + (a.occurrence_count || 0), 0)

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

      <div className="metrics">
        <Metric label="Assemblies processed" value={nAssemblies} />
        <Metric label="PDB entries" value={nPdb} />
        <Metric label="Antibody–antigen interfaces" value={interfaces.length} />
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

      {tab === 0 && <ComplexOverview epitope={epitope} abImgt={abImgt} regions={regions} residue={residue} />}
      {tab === 1 && <Explorer interfaces={interfaces} residue={residue} />}
      {tab === 2 && <DataNotes anomalies={anomalies} coverage={coverage} />}
    </div>
  )
}

const Metric = ({ label, value }) => (
  <div className="metric"><div className="label">{label}</div><div className="value">{value}</div></div>
)

function DataNotes({ anomalies, coverage }) {
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
    </>
  )
}
