#!/usr/bin/env python3
"""Build the assembly-instance similarity dataset for one PDBe-KB complex.

Scores every pair of assembly instances of a complex on global shape (spectral + Zernike
dissimilarity) and derives, for every assembly, the rigid transform that superposes it
onto a single representative assembly -- so the viewer can overlay any subset of them in
one frame.

The pairwise matrix, its seriation ordering, and the clustering all reuse the notebook's own
code (`clustering.py` and `ordering_similarity.py` from the pdbe_complex_clustering repo)
rather than reimplementing it, so this stays faithful to the published method. The defaults
match the notebook's defaults: combined score, average linkage, auto_gap cut.

The similarity page consumes the matrix, the seriation order, the per-assembly metadata and
the transforms. The cluster assignments are computed and emitted as provenance but are not
displayed.

Superposition transforms come from the pairwise TM-align matrices already in the repo
(`<A>/<A>-<B>_transform.txt`). Those are stored upper-triangular only -- one direction per
pair, with A sorting before B -- so roughly half are used as-is (X -> reference) and half
are inverted (reference -> X). Inversion is exact: the matrices are rigid, so R' = R^T and
t' = -R^T t.

Two things about the coordinate frame, both established by measurement (see --validate):

  * The transforms are expressed in the **PDBe assembly frame**, NOT in the frame of the
    `<asm>_transformed.cif` files committed alongside them. Those local files differ from
    the PDBe assembly by a further rigid transform (~57 A translation for 1g0b) and
    applying a stored matrix to them gives RMSDs of ~100 A instead of the ~0.5 A TM-align
    reports. This script therefore fetches assembly coordinates from the PDBe model server
    and ships those.
  * Every pair involving the representative exists directly in the stored set, so no
    transform is ever composed from two others and superposition error cannot accumulate.

Usage:
    python scripts/build_instance_similarity.py --validate
    python scripts/build_instance_similarity.py --complex PDB-CPX-131443 \
        --reference 1ns9_1 --validate
"""
import argparse
import csv
import json
import os
import sys
import urllib.request

import numpy as np

PDBE_API = "https://www.ebi.ac.uk/pdbe/api/v2/pdb/entry"
MODEL_SERVER = "https://www.ebi.ac.uk/pdbe/model-server/v1/{pdb}/assembly?name={asm}&encoding=cif"


# ---------------------------------------------------------------------------
# Clustering (delegated to the notebook's clustering.py)
# ---------------------------------------------------------------------------
def cluster_assemblies(repo, complex_id, score_type, linkage_method):
    """Run the notebook's default pipeline. Returns (labels, matrix, clusters, k, linkage)."""
    sys.path.insert(0, repo)
    import pandas as pd
    from sklearn import cluster as skcluster
    import clustering as C

    tsv = os.path.join(repo, "merged_zernike_spectral_scores.tsv")
    if not os.path.exists(tsv):
        raise SystemExit(f"pairwise scores TSV not found: {tsv}")

    df = pd.read_csv(tsv, sep="\t")
    df = df[df.pdb_complex_id == complex_id].rename(columns={
        "asm1": "asm1_id", "asm2": "asm2_id",
        "score_spectral": "spectral_similarity_score",
        "score_zernike": "zernike_similarity_score",
    })
    if df.empty:
        raise SystemExit(f"no pairwise scores for {complex_id}")

    combined, spectral, zernike, labels = C.compute_combined_scores_matrix_from_df(df)
    matrix = {"combined": combined, "spectral": spectral, "zernike": zernike}[score_type]

    n_missing = int(np.isnan(matrix).sum())
    if n_missing:
        raise SystemExit(f"{n_missing} missing pairs in the {score_type} matrix; refusing to cluster "
                         "an incomplete matrix (same gate as the notebook)")

    # auto_gap: pick k from this complex's own gap statistic, clamped to [2, n-1].
    full_tree = skcluster.AgglomerativeClustering(
        linkage=linkage_method, metric="precomputed", compute_distances=True,
        compute_full_tree=True, distance_threshold=0, n_clusters=None,
    ).fit(matrix)
    k = int(min(max(C.find_optimal_num_clusters(full_tree, matrix, max_k=len(labels), ktype="d"), 2),
                len(labels) - 1))
    clusters, k, link_matrix, _ = C.compute_clusters_from_precomputed_distance(
        matrix, labels, skcluster, linkage_method=linkage_method, no_clusters=k)
    return labels, matrix, clusters, k, link_matrix


def leaf_order(link_matrix, labels):
    """Dendrogram leaf order, so the heatmap reads consistently with the clustering."""
    from scipy.cluster.hierarchy import leaves_list
    return [labels[i] for i in leaves_list(link_matrix)]


def seriation_order(repo, matrix, labels):
    """Tree-penalised path-length seriation order, as the notebook's Section 13 heatmap uses.

    This ordering depends only on the dissimilarity matrix, so it shows the raw similarity
    structure independently of any clustering. Repetition count and seed are copied from the
    notebook so the order here reproduces the order there exactly.
    """
    sys.path.insert(0, repo)
    from ordering_similarity import treePenalizedPathLength
    n = len(labels)
    reps = max(10, min(100, 8000 // n))
    order = list(treePenalizedPathLength(np.asarray(matrix, dtype=float), reps, 39873))
    return [labels[i] for i in order]


# ---------------------------------------------------------------------------
# Transforms
# ---------------------------------------------------------------------------
def read_transform(path):
    """Parse a TM-align matrix file -> (R, t) mapping structure_1 onto structure_2.

    The file tabulates 'm t[m] u[m][0] u[m][1] u[m][2]', applied as X = t + u . x.
    """
    rows = []
    for line in open(path):
        f = line.split()
        if len(f) == 5 and f[0] in ("0", "1", "2"):
            rows.append([float(x) for x in f[1:]])
    if len(rows) != 3:
        raise ValueError(f"could not parse a 3-row matrix from {path}")
    a = np.array(rows)
    return a[:, 1:], a[:, 0]


def invert(R, t):
    """Inverse of a rigid transform: x = R^T (X - t)."""
    Rt = R.T
    return Rt, -Rt @ t


def transform_to_reference(raw_dir, asm, ref):
    """Rigid transform mapping `asm` onto `ref`, plus the sidecar paths used to derive it.

    Stored pairs are upper-triangular (A before B), so exactly one of the two files exists.
    """
    if asm == ref:
        return np.eye(3), np.zeros(3), None, "identity"
    direct = os.path.join(raw_dir, asm, f"{asm}-{ref}_transform.txt")
    if os.path.exists(direct):
        R, t = read_transform(direct)
        return R, t, direct, "direct"
    reverse = os.path.join(raw_dir, ref, f"{ref}-{asm}_transform.txt")
    if os.path.exists(reverse):
        R, t = read_transform(reverse)
        R, t = invert(R, t)
        return R, t, reverse, "inverted"
    raise SystemExit(f"no transform found between {asm} and {ref}")


# ---------------------------------------------------------------------------
# Structures
# ---------------------------------------------------------------------------
def fetch_assembly(pdb_id, asm_id, dest):
    if os.path.exists(dest):
        return False
    url = MODEL_SERVER.format(pdb=pdb_id, asm=asm_id)
    with urllib.request.urlopen(url, timeout=120) as r:
        data = r.read()
    if b"_atom_site" not in data:
        raise SystemExit(f"model server returned no coordinates for {pdb_id} assembly {asm_id}")
    with open(dest, "wb") as fh:
        fh.write(data)
    return True


def write_superposed(src, dest, R, t):
    """Copy an assembly CIF with the rigid transform applied to every atom.

    Baking the superposition into the coordinates keeps the viewer free of matrix maths:
    it just loads files that are already in the reference frame. The transform itself is
    still recorded in the JSON, so the derivation stays inspectable.

    The model server writes a whitespace-delimited atom_site loop with no quoted values
    (verified: 26 columns, zero field-count anomalies across all 20 assemblies), so a
    token-wise rewrite of the three coordinate columns is safe here.
    """
    cols, in_loop, out = [], False, []
    ix = iy = iz = None
    for line in open(src):
        s = line.rstrip("\n")
        st = s.strip()
        if st.startswith("_atom_site."):
            cols.append(st.split(".", 1)[1])
            in_loop = True
            out.append(s)
            continue
        if in_loop and ix is None and cols:
            ix, iy, iz = (cols.index("Cartn_x"), cols.index("Cartn_y"), cols.index("Cartn_z"))
        if in_loop and (st.startswith("ATOM ") or st.startswith("HETATM ")):
            f = st.split()
            if len(f) == len(cols):
                xyz = R @ np.array([float(f[ix]), float(f[iy]), float(f[iz])]) + t
                f[ix], f[iy], f[iz] = (f"{v:.3f}" for v in xyz)
                out.append(" ".join(f))
                continue
        out.append(s)
    with open(dest, "w") as fh:
        fh.write("\n".join(out) + "\n")


def read_ca(path, numbering="label"):
    """{(auth_asym_id, residue number): xyz} for CA atoms, via a minimal atom_site reader.

    Residues are keyed on `label_seq_id` by default -- the canonical, gap-free entity index.
    Author numbering is not comparable across entries of the same protein: 1iwh numbers its
    beta chains 201-346 where every other entry uses 1-146, which silently halves the
    residue correspondence if you match on it.

    Chain ids are normalised to the '-' suffix style used by the *_cc.csv correspondence
    files (the model server writes 'A_2' where those files say 'A-2').
    """
    seq_col = "label_seq_id" if numbering == "label" else "auth_seq_id"
    cols, out, in_loop = [], {}, False
    for line in open(path):
        s = line.strip()
        if s.startswith("_atom_site."):
            cols.append(s.split(".", 1)[1])
            in_loop = True
            continue
        if in_loop and (s.startswith("ATOM ") or s.startswith("HETATM ")):
            f = s.split()
            if len(f) != len(cols):
                continue
            r = dict(zip(cols, f))
            if r.get("label_atom_id") != "CA":
                continue
            key = (r["auth_asym_id"].replace("_", "-"), r[seq_col])
            out[key] = np.array([float(r["Cartn_x"]), float(r["Cartn_y"]), float(r["Cartn_z"])])
    return out


def chain_map(raw_dir, asm, ref):
    """{chain in asm -> chain in ref}, read from whichever *_cc.csv exists for the pair."""
    direct = os.path.join(raw_dir, asm, f"{asm}-{ref}_cc.csv")
    if os.path.exists(direct):
        return {r["asym_id1"]: r["asym_id2"] for r in csv.DictReader(open(direct))}
    reverse = os.path.join(raw_dir, ref, f"{ref}-{asm}_cc.csv")
    if os.path.exists(reverse):
        return {r["asym_id2"]: r["asym_id1"] for r in csv.DictReader(open(reverse))}
    return {}


def reported_rmsd(raw_dir, asm, ref):
    """TM-align's own RMSD and aligned length for the pair, from the scores sidecar."""
    for a, b in ((asm, ref), (ref, asm)):
        p = os.path.join(raw_dir, a, f"{a}-{b}_scores.csv")
        if os.path.exists(p):
            row = next(csv.DictReader(open(p)))
            return float(row["rmsd"]), int(row["aligned_length"])
    return None, None


def validate(raw_dir, cif_dir, asm, ref):
    """Measure the CA RMSD between the shipped superposed files and compare to TM-align.

    This checks the artifact the viewer actually loads, not an intermediate: if the
    transform were wrong, or applied wrongly during the rewrite, the RMSD would diverge
    from the value TM-align reported for the same pair.

    Tries canonical then author residue numbering and keeps whichever pairs up more
    residues, so a single entry's odd numbering can't masquerade as a bad transform.
    """
    cmap = chain_map(raw_dir, asm, ref)
    rep_rmsd, aligned = reported_rmsd(raw_dir, asm, ref)
    best = None
    for numbering in ("label", "auth"):
        A = read_ca(os.path.join(cif_dir, f"{asm}.cif"), numbering)
        B = read_ca(os.path.join(cif_dir, f"{ref}.cif"), numbering)
        pairs = [(v, B[(cmap[k[0]], k[1])]) for k, v in A.items()
                 if k[0] in cmap and (cmap[k[0]], k[1]) in B]
        if best is None or len(pairs) > len(best[1]):
            best = (numbering, pairs)
    numbering, pairs = best
    if not pairs:
        return {"n_matched": 0, "rmsd_applied": None, "rmsd_tmalign": rep_rmsd,
                "aligned_length": aligned, "numbering": numbering}
    P = np.array([p[0] for p in pairs])
    Q = np.array([p[1] for p in pairs])
    return {
        "n_matched": len(pairs),
        "rmsd_applied": round(float(np.sqrt(((P - Q) ** 2).sum(1).mean())), 3),
        "rmsd_tmalign": rep_rmsd,
        "aligned_length": aligned,
        "numbering": numbering,
    }


# ---------------------------------------------------------------------------
# Metadata
# ---------------------------------------------------------------------------
def pdbe_post(endpoint, pdb_ids):
    req = urllib.request.Request(
        f"{PDBE_API}/{endpoint}", data=",".join(pdb_ids).encode(),
        headers={"accept": "application/json", "content-type": "text/plain"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


def entry_metadata(pdb_ids):
    """{pdb_id: {structure_title, resolution, exp_method}} from the PDBe entry API."""
    pdb_ids = sorted(set(pdb_ids))
    experiment, summary = pdbe_post("experiment", pdb_ids), pdbe_post("summary", pdb_ids)
    meta = {}
    for p in pdb_ids:
        e = (experiment.get(p) or [{}])[0]
        s = (summary.get(p) or [{}])[0]
        meta[p] = {
            "structure_title": s.get("title"),
            "resolution": e.get("resolution"),
            "exp_method": e.get("experimental_method_class"),
        }
    return meta


# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--complex", default="PDB-CPX-131443")
    ap.add_argument("--clustering-repo",
                    default=os.path.expanduser("~/desktop/pdbe_complex_clustering"),
                    help="checkout holding clustering.py + merged_zernike_spectral_scores.tsv")
    ap.add_argument("--raw-dir", default=None, help="directory of per-assembly TM-align sidecars")
    ap.add_argument("--reference", default="1ns9_1",
                    help="assembly every other assembly is superposed onto ('auto' = medoid)")
    ap.add_argument("--score-type", default="combined", choices=["combined", "spectral", "zernike"])
    ap.add_argument("--linkage", default="average", choices=["average", "complete", "single"])
    ap.add_argument("--out-dir", default=None)
    ap.add_argument("--validate", action="store_true",
                    help="apply each transform to CA coordinates and check against TM-align's RMSD")
    args = ap.parse_args()

    raw_dir = args.raw_dir or args.complex
    out_dir = args.out_dir or os.path.join("data", "processed", args.complex)
    cif_dir = os.path.join(out_dir, "assemblies")          # superposed, committed, served
    cache_dir = os.path.join("data", "raw", args.complex, "assemblies")  # as fetched; gitignored
    os.makedirs(cif_dir, exist_ok=True)
    os.makedirs(cache_dir, exist_ok=True)

    labels, matrix, clusters, k, link_matrix = cluster_assemblies(
        args.clustering_repo, args.complex, args.score_type, args.linkage)
    print(f"clustered {len(labels)} assemblies into k={k} "
          f"(score={args.score_type}, linkage={args.linkage}, auto_gap)")

    cluster_of = {a: i for i, group in enumerate(clusters, start=1) for a in group}

    # Medoid = lowest mean dissimilarity to everything else; the most central frame to
    # superpose onto, which keeps every transform small.
    mean_dist = matrix.sum(1) / (len(labels) - 1)
    medoid = labels[int(np.argmin(mean_dist))]
    ref = medoid if args.reference == "auto" else args.reference
    if ref not in labels:
        raise SystemExit(f"reference {ref} is not one of the clustered assemblies")
    print(f"reference: {ref}" + (f"  (medoid is {medoid})" if ref != medoid else "  (medoid)"))

    meta = entry_metadata([a.rsplit("_", 1)[0] for a in labels])

    assemblies = []
    for asm in labels:
        pdb_id, asm_id = asm.rsplit("_", 1)
        cached = os.path.join(cache_dir, f"{asm}.cif")
        if fetch_assembly(pdb_id, asm_id, cached):
            print(f"  fetched {asm}")
        R, t, src, kind = transform_to_reference(raw_dir, asm, ref)
        write_superposed(cached, os.path.join(cif_dir, f"{asm}.cif"), R, t)
        rec = {
            "assembly_id": asm,
            "pdb_id": pdb_id,
            **meta[pdb_id],
            "cluster_id": cluster_of[asm],
            "mean_dissimilarity": round(float(mean_dist[labels.index(asm)]), 4),
            # Row-major 3x3 rotation + translation, applied as X = R.x + t.
            "transform": {"rotation": [round(v, 10) for v in R.flatten().tolist()],
                          "translation": [round(v, 10) for v in t.tolist()],
                          "source": os.path.basename(src) if src else None,
                          "derivation": kind},
        }
        assemblies.append(rec)

    # Validation runs only once every superposed file is written -- each assembly is
    # measured against the reference's own superposed file.
    if args.validate:
        for rec in assemblies:
            rec["validation"] = validate(raw_dir, cif_dir, rec["assembly_id"], ref)

    # The page draws the seriation ordering (the notebook's pre-clustering view of the raw
    # similarity structure); the dendrogram leaf order is kept alongside it for reference.
    order = seriation_order(args.clustering_repo, matrix, labels)
    dendro_order = leaf_order(link_matrix, labels)
    payload = {
        "complex_id": args.complex,
        "reference_assembly": ref,
        "method": {
            "score_type": args.score_type,
            "linkage": args.linkage,
            "cut_mode": "auto_gap",
            "n_clusters": k,
            "source": "pdbe_complex_clustering/clustering.py (notebook defaults)",
            "coordinate_source": "PDBe model server assembly coordinates",
        },
        "assemblies": assemblies,
        "heatmap": {
            "order": order,
            "ordering": "tree-penalised path-length seriation (matrix only, pre-clustering)",
            "dendrogram_order": dendro_order,
            "labels": labels,
            "matrix": [[round(float(v), 6) for v in row] for row in matrix],
        },
    }
    out = os.path.join(out_dir, "instance_similarity.json")
    with open(out, "w") as fh:
        json.dump(payload, fh, indent=1)
    print(f"wrote {out}")

    if args.validate:
        bad = []
        print("\nvalidation (applied transform vs TM-align's own RMSD):")
        for rec in assemblies:
            v = rec["validation"]
            if rec["assembly_id"] == ref:
                continue
            delta = (None if v["rmsd_applied"] is None or v["rmsd_tmalign"] is None
                     else abs(v["rmsd_applied"] - v["rmsd_tmalign"]))
            partial = v["aligned_length"] and v["n_matched"] < v["aligned_length"]
            flag = ""
            if delta is None or delta > 0.05:
                flag = "  <-- PARTIAL MATCH" if partial else "  <-- MISMATCH"
                if not partial:
                    bad.append(rec["assembly_id"])
            print(f"  {rec['assembly_id']:8s} {rec['transform']['derivation']:8s} "
                  f"applied={v['rmsd_applied']} tm-align={v['rmsd_tmalign']} "
                  f"matched={v['n_matched']}/{v['aligned_length']}{flag}")
        if bad:
            raise SystemExit(f"\nFAILED: transforms disagree with TM-align for {bad}")
        print("\nall transforms agree with TM-align (differences only where residue "
              "matching is partial, which reflects numbering gaps, not the transform)")


if __name__ == "__main__":
    main()
