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
// Below this many assemblies a group is flagged as small. With average linkage the first cuts
// tend to peel off single odd structures, so a small "group" is more likely an outlier than a
// population, and every figure computed for it rests on a handful of pairs. The same threshold
// gates the percentages in the features panel and the selection summary on the similarity page.
export const SMALL_GROUP = 5
const SMALL_NOTE = `Fewer than ${SMALL_GROUP} assemblies. Likely an outlier rather than a `
  + 'population, and its statistics and associated features rest on very few structures.'

const LARGEST_NOTE = 'Largest refers only to the number of deposited assembly instances in this '
  + 'structural group and does not imply biological importance.'

const REP_NOTE = 'The medoid is the assembly with the smallest average structural distance to the '
  + 'other members of this group.'

const FEATURES_HELP = [
  ['The two percentages', 'PDB entries in the group carrying the feature, then entries outside '
    + 'it. Counted per entry rather than per assembly, so an entry with several assemblies counts '
    + 'once; its features are pooled over them. Hover a feature for the counts.'],
  ['What is listed', `Features differing by ${pct(ENRICH_PP)} points or more. A display threshold, `
    + 'not a test of significance. Nothing here is tested or ranked by evidence.'],
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
              {g.members.length < SMALL_GROUP && (
                <span className="sg-tag sg-tag-warn" title={SMALL_NOTE}>
                  {g.members.length === 1 ? 'single' : 'small'}
                </span>
              )}
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
                : `${hidden.length} more groups · ${plural(hiddenN, 'assembly', 'assemblies')}`
                  + (hidden.every((g) => g.members.length < SMALL_GROUP) ? ' · all small' : '')}
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
          {/* Said in the card, where the figures are, and not only as a badge in the list: a reader
              who arrives at a small group from the table or the tree never saw the badge. */}
          {stats.n < SMALL_GROUP && (
            <p className="cs-notice sg-small-note" role="note">
              {stats.n === 1
                ? 'Single assembly: an outlier rather than a group. No within-group statistics, and '
                  + 'its associated features describe one structure.'
                : `Small group of ${stats.n}: may be an outlier rather than a population. Its `
                  + `statistics rest on ${stats.n * (stats.n - 1) / 2} pair${stats.n === 2 ? '' : 's'} `
                  + `and its associated features on ${stats.n} structures.`}
            </p>
          )}

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

// Which deposited features go with the selected group. The arithmetic is groupFeatures (per PDB
// entry); the rendering follows the similarity page's "Selection composition" so the two read
// alike. Unlike that panel, a group of two or three still gets its features, because the group is
// the unit the page is about; the small-group flag and the counts on hover say what they rest on.
export function AssociatedFeatures({ selection, features, small }) {
  if (!features) return null
  const f = features
  const counts = (d) => `${d.a}/${f.nIn} entries in this group\n${d.c}/${f.nOut} entries outside this group`
  const NAME_MAX = 26
  const chip = (d, name) => {
    const low = name ? name.toLowerCase() : null
    const short = low && low.length > NAME_MAX ? `${low.slice(0, NAME_MAX - 1)}…` : low
    return (
      <span key={d.key} className={`bs-chip ${d.delta > 0 ? 'bs-up' : 'bs-down'}`}
            title={`${name ? `${d.label}: ${name}\n` : ''}${counts(d)}`}>
        <b>{d.label}</b>{short && <span className="bs-lig-name">{short}</span>}
        <span className="bs-nums"><b>{pct(d.inShare)}</b> vs {pct(d.outShare)}</span>
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
        {f.nIn} PDB {f.nIn === 1 ? 'entry' : 'entries'} in this group
        {f.nIn !== f.asmIn && ` (${f.asmIn} assemblies)`}, compared with
        the {f.nOut} outside it{f.nOut !== f.asmOut && ` (${f.asmOut} assemblies)`}.
        {small && ' With so few, read the counts rather than the percentages.'}
      </p>
      {f.noRest ? (
        <p className="bs-note">This group is the whole set, so there is nothing to compare it
          against.</p>
      ) : (
        <div className="bs-grid">
          <Row label="Ligands" hint={LIGAND_NOTE}>
            {f.ligands.length === 0 && none}
            {f.ligands.map((d) => chip(d, f.ligName.get(d.label)))}
          </Row>
          <Row label="Modified residues" hint={MODIFIED_NOTE}>
            {f.modified.length === 0
              ? <span className="bs-note">{f.anyModified ? 'nothing differs' : 'none deposited for this complex'}</span>
              : f.modified.map((d) => chip(d))}
          </Row>
          <Row label="Mutations" hint={MUTATION_NOTE}>
            {f.mutations.length === 0 && none}
            {f.mutations.map((d) => chip(d))}
            {f.initiatorN > 0 && (
              <span className="bs-note"> · {f.initiatorN} with a position-1 substitution,
                {' '}excluded</span>
            )}
          </Row>
        </div>
      )}
    </div>
  )
}
