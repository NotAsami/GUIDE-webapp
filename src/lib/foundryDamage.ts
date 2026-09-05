/**
 * The damage a codex roll hands to dnd5e.
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
