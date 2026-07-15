import React, { useEffect, useMemo, useState } from 'react'
import Viewer3Dmol from './Viewer3Dmol.jsx'
import SankeyContacts from './SankeyContacts.jsx'
import InterfacePropertyDistributions from './InterfacePropertyDistributions.jsx'
import ContactPairTable from '../complex/ContactPairTable.jsx'
import EpitopeRegionMap from './EpitopeRegionMap.jsx'
import { Pager } from './Pager.jsx'
import SortIcon from './SortIcon.jsx'
import Hint from './Hint.jsx'

const COMPLEX_ID = 'PDB-CPX-140202'
const INST_PAGE_SIZE = 25
const ANTIGEN = { name: 'SARS-CoV-2 spike glycoprotein', gene: 'S', acc: 'P0DTC2',
  organism: 'SARS-CoV-2', note: 'Antigen · residues normalised by UniProt position (PISA)' }
const AB_COLOR = '#e19039', AG_COLOR = '#4b7fcc'

const median = (arr) => {
  if (!arr.length) return null
  const s = [...arr].sort((a, b) => a - b); const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const keyOf = (r) => `${r.pdb_id}|${r.assembly_id}|${r.interface_id}`
const ifaceLabel = (r) => `${r.pdb_id}_${r.assembly_id}_${r.interface_id}`
const SABDAB_URL = 'https://sabdab.opig.stats.ox.ac.uk/sabdab/'
const sabKey = (r) => `${r.pdb_id}|${r.antibody_chain}|${r.antibody_chain_type}`
const qualKey = (r) => `${r.pdb_id}|${r.assembly_id}`
const shortMethod = (m) => (m || '').replace('X-ray diffraction', 'X-ray').replace('Electron microscopy', 'EM').replace('cryo-EM', 'cryo-EM')

const AA3TO1 = { ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C', GLU: 'E', GLN: 'Q', GLY: 'G', HIS: 'H',
  ILE: 'I', LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F', PRO: 'P', SER: 'S', THR: 'T', TRP: 'W', TYR: 'Y',
  VAL: 'V', MSE: 'M', SEC: 'U', PYL: 'O' }
const one = (resn) => AA3TO1[resn] || 'X'

const INST_CMP = {
  experimental_method: (a, b) => (a._method || '').localeCompare(b._method || ''),
  resolution: (a, b) => (a._res ?? 1e9) - (b._res ?? 1e9),
  interface_area: (a, b) => (a.interface_area || 0) - (b.interface_area || 0),
}
const INST_DEFAULT_DIR = { experimental_method: 'asc', resolution: 'asc', interface_area: 'desc' }

function SelectorCard({ label, sub, color, count, medBsa, active, onClick }) {
  return (
    <div className={'selcard' + (active ? ' active' : '')} onClick={onClick} style={{ '--acc': color, cursor: 'pointer' }}>
      <div className="selcard-title"><span className="dot" style={{ background: color }} />{label}</div>
      {sub && <div className="note" style={{ margin: '2px 0 8px', fontSize: 12 }}>{sub}</div>}
      <div className="selcard-stats">
        <div><div className="v">{count}</div><div className="k">interface{count === 1 ? '' : 's'}</div></div>
        <div><div className="v">{medBsa != null ? Math.round(medBsa) : '—'}</div><div className="k">median BSA (Å²)</div></div>
      </div>
    </div>
  )
}

export default function Explorer({ interfaces, residue, sabdab = {}, quality = {} }) {
  const [chainType, setChainType] = useState('heavy')
  const [selKey, setSelKey] = useState(null)
  const [highlight, setHighlight] = useState(null)
  const [instFilter, setInstFilter] = useState('')
  const [resMin, setResMin] = useState('')
  const [resMax, setResMax] = useState('')
  const [instSort, setInstSort] = useState({ key: 'interface_area', dir: 'desc' })
  const [instPage, setInstPage] = useState(0)
  const selectInstance = (k) => { setSelKey(k); setHighlight(null) }
  const pickChain = (t) => { setChainType(t); setSelKey(null); setHighlight(null) }
  const toggleInst = (key) => setInstSort((p) => p.key === key
    ? { key, dir: p.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: INST_DEFAULT_DIR[key] })
  useEffect(() => { setInstPage(0) }, [chainType, instFilter, resMin, resMax, instSort.key, instSort.dir])

  // attach method/resolution (from structure_quality, keyed pdb|assembly) to each interface instance
  const byType = useMemo(() => {
    const attach = (i) => { const q = quality[qualKey(i)] || {}; return { ...i, _res: q.resolution ?? null, _method: q.method || '' } }
    const side = (t) => interfaces.filter((i) => i.antibody_chain_type === t).map(attach)
    return { heavy: side('heavy'), light: side('light') }
  }, [interfaces, quality])
  const stats = {
    heavy: { count: byType.heavy.length, med: median(byType.heavy.map((i) => i.interface_area).filter((x) => x != null)) },
    light: { count: byType.light.length, med: median(byType.light.map((i) => i.interface_area).filter((x) => x != null)) },
  }
  const instMethods = [...new Set(interfaces.map((i) => (quality[qualKey(i)] || {}).method).filter(Boolean))].sort()

  const instAll = byType[chainType]
  const instQ = instFilter.trim().toLowerCase()
  const instFilteredRows = instAll.filter((i) => {
    if (instQ && !`${i.pdb_id} ${i._method}`.toLowerCase().includes(instQ)) return false
    if (resMin !== '' && !(i._res != null && i._res >= +resMin)) return false
    if (resMax !== '' && !(i._res != null && i._res <= +resMax)) return false
    return true
  })
  const instRows = useMemo(() => {
    const s = instSort.dir === 'asc' ? 1 : -1
    return [...instFilteredRows].sort((a, b) => s * INST_CMP[instSort.key](a, b))
  }, [instFilteredRows, instSort])
  const instFiltered = instQ !== '' || resMin !== '' || resMax !== ''
  const clearInstFilters = () => { setInstFilter(''); setResMin(''); setResMax('') }
  const instPageCount = Math.max(1, Math.ceil(instRows.length / INST_PAGE_SIZE))
  const instPageIdx = Math.min(instPage, instPageCount - 1)
  const instFrom = instPageIdx * INST_PAGE_SIZE
  const instPaged = instRows.slice(instFrom, instFrom + INST_PAGE_SIZE)

  const selected = instRows.find((i) => keyOf(i) === selKey) || instAll.find((i) => keyOf(i) === selKey) || instRows[0] || instAll[0]

  const sankeyRows = useMemo(() => {
    if (!selected) return []
    return residue.filter((r) => r.pdb_id === selected.pdb_id
      && r.assembly_id === selected.assembly_id && r.interface_id === selected.interface_id)
  }, [selected, residue])

  // Interface residues for the 3D viewer (antigen -> UniProt label, antibody -> IMGT label).
  const iface = useMemo(() => {
    const ag = new Map(), ab = new Map()
    for (const r of sankeyRows) {
      const agNum = r.antigen_uniprot_position ?? r.antigen_residue_author_number
      ag.set(`${r.antigen_chain_id}|${r.antigen_residue_author_number}`, {
        chain: r.antigen_chain_id, resi: r.antigen_residue_author_number,
        label: `${r.antigen_chain_id}:${r.antigen_residue_name}${agNum} (UNP)`,
        short: `${r.antigen_chain_id}:${one(r.antigen_residue_name)}${agNum}` })
      const abNum = r.antibody_imgt_position != null
        ? `${r.antibody_imgt_position}${r.antibody_imgt_insertion_code || ''}` : r.antibody_residue_author_number
      ab.set(`${r.antibody_chain_id}|${r.antibody_residue_author_number}`, {
        chain: r.antibody_chain_id, resi: r.antibody_residue_author_number,
        label: `${r.antibody_chain_id}:${r.antibody_residue_name}${abNum} (IMGT)`,
        short: `${r.antibody_chain_id}:${one(r.antibody_residue_name)}${abNum}` })
    }
    return { ag: [...ag.values()], ab: [...ab.values()] }
  }, [sankeyRows])

  // Section 2 — aggregate epitope×paratope contacts across ALL instances of the selected chain type.
  // A "contact" is a (UniProt antigen residue, IMGT antibody position) pair; frequency = how many
  // antibody interfaces show it. Paratope-only: both sides must be mapped.
  const pairAgg = useMemo(() => {
    const m = new Map(); const insts = new Set()
    for (const r of residue) {
      if (r.antibody_chain_type !== chainType) continue
      if (r.antigen_uniprot_position == null || r.antibody_imgt_position == null) continue
      const inst = `${r.pdb_id}|${r.assembly_id}|${r.interface_id}`; insts.add(inst)
      const k = `${r.antigen_uniprot_position}|${r.antibody_imgt_position}`
      if (!m.has(k)) m.set(k, { pos1: r.antigen_uniprot_position, res1: r.antigen_residue_name,
        pos2: r.antibody_imgt_position, res2: r.antibody_residue_name, insts: new Set(), bonds: new Set() })
      const e = m.get(k); e.insts.add(inst)
      for (const bt of Object.keys(r.interaction_types || {})) e.bonds.add(bt)
    }
    return { pairs: [...m.values()].map((e) => ({ pos1: e.pos1, res1: e.res1, pos2: e.pos2, res2: e.res2,
      freq: e.insts.size, bonds: [...e.bonds] })), total: insts.size }
  }, [residue, chainType])

  const nAntibodies = new Set(Object.values(sabdab).map((v) => v.sabdab_id)).size
  const sideName = chainType === 'heavy' ? 'heavy chain' : 'light chain'
  const AG_LABEL = 'Ag residue', AB_LABEL = 'Ab residue'

  const SortTh = ({ label, k, className }) => {
    const active = instSort.key === k
    return (
      <th className={(className ? className + ' ' : '') + 'th-sort' + (active ? ' sorted' : '')}
          onClick={() => toggleInst(k)} title={`Sort by ${label}`}>
        <span className="th-inner">{label}<SortIcon dir={active ? instSort.dir : null} /></span>
      </th>
    )
  }

  return (
    <>
      {/* Component header — the two sides of every interface in this complex. */}
      <div className="uni-summary">
        <div className="uni-card">
          <div className="uni-head">
            <span className="chip"><span className="dot" style={{ background: AG_COLOR }} />Antigen</span>
            <a className="uni-acc" href={`https://www.uniprot.org/uniprotkb/${ANTIGEN.acc}`} target="_blank" rel="noreferrer">{ANTIGEN.acc}</a>
          </div>
          <div className="uni-name">{ANTIGEN.name} · {ANTIGEN.gene}</div>
          <div className="uni-meta"><i>{ANTIGEN.organism}</i> · residues by UniProt position (PISA)</div>
        </div>
        <div className="uni-card">
          <div className="uni-head">
            <span className="chip"><span className="dot" style={{ background: AB_COLOR }} />Antibody</span>
          </div>
          <div className="uni-name">Antibodies (Fab / Fv){nAntibodies ? ` · ${nAntibodies} unique` : ''}</div>
          <div className="uni-meta"><i>Homo sapiens</i> · residues by IMGT numbering (ANARCII), grouped by SAbDab2</div>
        </div>
      </div>

      {/* Section 1 — one selected antibody–antigen interface. */}
      <div className="section-band">
        <span className="section-num">1</span>
        <div>
          <h2 className="section-title">Explore one deposited structure</h2>
          <p className="section-sub">Pick an antibody chain side, then a deposited interface, to view its 3D
            structure and residue-level paratope–epitope contacts. Everything in this section reflects the one selected interface.</p>
        </div>
      </div>

      <div className="ex-row ex-row1">
        <div className="card ex-cell">
          <h2>Interface selection</h2>
          <p className="note">Antibody–antigen interfaces split by which antibody chain contacts the antigen.
            Select a side; cards are ranked below by buried surface area (BSA).</p>
          <div className="selcards">
            <SelectorCard label="Antibody heavy chain" sub="antigen ↔ VH" color={AB_COLOR}
              count={stats.heavy.count} medBsa={stats.heavy.med} active={chainType === 'heavy'} onClick={() => pickChain('heavy')} />
            <SelectorCard label="Antibody light chain" sub="antigen ↔ VL" color={AG_COLOR}
              count={stats.light.count} medBsa={stats.light.med} active={chainType === 'light'} onClick={() => pickChain('light')} />
          </div>
        </div>

        <div className="card ex-cell">
          <h2>3D view of selected interface <span className="h2-sub">· {selected ? `${selected.pdb_id} interface ${selected.interface_id}` : '—'}</span></h2>
          <div className="legend" style={{ marginTop: 0 }}>
            <span className="dot" style={{ background: AG_COLOR }} /> antigen
            <span className="dot" style={{ background: AB_COLOR }} /> antibody
          </div>
          {selected ? <Viewer3Dmol pdbId={selected.pdb_id} agResidues={iface.ag} abResidues={iface.ab}
                                    highlight={highlight} onClearHighlight={() => setHighlight(null)} height={480} />
            : <p className="note">No interface selected.</p>}
        </div>
      </div>

      <div className="ex-row ex-row2">
        {/* instances table */}
        <div className="card ex-cell">
          <h2>Interface instances <span className="h2-sub">· antibody {sideName}</span></h2>
          <p className="note">Deposited antibody–antigen interfaces for the selected chain side. Instance ID is
            <code> pdb_asm_interface</code>. Antibody is the SAbDab2 ID (identical variable-region sequence groups the
            same antibody). Resolution is the deposited structure resolution. Rows sort by BSA (largest first); click
            Method, Res. or BSA to re-sort. Filter by PDB ID, method or a resolution range. Click a row to inspect it above.</p>
          <div className="inst-filter">
            <input className="filter-input inst-filter-text" list="abx-methods" value={instFilter}
              placeholder="Filter by PDB ID or method…" onChange={(e) => setInstFilter(e.target.value)} />
            <datalist id="abx-methods">{instMethods.map((m) => <option key={m} value={m} />)}</datalist>
            <span className="inst-filter-res">Resolution
              <input type="number" step="0.1" min="0" className="filter-input res-in" placeholder="min" value={resMin} onChange={(e) => setResMin(e.target.value)} />–
              <input type="number" step="0.1" min="0" className="filter-input res-in" placeholder="max" value={resMax} onChange={(e) => setResMax(e.target.value)} />Å</span>
            {instFiltered && <button className="cm-filter-clear" onClick={clearInstFilters}>clear</button>}
          </div>
          <div className="table-scroll ex-scroll">
            <table>
              <thead>
                <tr><th>Instance <Hint text="Instance ID format: <pdb_id>_<assembly_id>_<interface_id> (e.g. 6wps_1_7)." /></th><th>PDB ID</th>
                  <SortTh label="Method" k="experimental_method" />
                  <SortTh label="Res. (Å)" k="resolution" className="num" />
                  <th>Ag</th><th>Ab</th><th>Antibody (SAbDab2)</th>
                  <SortTh label="BSA (Å²)" k="interface_area" className="num" /></tr>
              </thead>
              <tbody>
                {instPaged.map((r) => {
                  const sab = sabdab[sabKey(r)]
                  return (
                  <tr key={keyOf(r)} className={'selrow' + (selected && keyOf(r) === keyOf(selected) ? ' sel' : '')}
                      onClick={() => selectInstance(keyOf(r))}>
                    <td><code>{ifaceLabel(r)}</code></td>
                    <td><a href={`https://www.ebi.ac.uk/pdbe/entry/pdb/${r.pdb_id}`} target="_blank" rel="noreferrer"
                           onClick={(e) => e.stopPropagation()}>{r.pdb_id}</a></td>
                    <td><span title={r._method || ''}>{shortMethod(r._method) || '—'}</span></td>
                    <td className="num">{r._res != null ? r._res.toFixed(1) : '—'}</td>
                    <td>{r.antigen_chain}</td><td>{r.antibody_chain}</td>
                    <td>{sab ? (
                      <a href={SABDAB_URL + sab.sabdab_id} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                         title={[sab.ab_type, sab.heavy_subclass, sab.light_subclass].filter(Boolean).join(' · ')}>{sab.sabdab_id}</a>
                    ) : '—'}</td>
                    <td className="num">{r.interface_area != null ? Math.round(r.interface_area) : '—'}</td>
                  </tr>
                )})}
              </tbody>
            </table>
            {instFiltered && !instRows.length && <p className="note" style={{ padding: '10px 2px 0' }}>No interfaces match these filters.</p>}
          </div>
          <Pager page={instPageIdx} pageCount={instPageCount} setPage={setInstPage}
                 from={instFrom} to={instFrom + instPaged.length} total={instRows.length} unit="interfaces" />
        </div>

        {/* Sankey for selected instance */}
        <div className="card ex-cell">
          <h2>Antigen–antibody contacts <span className="h2-sub">· {selected ? `${selected.pdb_id} interface ${selected.interface_id}` : '—'}
            {selected && selected.residue_contacts != null ? ` · ${selected.residue_contacts} residue contacts` : ''}</span></h2>
          <p className="note">For the selected interface: antigen residues (UniProt) on the left, antibody residues
            (IMGT) on the right. Click a residue to highlight it here and in the 3D view; click it again to clear.</p>
          <div className="sankey-scroll">
            <SankeyContacts rows={sankeyRows} onNodeClick={setHighlight} selected={highlight} />
          </div>
        </div>
      </div>

      {/* Section 2 — aggregated across all interfaces of the selected chain side. */}
      <div className="section-band">
        <span className="section-num">2</span>
        <div>
          <h2 className="section-title">Conservation across all antibodies</h2>
          <p className="section-sub">How consistently each epitope–paratope contact recurs across every deposited
            antibody {sideName} interface — independent of the single interface shown above.</p>
        </div>
      </div>

      <div className="ex-row cm-row">
        <div className="card ex-cell">
          <h2>Contact pair frequency <span className="h2-sub">· antibody {sideName}</span></h2>
          <p className="note">Antigen residue (UniProt numbering) ↔ antibody residue (IMGT numbering) contacts,
            aggregated across all antibody {sideName} interfaces. Frequency indicates how often each pair is observed.
            Contact types are listed strongest first; use the filter to show only pairs with a given interaction type.</p>
          <ContactPairTable pairs={pairAgg.pairs} total={pairAgg.total} leftLabel={AG_LABEL} rightLabel={AB_LABEL} />
        </div>
        <div className="card ex-cell">
          <h2>Epitope × antibody-region map <span className="h2-sub">· antibody {sideName}</span></h2>
          <p className="note">Epitope residues (rows) against the antibody's IMGT regions (columns) — individual
            paratope positions are accumulated into their CDR / framework region. Each cell is shaded by the fraction
            of antibody {sideName} interfaces in which that epitope residue contacts that region; residue-level detail
            is in the table on the left.</p>
          <EpitopeRegionMap residue={residue} chainType={chainType} total={pairAgg.total} leftLabel={AG_LABEL} />
        </div>
      </div>

      <div className="ex-row">
        <InterfacePropertyDistributions instances={instAll} selected={selected} chainType={chainType} />
      </div>
    </>
  )
}
