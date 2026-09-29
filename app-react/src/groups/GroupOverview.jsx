import React, { useEffect, useRef, useState } from 'react'
import { pathBetween } from './clustering'

// Structural-group overview for a complex too large for an instance-level view: the clustering
// tree drawn down to the groups and no further, each group one wedge, with its name and its count
// beside it. It replaces the N x N matrix and the leaf-per-assembly tree, which past about 50
// assemblies are too dense to read a single row of.
//
// What it has to say is how many groups there are, how big each is, how the groups relate, and
// which one is selected. Every row selects its group.
//
// Row height follows group size but is CLAMPED at both ends. Drawn in proportion, a group of one
// beside a group of 174 is under a pixel tall: invisible, and impossible to click. So height only
// says "larger" or "smaller", and the exact size is carried by the count in text and by the bar
// under it, which IS in proportion.

const MIN_ROW = 34          // a group of one: still a full click target with a legible label
const MAX_ROW = 132         // the largest group
const GAP = 6
const MIN_ROWS_TOTAL = 300   // least height the rows take together
const TOP = 40              // room for the scale
const BOTTOM = 22           // room for the cut line's caption
const STUB = 10
const STRIP_W = 14
const INK = '#15191f'
const ABOVE = '#9aa2ad'

const fmt = (v) => (v >= 1 ? v.toFixed(2) : v.toFixed(3))

// compare: the two sides of a representative comparison, as [{ groupId, assembly_id, color }],
// or null. Both groups' rows are marked with their representative in its viewer colour, and the
// route between the two groups through the tree is drawn in ink.
export default function GroupOverview({ clustering, selectedId, onSelectGroup, quantity,
                                        compare = null }) {
  const { root, groups, cutHeight, maxHeight } = clustering
  const boxRef = useRef(null)
  const [W, setW] = useState(540)
  useEffect(() => {
    const el = boxRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const fit = () => { const w = el.getBoundingClientRect().width; if (w > 0) setW(Math.round(w)) }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Groups in the order the tree draws them, which is not the order they are numbered in.
  const rows = [...groups].sort((a, b) => a.from - b.from)
  const largest = Math.max(...groups.map((g) => g.members.length))
  const total = root.leaves.length
  const natural = (g) => MIN_ROW + (MAX_ROW - MIN_ROW) * (largest > 1
    ? (g.members.length - 1) / (largest - 1) : 0)
  // With only two or three groups the rows would fill half the panel and leave the rest blank
  // beside the viewer, so they are stretched, all by the same factor, to a sensible minimum.
  const sum = rows.reduce((t, g) => t + natural(g), 0) + GAP * (rows.length - 1)
  const stretch = Math.max(1, MIN_ROWS_TOTAL / sum)
  let y = TOP
  const at = new Map()
  for (const g of rows) {
    const h = Math.round(natural(g) * stretch)
    at.set(g.id, { y, h, mid: y + h / 2 })
    y += h + GAP
  }
  const bottom = y - GAP
  const height = bottom + BOTTOM

  const xBase = Math.round(W * 0.4)               // where the wedges end and the rows begin
  const xZero = xBase - STUB
  const xRoot = 10
  const x = (h) => (maxHeight > 0 ? xZero - (h / maxHeight) * (xZero - xRoot) : xZero)
  const xStrip = xBase + 6
  const xText = xStrip + STRIP_W + 10
  const barMax = Math.max(40, W - xText - 12)

  const topOf = new Map(groups.map((g) => [g.node.id, g]))
  const sides = (compare || []).map((c) => ({ ...c, group: groups.find((g) => g.id === c.groupId) }))
    .filter((c) => c.group)
  const sideOf = new Map(sides.map((c) => [c.groupId, c]))
  const route = sides.length === 2
    ? pathBetween(root, sides[0].group.node.id, sides[1].group.node.id) : null
  const lines = []
  const routeLines = []
  const wedges = []
  const yOf = (node) => {
    const g = topOf.get(node.id)
    if (g) {
      if (route && route.has(node.id)) {
        const r = at.get(g.id)
        routeLines.push(<line key={`rg${g.id}`} x1={x(node.height)} x2={xBase} y1={r.mid} y2={r.mid} />)
      }
      const r = at.get(g.id)
      const on = g.id === selectedId
      if (node.left) {
        wedges.push(<polygon key={`w${g.id}`} className={'sg-ov-wedge' + (on ? ' on' : '')}
                             points={`${x(node.height)},${r.mid} ${xBase},${r.y + 3} ${xBase},${r.y + r.h - 3}`} />)
      } else {
        // One assembly has no subtree to collapse: its branch simply runs to the row.
        lines.push(<line key={`s${g.id}`} x1={xZero} x2={xBase} y1={r.mid} y2={r.mid}
                         stroke={on ? INK : ABOVE} strokeWidth={on ? 1.8 : 1.2} />)
      }
      return r.mid
    }
    const yl = yOf(node.left), yr = yOf(node.right), xn = x(node.height)
    if (route && route.has(node.id)) {
      const ym = (yl + yr) / 2
      for (const [c, yc] of [[node.left, yl], [node.right, yr]]) {
        if (!route.has(c.id)) continue
        routeLines.push(<line key={`rh${c.id}`} x1={xn} x2={x(c.height)} y1={yc} y2={yc} />)
        routeLines.push(<line key={`rv${c.id}`} x1={xn} x2={xn} y1={yc} y2={ym} />)
      }
    }
    lines.push(<line key={`v${node.id}`} x1={xn} x2={xn} y1={yl} y2={yr} stroke={ABOVE}
                     strokeWidth={1.2} />)
    for (const [c, yc] of [[node.left, yl], [node.right, yr]]) {
      const cg = topOf.get(c.id)
      const on = cg && cg.id === selectedId
      lines.push(<line key={`h${c.id}`} x1={xn} x2={x(c.height)} y1={yc} y2={yc}
                       stroke={on ? INK : ABOVE} strokeWidth={on ? 1.8 : 1.2} />)
    }
    return (yl + yr) / 2
  }
  yOf(root)
  const xCut = cutHeight == null ? null : x(cutHeight)

  return (
    <div className="sg-ov" ref={boxRef}>
      <svg width={W} height={height} role="group"
           aria-label={`${groups.length} structural groups covering ${total} assemblies`}>
        {/* Selected row first, so everything else draws over its tint. */}
        {rows.map((g) => {
          const r = at.get(g.id)
          return g.id === selectedId && (
            <rect key={`bg${g.id}`} className="sg-ov-sel" style={{ '--g': g.color }}
                  x={xBase - 2} y={r.y - 2} width={W - xBase + 1} height={r.h + 4} rx={6} />
          )
        })}
        <g className="sg-dendro-axis">
          <line x1={x(maxHeight)} x2={xZero} y1={TOP - 14} y2={TOP - 14} />
          <line x1={x(maxHeight)} x2={x(maxHeight)} y1={TOP - 17} y2={TOP - 11} />
          <line x1={xZero} x2={xZero} y1={TOP - 17} y2={TOP - 11} />
          <text x={x(maxHeight)} y={TOP - 21} textAnchor="start">{fmt(maxHeight)}</text>
          <text x={xZero} y={TOP - 21} textAnchor="end">0</text>
          <text x={(x(maxHeight) + xZero) / 2} y={TOP - 21} textAnchor="middle">{quantity} at merge</text>
        </g>
        {/* The row compared against, outlined in its own colour where the selected row is filled. */}
        {sides.filter((c) => c.groupId !== selectedId).map((c) => {
          const r = at.get(c.groupId)
          return (
            <rect key={`cmp${c.groupId}`} className="sg-ov-cmp" style={{ '--g': c.group.color }}
                  x={xBase - 2} y={r.y - 2} width={W - xBase + 1} height={r.h + 4} rx={6} />
          )
        })}
        <g className={route ? 'sg-dendro-dim' : undefined}>{wedges}{lines}</g>
        {route && <g className="sg-dendro-route">{routeLines}</g>}
        {xCut != null && (
          <>
            <line className="sg-dendro-cut" x1={xCut} x2={xCut} y1={TOP - 6} y2={bottom + 4} />
            <text className="sg-ov-cut" x={xCut} y={bottom + 17} textAnchor="middle">
              cut at {fmt(cutHeight)}
            </text>
          </>
        )}
        {rows.map((g) => {
          const r = at.get(g.id)
          const on = g.id === selectedId
          const n = g.members.length
          const tall = r.h >= 58
          const ty = tall ? r.mid - 9 : r.mid
          return (
            <g key={g.id} className={'sg-ov-row' + (on ? ' on' : '')} role="button" tabIndex={0}
               aria-pressed={on}
               aria-label={`Select ${g.name}, ${n} ${n === 1 ? 'assembly' : 'assemblies'}`}
               onClick={() => onSelectGroup(g.id)}
               onKeyDown={(e) => {
                 if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectGroup(g.id) }
               }}>
              <title>{`${g.name}: ${n} of ${total} assemblies. Representative ${g.representative}. Click to select.`}</title>
              <rect x={xStrip} y={r.y + 2} width={STRIP_W} height={r.h - 4} rx={3} fill={g.color} />
              <text className="sg-ov-name" x={xText} y={ty} dominantBaseline="central">
                {g.name}
                <tspan className="sg-ov-n" dx={8}>
                  {n} {n === 1 ? 'assembly' : 'assemblies'}
                </tspan>
              </text>
              {/* In proportion, where the row's height is not: the share of all assemblies. */}
              <rect className="sg-ov-track" x={xText} y={tall ? r.mid + 8 : r.y + r.h - 7}
                    width={barMax} height={4} rx={2} />
              <rect x={xText} y={tall ? r.mid + 8 : r.y + r.h - 7}
                    width={Math.max(3, barMax * (n / total))} height={4} rx={2} fill={g.color} />
              {sideOf.has(g.id) && (
                <>
                  <circle className="sg-dendro-mark" cx={xBase} cy={r.mid} r={4.5}
                          fill={sideOf.get(g.id).color} />
                  <rect x={W - 92} y={ty - 5} width={9} height={9} rx={2}
                        fill={sideOf.get(g.id).color} />
                  <text className="sg-ov-rep" x={W - 78} y={ty} dominantBaseline="central">
                    {sideOf.get(g.id).assembly_id}
                  </text>
                </>
              )}
              {/* The whole row is the target, wedge included. */}
              <rect className="sg-ov-hit" x={0} y={r.y - GAP / 2} width={W} height={r.h + GAP} />
            </g>
          )
        })}
      </svg>
    </div>
  )
}
