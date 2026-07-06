// Data loading + shared helpers for the demo app.
const BASE = import.meta.env.BASE_URL || '/'

export async function loadAll() {
  const names = [
    'aggregated_antigen_epitope_contacts',
    'antigen_interface_variants',
    'antigen_interface_glycans',
    'aggregated_antibody_imgt_contacts',
    'imgt_region_contribution',
    'residue_level_interactions',
    'interface_summary',
    'mapping_anomalies',
    'antigen_unp_coverage',
    'batch_report',
    'sabdab2_ids',
    'structure_quality',
    'multidomain_antibody_chains',
  ]
  // files that are keyed objects, not arrays — default to {} on miss
  const objDefaults = new Set(['batch_report', 'sabdab2_ids', 'structure_quality', 'multidomain_antibody_chains'])
  const out = {}
  await Promise.all(names.map(async (n) => {
    const empty = objDefaults.has(n) ? {} : []
    try {
      const r = await fetch(`${BASE}data/${n}.json`)
      out[n] = r.ok ? await r.json() : empty
    } catch {
      out[n] = empty
    }
  }))
  return out
}

export const REGION_COLORS = {
  'CDR-H1': '#e8a34a', 'CDR-H2': '#e08b2c', 'CDR-H3': '#c96a12',
  'Framework-H': '#f2cf9e',
  'CDR-L1': '#5f93d6', 'CDR-L2': '#3f79c2', 'CDR-L3': '#1f5aa0',
  'Framework-L': '#aecbec',
}

export function topRegions(list) {
  if (!Array.isArray(list) || !list.length) return '—'
  return list.map((d) => `${d.value} (${d.count})`).join(', ')
}

export function fmt(v) {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'number') return Number.isInteger(v) ? v : v.toFixed(2)
  return v
}
