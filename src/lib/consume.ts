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

import type { CharacterRow, EquippedItem, ShardTree } from './database.types'
import { rollHeal } from './dice'
import type { RollLine } from './rolls'
import { activeEffects, effectiveSheet, summarizeEffects } from './effects'
import { gid, resolve, rollResolution, type AuditItem, type GraphContext, type Rider } from './graph'

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
  /** Feature-graph contributions to this use, rolled and attributed. */
  riders?: Rider[]
  notes?: string[]
  problems?: AuditItem[]
}

/** Resolve what using `item` does to this character (HP + status), without touching
 *  the container the item lives in.
 *
 *  `graph` lets features reach a consumable — "+2 to any potion you drink" is a
 *  contribution targeting `item:<gid>` or one of its tags, and it lands on the
 *  heal the same way a rider lands on an attack.
 *
 *  DELIBERATELY ONE-WAY: a CARRIED item is not an active source, so the item's
 *  own `graph` is not indexed and does not apply. `EquippedItem.graph` says
 *  "while EQUIPPED", and a potion in a bag is not equipped — see §51's note on
 *  what "active" should mean for a nocked or carried item. */
export function consumeEffect(
  item: EquippedItem, character: CharacterRow,
  shardTrees: Record<string, ShardTree> = {},
  graph?: GraphContext,
): ConsumeOutcome {
  const base = character.sheet
  const cur = base.hp?.current ?? 0
  // Clamp against the EFFECTIVE max (base + shard bonuses); the write below
  // never touches `max`, so the authored base is untouched either way.
  const max = effectiveSheet(character, shardTrees).hp?.max ?? base.hp?.max ?? 0
  const hasEffects = !!item.effects && Object.keys(item.effects).length > 0
  const canHeal = item.heal !== undefined && (max <= 0 || cur < max)

  // Pure healing potion at full HP would only waste a charge.
  if (item.heal !== undefined && !hasEffects && !canHeal) {
    return { wasted: true, subtitle: 'Already at full HP', lines: [{ label: 'No effect', total: '—' }] }
  }

  const lines: RollLine[] = []
  const out: ConsumeOutcome = { wasted: false, subtitle: 'Consumable used', lines }

  // Contributions aimed at this item. Resolved once, whether or not it heals, so
  // `riders` can be surfaced on a wasted use too — the player should see what
  // WOULD have applied.
  const res = graph ? resolve(graph, { kind: 'feature', subject: gid('item', item), tags: item.tags }) : null
  const contrib = res ? rollResolution(res) : { flat: 0, riders: [] as Rider[] }
  out.riders = contrib.riders
  if (res?.notes.length) out.notes = res.notes
  if (res?.problems.length) out.problems = res.problems

  if (canHeal) {
    const { total: rolled, breakdown } = rollHeal(item.heal!)
    const total = Math.max(0, rolled + contrib.flat)
    const next = max > 0 ? Math.min(max, cur + total) : cur + total
    const baseHp = base.hp ?? { current: 0, max: 0 }
    out.sheet = { ...base, hp: { ...baseHp, current: next } }
    lines.push({ label: 'Healed', total: `+${next - cur}`, breakdown: `${breakdown} · HP ${cur} → ${next}`, tone: 'heal' })
  }

  if (hasEffects) {
    const eff = {
      id: crypto.randomUUID(), name: item.name, icon: item.icon,
      effects: item.effects!, source: item.name, note: item.duration,
      desc: item.flavor, at: Date.now(),
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
