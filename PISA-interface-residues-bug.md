# PISA `number_interface_residues` — suspected bug

_Prepared 2026-07-15._

## Summary

The PISA interface property **`number_interface_residues` does not report the number of interface residues.** Across **every** interface of the horse-haemoglobin complex, its value is exactly the residue-array length of the **second interacting molecule** (`molecules[1]`) — i.e. that chain's full length — independent of how many residues are actually at the interface.

- **Complex:** PDB-CPX-131443 (*Equus caballus* haemoglobin)
- **Scope checked:** 111 interfaces across 19 deposited structures (1g0b, 1ibe, 1iwh, 1ns6, 1ns9, 1y8h, 1y8i, 1y8k, 2d5x, 2dhb, 2mhb, 2zlt, 2zlu, 2zlv, 2zlw, 5c6e, 6r2o, 6sva, 8puq)
- **Source:** PISA per-assembly interface JSON `<pdb>_assembly1_interfaces.json` (PDBe PISA API / FTP `msd/pdb-assemblies-analysis/split`)
- **Field:** `interfaces[].number_interface_residues`

## Result

| Test | Result |
|---|---|
| `number_interface_residues` == `molecules[1]` residue count | **111 / 111 (100%)** |
| == true interface residues (`buried_surface_area > 0`) | **0 / 111 (0%)** |

- Reported values track `molecules[1]` length (≈139–146); **true** interface-residue counts range **6–53**.

## Expected vs observed

- **Observed:** `number_interface_residues` = `len(interfaces[].molecules[1].buried_surface_areas)`.
- **Expected:** number of residues actually at the interface = count of residues with `buried_surface_area > 0`, summed over both molecules. The same JSON already carries per-residue arrays (`buried_surface_areas`, aligned with `residue_label_comp_ids` / `residue_seq_ids`), so the correct value is directly computable.
- **Likely cause:** the field is populated with an array length taken from `molecules[1]` instead of a count of interfacing residues (off-by-reference).

## Key examples

- **`2zlv/1`** proves it is specifically `molecules[1]` (index 1), not "the larger chain": molecules = `[A(141), B(132)]`, reported = **132** (the *smaller*, second molecule), true = **52**.
- **Homo-molecular interfaces** (tiny interface, reported = full chain length):
  - `1g0b/9` (A-2↔A): reported **141**, true **22**
  - `1g0b/10` (B-2↔B): reported **146**, true **14**
  - `6sva/9` (B-2↔B): reported **146**, true **10**
  - `6sva/10` (A-2↔A): reported **139**, true **6**
- **α1β1 interface** `6r2o/1` (A↔B): reported **145**, true **53**.

## Full evidence (all interfaces)

| pdb/iface | molecules (chain) | mol residue lengths | reported | true (bsa>0, per side) |
|---|---|---|---|---|
| 1g0b/1 | A, B | 141, 146 | **146** | 51 (26+25) |
| 1g0b/2 | A-2, B-2 | 141, 146 | **146** | 51 (26+25) |
| 1g0b/7 | A, B-2 | 141, 146 | **146** | 28 (14+14) |
| 1g0b/8 | A-2, B | 141, 146 | **146** | 29 (15+14) |
| 1g0b/9 | A-2, A | 141, 141 | **141** | 22 (11+11) |
| 1g0b/10 | B-2, B | 146, 146 | **146** | 14 (7+7) |
| 1ibe/1 | A-2, B-2 | 141, 146 | **146** | 49 (25+24) |
| 1ibe/2 | A, B | 141, 146 | **146** | 49 (25+24) |
| 1ibe/7 | A, B-2 | 141, 146 | **146** | 31 (14+17) |
| 1ibe/8 | A-2, B | 141, 146 | **146** | 31 (14+17) |
| 1ibe/9 | A-2, A | 141, 141 | **141** | 18 (9+9) |
| 1ibe/10 | B-2, B | 146, 146 | **146** | 16 (8+8) |
| 1iwh/1 | A, B | 141, 146 | **146** | 50 (26+24) |
| 1iwh/2 | A-2, B-2 | 141, 146 | **146** | 50 (26+24) |
| 1iwh/3 | A, B-2 | 141, 146 | **146** | 35 (14+21) |
| 1iwh/4 | A-2, B | 141, 146 | **146** | 35 (14+21) |
| 1iwh/11 | B-2, B | 146, 146 | **146** | 16 (8+8) |
| 1iwh/12 | A-2, A | 141, 141 | **141** | 12 (6+6) |
| 1ns6/1 | A-2, B-2 | 141, 146 | **146** | 49 (25+24) |
| 1ns6/2 | A, B | 141, 146 | **146** | 49 (25+24) |
| 1ns6/3 | A-2, B | 141, 146 | **146** | 33 (14+19) |
| 1ns6/4 | A, B-2 | 141, 146 | **146** | 33 (14+19) |
| 1ns6/9 | B-2, B | 146, 146 | **146** | 14 (7+7) |
| 1ns9/1 | A, B | 141, 146 | **146** | 50 (26+24) |
| 1ns9/2 | A-2, B-2 | 141, 146 | **146** | 50 (26+24) |
| 1ns9/7 | A, B-2 | 141, 146 | **146** | 32 (16+16) |
| 1ns9/8 | A-2, B | 141, 146 | **146** | 33 (17+16) |
| 1ns9/9 | A-2, A | 141, 141 | **141** | 22 (11+11) |
| 1ns9/10 | B-2, B | 146, 146 | **146** | 16 (8+8) |
| 1y8h/1 | A, B | 141, 146 | **146** | 47 (24+23) |
| 1y8h/2 | C, D | 141, 146 | **146** | 47 (24+23) |
| 1y8h/7 | A, D | 141, 146 | **146** | 31 (16+15) |
| 1y8h/8 | C, B | 141, 146 | **146** | 22 (11+11) |
| 1y8h/9 | A, C | 141, 141 | **141** | 27 (12+15) |
| 1y8h/10 | B, D | 146, 146 | **146** | 10 (5+5) |
| 1y8i/1 | C, D | 141, 146 | **146** | 50 (25+25) |
| 1y8i/2 | A, B | 141, 146 | **146** | 50 (27+23) |
| 1y8i/7 | A, D | 141, 146 | **146** | 28 (14+14) |
| 1y8i/8 | C, B | 141, 146 | **146** | 25 (14+11) |
| 1y8i/9 | A, C | 141, 141 | **141** | 26 (14+12) |
| 1y8i/10 | B, D | 146, 146 | **146** | 23 (11+12) |
| 1y8k/1 | C, D | 141, 146 | **146** | 49 (25+24) |
| 1y8k/2 | A, B | 141, 146 | **146** | 47 (25+22) |
| 1y8k/7 | A, D | 141, 146 | **146** | 29 (15+14) |
| 1y8k/8 | C, B | 141, 146 | **146** | 27 (14+13) |
| 1y8k/9 | A, C | 141, 141 | **141** | 28 (14+14) |
| 1y8k/10 | B, D | 146, 146 | **146** | 16 (9+7) |
| 2d5x/1 | A-2, B-2 | 141, 146 | **146** | 49 (26+23) |
| 2d5x/2 | A, B | 141, 146 | **146** | 49 (26+23) |
| 2d5x/3 | A-2, B | 141, 146 | **146** | 35 (14+21) |
| 2d5x/4 | A, B-2 | 141, 146 | **146** | 35 (14+21) |
| 2d5x/11 | B-2, B | 146, 146 | **146** | 18 (9+9) |
| 2d5x/16 | A-2, A | 141, 141 | **141** | 12 (6+6) |
| 2dhb/1 | A-2, B-2 | 141, 146 | **146** | 47 (25+22) |
| 2dhb/2 | A, B | 141, 146 | **146** | 47 (25+22) |
| 2dhb/3 | A, B-2 | 141, 146 | **146** | 35 (17+18) |
| 2dhb/4 | A-2, B | 141, 146 | **146** | 35 (17+18) |
| 2dhb/9 | A-2, A | 141, 141 | **141** | 18 (9+9) |
| 2mhb/1 | A-2, B-2 | 141, 146 | **146** | 53 (27+26) |
| 2mhb/2 | A, B | 141, 146 | **146** | 53 (27+26) |
| 2mhb/7 | A, B-2 | 141, 146 | **146** | 30 (15+15) |
| 2mhb/8 | A-2, B | 141, 146 | **146** | 29 (14+15) |
| 2mhb/9 | A-2, A | 141, 141 | **141** | 20 (10+10) |
| 2mhb/10 | B-2, B | 146, 146 | **146** | 14 (7+7) |
| 2zlt/1 | A-2, B-2 | 141, 145 | **145** | 50 (26+24) |
| 2zlt/2 | A, B | 141, 145 | **145** | 50 (26+24) |
| 2zlt/7 | A-2, B | 141, 145 | **145** | 31 (15+16) |
| 2zlt/8 | A, B-2 | 141, 145 | **145** | 31 (15+16) |
| 2zlt/9 | A-2, A | 141, 141 | **141** | 22 (11+11) |
| 2zlu/1 | A, B | 140, 145 | **145** | 53 (27+26) |
| 2zlu/2 | A-2, B-2 | 140, 145 | **145** | 53 (27+26) |
| 2zlu/7 | A-2, B | 140, 145 | **145** | 27 (13+14) |
| 2zlu/8 | A, B-2 | 140, 145 | **145** | 27 (13+14) |
| 2zlu/9 | A-2, A | 140, 140 | **140** | 14 (7+7) |
| 2zlu/10 | B-2, B | 145, 145 | **145** | 10 (5+5) |
| 2zlv/1 | A, B | 141, 132 | **132** | 52 (26+26) |
| 2zlv/2 | A-2, B-2 | 141, 132 | **132** | 52 (26+26) |
| 2zlv/7 | A, B-2 | 141, 132 | **132** | 30 (16+14) |
| 2zlv/8 | A-2, B | 141, 132 | **132** | 30 (16+14) |
| 2zlv/9 | A-2, A | 141, 141 | **141** | 18 (9+9) |
| 2zlv/10 | B-2, B | 132, 132 | **132** | 16 (8+8) |
| 2zlw/1 | A, B | 141, 146 | **146** | 51 (27+24) |
| 2zlw/2 | C, D | 141, 146 | **146** | 48 (25+23) |
| 2zlw/7 | C, B | 141, 146 | **146** | 34 (17+17) |
| 2zlw/8 | A, D | 141, 146 | **146** | 31 (16+15) |
| 2zlw/9 | A, C | 141, 141 | **141** | 25 (12+13) |
| 2zlw/10 | B, D | 146, 146 | **146** | 20 (11+9) |
| 5c6e/1 | A, B | 141, 146 | **146** | 50 (25+25) |
| 5c6e/2 | A-2, B-2 | 141, 146 | **146** | 50 (25+25) |
| 5c6e/7 | A, B-2 | 141, 146 | **146** | 30 (14+16) |
| 5c6e/8 | A-2, B | 141, 146 | **146** | 30 (14+16) |
| 5c6e/9 | A-2, A | 141, 141 | **141** | 22 (11+11) |
| 5c6e/10 | B-2, B | 146, 146 | **146** | 18 (9+9) |
| 6r2o/1 | A, B | 141, 145 | **145** | 53 (27+26) |
| 6r2o/2 | C, D | 141, 145 | **145** | 52 (27+25) |
| 6r2o/7 | A, D | 141, 145 | **145** | 31 (17+14) |
| 6r2o/8 | C, B | 141, 145 | **145** | 28 (14+14) |
| 6r2o/9 | A, C | 141, 141 | **141** | 29 (15+14) |
| 6r2o/11 | B, D | 145, 145 | **145** | 10 (6+4) |
| 6sva/1 | A-2, B-2 | 139, 146 | **146** | 50 (26+24) |
| 6sva/2 | A, B | 139, 146 | **146** | 50 (26+24) |
| 6sva/7 | A, B-2 | 139, 146 | **146** | 28 (13+15) |
| 6sva/8 | A-2, B | 139, 146 | **146** | 28 (13+15) |
| 6sva/9 | B-2, B | 146, 146 | **146** | 10 (5+5) |
| 6sva/10 | A-2, A | 139, 139 | **139** | 6 (3+3) |
| 8puq/1 | A, B | 139, 146 | **146** | 49 (25+24) |
| 8puq/2 | A-2, B-2 | 139, 146 | **146** | 49 (25+24) |
| 8puq/7 | A, B-2 | 139, 146 | **146** | 28 (13+15) |
| 8puq/8 | A-2, B | 139, 146 | **146** | 28 (13+15) |
| 8puq/9 | B-2, B | 146, 146 | **146** | 18 (9+9) |
| 8puq/10 | A-2, A | 139, 139 | **139** | 8 (4+4) |

## Reproduction

```python
import json
d = json.load(open('<pdb>_assembly1_interfaces.json'))
# for each interface object 'itf':
reported = itf['number_interface_residues']
mol1_len = len(itf['molecules'][1]['buried_surface_areas'])           # == reported (always)
true_ct  = sum(1 for m in itf['molecules']
               for x in m['buried_surface_areas'] if x and float(x) > 0)  # != reported (never)
```
