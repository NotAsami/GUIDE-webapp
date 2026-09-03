/**
 * The Features screen's view model — a `Feature` reshaped into what the mockup's
 * card and popup render, and nothing else.
 *
 * Pure and separate from the component for the usual reason: these are
 * DERIVATIONS, not markup. The effect sub-rows claim "this is what the feature
 * does" and the origin chain claims "this is where it came from"; both are
 * assembled from several optional fields, and both are wrong silently rather
 * than loudly. Here they are testable without a renderer.
 *
 * The reverse lookup ("Affected by") lives in graph.ts instead — it needs the
 * engine's own index, and exporting that index's element type just to read it
 * from here would widen the engine's surface for one caller.
 */
import type { Feature, GraphEffect, GraphOp, VarDef } from './database.types.ts'
import { IS_ACTIVATION, levelFormula } from './opSchema.ts'
import { evalExpr, type ExprScope } from './expr.ts'


/**
 * A feature's use counter, resolved — or null when it has none.
 *
 * THE ONE READER of `uses`. `max` is a formula (see Feature.uses), so
 * `f.uses.max` is a string on exactly the features that scale with level, and
 * every surface that printed it raw would print `[0,2,2,3,3,3,4,…][level]` at
 * the player. Nine call sites read this field; they all come through here.
 *
 * `current` is CLAMPED to the resolved max, on read and never on write — the
 * same rule effective HP follows and for the same reason. A Barbarian who drops
 * a level keeps their stored count underneath, so regaining the level gives the
 * Rage back rather than having quietly destroyed it.
 *
 * `scope` is REQUIRED rather than defaulted. An unresolvable max is 0, which
 * clamps `current` to 0, which reads as SPENT everywhere — so a caller that
 * forgot to pass one would silently grey out every limited-use feature on the
 * sheet. Making it an argument means the compiler asks. A caller that genuinely
 * has no character (the Feature Editor) passes `{}` and says so.
 */
export function usesOf(f: Pick<Feature, 'uses'>, scope: ExprScope): { current: number; max: number } | null {
  const u = f.uses
  if (!u) return null
  const max = resolveMax(u.max, scope)
  // Absent `current` is FULL, not empty — a catalog template has no number to
  // write, because the max it would copy depends on whose sheet it lands on.
  return { current: Math.max(0, Math.min(u.current ?? max, max)), max }
}

function resolveMax(max: number | string | undefined, scope: ExprScope): number {
  if (typeof max === 'number') return max
  const raw = String(max ?? '').trim()
  if (!raw) return 0
  // `"3"` is the overwhelmingly common case and predates the formula; take it
  // before the parser is asked, so nothing authored before this can regress.
  const n = Number(raw)
  if (Number.isFinite(n)) return Math.max(0, Math.trunc(n))
  const v = evalExpr(raw, scope)
  // Dice in a use count is nonsense — "1d4 uses" is not a thing — so a formula
  // carrying them is refused rather than silently truncated to its flat part.
  return v?.t === 'num' && !v.dice.length ? Math.max(0, Math.trunc(v.flat)) : 0
}

/** The mockup's operator glyphs, one per op.
 *
 *  EXHAUSTIVE BY TYPE (`Record<GraphOp, …>`), so adding an op to GraphOp stops
 *  this file compiling rather than rendering a blank column — the same guard the
 *  effect-schema test makes, expressed in the type system where it is free. */
export const OP_GLYPH: Record<GraphOp, string> = {
  add: '✖',       // a number added to a roll — the mockup's damage glyph
  adv: '⤒',       // raises
  dis: '⊟',       // lowers
  crit: '⚔',
  floor: '⊻',      // raises a total to a minimum — never a bonus
  reroll: '↻',    // re-runs a roll already made — the only op that acts afterwards
  note: '⊙',      // says something without changing a number
  boost: '◈',     // moves a number on the sheet, not on a roll
  useability: '◈', // also the sheet layer — which ability may swing the weapon
  unarmored: '◈',  // and again — the base AC of an unarmoured character
  resist: '⊟',
  vuln: '⤒',
  immune: '⊘',    // cancels outright
  setHp: '♥',      // writes the one stored number on the sheet
  setVar: '⊕',    // writes
  addVar: '⊕',
  addUses: '⊕',   // writes too — a use counter rather than a variable
  addSlot: '⊕',   // writes a spell slot — the spellbook's counter, not the sheet's
  grant: '⇥',     // writes onto SOMEONE ELSE — the only op that leaves this sheet
}

export type FeatureEffectRow = {
  glyph: string
  /** Already markdown — the card renders it through `Prose`, so an authored
   *  `[fire]{fire}` colours here exactly as it does in the prose fields. */
  text: string
  /** The right-hand qualifier: what this effect is aimed at. Empty when the
   *  effect targets the feature's own roll, which is the unremarkable case. */
  tag: string
  /** Kept SEPARATE from `text` rather than folded into it, so the row can be
   *  tinted the damage colour. Radiant reading gold in a feature's effect row and
   *  gold again in the roll it produces is the point — both go through
   *  lib/palette.ts. */
  dmgType?: string
}

/** How a target selector reads on a player's card.
 *
 *  Deliberately lossy. The DM authored `roll:damage.melee`; a player wants
 *  "melee damage". This is a label, not an identifier — nothing round-trips
 *  through it, so a gid degrades to its kind rather than leaking a uuid. */
function targetLabel(t: string): string {
  if (t.startsWith('tag:')) return t.slice(4).replace(/_/g, ' ')
  if (t.startsWith('roll:')) {
    const [kind, sub] = t.slice(5).split('.')
    return sub ? `${sub} ${kind}` : kind
  }
  // `feature:uuid`, `spell:uuid`… — the kind is the only half worth showing.
  const kind = t.split(':')[0]
  return kind && kind !== t ? kind : ''
}

/** The card's effect sub-rows, derived from the feature's graph.
 *
 *  ACTIVATION OPS ARE EXCLUDED. They do not modify anything until the player
 *  presses Use, so listing them beside the passive contributions would have the
 *  card claim a feature does something it only does on a press — and the press
 *  already shows them, in the activation confirm sheet. */
export function featureEffects(f: Feature, scope?: ExprScope): FeatureEffectRow[] {
  return (f.graph ?? [])
    .filter(e => !IS_ACTIVATION(e.op))
    .map(e => ({
      glyph: OP_GLYPH[e.op] ?? '◇',
      text: effectText(e, scope),
      tag: (e.target ?? []).map(targetLabel).filter(Boolean).join(' · '),
      dmgType: e.dmgType?.trim() || undefined,
    }))
}

/** "+2d6 radiant" / "Advantage · Steady Hand" — the label and what it is worth.
 *
 *  The VALUE leads when there is one, because that is what the player scans for.
 *  A flag op has no value, so its label carries the row alone. */
function effectText(e: GraphEffect, scope?: ExprScope): string {
  const label = e.label?.trim()
  const value = amountOf(e, scope)
  if (e.op === 'note') return label || value || ''
  if (!value) return label || ''
  // The damage type rides on the ROW, not in here — the renderer needs it apart
  // from the prose to colour it.
  const amount = `**${value}**`
  return label ? `${amount} · ${label}` : amount
}

/** What the value is WORTH to this character, not how it was written.
 *
 *  A value is a formula, and the card printed the source: a player reading
 *  Brutal Strike saw `has_improved_brutal_strike_enhanced ? 2d10 : 1d10` — the
 *  engine talking to itself in the one place that is supposed to say what the
 *  feature does. The same evaluation the roller performs (level table first,
 *  then the expression) answers it here, so the card and the roll cannot
 *  disagree.
 *
 *  Without a scope — the DM's authoring preview, before there is a character to
 *  resolve against — the source is still the honest answer, and so is a formula
 *  that fails to resolve: blanking it would hide the typo that caused it. */
function amountOf(e: GraphEffect, scope?: ExprScope): string {
  const src = (scope ? levelFormula(e, scope.level) : undefined) ?? e.value?.trim() ?? ''
  if (!src || !scope) return src
  const v = evalExpr(src, scope)
  if (v === null || v.t !== 'num') return src
  const parts = [...v.dice]
  if (v.flat || !parts.length) parts.push(String(v.flat))
  return parts.join(' + ')
}

/** The popup's origin breadcrumb.
 *
 *  Authored `origin` wins outright — a DM who wrote the chain meant it. The
 *  fallback assembles one from whatever the feature happens to carry, skipping
 *  absent steps rather than rendering empty chips, so thin data reads as a short
 *  chain instead of a broken one. Always ends with the feature's own name, which
 *  is what the mockup marks as the last (cyan) step. */
export function originChain(f: Feature): string[] {
  const authored = (f.origin ?? []).map(s => s.trim()).filter(Boolean)
  if (authored.length) return authored
  const steps = [
    f.category ? CATEGORY_LABEL[f.category] ?? f.category : null,
    f.source?.trim() || null,
    f.level ? `Level ${f.level}` : null,
    f.name,
  ]
  return steps.filter((s): s is string => !!s)
}

const CATEGORY_LABEL: Record<string, string> = {
  class: 'Class', feat: 'Feat', racial: 'Racial',
  background: 'Background', sense: 'Sense', other: 'Other',
}

/** Variables this feature declares that a player may flip directly.
 *
 *  A `bool` is the only shape that reads as a switch — a number is a stepper and
 *  cannot be "held" — and `dm` scope is not the player's to write. */
export const toggleVars = (f: Pick<Feature, 'vars'>): VarDef[] =>
  (f.vars ?? []).filter(v => v.kind === 'stored' && v.type === 'bool' && v.scope !== 'dm')

/** Can this feature be pressed at all?
 *
 *  Two independent reasons, and the split matters. `activation` is a DM's
 *  STATEMENT of intent ("this costs a bonus action"); the rest is the app
 *  observing that there is something to do. Requiring both would put a feature
 *  with real mechanics in the Passive tab whenever the DM left `activation` at
 *  its 'none' default — which is every feature on the live character today.
 *
 *  `once` counts because arming IS the press (§16): without it a feature whose
 *  only effect is "arm your next attack" would have no button to arm it with. */
export function isUsable(f: Feature): boolean {
  return !!f.roll
    || !!f.uses
    || (!!f.activation && f.activation !== 'none')
    || toggleVars(f).length > 0
    || (f.graph ?? []).some(e => IS_ACTIVATION(e.op) || e.once)
}

/** A feature whose press is "hold / release" rather than "spend".
 *
 *  Exactly one toggle variable — with two, the hexagon would have to pick one
 *  and the player could not tell which. Those keep their switches in the popup.
 *
 *  A STANCE MAY COST SOMETHING TO ENTER. `uses` used to disqualify a feature
 *  here, on the reasoning that a press either spends or holds. Rage is both:
 *  entering costs one of your Rages and it then stays on until you drop it, and
 *  so are Wild Shape, Frenzy and most of the class resources that matter. With
 *  the exclusion in place the only way to author Rage was a hexagon that spent a
 *  use and did nothing visible, plus a hand switch in the popup that turned it
 *  on for free — two doors into one room, and the free one had no lock.
 *
 *  What the press then does is `runsActivation`'s question, not this one: this
 *  says only "the hexagon is a switch". `roll` still disqualifies, because a
 *  feature that rolls dice has a result to show and a switch has nowhere to
 *  show it. */
export function toggleVar(f: Pick<Feature, 'vars' | 'roll'>): VarDef | null {
  const vars = toggleVars(f)
  return vars.length === 1 && !f.roll ? vars[0] : null
}

/** Does pressing this RUN something, or is the press only a variable write?
 *
 *  The difference is what a stance costs to enter. A cloak's `hoodUp` has no
 *  activation authored, so flipping it is a write and nothing else. Rage
 *  declares `setVar isRaging = true`, so entering goes through the activation
 *  path — which is the ONE place a use is spent, so a stance with a cost cannot
 *  end up with a second definition of spending it. */
export const runsActivation = (f: Pick<Feature, 'graph'>): boolean =>
  (f.graph ?? []).some(e => IS_ACTIVATION(e.op) || e.once)

/* ---------- carriers ---------- */

/**
 * A class or race CARRIER, not a feature.
 *
 * `assignClass`/`assignRace` put one synthetic row on `sheet.features` per
 * class and per race (`cls:<id>`, `race:<id>`) whose only job is to carry that
 * class's vars and graph to the engine — `activeSources` reads features, so a
 * carrier is how a class reaches a roll without the engine growing a fifth
 * source kind. It grants nothing and does nothing on its own.
 *
 * It is therefore not something to LIST as a feature, which is what it looked
 * like on the Features screen: a card with a class description and no effects.
 *
 * MATCHES THE CARRIER ONLY. A granted feature is `cls:<id>:<featureId>` — two
 * colons — and those are real features that must keep showing. A prefix test
 * (`id.startsWith('cls:')`) would hide every feature a class grants, which is
 * most of them.
 */
export const isCarrier = (id: string | undefined): boolean => /^(?:cls|race):[^:]+$/.test(id ?? '')

export type Origin = { kind: 'race' | 'class'; name: string; desc: string }

/**
 * What the carriers say about where this character came from — the class and
 * race descriptions, for the Lore dossier.
 *
 * Read off the carrier rather than the catalog on purpose: `class_catalog` has
 * no player policy (the security is the absence of one), so a player cannot
 * read it. `assignClass` already snapshots `desc` onto the carrier as
 * `light_description`, which is the copy the player owns.
 */
export function origins(features: readonly Feature[] | undefined): Origin[] {
  const out: Origin[] = []
  for (const f of features ?? []) {
    if (!isCarrier(f.id)) continue
    const desc = (f.light_description ?? '').trim()
    if (!desc) continue
    out.push({ kind: f.id.startsWith('race:') ? 'race' : 'class', name: f.name, desc })
  }
  // Race before class: it is the half of a character that exists first, the
  // same order the Operator Console's Actions tab puts them in.
  return out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'race' ? -1 : 1))
}
