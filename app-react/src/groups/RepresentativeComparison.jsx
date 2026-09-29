import React from 'react'
import Hint from '../components/Hint.jsx'

// Representative comparison: the medoid of the selected structural group superposed on the medoid
// of one other group, and nothing else in the viewer. It answers one question, how different are
// the representative structures of two groups, and it is the view that still works when a group
// holds hundreds of assemblies and superposing its members would show a tangle.
//
// Visualization only. It changes what the viewer draws. The selected group, its statistics, the
// associated features and the clustering are owned by the page and are never written from here.
//
// Shared by every structural-groups page: it takes groups and a pairwise lookup, and knows nothing
// about which complex it is looking at.

// The two structure colours. Blue and orange: separable under every common colour-vision
// deficiency, and neither is a group colour (coral, magenta, rust, cyan) or a step of viridis.
export const COMPARE_COLORS = ['#0072B2', '#E69F00']

const METRICS_NOTE = 'Between the two representatives only, from the same pairwise comparison the '
  + 'matrix shows. TM-score is averaged over both directions and reported to two decimals. '
  + 'RMSD is over the aligned backbone.'

// pair(a, b) -> { dissimilarity, rmsd } for two assembly ids; rmsd may be null.
export function comparisonOf(selected, other, pair) {
  const p = pair(selected.representative, other.representative)
  return {
    entries: [
      { assembly_id: selected.representative, color: COMPARE_COLORS[0] },
      { assembly_id: other.representative, color: COMPARE_COLORS[1] },
    ],
    tm: 1 - p.dissimilarity,
    dissimilarity: p.dissimilarity,
    rmsd: p.rmsd,
  }
}

const Dot = ({ color }) => <span className="sg-dot" style={{ '--g': color }} />
const Swatch = ({ color }) => <span className="cs-swatch" style={{ background: color }} />

// The control shown beside the normal superposition: pick the other group, then compare.
export function CompareControl({ groups, selected, withId, onWith, onCompare }) {
  const others = groups.filter((g) => g.id !== selected.id)
  if (!others.length) return null
  return (
    <div className="sg-compare">
      <span className="sg-compare-title">Compare representatives</span>
      <span className="sg-compare-from">
        <Dot color={selected.color} />{selected.label}
        <span className="sg-compare-id"> · representative {selected.representative}</span>
      </span>
      <label className="sg-compare-with">
        <span>Compare with</span>
        <select value={withId} onChange={(e) => onWith(Number(e.target.value))}>
          {others.map((g) => (
            <option key={g.id} value={g.id}>{g.name} · {g.representative}</option>
          ))}
        </select>
      </label>
      <button type="button" className="sg-compare-go" onClick={onCompare}>
        Compare representatives
      </button>
    </div>
  )
}

// What replaces that control while comparing: who is on screen, how far apart they are, and the
// way back.
export function ComparePanel({ selected, other, comparison, onExit }) {
  const rows = [[selected, comparison.entries[0]], [other, comparison.entries[1]]]
  return (
    <div className="sg-compare on">
      <div className="sg-compare-reps">
        {rows.map(([g, e]) => (
          <div key={g.id} className="sg-compare-rep">
            <Swatch color={e.color} />
            <span>{g.label ?? g.name} representative:</span>
            <b className="mono">{e.assembly_id}</b>
          </div>
        ))}
      </div>
      <div className="sg-compare-metrics">
        <span><i>TM-score</i><b>{comparison.tm.toFixed(3)}</b></span>
        <span><i>1 − TM-score</i><b>{comparison.dissimilarity.toFixed(3)}</b></span>
        {comparison.rmsd != null && (
          <span><i>RMSD</i><b>{comparison.rmsd.toFixed(2)} Å</b></span>
        )}
        <Hint text={METRICS_NOTE} width={300} />
      </div>
      <button type="button" className="sg-compare-back" onClick={onExit}>
        ← Back to group view
      </button>
    </div>
  )
}
