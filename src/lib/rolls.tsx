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
}

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

  const clear = useCallback(() => setRolls([]), [])

  const value = useMemo(() => ({ rolls, addRoll, clear }), [rolls, addRoll, clear])
  return <RollLogContext.Provider value={value}>{children}</RollLogContext.Provider>
}

export function useRollLog(): RollLogValue {
  const ctx = useContext(RollLogContext)
  if (!ctx) throw new Error('useRollLog must be used within a RollLogProvider')
  return ctx
}
