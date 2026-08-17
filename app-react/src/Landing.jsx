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
//
// Ordered best to worst by how well the shape scores track measured structural difference: primarily
// the partial correlation between score and backbone RMSD once modelled extent is controlled for,
// which is what distinguishes "measures shape" from "measures how much of the model was built".
// The numbers and caveats are not repeated here -- each page carries them in its data notes.
const SIMILARITY = [
  { hash: '#atcase-similarity', name: 'Aspartate carbamoyltransferase', oligomer: 'Heterododecamer',
    cpxId: 'PDB-CPX-137391', organism: 'Escherichia coli',
    detail: '58 instances · 1,653 pairs', accent: '#b0447a' },
  { hash: '#polii-similarity', name: 'RNA polymerase II', oligomer: 'Heterododecamer',
    cpxId: 'PDB-CPX-133430', organism: 'Saccharomyces cerevisiae',
    detail: '18 instances · 153 pairs', accent: '#6b6f9c' },
  { hash: '#complex1-similarity', name: 'Respiratory complex I', oligomer: 'Heteromultimer, 13 subunits',
    cpxId: 'PDB-CPX-138641', organism: 'Escherichia coli',
    detail: '24 instances · 276 pairs', accent: '#8a6d3b' },
  { hash: '#atpsynthase-similarity', name: 'F-ATP synthase', oligomer: 'Rotary, 17 subunits',
    cpxId: 'PDB-CPX-106364', organism: 'Polytomella sp.',
    detail: '16 instances · 120 pairs', accent: '#1f7a8c' },
  { hash: '#enolase-similarity', name: 'Enolase 1', oligomer: 'Homodimer',
    cpxId: 'PDB-CPX-130018', organism: 'Saccharomyces cerevisiae',
    detail: '24 instances · 276 pairs', accent: '#2f8f8f' },
  { hash: '#ldh-similarity', name: 'L-lactate dehydrogenase', oligomer: 'Homotetramer',
    cpxId: 'PDB-CPX-129047', organism: 'Lacticaseibacillus casei',
    detail: '13 instances · 78 pairs', accent: '#7b5cd6' },
  { hash: '#kir22-similarity', name: 'Kir2.2 potassium channel', oligomer: 'Homotetramer',
    cpxId: 'PDB-CPX-119152', organism: 'Gallus gallus',
    detail: '11 instances · 55 pairs', accent: '#4b7fcc' },
  { hash: '#rhodopsin-similarity', name: 'Rhodopsin', oligomer: 'Homodimer',
    cpxId: 'PDB-CPX-132237', organism: 'Bos taurus',
    detail: '28 instances · 378 pairs', accent: '#c98a2b' },
  { hash: '#rnr-similarity', name: 'Ribonucleotide reductase', oligomer: 'Heterotetramer',
    cpxId: 'PDB-CPX-151210', organism: 'Bacillus subtilis',
    detail: '40 instances · 780 pairs', accent: '#3f8f5a' },
  { hash: '#hemoglobin-similarity', name: 'Horse haemoglobin', oligomer: 'Heterotetramer (α₂β₂)',
    cpxId: 'PDB-CPX-131443', organism: 'Equus caballus',
    detail: '20 instances · 190 pairs', accent: '#c65a5a' },
  { hash: '#human-hb-similarity', name: 'Human haemoglobin', oligomer: 'Heterotetramer (α₂β₂)',
    cpxId: 'PDB-CPX-154652', organism: 'Homo sapiens',
    detail: '341 instances · 57,970 pairs', accent: '#8a4fb8' },
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
          superposed onto one representative. Best examples first.</p>
      </div>
      <div className="landing-grid">
        {SIMILARITY.map((c) => (
          <a key={c.hash} href={c.hash} className="landing-card" style={{ '--acc': c.accent }}>
            <div className="landing-accent" style={{ background: c.accent }} />
            <h2>{c.name}{c.synthetic && <span className="synth-tag">synthetic</span>}</h2>
            <dl className="lc-meta">
              <div><dt>Organism</dt><dd><i>{c.organism}</i></dd></div>
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
