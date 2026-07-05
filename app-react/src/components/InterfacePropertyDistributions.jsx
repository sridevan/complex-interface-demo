import React, { useMemo } from 'react'
import Hint from './Hint.jsx'

// PISA per-interface properties to profile. digits = decimal places for display / axis labels.
const PROPS = [
  { key: 'interface_area', label: 'Buried surface area', unit: 'Å²', digits: 0,
    help: 'PISA buried surface area (BSA): total area excluded from solvent when the interface forms. Larger = bigger interface.' },
  { key: 'solvation_energy', label: 'Solvation energy ΔᵢG', unit: 'kcal/mol', digits: 1,
    help: 'PISA solvation free-energy gain on interface formation. More negative = more hydrophobic burial driving binding.' },
  { key: 'stabilization_energy', label: 'Stabilisation energy', unit: 'kcal/mol', digits: 1,
    help: 'PISA stabilisation (dissociation) energy of the interface. More negative = a more stable interface.' },
  { key: 'p_value', label: 'Interface P-value', unit: '', digits: 2,
    help: 'PISA interface specificity P-value. < 0.5 = interface more hydrophobic (specific) than a random patch of equal area; > 0.5 = less.' },
  { key: 'number_interface_residues', label: 'Interface residues', unit: '', digits: 0, discrete: true,
    help: 'Number of residues (both partners) buried at the interface, per PISA.' },
  { key: 'number_hydrogen_bonds', label: 'Hydrogen bonds', unit: '', digits: 0, discrete: true,
    help: 'Number of hydrogen bonds across the interface, per PISA.' },
  { key: 'number_salt_bridges', label: 'Salt bridges', unit: '', digits: 0, discrete: true,
    help: 'Number of salt bridges across the interface, per PISA.' },
  { key: 'number_other_bonds', label: 'Other bonds', unit: '', digits: 0, discrete: true,
    help: 'Other close interface contacts not classified as H-bond, salt bridge, disulfide or covalent (per PISA) — the bulk of interface atom contacts.' },
  { key: 'number_disulfide_bonds', label: 'Disulfide bonds', unit: '', digits: 0, discrete: true,
    help: 'Inter-chain disulfide bonds across the interface, per PISA (rare in antibody–antigen interfaces).' },
  { key: 'number_covalent_bonds', label: 'Covalent bonds', unit: '', digits: 0, discrete: true,
    help: 'Covalent bonds linking the two partners across the interface, per PISA (rare).' },
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

  // Discrete: one bar per integer value. The highlighted bar IS the exact value — no marker line.
  if (discrete && (max - min) <= MAX_DISCRETE_SPAN) {
    const bars = new Array(max - min + 1).fill(0)
    for (const v of clean) bars[Math.round(v) - min]++
    const selIdx = selected == null ? -1 : Math.round(selected) - min
    return (
      <svg className="ipd-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <Bars bars={bars} selIdx={selIdx} />
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
      <p className="note">PISA properties of the selected interface (orange marker) against all
        {' '}<b>{chainType}-chain</b> interfaces in the complex (n = {instances.length}), with the selected
        interface highlighted. Small-range bond counts show one bar per value; energies, areas and wide
        ranges are binned.</p>
      <div className="ipd-grid">
        {cards.map(({ p, clean, sel, min, max, pct }) => (
          <div key={p.key} className="ipd-card">
            <div className="ipd-head"><span className="ipd-label">{p.label}</span><Hint text={p.help} /></div>
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
