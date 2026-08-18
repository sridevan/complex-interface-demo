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
import glob
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

import numpy as np

PDBE_API = "https://www.ebi.ac.uk/pdbe/api/v2/pdb/entry"
MODEL_SERVER = "https://www.ebi.ac.uk/pdbe/model-server/v1/{pdb}/assembly?name={asm}&encoding=cif"
# Fallback coordinate source. PDBe's ModelServer query layer has answered 404 to every request at
# least once (the swagger page kept serving, so it reads as "assembly does not exist" rather than
# as an outage), which stops a build dead. RCSB assembles from the same deposited matrices: atom
# counts were identical on 2atc_1, 3jyc_1, 9bz5_1 and 1ns9_1, spanning four complexes, so this is
# the same construction and not an approximation. PDBe is still tried first.
RCSB_ASSEMBLY = "https://files.rcsb.org/download/{pdb}-assembly{asm}.cif"


# ---------------------------------------------------------------------------
# Per-complex data artefacts, surfaced on the page. These are measured findings, not guesses --
# each was established by comparing atom content, modelled extent and backbone RMSD against the
# shape scores. They belong with the data because the scores cannot be read at face value without
# them: several complexes have instances that are structurally near-identical yet score as
# maximally different.
# ---------------------------------------------------------------------------
# Which measure a complex's notes were made against. Historically every note was a shape-score
# observation and the page said so for all of them; PDB-CPX-106364's notes report TM-score
# separation and rotor geometry as well, so a blanket "measured using the shape measure, may not
# apply to TM-score" would be false there. Default stays "shape".
DATA_NOTES_SCOPE = {"PDB-CPX-106364": "mixed", "PDB-CPX-138641": "mixed",
                    "PDB-CPX-133430": "mixed", "PDB-CPX-128088": "mixed"}

DATA_NOTES = {
    "PDB-CPX-128088": [
        "The two measures disagree on this set, and one of them is wrong. Read it on TM-score. "
        "Grouping the eight state-labelled instances by rotational state gives Cohen's d 1.86 on "
        "TM-score and -0.72 on shape, a negative value meaning instances sharing a state come out "
        "LESS alike than instances that do not. Grouping the same instances by which study "
        "deposited them reverses it: 0.32 on TM-score, 2.02 on shape.",
        "What the shape score is tracking here is reconstruction resolution, not shape. Across the "
        "36 pairs it correlates with backbone RMSD at r = -0.05, which is no relationship at all, "
        "and with the difference in resolution between the two structures at r = +0.46. TM-score "
        "over the same pairs correlates with backbone RMSD at r = +0.96. The two deposition series "
        "sit at different resolutions (5.0-7.5 A for the 5y entries, 3.25-4.3 A for the 6q/6r "
        "entries, 8.7 A for 5tsj), so grouping by resolution and grouping by study are the same "
        "grouping, and shape finds it instead of the biology.",
        "On TM-score the set passes a replication test no other page here can offer. Two "
        "independent studies each labelled rotational states 1, 2 and 3, and the matrix pairs them "
        "across studies rather than within: 5y5x and 6qum (both state 1) sit together, as do 5y60 "
        "and 6r0y (state 3) and 5y5z and 6r0w (state 2), with the 1L and 1R substates of 6r0z and "
        "6r10 falling in the state 1 group. Agreement between separate reconstructions is stronger "
        "evidence than agreement with a single set of labels.",
        "5tsj_1 carries bound VH single-domain antibodies that no other instance has, and at 8.7 A "
        "it is the lowest-resolution structure here. It has no rotational state in its title and "
        "is excluded from the state statistics above, but it is kept in the matrix.",
    ],
    "PDB-CPX-133430": [
        "This is not a set of conformational states. Seventeen of the eighteen instances are "
        "12-subunit Pol II elongation complexes at 3.4 to 4.5 A, and what varies between them is "
        "the nucleic-acid scaffold and the lesion it carries (CPD, cisplatin, an RdRP scaffold, a "
        "hepatitis delta ribozyme), not the conformation of the enzyme. Read it as a set of near "
        "copies with one outlier, not as states.",
        "That outlier, 3j1n_1, is a 16 A cryo-EM map of a preinitiation complex rather than an "
        "elongation complex, and it is disjoint from everything else: every pair involving it "
        "scores 0.195 to 0.210 on 1 - TM-score while every other pair in the set tops out at "
        "0.030. Nothing lies between. It is kept rather than dropped because it is real, but the "
        "matrix should be read as one tight group plus a structure that does not belong to it.",
        "One consequence is worth knowing before reading any colour on this page. The scale runs "
        "linearly to the largest value present, so 3j1n_1 sets the top of the ramp and squeezes "
        "everything else into the bottom: the middle half of all pairs occupies 7.1% of the ramp "
        "on TM-score with it present, against 33.3% without. Drill into the tight group and the "
        "colours will still be scaled to the full set, by design, so read the values rather than "
        "the shades.",
        "The set carries its own positive control. 2ja7_1 and 2ja7_2 are two assemblies of one "
        "entry and should be identical: backbone RMSD between them is 0.09 A and TM-score returns "
        "exactly 0.0000. The shape score returns 0.0684 for the same pair, which is its noise "
        "floor here, and that is 16% of the largest shape value among the other seventeen. Shape "
        "differences below roughly that size are not meaningful on this page.",
        "1nt9_1 was excluded before scoring. It has no spectral descriptor at all, so all 18 of "
        "its pairs were missing from the combined score and the build will not work from an "
        "incomplete matrix. Nineteen assemblies have US-align scores; eighteen are shown.",
    ],
    "PDB-CPX-138641": [
        "The depositors varied two things independently and said so in the entry titles: the "
        "conformation (Resting, Closed, Open, Open-ready) and the sample condition (apo, NADH, "
        "turnover at pH 6, turnover at pH 8, decylubiquinone, piericidin A), across three "
        "detergent preparations. That makes this the one set here carrying its own negative "
        "control, rather than only a grouping to be recovered.",
        "The matrix separates conformation and is blind to sample preparation. Grouping the same "
        "24 instances by conformation gives Cohen's d 1.42 on TM-score and 1.52 on shape; "
        "grouping them by condition gives -0.15 and -0.16, and by detergent 0.26 and -0.03. "
        "Values at or below zero mean instances sharing a condition are no more alike than "
        "instances that do not, so what the view responds to here is structure and not batch.",
        "Four conformations are labelled but the matrix shows two families, not four blocks. "
        "Closed, Open-ready and Open sit 0.008 to 0.015 apart on 1 - TM-score while all three sit "
        "0.033 to 0.048 from Resting, a gap three to five times wider, so they read as one "
        "connected family rather than three groups.",
        "Within that family the order is mechanistic, not arbitrary. Seriation returns Closed, "
        "then Open-ready, then Open, and the distances are close to additive (Closed to Open-ready "
        "0.0100, Open-ready to Open 0.0079, Closed to Open 0.0150 against 0.0179 if the three were "
        "exactly collinear), so Open-ready really does lie between the other two. This is the one "
        "place in this app where a sequence of states, and not just a grouping, comes back out.",
        "Resting is the loose group. Its own instances differ by 0.0183 on average, which is more "
        "than the whole distance from Closed to Open, so it is the most internally varied set on "
        "the page rather than a tight state, and the NuoE variant 9q8i_1 seriates in among its "
        "members rather than apart from them.",
        "Conditions scatter inside every block rather than forming blocks of their own. That "
        "scattering is the negative control made visible: it is what a measure reading "
        "conformation rather than provenance looks like.",
        "Three instances (7nyr_1, 7nyu_1, 7nyv_1) come from a separate study that numbers its "
        "conformations 1 to 3 instead of naming them, and they group together at one end of the "
        "matrix. Whether that block is a genuine conformational difference or an artefact of a "
        "different reconstruction is not something this page can decide, and nothing here should "
        "be read as settling it.",
        "Two assemblies with US-align scores, 9taj_1 and 9tam_1, are absent: they are recent "
        "depositions with no entry yet in the shape-score table this page is built from, and the "
        "build starts there. The 24 instances shown are every one that could be scored on both "
        "measures, not every one deposited.",
    ],
    "PDB-CPX-106364": [
        "Every entry here is a focussed refinement of the F1 head and rotor, not the whole "
        "F-ATP synthase. The comparison covers that region only, so nothing on this page speaks "
        "to the membrane-embedded Fo domain or to the peripheral stalk.",
        "The depositors labelled the states themselves, in the entry titles: three primary rotary "
        "states and their substates (1A-1F, 2A-2D, 3A-3C). That makes this the one set here with "
        "an independent ground truth to check the view against, rather than a grouping read off "
        "the matrix.",
        "Measured against those labels, TM-score separates the three primary states completely: "
        "every within-state pair is more similar than every between-state pair, with no overlap "
        "at all (Cohen's d 6.98). The shape score also recovers them as contiguous blocks but "
        "with overlapping ranges (d 1.47), which is what the atom-content caveat on that measure "
        "predicts for reconstructions of differing modelled extent.",
        "Substate lettering is NOT a rotation sequence, so do not read position within a block as "
        "progress around the cycle. Measuring the rotor's rotation directly (fit the alpha3beta3 "
        "head, then take the residual rotation carrying the rotor over) puts state 1 at "
        "*=115 A=113 B=115 C=117 D=97 E=102 F=107 degrees and state 2 at *=7 A=0 B=17 C=10 D=5: "
        "monotonic in neither. The three primary states sit near 0, 110 and 128 degrees, the ~120 "
        "degree steps expected of a three-fold rotary machine, which is what the blocks are. Those "
        "angles are magnitudes rather than signed rotations about the rotor axis, which is enough "
        "at these separations but would not tell apart opposite rotations of similar size.",
        "No measure on this page resolves the substates, and the reason is dilution rather than "
        "precision. The rotor is 1,266 of 4,506 CA atoms, so a whole-assembly score is dominated "
        "by a head that barely moves: within-state backbone RMSD spans 0.5-2.9 A here, against "
        "0.9-11.3 A when the head is used for the fit and only the rotor is measured. Ordering on "
        "that rotor-only distance recovers the true angular sequence of state 3 exactly, and most "
        "of states 1 and 2, failing only among structures within about 4 degrees of each other, "
        "which is below what a 2.8-4.2 A reconstruction separates.",
        "Coordinates were fetched from RCSB rather than from PDBe. PDBe's ModelServer answered "
        "404 to every request while this was built, including for entries that plainly have the "
        "assembly. RCSB assembles from the same deposited matrices and its atom counts match "
        "PDBe's exactly on four assemblies checked across four other complexes here.",
    ],
    "PDB-CPX-154652": [
        "At 341 instances this is by far the largest set here -- the next largest is ATCase at 58 "
        "-- so the heatmap is drawn without axis labels and identity comes from hovering a cell or "
        "from the instances table, which lists the rows in the same order.",
        "The reference is 1a00_1, not the medoid (1y45_1). Only the reference's own row of "
        "US-align output was available when this was built, and every instance is superposed onto "
        "it; a rebuild against the medoid would give slightly tighter transforms throughout.",
        "Only the shape measure is offered. TM-score needs a score for every pair and 53,539 of "
        "the 57,970 pairs have none, so that metric is omitted rather than shown with holes.",
        "Transforms were checked against the best rigid superposition achievable on the same "
        "residues: 340 of 341 are optimal. The exception is 2m6z_1, an NMR structure, which is "
        "placed at 5.82 A where 3.06 A is achievable, so it will sit visibly off the others in "
        "the 3D view. Every other instance lands between 0.14 and 3.79 A of the reference "
        "(median 1.13 A).",
        "Whether an instance shares the reference's frame was decided from the reference's own "
        "US-align row rather than by partitioning all 57,970 pairs, because only that row was "
        "available. By that test all 341 overlay 1a00_1, so none is flagged. Note four instances "
        "(8vyl_1, 8wj0_1, 8wj1_1, 8wj2_1) fall below TM-score 0.8 against the reference while "
        "still aligning across their full extent -- they fit less tightly, but are not a "
        "separate packing arrangement.",
        "The set is 316 x-ray, 21 EM, 2 NMR and 2 other, spanning 1.25-4.50 A; two instances "
        "have no resolution. Resolution varies far more than in the smaller sets here, so it is "
        "worth checking before reading any pair's dissimilarity as conformational.",
        "DO NOT TRUST the scores for 8wj0_1, 8wj1_1 and 8wj2_1. They were scored upstream on a "
        "structure half again as large as the one shown here. PDBe defines exactly one assembly "
        "for each of these entries -- a four-chain alpha2beta2 tetramer of 566, 566 and 574 "
        "residues, which is what is drawn and superposed -- but the US-align sidecars record 849, "
        "849 and 861 residues, exactly three alpha-beta dimers where the assembly has two. The "
        "ratio is 1.50 for all three. Checked across all 341 instances, these are the only three "
        "where the scored and the displayed structure disagree.",
        "The consequence is that the three sit lower against every other instance than they "
        "should: about a third of what was scored had no counterpart to align to, which alone "
        "accounts for their falling below TM-score 0.8 against the reference. Read their position "
        "in the matrix as an artefact of the comparison, not as conformational difference. Note "
        "8vyl_1 shows the same signature -- a much larger partner and a low reverse TM-score -- "
        "but legitimately: it really is a six-chain nanobody complex of 820 residues, and its "
        "scored and displayed sizes agree.",
        "Whether the shape scores for those three are affected is NOT established. They come from "
        "the same upstream pipeline that produced the sidecars, so if that pipeline built the same "
        "oversized assemblies then their Zernike and spectral values are wrong too and they sit in "
        "the wrong place in this heatmap. That has not been verified either way.",
    ],
    "PDB-CPX-129047": [
        "1llc_1 is one of two assemblies PDBe defines for entry 1llc, neither marked preferred. "
        "Its subunits are arranged asymmetrically (one centroid pair only 23.3 A apart) unlike the "
        "222-symmetric tetramer every other instance shows, so it is likely a crystallographic "
        "rather than biological grouping. It sits 18 A from the reference even at best fit and "
        "scores the highest dissimilarity here. 1llc_2 is the symmetric tetramer of the same entry.",
        "Only 2zqy is labelled T-state by its depositor; four instances are labelled R-state and "
        "six more are unlabelled but group with them. The R/T contrast therefore rests on a single "
        "T-state structure.",
    ],
    "PDB-CPX-137391": [
        "The best-behaved dataset in this collection. Dissimilarity tracks measured backbone RMSD "
        "at r = +0.97, and controlling for modelled-residue count leaves r = +0.98 -- it gets "
        "stronger, not weaker, so the scores here are not a proxy for how much was built. Residue "
        "counts span 2604-2778, only 6% and uncorrelated with the scores (r = -0.17).",
        "The set is cleanly bimodal with no instances in between: 37 T-state structures at "
        "0.04-2.41 A from the reference (dissimilarity 0.19-0.47) and 19 R-state structures at "
        "5.79-6.82 A (0.70-0.81). Both states are named by their depositors -- the 1ra* series is "
        "CTP-ligated T, while 1xjw, 1f1b, 1r0b, 1q95 and 4f04 are labelled R and 8atc/1d09 are PALA "
        "complexes. The reference 1rai_1 is itself a T-state structure.",
        "The engineered intermediate 4e2f (K164E/E239K) lands at 2.41 A and 0.438 -- the very top of "
        "the T group, at the boundary with R -- without the method being told anything about it.",
        "2atc is a 1980s deposition whose residue assignments agree with modern entries at only "
        "~71% of positions, so its comparison uses the 1959 residues that do agree.",
    ],
    "PDB-CPX-130018": [
        "The best-behaved set here: dissimilarity tracks measured backbone RMSD at r = +0.90 "
        "(+0.89 after controlling for modelled-residue count), and residue counts are uniform "
        "(851-874). Differences are small in absolute terms, 0.24-1.06 A, and concentrated around "
        "the active-site loop.",
    ],
    "PDB-CPX-151210": [
        "Four instances (9byh, 9bw3, 9by1, 9bxc) leave almost all of both beta subunits unmodelled "
        "- 1366 residues against 1944, retaining only a ~12-14 residue C-terminal tail. They "
        "superpose on the reference at 0.02-0.39 A, i.e. near-identical, yet score 0.91-0.96 "
        "dissimilarity, close to the maximum.",
        "Across all 40 instances the score correlates with modelled-residue count (r = -0.62) and "
        "not with measured RMSD (r = -0.10). For this complex the heatmap is largely reporting how "
        "much of the model was built rather than its shape.",
    ],
    "PDB-CPX-131443": [
        "Hydrogen content separates the set: the 14 structures with zero hydrogens group together, "
        "while 5c6e (joint X-ray/neutron, with 738 heavy-water atoms), 6sva, 8puq, 8pur and 6r2o "
        "carry 48-54% hydrogens and sit apart. The heme gives it away - 172 atoms without "
        "hydrogens, 292 with.",
        "2zlv is missing a 14-residue loop (beta 43-56) in both beta chains, which is why it "
        "separates despite superposing on the reference at 0.53 A.",
        "Backbone RMSD to the reference is 0.3-2.4 A throughout, so the groupings above reflect "
        "what each deposition contains rather than how the protein is folded.",
    ],
    "PDB-CPX-132237": [
        "These 28 instances fall into five groups (12, 7, 5, 2, 2) with no common rigid "
        "superposition. The split is purely quaternary: the monomers agree at 0.0-3.3 A whichever "
        "groups they come from -- median 0.8 A between groups against 1.1 A within, so monomer "
        "shape does not predict group membership at all -- while the best whole-assembly fit is "
        "0.1-7.0 A within a group and 15.2-33.3 A between them. Only the 12 sharing the "
        "reference's group overlay in the 3D view.",
        "Part of that separation is the crystal-form difference rhodopsin is known for: the "
        "tetragonal P 41 form (1f88, 1hzx, 1l9h, 2g87, 2hpy, 2ped, 3oax), the trigonal P 31 form "
        "(1gzm, 2j4y) and the rhombohedral H 3 opsin form (3cap, 3pxo, 4bez, 5te3, 6fk7) pair "
        "their subunits differently; 1gzm against 1f88 is 23.3 A. Which rhodopsin dimer is "
        "physiological rather than a lattice contact has been argued since the first structures.",
        "But two of the five groups are not crystal-form differences at all -- they are "
        "differences in which contact was annotated as the assembly. Groups 2 and 3 come from the "
        "same P 41 crystals: PDBe defines two dimers each for 1hzx and 1l9h (assemblies 3 and 4), "
        "and 1hzx_3 against 1hzx_4 has identical monomers (0.00 A) with the assemblies 31.2 A "
        "apart. Likewise 7zbc/7zbe and 8a6c/8a6d/8a6e are one crystal form -- space group "
        "P 2 21 21, cells matching within 0.6 A on every axis -- with a single assembly defined "
        "each, yet their monomers agree to 0.25 A while the assemblies differ by 28.3 A. Different "
        "depositions of one lattice had different neighbouring pairs called the dimer.",
        "The reference's group is not one crystal form either, but for the opposite reason: it "
        "holds instances from H 3 (3cap), P 2 21 21 (8a6c, 4.6 A from the reference) and P 31 2 1 "
        "(8fcz, 6.8 A), plus the cryo-EM native dimer 6ofj (4.9 A), which involves no lattice at "
        "all. One arrangement recurring across unrelated lattices and outside a crystal is "
        "suggestive, but only weakly so: those 4.6-6.8 A agreements are far looser than the "
        "0.27-0.29 A between two instances of a single form (3cap against 5te3).",
        "The picosecond time-resolved structures (8a6c/8a6d/8a6e) model hydrogens, and the "
        "nanobody complexes (8fcz/8fd0/8fd1) carry an extra chain (843 residues against 607), both "
        "of which shift their scores independently of conformation.",
    ],
    "PDB-CPX-119152": [
        "The structural variation is large and real: the two apo structures (3jyc, 3spj) sit 9.7 A "
        "from the PIP2-bound reference, consistent with the cytoplasmic-domain movement Kir "
        "channels make on PIP2 binding, and the scores order the set monotonically along it "
        "(0.22 for PIP2-bound through 0.83 for apo).",
        "Extent and conformation are confounded by the biology rather than by any error: PIP2 "
        "binding both changes the shape and orders the tether helix, so PIP2-bound structures also "
        "carry the most modelled residues (1328 against 1284 for apo). Dissimilarity correlates "
        "with measured RMSD at r = +0.83 and with residue count at r = -0.88, and those two are "
        "themselves correlated (r = -0.72). Controlling for residue count leaves r = +0.60, so the "
        "shape signal is not merely a residue count -- but this dataset cannot prove the point, "
        "because both explanations move together. With only 11 instances the estimates are noisy.",
    ],
}

# ---------------------------------------------------------------------------
# Clustering (delegated to the notebook's clustering.py)
# ---------------------------------------------------------------------------
def score_matrix(repo, complex_id, score_type, exclude=()):
    """Pairwise dissimilarity matrix for one complex, straight from the notebook's own combiner.

    `exclude` drops assemblies before the matrix is built. The gate below refuses an incomplete
    matrix, and a single assembly missing one descriptor takes its whole row and column with it --
    on PDB-CPX-133430, 1nt9_1 has no spectral score at all, so 18 of 171 pairs were unusable and
    the build stopped rather than lose one instance. Dropping that instance is the lesser loss, but
    it has to be a deliberate argument and named in the data notes, never a silent repair.
    """
    sys.path.insert(0, repo)
    import pandas as pd
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
    if exclude:
        keep = ~(df.asm1_id.isin(exclude) | df.asm2_id.isin(exclude))
        dropped = sorted(set(df.asm1_id[~keep]) | set(df.asm2_id[~keep]))
        df = df[keep]
        print(f"excluded {len(exclude)} assemblies before scoring: {', '.join(sorted(exclude))}"
              f" (touched rows naming {len(dropped)})")

    combined, spectral, zernike, labels = C.compute_combined_scores_matrix_from_df(df)
    matrix = {"combined": combined, "spectral": spectral, "zernike": zernike}[score_type]

    n_missing = int(np.isnan(matrix).sum())
    if n_missing:
        raise SystemExit(f"{n_missing} missing pairs in the {score_type} matrix; refusing to work "
                         "from an incomplete matrix (same gate as the notebook)")
    return labels, matrix


def cluster_matrix(repo, matrix, labels, linkage_method):
    """auto_gap clustering: pick k from this matrix's own gap statistic, clamped to [2, n-1]."""
    sys.path.insert(0, repo)
    from sklearn import cluster as skcluster
    import clustering as C

    full_tree = skcluster.AgglomerativeClustering(
        linkage=linkage_method, metric="precomputed", compute_distances=True,
        compute_full_tree=True, distance_threshold=0, n_clusters=None,
    ).fit(matrix)
    k = int(min(max(C.find_optimal_num_clusters(full_tree, matrix, max_k=len(labels), ktype="d"), 2),
                len(labels) - 1))
    clusters, k, link_matrix, _ = C.compute_clusters_from_precomputed_distance(
        matrix, labels, skcluster, linkage_method=linkage_method, no_clusters=k)
    return clusters, k, link_matrix


def read_score_row(path):
    """First data row of a US-align scores sidecar, or None if the file is empty or truncated.

    An interrupted copy of the sidecar tree leaves zero-byte files behind. Those carry no score,
    so the pair is simply unknown -- which the callers already handle as a missing pair. Letting
    the CSV reader raise instead would abort a whole build over one truncated file.
    """
    try:
        with open(path) as fh:
            return next(csv.DictReader(fh))
    except StopIteration:
        return None


def superposable_groups(raw_dir, labels, thresh=0.8):
    """Partition assemblies into sets whose members can be superposed AS WHOLE ASSEMBLIES.

    Two assemblies are joined when TM-align aligned at least `thresh` of the smaller one. A
    lower fraction means it could only align part -- typically one chain of a homodimer whose
    two subunits are packed differently between crystal forms. Those assemblies have no common
    rigid superposition at all (measured: ~25 A best-possible, against ~0.5 A per chain), so
    they cannot share a reference frame and belong on separate pages, not the same one.

    Returns groups sorted largest first.
    """
    adj = {a: set() for a in labels}
    known = set(labels)
    for a in labels:
        for path in glob.glob(os.path.join(raw_dir, a, "*_scores.csv")):
            row = read_score_row(path)
            if row is None:
                continue
            x, y = row["asm_id1"], row["asm_id2"]
            if x not in known or y not in known:
                continue
            shorter = min(int(row["length_structure_1"]), int(row["length_structure_2"]))
            if shorter and int(row["aligned_length"]) / shorter >= thresh:
                adj[x].add(y)
                adj[y].add(x)
    seen, groups = set(), []
    for a in labels:
        if a in seen:
            continue
        stack, comp = [a], set()
        while stack:
            b = stack.pop()
            if b in comp:
                continue
            comp.add(b)
            stack.extend(c for c in adj[b] if c not in comp)
        seen |= comp
        groups.append(sorted(comp))
    return sorted(groups, key=len, reverse=True)


def reference_overlap(raw_dir, ref, labels, thresh=0.8):
    """Which assemblies share the reference's frame, judged from the reference's own row alone.

    superposable_groups() needs every pair to partition the set properly. Deciding whether a
    given assembly overlays THE REFERENCE needs only one row of that matrix -- ref vs each other
    -- which is the row a partially-copied sidecar tree is most likely to have in full. Returns
    (overlapping, outside, n_seen) so the caller can tell "not in the reference's frame" from
    "no US-align score present at all".
    """
    known, over, seen = set(labels), {ref}, set()
    for path in glob.glob(os.path.join(raw_dir, ref, "*_scores.csv")):
        row = read_score_row(path)
        if row is None:
            continue
        x, y = row["asm_id1"], row["asm_id2"]
        other = y if x == ref else x
        if other not in known or ref not in (x, y):
            continue
        seen.add(other)
        shorter = min(int(row["length_structure_1"]), int(row["length_structure_2"]))
        if shorter and int(row["aligned_length"]) / shorter >= thresh:
            over.add(other)
    return over, [a for a in labels if a not in over], len(seen)


def tmscore_matrix(raw_dir, labels):
    """Pairwise 1 - TM-score matrix from the TM-align sidecars, or None if any pair is missing.

    Offered alongside the Zernike/spectral shape score because the two behave very differently.
    TM-score is length-normalised, bounded in [0, 1] and down-weights poorly-fitting regions, so it
    is largely blind to the two things that dominate the shape score on these datasets: how much of
    the model was built, and whether hydrogens were deposited (it is computed on CA positions, which
    hydrogens cannot affect). On ATCase it recovers the depositors' own T/R labelling exactly where
    the shape score does not.

    Averages tm_score_1 and tm_score_2 because TM-score is asymmetric -- it is normalised by the
    length of whichever structure is taken as the reference.
    """
    idx = {a: i for i, a in enumerate(labels)}
    n = len(labels)
    M = np.full((n, n), np.nan)
    np.fill_diagonal(M, 0.0)
    for a in labels:
        for path in glob.glob(os.path.join(raw_dir, a, "*_scores.csv")):
            row = read_score_row(path)
            if row is None:
                continue
            x, y = row["asm_id1"], row["asm_id2"]
            if x not in idx or y not in idx:
                continue
            try:
                tm = 1.0 - (float(row["tm_score_1"]) + float(row["tm_score_2"])) / 2
            except (KeyError, ValueError):
                continue
            M[idx[x], idx[y]] = M[idx[y], idx[x]] = max(0.0, tm)
    n_pairs = n * (n - 1) // 2
    have = n_pairs - int(np.isnan(M).sum() / 2)
    if np.isnan(M).any():
        print(f"  (no TM-score metric: {have} of {n_pairs} pairs have a score)")
        return None, have
    return M, have


def rmsd_matrix(raw_dir, labels):
    """Pairwise backbone RMSD from the US-align sidecars, or None if any pair is missing.

    The only measure here in units anyone can reason about: "these two differ by 5.4 A" means
    something, "1 - TM-score = 0.115" does not. It is also the only one that is neither saturated
    nor coarsely quantised. TM-score is normalised by d0, which grows with chain length -- 15.5 A
    for a 2,700-residue assembly -- so a real quaternary rearrangement of a few angstroms barely
    moves it, and what movement there is arrives rounded to two decimals: enolase's whole set
    spans 0.035, which is eight distinct values. Its RMSD spans 0.09-1.79 A.

    Not length-normalised, so RMSD is meaningless BETWEEN complexes -- but every page compares
    instances of one complex, which is exactly where it is the right measure.

    Caveat worth knowing when reading it: a global superposition understates quaternary change,
    because the fit distributes the error across both halves rather than leaving it in the part
    that actually moved.
    """
    idx = {a: i for i, a in enumerate(labels)}
    n = len(labels)
    M = np.full((n, n), np.nan)
    np.fill_diagonal(M, 0.0)
    for a in labels:
        for path in glob.glob(os.path.join(raw_dir, a, "*_scores.csv")):
            row = read_score_row(path)
            if row is None:
                continue
            x, y = row["asm_id1"], row["asm_id2"]
            if x not in idx or y not in idx:
                continue
            try:
                v = float(row["rmsd"])
            except (KeyError, ValueError):
                continue
            M[idx[x], idx[y]] = M[idx[y], idx[x]] = max(0.0, v)
    n_pairs = n * (n - 1) // 2
    have = n_pairs - int(np.isnan(M).sum() / 2)
    if np.isnan(M).any():
        print(f"  (no RMSD metric: {have} of {n_pairs} pairs have a score)")
        return None, have
    return M, have


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
def fetch_assembly(pdb_id, asm_id, dest, attempts=5):
    """Fetch one assembly, retrying the model server's transient failures.

    A complex with a few hundred assemblies is a few hundred consecutive requests, and the model
    server intermittently answers one with a 502/503. Without a retry a single blip throws away
    the whole run; the responses are cached on disk, so a resumed run only re-fetches what is
    genuinely missing. Backoff is exponential and the 4xx family is not retried -- those mean the
    assembly does not exist, and repeating the request will not change that.
    """
    if os.path.exists(dest):
        return False
    data = None
    last = None
    # PDBe first, then RCSB. A 4xx from PDBe is not retried there (repeating will not change it)
    # but it IS worth trying the other source, since PDBe has returned 404 for entries that do
    # have the assembly.
    for source, url in (("pdbe", MODEL_SERVER.format(pdb=pdb_id, asm=asm_id)),
                        ("rcsb", RCSB_ASSEMBLY.format(pdb=pdb_id, asm=asm_id))):
        for attempt in range(attempts):
            try:
                with urllib.request.urlopen(url, timeout=120) as r:
                    data = r.read()
                break
            except urllib.error.HTTPError as e:
                last = e
                if e.code < 500 or attempt == attempts - 1:
                    break
                wait = 2 ** attempt
                print(f"  {pdb_id}_{asm_id}: HTTP {e.code}, retrying in {wait}s "
                      f"({attempt + 1}/{attempts - 1})")
                time.sleep(wait)
            except (urllib.error.URLError, TimeoutError) as e:
                last = e
                if attempt == attempts - 1:
                    break
                wait = 2 ** attempt
                print(f"  {pdb_id}_{asm_id}: {e}, retrying in {wait}s "
                      f"({attempt + 1}/{attempts - 1})")
                time.sleep(wait)
        if data is not None:
            if source == "rcsb":
                print(f"  {pdb_id}_{asm_id}: PDBe unavailable ({last}), fetched from RCSB")
            break
    if data is None:
        raise SystemExit(f"could not fetch {pdb_id} assembly {asm_id} from PDBe or RCSB: {last}")
    if b"_atom_site" not in data:
        raise SystemExit(f"model server returned no coordinates for {pdb_id} assembly {asm_id}")
    with open(dest, "wb") as fh:
        fh.write(data)
    return True


# Columns the viewer never reads; dropping them roughly halves each atom_site line. The SIFTS
# cross-reference block in particular is four columns of UniProt bookkeeping per atom.
DROP_COLS = {"pdbx_sifts_xref_db_name", "pdbx_sifts_xref_db_acc",
             "pdbx_sifts_xref_db_num", "pdbx_sifts_xref_db_res", "pdbx_label_index"}
BACKBONE = {"N", "CA", "C", "O", "OXT"}


def write_superposed(src, dest, R, t, atoms="all"):
    """Copy an assembly CIF with the rigid transform applied to every atom.

    Baking the superposition into the coordinates keeps the viewer free of matrix maths:
    it just loads files that are already in the reference frame. The transform itself is
    still recorded in the JSON, so the derivation stays inspectable.

    The model server writes a whitespace-delimited atom_site loop with no quoted values
    (verified: 26 columns, zero field-count anomalies across every assembly used here), so a
    token-wise rewrite of the three coordinate columns is safe.

    atoms='backbone' keeps only polymer N/CA/C/O(/OXT) and drops HETATM records entirely. The
    page renders a backbone cartoon and nothing else, so this is lossless for what is drawn
    while cutting the shipped bytes several-fold. Use atoms='all' to keep side chains, ligands
    and waters (a larger file, and what the earlier haemoglobin build shipped).

    Only the FIRST model is kept. An NMR entry's assembly carries the whole ensemble -- 2m6z and
    2h35 are 20 models of ~2,300 atoms each -- and without this the viewer draws twenty copies on
    top of one another and every downstream count (atom content, ligand copies) is twenty times
    what it should be. One model is the right comparator against a crystal structure; taking the
    first is the convention the PDB itself uses for a representative.
    """
    cols, in_loop, out = [], False, []
    ix = iy = iz = None
    keep = None            # indices of retained columns, computed once the loop header is read
    i_atom = i_group = i_model = None
    model1 = None          # the first model number seen; every later one is skipped
    for line in open(src):
        s = line.rstrip("\n")
        st = s.strip()
        if st.startswith("_atom_site."):
            name = st.split(".", 1)[1]
            cols.append(name)
            in_loop = True
            continue                                  # header re-emitted below, post-filter
        if in_loop and keep is None and cols:
            keep = [n for n, c in enumerate(cols) if c not in DROP_COLS]
            ix, iy, iz = (cols.index("Cartn_x"), cols.index("Cartn_y"), cols.index("Cartn_z"))
            i_atom, i_group = cols.index("label_atom_id"), cols.index("group_PDB")
            i_model = cols.index("pdbx_PDB_model_num") if "pdbx_PDB_model_num" in cols else None
            out.extend(f"_atom_site.{cols[n]}" for n in keep)
        if in_loop and (st.startswith("ATOM ") or st.startswith("HETATM ")):
            f = st.split()
            if len(f) == len(cols):
                if i_model is not None:
                    if model1 is None:
                        model1 = f[i_model]
                    elif f[i_model] != model1:
                        continue                      # a later NMR model; keep the first only
                if atoms == "backbone" and (f[i_group] != "ATOM" or f[i_atom] not in BACKBONE):
                    continue
                xyz = R @ np.array([float(f[ix]), float(f[iy]), float(f[iz])]) + t
                f[ix], f[iy], f[iz] = (f"{v:.3f}" for v in xyz)
                out.append(" ".join(f[n] for n in keep))
                continue
        out.append(s)
    with open(dest, "w") as fh:
        fh.write("\n".join(out) + "\n")


def ligands_of(path, top=6):
    """Bound components in an assembly, most copies first, waters excluded.

    Blocks in the heatmap usually have a chemical identity -- in ATCase the two blocks are the
    CTP-inhibited and PALA-locked states -- so the page needs ligands to summarise a selection.
    """
    cols, counts, seen, in_loop = [], {}, set(), False
    for line in open(path):
        s = line.strip()
        if s.startswith("_atom_site."):
            cols.append(s.split(".", 1)[1])
            in_loop = True
            continue
        if in_loop and s.startswith("HETATM "):
            f = s.split()
            if len(f) != len(cols):
                continue
            r = dict(zip(cols, f))
            comp = r["label_comp_id"]
            if comp in ("HOH", "DOD"):
                continue
            key = (comp, r["auth_asym_id"], r["auth_seq_id"])
            if key in seen:
                continue
            seen.add(key)
            counts[comp] = counts.get(comp, 0) + 1
    ranked = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    return [{"comp": c, "copies": n} for c, n in ranked[:top]]


def read_chains(path):
    """{auth_asym_id: {label_seq_id(int): (comp_id, xyz)}} for CA atoms.

    Keyed on label_seq_id because it is dense and gap-free within an entity; author numbering
    varies wildly between depositions of the same protein (8a6e numbers rhodopsin 402-809 where
    3cap uses 1-348).
    """
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
            if r.get("label_atom_id") != "CA" or not r["label_seq_id"].isdigit():
                continue
            out.setdefault(r["auth_asym_id"].replace("_", "-"), {})[int(r["label_seq_id"])] = (
                r["label_comp_id"],
                np.array([float(r["Cartn_x"]), float(r["Cartn_y"]), float(r["Cartn_z"])]))
    return out


def align_offset(a_res, b_res, min_overlap=20):
    """Best constant numbering offset between two chains, by residue-name identity.

    Depositions of one protein routinely differ by a constant shift in canonical numbering --
    an expression tag, a retained initiator methionine, a construct starting later. A shift of
    one residue is enough to pair every alpha-carbon with its neighbour and make an identical
    structure look 23 A apart, so the offset has to be recovered rather than assumed to be 0.
    Returns (offset, identity, n_overlap); identity is over the overlapping residues.
    """
    if not a_res or not b_res:
        return 0, 0.0, 0
    lo = min(b_res) - max(a_res)
    hi = max(b_res) - min(a_res)
    best = (0, 0.0, 0)
    for off in range(lo, hi + 1):
        same = total = 0
        for s, (comp, _) in a_res.items():
            other = b_res.get(s + off)
            if other is not None:
                total += 1
                same += comp == other[0]
        if total >= min_overlap:
            ident = same / total
            if (ident, total) > (best[1], best[2]):
                best = (off, ident, total)
    return best


def read_res(path, numbering="auth"):
    """{(auth_asym_id, residue number): (comp_id, xyz)} for CA atoms — read_ca plus residue name."""
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
            out[(r["auth_asym_id"].replace("_", "-"), r[seq_col])] = (
                r["label_comp_id"],
                np.array([float(r["Cartn_x"]), float(r["Cartn_y"]), float(r["Cartn_z"])]))
    return out


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
            row = read_score_row(p)                 # None if the sidecar is empty or truncated
            if row is None:
                continue
            return float(row["rmsd"]), int(row["aligned_length"])
    return None, None


def geometric_chain_map(A, B):
    """Match chains between two already-superposed assemblies by nearest centroid.

    Needed because a correspondence file can name chains the served assembly does not have, and
    because for a symmetric homo-oligomer any symmetry-equivalent relabelling is equally valid --
    geometry is the only thing that can disambiguate which copy landed on which. Uses optimal
    (Hungarian) assignment so a 12-chain complex is tractable where 12! permutations is not.
    """
    if not A or not B or len(A) != len(B) or len(A) > 16:
        return {}
    from scipy.optimize import linear_sum_assignment
    la, lb = sorted(A), sorted(B)
    ca = np.array([np.mean([x for _, x in A[c].values()], axis=0) for c in la])
    cb = np.array([np.mean([x for _, x in B[c].values()], axis=0) for c in lb])
    cost = np.linalg.norm(ca[:, None, :] - cb[None, :, :], axis=2)
    ri, ci = linear_sum_assignment(cost)
    return {la[i]: lb[j] for i, j in zip(ri, ci)}


def kabsch_rmsd(P, Q):
    """RMSD of the OPTIMAL rigid superposition of P onto Q (the best any transform could do)."""
    Pc, Qc = P - P.mean(0), Q - Q.mean(0)
    V, S, Wt = np.linalg.svd(Pc.T @ Qc)
    d = np.sign(np.linalg.det(V @ Wt))
    R = V @ np.diag([1.0, 1.0, d]) @ Wt
    return float(np.sqrt((((Pc @ R) - Qc) ** 2).sum(1).mean()))


def validate(raw_dir, cif_dir, asm, ref):
    """Measure the CA RMSD between the shipped superposed files and judge the superposition.

    This checks the artifact the viewer actually loads, not an intermediate.

    The test is NOT "does this match TM-align's reported RMSD". TM-align reports its number
    over the subset it chose to align, which for some complexes is only one chain of a
    homodimer -- so a transform can be perfectly faithful yet score far worse across the whole
    assembly the viewer renders. The meaningful question is: over the residues we actually
    draw, is this transform as good as ANY rigid transform could be? So compare the applied
    RMSD against the Kabsch-optimal RMSD on the same residue set.

      applied ~= optimal          -> the superposition is the best achievable (pass), even if
                                     that best is poor because the assemblies genuinely differ
      applied  >  optimal         -> the transform superposes something other than what we draw

    Tries canonical then author residue numbering and keeps whichever pairs up more
    residues, so a single entry's odd numbering can't masquerade as a bad transform.
    """
    cmap = chain_map(raw_dir, asm, ref)
    rep_rmsd, aligned = reported_rmsd(raw_dir, asm, ref)
    # Pair residues chain by chain, recovering each chain pair's numbering offset from residue
    # identity. Assuming a zero offset silently pairs neighbouring residues and turns an
    # identical structure into a ~23 A "mismatch" -- see align_offset.
    A = read_chains(os.path.join(cif_dir, f"{asm}.cif"))
    B = read_chains(os.path.join(cif_dir, f"{ref}.cif"))

    # The correspondence file can name chains the served assembly does not have: 1llc's cc.csv
    # numbers assembly 2's chains A-5..A-8 (continuing across the whole entry) while the model
    # server restarts per assembly and calls them A-1..A-4. Nothing overlaps, so fall back to
    # assigning chains geometrically -- the files are already superposed, so the chain of `ref`
    # whose centroid is nearest is the corresponding one. This asks "given this transform, which
    # chain landed on which", and the optimality comparison afterwards uses the same pairing, so
    # it cannot flatter the result.
    geo = geometric_chain_map(A, B)

    def build(mapping):
        """Residue pairs under one chain mapping, offset-aware, keeping only same-residue pairs.

        The identity floor is 0.6, not 0.9: 2atc (a 1980s deposition) shares only ~71% of residue
        assignments with modern entries, yet its chains pair at offset 0 over their full length, so
        the agreeing residues are perfectly good for an RMSD. A frame-shifted mis-pairing sits near
        6-9% identity (see rhodopsin's 8a6e), far below this floor, so it is still rejected.
        """
        out, num, den = [], 0, 0
        for ca, cb in (mapping or {}).items():
            if ca not in A or cb not in B:
                continue
            off, ident, n_over = align_offset(A[ca], B[cb])
            if n_over < 20 or ident < 0.6:
                continue
            for seq, (comp, xyz) in A[ca].items():
                other = B[cb].get(seq + off)
                if other is not None and other[0] == comp:
                    out.append((xyz, other[1]))
                    num += 1
            den += n_over
        return out, ((num / den) if den else 0.0)

    # Symmetry makes the chain correspondence of a homo-oligomer genuinely ambiguous, so take
    # whichever mapping pairs up more residues. They agree whenever cc.csv is right.
    cc_pairs, cc_ident = build(cmap)
    geo_pairs, geo_ident = build(geo)
    if len(geo_pairs) > len(cc_pairs):
        pairs, identity, numbering = geo_pairs, geo_ident, "label+offset (chains matched geometrically)"
    else:
        pairs, identity, numbering = cc_pairs, cc_ident, "label+offset"
    if not pairs:
        return {"n_matched": 0, "rmsd_applied": None, "rmsd_optimal": None,
                "rmsd_tmalign": rep_rmsd, "aligned_length": aligned,
                "numbering": numbering, "residue_identity": 0.0}
    P = np.array([p[0] for p in pairs])
    Q = np.array([p[1] for p in pairs])
    return {
        "n_matched": len(pairs),
        "rmsd_applied": round(float(np.sqrt(((P - Q) ** 2).sum(1).mean())), 3),
        "rmsd_optimal": round(kabsch_rmsd(P, Q), 3),
        "rmsd_tmalign": rep_rmsd,
        "aligned_length": aligned,
        "numbering": numbering,
        "residue_identity": round(identity, 3),
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


def pdbe_post_lenient(endpoint, pdb_ids, chunk=60):
    """pdbe_post, batched, treating "no records" as an empty result rather than a failure.

    Needed for the annotation endpoints. `modified_AA_or_NA` answers a whole 60-entry batch with a
    404 when none of them carry modified residues, and answers a single entry with
    {"message": "Requested endpoint does not contain any data"} rather than the list shape the
    other endpoints return. Without this, one silent 404 drops sixty entries' annotations.
    """
    out = {}
    for i in range(0, len(pdb_ids), chunk):
        batch = pdb_ids[i:i + chunk]
        try:
            got = pdbe_post(endpoint, batch)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                continue                      # nothing in this batch carries the annotation
            raise
        if isinstance(got, dict) and "message" not in got:
            out.update(got)
    return out


def ligand_names(codes, cache_path=os.path.join("data", "processed", "ligand_names.json")):
    """Chemical component id -> name, e.g. CMO -> 'CARBON MONOXIDE'.

    Cached in the repo and shared across complexes: the codes recur (HEM, CMO, OXY appear in every
    haemoglobin set), the names never change, and caching keeps a rebuild offline-repeatable.
    """
    cache = {}
    if os.path.exists(cache_path):
        with open(cache_path) as fh:
            cache = json.load(fh)
    missing = sorted(set(codes) - set(cache))
    # Batched, like the entry endpoints: /pdb/compound/summary/ accepts a POSTed comma-separated
    # list, so a complex with 90 distinct ligands costs one request rather than 90.
    url = f"{PDBE_API.replace('/pdb/entry', '/pdb/compound')}/summary/"
    for i in range(0, len(missing), 200):
        batch = missing[i:i + 200]
        got = {}
        try:
            req = urllib.request.Request(url, data=",".join(batch).encode(),
                                         headers={"accept": "application/json",
                                                  "content-type": "text/plain"})
            with urllib.request.urlopen(req, timeout=120) as r:
                got = json.load(r)
        except Exception:
            pass
        for code in batch:
            rec = (got.get(code) or [{}])[0]
            cache[code] = (rec.get("name") or "").strip() or None   # unknown: shown by id alone
    if missing:
        os.makedirs(os.path.dirname(cache_path), exist_ok=True)
        with open(cache_path, "w") as fh:
            json.dump(dict(sorted(cache.items())), fh, indent=1)
    return cache


def entry_annotations(pdb_ids):
    """Per-entry sequence annotations that give a selected block its chemical identity.

    Both come from PDBe as structured records, so nothing here parses a title. Mutations carry a
    `type`, which matters: on human haemoglobin V1M appears 144 times and is an expression
    artefact, while E6V (24x) is sickle-cell. Reporting them as one count would be meaningless.
    """
    mutated = pdbe_post_lenient("mutated_AA_or_NA", pdb_ids)
    modified = pdbe_post_lenient("modified_AA_or_NA", pdb_ids)
    out = {}
    skipped_labels = []
    for pid in pdb_ids:
        muts = []
        for rec in mutated.get(pid, []):
            det = rec.get("mutation_details") or {}
            if not det.get("from") or not det.get("to"):
                continue
            # author_residue_number is null on some records and f-string formatting turned that into
            # the literal word None, so labels like "MNoneM" reached the page: 15 of them across 5
            # complexes. PDBe supplies residue_number on those same records, so fall back to it.
            # Author numbering is preferred where present because it is what a reader sees in the
            # structure; the two can differ (3jyc has author 370 for residue 335).
            pos = rec.get("author_residue_number")
            if pos is None:
                pos = rec.get("residue_number")
            if pos is None:
                continue
            label = f"{det['from']}{pos}{det['to']}"
            # Guard rather than trust: anything that is not residue-position-residue is dropped, so
            # a change upstream cannot put an unreadable label in front of a reader.
            if not re.fullmatch(r"[A-Z][0-9]+[A-Z]", label):
                skipped_labels.append(f"{pid}:{label}")
                continue
            muts.append({"label": label,
                         "chain": rec.get("chain_id"), "type": det.get("type")})
        mods = []
        for rec in modified.get(pid, []):
            if isinstance(rec, dict) and rec.get("chem_comp_id"):
                mods.append({"comp": rec["chem_comp_id"], "chain": rec.get("chain_id")})
        # Deduplicate: an assembly repeats each entity, so the same substitution appears once per
        # copy and would otherwise be counted several times over.
        seen, uniq = set(), []
        for m in muts:
            key = (m["label"], m["type"])
            if key not in seen:
                seen.add(key)
                uniq.append({"label": m["label"], "type": m["type"]})
        out[pid] = {"mutations": uniq,
                    "modified": sorted({m["comp"] for m in mods})}
    if skipped_labels:
        print(f"  (dropped {len(skipped_labels)} unreadable mutation labels: "
              f"{', '.join(skipped_labels[:5])}{'...' if len(skipped_labels) > 5 else ''})")
    return out


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
    ap.add_argument("--exclude", default="", help="comma-separated assembly ids to drop before "
                    "scoring, for instances whose descriptors are missing and would otherwise "
                    "make the whole matrix incomplete")
    ap.add_argument("--linkage", default="average", choices=["average", "complete", "single"])
    ap.add_argument("--out-dir", default=None)
    ap.add_argument("--overlap-from-reference", action="store_true",
                    help="decide what overlays the reference from the reference's own US-align "
                         "row instead of partitioning every pair; for sidecar trees that hold "
                         "that row in full but not the whole matrix. Needs --reference")
    ap.add_argument("--allow-cross-group", action="store_true",
                    help="keep every instance even when they fall into several packing groups; "
                         "those outside the reference's group are flagged as not superposing")
    ap.add_argument("--largest-superposable-group", action="store_true",
                    help="restrict to the biggest set of assemblies that share a common rigid "
                         "superposition; needed when a complex's assemblies fall into several "
                         "crystal-packing arrangements that no single transform can align")
    ap.add_argument("--atoms", default="backbone", choices=["backbone", "all"],
                    help="what to ship: polymer backbone only (default, what the viewer draws) "
                         "or every atom including side chains, ligands and waters")
    ap.add_argument("--validate", action="store_true",
                    help="apply each transform to CA coordinates and check against TM-align's RMSD")
    args = ap.parse_args()

    raw_dir = args.raw_dir or args.complex
    out_dir = args.out_dir or os.path.join("data", "processed", args.complex)
    cif_dir = os.path.join(out_dir, "assemblies")          # superposed, committed, served
    cache_dir = os.path.join("data", "raw", args.complex, "assemblies")  # as fetched; gitignored
    os.makedirs(cif_dir, exist_ok=True)
    os.makedirs(cache_dir, exist_ok=True)

    excluded = tuple(x.strip() for x in args.exclude.split(",") if x.strip())
    labels, matrix = score_matrix(args.clustering_repo, args.complex, args.score_type, excluded)
    n_total = len(labels)
    subset = None
    if args.overlap_from_reference:
        # Partitioning the whole set needs every pair. Deciding what overlays the REFERENCE needs
        # only the reference's own row, so this mode works on a sidecar tree that holds that row
        # in full but not the rest -- at the cost of not knowing how the non-overlapping
        # instances relate to each other, which the page does not ask.
        if args.reference == "auto":
            raise SystemExit("--overlap-from-reference needs an explicit --reference")
        if args.reference not in labels:
            raise SystemExit(f"reference {args.reference} is not one of the scored assemblies")
        over, outside, n_seen = reference_overlap(raw_dir, args.reference, labels)
        if n_seen < len(labels) - 1:
            raise SystemExit(
                f"--overlap-from-reference needs the reference's full row: {args.reference} has "
                f"US-align scores against {n_seen} of {len(labels) - 1} other assemblies.")
        groups = [sorted(over)] + ([sorted(outside)] if outside else [])
        print(f"overlap judged from {args.reference}'s row only: {len(over)} of {n_total} share "
              f"its frame, {len(outside)} do not")
        if outside:
            subset = {"applied": False, "kept": n_total, "of": n_total,
                      "group_sizes": [len(g) for g in groups],
                      "reason": "instances outside the reference's group have no common rigid "
                                "superposition with it (they differ in quaternary arrangement, "
                                "typically crystal packing) and will not overlay"}
        groups_are_partition = False
    else:
        groups = superposable_groups(raw_dir, labels)
        groups_are_partition = True
    if groups_are_partition and len(groups) > 1:
        sizes = ", ".join(str(len(g)) for g in groups)
        print(f"NOTE: these {n_total} assemblies fall into {len(groups)} groups that cannot be "
              f"superposed onto one another (sizes {sizes}).")
        if not (args.largest_superposable_group or args.allow_cross_group):
            raise SystemExit(
                "No single reference frame covers them all. Re-run with "
                "--largest-superposable-group to build the biggest coherent set, or "
                "--allow-cross-group to keep every instance and accept that those outside the "
                "reference's group will not superpose, or investigate why the assemblies differ "
                "(usually crystal packing of a non-biological dimer).")
    if groups_are_partition and len(groups) > 1 and args.allow_cross_group:
        # Keep every instance. Only the reference's own group superposes; the rest are shipped
        # with their transform applied but land in a different frame, and are flagged so the page
        # can say so rather than quietly showing a broken overlay.
        subset = {"applied": False, "kept": n_total, "of": n_total,
                  "group_sizes": [len(g) for g in groups],
                  "reason": "instances outside the reference's group have no common rigid "
                            "superposition with it (they differ in quaternary arrangement, "
                            "typically crystal packing) and will not overlay"}
        print(f"keeping all {n_total} assemblies; only the reference's group will superpose")
    elif groups_are_partition and len(groups) > 1:
        keep = groups[0]
        idx = [labels.index(a) for a in keep]
        matrix = matrix[np.ix_(idx, idx)]
        labels = keep
        subset = {"applied": True, "kept": len(keep), "of": n_total,
                  "group_sizes": [len(g) for g in groups],
                  "reason": "assemblies outside this group have no common rigid superposition "
                            "(they differ in quaternary arrangement, typically crystal packing)"}
        print(f"restricted to the largest group: {len(keep)} of {n_total} assemblies")

    clusters, k, link_matrix = cluster_matrix(args.clustering_repo, matrix, labels, args.linkage)
    print(f"clustered {len(labels)} assemblies into k={k} "
          f"(score={args.score_type}, linkage={args.linkage}, auto_gap)")

    cluster_of = {a: i for i, group in enumerate(clusters, start=1) for a in group}

    # Medoid = lowest mean dissimilarity to everything else; the most central frame to
    # superpose onto, which keeps every transform small.
    mean_dist = matrix.sum(1) / (len(labels) - 1)
    if len(groups) > 1 and (args.allow_cross_group or args.overlap_from_reference):
        # Restrict the medoid to the biggest group: any reference outside it would superpose
        # fewer instances than necessary.
        pool = [labels.index(a) for a in groups[0] if a in labels]
        medoid = labels[pool[int(np.argmin(mean_dist[pool]))]]
    else:
        medoid = labels[int(np.argmin(mean_dist))]
    ref = medoid if args.reference == "auto" else args.reference
    if ref not in labels:
        raise SystemExit(f"reference {ref} is not one of the clustered assemblies")
    print(f"reference: {ref}" + (f"  (medoid is {medoid})" if ref != medoid else "  (medoid)"))

    entry_ids = sorted({a.rsplit("_", 1)[0] for a in labels})
    meta = entry_metadata([a.rsplit("_", 1)[0] for a in labels])
    # Sequence annotations, so a selected block can be described by what is actually bound to it
    # and what differs in its sequence rather than by anything read out of a title.
    annot = entry_annotations(entry_ids)
    print(f"annotations: {sum(1 for v in annot.values() if v['mutations'])} of {len(entry_ids)} "
          f"entries carry mutations, "
          f"{sum(1 for v in annot.values() if v['modified'])} carry modified residues")

    assemblies = []
    for asm in labels:
        pdb_id, asm_id = asm.rsplit("_", 1)
        cached = os.path.join(cache_dir, f"{asm}.cif")
        if fetch_assembly(pdb_id, asm_id, cached):
            print(f"  fetched {asm}")
        R, t, src, kind = transform_to_reference(raw_dir, asm, ref)
        write_superposed(cached, os.path.join(cif_dir, f"{asm}.cif"), R, t, args.atoms)
        rec = {
            "assembly_id": asm,
            "pdb_id": pdb_id,
            **meta[pdb_id],
            "cluster_id": cluster_of[asm],
            "packing_group": next((i for i, g in enumerate(groups, 1) if asm in g), None),
            "superposes_with_reference": any(asm in g and ref in g for g in groups),
            "mean_dissimilarity": round(float(mean_dist[labels.index(asm)]), 4),
            "ligands": ligands_of(cached),
            # Per-ENTRY annotations, repeated onto each of that entry's assemblies. Both are
            # structured PDBe records; nothing here is inferred from a title.
            "mutations": annot.get(pdb_id, {}).get("mutations", []),
            "modified": annot.get(pdb_id, {}).get("modified", []),
            # Row-major 3x3 rotation + translation, applied as X = R.x + t.
            "transform": {"rotation": [round(v, 10) for v in R.flatten().tolist()],
                          "translation": [round(v, 10) for v in t.tolist()],
                          "source": os.path.basename(src) if src else None,
                          "derivation": kind},
        }
        assemblies.append(rec)

    # Chemical names for every ligand code in this complex, so a block summary can say "carbon
    # monoxide" rather than "CMO". Fetched once and cached in the repo across complexes.
    names = ligand_names({l["comp"] for rec in assemblies for l in rec["ligands"]}
                         | {c for rec in assemblies for c in rec["modified"]})
    for rec in assemblies:
        for l in rec["ligands"]:
            if names.get(l["comp"]):
                l["name"] = names[l["comp"]]
        rec["modified"] = [{"comp": c, "name": names.get(c)} for c in rec["modified"]]

    # Validation runs only once every superposed file is written -- each assembly is
    # measured against the reference's own superposed file.
    if args.validate:
        for rec in assemblies:
            rec["validation"] = validate(raw_dir, cif_dir, rec["assembly_id"], ref)

    # The page draws the seriation ordering (the notebook's pre-clustering view of the raw
    # similarity structure); the dendrogram leaf order is kept alongside it for reference.
    order = seriation_order(args.clustering_repo, matrix, labels)
    dendro_order = leaf_order(link_matrix, labels)

    # Each metric gets its own seriation ordering: the ordering is derived from the matrix, so
    # reusing the shape ordering for TM-score would misrepresent it.
    metrics = {"shape": {
        "label": f"Shape ({args.score_type} Zernike + spectral)",
        "cell_label": "dissimilarity",
        "order": order,
        "matrix": [[round(float(v), 6) for v in row] for row in matrix],
    }}
    tm, tm_have = tmscore_matrix(raw_dir, labels)
    if tm is not None:
        metrics["tmscore"] = {
            "label": "Structural (1 \u2212 TM-score)",
            "cell_label": "1 \u2212 TM-score",
            "order": seriation_order(args.clustering_repo, tm, labels),
            "matrix": [[round(float(v), 6) for v in row] for row in tm],
        }
    # RMSD rides along as an ANNOTATION, not as a selectable measure: it is shown for whichever
    # pair the reader hovers, in angstroms, alongside whatever measure is driving the colours.
    #
    # It is deliberately not a measure of its own. Measured on ATCase against the depositors' own
    # T/R labels, its seriation is the most fragmented of the three -- longest contiguous T block
    # 15 of 26, against TM-score's 23 -- because a global RMSD is dominated by the largest
    # displacements, so instances differing for reasons other than state (a disordered loop, a
    # slightly different modelled extent) get pulled apart in the ordering. Best number to read,
    # worst to order by.
    rm, rm_have = rmsd_matrix(raw_dir, labels)
    rmsd_block = None if rm is None else {
        "label": "Backbone RMSD after superposition (US-align)",
        "cell_label": "RMSD",
        "unit": "\u00c5",
        # 2 dp is what US-align reports; keeping more would invent precision.
        "matrix": [[round(float(v), 2) for v in row] for row in rm],
    }
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
            "atoms_shipped": args.atoms,
        },
        "subset": subset,
        "data_notes": DATA_NOTES.get(args.complex, []),
        "data_notes_scope": DATA_NOTES_SCOPE.get(args.complex, "shape"),
        "assemblies": assemblies,
        "heatmap": {
            "labels": labels,
            "ordering": "tree-penalised path-length seriation (matrix only, pre-clustering)",
            "dendrogram_order": dendro_order,
            # TM-score first where a dataset has it: measured on ATCase against the depositors'
            # own T/R labels it separates the states best of the three (Cohen's d 1.81, and the
            # least fragmented seriation). Shape is the fallback.
            "default_metric": next(m for m in ("tmscore", "shape") if m in metrics),
            # What was ATTEMPTED, not only what succeeded. A measure computed and then dropped for
            # being incomplete used to vanish without trace, which left the page looking as though
            # only one measure had ever been intended. Recording the pair counts lets it say that
            # TM-score was tried and covers 4,431 of 57,970 pairs, rather than silently omitting it.
            "coverage": {
                "pairs": len(labels) * (len(labels) - 1) // 2,
                "metrics": {
                    "shape": {"pairs": len(labels) * (len(labels) - 1) // 2, "shown": True},
                    "tmscore": {"pairs": tm_have, "shown": tm is not None},
                    "rmsd": {"pairs": rm_have, "shown": False, "per_pair": rmsd_block is not None},
                },
            },
            # Per-pair RMSD in angstroms, shown on hover alongside whichever measure is selected.
            # Null when the sidecars are incomplete, exactly as the measures are.
            "rmsd": rmsd_block,
            "metrics": metrics,
        },
    }
    out = os.path.join(out_dir, "instance_similarity.json")
    with open(out, "w") as fh:
        json.dump(payload, fh, indent=1)
    print(f"wrote {out}")

    if args.validate:
        bad = []
        print("\nvalidation — applied RMSD vs the best any rigid transform could achieve on the "
              "same residues:")
        for rec in assemblies:
            v = rec["validation"]
            if rec["assembly_id"] == ref:
                continue
            applied, best = v["rmsd_applied"], v["rmsd_optimal"]
            # An instance outside the reference's packing group is EXPECTED not to overlay: that
            # is the documented consequence of --allow-cross-group, not a defect. Only instances
            # sharing the reference's frame are held to the optimality test.
            same_frame = rec.get("superposes_with_reference", True)
            if applied is None or best is None:
                flag = "  <-- NO OVERLAP"
            # TM-align optimises TM-score, not plain RMSD, so its transform sits a few percent
            # above the Kabsch optimum even when it is perfectly good. The failure we care about
            # is the other regime -- a transform that superposes one chain of a homodimer while
            # the rest flies apart, which runs 2x the optimum or worse.
            elif applied > best * 1.25 and applied > best + 1.0:
                flag = "  <-- NOT THE BEST FIT"
            else:
                flag = ""
            if flag and same_frame:
                bad.append(rec["assembly_id"])
            if not same_frame:
                flag = f"  [packing group {rec.get('packing_group')} — does not overlay the reference]"
            frac = (v["aligned_length"] / v["n_matched"]) if v["n_matched"] else 0
            note = f"  [TM-align aligned {frac:.0%} of what we draw]" if frac < 0.9 else ""
            if not flag and applied is not None and applied > 5:
                note += "  [loose fit: these assemblies genuinely differ]"
            print(f"  {rec['assembly_id']:9s} {rec['transform']['derivation']:8s} "
                  f"applied={applied} optimal={best} tm-align={v['rmsd_tmalign']} "
                  f"matched={v['n_matched']}{flag}{note}")
        if bad:
            raise SystemExit(
                f"\nFAILED for {bad}: the stored transform is not the best rigid superposition of "
                "the residues being rendered. This happens when TM-align aligned only part of the "
                "assembly (e.g. one chain of a homodimer), which means no single transform "
                "superposes these assemblies -- they differ in quaternary arrangement.")
        print("\nevery transform is the best rigid superposition achievable for the residues "
              "rendered")


if __name__ == "__main__":
    main()
