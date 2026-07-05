import React, { useMemo, useState } from 'react'
import ContactHeatmap from './ContactHeatmap.jsx'
import DataTable from './DataTable.jsx'
import Hint from './Hint.jsx'
import { REGION_COLORS } from '../data.js'

// ── The complex-level atlas: every antibody bound to the antigen, aggregated onto one normalised
// view. Antigen residues by UniProt position, antibody residues by IMGT. Counts are STRUCTURAL
// COVERAGE across deposited complexes (what has been solved), NOT immunodominance — the PDB is not a
// random sample. The contacts↔structures toggle is the de-bias: "structures" counts distinct PDB
// entries so 200 re-depositions of one antibody don't dwarf a residue seen once each in 20.

// Aggregate ONE chain type's contacts per (antigen residue, antibody IMGT residue) — moved here from
// Explorer with the row-3 aggregation. Antibody residue = name + IMGT position (its conserved
// cross-structure identity); region is constant for a given IMGT position.
function contactTable(rows) {
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
      contacts: 0, asm: new Set(),
    })
    const e = m.get(k)
    e.contacts += 1
    e.asm.add(`${p.pdb_id}|${p.assembly_id}`)
  }
  return [...m.values()].map((e) => ({ ...e, assemblies: e.asm.size }))
}

const CONTACT_COLS = [
  { key: 'antigen', label: 'Antigen residue', sortValue: (r) => r.antigen_uniprot_position ?? Infinity },
  { key: 'antibody_residue', label: 'Antibody residue',
    sortValue: (r) => (r.ab_pos ?? 9999) + (r.ab_ins ? (r.ab_ins.charCodeAt(0) - 64) / 100 : 0) },
  { key: 'region', label: 'Antibody region' },
  { key: 'contacts', label: 'Contacts', num: true,
    help: 'Residue-level contacts for this epitope–paratope residue pair, summed across every deposited complex (one per contacting instance).' },
  { key: 'assemblies', label: 'Assemblies', num: true,
    help: 'Number of distinct structural assemblies (PDB entry + assembly) in which this exact residue pair is in contact — de-biases redundant re-deposition.' },
]

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
function ParatopeConvergence({ abImgt }) {
  const [side, setSide] = useState('all')  // 'all' | 'heavy' | 'light'
  const rows = useMemo(() => abImgt
    .filter((r) => side === 'all' || r.antibody_chain_type === side)
    .sort((a, b) => b.total_antigen_contacts - a.total_antigen_contacts), [abImgt, side])
  const max = Math.max(1, ...rows.map((r) => r.total_antigen_contacts))

  return (
    <div className="card ex-cell">
      <h2>Paratope convergence</h2>
      <p className="note">Antibody residues (by IMGT position, coloured by region) ranked by how often they
        contact the antigen across all complexes — where recognition converges.</p>
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
            <tr><th>Antibody residue</th><th>Region</th>
              <th>Antigen contacts<Hint text="Residue-level antigen contacts made by this antibody IMGT position, summed across every deposited complex — how often recognition converges here." /></th>
              <th className="num">Structures<Hint text="Distinct structural assemblies in which this antibody position contacts the antigen." /></th>
              <th>Top contacted antigen residues</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.antibody_chain_type}|${r.antibody_imgt_position}|${r.antibody_residue_name}`}>
                <td><b>{r.antibody_residue_name}{r.antibody_imgt_position}</b></td>
                <td><span className="rtag" style={{ background: (REGION_COLORS[r.antibody_imgt_region] || '#ccc') + '33',
                  color: REGION_COLORS[r.antibody_imgt_region] || '#555' }}>{r.antibody_imgt_region}</span></td>
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
function RegionContribution({ regions }) {
  const rows = useMemo(() => [...regions]
    .sort((a, b) => b.percentage_of_total_contacts - a.percentage_of_total_contacts), [regions])
  const max = Math.max(1, ...rows.map((r) => r.percentage_of_total_contacts))
  return (
    <div className="card ex-cell">
      <h2>CDR &amp; framework contribution</h2>
      <p className="note">Share of all antigen contacts by antibody region, pooled across every complex.
        CDR-H3 typically dominates the paratope.</p>
      <div className="rc-list">
        {rows.map((r) => (
          <div key={`${r.antibody_chain_type}|${r.antibody_imgt_region}`} className="rc-row">
            <span className="rc-name">{r.antibody_imgt_region}</span>
            <div className="rc-bar">
              <div className="rc-fill" style={{ width: `${(r.percentage_of_total_contacts / max) * 100}%`,
                background: REGION_COLORS[r.antibody_imgt_region] || '#999' }} />
            </div>
            <span className="rc-val">{r.percentage_of_total_contacts}%</span>
            <span className="rc-sub">{r.total_contacts} contacts · {r.unique_antigen_positions_contacted} epitope residues</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function ComplexOverview({ abImgt, regions, residue }) {
  // Epitope×paratope map + aggregated contact table, migrated from Explorer's row 3. Whole complex
  // (both chains) — the heatmap keeps its own value toggle; row-click filters the table (epiFilter).
  const [epiFilter, setEpiFilter] = useState(null)
  const toggleEpi = (pos) => setEpiFilter((p) => (p === pos ? null : pos))

  const contactRows = useMemo(() => contactTable(residue), [residue])
  const shown = useMemo(() => epiFilter == null ? contactRows
    : contactRows.filter((r) => r.antigen_uniprot_position === epiFilter), [contactRows, epiFilter])
  const epiLabel = epiFilter == null ? null
    : (contactRows.find((r) => r.antigen_uniprot_position === epiFilter)?.antigen ?? `residue ${epiFilter}`)

  return (
    <>
      {/* Full-width stacked: region summary -> detailed paratope. The antigen-side ranking + heavy/
          light split now live in the contact map below (its Σ / ΣH / ΣL columns), so there's no
          separate epitope-hotspots table — it duplicated the map. */}
      <div className="ex-row">
        <RegionContribution regions={regions} />
      </div>

      <div className="ex-row">
        <ParatopeConvergence abImgt={abImgt} />
      </div>

      {/* Migrated row 3 — epitope×paratope contact map linked to the aggregated contact table. */}
      <div className="ex-row ex-row3">
        <div className="card ex-cell">
          <h2>Aggregated contact table</h2>
          <p className="note">One row per epitope–paratope residue pair across <b>all</b> complexes.
            Sorted by contacts.</p>
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
