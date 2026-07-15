import React, { useEffect, useRef, useState } from 'react'
import { BOND_LABEL, BOND_COLOR, VDW_COLOR, bondRank } from './bondTypes.js'

// PDBe updated mmCIF (author numbering matches the residue lists we pass in).
const CIF_URL = (pdb) => `https://www.ebi.ac.uk/pdbe/entry-files/download/${pdb}_updated.cif`

const AG_CARBON = 0x4b7fcc  // antigen carbons – blue
const AB_CARBON = 0xe19039  // antibody carbons – orange
// Translucent per-chain surface tints (a light shade of each side's stick colour) so the two chain
// bodies are distinguishable; kept pale so the brighter interface sticks still read on top.
const AG_SURFACE = '#9cbde4'  // component-1 (blue) surface
const AB_SURFACE = '#eec79a'  // component-2 (orange) surface
const SURF_OPACITY = 0.42
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
// cifUrl: optional explicit mmCIF URL (e.g. a local assembly file); falls back to the PDBe entry CIF.
export default function Viewer3Dmol({ pdbId, cifUrl, agResidues, abResidues, contacts, highlight, onClearHighlight, height = 480 }) {
  const hostRef = useRef(null)
  const viewerRef = useRef(null)
  const surfRef = useRef(null)
  const ifaceSelRef = useRef(null)
  const highlightRef = useRef(null)
  highlightRef.current = highlight  // keep current for restyle() called from either effect
  const showBgRef = useRef(true)
  const labelsRef = useRef([])
  const showLabelsRef = useRef(false)
  const contactShapesRef = useRef([])
  const showContactsRef = useRef(false)
  const showVdwRef = useRef(false)
  const [showBg, setShowBg] = useState(true)
  const [showLabels, setShowLabels] = useState(false)
  const [showContacts, setShowContacts] = useState(false)
  const [showVdw, setShowVdw] = useState(false)
  const [err, setErr] = useState(null)

  // Show/hide the grey context volume (background) without recomputing the surface.
  const applyBg = (v, surfs, show) => {
    if (!v || !surfs) return
    for (const s of (Array.isArray(surfs) ? surfs : [{ surf: surfs, color: '#dce0e6' }])) {
      try { v.setSurfaceMaterialStyle(s.surf, { opacity: show ? SURF_OPACITY : 0, color: s.color }) } catch { /* noop */ }
    }
    v.render()
  }
  const toggleBg = () => {
    const next = !showBgRef.current
    showBgRef.current = next
    setShowBg(next)
    applyBg(viewerRef.current, surfRef.current, next)
  }

  // ── Contact-line overlay ───────────────────────────────────────────────────────────────
  // Draw each interface contact as a dashed cylinder between its two atoms. Specific bonds
  // (H-bond, salt bridge, …) are coloured by type; van der Waals ("other") contacts are optional,
  // drawn as one faint grey line per residue pair (endpoints = that pair's closest atom contact).
  const clearContacts = (v) => {
    for (const s of contactShapesRef.current) { try { v.removeShape(s) } catch { /* noop */ } }
    contactShapesRef.current = []
  }
  const atomPos = (v, chain, resi, atom) => {
    const model = v.getModel(); if (!model) return null
    let a = model.selectedAtoms({ chain, resi, atom })
    if (!a.length) a = model.selectedAtoms({ chain, resi })  // atom absent (e.g. no H) → residue centre
    if (!a.length) return null
    return { x: a[0].x, y: a[0].y, z: a[0].z }
  }
  const drawContacts = (v) => {
    if (!v) return
    clearContacts(v)
    if (!showContactsRef.current || !contacts) { v.render(); return }
    const lines = [...(contacts.specific || [])]
    if (showVdwRef.current) lines.push(...(contacts.vdw || []))
    for (const c of lines) {
      const s = atomPos(v, c.chain1, c.resi1, c.atom1)
      const e = atomPos(v, c.chain2, c.resi2, c.atom2)
      if (!s || !e) continue
      const vdw = c.type === 'other_bond'
      contactShapesRef.current.push(v.addCylinder({
        start: s, end: e, radius: vdw ? 0.04 : 0.07, color: vdw ? VDW_COLOR : (BOND_COLOR[c.type] || '#888'),
        dashed: true, dashLength: vdw ? 0.12 : 0.28, gapLength: vdw ? 0.2 : 0.16, fromCap: 1, toCap: 1,
      }))
    }
    v.render()
  }
  const toggleContacts = () => {
    const n = !showContactsRef.current; showContactsRef.current = n; setShowContacts(n)
    drawContacts(viewerRef.current)
  }
  const toggleVdw = () => {
    const n = !showVdwRef.current; showVdwRef.current = n; setShowVdw(n)
    drawContacts(viewerRef.current)
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

  // Re-frame the camera on the interacting residues and clear any Sankey-selected highlight
  // (the highlight prop change re-styles/de-highlights via the effect below).
  const recenter = () => {
    if (onClearHighlight) onClearHighlight()
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
      const url = cifUrl || (pdbId && CIF_URL(pdbId))
      if (!url) return
      try {
        if (!viewerRef.current) {
          viewerRef.current = $3Dmol.createViewer(hostRef.current, { backgroundColor: 'white' })
        }
        const viewer = viewerRef.current
        viewer.clear()
        labelsRef.current = []  // clear() removes any existing labels
        contactShapesRef.current = []  // …and any existing contact cylinders
        const cif = await fetch(url).then((r) => r.text())
        if (cancelled) return
        viewer.addModel(cif, 'cif')
        viewer.setStyle({}, {})  // nothing by default; show partners as volumes + interface sticks

        const agChains = [...new Set(agResidues.map((r) => r.chain))]
        const abChains = [...new Set(abResidues.map((r) => r.chain))]
        const groups = [...groupByChain(agResidues), ...groupByChain(abResidues)]
        const ifaceSel = { or: groups.map((g) => ({ chain: g.chain, resi: g.resi })) }
        ifaceSelRef.current = ifaceSel

        // Two translucent surfaces — one per side — each tinted a light shade of that side's colour,
        // so the two chain bodies are distinguishable at a glance while the brighter interface sticks
        // still read on top. Restricted to the region around the interface so it stays fast.
        const near1 = { chain: agChains, within: { distance: 16, sel: ifaceSel } }
        const near2 = { chain: abChains, within: { distance: 16, sel: ifaceSel } }
        const surf1 = await viewer.addSurface($3Dmol.SurfaceType.VDW, { opacity: SURF_OPACITY, color: AG_SURFACE }, near1)
        if (cancelled) return
        const surf2 = await viewer.addSurface($3Dmol.SurfaceType.VDW, { opacity: SURF_OPACITY, color: AB_SURFACE }, near2)
        surfRef.current = [{ surf: surf1, color: AG_SURFACE }, { surf: surf2, color: AB_SURFACE }]
        if (cancelled) return
        if (!showBgRef.current) applyBg(viewer, surfRef.current, false)  // respect the toggle across instances

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
        drawContacts(viewer)  // respect the contacts toggle across instances
        setErr(null)
      } catch (e) { setErr(String(e)) }
    }
    run()
    return () => { cancelled = true }
  }, [pdbId, cifUrl, agResidues, abResidues, contacts])

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

  const presentTypes = [...new Set((contacts?.specific || []).map((c) => c.type))]
    .sort((a, b) => bondRank(a) - bondRank(b))

  return (
    <>
      <div className="viewer-wrap" style={{ height }}>
        <div ref={hostRef} className="viewer" style={{ height }} />
        <div className="viewer-btns">
          <button className="viewer-btn" onClick={recenter}
                  title="Re-centre the view on the interacting residues">
            Centre view
          </button>
          <button className="viewer-btn" onClick={toggleBg}
                  title="Toggle the surrounding assembly surface">
            {showBg ? 'Hide assembly surface' : 'Show assembly surface'}
          </button>
          <button className="viewer-btn" onClick={toggleLabels}
                  title="Label the interacting residues (chain:resname+resnum)">
            {showLabels ? 'Hide residue labels' : 'Show residue labels'}
          </button>
          <button className="viewer-btn" onClick={toggleContacts}
                  title="Draw the interface contacts (H-bonds, salt bridges, …) as dashed lines">
            {showContacts ? 'Hide contacts' : 'Show contacts'}
          </button>
        </div>
        {showContacts && (
          <div className="viewer-legend">
            <div className="vl-title">Interface contacts</div>
            {presentTypes.length ? presentTypes.map((t) => (
              <div key={t} className="vl-row"><span className="vl-dash" style={{ '--c': BOND_COLOR[t] }} />{BOND_LABEL[t]}</div>
            )) : <div className="vl-row vl-muted">no specific bonds in this instance</div>}
            <label className="vl-row vl-check">
              <input type="checkbox" checked={showVdw} onChange={toggleVdw} />
              <span className="vl-dash vl-dash-vdw" style={{ '--c': VDW_COLOR }} />van der Waals
            </label>
            <div className="vl-note">vdW = one faint line per residue pair</div>
          </div>
        )}
      </div>
      {err && <p className="note" style={{ color: '#b1442f' }}>{err}</p>}
    </>
  )
}
