import React, { useEffect, useMemo, useRef, useState } from 'react'

// Lives with the heatmap it describes, but is rendered by the parent next to the card heading.
export const HEATMAP_HELP = 'Every instance is compared with every other; each cell is one '
  + 'pairwise comparison, and the diagonal is an instance against itself. Rows and columns are '
  + 'ordered by seriation, minimising the path length through the matrix under a tree penalty, so '
  + 'the most alike instances sit next to one another. Click a diagonal cell to display a single '
  + 'structure, or a cell below the diagonal to superpose a pair. Click again to remove.'

// Viridis, matching the notebook's Section 13 heatmap. Perceptually uniform and colourblind-safe,
// so magnitude reads monotonically: dark purple = similar shape, yellow = most different.
// Ten evenly spaced matplotlib control points, linearly interpolated in sRGB.
const VIRIDIS = ['#440154', '#482878', '#3e4a89', '#31688e', '#26828e',
                 '#1f9e89', '#35b779', '#6dcd59', '#b4de2c', '#fde725']
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const STOPS = VIRIDIS.map(hex)

function viridis(t) {
  const x = Math.max(0, Math.min(1, t)) * (STOPS.length - 1)
  const i = Math.min(STOPS.length - 2, Math.floor(x))
  const f = x - i
  const [r, g, b] = STOPS[i].map((c, k) => Math.round(c + (STOPS[i + 1][k] - c) * f))
  return `rgb(${r},${g},${b})`
}

const LEGEND_STOPS = Array.from({ length: 24 }, (_, i) => i / 23)

// order    : assembly ids in seriation order (rows and columns share it)
// labels   : assembly ids in matrix order
// matrix   : symmetric dissimilarity matrix indexed by `labels`
// metaOf   : { assembly_id -> { structure_title, exp_method, resolution } } for the diagonal hover
// colorOf  : { assembly_id -> slot colour } for whatever is currently displayed
// onPick   : (a, b) => void — b is null for a diagonal cell (single structure)
export default function DissimilarityHeatmap({ order, labels, matrix, metaOf, colorOf, onPick }) {
  const [hover, setHover] = useState(null)
  // Keyboard navigation: the matrix is a grid with ONE tab stop (roving tabindex), not 400 of them.
  // Arrows move between interactive cells, Enter/Space activates. `cur` is the roving position.
  const [cur, setCur] = useState({ i: 0, j: 0 })
  const cellRefs = useRef(new Map())
  const movedRef = useRef(false)

  const idx = useMemo(() => Object.fromEntries(labels.map((l, i) => [l, i])), [labels])
  // Colour is scaled to the observed range, as Plotly does when zmin/zmax are left to the data.
  const max = useMemo(() => Math.max(...matrix.flat()), [matrix])
  const value = (a, b) => matrix[idx[a]][idx[b]]
  const n = order.length

  // Only move focus when the user actually navigated — never steal it on first render.
  useEffect(() => {
    if (!movedRef.current) return
    cellRefs.current.get(`${cur.i},${cur.j}`)?.focus()
  }, [cur])

  // Interactive region is the lower triangle including the diagonal, so clamp j <= i.
  const moveTo = (i, j) => {
    const ni = Math.max(0, Math.min(n - 1, i))
    const nj = Math.max(0, Math.min(ni, j))
    movedRef.current = true
    setCur({ i: ni, j: nj })
  }
  const onKeyDown = (e, i, j, r, c, isDiag) => {
    const k = e.key
    if (k === 'Enter' || k === ' ') { e.preventDefault(); onPick(r, isDiag ? null : c); return }
    const step = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[k]
    if (step) { e.preventDefault(); moveTo(i + step[0], j + step[1]); return }
    if (k === 'Home') { e.preventDefault(); moveTo(i, 0) }
    else if (k === 'End') { e.preventDefault(); moveTo(i, i) }
  }

  return (
    <div className="cs-hm">
      <div className="cs-hm-scroll">
        <table className="cs-hm-table" role="grid"
               aria-label="Pairwise shape dissimilarity between assembly instances">
          <thead>
            <tr>
              <th className="cs-hm-corner" />
              {order.map((c) => (
                <th key={c} className="cs-hm-colhead">
                  <span style={{ color: colorOf[c] || undefined, fontWeight: colorOf[c] ? 700 : 500 }}>{c}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {order.map((r, i) => (
              <tr key={r}>
                <th className="cs-hm-rowhead">
                  {colorOf[r] && <span className="cs-swatch" style={{ background: colorOf[r] }} />}
                  <span style={{ fontWeight: colorOf[r] ? 700 : 500 }}>{r}</span>
                </th>
                {order.map((c, j) => {
                  const v = value(r, c)
                  const isDiag = i === j
                  const active = isDiag || i > j          // diagonal + below only
                  const style = { background: viridis(max > 0 ? v / max : 0),
                                  cursor: active ? 'pointer' : 'default' }
                  // A structure's own diagonal cell carries its selected state: slot-coloured ring
                  // plus a tick, so selection is not signalled by colour alone.
                  const picked = isDiag && colorOf[r]
                  if (picked) style.boxShadow = `inset 0 0 0 3px ${colorOf[r]}`
                  const shownNow = colorOf[r] && (isDiag || colorOf[c])
                  const label = isDiag
                    ? `${r}, itself${colorOf[r] ? ' — displayed' : ''}`
                    : `${r} versus ${c}, dissimilarity ${v.toFixed(3)}${shownNow ? ' — displayed' : ''}`
                  return (
                    <td key={c} className={'cs-hm-cell' + (active ? ' cs-hm-live' : '')}
                        style={style}
                        ref={active ? (el) => { if (el) cellRefs.current.set(`${i},${j}`, el)
                                                else cellRefs.current.delete(`${i},${j}`) } : undefined}
                        role={active ? 'button' : undefined}
                        aria-label={active ? label : undefined}
                        tabIndex={active ? (cur.i === i && cur.j === j ? 0 : -1) : undefined}
                        onKeyDown={active ? (e) => onKeyDown(e, i, j, r, c, isDiag) : undefined}
                        onFocus={active ? () => setCur({ i, j }) : undefined}
                        onClick={active ? () => onPick(r, isDiag ? null : c) : undefined}
                        onMouseEnter={(e) => setHover({ r, c, v, isDiag, active, x: e.clientX, y: e.clientY })}
                        onMouseMove={(e) => setHover((h) => (h ? { ...h, x: e.clientX, y: e.clientY } : h))}
                        onMouseLeave={() => setHover(null)}>
                      {picked && <span className="cs-hm-check" aria-hidden="true">✓</span>}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="cs-hm-foot">
        <div className="cs-hm-legend">
          <span className="cs-hm-ramp">
            {LEGEND_STOPS.map((s) => (
              <i key={s} style={{ background: viridis(s) }} />
            ))}
          </span>
          <div className="cs-hm-legend-caps">less similar</div>
        </div>
      </div>

      {hover && (() => {
        const s = { top: hover.y + 14 }
        if (hover.x > window.innerWidth * 0.72) s.right = window.innerWidth - hover.x + 14
        else s.left = hover.x + 14
        const m = metaOf[hover.r] || {}
        return (
          <div className="cm-tip" style={s}>
            {hover.isDiag ? (
              <>
                <div className="cm-tip-head">{hover.r}</div>
                {m.structure_title && <div className="cs-tip-title">{m.structure_title}</div>}
                <div>
                  <span className="cm-tip-sub">method</span> {m.exp_method || 'n/a'}
                  {'  '}<span className="cm-tip-sub">resolution</span>{' '}
                  {m.resolution != null ? `${m.resolution} Å` : 'n/a'}
                </div>
                <div className="cs-tip-act">
                  {colorOf[hover.r] ? 'click to remove this structure' : 'click to show this structure'}
                </div>
              </>
            ) : (
              <>
                <div className="cm-tip-head">{hover.r} vs {hover.c}</div>
                <div><span className="cm-tip-sub">dissimilarity</span> {hover.v.toFixed(3)}</div>
                <div className="cs-tip-act">
                  {!hover.active ? 'mirror of the cell below the diagonal'
                    : colorOf[hover.r] && colorOf[hover.c] ? 'click to remove this pair'
                    : 'click to superpose this pair'}
                </div>
              </>
            )}
          </div>
        )
      })()}
    </div>
  )
}
