import React from 'react'
import { methodCounts } from './methods'

// What went into this page, beside the table it describes. Facts only, no reasons: the aim is that
// a reader can see at a glance how much was analysed and whether anything is absent, without
// having to infer it from a table that silently shows fewer rows than they expected.
//
// Everything here is derived from the dataset itself, so a complex with nothing missing simply
// shows fewer lines rather than a row of zeroes and "none" that has to be read to be dismissed.

const METRIC_NAME = { shape: 'Shape', tmscore: 'TM-score', rmsd: 'RMSD' }
const num = (n) => n.toLocaleString()

export default function RunSummary({ data, metricKeys }) {
  const A = data.assemblies
  const n = A.length
  const entries = new Set(A.map((a) => a.pdb_id)).size
  const pairs = (n * (n - 1)) / 2
  const cov = data.heatmap && data.heatmap.coverage
  const subset = data.subset
  const noOverlay = A.filter((a) => a.superposes_with_reference === false).length
  const noRes = A.filter((a) => a.resolution == null).length
  const res = A.map((a) => a.resolution).filter((r) => r != null).sort((a, b) => a - b)
  const methods = methodCounts(A)
  const cx = data.complex
  // The bare word "Shape" names nothing a reader can check, so the panel uses the dataset's own
  // label for it ("Shape (combined Zernike + spectral)") rather than restating the composition
  // here, which would drift from the builder. TM-score and RMSD keep short names: their dataset
  // labels are long ("Backbone RMSD after superposition (US-align)") and what goes into them is
  // already in the measure info icon.
  const M = (data.heatmap && data.heatmap.metrics) || {}
  const nameOf = (k) => (k === 'shape' && M.shape && M.shape.label) || METRIC_NAME[k]
  const missing = metricKeys.length < 2 ? ['TM-score', 'Shape'].filter(
    (x) => !metricKeys.map((k) => METRIC_NAME[k]).includes(x)) : []

  const Line = ({ label, children, muted }) => (
    <div className={'rs-line' + (muted ? ' rs-muted' : '')}>
      <span className="rs-key">{label}</span>
      <span className="rs-val">{children}</span>
    </div>
  )

  // A stat tile: label in sentence case with no trailing colon, value in semibold sans. Deliberately
  // NOT tabular figures — those give every digit the width of a zero, which reads loose at this
  // size. Tabular numerals are for columns that must align vertically, which these are not.
  const Stat = ({ label, value, sub }) => (
    <div className="rs-stat">
      <div className="rs-stat-value">{value}</div>
      <div className="rs-stat-label">{label}</div>
      {sub && <div className="rs-stat-sub">{sub}</div>}
    </div>
  )

  return (
    <div className="card cs-runsummary">
      {/* Noun phrase, like every other card heading on the page. "Provenance" rather than "Summary"
          because the point of the card is where the numbers came from and what is missing from
          them, not a digest of the findings. */}
      <h2>Analysis provenance</h2>

      <div className="rs-kpi">
        <Stat label="Assemblies" value={num(n)} />
        {/* No "N repeat" sub-line: it was arithmetic on the two figures either side of it, and the
            point it made about independence is made where it bites, in the selection summary. */}
        <Stat label="PDB entries" value={num(entries)} />
        {/* "Comparisons", not "Pairs": the number counts work done, which is what this card is
            about, and it matches what the heatmap's own help calls a cell. The sub-line says where
            the number comes from, since n(n-1)/2 is not self-evident from 341 assemblies. */}
        <Stat label="Comparisons" value={num(pairs)} sub="one per pair" />
      </div>

      {/* Coverage per measure, including any computed and then dropped. Listing only what is shown
          would imply the others were never attempted, which is the illusion this panel exists to
          prevent. The meter's unfilled track is a lighter step of the same hue rather than grey, so
          a nearly-empty bar still reads as the same quantity partially filled. State is carried by
          the word, not by colour. */}
      {cov && (
        <div className="rs-section">
          <div className="rs-section-label">Measure coverage</div>
          {/* TM-score first as the measure a page opens on, then Shape as the fallback. RMSD has
              no meter of its own: US-align writes it into the same scores row as TM-score, so its
              coverage is identical by construction (verified on all eight datasets, including the
              sparse one at 4,431 of 57,970 for both). A second bar with the same number would read
              as a second measurement. It is named on the TM-score row instead, so the reader still
              learns it exists and rides on hover. Fixed order rather than sorted by coverage, so
              the rows do not reshuffle between complexes. */}
          {['tmscore', 'shape'].map((k) => {
            const c = cov.metrics?.[k]
            if (!c) return null
            const frac = pairs ? Math.min(1, c.pairs / pairs) : 0
            const shown = c.shown || (k === 'rmsd' && c.per_pair)
            return (
              <div key={k} className={'rs-measure' + (shown ? '' : ' rs-off')}>
                <div className="rs-measure-head">
                  <span className="rs-measure-name">{nameOf(k)}</span>
                  <span className="rs-measure-state">
                    {shown ? (k === 'rmsd' ? 'on hover' : 'shown') : 'not shown'}
                  </span>
                </div>
                <div className="rs-meter" role="img"
                     aria-label={`${nameOf(k)}: ${num(c.pairs)} of ${num(pairs)} comparisons`}>
                  <span className="rs-meter-fill" style={{ width: `${frac * 100}%` }} />
                </div>
                <div className="rs-measure-cov">
                  {frac >= 1 ? `all ${num(pairs)} comparisons`
                             : `${num(c.pairs)} of ${num(pairs)} comparisons`}
                  {k === 'tmscore' && cov.metrics?.rmsd && (
                    <span className="rs-note"> · backbone RMSD from the same run, on hover</span>)}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="rs-section">
        <div className="rs-section-label">Composition</div>
        <div className="rs-list">
          <Line label="Method">
            {methods.map((m) => `${num(m.n)} ${m.label}`).join(' · ')}
          </Line>
          {cx?.oligomeric_state && (
            <Line label="Assembly">
              {cx.oligomeric_state}
              {cx.symmetry && <span className="rs-note"> · symmetry {cx.symmetry}</span>}
            </Line>
          )}
          {res.length > 0 && (
            <Line label="Resolution">
              {res[0].toFixed(2)}–{res[res.length - 1].toFixed(2)} Å
            </Line>
          )}
          {/* Only rendered when there is something to say, so a clean dataset stays short rather
              than listing zeroes that have to be read to be dismissed. */}
          {subset && subset.group_sizes && subset.group_sizes.length > 1 && (
            <Line label="Packing groups" muted>
              <b>{subset.group_sizes.length}</b> ({subset.group_sizes.join(', ')})
              {subset.applied
                ? <span className="rs-note"> · {num(subset.of - subset.kept)} excluded</span>
                : noOverlay > 0 && <span className="rs-note"> · {num(noOverlay)} do not overlay</span>}
            </Line>
          )}
          {noRes > 0 && <Line label="No resolution" muted><b>{num(noRes)}</b></Line>}
          {!cov && (
            <Line label="Measures">{metricKeys.map((k) => METRIC_NAME[k] || k).join(', ')}
              {missing.length > 0 && (
                <span className="rs-note"> · {missing.join(' and ')} not available</span>)}
            </Line>
          )}
        </div>
      </div>

      {/* Two different structures, kept apart on purpose. The reference is chosen here, as the
          medoid, because a central frame keeps every transform small. The representative is PDBe's
          own editorial choice for the complex, which is what a reader will see elsewhere on the
          site; it is named but never superposed onto. */}
      <p className="rs-foot">
        Superposed onto reference assembly <span className="mono">{data.reference_assembly}</span>
        {cx?.representative && (
          <>
            <br />
            PDBe representative <span className="mono">{cx.representative}</span>
            {cx.representative_in_set === false && (
              <span className="rs-note"> · not among the scored assemblies</span>)}
          </>
        )}
      </p>
    </div>
  )
}
