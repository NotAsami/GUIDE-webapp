/**
 * Shared, ephemeral roll log. App-level state (mounted around the router) so dice
 * results survive screen navigation within a session — but it is NOT persisted to
 * Supabase (rolling is ephemeral, handoff §3). Every roll surface writes here;
 * the Roll Context Panel reads it as the full history and is the ONE place a roll
 * is presented in detail; the Character screen renders its own log from it; and
 * Bottombar watches the newest id to decide whether the ROLLS button pings.
 */

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { AttackRoll, DamageRoll } from './weapons'
import type { AuditItem, Rider } from './graph'
import type { RolledDie } from './dice'
import type { CheckTerm } from './dnd'
import type { AbilityKey } from './database.types'

/** A d20 roll behind an ability check, saving throw, or skill check — rolled on
 *  the Character screen. `rolls` holds one entry normally, two under adv/dis. */
export type CheckRoll = {
  mode: 'normal' | 'adv' | 'dis'
  rolls: RolledDie[]
  pick: number
  /** e.g. "14 + 2 DEX + 3 PROF" — everything except the trailing "= total". */
  breakdown: string
  /** The same parts, unjoined. The panel's modifier read-out itemises them, and
   *  re-splitting the string to get there would be parsing our own output. */
  terms?: CheckTerm[]
  total: number
  crit: boolean
  fumble: boolean
}

export type RollEntry = {
  id: string
  at: number
  kind: 'weapon' | 'check' | 'save' | 'custom'
  /** Headline, e.g. the weapon name. */
  title: string
  /** Secondary line, e.g. "Main Hand · Attack". */
  subtitle?: string
  icon?: string
  /** Weapon rolls carry both. */
  attack?: AttackRoll
  damage?: DamageRoll
  /** Ability check / saving throw / skill check rolls (Character screen). */
  check?: CheckRoll
  /** The DC the TARGET rolls against — a spell's save. Not a roll: it is a
   *  static number the caster imposes, so it has no dice, no pick and no crit,
   *  and forcing it into CheckRoll would give it three fields that mean nothing.
   *  Fills the slot an attack roll would occupy. */
  saveDC?: number
  /** Which save it is, so the line can say "DEX Save DC" rather than a bare
   *  number. Set together with `saveDC` or not at all. */
  saveAbility?: AbilityKey
  /** What this roll was ABOUT — the instance id on the character, so the panel's
   *  catalog sheet can look it up. Not a gid: a gid falls back to the instance id
   *  when `item_id` is absent (§43), and this lookup is local anyway. Absent for
   *  a save or a check, which are about nothing you could open an entry on. */
  subject?: { kind: 'weapon' | 'feature' | 'spell' | 'item'; id: string }
  /** Generic result lines (heal, buff applied, …) for non-weapon rolls. */
  lines?: RollLine[]
  /** Feature-graph contributions the player still has a say in, or that are
   *  worth naming. Additive on purpose: §7 splits the roll context panel into a
   *  base breakdown that "needs nothing from the engine" and riders that do, so
   *  the `breakdown` strings above stay exactly as they were and every existing
   *  renderer keeps working. A character with nothing authored has no riders and
   *  a quiet rider section — empty, not broken.
   *
   *  GROUPED, not flat: one action can raise two rolls, and "+1d4 to the attack"
   *  is a different statement from "+1d4 to the damage". Concatenating them
   *  loses which is which before anything can render it. */
  riderGroups?: RiderGroup[]
  /** Engine failures for this roll — a formula that resolved to nothing at these
   *  values. Kept apart from `lines` for the same reason Resolution keeps them
   *  apart from `notes`: a broken formula is not rule text. */
  problems?: AuditItem[]
  /** Authored `note` ops that matched this roll. */
  notes?: string[]
  /** This entry's own surface already confirmed it, so the ROLLS button must not
   *  ping for it — a rest shows its own toast, and one press earning two
   *  notifications is the noise the roll toast was retired for. It still belongs
   *  in the log: the panel is the history, and being quiet is about announcing,
   *  not about recording. */
  quiet?: boolean
}

/** Riders, labelled by the roll that produced them ("Attack", "Damage", "Save"). */
export type RiderGroup = { label: string; riders: Rider[] }

export type RollLine = {
  label: string
  total: string
  breakdown?: string
  tone?: 'heal' | 'buff'
}

interface RollLogValue {
  rolls: RollEntry[]
  /** Append a roll (id + timestamp filled in). Call from event handlers only. */
  addRoll: (entry: Omit<RollEntry, 'id' | 'at'>) => RollEntry
  /** Patch one entry in place.
   *
   *  Answering an `ask` and rolling its dice both mutate a roll that has ALREADY
   *  happened, which an append-only log cannot express. Deliberately narrow: the
   *  Roll Context Panel is the only caller, and every other producer stays
   *  fire-and-forget. `addRoll` already returns the entry, so a caller that needs
   *  to patch its own roll has the id. */
  updateRoll: (id: string, patch: Partial<RollEntry>) => void
  clear: () => void
}

const MAX_ROLLS = 50
const RollLogContext = createContext<RollLogValue | null>(null)

export function RollLogProvider({ children }: { children: ReactNode }) {
  const [rolls, setRolls] = useState<RollEntry[]>([])

  const addRoll = useCallback((entry: Omit<RollEntry, 'id' | 'at'>) => {
    const full: RollEntry = { ...entry, id: crypto.randomUUID(), at: Date.now() }
    setRolls(prev => [full, ...prev].slice(0, MAX_ROLLS))
    return full
  }, [])

  const updateRoll = useCallback<RollLogValue['updateRoll']>((id, patch) => {
    setRolls(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)))
  }, [])

  const clear = useCallback(() => setRolls([]), [])

  const value = useMemo(() => ({ rolls, addRoll, updateRoll, clear }), [rolls, addRoll, updateRoll, clear])
  return <RollLogContext.Provider value={value}>{children}</RollLogContext.Provider>
}

export function useRollLog(): RollLogValue {
  const ctx = useContext(RollLogContext)
  if (!ctx) throw new Error('useRollLog must be used within a RollLogProvider')
  return ctx
}
