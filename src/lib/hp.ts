import type { HP } from './database.types.ts'

export type HpChange = { kind: 'damage' | 'heal' | 'temp'; amount: number }

/**
 * One HP change, as the table speaks it. Damage eats temporary HP first;
 * healing stops at the EFFECTIVE max (shard bonuses included); temp HP is set,
 * not added — 5e temp HP never stacks, the player picks the bigger pool.
 *
 * `hp.max` passes through untouched: the persisted max is the authored base,
 * and baking a shard bonus into it would survive ejecting the shard.
 */
export function applyHp(hp: HP, effMax: number, change: HpChange): HP {
  const n = Math.max(0, Math.floor(change.amount))
  const temp = hp.temp ?? 0
  if (change.kind === 'temp') return { ...hp, temp: n }
  if (change.kind === 'heal') return { ...hp, current: Math.min(effMax, hp.current + n) }
  const absorbed = Math.min(temp, n)
  return { ...hp, temp: temp - absorbed, current: Math.max(0, hp.current - (n - absorbed)) }
}
