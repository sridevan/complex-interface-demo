import React, { useMemo, useState } from 'react'
import Viewer3Dmol from './Viewer3Dmol.jsx'
import SankeyContacts from './SankeyContacts.jsx'

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

export default function Explorer({ interfaces, residue }) {
  const [chainType, setChainType] = useState('heavy')
  const [selKey, setSelKey] = useState(null)
  const [highlight, setHighlight] = useState(null)  // residue clicked in the Sankey -> highlight in 3D
  const selectInstance = (k) => { setSelKey(k); setHighlight(null) }
  const pickChain = (t) => { setChainType(t); setSelKey(null); setHighlight(null) }

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

  return (
    <>
      <div className="ex-row ex-row1">
        {/* Row 1, Col 1 — selector cards */}
        <div className="card ex-cell">
          <h2>Interface selection</h2>
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
          <h2>Interface instances</h2>
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
          <h2>Paratope–epitope contacts{selected ? ` (${selected.pdb_id} interface ${selected.interface_id})` : ''}</h2>
          <p className="note">Epitope (antigen) on the left, paratope (antibody) on the right, for the
            selected interface. <b>Click a node to highlight it in 3D.</b></p>
          <SankeyContacts rows={sankeyRows} onNodeClick={setHighlight} />
        </div>
      </div>
    </>
  )
}
