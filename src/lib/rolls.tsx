/**
 * Shared, ephemeral roll log. App-level state (mounted around the router) so dice
 * results survive screen navigation within a session — but it is NOT persisted to
 * Supabase (rolling is ephemeral, handoff §3). The Equipment weapon roller writes
 * here; the toast (components/RollToast) surfaces the newest entry; the Character
 * screen will later render the full scrollable history from this same context.
 */

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { AttackRoll, DamageRoll } from './weapons'
import type { AuditItem, Rider } from './graph'

/** A d20 roll behind an ability check, saving throw, or skill check — rolled on
 *  the Character screen. `rolls` holds one entry normally, two under adv/dis. */
export type CheckRoll = {
  mode: 'normal' | 'adv' | 'dis'
  rolls: number[]
  pick: number
  /** e.g. "14 + 2 DEX + 3 PROF" — everything except the trailing "= total". */
  breakdown: string
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
