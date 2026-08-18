import React, { useMemo } from 'react'
import { methodCounts } from './methods'
import Hint, { helpHint } from '../components/Hint.jsx'

// Why every deposited compound is listed, including the ones that are only there because of how the
// crystal was grown. Complex-agnostic on purpose: it is shown on every page, and naming one complex
// as "here" would contradict itself on that complex's own page.
const LIGAND_NOTE = 'Listed as deposited, including crystallisation and cryoprotection '
  + 'additives. Only compounds that differ from the rest of the set are shown, so shared additives '
  + 'usually stay out. One that does appear often marks a single crystal form rather than a '
  + 'functional state.'

// What a drilled-in block of instances actually contains, as counts and ratios over the selection
// versus everything else. Every line is arithmetic on structured PDBe data — ligand codes, mutation
// records, experimental method. Nothing is inferred from a structure title, and no state is named.
//
// Two design rules, both learned the hard way on this data:
//
//   1. Always show the comparison, never a bare percentage. "24% carry E6V" sounds like a finding
//      until you learn the background rate is also 24%. The `vs rest` figure is what makes a number
//      mean anything, and the separation ratio is what stops an arbitrary drag reading as a block.
//
//   2. Provenance masquerades as biology. On human haemoglobin the top mutation hit for the deoxy
//      block is V1M at 36% vs 1% — a cloning artefact, enriched only because recombinant structures
//      were mostly solved deoxy. Residue-1 substitutions are therefore excluded outright, and method
//      mix and entry count are shown so a reader can see when a "finding" tracks who made the
//      structures rather than what they are.

// How to read the numbers. On the heading rather than on one row, because the same convention
// governs the ligands, the mutations and the modified residues alike.
const SELECTION_HELP = [
  ['The two percentages', 'The selection, then every instance not selected. Each is the proportion '
    + 'of structures carrying it, so several copies in one structure count once. Comparing against '
    + 'the rest rather than the whole set keeps the selection out of its own baseline. Hover a chip '
    + 'for the counts.'],
  ['The 15-point cutoff', 'A display threshold, not a test of significance. It is a difference in '
    + 'percentage points, so 42% against 30% is not listed. By permutation, a random selection of '
    + 'the same size clears it about 96% of the time, because dozens of ligands and sequence '
    + 'differences are compared at once.'],
  ['Reading it', 'A description of what you selected rather than a result. Below five instances no '
    + 'comparison is shown.'],
]

// Below this many instances the percentages are noise, so counts are reported instead.
const MIN_BLOCK = 5
// A ligand or mutation has to differ from the rest of the set by this much to be worth naming.
const ENRICH_PP = 0.15
// Substitutions at residue 1 are the initiator methionine — an artefact of recombinant expression,
// not biology. A positional rule, not a curated list of sequences to ignore.
const INITIATOR = /^[A-Z]1[A-Z]$/

const pct = (v) => `${Math.round(v * 100)}%`

// Fraction of a set of instances carrying each value of some property.
function frequency(instances, pick) {
  const counts = new Map()
  for (const a of instances) for (const v of new Set(pick(a))) counts.set(v, (counts.get(v) || 0) + 1)
  const out = new Map()
  for (const [k, n] of counts) out.set(k, n / instances.length)
  return out
}

// Values whose frequency inside the block differs from outside it by at least ENRICH_PP, most
// different first. `sign` selects enrichment (+1) or depletion (-1).
function differing(inBlock, outBlock, sign) {
  const keys = new Set([...inBlock.keys(), ...outBlock.keys()])
  return [...keys]
    .map((k) => ({ key: k, block: inBlock.get(k) || 0, rest: outBlock.get(k) || 0 }))
    .map((d) => ({ ...d, delta: (d.block - d.rest) * sign }))
    .filter((d) => d.delta >= ENRICH_PP)
    .sort((a, b) => b.delta - a.delta)
}

export default function BlockSummary({ block, assemblies, labels, matrix, cellLabel, rmsd,
                                       metricName, onClear, rangeLabel }) {
  const stats = useMemo(() => {
    const inSet = new Set(block)
    const byId = new Map(assemblies.map((a) => [a.assembly_id, a]))
    const blockRows = block.map((id) => byId.get(id)).filter(Boolean)
    const restRows = assemblies.filter((a) => !inSet.has(a.assembly_id))
    if (!blockRows.length) return null

    const idx = Object.fromEntries(labels.map((l, i) => [l, i]))
    const bi = block.map((id) => idx[id]).filter((i) => i != null)
    const ri = restRows.map((a) => idx[a.assembly_id]).filter((i) => i != null)
    // Mean over a rectangle of the matrix, skipping the diagonal when both axes are the same set.
    const mean = (rowsA, rowsB, sameSet) => {
      let sum = 0, n = 0
      for (const i of rowsA) for (const j of rowsB) {
        if (sameSet && i === j) continue
        sum += matrix[i][j]; n++
      }
      return n ? sum / n : null
    }
    const within = mean(bi, bi, true)
    const between = ri.length ? mean(bi, ri, false) : null
    // The largest pairwise value inside the selection, shown beside the mean. A selection that
    // spans two groups has a mean close to a single group's but a much larger maximum, so the
    // spread is where that shows. It is reported rather than tested on: see the note below.
    let withinMax = null
    for (const i of bi) for (const j of bi) {
      if (i !== j && (withinMax == null || matrix[i][j] > withinMax)) withinMax = matrix[i][j]
    }
    let rmsdWithin = null, rmsdMax = null
    if (rmsd) {
      let sum = 0, n = 0, max = 0
      for (const i of bi) for (const j of bi) {
        if (i === j) continue
        const v = rmsd.matrix[i][j]
        sum += v; n++; if (v > max) max = v
      }
      if (n) { rmsdWithin = sum / n; rmsdMax = max }
    }

    const entries = new Set(blockRows.map((a) => a.pdb_id)).size
    const methods = methodCounts(blockRows)
    const res = blockRows.map((a) => a.resolution).filter((r) => r != null).sort((a, b) => a - b)

    const ligIn = frequency(blockRows, (a) => (a.ligands || []).map((l) => l.comp))
    const ligOut = frequency(restRows, (a) => (a.ligands || []).map((l) => l.comp))
    const ligName = new Map()
    for (const a of assemblies) for (const l of a.ligands || []) if (l.name) ligName.set(l.comp, l.name)

    const realMut = (a) => (a.mutations || [])
      .map((m) => m.label).filter((l) => l && !INITIATOR.test(l))
    const mutIn = frequency(blockRows, realMut)
    const mutOut = frequency(restRows, realMut)
    // How many instances the excluded initiator substitutions affect, reported rather than hidden.
    const initiatorN = blockRows.filter((a) =>
      (a.mutations || []).some((m) => INITIATOR.test(m.label || ''))).length

    const modIn = frequency(blockRows, (a) => (a.modified || []).map((m) => m.comp))
    const modOut = frequency(restRows, (a) => (a.modified || []).map((m) => m.comp))

    return {
      n: blockRows.length, entries, methods, res, within, withinMax, between, rmsdWithin, rmsdMax,
      enriched: differing(ligIn, ligOut, 1), depleted: differing(ligIn, ligOut, -1),
      mutations: differing(mutIn, mutOut, 1), initiatorN,
      modified: differing(modIn, modOut, 1), ligName,
      small: blockRows.length < MIN_BLOCK,
      // Every comparison here is against the rest of the set, so when the selection IS the set
      // there is nothing to compare with. Without this, each ligand present in the selection would
      // read as "40% vs 0%" purely because the other side is empty.
      noRest: restRows.length === 0,
    }
  }, [block, assemblies, labels, matrix, rmsd])

  if (!stats) return null
  const s = stats
  const ratio = s.within > 0 && s.between != null ? s.between / s.within : null

  // A three-letter code identifies a compound but does not communicate one, so the chemical name
  // is shown beside it. Long systematic names are clipped and given in full on hover, since the
  // point is recognition ("carbon monoxide") rather than the full IUPAC string.
  const NAME_MAX = 26
  const ligChip = (d, dir) => {
    const full = s.ligName.get(d.key)
    const name = full ? full.toLowerCase() : null
    const short = name && name.length > NAME_MAX ? `${name.slice(0, NAME_MAX - 1)}…` : name
    return (
      <span key={d.key} className={`bs-chip ${dir}`}
            title={`${full ? `${d.key} — ${full}` : d.key}\n`
                   + `${Math.round(d.block * s.n)} of ${s.n} selected, `
                   + `${Math.round(d.rest * (assemblies.length - s.n))} of `
                   + `${assemblies.length - s.n} in the rest`}>
        <b>{d.key}</b>{short && <span className="bs-lig-name">{short}</span>}
        <span className="bs-nums"><b>{pct(d.block)}</b> vs {pct(d.rest)}</span>
      </span>
    )
  }

  const Row = ({ label, hint, children }) => (
    <div className="bs-row">
      <span className="bs-key">{label}{hint && <> <Hint text={hint} width={320} /></>}</span>
      <span className="bs-val">{children}</span>
    </div>
  )

  return (
    <div className="card cs-blocksummary">
      {/* Noun phrase, matching the other cards. "Composition" is the honest word for what the rows
          below are: what the selection is made of, and how that differs from everything else. It is
          not a verdict on whether the selection is one group — the note says so, because no
          statistic here can tell. */}
      <h2>
        Selection composition {helpHint(SELECTION_HELP, { width: 360 })}
        <span className="cs-count">{s.n} of {assemblies.length}</span>
        {onClear && (
          <button className="cs-linkbtn cs-clear-inline" onClick={onClear}
                  title="Return to the full matrix">show all</button>
        )}
      </h2>
      {/* States the limit plainly rather than implying a judgement the numbers cannot support. A
          selection spanning two groups has almost the same mean as a single group — measured on
          ATCase, 0.020 against 0.016, and a HIGHER separation from the rest (4.3x against 5.6x) —
          so no statistic here distinguishes them. The spread is reported so a mixture is visible,
          and the matrix sits directly above, where the boundary you crossed is on screen. */}
      <p className="note">
        {rangeLabel} Summarises the rows you selected, compared with every other instance in the
        set. It does not test whether they form one group.
      </p>

      <div className="bs-grid">
        <Row label="Instances">
          <b>{s.n}</b> from <b>{s.entries}</b> PDB {s.entries === 1 ? 'entry' : 'entries'}
          {s.entries < s.n && (
            <span className="bs-note"> — {s.n - s.entries} are additional assemblies of an entry
              already counted, so this block is less independent than its size suggests</span>
          )}
        </Row>

        <Row label="Method">
          {s.methods.map((m) => `${m.n} ${m.label}`).join(' · ')}
          {s.res.length > 0 && (
            <span className="bs-note"> · {s.res[0].toFixed(2)}–{s.res[s.res.length - 1].toFixed(2)} Å
              {s.res.length < s.n && ` (${s.n - s.res.length} without a resolution)`}</span>
          )}
        </Row>

        <Row label={`Tightness (${metricName})`}>
          {s.within == null ? '—' : <>within <b>{s.within.toFixed(3)}</b> {cellLabel}</>}
          {s.between != null && <> · rest of the set {s.between.toFixed(3)}</>}
          {s.withinMax != null && <span className="bs-note"> (up to {s.withinMax.toFixed(3)})</span>}
          {ratio && <> · <b>{ratio.toFixed(1)}×</b> apart</>}
          {s.rmsdWithin != null && (
            <span className="bs-note"> · backbone RMSD {s.rmsdWithin.toFixed(2)} Å,
              up to {s.rmsdMax.toFixed(2)} Å</span>
          )}
        </Row>

        <Row label="Bound ligands" hint={LIGAND_NOTE}>
          {s.noRest ? <span className="bs-note">the selection is the whole set, so there is nothing
            to compare it against</span>
           : s.small ? <span className="bs-note">too few instances to compare reliably</span> : (
            <>
              {s.enriched.length === 0 && s.depleted.length === 0 && (
                <span className="bs-note">nothing differs from the rest by {pct(ENRICH_PP)} or more</span>
              )}
              {s.enriched.map((d) => ligChip(d, 'bs-up'))}
              {s.depleted.map((d) => ligChip(d, 'bs-down'))}
            </>
          )}
        </Row>

        <Row label="Mutations">
          {s.noRest ? <span className="bs-note">nothing to compare against</span>
           : s.small ? <span className="bs-note">too few instances to compare reliably</span> : (
            <>
              {s.mutations.length === 0 && (
                <span className="bs-note">none differs from the rest by {pct(ENRICH_PP)} or more</span>
              )}
              {s.mutations.map((d) => (
                <span key={d.key} className="bs-chip bs-up">
                  {d.key} <b>{pct(d.block)}</b> vs {pct(d.rest)}
                </span>
              ))}
              {s.initiatorN > 0 && (
                <span className="bs-note"> — {s.initiatorN} instance{s.initiatorN === 1 ? '' : 's'}
                  {' '}also carry a residue-1 substitution, excluded as an initiator-methionine
                  artefact of recombinant expression</span>
              )}
            </>
          )}
        </Row>

        {s.modified.length > 0 && (
          <Row label="Modified residues">
            {s.modified.map((d) => (
              <span key={d.key} className="bs-chip bs-up">
                {d.key} <b>{pct(d.block)}</b> vs {pct(d.rest)}
              </span>
            ))}
          </Row>
        )}
      </div>
    </div>
  )
}
