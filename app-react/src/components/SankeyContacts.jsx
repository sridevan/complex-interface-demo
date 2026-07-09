import React, { useMemo } from 'react'
import { Sankey, Tooltip, ResponsiveContainer, Layer, Rectangle } from 'recharts'

// Antibody (paratope) nodes are coloured by IMGT region CLASS. A single-instance Sankey is one
// chain type, so we don't need the heavy/light hue split here — instead we give CDR1/2/3 and
// Framework distinct, distinguishable colours (the amber-only heavy palette was hard to tell apart).
// Colour-blind-safe (Paul Tol). Distinct from the antigen residue-class palette below:
// antigen = red / blue / green / sand; antibody = orange / cyan / magenta / grey.
const REGION_CLASS_COLOR = { CDR1: '#EE7733', CDR2: '#66CCEE', CDR3: '#AA3377', Framework: '#999999' }
function abRegionColor(region) {
  if (!region) return '#c9ced6'
  if (region.startsWith('Framework')) return REGION_CLASS_COLOR.Framework
  if (region.endsWith('1')) return REGION_CLASS_COLOR.CDR1
  if (region.endsWith('2')) return REGION_CLASS_COLOR.CDR2
  if (region.endsWith('3')) return REGION_CLASS_COLOR.CDR3
  return '#c9ced6'
}

// Amino-acid class colouring for antigen nodes.
const AA_CLASS = {
  ASP: 'acidic', GLU: 'acidic',
  ARG: 'basic', LYS: 'basic', HIS: 'basic',
  SER: 'polar', THR: 'polar', ASN: 'polar', GLN: 'polar', TYR: 'polar', CYS: 'polar',
  ALA: 'hydrophobic', VAL: 'hydrophobic', LEU: 'hydrophobic', ILE: 'hydrophobic',
  MET: 'hydrophobic', PHE: 'hydrophobic', TRP: 'hydrophobic', PRO: 'hydrophobic', GLY: 'hydrophobic',
}
// Colour-blind-safe (Paul Tol); conventional residue-class hues, all distinct from the antibody
// region palette above (hydrophobic uses sand rather than grey to avoid clashing with Framework).
const AA_COLOR = { acidic: '#CC3311', basic: '#4477AA', polar: '#228833', hydrophobic: '#DDCC77', unknown: '#c9ced6' }

// Colour a residue node by amino-acid class (used for the antigen side, and for the right side too
// when the partner isn't an IMGT-numbered antibody — e.g. a second protein chain in a homo/hetero-mer).
function aaColor(resn) { return AA_COLOR[AA_CLASS[resn] || 'unknown'] }

const AA3TO1 = {
  ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C', GLU: 'E', GLN: 'Q', GLY: 'G', HIS: 'H',
  ILE: 'I', LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F', PRO: 'P', SER: 'S', THR: 'T', TRP: 'W',
  TYR: 'Y', VAL: 'V', MSE: 'M', SEC: 'U', PYL: 'O',
}

function buildGraph(rows, rightColorBy = 'region', singleLetter = false) {
  const rn = (resn) => singleLetter ? (AA3TO1[resn] || 'X') : resn
  const abIndex = new Map(), agIndex = new Map()
  const nodes = []
  const add = (key, make) => {
    const idx = key.startsWith('ab:') ? abIndex : agIndex
    if (!idx.has(key)) { idx.set(key, nodes.length); nodes.push(make()) }
    return (key.startsWith('ab:') ? abIndex : agIndex).get(key)
  }
  const byAA = rightColorBy === 'aaclass'
  const linkMap = new Map()
  for (const r of rows) {
    const abKey = `ab:${r.antibody_chain_id}:${r.antibody_residue_author_number}:${r.antibody_residue_author_insertion_code || ''}`
    const agKey = `ag:${r.antigen_uniprot_position}:${r.antigen_residue_name}`
    const abI = add(abKey, () => ({
      kind: 'ab',
      name: r.antibody_imgt_position != null
        ? `${rn(r.antibody_residue_name)}${r.antibody_imgt_position}${r.antibody_imgt_insertion_code || ''}`
        : `${rn(r.antibody_residue_name)}${r.antibody_residue_author_number}`,
      color: byAA ? aaColor(r.antibody_residue_name) : abRegionColor(r.antibody_imgt_region),
      sub: byAA ? (AA_CLASS[r.antibody_residue_name] || 'unknown') : (r.antibody_imgt_region || 'unmapped'),
      chain: r.antibody_chain_id, resi: r.antibody_residue_author_number,  // for 3D highlight
    }))
    const agI = add(agKey, () => {
      const cls = AA_CLASS[r.antigen_residue_name] || 'unknown'
      return { kind: 'ag', name: `${rn(r.antigen_residue_name)}${r.antigen_uniprot_position}`,
               color: AA_COLOR[cls], sub: cls,
               chain: r.antigen_chain_id, resi: r.antigen_residue_author_number }  // for 3D highlight
    })
    const lk = `${agI}->${abI}`   // antigen (left / source) -> antibody (right / target)
    if (!linkMap.has(lk)) linkMap.set(lk, { value: 0, types: {}, minDist: Infinity, pairs: 0 })
    const e = linkMap.get(lk)
    e.value += r.bond_count || 1
    e.pairs += 1
    for (const [t, c] of Object.entries(r.interaction_types || {})) e.types[t] = (e.types[t] || 0) + c
    if (r.min_distance != null) e.minDist = Math.min(e.minDist, r.min_distance)
  }
  const links = []
  const linkInfo = new Map()  // "agName|abName" -> breakdown (Recharts drops custom link fields)
  for (const [k, info] of linkMap.entries()) {
    const [source, target] = k.split('->').map(Number)  // source = antigen, target = antibody
    links.push({ source, target, value: info.value })
    linkInfo.set(`${nodes[source].name}|${nodes[target].name}`, {
      value: info.value, types: info.types,
      minDist: isFinite(info.minDist) ? info.minDist : null,
      agClass: nodes[source].sub, abRegion: nodes[target].sub,
    })
  }
  return { nodes, links, linkInfo }
}

const TYPE_LABEL = {
  hydrogen_bond: 'H-bond', salt_bridge: 'salt bridge', disulfide_bond: 'disulfide',
  covalent_bond: 'covalent bond', other_bond: 'other contact',
}

// Custom tooltip: for a ribbon, break down the residue–residue contact; for a node, summarise it.
// linkInfo (breakdown by residue-name key) is passed as a prop — Recharts preserves our own props
// while it strips custom fields off the link datum, so we look the breakdown up by name.
function SankeyTooltip({ active, payload, linkInfo }) {
  if (!active || !payload || !payload.length) return null
  const item = payload[0]
  const d = item.payload
  const nameStr = item.name || (d && d.name) || ''
  // Recharts labels a link "sourceName - targetName" (residue names never contain ' - ').
  const isLink = nameStr.includes(' - ') || (d && d.source !== undefined && d.target !== undefined)
  if (isLink) {
    let agName, abName
    if (d && typeof d.source === 'object') { agName = d.source.name; abName = d.target.name }
    else { [agName, abName] = nameStr.split(' - ') }
    const info = (linkInfo && linkInfo.get(`${agName}|${abName}`)) || {}
    const value = info.value ?? item.value
    return (
      <div className="sankey-tip">
        <div className="st-head">{agName} <span className="st-sub">({info.agClass})</span>
          {'  —  '}{abName} <span className="st-sub">({info.abRegion})</span></div>
        <div className="st-row"><b>{value}</b> bond{value === 1 ? '' : 's'}</div>
        <div className="st-types">{Object.entries(info.types || {}).sort((a, b) => b[1] - a[1])
          .map(([t, c]) => `${TYPE_LABEL[t] || t} ×${c}`).join(', ') || '—'}</div>
      </div>
    )
  }
  // Node hover
  return <div className="sankey-tip"><b>{nameStr}</b>{d?.sub ? ` (${d.sub})` : ''} · {item.value} bonds</div>
}

function SankeyNode({ x, y, width, height, index, payload, onNodeClick }) {
  const isLeft = payload.kind === 'ag'   // antigen nodes are on the left
  const h = Math.max(height, 3)  // floor so 1-2 bond residues are still a visible bar
  const clickable = onNodeClick && payload.chain != null && payload.resi != null
  return (
    <Layer key={`node-${index}`} style={{ cursor: clickable ? 'pointer' : 'default' }}
           onClick={clickable ? () => onNodeClick({ chain: payload.chain, resi: payload.resi, name: payload.name }) : undefined}>
      <Rectangle x={x} y={y} width={width} height={h} fill={payload.color} fillOpacity={0.95} />
      <text
        x={isLeft ? x - 5 : x + width + 5}
        y={y + height / 2}
        textAnchor={isLeft ? 'end' : 'start'}
        dominantBaseline="middle"
        fontSize={10}
        fill="#333"
      >{payload.name}</text>
    </Layer>
  )
}

const LEGEND_AA = [['acidic', AA_COLOR.acidic], ['basic', AA_COLOR.basic],
                   ['polar', AA_COLOR.polar], ['hydrophobic', AA_COLOR.hydrophobic]]
const LEGEND_REGION = [['CDR1', REGION_CLASS_COLOR.CDR1], ['CDR2', REGION_CLASS_COLOR.CDR2],
                       ['CDR3', REGION_CLASS_COLOR.CDR3], ['Framework', REGION_CLASS_COLOR.Framework]]

export default function SankeyContacts({ rows, onNodeClick, leftLabel = 'antigen', rightLabel = 'antibody',
                                         rightColorBy = 'region', singleLetter = false }) {
  const data = useMemo(() => buildGraph(rows || [], rightColorBy, singleLetter), [rows, rightColorBy, singleLetter])
  // Give every node room: ~24px of vertical space per node on the busier side so thin (low-bond)
  // residues separate enough to read their labels.
  const height = Math.max(360, Math.max(
    data.nodes.filter((n) => n.kind === 'ab').length,
    data.nodes.filter((n) => n.kind === 'ag').length) * 24)

  if (!rows || !rows.length) return <p className="note">No contacts for the selected instance.</p>
  // Chain id(s) on each side of the selected instance, shown as a header above the columns.
  const leftChains = [...new Set(rows.map((r) => r.antigen_chain_id).filter((x) => x != null))]
  const rightChains = [...new Set(rows.map((r) => r.antibody_chain_id).filter((x) => x != null))]
  const chainLabel = (cs) => cs.length ? `Chain ${cs.join(', ')}` : ''
  return (
    <div className="sankey-contacts">
      <div className="sankey-head">
        <span className="l">{chainLabel(leftChains)}</span>
        <span className="r">{chainLabel(rightChains)}</span>
      </div>
      <div className="sankey-chart-scroll">
        <ResponsiveContainer width="100%" height={height}>
          <Sankey
            data={data}
            node={<SankeyNode onNodeClick={onNodeClick} />}
            nodePadding={14}
            nodeWidth={12}
            link={{ stroke: '#b9c0c9', strokeOpacity: 0.35 }}
            margin={{ top: 8, bottom: 8, left: 70, right: 90 }}
          >
            <Tooltip content={<SankeyTooltip linkInfo={data.linkInfo} />} />
          </Sankey>
        </ResponsiveContainer>
      </div>
      <div className="legend sankey-legend">
        {rightColorBy === 'aaclass' ? (
          // Both sides share the residue-class palette — a single legend covers them.
          <div>
            Amino acids are colored by type:
            {LEGEND_AA.map(([k, c]) => (
              <span key={k}><span className="dot" style={{ background: c }} />{k}</span>
            ))}
          </div>
        ) : (
          <>
            <div>
              <b style={{ color: '#333' }}>{leftLabel}</b> (left) by residue class:
              {LEGEND_AA.map(([k, c]) => (
                <span key={k}><span className="dot" style={{ background: c }} />{k}</span>
              ))}
            </div>
            <div>
              <b style={{ color: '#333' }}>{rightLabel}</b> (right) by IMGT region:
              {LEGEND_REGION.map(([k, c]) => (
                <span key={k}><span className="dot" style={{ background: c }} />{k}</span>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
