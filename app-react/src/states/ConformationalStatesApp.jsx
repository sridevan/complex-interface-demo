import React, { useEffect, useMemo, useState } from 'react'
import DissimilarityHeatmap, { HEATMAP_HELP } from './DissimilarityHeatmap.jsx'
import Hint from '../components/Hint.jsx'
import SuperpositionViewer from './SuperpositionViewer.jsx'
import SortIcon from '../components/SortIcon.jsx'
import '../styles.css'

const BASE = import.meta.env.BASE_URL || '/'

export const MAX_SHOWN = 5

// Categorical palette for the superposed structures, checked with the dataviz palette validator
// (all-pairs, light surface): passes the lightness band, chroma floor and normal-vision floor.
// Worst CVD separation is deutan dE 7.6, which is only admissible alongside secondary encoding —
// hence every structure is also named, in the viewer legend and in the table.
// Colours are held per SLOT, not per position in the selection, so removing one structure never
// repaints the others.
const SERIES = ['#0072B2', '#D55E00', '#009E73', '#CC79A7', '#56B4E9']

const COLS = [
  { key: 'assembly_id', label: 'Assembly' },
  { key: 'structure_title', label: 'Structure title' },
  { key: 'resolution', label: 'Resolution (Å)', num: true },
  { key: 'exp_method', label: 'Method' },
]

export default function ConformationalStatesApp({ config }) {
  const { basePath, complexId, title, organism } = config
  const [data, setData] = useState(null)
  const [slots, setSlots] = useState(Array(MAX_SHOWN).fill(null))
  // `notice` is a routine limit warning shown beside the viewer; `error` is fatal and replaces the
  // page. Sharing one channel meant a failed fetch rendered nothing at all (data stayed null).
  const [notice, setNotice] = useState(null)
  const [error, setError] = useState(null)
  const [sort, setSort] = useState({ key: null, dir: 'asc' })   // null = heatmap (seriation) order

  useEffect(() => {
    fetch(`${BASE}${basePath}/instance_similarity.json`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((d) => {
        setData(d)
        // Preselect the table's first row — which is the first assembly in the heatmap's seriation
        // order — so the page never opens on an empty viewer.
        const first = d.heatmap.order[0]
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
  // Default order matches the heatmap (seriation), so a row's position in the table is the same as
  // its position along the matrix. A column sort overrides it; a third click on that column
  // restores the heatmap order.
  const seriation = Object.fromEntries(data.heatmap.order.map((a, i) => [a, i]))
  const rows = [...data.assemblies].sort((x, y) => {
    if (!sort.key) return seriation[x.assembly_id] - seriation[y.assembly_id]
    const a = x[sort.key], b = y[sort.key]
    if (a == null) return 1
    if (b == null) return -1
    const cmp = typeof a === 'number' ? a - b : String(a).localeCompare(String(b))
    return sort.dir === 'asc' ? cmp : -cmp
  })
  const onSort = (key) => setSort((s) => {
    if (s.key !== key) return { key, dir: 'asc' }
    if (s.dir === 'asc') return { key, dir: 'desc' }
    return { key: null, dir: 'asc' }
  })

  return (
    <div className="wrap">
      <div className="page-head">
        <h1>{title}</h1>
        <a className="complex-id" href={`https://www.ebi.ac.uk/pdbe/pdbe-kb/complexes/${complexId}`}
           target="_blank" rel="noreferrer" title="View this complex on PDBe-KB">{complexId}</a>
        {organism && <i className="page-organism">{organism}</i>}
      </div>

      <div className="cs-grid">
        <div className="card cs-instances">
          <h2>Assembly instances</h2>
          <p className="note">
            Select up to {MAX_SHOWN} instances to superpose. The table and the heatmap share one
            selection.
          </p>
          <div className="cs-toolbar">
            <span className="cs-order">
              Order: <b>{sort.key ? COLS.find((c) => c.key === sort.key)?.label : 'similarity (heatmap)'}</b>
            </span>
            {sort.key && (
              <button className="cs-linkbtn" onClick={() => setSort({ key: null, dir: 'asc' })}
                      title="Return the rows to the heatmap's ordering">
                restore similarity order
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
                {rows.map((r) => {
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
                      </td>
                      <td className="cs-title" title={r.structure_title}>{r.structure_title}</td>
                      <td className="num">{r.resolution ?? '—'}</td>
                      <td>{r.exp_method ?? '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card cs-heatmap">
          <h2>How similar is every pair? <Hint text={HEATMAP_HELP} /></h2>
          <p className="note">
            All {data.assemblies.length} instances compared against each other —{' '}
            {(data.assemblies.length * (data.assemblies.length - 1) / 2).toLocaleString()} pairs,
            scored on global shape ({data.method.score_type} of the spectral and Zernike measures).
          </p>
          <DissimilarityHeatmap order={data.heatmap.order} labels={data.heatmap.labels}
                                matrix={data.heatmap.matrix} metaOf={metaOf}
                                colorOf={colorOf} onPick={onPick} />
        </div>

        <div className="card cs-viewer">
          <h2>
            3D view
            <span className="cs-count" title={`Up to ${MAX_SHOWN} instances can be superposed`}>
              {shown.length} of {MAX_SHOWN}
            </span>
            {shown.length > 0 && (
              <button className="cs-linkbtn cs-clear-inline" onClick={clearAll}
                      title="Clear the current selection">clear</button>
            )}
          </h2>
          <p className="note">
            Compare the selected instances directly: backbone trace only, one colour each, all
            superposed onto {data.reference_assembly}.
          </p>
          {/* Beside the viewer, not at the top of the page: this fires on a heatmap or table click,
              and a message above row 1 is off-screen once the page is scrolled. */}
          {notice && <p className="cs-notice">{notice}</p>}
          <SuperpositionViewer basePath={basePath} entries={shown} />
        </div>
      </div>
    </div>
  )
}
