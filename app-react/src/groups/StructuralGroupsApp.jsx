import React, { useEffect, useMemo, useRef, useState } from 'react'
import { methodLabel } from '../states/methods'
import DissimilarityHeatmap from '../states/DissimilarityHeatmap.jsx'
import { summariseSelection } from '../states/BlockSummary.jsx'
import SuperpositionViewer from '../states/SuperpositionViewer.jsx'
import Hint, { helpHint } from '../components/Hint.jsx'
import SortIcon from '../components/SortIcon.jsx'
import { Pager } from '../components/Pager.jsx'
import { structuralGroups, groupSubtree } from './clustering'
import Dendrogram from './Dendrogram.jsx'
import GroupOverview from './GroupOverview.jsx'
import { GroupsCard, AssociatedFeatures, GROUP_NOTE } from './GroupPanels.jsx'
import ExportMenu from './ExportMenu.jsx'
import { exportFigure, exportTable, HEATMAP_EXPORT_MAX } from './exportFigures'
import { CompareControl, ComparePanel, comparisonOf } from './RepresentativeComparison.jsx'
import '../styles.css'

// PROTOTYPE, for discussion: how PDBe-KB Complexes might present computationally derived
// structural groups of assembly instances. A separate page from the similarity view
// (ConformationalStatesApp), which it leaves untouched, reading the same dataset and reusing its
// heatmap, selection arithmetic, superposition viewer and provenance card.
//
// Terminology is load-bearing. The clustering groups assemblies by structural similarity and
// nothing else, so the UI says "structural group" throughout and never names a conformational
// state, even where one looks obvious. Interpretation is what the associated features are for.

const BASE = import.meta.env.BASE_URL || '/'

// At most this many structures are drawn at once. It is also the largest group that opens with
// every member displayed: a bigger group opens on its representative alone, and members are added
// by hand for comparison. One number for both, so "show all" never asks for more than the viewer
// will draw. A route may lower the second through grouping.showAllUpTo.
const MAX_SHOWN = 10
const PAGE_SIZE = 10
// One rule for what the page draws. The instance-level view, a matrix cell for every pair and a
// dendrogram leaf for every assembly, is drawn only when the set ON DISPLAY has at most this many
// assemblies. That set is the whole complex, or the selected group in the group-only view. Above
// it the page shows the groups themselves. A choice about legibility, not about the data: every
// pair is still computed, and the full tree and table are in the downloads.
const DETAIL_MAX = 50
// Width of the dendrogram gutter, px.
const DENDRO_W = 124

// First five as on the similarity page, so a structure shown on both keeps a familiar colour.
const SERIES = ['#0072B2', '#D55E00', '#009E73', '#CC79A7', '#56B4E9', '#E69F00', '#7A5195', '#4D4D4D',
                '#882255', '#999933']

// The page presents ONE structural similarity model: pairwise 1 - TM-score. It is what the
// clustering runs on, what the matrix shows and what every figure in the group card is measured
// in. A dataset may carry other measures for other pages; this one reads only this key and offers
// no choice, because a second measure means a second grouping.
const MEASURE = 'tmscore'
const QUANTITY = '1 \u2212 TM-score'

const pdbeAssemblyUrl = (asm) => {
  const [pdb, id] = asm.split('_')
  return `https://www.ebi.ac.uk/pdbe/entry/pdb/${pdb}?activeTab=complexes&id=${id}`
}

const HEATMAP_HELP = [
  ['Reading it', `Each cell is one pairwise comparison, shown as ${QUANTITY}: 0 for identical `
    + 'structures, larger for more different ones. The grey diagonal compares an assembly with '
    + 'itself.'],
  ['Ordering', 'Rows and columns follow the leaf order of the clustering tree, so the matrix, the '
    + 'dendrogram and the groups all describe the same arrangement.'],
  ['Groups', 'Each leaf of the dendrogram is one assembly and each structural group is one '
    + 'branch below the dashed cut line, marked by its coloured strip. Light outlines mark the '
    + 'groups on the matrix. Click a '
    + 'group bar to select that group.'],
  ['Superposition', 'Click a cell inside the selected group to hide or show those assemblies '
    + 'in the superposition view.'],
]
const OVERVIEW_HELP = [
  ['Reading it', 'The clustering tree, drawn down to the structural groups. Each group is one '
    + 'wedge: its point marks the largest dissimilarity merged inside the group, so a longer '
    + 'wedge is a more varied group.'],
  ['Group size', 'Taller rows are larger groups, within limits, so that a group of one stays '
    + 'visible. The count and the bar under it give the exact share of assemblies.'],
  ['Detail', `The pairwise matrix and a leaf for every assembly are shown for sets of up to `
    + `${DETAIL_MAX} assemblies: choose a group of that size and switch the view to it. The full `
    + 'tree and table are in the downloads.'],
]
const VIEWER_HELP = [
  ['What you see', 'Backbone trace only, one colour per assembly, each placed by a single global '
    + 'superposition onto the same reference assembly.'],
  ['Choosing structures', `A group of up to ${MAX_SHOWN} assemblies opens with every member `
    + 'displayed. A larger group opens on its representative, and other members can be added '
    + `for comparison, up to ${MAX_SHOWN} at once. This changes the view only: the selected `
    + 'group, its summary and its associated features stay as they are.'],
]
const COMPARE_HELP = [
  ['In the dendrogram', 'Both representatives are marked in their colours, and the route between '
    + 'them through the tree is drawn in black. The further left it reaches, the more dissimilar '
    + 'the merge that joins them.'],
  ['What you see', 'The representative of the selected group and the representative of one other '
    + 'group, superposed, and no other structure. Each is the medoid of its group.'],
  ['What it changes', 'The view only. The selected group, its statistics and its associated '
    + 'features are as they were.'],
]
const COLS = [
  { key: 'assembly_id', label: 'Assembly' },
  { key: 'group', label: 'Structural group',
    hint: 'Assemblies are grouped according to their structural similarity. Structural groups do '
      + 'not necessarily correspond to known biological conformational states.' },
  { key: 'structure_title', label: 'Structure title' },
  { key: 'resolution', label: 'Resolution (Å)', num: true },
  { key: 'exp_method', label: 'Method' },
]

const EMPTY = Array(MAX_SHOWN).fill(null)

// Reports its own height, as the heatmap does, so the viewer beside it can keep level with
// whatever this panel is showing.
function Measured({ onSize, children }) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const report = () => { const h = el.getBoundingClientRect().height; if (h > 0) onSize(h) }
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => ro.disconnect()
  }, [onSize])
  return <div ref={ref}>{children}</div>
}

export default function StructuralGroupsApp({ config }) {
  const { basePath, complexId, title, organism, grouping, similarityHash } = config
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  // ONE selection for the whole page, and it is always a structural group: the table, the chips
  // and the dendrogram all read and write this id and nothing else. There is deliberately no
  // free-form selection here. The page presents one reproducible grouping; arbitrary subsets are
  // what the similarity page is for, and other groupings are what the notebook is for.
  const [selectedId, setSelectedId] = useState(null)
  const [slots, setSlots] = useState(EMPTY)
  const [notice, setNotice] = useState(null)
  const [sort, setSort] = useState({ key: null, dir: 'asc' })
  const [page, setPage] = useState(0)
  const [panelSize, setPanelSize] = useState(520)
  const [nbOpen, setNbOpen] = useState(false)
  const [exportError, setExportError] = useState(null)
  // Which rows the matrix shows: every assembly, or the selected group alone. Only offered where
  // the whole set is too large to label, which is where looking inside one group earns its place.
  const [scope, setScope] = useState('all')
  // Narrows the table to the selected group. For a table of hundreds, where a group's members
  // otherwise start part-way down a page and run on for a dozen more.
  const [groupOnly, setGroupOnly] = useState(false)
  // Representative comparison. `compareWith` is the group chosen in the selector; `comparing` says
  // whether the viewer is showing the two representatives instead of the group. Neither is part
  // of the analytical selection: selectedId is, and nothing here writes it.
  const [compareWith, setCompareWith] = useState(null)
  const [comparing, setComparing] = useState(false)
  // Height of what sits between the viewer card's note and the viewer itself: the comparison box
  // and any notice. The heatmap card has nothing in that position, so the viewer gives up exactly
  // this much and the two cards end level, with no blank band under the matrix.
  const extrasRef = useRef(null)
  const [extrasH, setExtrasH] = useState(0)
  const ready = !!data && selectedId != null      // the card exists once a group is selected
  useEffect(() => {
    const el = extrasRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const measure = () => setExtrasH(Math.round(el.getBoundingClientRect().height))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ready])

  useEffect(() => {
    fetch(`${BASE}${basePath}/instance_similarity.json`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((d) => {
        if (!d.heatmap.metrics[MEASURE]) throw new Error('the dataset carries no TM-score matrix')
        setData(d)
      })
      .catch((e) => setError(String(e)))
  }, [basePath])

  const hm = data ? data.heatmap.metrics[MEASURE] : null
  const labels = data ? data.heatmap.labels : null
  const clustering = useMemo(
    () => (hm ? structuralGroups(labels, hm.matrix, { nGroups: grouping.nGroups }) : null),
    [hm, labels, grouping.nGroups])

  // What a group opens on: every member if it is small enough, otherwise the representative.
  const showAllUpTo = Math.min(grouping.showAllUpTo ?? MAX_SHOWN, MAX_SHOWN)
  const opensOn = (g) => (g.members.length <= showAllUpTo
    ? [g.representative, ...g.members.filter((m) => m !== g.representative)]
    : [g.representative])
  const selectGroup = (id) => {
    const g = clustering.groups.find((x) => x.id === id)
    if (!g) return
    setSelectedId(id)
    // Selecting a group always lands on that group's own view, so a comparison in progress ends.
    setComparing(false)
    const next = [...EMPTY]
    opensOn(g).forEach((m, i) => { next[i] = m })
    setSlots(next)
    setNotice(null)
    // The table follows the dendrogram, so a group is a run of consecutive rows. Turn to the page
    // it starts on, or selecting a group in a table of hundreds shows rows from another one.
    setPage(!sort.key && !groupOnly ? Math.floor(g.from / PAGE_SIZE) : 0)
  }
  // Opens on the largest group, and returns to it whenever the grouping itself is recomputed.
  useEffect(() => { if (clustering) selectGroup(1) }, [clustering])   // eslint-disable-line
  useEffect(() => { setPage(0) }, [sort.key, sort.dir, basePath])
  useEffect(() => { setScope('all') }, [basePath])

  const colorOf = useMemo(() => {
    const m = {}
    slots.forEach((a, i) => { if (a) m[a] = SERIES[i] })
    return m
  }, [slots])
  const shown = useMemo(
    () => slots.map((a, i) => (a ? { assembly_id: a, color: SERIES[i] } : null)).filter(Boolean),
    [slots])

  const sel = useMemo(() => {
    const g = clustering && clustering.groups.find((x) => x.id === selectedId)
    return g ? { id: g.id, label: g.name, color: g.color, members: g.members, from: g.from,
                 to: g.to, representative: g.representative } : null
  }, [clustering, selectedId])

  const stats = useMemo(() => (sel ? summariseSelection({
    block: sel.members, assemblies: data.assemblies, labels, matrix: hm.matrix,
    rmsd: data.heatmap.rmsd || null }) : null), [sel, data, labels, hm])

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
  if (!data || !clustering || !sel) return <div className="wrap">Loading…</div>

  const metaOf = Object.fromEntries(data.assemblies.map((a) => [a.assembly_id, a]))
  const { groups, groupOf, order } = clustering
  const inSel = new Set(sel.members)
  const nAll = data.assemblies.length
  const canScope = nAll > DETAIL_MAX
  const groupView = canScope && scope === 'group'
  const selGroup = groups.find((g) => g.id === sel.id)
  // What the panel draws, from the size of the set on display.
  const shownN = groupView ? sel.members.length : nAll
  const mode = shownN > DETAIL_MAX ? (groupView ? 'hidden' : 'overview')
    : shownN < 2 ? 'single' : 'detail'
  const view = groupView
    ? { clustering: groupSubtree(selGroup), order: sel.members, bands: null, block: null }
    : { clustering, order,
        bands: groups.map((g) => ({ key: g.id, from: g.from, to: g.to })),
        block: { from: sel.from, to: sel.to } }
  // --- representative comparison --------------------------------------------------------------
  // The group compared against: the one chosen, or the first other group when nothing valid is
  // chosen yet (on load, or after selecting the group that had been the choice).
  const others = groups.filter((g) => g.id !== sel.id)
  const other = others.find((g) => g.id === compareWith) || others[0] || null
  const at = Object.fromEntries(labels.map((l, i) => [l, i]))
  const rmsdM = data.heatmap.rmsd ? data.heatmap.rmsd.matrix : null
  const pair = (a, b) => ({ dissimilarity: hm.matrix[at[a]][at[b]],
                            rmsd: rmsdM ? rmsdM[at[a]]?.[at[b]] ?? null : null })
  const comparison = comparing && other ? comparisonOf(sel, other, pair) : null
  // What is on screen: the two representatives while comparing, otherwise the group's view.
  const entries = comparison ? comparison.entries : shown
  const colours = comparison
    ? Object.fromEntries(comparison.entries.map((e) => [e.assembly_id, e.color])) : colorOf

  const anyModified = data.assemblies.some((a) => (a.modified || []).length > 0)
  // --- viewer selection, as on the similarity page -------------------------------------------
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
  // Visualization only, and only within the selected group: these change which members are drawn
  // and nothing else. They never touch selectedId, so the summary and the associated features
  // cannot move. The guards repeat what the disabled controls already enforce.
  const toggle = (id) => {
    if (comparison || !inSel.has(id)) return
    if (slots.includes(id)) removeMany([id]); else addMany([id])
  }
  const onPick = (a, b) => {
    const ids = b ? [a, b] : [a]
    if (comparison || !ids.every((id) => inSel.has(id))) return
    if (ids.every((id) => slots.includes(id))) removeMany(ids)
    else addMany(ids)
  }
  const resetView = () => selectGroup(sel.id)
  const large = sel.members.length > showAllUpTo
  const opening = large ? [sel.representative] : sel.members
  const atOpening = shown.length === opening.length
    && opening.every((m) => slots.includes(m))

  // --- table ------------------------------------------------------------------------------------
  const leaf = Object.fromEntries(order.map((a, i) => [a, i]))
  const rows = data.assemblies.map((a) => ({ ...a, group: groupOf[a.assembly_id] }))
    .filter((a) => !groupOnly || a.group === sel.id)
    .sort((x, y) => {
      if (!sort.key) return leaf[x.assembly_id] - leaf[y.assembly_id]
      const a = x[sort.key], b = y[sort.key]
      if (a == null) return 1
      if (b == null) return -1
      const cmp = typeof a === 'number' ? a - b : String(a).localeCompare(String(b))
      return (sort.dir === 'asc' ? cmp : -cmp) || leaf[x.assembly_id] - leaf[y.assembly_id]
    })
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const curPage = Math.min(page, pageCount - 1)
  const from = curPage * PAGE_SIZE
  const paged = rows.slice(from, from + PAGE_SIZE)
  const onSort = (key) => setSort((s) => {
    if (s.key !== key) return { key, dir: 'asc' }
    if (s.dir === 'asc') return { key, dir: 'desc' }
    return { key: null, dir: 'asc' }
  })

  // --- what the notebook would be handed ----------------------------------------------------
  // The same matrix the page clustered and the configuration it used, so the grouping on screen
  // can be reproduced first and varied second. Built on the click, not on every render: at 341
  // assemblies the matrix alone is most of a megabyte.
  const handoffFile = `${data.complex_id}_structural_groups.json`
  const downloadHandoff = (e) => {
    e.preventDefault()
    const handoff = {
      complex_id: data.complex_id,
      input: { measure: MEASURE, label: hm.label, labels, matrix: hm.matrix },
      clustering: { method: grouping.method, linkage: grouping.linkage.toLowerCase(),
                    n_groups: groups.length, cut_height: clustering.cutHeight },
      result: { leaf_order: order,
                groups: groups.map((g) => ({ name: g.name, representative: g.representative,
                                             members: g.members })) },
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(handoff, null, 1)],
                                             { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = handoffFile
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  // --- downloads ----------------------------------------------------------------------------
  // The matrix is offered only where its figure can name every assembly on both axes.
  const downloads = [
    ['dendrogram', 'svg', 'Dendrogram SVG'],
    ['dendrogram', 'png', 'Dendrogram PNG'],
    ['table', 'csv', 'Assembly instances CSV'],
    ...(nAll <= HEATMAP_EXPORT_MAX
      ? [['heatmap', 'svg', 'Heatmap SVG'], ['heatmap', 'png', 'Heatmap PNG']] : []),
  ]
  // The table's own rows, all of them, in dendrogram order: not the page on screen, and not
  // narrowed to the selected group.
  const tableRows = () => order.map((id) => {
    const a = metaOf[id], g = groups[groupOf[id] - 1]
    return { assembly_id: id, pdb_id: a.pdb_id, group_name: g.name,
             is_representative: g.representative === id, structure_title: a.structure_title,
             method: a.exp_method ? methodLabel(a.exp_method) : null, resolution: a.resolution }
  })

  const doExport = (what, format) => (what === 'table'
    ? exportTable({ fileStem: data.complex_id, rows: tableRows() })
    : exportFigure(what, format, {
        fileStem: data.complex_id, title: `${title} (${data.complex_id})`,
        quantity: QUANTITY, labels, matrix: hm.matrix, clustering }))
  // For the buttons outside the menu. Same export, same error line.
  const download = async (what, format, label) => {
    setExportError(null)
    try { await doExport(what, format) } catch (e) {
      setExportError(`${label} could not be exported: ${e && e.message ? e.message : 'unknown error'}.`)
    }
  }

  const viewSwitch = canScope && (
    <div className="sg-scope">
      <span className="cs-metric-label">View</span>
      <span className="pill">
        <button className={!groupView ? 'active' : undefined} onClick={() => setScope('all')}
                title="Every structural group of the complex">
          All {nAll} assemblies
        </button>
        <button className={groupView ? 'active' : undefined} onClick={() => setScope('group')}
                title={`Only the ${sel.members.length} assemblies of ${sel.label}`}>
          {sel.label} only
        </button>
      </span>
    </div>
  )

  const grp = (r) => {
    const on = sel.id === r.group
    return (
      <button type="button" className={'sg-cell' + (on ? ' on' : '')} aria-pressed={on}
              style={{ '--g': groups[r.group - 1].color }}
              onClick={() => selectGroup(r.group)}
              title={`Select all ${groups[r.group - 1].members.length} assemblies in Group ${r.group}`}>
        <span className="sg-dot" />Group {r.group}
      </button>
    )
  }

  return (
    <div className="wrap">
      <div className="page-head">
        <h1>{title}</h1>
        <a className="complex-id" href={`https://www.ebi.ac.uk/pdbe/pdbe-kb/complexes/${complexId}`}
           target="_blank" rel="noreferrer" title="View this complex on PDBe-KB">{complexId}</a>
        {organism && <i className="page-organism">{organism}</i>}
        <span className="synth-tag">prototype</span>
      </div>
      <p className="sg-intro">
        Structural groups <Hint text={GROUP_NOTE} width={300} />
        {similarityHash && <> · <a href={similarityHash}>current similarity view</a></>}
      </p>

      <div className="cs-row1">
        <div className="card cs-instances sg-instances">
          <h2>Assembly instances</h2>
          <div className="cs-toolbar">
            <span className="cs-order">
              Order: <b>{sort.key ? COLS.find((c) => c.key === sort.key)?.label
                                  : 'matching the dendrogram'}</b>
            </span>
            {canScope && (
              <label className="cs-order-toggle"
                     title={`List only the assemblies of ${sel.label}`}>
                <input type="checkbox" checked={groupOnly}
                       onChange={(e) => {
                         setGroupOnly(e.target.checked)
                         setPage(e.target.checked || sort.key ? 0 : Math.floor(sel.from / PAGE_SIZE))
                       }} />
                selected group only
              </label>
            )}
            {sort.key && (
              <button className="cs-linkbtn" onClick={() => setSort({ key: null, dir: 'asc' })}
                      title="Return the rows to the clustering leaf order">
                match the dendrogram again
              </button>
            )}
          </div>
          <div className="cs-instances-scroll">
            {/* A full page takes up whatever height the card has to spare, shared evenly between
                its rows. Only a full page: the two rows of a last page would each be stretched
                to several times their height. */}
            <table className={'cs-tbl sg-tbl' + (paged.length === PAGE_SIZE ? ' sg-tbl-fill' : '')}>
              <thead>
                <tr>
                  <th className="cs-check-col"><span className="cs-sr">Show</span></th>
                  {COLS.map((c) => (
                    <th key={c.key} className={(c.num ? 'num ' : '') + 'sortable'}
                        onClick={() => onSort(c.key)} title="Click to sort">
                      <span className="th-inner">
                        {c.label}
                        {c.hint && <Hint text={c.hint} width={300} />}
                        <SortIcon dir={sort.key === c.key ? sort.dir : null} />
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paged.map((r) => {
                  const on = colours[r.assembly_id] != null
                  const cls = [on && 'cs-row-on', inSel.has(r.assembly_id) && 'sg-row-sel']
                    .filter(Boolean).join(' ')
                  return (
                    <tr key={r.assembly_id} className={cls || undefined}
                        style={{ '--g': groups[r.group - 1].color }}>
                      <td className="cs-check-col">
                        <input type="checkbox" checked={on} onChange={() => toggle(r.assembly_id)}
                               disabled={!!comparison || !inSel.has(r.assembly_id)}
                               title={comparison ? 'Go back to the group view to change what is displayed'
                                 : inSel.has(r.assembly_id)
                                 ? `Show or hide ${r.assembly_id} in the superposition view`
                                 : `Select Group ${r.group} to display this assembly`}
                               aria-label={`Show ${r.assembly_id}`} />
                      </td>
                      <td className="mono">
                        {on && <span className="cs-swatch" style={{ background: colours[r.assembly_id] }} />}
                        <a className="cs-asm-link" href={pdbeAssemblyUrl(r.assembly_id)}
                           target="_blank" rel="noreferrer"
                           title={`View ${r.assembly_id} at PDBe`}>{r.assembly_id}</a>
                        {r.assembly_id === groups[r.group - 1].representative && (
                          <span className="cs-rep"
                                title={`Representative of Group ${r.group}: the medoid, closest on average to the other members`}>medoid</span>
                        )}
                      </td>
                      <td>{grp(r)}</td>
                      <td className="cs-title" title={r.structure_title}>{r.structure_title}</td>
                      <td className="num">{r.resolution ?? '—'}</td>
                      <td>{r.exp_method ? methodLabel(r.exp_method) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {pageCount > 1 && (
            <Pager page={curPage} pageCount={pageCount} setPage={setPage}
                   from={from} to={from + paged.length} total={rows.length} unit="instances" />
          )}
        </div>

        <GroupsCard clustering={clustering} selection={sel} stats={stats}
                    representative={sel.representative} quantity={QUANTITY}
                    onSelectGroup={selectGroup} config={grouping} />
      </div>

      <div className="cs-grid">
        <div className="card cs-heatmap sg-heatmap">
          <h2 className="cs-h2-row">
            <span>Pairwise structural dissimilarity {helpHint([
              ...(mode === 'detail' ? HEATMAP_HELP : OVERVIEW_HELP)])}</span>
            <span className="sg-head-actions">
              {/* Always the whole complex in clustering order, whatever is selected or zoomed:
                  a file with a fixed name should hold the same figure every time. */}
              <ExportMenu onError={setExportError} items={downloads}
                          onExport={doExport} />
              <button type="button" className="sg-nbbtn" aria-expanded={nbOpen}
                      onClick={() => setNbOpen((v) => !v)}>
                Explore clustering in notebook
              </button>
            </span>
          </h2>
          {exportError && (
            <p className="cs-notice sg-export-error" role="status">
              {exportError}
              <button className="cs-linkbtn" onClick={() => setExportError(null)}>dismiss</button>
            </p>
          )}
          {nbOpen && (
            <div className="sg-nb">
              <b>Placeholder.</b> The notebook is not linked yet. It will open with the matrix and
              the clustering configuration used here, so the grouping can be reproduced and then
              rerun with another method or other parameters.{' '}
              <a href={`#${handoffFile}`} onClick={downloadHandoff}>Download the inputs (JSON)</a>
            </div>
          )}
          <p className="note">
            {mode === 'detail'
              ? 'Select a structural group to highlight its assemblies and inspect its structural similarity.'
              : `${nAll} assemblies in ${groups.length} structural groups.`
                + (mode === 'overview'
                  ? ` Detailed pairwise view is shown for sets of up to ${DETAIL_MAX} assemblies.` : '')}
          </p>
          {mode === 'detail' ? (
            <DissimilarityHeatmap key={groupView ? sel.id : 'all'}
                                  order={view.order} labels={labels}
                                  matrix={hm.matrix} cellLabel={QUANTITY} metaOf={metaOf}
                                  colorOf={colours} onPick={onPick} onSize={setPanelSize}
                                  dragSelect={false} rmsd={data.heatmap.rmsd || null}
                                  pickable={(id) => !comparison && inSel.has(id)}
                                  pickNote={comparison ? 'representative comparison'
                                    : 'outside the selected structural group'}
                                  block={view.block} bands={view.bands}
                                  leftGutter={DENDRO_W}
                                  leftPanel={({ cell, top: y0 }) => (
                                    <Dendrogram clustering={view.clustering} cell={cell} top={y0}
                                                width={DENDRO_W} selectedId={sel.id}
                                                labels={labels}
                                                compare={comparison ? comparison.entries : null}
                                                onSelectGroup={selectGroup} />
                                  )}
                                  toolbar={canScope ? viewSwitch : null} />
          ) : (
            <Measured onSize={setPanelSize}>
              <div className="cs-hm-bar">{viewSwitch}</div>
              {mode !== 'overview' && (
                <div className="sg-hidden">
                  <p>
                    {mode === 'single'
                      ? `${sel.label} has one assembly, so there are no pairs inside it to show.`
                      : `${sel.members.length} assemblies in this structural group. Detailed `
                        + `pairwise view is hidden for sets larger than ${DETAIL_MAX} assemblies.`}
                  </p>
                  <p className="sg-hidden-actions">
                    <button type="button" className="sg-nbbtn"
                            onClick={() => download('dendrogram', 'svg', 'Dendrogram SVG')}>
                      Download full dendrogram
                    </button>
                    <button type="button" className="sg-nbbtn" onClick={() => setNbOpen(true)}>
                      Explore clustering in notebook
                    </button>
                  </p>
                </div>
              )}
              <GroupOverview clustering={clustering} selectedId={sel.id}
                             onSelectGroup={selectGroup} quantity={QUANTITY}
                             compare={comparison ? [
                               { ...comparison.entries[0], groupId: sel.id },
                               { ...comparison.entries[1], groupId: other.id }] : null} />
            </Measured>
          )}
        </div>

        <div className="card cs-viewer">
          {comparison ? (
            <>
              <h2>Representative comparison {helpHint(COMPARE_HELP)}</h2>
              <p className="note">{sel.label} vs {other.name}</p>
            </>
          ) : (
            <>
              <h2>
                Superposition view {helpHint(VIEWER_HELP)}
                <span className="cs-count"
                      title={`Members of ${sel.label} displayed. Up to ${MAX_SHOWN} can be superposed at once.`}>
                  {shown.length} of {sel.members.length}
                </span>
                {!atOpening && (
                  <button className="cs-linkbtn cs-clear-inline" onClick={resetView}
                          title={large ? `Return to the representative of ${sel.label}`
                                       : `Display every member of ${sel.label} again`}>
                    {large ? 'reset' : 'show all'}
                  </button>
                )}
              </h2>
              <p className="note">
                {large
                  ? `${sel.label} contains ${sel.members.length} assemblies. Showing the representative by default.`
                  : sel.label}
              </p>
            </>
          )}
          <div className="sg-viewer-extras" ref={extrasRef}>
            {comparison ? (
              <ComparePanel selected={sel} other={other} comparison={comparison}
                            onExit={() => selectGroup(sel.id)} />
            ) : other && (
              <CompareControl groups={groups} selected={sel} withId={other.id}
                              onWith={setCompareWith}
                              onCompare={() => { setCompareWith(other.id); setNotice(null); setComparing(true) }} />
            )}
            {!comparison && notice && <p className="cs-notice">{notice}</p>}
          </div>
          <SuperpositionViewer basePath={basePath} entries={entries}
                               height={Math.max(320, panelSize - extrasH)} />
        </div>

        <AssociatedFeatures selection={sel} stats={stats} total={data.assemblies.length}
                            anyModified={anyModified} />
      </div>

    </div>
  )
}
