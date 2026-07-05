import React, { useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// Small "?" help badge with a styled dark popup (black background, white text). The popup is
// rendered into document.body via a portal and positioned with position:fixed, so it is never
// clipped by a scrolling table / overflow ancestor (.ex-scroll, .table-scroll). Opens downward
// from the badge; left is clamped to stay on-screen. stopPropagation keeps a click on the badge
// from triggering a sortable header's sort handler.
export default function Hint({ text }) {
  const ref = useRef(null)
  const [pos, setPos] = useState(null)
  const POP_W = 260
  const show = () => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - POP_W - 8)) })
  }
  const hide = () => setPos(null)
  return (
    <span className="hint" ref={ref} tabIndex={0} role="note" aria-label={text}
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
