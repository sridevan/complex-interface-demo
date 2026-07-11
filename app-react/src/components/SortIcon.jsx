import React from 'react'

// Sort-direction indicator drawn as an inline SVG. A Unicode glyph (▲/▼/↕) can't be reliably
// centred — geometric arrows carry font-dependent vertical metrics — so we draw two triangles and
// let flexbox align them to the label. Both are solid black when unsorted; when a direction is
// active the opposite triangle dims, so the bold arrow reads as the current sort. dir: 'asc'|'desc'|null.
export default function SortIcon({ dir }) {
  return (
    <svg className="sort-ic" width="9" height="12" viewBox="0 0 9 12" aria-hidden="true" focusable="false">
      <path className={dir === 'desc' ? 'off' : ''} d="M4.5 0 L8.5 5 L0.5 5 Z" />
      <path className={dir === 'asc' ? 'off' : ''} d="M4.5 12 L0.5 7 L8.5 7 Z" />
    </svg>
  )
}
