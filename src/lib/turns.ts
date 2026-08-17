/**
 * The round tracker — what "advance a turn" does to a character's active effects.
 *
 * Pure, and separate from the button, because every part of it is the kind of
 * arithmetic that is wrong quietly: an effect that expires a turn late is a
 * player getting a bonus they no longer have, and one that expires a turn early
 * is one they paid for and lost.
 *
 * THE UNIT IS A TURN, and everything converts to it on the way IN rather than on
 * the way out. `duration` on an item and `note` on an applied effect are free
 * text — "10 rounds", "1 minute", and in live data one that just says "Haste" —
 * so nothing could be counted down until a number was stored. `turns` is that
 * number, written when the effect is applied.
 *
 * ABSENT `turns` MEANS UNTRACKED, not zero. "Until rest", a permanent boon, a
 * condition the DM will lift by hand — all of them simply do not tick. Treating
 * an absent count as expired would delete every effect the moment the button was
 * first pressed.
 */
import type { ActiveEffect } from './database.types.ts'

/** Rounds per unit. A 5e round is six seconds, so a minute is ten of them —
 *  which is the conversion the user asked for in so many words. Hours and days
 *  are here for completeness; nothing sane ticks a day down one turn at a time,
 *  and an effect that long is better authored as untracked. */
export const TURNS_PER: Record<string, number> = {
  round: 1, turn: 1, minute: 10, hour: 600, day: 14400,
}

/** A duration the DM chose, as a number of turns — or undefined for "untracked",
 *  which is what "until rest" and anything longer than a day mean in practice. */
export function durationTurns(amount: number, unit: string): number | undefined {
  const per = TURNS_PER[unit]
  if (!per || !Number.isFinite(amount) || amount <= 0) return undefined
  const turns = Math.round(amount * per)
  // Past a day the count stops being useful and starts being a number nobody
  // will ever watch reach zero. Untracked says the same thing more honestly.
  return turns > TURNS_PER.day ? undefined : turns
}

/** One effect's per-turn damage, ready to be rolled. */
export type TurnTick = { id: string; name: string; dice: string; icon?: string }

export type TurnAdvance = {
  /** The effects that remain, with their counts decremented. */
  next: ActiveEffect[]
  /** Effects whose last turn just ran out. Removed from `next`. */
  expired: ActiveEffect[]
  /** Effects whose count went DOWN but has not run out, already decremented.
   *  Reported because a tracker that only speaks when something expires is one
   *  the player cannot trust between expiries — pressing the button and seeing
   *  nothing reads as "it did nothing", not "three turns left". */
  counted: ActiveEffect[]
  /** Effects that deal damage each turn — the player still has to ROLL these,
   *  which is why they come back as a list rather than a number. */
  ticks: TurnTick[]
  /** How many effects still have a countdown running. */
  running: number
}

/** Advance one turn.
 *
 *  Order matters and is deliberate: an effect ticks on the turn it expires. A
 *  poison with one turn left still poisons you as it wears off — resolving the
 *  damage first and the expiry second is the difference between six turns of
 *  poison and five. */
export function advanceTurn(effects: ActiveEffect[]): TurnAdvance {
  const next: ActiveEffect[] = []
  const expired: ActiveEffect[] = []
  const counted: ActiveEffect[] = []
  const ticks: TurnTick[] = []

  for (const e of effects) {
    if (e.tick?.trim()) ticks.push({ id: e.id, name: e.name, dice: e.tick.trim(), icon: e.icon })

    if (typeof e.turns !== 'number') { next.push(e); continue }
    const left = e.turns - 1
    if (left <= 0) { expired.push(e); continue }
    const dec = { ...e, turns: left }
    next.push(dec)
    counted.push(dec)
  }

  return { next, expired, counted, ticks, running: counted.length }
}

/** How a countdown reads on a status chip. Short, because it sits beside a name
 *  in a strip that is already tight — and a turn count nobody can see is a
 *  countdown the player cannot plan around. */
export function turnsLabel(e: ActiveEffect): string | null {
  if (typeof e.turns !== 'number') return null
  return e.turns === 1 ? 'last turn' : `${e.turns} turns`
}
