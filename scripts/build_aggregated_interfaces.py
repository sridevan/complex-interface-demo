#!/usr/bin/env python3
"""
build_aggregated_interfaces.py — aggregate per-instance PISA interfaces into chain-class
interface groups for the PDBe-KB Complexes aggregated-interface page (see the schema /
ingestion workflow docs). Demonstrated on PDB-CPX-131443 (horse hemoglobin).

Inputs (from build_chain_correspondence step):
  data/processed/<complex>/complex_chain_class.json
  data/processed/<complex>/complex_chain_instance.json     (asym_id == label_asym_id)
Per-instance interfaces are fetched from the PISA FTP (msd/pdb-assemblies-analysis/split).

Outputs (data/processed/<complex>/):
  interface.json            per-instance interfaces, each tagged with agg_interface_id
  interface_contacts.json   residue-residue contacts per instance (UniProt-numbered)
  aggregated_interface.json  one row per chain-class pair (selector cards): instance_count,
                             median_bsa, endpoint component labels, + aggregated contact summary

  python scripts/build_aggregated_interfaces.py [--complex PDB-CPX-131443]
"""
import argparse
import json
import os
import statistics
from collections import defaultdict

import requests

from common import PISA_SPLIT_DIR, get_logger, load_interfaces, pisa_split_mid
from parse_pisa_interfaces import parse_interfaces

log = get_logger("agg_interfaces")


def ensure_pisa(pdb, asm):
    dest = f"data/raw/pisa/{pdb}/{pdb}_assembly{asm}_interfaces.json"
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return dest
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    url = PISA_SPLIT_DIR.format(mid=pisa_split_mid(pdb)) + f"{pdb}_assembly{asm}_interfaces.json"
    try:
        r = requests.get(url, timeout=90)
    except Exception as e:
        log.warning("%s/%s PISA fetch error %s", pdb, asm, e); return None
    if r.status_code != 200:
        log.warning("%s/%s PISA %s", pdb, asm, r.status_code); return None
    open(dest, "wb").write(r.content)
    return dest


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--complex", default="PDB-CPX-131443")
    args = ap.parse_args()
    CX = args.complex
    NUM = CX.split("-")[-1]
    D = f"data/processed/{CX}"

    classes = {c["chain_class_id"]: c for c in json.load(open(f"{D}/complex_chain_class.json"))}
    inst = {}  # (entry, assembly, asym) -> chain_class_id
    for i in json.load(open(f"{D}/complex_chain_instance.json")):
        inst[(i["entry_id"], i["assembly_id"], i["asym_id"])] = i["chain_class_id"]
    assemblies = sorted({(i["entry_id"], i["assembly_id"]) for i in
                         json.load(open(f"{D}/complex_chain_instance.json"))})

    # assembly metadata (resolution / method / title)
    api = requests.get(f"https://www.ebi.ac.uk/pdbe/api/v2/complex/details/{CX}?id_type=pdb_complex_id",
                       timeout=30).json()
    meta = {(a["pdb_id"], str(a["assembly_id"])): a for a in api[CX][0]["assemblies"]}

    interfaces, contacts = [], []
    agg = defaultdict(lambda: {"bsa": [], "solv": [], "instances": set(),
                               "contacts": defaultdict(lambda: defaultdict(set))})

    for pdb, asm in assemblies:
        p = ensure_pisa(pdb, asm)
        if not p:
            continue
        _, block = load_interfaces(p)
        recs = parse_interfaces(pdb, block, pdb_complex_id=CX)
        by_if = defaultdict(list)
        for r in recs:
            by_if[r["interface_id"]].append(r)
        for iid, brs in by_if.items():
            chains = {s[k] for r in brs for s, k in ((r["side1"], "label_asym_id"), (r["side2"], "label_asym_id"))} - {None}
            if len(chains) != 2:
                continue
            cls = {c: inst.get((pdb, asm, c)) for c in chains}
            if not all(cls.values()):        # non-protein / unmapped chain -> skip
                continue
            classA, classB = sorted(cls.values())             # canonical order
            agg_id = f"AI_{NUM}_{classA.split('_')[-1]}_{classB.split('_')[-1]}"
            inst_id = f"{pdb}_{asm}_{iid}"
            m = meta.get((pdb, asm), {})
            props = brs[0]
            # orient chains: chainA -> classA
            chA = next(c for c, v in cls.items() if v == classA)
            chB = next(c for c, v in cls.items() if v == classB)
            interfaces.append({
                "interface_instance_id": inst_id, "pdb_complex_id": CX,
                "entry_id": pdb, "assembly_id": asm, "interface_id": iid,
                "agg_interface_id": agg_id,
                "chain_class_id_1": classA, "chain_class_id_2": classB,
                "asym_id_1": chA, "asym_id_2": chB,
                "interface_area": props.get("interface_area"),
                "solvation_energy": props.get("solvation_energy"),
                "stabilization_energy": props.get("stabilization_energy"),
                "p_value": props.get("p_value"),
                "number_interface_residues": props.get("number_interface_residues"),
                "n_interface_residues": props.get("number_interface_residues"),
                "number_hydrogen_bonds": props.get("number_hydrogen_bonds"),
                "number_salt_bridges": props.get("number_salt_bridges"),
                "number_disulfide_bonds": props.get("number_disulfide_bonds"),
                "number_covalent_bonds": props.get("number_covalent_bonds"),
                "number_other_bonds": props.get("number_other_bonds"),
                "resolution": m.get("resolution"), "experimental_method": m.get("experimental_method"),
                "title": m.get("title"),
            })
            agg[agg_id]["instances"].add(inst_id)
            if props.get("interface_area") is not None:
                agg[agg_id]["bsa"].append(props["interface_area"])
            if props.get("solvation_energy") is not None:
                agg[agg_id]["solv"].append(props["solvation_energy"])
            # residue-residue contacts, oriented A(class1) -> B(class2), UniProt numbering
            for r in brs:
                sa, sb = (r["side1"], r["side2"]) if inst.get((pdb, asm, r["side1"]["label_asym_id"])) == classA \
                    else (r["side2"], r["side1"])
                key = (sa["unp_num"], sa["residue_name"], sb["unp_num"], sb["residue_name"])
                contacts.append({
                    "interface_instance_id": inst_id, "agg_interface_id": agg_id,
                    "asym_id_1": sa["label_asym_id"], "auth_residue_number_1": sa["author_residue_number"],
                    "residue_1": f"{sa['residue_name']}{sa['unp_num']}", "unp_num_1": sa["unp_num"],
                    "asym_id_2": sb["label_asym_id"], "auth_residue_number_2": sb["author_residue_number"],
                    "residue_2": f"{sb['residue_name']}{sb['unp_num']}", "unp_num_2": sb["unp_num"],
                    "bond_type": r["interaction_type"],
                })
                agg[agg_id]["contacts"][key][r["interaction_type"]].add(inst_id)

    # aggregated_interface rows
    agg_rows = []
    for agg_id, a in agg.items():
        c1, c2 = agg_id.rsplit("_", 2)[-2:]
        cc1, cc2 = f"CC_{NUM}_{c1}", f"CC_{NUM}_{c2}"
        summary = sorted(
            [{"residue_1": f"{k[1]}{k[0]}", "residue_2": f"{k[3]}{k[2]}",
              "bond_type": bt, "frequency": len(insts)}
             for k, bts in a["contacts"].items() for bt, insts in bts.items()],
            key=lambda x: -x["frequency"])
        agg_rows.append({
            "agg_interface_id": agg_id, "pdb_complex_id": CX,
            "chain_class_id_1": cc1, "chain_class_id_2": cc2,
            "component_label_1": classes[cc1]["component_label"],
            "component_label_2": classes[cc2]["component_label"],
            "instance_count": len(a["instances"]),
            "median_bsa": round(statistics.median(a["bsa"]), 1) if a["bsa"] else None,
            "median_solvation_energy": round(statistics.median(a["solv"]), 2) if a["solv"] else None,
            "contact_summary": summary,
        })
    agg_rows.sort(key=lambda r: -(r["median_bsa"] or 0))

    json.dump(interfaces, open(f"{D}/interface.json", "w"), indent=1)
    json.dump(contacts, open(f"{D}/interface_contacts.json", "w"), indent=1)
    json.dump(agg_rows, open(f"{D}/aggregated_interface.json", "w"), indent=1)
    log.info("%d per-instance interfaces, %d contact records, %d aggregated interfaces",
             len(interfaces), len(contacts), len(agg_rows))
    for r in agg_rows:
        log.info("  %s  %s <-> %s  n=%d  median_bsa=%s A^2",
                 r["agg_interface_id"], r["component_label_1"], r["component_label_2"],
                 r["instance_count"], r["median_bsa"])


if __name__ == "__main__":
    main()
