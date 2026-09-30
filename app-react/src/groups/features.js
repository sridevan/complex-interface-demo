// Associated features for a structural group, counted per PDB entry.
//
// Per ENTRY, not per assembly: an entry that PDBe splits into two assemblies would otherwise count
// twice, and every one of its features with it. An entry's features are the union over its
// assemblies. An entry with assemblies on both sides of the group boundary counts on both sides,
// which happens (human haemoglobin's 1yff) and is rare.
//
// Deliberately no test of significance and no grading of the chips. The panel describes what was
// deposited and leaves the weighing of it to the reader; the small-group flag and the counts on
// hover are what say how much a chip rests on. The 15-point display threshold from the similarity
// page still decides which chips appear.

import { ENRICH_PP } from '../states/BlockSummary.jsx'

// Substitutions at residue 1 are the initiator methionine, an expression artefact.
const INITIATOR = /^[A-Z]1[A-Z]$/

// Three kinds of feature in one key space.
export function featuresOf(a) {
  const f = new Set()
  for (const l of a.ligands || []) f.add(`lig:${l.comp}`)
  for (const m of a.mutations || []) if (m.label && !INITIATOR.test(m.label)) f.add(`mut:${m.label}`)
  for (const m of a.modified || []) f.add(`mod:${m.comp}`)
  return f
}

// members: assembly ids in the group; assemblies: every assembly record of the complex.
export function groupFeatures(members, assemblies) {
  const inSet = new Set(members)
  const entries = new Map()
  const ligName = new Map()
  for (const a of assemblies) {
    const e = entries.get(a.pdb_id) || { features: new Set(), inside: false, outside: false }
    for (const f of featuresOf(a)) e.features.add(f)
    if (inSet.has(a.assembly_id)) e.inside = true; else e.outside = true
    entries.set(a.pdb_id, e)
    for (const l of a.ligands || []) if (l.name) ligName.set(l.comp, l.name)
  }
  const all = [...entries.values()]
  const inside = all.filter((e) => e.inside), outside = all.filter((e) => e.outside)
  const nIn = inside.length, nOut = outside.length
  const keys = [...new Set(all.flatMap((e) => [...e.features]))].sort()
  const rows = keys.map((key) => {
    const a = inside.filter((e) => e.features.has(key)).length
    const c = outside.filter((e) => e.features.has(key)).length
    const inShare = nIn ? a / nIn : 0, outShare = nOut ? c / nOut : 0
    return { key, kind: key.slice(0, 3), label: key.slice(4), a, c, inShare, outShare,
             delta: inShare - outShare }
  })
  // Shown: the display threshold, largest difference first.
  const shown = rows.filter((r) => Math.abs(r.delta) >= ENRICH_PP)
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))
  const initiatorN = assemblies.filter((a) => inSet.has(a.assembly_id)
    && (a.mutations || []).some((m) => INITIATOR.test(m.label || ''))).length
  // Assemblies on each side, for the note: the reader sees assemblies in the table and entries in
  // the counts, and the two differ where an entry has several assemblies.
  const asmIn = members.length, asmOut = assemblies.length - asmIn
  return {
    nIn, nOut, asmIn, asmOut, ligName, initiatorN,
    ligands: shown.filter((r) => r.kind === 'lig'),
    mutations: shown.filter((r) => r.kind === 'mut' && r.delta > 0),
    modified: shown.filter((r) => r.kind === 'mod' && r.delta > 0),
    anyModified: rows.some((r) => r.kind === 'mod'),
    noRest: nOut === 0,
  }
}
