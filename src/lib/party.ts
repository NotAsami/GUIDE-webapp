/** Cast-on-party-member plumbing (Spellbook "Party Cast" button). The wall
 *  between characters is real (`own_character` RLS, 0001_init.sql) — both
 *  calls here go through the SECURITY DEFINER functions in migration 0011,
 *  the only path that can read/write another PC's row. */

import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { useAuth } from './auth'
import type { ArmedMod, Json, PartyRosterRow } from './database.types'

/** Other bound characters (never your own row) — the projection and nothing
 *  else. The shape is `PartyRosterRow` (database.types.ts), which is where the
 *  function's return columns are already described; a second copy of it here
 *  was one more thing to keep in step every time the projection widened. */
export async function fetchPartyRoster(): Promise<PartyRosterRow[]> {
  const { data, error } = await supabase.rpc('list_party_roster')
  if (error) throw error
  return (data ?? []) as PartyRosterRow[]
}

export type PartyRosterState = {
  roster: PartyRosterRow[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

/** The party HUD's roster. Fetched ONCE — the live numbers arrive over the
 *  presence channel (lib/presence.ts), because Realtime respects RLS and a
 *  player can never subscribe to another player's row. What this call provides
 *  is the identity (name, class, level) and the last-known `public_vitals` for
 *  anyone who is currently offline. */
export function usePartyRoster(): PartyRosterState {
  const { session } = useAuth()
  const [roster, setRoster] = useState<PartyRosterRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!session) { setRoster([]); setLoading(false); return }
    try {
      setRoster(await fetchPartyRoster())
      setError(null)
    } catch (e) {
      // A player with no character of their own gets zero rows, not an error —
      // this branch is a real failure, and the HUD simply does not draw.
      setError(e instanceof Error ? e.message : String(e))
      setRoster([])
    }
    setLoading(false)
  }, [session])

  useEffect(() => { void refresh() }, [refresh])

  return { roster, loading, error, refresh }
}

export type PartyEffectInput = { name: string; icon?: string; kind?: 'buff' | 'cond' | 'debuff'; note?: string }
export type PartyCastResult =
  | { ok: true; target_name: string; hp_current: number | null; hp_max: number | null }
  | { ok: false; reason: string }

/** Applies a flat heal and/or pushes a status effect onto `targetId`'s row.
 *  Dumb by design (handoff request): no range check, no concentration
 *  tracking, no save adjudication — just the numbers the caller already
 *  rolled/authored. `heal` OR `effect` is typically set, not both. */
export async function castPartyEffect(
  targetId: string,
  heal: number | null,
  effect: PartyEffectInput | null,
): Promise<PartyCastResult> {
  const { data, error } = await supabase.rpc('cast_party_effect', {
    p_target: targetId, p_heal: heal, p_effect: effect,
  })
  if (error) return { ok: false, reason: error.message }
  return data as PartyCastResult
}

export type PartyGrantResult =
  | { ok: true; target_name: string; label: string; value: string | null }
  | { ok: false; reason: string }

/** Places one armed modifier on `targetId`'s row — the `grant` op's write.
 *
 *  The mod arrives WITHOUT `id`, `source`, `sourceName` or `at`: migration 0022
 *  stamps all four, and rebuilds the rest of the object from a whitelist. This
 *  is the one path where a player hands the server a payload bound for another
 *  player's row, so what it may contain is the server's answer, not ours.
 *
 *  Dumb in the same way castPartyEffect is: no range check, no "can they see or
 *  hear you", no one-die-at-a-time rule. The bard applies those at the table. */
export async function grantPartyArm(
  targetId: string,
  /** Without `id`/`at`: the server stamps those, and `picks`/`spent` are
   *  dropped by its whitelist — a granted die is one die, not a pick group. */
  mod: Omit<ArmedMod, 'id' | 'at'>,
): Promise<PartyGrantResult> {
  const { data, error } = await supabase.rpc('grant_party_arm', { p_target: targetId, p_mod: mod as Json })
  if (error) return { ok: false, reason: error.message }
  return data as PartyGrantResult
}
