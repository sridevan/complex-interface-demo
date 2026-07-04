import React, { useMemo, useState } from 'react'
import Viewer3Dmol from './Viewer3Dmol.jsx'
import SankeyContacts from './SankeyContacts.jsx'
import ContactHeatmap from './ContactHeatmap.jsx'
import DataTable from './DataTable.jsx'
import InfoTip from './InfoTip.jsx'

// Residue columns sort by sequence position (antigen UniProt, antibody IMGT + insertion code),
// which is how epitope/paratope residues are read — not alphabetically by the displayed label.
const CONTACT_COLS = [
  { key: 'antigen', label: 'Antigen residue', sortValue: (r) => r.antigen_uniprot_position ?? Infinity },
  { key: 'antibody_residue', label: 'Antibody residue',
    sortValue: (r) => (r.ab_pos ?? 9999) + (r.ab_ins ? (r.ab_ins.charCodeAt(0) - 64) / 100 : 0) },
  { key: 'region', label: 'Antibody region' },
  { key: 'contacts', label: 'Contacts', num: true },
  { key: 'assemblies', label: 'Assemblies', num: true },
]

// Aggregate ONE chain type's contacts per (antigen residue, antibody IMGT residue). Antibody residue
// is identified by residue name + IMGT position (its conserved cross-structure identity); region is
// the IMGT region (CDR-H1/2/3, Framework-H, ...), constant for a given IMGT position.
function contactTable(rows) {
  const m = new Map()
  for (const p of rows) {
    if (p.antigen_uniprot_position == null) continue
    const abres = p.antibody_imgt_position != null
      ? `${p.antibody_residue_name}${p.antibody_imgt_position}${p.antibody_imgt_insertion_code || ''}`
      : `${p.antibody_residue_name}${p.antibody_residue_author_number}*`  // * = IMGT-unmapped
    const k = `${p.antigen_uniprot_position}|${p.antigen_residue_name}|${abres}`
    if (!m.has(k)) m.set(k, {
      antigen: `${p.antigen_residue_name}${p.antigen_uniprot_position}`,
      antigen_uniprot_position: p.antigen_uniprot_position,
      antibody_residue: abres, region: p.antibody_imgt_region,
      ab_pos: p.antibody_imgt_position, ab_ins: p.antibody_imgt_insertion_code || '',
      contacts: 0, asm: new Set(),
    })
    const e = m.get(k)
    e.contacts += 1
    e.asm.add(`${p.pdb_id}|${p.assembly_id}`)
  }
  return [...m.values()].map((e) => ({ ...e, assemblies: e.asm.size }))
}

const median = (arr) => {
  if (!arr.length) return null
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const keyOf = (r) => `${r.pdb_id}|${r.assembly_id}|${r.interface_id}`

const AA3TO1 = {
  ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C', GLU: 'E', GLN: 'Q', GLY: 'G', HIS: 'H',
  ILE: 'I', LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F', PRO: 'P', SER: 'S', THR: 'T', TRP: 'W',
  TYR: 'Y', VAL: 'V', MSE: 'M', SEC: 'U', PYL: 'O',
}
const one = (resn) => AA3TO1[resn] || 'X'

function SelectorCard({ label, color, count, medBsa, active, onClick }) {
  return (
    <div className={'selcard' + (active ? ' active' : '')} onClick={onClick}
         style={{ '--acc': color }}>
      <div className="selcard-title"><span className="dot" style={{ background: color }} />{label}</div>
      <div className="selcard-stats">
        <div><div className="v">{count}</div><div className="k">instances</div></div>
        <div><div className="v">{medBsa != null ? Math.round(medBsa) : '—'}</div><div className="k">median BSA (Å²)</div></div>
      </div>
    </div>
  )
}

export default function Explorer({ interfaces, residue, epitope }) {
  const [chainType, setChainType] = useState('heavy')
  const [selKey, setSelKey] = useState(null)
  const [highlight, setHighlight] = useState(null)  // residue clicked in the Sankey -> highlight in 3D
  const [epiFilter, setEpiFilter] = useState(null)  // antigen UniProt pos clicked in heatmap -> filter contact table
  const selectInstance = (k) => { setSelKey(k); setHighlight(null) }
  const pickChain = (t) => { setChainType(t); setSelKey(null); setHighlight(null); setEpiFilter(null) }
  const toggleEpi = (pos) => setEpiFilter((p) => (p === pos ? null : pos))

  const byType = useMemo(() => {
    const bySide = (t) => interfaces.filter((i) => i.antibody_chain_type === t)
      .sort((a, b) => (b.interface_area || 0) - (a.interface_area || 0))  // largest BSA first
    return { heavy: bySide('heavy'), light: bySide('light') }
  }, [interfaces])

  const stats = useMemo(() => ({
    heavy: { count: byType.heavy.length, med: median(byType.heavy.map((i) => i.interface_area).filter((x) => x != null)) },
    light: { count: byType.light.length, med: median(byType.light.map((i) => i.interface_area).filter((x) => x != null)) },
  }), [byType])

  const instances = byType[chainType]
  const selected = instances.find((i) => keyOf(i) === selKey) || instances[0]

  const sankeyRows = useMemo(() => {
    if (!selected) return []
    return residue.filter((r) => r.pdb_id === selected.pdb_id
      && r.assembly_id === selected.assembly_id && r.interface_id === selected.interface_id)
  }, [selected, residue])

  // Interface residues for the 3D viewer (author chain + author residue number + a hover label
  // showing the normalised numbering — UniProt for antigen, IMGT + region for antibody).
  const iface = useMemo(() => {
    const ag = new Map(), ab = new Map()
    for (const r of sankeyRows) {
      // Consistent label: <chain>:<resname><resnum> (numbering scheme). Antigen -> UniProt, antibody -> IMGT.
      const agNum = r.antigen_uniprot_position ?? r.antigen_residue_author_number
      ag.set(`${r.antigen_chain_id}|${r.antigen_residue_author_number}`, {
        chain: r.antigen_chain_id, resi: r.antigen_residue_author_number,
        label: `${r.antigen_chain_id}:${r.antigen_residue_name}${agNum} (UNP)`,   // hover (detailed)
        short: `${r.antigen_chain_id}:${one(r.antigen_residue_name)}${agNum}`,     // persistent (compact)
      })
      const abNum = r.antibody_imgt_position != null
        ? `${r.antibody_imgt_position}${r.antibody_imgt_insertion_code || ''}` : r.antibody_residue_author_number
      ab.set(`${r.antibody_chain_id}|${r.antibody_residue_author_number}`, {
        chain: r.antibody_chain_id, resi: r.antibody_residue_author_number,
        label: `${r.antibody_chain_id}:${r.antibody_residue_name}${abNum} (IMGT)`,
        short: `${r.antibody_chain_id}:${one(r.antibody_residue_name)}${abNum}`,
      })
    }
    return { ag: [...ag.values()], ab: [...ab.values()] }
  }, [sankeyRows])

  // Row 3 shows ONLY the selected chain type's contacts (not heavy + light combined).
  const typeResidue = useMemo(() => residue.filter((r) => r.antibody_chain_type === chainType), [residue, chainType])
  const typeContactTable = useMemo(() => contactTable(typeResidue), [typeResidue])
  const shownContactTable = useMemo(() => epiFilter == null ? typeContactTable
    : typeContactTable.filter((r) => r.antigen_uniprot_position === epiFilter), [typeContactTable, epiFilter])
  const epiLabel = epiFilter == null ? null
    : (typeContactTable.find((r) => r.antigen_uniprot_position === epiFilter)?.antigen ?? `residue ${epiFilter}`)

  return (
    <>
      <div className="ex-row ex-row1">
        {/* Row 1, Col 1 — selector cards */}
        <div className="card ex-cell">
          <h2>Interface selection<InfoTip text="Each card's stats span all antigen–antibody interfaces of that chain type across every processed structure. BSA = buried surface area." /></h2>
          <p className="note">Select an antibody chain type to explore.</p>
          <div className="selcards">
            <SelectorCard label="Antigen–heavy chain" color="#e19039"
              count={stats.heavy.count} medBsa={stats.heavy.med}
              active={chainType === 'heavy'} onClick={() => pickChain('heavy')} />
            <SelectorCard label="Antigen–light chain" color="#4b7fcc"
              count={stats.light.count} medBsa={stats.light.med}
              active={chainType === 'light'} onClick={() => pickChain('light')} />
          </div>
        </div>

        {/* Row 1, Col 2 — Mol* */}
        <div className="card ex-cell">
          <h2>Interface 3D visualisation{selected ? ` (${selected.pdb_id} interface ${selected.interface_id})` : ''}</h2>
          <div className="legend" style={{ marginTop: 0 }}>
            <span className="dot" style={{ background: '#4b7fcc' }} /> antigen
            <span className="dot" style={{ background: '#e19039' }} /> antibody · structure served from PDBe
          </div>
          {selected ? <Viewer3Dmol pdbId={selected.pdb_id} agResidues={iface.ag} abResidues={iface.ab}
                                    highlight={highlight} onClearHighlight={() => setHighlight(null)} height={480} />
            : <p className="note">No instance selected.</p>}
        </div>
      </div>

      <div className="ex-row ex-row2">
        {/* Row 2, Col 1 — instances table */}
        <div className="card ex-cell">
          <h2>Interface instances<InfoTip text="BSA (buried surface area) = PISA interface area buried on complex formation, per side — not solvent-accessible area (ASA)." /></h2>
          <p className="note">Sorted by buried surface area (BSA), largest first. Click a row to inspect it above.</p>
          <div className="table-scroll ex-scroll">
            <table>
              <thead>
                <tr><th>PDB</th><th className="num">Asm</th><th className="num">Interface</th>
                  <th>Ag chain</th><th>Ab chain</th><th className="num">BSA (Å²)</th>
                  <th className="num">Residue contacts</th></tr>
              </thead>
              <tbody>
                {instances.map((r) => (
                  <tr key={keyOf(r)} className={'selrow' + (selected && keyOf(r) === keyOf(selected) ? ' sel' : '')}
                      onClick={() => selectInstance(keyOf(r))}>
                    <td>{r.pdb_id}</td><td className="num">{r.assembly_id}</td>
                    <td className="num">{r.interface_id}</td><td>{r.antigen_chain}</td>
                    <td>{r.antibody_chain}</td><td className="num">{Math.round(r.interface_area)}</td>
                    <td className="num">{r.residue_contacts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Row 2, Col 2 — Sankey for selected instance */}
        <div className="card ex-cell">
          <h2>Paratope–epitope contacts{selected ? ` (${selected.pdb_id} interface ${selected.interface_id})` : ''}<InfoTip text="Ribbon width is proportional to the number of interatomic bonds between the two residues. Antigen nodes are coloured by residue class, antibody nodes by IMGT region (see legend)." /></h2>
          <p className="note">Epitope (antigen) on the left, paratope (antibody) on the right, for the
            selected interface. <b>Click a node to highlight it in 3D.</b></p>
          <SankeyContacts rows={sankeyRows} onNodeClick={setHighlight} />
        </div>
      </div>

      {/* Row 3 — contact table + contact map, BOTH scoped to the selected heavy/light group */}
      <div className="ex-row ex-row3">
        <div className="card ex-cell">
          <h2>Aggregated contact table<InfoTip text="Antibody residue = residue name + IMGT position; region = IMGT region (CDR-H1/2/3, Framework-H, …). Aggregated across every processed structure — independent of the single interface selected above." /></h2>
          <p className="note">One row per epitope–paratope residue pair over <b>all {chainType}-chain
            instances</b>. Sorted by contacts.</p>
          {epiFilter != null && (
            <div className="filter-chip">
              Filtered to antigen residue <b>{epiLabel}</b>
              <button onClick={() => setEpiFilter(null)}>clear ✕</button>
            </div>
          )}
          <div className="ex-scroll">
            <DataTable columns={CONTACT_COLS} rows={shownContactTable} initialSort="contacts" />
          </div>
        </div>
        <ContactHeatmap residue={typeResidue} onSelect={toggleEpi} selected={epiFilter} chainType={chainType} />
      </div>
    </>
  )
}
