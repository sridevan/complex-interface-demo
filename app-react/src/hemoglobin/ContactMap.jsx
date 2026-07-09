import React, { useMemo, useState } from 'react'

const BOND_SHORT = {
  hydrogen_bond: 'H-bond', salt_bridge: 'salt bridge', disulfide_bond: 'disulfide',
  covalent_bond: 'covalent', other_bond: 'other',
}

// Single-hue sequential ramp (white -> deep purple), sqrt-boosted for low counts; text flips to
// white on dark cells. Mirrors the spike ContactHeatmap ramp. t in [0,1].
function cellColor(t) {
  if (t <= 0) return { bg: '#ffffff', fg: '#2a2f36' }
  const k = Math.sqrt(Math.min(1, t))
  const lerp = (a, b) => Math.round(a + (b - a) * k)
  const r = lerp(244, 63), g = lerp(240, 0), b = lerp(250, 125)
  const lum = 0.299 * r + 0.587 * g + 0.114 * b
  return { bg: `rgb(${r},${g},${b})`, fg: lum < 150 ? '#ffffff' : '#2a2f36' }
}

// Residue × residue contact map: chain-1 contacting residues on rows, chain-2 on columns, each
// cell shaded by the number of the group's instances that contain that residue–residue contact.
export default function ContactMap({ pairs, total, leftLabel, rightLabel, selected, onSelect }) {
  const [hover, setHover] = useState(null)
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

  if (!pairs.length) return <p className="note">No contacts for this interface group.</p>
  const denom = total || Math.max(1, ...pairs.map((p) => p.freq))
  return (
    <>
      {rightLabel && <div className="cm-axis-x">{rightLabel}</div>}
      <div className="cm-mid">
        {leftLabel && <div className="cm-axis-y"><span>{leftLabel}</span></div>}
        <div className="cm-wrap">
        <table className="cm-table">
          <thead>
            <tr>
              <th className="cm-corner" />
              {cols.map((c) => <th key={c.pos} className="cm-colhead"><span>{c.res}{c.pos}</span></th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.pos}>
                <td className="cm-rowhead">{r.res}{r.pos}</td>
                {cols.map((c) => {
                  const key = `${r.pos}|${c.pos}`
                  const p = grid.get(key)
                  const v = p ? p.freq : 0
                  const col = cellColor(v / denom)
                  return (
                    <td key={c.pos} className={'cm-cell' + (selected === key ? ' cm-sel' : '')}
                        style={{ background: col.bg, color: col.fg, cursor: p ? 'pointer' : 'default' }}
                        onMouseEnter={() => setHover(p
                          ? `${r.res}${r.pos} × ${c.res}${c.pos}: ${v}/${total} instances · ${p.bonds.map((b) => BOND_SHORT[b] || b).join(', ')}`
                          : null)}
                        onMouseLeave={() => setHover(null)}
                        onClick={() => p && onSelect && onSelect(p)}>
                      {v > 0 ? v : ''}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
      <div className="cm-foot">
        <span className="cm-legend-ramp" /> <span className="note" style={{ margin: 0 }}>0 → {denom} instances</span>
        {hover && <span className="cm-hover">{hover}</span>}
      </div>
    </>
  )
}
