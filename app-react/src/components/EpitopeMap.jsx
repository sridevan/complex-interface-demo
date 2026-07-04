import React, { useEffect, useRef, useState } from 'react'
import NightingaleTrackCanvas from '@nightingale-elements/nightingale-track-canvas'
import NightingaleManager from '@nightingale-elements/nightingale-manager'
import NightingaleNavigation from '@nightingale-elements/nightingale-navigation'

// Guard-register the custom elements (idempotent — the packages may already self-register).
function reg(name, klass) {
  try { if (!customElements.get(name)) customElements.define(name, klass) } catch { /* already defined */ }
}
reg('nightingale-track-canvas', NightingaleTrackCanvas)
reg('nightingale-manager', NightingaleManager)
reg('nightingale-navigation', NightingaleNavigation)

// Antigen length (SARS-CoV-2 spike P0DTC2 is 1273 aa); the track spans the whole protein so the
// epitope's position along the antigen is visible, matching PDBe-KB's ProtVista idiom.
const ANTIGEN_LEN = 1273

function toFeatures(rows, key, color, label) {
  const vals = rows.map((r) => r[key] || 0)
  const max = Math.max(1, ...vals)
  return rows
    .filter((r) => r.antigen_uniprot_position != null && (r[key] || 0) > 0)
    .map((r) => ({
      accession: `${r.antigen_residue_name}${r.antigen_uniprot_position}`,
      start: r.antigen_uniprot_position,
      end: r.antigen_uniprot_position,
      color,
      fill: color,
      opacity: 0.25 + 0.75 * ((r[key] || 0) / max),
      tooltipContent: `${r.antigen_residue_name}${r.antigen_uniprot_position}: ${r[key]} ${label} contact pairs`,
    }))
}

const TRACKS = [
  { key: 'total_contacts', color: '#7a5195', label: 'all' },
  { key: 'heavy_chain_contacts', color: '#e19039', label: 'heavy' },
  { key: 'light_chain_contacts', color: '#4b7fcc', label: 'light' },
]

export default function EpitopeMap({ epitope, onSelect, selected }) {
  const navRef = useRef(null)
  const trackRefs = useRef(TRACKS.map(() => React.createRef()))
  const L = Math.max(ANTIGEN_LEN, ...epitope.map((r) => r.antigen_uniprot_position || 0))
  const [hover, setHover] = useState(null)

  // Configure navigation + tracks imperatively (properties/attributes on web components).
  // Wait until the elements actually have a measured width, otherwise Nightingale computes
  // negative-width rects during the 0-width first paint.
  useEffect(() => {
    let raf
    const configure = () => {
      const nav = navRef.current
      const first = trackRefs.current[0]?.current
      if (!nav || !first || first.getBoundingClientRect().width === 0) {
        raf = requestAnimationFrame(configure)
        return
      }
      nav.setAttribute('length', L)
      nav.setAttribute('display-start', 1)
      nav.setAttribute('display-end', L)
      trackRefs.current.forEach((ref, i) => {
        const el = ref.current
        if (!el) return
        el.setAttribute('length', L)
        el.setAttribute('display-start', 1)
        el.setAttribute('display-end', L)
        el.setAttribute('height', 26)
        el.setAttribute('layout', 'non-overlapping')
        el.setAttribute('highlight-color', 'rgba(122,81,149,0.28)')
        el.data = toFeatures(epitope, TRACKS[i].key, TRACKS[i].color, TRACKS[i].label)
      })
    }
    configure()
    return () => cancelAnimationFrame(raf)
  }, [epitope, L])

  // Click a track -> map the x-pixel to a UniProt position (honouring current zoom) and snap to
  // the nearest contacted residue. Independent of Nightingale's internal event API, so robust.
  useEffect(() => {
    const positions = epitope.filter((r) => r.antigen_uniprot_position != null)
      .map((r) => r.antigen_uniprot_position)
    const handlers = []
    trackRefs.current.forEach((ref) => {
      const el = ref.current
      if (!el) return
      const onClick = (e) => {
        const ds = Number(el.getAttribute('display-start')) || 1
        const de = Number(el.getAttribute('display-end')) || L
        const rect = el.getBoundingClientRect()
        if (!rect.width) return
        const frac = (e.clientX - rect.left) / rect.width
        const approx = ds + frac * (de - ds)
        let nearest = null, best = Infinity
        for (const p of positions) {
          const d = Math.abs(p - approx)
          if (d < best) { best = d; nearest = p }
        }
        // Only select if the click is within a few residues of a real contacted position.
        const tol = Math.max(2, ((de - ds) / rect.width) * 6)
        if (nearest != null && best <= tol) onSelect?.(nearest)
      }
      el.addEventListener('click', onClick)
      handlers.push([el, onClick])
    })
    return () => handlers.forEach(([el, h]) => el.removeEventListener('click', h))
  }, [onSelect, epitope, L])

  // Reflect external selection as a highlight across tracks (remove attr when cleared to avoid
  // Nightingale drawing a zero/negative-width highlight rect).
  useEffect(() => {
    ;[navRef.current, ...trackRefs.current.map((r) => r.current)].forEach((el) => {
      if (!el) return
      if (selected) el.setAttribute('highlight', `${selected}:${selected}`)
      else el.removeAttribute('highlight')
    })
  }, [selected])

  return (
    <div className="card">
      <h2>Antigen epitope map</h2>
      <p className="note">
        Per-residue antibody contacts along the antigen (UniProt P0DTC2), the way PDBe-KB shows
        residue-level annotations (Nightingale track). Colour intensity ∝ contact pairs; drag on the
        ruler to zoom, click a residue to filter the tables below. Antigen positions come from PISA
        (SIFTS fallback where PISA lacks them).
      </p>
      <div className="legend">
        <span className="dot" style={{ background: '#7a5195' }} /> all
        <span className="dot" style={{ background: '#e19039' }} /> heavy
        <span className="dot" style={{ background: '#4b7fcc' }} /> light
        {selected && <span style={{ marginLeft: 12 }}>selected UniProt position <b>{selected}</b>
          {' '}<button className="linklike" onClick={() => onSelect?.(null)}>clear</button></span>}
      </div>
      <nightingale-manager attributes="length display-start display-end highlight">
        <div className="nt-grid">
          <span className="nt-lbl" />
          <nightingale-navigation ref={navRef} height="40" />
          {TRACKS.map((t, i) => (
            <React.Fragment key={t.key}>
              <span className="nt-lbl">{t.label}</span>
              <nightingale-track-canvas ref={trackRefs.current[i]} height="26" />
            </React.Fragment>
          ))}
        </div>
      </nightingale-manager>
      {hover && <div className="nt-tip">{hover}</div>}
    </div>
  )
}
