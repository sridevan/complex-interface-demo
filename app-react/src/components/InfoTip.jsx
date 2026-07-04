import React from 'react'

// Small "i" badge next to a header; reveals a styled tooltip on hover/focus. Use it to keep the
// visible note to one concise line while parking definitions/caveats one interaction away.
export default function InfoTip({ text }) {
  return (
    <span className="infotip" tabIndex={0} role="note" aria-label={text}>
      <span className="infotip-badge">i</span>
      <span className="infotip-pop">{text}</span>
    </span>
  )
}
