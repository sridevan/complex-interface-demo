import React, { useMemo, useState } from 'react'
import SortIcon from '../components/SortIcon.jsx'
import Hint from '../components/Hint.jsx'
import { Pager, usePager } from '../components/Pager.jsx'
import { bondRank, bondLabel, orderedBondLabels } from '../components/bondTypes.js'

const PAGE_SIZE = 25

// PISA classifies every interface atom–atom contact into one of these types (this dataset only
// contains hydrogen bonds, salt bridges and "other"; disulfide/covalent do not occur here).
const BOND_TYPE_HELP = (
  <>
    Interaction type PISA assigns to each interface atom–atom contact:
    <ul className="hint-list">
      <li><b>hydrogen bond</b> — donor–acceptor hydrogen bond</li>
      <li><b>salt bridge</b> — oppositely charged side chains (Asp/Glu ↔ Lys/Arg/His)</li>
      <li><b>disulfide bond</b> — covalent S–S bond between cysteines</li>
      <li><b>covalent bond</b> — other covalent link bridging the two chains</li>
      <li><b>other bond</b> — a non-bonded van der Waals contact (atoms ≲4 Å) that doesn’t meet the
        criteria above; these dominate most interfaces</li>
    </ul>
    A pair’s types are listed strongest first.
  </>
)

// Comparators keyed by sortable column; each falls back to residue number for stable, readable ties.
const CMP = {
  pos1: (a, b) => a.pos1 - b.pos1 || a.pos2 - b.pos2,
  pos2: (a, b) => a.pos2 - b.pos2 || a.pos1 - b.pos1,
  freq: (a, b) => a.freq - b.freq || a.pos1 - b.pos1 || a.pos2 - b.pos2,
}

// Aggregated residue–residue contact pairs for one interface group. Columns are click-to-sort; the
// residue-number columns default ascending, Frequency defaults descending. An interaction-type filter
// narrows the rows to pairs that make a given bond type.
// extraCol (optional): { label, render(pair) } — an extra display column after the right residue
// column (e.g. the antibody IMGT region in the antibody–antigen view). Generic complexes omit it.
export default function ContactPairTable({ pairs, total, leftLabel, rightLabel, extraCol }) {
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
  // Page the (possibly hundreds of) rows; reset to page 1 when the interface, sort or filter changes.
  const pg = usePager(shown, PAGE_SIZE, [pairs, sort.key, sort.dir, q])

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
              {extraCol && <th>{extraCol.label}</th>}
              <th>Contact type(s) <Hint text={BOND_TYPE_HELP} /></th>
              <Th label="Frequency" k="freq" className="num" />
            </tr>
          </thead>
          <tbody>
            {pg.pageItems.map((p) => {
              const key = `${p.pos1}|${p.pos2}`
              const pct = total ? p.freq / total : 0
              return (
                <tr key={key}>
                  <td>{p.res1}{p.pos1}</td>
                  <td>{p.res2}{p.pos2}</td>
                  {extraCol && <td>{extraCol.render(p)}</td>}
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
      <Pager {...pg} unit="pairs" />
    </>
  )
}
