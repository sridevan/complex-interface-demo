#!/usr/bin/env python3
"""
common.py — shared constants and small helpers for the antibody-antigen interface pipeline.

Kept deliberately tiny and dependency-free so every step imports the same definitions
(bond types, IMGT boundaries, chain-type mapping, PISA loading, null/int coercion).
"""

import json
import logging

# ---------------------------------------------------------------------------
# PISA bond groups (spec §3a). Order matters only for deterministic output.
# ---------------------------------------------------------------------------
BOND_TYPES = [
    "hydrogen_bonds",
    "salt_bridges",
    "disulfide_bonds",
    "covalent_bonds",
    "other_bonds",
]

# Bond-group name -> singular interaction_type stored per record (spec §3 field mapping).
INTERACTION_TYPE = {
    "hydrogen_bonds": "hydrogen_bond",
    "salt_bridges": "salt_bridge",
    "disulfide_bonds": "disulfide_bond",
    "covalent_bonds": "covalent_bond",
    "other_bonds": "other_bond",
}

# ---------------------------------------------------------------------------
# IMGT region boundaries (spec "Tooling" section) — one definition, reused everywhere.
# ---------------------------------------------------------------------------
CDR1 = range(27, 39)    # IMGT 27-38
CDR2 = range(56, 66)    # IMGT 56-65
CDR3 = range(105, 118)  # IMGT 105-117

# ANARCII chain_type -> collapsed heavy/light (spec chain-type mapping).
CHAIN_TYPE_COLLAPSE = {"H": "heavy", "K": "light", "L": "light"}


def imgt_region(imgt_position, chain_class):
    """Map an IMGT position + chain class ('heavy'/'light') to a region label.

    chain_class must be 'heavy' or 'light'. Positions outside the CDR ranges are
    framework. Callers pass None position -> 'unmapped' handled upstream.
    """
    if imgt_position is None or chain_class not in ("heavy", "light"):
        return "unmapped"
    suffix = "H" if chain_class == "heavy" else "L"
    if imgt_position in CDR1:
        return f"CDR-{suffix}1"
    if imgt_position in CDR2:
        return f"CDR-{suffix}2"
    if imgt_position in CDR3:
        return f"CDR-{suffix}3"
    return f"Framework-{suffix}"


# ---------------------------------------------------------------------------
# PISA loading + coercion helpers
# ---------------------------------------------------------------------------
def load_interfaces(path):
    """Load a PISA *_interfaces.json. Returns (pdb_id, block) where block has
    keys assembly_id, pisa_version, assembly. Mirrors the reference scripts."""
    with open(path) as fh:
        data = json.load(fh)
    if len(data) == 1:
        pdb_id = next(iter(data))
        block = data[pdb_id]
        if isinstance(block, dict) and "assembly" in block:
            return pdb_id, block
    for k, v in data.items():
        if isinstance(v, dict) and "assembly" in v:
            return k, v
    raise ValueError(f"No 'assembly' block found in {path}")


def arr_get(bd, key, i):
    """Safe index into a PISA parallel array; None if missing/short."""
    arr = bd.get(key)
    if arr is None or i >= len(arr):
        return None
    return arr[i]


def to_int(v):
    """Cast a PISA numeric string to int; None-safe. Returns None if not intable."""
    if v is None:
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def blank_ins(v):
    """Normalise an insertion code: null/empty/whitespace -> '' (blank)."""
    if v is None:
        return ""
    s = str(v).strip()
    return s


# ---------------------------------------------------------------------------
# Download URLs / path helpers
# ---------------------------------------------------------------------------
PISA_SPLIT_DIR = "https://ftp.ebi.ac.uk/pub/databases/msd/pdb-assemblies-analysis/split/{mid}/"
PDBE_CIF_URL = "https://www.ebi.ac.uk/pdbe/entry-files/download/{pdb_id}_updated.cif"
PDBE_MOLECULES_API = "https://www.ebi.ac.uk/pdbe/api/pdb/entry/molecules/{pdb_id}"


def pisa_split_mid(pdb_id):
    """Middle two characters of a lowercased 4-char PDB id (6wps -> 'wp')."""
    p = pdb_id.lower()
    if len(p) != 4:
        raise ValueError(f"Extended/non-4-char PDB id out of scope for v1: {pdb_id}")
    return p[1:3]


def observed_residues(cif_path, chain_id):
    """Return the ordered list of observed amino-acid residues for an author chain,
    as (author_seq_num:int, insertion_code:str, residue_name:str, one_letter:str).
    Uses gemmi; this is the sequence ANARCII numbers and the anchor for the IMGT walk."""
    import gemmi
    st = gemmi.read_structure(cif_path)
    model = st[0]
    if chain_id not in [c.name for c in model]:
        return []
    out = []
    for res in model[chain_id]:
        info = gemmi.find_tabulated_residue(res.name)
        if info is None or not info.is_amino_acid():
            continue
        one = info.one_letter_code.upper() or "X"
        out.append((res.seqid.num, (res.seqid.icode or "").strip(), res.name, one))
    return out


def get_logger(name):
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )
    return logging.getLogger(name)
