// Structural grouping for the prototype page: agglomerative clustering with average linkage
// (UPGMA) over the pairwise dissimilarity matrix the similarity page already ships.
//
// PROTOTYPE CONFIGURATION. The method, the linkage and the number of groups are fixed choices made
// to demonstrate the page, not the outcome of a benchmark. The eventual PDBe-KB implementation may
// cluster differently and pick the number of groups differently; nothing downstream of this file
// depends on how the tree was built, only on its shape.
//
// Computed in the browser rather than at build time so the page reads the same
// instance_similarity.json as the similarity page, untouched. At n <= 50 (the page's own limit for
// drawing the matrix) the O(n^3) loop below is a few thousand operations.

// A node is { id, left, right, height, leaves } with `leaves` as indices into `labels`, already in
// drawing order. Leaves have left = right = null and height 0.
export function averageLinkage(matrix) {
  const n = matrix.length
  let active = Array.from({ length: n }, (_, i) => (
    { id: i, left: null, right: null, height: 0, leaves: [i] }))
  // Distances between every pair of nodes that ever exists, leaves and merges alike, in one flat
  // array indexed by node id. A map keyed on strings did the same job and took seconds at 341
  // instances, where this takes milliseconds.
  const N = 2 * n - 1
  const dist = new Float64Array(N * N)
  const get = (a, b) => dist[a * N + b]
  const set = (a, b, v) => { dist[a * N + b] = v; dist[b * N + a] = v }
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) set(i, j, matrix[i][j])
  let next = n
  while (active.length > 1) {
    // Closest pair. Strict inequality, so ties go to the first pair met: TM-score is reported to
    // two decimals and ties are common, and the result has to be the same on every load.
    let ba = -1, bb = -1, bd = Infinity
    for (let a = 0; a < active.length; a++) {
      const ia = active[a].id
      for (let b = a + 1; b < active.length; b++) {
        const d = get(ia, active[b].id)
        if (d < bd) { ba = a; bb = b; bd = d }
      }
    }
    const A = active[ba], B = active[bb]
    // Larger child first, then the one holding the lowest index. Either orientation is a valid
    // drawing of the same tree; fixing one keeps the largest group at the top of the matrix.
    const aFirst = A.leaves.length !== B.leaves.length
      ? A.leaves.length > B.leaves.length
      : Math.min(...A.leaves) < Math.min(...B.leaves)
    const [L, R] = aFirst ? [A, B] : [B, A]
    const node = { id: next++, left: L, right: R, height: bd,
                   leaves: [...L.leaves, ...R.leaves] }
    const na = A.leaves.length, nb = B.leaves.length
    for (const C of active) {
      if (C === A || C === B) continue
      // Average linkage: the mean over every cross pair, which for a merged cluster is the
      // size-weighted mean of its two halves' distances.
      set(node.id, C.id, (get(A.id, C.id) * na + get(B.id, C.id) * nb) / (na + nb))
    }
    active = active.filter((x) => x !== A && x !== B).concat(node)
  }
  return active[0]
}

// Cuts the tree into k groups by undoing its k-1 highest merges. Returns the subtrees in drawing
// order plus the height the cut sits at, midway between the lowest merge undone and the highest
// one kept, which is where the dendrogram draws its line.
export function cutTree(root, k) {
  let parts = [root]
  let lowestSplit = null
  while (parts.length < k) {
    let at = -1
    parts.forEach((p, i) => {
      if (p.left && (at < 0 || p.height > parts[at].height)) at = i
    })
    if (at < 0) break                     // fewer instances than groups asked for
    const p = parts[at]
    lowestSplit = lowestSplit == null ? p.height : Math.min(lowestSplit, p.height)
    parts = [...parts.slice(0, at), p.left, p.right, ...parts.slice(at + 1)]
  }
  const highestKept = Math.max(0, ...parts.map((p) => p.height))
  const cutHeight = lowestSplit == null ? root.height : (lowestSplit + highestKept) / 2
  return { parts, cutHeight }
}

// The medoid: the member with the smallest mean distance to the other members. A member of the
// group by construction, so the representative is always a real deposited assembly.
export function medoid(members, matrix) {
  if (members.length === 1) return members[0]
  let best = null
  for (const i of members) {
    let sum = 0
    for (const j of members) if (j !== i) sum += matrix[i][j]
    const mean = sum / (members.length - 1)
    if (best == null || mean < best.mean) best = { i, mean }
  }
  return best.i
}

// One colour per group, by group number: coral, magenta, rust, light cyan, then neutral grey for
// any group past the fourth rather than a generated hue.
//
// Two colour systems share this page and must not be confused. Viridis encodes pairwise
// dissimilarity, a quantity. These encode group membership, an identity. So none of them may look
// like a point on the viridis ramp: no dark purple, no blue-green, no yellow-green. Measured in
// OKLab against the ramp, the nearest is the cyan at dE 10 and the three a three-group page shows
// are 17 to 25 away; the indigo and teal this replaced were 6.6 and 2.3.
//
// Checked with the dataviz palette validator (all pairs, light surface): worst
// colour-vision-deficient separation dE 11.3, worst normal-vision dE 16.3. The cyan sits under 3:1
// against white, so colour never stands alone: every use carries the group's name beside it.
// Used for chips, labels, the strip beside the dendrogram and selection indicators. Never for a
// heatmap cell.
export const GROUP_COLORS = ['#E8685A', '#B0327A', '#8C4A1E', '#3FA7D6']
export const groupColor = (id) => GROUP_COLORS[id - 1] || '#6b7480'

// Everything the page needs, from one matrix: the tree, the leaf order every view shares, and the
// groups. Groups are numbered by size, largest first, and carry no other meaning.
export function structuralGroups(labels, matrix, { nGroups }) {
  const root = averageLinkage(matrix)
  const order = root.leaves.map((i) => labels[i])
  const pos = new Map(root.leaves.map((leaf, p) => [leaf, p]))
  const { parts, cutHeight } = cutTree(root, nGroups)
  const bySize = parts
    .map((node, drawn) => ({ node, drawn }))
    .sort((a, b) => b.node.leaves.length - a.node.leaves.length || a.drawn - b.drawn)
  const groups = bySize.map(({ node }, i) => ({
    id: i + 1,
    name: `Group ${i + 1}`,
    color: groupColor(i + 1),
    node,
    members: node.leaves.map((l) => labels[l]),
    from: pos.get(node.leaves[0]),
    to: pos.get(node.leaves[node.leaves.length - 1]),
    representative: labels[medoid(node.leaves, matrix)],
  }))
  const groupOf = {}
  for (const g of groups) for (const m of g.members) groupOf[m] = g.id
  return { root, order, groups, groupOf, cutHeight, maxHeight: root.height }
}

// The route through the tree from one node to another: up from each to the merge that first joins
// them, that merge included. Returned as a set of node ids. Used to draw how two representatives,
// or the two groups they stand for, are related. Null when either node is not in this tree.
export function pathBetween(root, idA, idB) {
  const chain = (target) => {
    const walk = (node, trail) => {
      const here = [...trail, node.id]
      if (node.id === target) return here
      if (!node.left) return null
      return walk(node.left, here) || walk(node.right, here)
    }
    return walk(root, [])
  }
  const a = chain(idA), b = chain(idB)
  if (!a || !b) return null
  let k = 0
  while (k < a.length && k < b.length && a[k] === b[k]) k++
  return new Set([...a.slice(k - 1), ...b.slice(k)])
}
