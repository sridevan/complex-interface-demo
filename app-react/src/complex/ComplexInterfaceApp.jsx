import React, { useEffect, useMemo, useState } from 'react'
import Viewer3Dmol from '../components/Viewer3Dmol.jsx'
import SankeyContacts from '../components/SankeyContacts.jsx'
import InterfacePropertyDistributions from '../components/InterfacePropertyDistributions.jsx'
import ContactPairTable from './ContactPairTable.jsx'
import ContactMap from './ContactMap.jsx'
import SortIcon from '../components/SortIcon.jsx'
import Hint from '../components/Hint.jsx'
import '../styles.css'

// PISA per-interface properties to profile (generic wording — both partners are protein chains).
const PISA_PROPS = [
  { key: 'interface_area', label: 'Buried surface area', unit: 'Å²', digits: 0,
    desc: 'Buried surface area of the selected interface — area excluded from solvent on binding (PISA). Larger = bigger interface.' },
  { key: 'solvation_energy', label: 'Solvation energy ΔᵢG', unit: 'kcal/mol', digits: 1,
    desc: 'Solvation free-energy gain when the selected interface forms (PISA). More negative = more hydrophobic burial driving association.' },
  { key: 'stabilization_energy', label: 'Stabilisation energy', unit: 'kcal/mol', digits: 1,
    desc: 'Stabilisation (dissociation) energy of the selected interface (PISA). More negative = a more stable interface.' },
  { key: 'p_value', label: 'Interface P-value', unit: '', digits: 2,
    desc: 'Specificity P-value of the selected interface (PISA). < 0.5 = more hydrophobic/specific than a random patch of equal area; > 0.5 = less.' },
  { key: 'number_interface_residues', label: 'Interface residues', unit: '', digits: 0, discrete: true,
    desc: 'Residues buried at the selected interface, counting both chains (PISA).' },
  { key: 'number_hydrogen_bonds', label: 'Hydrogen bonds', unit: '', digits: 0, discrete: true,
    desc: 'Hydrogen bonds across the selected interface (PISA).' },
  { key: 'number_salt_bridges', label: 'Salt bridges', unit: '', digits: 0, discrete: true,
    desc: 'Salt bridges across the selected interface (PISA).' },
  { key: 'number_other_bonds', label: 'Other bonds', unit: '', digits: 0, discrete: true,
    desc: 'Other close contacts (not a hydrogen bond, salt bridge, disulfide or covalent bond) across the selected interface (PISA) — the bulk of interface atom contacts.' },
  { key: 'number_disulfide_bonds', label: 'Disulfide bonds', unit: '', digits: 0, discrete: true,
    desc: 'Disulfide bonds across the selected interface (PISA); rare.' },
  { key: 'number_covalent_bonds', label: 'Covalent bonds', unit: '', digits: 0, discrete: true,
    desc: 'Covalent bonds across the selected interface (PISA); rare.' },
]

const BASE = import.meta.env.BASE_URL || '/'
// Data is loaded from a per-complex folder under the public root (config.basePath), so the same
// component serves any deposited complex, not just the horse-hemoglobin dataset.
const load = (base, n) => fetch(`${BASE}${base}/${n}.json`).then((r) => r.json())
const uniq = (a) => [...new Set(a)]

const AA3TO1 = {
  ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C', GLU: 'E', GLN: 'Q', GLY: 'G', HIS: 'H',
  ILE: 'I', LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F', PRO: 'P', SER: 'S', THR: 'T', TRP: 'W',
  TYR: 'Y', VAL: 'V', MSE: 'M', SEC: 'U', PYL: 'O',
}
const one = (resn) => AA3TO1[resn] || 'X'
// contact records store residue_1/2 as "<resname><num>" (e.g. "ARG32"); recover the bare 3-letter code.
const bareRes = (s) => String(s || '').replace(/\d+$/, '')

// Component chips are coloured by accession family: each UniProt accession gets a hue family and the
// copy suffix picks a shade, so copies of one component read as related tints.
const COMP_FAMILIES = [['#3b6fb0', '#7aa5db'], ['#d1782e', '#eab07a'], ['#3f8f5a', '#84c397'], ['#8a5cb0', '#b79ad6']]
function buildCompColors(labels) {
  const accs = [...new Set(labels.map((l) => l.split('-')[0]))].sort()
  const map = {}
  for (const l of labels) {
    const [acc, suf] = l.split('-')
    const fam = COMP_FAMILIES[accs.indexOf(acc) % COMP_FAMILIES.length]
    map[l] = fam[(parseInt(suf, 10) - 1 + fam.length) % fam.length]
  }
  return map
}

// ── Generic component nomenclature (no domain-specific labels) ─────────────────────────────
// Subscript digits for the stoichiometry string (e.g. 2 -> ₂).
const SUBSCRIPTS = '₀₁₂₃₄₅₆₇₈₉'
const toSub = (n) => String(n).split('').map((d) => SUBSCRIPTS[+d] ?? d).join('')

// Catalogue the component copies referenced by the aggregated interfaces: accession -> set of copy
// suffixes (e.g. P01958 -> {"1","2"}). Drives copy-index labels and the complex stoichiometry.
function componentCopies(agg) {
  const copies = new Map()
  for (const a of agg) {
    for (const l of [a.component_label_1, a.component_label_2]) {
      const [acc, suf] = String(l).split('-')
      if (!copies.has(acc)) copies.set(acc, new Set())
      copies.get(acc).add(suf)
    }
  }
  return copies
}

// Human label for a component copy: gene (or accession) plus a copy index, but only when the
// component has more than one copy — so single-copy components stay uncluttered. Generalises the
// hemoglobin α1/α2 idea without hardcoding: "P01958-1" -> "HBA·1" (2 copies), lone chain -> "HBA".
function compLabel(label, copies, uni) {
  if (!label) return ''
  const [acc, suf] = String(label).split('-')
  const gene = (uni && uni[acc] && uni[acc].gene) || acc
  return (copies.get(acc)?.size || 1) > 1 ? `${gene}·${suf}` : gene
}

// Complex composition string from the copy catalogue, e.g. "HBA₂HBB₂" (generic, no domain lookup).
function stoichiometry(copies, uni) {
  const gene = (acc) => (uni && uni[acc] && uni[acc].gene) || acc
  return [...copies.entries()]
    .sort((a, b) => gene(a[0]).localeCompare(gene(b[0])))
    .map(([acc, set]) => `${gene(acc)}${set.size > 1 ? toSub(set.size) : ''}`)
    .join('')
}

// Function blurb: show a preview up to `limit` chars (cut on a word boundary) with an inline
// more/less toggle to reveal the full text.
function UniFunction({ text, limit = 70 }) {
  const [open, setOpen] = useState(false)
  if (!text) return null
  if (text.length <= limit) return <div className="uni-func">{text}</div>
  let cut = text.slice(0, limit)
  const sp = cut.lastIndexOf(' ')
  if (sp > limit * 0.5) cut = cut.slice(0, sp)
  return (
    <div className="uni-func">
      {open ? `${text} ` : `${cut}… `}
      <button className="uni-more" onClick={() => setOpen(!open)}>{open ? 'less' : 'more'}</button>
    </div>
  )
}

// Sortable columns of the instances table. Nulls sort last under the column's default direction.
const INST_CMP = {
  experimental_method: (a, b) => (a.experimental_method || '').localeCompare(b.experimental_method || ''),
  resolution: (a, b) => (a.resolution ?? Infinity) - (b.resolution ?? Infinity),
  interface_area: (a, b) => (a.interface_area ?? -Infinity) - (b.interface_area ?? -Infinity),
}
const INST_DEFAULT_DIR = { experimental_method: 'asc', resolution: 'asc', interface_area: 'desc' }

export default function ComplexInterfaceApp({ config = {} }) {
  // Everything else (complex id, organism, stoichiometry, component labels) is derived from the data,
  // so pointing this at another complex only needs a different basePath.
  const { basePath = 'hemoglobin', title = 'Aggregated Interface View' } = config
  const [data, setData] = useState(null)
  const [selAgg, setSelAgg] = useState(null)
  const [selInst, setSelInst] = useState(null)
  const [highlight, setHighlight] = useState(null)  // residue clicked in the Sankey -> highlight in 3D
  const [filter, setFilter] = useState('')
  const [instFilter, setInstFilter] = useState('')
  const [resMin, setResMin] = useState('')
  const [resMax, setResMax] = useState('')
  const [instSort, setInstSort] = useState({ key: 'interface_area', dir: 'desc' })
  const toggleInst = (key) => setInstSort((prev) =>
    prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: INST_DEFAULT_DIR[key] })

  useEffect(() => {
    Promise.all([load(basePath, 'aggregated_interface'), load(basePath, 'interface'),
      load(basePath, 'interface_contacts'), load(basePath, 'complex_chain_class'),
      load(basePath, 'uniprot_summary')])
      .then(([agg, iface, contacts, classes, uni]) => {
        setData({ agg, iface, contacts, classes, uni })
        setSelAgg(agg[0]?.agg_interface_id)
      })
  }, [basePath])

  // all hooks must run unconditionally (data may be null on first render)
  const instances = useMemo(() => !data ? [] : data.iface.filter((i) => i.agg_interface_id === selAgg)
    .sort((a, b) => (b.interface_area || 0) - (a.interface_area || 0)), [data, selAgg])
  const instance = instances.find((i) => i.interface_instance_id === selInst) || instances[0]

  // Table display order (default = BSA desc, matching `instances`); does not affect default selection.
  const shownInstances = useMemo(() => {
    const s = instSort.dir === 'asc' ? 1 : -1
    return [...instances].sort((a, b) => s * INST_CMP[instSort.key](a, b))
  }, [instances, instSort])

  const instContacts = useMemo(() => (data && instance)
    ? data.contacts.filter((c) => c.interface_instance_id === instance.interface_instance_id) : [], [data, instance])

  // Feed the shared spike Sankey: chain-1 residues take the "antigen" (left) slot, chain-2 the
  // "antibody" (right) slot. Both are proteins here, so the right side is coloured by residue class.
  const sankeyRows = useMemo(() => instContacts.map((c) => ({
    antigen_chain_id: c.asym_id_1, antigen_residue_author_number: c.auth_residue_number_1,
    antigen_residue_name: bareRes(c.residue_1), antigen_uniprot_position: c.unp_num_1,
    antibody_chain_id: c.asym_id_2, antibody_residue_author_number: c.auth_residue_number_2,
    antibody_residue_name: bareRes(c.residue_2), antibody_imgt_position: null, antibody_imgt_region: null,
    antibody_residue_author_insertion_code: '',
    bond_count: 1, interaction_types: c.bond_type ? { [c.bond_type]: 1 } : {},
  })), [instContacts])

  // Interface residues for the 3D viewer (author chain + author residue number + hover/short labels
  // in UniProt numbering, matching the spike viewer's read).
  const iface = useMemo(() => {
    const ag = new Map(), ab = new Map()
    for (const c of instContacts) {
      ag.set(`${c.asym_id_1}|${c.auth_residue_number_1}`, {
        chain: c.asym_id_1, resi: c.auth_residue_number_1,
        label: `${c.asym_id_1}:${bareRes(c.residue_1)}${c.unp_num_1 ?? c.auth_residue_number_1} (UNP)`,
        short: `${c.asym_id_1}:${one(bareRes(c.residue_1))}${c.unp_num_1 ?? c.auth_residue_number_1}`,
      })
      ab.set(`${c.asym_id_2}|${c.auth_residue_number_2}`, {
        chain: c.asym_id_2, resi: c.auth_residue_number_2,
        label: `${c.asym_id_2}:${bareRes(c.residue_2)}${c.unp_num_2 ?? c.auth_residue_number_2} (UNP)`,
        short: `${c.asym_id_2}:${one(bareRes(c.residue_2))}${c.unp_num_2 ?? c.auth_residue_number_2}`,
      })
    }
    return { ag: [...ag.values()], ab: [...ab.values()] }
  }, [instContacts])

  // Contact lines for the 3D overlay. Specific bonds: one line per atom–atom contact. vdW ("other"):
  // collapse to one (shortest) line per residue pair so packing contacts don't become a hairball.
  const viewerContacts = useMemo(() => {
    const specific = [], vdwByPair = new Map()
    for (const c of instContacts) {
      if (!c.atom_id_1 || !c.atom_id_2) continue
      const rec = { chain1: c.asym_id_1, resi1: c.auth_residue_number_1, atom1: c.atom_id_1, res1: c.residue_1,
        chain2: c.asym_id_2, resi2: c.auth_residue_number_2, atom2: c.atom_id_2, res2: c.residue_2,
        type: c.bond_type, distance: c.distance }
      if (c.bond_type === 'other_bond') {
        const k = `${c.asym_id_1}:${c.auth_residue_number_1}-${c.asym_id_2}:${c.auth_residue_number_2}`
        const cur = vdwByPair.get(k)
        if (!cur || (c.distance ?? 1e9) < (cur.distance ?? 1e9)) vdwByPair.set(k, rec)
      } else specific.push(rec)
    }
    return { specific, vdw: [...vdwByPair.values()] }
  }, [instContacts])

  // Aggregate residue–residue contacts across ALL instances of the selected interface group:
  // frequency = number of instances containing the (chain-1 residue, chain-2 residue) pair.
  const pairAgg = useMemo(() => {
    if (!data) return []
    const m = new Map()
    for (const c of data.contacts) {
      if (c.agg_interface_id !== selAgg) continue
      const k = `${c.unp_num_1}|${c.unp_num_2}`
      if (!m.has(k)) m.set(k, { pos1: c.unp_num_1, res1: bareRes(c.residue_1),
        pos2: c.unp_num_2, res2: bareRes(c.residue_2), insts: new Set(), bonds: new Set() })
      const e = m.get(k)
      e.insts.add(c.interface_instance_id)
      if (c.bond_type) e.bonds.add(c.bond_type)
    }
    return [...m.values()].map((e) => ({ pos1: e.pos1, res1: e.res1, pos2: e.pos2, res2: e.res2,
      freq: e.insts.size, bonds: [...e.bonds] }))
  }, [data, selAgg])

  if (!data) return <div className="wrap">Loading…</div>

  const agg = data.agg
  // Derived, data-driven complex identity + generic component labeller.
  const copies = componentCopies(agg)
  const lab = (l) => compLabel(l, copies, data.uni)
  const complexId = agg[0]?.pdb_complex_id
  const organisms = [...new Set([...copies.keys()].map((acc) => data.uni?.[acc]?.organism).filter(Boolean))]
  const stoich = stoichiometry(copies, data.uni)
  const aggShown = agg.filter((a) => {
    const q = filter.toLowerCase()
    if (!q) return true
    // Match on raw label (accession + copy id), gene, and the display label, so the query works
    // whether the user types "P01958", "HBA", or "HBA·1".
    const hay = [a.agg_interface_id, a.component_label_1, a.component_label_2,
      lab(a.component_label_1), lab(a.component_label_2)].join(' ').toLowerCase()
    return hay.includes(q)
  })
  const current = agg.find((a) => a.agg_interface_id === selAgg)

  // Click-to-sort header for the instances table.
  const SortTh = ({ label, k, className }) => {
    const active = instSort.key === k
    return (
      <th className={(className ? className + ' ' : '') + 'th-sort' + (active ? ' sorted' : '')}
          onClick={() => toggleInst(k)} title={`Sort by ${label}`}>
        <span className="th-inner">{label}<SortIcon dir={active ? instSort.dir : null} /></span>
      </th>
    )
  }

  const compColors = buildCompColors([...new Set(agg.flatMap((a) => [a.component_label_1, a.component_label_2]))])
  const Chip = (label) => {
    const c = compColors[label] || '#888'
    const acc = label.split('-')[0]
    return (
      <span className="comp-chip" style={{ '--cc': c, '--chip-bg': c + '22', '--chip-bd': c + '66' }}>
        <span className="comp-dot" />
        <span className="comp-gene">{lab(label)}</span>
        <span className="comp-acc">{acc}</span>
      </span>
    )
  }

  const pickAgg = (id) => { setSelAgg(id); setSelInst(null); setHighlight(null) }
  const selectInstance = (id) => { setSelInst(id); setHighlight(null) }

  // Instances-table filter: PDB id or experimental method, plus an optional resolution range (Å).
  const instMethods = [...new Set(instances.map((i) => i.experimental_method).filter(Boolean))].sort()
  const instQ = instFilter.trim().toLowerCase()
  const instRows = shownInstances.filter((i) => {
    if (instQ && !`${i.entry_id || ''} ${i.experimental_method || ''}`.toLowerCase().includes(instQ)) return false
    if (resMin !== '' && !(i.resolution != null && i.resolution >= +resMin)) return false
    if (resMax !== '' && !(i.resolution != null && i.resolution <= +resMax)) return false
    return true
  })
  const instFiltered = instQ !== '' || resMin !== '' || resMax !== ''
  const clearInstFilters = () => { setInstFilter(''); setResMin(''); setResMax('') }

  return (
    <div className="wrap">
      <div className="page-head">
        <h1>{title}</h1>
        {complexId && <span className="complex-id">{complexId}</span>}
      </div>
      <p className="subtitle">
        {organisms.length > 0 && <><i>{organisms.join(', ')}</i> · </>}
        {stoich && <>{stoich} · </>}
        equivalent interfaces grouped across deposited assemblies</p>

      {/* UniProt summary for the two components of the currently selected interface pair. */}
      {current && (
        <div className="uni-summary">
          {[...new Set([current.component_label_1, current.component_label_2].map((l) => l.split('-')[0]))].map((acc) => {
            const u = (data.uni && data.uni[acc]) || {}
            const copies = [current.component_label_1, current.component_label_2].filter((l) => l.split('-')[0] === acc)
            return (
              <div key={acc} className="uni-card">
                <div className="uni-head">
                  {copies.map((c) => <React.Fragment key={c}>{Chip(c)}</React.Fragment>)}
                  <a className="uni-acc" href={`https://www.uniprot.org/uniprotkb/${acc}`} target="_blank" rel="noreferrer">{acc}</a>
                </div>
                <div className="uni-name">{u.name || acc}{u.gene ? ` · ${u.gene}` : ''}</div>
                <div className="uni-meta"><i>{u.organism}</i>{u.length ? ` · ${u.length} amino acids` : ''}</div>
                <UniFunction text={u.function} />
              </div>
            )
          })}
        </div>
      )}

      {/* Section 1 — everything here is scoped to ONE deposited instance. */}
      <div className="section-band">
        <span className="section-num">1</span>
        <div>
          <h2 className="section-title">Explore one deposited structure</h2>
          <p className="section-sub">Pick an equivalent interface, then a deposited instance, to view its 3D
            structure and residue-level contacts. Everything in this section reflects the one selected instance.</p>
        </div>
      </div>

      <div className="ex-row ex-row1">
        {/* Row 1, Col 1 — interface selector */}
        <div className="card ex-cell">
          <h2>Interface selection</h2>
          <p className="note">Each card represents an equivalent interface between two component copies. Select a
            card to explore the deposited instances of that interface. Cards are ranked by median buried surface
            area (BSA).</p>
          <input className="filter-input" placeholder="Filter by gene, accession, or copy…"
            value={filter} onChange={(e) => setFilter(e.target.value)}
            style={{ width: '100%', padding: '6px 8px', marginBottom: 8, boxSizing: 'border-box' }} />
          <div className="selcards" style={{ maxHeight: 440, overflow: 'auto' }}>
            {aggShown.map((a) => (
              <div key={a.agg_interface_id} className={'selcard' + (selAgg === a.agg_interface_id ? ' active' : '')}
                   onClick={() => pickAgg(a.agg_interface_id)} style={{ '--acc': '#c65a5a', cursor: 'pointer' }}>
                <div className="hemo-chips">
                  {Chip(a.component_label_1)}<span className="chip-x">↔</span>{Chip(a.component_label_2)}
                </div>
                <div className="selcard-stats">
                  <div><div className="v">{a.instance_count}</div><div className="k">deposited instances</div></div>
                  <div><div className="v">{a.median_bsa != null ? Math.round(a.median_bsa) : '—'}</div><div className="k">median BSA (Å²)</div></div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Row 1, Col 2 — 3Dmol viewer of the selected instance */}
        <div className="card ex-cell">
          <h2>3D view of selected interface</h2>
          {instance && <p className="note" style={{ marginTop: 0 }}>{instance.entry_id} assembly {instance.assembly_id},
            interface {instance.interface_id} · {lab(current?.component_label_1)} ↔ {lab(current?.component_label_2)}</p>}
          <div className="legend" style={{ marginTop: 0 }}>
            <span className="dot" style={{ background: '#4b7fcc' }} /> {lab(current?.component_label_1)}
            <span className="dot" style={{ background: '#e19039' }} /> {lab(current?.component_label_2)}
          </div>
          {instance
            ? <Viewer3Dmol cifUrl={`${BASE}hemoglobin/cif/${instance.entry_id}_${instance.assembly_id}.cif`}
                agResidues={iface.ag} abResidues={iface.ab} contacts={viewerContacts}
                highlight={highlight} onClearHighlight={() => setHighlight(null)} height={480} />
            : <p className="note">No instance selected.</p>}
        </div>
      </div>

      <div className="ex-row ex-row2">
        {/* Row 2, Col 1 — instances table */}
        <div className="card ex-cell">
          <h2>Interface instances <span className="h2-sub">· {lab(current?.component_label_1)} ↔ {lab(current?.component_label_2)}</span></h2>
          <p className="note">This table lists the deposited structure instances of the selected equivalent
            interface. Resolution refers to the deposited structure resolution. Rows are sorted by buried
            surface area (BSA), largest first; click the Method, Resolution or BSA header to re-sort. Filter by
            PDB ID, method or a resolution range. Click a row to update the 3D view and plots.</p>
          <div className="inst-filter">
            <input className="filter-input inst-filter-text" list="inst-methods" value={instFilter}
              placeholder="Filter by PDB ID or method…" onChange={(e) => setInstFilter(e.target.value)} />
            <datalist id="inst-methods">{instMethods.map((m) => <option key={m} value={m} />)}</datalist>
            <span className="inst-filter-res">Resolution
              <input type="number" step="0.1" min="0" className="filter-input res-in" placeholder="min"
                value={resMin} onChange={(e) => setResMin(e.target.value)} />–
              <input type="number" step="0.1" min="0" className="filter-input res-in" placeholder="max"
                value={resMax} onChange={(e) => setResMax(e.target.value)} />Å</span>
            {instFiltered && <button className="cm-filter-clear" onClick={clearInstFilters}>clear</button>}
          </div>
          <div className="table-scroll ex-scroll">
            <table>
              <thead>
                <tr><th>Instance <Hint text="Instance ID format: <pdb_id>_<assembly_id>_<interface_id> (e.g. 6r2o_1_1)." /></th><th>PDB ID</th>
                  <SortTh label="Method" k="experimental_method" />
                  <SortTh label="Resolution (Å)" k="resolution" className="num" />
                  <th>Chain 1</th><th>Chain 2</th>
                  <SortTh label="BSA (Å²)" k="interface_area" className="num" /></tr>
              </thead>
              <tbody>
                {instRows.map((i) => (
                  <tr key={i.interface_instance_id}
                      className={'selrow' + (instance && i.interface_instance_id === instance.interface_instance_id ? ' sel' : '')}
                      onClick={() => selectInstance(i.interface_instance_id)}>
                    <td><code>{i.interface_instance_id}</code></td>
                    <td><a href={`https://www.ebi.ac.uk/pdbe/entry/pdb/${i.entry_id}`} target="_blank" rel="noreferrer"
                           onClick={(e) => e.stopPropagation()}>{i.entry_id}</a></td>
                    <td><span title={i.experimental_method || ''}>{(i.experimental_method || '').replace('X-ray diffraction', 'X-ray')}</span></td>
                    <td className="num">{i.resolution ?? '—'}</td>
                    <td>{i.asym_id_1}</td><td>{i.asym_id_2}</td>
                    <td className="num">{i.interface_area != null ? Math.round(i.interface_area) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {instFiltered && !instRows.length && <p className="note" style={{ padding: '10px 2px 0' }}>No instances match these filters.</p>}
          </div>
        </div>

        {/* Row 2, Col 2 — Sankey for the selected instance */}
        <div className="card ex-cell">
          <h2>Residue–residue contacts{instance && <span className="h2-sub"> · {instance.entry_id} assembly {instance.assembly_id}, interface {instance.interface_id}</span>}</h2>
          <p className="note">For the selected instance: residues from the first component are shown on the left
            and residues from the second component on the right. Residue labels use UniProt numbering. Click a
            residue to highlight it here and in the 3D view.</p>
          <div className="sankey-scroll">
            <SankeyContacts rows={sankeyRows} onNodeClick={setHighlight} selected={highlight} rightColorBy="aaclass"
              leftLabel={lab(current?.component_label_1)} rightLabel={lab(current?.component_label_2)} />
          </div>
        </div>
      </div>

      {/* Section 2 — everything here is aggregated across ALL deposited instances of this interface. */}
      <div className="section-band">
        <span className="section-num">2</span>
        <div>
          <h2 className="section-title">Conservation across all {current?.instance_count} deposited structures</h2>
          <p className="section-sub">How consistently each residue–residue contact and interface property recurs
            across every deposited instance of this interface — independent of the single instance shown above.</p>
        </div>
      </div>

      {/* Row 3 — aggregated residue–residue contacts: frequency table + residue×residue contact map. */}
      <div className="ex-row cm-row">
        <div className="card ex-cell">
          <h2>Contact pair frequency <span className="h2-sub">· {lab(current?.component_label_1)} ↔ {lab(current?.component_label_2)}</span></h2>
          <p className="note">Residue–residue contacts are aggregated across deposited instances of the selected
            equivalent interface. Frequency indicates how often each residue pair is observed in contact. Contact
            types are listed strongest first; use the filter to show only pairs with a given interaction type.</p>
          <ContactPairTable pairs={pairAgg} total={current?.instance_count}
            leftLabel={lab(current?.component_label_1)} rightLabel={lab(current?.component_label_2)} />
        </div>
        <div className="card ex-cell">
          <h2>Contact frequency map <span className="h2-sub">· {lab(current?.component_label_1)} × {lab(current?.component_label_2)}</span></h2>
          <p className="note">Each cell represents a residue–residue contact between the selected component copies.
            Colour intensity indicates how often the contact is observed across deposited instances. Hover for
            contact details.</p>
          <ContactMap pairs={pairAgg} total={current?.instance_count}
            leftLabel={lab(current?.component_label_1)} rightLabel={lab(current?.component_label_2)} />
        </div>
      </div>

      {/* Row 4 — where the selected instance sits among its peers on each PISA property. */}
      <div className="ex-row">
        <InterfacePropertyDistributions instances={instances} selected={instance} props={PISA_PROPS}
          populationLabel={`deposited instances of the ${lab(current?.component_label_1)} ↔ ${lab(current?.component_label_2)} equivalent interface`}
          note={(
            <p className="note">PISA-derived properties are shown for the selected interface instance relative to
              other deposited instances of the same equivalent interface. The selected instance is highlighted.
              Discrete contact counts are shown as individual values; continuous properties such as energies and
              areas are shown as binned distributions.</p>
          )} />
      </div>
    </div>
  )
}
