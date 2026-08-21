import React, { useMemo, useState, useCallback } from 'react'
import Hint from './Hint.jsx'

// PISA per-interface properties to profile. digits = decimal places for display / axis labels.
// `discrete: true` marks a count — a value that can only be a whole number. It decides both how the
// median is taken and how the distribution is drawn, so it is a property of the DATA, not a styling
// choice. The eventual API carries the same distinction as `value_type`.
//
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
    desc: 'Other close contacts (not a hydrogen bond, salt bridge, disulfide or covalent bond) between the {chain} chain and the antigen in the selected interface (PISA) — the bulk of interface atom contacts.' },
  { key: 'number_disulfide_bonds', label: 'Disulfide bonds', unit: '', digits: 0, discrete: true,
    desc: 'Disulfide bonds between the {chain} chain and the antigen in the selected interface (PISA); rare.' },
  { key: 'number_covalent_bonds', label: 'Covalent bonds', unit: '', digits: 0, discrete: true,
    desc: 'Covalent bonds between the {chain} chain and the antigen in the selected interface (PISA); rare.' },
]

// Below this many interfaces a distribution is not drawn: with 4 or fewer the bin rule below gives
// 2 bins, which reads as a comparison rather than a distribution. The values are listed instead.
// Measured over 77 aggregated interfaces in 4 complexes, 47 clear this bar.
const MIN_INSTANCES_FOR_PLOT = 5
// Bin count follows the square-root rule rather than a fixed 12, because real populations run from
// 1 to 227 interfaces (median 13). Twelve bins over 13 values leaves most of them empty and shows
// gaps that are an artefact of the binning, not of the data.
const binCount = (n) => Math.max(1, Math.min(12, Math.ceil(Math.sqrt(n))))
// A count property with a small integer range gets one bar per value (bond counts); anything else —
// continuous energies/areas or a wide integer range — gets a binned histogram.
const MAX_DISCRETE_SPAN = 24
const W = 240, H = 84
// Bar spacing carries the meaning, following the usual convention: a histogram's bars TOUCH because
// its bins are contiguous ranges, while bars for discrete values are SEPARATED because there is
// nothing between them. Without this both chart types look identical and a reader has no way to
// tell "six distinct values" from "three ranges".
const GAP_COUNT = 4, GAP_BINNED = 0

// `populationNoun` is supplied in the plural ("instances", "interfaces"); the tooltip needs the
// singular for a count of one. Both nouns in use are regular, so trimming the 's' is enough.
const singular = (plural) => plural.replace(/s$/, '')

// Is a chart actually drawn? Everything below the threshold, and every all-tied property, shows
// text instead -- and text has no x-scale, so the axis ends underneath would label nothing. The two
// callers must agree, hence one predicate rather than two copies of the condition.
const isPlotted = (values, ext) =>
  values.length >= MIN_INSTANCES_FOR_PLOT && ext.min != null && ext.min !== ext.max

function fmtNum(v, d) {
  if (v == null || Number.isNaN(v)) return '—'
  return d === 0 ? Math.round(v).toLocaleString() : v.toFixed(d)
}

// Reduced rather than Math.min(...clean): the spread passes one argument per interface, and one
// complex in this dataset already has 227 instances with nothing bounding it. A reduce has no
// argument limit.
const extent = (values) => values.reduce(
  (a, v) => ({ min: v < a.min ? v : a.min, max: v > a.max ? v : a.max }),
  { min: Infinity, max: -Infinity })

// Counts take the LOW median so the reported value is one an interface actually has: an ordinary
// median over an even number of counts returns "6.5 hydrogen bonds", which cannot occur. Matches
// scripts/build_api_data.py, so the page and the API agree.
function median(values, discrete) {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  if (s.length % 2) return s[mid]
  return discrete ? s[mid - 1] : (s[mid - 1] + s[mid]) / 2
}

// Where the selected value sits relative to the population: the median itself, beside the value.
//
// Deliberately NOT a percentile and not a percentage deviation. A percentile reports every interface
// as 100th when all values tie, which is 34% of everything displayed on real data. A percentage
// deviation misreports the other two families: a count of 6 against a median of 2 becomes "200%
// above", and an energy of -3.6 against -4.0 becomes "above median" when it is the weaker one.
// Showing the median is unit-free, sign-safe, works for counts and measurements alike, and leaves
// the comparison to the reader, which is the right size of claim at these population sizes.
function describe(sel, values, ext, med, digits) {
  if (sel == null || !values.length) return null
  // Nothing here when every interface ties: the chart area already says "0 in all 19 interfaces",
  // and saying it twice in one card reads as two different facts.
  if (ext.min === ext.max || med == null) return null
  if (sel === med) return 'at the median'
  return `median ${fmtNum(med, digits)}`
}

// Distribution of the population with the selected interface's value marked. Grey bars for the
// population, the selected interface's bar in orange, and a dashed marker line at its exact value.
// The line is not decoration: an outlier selection produces a bar a pixel or two tall that is
// invisible without it.
function Distribution({ values, selected, ext, discrete, digits, unit, label, populationNoun, onTip }) {
  const { min, max } = ext
  if (!values.length || min == null) return <div className="ipd-nodata">not enough data</div>

  // Every interface has the same value (0 disulfide bonds everywhere): a histogram would imply
  // spread that is not there, so say it plainly. Checked before the small-population case below,
  // which would otherwise list the same value repeatedly ("0, 0, 0"). Formatted with the property's
  // own decimals: rounding here reported a tied P-value of 0.5 as "1".
  if (min === max) {
    return <div className="ipd-nodata">{fmtNum(min, digits)} in all {values.length} {populationNoun}</div>
  }
  // Too few to plot: list the actual values. At n=3, "421, 506, 691" says everything a chart would
  // and nothing it would not.
  if (values.length < MIN_INSTANCES_FOR_PLOT) {
    return (
      <div className="ipd-nodata">
        {values.length === 1 ? `one ${singular(populationNoun)} only`
          : [...values].sort((a, b) => a - b).map((v) => fmtNum(v, digits)).join(', ')}
      </div>
    )
  }

  // A count with a narrow range gets one bar per integer value; anything else is binned. Bar
  // spacing follows from that choice, so the two conventions cannot drift apart.
  const isCount = discrete && (max - min) <= MAX_DISCRETE_SPAN
  const GAP = isCount ? GAP_COUNT : GAP_BINNED
  let bars, selIdx, selX

  if (isCount) {
    bars = new Array(max - min + 1).fill(0)
    for (const v of values) bars[Math.round(v) - min]++
    selIdx = selected == null ? -1 : Math.round(selected) - min
    const bw = (W - GAP * (bars.length - 1)) / bars.length
    selX = selIdx < 0 ? null : selIdx * (bw + GAP) + bw / 2        // centre of the selected bar
  } else {
    const nBins = binCount(values.length)
    const binSpan = (max - min) || 1
    const binOf = (v) => Math.min(nBins - 1, Math.max(0, Math.floor(((v - min) / binSpan) * nBins)))
    bars = new Array(nBins).fill(0)
    for (const v of values) bars[binOf(v)]++
    selIdx = selected == null ? -1 : binOf(selected)
    selX = selected == null ? null : ((selected - min) / binSpan) * W  // exact value, not bin centre
  }

  const maxCount = bars.reduce((a, c) => (c > a ? c : a), 1)
  const bw = (W - GAP * (bars.length - 1)) / bars.length
  const span = (max - min) || 1          // value range, not to be confused with bw (bar width)
  // Nudge the marker inside the viewBox at the extremes. A selection equal to the min or the max
  // puts it exactly on the edge, where half the stroke falls outside and is clipped, and the
  // extremes are precisely the selections worth finding.
  const markerX = selX == null ? null : Math.max(1.5, Math.min(W - 1.5, selX))

  const tipFor = (count, i) => {
    const where = isCount
      ? fmtNum(min + i, digits)
      : `${fmtNum(min + (i * span) / bars.length, digits)} to `
        + `${fmtNum(min + ((i + 1) * span) / bars.length, digits)}`
    const noun = count === 1 ? singular(populationNoun) : populationNoun
    return `${count} ${noun} · ${where}${unit ? ' ' + unit : ''}`
  }

  return (
    <svg className="ipd-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
      aria-label={`${label}: ${values.length} ${populationNoun} between ${fmtNum(min, digits)} and `
        + `${fmtNum(max, digits)}${selected == null ? '' : `, selected ${fmtNum(selected, digits)}`}`}>
      {bars.map((count, i) => {
        const h = (count / maxCount) * (H - 2)
        return <rect key={`b${i}`} x={i * (bw + GAP)} y={H - h} width={bw} height={h}
          className={'ipd-bar' + (i === selIdx ? ' sel' : '')} />
      })}
      {markerX != null && <line x1={markerX} y1="0" x2={markerX} y2={H} className="ipd-marker"
        vectorEffect="non-scaling-stroke" />}
      {/* A transparent full-height rect per bar, so a bar is hoverable however short it is.
          Empty bars are hoverable only when binned. There, "0 interfaces between 530 and 600" is
          worth confirming and the hover is the only place the bin RANGE appears at all. On a
          discrete chart the x position is the value itself and the gaps are literally nothing, so
          "0 interfaces, 3" states what the empty space already says.
          Inset by half a stroke width so the hover outline is not clipped at the chart edges. */}
      {bars.map((count, i) => (isCount && count === 0) ? null : (
        <rect key={`h${i}`} className="ipd-hit" vectorEffect="non-scaling-stroke"
          x={i * (bw + GAP) + 0.5} y={0.5} width={Math.max(0, bw - 1)} height={H - 1}
          onMouseEnter={(e) => onTip(tipFor(count, i), e)}
          onMouseMove={(e) => onTip(tipFor(count, i), e)}
          onMouseLeave={() => onTip(null)} />
      ))}
    </svg>
  )
}

// Past the halfway mark the tooltip hangs to the LEFT of the pointer, anchored by `right`. Using
// `right` rather than `left - width` means the width never has to be measured, so a long bin label
// cannot overflow the viewport.
function tipStyle({ x, y }) {
  const pad = 12
  const flip = x > window.innerWidth / 2
  return flip
    ? { right: Math.max(4, window.innerWidth - x + pad), top: y + pad }
    : { left: Math.max(4, x + pad), top: y + pad }
}

function PropertyCard({ p, values, sel, ext, med, hint, populationNoun, onTip }) {
  const compare = describe(sel, values, ext, med, p.digits)   // see describe()
  return (
    <div className="ipd-card">
      <div className="ipd-head">
        <span className="ipd-label">{p.label}</span>
        <Hint text={hint} />
      </div>
      <div className="ipd-val">
        <b>{fmtNum(sel, p.digits)}</b>{p.unit ? ' ' + p.unit : ''}
        {compare && <span className="ipd-compare">{compare}</span>}
      </div>
      <Distribution values={values} selected={sel} ext={ext} discrete={p.discrete}
        digits={p.digits} unit={p.unit} label={p.label} populationNoun={populationNoun}
        onTip={onTip} />
      {isPlotted(values, ext) && (
        <div className="ipd-axis">
          <span>{fmtNum(ext.min, p.digits)}</span>
          <span>{fmtNum(ext.max, p.digits)}</span>
        </div>
      )}
    </div>
  )
}

// Distribution of each interface property across a population of interfaces, with the selected
// instance marked — the PISA "where does this interface sit in the population" view. Defaults are
// antibody–antigen (spike); `props`, `note` and `populationLabel` let other complexes reuse it.
export default function InterfacePropertyDistributions({ instances, selected, chainType,
  props = PROPS, title = 'Interface property distributions', note, populationLabel,
  populationNoun = 'interfaces' }) {
  const popLabel = populationLabel || `${chainType}-chain interfaces in the complex`
  // One tooltip for the whole grid rather than one per chart: there are ten charts, each with up to
  // twelve bars, and only ever one is hovered.
  const [tip, setTip] = useState(null)
  const onTip = useCallback((text, e) => {
    setTip(text == null ? null : { text, x: e.clientX, y: e.clientY })
  }, [])

  const cards = useMemo(() => props.map((p) => {
    const values = instances.map((r) => r[p.key]).filter((v) => v != null && !Number.isNaN(v))
    return {
      p,
      values,
      sel: selected ? selected[p.key] : null,
      ext: values.length ? extent(values) : { min: null, max: null },
      med: median(values, p.discrete),
    }
  }), [instances, selected, props])

  // Grouped by what the property IS, not by how it happens to be drawn: a count with a wide range
  // falls back to binning, so the heading has to allow for that rather than promise one bar per
  // value. Every property in `props` lands in exactly one group.
  const groups = [
    { key: 'continuous', heading: 'Continuous properties',
      sub: 'areas, energies and the P-value, binned into ranges',
      cards: cards.filter((c) => !c.p.discrete) },
    { key: 'count', heading: 'Discrete counts',
      sub: 'one bar per observed value, binned where the range is wide',
      cards: cards.filter((c) => c.p.discrete) },
  ].filter((g) => g.cards.length)

  const hintSuffix = `The chart shows how this compares across all ${popLabel} `
    + `(n = ${instances.length}); the selected interface is highlighted.`

  return (
    <div className="card ex-cell">
      <h2>{title}</h2>
      {note || (
        <p className="note">PISA properties of the selected interface (highlighted in orange) against all
          {' '}<b>{chainType}-chain</b> interfaces in the complex (n = {instances.length}), with the selected
          interface highlighted. Continuous properties such as areas and energies are shown as binned
          distributions; discrete contact counts are shown as individual values.</p>
      )}
      {groups.map((g) => (
        <React.Fragment key={g.key}>
          <h3 className="ipd-group">{g.heading} <span>{g.sub}</span></h3>
          <div className="ipd-grid">
            {g.cards.map((c) => (
              <PropertyCard key={c.p.key} {...c}
                hint={`${c.p.desc.replaceAll('{chain}', chainType || '')} ${hintSuffix}`}
                populationNoun={populationNoun} onTip={onTip} />
            ))}
          </div>
        </React.Fragment>
      ))}
      {/* Mouse-only, and hidden from assistive tech on purpose: each chart carries an aria-label
          with its n and range, so the numbers are announced once per chart rather than once per bar. */}
      {tip && (
        <div className="ipd-tip" aria-hidden="true" style={tipStyle(tip)}>
          {tip.text}
        </div>
      )}
    </div>
  )
}
