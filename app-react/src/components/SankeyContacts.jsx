import React, { useMemo } from 'react'
import { Sankey, Tooltip, ResponsiveContainer, Layer, Rectangle } from 'recharts'
import { REGION_COLORS } from '../data.js'

// Amino-acid class colouring for antigen nodes.
const AA_CLASS = {
  ASP: 'acidic', GLU: 'acidic',
  ARG: 'basic', LYS: 'basic', HIS: 'basic',
  SER: 'polar', THR: 'polar', ASN: 'polar', GLN: 'polar', TYR: 'polar', CYS: 'polar',
  ALA: 'hydrophobic', VAL: 'hydrophobic', LEU: 'hydrophobic', ILE: 'hydrophobic',
  MET: 'hydrophobic', PHE: 'hydrophobic', TRP: 'hydrophobic', PRO: 'hydrophobic', GLY: 'hydrophobic',
}
const AA_COLOR = { acidic: '#d9544d', basic: '#4b7fcc', polar: '#46a758', hydrophobic: '#9aa0a6', unknown: '#c9ced6' }

function buildGraph(rows) {
  const abIndex = new Map(), agIndex = new Map()
  const nodes = []
  const add = (key, make) => {
    const idx = key.startsWith('ab:') ? abIndex : agIndex
    if (!idx.has(key)) { idx.set(key, nodes.length); nodes.push(make()) }
    return (key.startsWith('ab:') ? abIndex : agIndex).get(key)
  }
  const linkMap = new Map()
  for (const r of rows) {
    const abKey = `ab:${r.antibody_chain_id}:${r.antibody_residue_author_number}:${r.antibody_residue_author_insertion_code || ''}`
    const agKey = `ag:${r.antigen_uniprot_position}:${r.antigen_residue_name}`
    const abI = add(abKey, () => ({
      kind: 'ab',
      name: r.antibody_imgt_position != null
        ? `${r.antibody_residue_name}${r.antibody_imgt_position}${r.antibody_imgt_insertion_code || ''}`
        : `${r.antibody_residue_name}${r.antibody_residue_author_number}`,
      color: REGION_COLORS[r.antibody_imgt_region] || '#c9ced6',
      sub: r.antibody_imgt_region || 'unmapped',
    }))
    const agI = add(agKey, () => {
      const cls = AA_CLASS[r.antigen_residue_name] || 'unknown'
      return { kind: 'ag', name: `${r.antigen_residue_name}${r.antigen_uniprot_position}`,
               color: AA_COLOR[cls], sub: cls }
    })
    const lk = `${abI}->${agI}`
    if (!linkMap.has(lk)) linkMap.set(lk, { value: 0, types: {}, minDist: Infinity, pairs: 0 })
    const e = linkMap.get(lk)
    e.value += r.bond_count || 1
    e.pairs += 1
    for (const [t, c] of Object.entries(r.interaction_types || {})) e.types[t] = (e.types[t] || 0) + c
    if (r.min_distance != null) e.minDist = Math.min(e.minDist, r.min_distance)
  }
  const links = []
  const linkInfo = new Map()  // "abName|agName" -> breakdown (Recharts drops custom link fields)
  for (const [k, info] of linkMap.entries()) {
    const [source, target] = k.split('->').map(Number)
    links.push({ source, target, value: info.value })
    linkInfo.set(`${nodes[source].name}|${nodes[target].name}`, {
      value: info.value, types: info.types,
      minDist: isFinite(info.minDist) ? info.minDist : null,
      abRegion: nodes[source].sub, agClass: nodes[target].sub,
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
    let abName, agName
    if (d && typeof d.source === 'object') { abName = d.source.name; agName = d.target.name }
    else { [abName, agName] = nameStr.split(' - ') }
    const info = (linkInfo && linkInfo.get(`${abName}|${agName}`)) || {}
    const value = info.value ?? item.value
    return (
      <div className="sankey-tip">
        <div className="st-head">{abName} <span className="st-sub">({info.abRegion})</span>
          {'  —  '}{agName} <span className="st-sub">({info.agClass})</span></div>
        <div className="st-row"><b>{value}</b> contact{value === 1 ? '' : 's'}
          {info.minDist != null ? ` · closest ${info.minDist.toFixed(2)} Å` : ''}</div>
        <div className="st-types">{Object.entries(info.types || {}).sort((a, b) => b[1] - a[1])
          .map(([t, c]) => `${TYPE_LABEL[t] || t} ×${c}`).join(', ') || '—'}</div>
      </div>
    )
  }
  // Node hover
  return <div className="sankey-tip"><b>{nameStr}</b>{d?.sub ? ` (${d.sub})` : ''} · {item.value} bonds</div>
}

function SankeyNode({ x, y, width, height, index, payload }) {
  const isAb = payload.kind === 'ab'
  const h = Math.max(height, 3)  // floor so 1-2 bond residues are still a visible bar
  return (
    <Layer key={`node-${index}`}>
      <Rectangle x={x} y={y} width={width} height={h} fill={payload.color} fillOpacity={0.95} />
      <text
        x={isAb ? x - 5 : x + width + 5}
        y={y + height / 2}
        textAnchor={isAb ? 'end' : 'start'}
        dominantBaseline="middle"
        fontSize={10}
        fill="#333"
      >{payload.name}</text>
    </Layer>
  )
}

const LEGEND_AA = [['acidic', AA_COLOR.acidic], ['basic', AA_COLOR.basic],
                   ['polar', AA_COLOR.polar], ['hydrophobic', AA_COLOR.hydrophobic]]

export default function SankeyContacts({ rows, title }) {
  const data = useMemo(() => buildGraph(rows || []), [rows])
  // Give every node room: ~24px of vertical space per node on the busier side so thin (low-bond)
  // residues separate enough to read their labels.
  const height = Math.max(360, Math.max(
    data.nodes.filter((n) => n.kind === 'ab').length,
    data.nodes.filter((n) => n.kind === 'ag').length) * 24)

  if (!rows || !rows.length) return <p className="note">No contacts for the selected instance.</p>
  return (
    <div>
      <div className="legend" style={{ marginTop: 0 }}>
        <b style={{ color: '#333' }}>antibody</b> by IMGT region ·{' '}
        <b style={{ color: '#333' }}>antigen</b> by residue class:
        {LEGEND_AA.map(([k, c]) => (
          <span key={k}><span className="dot" style={{ background: c }} />{k}</span>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <Sankey
          data={data}
          node={<SankeyNode />}
          nodePadding={14}
          nodeWidth={12}
          link={{ stroke: '#b9c0c9', strokeOpacity: 0.35 }}
          margin={{ top: 8, bottom: 8, left: 70, right: 90 }}
        >
          <Tooltip content={<SankeyTooltip linkInfo={data.linkInfo} />} />
        </Sankey>
      </ResponsiveContainer>
    </div>
  )
}
