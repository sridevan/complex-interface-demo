import React, { useMemo, useState } from 'react'

// Antibody IMGT regions in a fixed, readable order (heavy block then light block).
const HEAVY_REGIONS = ['CDR-H1', 'CDR-H2', 'CDR-H3', 'Framework-H']
const LIGHT_REGIONS = ['CDR-L1', 'CDR-L2', 'CDR-L3', 'Framework-L']
const ALL_REGIONS = [...HEAVY_REGIONS, ...LIGHT_REGIONS]
const SHORT = { 'CDR-H1': 'H1', 'CDR-H2': 'H2', 'CDR-H3': 'H3', 'Framework-H': 'FR-H',
                'CDR-L1': 'L1', 'CDR-L2': 'L2', 'CDR-L3': 'L3', 'Framework-L': 'FR-L' }

// Single-hue sequential ramp (white -> deep purple). Colourblind-safe (no rainbow); sqrt boosts
// visibility of low counts. Returns { bg, fg }: the count text flips to white on dark cells so it
// never gets swallowed by the deep-purple end of the ramp. t in [0,1].
function cell(t) {
  if (t <= 0) return { bg: '#ffffff', fg: '#2a2f36' }
  const k = Math.sqrt(Math.min(1, t))
  const lerp = (a, b) => Math.round(a + (b - a) * k)
  // #f4f0fa (very light) -> #3f007d (deep purple)
  const r = lerp(244, 63), g = lerp(240, 0), b = lerp(250, 125)
  const lum = 0.299 * r + 0.587 * g + 0.114 * b   // perceived brightness
  return { bg: `rgb(${r},${g},${b})`, fg: lum < 150 ? '#ffffff' : '#2a2f36' }
}

export default function ContactHeatmap({ residue, onSelect, selected, chainType }) {
  const [sortBy, setSortBy] = useState('contacts')  // 'contacts' | 'position'
  const [hover, setHover] = useState(null)

  // Only the selected chain type's 4 IMGT regions (both blocks if no chainType given).
  const REGIONS = chainType === 'heavy' ? HEAVY_REGIONS
    : chainType === 'light' ? LIGHT_REGIONS : ALL_REGIONS

  // Build matrix: (antigen residue) x region -> { pairs, structures:Set }.
  const { rows, maxVal } = useMemo(() => {
    const map = new Map()
    for (const p of residue) {
      if (p.antigen_uniprot_position == null || !p.antibody_imgt_region) continue
      if (!REGIONS.includes(p.antibody_imgt_region)) continue
      const rkey = `${p.antigen_uniprot_position}|${p.antigen_residue_name}`
      if (!map.has(rkey)) {
        map.set(rkey, {
          position: p.antigen_uniprot_position, residue: p.antigen_residue_name,
          cells: Object.fromEntries(REGIONS.map((r) => [r, { pairs: 0, structs: new Set() }])),
          total: 0,
        })
      }
      const row = map.get(rkey)
      const cell = row.cells[p.antibody_imgt_region]
      cell.pairs += 1
      cell.structs.add(p.pdb_id)
      row.total += 1
    }
    const rows = [...map.values()].map((row) => ({
      ...row,
      values: Object.fromEntries(REGIONS.map((r) => [r, row.cells[r].pairs])),
      rowTotal: REGIONS.reduce((s, r) => s + row.cells[r].pairs, 0),
    }))
    const maxVal = Math.max(1, ...rows.flatMap((row) => REGIONS.map((r) => row.values[r])))
    return { rows, maxVal }
  }, [residue, chainType])

  const sorted = useMemo(() => {
    const c = [...rows]
    c.sort((a, b) => sortBy === 'position' ? a.position - b.position : b.rowTotal - a.rowTotal)
    return c
  }, [rows, sortBy])

  const title = chainType
    ? 'Aggregated epitope × paratope contact map'
    : 'Epitope × paratope contact map'

  return (
    <div className="card">
      <h2>{title}</h2>
      <p className="note">
        Contact intensity between each antigen residue (UniProt position, from PISA) and each antibody
        IMGT region (from ANARCII), aggregated across all processed structures as the number of
        contact pairs. Single-hue scale (white-to-purple) is colour-blind-safe. Click a row to filter
        the aggregated contact table to that antigen residue (click again to clear).
      </p>
      <div className="controls">
        <label>Sort</label>
        <span className="pill">
          <button className={sortBy === 'contacts' ? 'active' : ''} onClick={() => setSortBy('contacts')}>By contacts</button>
          <button className={sortBy === 'position' ? 'active' : ''} onClick={() => setSortBy('position')}>By position</button>
        </span>
        <span className="rowcount">{sorted.length} antigen residues</span>
      </div>

      <div className="hm-legend">
        low
        <span className="hm-ramp" />
        high (max {maxVal} contact pairs)
      </div>

      <div className="hm-wrap">
        <table className="heatmap">
          <thead>
            <tr>
              <th className="hm-rowhead">Antigen residue</th>
              {REGIONS.map((r) => (
                <th key={r} className={'hm-col ' + (r.includes('-H') || r.endsWith('-H') ? 'hcol' : 'lcol')}>{SHORT[r]}</th>
              ))}
              <th className="hm-col">Σ</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={row.position} className={'selrow' + (row.position === selected ? ' sel' : '')}
                  onClick={() => onSelect?.(row.position)}
                  title="Click to filter the aggregated contact table to this antigen residue">
                <td className="hm-rowhead">{row.residue}{row.position}</td>
                {REGIONS.map((r) => {
                  const v = row.values[r]
                  const c = cell(v / maxVal)
                  return (
                    <td key={r} className="hm-cell"
                        style={{ background: c.bg, color: c.fg }}
                        onMouseEnter={() => setHover(`${row.residue}${row.position} × ${r}: ${v} contact pairs`)}
                        onMouseLeave={() => setHover(null)}>
                      {v > 0 ? v : ''}
                    </td>
                  )
                })}
                <td className="hm-cell hm-total">{row.rowTotal}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hover && <div className="nt-tip">{hover}</div>}
    </div>
  )
}
