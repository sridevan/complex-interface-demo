import React from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Legend, CartesianGrid,
} from 'recharts'
import { REGION_COLORS } from '../data.js'

export default function Charts({ region, epitope }) {
  const regionData = [...region]
    .map((r) => ({ name: `${r.antibody_chain_type} · ${r.antibody_imgt_region}`,
                   region: r.antibody_imgt_region, contacts: r.total_contacts,
                   pct: r.percentage_of_total_contacts }))
    .sort((a, b) => b.contacts - a.contacts)

  const heavy = epitope.reduce((s, r) => s + (r.heavy_chain_contacts || 0), 0)
  const light = epitope.reduce((s, r) => s + (r.light_chain_contacts || 0), 0)
  const hlData = [{ name: 'Heavy', v: heavy, fill: '#e19039' }, { name: 'Light', v: light, fill: '#4b7fcc' }]

  const topSpike = [...epitope]
    .sort((a, b) => b.total_contacts - a.total_contacts)
    .slice(0, 20)
    .map((r) => ({ name: `${r.antigen_residue_name}${r.antigen_uniprot_position}`,
                   heavy: r.heavy_chain_contacts, light: r.light_chain_contacts }))

  return (
    <>
      <div className="card">
        <h2>Contacts by IMGT region</h2>
        <p className="note">Which antibody regions contribute most to the interface (contact pairs).</p>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={regionData} margin={{ top: 8, right: 16, bottom: 40, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" angle={-25} textAnchor="end" interval={0} height={70} fontSize={12} />
            <YAxis fontSize={12} />
            <Tooltip formatter={(v, n, p) => [`${v} contacts (${p.payload.pct}%)`, 'contacts']} />
            <Bar dataKey="contacts" isAnimationActive={false}>
              {regionData.map((d, i) => <Cell key={i} fill={REGION_COLORS[d.region] || '#8aa0b6'} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="card">
        <h2>Heavy vs light contribution</h2>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={hlData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" fontSize={12} />
            <YAxis fontSize={12} />
            <Tooltip />
            <Bar dataKey="v" name="contacts" isAnimationActive={false}>
              {hlData.map((d, i) => <Cell key={i} fill={d.fill} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="card">
        <h2>Top contacted spike residues</h2>
        <p className="note">Antigen UniProt position (P0DTC2), stacked by antibody chain type.</p>
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={topSpike} margin={{ top: 8, right: 16, bottom: 50, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" angle={-40} textAnchor="end" interval={0} height={70} fontSize={11} />
            <YAxis fontSize={12} />
            <Tooltip />
            <Legend />
            <Bar dataKey="heavy" stackId="a" fill="#e19039" name="heavy" isAnimationActive={false} />
            <Bar dataKey="light" stackId="a" fill="#4b7fcc" name="light" isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  )
}
