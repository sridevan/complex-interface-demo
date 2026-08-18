import React, { useEffect, useMemo, useState } from 'react'
import { methodLabel } from './methods'
import DissimilarityHeatmap, { HEATMAP_HELP } from './DissimilarityHeatmap.jsx'
import BlockSummary from './BlockSummary.jsx'
import RunSummary from './RunSummary.jsx'
import { helpHint } from '../components/Hint.jsx'
import SuperpositionViewer from './SuperpositionViewer.jsx'
import SortIcon from '../components/SortIcon.jsx'
import { Pager } from '../components/Pager.jsx'
import '../styles.css'

const BASE = import.meta.env.BASE_URL || '/'

export const MAX_SHOWN = 5
const PAGE_SIZE = 10

// Categorical palette for the superposed structures, checked with the dataviz palette validator
// (all-pairs, light surface): passes the lightness band, chroma floor and normal-vision floor.
// Worst CVD separation is deutan dE 7.6, which is only admissible alongside secondary encoding —
// hence every structure is also named, in the viewer legend and in the table.
// Colours are held per SLOT, not per position in the selection, so removing one structure never
// repaints the others.
const SERIES = ['#0072B2', '#D55E00', '#009E73', '#CC79A7', '#56B4E9']

// Short button labels for the Measure switch. A lookup rather than a conditional, so a dataset
// that gains a metric the page has not seen before falls back to its key instead of being
// mislabelled as one of the others.
const METRIC_NAME = { shape: 'Shape', tmscore: 'TM-score', rmsd: 'RMSD' }

// Presentation order, and the first one present is what a page opens on. TM-score leads: measured
// on ATCase against the depositors' own T/R labels it separates the states best (Cohen's d 1.81 vs
// shape's 1.67) and gives the least fragmented ordering. RMSD is deliberately absent — it is the
// best number to READ but the worst to order by, so it rides along on hover instead. Anything not
// listed sorts to the end in the order the dataset supplied it.
const METRIC_ORDER = ['tmscore', 'shape']
const orderMetrics = (keys) => [...keys].sort((a, b) => {
  const ia = METRIC_ORDER.indexOf(a), ib = METRIC_ORDER.indexOf(b)
  return (ia < 0 ? METRIC_ORDER.length : ia) - (ib < 0 ? METRIC_ORDER.length : ib)
})

// What each measure actually is, and where each one misleads. These are not interchangeable views
// of the same quantity: they disagree, and a reader who switches between them needs to know why.
// Rendered only for the measures a given dataset actually carries.
const METRIC_HELP = {
  shape: ['Shape',
    '3D Zernike and spectral descriptors of the whole assembly, combined into one score and '
    + 'normalised within this set, so values mean nothing outside this complex. It also responds '
    + 'to how much of each model was built, so missing residues can separate instances that share '
    + 'a conformation.'],
  tmscore: ['TM-score',
    'Shown as 1 \u2212 TM-score. It tests whether two structures share a fold, which every pair '
    + 'here does, so it works near the top of its range. Averaged over both directions and rounded '
    + 'to two decimals, giving steps of 0.005.'],
}
// Listed after the measures, since RMSD annotates every pair regardless of which one is selected.
const RMSD_HELP = ['RMSD',
  'Backbone RMSD in \u00c5, on hover for every pair and the only measure here in '
  + 'physical units. Not offered as an ordering: it is dominated by the largest displacements and '
  + 'depends on structure size, so compare within this set only.']
// Moved out of a note under the heading: it described what is already on screen (a backbone trace
// in colours) and named a reference the provenance panel already names. What it did not say is how
// a structure gets here, which is the part a reader can act on.
const VIEWER_HELP = [
  ['What you see', 'Backbone trace only, one colour per instance, each placed by a single global '
    + 'superposition onto the same reference assembly. Differences between traces are therefore '
    + 'conformational rather than differences in deposited coordinate frames. Because the fit is '
    + 'global, a rigid-body shift in one domain appears as displacement across the whole model.'],
  ['Choosing structures', `Added from the matrix or the instances table, up to ${MAX_SHOWN} at `
    + 'once. Click a selected structure again to remove it.'],
]

const COLS = [
  { key: 'assembly_id', label: 'Assembly' },
  { key: 'structure_title', label: 'Structure title' },
  { key: 'resolution', label: 'Resolution (Å)', num: true },
  { key: 'exp_method', label: 'Method' },
]

export default function ConformationalStatesApp({ config }) {
  const { basePath, complexId, title, organism, synthetic } = config
  const [data, setData] = useState(null)
  const [slots, setSlots] = useState(Array(MAX_SHOWN).fill(null))
  // `notice` is a routine limit warning shown beside the viewer; `error` is fatal and replaces the
  // page. Sharing one channel meant a failed fetch rendered nothing at all (data stayed null).
  const [notice, setNotice] = useState(null)
  const [error, setError] = useState(null)
  const [sort, setSort] = useState({ key: null, dir: 'asc' })   // null = heatmap (seriation) order
  // Lift the displayed structures to the top of the table. Opt-in, never automatic: reordering the
  // list every time a heatmap cell is clicked would move rows out from under the pointer and lose
  // the reader's place on every selection.
  const [selectedFirst, setSelectedFirst] = useState(false)
  const [page, setPage] = useState(0)
  // The heatmap solves its own square size from the card width; the viewer is told to match it so
  // the two row-2 cards end level with no filler inside either one.
  const [panelSize, setPanelSize] = useState(520)
  // Which pairwise measure the heatmap shows. Resolved once the data says which measures it
  // carries — a page with no RMSD must not open on a measure it does not have. Order and default
  // come from METRIC_ORDER; the measures disagree with one another, so which one a page opens on
  // is a real editorial choice, not a detail.
  const [metric, setMetric] = useState(null)
  // Drilled-in range, as {from, to} indices into the CURRENT metric's seriation order, or null for
  // the whole set. Reading structure off a 341-instance matrix works; acting on it does not, since
  // a cell is under 2px. Dragging a block is the way in — it needs no precision, and the ordering
  // already groups what belongs together, so a contiguous range is the natural unit.
  const [zoom, setZoom] = useState(null)


  useEffect(() => {
    fetch(`${BASE}${basePath}/instance_similarity.json`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((d) => {
        setData(d)
        // The measure this dataset opens on: the best-behaved one it actually carries.
        const opening = orderMetrics(Object.keys(d.heatmap.metrics))[0]
        setMetric(opening)
        // Preselect the table's first row — the first assembly in THAT measure's seriation order,
        // since each measure orders the rows differently — so the page never opens on an empty
        // viewer showing a structure from a different ordering.
        const first = d.heatmap.metrics[opening]?.order[0]
        if (first) setSlots((prev) => prev.map((s, i) => (i === 0 ? first : s)))
      })
      .catch((e) => setError(String(e)))
  }, [basePath])

  // --- selection ------------------------------------------------------------------------------
  // A fixed set of MAX_SHOWN slots; a structure holds its slot (and so its colour) until removed.
  const colorOf = useMemo(() => {
    const m = {}
    slots.forEach((a, i) => { if (a) m[a] = SERIES[i] })
    return m
  }, [slots])

  const shown = useMemo(
    () => slots.map((a, i) => (a ? { assembly_id: a, color: SERIES[i] } : null)).filter(Boolean),
    [slots])

  // Computed outside the state updater: the updater must stay pure, or StrictMode's double
  // invocation fires the notice twice.
  const addMany = (ids) => {
    const wanted = ids.filter((id) => !slots.includes(id))
    if (!wanted.length) { setNotice(null); return }
    const free = slots.reduce((n, s) => n + (s === null ? 1 : 0), 0)
    if (wanted.length > free) {
      setNotice(`A maximum of ${MAX_SHOWN} structures can be superposed simultaneously. Deselect one to continue.`)
      return
    }
    const next = [...slots]
    for (const id of wanted) next[next.indexOf(null)] = id
    setNotice(null)
    setSlots(next)
  }
  const removeMany = (ids) => {
    setNotice(null)
    setSlots((prev) => prev.map((s) => (ids.includes(s) ? null : s)))
  }
  const toggle = (id) => (slots.includes(id) ? removeMany([id]) : addMany([id]))
  const clearAll = () => { setNotice(null); setSlots(Array(MAX_SHOWN).fill(null)) }

  // Diagonal click -> that one structure; below-diagonal click -> both members of the pair.
  // Clicking a cell whose structures are all already shown removes them again, so the same cell
  // toggles rather than being a dead click once its structures are on screen.
  const onPick = (a, b) => {
    const ids = b ? [a, b] : [a]
    if (ids.every((id) => slots.includes(id))) removeMany(ids)
    else addMany(ids)
  }

  // Re-sorting re-derives the list, so send the reader back to the first page. `selectedFirst` is
  // included because toggling it moves the selected rows to page 1 — leaving the reader on page 12
  // would hide the thing they just asked to see. Deliberately NOT keyed on `slots`: once the mode
  // is on, selecting another structure should not also jump the page.
  useEffect(() => { setPage(0) }, [sort.key, sort.dir, basePath, zoom, selectedFirst])
  // Each measure carries its OWN seriation, so a range of indices means something different under
  // each one. Carrying a zoom across the switch would silently show a different set of instances.
  useEffect(() => { setZoom(null) }, [metric, basePath])

  if (error) {
    return (
      <div className="wrap">
        <p className="cs-error">
          Could not load the similarity dataset for {complexId} ({error}). The page needs{' '}
          <code>{basePath}/instance_similarity.json</code>, staged by <code>npm run sync-data</code>.
        </p>
      </div>
    )
  }
  if (!data) return <div className="wrap">Loading…</div>

  // Diagonal cells of the heatmap show the structure's own metadata, as the notebook's does.
  const metaOf = Object.fromEntries(data.assemblies.map((a) => [a.assembly_id, a]))
  const metrics = data.heatmap.metrics
  const metricKeys = orderMetrics(Object.keys(metrics))
  // Per-pair RMSD, shown on hover alongside whichever measure is selected. Null when the sidecars
  // were incomplete, exactly as a missing measure is.
  const rmsdOf = data.heatmap.rmsd || null
  // What the Measure "?" explains: every measure this dataset carries, plus RMSD if it has it.
  const helpEntries = [...metricKeys.filter((k) => METRIC_HELP[k]).map((k) => METRIC_HELP[k]),
                       ...(rmsdOf ? [RMSD_HELP] : [])]
  // Falls back to the first available measure rather than to a hard-coded name: `metric` is null
  // for the render between the fetch resolving and the state landing, and a dataset need not
  // carry whichever measure was hard-coded.
  const hm = metrics[metric] || metrics[metricKeys[0]]

  // false only when the builder ran in cross-group mode and this instance sits in a different
  // packing group from the reference.
  const overlays = (a) => a.superposes_with_reference !== false
  const nOverlay = data.assemblies.filter(overlays).length
  // Default order matches the heatmap (seriation), so a row's position in the table is the same as
  // its position along the matrix. A column sort overrides it; a third click on that column
  // restores the heatmap order.
  // The matrix itself is never sliced — the heatmap looks every cell up by label — so drilling in
  // is purely a matter of handing it a shorter order. That also keeps the colour scale fixed to
  // the full set for free.
  const shownOrder = zoom ? hm.order.slice(zoom.from, zoom.to + 1) : hm.order
  const inView = zoom ? new Set(shownOrder) : null
  // A drag hands back indices into the order the heatmap was given, so while drilled in they are
  // relative to the current view — rebase them to keep zooming further in.
  const onSelectBlock = (from, to) => {
    const base = zoom ? zoom.from : 0
    setZoom({ from: base + from, to: base + to })
  }

  const seriation = Object.fromEntries(shownOrder.map((a, i) => [a, i]))
  const rows = [...data.assemblies].filter((a) => !inView || inView.has(a.assembly_id))
    .sort((x, y) => {
      // Selected first, when asked for. A stable PARTITION, not a re-sort: whatever order was in
      // force still holds within each group, so this lifts the chosen rows out of the list rather
      // than scrambling it. Worth having because the table is paginated at 10 and a large set runs
      // to 35 pages — two structures picked from opposite ends of the matrix are otherwise 30
      // pages apart, and the table is the only place their metadata is shown.
      if (selectedFirst) {
        const sx = slots.includes(x.assembly_id) ? 0 : 1
        const sy = slots.includes(y.assembly_id) ? 0 : 1
        if (sx !== sy) return sx - sy
      }
      if (!sort.key) return seriation[x.assembly_id] - seriation[y.assembly_id]
      const a = x[sort.key], b = y[sort.key]
      if (a == null) return 1
      if (b == null) return -1
      const cmp = typeof a === 'number' ? a - b : String(a).localeCompare(String(b))
      return sort.dir === 'asc' ? cmp : -cmp
    })
  // Clamp rather than trust the stored page: the list can shrink under us (a different complex,
  // a filter) and slicing past the end would render an empty table.
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const curPage = Math.min(page, pageCount - 1)
  const from = curPage * PAGE_SIZE
  const paged = rows.slice(from, from + PAGE_SIZE)
  const onSort = (key) => setSort((s) => {
    if (s.key !== key) return { key, dir: 'asc' }
    if (s.dir === 'asc') return { key, dir: 'desc' }
    return { key: null, dir: 'asc' }
  })

  return (
    <div className="wrap">
      <div className="page-head">
        <h1>{title}</h1>
        {/* A synthetic set has no PDBe entry, so its id is plain text -- a link that 404s reads as
            a real complex whose page is merely broken. */}
        {synthetic
          ? <span className="complex-id">{complexId}<span className="synth-tag">synthetic</span></span>
          : <a className="complex-id" href={`https://www.ebi.ac.uk/pdbe/pdbe-kb/complexes/${complexId}`}
               target="_blank" rel="noreferrer" title="View this complex on PDBe-KB">{complexId}</a>}
        {organism && <i className="page-organism">{organism}</i>}
      </div>

      {data.subset && (data.subset.applied ? (
        <p className="banner info">
          Showing <b>{data.subset.kept} of {data.subset.of}</b> assembly instances — the largest
          group that shares a common superposition. The rest differ in quaternary arrangement
          (their subunits are packed differently between crystal forms), so no single transform
          can place them in this frame. Group sizes: {data.subset.group_sizes.join(', ')}.
        </p>
      ) : (
        <p className="banner warn">
          These {data.subset.of} instances fall into <b>{data.subset.group_sizes.length} packing
          groups</b> (sizes {data.subset.group_sizes.join(', ')}) whose subunits are arranged
          differently, so no single transform aligns them all. Every instance is listed and every
          pair is scored, but only the <b>{nOverlay}</b> sharing {data.reference_assembly}&rsquo;s
          group overlay in 3D — the other <b>{data.subset.of - nOverlay}</b> are marked{' '}
          <span className="cs-nofit">△</span> and will appear offset in the viewer.
        </p>
      ))}

      {!!(data.data_notes || []).length && (
        <details className="cs-notes">
          <summary>
            Data notes{data.data_notes_scope === 'mixed' ? '' : ' — shape measure'}
            <span className="cs-notes-count">{data.data_notes.length}</span>
          </summary>
          {/* Which measure the notes belong to is declared by the dataset, not assumed. On most
              complexes every note is a shape-score observation, and saying so matters: TM-score is
              length-normalised and computed on CA positions alone, so caveats about modelled extent
              or hydrogen content may not apply to it. Where a complex's notes span both measures,
              claiming they are shape-only would be worse than saying nothing. */}
          <p className="cs-notes-scope">
            {data.data_notes_scope === 'mixed'
              ? 'Each note names the measure it was made against.'
              : <>Measured using the <b>shape</b> measure ({data.method.score_type} Zernike
                 + spectral).
                 {metricKeys.length > 1 && ' Not re-measured for TM-score, so these may not apply there.'}</>}
          </p>
          <ul>
            {data.data_notes.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
        </details>
      )}

      {/* Row 1 is its own flex container rather than part of .cs-grid: the grid below it is two
          equal columns for the heatmap and the viewer, and a CSS grid cannot give one row a
          different column split. */}
      <div className="cs-row1">
        <div className="card cs-instances">
          <h2>Assembly instances</h2>
          <p className="note">
            Select up to {MAX_SHOWN} instances to superpose. The table and the heatmap share one
            selection.
          </p>
          <div className="cs-toolbar">
            {/* The Order label states plainly when the rows no longer mirror the matrix. That
                correspondence is load-bearing — row N in the table is row N in the heatmap — so
                anything that suspends it has to say so rather than let the reader assume. */}
            <span className="cs-order">
              Order: <b>{[selectedFirst && 'selected first',
                          sort.key ? COLS.find((c) => c.key === sort.key)?.label
                                   : (!selectedFirst && 'matching the heatmap')]
                          .filter(Boolean).join(', then ')}</b>
            </span>
            <label className="cs-order-toggle"
                   title={`Lift the ${shown.length ? shown.length : ''} displayed structure`
                          + `${shown.length === 1 ? '' : 's'} to the top of the table, keeping the `
                          + `current order within each group`}>
              <input type="checkbox" checked={selectedFirst}
                     onChange={(e) => setSelectedFirst(e.target.checked)} />
              selected first
            </label>
            {(sort.key || selectedFirst) && (
              <button className="cs-linkbtn"
                      onClick={() => { setSort({ key: null, dir: 'asc' }); setSelectedFirst(false) }}
                      title="Return the rows to the heatmap's ordering">
                match the heatmap again
              </button>
            )}
          </div>
          <div className="cs-instances-scroll">
            <table className="cs-tbl">
              <thead>
                <tr>
                  {/* The clear control lives next to the selection count in the 3D view heading,
                      where the selection's effect is visible — not buried in a header cell. */}
                  <th className="cs-check-col"><span className="cs-sr">Show</span></th>
                  {COLS.map((c) => (
                    <th key={c.key} className={(c.num ? 'num ' : '') + 'sortable'}
                        onClick={() => onSort(c.key)} title="Click to sort">
                      <span className="th-inner">
                        {c.label}
                        <SortIcon dir={sort.key === c.key ? sort.dir : null} />
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paged.map((r) => {
                  const on = slots.includes(r.assembly_id)
                  return (
                    <tr key={r.assembly_id} className={on ? 'cs-row-on' : undefined}>
                      <td className="cs-check-col">
                        <input type="checkbox" checked={on} onChange={() => toggle(r.assembly_id)}
                               aria-label={`Show ${r.assembly_id}`} />
                      </td>
                      <td className="mono">
                        {on && <span className="cs-swatch" style={{ background: colorOf[r.assembly_id] }} />}
                        {r.assembly_id}
                        {!overlays(r) && (
                          <span className="cs-nofit"
                                title={`Packing group ${r.packing_group}: this instance does not share the reference's arrangement, so it will not overlay in the 3D view`}>△</span>
                        )}
                      </td>
                      <td className="cs-title" title={r.structure_title}>{r.structure_title}</td>
                      <td className="num">{r.resolution ?? '—'}</td>
                      <td>{r.exp_method ? methodLabel(r.exp_method) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

          </div>
          <Pager page={curPage} pageCount={pageCount} setPage={setPage}
                 from={from} to={from + paged.length} total={rows.length} unit="instances" />
        </div>

        <RunSummary data={data} metricKeys={metricKeys} />
      </div>

      <div className="cs-grid">
        <div className="card cs-heatmap">
          {/* Named for what the card is, not posed as a question: the ramp runs low = same,
              high = different, so the quantity on screen is a dissimilarity, and the old
              "How similar…?" read inverted against its own colourbar. "Dissimilarity" is generic
              here — the legend and the hover name the exact quantity, which changes with the
              measure ("1 - TM-score", "RMSD"). The heading deliberately does not track the measure
              switch beneath it: a section heading should stay a fixed landmark. */}
          <h2 className="cs-h2-row">
            <span>Pairwise structural dissimilarity {helpHint(HEATMAP_HELP)}</span>
            {/* Deliberately disabled rather than absent or wired up. The clustering analysis lives
                in a notebook outside this app, in a repository that is not public, so a working
                link would 404 for every reader; and a button that silently does nothing is worse
                than one that says why. Not labelled "clustering": the cut is computed and shipped
                as provenance but never drawn, because auto_gap returns k=4 on ATCase where the
                depositors say 2, so a button promising clusters would endorse a number this page
                declines to show. The title carries the reason; enable this the day the notebook is
                published. */}
            <span className="cs-nb"
                  title="Opens the analysis notebook (explore_assembly_clustering.ipynb). Not part of this demo — the heatmap here is the evidence, and the notebook is where a cut into groups can be tried.">
              <button className="cs-nbbtn" disabled aria-disabled="true">
                Explore structural variation
              </button>
            </span>
          </h2>
          {zoom ? (
            <p className="note cs-zoomed">
              Showing <b>{shownOrder.length} of {data.assemblies.length}</b> instances —{' '}
              rows {zoom.from + 1}–{zoom.to + 1} of the matrix. Drag again to go deeper.
              <button className="cs-linkbtn" onClick={() => setZoom(null)}
                      title="Return to the full matrix">
                show all {data.assemblies.length}
              </button>
            </p>
          ) : (
            // Only the gesture. "Every instance compared with every other" was the heading said
            // twice, and the counts live in the provenance panel. This clause stays visible rather
            // than folding into the info icon because drag-to-zoom is the one thing here that
            // cannot be discovered by looking: a reader who does not know the gesture exists has
            // no reason to open a popup to find it.
            <p className="note">Drag down the diagonal to look inside a block.</p>
          )}
          {/* Handed to the heatmap rather than rendered here, so the measure switch and the zoom
              control share one bar instead of stacking two thin rows above the matrix. The
              heatmap owns that bar's layout; this is just its left-hand content.

              Rendered even when there is only one measure. A reader needs to know WHICH measure
              the matrix shows before reading a single cell, and a page that silently omits the
              row leaves that unstated — human haemoglobin ships shape alone because TM-score is
              missing for 53,539 of its pairs. */}
          <DissimilarityHeatmap key={metric} order={shownOrder} labels={data.heatmap.labels}
                                matrix={hm.matrix} cellLabel={hm.cell_label} metaOf={metaOf}
                                colorOf={colorOf} onPick={onPick} onSize={setPanelSize}
                                onSelectBlock={onSelectBlock} rmsd={rmsdOf}
                                toolbar={(
                                  <div className="cs-metric">
                                    <span className="cs-metric-label">
                                      Measure{' '}
                                      {helpHint(helpEntries)}
                                    </span>
                                    {metricKeys.length > 1 ? (
                                      <span className="pill">
                                        {metricKeys.map((k) => (
                                          <button key={k} className={k === metric ? 'active' : undefined}
                                                  onClick={() => setMetric(k)} title={metrics[k].label}>
                                            {METRIC_NAME[k] || k}
                                          </button>
                                        ))}
                                      </span>
                                    ) : (
                                      <span className="cs-metric-only" title={hm.label}>
                                        {METRIC_NAME[metric] || metric}
                                      </span>
                                    )}
                                  </div>
                                )} />
        </div>

        <div className="card cs-viewer">
          <h2>
            {/* "Superposition view", not "3D view": every structure here is laid onto a common
                reference, which is the whole point of the panel and the reason differences in it
                are real rather than placement. The other pages' "3D view of selected interface"
                shows one structure, so it keeps its own name. */}
            Superposition view {helpHint(VIEWER_HELP)}
            <span className="cs-count" title={`Up to ${MAX_SHOWN} instances can be superposed`}>
              {shown.length} of {MAX_SHOWN}
            </span>
            {shown.length > 0 && (
              <button className="cs-linkbtn cs-clear-inline" onClick={clearAll}
                      title="Clear the current selection">clear</button>
            )}
          </h2>
          {/* Beside the viewer, not at the top of the page: this fires on a heatmap or table click,
              and a message above row 1 is off-screen once the page is scrolled. */}
          {notice && <p className="cs-notice">{notice}</p>}
          <SuperpositionViewer basePath={basePath} entries={shown} height={panelSize} />
        </div>

        {/* Only once a block has been drilled into. A full-width card below the two columns, so it
            costs nothing when absent and does not disturb the matched heights of the heatmap and
            the viewer. */}
        {zoom && (
          <BlockSummary block={shownOrder} assemblies={data.assemblies}
                        labels={data.heatmap.labels} matrix={hm.matrix}
                        cellLabel={hm.cell_label} rmsd={rmsdOf}
                        metricName={METRIC_NAME[metric] || metric}
                        onClear={() => setZoom(null)}
                        rangeLabel={`Rows ${zoom.from + 1}–${zoom.to + 1} of the matrix.`} />
        )}
      </div>
    </div>
  )
}
