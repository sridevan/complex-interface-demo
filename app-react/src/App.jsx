import React, { useEffect, useMemo, useState } from 'react'
import { loadAll, topRegions } from './data.js'
import DataTable from './components/DataTable.jsx'
import Charts from './components/Charts.jsx'
import Interfaces3D from './components/Interfaces3D.jsx'
import EpitopeMap from './components/EpitopeMap.jsx'
import ContactHeatmap from './components/ContactHeatmap.jsx'
import Explorer from './components/Explorer.jsx'

const COMPLEX_ID = 'PDB-CPX-140202'
const TABS = ['Interface explorer', 'Epitope map', 'Contact map', 'Epitope residues', 'Paratope (IMGT)',
              'Residue contacts', 'Summary charts', 'Structure viewer', 'Data provenance']

const hlTag = (t) => t ? <span className={`tag ${t}`}>{t}</span> : '—'

export default function App() {
  const [data, setData] = useState(null)
  const [tab, setTab] = useState(0)
  const [selected, setSelected] = useState(null)  // selected antigen UniProt position (2D<->tables link)
  const handleSelect = (pos) => { setSelected(pos); if (pos) setTab(5) }  // 5 = Residue-level contacts
  useEffect(() => { loadAll().then(setData) }, [])
  if (!data) return <div className="wrap">Loading…</div>

  const epitope = data.aggregated_antigen_epitope_contacts || []
  const antibodyImgt = data.aggregated_antibody_imgt_contacts || []
  const region = data.imgt_region_contribution || []
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
          occurrences). See “Data notes”.</div>
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

      {tab === 0 && <Explorer interfaces={interfaces} residue={residue} epitope={epitope} />}
      {tab === 1 && <EpitopeMap epitope={epitope} selected={selected} onSelect={handleSelect} />}
      {tab === 2 && <ContactHeatmap residue={residue} onSelect={handleSelect} />}
      {tab === 3 && <EpitopeTab epitope={epitope} />}
      {tab === 4 && <AntibodyImgtTab rows={antibodyImgt} />}
      {tab === 5 && <ResidueTab rows={residue} selected={selected} onClearSelected={() => setSelected(null)} />}
      {tab === 6 && <Charts region={region} epitope={epitope} />}
      {tab === 7 && <Interfaces3D interfaces={interfaces} />}
      {tab === 8 && <DataNotes anomalies={anomalies} coverage={coverage} />}
    </div>
  )
}

const Metric = ({ label, value }) => (
  <div className="metric"><div className="label">{label}</div><div className="value">{value}</div></div>
)

// ---- Tab 0: merged antigen epitope + heavy/light (one table, no duplication) ----
function EpitopeTab({ epitope }) {
  const [filter, setFilter] = useState('all')
  const rows = useMemo(() => epitope.filter((r) => {
    if (filter === 'heavy') return r.heavy_chain_contacts > r.light_chain_contacts
    if (filter === 'light') return r.light_chain_contacts > r.heavy_chain_contacts
    if (filter === 'both') return r.heavy_chain_contacts > 0 && r.light_chain_contacts > 0
    return true
  }), [epitope, filter])

  const columns = [
    { key: 'antigen_uniprot_accession', label: 'UniProt' },
    { key: 'antigen_uniprot_position', label: 'Position', num: true },
    { key: 'antigen_residue_name', label: 'Residue' },
    { key: 'total_contacts', label: 'Total', num: true },
    { key: 'heavy_chain_contacts', label: 'Heavy', num: true },
    { key: 'light_chain_contacts', label: 'Light', num: true },
    { key: 'assemblies_contacted', label: 'Assemblies', num: true },
    { key: 'pdb_entries_contacted', label: 'PDB entries', num: true },
    { key: 'unique_antibody_chains', label: 'Ab chains', num: true },
    { key: 'unique_antibody_imgt_positions', label: 'IMGT pos', num: true },
    { key: 'most_common_heavy_chain_imgt_regions', label: 'Top heavy regions', render: topRegions },
    { key: 'most_common_light_chain_imgt_regions', label: 'Top light regions', render: topRegions },
  ]
  return (
    <div className="card">
      <h2>Epitope residues by heavy and light chain</h2>
      <p className="note">One row per antigen UniProt position (from PISA). Heavy/light split and top
        IMGT regions come from ANARCII. Unit: contact pairs. (This single view replaces the separate
        epitope and heavy/light tables — same grouping axis.)</p>
      <div className="controls">
        <span className="pill">
          {[['all', 'All'], ['heavy', 'Heavy-dominated'], ['light', 'Light-dominated'], ['both', 'Both']]
            .map(([k, lbl]) => (
              <button key={k} className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>{lbl}</button>
            ))}
        </span>
        <span className="rowcount">{rows.length} residues</span>
      </div>
      <DataTable columns={columns} rows={rows} initialSort="total_contacts" />
    </div>
  )
}

// ---- Tab 1: antibody IMGT (antibody-side axis, distinct information) ----
function AntibodyImgtTab({ rows }) {
  const columns = [
    { key: 'antibody_chain_type', label: 'Chain', render: hlTag },
    { key: 'antibody_imgt_position', label: 'IMGT pos', num: true },
    { key: 'antibody_imgt_region', label: 'Region' },
    { key: 'antibody_residue_name', label: 'Residue' },
    { key: 'total_antigen_contacts', label: 'Antigen contacts', num: true },
    { key: 'assemblies_contacted', label: 'Assemblies', num: true },
    { key: 'unique_antigen_positions_contacted', label: 'Unique antigen pos', num: true },
    { key: 'most_common_contacted_antigen_residues', label: 'Top antigen residues', render: topRegions },
  ]
  return (
    <div className="card">
      <h2>Paratope positions (IMGT)</h2>
      <p className="note">One row per antibody IMGT position (from ANARCII) — the antibody-side view of
        the interface. Sorted by antigen contacts.</p>
      <DataTable columns={columns} rows={rows} initialSort="total_antigen_contacts" />
    </div>
  )
}

// ---- Tab 3: residue-level contact pairs (the raw, non-aggregated table) ----
function ResidueTab({ rows, selected, onClearSelected }) {
  const [hl, setHl] = useState('')
  const [reg, setReg] = useState('')
  const [itype, setItype] = useState('')
  const [q, setQ] = useState('')

  const regions = useMemo(() => [...new Set(rows.map((r) => r.antibody_imgt_region).filter(Boolean))].sort(), [rows])
  const itypes = useMemo(() => [...new Set(rows.flatMap((r) => Object.keys(r.interaction_types || {})))].sort(), [rows])

  const filtered = rows.filter((r) => {
    if (selected != null && r.antigen_uniprot_position !== selected) return false
    if (hl && r.antibody_chain_type !== hl) return false
    if (reg && r.antibody_imgt_region !== reg) return false
    if (itype && !(r.interaction_types || {})[itype]) return false
    if (q && !String(r.antigen_uniprot_position).includes(q)) return false
    return true
  })

  const columns = [
    { key: 'pdb_id', label: 'PDB' },
    { key: 'interface_id', label: 'Itf', num: true },
    { key: 'antigen_chain_id', label: 'Ag chain' },
    { key: 'antigen_residue_name', label: 'Ag res' },
    { key: 'antigen_uniprot_position', label: 'UniProt pos', num: true },
    { key: 'antibody_chain_id', label: 'Ab chain' },
    { key: 'antibody_chain_type', label: 'H/L', render: hlTag },
    { key: 'antibody_residue_name', label: 'Ab res' },
    { key: 'antibody_imgt_position', label: 'IMGT', num: true },
    { key: 'antibody_imgt_region', label: 'Region' },
    { key: 'bond_count', label: 'Bonds', num: true },
    { key: 'interaction_types', label: 'Types', render: (d) => Object.entries(d || {}).map(([k, v]) => `${k}×${v}`).join(', ') },
    { key: 'min_distance', label: 'Min Å', num: true, render: (v) => v?.toFixed(2) ?? '—' },
  ]
  return (
    <div className="card">
      <h2>Antibody–antigen residue contacts</h2>
      <p className="note">One row per antibody–antigen residue contact pair. Antigen numbering: UniProt
        (PISA). Antibody numbering: IMGT (ANARCII).</p>
      {selected != null && (
        <div className="banner info" style={{ marginBottom: 10 }}>
          Filtered to antigen UniProt position <b>{selected}</b> (from the epitope map).{' '}
          <button className="linklike" onClick={onClearSelected}>clear</button>
        </div>
      )}
      <div className="controls">
        <label>Heavy/Light</label>
        <select value={hl} onChange={(e) => setHl(e.target.value)}>
          <option value="">all</option><option value="heavy">heavy</option><option value="light">light</option>
        </select>
        <label>Region</label>
        <select value={reg} onChange={(e) => setReg(e.target.value)}>
          <option value="">all</option>{regions.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <label>Interaction</label>
        <select value={itype} onChange={(e) => setItype(e.target.value)}>
          <option value="">all</option>{itypes.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <label>Antigen pos</label>
        <input type="text" value={q} placeholder="e.g. 343" onChange={(e) => setQ(e.target.value)} style={{ width: 80 }} />
        <span className="rowcount">{filtered.length} of {rows.length} pairs</span>
      </div>
      <DataTable columns={columns} rows={filtered} initialSort="bond_count" />
    </div>
  )
}

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
