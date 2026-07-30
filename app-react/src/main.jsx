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
    title: 'Horse haemoglobin — similarity between assembly instances',
    organism: 'Equus caballus',
  }} /></>
  return <Landing />
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
