import { viridis, DIAGONAL } from '../states/DissimilarityHeatmap.jsx'

// Downloads for the structural-groups pages: the dendrogram and the pairwise matrix as SVG and
// PNG, the assembly table as CSV, and every pairwise score as CSV.
//
// The figures are DRAWN FROM THE DATA, not captured from the page. A capture would inherit the
// page's size, its scroll position, its hover state and whichever group happened to be selected;
// a figure drawn from the clustering is the same every time, which is what a file with a fixed
// name should be. It also lets the export be fuller than the screen: the dendrogram always has a
// labelled leaf for every assembly, including on complexes where the page has to collapse it.
//
// Everything is real SVG, text as text and shapes as shapes, so a figure can be edited afterwards.

const SANS = 'Helvetica, Arial, sans-serif'
const MONO = 'Menlo, Consolas, monospace'
const INK = '#15191f'
const MUTED = '#5b6470'
const BRANCH = '#6b7480'
// The matrix is only offered as a figure while every assembly can be named on both axes: a
// matrix without its labels cannot be read away from the page it came from. Past this many
// assemblies the labels stop being legible at any size a figure is used at, so the page offers
// the dendrogram and the table instead.
export const HEATMAP_EXPORT_MAX = 50
const MAX_LABELLED = HEATMAP_EXPORT_MAX

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const fmt = (v) => (v >= 10 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : v.toFixed(3))
const text = (x, y, t, a = {}) => {
  const { size = 11, anchor = 'start', fill = INK, weight = 400, font = SANS, rotate = null,
          baseline = 'auto' } = a
  const tr = rotate == null ? '' : ` transform="rotate(${rotate} ${x} ${y})"`
  return `<text x="${x}" y="${y}" font-family="${font}" font-size="${size}" font-weight="${weight}" `
    + `fill="${fill}" text-anchor="${anchor}" dominant-baseline="${baseline}"${tr}>${esc(t)}</text>`
}
const wrap = (w, h, body) => `<?xml version="1.0" encoding="UTF-8"?>\n`
  + `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" `
  + `width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n`
  + `<rect width="${w}" height="${h}" fill="#ffffff"/>\n${body}\n</svg>\n`

// Names every group beside its colour, so identity never rests on the strip alone: a group of one
// in a matrix of hundreds is a strip two pixels tall.
function groupLegend(groups, x, y, maxWidth) {
  const out = []
  let cx = x, cy = y
  for (const g of groups) {
    const label = `${g.name} (${g.members.length})`
    const w = 22 + label.length * 6.2
    if (cx + w > x + maxWidth && cx > x) { cx = x; cy += 18 }
    out.push(`<circle cx="${cx + 5}" cy="${cy - 4}" r="4.5" fill="${g.color}"/>`)
    out.push(text(cx + 14, cy, label, { size: 11 }))
    cx += w
  }
  return { svg: out.join('\n'), bottom: cy }
}

// A strip segment per group along one edge of the matrix, named where there is room.
function strips(groups, cell, x, y, vertical, thick) {
  return groups.map((g) => {
    const at = g.from * cell, len = (g.to - g.from + 1) * cell
    const inset = len >= 10 ? 1 : 0
    const r = vertical
      ? `<rect x="${x}" y="${y + at + inset}" width="${thick}" height="${Math.max(1, len - 2 * inset)}" rx="2" fill="${g.color}"/>`
      : `<rect x="${x + at + inset}" y="${y}" width="${Math.max(1, len - 2 * inset)}" height="${thick}" rx="2" fill="${g.color}"/>`
    const mid = at + len / 2
    const label = len >= 50 ? g.name : len >= 14 ? String(g.id) : null
    if (!label) return r
    const tx = vertical ? x + thick / 2 : x + mid
    const ty = vertical ? y + mid : y + thick / 2
    return r + text(tx, ty, label, { size: 9.5, weight: 700, fill: '#ffffff', anchor: 'middle',
                                     baseline: 'central', rotate: vertical && len >= 50 ? -90 : null })
  }).join('\n')
}

// The matrix cells as vector rectangles, runs of one colour merged along each row.
function cellsVector(order, idx, matrix, max, cell) {
  const n = order.length
  const out = []
  for (let i = 0; i < n; i++) {
    const row = matrix[idx[order[i]]]
    let start = 0, fill = null
    for (let j = 0; j <= n; j++) {
      const f = j === n ? null : i === j ? DIAGONAL : viridis(max > 0 ? row[idx[order[j]]] / max : 0)
      if (f !== fill) {
        if (fill) out.push(`<rect x="${start * cell}" y="${i * cell}" width="${(j - start) * cell}" height="${cell}" fill="${fill}"/>`)
        start = j; fill = f
      }
    }
  }
  return `<g shape-rendering="crispEdges">${out.join('')}</g>`
}

// The whole matrix in clustering order, every assembly named on both axes, the groups marked
// along both edges and outlined on the diagonal, and the colour bar.
export function heatmapFigure({ title, quantity, labels, matrix, clustering }) {
  const { order, groups } = clustering
  const n = order.length
  const idx = Object.fromEntries(labels.map((l, i) => [l, i]))
  let max = 0
  for (const row of matrix) for (const v of row) if (v > max) max = v
  if (n > HEATMAP_EXPORT_MAX) {
    throw new Error(`the matrix is exported with every assembly labelled, up to ${HEATMAP_EXPORT_MAX} assemblies`)
  }
  const labelled = true
  // Never below 16px a cell, whatever the count: the figure grows instead of the labels
  // shrinking, so ids are 9px at the fewest and sit one to a row without touching.
  const cell = Math.max(16, Math.min(34, Math.round(600 / n)))
  const side = n * cell
  const font = Math.max(9, Math.min(11, Math.round(cell * 0.5)))
  const LABEL = 70, STRIP = 14, GAP = 5, PAD = 24
  const x0 = PAD + LABEL + STRIP + GAP          // left edge of the matrix
  const yTitle = PAD + 14
  const legend = groupLegend(groups, PAD, yTitle + 44, Math.max(side + LABEL + STRIP + GAP, 360))
  const y0 = legend.bottom + 16 + LABEL + STRIP + GAP   // top edge of the matrix
  const width = Math.max(x0 + side + PAD, 440)
  const body = []
  body.push(text(PAD, yTitle, title, { size: 15, weight: 700 }))
  body.push(text(PAD, yTitle + 18, `Pairwise structural dissimilarity (${quantity}), `
    + `${n} assemblies in ${groups.length} structural groups`, { size: 11, fill: MUTED }))
  body.push(legend.svg)
  {
    order.forEach((id, i) => {
      body.push(text(PAD + LABEL - 5, y0 + (i + 0.5) * cell, id,
        { size: font, font: MONO, anchor: 'end', baseline: 'central' }))
      const cx = x0 + (i + 0.5) * cell, cy = y0 - STRIP - GAP - 5
      body.push(text(cx, cy, id, { size: font, font: MONO, anchor: 'start', baseline: 'central',
                                   rotate: -90 }))
    })
  }
  body.push(strips(groups, cell, PAD + LABEL, y0, true, STRIP))
  body.push(strips(groups, cell, x0, y0 - STRIP - GAP, false, STRIP))
  body.push(`<g transform="translate(${x0} ${y0})">`)
  body.push(cellsVector(order, idx, matrix, max, cell))
  // Group boundaries: white with a thin dark edge, the page's own marking.
  for (const g of groups) {
    const a = g.from * cell, l = (g.to - g.from + 1) * cell
    body.push(`<rect x="${a}" y="${a}" width="${l}" height="${l}" fill="none" stroke="#15191f" stroke-opacity="0.35" stroke-width="3"/>`)
    body.push(`<rect x="${a}" y="${a}" width="${l}" height="${l}" fill="none" stroke="#ffffff" stroke-width="1.5"/>`)
  }
  body.push('</g>')
  // Colour bar: a true gradient, its two ends carrying their values.
  const bw = Math.min(280, side), bx = x0 + (side - bw) / 2, by = y0 + side + 22
  const stops = Array.from({ length: 11 }, (_, i) =>
    `<stop offset="${i * 10}%" stop-color="${viridis(i / 10)}"/>`).join('')
  body.push(`<defs><linearGradient id="ramp" x1="0" x2="1" y1="0" y2="0">${stops}</linearGradient></defs>`)
  body.push(`<rect x="${bx}" y="${by}" width="${bw}" height="12" fill="url(#ramp)" stroke="#d0d4da"/>`)
  body.push(text(bx - 6, by + 6, fmt(0), { size: 11, anchor: 'end', baseline: 'central', fill: MUTED }))
  body.push(text(bx + bw + 6, by + 6, fmt(max), { size: 11, baseline: 'central', fill: MUTED }))
  body.push(text(bx + bw / 2, by + 30, quantity, { size: 11, weight: 700, anchor: 'middle' }))
  body.push(text(bx, by + 30, 'more similar', { size: 10, fill: MUTED }))
  body.push(text(bx + bw, by + 30, 'more different', { size: 10, fill: MUTED, anchor: 'end' }))
  const height = by + 30 + PAD
  return { svg: wrap(width, height, body.join('\n')), width, height }
}

// The full tree, drawn horizontally: root on the left, a labelled leaf for every assembly, the cut that makes the groups, and each
// group named beside the leaves it covers.
export function dendrogramFigure({ title, quantity, labels, clustering }) {
  const { root, groups, cutHeight, maxHeight } = clustering
  const n = root.leaves.length
  const step = n <= MAX_LABELLED ? 22 : 12
  const font = n <= MAX_LABELLED ? 11 : 9
  const PAD = 24, TREE = 420, STUB = 10, LABEL = font * 6.4, STRIP = 12, NAME = 96
  const yTitle = PAD + 14
  const legend = groupLegend(groups, PAD, yTitle + 44, TREE + LABEL + STRIP + NAME)
  const yAxis = legend.bottom + 58
  const y0 = yAxis + 16
  const xRoot = PAD + 4, xZero = PAD + TREE - STUB, xLeaf = PAD + TREE
  const x = (h) => (maxHeight > 0 ? xZero - (h / maxHeight) * (xZero - xRoot) : xZero)
  const pos = new Map(root.leaves.map((leaf, p) => [leaf, p]))
  const yLeaf = (leaf) => y0 + (pos.get(leaf) + 0.5) * step
  const inGroup = new Map()
  const mark = (node, g) => { inGroup.set(node.id, g); if (node.left) { mark(node.left, g); mark(node.right, g) } }
  for (const g of groups) mark(g.node, g)
  const lines = []
  const stroke = (node) => (inGroup.has(node.id) ? INK : BRANCH)
  const yOf = (node) => {
    if (!node.left) return yLeaf(node.leaves[0])
    const yl = yOf(node.left), yr = yOf(node.right), xn = x(node.height)
    lines.push(`<line x1="${xn}" y1="${yl}" x2="${xn}" y2="${yr}" stroke="${stroke(node)}"/>`)
    for (const [c, yc] of [[node.left, yl], [node.right, yr]]) {
      lines.push(`<line x1="${xn}" y1="${yc}" x2="${c.left ? x(c.height) : xLeaf}" y2="${yc}" stroke="${stroke(c)}"/>`)
    }
    return (yl + yr) / 2
  }
  yOf(root)
  const bottom = y0 + n * step
  const body = []
  body.push(text(PAD, yTitle, title, { size: 15, weight: 700 }))
  body.push(text(PAD, yTitle + 18, `Structural groups: average-linkage clustering on pairwise ${quantity}, `
    + `${n} assemblies in ${groups.length} groups`, { size: 11, fill: MUTED }))
  body.push(legend.svg)
  // Scale: merge height, in the quantity the clustering ran on.
  body.push(`<line x1="${x(maxHeight)}" y1="${yAxis}" x2="${xZero}" y2="${yAxis}" stroke="${MUTED}"/>`)
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    const h = maxHeight * f
    body.push(`<line x1="${x(h)}" y1="${yAxis - 4}" x2="${x(h)}" y2="${yAxis + 4}" stroke="${MUTED}"/>`)
    body.push(text(x(h), yAxis - 8, f === 0 ? '0' : fmt(h), { size: 9.5, anchor: 'middle', fill: MUTED }))
  }
  body.push(text(x(maxHeight), yAxis - 24, `${quantity} at merge`, { size: 10, fill: MUTED }))
  body.push(`<g stroke-width="1.1" stroke-linecap="square" fill="none">${lines.join('')}</g>`)
  if (cutHeight != null) {
    body.push(`<line x1="${x(cutHeight)}" y1="${y0 - 6}" x2="${x(cutHeight)}" y2="${bottom + 4}" stroke="${MUTED}" stroke-dasharray="4 3"/>`)
    body.push(text(x(cutHeight), bottom + 18, `cut at ${fmt(cutHeight)}: ${groups.length} groups`,
      { size: 10, anchor: 'middle', fill: MUTED }))
  }
  root.leaves.forEach((leaf) => {
    body.push(text(xLeaf + 5, yLeaf(leaf), labels[leaf], { size: font, font: MONO, baseline: 'central' }))
  })
  const xs = xLeaf + 5 + LABEL
  for (const g of groups) {
    const a = y0 + g.from * step + 1, l = (g.to - g.from + 1) * step - 2
    body.push(`<rect x="${xs}" y="${a}" width="${STRIP}" height="${l}" rx="2" fill="${g.color}"/>`)
    body.push(text(xs + STRIP + 6, a + l / 2, l >= 20 ? `${g.name} (${g.members.length})` : g.name,
      { size: l >= 20 ? 11 : 9, weight: 700, baseline: 'central' }))
  }
  const width = xs + STRIP + NAME + PAD
  const height = bottom + 26 + PAD
  return { svg: wrap(width, height, body.join('\n')), width, height }
}

// --- files ------------------------------------------------------------------------------------

function save(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

// Longest side of a PNG, in pixels. Browsers refuse canvases much past this, and they fail by
// returning a blank image rather than by raising an error.
const MAX_SIDE = 12000

function rasterise({ svg, width, height }) {
  return new Promise((resolve, reject) => {
    // Three times the drawn size, which prints at 300 dpi across a slide, short of MAX_SIDE.
    const scale = Math.min(3, MAX_SIDE / Math.max(width, height))
    const img = new Image()
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
    img.onload = () => {
      try {
        const cv = document.createElement('canvas')
        cv.width = Math.round(width * scale)
        cv.height = Math.round(height * scale)
        const ctx = cv.getContext('2d')
        ctx.imageSmoothingEnabled = false
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, cv.width, cv.height)
        ctx.drawImage(img, 0, 0, cv.width, cv.height)
        cv.toBlob((b) => (b ? resolve(b) : reject(new Error('the image could not be encoded'))),
                  'image/png')
      } catch (e) { reject(e) } finally { URL.revokeObjectURL(url) }
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('the figure could not be drawn')) }
    img.src = url
  })
}

// The assembly table as CSV: one row per assembly in dendrogram order, the rows the page's own
// table is built from. Always the whole complex, whatever page or filter the table is showing.
const CSV_COLUMNS = [
  ['assembly_id', (r) => r.assembly_id],
  ['pdb_id', (r) => r.pdb_id],
  ['structural_group', (r) => r.group_name],
  ['group_representative', (r) => (r.is_representative ? 'yes' : 'no')],
  ['structure_title', (r) => r.structure_title],
  ['experimental_method', (r) => r.method],
  ['resolution_angstrom', (r) => r.resolution],
]
const csvCell = (v) => {
  if (v == null) return ''
  const t = String(v)
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
}
export function tableCsv(rows) {
  return [CSV_COLUMNS.map(([name]) => name).join(','),
          ...rows.map((r) => CSV_COLUMNS.map(([, get]) => csvCell(get(r))).join(','))]
    .join('\r\n') + '\r\n'
}
export function exportTable({ fileStem, rows }) {
  const name = `${fileStem}_structural_group_assemblies.csv`
  save(new Blob([tableCsv(rows)], { type: 'text/csv;charset=utf-8' }), name)
  return name
}

// Every pairwise score, one row per unordered pair, for anyone who wants to run their own
// clustering: 1 - TM-score as the page uses it, the TM-score it came from, backbone RMSD where the
// dataset has it, and the group each assembly landed in here. Long format rather than a square
// matrix, because that is what pandas, R and a spreadsheet take without reshaping; at 341
// assemblies it is 57,970 rows, about 3 MB.
export function pairsCsv({ labels, matrix, rmsd, groupOf }) {
  const head = ['assembly_a', 'assembly_b', 'tm_dissimilarity', 'tm_score',
                ...(rmsd ? ['rmsd_angstrom'] : []), 'group_a', 'group_b']
  const lines = [head.join(',')]
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      const d = matrix[i][j]
      const row = [labels[i], labels[j], d.toFixed(4), (1 - d).toFixed(4)]
      if (rmsd) row.push(rmsd.matrix[i]?.[j] == null ? '' : rmsd.matrix[i][j].toFixed(2))
      row.push(`Group ${groupOf[labels[i]]}`, `Group ${groupOf[labels[j]]}`)
      lines.push(row.join(','))
    }
  }
  return lines.join('\r\n') + '\r\n'
}
export function exportPairs({ fileStem, ...input }) {
  const name = `${fileStem}_pairwise_tm_dissimilarity.csv`
  save(new Blob([pairsCsv(input)], { type: 'text/csv;charset=utf-8' }), name)
  return name
}

// figure: 'heatmap' | 'dendrogram'; format: 'svg' | 'png'. Resolves once the file is handed to
// the browser and rejects with a message fit to show the reader.
export async function exportFigure(figure, format, { fileStem, ...input }) {
  const made = figure === 'heatmap' ? heatmapFigure(input) : dendrogramFigure(input)
  const name = figure === 'heatmap'
    ? `${fileStem}_pairwise_tm_dissimilarity_heatmap.${format}`
    : `${fileStem}_structural_groups_dendrogram.${format}`
  if (format === 'svg') save(new Blob([made.svg], { type: 'image/svg+xml;charset=utf-8' }), name)
  else save(await rasterise(made), name)
  return name
}
