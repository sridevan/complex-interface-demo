import React, { useEffect, useRef, useState } from 'react'

// PDBe updated mmCIF (author numbering matches the residue lists we pass in).
const CIF_URL = (pdb) => `https://www.ebi.ac.uk/pdbe/entry-files/download/${pdb}_updated.cif`

const AG_CARBON = 0x4b7fcc  // antigen carbons – blue
const AB_CARBON = 0xe19039  // antibody carbons – orange
const CPK = { O: 0xd1392c, N: 0x3454d1, S: 0xe6b800, H: 0xeeeeee }

// Colour scheme: carbons by side, heteroatoms by CPK (like histo.fyi's chemical read).
const carbonScheme = (carbon) => ({ prop: 'elem', map: { C: carbon, ...CPK } })

function groupByChain(residues) {
  const by = {}
  for (const r of residues) (by[r.chain] ||= new Set()).add(r.resi)
  return Object.entries(by).map(([chain, set]) => ({ chain, resi: [...set] }))
}

const HL_COLOR = 0x12c9a6  // highlight teal for a Sankey-selected residue

// residues: [{ chain: <author asym id>, resi: <author seq num> }]
export default function Viewer3Dmol({ pdbId, agResidues, abResidues, highlight, height = 480 }) {
  const hostRef = useRef(null)
  const viewerRef = useRef(null)
  const surfRef = useRef(null)
  const ifaceSelRef = useRef(null)
  const highlightRef = useRef(null)
  highlightRef.current = highlight  // keep current for restyle() called from either effect
  const showBgRef = useRef(true)
  const labelsRef = useRef([])
  const showLabelsRef = useRef(false)
  const [showBg, setShowBg] = useState(true)
  const [showLabels, setShowLabels] = useState(false)
  const [err, setErr] = useState(null)

  // Show/hide the grey context volume (background) without recomputing the surface.
  const applyBg = (v, surf, show) => {
    if (!v || surf == null) return
    try { v.setSurfaceMaterialStyle(surf, { opacity: show ? 0.3 : 0, color: '#dce0e6' }); v.render() } catch { /* noop */ }
  }
  const toggleBg = () => {
    const next = !showBgRef.current
    showBgRef.current = next
    setShowBg(next)
    applyBg(viewerRef.current, surfRef.current, next)
  }

  // Persistent residue labels (<chain>:<resname><resnum> (UNP|IMGT)) placed at each residue's CA.
  const addResidueLabels = (v) => {
    const model = v.getModel()
    if (!model) return
    const out = []
    for (const r of [...agResidues, ...abResidues]) {
      const atoms = model.selectedAtoms({ chain: r.chain, resi: r.resi })
      if (!atoms.length) continue
      const a = atoms.find((x) => x.atom === 'CA') || atoms[0]
      out.push(v.addLabel(r.short || r.label, {
        position: { x: a.x, y: a.y, z: a.z }, inFront: true, fontColor: 'black',
        backgroundOpacity: 0, fontSize: 13, borderThickness: 0,
      }))
    }
    labelsRef.current = out
    v.render()
  }
  const clearResidueLabels = (v) => {
    for (const l of labelsRef.current) v.removeLabel(l)
    labelsRef.current = []
    v.render()
  }
  const toggleLabels = () => {
    const next = !showLabelsRef.current
    showLabelsRef.current = next
    setShowLabels(next)
    const v = viewerRef.current
    if (!v) return
    if (next) addResidueLabels(v); else clearResidueLabels(v)
  }
  // Apply interface-residue sticks (per-side CPK) + the current highlight, if any.
  const restyle = (v) => {
    for (const g of groupByChain(agResidues))
      v.setStyle({ chain: g.chain, resi: g.resi }, { stick: { radius: 0.25, colorscheme: carbonScheme(AG_CARBON) } })
    for (const g of groupByChain(abResidues))
      v.setStyle({ chain: g.chain, resi: g.resi }, { stick: { radius: 0.25, colorscheme: carbonScheme(AB_CARBON) } })
    v.setStyle({ elem: 'H' }, {})
    const hl = highlightRef.current
    if (hl && hl.chain != null && hl.resi != null) {
      const sel = { chain: hl.chain, resi: hl.resi }
      v.setStyle(sel, { stick: { radius: 0.42, color: HL_COLOR } })
      v.addStyle(sel, { sphere: { radius: 0.9, color: HL_COLOR, opacity: 0.22 } })
      v.setStyle({ chain: hl.chain, resi: hl.resi, elem: 'H' }, {})
    }
  }

  // Re-frame the camera on the interacting residues (after the user has rotated/zoomed away).
  const recenter = () => {
    const v = viewerRef.current, sel = ifaceSelRef.current
    if (!v || !sel) return
    v.zoomTo(sel, 250)
    v.zoom(1.2)
    v.render()
  }

  useEffect(() => {
    let cancelled = false
    async function run() {
      const $3Dmol = window.$3Dmol
      if (!$3Dmol) { setErr('3Dmol failed to load from CDN (needs internet).'); return }
      if (!pdbId) return
      try {
        if (!viewerRef.current) {
          viewerRef.current = $3Dmol.createViewer(hostRef.current, { backgroundColor: 'white' })
        }
        const viewer = viewerRef.current
        viewer.clear()
        labelsRef.current = []  // clear() removes any existing labels
        const cif = await fetch(CIF_URL(pdbId)).then((r) => r.text())
        if (cancelled) return
        viewer.addModel(cif, 'cif')
        viewer.setStyle({}, {})  // nothing by default; show partners as volumes + interface sticks

        const agChains = [...new Set(agResidues.map((r) => r.chain))]
        const abChains = [...new Set(abResidues.map((r) => r.chain))]
        const groups = [...groupByChain(agResidues), ...groupByChain(abResidues)]
        const ifaceSel = { or: groups.map((g) => ({ chain: g.chain, resi: g.resi })) }
        ifaceSelRef.current = ifaceSel

        // A single soft-grey translucent surface for the surrounding structure ("the rest" as a
        // volume), restricted to the region around the interface so it stays fast. The coloured
        // sticks already convey antigen vs antibody, so a neutral volume reads cleanest.
        const near = { within: { distance: 16, sel: ifaceSel } }
        const surf = await viewer.addSurface($3Dmol.SurfaceType.VDW, { opacity: 0.3, color: '#dce0e6' }, near)
        surfRef.current = surf
        if (cancelled) return
        if (!showBgRef.current) applyBg(viewer, surf, false)  // respect the toggle across instances

        // Interacting residues as bright sticks on top (they sit forward of the translucent volumes),
        // plus the current highlight if a Sankey node is selected.
        restyle(viewer)

        // Hover a residue -> label with its normalised numbering (UniProt / IMGT).
        const labelMap = {}
        for (const r of [...agResidues, ...abResidues]) labelMap[`${r.chain}:${r.resi}`] = r.label
        viewer.setHoverDuration(80)
        viewer.setHoverable(ifaceSel, true,
          (atom, v) => {
            if (atom.__lbl) return
            const text = labelMap[`${atom.chain}:${atom.resi}`] || `${atom.chain}:${atom.resn}${atom.resi}`
            atom.__lbl = v.addLabel(text, {
              position: atom, backgroundColor: '#1c2430', backgroundOpacity: 0.9,
              fontColor: 'white', fontSize: 12, borderThickness: 0, inFront: true,
            })
            v.render()
          },
          (atom, v) => { if (atom.__lbl) { v.removeLabel(atom.__lbl); delete atom.__lbl; v.render() } })

        // Focus tightly on exactly the interface residues (per-chain OR, so it doesn't frame
        // every residue that merely shares a number with another chain).
        viewer.zoomTo(ifaceSel)
        viewer.zoom(1.2)  // push the interacting residues closer to the viewer
        viewer.render()
        if (showLabelsRef.current) addResidueLabels(viewer)  // respect the labels toggle across instances
        setErr(null)
      } catch (e) { setErr(String(e)) }
    }
    run()
    return () => { cancelled = true }
  }, [pdbId, agResidues, abResidues])

  // When a Sankey node is clicked, re-apply styles with the highlight and bring it into view.
  useEffect(() => {
    const v = viewerRef.current
    if (!v) return
    restyle(v)
    if (highlight && highlight.chain != null && highlight.resi != null) {
      v.center({ chain: highlight.chain, resi: highlight.resi }, 350)
    }
    v.render()
  }, [highlight])

  return (
    <>
      <div className="viewer-wrap" style={{ height }}>
        <div ref={hostRef} className="viewer" style={{ height }} />
        <div className="viewer-btns">
          <button className="viewer-btn" onClick={recenter}
                  title="Re-center the view on the interacting residues">
            Center
          </button>
          <button className="viewer-btn" onClick={toggleBg}
                  title="Toggle the surrounding structure (background)">
            {showBg ? 'Hide background' : 'Show background'}
          </button>
          <button className="viewer-btn" onClick={toggleLabels}
                  title="Label the interacting residues (chain:resname+resnum)">
            {showLabels ? 'Hide labels' : 'Show labels'}
          </button>
        </div>
      </div>
      {err && <p className="note" style={{ color: '#b1442f' }}>{err}</p>}
    </>
  )
}
