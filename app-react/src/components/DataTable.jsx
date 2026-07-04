import React, { useMemo, useState } from 'react'

// Generic sortable table. `columns` = [{ key, label, num?, render?, sortValue? }].
// `sortValue(row)` overrides the value used for sorting (e.g. sort a residue label by its
// numeric sequence position instead of its displayed string).
export default function DataTable({ columns, rows, initialSort, initialDir = 'desc' }) {
  const [sortKey, setSortKey] = useState(initialSort || columns[0].key)
  const [dir, setDir] = useState(initialDir)

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sortKey)
    const get = col && col.sortValue ? col.sortValue : (row) => row[sortKey]
    const copy = [...rows]
    copy.sort((a, b) => {
      const av = get(a), bv = get(b)
      if (av === bv) return 0
      if (av === null || av === undefined) return 1
      if (bv === null || bv === undefined) return -1
      // Natural sort: numeric-aware so residue ids like LYS40/LYS386 order by their
      // embedded number, not lexicographically (LYS386 before LYS40).
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv : String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' })
      return dir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [rows, sortKey, dir, columns])

  const onSort = (k) => {
    if (k === sortKey) setDir(dir === 'asc' ? 'desc' : 'asc')
    else { setSortKey(k); setDir('desc') }
  }

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={(c.num ? 'num ' : '') + 'sortable'}
                  onClick={() => onSort(c.key)} title="Click to sort">
                {c.label}
                <span className={'sort-ind' + (sortKey === c.key ? ' active' : '')}>
                  {sortKey === c.key ? (dir === 'asc' ? '▲' : '▼') : '↕'}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={i}>
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
  )
}
