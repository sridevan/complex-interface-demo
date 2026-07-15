// PISA interaction-type labels + strength ordering, shared by the contact-pair table, the contact-
// frequency map, and the Sankey tooltip so every list of bond types reads the same and is ordered
// strongest → weakest: covalent > disulfide > salt bridge > hydrogen bond > other.
export const BOND_LABEL = {
  hydrogen_bond: 'hydrogen bond', salt_bridge: 'salt bridge', disulfide_bond: 'disulfide bond',
  covalent_bond: 'covalent bond', other_bond: 'other bond',
}

// Colours for the 3D contact-line overlay — distinct from the blue/orange chain colours and from
// each other. "other" (van der Waals) uses a neutral grey since it isn't a specific bond.
export const BOND_COLOR = {
  hydrogen_bond: '#e8a400', salt_bridge: '#d24b9c', disulfide_bond: '#2e9e6b', covalent_bond: '#8a5cd0',
}
export const VDW_COLOR = '#9aa3ad'

const BOND_ORDER = ['covalent_bond', 'disulfide_bond', 'salt_bridge', 'hydrogen_bond', 'other_bond']
// Rank for sorting; unknown types fall to the end.
export const bondRank = (b) => { const i = BOND_ORDER.indexOf(b); return i === -1 ? BOND_ORDER.length : i }
export const bondLabel = (b) => BOND_LABEL[b] || b
// A list of bond-type keys, sorted strongest → weakest and mapped to display labels.
export const orderedBondLabels = (bonds) => [...bonds].sort((a, b) => bondRank(a) - bondRank(b)).map(bondLabel)
