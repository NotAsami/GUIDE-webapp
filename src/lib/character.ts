import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { CharacterRow, CharacterSection, CharacterUpdate, ShardTree } from './database.types'
import { publicVitals, vitalsEqual } from './vitals.ts'
import { useAuth } from './auth'

/** Reject an incoming row if it's OLDER than what's already displayed —
 *  `updated_at` is bumped by tg_set_updated_at on every write, so ISO-8601
 *  strings compare correctly. Guards against a real race: the realtime
 *  refetch triggered by THIS write's own coins UPDATE (shop_buy writes coins
 *  first, inventory second — two separate statements) can resolve its
 *  independent `.select()` AFTER updateSection's own `.select()` returns the
 *  fully-current row, since they're two unrelated network round-trips with
 *  no ordering guarantee between them. Without this guard, the later-
 *  resolving but earlier-read (pre-inventory-write) fetch clobbers local
 *  state and the just-granted item silently vanishes from the UI — even
 *  though the DB row itself is correct. */
function applyIfNewer(prev: CharacterRow | null, next: CharacterRow): CharacterRow {
  if (!prev || next.updated_at >= prev.updated_at) return next
  return prev
}

interface CharacterState {
  character: CharacterRow | null
  loading: boolean
  error: string | null
  /** Patch one JSONB section (sheet, progress, ...). Last-write-wins per handoff §7. */
  updateSection: <K extends CharacterSection>(
    section: K,
    next: CharacterRow[K],
  ) => Promise<void>
  /** Patch several sections in ONE atomic DB update. Required when a mutation
   *  spans sections that must stay consistent — e.g. equip/unequip moving an
   *  item between `inventory` and `equipped` ("never both", handoff §4). */
  updateSections: (patch: Partial<Pick<CharacterRow, CharacterSection>>) => Promise<void>
  refetch: () => Promise<void>
}

/** Reads the character row owned by the current user. Returns null when none exists
 *  (the seeded character belongs to whoever logs in first — that's the player). */
export function useCharacter(shardTrees: Record<string, ShardTree> = {}): CharacterState {
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

  // Live read-sync (Phase 2 slice 6): when the DM edits this character from the
  // Operator Console, the row UPDATE arrives here and the whole app re-renders
  // from the fresh row — no reload. `characters` is in the realtime publication
  // (0001_init.sql) and postgres_changes respects RLS, so a player only ever
  // receives their own row. Keyed on the row id (not the row object) so our own
  // optimistic writes don't churn the subscription.
  //
  // IMPORTANT: the event is only a SIGNAL — never adopt `payload.new` as the row.
  // Postgres omits unchanged TOASTed columns from the WAL, and this row is all
  // big JSONB, so a write to `inventory` arrives WITHOUT `sheet`/`resources`/…;
  // adopting that partial payload guts the client state (HP 0/0, missing sheet).
  // Refetch the full row instead. Silent (no `loading` flip) so the app never
  // unmounts and in-progress form drafts survive.
  const charId = character?.id
  useEffect(() => {
    if (!charId) return
    const ch = supabase
      .channel(`char-sync-${charId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'characters', filter: `id=eq.${charId}` },
        () => {
          void supabase
            .from('characters')
            .select('*')
            .eq('id', charId)
            .maybeSingle<CharacterRow>()
            .then(({ data }) => {
              if (data) setCharacter(prev => applyIfNewer(prev, data))
            })
        },
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(ch)
    }
  }, [charId])

  /* THE PARTY HUD'S CACHE, recomputed here and nowhere else.

     Two of the numbers other players see (effective AC, effective max HP) are
     derived from the whole row, and `list_party_roster()` can only project
     columns — so the OWNER, who can read their own row, computes them and
     writes the result. Folding it into the write path rather than a separate
     effect is what makes drift impossible: there is no way to change the sheet
     without the cache going with it.

     Skipped when nothing a watcher would see has moved, so stowing an item does
     not write a column nobody will re-render for. */
  const withVitals = useCallback((next: CharacterRow): Partial<CharacterUpdate> => {
    const v = publicVitals(next, shardTrees)
    return vitalsEqual(next.public_vitals, v) ? {} : { public_vitals: v }
  }, [shardTrees])

  const updateSection: CharacterState['updateSection'] = useCallback(
    async (section, next) => {
      if (!character) return
      // Optimistic update so the topbar HP pill / Codex cards re-render instantly.
      const optimistic = { ...character, [section]: next }
      setCharacter(optimistic)
      const patch = { [section]: next, ...withVitals(optimistic) } as CharacterUpdate
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
        setCharacter(prev => applyIfNewer(prev, data))
      }
    },
    [character, withVitals],
  )

  const updateSections: CharacterState['updateSections'] = useCallback(
    async patch => {
      if (!character) return
      const optimistic = { ...character, ...patch }
      setCharacter(optimistic)
      const { data, error: err } = await supabase
        .from('characters')
        .update({ ...patch, ...withVitals(optimistic) } as CharacterUpdate)
        .eq('id', character.id)
        .select()
        .single<CharacterRow>()
      if (err) {
        setError(err.message)
        setCharacter(character) // roll back — both sections revert together
      } else if (data) {
        setCharacter(prev => applyIfNewer(prev, data))
      }
    },
    [character],
  )

  return { character, loading, error, updateSection, updateSections, refetch: fetchOnce }
}
