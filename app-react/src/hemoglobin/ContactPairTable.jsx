import React, { useMemo } from 'react'

const BOND_SHORT = {
  hydrogen_bond: 'H-bond', salt_bridge: 'salt bridge', disulfide_bond: 'disulfide',
  covalent_bond: 'covalent', other_bond: 'other',
}


// Aggregated residue–residue contact pairs for one interface group, ranked by how many of the
// group's instances contain the contact.
export default function ContactPairTable({ pairs, total, leftLabel, rightLabel, selected, onSelect }) {
  const sorted = useMemo(() => [...pairs].sort(
    (a, b) => b.freq - a.freq || a.pos1 - b.pos1 || a.pos2 - b.pos2), [pairs])
  if (!pairs.length) return <p className="note">No contacts for this interface group.</p>
  return (
    <div className="table-scroll cm-scroll">
      <table>
        <thead>
          <tr><th>{leftLabel}</th><th>{rightLabel}</th><th>Contact type(s)</th><th className="num">Frequency</th></tr>
        </thead>
        <tbody>
          {sorted.map((p) => {
            const key = `${p.pos1}|${p.pos2}`
            const pct = total ? p.freq / total : 0
            return (
              <tr key={key} className={'selrow' + (selected === key ? ' sel' : '')}
                  onClick={() => onSelect && onSelect(p)} style={{ cursor: 'pointer' }}>
                <td>{p.res1}{p.pos1}</td>
                <td>{p.res2}{p.pos2}</td>
                <td>{p.bonds.map((b) => BOND_SHORT[b] || b).join(', ')}</td>
                <td className="num">
                  <span className="freqbar"><span className="freqbar-fill" style={{ width: `${pct * 100}%` }} /></span>
                  <span className="freqbar-txt">{p.freq}/{total}</span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
