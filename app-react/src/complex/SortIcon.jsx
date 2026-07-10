import React from 'react'

// Sort-direction indicator drawn as an inline SVG. A Unicode glyph (▲/▼/↕) can't be reliably
// centred — geometric arrows carry font-dependent vertical metrics — so we draw two triangles and
// let flexbox align them to the label. dir: 'asc' | 'desc' | null (null = unsorted, both dimmed).
export default function SortIcon({ dir }) {
  return (
    <svg className="sort-ic" width="8" height="11" viewBox="0 0 8 11" aria-hidden="true" focusable="false">
      <path className={dir === 'asc' ? 'on' : ''} d="M4 0 L7.5 4 L0.5 4 Z" />
      <path className={dir === 'desc' ? 'on' : ''} d="M4 11 L0.5 7 L7.5 7 Z" />
    </svg>
  )
}
