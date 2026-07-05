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
  { key: 'number_interface_residues', label: 'Interface residues', unit: '', digits: 0,
    help: 'Number of residues (both partners) buried at the interface, per PISA.' },
  { key: 'number_hydrogen_bonds', label: 'Hydrogen bonds', unit: '', digits: 0,
    help: 'Number of hydrogen bonds across the interface, per PISA.' },
  { key: 'number_salt_bridges', label: 'Salt bridges', unit: '', digits: 0,
    help: 'Number of salt bridges across the interface, per PISA.' },
]

const N_BINS = 12

function fmtNum(v, d) {
  if (v == null || Number.isNaN(v)) return '—'
  return d === 0 ? Math.round(v).toLocaleString() : v.toFixed(d)
}

// Histogram of the population with the selected interface's value marked (highlighted bin + line).
function Histogram({ clean, min, max, selected }) {
  if (clean.length < 2 || min == null) return <div className="ipd-nodata">not enough data</div>
  const span = (max - min) || 1
  const binOf = (v) => Math.min(N_BINS - 1, Math.max(0, Math.floor(((v - min) / span) * N_BINS)))
  const bins = new Array(N_BINS).fill(0)
  for (const v of clean) bins[binOf(v)]++
  const maxCount = Math.max(...bins, 1)
  const selBin = selected == null ? -1 : binOf(selected)
  const W = 240, H = 56, gap = 2
  const bw = (W - gap * (N_BINS - 1)) / N_BINS
  const selX = selected == null ? null : ((selected - min) / span) * W
  return (
    <svg className="ipd-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {bins.map((c, i) => {
        const h = (c / maxCount) * (H - 2)
        return <rect key={i} x={i * (bw + gap)} y={H - h} width={bw} height={h}
          className={'ipd-bar' + (i === selBin ? ' sel' : '')} />
      })}
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
        {' '}<b>{chainType}-chain</b> interfaces in the complex (n = {instances.length}). Each bar counts
        interfaces in that value range.</p>
      <div className="ipd-grid">
        {cards.map(({ p, clean, sel, min, max, pct }) => (
          <div key={p.key} className="ipd-card">
            <div className="ipd-head"><span className="ipd-label">{p.label}</span><Hint text={p.help} /></div>
            <div className="ipd-val">
              <b>{fmtNum(sel, p.digits)}</b>{p.unit ? ' ' + p.unit : ''}
              {pct != null && <span className="ipd-pct">{pct}ᵗʰ pct</span>}
            </div>
            <Histogram clean={clean} min={min} max={max} selected={sel} />
            <div className="ipd-axis"><span>{fmtNum(min, p.digits)}</span><span>{fmtNum(max, p.digits)}</span></div>
          </div>
        ))}
      </div>
    </div>
  )
}
