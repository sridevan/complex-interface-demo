import React, { useMemo, useState } from 'react'
import MolstarViewer from './MolstarViewer.jsx'
import SankeyContacts from './SankeyContacts.jsx'
import ContactHeatmap from './ContactHeatmap.jsx'
import DataTable from './DataTable.jsx'

const CONTACT_COLS = [
  { key: 'antigen', label: 'Antigen residue' },
  { key: 'antibody_residue', label: 'Antibody residue' },
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
      antibody_residue: abres, region: p.antibody_imgt_region, contacts: 0, asm: new Set(),
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

  // Row 3 shows ONLY the selected chain type's contacts (not heavy + light combined).
  const typeResidue = useMemo(() => residue.filter((r) => r.antibody_chain_type === chainType), [residue, chainType])
  const typeContactTable = useMemo(() => contactTable(typeResidue), [typeResidue])

  return (
    <>
      <div className="ex-row ex-row1">
        {/* Row 1, Col 1 — selector cards */}
        <div className="card ex-cell">
          <h2>Interface selection</h2>
          <p className="note">Select an antibody chain type. Median buried surface area (BSA) and
            instance count span all antigen–antibody interfaces of that chain type.</p>
          <div className="selcards">
            <SelectorCard label="Antigen–heavy chain" color="#e19039"
              count={stats.heavy.count} medBsa={stats.heavy.med}
              active={chainType === 'heavy'} onClick={() => { setChainType('heavy'); setSelKey(null) }} />
            <SelectorCard label="Antigen–light chain" color="#4b7fcc"
              count={stats.light.count} medBsa={stats.light.med}
              active={chainType === 'light'} onClick={() => { setChainType('light'); setSelKey(null) }} />
          </div>
        </div>

        {/* Row 1, Col 2 — Mol* */}
        <div className="card ex-cell">
          <h2>Interface structure{selected ? ` (${selected.pdb_id} interface ${selected.interface_id})` : ''}</h2>
          <div className="legend" style={{ marginTop: 0 }}>
            <span className="dot" style={{ background: '#4b7fcc' }} /> antigen
            <span className="dot" style={{ background: '#e19039' }} /> antibody · structure served from PDBe
          </div>
          {selected ? <MolstarViewer mvsj={selected.mvsj} height={480} />
            : <p className="note">No instance selected.</p>}
        </div>
      </div>

      <div className="ex-row ex-row2">
        {/* Row 2, Col 1 — instances table */}
        <div className="card ex-cell">
          <h2>Interface instances ({chainType} chain)</h2>
          <p className="note">Sorted by buried surface area (BSA) descending. <b>BSA</b> = PISA interface
            area, i.e. the surface area buried on complex formation (per side) — not solvent-accessible
            area (ASA).</p>
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
                      onClick={() => setSelKey(keyOf(r))}>
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
          <h2>Paratope–epitope contacts{selected ? ` (${selected.pdb_id} interface ${selected.interface_id})` : ''}</h2>
          <p className="note">Epitope (antigen) residues on the left, paratope (antibody) residues on the
            right, for the selected interface. Ribbon width is proportional to the number of interatomic
            bonds.</p>
          <SankeyContacts rows={sankeyRows} />
        </div>
      </div>

      {/* Row 3 — contact table + contact map, BOTH scoped to the selected heavy/light group */}
      <div className="ex-row ex-row3">
        <div className="card ex-cell">
          <h2>Aggregated contact table (all {chainType} chain instances)</h2>
          <p className="note">One row per epitope residue–paratope residue (IMGT) contact, aggregated
            over <b>all {chainType}-chain interface instances</b> across every processed structure (not
            the single instance selected above). Antibody residue = residue name and IMGT position;
            region = IMGT region (CDR-H1/2/3, Framework-H, …). Sorted by number of contacts.</p>
          <div className="ex-scroll">
            <DataTable columns={CONTACT_COLS} rows={typeContactTable} initialSort="contacts" />
          </div>
        </div>
        <ContactHeatmap residue={typeResidue} chainType={chainType} />
      </div>
    </>
  )
}
