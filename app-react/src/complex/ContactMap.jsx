import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { orderedBondLabels } from '../components/bondTypes.js'

const ROWHEAD_W = 50   // px reserved for row residue labels (matches .cm-rowhead width)
const COLHEAD_H = 54   // px reserved for rotated column residue labels (matches .cm-colhead height)
const MIN_CELL_W = 16  // smallest readable cell width  (matches the fit() clamp below)
const MIN_CELL_H = 14  // smallest readable cell height (matches the fit() clamp below)

const axisSizes = (pairs) => {
  const r = new Set(), c = new Set()
  for (const p of pairs) { r.add(p.pos1); c.add(p.pos2) }
  return { rows: r.size, cols: c.size }
}

// Same single-hue sequential ramp as the spike contact heatmap (white -> deep purple), sqrt-boosted
// for low counts: white = not observed, darker = more frequently observed. t in [0,1].
function cellColor(t) {
  if (t <= 0) return '#ffffff'
  const k = Math.sqrt(Math.min(1, t))
  const lerp = (a, b) => Math.round(a + (b - a) * k)
  return `rgb(${lerp(244, 63)},${lerp(240, 0)},${lerp(250, 125)})`  // #f4f0fa -> #3f007d
}

// Residue x residue contact-frequency map: chain-1 contacting residues on rows, chain-2 on columns,
// each cell shaded by the fraction of the group's instances that contain that residue-residue contact.
// Cells are sized to fill the card's map area (rectangular; adapts to each interface's row/col count).
export default function ContactMap({ pairs, total, leftLabel, rightLabel }) {
  const wrapRef = useRef(null)
  const [cell, setCell] = useState({ w: 18, h: 16 })
  const [tip, setTip] = useState(null)  // hover popup: { x, y, head, freq, types }

  const full = useMemo(() => axisSizes(pairs), [pairs])

  // How many residues fit on each axis at the smallest readable cell size — measured from the actual map
  // viewport (the card, capped by .cm-wrap's max-height), not a fixed number. ResizeObserver keeps it
  // current as the layout changes. Null until first measured.
  const [capacity, setCapacity] = useState(null)
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => {
      const maxCols = Math.max(4, Math.floor((el.clientWidth - ROWHEAD_W) / MIN_CELL_W))
      const maxRows = Math.max(4, Math.floor((el.clientHeight - COLHEAD_H) / MIN_CELL_H))
      setCapacity((c) => (c && c.maxCols === maxCols && c.maxRows === maxRows) ? c : { maxCols, maxRows })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // The control (and any filtering) is only needed when the full grid can't fit the measured viewport.
  const needsControl = !!capacity && (full.rows > capacity.maxRows || full.cols > capacity.maxCols)
  // "detail" scales the residue budget relative to what fits the card: 1 = fill the card exactly,
  // <1 = a tighter core (bigger cells), >1 = show more (scrolls). Reset per interface.
  const [detail, setDetail] = useState(1)
  useEffect(() => { setDetail(1) }, [pairs])

  // Top-N fill: walk contacts most-frequent first, keeping each whose residues still fit the row/col
  // budget. This fills the card with the most-conserved contacts and — unlike a discrete frequency
  // threshold — has no granularity jumps, so the map is always well-filled. The kept residues then
  // define the grid; we render every contact among them (denser, and truthful for what's on screen).
  const fill = useMemo(() => {
    if (!capacity) return null
    const budgetRows = Math.max(4, Math.round(capacity.maxRows * detail))
    const budgetCols = Math.max(4, Math.round(capacity.maxCols * detail))
    const byFreq = [...pairs].sort((a, b) => b.freq - a.freq || a.pos1 - b.pos1 || a.pos2 - b.pos2)
    const rowSet = new Set(), colSet = new Set()
    for (const p of byFreq) {
      const addR = rowSet.has(p.pos1) ? 0 : 1
      const addC = colSet.has(p.pos2) ? 0 : 1
      if (rowSet.size + addR > budgetRows || colSet.size + addC > budgetCols) continue
      rowSet.add(p.pos1); colSet.add(p.pos2)
    }
    return { rowSet, colSet }
  }, [pairs, capacity, detail])

  const shown = useMemo(() => {
    if (!needsControl || !fill) return pairs   // whole interface fits → show everything
    return pairs.filter((p) => fill.rowSet.has(p.pos1) && fill.colSet.has(p.pos2))
  }, [pairs, needsControl, fill])
  const { rows, cols, grid } = useMemo(() => {
    const rowMap = new Map(), colMap = new Map(), grid = new Map()
    for (const p of shown) {
      rowMap.set(p.pos1, p.res1); colMap.set(p.pos2, p.res2)
      grid.set(`${p.pos1}|${p.pos2}`, p)
    }
    const rows = [...rowMap.entries()].map(([pos, res]) => ({ pos, res })).sort((a, b) => a.pos - b.pos)
    const cols = [...colMap.entries()].map(([pos, res]) => ({ pos, res })).sort((a, b) => a.pos - b.pos)
    return { rows, cols, grid }
  }, [shown])

  // Fill the available map area: cell size = remaining space / count, clamped to sane bounds.
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el || !rows.length || !cols.length) return
    const fit = () => {
      const w = Math.max(MIN_CELL_W, Math.min(44, Math.floor((el.clientWidth - ROWHEAD_W) / cols.length)))
      const h = Math.max(MIN_CELL_H, Math.min(40, Math.floor((el.clientHeight - COLHEAD_H) / rows.length)))
      setCell({ w, h })
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [rows.length, cols.length])

  if (!pairs.length) return <p className="note">No contacts for this interface group.</p>
  const denom = total || Math.max(1, ...pairs.map((p) => p.freq))
  const showTip = (e, p, r, c) => setTip({
    x: e.clientX, y: e.clientY,
    res1: `${r.res}${r.pos}`, res2: `${c.res}${c.pos}`,
    freq: `${p.freq}/${total}`,
    types: orderedBondLabels(p.bonds).join(', '),
  })
  return (
    <>
      {needsControl && (
        <div className="cm-controls">
          <label className="cm-minfreq">
            <span>Contacts shown</span>
            <span className="cm-range-end">fewer</span>
            <input type="range" min={0.5} max={3} step={0.25} value={detail}
                   onChange={(e) => setDetail(+e.target.value)} />
            <span className="cm-range-end">more</span>
          </label>
          <span className="cm-controls-note">
            {shown.length} of {pairs.length} contacts · {rows.length}×{cols.length} most-conserved residues
            {shown.length < pairs.length && ' · full list in the table'}
          </span>
        </div>
      )}
      {rightLabel && <div className="cm-axis-x">{rightLabel}</div>}
      <div className="cm-mid">
        {leftLabel && <div className="cm-axis-y"><span>{leftLabel}</span></div>}
        <div className="cm-wrap" ref={wrapRef}>
          {(!shown.length || rows.length < 2 || cols.length < 2) ? (
            // A single row or column isn't a 2-D map — one contact would balloon into a lone stripe.
            // Point to the table, which lists these few contacts cleanly.
            <p className="note" style={{ padding: 12, margin: 0 }}>
              {!pairs.length
                ? 'No contacts for this interface group.'
                : `Too few contacting residues for a map — the ${pairs.length} contact${pairs.length === 1 ? ' is' : 's are'} listed in the table.`}
            </p>
          ) : (
          <table className="cm-table">
            <thead>
              <tr>
                <th className="cm-corner" />
                {cols.map((c) => (
                  <th key={c.pos} className="cm-colhead" style={{ width: cell.w }}><span>{c.res}{c.pos}</span></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.pos}>
                  <td className="cm-rowhead" style={{ height: cell.h }}>{r.res}{r.pos}</td>
                  {cols.map((c) => {
                    const key = `${r.pos}|${c.pos}`
                    const p = grid.get(key)
                    // Absent (no contact ever) reads as a neutral cell, distinct from a purple-tinted
                    // "observed but rare" cell — so "never" and "seldom" are never confused. Hovering a
                    // populated cell shows a styled details popup (no selection).
                    return (
                      <td key={c.pos} className={'cm-cell' + (p ? '' : ' cm-absent')}
                          style={{ width: cell.w, height: cell.h,
                                   ...(p ? { background: cellColor(p.freq / denom) } : null) }}
                          onMouseEnter={p ? (e) => showTip(e, p, r, c) : undefined}
                          onMouseMove={p ? (e) => showTip(e, p, r, c) : undefined}
                          onMouseLeave={p ? () => setTip(null) : undefined} />
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          )}
        </div>
      </div>
      <div className="cm-foot">
        <span className="cm-legend-item"><span className="cm-sw cm-sw-absent" /> not observed</span>
        <span className="cm-legend-item cm-legend-scale">
          observed in <b>1</b>
          <span className="cm-legend-ramp" />
          <b>{total ?? denom}</b> instances
        </span>
      </div>
      {tip && (() => {
        // Position near the cursor; flip to the left when close to the right edge.
        const s = { top: tip.y + 14 }
        if (tip.x > window.innerWidth * 0.72) s.right = window.innerWidth - tip.x + 14
        else s.left = tip.x + 14
        return (
          <div className="cm-tip" style={s}>
            {/* Pair formatted like the Sankey tooltip — residue (component); no chain id (aggregated). */}
            <div className="cm-tip-head">{tip.res1} <span className="cm-tip-sub">({leftLabel})</span> — {tip.res2} <span className="cm-tip-sub">({rightLabel})</span></div>
            <div><span className="cm-tip-sub">Frequency:</span> {tip.freq}</div>
            <div><span className="cm-tip-sub">Contact type(s):</span> {tip.types}</div>
          </div>
        )
      })()}
    </>
  )
}
