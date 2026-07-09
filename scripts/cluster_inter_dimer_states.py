#!/usr/bin/env python3
"""Cluster the inter-dimer alpha-beta interfaces of a hemoglobin complex by contact-fingerprint
Jaccard similarity and test whether the clustering tracks the T (tense/deoxy) vs R (relaxed/
liganded) quaternary state.

The inter-dimer alpha1-beta2 / alpha2-beta1 interface is the allosteric ("Perutz switch") interface
that rewires between the T and R quaternary states. We fingerprint each structure by the set of
(alpha UniProt position, beta UniProt position) residue-residue contact pairs at that interface
(pooled over both symmetry-equivalent copies), then hierarchically cluster on Jaccard distance.

Finding for PDB-CPX-131443 (horse hemoglobin): the single deoxy T-state structure (2dhb) separates
from all R-state structures (within-R Jaccard ~0.66 vs R-to-T ~0.35); the T-specific contacts map
onto the classic C-terminal / switch residues (beta145/146, alpha C-terminus, beta FG corner).
1ibe (deoxy ligation but crystallised in the R quaternary state) clusters with R, showing the
interface tracks the quaternary state rather than ligation. NB the set is 18 R : 1 T, so the T/R
split rests on a single deoxy structure -- confirmatory, not statistically strong.

Usage:
    python scripts/cluster_inter_dimer_states.py --complex PDB-CPX-131443 \
        --out data/processed/PDB-CPX-131443/inter_dimer_state_cluster.png
"""
import argparse
import json
import os

import numpy as np
from scipy.cluster.hierarchy import dendrogram, fcluster, linkage
from scipy.spatial.distance import squareform

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

# Quaternary state (T/R) + ligation, read from the deposited structure titles. For horse
# hemoglobin (PDB-CPX-131443); extend/replace for other complexes.
STATE = {
    "1g0b": ("R", "CO"),       "1ibe": ("R", "deoxy"),    "1iwh": ("R", "CO"),
    "1ns6": ("R", "met"),      "1ns9": ("R", "met"),      "1y8h": ("R", "met"),
    "1y8i": ("R", "met"),      "1y8k": ("R", "met"),      "2d5x": ("R", "CO"),
    "2dhb": ("T", "deoxy"),    "2mhb": ("R", "met"),      "2zlt": ("R", "met"),
    "2zlu": ("R", "met"),      "2zlv": ("R", "met"),      "2zlw": ("R", "met"),
    "5c6e": ("R", "cyanomet"), "6r2o": ("R", "?"),        "6sva": ("R", "?"),
    "8puq": ("R", "met"),
}
# The two inter-dimer alpha-beta aggregated interfaces (alpha1-beta2, alpha2-beta1).
INTER = {"AI_131443_0001_0004", "AI_131443_0002_0003"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--complex", default="PDB-CPX-131443")
    ap.add_argument("--contacts", default=None)
    ap.add_argument("--out", default="data/processed/PDB-CPX-131443/inter_dimer_state_cluster.png")
    args = ap.parse_args()
    contacts = args.contacts or f"data/processed/{args.complex}/interface_contacts.json"

    # Fingerprint: {structure -> set of (alpha_pos, beta_pos) contact pairs} over both inter copies.
    fp = {}
    for r in json.load(open(contacts)):
        if r["agg_interface_id"] in INTER:
            e = r["interface_instance_id"].split("_")[0]
            fp.setdefault(e, set()).add((r["unp_num_1"], r["unp_num_2"]))
    entries = sorted(fp)
    lab = {e: f"{STATE[e][0]} ({STATE[e][1]})" for e in entries}
    for e in entries:
        print(f"{e:6s} {lab[e]:14s} {len(fp[e]):3d} contacts")

    n = len(entries)
    D = np.zeros((n, n))
    for i in range(n):
        for j in range(n):
            a, b = fp[entries[i]], fp[entries[j]]
            D[i, j] = 1 - len(a & b) / len(a | b)
    Z = linkage(squareform(D, checks=False), method="average")

    # Figure: dendrogram (T in red) + clustering-ordered Jaccard-similarity heatmap.
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(15, 7), gridspec_kw={"width_ratios": [1, 1.15]})
    tcol = lambda e: "#c0392b" if STATE[e][0] == "T" else "#2c6fbf"
    dn = dendrogram(Z, labels=[f"{e}  [{lab[e]}]" for e in entries], orientation="right",
                    ax=ax1, color_threshold=0.42, leaf_font_size=9)
    ax1.set_title("Inter-dimer α–β interface\nJaccard on contact fingerprints "
                  "(average linkage)", fontsize=11)
    ax1.set_xlabel("Jaccard distance (1 = no shared contacts)")
    for t in ax1.get_ymajorticklabels():
        t.set_color(tcol(t.get_text().split()[0]))
    order = dn["leaves"]
    im = ax2.imshow(1 - D[np.ix_(order, order)], cmap="magma", vmin=0.3, vmax=1)
    ax2.set_xticks(range(n)); ax2.set_yticks(range(n))
    ax2.set_xticklabels([entries[i] for i in order], rotation=90, fontsize=8)
    ax2.set_yticklabels([f"{entries[i]} [{lab[entries[i]]}]" for i in order], fontsize=8)
    for k, i in enumerate(order):
        if STATE[entries[i]][0] == "T":
            ax2.get_yticklabels()[k].set_color("#c0392b")
            ax2.get_xticklabels()[k].set_color("#c0392b")
    ax2.set_title("Jaccard similarity (reordered by clustering)", fontsize=11)
    fig.colorbar(im, ax=ax2, fraction=0.046, label="Jaccard similarity")
    plt.tight_layout()
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    plt.savefig(args.out, dpi=130, bbox_inches="tight")
    print(f"\nwrote figure -> {args.out}")

    # Quantify + differential (T-specific) contacts.
    sim = lambda a, b: len(fp[a] & fp[b]) / len(fp[a] | fp[b])
    R = [e for e in entries if STATE[e][0] == "R"]
    T = [e for e in entries if STATE[e][0] == "T"]
    if R and len(R) > 1:
        print(f"mean Jaccard within R (n={len(R)}): "
              f"{np.mean([sim(a, b) for i, a in enumerate(R) for b in R[i + 1:]]):.2f}")
    if R and T:
        print(f"mean Jaccard  R vs {T[0]} (T)   : {np.mean([sim(a, T[0]) for a in R]):.2f}")
        t_only = fp[T[0]] - set.union(*[fp[e] for e in R])
        print(f"{T[0]} (T)-specific contacts absent from every R structure: "
              + ", ".join(sorted(f"α{a}-β{b}" for a, b in t_only)))
    cl = fcluster(Z, t=2, criterion="maxclust")
    print("2-cluster cut:")
    for c in sorted(set(cl)):
        m = [entries[i] for i in range(n) if cl[i] == c]
        print(f"  cluster {c} (n={len(m)}): " + ", ".join(f"{e}[{STATE[e][0]}]" for e in m))


if __name__ == "__main__":
    main()
