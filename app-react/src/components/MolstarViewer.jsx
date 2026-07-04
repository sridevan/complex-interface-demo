import React, { useEffect, useRef, useState } from 'react'

const BASE = import.meta.env.BASE_URL || '/'

// Loads a pre-built .mvsj scene into an embedded Mol* viewer (Mol* from CDN, see index.html).
export default function MolstarViewer({ mvsj, height = 460 }) {
  const hostRef = useRef(null)
  const viewerRef = useRef(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function run() {
      const molstar = window.molstar
      if (!molstar) { setErr('Mol* failed to load from CDN (needs internet).'); return }
      try {
        if (!viewerRef.current) {
          viewerRef.current = await molstar.Viewer.create(hostRef.current, {
            layoutIsExpanded: false, layoutShowControls: false, pdbProvider: 'pdbe',
          })
        }
        const text = await fetch(`${BASE}mvs/${mvsj}`).then((r) => r.text())
        if (cancelled) return
        const data = molstar.PluginExtensions.mvs.MVSData.fromMVSJ(text)
        await molstar.PluginExtensions.mvs.loadMVS(viewerRef.current.plugin, data,
          { replaceExisting: true, sanityChecks: true })
        setErr(null)
      } catch (e) { setErr(String(e)) }
    }
    if (mvsj) run()
    return () => { cancelled = true }
  }, [mvsj])

  return (
    <>
      <div className="viewer" ref={hostRef} style={{ height }} />
      {err && <p className="note" style={{ color: '#b1442f' }}>{err}</p>}
    </>
  )
}
