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
// bundleCif:false → the viewer fetches this complex's assemblies from PDBe/RCSB at runtime
// (see remoteCif in ComplexInterfaceApp), so we don't stage or ship its CIFs.
const COMPLEXES = [
  { cx: 'PDB-CPX-131443', name: 'hemoglobin', bundleCif: true },  // horse haemoglobin (α₂β₂)
  { cx: 'PDB-CPX-143265', name: 'cct', bundleCif: false },        // human CCT/TRiC chaperonin (16-mer)
  { cx: 'PDB-CPX-110422', name: 'arp23', bundleCif: true },       // bovine Arp2/3 complex (7 subunits)
  { cx: 'PDB-CPX-129188', name: 'pygm', bundleCif: false },        // rabbit glycogen phosphorylase homodimer (227 assemblies, remote CIFs)
]
for (const { cx, name, bundleCif } of COMPLEXES) {
  const srcDir = resolve(proc, cx)
  const rawDir = resolve(root, cx)
  const pub = resolve(here, '..', 'public', name)
  if (!existsSync(srcDir)) continue
  mkdirSync(pub, { recursive: true })
  for (const f of ['aggregated_interface', 'interface', 'interface_contacts',
                   'complex_chain_class', 'uniprot_summary']) {
    const j = resolve(srcDir, `${f}.json`)
    if (existsSync(j)) cpSync(j, resolve(pub, `${f}.json`))
  }
  if (bundleCif && existsSync(rawDir)) {
    const pubCif = resolve(pub, 'cif')
    mkdirSync(pubCif, { recursive: true })
    for (const d of readdirSync(rawDir, { withFileTypes: true })) {
      if (!d.isDirectory()) continue
      const cif = resolve(rawDir, d.name, `${d.name}_transformed.cif`)
      if (existsSync(cif)) cpSync(cif, resolve(pubCif, `${d.name}.cif`))
    }
  }
  console.log(`synced ${cx} data${bundleCif ? ' + assembly CIFs' : ' (CIFs fetched at runtime)'} into public/${name}/`)
}

// Instance-similarity pages: one dataset JSON (pairwise shape scores + metadata) plus the
// per-assembly CIFs, already superposed onto the reference assembly by
// scripts/build_instance_similarity.py.
const SIMILARITY = [
  { cx: 'PDB-CPX-131443', name: 'hemoglobin-similarity' },   // horse haemoglobin, 20 assemblies
  { cx: 'PDB-CPX-151210', name: 'rnr-similarity' },          // B. subtilis RNR, 40 assemblies
  { cx: 'PDB-CPX-132237', name: 'rhodopsin-similarity' },    // bovine rhodopsin, 12 of 28
  { cx: 'PDB-CPX-119152', name: 'kir22-similarity' },        // chicken Kir2.2, 11 assemblies
  { cx: 'PDB-CPX-129047', name: 'ldh-similarity' },          // L. casei LDH, 13 assemblies (T/R)
  { cx: 'PDB-CPX-130018', name: 'enolase-similarity' },      // yeast enolase, 24 assemblies
  { cx: 'PDB-CPX-137391', name: 'atcase-similarity' },       // E. coli ATCase, 58 assemblies (T/R)
  // Human haemoglobin, 341 assemblies — by far the largest set here, and the one that shows how
  // the view behaves at the scale of a well-studied complex.
  { cx: 'PDB-CPX-154652', name: 'human-hb-similarity' },
]
for (const { cx, name } of SIMILARITY) {
  const srcJson = resolve(proc, cx, 'instance_similarity.json')
  if (!existsSync(srcJson)) continue
  const pub = resolve(here, '..', 'public', name)
  const pubCif = resolve(pub, 'assemblies')
  mkdirSync(pubCif, { recursive: true })
  cpSync(srcJson, resolve(pub, 'instance_similarity.json'))
  const srcCif = resolve(proc, cx, 'assemblies')
  if (existsSync(srcCif)) cpSync(srcCif, pubCif, { recursive: true })
  console.log(`synced ${cx} instance-similarity data into public/${name}/`)
}
