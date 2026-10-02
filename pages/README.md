# Pre-built standalone pages

Each directory here is a finished static site that is published as-is under the demo's base path:
`pages/<name>/` becomes `https://sridevan.github.io/complex-interface-demo/<name>/`.
`app-react/scripts/sync-data.mjs` copies the directories into `app-react/public/` before every
build, so they need no build step of their own and use relative URLs throughout.

| Directory | What it is | Source |
|---|---|---|
| `structural-comparison/` | Prototype: structural comparison between two structural groups of human haemoglobin (PDB-CPX-154652, T state vs R state). Two views: a structural profile (displacement and local deformation per residue) and a distance-difference map, each linked to Mol*. | Built with `npm run build` from the separate `res_pairwise_comparison_prototype/app` project (Vite, React, Mol*); not built from this repository. To update, rebuild there and replace the directory. |
