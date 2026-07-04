# Sample data notes — PISA interface JSON (spec §3a / §3b, verified against real 6wps)

These notes restate **spec §3a (confirmed PISA structure)** and **§3b (confirmed join key)**
as verified directly against the real `6wps_assembly1_interfaces.json` (988 KB / 1,009,186 bytes).
**The parser is written to this structure, not to assumptions.**

## Files here

- `6wps_assembly1_interfaces.sample.json` — a **trimmed slice** of the real file. Full top-level
  structure and all **12 interfaces** are preserved; each bond-group array is trimmed to a
  representative ~14 bonds per group (chosen to include the interesting cases below). 84
  antibody-side spurious-UniProt occurrences are deliberately retained so the anomaly logic can be
  developed/tested offline. Molecule `residue_*` arrays trimmed to 8 entries each.
- The full untrimmed file remains at repo root `6wps_assembly1_interfaces.json` for real runs.

## §3a — Confirmed top-level shape

```
{ "6wps": {                         # top-level key IS the lowercased PDB id
    "assembly_id": "1",             # NB: string
    "pisa_version": "...",
    "assembly": {
      mmsize, dissociation_energy, accessible_surface_area, buried_surface_area, entropy,
      dissociation_area, solvation_energy_gain, formula, composition,   # assembly summary
      "interface_count": 12,
      "interfaces": [ <interface> x12 ]        # the list to iterate
    }
} }
```

Each `<interface>` keys (verified):
`interface_id`(str), `interface_area`(float), `solvation_energy`, `stabilization_energy`,
`p_value`, `number_interface_residues`, `number_hydrogen_bonds`, `number_covalent_bonds`,
`number_disulfide_bonds`, `number_salt_bridges`, `number_other_bonds`,
`hydrogen_bonds`, `salt_bridges`, `disulfide_bonds`, `covalent_bonds`, `other_bonds` (bond groups),
`molecules` (list of exactly 2).

Each `<molecule>` keys (verified — **no UniProt at this level**):
`molecule_id`, `molecule_class`, `chain_id`(AUTHOR), `residue_label_comp_ids`, `residue_seq_ids`
(AUTHOR, str), `residue_label_seq_ids`(LABEL, str), `residue_ins_codes`, `residue_bonds`(mostly null),
`solvation_energies`, `accessible_surface_areas`, `buried_surface_areas`.

Each bond group (e.g. `hydrogen_bonds`) is a dict of **parallel arrays**, one entry per bond.
Verified keys (this is where UniProt lives):
```
bond_distances
atom_site_{1,2}_chains            # AUTHOR chain id
atom_site_{1,2}_residues          # residue name
atom_site_{1,2}_label_asym_ids    # LABEL chain id
atom_site_{1,2}_orig_label_asym_ids
atom_site_{1,2}_unp_accs          # UniProt accession (SPARSE; spurious on antibody — see warnings)
atom_site_{1,2}_unp_nums          # UniProt position (with the acc)
atom_site_{1,2}_seq_nums          # AUTHOR residue number (str)
atom_site_{1,2}_label_seq_ids     # LABEL residue number (str)
atom_site_{1,2}_label_atom_ids
atom_site_{1,2}_inscodes          # insertion code (all null in 6wps)
```

## The 12 interfaces in 6wps assembly 1 (verified categories)

| itf | author chains | area | category | keep? |
|----:|:--------------|-----:|:---------|:------|
| 1,2,3 | B–E, A–E, A–B | ~4530 | spike–spike trimer (both P0DTC2) | DROP |
| 4,5,6 | C–D, H–L, F–G | ~705  | intra-Fab heavy–light | DROP |
| 7,8,9 | E–F, A–H, B–C | ~630  | **spike ↔ antibody** | KEEP |
| 10,11,12 | E–G, B–D, A–L | ~166 | **spike ↔ antibody** | KEEP |

Chain roles (cross-checked against PDBe `entry/molecules/6wps`):
- **Antigen** (spike, P0DTC2): **A, B, E** — entity 1, 100% accession coverage.
- **Antibody heavy** (S309): **C, F, H** — entity 2, len 127.
- **Antibody light** (S309): **D, G, L** — entity 3, len 107.
- (This is a Fab, heavy+light — not a VHH.)

`other_bonds` dominates raw counts (499 vs 38 H-bonds in the trimer interfaces; 105 vs 6 in
spike–antibody) — hence spec's `contact_pairs` (dedupe to residue-pair) as the headline unit.

## CRITICAL warnings (verified — demo is wrong if ignored)

1. **Classify antigen/antibody BY CHAIN, never by per-bond `unp_accs`.** Antibody residues carry
   **spurious P0DTC2 tags** (author THR30→P0DTC2/11, THR32→P0DTC2/13, PRO45→P0DTC2/26,
   PHE98→P0DTC2/79), repeated across the 3 symmetry-related Fabs — 117 bond records in the full file.
   Coverage: antigen chains A/B/E = 100%; antibody chains = 0–25%. Use `unp_nums` only to read the
   antigen residue's UniProt position, and only on chains already known to be antigen.
2. **`unp_num` ≠ `seq_num`.** For 117 of 3781 spike bond-residues the UniProt position differs from
   the author number. Take `antigen_uniprot_position` from `atom_site_N_unp_nums`;
   `antigen_residue_author_number` from `atom_site_N_seq_nums`. Not interchangeable.
3. **Not all interfaces are antibody–antigen** (see table). Step 8 must drop trimer + intra-Fab.
4. **All strings.** Residue numbers / seq ids / interface ids are JSON strings — cast to int for
   numeric work; treat `null` inscodes as blank.
5. **Antibody author numbers are author/Kabat-style, not IMGT** (chain F: 28,30,31…100,103–111) —
   ANARCII renumbering required; author numbers are the join key onto ANARCII.

## §3b — Confirmed join key (author-based)

```
Antibody-side join (PISA bond side -> ANARCII mapping table):
  pdb_id
  assembly_id
  atom_site_N_chains         == auth_asym_id
  atom_site_N_seq_nums (int) == author_residue_number
  atom_site_N_inscodes       == author_insertion_code   (null -> blank)
```
Join on **author** ids (PISA exposes author per bond). Keep label ids for debugging + for MVS.

**MVS caveat:** MolViewSpec selectors use **LABEL** ids (`atom_site_N_label_asym_ids` /
`atom_site_N_label_seq_ids`), which differ from author (6wps spike author E = label G, +19 offset;
antibody author F = label H, no offset). Take label ids straight from the bond arrays — never derive
them from author numbers.
