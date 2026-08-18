import React, { useEffect, useRef, useState } from 'react'

const BASE = import.meta.env.BASE_URL || '/'

// The served assembly CIFs are already superposed onto the reference assembly at build time
// (scripts/build_instance_similarity.py), so the viewer never applies a matrix itself —
// it just draws each file in the frame it arrives in.
const cifUrl = (basePath, asm) => `${BASE}${basePath}/assemblies/${asm}.cif`


// --- natural orientation -----------------------------------------------------------------------
//
// Deposited coordinate frames are arbitrary, so a superposed set arrives pointing wherever the
// reference happened to point. On an elongated assembly that often means looking straight down its
// long axis: ATP synthase opened as a top view of the F1 head, and had to be re-oriented by hand
// before it read as the rotary machine it is.
//
// The fix is geometry, not per-complex knowledge, so it works on any dataset: take the principal
// axes of the CA cloud and put the longest one up the screen, the second across it, and view down
// the shortest. Viewing down the shortest axis is the projection with the most spread and the least
// foreshortening — the "side on" view for anything elongated. For a globular assembly the axes are
// near-degenerate and the choice barely matters, which is the right behaviour there too.
//
// What this deliberately does NOT do is decide which END is up: principal axes are undirected, so
// membrane-down versus membrane-up is a coin toss that only biology could settle. Signs are fixed
// to a deterministic rule so the view is at least stable and reproducible, never guessed.
const caCoords = (cif) => {
  const out = []
  for (const line of cif.split('\n')) {
    if (line.charCodeAt(0) !== 65 /* A */ || !line.startsWith('ATOM')) continue
    const f = line.split(/\s+/)
    if (f[3] !== 'CA') continue
    const x = +f[10], y = +f[11], z = +f[12]
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) out.push([x, y, z])
  }
  return out
}

// Eigenvectors of a 3x3 symmetric matrix by cyclic Jacobi. Small and exact enough here, and it
// avoids pulling a linear-algebra dependency into the bundle for one 3x3 problem.
function jacobiEigen(A) {
  const a = A.map((r) => r.slice())
  let V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
  for (let sweep = 0; sweep < 24; sweep++) {
    let off = 0
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) off += a[i][j] * a[i][j]
    if (off < 1e-18) break
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) {
      if (Math.abs(a[p][q]) < 1e-15) continue
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q])
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
      const c = 1 / Math.sqrt(t * t + 1), s = t * c
      for (let k = 0; k < 3; k++) {
        const akp = a[k][p], akq = a[k][q]
        a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p][k], aqk = a[q][k]
        a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk
      }
      for (let k = 0; k < 3; k++) {
        const vkp = V[k][p], vkq = V[k][q]
        V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq
      }
    }
  }
  const eig = [0, 1, 2].map((i) => ({ val: a[i][i], vec: [V[0][i], V[1][i], V[2][i]] }))
  eig.sort((x, y) => y.val - x.val)          // largest variance first
  return eig
}

// Rotation taking world coordinates into the view frame: PC1 -> screen y, PC2 -> screen x,
// PC3 -> screen z (towards the camera, so we look down the thinnest direction).
function principalRotation(coords) {
  const n = coords.length
  if (n < 12) return null
  const c = [0, 0, 0]
  for (const p of coords) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2] }
  c[0] /= n; c[1] /= n; c[2] /= n
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  for (const p of coords) {
    const d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]]
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += d[i] * d[j]
  }
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] /= n
  const e = jacobiEigen(C)
  // Sign is arbitrary out of the solver; pin it so the same structure always lands the same way up.
  const fix = (v) => {
    let k = 0
    for (let i = 1; i < 3; i++) if (Math.abs(v[i]) > Math.abs(v[k])) k = i
    return v[k] < 0 ? v.map((x) => -x) : v
  }
  const y = fix(e[0].vec), x = fix(e[1].vec)
  // Third axis from a cross product rather than the solver, so the frame is guaranteed
  // right-handed; a left-handed one would mirror the structure on screen.
  const z = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]]
  return { R: [x, y, z], centre: c }
}

// Applies the rotation to the mmCIF text rather than to the atoms after loading. Mutating atom
// objects does rotate what is DRAWN, but 3Dmol keeps the model extent it computed at addModel time,
// so zoomTo then frames the old bounding box: the structure rendered correctly and sat off-centre
// and clipped, and "Centre view" could not fix it because it fits the same stale extent. Rotating
// the text means every later calculation, framing included, sees one consistent frame.
function rotateCif(cif, { R, centre }) {
  const out = []
  for (const line of cif.split('\n')) {
    if (!line.startsWith('ATOM') && !line.startsWith('HETATM')) { out.push(line); continue }
    const f = line.split(/\s+/)
    const x = +f[10], y = +f[11], z = +f[12]
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) { out.push(line); continue }
    const d = [x - centre[0], y - centre[1], z - centre[2]]
    for (let i = 0; i < 3; i++) {
      f[10 + i] = (R[i][0] * d[0] + R[i][1] * d[1] + R[i][2] * d[2]).toFixed(3)
    }
    out.push(f.join(' '))
  }
  return out.join('\n')
}

// zoomTo() fits to the bounding box with no margin at all, and overshoots it: measured on the
// rendered image, ATP synthase lost its stalk off the bottom edge and ATCase touched the right.
// Pulling back to 0.82 leaves a consistent margin on every complex without making anything small.
const FIT = 0.82
const fit = (v) => { v.zoomTo(); v.zoom(FIT) }

// entries: [{ assembly_id, color }] — colour comes from the caller's stable slot assignment, so a
// structure keeps its colour when others are removed.
export default function SuperpositionViewer({ basePath, entries, height = 520 }) {
  const hostRef = useRef(null)
  const viewerRef = useRef(null)
  const cacheRef = useRef(new Map())     // assembly_id -> mmCIF text, so re-selecting is instant
  // Orientation is computed once per complex from the first structure loaded and then reused. Every
  // instance on a page is already superposed onto the same reference, so any of them gives the same
  // axes — and reusing one keeps the view still when structures are added or removed, instead of
  // swinging to a slightly different frame on each change.
  const orientRef = useRef({ basePath: null, orient: null })
  const frameRef = useRef(null)
  const [isFull, setIsFull] = useState(false)
  const [err, setErr] = useState(null)
  const [loading, setLoading] = useState(false)

  const toggleFullscreen = () => {
    const el = frameRef.current
    if (!el) return
    if (document.fullscreenElement) document.exitFullscreen?.()
    else el.requestFullscreen?.()
  }
  useEffect(() => {
    const onChange = () => {
      setIsFull(document.fullscreenElement === frameRef.current)
      const v = viewerRef.current
      if (v) setTimeout(() => { try { v.resize(); v.render() } catch { /* noop */ } }, 80)
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const recenter = () => {
    const v = viewerRef.current
    if (!v) return
    v.resize(); fit(v); v.render()
  }

  // The panel is sized from the heatmap beside it, so the container grows AFTER the viewer is
  // created, and 3Dmol only recomputes its camera aspect when told to. Without this the projection
  // stays fitted to the height the viewer happened to be born at, which framed a tall assembly
  // clipped and low — ATP synthase lost its whole membrane region off the bottom edge. Observing
  // the host covers the panel settling, the window resizing and the card reflowing alike.
  useEffect(() => {
    const el = hostRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let frame = null
    const ro = new ResizeObserver(() => {
      if (frame) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const v = viewerRef.current
        if (!v) return
        try { v.resize(); fit(v); v.render() } catch { /* viewer torn down */ }
      })
    })
    ro.observe(el)
    return () => { if (frame) cancelAnimationFrame(frame); ro.disconnect() }
  }, [])

  // Key on the ids + colours so re-render only reloads when the selection actually changes.
  const key = entries.map((e) => `${e.assembly_id}:${e.color}`).join(',')

  useEffect(() => {
    let cancelled = false
    async function run() {
      const $3Dmol = window.$3Dmol
      if (!$3Dmol) { setErr('3Dmol failed to load from CDN (needs internet).'); return }
      try {
        if (!viewerRef.current) {
          viewerRef.current = $3Dmol.createViewer(hostRef.current, { backgroundColor: 'white' })
        }
        const viewer = viewerRef.current
        viewer.clear()
        if (!entries.length) { viewer.render(); setErr(null); return }

        setLoading(true)
        for (const e of entries) {
          let text = cacheRef.current.get(e.assembly_id)
          if (text == null) {
            const r = await fetch(cifUrl(basePath, e.assembly_id))
            if (!r.ok) throw new Error(`${e.assembly_id}: HTTP ${r.status}`)
            text = await r.text()
            cacheRef.current.set(e.assembly_id, text)
          }
          if (cancelled) return
          if (orientRef.current.basePath !== basePath) {
            orientRef.current = { basePath, orient: principalRotation(caCoords(text)) }
          }
          // The same rotation is applied to every structure in the scene, so the superposition is
          // untouched — this turns the whole scene, it does not move anything within it.
          const o = orientRef.current.orient
          const model = viewer.addModel(o ? rotateCif(text, o) : text, 'cif')
          // Backbone only: a cartoon draws the polymer backbone and leaves ligands, ions and
          // waters unstyled (and so invisible), which is exactly the requested representation.
          //
          // `ribbon` draws a smooth tube of even thickness along the spline, which is how PDBe-KB
          // draws its superposed structures. The default cartoon widens helices into ribbons and
          // flattens strands — right for reading ONE structure, wrong here: several overlaid
          // ribbons occlude each other, and their varying width exaggerates differences that are
          // only secondary-structure assignment. An even tube makes the actual backbone
          // displacement between instances the thing you see.
          //
          // Checked against the alternatives: `style:'trace'` is an unsmoothed polyline straight
          // between CA atoms, and `tubes:true` collapses each helix into a fat cylinder — both
          // read worse when several structures are overlaid.
          // `oval` + equal thickness and width gives a circular cross-section, so the tube reads
          // the same from every angle. 0.4 is lighter than the reference snapshot looks, and
          // deliberately: that snapshot is a single small domain, where a heavy tube still leaves
          // space between turns. Over a whole tetramer with up to five instances overlaid, a
          // heavier tube fuses neighbouring strands into one mass — the opposite of what a
          // superposition is for.
          viewer.setStyle({ model }, {
            cartoon: { color: e.color, style: 'oval', ribbon: true, arrows: false,
                       thickness: 0.4, width: 0.4 },
          })
        }
        if (cancelled) return
        // resize before framing: the camera aspect must match the container the structure is about
        // to be fitted into, or zoomTo fits the wrong one.
        viewer.resize()
        fit(viewer)
        viewer.render()
        setErr(null)
      } catch (e) {
        if (!cancelled) setErr(String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [key, basePath])

  return (
    <>
      <div className="viewer-wrap" ref={frameRef} style={{ height }}>
        <div ref={hostRef} className="viewer" style={{ height }} />
        <div className="viewer-btns">
          <button className="viewer-btn" onClick={toggleFullscreen} title="View the superposition fullscreen">
            {isFull ? 'Exit fullscreen' : 'Fullscreen'}
          </button>
          <button className="viewer-btn" onClick={recenter} title="Centre the view on all displayed structures">
            Centre view
          </button>
        </div>
        {entries.length > 0 && (
          <div className="viewer-legend cs-legend">
            <div className="vl-title">Displayed structures</div>
            {entries.map((e) => (
              <div key={e.assembly_id} className="vl-row">
                <span className="cs-swatch" style={{ background: e.color }} />{e.assembly_id}
              </div>
            ))}
          </div>
        )}
        {!entries.length && (
          <div className="cs-empty">
            Select structures in the table, or in the heatmap: a diagonal cell displays a single
            structure, a cell below the diagonal superposes that pair.
          </div>
        )}
        {loading && <div className="cs-loading">Loading…</div>}
      </div>
      {err && <p className="note" style={{ color: '#b1442f' }}>{err}</p>}
    </>
  )
}
