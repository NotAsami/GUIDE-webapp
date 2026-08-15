/**
 * The op schema — why the feature editor is ONE form.
 *
 *   > Adding an op must not require editing the editor.
 *
 * Every field an effect shows comes from `OPS[op].fields`. A new op is an entry
 * here plus a case in lib/graph.ts; the renderer is untouched. That is the whole
 * requirement, and it is why this file has no JSX in it.
 *
 * FIELD TYPES ARE A CLOSED SET. Adding a field type is a considered change, made
 * occasionally. Building a UI to author schemas is where this stops — that is a
 * form builder, it is its own project, and it is always almost done.
 *
 * `desc`/`example` are not decoration: they are the only source for both the
 * inline per-field help and the authoring guide, so a field explains itself
 * wherever it appears.
 */
import type { GraphOp } from './database.types.ts'

export type FieldType =
  | 'formula'   // number or expression, evaluated by lib/expr.ts
  | 'text'      // player-facing prose
  | 'selector'  // a target list — thing, tag or roll kind
  | 'enum'      // one of a fixed list
  | 'boolean'   // on or off
  | 'reference' // a pick from the catalog, or from this feature's own variables
  | 'array'     // level-indexed progression: 21 slots, index 0 unused

export type OpField = {
  key: string
  type: FieldType
  label: string
  required?: boolean
  /** Lays out full-width instead of sharing a row. */
  wide?: boolean
  /** `enum` only. */
  options?: string[]
  /** `reference` only — what it picks from. */
  ref?: 'variable' | 'effect'
  desc: string
  example?: string
}

export type OpDef = {
  label: string
  /** Only passive contributions exist so far. Activation outcomes (§23) arrive
   *  with the activation slice and will carry `group: 'activation'`. */
  group: 'passive'
  icon: string
  blurb: string
  fields: OpField[]
}

const AMOUNT: OpField = {
  key: 'value', type: 'formula', label: 'Amount', required: true,
  desc: 'Number or expression contributed to every matched target. Dice are allowed and stay unrolled, so a crit can still double them.',
  example: '2 + level / 4',
}

/** Damage flags share a blurb shape: their target list IS the statement, so they
 *  declare no fields at all. */
const flag = (label: string, icon: string, blurb: string): OpDef =>
  ({ label, group: 'passive', icon, blurb, fields: [] })

export const OPS: Record<GraphOp, OpDef> = {
  add: {
    label: 'add', group: 'passive', icon: 'fa-plus',
    blurb: 'Adds a numeric contribution to every matched target. Stacks with other add nodes.',
    fields: [
      AMOUNT,
      {
        key: 'byLevel', type: 'array', label: 'By level', wide: true,
        desc: 'Level-indexed progression. When any slot is filled it overrides Amount. Index 0 is unused — character levels start at 1.',
        example: 'slot 1 = 2, slot 5 = 3, slot 11 = 4',
      },
    ],
  },
  adv: flag('adv', 'fa-angles-up', 'Grants advantage on the matched rolls. No parameters — the target list is the whole statement.'),
  dis: flag('dis', 'fa-angles-down', 'Imposes disadvantage on the matched rolls.'),
  crit: {
    label: 'crit', group: 'passive', icon: 'fa-burst',
    blurb: 'Lowers the critical-hit threshold on the matched attack rolls.',
    fields: [{
      key: 'threshold', type: 'formula', label: 'Crits on', required: true,
      desc: 'Lowest d20 face that counts as a critical hit. The lowest threshold across every applying node wins.',
      example: '19',
    }],
  },
  note: {
    label: 'note', group: 'passive', icon: 'fa-comment',
    blurb: 'Surfaces rules text on the target without changing a number. A note has nothing to resolve, so it takes when but never ask.',
    fields: [{
      key: 'text', type: 'text', label: 'Note text', required: true, wide: true,
      desc: 'The sentence the player reads on the matched targets. The Label above is the short line in the breakdown; this is the rule itself.',
      example: 'Ignores half cover.',
    }],
  },
  resist: flag('resist', 'fa-shield-halved', 'Halves incoming damage of the matched kind. Target a tag — the tag names the damage type.'),
  vuln: flag('vuln', 'fa-heart-crack', 'Doubles incoming damage of the matched kind.'),
  immune: flag('immune', 'fa-shield', 'Nullifies incoming damage of the matched kind.'),
}

/** Palette order — what an author reaches for first, and what hides behind MORE. */
export const PALETTE = ['add', 'adv', 'dis', 'crit', 'resist'] as const satisfies readonly GraphOp[]
export const PALETTE_MORE = ['vuln', 'immune', 'note'] as const satisfies readonly GraphOp[]
export const OP_ORDER: GraphOp[] = [...PALETTE, ...PALETTE_MORE]

export const OP_TITLE: Record<GraphOp, string> = {
  add: 'Add', adv: 'Adv', dis: 'Dis', crit: 'Crit', note: 'Note',
  resist: 'Resist', vuln: 'Vuln', immune: 'Immune',
}

/** The ops whose target names a damage kind rather than a roll. Mirrors the
 *  engine's own list; kept here so the editor can label them without importing
 *  the resolver. */
export const IS_DAMAGE_FLAG = (op: GraphOp) => op === 'resist' || op === 'vuln' || op === 'immune'

/** Roll kinds a selector may name. `RollKind` in lib/graph.ts is the authority for
 *  the left half; the sub-kinds are the ones the app actually raises today. */
export const ROLL_SELECTORS = [
  'attack', 'attack.melee', 'attack.ranged', 'attack.spell',
  'damage',
  'save', 'save.str', 'save.dex', 'save.con', 'save.int', 'save.wis', 'save.cha',
  'check', 'check.athletics', 'check.stealth', 'check.perception',
  'feature',
]

export const SOURCES: Record<string, string> = {
  class: 'Class', feat: 'Feat', racial: 'Racial', background: 'Background',
  sense: 'Sense', other: 'Other',
}

export const ACTIVATIONS = {
  none: { label: 'None (passive)', note: 'No button on the player’s Features screen — this feature simply applies.', color: 'var(--beige-dim)', icon: 'fa-infinity' },
  action: { label: 'Action', note: 'A button on the Features screen, spending the player’s action.', color: 'var(--amber)', icon: 'fa-hand' },
  bonus: { label: 'Bonus action', note: 'A button, spending the player’s bonus action.', color: 'var(--amber)', icon: 'fa-bolt' },
  reaction: { label: 'Reaction', note: 'A button. Mechanically an action — the label is what tells the player when it fires.', color: 'var(--cyan)', icon: 'fa-reply' },
  free: { label: 'Free action', note: 'A button that costs nothing. Uses, if any, are the only limit.', color: 'var(--good)', icon: 'fa-feather' },
} as const

export type ActivationKind = keyof typeof ACTIVATIONS
export const ACT_ORDER: ActivationKind[] = ['none', 'action', 'bonus', 'reaction', 'free']

/** The six console swatches. Anything else goes through the native colour input. */
export const COLORS = ['#d4bf7d', '#e2b021', '#00a6d6', '#a07ad6', '#b93a3a', '#4fae6b']
export const DEFAULT_COLOR = '#d4bf7d'
