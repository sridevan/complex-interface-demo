import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import Landing from './Landing.jsx'
import ComplexInterfaceApp from './complex/ComplexInterfaceApp.jsx'
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
  // CCT assemblies are fetched on demand from PDBe's model-server (chains/numbering verified to match
  // our contact data), so its CIFs aren't bundled — see remoteCif in ComplexInterfaceApp.
  if (route === '#cct') return <><BackLink /><ComplexInterfaceApp config={{ basePath: 'cct', remoteCif: true }} /></>
  return <Landing />
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
