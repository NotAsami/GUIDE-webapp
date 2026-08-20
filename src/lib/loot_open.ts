/**
 * Player-side read of the open loot roll.
 *
 * READ ONLY, AND THAT IS THE WHOLE DESIGN. There is no claim call to sit beside
 * this the way `buyItem` sits beside `useOpenShop` — migration 0020 gives
 * players a SELECT policy and nothing else. The DM assigns each line; the party
 * watches. That is what removes the contention problem rather than solving it:
 * with one writer, two players cannot both take the last torch.
 *
 * Mirrors character.ts's realtime rule: the postgres_changes event is only a
 * signal, never adopt `payload.new` — refetch the row. Which matters more here
 * than anywhere else, because the party is watching assignments land live and a
 * stale payload would show the wrong name against an item.
 */
import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { LootOpenRow } from './database.types'

export interface OpenLootState {
  roll: LootOpenRow | null
  loading: boolean
}

/** The roll currently open for this character, or null. `characterId` isn't
 *  used to filter the query — the `player_read_open_loot` policy already scopes
 *  rows to "open, and either whole-party or targeted at me" — it just gates the
 *  hook until a character is bound. */
export function useOpenLoot(characterId: string | undefined): OpenLootState {
  const [roll, setRoll] = useState<LootOpenRow | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchOpen = useCallback(async () => {
    if (!characterId) { setRoll(null); setLoading(false); return }
    const { data } = await supabase.from('loot_open').select('*').eq('is_open', true)
    setRoll(((data as LootOpenRow[]) ?? [])[0] ?? null)
    setLoading(false)
  }, [characterId])

  useEffect(() => { void fetchOpen() }, [fetchOpen])

  useEffect(() => {
    if (!characterId) return
    const ch = supabase
      .channel('loot-open-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'loot_open' }, () => void fetchOpen())
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [characterId, fetchOpen])

  return { roll, loading }
}
