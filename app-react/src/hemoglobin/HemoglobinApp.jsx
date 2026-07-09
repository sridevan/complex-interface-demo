import React, { useEffect, useMemo, useState } from 'react'
import Viewer3Dmol from '../components/Viewer3Dmol.jsx'
import SankeyContacts from '../components/SankeyContacts.jsx'
import InterfacePropertyDistributions from '../components/InterfacePropertyDistributions.jsx'
import ContactPairTable from './ContactPairTable.jsx'
import ContactMap from './ContactMap.jsx'
import '../styles.css'

// PISA per-interface properties to profile (generic wording — both partners are protein chains).
const HEMO_PROPS = [
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
    desc: 'Other close contacts (not H-bond, salt bridge, disulfide or covalent) across the selected interface (PISA) — the bulk of interface atom contacts.' },
  { key: 'number_disulfide_bonds', label: 'Disulfide bonds', unit: '', digits: 0, discrete: true,
    desc: 'Disulfide bonds across the selected interface (PISA); rare.' },
  { key: 'number_covalent_bonds', label: 'Covalent bonds', unit: '', digits: 0, discrete: true,
    desc: 'Covalent bonds across the selected interface (PISA); rare.' },
]

const BASE = import.meta.env.BASE_URL || '/'
const load = (n) => fetch(`${BASE}hemoglobin/${n}.json`).then((r) => r.json())
const uniq = (a) => [...new Set(a)]

const AA3TO1 = {
  ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C', GLU: 'E', GLN: 'Q', GLY: 'G', HIS: 'H',
  ILE: 'I', LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F', PRO: 'P', SER: 'S', THR: 'T', TRP: 'W',
  TYR: 'Y', VAL: 'V', MSE: 'M', SEC: 'U', PYL: 'O',
}
const one = (resn) => AA3TO1[resn] || 'X'
// contact records store residue_1/2 as "<resname><num>" (e.g. "ARG32"); recover the bare 3-letter code.
const bareRes = (s) => String(s || '').replace(/\d+$/, '')

// Component chips are coloured by accession family (each UniProt accession gets a hue family; the
// copy suffix -1/-2 picks a shade), so α1/α2 read as related blues and β1/β2 as related warms.
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

export default function HemoglobinApp() {
  const [data, setData] = useState(null)
  const [selAgg, setSelAgg] = useState(null)
  const [selInst, setSelInst] = useState(null)
  const [highlight, setHighlight] = useState(null)  // residue clicked in the Sankey -> highlight in 3D
  const [selPair, setSelPair] = useState(null)      // contact pair selected in the table / map
  const [filter, setFilter] = useState('')

  useEffect(() => {
    Promise.all([load('aggregated_interface'), load('interface'), load('interface_contacts'),
      load('complex_chain_class'), load('uniprot_summary')])
      .then(([agg, iface, contacts, classes, uni]) => {
        setData({ agg, iface, contacts, classes, uni })
        setSelAgg(agg[0]?.agg_interface_id)
      })
  }, [])

  // all hooks must run unconditionally (data may be null on first render)
  const instances = useMemo(() => !data ? [] : data.iface.filter((i) => i.agg_interface_id === selAgg)
    .sort((a, b) => (b.interface_area || 0) - (a.interface_area || 0)), [data, selAgg])
  const instance = instances.find((i) => i.interface_instance_id === selInst) || instances[0]

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
  const aggShown = agg.filter((a) => {
    const q = filter.toLowerCase()
    return !q || a.agg_interface_id.toLowerCase().includes(q) ||
      a.component_label_1.toLowerCase().includes(q) || a.component_label_2.toLowerCase().includes(q)
  })
  const current = agg.find((a) => a.agg_interface_id === selAgg)

  const compColors = buildCompColors([...new Set(agg.flatMap((a) => [a.component_label_1, a.component_label_2]))])
  const Chip = (label) => {
    const c = compColors[label] || '#888'
    const gene = data.uni && data.uni[label.split('-')[0]] && data.uni[label.split('-')[0]].gene
    return (
      <span className="comp-chip" style={{ '--cc': c, '--chip-bg': c + '22', '--chip-bd': c + '66' }}>
        <span className="comp-dot" />
        <span className="comp-gene">{gene || label}</span>
        {gene && <span className="comp-acc">{label}</span>}
      </span>
    )
  }

  const pickAgg = (id) => { setSelAgg(id); setSelInst(null); setHighlight(null); setSelPair(null) }
  const selectInstance = (id) => { setSelInst(id); setHighlight(null) }
  // Selecting a contact pair (table row or map cell): mark it and highlight its chain-1 residue in 3D.
  const onSelectPair = (p) => {
    setSelPair(`${p.pos1}|${p.pos2}`)
    const m = instContacts.find((c) => c.unp_num_1 === p.pos1 && c.unp_num_2 === p.pos2)
      || instContacts.find((c) => c.unp_num_1 === p.pos1)
    if (m) setHighlight({ chain: m.asym_id_1, resi: m.auth_residue_number_1 })
  }

  return (
    <div className="wrap">
      <h1>Aggregated interfaces — Hemoglobin</h1>
      <p className="subtitle">PDB-CPX-131443 · <i>Equus caballus</i> · α₂β₂ · interfaces grouped by equivalent
        chain-class pairs across {uniq(data.iface.map((i) => `${i.entry_id}_${i.assembly_id}`)).length} assemblies</p>

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
                <div className="uni-meta"><i>{u.organism}</i>{u.length ? ` · ${u.length} aa` : ''}</div>
                <UniFunction text={u.function} />
              </div>
            )
          })}
        </div>
      )}

      <div className="ex-row ex-row1">
        {/* Row 1, Col 1 — interface selector */}
        <div className="card ex-cell">
          <h2>Interface selection</h2>
          <p className="note">Each card is a chain-class pair (UniProt accession + copy suffix). Select one to
            explore its instances. Cards are sorted by median buried surface area (BSA).</p>
          <input className="filter-input" placeholder="Filter by component / ID…"
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
                  <div><div className="v">{a.instance_count}</div><div className="k">instances</div></div>
                  <div><div className="v">{a.median_bsa != null ? Math.round(a.median_bsa) : '—'}</div><div className="k">median BSA (Å²)</div></div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Row 1, Col 2 — 3Dmol viewer of the selected instance */}
        <div className="card ex-cell">
          <h2>Interface 3D visualisation{instance ? ` (${instance.entry_id} interface ${instance.interface_id})` : ''}</h2>
          <div className="legend" style={{ marginTop: 0 }}>
            <span className="dot" style={{ background: '#4b7fcc' }} /> {current?.component_label_1}
            <span className="dot" style={{ background: '#e19039' }} /> {current?.component_label_2} · assembly served locally
          </div>
          {instance
            ? <Viewer3Dmol cifUrl={`${BASE}hemoglobin/cif/${instance.entry_id}_${instance.assembly_id}.cif`}
                agResidues={iface.ag} abResidues={iface.ab}
                highlight={highlight} onClearHighlight={() => setHighlight(null)} height={480} />
            : <p className="note">No instance selected.</p>}
        </div>
      </div>

      <div className="ex-row ex-row2">
        {/* Row 2, Col 1 — instances table */}
        <div className="card ex-cell">
          <h2>Interface instances <span className="h2-sub">· {current?.component_label_1} ↔ {current?.component_label_2} ({instances.length})</span></h2>
          <p className="note">All deposited instances of the selected chain-class pair. Instance ID is
            <code> entry_assembly_interface</code>. Resolution is the deposited structure resolution (method on
            hover). Sorted by BSA, largest first; click a row to inspect it above.</p>
          <div className="table-scroll ex-scroll">
            <table>
              <thead>
                <tr><th>Instance</th><th>Entry</th><th className="num">Asm</th><th>Method</th>
                  <th className="num">Res. (Å)</th><th>Chain 1</th><th>Chain 2</th><th className="num">BSA (Å²)</th></tr>
              </thead>
              <tbody>
                {instances.map((i) => (
                  <tr key={i.interface_instance_id}
                      className={'selrow' + (instance && i.interface_instance_id === instance.interface_instance_id ? ' sel' : '')}
                      onClick={() => selectInstance(i.interface_instance_id)}>
                    <td><a href={`https://www.ebi.ac.uk/pdbe/entry/pdb/${i.entry_id}`} target="_blank" rel="noreferrer"
                           onClick={(e) => e.stopPropagation()}><code>{i.interface_instance_id}</code></a></td>
                    <td>{i.entry_id}</td><td className="num">{i.assembly_id}</td>
                    <td><span title={i.experimental_method || ''}>{(i.experimental_method || '').replace('X-ray diffraction', 'X-ray')}</span></td>
                    <td className="num">{i.resolution ?? '—'}</td>
                    <td>{i.asym_id_1}</td><td>{i.asym_id_2}</td>
                    <td className="num">{i.interface_area != null ? Math.round(i.interface_area) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Row 2, Col 2 — Sankey for the selected instance */}
        <div className="card ex-cell">
          <h2>Residue–residue contacts{instance ? ` (${instance.entry_id} interface ${instance.interface_id})` : ''}
            {instance && <span className="h2-sub"> · {instContacts.length} contacts</span>}</h2>
          <p className="note"><b>{current?.component_label_1}</b> on the left, <b>{current?.component_label_2}</b> on
            the right, for the selected interface (UniProt numbering). <b>Click a node to highlight it in 3D.</b></p>
          <div className="sankey-scroll">
            <SankeyContacts rows={sankeyRows} onNodeClick={setHighlight} rightColorBy="aaclass"
              leftLabel={current?.component_label_1} rightLabel={current?.component_label_2} />
          </div>
        </div>
      </div>

      {/* Row 3 — aggregated residue–residue contacts: frequency table + residue×residue contact map. */}
      <div className="ex-row cm-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="card ex-cell">
          <h2>Contact pair frequency <span className="h2-sub">· {current?.component_label_1} ↔ {current?.component_label_2}</span></h2>
          <p className="note">Residue–residue contacts aggregated across the {current?.instance_count} instances of
            this interface group; frequency = number of instances in which the pair contacts (UniProt numbering).
            Click a row to highlight it in 3D and on the map.</p>
          <ContactPairTable pairs={pairAgg} total={current?.instance_count}
            leftLabel={current?.component_label_1} rightLabel={current?.component_label_2}
            selected={selPair} onSelect={onSelectPair} />
        </div>
        <div className="card ex-cell">
          <h2>Contact map <span className="h2-sub">· {current?.component_label_1} (rows) × {current?.component_label_2} (cols)</span></h2>
          <p className="note">Every contacting residue of <b>{current?.component_label_1}</b> against every contacting
            residue of <b>{current?.component_label_2}</b>. Cell shade / number = instances (of {current?.instance_count})
            with that residue–residue contact. Hover for bond types; click to highlight.</p>
          <ContactMap pairs={pairAgg} total={current?.instance_count}
            leftLabel={current?.component_label_1} rightLabel={current?.component_label_2}
            selected={selPair} onSelect={onSelectPair} />
        </div>
      </div>

      {/* Row 4 — where the selected instance sits among its peers on each PISA property. */}
      <div className="ex-row">
        <InterfacePropertyDistributions instances={instances} selected={instance} props={HEMO_PROPS}
          populationLabel={`instances of the ${current?.component_label_1} ↔ ${current?.component_label_2} interface group`}
          note={(
            <p className="note">PISA properties of the selected interface instance (highlighted in orange) against
              all {instances.length} instances of the <b>{current?.component_label_1} ↔ {current?.component_label_2}</b> interface
              group, with the selected instance highlighted. Small-range bond counts show one bar per value;
              energies, areas and wide ranges are binned.</p>
          )} />
      </div>
    </div>
  )
}
