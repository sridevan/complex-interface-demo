import React from 'react'
import './styles.css'

const COMPLEXES = [
  {
    hash: '#spike', title: 'SARS-CoV-2 spike — antibody–antigen interfaces',
    sub: 'PDB-CPX-140202 · Homo sapiens antibodies × spike glycoprotein',
    body: 'Aggregated antibody–antigen interfaces: epitope communities, binding modes, per-antibody '
      + 'IMGT paratope, and conformational-state analysis across the spike antibody structurome.',
    accent: '#4b7fcc',
  },
  {
    hash: '#hemoglobin', title: 'Horse hemoglobin — interface conservation',
    sub: 'PDB-CPX-131443 · Equus caballus · α₂β₂ heterotetramer',
    body: 'Equivalent interfaces grouped across deposited assemblies — selector, 3D viewer, instance table, '
      + 'residue–residue contacts, contact map, and PISA property distributions.',
    accent: '#c65a5a',
  },
]

export default function Landing() {
  return (
    <div className="wrap">
      <h1>PDBe-KB Complexes — aggregated interfaces</h1>
      <p className="subtitle">Choose a complex to explore its aggregated interface view.</p>
      <div className="landing-grid">
        {COMPLEXES.map((c) => (
          <a key={c.hash} href={c.hash} className="landing-card" style={{ '--acc': c.accent }}>
            <div className="landing-accent" style={{ background: c.accent }} />
            <h2>{c.title}</h2>
            <p className="subtitle" style={{ marginTop: 2 }}>{c.sub}</p>
            <p className="note">{c.body}</p>
            <div className="landing-go" style={{ color: c.accent }}>Open interface view →</div>
          </a>
        ))}
      </div>
    </div>
  )
}
