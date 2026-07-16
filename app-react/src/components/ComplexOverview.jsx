import React, { useMemo, useState } from 'react'
import ContactHeatmap from './ContactHeatmap.jsx'
import DataTable from './DataTable.jsx'
import Hint from './Hint.jsx'
import VariantBadge from './VariantBadge.jsx'
import GlycanBadge from './GlycanBadge.jsx'
import { REGION_COLORS } from '../data.js'

// Antibody variable-domain region definitions (IMGT). Authoritative reference below.
const REGION_REF_URL = 'https://www.imgt.org/IMGTScientificChart/Nomenclature/IMGT-FRCDRdefinition.html'
const AB_REGION_HELP = 'Antibody variable-domain regions in IMGT numbering. CDR-1/2/3 are the '
  + 'hypervariable, antigen-contacting loops (CDR-H3 is the most variable and usually dominates the '
  + 'paratope); Framework regions are the conserved β-sheet scaffold. H = heavy chain, L = light '
  + 'chain. Definitions: IMGT (imgt.org).'

// ── The complex-level atlas: every antibody bound to the antigen, aggregated onto one normalised
// view. Antigen residues by UniProt position, antibody residues by IMGT. Counts are STRUCTURAL
// COVERAGE across deposited complexes (what has been solved), NOT immunodominance — the PDB is not a
// random sample. The contacts↔structures toggle is the de-bias: "structures" counts distinct PDB
// entries so 200 re-depositions of one antibody don't dwarf a residue seen once each in 20.

// ── Weighting ───────────────────────────────────────────────────────────────────────────────────
// Every aggregate below is counted one of two ways, chosen by a single overview-level toggle:
//   'all'      — one count per contacting instance (raw residue-pair occurrences; the PDB as-deposited)
//   'antibody' — weight each distinct antibody (SAbDab2 ID) EQUALLY, removing deposition redundancy
//                (a mAb solved in 20 PDBs / many symmetry copies stops dominating). What "equal weight"
//                means depends on the quantity:
//                  · ranked COUNTS (paratope positions, epitope pairs) -> distinct-antibody counts
//                    (each antibody contributes 0/1 per bucket; redundancy-immune by construction).
//                  · region-contribution SHARES (a % split across regions) -> the MEAN over antibodies
//                    of each region's share of that antibody's own paratope. NOT summed membership:
//                    summed membership measures breadth (how many antibodies touch a region at all) and
//                    dilutes the dominant loop, whereas the mean-share is the redundancy-corrected DEPTH.
//                    Empirically the mean-share leaves CDR-H3 / heavy-chain dominance ~unchanged from
//                    'all' — that dominance is real, not a re-deposition artifact.
// The 'all' numbers reproduce the precomputed pipeline aggregates exactly; 'antibody' is derived
// client-side from the same residue-level pairs joined to the SAbDab2 lookup. See fetch_sabdab2_ids.py.
const WEIGHTS = { all: 'All contacts', antibody: 'Per antibody (SAbDab2)' }
const WEIGHT_HELP = 'How repeated structures of the SAME antibody are counted. “All contacts” pools '
  + 'every deposited instance — so a mAb solved many times (or in many symmetry copies) dominates. '
  + '“Per antibody” weights each distinct antibody (SAbDab2 ID) equally, removing deposition redundancy: '
  + 'ranked tables switch to distinct-antibody counts, and the region-contribution shares become the '
  + 'mean over antibodies of each region’s share of its paratope (depth, not just how many antibodies '
  + 'touch it). The PDB is not a random sample, so per-antibody is the fairer view.'

// SAbDab2 antibody identity for a contact row; falls back to the per-instance key so an
// unmatched chain still counts as its own antibody (never dropped, never over-merged).
const sabId = (lookup, p) => {
  const k = `${p.pdb_id}|${p.antibody_chain_id}|${p.antibody_chain_type}`
  return (lookup[k] && lookup[k].sabdab_id) || k
}
const metricOf = (e, weight) => (weight === 'antibody' ? e.sab.size : e.raw)

// Aggregate contacts per (antigen residue, antibody IMGT residue). Tracks raw occurrences, the set of
// distinct antibodies (SAbDab2), and distinct assemblies — the display metric is chosen by `weight`.
function contactTable(rows, lookup, weight) {
  const m = new Map()
  for (const p of rows) {
    if (p.antigen_uniprot_position == null) continue
    const abres = p.antibody_imgt_position != null
      ? `${p.antibody_residue_name}${p.antibody_imgt_position}${p.antibody_imgt_insertion_code || ''}`
      : `${p.antibody_residue_name}${p.antibody_residue_author_number}*`  // * = IMGT-unmapped
    const k = `${p.antigen_uniprot_position}|${p.antigen_residue_name}|${abres}`
    if (!m.has(k)) m.set(k, {
      antigen: `${p.antigen_residue_name}${p.antigen_uniprot_position}`,
      antigen_uniprot_position: p.antigen_uniprot_position,
      antibody_residue: abres, region: p.antibody_imgt_region,
      ab_pos: p.antibody_imgt_position, ab_ins: p.antibody_imgt_insertion_code || '',
      raw: 0, sab: new Set(), asm: new Set(),
    })
    const e = m.get(k)
    e.raw += 1
    e.sab.add(sabId(lookup, p))
    e.asm.add(`${p.pdb_id}|${p.assembly_id}`)
  }
  return [...m.values()].map((e) => ({ ...e, contacts: metricOf(e, weight), assemblies: e.asm.size }))
}

// CONTACT_COLS is a factory: the antigen column renders variant / glycan badges when that epitope
// residue carries a natural Variant or is an N-glycosylation site (looked up by UniProt position).
// The count column's label + help adapt to the weighting mode.
const contactCols = (variantMap, glycanMap, weight) => [
  { key: 'antigen', label: 'Ag residue', sortValue: (r) => r.antigen_uniprot_position ?? Infinity,
    render: (v, r) => (<>{v} <VariantBadge variants={variantMap[r.antigen_uniprot_position]} />
      {' '}<GlycanBadge glycan={glycanMap[r.antigen_uniprot_position]} /></>) },
  { key: 'antibody_residue', label: 'Ab residue',
    sortValue: (r) => (r.ab_pos ?? 9999) + (r.ab_ins ? (r.ab_ins.charCodeAt(0) - 64) / 100 : 0) },
  { key: 'region', label: 'Ab region', help: AB_REGION_HELP },
  { key: 'contacts', label: weight === 'antibody' ? 'Antibodies' : 'Contacts', num: true,
    help: weight === 'antibody'
      ? 'Distinct antibodies (SAbDab2 ID) that make this exact epitope–paratope residue pair — each antibody counted once, deposition redundancy removed.'
      : 'Residue-level contacts for this epitope–paratope residue pair, summed across every deposited complex (one per contacting instance).' },
  { key: 'assemblies', label: 'Assemblies', num: true,
    help: 'Number of distinct structural assemblies (PDB entry + assembly) in which this exact residue pair is in contact — de-biases redundant re-deposition.' },
]

// Recompute the paratope-convergence table client-side so it honours the weighting toggle.
// Aggregated by antibody IMGT POSITION (not residue identity): convergence is a property of the
// structurally-aligned position — the CDR positions are hypervariable (20+ amino acids at a single
// CDR-H3 position), so keying on the residue would fragment the signal at exactly the positions that
// matter. The amino acid is kept as a consensus (most-common residue at that position across deposited
// antibodies) + a diversity count.
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
//                still reports the membership count as a companion breadth stat.
function aggRegions(rows, lookup, weight) {
  const m = new Map()                 // `${chain}|${region}` -> pooled stats
  const abTotal = new Map()           // antibody -> its total mapped contacts
  const abRegion = new Map()          // `${antibody} ${chain}|${region}` -> that antibody's contacts here
  for (const p of rows) {
    const rg = p.antibody_imgt_region
    if (!rg || rg === 'unmapped') continue
    const k = `${p.antibody_chain_type}|${rg}`
    if (!m.has(k)) m.set(k, {
      antibody_chain_type: p.antibody_chain_type, antibody_imgt_region: rg,
      raw: 0, sab: new Set(), agpos: new Set(),
    })
    const e = m.get(k)
    e.raw += 1
    const ab = sabId(lookup, p)
    e.sab.add(ab)
    if (p.antigen_uniprot_position != null) e.agpos.add(`${p.antigen_uniprot_accession}|${p.antigen_uniprot_position}`)
    abTotal.set(ab, (abTotal.get(ab) || 0) + 1)
    const ak = `${ab} ${k}`
    abRegion.set(ak, (abRegion.get(ak) || 0) + 1)
  }
  // Depth-corrected mean share per region: Σ_antibodies (region contacts / antibody total), then / N.
  // Antibodies absent from a region contribute 0, so the shares sum to ~100% across regions.
  const nAb = abTotal.size || 1
  const meanShareSum = new Map()
  for (const [ak, c] of abRegion) {
    const k = ak.slice(ak.indexOf(' ') + 1)
    const ab = ak.slice(0, ak.indexOf(' '))
    meanShareSum.set(k, (meanShareSum.get(k) || 0) + c / abTotal.get(ab))
  }
  const vals = [...m.values()].map((e) => ({ ...e, total_contacts: metricOf(e, weight),
    unique_antigen_positions_contacted: e.agpos.size }))
  if (weight === 'antibody') {
    return vals.map((r) => ({ ...r, percentage_of_total_contacts:
      Math.round(1000 * (meanShareSum.get(`${r.antibody_chain_type}|${r.antibody_imgt_region}`) || 0) / nAb) / 10 }))
  }
  const denom = vals.reduce((s, r) => s + r.raw, 0) || 1
  return vals.map((r) => ({ ...r, percentage_of_total_contacts: Math.round(1000 * r.raw / denom) / 10 }))
}

// White or dark text for a coloured chip, chosen by the background's perceived luminance (same
// threshold as the contact heatmap) — so pale regions like Framework-H get dark, readable text.
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
const REGION_BAND = { 'CDR-H1': 'CDR1', 'CDR-H2': 'CDR2', 'CDR-H3': 'CDR3',
  'CDR-L1': 'CDR1', 'CDR-L2': 'CDR2', 'CDR-L3': 'CDR3' }
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
                {REGION_BAND[g.region] || g.region}</th>
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
    {tip && <div className="nt-tip">{tip}</div>}
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
        <table>
          <thead>
            <tr><th>IMGT pos</th><th>Ab region<Hint text={AB_REGION_HELP} /></th>
              <th>Top residue<Hint text="Most common antibody amino acid at this IMGT position across deposited antibodies. The bar is its share of contacts at the position — a long bar is a conserved position, a short bar with a high 'aa' count is hypervariable. Full per-position usage is in the Sequence conservation view." /></th>
              <th>{byAb ? 'Antibodies' : 'Ag contacts'}<Hint text={contactHelp} /></th>
              <th className="num">Structures<Hint text="Distinct structural assemblies in which this antibody position contacts the antigen." /></th>
              <th>Top contacted Ag residues</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.antibody_chain_type}|${r.antibody_imgt_position}`}>
                <td><b>{r.antibody_imgt_position}</b></td>
                <td><span className="rtag" style={{ background: REGION_COLORS[r.antibody_imgt_region] || '#8a94a6',
                  color: chipInk(REGION_COLORS[r.antibody_imgt_region] || '#8a94a6') }}>{r.antibody_imgt_region}</span></td>
                <td className="conv-consensus">
                  <b>{r.consensus_residue || '—'}</b>
                  {r.consensus_residue && <>
                    <span className="conv-bar"><span className="conv-bar-fill" style={{ width: `${r.consensus_frac * 100}%` }} /></span>
                    <span className="conv-sub">{Math.round(r.consensus_frac * 100)}% · {r.n_distinct_residues} aa</span>
                  </>}
                </td>
                <td style={{ minWidth: 130 }}>
                  <Bar frac={r.total_antigen_contacts / max} color={REGION_COLORS[r.antibody_imgt_region] || '#999'}>
                    {r.total_antigen_contacts}</Bar>
                </td>
                <td className="num">{r.assemblies_contacted}</td>
                <td className="epi-chips">{(r.most_common_contacted_antigen_residues || []).slice(0, 5)
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

// ── Section 2: CDR / framework contribution ────────────────────────────────────────────────────
function RegionContribution({ regions, weight }) {
  const rows = useMemo(() => [...regions]
    .sort((a, b) => b.percentage_of_total_contacts - a.percentage_of_total_contacts), [regions])
  const max = Math.max(1, ...rows.map((r) => r.percentage_of_total_contacts))
  const byAb = weight === 'antibody'
  return (
    <div className="card ex-cell">
      <h2>CDR &amp; framework contribution</h2>
      <p className="note">Share of antigen contacts by antibody region, {byAb
        ? 'with each distinct antibody (SAbDab2) weighted equally — the mean over antibodies of each region’s share of its own paratope, so redundant re-depositions don’t skew it (the count is how many antibodies use the region)'
        : 'pooled across every complex'}. CDR-H3 typically dominates the paratope{byAb ? ', and stays dominant here — its lead is real, not a re-deposition artifact' : ''}.</p>
      <div className="rc-list">
        {rows.map((r) => (
          <div key={`${r.antibody_chain_type}|${r.antibody_imgt_region}`} className="rc-row">
            <span className="rc-name">{r.antibody_imgt_region}</span>
            <div className="rc-bar">
              <div className="rc-fill" style={{ width: `${(r.percentage_of_total_contacts / max) * 100}%`,
                background: REGION_COLORS[r.antibody_imgt_region] || '#999' }} />
            </div>
            <span className="rc-val">{r.percentage_of_total_contacts}%</span>
            <span className="rc-sub">{r.total_contacts} {byAb ? 'antibodies' : 'contacts'} · {r.unique_antigen_positions_contacted} epitope residues</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function ComplexOverview({ residue, variants = [], glycans = [], sabdab = {} }) {
  // Epitope×paratope map + aggregated contact table, migrated from Explorer's row 3. Whole complex
  // (both chains) — the heatmap keeps its own value toggle; row-click filters the table (epiFilter).
  const [epiFilter, setEpiFilter] = useState(null)
  const toggleEpi = (pos) => setEpiFilter((p) => (p === pos ? null : pos))

  // Weighting toggle: 'all' (per-instance, reproduces the pipeline aggregates) vs 'antibody' (collapse
  // by SAbDab2 ID). Drives all three aggregates below so they read consistently. See fetch_sabdab2_ids.py.
  const [weight, setWeight] = useState('all')
  const hasSab = Object.keys(sabdab).length > 0
  const abImgt = useMemo(() => aggParatope(residue, sabdab, weight), [residue, sabdab, weight])
  const regions = useMemo(() => aggRegions(residue, sabdab, weight), [residue, sabdab, weight])

  // Natural variants keyed by antigen UniProt position — used to badge epitope residues in the
  // contact table and heatmap. Empty until the dataset includes variant (non-Wuhan) structures.
  const variantMap = useMemo(() => {
    const m = {}
    for (const v of variants) (m[v.antigen_uniprot_position] ||= []).push(v)
    return m
  }, [variants])
  const glycanMap = useMemo(() => {
    const m = {}
    for (const g of glycans) m[g.antigen_uniprot_position] = g
    return m
  }, [glycans])
  const CONTACT_COLS = useMemo(() => contactCols(variantMap, glycanMap, weight), [variantMap, glycanMap, weight])

  const contactRows = useMemo(() => contactTable(residue, sabdab, weight), [residue, sabdab, weight])
  const shown = useMemo(() => epiFilter == null ? contactRows
    : contactRows.filter((r) => r.antigen_uniprot_position === epiFilter), [contactRows, epiFilter])
  const epiLabel = epiFilter == null ? null
    : (contactRows.find((r) => r.antigen_uniprot_position === epiFilter)?.antigen ?? `residue ${epiFilter}`)

  return (
    <>
      {/* Weighting toggle — governs every aggregate on this tab. */}
      {hasSab && (
        <div className="ex-row">
          <div className="card ex-cell weight-bar">
            <div className="controls">
              <label>Weighting<Hint text={WEIGHT_HELP} /></label>
              <span className="pill">
                {Object.entries(WEIGHTS).map(([k, lbl]) => (
                  <button key={k} className={weight === k ? 'active' : ''} onClick={() => setWeight(k)}>{lbl}</button>
                ))}
              </span>
              <span className="rowcount">{weight === 'antibody'
                ? 'each distinct antibody (SAbDab2 ID) counted once — deposition redundancy removed'
                : 'every deposited instance counted — redundant re-depositions included'}</span>
            </div>
          </div>
        </div>
      )}

      {/* Full-width stacked: detailed paratope -> region summary. The antigen-side ranking + heavy/
          light split now live in the contact map below (its Σ / ΣH / ΣL columns), so there's no
          separate epitope-hotspots table — it duplicated the map. */}
      <div className="ex-row">
        <ParatopeConvergence abImgt={abImgt} weight={weight} />
      </div>

      <div className="ex-row">
        <RegionContribution regions={regions} weight={weight} />
      </div>

      {/* Migrated row 3 — epitope×paratope contact map linked to the aggregated contact table. */}
      <div className="ex-row ex-row3">
        <div className="card ex-cell">
          <h2>Aggregated contact table</h2>
          <p className="note">One row per epitope–paratope residue pair, {weight === 'antibody'
            ? <>counted per <b>distinct antibody</b> (SAbDab2)</>
            : <>summed across <b>all</b> deposited complexes</>}. Sorted by {weight === 'antibody' ? 'antibodies' : 'contacts'}.</p>
          {epiFilter != null && (
            <div className="filter-chip">
              Filtered to antigen residue <b>{epiLabel}</b>
              <button onClick={() => setEpiFilter(null)}>clear ✕</button>
            </div>
          )}
          <div className="ex-scroll">
            <DataTable columns={CONTACT_COLS} rows={shown} initialSort="contacts" />
          </div>
        </div>
        <ContactHeatmap residue={residue} onSelect={toggleEpi} selected={epiFilter} />
      </div>
    </>
  )
}
