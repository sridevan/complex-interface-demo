import React, { useEffect, useMemo, useRef, useState } from 'react'
import { methodLabel } from '../states/methods'
import DissimilarityHeatmap from '../states/DissimilarityHeatmap.jsx'
import { summariseSelection } from '../states/BlockSummary.jsx'
import SuperpositionViewer from '../states/SuperpositionViewer.jsx'
import Hint, { helpHint } from '../components/Hint.jsx'
import SortIcon from '../components/SortIcon.jsx'
import { Pager } from '../components/Pager.jsx'
import { structuralGroups } from './clustering'
import Dendrogram from './Dendrogram.jsx'
import GroupOverview from './GroupOverview.jsx'
import { GroupsCard, AssociatedFeatures, GROUP_NOTE, SMALL_GROUP } from './GroupPanels.jsx'
import { groupFeatures } from './features'
import ExportMenu from './ExportMenu.jsx'
import { exportFigure, exportTable, exportPairs, HEATMAP_EXPORT_MAX } from './exportFigures'
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

const PAGE_SIZE = 10
// A group of up to this many assemblies is shown with every member aligned; a larger one by its
// representative alone. What is shown is fixed by the group: there is no adding or removing of
// structures by hand, which is exploration and belongs in the notebook.
//
// Eight, not ten: eight is as many colours as can be told apart by every reader. Checked with
// the dataviz palette validator over all pairs: the worst pair under a colour-vision deficiency
// is dE 7.1 (protan), the worst for normal vision 15.6, and no ten-colour set searched came
// close. Each structure is also named in the legend, so identity never rests on colour alone.
const OVERLAY_MAX = 8
// One colour per aligned member. The first six are Okabe-Ito, as on the similarity page, so a
// structure shown on both keeps a familiar colour; the representative always takes the first.
const SERIES = ['#0072B2', '#D55E00', '#009E73', '#CC79A7', '#56B4E9', '#E69F00', '#9F3960',
                '#815C0A']
// One rule for what the page draws. The instance-level view, a matrix cell for every pair and a
// dendrogram leaf for every assembly, is drawn for a complex of at most this many assemblies.
// Above it the page shows the groups themselves, and nothing finer: looking inside a group is
// left to the notebook, which is where any re-cutting of the tree belongs. A choice about
// legibility and scope, not about the data: every pair is still computed, and the full tree and
// table are in the downloads.
const DETAIL_MAX = 50
// Width of the dendrogram gutter, px.
const DENDRO_W = 124

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
  ['Hovering', 'A cell gives the pair\'s 1 \u2212 TM-score and backbone RMSD. Cells are not '
    + 'clickable: what the 3D view shows is decided by the selected group.'],
]
const OVERVIEW_HELP = [
  ['Reading it', 'The clustering tree, drawn down to the structural groups. Each group is one '
    + 'wedge: its point marks the largest dissimilarity merged inside the group, so a longer '
    + 'wedge is a more varied group.'],
  ['Group size', 'Taller rows are larger groups, within limits, so that a group of one stays '
    + 'visible. The count and the bar under it give the exact share of assemblies.'],
  ['Detail', `The pairwise matrix and a leaf for every assembly are drawn for complexes of up `
    + `to ${DETAIL_MAX} assemblies. Above that the page stops at the groups. The full tree and `
    + 'table are in the downloads, and the notebook is where to look inside a group or try '
    + 'another grouping.'],
]
// The viewer shows the representative of the selected group and nothing more. Overlaying a
// group's members, or any other subset, is exploration, and exploration belongs in the notebook;
// the one comparison the page offers is between two groups' representatives.
const VIEWER_HELP = [
  ['What you see', `A group of up to ${OVERLAY_MAX} assemblies with every member aligned, one `
    + 'colour each, the representative first. A larger group by its representative alone, in the '
    + 'group\'s colour. Backbone traces, each placed by a single global alignment onto the same '
    + 'reference assembly.'],
  ['What you can change', 'Nothing here: the group decides what is drawn. Use Compare '
    + 'representatives to align it with another group\'s representative, and the notebook for '
    + 'any other subset.'],
]
const COMPARE_HELP = [
  ['In the dendrogram', 'Each representative is drawn in its group\'s colour, in the viewer and '
    + 'on the tree, and the route between them through the tree is drawn in black. The further left it reaches, the more dissimilar '
    + 'the merge that joins them.'],
  ['What you see', 'The representative of the selected group and the representative of one other '
    + 'group, aligned, and no other structure. Each is the medoid of its group.'],
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
  const [sort, setSort] = useState({ key: null, dir: 'asc' })
  const [page, setPage] = useState(0)
  const [panelSize, setPanelSize] = useState(520)
  const [nbOpen, setNbOpen] = useState(false)
  const [exportError, setExportError] = useState(null)
  // Narrows the table to the selected group. For a table of hundreds, where a group's members
  // otherwise start part-way down a page and run on for a dozen more.
  const [groupOnly, setGroupOnly] = useState(false)
  // Representative comparison. `compareWith` is the group chosen in the selector; `comparing` says
  // whether the viewer is showing the two representatives instead of the group. Neither is part
  // of the analytical selection: selectedId is, and nothing here writes it.
  const [compareWith, setCompareWith] = useState(null)
  const [comparing, setComparing] = useState(false)
  // Height of what sits between the viewer card's note and the viewer itself: the comparison box
  // The heatmap card has nothing in that position, so the viewer gives up exactly
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

  const selectGroup = (id) => {
    const g = clustering.groups.find((x) => x.id === id)
    if (!g) return
    setSelectedId(id)
    // Selecting a group always lands on that group's own view, so a comparison in progress ends.
    setComparing(false)
    // The table follows the dendrogram, so a group is a run of consecutive rows. Turn to the page
    // it starts on, or selecting a group in a table of hundreds shows rows from another one.
    setPage(!sort.key && !groupOnly ? Math.floor(g.from / PAGE_SIZE) : 0)
  }
  // Opens on the largest group, and returns to it whenever the grouping itself is recomputed.
  useEffect(() => { if (clustering) selectGroup(1) }, [clustering])   // eslint-disable-line
  useEffect(() => { setPage(0) }, [sort.key, sort.dir, basePath])

  const sel = useMemo(() => {
    const g = clustering && clustering.groups.find((x) => x.id === selectedId)
    return g ? { id: g.id, label: g.name, color: g.color, members: g.members, from: g.from,
                 to: g.to, representative: g.representative } : null
  }, [clustering, selectedId])

  const stats = useMemo(() => (sel ? summariseSelection({
    block: sel.members, assemblies: data.assemblies, labels, matrix: hm.matrix,
    rmsd: data.heatmap.rmsd || null }) : null), [sel, data, labels, hm])
  const features = useMemo(
    () => (sel ? groupFeatures(sel.members, data.assemblies) : null), [sel, data])

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
  const overview = nAll > DETAIL_MAX     // too many assemblies for the instance-level view
  const view = { clustering, order,
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
  // What is on screen: the two representatives while comparing; otherwise every member of a
  // small group, representative first; otherwise the representative alone, in the group's
  // colour. The same map colours the rows in the table and the labels on the matrix.
  const overlay = sel.members.length <= OVERLAY_MAX
  const entries = comparison ? comparison.entries
    : overlay
      ? [sel.representative, ...sel.members.filter((m) => m !== sel.representative)]
          .map((id, i) => ({ assembly_id: id, color: SERIES[i] }))
      : [{ assembly_id: sel.representative, color: sel.color }]
  const colours = Object.fromEntries(entries.map((e) => [e.assembly_id, e.color]))

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
    ['pairs', 'csv', 'Pairwise dissimilarity CSV'],
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
    : what === 'pairs'
    ? exportPairs({ fileStem: data.complex_id, labels, matrix: hm.matrix,
                    rmsd: data.heatmap.rmsd || null, groupOf })
    : exportFigure(what, format, {
        fileStem: data.complex_id, title: `${title} (${data.complex_id})`,
        quantity: QUANTITY, labels, matrix: hm.matrix, clustering }))
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
            {overview && (
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
              ...(overview ? OVERVIEW_HELP : HEATMAP_HELP)])}</span>
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
            {overview
              ? `${nAll} assemblies in ${groups.length} structural groups. The pairwise matrix and `
                + `dendrogram are drawn for complexes of up to ${DETAIL_MAX} assemblies.`
              : 'Select a structural group to highlight its assemblies and inspect its structural similarity.'}
          </p>
          {/* The page presents one grouping and does not open a group up. Said where a reader
              would look for that, beside the tree, with the way to do it. */}
          <p className="note sg-nb-note">
            To explore the clustering within a structural group, or to try other methods and
            parameters, use the{' '}
            <button type="button" className="cs-linkbtn" onClick={() => setNbOpen(true)}>
              analysis notebook
            </button>.
          </p>
          {!overview ? (
            <DissimilarityHeatmap key="all"
                                  order={view.order} labels={labels}
                                  matrix={hm.matrix} cellLabel={QUANTITY} metaOf={metaOf}
                                  colorOf={colours} onPick={() => {}} onSize={setPanelSize}
                                  dragSelect={false} rmsd={data.heatmap.rmsd || null}
                                  pickable={() => false} pickNote={null}
                                  block={view.block} bands={view.bands}
                                  leftGutter={DENDRO_W}
                                  leftPanel={({ cell, top: y0 }) => (
                                    <Dendrogram clustering={view.clustering} cell={cell} top={y0}
                                                width={DENDRO_W} selectedId={sel.id}
                                                labels={labels}
                                                compare={comparison ? comparison.entries : null}
                                                onSelectGroup={selectGroup} />
                                  )}
                                  toolbar={null} />
          ) : (
            <Measured onSize={setPanelSize}>
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
              <h2>3D alignment view {helpHint(VIEWER_HELP)}</h2>
              <p className="note">
                {overlay
                  ? `${sel.label}: ${sel.members.length === 1 ? 'its one assembly'
                      : `all ${sel.members.length} assemblies aligned`}`
                  : `${sel.label} contains ${sel.members.length} assemblies. Showing the `
                    + `representative, ${sel.representative}.`}
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
                              onCompare={() => { setCompareWith(other.id); setComparing(true) }} />
            )}
          </div>
          <SuperpositionViewer basePath={basePath} entries={entries}
                               height={Math.max(320, panelSize - extrasH)} />
        </div>

        <AssociatedFeatures selection={sel} features={features}
                            small={sel.members.length < SMALL_GROUP} />
      </div>

    </div>
  )
}
