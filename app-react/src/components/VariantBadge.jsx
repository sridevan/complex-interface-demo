import React, { useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// Small badge marking an antigen interface residue that carries a natural sequence variant
// (PDBe mutated_AA_or_NA, type == "Variant") in one or more deposited structures — e.g. K417N.
// Purely from the API: a residue is badged iff it is BOTH an interface residue AND reported as a
// Variant. Escape mutations (K417N/E484K/N501Y…) surface here when the antibody footprints them.
// The dark popup (portaled, position:fixed) mirrors the Hint convention so it is never clipped by a
// scrolling table. `variants` = [{ label, structures:[pdb,…] }].
export default function VariantBadge({ variants }) {
  const ref = useRef(null)
  const [pos, setPos] = useState(null)
  const POP_W = 260
  if (!variants || !variants.length) return null

  const labels = variants.map((v) => v.label)
  const shown = labels[0] + (labels.length > 1 ? ` +${labels.length - 1}` : '')
  const text = 'Natural sequence variant at this epitope residue (PDBe, type “Variant”):\n'
    + variants.map((v) => `• ${v.label} — in ${v.structures.length} structure(s): ${v.structures.join(', ')}`).join('\n')

  const show = () => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - POP_W - 8)) })
  }
  const hide = () => setPos(null)
  return (
    <span className="vbadge" ref={ref} tabIndex={0} role="note" aria-label={text}
          onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}
          onClick={(e) => { e.stopPropagation(); e.preventDefault() }}>
      {shown}
      {pos && createPortal(
        <span className="hint-pop" style={{ top: pos.top, left: pos.left, maxWidth: POP_W, whiteSpace: 'pre-line' }}>{text}</span>,
        document.body,
      )}
    </span>
  )
}
