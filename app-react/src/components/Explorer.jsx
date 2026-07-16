import React, { useEffect, useMemo, useState } from 'react'
import Viewer3Dmol from './Viewer3Dmol.jsx'
import SankeyContacts from './SankeyContacts.jsx'
import InterfacePropertyDistributions from './InterfacePropertyDistributions.jsx'
import ContactHeatmap from './ContactHeatmap.jsx'
import { aggParatope, ParatopeConvergence } from './Paratope.jsx'
import { Pager } from './Pager.jsx'
import SortIcon from './SortIcon.jsx'
import Hint from './Hint.jsx'

const COMPLEX_ID = 'PDB-CPX-140202'
const INST_PAGE_SIZE = 25
const ANTIGEN = { name: 'SARS-CoV-2 spike glycoprotein', gene: 'S', acc: 'P0DTC2', organism: 'SARS-CoV-2',
  func: 'Class I viral fusion glycoprotein: the S1 subunit binds the host ACE2 receptor and the S2 subunit '
    + 'drives viral–host membrane fusion, mediating SARS-CoV-2 cell entry — the principal target of neutralising antibodies.' }
const ANTIBODY_FUNC = 'Adaptive immune recognition — the paired heavy/light variable domains (Fv) form the '
  + 'paratope, whose CDR loops bind the antigen epitope.'
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
const shortMethod = (m) => (m || '').replace('X-ray diffraction', 'X-ray').replace('Electron microscopy', 'EM').replace('cryo-EM', 'EM')

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

const CompChip = ({ color, gene, acc }) => (
  <span className="comp-chip" style={{ '--cc': color, '--chip-bg': color + '22', '--chip-bd': color + '66' }}>
    <span className="comp-dot" /><span className="comp-gene">{gene}</span>
    {acc && <span className="comp-acc">{acc}</span>}
  </span>
)

// Biological-function line with a "more" toggle, matching the protein–protein UniProt cards.
function UniFunc({ text, limit = 90 }) {
  const [open, setOpen] = useState(false)
  if (!text) return null
  if (text.length <= limit) return <div className="uni-func">{text}</div>
  let cut = text.slice(0, limit)
  const sp = cut.lastIndexOf(' ')
  if (sp > limit * 0.5) cut = cut.slice(0, sp)
  return (
    <div className="uni-func">{open ? `${text} ` : `${cut}… `}
      <button className="uni-more" onClick={() => setOpen(!open)}>{open ? 'less' : 'more'}</button></div>
  )
}

function SelectorCard({ abLabel, count, medBsa, active, onClick }) {
  return (
    <div className={'selcard' + (active ? ' active' : '')} onClick={onClick} style={{ '--acc': AB_COLOR, cursor: 'pointer' }}>
      <div className="hemo-chips">
        <CompChip color={AG_COLOR} gene={ANTIGEN.gene} acc={ANTIGEN.acc} />
        <span className="chip-x">↔</span>
        <CompChip color={AB_COLOR} gene={abLabel} />
      </div>
      <div className="selcard-stats">
        <div><div className="v">{count}</div><div className="k">deposited interface{count === 1 ? '' : 's'}</div></div>
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
  const [epiSel, setEpiSel] = useState(null)  // antigen residue clicked in the heatmap -> filters the pair table
  useEffect(() => { setEpiSel(null) }, [chainType])
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

  // Section 2 — paratope convergence: antibody IMGT positions ranked by how often they contact the
  // antigen, aggregated across ALL interfaces of the selected chain side. When an epitope residue is
  // selected in the heatmap, re-aggregate over only the contacts to that residue.
  const epiRows = useMemo(() => epiSel != null
    ? residue.filter((r) => r.antigen_uniprot_position === epiSel) : residue, [residue, epiSel])
  const abImgt = useMemo(() => aggParatope(epiRows, sabdab, 'all'), [epiRows, sabdab])
  const epiLabel = useMemo(() => {
    if (epiSel == null) return null
    const r = residue.find((x) => x.antigen_uniprot_position === epiSel)
    return r ? `${r.antigen_residue_name}${epiSel}` : `residue ${epiSel}`
  }, [residue, epiSel])

  const nAntibodies = new Set(Object.values(sabdab).map((v) => v.sabdab_id)).size
  const sideName = chainType === 'heavy' ? 'heavy chain' : 'light chain'

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
          <UniFunc text={ANTIGEN.func} />
        </div>
        <div className="uni-card">
          <div className="uni-head">
            <span className="chip"><span className="dot" style={{ background: AB_COLOR }} />Antibody</span>
          </div>
          <div className="uni-name">Antibodies (Fab / Fv){nAntibodies ? ` · ${nAntibodies} unique` : ''}</div>
          <div className="uni-meta"><i>Homo sapiens</i> · residues by IMGT numbering (ANARCII), grouped by SAbDab2</div>
          <UniFunc text={ANTIBODY_FUNC} />
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
            <SelectorCard abLabel="Antibody VH" count={stats.heavy.count} medBsa={stats.heavy.med}
              active={chainType === 'heavy'} onClick={() => pickChain('heavy')} />
            <SelectorCard abLabel="Antibody VL" count={stats.light.count} medBsa={stats.light.med}
              active={chainType === 'light'} onClick={() => pickChain('light')} />
          </div>
        </div>

        <div className="card ex-cell">
          <h2>3D view of selected interface</h2>
          {selected && <p className="note" style={{ marginTop: 0 }}>
            {selected.pdb_id} assembly {selected.assembly_id}, interface {selected.interface_id}
            {' · '}{ANTIGEN.gene} ↔ {chainType === 'heavy' ? 'VH' : 'VL'}</p>}
          <div className="legend" style={{ marginTop: 0 }}>
            <span className="dot" style={{ background: AG_COLOR }} /> {ANTIGEN.gene}
            <span className="dot" style={{ background: AB_COLOR }} /> {chainType === 'heavy' ? 'VH' : 'VL'}
          </div>
          {selected ? <Viewer3Dmol pdbId={selected.pdb_id} agResidues={iface.ag} abResidues={iface.ab}
                                    highlight={highlight} onClearHighlight={() => setHighlight(null)} height={480} />
            : <p className="note">No interface selected.</p>}
        </div>
      </div>

      <div className="ex-row ex-row2">
        {/* instances table */}
        <div className="card ex-cell">
          <h2>Interface instances <span className="h2-sub">· {ANTIGEN.gene} ↔ {chainType === 'heavy' ? 'VH' : 'VL'}</span></h2>
          <p className="note">This table lists the deposited structure instances of the selected antibody chain side.
            Resolution refers to the deposited structure resolution. Rows are sorted by buried surface area (BSA),
            largest first; click the Method, Resolution or BSA header to re-sort. Filter by PDB ID, method or a
            resolution range. Click a row to update the 3D view and plots.</p>
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
                  <th>Ag</th><th>Ab</th><th>Antibody (SAbDab2)<Hint text="SAbDab2 antibody identifier: antibody chains sharing an identical variable-region sequence are grouped under one ID, so re-depositions of the same antibody carry the same identifier. Source: SAbDab (Oxford OPIG)." /></th>
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
                 from={instFrom} to={instFrom + instPaged.length} total={instRows.length} unit="instances" />
        </div>

        {/* Sankey for selected instance */}
        <div className="card ex-cell">
          <h2>Antigen–antibody contacts <span className="h2-sub">· {selected ? `${selected.pdb_id} interface ${selected.interface_id}` : '—'}
            {selected && selected.residue_contacts != null ? ` · ${selected.residue_contacts} residue contacts` : ''}</span></h2>
          <p className="note">For the selected interface: antigen residues (UniProt numbering) on the left, antibody residues
            (IMGT numbering) on the right. Click a residue to highlight it here and in the 3D view; click it again to clear.</p>
          <div className="sankey-scroll">
            <SankeyContacts rows={sankeyRows} onNodeClick={setHighlight} selected={highlight} />
          </div>
        </div>
      </div>

      {/* Section 2 — aggregated across all interfaces of the selected chain side. */}
      <div className="section-band">
        <span className="section-num">2</span>
        <div>
          <h2 className="section-title">Where antibody recognition converges</h2>
          <p className="section-sub">Aggregated across every deposited antibody {sideName} interface: which paratope
            positions recur (left) and which epitope residues each antibody region engages (right). Click an epitope
            residue in the map to see the paratope positions that contact it.</p>
        </div>
      </div>

      <div className="ex-row cm-row">
        <ParatopeConvergence abImgt={abImgt} weight="all" fixedSide={chainType}
          epiFilter={epiLabel} onClearEpiFilter={() => setEpiSel(null)} />
        <ContactHeatmap residue={residue} chainType={chainType} selected={epiSel}
          onSelect={(pos) => setEpiSel((c) => (c === pos ? null : pos))} />
      </div>

      <div className="ex-row">
        <InterfacePropertyDistributions instances={instAll} selected={selected} chainType={chainType} />
      </div>
    </>
  )
}
