import React, { useState } from 'react'
import Hint, { helpHint } from '../components/Hint.jsx'
import { ENRICH_PP, LIGAND_NOTE, MUTATION_NOTE, pct } from '../states/BlockSummary.jsx'

// The one sentence the whole page hangs on, worded once and shown wherever a group is named.
export const GROUP_NOTE = 'Structural groups are computationally derived from pairwise structural '
  + 'similarity and do not necessarily correspond to known biological conformational states.'

const GROUPS_HELP = [
  ['Structural groups', GROUP_NOTE],
  ['Colours', 'Each group has one colour, used for its chip, its table cells and the strip '
    + 'beside the dendrogram. It shows membership only. The colours in the matrix are a '
    + 'separate scale and show pairwise dissimilarity.'],
  ['Numbering', 'Groups are numbered by size, largest first.'],
  ['Selecting', 'Click a group here, in the table or beside the dendrogram. Every view follows '
    + 'the same selection.'],
]

const PROVENANCE_NOTE = 'Structural groups were generated using the current clustering '
  + 'configuration. Alternative methods or parameters may produce different groupings.'

// How many groups the picker lists before folding the rest.
const MAX_LISTED = 3

const LARGEST_NOTE = 'Largest refers only to the number of deposited assembly instances in this '
  + 'structural group and does not imply biological importance.'

const REP_NOTE = 'The medoid is the assembly with the smallest average structural distance to the '
  + 'other members of this group.'

const FEATURES_HELP = [
  ['The two percentages', 'Assemblies in the group carrying the feature, then assemblies '
    + 'outside it. Several copies in one assembly count once. Hover a feature for the counts.'],
  ['What is listed', `Features differing by ${pct(ENRICH_PP)} points or more. A display threshold, `
    + 'not a test of significance.'],
  ['Reading it', 'An association describes which structures were deposited. It can support an '
    + 'interpretation of a group and cannot establish one.'],
]

const MODIFIED_NOTE = 'Modified residues as deposited, by chemical component code.'

// Group picker, then what the selected group IS: its size, its representative, how tight it is
// and how far it sits from everything else. Nothing about ligands, mutations or any other
// annotation: those belong to the Associated features panel, and repeating them here gave the page
// two places answering one question.
//
// `selection` is always a structural group. Every figure is in the one quantity the page uses,
// 1 - TM-score, which is what the clustering ran on. RMSD is a different quantity, so
// it rides in the info icon rather than sitting among the numbers the groups were built from.
export function GroupsCard({ clustering, selection, stats, representative, quantity,
                             onSelectGroup, config }) {
  const { groups } = clustering
  const largest = groups[0]
  // The picker lists the largest groups and folds the rest away, so the card stays the height of
  // the table beside it however many groups there are. Groups are numbered by size, so the ones
  // folded are always the smallest. A fold that would hide a single group is not worth its own
  // row, so that group is simply listed.
  const [showAll, setShowAll] = useState(false)
  const folds = groups.length > MAX_LISTED + 1
  const hidden = folds ? groups.slice(MAX_LISTED) : []
  // A group selected from the table or the dendrogram must not be selected out of sight.
  const selectedHidden = hidden.some((g) => g.id === selection.id)
  const open = showAll || selectedHidden
  const listed = folds && !open ? groups.slice(0, MAX_LISTED) : groups
  const hiddenN = hidden.reduce((n, g) => n + g.members.length, 0)
  // The two means are shown to four decimals, and the ratio is the ratio of the figures as shown.
  // At three decimals a tight group's mean kept one significant digit (0.007 for 0.00722), and
  // dividing the numbers on the card gave 15.4 where the card said 14.9. A reader who checks the
  // arithmetic should get the number printed. The maximum is a single pair of values reported to
  // 0.005, so it stays at three.
  const mean = (v) => v.toFixed(4)
  // A group of one has no pairs inside it, so no within-group mean and no ratio.
  const ratio = stats && stats.within != null && stats.between != null
    && Number(mean(stats.within)) > 0
    ? Number(mean(stats.between)) / Number(mean(stats.within)) : null
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
  const input = `pairwise ${quantity} dissimilarity`
  const withinHint = `Pairwise ${quantity} between the members, the quantity the clustering `
    + 'used. Lower is more alike.'
    + (stats && stats.rmsdWithin != null
      ? ` Backbone RMSD between members: ${stats.rmsdWithin.toFixed(2)} Å mean, `
        + `${stats.rmsdMax.toFixed(2)} Å maximum.` : '')
  const betweenHint = `Mean pairwise ${quantity} from the members to every assembly outside `
    + 'this group, all other groups pooled. The ratio divides it by the within-group mean, using '
    + 'the two figures as shown. Higher is less alike, so a large ratio means the group is far '
    + 'more uniform inside than it is like the rest. Not a statistical test.'
  const Block = ({ title, hint, children }) => (
    <div className="sg-block">
      <div className="sg-block-title">{title}{hint && <> <Hint text={hint} width={300} /></>}</div>
      {children}
    </div>
  )
  const Pair = ({ label, value }) => (
    <div className="sg-pair"><span>{label}</span><b>{value}</b></div>
  )
  return (
    <div className="card cs-runsummary sg-groups">
      <h2>Structural groups {helpHint(GROUPS_HELP)}</h2>
      <div className="sg-chips" role="group" aria-label="Structural groups">
        {listed.map((g) => {
          const on = selection.id === g.id
          return (
            <button key={g.id} type="button" className={'sg-chip' + (on ? ' on' : '')}
                    style={{ '--g': g.color }}
                    aria-pressed={on} onClick={() => onSelectGroup(g.id)}>
              <span className="sg-dot" />
              <b>{g.name}</b>
              <span className="sg-chip-n">{plural(g.members.length, 'assembly', 'assemblies')}</span>
              {g.id === largest.id && <span className="sg-tag" title={LARGEST_NOTE}>largest</span>}
            </button>
          )
        })}
      </div>
      {folds && (
        <button type="button" className="sg-more" aria-expanded={open}
                disabled={selectedHidden}
                title={selectedHidden ? 'The selected group is one of these' : undefined}
                onClick={() => setShowAll(!showAll)}>
          {open ? 'Show fewer groups'
                : `${hidden.length} more groups · ${plural(hiddenN, 'assembly', 'assemblies')}`}
        </button>
      )}
      <p className="sg-default-note">Largest group selected by default.</p>

      {stats && (
        <div className="rs-section">
          <div className="rs-section-label">
            Selected structural group
          </div>
          <div className="sg-selected-name">
            {selection.color && <span className="sg-dot" style={{ '--g': selection.color }} />}
            {selection.label}
          </div>
          <div className="sg-selected-sub">
            {plural(stats.n, 'assembly', 'assemblies')} · {plural(stats.entries, 'PDB entry', 'PDB entries')}
          </div>

          <Block title="Representative" hint={REP_NOTE}>
            <div className="sg-rep">
              <span className="mono">{representative}</span>
              <span className="cs-rep">Medoid</span>
            </div>
          </Block>

          <Block title="Within-group similarity" hint={withinHint}>
            {stats.within == null ? <div className="rs-note">Single assembly</div> : (
              <>
                <Pair label={`Mean ${quantity}`} value={mean(stats.within)} />
                <Pair label={`Maximum ${quantity}`} value={stats.withinMax.toFixed(3)} />
              </>
            )}
          </Block>

          {/* Named to pair with "Within-group similarity" above. Both headings say similarity
              while the figures are 1 - TM-score, where larger means LESS alike, so the hints say
              which way the number runs and the ratio is worded without "greater". */}
          {stats.between != null && (
            <Block title="Across-group similarity" hint={betweenHint}>
              <Pair label={`Mean ${quantity}`} value={mean(stats.between)} />
              {ratio && (
                <div className="sg-ratio">
                  {ratio.toFixed(1)}× the within-group mean
                </div>
              )}
            </Block>
          )}
        </div>
      )}

      <details className="sg-details">
        <summary>Clustering details</summary>
        <div className="sg-details-body">
          <Pair label="Method" value={config.method} />
          <Pair label="Linkage" value={config.linkage} />
          <Pair label="Groups" value={groups.length} />
          <Pair label="Input" value={input} />
          <p className="sg-details-note">{PROVENANCE_NOTE}</p>
          <p className="sg-details-note">Other methods and parameters can be tried in the
            analysis notebook.</p>
        </div>
      </details>
    </div>
  )
}

// Which deposited features go with the selected group. The arithmetic is summariseSelection's, the
// same code behind the similarity page's "Selection composition": this is a different rendering
// of it, ordered by the kinds of annotation that help interpret a group.
//
// One deliberate difference: that panel shows nothing below five instances. Here a computed group
// of two or three still gets its features, because the group is the unit the page is about, and
// the counts are stated beside the heading so the percentages cannot pass for more than they are.
export function AssociatedFeatures({ selection, stats, total, anyModified }) {
  if (!stats) return null
  const s = stats
  const nRest = total - s.n
  const scope = 'group'
  const counts = (d) => `${Math.round(d.block * s.n)}/${s.n} assemblies in this ${scope}\n`
    + `${Math.round(d.rest * nRest)}/${nRest} assemblies outside this ${scope}`
  const NAME_MAX = 26
  const chip = (d, dir, name) => {
    const low = name ? name.toLowerCase() : null
    const short = low && low.length > NAME_MAX ? `${low.slice(0, NAME_MAX - 1)}…` : low
    return (
      <span key={d.key} className={`bs-chip ${dir}`}
            title={`${name ? `${d.key}: ${name}\n` : ''}${counts(d)}`}>
        <b>{d.key}</b>{short && <span className="bs-lig-name">{short}</span>}
        <span className="bs-nums"><b>{pct(d.block)}</b> vs {pct(d.rest)}</span>
      </span>
    )
  }
  const none = <span className="bs-note">nothing differs by {pct(ENRICH_PP)} points or more</span>
  const Row = ({ label, hint, children }) => (
    <div className="bs-row">
      <span className="bs-key">{label}{hint && <> <Hint text={hint} width={320} /></>}</span>
      <span className="bs-val">{children}</span>
    </div>
  )
  return (
    <div className="card cs-blocksummary sg-features">
      <h2>
        Associated features {helpHint(FEATURES_HELP, { width: 360 })}
        {/* The same chip the table uses for a group, so the panel is labelled by the thing that was
            clicked. A span, not a button: here it names the group and selects nothing. */}
        <span className="sg-cell on sg-cell-static" style={{ '--g': selection.color }}>
          <span className="sg-dot" />{selection.label}
        </span>
      </h2>
      <p className="note">
        {s.n} {s.n === 1 ? 'assembly' : 'assemblies'} in this {scope}, compared with
        the {nRest} outside it.
        {s.n < 5 && ' With so few assemblies, read the counts rather than the percentages.'}
      </p>
      {s.noRest ? (
        <p className="bs-note">This group is the whole set, so there is nothing to compare it
          against.</p>
      ) : (
        <div className="bs-grid">
          <Row label="Ligands" hint={LIGAND_NOTE}>
            {s.enriched.length + s.depleted.length === 0 && none}
            {s.enriched.map((d) => chip(d, 'bs-up', s.ligName.get(d.key)))}
            {s.depleted.map((d) => chip(d, 'bs-down', s.ligName.get(d.key)))}
          </Row>
          <Row label="Modified residues" hint={MODIFIED_NOTE}>
            {s.modified.length === 0
              ? <span className="bs-note">{anyModified ? 'nothing differs' : 'none deposited for this complex'}</span>
              : s.modified.map((d) => chip(d, 'bs-up'))}
          </Row>
          <Row label="Mutations" hint={MUTATION_NOTE}>
            {s.mutations.length === 0 && none}
            {s.mutations.map((d) => chip(d, 'bs-up'))}
            {s.initiatorN > 0 && (
              <span className="bs-note"> · {s.initiatorN} with a position-1 substitution,
                {' '}excluded</span>
            )}
          </Row>
        </div>
      )}
    </div>
  )
}
