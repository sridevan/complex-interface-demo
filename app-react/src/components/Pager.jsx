import React, { useEffect, useState } from 'react'

// Client-side pagination for the interface tables. Datasets stay small for the demo complexes
// (CCT/hemoglobin), but ComplexInterfaceApp is generic — a spike-scale complex can have 100+
// instances and hundreds of contact pairs — so tables page rather than scroll indefinitely.
//
// usePager slices `items` into pages of `pageSize`. Pass `resetDeps` — the values that, when they
// change, mean the list was re-derived (interface switch, filter, sort) — so paging jumps back to
// page 1. resetDeps must have a stable length across renders (it's used as an effect dep array).
export function usePager(items, pageSize, resetDeps = []) {
  const [page, setPage] = useState(0)
  useEffect(() => { setPage(0) }, resetDeps)  // eslint-disable-line react-hooks/exhaustive-deps
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize))
  const clamped = Math.min(page, pageCount - 1)   // stay valid if the list shrank under us
  const from = clamped * pageSize
  const pageItems = items.slice(from, from + pageSize)
  return { pageItems, page: clamped, setPage, pageCount, from, to: from + pageItems.length, total: items.length }
}

// Prev / range / Next control. Renders nothing when everything fits on one page.
export function Pager({ page, pageCount, setPage, from, to, total, unit = 'rows' }) {
  if (pageCount <= 1) return null
  return (
    <div className="pager">
      <button className="pager-btn" disabled={page === 0} onClick={() => setPage(page - 1)}>‹ Prev</button>
      <span className="pager-info">{from + 1}–{to} of {total} {unit} · page {page + 1} / {pageCount}</span>
      <button className="pager-btn" disabled={page >= pageCount - 1} onClick={() => setPage(page + 1)}>Next ›</button>
    </div>
  )
}
