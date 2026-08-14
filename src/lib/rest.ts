import type { CharacterRow, CharacterSection, CharacterSheet, ShardTree } from './database.types'
import type { RollLine } from './rolls'
import { effectiveSheet } from './effects'

/** Build the long-rest result: faithful 5e long-rest defaults, applied in ONE
 *  atomic write (both sections spread from the existing data — never replaced).
 *   - HP -> max, temp cleared
 *   - hit dice: regain floor(max/2), min 1 (capped)
 *   - exhaustion -1, death saves cleared
 *   - active effects cleared (the "buffs reset on rest" decision)
 *   - every limited-use feature recharges
 *   - every standard spell slot's `expended` resets to 0 (5e default — a
 *     SHORT rest does NOT do this for standard slots)
 *   - Pact Magic slots reset too (a long rest grants every short-rest
 *     benefit; see `pactShortRestPatch` for the short-rest-only path)
 *  Attunement is a slot budget, not refilled.
 *
 *  Shared so the player Rest button AND the Operator Console Vitals card produce
 *  IDENTICAL writes — both target the same `sheet`/`resources`/`spellbook` fields,
 *  so they can never drift (single source of truth). The `lines` are the
 *  player-facing roll-log summary; the DM side may ignore them.
 *
 *  Heals to the EFFECTIVE max (base + shard bonuses) if `shardTrees` is passed,
 *  but always persists the AUTHORED `hp.max` unchanged — a rest can't bake a
 *  shard's bonus into canon, so ejecting the shard correctly drops max HP back
 *  down without this write having corrupted the base. */
export function longRestPatch(character: CharacterRow, shardTrees: Record<string, ShardTree> = {}): {
  patch: Partial<Pick<CharacterRow, CharacterSection>>
  lines: RollLine[]
} {
  const sheet = character.sheet ?? {}
  const resources = character.resources ?? {}
  const spellbook = character.spellbook ?? {}
  const lines: RollLine[] = []

  const hp = sheet.hp ?? { current: 0, max: 0 }
  const baseMax = hp.max ?? 0
  const healMax = effectiveSheet(character, shardTrees).hp?.max ?? baseMax
  const hpHealed = Math.max(0, healMax - (hp.current ?? 0))
  const nextSheet: CharacterSheet = { ...sheet, hp: { ...hp, current: healMax, max: baseMax, temp: 0 } }
  lines.push({
    label: 'HP', total: `${healMax} / ${healMax}`,
    breakdown: hpHealed > 0 ? `+${hpHealed} restored` : 'already full', tone: 'heal',
  })

  const hd = sheet.hitDice
  if (hd && hd.max > 0) {
    const regain = Math.max(1, Math.floor(hd.max / 2))
    const nextCur = Math.min(hd.max, (hd.current ?? 0) + regain)
    const gained = nextCur - (hd.current ?? 0)
    nextSheet.hitDice = { ...hd, current: nextCur }
    if (gained > 0) lines.push({ label: 'Hit Dice', total: `${nextCur}${hd.die}`, breakdown: `+${gained} regained` })
  }

  // Every limited-use feature recharges on a long rest.
  const features = sheet.features
  if (features && features.length) {
    let recharged = 0
    nextSheet.features = features.map(f => {
      if (f.uses && f.uses.current < f.uses.max) { recharged++; return { ...f, uses: { ...f.uses, current: f.uses.max } } }
      return f
    })
    if (recharged > 0) lines.push({ label: 'Features', total: 'recharged', breakdown: `${recharged} restored` })
  }

  const exhaustion = typeof resources.exhaustion === 'number' ? resources.exhaustion : 0
  const nextExhaustion = Math.max(0, exhaustion - 1)
  if (exhaustion > 0) lines.push({ label: 'Exhaustion', total: `${nextExhaustion}`, breakdown: '−1 level' })

  const effects = Array.isArray(resources.activeEffects) ? resources.activeEffects : []
  if (effects.length > 0) lines.push({ label: 'Effects Cleared', total: `${effects.length}`, breakdown: 'potions worn off', tone: 'buff' })

  const ds = resources.deathSaves as { successes?: number; failures?: number } | undefined
  if (ds && ((ds.successes ?? 0) > 0 || (ds.failures ?? 0) > 0)) lines.push({ label: 'Death Saves', total: 'reset', breakdown: '0 / 0' })

  const patch: Partial<Pick<CharacterRow, CharacterSection>> = {
    sheet: nextSheet,
    resources: { ...resources, deathSaves: { successes: 0, failures: 0 }, exhaustion: nextExhaustion, activeEffects: [] },
  }

  const slots = spellbook.slots
  if (slots && slots.length) {
    const recovered = slots.reduce((n, s) => n + s.expended, 0)
    patch.spellbook = { ...spellbook, slots: slots.map(s => ({ ...s, expended: 0 })) }
    if (recovered > 0) lines.push({ label: 'Spell Slots', total: 'restored', breakdown: `${recovered} recovered`, tone: 'buff' })
  }

  if (spellbook.pactMagic && (spellbook.pactExpended ?? 0) > 0) {
    const recovered = spellbook.pactExpended ?? 0
    patch.spellbook = { ...(patch.spellbook ?? spellbook), pactExpended: 0 }
    lines.push({ label: 'Pact Magic', total: 'restored', breakdown: `${recovered} recovered`, tone: 'buff' })
  }

  return { patch, lines }
}

/** Warlock Pact Magic slots recharge on a SHORT rest too — the defining
 *  trait of that class's spellcasting (2014/2024 5e both agree here). A long
 *  rest already includes every short-rest benefit, so `longRestPatch` resets
 *  `pactExpended` directly rather than composing this; this is the
 *  short-rest-ONLY path (standard `slots[]` stay untouched — those still
 *  need a long rest). Returns null when there's nothing to restore (not a
 *  pact caster, or already full) so callers can skip the write/line cleanly. */
export function pactShortRestPatch(character: CharacterRow): {
  patch: Partial<Pick<CharacterRow, CharacterSection>>
  lines: RollLine[]
} | null {
  const spellbook = character.spellbook ?? {}
  const expended = spellbook.pactExpended ?? 0
  if (!spellbook.pactMagic || expended <= 0) return null
  return {
    patch: { spellbook: { ...spellbook, pactExpended: 0 } },
    lines: [{ label: 'Pact Magic', total: 'restored', breakdown: `${expended} recovered`, tone: 'buff' }],
  }
}
