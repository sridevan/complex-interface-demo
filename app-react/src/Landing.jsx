import React from 'react'
import './styles.css'

// Landing cards show only: complex name, oligomeric state, PDB Complex ID, interface type, open link.
// `nProto` (subunit count) orders the protein–protein complexes; antibody–antigen is forced last.
const COMPLEXES = [
  { hash: '#spike', name: 'SARS-CoV-2 spike glycoprotein', oligomer: 'Homotrimer',
    cpxId: 'PDB-CPX-140202', interfaceType: 'antibody-antigen', nProto: 3, accent: '#4b7fcc' },
  { hash: '#hemoglobin', name: 'Horse haemoglobin', oligomer: 'Heterotetramer (α₂β₂)',
    cpxId: 'PDB-CPX-131443', interfaceType: 'protein-protein', nProto: 4, accent: '#c65a5a' },
  { hash: '#cct', name: 'Human CCT / TRiC chaperonin', oligomer: 'Hetero-16-mer (8 subunits × 2)',
    cpxId: 'PDB-CPX-143265', interfaceType: 'protein-protein', nProto: 16, accent: '#3f8f5a' },
  { hash: '#arp23', name: 'Bovine Arp2/3 complex', oligomer: 'Heteroheptamer (7 subunits)',
    cpxId: 'PDB-CPX-110422', interfaceType: 'protein-protein', nProto: 7, accent: '#7b5cd6' },
  { hash: '#pygm', name: 'Rabbit glycogen phosphorylase', oligomer: 'Homodimer',
    cpxId: 'PDB-CPX-129188', interfaceType: 'protein-protein', nProto: 2, accent: '#c98a2b' },
]
const IFACE_LABEL = {
  'protein-protein': 'Protein–protein interfaces',
  'antibody-antigen': 'Antibody–antigen interfaces',
}

// Second category: how similar the assembly instances of one complex are to each other in global
// shape, rather than a view of that complex's interfaces.
const SIMILARITY = [
  { hash: '#hemoglobin-similarity', name: 'Horse haemoglobin', oligomer: 'Heterotetramer (α₂β₂)',
    cpxId: 'PDB-CPX-131443', detail: '20 assembly instances, all pairs compared',
    accent: '#c65a5a' },
]

export default function Landing() {
  const cards = [...COMPLEXES].sort((a, b) => {
    const aAb = a.interfaceType === 'antibody-antigen'
    const bAb = b.interfaceType === 'antibody-antigen'
    if (aAb !== bAb) return aAb ? 1 : -1   // antibody–antigen cards last
    return a.nProto - b.nProto              // others by oligomeric state (subunit count)
  })
  return (
    <div className="wrap">
      <h1>PDBe-KB Complexes</h1>
      <p className="subtitle">Choose a complex to explore.</p>

      <div className="landing-section">
        <h2>Aggregated interfaces</h2>
        <p>Interfaces of a complex, aggregated across every structure that contains it.</p>
      </div>
      <div className="landing-grid">
        {cards.map((c) => (
          <a key={c.hash} href={c.hash} className="landing-card" style={{ '--acc': c.accent }}>
            <div className="landing-accent" style={{ background: c.accent }} />
            <h2>{c.name}</h2>
            <dl className="lc-meta">
              <div><dt>Oligomeric state</dt><dd>{c.oligomer}</dd></div>
              <div><dt>PDB Complex ID</dt><dd className="mono">{c.cpxId}</dd></div>
              <div><dt>Interface type</dt>
                <dd><span className={'lc-pill ' + (c.interfaceType === 'antibody-antigen' ? 'ab' : 'pp')}>
                  {IFACE_LABEL[c.interfaceType]}</span></dd></div>
            </dl>
            <div className="landing-go" style={{ color: c.accent }}>Open interface view →</div>
          </a>
        ))}
      </div>

      <div className="landing-section">
        <h2>Similarity between assembly instances</h2>
        <p>How alike the assembly instances of a complex are in global shape, with any subset
          superposed onto one representative.</p>
      </div>
      <div className="landing-grid">
        {SIMILARITY.map((c) => (
          <a key={c.hash} href={c.hash} className="landing-card" style={{ '--acc': c.accent }}>
            <div className="landing-accent" style={{ background: c.accent }} />
            <h2>{c.name}</h2>
            <dl className="lc-meta">
              <div><dt>Oligomeric state</dt><dd>{c.oligomer}</dd></div>
              <div><dt>PDB Complex ID</dt><dd className="mono">{c.cpxId}</dd></div>
              <div><dt>Comparison</dt><dd>{c.detail}</dd></div>
            </dl>
            <div className="landing-go" style={{ color: c.accent }}>Open similarity view →</div>
          </a>
        ))}
      </div>
    </div>
  )
}
