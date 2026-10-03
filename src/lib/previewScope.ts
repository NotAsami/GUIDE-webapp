/**
 * The scope an authoring preview evaluates `{…}` spans against.
 *
 * There is no character in the Feature Editor, so most of the whitelist is
 * genuinely unknowable: ability mods, hp and the save DC belong to a person,
 * and `prof` is AUTHORED on the sheet (dnd.ts proficiency reads
 * sheet.proficiencyBonus) rather than derived from level, so guessing it here
 * would be inventing a number the app deliberately lets the DM set.
 *
 * So this returns only what is actually knowable — a nominal level, and every
 * variable whose value follows from it. `weaponMastery` is a derived formula
 * over `level`, so at level 7 it really is 3; that is a fact, not a sample.
 * Anything left over stays literal and `interpolate` names it, which is the
 * honest answer to "what will the player see": the preview says it cannot know.
 */

import { evalExpr, freeIdents, hasIdent, isHasIdent, type ExprScope } from './expr.ts'
import type { VarDef, FeatureGrantRef } from './database.types.ts'

/** Project canon (CLAUDE.md): the party is level 7. */
export const PREVIEW_LEVEL = 7

export type VarOwner = { features?: FeatureGrantRef[]; vars?: VarDef[] }

export function previewScope(opts: {
  level?: number
  /** Restricts owners to those that actually grant this feature. Six classes
   *  declare `cantrips` with different progressions, so taking them all would
   *  show a Bard's number inside a Wizard's prose. */
  featureId?: string
  /** The feature's own variables. */
  vars?: VarDef[]
  /** Classes, races and backgrounds whose variables are in scope on a
   *  character that has this feature. */
  owners?: VarOwner[]
} = {}): ExprScope {
  const { level = PREVIEW_LEVEL, featureId, vars = [], owners = [] } = opts
  const scope: ExprScope = { level }

  const defs = [
    ...owners
      .filter(o => !featureId || (o.features ?? []).some(r => r?.feature_id === featureId))
      .flatMap(o => o.vars ?? []),
    ...vars,
  ]

  // Stored first — a derived formula may read one, and a stored variable's
  // preview value is its declared initial, which is what a fresh character has.
  for (const d of defs) {
    if (d.kind === 'stored') scope[d.name] = d.initial ?? (d.type === 'bool' ? false : 0)
  }

  // Twice, so a derived variable that reads another derived variable settles
  // regardless of declaration order. Two passes rather than a dependency sort:
  // chains deeper than that are not worth the machinery for a preview.
  for (let pass = 0; pass < 2; pass++) {
    for (const d of defs) {
      if (d.kind !== 'derived' || !d.formula) continue
      const v = evalExpr(d.formula, scope)
      if (v?.t === 'num' && !v.dice.length) scope[d.name] = v.flat
      else if (v?.t === 'bool') scope[d.name] = v.v
    }
  }
  return scope
}

/* ==========================================================================
 * CLASS PROGRESSION — the Graph view's preview lens ("what does this feature
 * do for a Barbarian 9?"). A class's grants are `FeatureGrantRef.when` over
 * `level`, so owning a granted feature is a pure function of level: that, and
 * `level` itself, are the ONLY things it decides. Everything else stays open.
 * ========================================================================== */

/** `has_<name>` for every feature this class grants, at this level. A grant
 *  whose feature is not in `names` (deleted, not loaded) is skipped, not false. */
export function classHas(grants: FeatureGrantRef[], names: Map<string, string>, level: number): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const r of grants) {
    const name = names.get(r?.feature_id)
    if (!name) continue
    const v = r.when?.trim() ? evalExpr(r.when, { level }) : { t: 'bool' as const, v: true }
    const id = hasIdent(name)
    out[id] = (out[id] ?? false) || (v?.t === 'bool' && v.v)
  }
  return out
}

/** The levels worth stepping through: where the set of grants changes. */
export function grantLevels(grants: FeatureGrantRef[], names: Map<string, string>): number[] {
  const out: number[] = []
  let prev = ''
  for (let l = 1; l <= 20; l++) {
    const key = JSON.stringify(classHas(grants, names, l))
    if (key !== prev) out.push(l)
    prev = key
  }
  return out
}

export type PreviewState = 'active' | 'off' | 'undetermined'

/** How many unknown booleans are enumerated before giving up. 2^6 = 64 evaluations. */
const MAX_UNKNOWN = 6

/** Decide a gate under a preview scope, through the REAL evaluator.
 *
 *  There is no three-valued logic here (the mockup had its own parser for
 *  that; a second copy of the expression language would drift). Instead the
 *  identifiers the preview cannot know are ENUMERATED: an unknown boolean takes
 *  both values; an unknown number cannot be enumerated, so it leaves the answer
 *  undetermined. All outcomes true → active, all false → off, mixed →
 *  undetermined. It can say "undetermined" more often than it must; it never
 *  says "off" about something that could be on.
 *
 *  An `ask` is answered by a player, never by a preview (D21): such a rule is
 *  off only when its `when` already is. */
export function progressionState(
  gate: { when?: string; ask?: string },
  scope: ExprScope,
  isBool: (id: string) => boolean,
): PreviewState {
  const when = gate.when?.trim()
  const asked = !!gate.ask?.trim()
  if (!when) return asked ? 'undetermined' : 'active'
  const unknown = freeIdents(when).filter(id => !(id in scope))
  let v: boolean | null
  if (unknown.some(id => !isBool(id)) || unknown.length > MAX_UNKNOWN) v = null
  else {
    const seen = new Set<boolean>()
    for (let m = 0; m < 1 << unknown.length && seen.size < 2; m++) {
      const s: ExprScope = { ...scope }
      unknown.forEach((id, i) => { s[id] = !!(m & (1 << i)) })
      const r = evalExpr(when, s)
      if (r?.t !== 'bool') { seen.add(true); seen.add(false); break }
      seen.add(r.v)
    }
    v = seen.size === 1 ? [...seen][0] : null
  }
  if (asked) return v === false ? 'off' : 'undetermined'
  return v === true ? 'active' : v === false ? 'off' : 'undetermined'
}

/** The booleans a preview may enumerate: feature presence, and anything the
 *  AUDIT's type probe (graph.ts probeScope) types as boolean — declared
 *  booleans, derived variables whose formula is boolean, catalog booleans, the
 *  boolean roll facts. One typing, the audit's, rather than a second guess. */
export const previewBool = (probe: ExprScope) => (id: string) =>
  isHasIdent(id) || typeof probe[id] === 'boolean'

/** The scope a progression preview decides: `level`, the class's `has_*`, and
 *  derived variables that follow from those alone. NOT stored variables at their
 *  initial value — `mercy >= 2` reads 0 on a fresh sheet, but mercy moves in
 *  play, so treating the initial as the answer would call a live rule "off". */
export function progressionScope(level: number, has: Record<string, boolean>, defs: VarDef[] = []): ExprScope {
  const scope: ExprScope = { level, ...has }
  for (let pass = 0; pass < 2; pass++) {
    for (const d of defs) {
      if (d.kind !== 'derived' || !d.formula || d.uses || d.name in scope) continue
      // A formula reading anything undecided does not evaluate, so it stays open.
      const v = evalExpr(d.formula, scope)
      if (v?.t === 'num' && !v.dice.length) scope[d.name] = v.flat
      else if (v?.t === 'bool') scope[d.name] = v.v
    }
  }
  return scope
}
