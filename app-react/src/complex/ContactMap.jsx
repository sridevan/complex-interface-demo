import React, { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { orderedBondLabels } from '../components/bondTypes.js'

const ROWHEAD_W = 50   // px reserved for row residue labels (matches .cm-rowhead width)
const COLHEAD_H = 54   // px reserved for rotated column residue labels (matches .cm-colhead height)

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
  const { rows, cols, grid } = useMemo(() => {
    const rowMap = new Map(), colMap = new Map(), grid = new Map()
    for (const p of pairs) {
      rowMap.set(p.pos1, p.res1); colMap.set(p.pos2, p.res2)
      grid.set(`${p.pos1}|${p.pos2}`, p)
    }
    const rows = [...rowMap.entries()].map(([pos, res]) => ({ pos, res })).sort((a, b) => a.pos - b.pos)
    const cols = [...colMap.entries()].map(([pos, res]) => ({ pos, res })).sort((a, b) => a.pos - b.pos)
    return { rows, cols, grid }
  }, [pairs])

  // Fill the available map area: cell size = remaining space / count, clamped to sane bounds.
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el || !rows.length || !cols.length) return
    const fit = () => {
      const w = Math.max(14, Math.min(44, Math.floor((el.clientWidth - ROWHEAD_W) / cols.length)))
      const h = Math.max(12, Math.min(40, Math.floor((el.clientHeight - COLHEAD_H) / rows.length)))
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
    head: `${leftLabel} ${r.res}${r.pos} contacts ${rightLabel} ${c.res}${c.pos}`,
    freq: `${p.freq}/${total}`,
    types: orderedBondLabels(p.bonds).join(', '),
  })
  return (
    <>
      {rightLabel && <div className="cm-axis-x">{rightLabel}</div>}
      <div className="cm-mid">
        {leftLabel && <div className="cm-axis-y"><span>{leftLabel}</span></div>}
        <div className="cm-wrap" ref={wrapRef}>
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
            <div className="cm-tip-head">{tip.head}</div>
            <div><span className="cm-tip-sub">Frequency:</span> {tip.freq}</div>
            <div><span className="cm-tip-sub">Contact type(s):</span> {tip.types}</div>
          </div>
        )
      })()}
    </>
  )
}
