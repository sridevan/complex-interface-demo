import { cpSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..', '..')            // repo root
const proc = resolve(root, 'data', 'processed')
const mvsSrc = resolve(root, 'app', 'public', 'mvs')
const pubData = resolve(here, '..', 'public', 'data')
const pubMvs = resolve(here, '..', 'public', 'mvs')
mkdirSync(pubData, { recursive: true }); mkdirSync(pubMvs, { recursive: true })
if (existsSync(proc)) cpSync(proc, pubData, { recursive: true })
if (existsSync(mvsSrc)) cpSync(mvsSrc, pubMvs, { recursive: true })
console.log('synced processed data + mvs scenes into public/')

// Hemoglobin complex (PDB-CPX-131443): the aggregated-interface page loads a flat set of JSONs from
// public/hemoglobin/ plus one CIF per assembly. Stage them from the committed sources: processed
// JSONs (data/processed/<CX>/) and the per-assembly transformed CIFs (<CX>/<asm>/<asm>_transformed.cif).
const HEMO = 'PDB-CPX-131443'
const hemoProc = resolve(proc, HEMO)
const hemoRaw = resolve(root, HEMO)
const pubHemo = resolve(here, '..', 'public', 'hemoglobin')
const pubHemoCif = resolve(pubHemo, 'cif')
if (existsSync(hemoProc)) {
  mkdirSync(pubHemoCif, { recursive: true })
  for (const f of ['aggregated_interface', 'interface', 'interface_contacts',
                   'complex_chain_class', 'uniprot_summary']) {
    const src = resolve(hemoProc, `${f}.json`)
    if (existsSync(src)) cpSync(src, resolve(pubHemo, `${f}.json`))
  }
  if (existsSync(hemoRaw)) {
    for (const d of readdirSync(hemoRaw, { withFileTypes: true })) {
      if (!d.isDirectory()) continue
      const cif = resolve(hemoRaw, d.name, `${d.name}_transformed.cif`)
      if (existsSync(cif)) cpSync(cif, resolve(pubHemoCif, `${d.name}.cif`))
    }
  }
  console.log('synced hemoglobin data + assembly CIFs into public/hemoglobin/')
}
