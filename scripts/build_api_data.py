#!/usr/bin/env python3
"""Restructure the prototype's aggregated-interface data into the proposed API responses.

Reads the files the prototype actually serves (data/processed/<complex>/) and writes api_data/:

    aggregated_interfaces.json                    endpoint 1, the whole complex
    aggregated_interface_<agg_id>.json            endpoint 2, one per aggregated interface

Nothing here invents values. Every field is either copied from the prototype data, renamed (with
the rename recorded in api_data/README.md), or derived by arithmetic over those values. Fields the
eventual backend will have to supply are listed in the README rather than stubbed with nulls.

Run:  python3 scripts/build_api_data.py --complex PDB-CPX-131443
"""
import argparse
import json
import os
import statistics
from collections import defaultdict

# PISA-derived per-interface properties the prototype plots. Kept as one block so the frontend can
# iterate them generically rather than naming each; units are documented in the README.
PISA_PROPERTY_KEYS = [
    "interface_area", "solvation_energy", "stabilization_energy", "p_value",
    "number_interface_residues", "number_hydrogen_bonds", "number_salt_bridges",
    "number_disulfide_bonds", "number_covalent_bonds", "number_other_bonds",
]
# Areas, energies and the P-value are measured on a continuous scale; the rest are counts. The
# distinction is not cosmetic: an ordinary median over an even number of counts returns a value that
# cannot occur ("6.5 hydrogen bonds"), so counts use the low median, which is always an observed
# value. The prototype draws the same line, plotting counts as individual values and the continuous
# properties as binned distributions.
CONTINUOUS_PROPERTIES = {"interface_area", "solvation_energy", "stabilization_energy", "p_value"}


PISA_DIR = os.path.join("data", "raw", "pisa")
BOND_BLOCKS = ("hydrogen_bonds", "salt_bridges", "other_bonds", "disulfide_bonds", "covalent_bonds")


def pisa_chain_ids(pdb_id, assembly_id, interface_id):
    """{auth_asym_id: label_asym_id} for one PISA interface.

    The prototype carries a single chain identifier per side. PISA carries both, as parallel arrays
    on each bond block: `atom_site_N_chains` is the author chain and `atom_site_N_label_asym_ids`
    the mmCIF label_asym_id. Read here rather than assumed, because the two genuinely differ in
    general (in the supplied 6wps file, author B is label D).

    Returns {} when the interface has no bonded contacts to read the pairing from; the caller then
    emits a null label_asym_id rather than guessing.
    """
    path = os.path.join(PISA_DIR, pdb_id, f"{pdb_id}_assembly{assembly_id}_interfaces.json")
    if not os.path.exists(path):
        return {}
    with open(path) as fh:
        asm = json.load(fh)[pdb_id]["assembly"]
    rec = next((i for i in asm["interfaces"] if str(i["interface_id"]) == str(interface_id)), None)
    if rec is None:
        return {}
    out = {}
    for block in BOND_BLOCKS:
        b = rec.get(block) or {}
        for side in ("1", "2"):
            for auth, label in zip(b.get(f"atom_site_{side}_chains") or [],
                                   b.get(f"atom_site_{side}_label_asym_ids") or []):
                out[auth] = label
    return out


def chain_ref(auth, label_by_auth, side, chain_class_id=None):
    """A chain named in both identifier namespaces, so a viewer can select on either.

    Flat, with a `_1` / `_2` suffix rather than a nested object. That is what the upstream data uses
    (`asym_id_1`, PISA's `atom_site_1_*`), and what every consumer wants: the prototype's Sankey and
    3D overlay both rebuild flat records immediately, so nesting only added a destructuring step.
    Measured at 2.42 MB nested against 2.38 MB flat, so size does not decide it either.
    """
    out = {f"auth_asym_id_{side}": auth, f"label_asym_id_{side}": label_by_auth.get(auth)}
    if chain_class_id is not None:
        # Which component copy this chain realises. A property of the chain, so it belongs with the
        # chain rather than loose on the instance; it is also the join back to complex.components[].
        out[f"chain_class_id_{side}"] = chain_class_id
    return out


def residue_name(label):
    """'LYS128' -> 'LYS'. The prototype does this in the browser on every render; doing it once
    here means the API ships the residue name and its number as separate fields."""
    return "".join(c for c in str(label) if not c.isdigit())


def load(base, name):
    with open(os.path.join(base, f"{name}.json")) as fh:
        return json.load(fh)


def component_index(classes, uni):
    """chain_class_id -> the component-copy record used on both endpoints."""
    out = {}
    for c in classes:
        acc = c["accession"]
        u = uni.get(acc, {})
        out[c["chain_class_id"]] = {
            "chain_class_id": c["chain_class_id"],
            "component_label": c["component_label"],
            "accession": acc,
            "accession_type": "UniProt",
            "copy_index": c["component_index"],
            "molecule_name": u.get("name"),
            "gene": u.get("gene"),
        }
    return out


def partner(comp_index, chain_class_id):
    """The component copy on one side of an interface.

    Identity plus the gene name. The gene is the label the UI actually shows ("HBA.1"), and endpoint
    2 carries no component list to join against, so without it every detail response would need
    endpoint 1 in hand before it could name its own partners.
    """
    c = comp_index[chain_class_id]
    return {k: c[k] for k in ("chain_class_id", "component_label", "accession", "copy_index", "gene")}


def build_endpoint_1(cx, agg, classes, uni, ifaces):
    comp_index = component_index(classes, uni)
    per_agg_entries = defaultdict(set)
    for i in ifaces:
        per_agg_entries[i["agg_interface_id"]].add(i["entry_id"])

    components = []
    for c in classes:
        rec = dict(comp_index[c["chain_class_id"]])
        u = uni.get(c["accession"], {})
        rec.update({
            "organism": u.get("organism"),
            "sequence_length": u.get("length"),
            "function": u.get("function"),
            "subunit": u.get("subunit"),
        })
        components.append(rec)

    interfaces = []
    for a in sorted(agg, key=lambda x: -(x.get("median_bsa") or 0)):
        aid = a["agg_interface_id"]
        interfaces.append({
            "aggregated_interface_id": aid,
            "partner_1": partner(comp_index, a["chain_class_id_1"]),
            "partner_2": partner(comp_index, a["chain_class_id_2"]),
            "instance_count": a["instance_count"],
            "distinct_entry_count": len(per_agg_entries[aid]),
            "median_interface_area": a.get("median_bsa"),
        })

    return {
        "complex": {
            "components": components,
            "component_count": len(components),
            "distinct_accession_count": len({c["accession"] for c in components}),
        },
        "aggregated_interface_count": len(interfaces),
        "aggregated_interfaces": interfaces,
    }


def contact_record(c, label_by_auth):
    """One atom-atom contact. Nested inside its interface instance, so it carries no instance id.

    Side 1 is always the instance's chain_1, which is the aggregated interface's partner_1.
    """
    return {
        "bond_type": c["bond_type"],
        "distance": c.get("distance"),
        **chain_ref(c["asym_id_1"], label_by_auth, 1),
        "auth_seq_id_1": c["auth_residue_number_1"],
        "residue_name_1": residue_name(c["residue_1"]),
        "unp_num_1": c.get("unp_num_1"),
        "atom_id_1": c.get("atom_id_1"),
        **chain_ref(c["asym_id_2"], label_by_auth, 2),
        "auth_seq_id_2": c["auth_residue_number_2"],
        "residue_name_2": residue_name(c["residue_2"]),
        "unp_num_2": c.get("unp_num_2"),
        "atom_id_2": c.get("atom_id_2"),
    }


def conserved_contacts(contacts, n_instances):
    """Residue-residue pairs aggregated over the instances of one aggregated interface.

    Keyed on the UniProt position pair, which is what makes the pairs comparable across deposited
    structures with different author numbering. This reproduces the prototype's `pairAgg` exactly,
    computed once server-side instead of in every browser.
    """
    m = {}
    for c in contacts:
        key = (c["unp_num_1"], c["unp_num_2"])
        e = m.setdefault(key, {
            "unp_num_1": c["unp_num_1"], "residue_name_1": residue_name(c["residue_1"]),
            "unp_num_2": c["unp_num_2"], "residue_name_2": residue_name(c["residue_2"]),
            "_instances": set(), "_bonds": set(),
        })
        e["_instances"].add(c["interface_instance_id"])
        if c.get("bond_type"):
            e["_bonds"].add(c["bond_type"])
    out = []
    for e in m.values():
        n = len(e["_instances"])
        out.append({
            "unp_num_1": e["unp_num_1"], "residue_name_1": e["residue_name_1"],
            "unp_num_2": e["unp_num_2"], "residue_name_2": e["residue_name_2"],
            "observed_in_instances": n,
            "frequency": round(n / n_instances, 4) if n_instances else None,
            "bond_types": sorted(e["_bonds"]),
        })
    return sorted(out, key=lambda x: (-x["observed_in_instances"],
                                      x["unp_num_1"], x["unp_num_2"]))


def property_summary(instances):
    """Range and centre of each PISA property over the instances of one aggregated interface.

    Reported alongside the count of instances the figure was computed from, because a property can
    be absent on some deposited interfaces and a summary over four values means something different
    from one over nineteen. `value_type` tells the client whether the property is a measurement or a
    count, which decides both how the median was taken and how the distribution should be drawn.
    """
    out = {"instance_count": len(instances),
           "distinct_entry_count": len({i["pdb_id"] for i in instances})}
    props = {}
    for k in PISA_PROPERTY_KEYS:
        vals = [i["properties"][k] for i in instances if i["properties"][k] is not None]
        continuous = k in CONTINUOUS_PROPERTIES
        if not vals:
            median = None
        elif continuous:
            median = round(statistics.median(vals), 3)
        else:
            # median_low, so the reported value is one an interface actually has.
            median = statistics.median_low(vals)
        props[k] = {
            "value_type": "continuous" if continuous else "count",
            "min": round(min(vals), 3) if vals else None,
            "max": round(max(vals), 3) if vals else None,
            "median": median,
            "n": len(vals),
        }
    out["properties"] = props
    return out


def build_endpoint_2(cx, a, classes, uni, ifaces, contacts):
    comp_index = component_index(classes, uni)
    aid = a["agg_interface_id"]
    rows = [i for i in ifaces if i["agg_interface_id"] == aid]
    rows.sort(key=lambda i: -(i.get("interface_area") or 0))

    by_instance = defaultdict(list)
    for c in contacts:
        if c["agg_interface_id"] == aid:
            by_instance[c["interface_instance_id"]].append(c)

    instances = []
    for i in rows:
        iid = i["interface_instance_id"]
        labels = pisa_chain_ids(i["entry_id"], i["assembly_id"], i["interface_id"])
        instances.append({
            "interface_instance_id": iid,
            "pdb_id": i["entry_id"],
            "assembly_id": i["assembly_id"],
            "interface_id": i["interface_id"],
            # The two chains that form this interface, grouped so the identifiers do not sit loose
            # among the instance's own fields. Both namespaces are given for each: a viewer
            # selecting on the wrong one fails silently.
            "interacting_chains": {
                **chain_ref(i["asym_id_1"], labels, 1, i["chain_class_id_1"]),
                **chain_ref(i["asym_id_2"], labels, 2, i["chain_class_id_2"]),
            },
            "properties": {k: i.get(k) for k in PISA_PROPERTY_KEYS},
            "contacts": [contact_record(c, labels) for c in by_instance.get(iid, [])],
        })

    all_cts = [c for c in contacts if c["agg_interface_id"] == aid]
    return {
        "aggregated_interface_id": aid,
        "partner_1": partner(comp_index, a["chain_class_id_1"]),
        "partner_2": partner(comp_index, a["chain_class_id_2"]),
        "pisa_interface_property_summary": property_summary(instances),
        "interface_instances": instances,
        "conserved_contacts": conserved_contacts(all_cts, len(instances)),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--complex", default="PDB-CPX-131443")
    ap.add_argument("--src", default=None)
    ap.add_argument("--out", default="api_data")
    args = ap.parse_args()

    src = args.src or os.path.join("data", "processed", args.complex)
    agg = load(src, "aggregated_interface")
    ifaces = load(src, "interface")
    contacts = load(src, "interface_contacts")
    classes = load(src, "complex_chain_class")
    uni = load(src, "uniprot_summary")
    os.makedirs(args.out, exist_ok=True)

    # Keyed by complex id at the top level, the way PDBe responses are keyed by entry id.
    e1 = build_endpoint_1(args.complex, agg, classes, uni, ifaces)
    p1 = os.path.join(args.out, "aggregated_interfaces.json")
    with open(p1, "w") as fh:
        json.dump({args.complex: e1}, fh, indent=2)
    print(f"{p1}  {os.path.getsize(p1)/1024:.0f} KB  "
          f"{e1['aggregated_interface_count']} aggregated interfaces")

    for a in agg:
        e2 = build_endpoint_2(args.complex, a, classes, uni, ifaces, contacts)
        p2 = os.path.join(args.out, f"aggregated_interface_{a['agg_interface_id']}.json")
        with open(p2, "w") as fh:
            json.dump({args.complex: e2}, fh, indent=2)
        n_ct = sum(len(i["contacts"]) for i in e2["interface_instances"])
        n_lab = sum(1 for i in e2["interface_instances"]
                    for k in ("label_asym_id_1", "label_asym_id_2")
                    if i["interacting_chains"][k] is not None)
        print(f"{p2}  {os.path.getsize(p2)/1024:.0f} KB  "
              f"{e2['pisa_interface_property_summary']['instance_count']} instances, "
              f"{len(e2['conserved_contacts'])} conserved pairs, "
              f"{n_ct} atom contacts, "
              f"{n_lab}/{2 * len(e2['interface_instances'])} chains with a label_asym_id")


if __name__ == "__main__":
    main()
