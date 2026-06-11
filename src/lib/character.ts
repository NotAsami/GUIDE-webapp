import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { CharacterRow, CharacterSection, CharacterUpdate } from './database.types'
import { useAuth } from './auth'

interface CharacterState {
  character: CharacterRow | null
  loading: boolean
  error: string | null
  /** Patch one JSONB section (sheet, progress, ...). Last-write-wins per handoff §7. */
  updateSection: <K extends CharacterSection>(
    section: K,
    next: CharacterRow[K],
  ) => Promise<void>
  refetch: () => Promise<void>
}

/** Reads the character row owned by the current user. Returns null when none exists
 *  (the seeded character belongs to whoever logs in first — that's the player). */
export function useCharacter(): CharacterState {
  const { session } = useAuth()
  const [character, setCharacter] = useState<CharacterRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchOnce = useCallback(async () => {
    if (!session) {
      setCharacter(null)
      setLoading(false)
      return
    }
    setLoading(true)
    const { data, error: err } = await supabase
      .from('characters')
      .select('*')
      .eq('owner', session.user.id)
      .maybeSingle<CharacterRow>()
    if (err) {
      setError(err.message)
      setCharacter(null)
    } else {
      setCharacter(data ?? null)
      setError(null)
    }
    setLoading(false)
  }, [session])

  useEffect(() => {
    void fetchOnce()
  }, [fetchOnce])

  const updateSection: CharacterState['updateSection'] = useCallback(
    async (section, next) => {
      if (!character) return
      // Optimistic update so the topbar HP pill / Codex cards re-render instantly.
      const optimistic = { ...character, [section]: next }
      setCharacter(optimistic)
      const patch = { [section]: next } as CharacterUpdate
      const { data, error: err } = await supabase
        .from('characters')
        .update(patch)
        .eq('id', character.id)
        .select()
        .single<CharacterRow>()
      if (err) {
        setError(err.message)
        // Roll back on failure.
        setCharacter(character)
      } else if (data) {
        setCharacter(data)
      }
    },
    [character],
  )

  return { character, loading, error, updateSection, refetch: fetchOnce }
}
