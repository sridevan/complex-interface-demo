import React, { useMemo, useState } from 'react'

const BOND_SHORT = {
  hydrogen_bond: 'H-bond', salt_bridge: 'salt bridge', disulfide_bond: 'disulfide',
  covalent_bond: 'covalent', other_bond: 'other',
}

// Comparators keyed by sortable column; each falls back to residue number for stable, readable ties.
const CMP = {
  pos1: (a, b) => a.pos1 - b.pos1 || a.pos2 - b.pos2,
  pos2: (a, b) => a.pos2 - b.pos2 || a.pos1 - b.pos1,
  freq: (a, b) => a.freq - b.freq || a.pos1 - b.pos1 || a.pos2 - b.pos2,
}

// Aggregated residue–residue contact pairs for one interface group. Columns are click-to-sort; the
// residue-number columns default ascending, Frequency defaults descending.
export default function ContactPairTable({ pairs, total, leftLabel, rightLabel }) {
  const [sort, setSort] = useState({ key: 'freq', dir: 'desc' })
  const toggle = (key) => setSort((prev) => prev.key === key
    ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
    : { key, dir: key === 'freq' ? 'desc' : 'asc' })

  const sorted = useMemo(() => {
    const s = sort.dir === 'asc' ? 1 : -1
    return [...pairs].sort((a, b) => s * CMP[sort.key](a, b))
  }, [pairs, sort])

  const Th = ({ label, k, className }) => {
    const active = sort.key === k
    return (
      <th className={(className ? className + ' ' : '') + 'th-sort' + (active ? ' sorted' : '')}
          onClick={() => toggle(k)} title={`Sort by ${typeof label === 'string' ? label : 'this column'}`}>
        {label}<span className="sort-ind">{active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
      </th>
    )
  }

  if (!pairs.length) return <p className="note">No contacts for this interface group.</p>
  return (
    <div className="table-scroll cm-scroll">
      <table>
        <thead>
          <tr>
            <Th label={leftLabel} k="pos1" />
            <Th label={rightLabel} k="pos2" />
            <th>Contact type(s)</th>
            <Th label="Frequency" k="freq" className="num" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => {
            const key = `${p.pos1}|${p.pos2}`
            const pct = total ? p.freq / total : 0
            return (
              <tr key={key}>
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
