import React from 'react'
import { pathBetween } from './clustering'

// The clustering tree, drawn in the heatmap's left gutter with one leaf per matrix row. Root on the
// left, leaves on the right, so a leaf ends exactly at the row it belongs to and a structural group
// is visibly a branch: everything hanging below the dashed cut line from one point.
//
// Branch length is the merge height, in 1 - TM-score, on a linear scale. Leaves
// get a short fixed stub past zero, because TM-score is quantised and many merges happen at exactly
// 0: without the stub those leaves would have no line at all.
//
// The tree itself is neutral: grey branches, with the selected group's branch in ink. Group
// colour is confined to the strip between the leaves and the row labels, which is where a reader
// looks to see which rows a group covers, and it keeps a categorical colour from being read as
// part of the matrix beside it.

const STUB = 8          // leaf stub past height 0, px
const BAR_W = 16        // clickable group bar, right-hand edge of the gutter
const BAR_GAP = 5
const PAD_L = 6
const INK = '#15191f'
const QUIET = '#9aa2ad'
const ABOVE = '#c9ced6'

const fmt = (v) => (v >= 1 ? v.toFixed(2) : v.toFixed(3))

// compare: the two structures of a representative comparison, as [{ assembly_id, color }], or
// null. Their leaves are marked in the colours they have in the viewer, and the route between
// them through the tree is drawn in ink, so the comparison can be read off the tree: the further
// left the route reaches, the more dissimilar the merge that joins the two.
export default function Dendrogram({ clustering, selectedId, onSelectGroup, cell, top, width,
                                     labels = null, compare = null }) {
  const { root, groups, cutHeight, maxHeight } = clustering
  const n = root.leaves.length
  const height = top + n * cell
  const xLeaf = width - BAR_W - BAR_GAP
  const xZero = xLeaf - STUB
  const x = (h) => (maxHeight > 0 ? xZero - (h / maxHeight) * (xZero - PAD_L) : xZero)
  const pos = new Map(root.leaves.map((leaf, p) => [leaf, p]))
  const yLeaf = (leaf) => top + (pos.get(leaf) + 0.5) * cell

  // Which group a node sits inside, if any. Nodes above the cut belong to none.
  const nodeGroup = new Map()
  const mark = (node, g) => {
    nodeGroup.set(node.id, g)
    if (node.left) { mark(node.left, g); mark(node.right, g) }
  }
  for (const g of groups) mark(g.node, g.id)

  // Leaves of the compared structures that are in this tree. In a group's own tree the other
  // group's representative is not, and then only one leaf is marked and no route is drawn.
  const marked = (compare && labels ? compare : [])
    .map((c) => ({ ...c, leaf: labels.indexOf(c.assembly_id) }))
    .filter((c) => pos.has(c.leaf))
  const route = marked.length === 2 ? pathBetween(root, marked[0].leaf, marked[1].leaf) : null

  const lines = []
  const routeLines = []
  const yOf = (node) => {
    if (!node.left) return yLeaf(node.leaves[0])
    const yl = yOf(node.left), yr = yOf(node.right)
    if (route && route.has(node.id)) {
      const xr = x(node.height), ym = (yl + yr) / 2
      for (const [c, yc] of [[node.left, yl], [node.right, yr]]) {
        if (!route.has(c.id)) continue
        routeLines.push(<line key={`rh${c.id}`} x1={xr} x2={c.left ? x(c.height) : xLeaf}
                              y1={yc} y2={yc} />)
        routeLines.push(<line key={`rv${c.id}`} x1={xr} x2={xr} y1={yc} y2={ym} />)
      }
    }
    const g = nodeGroup.get(node.id)
    const xn = x(node.height)
    const stroke = (gid) => (gid == null ? ABOVE : gid === selectedId ? INK : QUIET)
    // Hairlines once leaves are a few pixels apart, or a tree of 170 leaves fills in solid.
    const thin = cell < 4
    const w = (gid) => (thin ? 0.6 : gid != null && gid === selectedId ? 1.9 : 1.2)
    lines.push(<line key={`v${node.id}`} x1={xn} x2={xn} y1={yl} y2={yr}
                     stroke={stroke(g)} strokeWidth={w(g)} />)
    for (const [child, yc] of [[node.left, yl], [node.right, yr]]) {
      // A branch takes the style of the group it leads INTO, so the line dropping from the cut to
      // a group's top node is already drawn as part of that group.
      const gc = nodeGroup.get(child.id)
      lines.push(<line key={`h${child.id}`} x1={xn} x2={child.left ? x(child.height) : xLeaf}
                       y1={yc} y2={yc} stroke={stroke(gc)} strokeWidth={w(gc)} />)
    }
    return (yl + yr) / 2
  }
  yOf(root)

  const xCut = cutHeight == null ? null : x(cutHeight)
  return (
    <svg className="sg-dendro" width={width} height={height} role="img"
         aria-label={`Dendrogram of ${n} assemblies in ${groups.length} structural `
           + `group${groups.length === 1 ? '' : 's'}`}>
      {/* Scale, in the band the column labels occupy. Only the two ends: the tree is read for its
          shape, and exact merge heights are in the notebook. */}
      {top > 0 && (
        <g className="sg-dendro-axis">
          <line x1={x(maxHeight)} x2={xZero} y1={top - 8} y2={top - 8} />
          <line x1={x(maxHeight)} x2={x(maxHeight)} y1={top - 11} y2={top - 5} />
          <line x1={xZero} x2={xZero} y1={top - 11} y2={top - 5} />
          <text x={x(maxHeight)} y={top - 15} textAnchor="start">{fmt(maxHeight)}</text>
          <text x={xZero} y={top - 15} textAnchor="end">0</text>
        </g>
      )}
      <g className={route ? 'sg-dendro-dim' : undefined}>{lines}</g>
      {route && <g className="sg-dendro-route">{routeLines}</g>}
      {marked.map((c) => (
        <circle key={c.assembly_id} className="sg-dendro-mark" cx={xLeaf} cy={yLeaf(c.leaf)} r={4.5}
                fill={c.color}>
          <title>{`${c.assembly_id}, representative`}</title>
        </circle>
      ))}
      {xCut != null && (
        <line className="sg-dendro-cut" x1={xCut} x2={xCut} y1={Math.max(0, top - 2)} y2={height}>
          <title>{`Cut at ${fmt(cutHeight)}, giving ${groups.length} structural groups`}</title>
        </line>
      )}
      {groups.map((g) => {
        // Inset from its neighbours where there is room. A group of one in a matrix of hundreds
        // is a row a pixel or two tall, and an inset would erase it.
        const span = (g.to - g.from + 1) * cell
        const inset = span >= 10 ? 2 : 0
        const y0 = top + g.from * cell + inset
        const h = span - 2 * inset
        const on = g.id === selectedId
        const cy = y0 + h / 2
        return (
          <g key={g.id} className={'sg-dendro-bar' + (on ? ' on' : '')} role="button" tabIndex={0}
             aria-pressed={on} aria-label={`Select ${g.name}, ${g.members.length} assemblies`}
             onClick={() => onSelectGroup(g.id)}
             onKeyDown={(e) => {
               if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectGroup(g.id) }
             }}>
            <title>{`${g.name}: ${g.members.length} assemblies. Click to select.`}</title>
            <rect x={xLeaf + BAR_GAP - 1} y={y0} width={BAR_W - 2} height={Math.max(2, h)} rx={3}
                  fill={g.color} stroke={on ? INK : g.color} strokeWidth={on ? 2 : 1} />
            {h >= 46
              ? <text x={xLeaf + BAR_GAP + BAR_W / 2 - 1} y={cy} textAnchor="middle"
                      dominantBaseline="central"
                      transform={`rotate(-90 ${xLeaf + BAR_GAP + BAR_W / 2 - 1} ${cy})`}>{g.name}</text>
              : h >= 12 && <text x={xLeaf + BAR_GAP + BAR_W / 2 - 1} y={cy} textAnchor="middle"
                                 dominantBaseline="central">{g.id}</text>}
          </g>
        )
      })}
    </svg>
  )
}
