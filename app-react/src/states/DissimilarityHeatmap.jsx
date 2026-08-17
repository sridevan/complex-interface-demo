import React, { useEffect, useMemo, useRef, useState } from 'react'
import { methodLabel } from './methods'

// Lives with the heatmap it describes, but is rendered by the parent next to the card heading.
// [heading, text] pairs, the same shape as the measure help, so both popups read alike.
export const HEATMAP_HELP = [
  ['Reading it', 'Each cell is one pairwise comparison. The diagonal is grey because it is an '
    + 'instance against itself: always zero, and not a measurement.'],
  ['Ordering', 'Rows and columns are ordered so that alike instances sit next to each other, '
    + 'which is what makes blocks appear. The instances table above uses the same order. Each '
    + 'measure has its own ordering, so switching measure reorders both.'],
  ['Selecting', 'Click a diagonal cell to show that structure in 3D, or a cell below the diagonal '
    + 'to superpose that pair. Click again to remove.'],
  ['Zooming in', 'Press anywhere in the matrix and drag up or down to narrow it, and the table, to '
    + 'that block. Drag again to go deeper. Colours stay fixed to the full set while you do, so a '
    + 'shade means the same thing however far in you are. Use the + and − controls above the '
    + 'matrix when cells are too small to aim at.'],
]

// Viridis, matching the notebook's Section 13 heatmap. Perceptually uniform and colourblind-safe,
// so magnitude reads monotonically: dark purple = similar shape, yellow = most different.
// Ten evenly spaced matplotlib control points, linearly interpolated in sRGB.
const VIRIDIS = ['#440154', '#482878', '#3e4a89', '#31688e', '#26828e',
                 '#1f9e89', '#35b779', '#6dcd59', '#b4de2c', '#fde725']
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const STOPS = VIRIDIS.map(hex)

function viridisRGB(t) {
  const x = Math.max(0, Math.min(1, t)) * (STOPS.length - 1)
  const i = Math.min(STOPS.length - 2, Math.floor(x))
  const f = x - i
  return STOPS[i].map((c, k) => Math.round(c + (STOPS[i + 1][k] - c) * f))
}
function viridis(t) {
  const [r, g, b] = viridisRGB(t)
  return `rgb(${r},${g},${b})`
}

// The diagonal is an instance against itself. It is not a measurement, it is always exactly 0, and
// it carries no information — so it is drawn in a neutral grey rather than in the data's own
// colours. Painting it with the ramp put a hard dark line through every matrix that read as "the
// most similar cells here", and on human haemoglobin the off-diagonal minimum is also 0.000, which
// made genuinely identical PAIRS indistinguishable from the self-comparison. Grey appears nowhere
// in viridis, so it cannot be mistaken for a value.
const DIAGONAL = '#d7dae0'
// Outline colour for anything drawn OVER the matrix: the selection ring's halo, the hover outline,
// the marked drag range. Deliberately not white — white flashed against the data and, now that the
// diagonal is a light grey, had nothing to separate itself from where the selection ring sits.
// Near-black is darker than viridis's darkest (#440154), so it reads at every shade.
const HALO = '#15191f'

const LEGEND_STOPS = Array.from({ length: 24 }, (_, i) => i / 23)

// order    : assembly ids in seriation order (rows and columns share it)
// labels   : assembly ids in matrix order
// matrix   : symmetric dissimilarity matrix indexed by `labels`
// metaOf   : { assembly_id -> { structure_title, exp_method, resolution } } for the diagonal hover
// colorOf  : { assembly_id -> slot colour } for whatever is currently displayed
// onPick   : (a, b) => void — b is null for a diagonal cell (single structure)
// Axis labels are drawn up to MAX_LABELLED instances. Past that the ids are unreadable however the
// matrix is sized, so the gutters are reclaimed as cells and identity comes from hovering a cell and
// from the instances table, which lists the rows in this same order.
const MAX_LABELLED = 50
// Fewest instances a diagonal drag can mark out before it counts as a drag rather than a click.
const MIN_DRAG = 5
// Smallest cell that can carry the ✕ marking a displayed structure. Below this the glyph is a
// smudge, and the slot-coloured ring carries the state on its own.
const MIN_GLYPH = 12
// Row-label gutter and rotated-column-label band, in px. Fixed so the cell size solves exactly
// rather than needing a second layout pass.
const ROW_HEAD = 74
const COL_HEAD = 58

export default function DissimilarityHeatmap({ order, labels, matrix, cellLabel = 'dissimilarity',
                                              metaOf, colorOf, onPick, onSize, onSelectBlock,
                                              block, toolbar, rmsd }) {
  const [hover, setHover] = useState(null)
  // Cell size is solved from the space the card gives us, so an 11-instance matrix and a
  // 40-instance one both fill the same box — and the heatmap ends up the same size as the 3D
  // viewer beside it instead of being a small grid floating in a large card.
  const boxRef = useRef(null)
  // fitCell is the size at which the whole matrix fills the box; `zoom` magnifies it. At 341
  // instances a fitted cell is 1.68px, which is too small to aim a click or start a drag at, so
  // the matrix has to be able to grow past its container and be scrolled.
  const [fitCell, setFitCell] = useState(22)
  const [zoom, setZoom] = useState(1)
  const [measured, setMeasured] = useState(false)
  const cell = Math.round(fitCell * zoom * 1000) / 1000
  // Keyboard navigation: the matrix is a grid with ONE tab stop (roving tabindex), not 400 of them.
  // Arrows move between interactive cells, Enter/Space activates. `cur` is the roving position.
  const [cur, setCur] = useState({ i: 0, j: 0 })
  // Drag along the diagonal to mark out a block. A plain click (no movement) still toggles a single
  // structure, so this adds a gesture without taking one away.
  const dragRef = useRef(null)
  const [dragTo, setDragTo] = useState(null)
  const cellRefs = useRef(new Map())
  const movedRef = useRef(false)

  const idx = useMemo(() => Object.fromEntries(labels.map((l, i) => [l, i])), [labels])
  // Colour is scaled to the observed range, as Plotly does when zmin/zmax are left to the data.
  // Always the FULL matrix, never the zoomed subset: a shade has to mean the same dissimilarity
  // however far into a block you have drilled, or a tight cluster rescales to look as varied as
  // the whole set.
  //
  // Reduced rather than `Math.max(...matrix.flat())`. Spreading a 341x341 matrix passes 116,281
  // arguments, which is at the edge of V8's argument limit, and an 800-instance complex would
  // pass 640,000 and throw RangeError outright.
  const max = useMemo(() => {
    let m = 0
    for (const row of matrix) for (const v of row) if (v > m) m = v
    return m
  }, [matrix])
  const value = (a, b) => matrix[idx[a]][idx[b]]
  // Indexed by `labels` like the measure matrices, so it survives drilling in — which only ever
  // shortens `order`, never the matrices themselves.
  const rmsdAt = (a, b) => (rmsd ? rmsd.matrix[idx[a]]?.[idx[b]] ?? null : null)
  const n = order.length

  useEffect(() => {
    const el = boxRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const fit = () => {
      // Border-box width, NOT clientWidth. Zooming makes the box scrollable, and on platforms
      // where scrollbars take space clientWidth would shrink the moment one appeared — which
      // would shrink the fitted cell, which changes the layout again. getBoundingClientRect is
      // unaffected by scrollbars, so the fitted size stays a property of the card alone.
      const w0 = el.getBoundingClientRect().width
      if (w0 <= 0) return
      // Solve the cell size from the WIDTH alone and let the height follow, so the matrix fills the
      // card edge to edge. Sizing to min(width, height) left a band of unused white inside the
      // border whenever the card was wider than tall.
      //
      // Solved exactly, NOT floored to a whole pixel and with no lower bound. A 3px floor asked
      // for 341 * 3 = 1023px of table inside a ~440px card; the cells then kept their 3px HEIGHT
      // while the auto table layout squeezed the COLUMNS down to fit, so a square matrix was
      // drawn as a 2.3:1 rectangle that towered over every other page. Sub-pixel cells stay
      // square because width and height are solved from the same number, and the matrix is the
      // width of the card at every n -- which is what makes the pages match.
      const gutter = n <= MAX_LABELLED ? ROW_HEAD : 0
      const c = Math.min(64, Math.round(((w0 - gutter - 2) / n) * 1000) / 1000)
      setFitCell(c)
      setMeasured(true)
      // (the height the viewer should match is reported separately, from the whole column)
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [n])

  // Height the viewer beside us should match. Reporting the matrix box alone left the viewer 90px
  // short — the box is only part of this column, which also carries the toolbar above it and the
  // colourbar and caption below. Measuring the whole column instead means the viewer keeps pace
  // automatically if either of those changes, rather than needing a constant kept in step by hand.
  const rootRef = useRef(null)
  useEffect(() => {
    const el = rootRef.current
    if (!el || !onSize || typeof ResizeObserver === 'undefined') return
    const report = () => {
      const h = el.getBoundingClientRect().height
      if (h > 0) onSize(h)
    }
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => ro.disconnect()
  }, [onSize])

  const font = Math.max(7, Math.min(11, Math.round(cell * 0.48)))
  // Labels are drawn against the FITTED size, not the zoomed one: whether ids fit is a property
  // of how many instances there are, and letting them appear on zoom would reflow the matrix
  // under the pointer mid-gesture.
  const labelled = n <= MAX_LABELLED
  // dragTo is state, so a live drag re-renders and dragRef.current is current when read here.
  const dragCount = (dragRef.current != null && dragTo != null)
    ? Math.abs(dragTo - dragRef.current) + 1 : 0
  // Ramp-end labels. Decimals follow the magnitude — RMSD runs to single figures of angstroms and
  // wants one, a dissimilarity in the hundredths wants three. The unit comes from the metric's own
  // cell_label so a new metric needs no change here.
  const unit = /Å/.test(cellLabel) ? ' Å' : ''
  const fmtVal = (v) => (max >= 10 ? v.toFixed(1) : max >= 1 ? v.toFixed(2) : v.toFixed(3)) + unit
  // The range to outline: the live drag if there is one, otherwise a block the caller has marked.
  const mark = (dragRef.current != null && dragTo != null)
    ? { lo: Math.min(dragRef.current, dragTo), hi: Math.max(dragRef.current, dragTo) }
    : (block ? { lo: block.from, hi: block.to } : null)

  // Drilling in replaces the rows without remounting, so the roving tab position can be left
  // pointing past the end of the new, shorter range. Send it back to the top instead, and go back
  // to fitting — a narrower range needs less magnification, and keeping the old factor would drop
  // the reader into a corner of a matrix they have not seen whole yet.
  useEffect(() => {
    movedRef.current = false
    setCur({ i: 0, j: 0 })
    cellRefs.current.clear()
    setZoom(1)
    if (boxRef.current) boxRef.current.scrollTo(0, 0)
  }, [n])

  // Zoom about the centre of what is on screen, so the block being looked at stays put instead of
  // sliding away as the matrix grows. Fractions are captured before the resize and reapplied after
  // the browser has laid the bigger table out.
  const applyZoom = (next) => {
    const el = boxRef.current
    const before = el && el.scrollWidth > el.clientWidth
      ? { x: (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth,
          y: (el.scrollTop + el.clientHeight / 2) / el.scrollHeight }
      : { x: 0.5, y: 0.5 }
    setZoom(next)
    requestAnimationFrame(() => {
      if (!boxRef.current) return
      const b = boxRef.current
      b.scrollLeft = before.x * b.scrollWidth - b.clientWidth / 2
      b.scrollTop = before.y * b.scrollHeight - b.clientHeight / 2
    })
  }
  // Upper bound is a cell size, not a factor: 40px is already larger than the biggest fitted cell
  // on any page here, and past it the reader is scrolling a wall of squares.
  const canZoomIn = cell < 40
  const zoomIn = () => applyZoom(Math.min(zoom * 1.6, 40 / fitCell))
  const zoomOut = () => applyZoom(Math.max(1, zoom / 1.6))

  // A pointer released anywhere outside the matrix has to clear the drag too. Without this the
  // range stays armed and the next cell the pointer crosses silently extends a selection the
  // user already abandoned.
  useEffect(() => {
    const up = () => { if (dragRef.current != null) { dragRef.current = null; setDragTo(null) } }
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [])

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
  // Arms a drag at row i. Deliberately NOT restricted to the diagonal: at 1.68px per cell, asking
  // someone to press exactly on a one-and-a-half-pixel diagonal line is asking them to miss. A
  // press anywhere in the matrix marks out rows from there, and a press that does not travel far
  // enough still falls through to a plain click on whatever cell it landed on.
  const beginDrag = (i) => { dragRef.current = i; setDragTo(i) }
  // Where the drag has reached, from the pointer's Y position rather than from per-cell
  // mouseenter events. At 341 instances a row is under 2px, and the browser coalesces pointer
  // moves — it will step straight over cells without ever entering them, so an event-driven
  // preview sticks at whatever row the drag began on. Geometry cannot skip. It also means the
  // pointer need not stay on the diagonal itself: dragging anywhere down the matrix works.
  const dragMove = (e) => {
    if (gridRef.current && dragRef.current != null) {
      const r = gridRef.current.getBoundingClientRect()
      const top = r.top + (n <= MAX_LABELLED ? COL_HEAD : 0)
      const i = Math.floor((e.clientY - top) / cell)
      setDragTo(Math.max(0, Math.min(n - 1, i)))
    }
    // In canvas mode there are no per-cell nodes, so the tooltip is resolved here from geometry.
    // This sets state on every move, but the subtree it re-renders is one <canvas> and a tooltip
    // — not the 116,281 cells the table had to reconcile to do the same job.
    if (!labelled) {
      const p = cellAt(e)
      if (!p) { setHover(null); return }
      const r = order[p.i], c = order[p.j]
      setHover({ r, c, v: value(r, c), isDiag: p.i === p.j, active: p.i >= p.j,
                 x: e.clientX, y: e.clientY })
    }
  }
  // Completes a drag if one is armed. Runs on the SCROLL BOX in the capture phase, not on the
  // cell that happens to be under the pointer: a drag straight down from the diagonal ends on a
  // cell BELOW it, and requiring the release to land on a diagonal cell — as an earlier version
  // did — means a real downward drag never completes. Where it is released does not matter. The
  // gesture is defined by where it began (beginDrag only arms on a diagonal cell) and how far
  // the pointer travelled.
  const endDrag = () => {
    const from = dragRef.current
    const to = dragTo
    dragRef.current = null
    setDragTo(null)
    if (from == null || to == null) return false
    // Below MIN_DRAG the gesture is treated as a click. At 341 instances a cell is under 2px, so
    // a hand tremor covers several of them -- without a floor, trying to select one structure
    // would zoom into a meaningless three-instance range instead.
    if (Math.abs(to - from) + 1 < MIN_DRAG) return false
    if (onSelectBlock) onSelectBlock(Math.min(from, to), Math.max(from, to))
    return true
  }
  // Set when a drag completed, so the cell's own mouseup does not ALSO fire a selection. Capture
  // on the box runs before the cell's bubbling handler, so the flag is always set in time.
  // --- canvas renderer (n > MAX_LABELLED) ------------------------------------------------------
  // Above the labelling threshold the matrix is drawn as an image rather than as one <td> per
  // cell. At 341 instances the table is 116,281 elements, and every pointer move re-rendered all
  // of them just to move a tooltip. One canvas is one element, and at 800 instances — 640,000
  // cells — a table does not render at all.
  //
  // The pixels are built ONCE per matrix at one pixel per cell, then scaled up with smoothing
  // off. Redrawing at a new zoom is a single drawImage, so zooming and panning cost nothing.
  const gridRef = useRef(null)          // whichever element holds the matrix: <table> or <canvas>
  const tileRef = useRef(null)          // n x n offscreen canvas, one pixel per cell
  const [tile, setTile] = useState(0)   // bumped when the tile is rebuilt, to trigger a repaint
  useEffect(() => {
    if (labelled) { tileRef.current = null; return }
    const tile = document.createElement('canvas')
    tile.width = n
    tile.height = n
    const img = new ImageData(n, n)
    const px = img.data
    const dg = [parseInt(DIAGONAL.slice(1, 3), 16), parseInt(DIAGONAL.slice(3, 5), 16),
                parseInt(DIAGONAL.slice(5, 7), 16)]
    for (let i = 0; i < n; i++) {
      const row = matrix[idx[order[i]]]
      for (let j = 0; j < n; j++) {
        const [r, g, b] = i === j ? dg : viridisRGB(max > 0 ? row[idx[order[j]]] / max : 0)
        const p = (i * n + j) * 4
        px[p] = r; px[p + 1] = g; px[p + 2] = b; px[p + 3] = 255
      }
    }
    tile.getContext('2d').putImageData(img, 0, 0)
    tileRef.current = tile
    setTile((v) => v + 1)               // nudge the paint effect once the tile exists
  }, [order, matrix, idx, max, n, labelled])

  // Paint. Depends on the tile, the cell size and what is selected — NOT on hover or on the live
  // drag, which are drawn as DOM overlays so that moving the pointer never repaints the matrix.
  useEffect(() => {
    const cv = gridRef.current
    // `measured` gates the first paint on a real measurement of the box. Without it the first
    // frame paints at the placeholder cell size, which for 341 instances is a 7,502px matrix that
    // is then immediately thrown away.
    if (labelled || !measured || !cv || !tileRef.current || !cv.getContext) return
    const W = Math.max(1, Math.round(n * cell))
    // Clamp the backing store. The fitted cell size starts at a placeholder before the box has
    // been measured, and 341 x 22px would ask for a 15,004px canvas at 2x — over Safari's limit
    // outright and a large allocation everywhere else. Dropping the pixel ratio rather than the
    // CSS size keeps the matrix the right size on screen and only costs sharpness for the frame
    // or two before the real measurement lands.
    const MAX_SIDE = 8192
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, MAX_SIDE / W))
    const back = Math.min(MAX_SIDE, Math.round(W * dpr))
    if (cv.width !== back) { cv.width = back; cv.height = back }
    cv.style.width = `${W}px`
    cv.style.height = `${W}px`
    const ctx = cv.getContext('2d')
    if (!ctx) return
    // Scale from the ACTUAL backing size, not from dpr — they differ once the clamp bites.
    const k = back / W
    ctx.setTransform(k, 0, 0, k, 0, 0)
    ctx.imageSmoothingEnabled = false           // cells are data, not a photo: keep them square
    ctx.clearRect(0, 0, W, W)
    ctx.drawImage(tileRef.current, 0, 0, n, n, 0, 0, W, W)
    // Selected structures get a ring on their own diagonal cell, as the table draws with an inset
    // shadow. Stroked at least 2px wide so it survives a 1.68px cell.
    //
    // Drawn over a WHITE halo. Three of the five slot colours (the blue, the light blue and the
    // green) sit inside viridis's own blue-to-green range, so a bare ring can read as just another
    // cell. The halo separates the marker from the data while the ring itself keeps the
    // structure's own colour, which is what ties it to the 3D view and the legend.
    //
    // Dark rather than white. The ring sits on the diagonal, which is a light neutral grey, so a
    // white halo had almost nothing to separate itself from; dark reads against both the grey
    // diagonal and the neighbouring cells the ring overlaps.
    const ring = Math.max(2, Math.min(3, cell / 4))
    const halo = ring + 2
    for (let i = 0; i < n; i++) {
      const col = colorOf[order[i]]
      if (!col) continue
      ctx.lineWidth = halo
      ctx.strokeStyle = HALO
      ctx.strokeRect(i * cell - halo / 2, i * cell - halo / 2, cell + halo, cell + halo)
      ctx.lineWidth = ring
      ctx.strokeStyle = col
      ctx.strokeRect(i * cell - ring / 2, i * cell - ring / 2, cell + ring, cell + ring)
      // The same ✕ the table draws, once the cells are big enough to hold it — so zooming into a
      // canvas matrix and drilling into a labelled one look alike rather than one of them silently
      // dropping the marker.
      if (cell >= MIN_GLYPH) {
        const p = cell * 0.3
        const a = i * cell + p, b = i * cell + cell - p
        const cross = () => {
          ctx.beginPath()
          ctx.moveTo(a, a); ctx.lineTo(b, b)
          ctx.moveTo(b, a); ctx.lineTo(a, b)
          ctx.stroke()
        }
        // No halo: the ✕ sits on the diagonal, which is a light neutral grey, so a dark stroke
        // reads on its own.
        ctx.lineCap = 'round'
        ctx.lineWidth = 2
        ctx.strokeStyle = HALO
        cross()
      }
    }
    // Keyboard cursor, so arrow-key navigation is visible without per-cell DOM nodes. Same
    // near-black as every other mark over the matrix, no light halo: viridis's darkest is
    // #440154, which #15191f still separates from.
    if (movedRef.current) {
      ctx.lineWidth = 2
      ctx.strokeStyle = HALO
      ctx.strokeRect(cur.j * cell - 1, cur.i * cell - 1, cell + 2, cell + 2)
    }
  }, [tile, cell, n, colorOf, order, cur, labelled, measured])

  // Which cell the pointer is over, from geometry. Replaces 116,281 sets of mouse handlers.
  const cellAt = (e) => {
    const el = gridRef.current
    if (!el) return null
    const r = el.getBoundingClientRect()
    const j = Math.floor((e.clientX - r.left) / cell)
    const i = Math.floor((e.clientY - r.top) / cell)
    if (i < 0 || j < 0 || i >= n || j >= n) return null
    return { i, j }
  }

  const swallowRef = useRef(false)
  const onBoxMouseUp = () => {
    const zoomed = endDrag()
    swallowRef.current = zoomed
    // Cleared on the next tick regardless. The cell handler clears it too, but a release landing
    // on a cell ABOVE the diagonal has no handler at all — without this the flag would survive
    // and swallow the user's next click.
    if (zoomed) setTimeout(() => { swallowRef.current = false }, 0)
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
    <div className="cs-hm" ref={rootRef}>
      {/* One bar above the matrix: whatever the caller supplies on the left (the measure switch),
          zoom on the right. Floating zoom over the matrix's corner reads better but covers the
          rotated column labels on the pages that draw them, and hides the matrix corner on the
          canvas pages. Sharing this row with the measure switch keeps it out of the data without
          costing a second row. */}
      <div className="cs-hm-bar">
        <div className="cs-hm-bar-left">{toolbar}</div>
        <div className="cs-hm-zoom">
          {/* Labelled like the measure switch beside it. Unlabelled, a bare pair of small +/−
              glyphs reads as decoration and gets missed, which matters most on exactly the
              matrices too dense to click without it. */}
          <span className="cs-hm-zoom-label">Zoom</span>
          <button type="button" onClick={zoomOut} disabled={zoom <= 1}
                  aria-label="Zoom out of the matrix" title="Zoom out">&minus;</button>
          <span className="cs-hm-zoomval" aria-live="polite"
                title={`Cells are ${cell.toFixed(cell < 10 ? 1 : 0)}px`}>
            {zoom > 1 ? `${zoom.toFixed(1)}×` : 'fit'}
          </span>
          <button type="button" onClick={zoomIn} disabled={!canZoomIn}
                  aria-label="Zoom into the matrix" title="Zoom in">+</button>
        </div>
      </div>
      <div className={'cs-hm-scroll' + (zoom > 1 ? ' cs-hm-pannable' : '')} ref={boxRef}
           onMouseMove={dragMove} onMouseUpCapture={onBoxMouseUp}>
       <div className="cs-hm-stage" style={{ width: `${cell * n + (labelled ? ROW_HEAD : 0)}px` }}>
        {/* One rectangle over the whole marked range. Two strokes — dark outside, white inside —
            so it holds up against both ends of the viridis ramp, and everything outside it is
            dimmed so the range reads even when it is a few pixels tall. */}
        {mark && (
          <div className="cs-hm-mark" aria-hidden="true" style={{
            left: (labelled ? ROW_HEAD : 0) + mark.lo * cell,
            top: (labelled ? COL_HEAD : 0) + mark.lo * cell,
            width: (mark.hi - mark.lo + 1) * cell,
            height: (mark.hi - mark.lo + 1) * cell }} />
        )}
        {/* Canvas above the labelling threshold, table below it. The table earns its keep only
            while it carries something a canvas cannot: row and column labels, a per-cell
            aria-label and a real tab stop. Past 50 instances the labels are already gone and
            tabbing through n^2 cells was never usable, so all the table contributes is DOM. */}
        {!labelled ? (
          <canvas className="cs-hm-canvas" ref={gridRef} tabIndex={0} role="img"
                  aria-label={`Pairwise ${cellLabel} between ${n} assembly instances, drawn as a `
                    + 'matrix. Use the arrow keys to move between cells and Enter to display a '
                    + 'structure or a pair.'}
                  onMouseDown={(e) => { const p = cellAt(e); if (p && p.i >= p.j) beginDrag(p.i) }}
                  onMouseUp={(e) => {
                    if (swallowRef.current) { swallowRef.current = false; return }
                    const p = cellAt(e)
                    if (p && p.i >= p.j) onPick(order[p.i], p.i === p.j ? null : order[p.j])
                  }}
                  onMouseLeave={() => setHover(null)}
                  onKeyDown={(e) => onKeyDown(e, cur.i, cur.j, order[cur.i], order[cur.j],
                                              cur.i === cur.j)} />
        ) : (
        /* --matrix pins the table to exactly the width the cell size was solved for. Left to
           `width: auto` the layout engine redistributes sub-pixel columns on its own and the
           matrix stops being square. */
        <table className="cs-hm-table cs-hm-nosel" role="grid" ref={gridRef}
               style={{ "--cell": `${cell}px`, "--cellfont": `${font}px`,
                        "--matrix": `${cell * n + (labelled ? ROW_HEAD : 0)}px` }}
               aria-label="Pairwise shape dissimilarity between assembly instances">
          {labelled && (
            <thead>
              <tr>
                <th className="cs-hm-corner" />
                {order.map((c) => (
                  <th key={c} className="cs-hm-colhead" style={{ height: COL_HEAD }}>
                    <span style={{ color: colorOf[c] || undefined, fontWeight: colorOf[c] ? 700 : 500 }}>{c}</span>
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {order.map((r, i) => (
              <tr key={r}>
                {labelled && (
                  <th className="cs-hm-rowhead">
                    {colorOf[r] && <span className="cs-swatch" style={{ background: colorOf[r] }} />}
                    <span style={{ fontWeight: colorOf[r] ? 700 : 500 }}>{r}</span>
                  </th>
                )}
                {order.map((c, j) => {
                  const v = value(r, c)
                  const isDiag = i === j
                  const active = isDiag || i > j          // diagonal + below only
                  const style = { background: isDiag ? DIAGONAL : viridis(max > 0 ? v / max : 0),
                                  cursor: active ? 'pointer' : 'default' }
                  // A structure's own diagonal cell carries its selected state: slot-coloured ring
                  // plus a tick, so selection is not signalled by colour alone.
                  // The marked range is NOT drawn here. Outlining each cell individually was
                  // invisible at 341 instances -- a 1px translucent line inside a 1.68px cell is
                  // smaller than the cell it is meant to mark. It is one overlay rectangle drawn
                  // over the whole table instead, which stays crisp at any cell size.
                  // Slot colour inside, white outside — see the canvas painter for why: three of
                  // the five slot colours fall inside viridis's own range, and white does not.
                  const picked = isDiag && colorOf[r]
                  if (picked) {
                    const w = cell < 14 ? 2 : 3
                    style.boxShadow =
                      `inset 0 0 0 ${w}px ${colorOf[r]}, inset 0 0 0 ${w + 2}px ${HALO}`
                  }
                  const shownNow = colorOf[r] && (isDiag || colorOf[c])
                  const label = isDiag
                    ? `${r}, itself${colorOf[r] ? ' — displayed' : ''}`
                    : `${r} versus ${c}, ${cellLabel} ${v.toFixed(3)}${shownNow ? ' — displayed' : ''}`
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
                        onMouseDown={active ? () => beginDrag(i) : undefined}
                        onMouseUp={active ? () => {
                          if (swallowRef.current) { swallowRef.current = false; return }
                          onPick(r, isDiag ? null : c)
                        } : undefined}
                        onMouseEnter={(e) => setHover({ r, c, v, isDiag, active, x: e.clientX, y: e.clientY })}
                        onMouseMove={(e) => setHover((h) => (h ? { ...h, x: e.clientX, y: e.clientY } : h))}
                        onMouseLeave={() => setHover(null)}>
                      {/* ✕ rather than a tick: the ring already says "this one is displayed", so
                          the glyph is better spent saying what a click will do, which is remove
                          it. Matches the tooltip, which reads "click to remove this structure". */}
                      {picked && cell >= MIN_GLYPH && (
                        <span className="cs-hm-check" aria-hidden="true">✕</span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        )}
       </div>
      </div>

      <div className="cs-hm-foot">
        {/* The ramp's ends carry their actual values. Without them there is no way to tell whether
            a matrix spans 0-0.88 or 0-0.035, and the two look identical because the scale is always
            stretched to the data. That difference matters: enolase's whole TM-score set spans
            0.035, which is eight distinct values painted across the full ramp. */}
        <div className="cs-hm-legend">
          <div className="cs-hm-ramp-row">
            <span className="cs-hm-tick">{fmtVal(0)}</span>
            <span className="cs-hm-ramp">
              {LEGEND_STOPS.map((s) => (
                <i key={s} style={{ background: viridis(s) }} />
              ))}
            </span>
            <span className="cs-hm-tick">{fmtVal(max)}</span>
          </div>
          {/* Both directions named, with the quantity between them. Generic on purpose: this used
              to interpolate cellLabel, so on TM-score it read "1 - TM-score", naming a measure the
              active pill directly above already names. What the legend is for is which way the
              ramp runs, and "dissimilarity" carries that where the measure's own name does not.
              Not "score" -- TM-score runs 0 to 1 with 1 = identical and this ramp paints the
              complement, so a word implying higher-is-more-similar would point the reader the
              wrong way down the bar. The exact quantity still labels every number that is actually
              reported: the hover tooltip and the selection summary both use cellLabel. */}
          <div className="cs-hm-legend-caps">
            More similar <span className="cs-hm-arrow">←</span>
            {' '}<span className="cs-hm-quantity">dissimilarity</span>{' '}
            <span className="cs-hm-arrow">→</span> More different
          </div>
        </div>
        {/* Live readout for the range being marked out: at these cell sizes the outline alone does
            not tell you how many instances you have. Idle it is blank but still occupies its line,
            so the card does not resize under the pointer as the drag starts. The instance count
            used to sit here; it now lives in the provenance panel, where it is not repeated. */}
        <p className="cs-hm-caption">
          {dragCount > 0
            ? (dragCount < MIN_DRAG
                ? `${dragCount} marked — drag at least ${MIN_DRAG} to zoom in`
                : `${dragCount} instances marked — release to zoom in`)
            : ' '}
        </p>
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
                  <span className="cm-tip-sub">method</span> {m.exp_method ? methodLabel(m.exp_method) : 'n/a'}
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
                <div><span className="cm-tip-sub">{cellLabel}</span> {hover.v.toFixed(3)}</div>
                {/* RMSD rides along on every pair whatever measure is selected: it is the one
                    figure here in units a reader can act on, even though it orders the matrix
                    badly and so is not a measure of its own. */}
                {rmsdAt(hover.r, hover.c) != null && (
                  <div>
                    <span className="cm-tip-sub">{rmsd.cell_label}</span>{' '}
                    {rmsdAt(hover.r, hover.c).toFixed(2)} {rmsd.unit}
                  </div>
                )}
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
