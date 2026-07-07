import React, { useMemo, useState } from 'react'
import { ScatterChart, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

// Distinct, colourblind-friendlyish palette for communities (index = community id).
const PALETTE = ['#4b7fcc', '#e19039', '#4aa564', '#c65a5a', '#8a6fc0', '#3aa8a8',
  '#c96a9e', '#9aa63a', '#5a6b8c', '#b5762c', '#6a9bd1', '#d98cae']
const GREY = '#c2c8d0'

function PointTip({ active, payload }) {
  if (!active || !payload || !payload.length) return null
  const d = payload[0].payload
  return (
    <div className="hint-pop" style={{ position: 'static', maxWidth: 260 }}>
      <b>{d.antibody}</b><br />
      {d.communityLabel} · {d.dominant_domain}<br />
      epitope: {(d.top_positions || []).join(', ')}
    </div>
  )
}

export default function Communities({ data }) {
  const { meta, communities = [], archetypes = [], antibodies = [] } = data || {}
  const [sel, setSel] = useState(null)  // selected community id to highlight

  const commById = useMemo(() => Object.fromEntries(communities.map((c) => [c.id, c])), [communities])
  const big = communities.filter((c) => c.size >= 4)
  const colorOf = (id) => (id != null && commById[id] && commById[id].size >= 4 ? PALETTE[id % PALETTE.length] : GREY)

  // group points into per-community series for the scatter
  const series = useMemo(() => {
    const groups = new Map()
    for (const a of antibodies) {
      const cid = commById[a.community] && commById[a.community].size >= 4 ? a.community : -1
      if (!groups.has(cid)) groups.set(cid, [])
      groups.get(cid).push({ ...a, communityLabel: cid === -1 ? 'unclustered' : commById[cid].label })
    }
    return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([cid, points]) => ({ cid, points }))
  }, [antibodies, commById])

  if (!antibodies.length) {
    return <div className="card"><h2>Epitope communities</h2>
      <p className="note">No clustering artifact found. Run <code>scripts/build_epitope_communities.py</code>.</p></div>
  }

  return (
    <>
      <div className="card">
        <h2>Epitope communities</h2>
        <p className="note">Each point is a distinct antibody (SAbDab2), positioned by <b>epitope-footprint
          similarity</b> ({meta?.embedding?.toUpperCase()} of spatially-smoothed, paratope-only contact
          vectors) and coloured by <b>Louvain community</b>. Communities recover the known SARS-CoV-2
          epitope classes from contacts alone. Click a community to highlight it. {meta?.n_antibodies} antibodies
          over {meta?.n_positions} epitope positions.</p>
        <ResponsiveContainer width="100%" height={460}>
          <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
            <XAxis type="number" dataKey="x" hide domain={['dataMin', 'dataMax']} />
            <YAxis type="number" dataKey="y" hide domain={['dataMin', 'dataMax']} />
            <Tooltip content={<PointTip />} cursor={false} />
            {series.map(({ cid, points }) => (
              <Scatter key={cid} data={points} fill={colorOf(cid)} isAnimationActive={false}
                fillOpacity={sel == null || sel === cid ? 0.85 : 0.12} />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      <div className="card">
        <h2>Communities</h2>
        <p className="note">Ranked by size. <b>Domain</b> is the structural domain of the community's
          epitope residues, fetched live from <b>PDBe</b> (Pfam/CATH via SIFTS) on a representative
          structure — no hardcoded ontology, so it generalises to any antigen. Escape column lists
          consensus positions that are documented antibody-escape sites.</p>
        <div className="table-scroll">
          <table>
            <thead><tr><th></th><th>Community</th><th className="num">Antibodies</th><th>PDBe domain</th>
              <th>Top epitope positions</th><th>Escape residues</th></tr></thead>
            <tbody>
              {big.map((c) => (
                <tr key={c.id} className={'selrow' + (sel === c.id ? ' sel' : '')}
                    onClick={() => setSel(sel === c.id ? null : c.id)} style={{ cursor: 'pointer' }}>
                  <td><span className="dot" style={{ background: colorOf(c.id) }} /></td>
                  <td><b>{c.label}</b></td>
                  <td className="num">{c.size}</td>
                  <td>{c.pdbe_domain || c.dominant_domain || '—'}</td>
                  <td>{(c.top_positions || []).join(', ')}</td>
                  <td>{(c.escape_positions || []).length ? c.escape_positions.join(', ') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>NMF archetypes (soft sub-structure)</h2>
        <p className="note">Non-negative matrix factorisation decomposes each antibody into a mixture of
          {' '}{meta?.nmf_k} epitope <b>archetypes</b> — finer than the hard communities (e.g. it splits the
          RBM into ACE2-site vs E484 vs K417 anchors). Each archetype's strongest positions:</p>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Archetype</th><th className="num">Antibodies (dominant)</th><th>~Class</th>
              <th>Top positions</th></tr></thead>
            <tbody>
              {archetypes.map((a) => (
                <tr key={a.id}><td>A{a.id}</td><td className="num">{a.n_dominant}</td>
                  <td>{a.label}</td><td>{(a.top_positions || []).join(', ')}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
