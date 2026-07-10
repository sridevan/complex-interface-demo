import React, { useLayoutEffect, useMemo, useRef, useState } from 'react'

const BOND_SHORT = {
  hydrogen_bond: 'H-bond', salt_bridge: 'salt bridge', disulfide_bond: 'disulfide',
  covalent_bond: 'covalent', other_bond: 'other',
}
const ROWHEAD_W = 50   // px reserved for row residue labels (matches .cm-rowhead width)
const COLHEAD_H = 54   // px reserved for rotated column residue labels (matches .cm-colhead height)

// Single-hue sequential scale (white -> dark blue): white = not observed, darker = more frequently
// observed across the deposited instances. A floor keeps even a single-instance contact a visible
// pale blue (distinct from empty white). t in [0,1].
function cellColor(t) {
  if (t <= 0) return '#ffffff'
  const k = 0.18 + 0.82 * Math.min(1, t)
  const lerp = (a, b) => Math.round(a + (b - a) * k)
  return `rgb(${lerp(222, 8)},${lerp(235, 48)},${lerp(247, 107)})`  // #deebf7 -> #08306b
}

// Residue x residue contact-frequency map: chain-1 contacting residues on rows, chain-2 on columns,
// each cell shaded by the fraction of the group's instances that contain that residue-residue contact.
// Cells are sized to fill the card's map area (rectangular; adapts to each interface's row/col count).
export default function ContactMap({ pairs, total, leftLabel, rightLabel, selected, onSelect }) {
  const wrapRef = useRef(null)
  const [cell, setCell] = useState({ w: 18, h: 16 })
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
                    const title = p
                      ? `${leftLabel} ${r.res}${r.pos} contacts ${rightLabel} ${c.res}${c.pos}`
                        + `\nFrequency: ${p.freq}/${total}`
                        + `\nContact type(s): ${p.bonds.map((b) => BOND_SHORT[b] || b).join(', ')}`
                      : undefined
                    return (
                      <td key={c.pos} className={'cm-cell' + (selected === key ? ' cm-sel' : '')}
                          style={{ width: cell.w, height: cell.h,
                                   background: cellColor((p ? p.freq : 0) / denom), cursor: p ? 'pointer' : 'default' }}
                          title={title} onClick={() => p && onSelect && onSelect(p)} />
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="cm-foot">
        <span className="cm-legend-ramp" />
        <span className="note" style={{ margin: 0 }}>
          {total ? `1/${total} → ${total}/${total} instances` : 'Less frequent contacts → more frequent contacts'}</span>
      </div>
    </>
  )
}
