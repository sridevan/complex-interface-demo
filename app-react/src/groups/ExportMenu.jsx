import React, { useEffect, useRef, useState } from 'react'

// One compact "Download" menu. Knows nothing about what it downloads: the page passes the items
// it can actually produce, as [what, format, label], and `onExport(what, format)`, which may
// return a promise. An item the page cannot produce is left out rather than shown disabled. A
// failure is reported through onError and changes nothing else on the page.
export default function ExportMenu({ items, onExport, onError }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(null)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const key = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', key)
    }
  }, [open])

  const run = async (figure, format, label) => {
    setOpen(false)
    setBusy(label)
    onError(null)
    try {
      await onExport(figure, format)
    } catch (e) {
      onError(`${label} could not be exported: ${e && e.message ? e.message : 'unknown error'}.`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <span className="sg-export" ref={ref}>
      <button type="button" className="sg-nbbtn" aria-haspopup="menu" aria-expanded={open}
              disabled={!!busy} onClick={() => setOpen((v) => !v)}>
        {busy ? 'Preparing…' : 'Download'} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <span className="sg-export-menu" role="menu">
          {items.map(([figure, format, label]) => (
            <button key={label} type="button" role="menuitem"
                    onClick={() => run(figure, format, label)}>{label}</button>
          ))}
        </span>
      )}
    </span>
  )
}
