import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import type {
  CharacterRow, CharacterUpdate, CharacterSecret, CharacterSecretUpdate,
  QuestRow, QuestInsert, QuestUpdate, QuestSecret, QuestSecretUpdate,
  SessionRow, SessionInsert, SessionUpdate,
} from './database.types'
import { useAuth } from './auth'

/** Is the current user the DM? Checked against the `dm_users` table — the same
 *  membership the `dm_all` RLS policy uses to grant cross-character access
 *  (supabase/migrations/0001_init.sql). The `dm_users_self_read` policy lets a
 *  user read their OWN row, so this query works client-side without elevation.
 *
 *  Grant yourself DM once (see supabase/grant_dm.sql) or every Operator Console
 *  surface looks broken: the gate redirects you off `/dm`, and useDmParty()
 *  returns only your one owned character instead of the whole party. */
export function useDmStatus(): { isDm: boolean; loading: boolean } {
  const { session, loading: authLoading } = useAuth()
  const [isDm, setIsDm] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    if (authLoading) return
    if (!session) {
      setIsDm(false)
      setLoading(false)
      return
    }
    setLoading(true)
    supabase
      .from('dm_users')
      .select('user_id')
      .eq('user_id', session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        setIsDm(!!data)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [session, authLoading])

  return { isDm, loading }
}

interface DmPartyState {
  party: CharacterRow[]
  /** DM-only per-character secrets (digitization / true_lore), keyed by character
   *  id. A character with no row yet is simply absent — read sites default it to
   *  `{ digitization: 0, true_lore: '' }`. Only a DM can read this table at all
   *  (no player RLS policy on `character_secrets`), so it can never reach a player. */
  secrets: Record<string, CharacterSecret>
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
  /** Patch any character row BY ID — the operator's cross-character write. The
   *  caller pre-spreads the JSONB section (e.g. `{ sheet: { ...row.sheet, hp } }`)
   *  so the merge here is a shallow row-level replace and never clobbers sibling
   *  sections. Goes through the `dm_all` RLS policy (write only succeeds for a DM,
   *  or for a row you own). Optimistic, with reconcile from the returned row. */
  updateCharacter: (id: string, patch: CharacterUpdate) => Promise<void>
  /** Upsert a character's DM-only secret. Existing rows are absent for untouched
   *  characters, so this UPSERTs (a plain update would silently hit zero rows);
   *  unspecified columns fall back to their defaults on first insert. Optimistic. */
  updateSecret: (characterId: string, patch: CharacterSecretUpdate) => Promise<void>
}

/** Reads EVERY character row — the operator's cross-character view. Only returns
 *  more than the caller's own row when the `dm_all` RLS policy applies (i.e. the
 *  user is in `dm_users`); a plain player gets just their own character back, so
 *  always gate the Operator Console on useDmStatus() rather than on row count. */
export function useDmParty(): DmPartyState {
  const { session } = useAuth()
  const [party, setParty] = useState<CharacterRow[]>([])
  const [secrets, setSecrets] = useState<Record<string, CharacterSecret>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    if (!session) {
      setParty([])
      setSecrets({})
      setLoading(false)
      return
    }
    setLoading(true)
    // Fetch characters and their DM-only secrets together. The secrets select
    // returns zero rows for a non-DM (RLS), so it's harmless to issue either way.
    const [chars, secs] = await Promise.all([
      supabase.from('characters').select('*').order('name', { ascending: true }),
      supabase.from('character_secrets').select('*'),
    ])
    if (chars.error) {
      setError(chars.error.message)
      setParty([])
    } else {
      setParty((chars.data as CharacterRow[]) ?? [])
      setError(null)
    }
    if (!secs.error && secs.data) {
      const map: Record<string, CharacterSecret> = {}
      for (const s of secs.data as CharacterSecret[]) map[s.character_id] = s
      setSecrets(map)
    }
    setLoading(false)
  }, [session])

  useEffect(() => {
    void fetchAll()
  }, [fetchAll])

  const updateCharacter = useCallback<DmPartyState['updateCharacter']>(async (id, patch) => {
    // Optimistic: row-level shallow merge (caller already spread the section).
    let previous: CharacterRow | undefined
    setParty(prev => prev.map(c => {
      if (c.id !== id) return c
      previous = c
      return { ...c, ...patch } as CharacterRow
    }))
    const { data, error: err } = await supabase
      .from('characters')
      .update(patch)
      .eq('id', id)
      .select()
      .single<CharacterRow>()
    if (err) {
      setError(err.message)
      if (previous) setParty(prev => prev.map(c => (c.id === id ? previous! : c))) // roll back
    } else if (data) {
      setParty(prev => prev.map(c => (c.id === id ? data : c)))
    }
  }, [])

  const updateSecret = useCallback<DmPartyState['updateSecret']>(async (characterId, patch) => {
    // Optimistic: merge onto the existing secret (or a fresh zero-value one).
    let previous: CharacterSecret | undefined
    setSecrets(prev => {
      previous = prev[characterId]
      const base: CharacterSecret = previous ?? { character_id: characterId, digitization: 0, true_lore: '', updated_at: '' }
      return { ...prev, [characterId]: { ...base, ...patch } }
    })
    const { data, error: err } = await supabase
      .from('character_secrets')
      .upsert({ character_id: characterId, ...patch }, { onConflict: 'character_id' })
      .select()
      .single<CharacterSecret>()
    if (err) {
      setError(err.message)
      setSecrets(prev => {
        const next = { ...prev }
        if (previous) next[characterId] = previous
        else delete next[characterId] // roll back the speculative insert
        return next
      })
    } else if (data) {
      setSecrets(prev => ({ ...prev, [characterId]: data }))
    }
  }, [])

  return { party, secrets, loading, error, refetch: fetchAll, updateCharacter, updateSecret }
}

export interface DmCampaignState {
  quests: QuestRow[]
  /** DM-only quest notes keyed by quest id; absent until the DM authors them. */
  questSecrets: Record<string, QuestSecret>
  sessions: SessionRow[]
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
  createQuest: (q: QuestInsert) => Promise<QuestRow | null>
  updateQuest: (id: string, patch: QuestUpdate) => Promise<void>
  deleteQuest: (id: string) => Promise<void>
  updateQuestSecret: (questId: string, patch: QuestSecretUpdate) => Promise<void>
  createSession: (s: SessionInsert) => Promise<SessionRow | null>
  updateSession: (id: string, patch: SessionUpdate) => Promise<void>
  deleteSession: (id: string) => Promise<void>
}

/** Campaign-level authoring data (quests + their DM-only notes + sessions). All
 *  DM-gated by the per-table `dm_*` RLS policies (migration 0003); a non-DM gets
 *  empty arrays. Separate from useDmParty() because it isn't per-character. */
export function useDmCampaign(): DmCampaignState {
  const { session } = useAuth()
  const [quests, setQuests] = useState<QuestRow[]>([])
  const [questSecrets, setQuestSecrets] = useState<Record<string, QuestSecret>>({})
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    if (!session) {
      setQuests([]); setQuestSecrets({}); setSessions([]); setLoading(false)
      return
    }
    setLoading(true)
    const [qs, qsec, ss] = await Promise.all([
      supabase.from('quests').select('*').order('created_at', { ascending: true }),
      supabase.from('quest_secrets').select('*'),
      supabase.from('sessions').select('*').order('num', { ascending: true }),
    ])
    if (qs.error) { setError(qs.error.message); setQuests([]) }
    else { setQuests((qs.data as QuestRow[]) ?? []); setError(null) }
    if (!qsec.error && qsec.data) {
      const map: Record<string, QuestSecret> = {}
      for (const s of qsec.data as QuestSecret[]) map[s.quest_id] = s
      setQuestSecrets(map)
    }
    if (!ss.error && ss.data) setSessions((ss.data as SessionRow[]) ?? [])
    setLoading(false)
  }, [session])

  useEffect(() => { void fetchAll() }, [fetchAll])

  const createQuest = useCallback<DmCampaignState['createQuest']>(async (q) => {
    const { data, error: err } = await supabase.from('quests').insert(q).select().single<QuestRow>()
    if (err) { setError(err.message); return null }
    setQuests(prev => [...prev, data])
    return data
  }, [])

  const updateQuest = useCallback<DmCampaignState['updateQuest']>(async (id, patch) => {
    let previous: QuestRow | undefined
    setQuests(prev => prev.map(q => { if (q.id !== id) return q; previous = q; return { ...q, ...patch } as QuestRow }))
    const { data, error: err } = await supabase.from('quests').update(patch).eq('id', id).select().single<QuestRow>()
    if (err) { setError(err.message); if (previous) setQuests(prev => prev.map(q => (q.id === id ? previous! : q))) }
    else if (data) setQuests(prev => prev.map(q => (q.id === id ? data : q)))
  }, [])

  const deleteQuest = useCallback<DmCampaignState['deleteQuest']>(async (id) => {
    const snapshot = quests
    setQuests(prev => prev.filter(q => q.id !== id))
    const { error: err } = await supabase.from('quests').delete().eq('id', id)
    if (err) { setError(err.message); setQuests(snapshot) }
  }, [quests])

  const updateQuestSecret = useCallback<DmCampaignState['updateQuestSecret']>(async (questId, patch) => {
    let previous: QuestSecret | undefined
    setQuestSecrets(prev => {
      previous = prev[questId]
      const base: QuestSecret = previous ?? { quest_id: questId, gm_notes: '', updated_at: '' }
      return { ...prev, [questId]: { ...base, ...patch } }
    })
    const { data, error: err } = await supabase
      .from('quest_secrets').upsert({ quest_id: questId, ...patch }, { onConflict: 'quest_id' })
      .select().single<QuestSecret>()
    if (err) {
      setError(err.message)
      setQuestSecrets(prev => { const next = { ...prev }; if (previous) next[questId] = previous; else delete next[questId]; return next })
    } else if (data) setQuestSecrets(prev => ({ ...prev, [questId]: data }))
  }, [])

  const createSession = useCallback<DmCampaignState['createSession']>(async (s) => {
    const { data, error: err } = await supabase.from('sessions').insert(s).select().single<SessionRow>()
    if (err) { setError(err.message); return null }
    setSessions(prev => [...prev, data].sort((a, b) => a.num - b.num))
    return data
  }, [])

  const updateSession = useCallback<DmCampaignState['updateSession']>(async (id, patch) => {
    let previous: SessionRow | undefined
    setSessions(prev => prev.map(s => { if (s.id !== id) return s; previous = s; return { ...s, ...patch } as SessionRow }))
    const { data, error: err } = await supabase.from('sessions').update(patch).eq('id', id).select().single<SessionRow>()
    if (err) { setError(err.message); if (previous) setSessions(prev => prev.map(s => (s.id === id ? previous! : s))) }
    else if (data) setSessions(prev => prev.map(s => (s.id === id ? data : s)).sort((a, b) => a.num - b.num))
  }, [])

  const deleteSession = useCallback<DmCampaignState['deleteSession']>(async (id) => {
    const snapshot = sessions
    setSessions(prev => prev.filter(s => s.id !== id))
    const { error: err } = await supabase.from('sessions').delete().eq('id', id)
    if (err) { setError(err.message); setSessions(snapshot) }
  }, [sessions])

  return {
    quests, questSecrets, sessions, loading, error, refetch: fetchAll,
    createQuest, updateQuest, deleteQuest, updateQuestSecret,
    createSession, updateSession, deleteSession,
  }
}
