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

import { evalExpr, type ExprScope } from './expr.ts'
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
