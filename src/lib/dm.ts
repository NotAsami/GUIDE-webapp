import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { CharacterRow, CharacterUpdate } from './database.types'
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
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
  /** Patch any character row BY ID — the operator's cross-character write. The
   *  caller pre-spreads the JSONB section (e.g. `{ sheet: { ...row.sheet, hp } }`)
   *  so the merge here is a shallow row-level replace and never clobbers sibling
   *  sections. Goes through the `dm_all` RLS policy (write only succeeds for a DM,
   *  or for a row you own). Optimistic, with reconcile from the returned row. */
  updateCharacter: (id: string, patch: CharacterUpdate) => Promise<void>
}

/** Reads EVERY character row — the operator's cross-character view. Only returns
 *  more than the caller's own row when the `dm_all` RLS policy applies (i.e. the
 *  user is in `dm_users`); a plain player gets just their own character back, so
 *  always gate the Operator Console on useDmStatus() rather than on row count. */
export function useDmParty(): DmPartyState {
  const { session } = useAuth()
  const [party, setParty] = useState<CharacterRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    if (!session) {
      setParty([])
      setLoading(false)
      return
    }
    setLoading(true)
    const { data, error: err } = await supabase
      .from('characters')
      .select('*')
      .order('name', { ascending: true })
    if (err) {
      setError(err.message)
      setParty([])
    } else {
      setParty((data as CharacterRow[]) ?? [])
      setError(null)
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

  return { party, loading, error, refetch: fetchAll, updateCharacter }
}
