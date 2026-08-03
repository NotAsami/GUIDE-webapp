import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { QuestRow, SessionRow } from './database.types'
import { useAuth } from './auth'

export interface CampaignState {
  quests: QuestRow[]
  /** Newest first — a session log reads backwards from the last game. */
  sessions: SessionRow[]
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
}

/** The player's READ-ONLY view of the campaign tables behind the Journal.
 *
 *  Deliberately not useDmCampaign() (lib/dm.ts): that hook also fetches
 *  `quest_secrets`, which no player policy can reach, and exposes create/update/
 *  delete that would silently no-op against RLS. Everything a player may see is
 *  granted by migration 0007; writes are the DM's, in the Operator Console.
 *
 *  Called from the Journal screen, not from Layout — campaign data is
 *  screen-local, and Layout would refetch it on every route change. There is no
 *  realtime subscription (only `characters` is in the publication), so a DM edit
 *  lands on the player's next reload. */
export function useCampaign(): CampaignState {
  const { session } = useAuth()
  const [quests, setQuests] = useState<QuestRow[]>([])
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    if (!session) {
      setQuests([]); setSessions([]); setLoading(false)
      return
    }
    setLoading(true)
    const [qs, ss] = await Promise.all([
      // created_at, not title: edits must not reshuffle the index under the player.
      supabase.from('quests').select('*').order('created_at', { ascending: true }),
      supabase.from('sessions').select('*').order('num', { ascending: false }),
    ])
    const err = qs.error ?? ss.error
    setError(err ? err.message : null)
    setQuests((qs.data as QuestRow[]) ?? [])
    setSessions((ss.data as SessionRow[]) ?? [])
    setLoading(false)
  }, [session])

  useEffect(() => { void fetchAll() }, [fetchAll])

  return { quests, sessions, loading, error, refetch: fetchAll }
}
