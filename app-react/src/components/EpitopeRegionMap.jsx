import React, { useMemo, useState } from 'react'
import { REGION_COLORS } from '../data.js'

// Antibody–antigen variant of the contact map: instead of individual antibody IMGT positions on the
// x-axis (dozens, mostly sparse), accumulate contacts into the antibody's IMGT regions — the CDRs and
// framework. Rows are epitope (antigen) residues; each cell is shaded by the fraction of antibody
// interfaces in which that epitope residue contacts that region. Makes the CDR-H3-dominated paratope
// read at a glance. Residue-level detail stays in the adjacent contact-pair table.
const REGION_ORDER = {
  heavy: ['CDR-H1', 'CDR-H2', 'CDR-H3', 'Framework-H'],
  light: ['CDR-L1', 'CDR-L2', 'CDR-L3', 'Framework-L'],
}
const REGION_SHORT = { 'CDR-H1': 'CDR1', 'CDR-H2': 'CDR2', 'CDR-H3': 'CDR3', 'Framework-H': 'FR',
  'CDR-L1': 'CDR1', 'CDR-L2': 'CDR2', 'CDR-L3': 'CDR3', 'Framework-L': 'FR' }

// Same white -> deep purple ramp as ContactMap, sqrt-boosted for low counts.
function cellColor(t) {
  if (t <= 0) return '#ffffff'
  const k = Math.sqrt(Math.min(1, t))
  const lerp = (a, b) => Math.round(a + (b - a) * k)
  return `rgb(${lerp(244, 63)},${lerp(240, 0)},${lerp(250, 125)})`
}
const bondCount = (it) => Object.values(it || {}).reduce((s, n) => s + n, 0)
const MAX_ROWS = 40   // an epitope can span the whole antigen across many antibodies; show the hotspots

export default function EpitopeRegionMap({ residue, chainType, total, leftLabel = 'Ag residue' }) {
  const [tip, setTip] = useState(null)
  const regions = REGION_ORDER[chainType] || REGION_ORDER.heavy

  const { rows, grid, nAll } = useMemo(() => {
    const epi = new Map()          // pos -> { pos, res, insts:Set }  (row totals)
    const g = new Map()            // `${pos}|${region}` -> { insts:Set, count }
    for (const r of residue) {
      if (r.antibody_chain_type !== chainType) continue
      if (r.antigen_uniprot_position == null || r.antibody_imgt_region == null) continue
      const pos = r.antigen_uniprot_position, region = r.antibody_imgt_region
      const inst = `${r.pdb_id}|${r.assembly_id}|${r.interface_id}`
      if (!epi.has(pos)) epi.set(pos, { pos, res: r.antigen_residue_name, insts: new Set() })
      epi.get(pos).insts.add(inst)
      const gk = `${pos}|${region}`
      if (!g.has(gk)) g.set(gk, { insts: new Set(), count: 0 })
      const e = g.get(gk); e.insts.add(inst); e.count += bondCount(r.interaction_types)
    }
    // rows ordered by total involvement (strongest epitope residues first), ties by position
    const all = [...epi.values()].map((e) => ({ pos: e.pos, res: e.res, n: e.insts.size }))
      .sort((a, b) => b.n - a.n || a.pos - b.pos)
    return { rows: all.slice(0, MAX_ROWS), grid: g, nAll: all.length }
  }, [residue, chainType])

  if (!rows.length) return <p className="note">No paratope contacts for this chain side.</p>
  const denom = total || Math.max(1, ...rows.map((r) => r.n))
  const showTip = (e, row, region, cell) => setTip({ x: e.clientX, y: e.clientY,
    epi: `${row.res}${row.pos}`, region, freq: `${cell ? cell.insts.size : 0}/${total}`,
    count: cell ? cell.count : 0 })

  return (
    <>
      <p className="cm-controls-note" style={{ margin: '2px 0 10px' }}>
        {nAll > rows.length ? `top ${rows.length} of ${nAll}` : rows.length} epitope residues by contact frequency ·
        antibody positions accumulated into {regions.length} IMGT regions{nAll > rows.length ? ' · full list in the table' : ''}
      </p>
      <div className="cm-axis-x">Ab region</div>
      <div className="cm-mid">
        <div className="cm-axis-y"><span>{leftLabel}</span></div>
        <div className="cm-wrap">
          <table className="cm-table erm-table">
            <thead>
              <tr>
                <th className="cm-corner" />
                {regions.map((rg) => (
                  <th key={rg} className="cm-colhead erm-colhead" title={rg}>
                    <span className="erm-reg" style={{ '--rc': REGION_COLORS[rg] || '#888' }}>{REGION_SHORT[rg]}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.pos}>
                  <td className="cm-rowhead">{row.res}{row.pos}</td>
                  {regions.map((rg) => {
                    const cell = grid.get(`${row.pos}|${rg}`)
                    const freq = cell ? cell.insts.size / denom : 0
                    return (
                      <td key={rg} className={'cm-cell erm-cell' + (cell ? '' : ' cm-absent')}
                          style={cell ? { background: cellColor(freq) } : null}
                          onMouseEnter={cell ? (e) => showTip(e, row, rg, cell) : undefined}
                          onMouseMove={cell ? (e) => showTip(e, row, rg, cell) : undefined}
                          onMouseLeave={cell ? () => setTip(null) : undefined} />
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="cm-foot">
        <span className="cm-legend-item"><span className="cm-sw cm-sw-absent" /> not observed</span>
        <span className="cm-legend-item cm-legend-scale">observed in <b>1</b>
          <span className="cm-legend-ramp" /><b>{total}</b> antibodies</span>
      </div>
      {tip && (() => {
        const s = { top: tip.y + 14 }
        if (tip.x > window.innerWidth * 0.72) s.right = window.innerWidth - tip.x + 14
        else s.left = tip.x + 14
        return (
          <div className="cm-tip" style={s}>
            <div className="cm-tip-head">{tip.epi} <span className="cm-tip-sub">(Ag)</span> — {tip.region}</div>
            <div><span className="cm-tip-sub">Frequency:</span> {tip.freq} antibodies</div>
            <div><span className="cm-tip-sub">Accumulated contacts:</span> {tip.count}</div>
          </div>
        )
      })()}
    </>
  )
}
