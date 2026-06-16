/**
 * "Using a consumable" — the effect math, in ONE place.
 *
 * A potion does the same thing whether it's in the quick-access pouch (Equipment)
 * or still in the bag (Inventory): roll its heal onto real HP and/or apply a
 * temporary status effect. That computation lives here so neither screen owns a
 * private copy. What differs between the two — WHERE the spent item lives (a
 * quick-access slot vs an inventory stack) — stays with each caller: this returns
 * the sheet/resources pieces + toast lines, the caller folds in its own
 * qty-decrement and fires the single atomic write + toast.
 *
 * HP is always computed from `character.sheet` (the canonical base), never the
 * effect-layered sheet — writing layered scores back would corrupt canon.
 */

import type { CharacterRow, EquippedItem } from './database.types'
import { rollHeal } from './dice'
import type { RollLine } from './rolls'
import { activeEffects, summarizeEffects } from './effects'

export interface ConsumeOutcome {
  /** True when using it would do nothing (a pure heal at full HP) — don't spend it. */
  wasted: boolean
  /** Toast subtitle for this outcome. */
  subtitle: string
  /** Toast roll lines (heal / status). */
  lines: RollLine[]
  /** New `sheet` with HP applied — present only when HP actually changed. */
  sheet?: CharacterRow['sheet']
  /** New `resources` with the status effect appended — present only when one applied. */
  resources?: CharacterRow['resources']
}

/** Resolve what using `item` does to this character (HP + status), without touching
 *  the container the item lives in. */
export function consumeEffect(item: EquippedItem, character: CharacterRow): ConsumeOutcome {
  const base = character.sheet
  const cur = base.hp?.current ?? 0
  const max = base.hp?.max ?? 0
  const hasEffects = !!item.effects && Object.keys(item.effects).length > 0
  const canHeal = item.heal !== undefined && (max <= 0 || cur < max)

  // Pure healing potion at full HP would only waste a charge.
  if (item.heal !== undefined && !hasEffects && !canHeal) {
    return { wasted: true, subtitle: 'Already at full HP', lines: [{ label: 'No effect', total: '—' }] }
  }

  const lines: RollLine[] = []
  const out: ConsumeOutcome = { wasted: false, subtitle: 'Consumable used', lines }

  if (canHeal) {
    const { total, breakdown } = rollHeal(item.heal!)
    const next = max > 0 ? Math.min(max, cur + total) : cur + total
    out.sheet = { ...base, hp: { ...(base.hp ?? { max }), current: next } }
    lines.push({ label: 'Healed', total: `+${next - cur}`, breakdown: `${breakdown} · HP ${cur} → ${next}`, tone: 'heal' })
  }

  if (hasEffects) {
    const eff = {
      id: crypto.randomUUID(), name: item.name, icon: item.icon,
      effects: item.effects!, source: item.name, note: item.duration, at: Date.now(),
    }
    out.resources = {
      ...character.resources, activeEffects: [...activeEffects(character), eff],
    } as unknown as CharacterRow['resources']
    lines.push({
      label: 'Status', total: summarizeEffects(item.effects!),
      breakdown: `${item.name}${item.duration ? ` · ${item.duration}` : ' · until rest'}`, tone: 'buff',
    })
  }

  if (!lines.length) lines.push({ label: 'Used', total: '✓' })
  return out
}
