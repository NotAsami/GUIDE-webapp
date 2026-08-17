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
import { IS_ACTIVATION } from './opSchema.ts'

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
  note: '⊙',      // says something without changing a number
  resist: '⊟',
  vuln: '⤒',
  immune: '⊘',    // cancels outright
  setVar: '⊕',    // writes
  addVar: '⊕',
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
export function featureEffects(f: Feature): FeatureEffectRow[] {
  return (f.graph ?? [])
    .filter(e => !IS_ACTIVATION(e.op))
    .map(e => ({
      glyph: OP_GLYPH[e.op] ?? '◇',
      text: effectText(e),
      tag: (e.target ?? []).map(targetLabel).filter(Boolean).join(' · '),
      dmgType: e.dmgType?.trim() || undefined,
    }))
}

/** "+2d6 radiant" / "Advantage · Steady Hand" — the label and what it is worth.
 *
 *  The VALUE leads when there is one, because that is what the player scans for.
 *  A flag op has no value, so its label carries the row alone. */
function effectText(e: GraphEffect): string {
  const label = e.label?.trim()
  const value = e.value?.trim()
  if (e.op === 'note') return label || value || ''
  if (!value) return label || ''
  // The damage type rides on the ROW, not in here — the renderer needs it apart
  // from the prose to colour it.
  const amount = `**${value}**`
  return label ? `${amount} · ${label}` : amount
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
export const toggleVars = (f: Feature): VarDef[] =>
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
 *  Exactly one toggle variable and nothing else to spend — with two, the
 *  hexagon would have to pick one and the player could not tell which. Those
 *  keep their switches in the popup instead. */
export function toggleVar(f: Feature): VarDef | null {
  const vars = toggleVars(f)
  return vars.length === 1 && !f.uses && !f.roll ? vars[0] : null
}
