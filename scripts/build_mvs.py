#!/usr/bin/env python3
"""
build_mvs.py

Generate one MolViewSpec (.mvsj) scene per antibody-antigen interface from a PISA
"*_interfaces.json" file, so the demo web app can let a user click an interface row
and view it in Mol*.

Design notes (verified against real 6wps data):
  * MolViewSpec component selectors use LABEL ids (label_asym_id, label_seq_id), NOT
    author ids. The PISA bond arrays carry both, so we take label ids straight from
    atom_site_N_label_asym_ids / atom_site_N_label_seq_ids per interface side. Do not
    reuse the author numbering here (author != label; e.g. 6wps spike chain E/author is
    label G with a +19 seq offset, while antibody chain F is label H with no offset).
  * The structure is loaded from the PDBe updated mmCIF, which carries label ids and
    UniProt mapping consistent with PISA.
  * We colour the antigen side and antibody side distinctly, ball-and-stick the
    interface residues, keep the rest as a faint cartoon, and focus the camera on the
    union of interface residues.

Requires: pip install molviewspec   (built/tested with molviewspec 1.8.x)

Usage:
  python build_mvs.py 6wps_assembly1_interfaces.json --out-dir app/public/mvs \
      --antibody-chains C,D,F,G,H,L --antigen-chains A,B,E
  # chain lists are AUTHOR chain ids; if omitted, the script infers antigen chains as
  # those whose accession coverage is ~100% and antibody chains as the rest (see
  # check_unp_anomalies.py for the same coverage heuristic).
"""

import argparse
import json
import os
from collections import defaultdict

import molviewspec as mvs

BOND_TYPES = ["hydrogen_bonds", "salt_bridges", "disulfide_bonds", "covalent_bonds", "other_bonds"]

# PDBe updated mmCIF carries label ids + UniProt mapping consistent with PISA.
PDBE_CIF_URL = "https://www.ebi.ac.uk/pdbe/entry-files/download/{pdb_id}_updated.cif"

ANTIGEN_COLOR = "#4b7fcc"   # blue   (antigen side-chain carbons)
ANTIBODY_COLOR = "#e19039"  # orange (antibody side-chain carbons)
CONTEXT_COLOR = "#d0d0d0"   # faint grey cartoon
# CPK heteroatom colours overlaid on the side-chain sticks (carbon keeps the per-side colour),
# giving a chemical, histo.fyi/YRB-style read of the interface side chains.
O_COLOR = "#d1392c"  # oxygen  – red
N_COLOR = "#3454d1"  # nitrogen – blue
S_COLOR = "#e6b800"  # sulfur  – yellow


def load_interfaces(path):
    with open(path) as fh:
        data = json.load(fh)
    for k, v in data.items():
        if isinstance(v, dict) and "assembly" in v:
            return k, v
    raise ValueError("No 'assembly' block found in file.")


def _get(bd, key, i):
    arr = bd.get(key)
    return arr[i] if arr is not None and i < len(arr) else None


def collect_sides(itf):
    """Return per-side dicts of label_asym_id -> sorted set of label_seq_id (ints),
    plus the author chain ids present on each side (for antigen/antibody assignment)."""
    side_label = {1: defaultdict(set), 2: defaultdict(set)}
    side_auth_chains = {1: set(), 2: set()}
    for bt in BOND_TYPES:
        bd = itf.get(bt)
        if not isinstance(bd, dict) or not bd:
            continue
        n = len(bd.get("bond_distances", []))
        for i in range(n):
            for s in (1, 2):
                la = _get(bd, f"atom_site_{s}_label_asym_ids", i)
                ls = _get(bd, f"atom_site_{s}_label_seq_ids", i)
                ch = _get(bd, f"atom_site_{s}_chains", i)
                if la is not None and ls is not None:
                    try:
                        side_label[s][la].add(int(ls))
                    except (TypeError, ValueError):
                        pass
                if ch is not None:
                    side_auth_chains[s].add(ch)
    return side_label, side_auth_chains


def infer_chain_roles(_, block):
    """Fallback: infer antigen (author) chains as those with ~100% accession coverage."""
    interfaces = block.get("assembly", {}).get("interfaces", [])
    seen = defaultdict(set)
    acc = defaultdict(set)
    for itf in interfaces:
        for bt in BOND_TYPES:
            bd = itf.get(bt)
            if not isinstance(bd, dict) or not bd:
                continue
            n = len(bd.get("bond_distances", []))
            for i in range(n):
                for s in (1, 2):
                    ch = _get(bd, f"atom_site_{s}_chains", i)
                    a = _get(bd, f"atom_site_{s}_seq_nums", i)
                    u = _get(bd, f"atom_site_{s}_unp_accs", i)
                    if ch and a is not None:
                        seen[ch].add(str(a))
                        if u:
                            acc[ch].add(str(a))
    antigen = {ch for ch in seen if seen[ch] and len(acc[ch]) / len(seen[ch]) >= 0.90}
    antibody = set(seen) - antigen
    return antigen, antibody


def build_interface_mvsj(pdb_id, assembly_id, itf, antigen_auth, antibody_auth):
    side_label, side_auth_chains = collect_sides(itf)

    # Decide which numbered side is antigen vs antibody using AUTHOR chain membership.
    def role_of(side):
        chs = side_auth_chains[side]
        if chs & antigen_auth:
            return "antigen"
        if chs & antibody_auth:
            return "antibody"
        return "other"

    roles = {1: role_of(1), 2: role_of(2)}
    # Only build antibody-antigen interfaces.
    if set(roles.values()) != {"antigen", "antibody"}:
        return None

    builder = mvs.create_builder()
    structure = (
        builder
        .download(url=PDBE_CIF_URL.format(pdb_id=pdb_id))
        .parse(format="mmcif")
        .assembly_structure(assembly_id=str(assembly_id))
    )

    # Faint context cartoon for the whole polymer.
    structure.component(selector="polymer").representation(type="cartoon").color(color=CONTEXT_COLOR)

    # Interface residues as ball-and-stick side chains: carbons coloured by side (antigen blue /
    # antibody orange), heteroatoms by CPK (O red, N blue, S yellow).
    focus_expressions = []
    for side in (1, 2):
        carbon = ANTIGEN_COLOR if roles[side] == "antigen" else ANTIBODY_COLOR
        exprs = [mvs.ComponentExpression(label_asym_id=la, label_seq_id=seq)
                 for la, seqs in side_label[side].items() for seq in sorted(seqs)]
        if not exprs:
            continue
        rep = structure.component(selector=exprs).representation(type="ball_and_stick")
        rep.color(color=carbon)  # base: carbons + anything not overridden below
        rep.color(color=O_COLOR, selector=mvs.ComponentExpression(type_symbol="O"))
        rep.color(color=N_COLOR, selector=mvs.ComponentExpression(type_symbol="N"))
        rep.color(color=S_COLOR, selector=mvs.ComponentExpression(type_symbol="S"))
        focus_expressions.extend(exprs)

    # Focus camera on the union of interface residues (a dedicated component we .focus()).
    if focus_expressions:
        structure.component(selector=focus_expressions).focus()

    builder.canvas(background_color="#ffffff")
    return builder.get_state()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("interfaces_json")
    ap.add_argument("--out-dir", default="mvs", help="Directory to write .mvsj files")
    ap.add_argument("--antigen-chains", default=None, help="Comma-separated AUTHOR antigen chain ids")
    ap.add_argument("--antibody-chains", default=None, help="Comma-separated AUTHOR antibody chain ids")
    args = ap.parse_args()

    pdb_id, block = load_interfaces(args.interfaces_json)
    assembly_id = block.get("assembly_id")
    interfaces = block.get("assembly", {}).get("interfaces", [])

    if args.antigen_chains or args.antibody_chains:
        antigen_auth = set((args.antigen_chains or "").replace(" ", "").split(",")) - {""}
        antibody_auth = set((args.antibody_chains or "").replace(" ", "").split(",")) - {""}
        if not antigen_auth or not antibody_auth:
            inf_ag, inf_ab = infer_chain_roles(pdb_id, block)
            antigen_auth = antigen_auth or inf_ag
            antibody_auth = antibody_auth or inf_ab
    else:
        antigen_auth, antibody_auth = infer_chain_roles(pdb_id, block)

    os.makedirs(args.out_dir, exist_ok=True)
    manifest = []
    for itf in interfaces:
        iid = itf.get("interface_id")
        state = build_interface_mvsj(pdb_id, assembly_id, itf, antigen_auth, antibody_auth)
        if state is None:
            continue
        fname = f"{pdb_id}_assembly{assembly_id}_interface{iid}.mvsj"
        fpath = os.path.join(args.out_dir, fname)
        with open(fpath, "w") as fh:
            fh.write(state.dumps(indent=2))
        manifest.append({"pdb_id": pdb_id, "assembly_id": assembly_id,
                         "interface_id": iid, "mvsj": fname})
        print(f"wrote {fpath}")

    with open(os.path.join(args.out_dir, "mvs_manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)
    print(f"\n{len(manifest)} antibody-antigen interface scenes written to {args.out_dir}/")
    print(f"antigen author chains: {sorted(antigen_auth)}  |  antibody author chains: {sorted(antibody_auth)}")


if __name__ == "__main__":
    main()
