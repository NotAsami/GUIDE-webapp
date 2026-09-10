// The Story screen's geometry and its thread sources. Pure functions, in lib/
// with a test beside them, because a leader that misses its node by four pixels
// looks like a rendering quirk rather than a bug and nobody would ever chase it.
//
// ONE COORDINATE SPACE. The screen is a fixed BODY_H-tall canvas (it scrolls on
// a short viewport — "the viewport is a minimum, not a maximum"), so every mark
// is a compile-time number rather than a measurement: no ResizeObserver, no
// layout read, nothing to keep in sync on resize. The lattice is a fixed 640px
// square bled off the left edge; the dossier is pinned at COL and absorbs all
// horizontal slack to its right, which is why the leader runs never change.

import type {
  CharacterRow, ProgressStory, QuestObjective, QuestRow, QuestStatus, RelatedTag, Relation,
} from './database.types'

/* NO CANVAS HEIGHT CONSTANT. The body sizes to whatever the chrome leaves it,
   with the --screen-min-h floor, because none of the geometry below depends on
   it: the lattice is anchored to the TOP and the rows to ROWS_TOP, so both are
   fixed whatever the container's height turns out to be. Measured live, the
   real box is 472px on a 746px viewport — the topbar, dock nav and bottombar
   take 274px between them — against the 788px the design was drawn at. A fixed
   660px canvas put the whole reading half below the fold. */
/** Lattice square — the same 640px the Codex's own sigil uses. */
export const LAT = { left: -150, top: 10, size: 640 } as const
export const CX = LAT.left + LAT.size / 2   // 170
export const CY = LAT.top + LAT.size / 2    // 330
export const R_ARC = 250                    // the progress ring
export const R_NODE = 220                   // where a thread's node sits
export const R_EXIT = 285                   // where its leader breaks to horizontal
/** Left edge of the dossier, and so the end of every leader run. */
export const COL = 520
/** Where the two column headings sit, and how tall that band is. ROWS_TOP is
 *  DERIVED from them rather than typed twice: the headings are a grid row above
 *  the rows, so if that band changes height the rows must follow or every
 *  leader misses its title. storyLattice.test.ts holds them together. */
export const HEADS_TOP = 86
export const HEAD_H = 22
export const ROWS_TOP = HEADS_TOP + HEAD_H
export const ROW_H = 92
/** A row is 30px tall at the top and its title is centred in that, so the line a
 *  leader docks onto sits this far into the row. */
export const TITLE_OFF = 15

const rad = (deg: number) => (deg * Math.PI) / 180

/** The y a thread's title line occupies, which is the y its leader must reach. */
export const rowY = (i: number) => ROWS_TOP + i * ROW_H + TITLE_OFF

export interface Wire { nx: number; ny: number; ex: number; ey: number }

/** Solve a thread's node and leader break-point from the row it occupies.
 *
 *  The angle is DERIVED rather than hand-picked, so this holds for any number of
 *  threads instead of exactly the three the design was drawn with. Past the
 *  ring's vertical reach asin has no answer: return null and let the row list
 *  without a node, which is honest degradation rather than a NaN in the markup. */
export function solve(y: number): Wire | null {
  const sin = (y - CY) / R_EXIT
  if (sin < -1 || sin > 1) return null
  const theta = Math.asin(sin)
  return {
    nx: CX + R_NODE * Math.cos(theta),
    ny: CY + R_NODE * Math.sin(theta),
    ex: CX + R_EXIT * Math.cos(theta),
    ey: y,
  }
}

/** The progress ring, swept clockwise from the top. */
export function arcPath(percent: number): string | null {
  const p = Math.max(0, Math.min(100, percent))
  if (p <= 0) return null
  // A 360° arc starts and ends at the same point, which an `A` command collapses
  // to nothing — a finished story draws as a closed ring instead.
  if (p >= 99.95) {
    return `M ${CX} ${CY - R_ARC} A ${R_ARC} ${R_ARC} 0 1 1 ${CX - 0.01} ${CY - R_ARC} Z`
  }
  const sweep = (p / 100) * 360
  const end = rad(-90 + sweep)
  return `M ${CX} ${CY - R_ARC} A ${R_ARC} ${R_ARC} 0 ${sweep > 180 ? 1 : 0} 1 `
    + `${(CX + R_ARC * Math.cos(end)).toFixed(2)} ${(CY + R_ARC * Math.sin(end)).toFixed(2)}`
}

export type Tone = 'current' | 'active' | 'closed'
export interface Thread { id: string; title: string; meta: string; tone: Tone }

const slug = (s: string) => s.toLowerCase().replace(/\s+/g, '-')

/** What a story card's threads ARE depends on its emblem, and each emblem
 *  already has a natural source in content the DM authors today — which is why
 *  no join column exists between `progress.stories[]` and `quests`, and why none
 *  is needed:
 *
 *    main      → the campaign's main quests
 *    region    → the distinct locations those quests name (there is no locations
 *                table; the card's own percent stays the authored number)
 *    character → this character's relations, from `lore`
 *
 *  KNOWN LIMIT: a second card of the same emblem repeats the first's threads,
 *  because nothing distinguishes them. The fix, if it ever bites, is a nullable
 *  `quests.story_id` plus a picker in the console's quest form — not worth a
 *  migration until someone actually wants two cards of one kind. */
export function threadsFor(story: ProgressStory, quests: QuestRow[], character: CharacterRow): Thread[] {
  if (story.emblem === 'main') {
    // Active first, then failed, then completed — and a stable sort keeps
    // useCampaign's created_at order inside each group, so a DM edit never
    // reshuffles the list under the player.
    const rank = (q: QuestRow) => (q.status === 'active' ? 0 : q.status === 'failed' ? 1 : 2)
    return quests
      .filter(q => q.type === 'main')
      .slice()
      .sort((a, b) => rank(a) - rank(b))
      .map((q, i) => {
        const done = q.objectives.filter(o => o.done).length
        const bits = [q.location, q.given_by].filter(Boolean)
        if (q.objectives.length > 0) bits.push(`Obj ${done} / ${q.objectives.length}`)
        return {
          id: q.id,
          title: q.title,
          meta: bits.join(' · '),
          tone: q.status !== 'active' ? 'closed' : i === 0 ? 'current' : 'active',
        }
      })
  }

  if (story.emblem === 'region') {
    const seen = new Map<string, number>()
    for (const q of quests) {
      const loc = q.location.trim()
      if (loc) seen.set(loc, (seen.get(loc) ?? 0) + 1)
    }
    return [...seen.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([loc, n], i) => ({
        id: slug(loc),
        title: loc,
        meta: `${n} ${n === 1 ? 'quest' : 'quests'} logged`,
        tone: i === 0 ? 'current' : 'active',
      }))
  }

  const relations: Relation[] = character.lore?.relations ?? []
  return relations.map((r, i) => ({
    id: slug(r.name),
    title: r.name,
    meta: [r.type, r.attitude ?? 'unknown'].join(' · '),
    tone: i === 0 ? 'current' : 'active',
  }))
}

/* ============================================================
   THE THREAD DEPTH — /story/:storyId/:threadId

   One record shape for all three emblems rather than three renderers: each
   fills the fields it has and leaves the rest empty, so the screen has a single
   code path and an emblem that carries no objectives simply shows none.
   ============================================================ */

export interface ThreadRecord {
  title: string
  /** What KIND of thing this is — "Main Quest", "Location", "Relation". */
  kicker: string
  status: string | null
  meta: { k: string; v: string }[]
  /** Markdown. MUST render through <Prose>, never printed raw — quest
   *  descriptions are authored in a markdownShortcuts textarea and
   *  proseFields.test.ts guards exactly this. */
  body: string
  objectives: QuestObjective[]
  related: RelatedTag[]
  /** Whatever else belongs to this thread — the quests at a location. */
  links: { id: string; title: string; meta: string }[]
}

/** Rows written before Related tags carried a `url` are plain strings, so every
 *  reader must accept both shapes. Same normalisation the Journal does. */
const toTag = (r: RelatedTag | string): RelatedTag => (typeof r === 'string' ? { name: r } : r)

const STATUS: Record<QuestStatus, string> = { active: 'Active', completed: 'Completed', failed: 'Failed' }

/** The record behind one thread, or null when the id matches nothing — a thread
 *  the DM deleted, or a hand-typed URL. The caller redirects rather than
 *  rendering an empty husk. */
export function recordFor(
  story: ProgressStory, threadId: string, quests: QuestRow[], character: CharacterRow,
): ThreadRecord | null {
  const blank = { status: null, meta: [], body: '', objectives: [], related: [], links: [] }

  if (story.emblem === 'main') {
    const q = quests.find(x => x.id === threadId && x.type === 'main')
    if (!q) return null
    return {
      ...blank,
      title: q.title,
      kicker: 'Main Quest',
      status: STATUS[q.status],
      meta: [
        ...(q.given_by ? [{ k: 'Given by', v: q.given_by }] : []),
        ...(q.location ? [{ k: 'Location', v: q.location }] : []),
      ],
      body: q.description,
      objectives: q.objectives,
      related: q.related.map(toTag),
    }
  }

  if (story.emblem === 'region') {
    const here = quests.filter(q => slug(q.location.trim()) === threadId && q.location.trim())
    if (here.length === 0) return null
    const open = here.filter(q => q.status === 'active').length
    return {
      ...blank,
      title: here[0].location.trim(),
      kicker: 'Location',
      status: `${open} open`,
      meta: [{ k: 'Logged', v: `${here.length} ${here.length === 1 ? 'quest' : 'quests'}` }],
      // No locations table, so a place has no description of its own — what is
      // genuinely known about it is which quests name it.
      links: here.map(q => ({
        id: q.id,
        title: q.title,
        meta: [STATUS[q.status], q.type === 'main' ? 'Main' : 'Side', q.given_by].filter(Boolean).join(' · '),
      })),
    }
  }

  const r = (character.lore?.relations ?? []).find(x => slug(x.name) === threadId)
  if (!r) return null
  return {
    ...blank,
    title: r.name,
    kicker: 'Relation',
    status: r.attitude ? r.attitude[0].toUpperCase() + r.attitude.slice(1) : '—',
    meta: [{ k: 'Type', v: r.type }],
    body: r.desc,
  }
}

/* ============================================================
   THE ZOOM — what the thread depth does to the instrument.

   The obvious way to do this is to centre the focused node on the lattice's own
   middle, and it is the wrong way: at 472px of canvas that throws the other
   nodes clean off the bottom. Landing it on a focal point that TRACKS ITS OWN
   ROW instead keeps the whole cluster on screen (measured: x 101-319, y 28-298
   across all three), and it makes the focused leader a fixed 248px run whatever
   thread is open, so nothing can ever fall out of reach.

   Only the sigil, the arc and the nodes ride this transform. The leaders do not:
   they have to reach rows that never move, which is the whole point of them.
   ============================================================ */

export const ZOOM = 1.6
/** How far above its row's line the focused node comes to rest. */
const FOCAL_X = 210
const FOCAL_RISE = 52
/** Where the leader turns horizontal, once zoomed. */
export const FOCAL_BREAK = 58

export interface Zoom {
  /** CSS transform for the instrument. Needs `transform-origin: 0 0`. */
  transform: string
  /** Where the focused node ends up, in the body's own px. */
  focal: { x: number; y: number }
}

/** Zoom the instrument so `node` lands beside the row at `y`.
 *
 *  P -> s·P + t, with t chosen so the focused node lands on the focal point —
 *  which is why the transform needs origin 0 0: the maths is in the body's
 *  coordinate space, not the element's box. */
export function zoomTo(node: Wire, y: number): Zoom {
  const focal = { x: FOCAL_X, y: y - FOCAL_RISE }
  return {
    transform: `translate(${(focal.x - ZOOM * node.nx).toFixed(2)}px, `
      + `${(focal.y - ZOOM * node.ny).toFixed(2)}px) scale(${ZOOM})`,
    focal,
  }
}
