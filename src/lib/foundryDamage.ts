/**
 * The dnd5e vocabulary the bridge speaks: damage amounts, and the conditions a
 * status can be.
 *
 * Its own module, and deliberately free of the Supabase client: this is the one
 * piece of the bridge that is pure arithmetic about someone else's schema, and
 * it is the piece most worth a test. lib/foundry.ts owns the socket; this owns
 * the shape.
 */

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

