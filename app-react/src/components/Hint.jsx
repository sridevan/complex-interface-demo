import React, { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// Small "?" help badge with a styled dark popup (black background, white text). The popup is
// rendered into document.body via a portal and positioned with position:fixed, so it is never
// clipped by a scrolling table / overflow ancestor (.ex-scroll, .table-scroll). stopPropagation
// keeps a click on the badge from triggering a sortable header's sort handler.
// `text` may be a string or JSX. When it is JSX, pass `aria` with the plain-text equivalent —
// otherwise the badge announces nothing to a screen reader. `width` widens the popup for help
// that is a list rather than a sentence.
//
// Placement is decided in two passes, because the popups differ hugely in height — one sentence for
// a table column, four paragraphs for the selection panel — and the height is only knowable once
// the content is in the DOM. The first pass puts it below the badge; a layout effect then measures
// it and, if it would run off the bottom, flips it above. Opening downward unconditionally clipped
// the tall popups on the lower cards, which is where the longest help happens to live.
export default function Hint({ text, aria, width = 260 }) {
  const ref = useRef(null)
  const popRef = useRef(null)
  const [pos, setPos] = useState(null)
  const POP_W = width
  const GAP = 6      // between badge and popup
  const EDGE = 8     // smallest gap left against the viewport edge

  const show = () => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    setPos({ top: r.bottom + GAP,
             left: Math.max(EDGE, Math.min(r.left, window.innerWidth - POP_W - EDGE)),
             maxH: null, placed: false })
  }
  const hide = () => setPos(null)

  useLayoutEffect(() => {
    if (!pos || pos.placed || !popRef.current || !ref.current) return
    const badge = ref.current.getBoundingClientRect()
    const h = popRef.current.getBoundingClientRect().height
    const below = window.innerHeight - badge.bottom - GAP - EDGE
    const above = badge.top - GAP - EDGE
    let top = badge.bottom + GAP
    let maxH = null
    if (h > below) {
      if (h <= above) {
        top = badge.top - GAP - h                 // flips above: the usual case near the page foot
      } else {
        // Taller than either side — only for the longest help on a short window. Pin it to
        // whichever side has more room and let it scroll rather than trailing off-screen.
        if (above > below) { top = EDGE; maxH = above }
        else { top = badge.bottom + GAP; maxH = below }
      }
    }
    setPos({ ...pos, top, maxH, placed: true })
  }, [pos])

  return (
    <span className="hint" ref={ref} tabIndex={0} role="note"
          aria-label={typeof text === 'string' ? text : aria}
          onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}
          onClick={(e) => { e.stopPropagation(); e.preventDefault() }}>
      ?
      {pos && createPortal(
        <span className="hint-pop" ref={popRef}
              style={{ top: pos.top, left: pos.left, maxWidth: POP_W,
                       // Hidden until measured, so the first frame below the badge is never seen.
                       visibility: pos.placed ? 'visible' : 'hidden',
                       ...(pos.maxH ? { maxHeight: pos.maxH, overflowY: 'auto' } : {}) }}>
          {text}
        </span>,
        document.body,
      )}
    </span>
  )
}

// One renderer for every multi-paragraph help popup, so they stay in the same voice and the
// plain-text version a screen reader gets is always derived from the same strings as the visible
// one. `entries` is [heading, text] pairs; `tail` is an optional closing paragraph with no heading.
export function helpHint(entries, { width = 330, tail = null } = {}) {
  const aria = [...entries.map(([n, t]) => `${n}: ${t}`), ...(tail ? [tail] : [])].join(' ')
  return (
    <Hint width={width} aria={aria} text={(
      <>
        {entries.map(([name, txt]) => (
          <span key={name} className="hint-para"><b>{name}:</b> {txt}</span>
        ))}
        {tail && <span className="hint-para">{tail}</span>}
      </>
    )} />
  )
}
