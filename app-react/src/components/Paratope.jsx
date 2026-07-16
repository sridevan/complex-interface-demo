import React, { useMemo, useState } from 'react'
import Hint from './Hint.jsx'
import { REGION_COLORS } from '../data.js'

// Antibody variable-domain region definitions (IMGT). Authoritative reference below.
const REGION_REF_URL = 'https://www.imgt.org/IMGTScientificChart/Nomenclature/IMGT-FRCDRdefinition.html'
const AB_REGION_HELP = 'Antibody variable-domain regions in IMGT numbering. CDR-1/2/3 are the '
  + 'hypervariable, antigen-contacting loops (CDR-H3 is the most variable and usually dominates the '
  + 'paratope); Framework regions are the conserved β-sheet scaffold. H = heavy chain, L = light '
  + 'chain. Definitions: IMGT (imgt.org).'

// SAbDab2 antibody identity for a contact row; falls back to the per-instance key so an
// unmatched chain still counts as its own antibody (never dropped, never over-merged).
const sabId = (lookup, p) => {
  const k = `${p.pdb_id}|${p.antibody_chain_id}|${p.antibody_chain_type}`
  return (lookup[k] && lookup[k].sabdab_id) || k
}
const metricOf = (e, weight) => (weight === 'antibody' ? e.sab.size : e.raw)

export function aggParatope(rows, lookup, weight) {
  const m = new Map()
  for (const p of rows) {
    if (p.antibody_imgt_position == null) continue      // precomputed aggregate excludes unmapped
    const k = `${p.antibody_chain_type}|${p.antibody_imgt_position}`
    if (!m.has(k)) m.set(k, {
      antibody_chain_type: p.antibody_chain_type, antibody_imgt_position: p.antibody_imgt_position,
      antibody_imgt_region: p.antibody_imgt_region,
      raw: 0, sab: new Set(), asm: new Set(), agres: new Map(), abres: new Map(),
    })
    const e = m.get(k)
    const ab = sabId(lookup, p)
    e.raw += 1
    e.sab.add(ab)
    e.asm.add(`${p.pdb_id}|${p.assembly_id}`)
    // amino-acid identity distribution at this position -> consensus residue
    if (!e.abres.has(p.antibody_residue_name)) e.abres.set(p.antibody_residue_name, { raw: 0, sab: new Set() })
    const bb = e.abres.get(p.antibody_residue_name); bb.raw += 1; bb.sab.add(ab)
    if (p.antigen_uniprot_position != null) {
      const av = `${p.antigen_residue_name}${p.antigen_uniprot_position}`
      if (!e.agres.has(av)) e.agres.set(av, { raw: 0, sab: new Set() })
      const a = e.agres.get(av); a.raw += 1; a.sab.add(ab)
    }
  }
  return [...m.values()].map((e) => {
    const cnt = (x) => weight === 'antibody' ? x.sab.size : x.raw
    const abList = [...e.abres.entries()].map(([res, x]) => ({ res, n: cnt(x) })).sort((a, b) => b.n - a.n)
    const abDenom = abList.reduce((s, x) => s + x.n, 0) || 1
    return {
      ...e,
      total_antigen_contacts: metricOf(e, weight),
      assemblies_contacted: e.asm.size,
      consensus_residue: abList[0] ? abList[0].res : null,
      consensus_frac: abList[0] ? abList[0].n / abDenom : 0,
      n_distinct_residues: e.abres.size,
      most_common_contacted_antigen_residues: [...e.agres.entries()]
        .map(([value, a]) => ({ value, count: cnt(a) }))
        .sort((x, y) => y.count - x.count).slice(0, 5),
    }
  })
}

// Recompute CDR/framework region contribution client-side, honouring the weighting toggle.
//   'all'      — % = region's share of ALL mapped contacts (contact volume). Reproduces
//                imgt_region_contribution.json exactly.
//   'antibody' — % = mean over distinct antibodies of (region's contacts / that antibody's total mapped
//                contacts). Every antibody weighted equally regardless of how many times it was
//                deposited — the redundancy-corrected DEPTH. (Deliberately NOT summed distinct-antibody
//                membership, which measures breadth and dilutes the dominant loop.) `total_contacts`

function chipInk(hex) {
  const n = parseInt(hex.slice(1), 16)
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)
  return lum > 150 ? '#1c2430' : '#ffffff'
}

// Ranked-table bar: value label sits to the LEFT on white (always legible — never dark text on a
// dark bar), the bar itself is purely visual and sized to `frac` of the track.
function Bar({ frac, color, children }) {
  return (
    <div className="bar-cell">
      <span className="bar-num">{children}</span>
      <span className="bar-track">
        <span className="bar-fill" style={{ width: `${Math.max(2, frac * 100)}%`, background: color }} />
      </span>
    </div>
  )
}

// ── Sequence-conservation heatmap (opt-in view of the paratope-convergence card) ────────────────
// Amino-acid usage at each CDR IMGT position, per distinct antibody (so re-depositions don't skew
// conservation). Rows = 20 amino acids grouped by physicochemical class; columns = CDR positions in
// sequence order, banded by region. A pinned position shows one dark cell; a hypervariable one spreads.
const AA1 = ['R', 'K', 'H', 'D', 'E', 'S', 'T', 'N', 'Q', 'C', 'G', 'P', 'A', 'V', 'I', 'L', 'M', 'F', 'W', 'Y']
const ONE2THREE = { R: 'ARG', K: 'LYS', H: 'HIS', D: 'ASP', E: 'GLU', S: 'SER', T: 'THR', N: 'ASN', Q: 'GLN',
  C: 'CYS', G: 'GLY', P: 'PRO', A: 'ALA', V: 'VAL', I: 'ILE', L: 'LEU', M: 'MET', F: 'PHE', W: 'TRP', Y: 'TYR' }
const AA_TEXT = { R: '#3a6bb0', K: '#3a6bb0', H: '#3a6bb0', D: '#c0341a', E: '#c0341a', S: '#1f7a2f', T: '#1f7a2f',
  N: '#1f7a2f', Q: '#1f7a2f', C: '#1f7a2f', Y: '#1f7a2f', G: '#8a7a1f', P: '#8a7a1f', A: '#8a7a1f', V: '#8a7a1f',
  I: '#8a7a1f', L: '#8a7a1f', M: '#8a7a1f', F: '#8a7a1f', W: '#8a7a1f' }
function seqCell(t) {
  if (t <= 0) return '#ffffff'
  const k = Math.sqrt(Math.min(1, t))
  const lerp = (a, b) => Math.round(a + (b - a) * k)
  return `rgb(${lerp(244, 63)},${lerp(240, 0)},${lerp(250, 125)})`
}

function ParatopeConservation({ abImgt, side }) {
  const [tip, setTip] = useState(null)
  const cols = useMemo(() => abImgt
    .filter((r) => (side === 'all' || r.antibody_chain_type === side) && /CDR/.test(r.antibody_imgt_region || ''))
    .sort((a, b) => a.antibody_chain_type.localeCompare(b.antibody_chain_type)
      || a.antibody_imgt_position - b.antibody_imgt_position), [abImgt, side])
  const grid = useMemo(() => cols.map((c) => {
    const total = [...c.abres.values()].reduce((s, x) => s + x.sab.size, 0) || 1
    const comp = {}
    for (const [res, x] of c.abres) comp[res] = x.sab.size / total
    return { comp, total }
  }), [cols])
  // Contiguous runs of the same region -> a spanning band above the position numbers.
  const bands = useMemo(() => {
    const g = []
    for (const c of cols) {
      const last = g[g.length - 1]
      if (last && last.region === c.antibody_imgt_region) last.span++
      else g.push({ region: c.antibody_imgt_region, span: 1 })
    }
    return g
  }, [cols])
  if (!cols.length) return <p className="note">No CDR paratope positions for this chain side.</p>
  return (
    <>
    <div className="seq-axis-x">Antibody IMGT position (CDR) →</div>
    <div className="cm-mid">
    <div className="seq-axis-y"><span>Amino acid</span></div>
    <div className="hm-wrap seqmap-wrap">
      <table className="seqmap">
        <thead>
          <tr>
            <th className="seqmap-corner" rowSpan={2} />
            {bands.map((g, i) => (
              <th key={i} colSpan={g.span} className="seqmap-region"
                  style={{ background: REGION_COLORS[g.region] || '#8a94a6', color: chipInk(REGION_COLORS[g.region] || '#8a94a6') }}>
                {g.region}</th>
            ))}
          </tr>
          <tr>
            {cols.map((c, i) => (
              <th key={i} className="seqmap-col" title={`IMGT ${c.antibody_imgt_position} · ${c.antibody_imgt_region} · ${grid[i].total} antibodies`}
                  style={{ borderTopColor: REGION_COLORS[c.antibody_imgt_region] || '#8a94a6' }}>{c.antibody_imgt_position}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {AA1.map((aa) => (
            <tr key={aa}>
              <td className="seqmap-aa" style={{ color: AA_TEXT[aa] }}>{aa}</td>
              {cols.map((c, i) => {
                const f = grid[i].comp[ONE2THREE[aa]] || 0
                return (
                  <td key={i} className={'seqmap-cell' + (f > 0 ? '' : ' cm-absent')}
                      style={f > 0 ? { background: seqCell(f) } : null}
                      onMouseEnter={f > 0 ? () => setTip(`${ONE2THREE[aa]} at IMGT ${c.antibody_imgt_position} (${c.antibody_imgt_region}): ${Math.round(f * 100)}% of ${grid[i].total} antibodies`) : undefined}
                      onMouseLeave={f > 0 ? () => setTip(null) : undefined} />
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </div>
    <div className="cm-foot">
      <span className="cm-legend-item cm-legend-scale">
        residue share at position <b>0%</b><span className="cm-legend-ramp" /><b>100%</b> of antibodies
      </span>
    </div>
    <div className="nt-tip">{tip || ' '}</div>
    </>
  )
}

// ── Section 1: paratope convergence ────────────────────────────────────────────────────────────
export function ParatopeConvergence({ abImgt, weight, fixedSide, epiFilter, onClearEpiFilter }) {
  const [sideState, setSide] = useState('all')  // 'all' | 'heavy' | 'light'
  const [sortBy, setSortBy] = useState('contacts')  // 'contacts' | 'position'
  const [view, setView] = useState('table')  // 'table' | 'heatmap' (sequence conservation)
  const side = fixedSide || sideState
  const rows = useMemo(() => {
    const f = abImgt.filter((r) => side === 'all' || r.antibody_chain_type === side)
    const cmp = sortBy === 'position'
      ? (a, b) => a.antibody_chain_type.localeCompare(b.antibody_chain_type) || a.antibody_imgt_position - b.antibody_imgt_position
      : (a, b) => b.total_antigen_contacts - a.total_antigen_contacts
    return [...f].sort(cmp)
  }, [abImgt, side, sortBy])
  const max = Math.max(1, ...rows.map((r) => r.total_antigen_contacts))
  const nCdr = rows.filter((r) => /CDR/.test(r.antibody_imgt_region || '')).length
  const byAb = weight === 'antibody'
  const contactHelp = byAb
    ? 'Distinct antibodies (SAbDab2 ID) whose paratope includes this IMGT position — each antibody counted once, deposition redundancy removed.'
    : 'Residue-level antigen contacts made by this antibody IMGT position, summed across every deposited complex — how often recognition converges here.'

  return (
    <div className="card ex-cell">
      <h2>Paratope convergence</h2>
      <p className="note">Antibody <a href={REGION_REF_URL} target="_blank" rel="noopener noreferrer">IMGT positions</a>
        {' '}ranked by how often they contact the antigen {byAb ? 'across distinct antibodies' : 'across all complexes'} —
        where recognition converges. <b>Top residue</b> is the most common amino acid at each position (its share
        shows how conserved the position is); switch to <b>Sequence conservation</b> for the full amino-acid usage per
        CDR position, weighted per distinct antibody.</p>
      <div className="controls">
        {!fixedSide && <>
          <label>Chain</label>
          <span className="pill">
            {['all', 'heavy', 'light'].map((s) => (
              <button key={s} className={side === s ? 'active' : ''} onClick={() => setSide(s)}>
                {s[0].toUpperCase() + s.slice(1)}</button>
            ))}
          </span>
        </>}
        <label style={{ marginLeft: fixedSide ? 0 : 10 }}>View</label>
        <span className="pill">
          <button className={view === 'table' ? 'active' : ''} onClick={() => setView('table')}>Ranked positions</button>
          <button className={view === 'heatmap' ? 'active' : ''} onClick={() => setView('heatmap')}>Sequence conservation</button>
        </span>
        {view === 'table' && <>
          <label style={{ marginLeft: 10 }}>Sort</label>
          <span className="pill">
            <button className={sortBy === 'contacts' ? 'active' : ''} onClick={() => setSortBy('contacts')}>By contacts</button>
            <button className={sortBy === 'position' ? 'active' : ''} onClick={() => setSortBy('position')}>By position</button>
          </span>
        </>}
        <span className="rowcount">{view === 'table' ? `${rows.length} IMGT positions` : `20 aa × ${nCdr} CDR positions`}</span>
      </div>
      {epiFilter && (
        <div className="filter-chip">Contacting antigen residue <b>{epiFilter}</b>
          <button onClick={onClearEpiFilter}>clear ✕</button></div>
      )}
      {view === 'heatmap' ? (
        <ParatopeConservation abImgt={abImgt} side={side} />
      ) : (
      <div className="ex-scroll">
        <table className="conv-table">
          <thead>
            <tr><th>IMGT pos</th><th>Ab region<Hint text={AB_REGION_HELP} /></th>
              <th>Top residue<Hint text="Most common antibody amino acid at this IMGT position across deposited antibodies. The share % shows how conserved the position is; a high 'aa' count means it is hypervariable. Full per-position usage is in the Sequence conservation view." /></th>
              <th>{byAb ? 'Antibodies' : 'Ag contacts'}<Hint text={contactHelp} /></th>
              <th className="num">Structures<Hint text="Distinct structural assemblies in which this antibody position contacts the antigen." /></th>
              <th>Top Ag residues</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.antibody_chain_type}|${r.antibody_imgt_position}`}>
                <td><b>{r.antibody_imgt_position}</b></td>
                <td><span className="rtag" style={{ background: REGION_COLORS[r.antibody_imgt_region] || '#8a94a6',
                  color: chipInk(REGION_COLORS[r.antibody_imgt_region] || '#8a94a6') }}>{r.antibody_imgt_region}</span></td>
                <td className="conv-consensus">
                  <b>{r.consensus_residue || '—'}</b>
                  {r.consensus_residue && (
                    <span className="conv-sub"><b>{Math.round(r.consensus_frac * 100)}%</b> · {r.n_distinct_residues} aa</span>
                  )}
                </td>
                <td className="conv-agc">
                  <Bar frac={r.total_antigen_contacts / max} color={REGION_COLORS[r.antibody_imgt_region] || '#999'}>
                    {r.total_antigen_contacts}</Bar>
                </td>
                <td className="num">{r.assemblies_contacted}</td>
                <td className="epi-chips">{(r.most_common_contacted_antigen_residues || []).slice(0, 3)
                  .map((d) => <span key={d.value} className="chip">{d.value}<span className="chip-n">{d.count}</span></span>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </div>
  )
}
