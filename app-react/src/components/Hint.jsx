import React, { useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// Small "?" help badge with a styled dark popup (black background, white text). The popup is
// rendered into document.body via a portal and positioned with position:fixed, so it is never
// clipped by a scrolling table / overflow ancestor (.ex-scroll, .table-scroll). Opens downward
// from the badge; left is clamped to stay on-screen. stopPropagation keeps a click on the badge
// from triggering a sortable header's sort handler.
// `text` may be a string or JSX. When it is JSX, pass `aria` with the plain-text equivalent —
// otherwise the badge announces nothing to a screen reader. `width` widens the popup for help
// that is a list rather than a sentence.
export default function Hint({ text, aria, width = 260 }) {
  const ref = useRef(null)
  const [pos, setPos] = useState(null)
  const POP_W = width
  const show = () => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - POP_W - 8)) })
  }
  const hide = () => setPos(null)
  return (
    <span className="hint" ref={ref} tabIndex={0} role="note"
          aria-label={typeof text === 'string' ? text : aria}
          onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}
          onClick={(e) => { e.stopPropagation(); e.preventDefault() }}>
      ?
      {pos && createPortal(
        <span className="hint-pop" style={{ top: pos.top, left: pos.left, maxWidth: POP_W }}>{text}</span>,
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
