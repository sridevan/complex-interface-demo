import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import Landing from './Landing.jsx'
import ComplexInterfaceApp from './complex/ComplexInterfaceApp.jsx'
import ConformationalStatesApp from './states/ConformationalStatesApp.jsx'
import './styles.css'

function BackLink() {
  return <a href="#" className="back-link">← All complexes</a>
}

function Root() {
  const [route, setRoute] = useState(window.location.hash)
  useEffect(() => {
    const h = () => setRoute(window.location.hash)
    window.addEventListener('hashchange', h)
    return () => window.removeEventListener('hashchange', h)
  }, [])
  if (route === '#spike') return <><BackLink /><App /></>
  // Generic interface-conservation view; the horse-hemoglobin dataset is just one basePath.
  if (route === '#hemoglobin') return <><BackLink /><ComplexInterfaceApp config={{ basePath: 'hemoglobin' }} /></>
  // CCT assemblies are fetched on demand from RCSB (see remoteCif/cifSrc), so its CIFs aren't bundled.
  if (route === '#cct') return <><BackLink /><ComplexInterfaceApp config={{ basePath: 'cct', remoteCif: true }} /></>
  if (route === '#arp23') return <><BackLink /><ComplexInterfaceApp config={{ basePath: 'arp23' }} /></>
  // Homodimer with 227 assemblies; CIFs (276MB) are fetched from RCSB at runtime (see remoteCif).
  if (route === '#pygm') return <><BackLink /><ComplexInterfaceApp config={{ basePath: 'pygm', remoteCif: true }} /></>
  // Pairwise global-shape similarity between the assembly instances of one complex, with a
  // build-time superposition onto one representative assembly.
  if (route === '#hemoglobin-similarity') return <><BackLink /><ConformationalStatesApp config={{
    basePath: 'hemoglobin-similarity', complexId: 'PDB-CPX-131443',
    title: 'Horse haemoglobin',
    organism: 'Equus caballus',
  }} /></>
  if (route === '#rnr-similarity') return <><BackLink /><ConformationalStatesApp config={{
    basePath: 'rnr-similarity', complexId: 'PDB-CPX-151210',
    title: 'Ribonucleotide reductase',
    organism: 'Bacillus subtilis',
  }} /></>
  if (route === '#kir22-similarity') return <><BackLink /><ConformationalStatesApp config={{
    basePath: 'kir22-similarity', complexId: 'PDB-CPX-119152',
    title: 'Kir2.2 potassium channel',
    organism: 'Gallus gallus',
  }} /></>
  // Exception to the usual size limits: 58 instances and a 12-chain assembly, kept because its
  // scores track measured structural difference better than any other complex here.
  if (route === '#atcase-similarity') return <><BackLink /><ConformationalStatesApp config={{
    basePath: 'atcase-similarity', complexId: 'PDB-CPX-137391',
    title: 'Aspartate carbamoyltransferase',
    organism: 'Escherichia coli',
  }} /></>
  if (route === '#ldh-similarity') return <><BackLink /><ConformationalStatesApp config={{
    basePath: 'ldh-similarity', complexId: 'PDB-CPX-129047',
    title: 'L-lactate dehydrogenase',
    organism: 'Lacticaseibacillus casei',
  }} /></>
  if (route === '#enolase-similarity') return <><BackLink /><ConformationalStatesApp config={{
    basePath: 'enolase-similarity', complexId: 'PDB-CPX-130018',
    title: 'Enolase 1',
    organism: 'Saccharomyces cerevisiae',
  }} /></>
  // 341 assemblies — an order of magnitude past the other sets, and the case the view has to
  // survive. Note this is HUMAN haemoglobin; '#hemoglobin-similarity' above is the horse one.
  if (route === '#human-hb-similarity') return <><BackLink /><ConformationalStatesApp config={{
    basePath: 'human-hb-similarity', complexId: 'PDB-CPX-154652',
    title: 'Human haemoglobin',
    organism: 'Homo sapiens',
  }} /></>
  // RNA polymerase II: near-copies rather than states, and the clearest demonstration here of
  // what one genuine outlier does to a linear colour scale.
  if (route === '#polii-similarity') return <><BackLink /><ConformationalStatesApp config={{
    basePath: 'polii-similarity', complexId: 'PDB-CPX-133430',
    title: 'RNA polymerase II',
    organism: 'Saccharomyces cerevisiae',
  }} /></>
  // Respiratory complex I: the depositors varied conformation and sample condition
  // independently, so this set carries its own negative control. The matrix separates
  // conformation (Cohen's d 1.42) and is blind to condition (-0.15) and detergent (0.26).
  if (route === '#complex1-similarity') return <><BackLink /><ConformationalStatesApp config={{
    basePath: 'complex1-similarity', complexId: 'PDB-CPX-138641',
    title: 'Respiratory complex I',
    organism: 'Escherichia coli',
  }} /></>
  // Rotary F-ATP synthase: the depositors labelled three primary rotary states and their
  // substates in the entry titles, so this set has an independent ground truth to check the view
  // against. TM-score separates the three states with no overlap at all (Cohen's d 6.98, every
  // within-state pair closer than every between-state pair), which is the cleanest recovery of any
  // set here.
  if (route === '#atpsynthase-similarity') return <><BackLink /><ConformationalStatesApp config={{
    basePath: 'atpsynthase-similarity', complexId: 'PDB-CPX-106364',
    title: 'F-ATP synthase',
    organism: 'Polytomella sp.',
  }} /></>
  // Only the largest packing group is built for rhodopsin; see the subset note on the page.
  if (route === '#rhodopsin-similarity') return <><BackLink /><ConformationalStatesApp config={{
    basePath: 'rhodopsin-similarity', complexId: 'PDB-CPX-132237',
    title: 'Rhodopsin',
    organism: 'Bos taurus',
  }} /></>
  return <Landing />
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
