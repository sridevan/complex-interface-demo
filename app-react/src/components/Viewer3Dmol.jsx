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

// residues: [{ chain: <author asym id>, resi: <author seq num> }]
export default function Viewer3Dmol({ pdbId, agResidues, abResidues, height = 480 }) {
  const hostRef = useRef(null)
  const viewerRef = useRef(null)
  const [err, setErr] = useState(null)

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
        const cif = await fetch(CIF_URL(pdbId)).then((r) => r.text())
        if (cancelled) return
        viewer.addModel(cif, 'cif')
        viewer.setStyle({}, {})  // nothing by default; show partners as volumes + interface sticks

        const agChains = [...new Set(agResidues.map((r) => r.chain))]
        const abChains = [...new Set(abResidues.map((r) => r.chain))]
        const groups = [...groupByChain(agResidues), ...groupByChain(abResidues)]
        const ifaceSel = { or: groups.map((g) => ({ chain: g.chain, resi: g.resi })) }

        // A single soft-grey translucent surface for the surrounding structure ("the rest" as a
        // volume), restricted to the region around the interface so it stays fast. The coloured
        // sticks already convey antigen vs antibody, so a neutral volume reads cleanest.
        const near = { within: { distance: 16, sel: ifaceSel } }
        await viewer.addSurface($3Dmol.SurfaceType.VDW, { opacity: 0.3, color: '#dce0e6' }, near)
        if (cancelled) return

        // Interacting residues as bright sticks on top (they sit forward of the translucent volumes).
        for (const g of groupByChain(agResidues))
          viewer.setStyle({ chain: g.chain, resi: g.resi }, { stick: { radius: 0.25, colorscheme: carbonScheme(AG_CARBON) } })
        for (const g of groupByChain(abResidues))
          viewer.setStyle({ chain: g.chain, resi: g.resi }, { stick: { radius: 0.25, colorscheme: carbonScheme(AB_CARBON) } })
        viewer.setStyle({ elem: 'H' }, {})  // hide hydrogens from the PDBe mmCIF

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
        setErr(null)
      } catch (e) { setErr(String(e)) }
    }
    run()
    return () => { cancelled = true }
  }, [pdbId, agResidues, abResidues])

  return (
    <>
      <div ref={hostRef} className="viewer" style={{ height }} />
      {err && <p className="note" style={{ color: '#b1442f' }}>{err}</p>}
    </>
  )
}
