/**
 * The dnd5e vocabulary the bridge speaks: damage amounts, and conditions in
 * both directions.
 *
 * Free of the Supabase client on purpose — this is the part of the bridge that
 * is pure arithmetic and name-matching about someone else's schema, which makes
 * it the part most worth a test. lib/foundry.ts owns the socket.
 */

import type { ActiveEffect } from './database.types.ts'

/** One typed lump of damage, in dnd5e's own shape. `type` absent = untyped,
 *  which dnd5e applies without resistances rather than guessing a type. */
export type DamageAmount = { value: number; type?: string }

/**
 * A roll's damage split, as dnd5e wants it.
 *
 * `byType` is already keyed by damage type and the keys are already dnd5e's
 * (lib/palette.ts and the system share the SRD's lowercase names — one of the
 * few places the two vocabularies happen to be identical). An untyped entry
 * travels with no `type` at all rather than as the string "damage": a type the
 * system does not know is a resistance check nobody asked for.
 */
export function damageAmounts(byType: Record<string, number>): DamageAmount[] {
  return Object.entries(byType)
    .filter(([, value]) => value > 0)
    .map(([type, value]) => {
      const t = type.trim().toLowerCase()
      return t && t !== 'damage' ? { value, type: t } : { value }
    })
}

/**
 * The conditions a DM can drop on a targeted creature.
 *
 * These are Foundry's own status ids, not this app's effect names — the two
 * vocabularies overlap for the SRD conditions and diverge everywhere else, and
 * this list is deliberately the SYSTEM's half. Nothing here touches a character
 * row: a condition applied to an enemy lives in Foundry, which is the only
 * place that knows what an enemy is.
 *
 * Exhaustion is absent on purpose. It is a counter in 2024, not a switch, and
 * a toggle that sets it to 1 would silently overwrite whatever level the
 * creature was already on.
 */
export const FOUNDRY_CONDITIONS = [
  'blinded', 'charmed', 'deafened', 'frightened', 'grappled', 'incapacitated',
  'invisible', 'paralyzed', 'petrified', 'poisoned', 'prone', 'restrained',
  'stunned', 'unconscious',
] as const

export type FoundryCondition = (typeof FOUNDRY_CONDITIONS)[number]

/** Title case for a status id — "frightened" reads as Frightened in a menu. */
export const conditionLabel = (id: string) => id.charAt(0).toUpperCase() + id.slice(1)

/** Marks an effect as Foundry's rather than the row's. A prefix rather than a
 *  new field on ActiveEffect: these never reach the database, so a column for
 *  them would be a schema change in service of something that is not stored. */
export const MIRROR_PREFIX = 'fvtt:'

export const isMirrored = (id: string): boolean => id.startsWith(MIRROR_PREFIX)

/** "blinded" → "Blinded". Foundry's status ids are lowercase words; the SRD
 *  conditions are the same words the app's own effects use, which is why they
 *  can sit in one list without reading as two vocabularies. */
const label = (id: string) => id.charAt(0).toUpperCase() + id.slice(1)

/** Foundry statuses as effect-shaped rows the panel can render.
 *
 *  `cond` always: these are conditions by construction. No `effects` payload —
 *  the app is not applying anything, it is REPORTING. A mirrored Blinded that
 *  quietly subtracted from a roll would be a number nobody could trace to a
 *  source the player can see. */
export function mirroredEffects(statuses: readonly string[]): ActiveEffect[] {
  return statuses.map(id => ({
    id: `${MIRROR_PREFIX}${id}`,
    name: label(id),
    kind: 'cond' as const,
    effects: {},
    source: 'Foundry',
    note: 'Applied on the battlemap',
  }))
}

/** The Foundry status an effect NAME is, when it is one at all.
 *
 *  Name matching, because that is the only join the two vocabularies have —
 *  the app's effects are free text a DM wrote and Foundry's statuses are a
 *  closed set of ids. It is the same match `suppressedEffects` uses for
 *  immunity, so an effect that suppresses as Frightened also lights the
 *  Frightened icon, and one that does neither does neither. */
export function statusOf(name: string): string | undefined {
  const id = name.trim().toLowerCase()
  return (FOUNDRY_CONDITIONS as readonly string[]).includes(id) ? id : undefined
}

/** What the app sends Foundry about its own effects. Shaped here so the wire
 *  format and the mirror that reads it back sit in one file. */
export function pushableEffects(effects: readonly ActiveEffect[]) {
  return effects.map(e => ({
    id: e.id,
    name: e.name,
    ...(statusOf(e.name) ? { status: statusOf(e.name)! } : {}),
    ...(e.icon ? { icon: e.icon } : {}),
  }))
}
