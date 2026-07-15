import React, { useMemo, useState } from 'react'
import SortIcon from '../components/SortIcon.jsx'
import { bondRank, bondLabel, orderedBondLabels } from '../components/bondTypes.js'

// Comparators keyed by sortable column; each falls back to residue number for stable, readable ties.
const CMP = {
  pos1: (a, b) => a.pos1 - b.pos1 || a.pos2 - b.pos2,
  pos2: (a, b) => a.pos2 - b.pos2 || a.pos1 - b.pos1,
  freq: (a, b) => a.freq - b.freq || a.pos1 - b.pos1 || a.pos2 - b.pos2,
}

// Aggregated residue–residue contact pairs for one interface group. Columns are click-to-sort; the
// residue-number columns default ascending, Frequency defaults descending. An interaction-type filter
// narrows the rows to pairs that make a given bond type.
export default function ContactPairTable({ pairs, total, leftLabel, rightLabel }) {
  const [sort, setSort] = useState({ key: 'freq', dir: 'desc' })
  const [typeFilter, setTypeFilter] = useState('')
  const toggle = (key) => setSort((prev) => prev.key === key
    ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
    : { key, dir: key === 'freq' ? 'desc' : 'asc' })

  const sorted = useMemo(() => {
    const s = sort.dir === 'asc' ? 1 : -1
    return [...pairs].sort((a, b) => s * CMP[sort.key](a, b))
  }, [pairs, sort])

  // Interaction types actually present in this interface, strongest-first, for the filter autocomplete.
  const availableTypes = useMemo(
    () => [...new Set(pairs.flatMap((p) => p.bonds))].sort((a, b) => bondRank(a) - bondRank(b)).map(bondLabel),
    [pairs])

  const q = typeFilter.trim().toLowerCase()
  const shown = q ? sorted.filter((p) => p.bonds.some((b) => bondLabel(b).toLowerCase().includes(q))) : sorted

  const Th = ({ label, k, className }) => {
    const active = sort.key === k
    return (
      <th className={(className ? className + ' ' : '') + 'th-sort' + (active ? ' sorted' : '')}
          onClick={() => toggle(k)} title={`Sort by ${typeof label === 'string' ? label : 'this column'}`}>
        <span className="th-inner">{label}<SortIcon dir={active ? sort.dir : null} /></span>
      </th>
    )
  }

  if (!pairs.length) return <p className="note">No contacts for this interface group.</p>
  return (
    <>
      <div className="cm-filter">
        <input className="filter-input" list="cm-bondtypes" value={typeFilter}
          placeholder="Filter by interaction type (e.g. hydrogen bond)…"
          onChange={(e) => setTypeFilter(e.target.value)} />
        <datalist id="cm-bondtypes">
          {availableTypes.map((t) => <option key={t} value={t} />)}
        </datalist>
        {q && <button className="cm-filter-clear" onClick={() => setTypeFilter('')}>clear</button>}
      </div>
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
            {shown.map((p) => {
              const key = `${p.pos1}|${p.pos2}`
              const pct = total ? p.freq / total : 0
              return (
                <tr key={key}>
                  <td>{p.res1}{p.pos1}</td>
                  <td>{p.res2}{p.pos2}</td>
                  <td>{orderedBondLabels(p.bonds).join(', ')}</td>
                  <td className="num">
                    <span className="freqbar"><span className="freqbar-fill" style={{ width: `${pct * 100}%` }} /></span>
                    <span className="freqbar-txt">{p.freq}/{total}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {q && !shown.length && <p className="note" style={{ padding: '10px 2px 0' }}>No pairs make a “{typeFilter.trim()}” interaction.</p>}
      </div>
    </>
  )
}
