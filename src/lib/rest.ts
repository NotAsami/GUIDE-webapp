import type { CharacterRow, CharacterSection, CharacterSheet } from './database.types'
import type { RollLine } from './rolls'

/** Build the long-rest result: faithful 5e long-rest defaults, applied in ONE
 *  atomic write (both sections spread from the existing data — never replaced).
 *   - HP -> max, temp cleared
 *   - hit dice: regain floor(max/2), min 1 (capped)
 *   - exhaustion -1, death saves cleared
 *   - active effects cleared (the "buffs reset on rest" decision)
 *   - every limited-use feature recharges
 *  Spell slots are intentionally NOT touched yet (no `spellbook.slots` shape;
 *  wire that with the Spellbook port). Attunement is a slot budget, not refilled.
 *
 *  Shared so the player Rest button AND the Operator Console Vitals card produce
 *  IDENTICAL writes — both target the same `sheet`/`resources` fields, so they can
 *  never drift (single source of truth). The `lines` are the player-facing roll-log
 *  summary; the DM side may ignore them. */
export function longRestPatch(character: CharacterRow): {
  patch: Partial<Pick<CharacterRow, CharacterSection>>
  lines: RollLine[]
} {
  const sheet = character.sheet ?? {}
  const resources = character.resources ?? {}
  const lines: RollLine[] = []

  const hp = sheet.hp ?? { current: 0, max: 0 }
  const hpMax = hp.max ?? 0
  const hpHealed = Math.max(0, hpMax - (hp.current ?? 0))
  const nextSheet: CharacterSheet = { ...sheet, hp: { ...hp, current: hpMax, max: hpMax, temp: 0 } }
  lines.push({
    label: 'HP', total: `${hpMax} / ${hpMax}`,
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

  return {
    patch: {
      sheet: nextSheet,
      resources: { ...resources, deathSaves: { successes: 0, failures: 0 }, exhaustion: nextExhaustion, activeEffects: [] },
    },
    lines,
  }
}
