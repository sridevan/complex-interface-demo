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

// Aggregated-interface pages: each loads a flat set of JSONs from public/<name>/ plus one CIF per
// assembly. Stage them from the committed sources: processed JSONs (data/processed/<CX>/) and the
// per-assembly transformed CIFs (<CX>/<asm>/<asm>_transformed.cif). Add a complex by appending here.
const COMPLEXES = [
  { cx: 'PDB-CPX-131443', name: 'hemoglobin' },  // horse haemoglobin (α₂β₂)
  { cx: 'PDB-CPX-143265', name: 'cct' },          // human CCT/TRiC chaperonin (16-mer)
]
for (const { cx, name } of COMPLEXES) {
  const srcDir = resolve(proc, cx)
  const rawDir = resolve(root, cx)
  const pub = resolve(here, '..', 'public', name)
  const pubCif = resolve(pub, 'cif')
  if (!existsSync(srcDir)) continue
  mkdirSync(pubCif, { recursive: true })
  for (const f of ['aggregated_interface', 'interface', 'interface_contacts',
                   'complex_chain_class', 'uniprot_summary']) {
    const j = resolve(srcDir, `${f}.json`)
    if (existsSync(j)) cpSync(j, resolve(pub, `${f}.json`))
  }
  if (existsSync(rawDir)) {
    for (const d of readdirSync(rawDir, { withFileTypes: true })) {
      if (!d.isDirectory()) continue
      const cif = resolve(rawDir, d.name, `${d.name}_transformed.cif`)
      if (existsSync(cif)) cpSync(cif, resolve(pubCif, `${d.name}.cif`))
    }
  }
  console.log(`synced ${cx} data + assembly CIFs into public/${name}/`)
}
