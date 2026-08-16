/**
 * The Roll Context Panel's view model — a `RollEntry` reshaped into what the
 * rail renders, and nothing else.
 *
 * Pure and separate from the component for one reason: the totals arithmetic is
 * the part that can be silently wrong. A rider counted twice, or a rolled `ask`
 * that fails to reach the total, is a number a player trusts and shouldn't.
 * Here it is testable without a renderer.
 *
 * THE THREE RIDER STATES ARE THE ENGINE'S, not a second vocabulary:
 *
 *   resolved   — the engine decided it applies. A breakdown line, never a control.
 *   unresolved — depends on something only a human knows. A toggle.
 *   (absent)   — §32's two non-surfacing rows never reach here at all; resolve()
 *                already dropped them, which is why there is no third case.
 */
import type { Rider } from './graph.ts'
import type { RollEntry } from './rolls.tsx'
import { parseDice } from './dice.ts'

export type Die = { v: number; sides: number; dropped?: boolean }

export type RollLineView = {
  kind: 'attack' | 'damage' | 'check'
  label: string
  formula: string
  dice: Die[]
  /** 'vs' joins the dice under adv/dis — two contested rolls, not a sum. */
  mode?: 'adv' | 'dis'
  mods: number
  type?: string
  crit?: boolean
  total: number
}

export type FlagName = 'ADVANTAGE' | 'DISADVANTAGE' | 'CRIT'

/** A rider plus everything the panel needs to draw it without re-deriving. */
export type RiderView = {
  rider: Rider
  /** Index within the entry's flattened rider list — the patch address. */
  index: number
  group: string
  kind: 'value' | 'flag'
  grants?: FlagName
  /** Contributing right now: resolved, or a flag the player switched on, or an
   *  answered value rider whose dice have been rolled. */
  live: boolean
  value: number
}

const FLAG: Partial<Record<Rider['op'], FlagName>> = {
  adv: 'ADVANTAGE', dis: 'DISADVANTAGE', crit: 'CRIT',
}

/** What a rider contributes. A `manual` rider contributes its ROLLED faces, not
 *  its formula — the formula is what it shows before the player answers. */
export function riderValue(r: Rider): number {
  if (r.op !== 'add') return 0
  if (r.when === 'manual') return r.rolled ? (r.rolledDice ?? []).reduce((a, b) => a + b, 0) + r.flat : 0
  return r.flat
}

export function riderViews(entry: RollEntry): RiderView[] {
  const out: RiderView[] = []
  let i = 0
  for (const g of entry.riderGroups ?? []) {
    for (const rider of g.riders) {
      const kind = rider.op === 'add' ? 'value' as const : 'flag' as const
      const live = rider.when !== 'manual'
        ? true
        : rider.on && (kind === 'flag' || !!rider.rolled)
      out.push({ rider, index: i++, group: g.label, kind, grants: FLAG[rider.op], live, value: riderValue(rider) })
    }
  }
  return out
}

export const resolvedOf = (v: RiderView[]) => v.filter(r => r.rider.when !== 'manual')
export const unresolvedOf = (v: RiderView[]) => v.filter(r => r.rider.when === 'manual')

/** Die list for a dice expression plus its rolled faces. `sides` is recovered
 *  from the expression rather than stored, so nothing else had to change. */
function dice(expr: string | undefined, faces: number[]): Die[] {
  const sides = parseDice(expr ?? '')?.sides ?? 20
  return faces.map(v => ({ v, sides }))
}

/** The d20 line for a check or an attack: both dice, the loser struck through. */
function d20Line(
  kind: 'attack' | 'check', label: string,
  rolls: number[], pick: number, mods: number,
  mode: 'normal' | 'adv' | 'dis', crit: boolean,
): RollLineView {
  // Mark exactly ONE die as kept, even when both show the same face — otherwise
  // a double 17 under advantage renders as two dropped dice and no winner.
  let kept = false
  const list: Die[] = rolls.map(v => {
    const isPick = !kept && v === pick
    if (isPick) kept = true
    return { v, sides: 20, dropped: rolls.length > 1 && !isPick }
  })
  return {
    kind, label, formula: rolls.length > 1 ? '2d20' : 'd20', dice: list,
    mode: mode === 'normal' ? undefined : mode,
    mods, crit, total: pick + mods,
  }
}

export function lineViews(entry: RollEntry): RollLineView[] {
  const out: RollLineView[] = []
  const a = entry.attack
  if (a) out.push(d20Line('attack', 'Attack', a.rolls ?? [a.d20], a.d20, a.bonus, a.mode ?? 'normal', a.crit))

  const d = entry.damage
  if (d) {
    out.push({
      kind: 'damage', label: 'Damage', formula: d.diceExpr,
      dice: dice(d.diceExpr, d.dice), mods: d.bonus, type: d.type,
      crit: d.crit, total: d.total,
    })
  }

  const c = entry.check
  if (c) {
    const mods = c.total - c.pick
    out.push(d20Line('check', entry.kind === 'save' ? 'Save' : 'Check', c.rolls, c.pick, mods, c.mode, c.crit))
  }
  return out
}

export type RollTotals = {
  attack?: number
  damage?: number
  /** Damage split by type. One entry today; spells bring more. */
  byType: Record<string, number>
  flags: FlagName[]
  /** Unresolved riders the player has not settled — the "still waiting on you" note. */
  pending: number
}

export function rollTotals(entry: RollEntry, views: RiderView[]): RollTotals {
  const lines = lineViews(entry)
  const attackLine = lines.find(l => l.kind === 'attack' || l.kind === 'check')
  const byType: Record<string, number> = {}
  for (const l of lines.filter(x => x.kind === 'damage')) {
    byType[l.type ?? 'damage'] = (byType[l.type ?? 'damage'] ?? 0) + l.total
  }

  let attack = attackLine?.total
  const flags: FlagName[] = []
  for (const v of views) {
    if (!v.live) continue
    if (v.kind === 'flag') {
      if (v.grants && !flags.includes(v.grants)) flags.push(v.grants)
      continue
    }
    // `always` riders are ALREADY inside the line's mods — the roller folded
    // them in before the entry existed. Adding them here would double every
    // unconditional contribution, exactly as it would in total().
    if (v.rider.when === 'always') continue
    if (v.group === 'Attack' || v.group === 'Check' || v.group === 'Save') {
      if (attack !== undefined) attack += v.value
    } else {
      const t = v.rider.dmgType ?? entry.damage?.type ?? 'damage'
      byType[t] = (byType[t] ?? 0) + v.value
    }
  }

  const damageKeys = Object.keys(byType)
  return {
    attack,
    damage: damageKeys.length ? Object.values(byType).reduce((a, b) => a + b, 0) : undefined,
    byType,
    flags,
    pending: unresolvedOf(views).filter(v => !v.live).length,
  }
}
