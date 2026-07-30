import React, { useEffect, useRef, useState } from 'react'

const BASE = import.meta.env.BASE_URL || '/'

// The served assembly CIFs are already superposed onto the reference assembly at build time
// (scripts/build_instance_similarity.py), so the viewer never applies a matrix itself —
// it just draws each file in the frame it arrives in.
const cifUrl = (basePath, asm) => `${BASE}${basePath}/assemblies/${asm}.cif`

// entries: [{ assembly_id, color }] — colour comes from the caller's stable slot assignment, so a
// structure keeps its colour when others are removed.
export default function SuperpositionViewer({ basePath, entries, height = 520 }) {
  const hostRef = useRef(null)
  const viewerRef = useRef(null)
  const cacheRef = useRef(new Map())     // assembly_id -> mmCIF text, so re-selecting is instant
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
    v.zoomTo(); v.render()
  }

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
          const model = viewer.addModel(text, 'cif')
          // Backbone only: a cartoon trace draws the polymer backbone and leaves ligands, ions and
          // waters unstyled (and so invisible), which is exactly the requested representation.
          viewer.setStyle({ model }, { cartoon: { color: e.color, arrows: false } })
        }
        if (cancelled) return
        viewer.zoomTo()
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
