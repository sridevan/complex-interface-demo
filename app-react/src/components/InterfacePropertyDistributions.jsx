import React, { useMemo } from 'react'
import Hint from './Hint.jsx'

// PISA per-interface properties to profile. digits = decimal places for display / axis labels.
// `desc` describes the value FOR THE SELECTED INTERFACE (a single {chain}-chain–antigen interface);
// {chain} is filled with the active chain type. A common suffix explains the distribution/chart.
const PROPS = [
  { key: 'interface_area', label: 'Buried surface area', unit: 'Å²', digits: 0,
    desc: 'Buried surface area of the selected {chain} chain–antigen interface — area excluded from solvent on binding (PISA). Larger = bigger interface.' },
  { key: 'solvation_energy', label: 'Solvation energy ΔᵢG', unit: 'kcal/mol', digits: 1,
    desc: 'Solvation free-energy gain when the selected {chain} chain–antigen interface forms (PISA). More negative = more hydrophobic burial driving binding.' },
  { key: 'stabilization_energy', label: 'Stabilisation energy', unit: 'kcal/mol', digits: 1,
    desc: 'Stabilisation (dissociation) energy of the selected {chain} chain–antigen interface (PISA). More negative = a more stable interface.' },
  { key: 'p_value', label: 'Interface P-value', unit: '', digits: 2,
    desc: 'Specificity P-value of the selected {chain} chain–antigen interface (PISA). < 0.5 = more hydrophobic/specific than a random patch of equal area; > 0.5 = less.' },
  { key: 'number_interface_residues', label: 'Interface residues', unit: '', digits: 0, discrete: true,
    desc: 'Residues buried at the selected {chain} chain–antigen interface, counting both partners (PISA).' },
  { key: 'number_hydrogen_bonds', label: 'Hydrogen bonds', unit: '', digits: 0, discrete: true,
    desc: 'Hydrogen bonds between the {chain} chain and the antigen in the selected interface (PISA).' },
  { key: 'number_salt_bridges', label: 'Salt bridges', unit: '', digits: 0, discrete: true,
    desc: 'Salt bridges between the {chain} chain and the antigen in the selected interface (PISA).' },
  { key: 'number_other_bonds', label: 'Other bonds', unit: '', digits: 0, discrete: true,
    desc: 'Other close contacts (not H-bond, salt bridge, disulfide or covalent) between the {chain} chain and the antigen in the selected interface (PISA) — the bulk of interface atom contacts.' },
  { key: 'number_disulfide_bonds', label: 'Disulfide bonds', unit: '', digits: 0, discrete: true,
    desc: 'Disulfide bonds between the {chain} chain and the antigen in the selected interface (PISA); rare.' },
  { key: 'number_covalent_bonds', label: 'Covalent bonds', unit: '', digits: 0, discrete: true,
    desc: 'Covalent bonds between the {chain} chain and the antigen in the selected interface (PISA); rare.' },
]

const N_BINS = 12

function fmtNum(v, d) {
  if (v == null || Number.isNaN(v)) return '—'
  return d === 0 ? Math.round(v).toLocaleString() : v.toFixed(d)
}

const W = 240, H = 56, GAP = 2
// A count property with a small integer range gets one bar per value (bond counts); anything else —
// continuous energies/areas or a wide integer range — gets a binned histogram.
const MAX_DISCRETE_SPAN = 24

function Bars({ bars, selIdx }) {
  const maxCount = Math.max(...bars, 1)
  const bw = (W - GAP * (bars.length - 1)) / bars.length
  return bars.map((c, i) => {
    const h = (c / maxCount) * (H - 2)
    return <rect key={i} x={i * (bw + GAP)} y={H - h} width={bw} height={h}
      className={'ipd-bar' + (i === selIdx ? ' sel' : '')} />
  })
}

// Distribution of the population with the selected interface's value marked.
function Distribution({ clean, min, max, selected, discrete }) {
  if (clean.length < 2 || min == null) return <div className="ipd-nodata">not enough data</div>

  // Every interface has the same value (e.g. 0 disulfide/covalent bonds): a distribution would be
  // misleading, so state it plainly. Auto-renders real bars once any value differs.
  if (max === min) return <div className="ipd-nodata">{Math.round(min)} in all {clean.length} interfaces</div>

  // Discrete: one bar per integer value, with an orange marker line centred on the selected value's
  // bar. The line (not just the highlighted bar) is essential because an outlier selection — e.g. 8
  // salt bridges when almost all interfaces have 0-2 — has a ~1px-tall bar that's invisible on its own.
  if (discrete && (max - min) <= MAX_DISCRETE_SPAN) {
    const bars = new Array(max - min + 1).fill(0)
    for (const v of clean) bars[Math.round(v) - min]++
    const selIdx = selected == null ? -1 : Math.round(selected) - min
    const bw = (W - GAP * (bars.length - 1)) / bars.length
    const selX = selIdx < 0 ? null : selIdx * (bw + GAP) + bw / 2
    return (
      <svg className="ipd-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <Bars bars={bars} selIdx={selIdx} />
        {selX != null && <line x1={selX} y1="0" x2={selX} y2={H} className="ipd-marker"
          vectorEffect="non-scaling-stroke" />}
      </svg>
    )
  }

  // Continuous: binned histogram + a precise marker line at the selected value (bins are ranges).
  const span = (max - min) || 1
  const binOf = (v) => Math.min(N_BINS - 1, Math.max(0, Math.floor(((v - min) / span) * N_BINS)))
  const bins = new Array(N_BINS).fill(0)
  for (const v of clean) bins[binOf(v)]++
  const selBin = selected == null ? -1 : binOf(selected)
  const selX = selected == null ? null : ((selected - min) / span) * W
  return (
    <svg className="ipd-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <Bars bars={bins} selIdx={selBin} />
      {selX != null && <line x1={selX} y1="0" x2={selX} y2={H} className="ipd-marker"
        vectorEffect="non-scaling-stroke" />}
    </svg>
  )
}

// Distribution of each interface property across the selected chain type's interfaces, with the
// selected instance marked — the PISA "where does this interface sit in the population" view.
export default function InterfacePropertyDistributions({ instances, selected, chainType }) {
  const cards = useMemo(() => PROPS.map((p) => {
    const clean = instances.map((r) => r[p.key]).filter((v) => v != null && !Number.isNaN(v))
    const sel = selected ? selected[p.key] : null
    const min = clean.length ? Math.min(...clean) : null
    const max = clean.length ? Math.max(...clean) : null
    // Percentile: share of interfaces at or below the selected value.
    const pct = (sel != null && clean.length)
      ? Math.round((clean.filter((v) => v <= sel).length / clean.length) * 100) : null
    return { p, clean, sel, min, max, pct }
  }), [instances, selected])

  return (
    <div className="card ex-cell">
      <h2>Interface property distributions</h2>
      <p className="note">PISA properties of the selected interface (highlighted in orange) against all
        {' '}<b>{chainType}-chain</b> interfaces in the complex (n = {instances.length}), with the selected
        interface highlighted. Small-range bond counts show one bar per value; energies, areas and wide
        ranges are binned.</p>
      <div className="ipd-grid">
        {cards.map(({ p, clean, sel, min, max, pct }) => (
          <div key={p.key} className="ipd-card">
            <div className="ipd-head"><span className="ipd-label">{p.label}</span>
              <Hint text={`${p.desc.replaceAll('{chain}', chainType)} The chart shows how this compares across all ${chainType}-chain interfaces in the complex (n = ${instances.length}); the selected interface is highlighted.`} /></div>
            <div className="ipd-val">
              <b>{fmtNum(sel, p.digits)}</b>{p.unit ? ' ' + p.unit : ''}
              {pct != null && <span className="ipd-pct">{pct}ᵗʰ pct</span>}
            </div>
            <Distribution clean={clean} min={min} max={max} selected={sel} discrete={p.discrete} />
            <div className="ipd-axis"><span>{fmtNum(min, p.digits)}</span><span>{fmtNum(max, p.digits)}</span></div>
          </div>
        ))}
      </div>
    </div>
  )
}
