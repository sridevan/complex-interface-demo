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
//   'antibody' — collapse by SAbDab2 ID: each distinct antibody counted once per bucket. This removes
//                deposition redundancy (a mAb solved in 20 PDBs / many symmetry copies stops dominating).
// The 'all' numbers reproduce the precomputed pipeline aggregates exactly; 'antibody' is derived
// client-side from the same residue-level pairs joined to the SAbDab2 lookup. See fetch_sabdab2_ids.py.
const WEIGHTS = { all: 'All contacts', antibody: 'Per antibody (SAbDab2)' }
const WEIGHT_HELP = 'How repeated structures of the SAME antibody are counted. “All contacts” counts '
  + 'every deposited instance — so a mAb solved many times (or in many symmetry copies) dominates. '
  + '“Per antibody” collapses by SAbDab2 ID, counting each distinct antibody once per row — removing '
  + 'deposition redundancy. The PDB is not a random sample, so per-antibody is the fairer denominator.'

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

// Recompute the paratope-convergence table (per antibody IMGT residue) client-side so it honours the
// weighting toggle. In 'all' mode this reproduces aggregated_antibody_imgt_contacts.json exactly.
function aggParatope(rows, lookup, weight) {
  const m = new Map()
  for (const p of rows) {
    if (p.antibody_imgt_position == null) continue      // precomputed aggregate excludes unmapped
    const k = `${p.antibody_chain_type}|${p.antibody_imgt_position}|${p.antibody_residue_name}`
    if (!m.has(k)) m.set(k, {
      antibody_chain_type: p.antibody_chain_type, antibody_imgt_position: p.antibody_imgt_position,
      antibody_residue_name: p.antibody_residue_name, antibody_imgt_region: p.antibody_imgt_region,
      raw: 0, sab: new Set(), asm: new Set(), agres: new Map(),
    })
    const e = m.get(k)
    e.raw += 1
    e.sab.add(sabId(lookup, p))
    e.asm.add(`${p.pdb_id}|${p.assembly_id}`)
    if (p.antigen_uniprot_position != null) {
      const av = `${p.antigen_residue_name}${p.antigen_uniprot_position}`
      if (!e.agres.has(av)) e.agres.set(av, { raw: 0, sab: new Set() })
      const a = e.agres.get(av); a.raw += 1; a.sab.add(sabId(lookup, p))
    }
  }
  return [...m.values()].map((e) => ({
    ...e,
    total_antigen_contacts: metricOf(e, weight),
    assemblies_contacted: e.asm.size,
    most_common_contacted_antigen_residues: [...e.agres.entries()]
      .map(([value, a]) => ({ value, count: weight === 'antibody' ? a.sab.size : a.raw }))
      .sort((x, y) => y.count - x.count).slice(0, 5),
  }))
}

// Recompute CDR/framework region contribution client-side, honouring the weighting toggle. In 'all'
// mode this reproduces imgt_region_contribution.json exactly (percentage over all mapped contacts).
function aggRegions(rows, lookup, weight) {
  const m = new Map()
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
    e.sab.add(sabId(lookup, p))
    if (p.antigen_uniprot_position != null) e.agpos.add(`${p.antigen_uniprot_accession}|${p.antigen_uniprot_position}`)
  }
  const vals = [...m.values()].map((e) => ({ ...e, total_contacts: metricOf(e, weight),
    unique_antigen_positions_contacted: e.agpos.size }))
  const denom = vals.reduce((s, r) => s + r.total_contacts, 0) || 1
  return vals.map((r) => ({ ...r, percentage_of_total_contacts: Math.round(1000 * r.total_contacts / denom) / 10 }))
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

// ── Section 1: paratope convergence ────────────────────────────────────────────────────────────
function ParatopeConvergence({ abImgt, weight }) {
  const [side, setSide] = useState('all')  // 'all' | 'heavy' | 'light'
  const rows = useMemo(() => abImgt
    .filter((r) => side === 'all' || r.antibody_chain_type === side)
    .sort((a, b) => b.total_antigen_contacts - a.total_antigen_contacts), [abImgt, side])
  const max = Math.max(1, ...rows.map((r) => r.total_antigen_contacts))
  const byAb = weight === 'antibody'
  const contactHelp = byAb
    ? 'Distinct antibodies (SAbDab2 ID) whose paratope includes this IMGT position — each antibody counted once, deposition redundancy removed.'
    : 'Residue-level antigen contacts made by this antibody IMGT position, summed across every deposited complex — how often recognition converges here.'

  return (
    <div className="card ex-cell">
      <h2>Paratope convergence</h2>
      <p className="note">Antibody residues (by IMGT position, coloured by{' '}
        <a href={REGION_REF_URL} target="_blank" rel="noopener noreferrer">IMGT region</a>) ranked by how
        often they contact the antigen {byAb ? 'across distinct antibodies' : 'across all complexes'} — where recognition converges.</p>
      <div className="controls">
        <label>Chain</label>
        <span className="pill">
          {['all', 'heavy', 'light'].map((s) => (
            <button key={s} className={side === s ? 'active' : ''} onClick={() => setSide(s)}>
              {s[0].toUpperCase() + s.slice(1)}</button>
          ))}
        </span>
        <span className="rowcount">{rows.length} IMGT positions</span>
      </div>
      <div className="ex-scroll">
        <table>
          <thead>
            <tr><th>Ab residue</th><th>Ab region<Hint text={AB_REGION_HELP} /></th>
              <th>{byAb ? 'Antibodies' : 'Ag contacts'}<Hint text={contactHelp} /></th>
              <th className="num">Structures<Hint text="Distinct structural assemblies in which this antibody position contacts the antigen." /></th>
              <th>Top contacted Ag residues</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.antibody_chain_type}|${r.antibody_imgt_position}|${r.antibody_residue_name}`}>
                <td><b>{r.antibody_residue_name}{r.antibody_imgt_position}</b></td>
                <td><span className="rtag" style={{ background: REGION_COLORS[r.antibody_imgt_region] || '#8a94a6',
                  color: chipInk(REGION_COLORS[r.antibody_imgt_region] || '#8a94a6') }}>{r.antibody_imgt_region}</span></td>
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
        ? 'weighted per distinct antibody (SAbDab2) so redundant re-depositions don’t skew it'
        : 'pooled across every complex'}. CDR-H3 typically dominates the paratope.</p>
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
