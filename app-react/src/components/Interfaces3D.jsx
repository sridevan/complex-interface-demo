import React, { useState } from 'react'
import DataTable from './DataTable.jsx'
import MolstarViewer from './MolstarViewer.jsx'

export default function Interfaces3D({ interfaces }) {
  const [sel, setSel] = useState(interfaces[0] || null)

  const columns = [
    { key: 'pdb_id', label: 'PDB' },
    { key: 'assembly_id', label: 'Asm', num: true },
    { key: 'interface_id', label: 'Interface', num: true },
    { key: 'antigen_chain', label: 'Antigen' },
    { key: 'antibody_chain', label: 'Antibody' },
    { key: 'antibody_chain_type', label: 'H/L' },
    { key: 'interface_area', label: 'Area (Å²)', num: true, render: (v) => v?.toFixed(0) ?? '—' },
    { key: 'residue_contacts', label: 'Residue contacts', num: true },
    { key: 'hbonds', label: 'H-bonds', num: true },
  ]

  return (
    <div className="card">
      <h2>Antibody–antigen interfaces</h2>
      <p className="note">Click a row to load it in the 3D viewer.</p>
      <div className="table-scroll" style={{ maxHeight: 260, overflowY: 'auto', marginBottom: 12 }}>
        <table>
          <thead>
            <tr>{columns.map((c) => <th key={c.key} className={c.num ? 'num' : ''}>{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {interfaces.map((r, i) => (
              <tr key={i}
                  className={'selrow' + (sel && sel.mvsj === r.mvsj ? ' sel' : '')}
                  onClick={() => setSel(r)}>
                {columns.map((c) => (
                  <td key={c.key} className={c.num ? 'num' : ''}>
                    {c.render ? c.render(r[c.key], r) : (r[c.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sel
        ? <MolstarViewer mvsj={sel.mvsj} />
        : <p className="note">No interface scenes available.</p>}
    </div>
  )
}
