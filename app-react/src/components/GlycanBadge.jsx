import React, { useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// Badge marking an antigen interface residue that is an N-glycosylation site, from PDBe's
// PRE-COMPUTED glycan interactions (bound_molecule_interactions) — a `covalent` bond gives the
// site, contacts with an antibody chain give the glycan-dependent-epitope signal (e.g. the N343
// glycan against S309). Everything shown is the API's own data; nothing is computed here. The dark
// popup mirrors the Hint/Variant convention. `glycan` = one antigen_interface_glycans row.
export default function GlycanBadge({ glycan }) {
  const ref = useRef(null)
  const [pos, setPos] = useState(null)
  const POP_W = 280
  if (!glycan) return null

  const sites = glycan.glyco_site_structures || []
  const para = glycan.paratope_structures || []
  const resSet = [...new Set((glycan.paratope_contacts || []).map((c) => c.antibody_residue))]
  const nStruct = (n) => `${n} structure${n === 1 ? '' : 's'}`
  // Concise: when the glycan contacts the paratope, the structure list on that line already carries
  // the "where", so don't repeat a separate glycosylated-in line (they're the same structures).
  const text = glycan.contacts_paratope
    ? `N-glycosylation site (PDBe). Glycan contacts the paratope in ${nStruct(para.length)}: `
      + `${para.join(', ')}.\nParatope residues: ${resSet.join(', ')}.`
    : `N-glycosylation site (PDBe), glycosylated in ${nStruct(sites.length)}: ${sites.join(', ')}.`

  const show = () => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - POP_W - 8)) })
  }
  const hide = () => setPos(null)
  return (
    <span className="gbadge" ref={ref} tabIndex={0} role="note" aria-label={text}
          onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}
          onClick={(e) => { e.stopPropagation(); e.preventDefault() }}>
      N-glycan
      {pos && createPortal(
        <span className="hint-pop" style={{ top: pos.top, left: pos.left, maxWidth: POP_W, whiteSpace: 'pre-line' }}>{text}</span>,
        document.body,
      )}
    </span>
  )
}
