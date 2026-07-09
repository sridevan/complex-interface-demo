import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import Landing from './Landing.jsx'
import HemoglobinApp from './hemoglobin/HemoglobinApp.jsx'
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
  if (route === '#hemoglobin') return <><BackLink /><HemoglobinApp /></>
  return <Landing />
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
