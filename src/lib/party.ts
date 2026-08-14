/** Cast-on-party-member plumbing (Spellbook "Party Cast" button). The wall
 *  between characters is real (`own_character` RLS, 0001_init.sql) — both
 *  calls here go through the SECURITY DEFINER functions in migration 0011,
 *  the only path that can read/write another PC's row. */

import { supabase } from './supabase'

export type PartyMember = {
  id: string
  name: string
  race: string | null
  class: string | null
  level: number | null
  hp_current: number | null
  hp_max: number | null
}

/** Other bound characters (never your own row) — id/name/race/class/level/hp
 *  only, never the full sheet. */
export async function fetchPartyRoster(): Promise<PartyMember[]> {
  const { data, error } = await supabase.rpc('list_party_roster')
  if (error) throw error
  return (data ?? []) as PartyMember[]
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
