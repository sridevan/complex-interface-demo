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
    hash: '#hemoglobin', title: 'Horse hemoglobin — aggregated interfaces',
    sub: 'PDB-CPX-131443 · Equus caballus · α₂β₂ heterotetramer',
    body: 'Interfaces grouped by equivalent chain-class pairs (α1–β1, α1–β2, α1–α2, β1–β2 …) across all '
      + 'deposited structures — selector, 3D viewer, instance table, and aggregated contact Sankey.',
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
