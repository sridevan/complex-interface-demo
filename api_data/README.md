# Aggregated interface API — proposed contract

Two response shapes for the aggregated-interface view, with real data for **PDB-CPX-131443**
(horse haemoglobin) taken from the prototype at
`https://sridevan.github.io/complex-interface-demo/#hemoglobin`.

These files are **not mocks**. Every value is copied from the data the prototype serves
(`data/processed/PDB-CPX-131443/`), renamed where noted below, or derived by arithmetic over those
values. Regenerate with:

```
python3 scripts/build_api_data.py --complex PDB-CPX-131443
```

| file | endpoint | size |
|---|---|---|
| `aggregated_interfaces.json` | 1 — list for the complex | 6 KB |
| `aggregated_interface_AI_131443_0001_0003.json` | 2 — detail, α1–β1 | 1.1 MB |
| `aggregated_interface_AI_131443_0002_0004.json` | 2 — detail, α2–β2 | 1.2 MB |
| `aggregated_interface_AI_131443_0001_0004.json` | 2 — detail, α1–β2 | 626 KB |
| `aggregated_interface_AI_131443_0002_0003.json` | 2 — detail, α2–β1 | 614 KB |
| `aggregated_interface_AI_131443_0001_0002.json` | 2 — detail, α1–α2 | 307 KB |
| `aggregated_interface_AI_131443_0003_0004.json` | 2 — detail, β1–β2 | 136 KB |

---

## The four levels of information

Kept deliberately separate, because they have different cardinality and different lifetimes:

| level | lives in | for haemoglobin |
|---|---|---|
| **Complex** — the entity and its components | endpoint 1, `complex` | 1 complex, 4 component copies, 2 accessions |
| **Aggregated interface** — one pair of component copies | endpoint 1, `aggregated_interfaces[]`; echoed as identity in endpoint 2 | 6 |
| **Interface instance** — one interface in one deposited assembly | endpoint 2, `interface_instances[]` | 111 across the 6 |
| **Residue / atom interactions** | endpoint 2, `interface_instances[].contacts[]` (atom level) and `conserved_contacts[]` (aggregated) | 8,024 atom contacts |

---

**Keying.** Both responses are wrapped in an object whose single key is the complex id, matching how
PDBe keys entry responses by PDB id (and how the supplied PISA file is keyed by `6wps`). Note PDBe
usually wraps the body in a **list** — `{"1g0b": [ {...} ]}` — because an id can map to several
records. That does not apply here: one complex has one aggregated-interface list, and one aggregated
interface has one detail body, so a single-element list would be indirection for its own sake. If
the eventual API prefers strict house style, changing `{cx: {...}}` to `{cx: [{...}]}` is a one-line
change in the generator.

## Endpoint 1 — `GET /complex/{pdb_complex_id}/aggregated-interfaces`

Populates the left-hand **Interface selection** panel and the UniProt summary cards. Deliberately
lightweight: no residue-level data, so the page can render its chrome before any detail is fetched.

```jsonc
// Keyed by complex id at the top level, the way PDBe responses are keyed by entry id.
{ "PDB-CPX-131443": {

  // COMPLEX LEVEL — described once here, never repeated per interface.
  "complex": {
    "components": [{
      "chain_class_id": "CC_131443_0001",   // stable id for one component COPY
      "component_label": "P01958-1",        // accession + copy suffix, as used in PDBe-KB complexes
      "accession": "P01958",
      "accession_type": "UniProt",
      "copy_index": 1,                      // which copy of that accession
      "molecule_name": "Hemoglobin subunit alpha",
      "gene": "HBA",
      "organism": "Equus caballus",
      "sequence_length": 142,
      "function": "...",                    // UniProt function comment
      "subunit": "..."                      // UniProt subunit comment
    }],
    "component_count": 4,
    "distinct_accession_count": 2
  },

  // AGGREGATED INTERFACE LEVEL — one entry per unique pair of component copies.
  "aggregated_interface_count": 6,
  "aggregated_interfaces": [{
    "aggregated_interface_id": "AI_131443_0001_0003",   // stable; request key for endpoint 2
    "partner_1": { "chain_class_id": "CC_131443_0001", "component_label": "P01958-1",
                   "accession": "P01958", "copy_index": 1, "gene": "HBA" },
    "partner_2": { "chain_class_id": "CC_131443_0003", "component_label": "P02062-1",
                   "accession": "P02062", "copy_index": 1, "gene": "HBB" },
    "instance_count": 19,                 // deposited interfaces contributing
    "distinct_entry_count": 19,           // how many distinct PDB entries those come from
    "median_interface_area": 893.0        // Å², median over the instances; the panel ranks on this
  }]
}}
```

**Why `chain_class_id` on both partners.** It is what distinguishes aggregated interfaces that share
an accession pair. Haemoglobin has four P01958 ↔ P02062 interfaces: `AI_131443_0001_0003` (α1–β1) and
`AI_131443_0001_0004` (α1–β2) differ only in *which copy* of each component is involved, and they are
not equivalent — median BSA 893 Å² against 506 Å². Keying on accession alone would merge them.

`distinct_entry_count` is new (derived here, not in the prototype). It matters because `instance_count`
alone overstates independence when one entry contributes several assemblies; for haemoglobin the two
happen to be equal.

---

## Endpoint 2 — `GET /complex/{pdb_complex_id}/aggregated-interface/{aggregated_interface_id}`

Everything below the interface selection panel.

```jsonc
{ "PDB-CPX-131443": {

  "aggregated_interface_id": "AI_131443_0001_0003",
  // Identity plus the gene name, which is the label the UI shows. This response carries no
  // component list, so without the gene a detail response could not name its own partners.
  "partner_1": { "chain_class_id": "CC_131443_0001", "component_label": "P01958-1",
                 "accession": "P01958", "copy_index": 1, "gene": "HBA" },
  "partner_2": { "chain_class_id": "CC_131443_0003", "component_label": "P02062-1",
                 "accession": "P02062", "copy_index": 1, "gene": "HBB" },

  // Range and centre of every PISA property across the instances below, so the client need not
  // recompute them. `n` is how many instances carried a value: a summary over four means something
  // different from one over nineteen. `value_type` says whether the property is a measurement or a
  // count -- see the note under this block.
  "pisa_interface_property_summary": {
    "instance_count": 19,
    "distinct_entry_count": 19,
    "properties": {
      "interface_area":            { "value_type": "continuous", "min": 712.91, "max": 916.71, "median": 893.01, "n": 19 },
      "solvation_energy":          { "value_type": "continuous", "min": -11.37, "max": -7.33, "median": -9.53, "n": 19 },
      "stabilization_energy":      { "value_type": "continuous", "min": -14.93, "max": -11.66, "median": -12.78, "n": 19 },
      "p_value":                   { "value_type": "continuous", "min": 0.264, "max": 0.607, "median": 0.354, "n": 19 },
      "number_interface_residues": { "value_type": "count", "min": 132, "max": 146, "median": 146, "n": 19 },
      "number_hydrogen_bonds":     { "value_type": "count", "min": 5, "max": 9, "median": 7, "n": 19 },
      "number_salt_bridges":       { "value_type": "count", "min": 0, "max": 3, "median": 0, "n": 19 },
      "number_disulfide_bonds":    { "value_type": "count", "min": 0, "max": 0, "median": 0, "n": 19 },
      "number_covalent_bonds":     { "value_type": "count", "min": 0, "max": 0, "median": 0, "n": 19 },
      "number_other_bonds":        { "value_type": "count", "min": 86, "max": 208, "median": 109, "n": 19 }
    }
  },

  // INTERFACE INSTANCE LEVEL — one deposited interface each.
  "interface_instances": [{
    "interface_instance_id": "6r2o_1_1",   // stable: "<pdb_id>_<assembly_id>_<interface_id>"
    "pdb_id": "6r2o",
    "assembly_id": "1",
    "interface_id": "1",                   // PISA interface number WITHIN that assembly
    // The two chains forming this interface. Grouped so the identifiers do not sit loose among the
    // instance's own fields. Both namespaces per chain, read from PISA: a viewer selecting on the
    // wrong one fails silently.
    "interacting_chains": {
      "auth_asym_id_1": "A", "label_asym_id_1": "A",
      "chain_class_id_1": "CC_131443_0001",   // which component copy this chain realises
      "auth_asym_id_2": "B", "label_asym_id_2": "B",
      "chain_class_id_2": "CC_131443_0003"
    },
    "properties": {                         // PISA, per interface
      "interface_area": 916.71,             // Å²
      "solvation_energy": -8.31,            // kcal/mol (PISA ΔᵢG)
      "stabilization_energy": -12.09,       // kcal/mol
      "p_value": 0.357,                     // PISA interface specificity
      "number_interface_residues": 145,     // both chains
      "number_hydrogen_bonds": 6,
      "number_salt_bridges": 3,
      "number_disulfide_bonds": 0,
      "number_covalent_bonds": 0,
      "number_other_bonds": 118
    },

    // ATOM LEVEL — nested here, so a contact carries no instance id of its own.
    // One record per contacting ATOM PAIR, not per residue pair: a residue pair usually appears
    // several times. Side 1 is always this instance's chain 1.
    "contacts": [{
      "bond_type": "hydrogen_bond",         // hydrogen_bond | salt_bridge | other_bond
      "distance": 2.32,                     // Å
      "auth_asym_id_1": "A", "label_asym_id_1": "A",
      "auth_seq_id_1": 31,                  // author numbering — use to select in 3D
      "residue_name_1": "ARG",
      "unp_num_1": 32,                      // UniProt numbering — use to compare across entries
      "atom_id_1": "HH12",
      "auth_asym_id_2": "B", "label_asym_id_2": "B",
      "auth_seq_id_2": 122, "residue_name_2": "PHE", "unp_num_2": 122, "atom_id_2": "O"
    }]
  }],

  // RESIDUE LEVEL, aggregated across the instances above.
  "conserved_contacts": [{
    "unp_num_1": 32, "residue_name_1": "ARG",
    "unp_num_2": 122, "residue_name_2": "PHE",
    "observed_in_instances": 19,
    "frequency": 1.0,                       // observed_in_instances / instance_count
    "bond_types": ["hydrogen_bond", "other_bond"]
  }]
}}
```

**`value_type`, and why the median is taken differently for counts.** Four of the ten properties are
measurements on a continuous scale — `interface_area`, `solvation_energy`, `stabilization_energy`,
`p_value` — and take an ordinary median. The other six are counts, where an ordinary median over an
even number of instances returns a value no interface can have ("6.5 hydrogen bonds"); those use the
low median, so the reported figure is always one an interface actually has. On this complex the
distinction happens not to bite (every count median lands on an integer anyway, including the
18-instance α1–α2 interface), but it will on a set with even `n`.

`value_type` is also what the distribution panel should switch on: the prototype already plots counts
as individual values and continuous properties as binned distributions, and this field lets it do so
without hardcoding a list of property names.

**Why `min` and `max` as well as the median.** The selection panel needs one representative number,
but the distribution panel needs axis bounds, and a range is what shows whether an interface is
consistent across depositions or varies wildly — α1–α2 spans 59.6 to 392.0 Å², which a median of
293.3 alone would hide.

**Why the interaction records are flat.** Contacts and conserved contacts use `_1` / `_2` suffixes
rather than nested `partner_1` / `partner_2` objects, because that is what the upstream data already
uses (`asym_id_1`; PISA's `atom_site_1_*`) and what every consumer wants — the prototype's Sankey and
3D overlay both rebuild flat records immediately, so nesting only added a step. Size does not decide
it: measured at 2.42 MB nested against 2.38 MB flat. The same suffix rule is used for the instance's
own chain identifiers.

`partner_1` / `partner_2` stay nested at the aggregated-interface level, because those are component
*entities* with four fields and their own id, not a pair of scalars. An interface instance groups its
two chain identifiers under `interacting_chains` for the same reason a contact does not: four loose
`*_asym_id_*` keys among `pdb_id`, `assembly_id` and `interface_id` read as though they were all the
same kind of thing, whereas a contact record *is* nothing but a pair of atoms.

**Side 1 is always partner 1.** Verified across all 8,024 contacts: a contact's side 1 is its
instance's chain 1, which realises the aggregated interface's `partner_1`. The sides are never
swapped, so the left-hand column of the Sankey can be taken directly.

**Why `unp_num` keys the conserved contacts.** Author numbering differs between deposited
structures, so aggregating on it would split the same contact across entries. UniProt position is
the common frame. Author numbering is still carried per atom contact, because that is what the 3D
viewer needs to select a residue.

**Why `auth_seq_id` and `residue_name` are separate.** The prototype ships `residue_1: "LYS128"` —
name and number fused, with the number being the *UniProt* one — and strips the digits in the
browser on every render. The API separates them.

---

## Stable identifiers

| id | form | scope | joins |
|---|---|---|---|
| `pdb_complex_id` | `PDB-CPX-131443` | PDBe-KB | **the outer key of both responses**; path parameter |
| `chain_class_id` | `CC_131443_0001` | complex | `complex.components[]` ↔ endpoint-1 `partner_N` ↔ `interacting_chains.chain_class_id_N` |
| `aggregated_interface_id` | `AI_131443_0001_0003` | complex | endpoint 1 row → endpoint 2 path (the client constructs it; no link is returned) |
| `interface_instance_id` | `6r2o_1_1` | complex | identifies a row of `interface_instances[]`; its contacts are nested inside it |

`AI_<complex digits>_<chain_class 1>_<chain_class 2>` and
`<pdb_id>_<assembly_id>_<interface_id>` are both composite but **should be treated as opaque** by the
frontend; the parts are available as their own fields.

**`pdb_id` + `assembly_id` is not unique.** Every haemoglobin assembly here contributes six
interfaces — all 19 entries appear in all six aggregated interfaces — so `interface_id` is required
to identify an interface, and `interface_instance_id` is the key to use.

---

## Which frontend element consumes what

| UI element (prototype) | endpoint | fields |
|---|---|---|
| Page title, complex id link, organism | 1 | `pdb_complex_id`, `complex.components[].organism` |
| UniProt summary cards | 1 | `components[]`: `molecule_name`, `gene`, `organism`, `sequence_length`, `function`, `accession` |
| Component chips (colour, gene·copy label) | 1 or 2 | `partner_N.accession`, `.copy_index`, `.gene` — available on both endpoints |
| Complex stoichiometry string (`HBA₂HBB₂`) | 1 | derived client-side from `components[]` |
| **Interface selection** cards | 1 | `aggregated_interface_id`, both `partner_N`, `instance_count`, `median_interface_area` |
| Detail request on card click | 1 → 2 | client builds the path from `pdb_complex_id` + `aggregated_interface_id` |
| Card ordering (by median BSA) | 1 | `median_interface_area` — already sorted descending in the response |
| Selection-panel filter box | 1 | `aggregated_interface_id`, `component_label`, `accession`, `gene` |
| **Interface instances** table | 2 | `interface_instances[]`: `interface_instance_id`, `pdb_id`, `interacting_chains.auth_asym_id_1`, `.auth_asym_id_2`, `properties.interface_area` |
| Instances table — Method and Resolution columns | **not in either response** | see gap 1: must come from a PDBe entry call |
| Instances table filters (PDB id, method, resolution range) | 2 + entry call | `pdb_id` from endpoint 2; method and resolution from the entry call |
| **3D view** — coordinates to load | 2 | `pdb_id`, `assembly_id` (URL constructed client-side — see gaps) |
| **3D view** — residues to highlight | 2 | selected instance's `contacts[]`: `auth_asym_id_N`, `auth_seq_id_N`, `residue_name_N`, `unp_num_N` |
| **3D view** — contact lines | 2 | selected instance's `contacts[]`: `atom_id_N`, `bond_type`, `distance` |
| **Residue–residue contacts** (Sankey) | 2 | the selected instance's `contacts[]` — no filtering needed, they are already scoped |
| **Contact pair frequency** table | 2 | `conserved_contacts[]` + `summary.instance_count` |
| **Conserved contact map** | 2 | `conserved_contacts[]`: `unp_num_N`, `residue_name_N`, `frequency` |
| **Interface property distributions** | 2 | `interface_instances[].properties` (all ten keys), selected instance highlighted; axis bounds from `pisa_interface_property_summary.properties[k].min`/`.max` |
| Section-2 gate (needs ≥3 instances) | 1 or 2 | `instance_count` |

---

## Renames and removals from the prototype data

| prototype | proposed | why |
|---|---|---|
| `entry_id` | `pdb_id` | requested; matches PDBe usage |
| `agg_interface_id` | `aggregated_interface_id` | unabbreviated |
| `asym_id_1` / `asym_id_2` | `interacting_chains.{auth,label}_asym_id_N` on an instance; `{auth,label}_asym_id_N` on a contact | a single unnamed identifier could not tell a viewer which namespace it was in |
| `experimental_method`, `resolution`, `title` | *removed* | entry-level, not interface-level — see gap 1 |
| `median_bsa` | `median_interface_area` | matches the per-instance property name |
| `residue_1: "ARG32"` | `residue_name_N` + `unp_num_N` | fused name and number, split here |
| `auth_residue_number_N` | `auth_seq_id_N` | mmCIF term |
| `n_interface_residues` | *dropped* | exact duplicate of `number_interface_residues` in every record |
| `contact_summary` | *dropped from endpoint 1* | **unused by the prototype** (0 references) and residue-level, so it does not belong in a lightweight list response. Its aggregate role is served by `conserved_contacts` in endpoint 2, keyed on UniProt position rather than author label. |
| `pdb_complex_id` repeated on every row | the outer key of the response | removes ~110 copies per detail file |

---

## Gaps — must come from the eventual backend

Not invented here. Each is either absent from the prototype data or currently constructed client-side.

1. **Entry-level metadata is no longer in these responses.** `experimental_method`, `resolution` and
   `title` were removed from `interface_instances[]` as entry-level facts that do not belong on an
   interface record. The prototype's instances table shows Method and Resolution columns and filters
   on both, so the frontend now needs a second call — `/pdb/entry/summary/{pdb_id}` returns all
   three, and 19 distinct entries back the 111 instances here, so it batches cheaply. **Decide
   whether the backend joins it in or the frontend fetches it.**
2. **Coordinate URL for the 3D view.** The prototype builds it from `pdb_id` + `assembly_id`. A
   `structure_url` (or an explicit assembly-file reference) per instance would remove that coupling.
3. **`label_asym_id` is PISA's, and for this complex equals the author id.** Both namespaces are now
   returned, read from PISA's `atom_site_N_chains` and `atom_site_N_label_asym_ids`. For horse
   haemoglobin they coincide on every one of the 111 instances (both `A`, `A-2`, `B`, `B-2`, …), so
   the fixture cannot demonstrate the case where they differ — the supplied 6wps file can (author
   `B` is label `D`). Note these are assembly-expanded identifiers: the `-2` suffix marks an
   operator-generated copy, so neither is the deposited-entry `label_asym_id` unchanged.
4. **Residue insertion codes.** PISA carries `inscodes`; the prototype's contacts do not. Required
   for unambiguous residue identity in structures that use them.
5. **Per-residue PISA values.** PISA's `molecules[].buried_surface_areas`, `solvation_energies` and
   `accessible_surface_areas` (per residue) are not in the prototype. They would support
   burial-shaded residue views, which the current page cannot draw.
6. **Assembly-level PISA properties** — `dissociation_energy`, `accessible_surface_area`,
   `buried_surface_area`, `entropy`, `formula`, `composition`. Present in the supplied
   `6wps_assembly1_interfaces.json`, absent here. Useful context for an interface's assembly.
7. **Symmetry operator** for operator-generated chains, so a copy can be traced to its transform.
8. **Entity ids.** No `entity_id` / `struct_asym_id` link from a chain to its mmCIF entity.
9. **Why an instance belongs to an aggregated interface.** The grouping is given, but no evidence
   field (sequence identity, mapping method) is exposed. Worth returning if the backend has it.
10. **Provenance and versions.** No PISA version, no PDBe release, no computation date. The supplied
   PISA file carries `pisa_version: "2.0"`; the API should carry the equivalent.
11. **`p_value` semantics.** Carried through unchanged; PISA's definition should be documented in the
    API reference rather than inferred.

---

## Notes for other complexes

- Nothing is haemoglobin-specific: components, copies and interfaces are all read from the data.
  A homodimer yields one aggregated interface with `copy_index` 1 and 2 of one accession; a complex
  with non-UniProt components would need `accession_type` to carry something other than `UniProt`.
- **Detail-response size scales with instances × contacts.** Haemoglobin's largest is 1.1 MB, of
  which ~95% is the nested `contacts` arrays. For a complex with hundreds of instances this will need either
  its own endpoint (`.../aggregated-interface/{id}/instances/{instance_id}/contacts`) or pagination.
  The prototype only ever renders contacts for **one selected instance** at a time, so splitting
  costs nothing in functionality. `conserved_contacts` is small (19–49 pairs here) and should stay.
- Endpoint 1 is safe to cache per complex; endpoint 2 per aggregated interface.

---

## `demo_distributions.html` — reference implementation

**One self-contained file. Open it directly in a browser** — no server, no build step, no
dependencies. Everything the frontend engineer needs to reproduce the prototype's distribution
charts is in ~740 readable lines.

The sample it carries is one real endpoint-2 response — aggregated interface
`AI_131443_0001_0004` (haemoglobin α1 ↔ β2) — trimmed to **8 of its 19 interface instances**,
chosen evenly across the buried-surface-area range so the real spread survives the trim. Two honest
consequences, both noted in the file:

- `pisa_interface_property_summary` is **recomputed over the 8**, not copied from the 19, so the
  axis ends match the bars actually drawn.
- each instance's `contacts` array is **omitted**: this page never touches them, and the real
  response nests them under every instance.

Swap `const RESPONSE = {...}` for a `fetch()` and nothing else changes.

**What it demonstrates, beyond drawing charts**

- **Responses are keyed by complex id** — `RESPONSE[COMPLEX]`, one line.
- **`value_type` drives the chart choice.** A `count` spanning 24 or less gets one bar per integer
  value; everything else is binned. The prototype hardcoded which properties were discrete; reading
  it from the API means that list cannot drift.
- **Axis ends come from `pisa_interface_property_summary`**, not from re-scanning the instances.
- **The dashed marker line earns its place.** An outlier selection produces a bar one or two pixels
  tall that is invisible without it.
- **Bar spacing carries meaning.** Binned bars touch, because bins are contiguous ranges; discrete
  bars are separated, because there is nothing between two integers. Without this the two chart
  types looked identical and a reader could not tell three ranges from three values.
- **Hover marks the column and names it.** One delegated listener on the document, not a handler per
  rect. Empty positions are hoverable only when binned, where the tooltip is the only place a bin's
  range appears; on a discrete chart an empty position is a value nobody observed, and the gap
  already says so.

### Three display rules, decided from the data

Measured over **77 aggregated interfaces across 4 complexes**, whose instance counts run 1 to 227
with a median of 13. 19 of the 77 have 2 instances or fewer.

**1. No distribution below 5 instances** (`MIN_INSTANCES_FOR_PLOT = 5`). At 4 or fewer the bin rule
gives 2 bins, which reads as a comparison rather than a distribution. The values are listed instead
— at n=3, `421, 506, 691 Å²` says everything a chart would and nothing it would not. 47 of the 77
interfaces clear this bar. The threshold applies to these plots only; the contact map and
pair-frequency table keep their own gate of 3, where a frequency of "2 of 3" is coarse but not
wrong in the way the statistics below were.

**2. Bin count follows the square-root rule**, `clamp(ceil(sqrt(n)), 1, 12)`, rather than a fixed
12. With 12 bins over a median of 13 values, most bins are empty and the chart shows gaps that are
an artefact of the binning rather than the data: on the 8-instance sample here, 6 of 12 bins were
empty and only 2 of those gaps were real. One rule covers n = 5 to n = 227 with no mode switch.

**3. No percentile.** It was removed rather than fixed. Computed as "share of instances at or below
the selected value", it reports **38%** of all displayed values as the 100th percentile, and **34%**
of everything displayed is a property where every instance holds the same value — disulfide bonds
are 0 in all 19 haemoglobin instances, so each one read "0, 100ᵗʰ pct" beside a chart correctly
saying "0 in all 19".

A percentage deviation from the median was tried as the replacement and is also wrong: it turns a
count of 6 against a median of 2 into "200% above median", and reports an energy of −3.6 against a
median of −4.0 as "above median" when it is the weaker interaction. What is shown instead is **the
median itself** beside the value — unit-free, sign-safe, correct for counts and measurements alike,
and it needs no threshold of its own. When every instance ties there is no comparison to make, so
the header shows the value alone and the chart area carries the statement — "0 in all 8 instances",
said once rather than in both places.

Percentile also needed n ≥ 10 to be defensible at all (10-point steps); dropping it removes that
constraint.

**Caveat on the numbers above**: 77 interfaces from 4 complexes, and the cluster at n=13 is largely
CCT, so the *shape* of that distribution is partly one complex's deposition history. The tiering is
sound regardless; the exact threshold of 5 is worth re-checking against a wider set of complexes.
