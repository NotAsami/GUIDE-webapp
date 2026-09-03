/**
 * Shared, ephemeral roll log. App-level state (mounted around the router) so dice
 * results survive screen navigation within a session — but it is NOT persisted to
 * Supabase (rolling is ephemeral, handoff §3). Every roll surface writes here —
 * weapons, spells, checks, potions and rests alike, which is what lets one toast
 * and one panel serve all of them.
 *
 * Three readers, deliberately different jobs: RollToast is the glance, the Roll
 * Context Panel is the full history and the only place a roll can be ARGUED with,
 * and the Character screen keeps its own log. Bottombar reads it too, but only to
 * count what is still unresolved.
 */

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { AttackRoll, DamageRoll } from './weapons'
import type { AuditItem, GraphContext, Rider } from './graph'
import { resolve, rollResolution } from './graph'
import type { RolledDie } from './dice'
import { rolledDice } from './dice'
import type { CheckTerm } from './dnd'
import { composeCheck, effectiveMode, usesProficiency } from './dnd'
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
  /** WHO THE ROLL WAS AGAINST, when Foundry said so. `hit` is undefined when
   *  there was a target but no verdict to reach (no AC), which the panel shows
   *  as a target with no outcome rather than as a miss. */
  target?: { name: string; hit?: boolean }
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
  /** The player has seen this entry in the open panel — which settles it.
   *
   *  What stops the nav badge pulsing forever, and it covers an unanswered `ask`
   *  too: leaving a toggle off IS an answer ("it missed, so it did not apply"),
   *  and treating that as outstanding would pulse at someone already done. See
   *  `pendingOf` in lib/rollView.ts. */
  acked?: boolean
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

/* ---------- building a d20 check ---------- */

export type CheckRequest = {
  kind: 'check' | 'save'
  /** Sub-key for `roll:<kind>.<sub>` — the ability for a save or an ability
   *  check, the skill key for a skill check, `initiative` for initiative. */
  sub: string
  title: string
  subtitle?: string
  icon?: string
  /** The named parts, from saveTerms / skillTerms / abilityCheckTerms. */
  terms: CheckTerm[]
  /** The player's OWN adv/dis switch, before the graph has had its say. Absent
   *  is 'normal' — a surface with no switch (the Stats screen's initiative cell)
   *  still picks up advantage the engine grants, which is the whole of Feral
   *  Instinct. */
  mode?: 'normal' | 'adv' | 'dis'
}

/**
 * One d20 check, resolved against the graph and shaped into a log entry.
 *
 * SHARED because it now has two callers. It lived inside Character.tsx, which
 * was correct while the hex ring was the only thing that rolled a d20 — but
 * initiative rolls from the Stats screen's Combat widget, and a second copy of
 * "resolve, apply adv/dis, roll, compose, attach riders" is a second answer to
 * how a check is made. They would agree today and drift on the first change.
 *
 * Returns the entry rather than logging it: the caller owns what happens next
 * (Character flashes the ability hexagon, Stats flashes its cell), and a builder
 * that also wrote to the log could not be called by a surface that wants to look
 * at the result first.
 */
export function buildCheck(graph: GraphContext, req: CheckRequest): Omit<RollEntry, 'id' | 'at'> & { check: CheckRoll } {
  // The same boundary the weapon roller uses, on a roll kind that has no subject.
  // `proficient` is read off the terms that built this check — see usesProficiency.
  const res = resolve(graph, { kind: req.kind, sub: req.sub, proficient: usesProficiency(req.terms) })
  /* Graph dice on a d20 roll are rolled NOW — the total is one number and an
     unrolled term has nowhere to live. (Damage dice stay unrolled so a crit can
     double them; a check has no crit multiplier, so `double` is never set.) */
  const contrib = rollResolution(res)

  const eff = effectiveMode(req.mode ?? 'normal', res.adv, res.dis)
  const rolls = rolledDice(eff === 'normal' ? 1 : 2, 20)
  const faces = rolls.map(d => d.v)
  const pick = eff === 'adv' ? Math.max(...faces) : eff === 'dis' ? Math.min(...faces) : faces[0]

  const terms = [...req.terms, { label: 'FEAT', value: contrib.flat }]
  const { total, breakdown, crit, fumble } = composeCheck(pick, terms, res.critFrom, res.floor)

  return {
    kind: req.kind, title: req.title, subtitle: req.subtitle, icon: req.icon ?? 'fa-dice-d20',
    check: { mode: eff, rolls, pick, breakdown, terms, total, crit, fumble },
    riderGroups: contrib.riders.length
      ? [{ label: req.kind === 'save' ? 'Save' : 'Check', riders: contrib.riders }]
      : undefined,
    notes: res.notes.length ? res.notes : undefined,
    problems: res.problems.length ? res.problems : undefined,
  }
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
