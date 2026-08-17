// Experimental method, spelled one way for the whole app.
//
// PDBe's `experimental_method_class` is a closed vocabulary of four lowercase codes. Left raw they
// render as "x-ray" and "em", which read as data rather than as the names crystallographers use,
// and they were being spelled differently in the table, the provenance panel, the block summary and
// the heatmap tooltip. One map, one order, imported everywhere.
//
// Fixed order rather than ranked by count: the reader learns the order once, and two complexes can
// be compared without first re-reading which method happened to come first.

export const METHOD_ORDER = ['x-ray', 'em', 'nmr', 'other']
export const METHOD_NAME = { 'x-ray': 'X-ray', em: 'EM', nmr: 'NMR', other: 'Other' }

// Anything outside the four known classes, a missing value included, folds into "Other" rather than
// inventing a fifth label, so per-method counts always add up to the number of assemblies.
export const methodKey = (m) => (METHOD_ORDER.includes(m) ? m : 'other')
export const methodLabel = (m) => METHOD_NAME[methodKey(m)]

// Counts by method, in METHOD_ORDER, omitting the classes that are absent.
export function methodCounts(rows, get = (a) => a.exp_method) {
  const m = new Map()
  for (const r of rows) {
    const k = methodKey(get(r))
    m.set(k, (m.get(k) || 0) + 1)
  }
  return METHOD_ORDER.filter((k) => m.has(k)).map((k) => ({ key: k, label: METHOD_NAME[k], n: m.get(k) }))
}
