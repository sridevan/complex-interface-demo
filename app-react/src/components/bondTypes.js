// PISA interaction-type labels + strength ordering, shared by the contact-pair table, the contact-
// frequency map, and the Sankey tooltip so every list of bond types reads the same and is ordered
// strongest → weakest: covalent > disulfide > salt bridge > hydrogen bond > other.
export const BOND_LABEL = {
  hydrogen_bond: 'hydrogen bond', salt_bridge: 'salt bridge', disulfide_bond: 'disulfide bond',
  covalent_bond: 'covalent bond', other_bond: 'other bond',
}

// Colours for the 3D contact-line overlay. Deliberately kept clear of everything else in the scene —
// the blue/orange chains, the CPK heteroatoms (red O, blue N, yellow S) and the teal highlight — so
// a contact line never reads as part of the structure. "other" (vdW) uses neutral grey.
export const BOND_COLOR = {
  hydrogen_bond: '#e0218a', salt_bridge: '#1f9e5a', disulfide_bond: '#7c4dff', covalent_bond: '#a21caf',
}
export const VDW_COLOR = '#9aa3ad'

const BOND_ORDER = ['covalent_bond', 'disulfide_bond', 'salt_bridge', 'hydrogen_bond', 'other_bond']
// Rank for sorting; unknown types fall to the end.
export const bondRank = (b) => { const i = BOND_ORDER.indexOf(b); return i === -1 ? BOND_ORDER.length : i }
export const bondLabel = (b) => BOND_LABEL[b] || b
// A list of bond-type keys, sorted strongest → weakest and mapped to display labels.
export const orderedBondLabels = (bonds) => [...bonds].sort((a, b) => bondRank(a) - bondRank(b)).map(bondLabel)
