#!/usr/bin/env python3
"""
build_epitope_communities.py — cluster antibodies by epitope footprint and write a
per-antibody community / archetype / 2-D-embedding artifact for the app.

Method (see the design walkthrough): each SAbDab2-deduplicated antibody -> a vector over
antigen UNP positions (paratope-only, contact-weighted). Spatially SMOOTH the vector with a
Gaussian on Ca-Ca distance (so adjacent / discontinuous-epitope residues aren't orthogonal),
L2-normalize (footprint-size-invariant -> cosine). Then:
  * Louvain community detection on the cosine graph  -> hard epitope communities (Barnes-like).
  * NMF (multiplicative updates)                     -> soft archetypes + per-antibody mixture.
  * UMAP (falls back to spectral, then PCA)          -> 2-D coords for the app scatter.
Communities/archetypes are auto-labelled against known SARS-CoV-2 epitope classes.

  python scripts/build_epitope_communities.py [--k 8] [--sigma 8] [--threshold 0.30]

Output: data/processed/epitope_communities.json  { meta, communities[], archetypes[], antibodies[] }
"""

import argparse
import json
import os
from collections import Counter, defaultdict

import gemmi
import networkx as nx
import numpy as np

from common import get_logger

log = get_logger("epitope_communities")

# Known SARS-CoV-2 epitope classes (UNP positions) for auto-labelling only.
CLASS_SETS = {
    "Class 1 (RBM / ACE2)": {417, 455, 456, 475, 486, 487, 489, 493, 496, 500, 501, 505},
    "Class 2 (RBM / E484)": {452, 472, 483, 484, 485, 490, 493, 494},
    "Class 3 (site V / S309)": {337, 339, 340, 343, 344, 345, 346, 356, 440, 441, 444, 445, 446, 448, 449, 450, 452},
    "Class 4 (cryptic)": {369, 370, 371, 374, 375, 376, 377, 378, 379, 380, 383, 384, 385, 386, 408, 504},
}
ESCAPE = {346, 417, 440, 444, 445, 446, 450, 452, 455, 456, 460, 472, 477, 478, 484, 486, 490, 493, 494, 501}
REF_CANDIDATES = ["7a29", "6z43", "6xr8", "6wps", "6zdg", "7df4"]  # full-length closed spikes to try for Ca coords


def domain_of(p):
    if 14 <= p <= 305: return "NTD"
    if 331 <= p <= 528: return "RBD"
    if p >= 686: return "S2"
    return "linker"


def label_epitope(positions):
    """Auto-label a set of consensus positions: domain first (NTD/S2 unambiguous), else best RBD class."""
    doms = Counter(domain_of(p) for p in positions)
    top_dom = doms.most_common(1)[0][0] if doms else "RBD"
    if top_dom == "NTD": return "NTD supersite"
    if top_dom == "S2": return "S2 stem"
    best = max(CLASS_SETS, key=lambda c: len(set(positions) & CLASS_SETS[c]))
    return best if len(set(positions) & CLASS_SETS[best]) else "RBD (other)"


def nmf(V, k, iters=400, seed=0):
    rng = np.random.RandomState(seed)
    W = rng.rand(V.shape[0], k) + 1e-3
    H = rng.rand(k, V.shape[1]) + 1e-3
    for _ in range(iters):
        H *= (W.T @ V) / (W.T @ W @ H + 1e-9)
        W *= (V @ H.T) / (W @ H @ H.T + 1e-9)
    return W, H


def embed_2d(Mn, sim):
    """2-D embedding: UMAP if available, else spectral (scipy), else PCA (numpy)."""
    try:
        import umap
        emb = umap.UMAP(n_neighbors=15, min_dist=0.25, metric="cosine", random_state=0).fit_transform(Mn)
        return emb, "umap"
    except Exception as e:
        log.warning("UMAP unavailable (%s) -> spectral embedding", type(e).__name__)
    try:
        from scipy.sparse.linalg import eigsh
        A = sim.copy(); np.fill_diagonal(A, 0.0); A[A < 0.2] = 0.0
        d = A.sum(1); L = np.diag(d) - A
        with np.errstate(divide="ignore"):
            dm = np.diag(1.0 / np.sqrt(np.where(d > 0, d, 1)))
        Ln = dm @ L @ dm
        vals, vecs = eigsh(Ln, k=3, which="SM")
        return vecs[:, 1:3], "spectral"
    except Exception as e:
        log.warning("spectral failed (%s) -> PCA", type(e).__name__)
    X = Mn - Mn.mean(0)
    _, _, Vt = np.linalg.svd(X, full_matrices=False)
    return X @ Vt[:2].T, "pca"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--processed", default="data/processed/residue_level_interactions.json")
    ap.add_argument("--sabdab", default="data/processed/sabdab2_ids.json")
    ap.add_argument("--structures", default="data/raw/structures")
    ap.add_argument("--out", default="data/processed/epitope_communities.json")
    ap.add_argument("--k", type=int, default=8)
    ap.add_argument("--sigma", type=float, default=8.0)
    ap.add_argument("--threshold", type=float, default=0.30)
    args = ap.parse_args()

    R = json.load(open(args.processed))
    S = json.load(open(args.sabdab))

    def abid(r):
        k = f"{r['pdb_id']}|{r['antibody_chain_id']}|{r['antibody_chain_type']}"
        return S[k]["sabdab_id"] if k in S else k

    # antibody -> contact-weighted epitope-position counter (paratope-only)
    vec = defaultdict(Counter)
    for r in R:
        if r["antibody_imgt_position"] is None or r["antigen_uniprot_position"] is None:
            continue
        vec[abid(r)][r["antigen_uniprot_position"]] += 1
    antibodies = sorted(vec)
    positions = sorted({p for c in vec.values() for p in c})
    pidx = {p: i for i, p in enumerate(positions)}
    M = np.zeros((len(antibodies), len(positions)))
    for i, a in enumerate(antibodies):
        for p, c in vec[a].items():
            M[i, pidx[p]] = c
    log.info("antibodies=%d positions=%d", len(antibodies), len(positions))

    # Ca coords from best-covering offset-0 reference spike -> Gaussian smoothing kernel
    ca, ref = {}, None
    for pdb in REF_CANDIDATES:
        f = os.path.join(args.structures, f"{pdb}_updated.cif")
        if not os.path.exists(f):
            continue
        m = gemmi.read_structure(f)[0]
        for ch in m:
            cand = {res.seqid.num: np.array([a.pos.x, a.pos.y, a.pos.z])
                    for res in ch for a in res if a.name == "CA"}
            if sum(1 for p in positions if p in cand) > len(ca):
                ca, ref = cand, f"{pdb}/{ch.name}"
    coords = np.array([ca.get(p, [np.nan, np.nan, np.nan]) for p in positions])
    have = np.where(~np.isnan(coords[:, 0]))[0]
    K = np.eye(len(positions))
    C = coords[have]
    dd = np.linalg.norm(C[:, None] - C[None], axis=2)
    Kb = np.exp(-dd ** 2 / (2 * args.sigma ** 2))
    for ai, i in enumerate(have):
        K[i, have] = Kb[ai]
    log.info("smoothing kernel from %s (%d/%d positions have Ca)", ref, len(have), len(positions))

    Ms = M @ K
    Mn = Ms / (np.linalg.norm(Ms, axis=1, keepdims=True) + 1e-9)
    sim = Mn @ Mn.T

    # Louvain hard communities
    G = nx.Graph(); G.add_nodes_from(range(len(antibodies)))
    for i in range(len(antibodies)):
        for j in range(i + 1, len(antibodies)):
            if sim[i, j] >= args.threshold:
                G.add_edge(i, j, weight=float(sim[i, j]))
    comms = sorted(nx.community.louvain_communities(G, weight="weight", seed=0), key=len, reverse=True)
    comm_of = {n: ci for ci, c in enumerate(comms) for n in c}

    # NMF soft archetypes
    W, H = nmf(M, args.k)
    mix = W / (W.sum(1, keepdims=True) + 1e-9)
    dom = W.argmax(1)

    # 2-D embedding
    emb, emb_kind = embed_2d(Mn, sim)
    log.info("Louvain communities>=4: %d | NMF k=%d | embedding=%s",
             sum(1 for c in comms if len(c) >= 4), args.k, emb_kind)

    # ---- assemble artifact ----
    def consensus(members):
        cnt = Counter()
        for n in members: cnt.update(vec[antibodies[n]])
        cons = [p for p, x in cnt.items() if x >= 0.4 * len(members)]
        return cnt, cons

    communities_out = []
    for ci, c in enumerate(comms):
        members = list(c)
        cnt, cons = consensus(members)
        communities_out.append({
            "id": ci, "size": len(members),
            "label": label_epitope(cons) if cons else "unassigned",
            "dominant_domain": Counter(domain_of(p) for p in cnt).most_common(1)[0][0] if cnt else None,
            "consensus_positions": sorted(cons),
            "top_positions": [p for p, _ in cnt.most_common(8)],
            "escape_positions": sorted(set(cons) & ESCAPE),
        })
    archetypes_out = []
    for a in range(args.k):
        top = [int(positions[i]) for i in np.argsort(H[a])[::-1][:8]]
        archetypes_out.append({"id": a, "n_dominant": int((dom == a).sum()),
                               "label": label_epitope(top), "top_positions": top})
    antibodies_out = []
    for n, ab in enumerate(antibodies):
        cnt = vec[ab]
        antibodies_out.append({
            "antibody": ab, "community": int(comm_of.get(n, -1)),
            "nmf_dominant": int(dom[n]),
            "nmf_mixture": [round(float(x), 3) for x in mix[n]],
            "x": round(float(emb[n, 0]), 3), "y": round(float(emb[n, 1]), 3),
            "n_epitope_positions": len(cnt),
            "top_positions": [int(p) for p, _ in cnt.most_common(6)],
            "dominant_domain": Counter(domain_of(p) for p in cnt).most_common(1)[0][0] if cnt else None,
        })

    artifact = {
        "meta": {"n_antibodies": len(antibodies), "n_positions": len(positions),
                 "sigma": args.sigma, "threshold": args.threshold, "nmf_k": args.k,
                 "embedding": emb_kind, "reference_structure": ref},
        "communities": communities_out, "archetypes": archetypes_out, "antibodies": antibodies_out,
    }
    with open(args.out, "w") as fh:
        json.dump(artifact, fh, indent=1)
    log.info("wrote %s", args.out)
    for c in communities_out:
        if c["size"] >= 4:
            log.info("  C%d n=%d %-22s escape=%s", c["id"], c["size"], c["label"], c["escape_positions"])


if __name__ == "__main__":
    main()
