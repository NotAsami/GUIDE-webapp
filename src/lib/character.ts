import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import type { CharacterRow, CharacterSection, CharacterUpdate, ShardTree } from './database.types'
import { useAuth } from './auth'
import { characterStore } from './characterStore'
import { writeCharacter } from './characterWrite'
import type { SaveResult } from './saveResult'

function applyIfNewer(prev: CharacterRow | null, next: CharacterRow): CharacterRow {
  return !prev || next.id !== prev.id || next.updated_at >= prev.updated_at ? next : prev
}

interface CharacterState {
  character: CharacterRow | null
  loading: boolean
  error: string | null
  saveError: string | null
  dismissSaveError: () => void
  updateSection: <K extends CharacterSection>(section: K, next: CharacterRow[K]) => Promise<SaveResult>
  updateSections: (patch: Partial<Pick<CharacterRow, CharacterSection>>) => Promise<SaveResult>
  refetch: () => Promise<void>
}

/** Keep confirmed server state on screen. Writes merge disjoint changes and use
 * a database compare-and-swap; a failed request never rolls back another save. */
export function useCharacter(shardTrees: Record<string, ShardTree> = {}): CharacterState {
  const { session } = useAuth()
  const userId = session?.user.id
  const activeUser = useRef(userId)
  activeUser.current = userId
  const [character, setCharacter] = useState<CharacterRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const fetchOnce = useCallback(async () => {
    if (!userId) { setCharacter(null); setLoading(false); return }
    const { data, error: err } = await supabase.from('characters').select('*')
      .eq('owner', userId).maybeSingle<CharacterRow>()
    if (activeUser.current !== userId) return
    if (err) setError(err.message)
    else { setCharacter(prev => data ? applyIfNewer(prev, data) : null); setError(null) }
    setLoading(false)
  }, [userId])

  useEffect(() => {
    setCharacter(null)
    setError(null)
    setSaveError(null)
    setLoading(true)
    void fetchOnce()
  }, [fetchOnce])

  const charId = character?.id
  useEffect(() => {
    if (!charId) return
    let active = true
    const refresh = () => {
      void characterStore.read(charId).then(data => {
        if (active) setCharacter(prev => applyIfNewer(prev, data))
      }).catch(() => { /* Reconnect will fetch again; retain the last good row. */ })
    }
    const channel = supabase.channel(`char-sync-${charId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'characters', filter: `id=eq.${charId}` }, refresh)
      .subscribe(status => { if (status === 'SUBSCRIBED') refresh() })
    return () => { active = false; void supabase.removeChannel(channel) }
  }, [charId])

  const updateSections: CharacterState['updateSections'] = useCallback(async patch => {
    if (!character) return { ok: false, message: 'No character is loaded.' }
    const result = await writeCharacter(characterStore, character, patch as CharacterUpdate, shardTrees)
    if (activeUser.current !== userId) return { ok: false, message: 'The signed-in account changed.' }
    if (result.row) setCharacter(prev => applyIfNewer(prev, result.row!))
    if (!result.ok) { setSaveError(result.message); return { ok: false, message: result.message } }
    setSaveError(null)
    return { ok: true }
  }, [character, shardTrees, userId])

  const updateSection: CharacterState['updateSection'] = useCallback(
    (section, next) => updateSections({ [section]: next }), [updateSections],
  )
  return { character, loading, error, saveError, dismissSaveError: () => setSaveError(null), updateSection, updateSections, refetch: fetchOnce }
}
