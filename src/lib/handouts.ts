/**
 * Handouts — a document or image the DM hands to players (migration 0023).
 *
 * THE CONSOLE'S VERBS ARE PURE PATCHES, tested in handouts.test.ts (logic in handoutPatches.ts), because the
 * interesting part is set arithmetic that fails silently: a Push that forgot to
 * keep last week's recipients would quietly take a letter out of Ros's Journal.
 *
 *   Push      file it for these characters AND put it on exactly their screens
 *   File      file it for them, quietly — their Journal gets it, nothing opens
 *   Recall    off every screen; everyone keeps it filed
 *   Take back out of their Journal and off their screen
 *
 * Player side is read-only (SELECT policy only). What a player does — close the
 * dock, see the NEW dot go out — is a per-browser convenience in localStorage,
 * never state: losing it costs a dock reopening once, nothing more.
 */
import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { useAuth } from './auth'
import type { HandoutInsert, HandoutRow, HandoutUpdate } from './database.types'
import { pushKey } from './handoutPatches.ts'
export * from './handoutPatches.ts'

/* ---- per-browser memory: which handouts were read, which pushes dismissed ---- */
const SEEN = 'guide.handouts.seen'
const DISMISSED = 'guide.handouts.dismissed'

function readSet(key: string): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(key) ?? '[]') as string[]) } catch { return new Set() }
}
function writeSet(key: string, s: Set<string>) {
  // ponytail: keeps the newest 200, which outlives any real campaign's handouts.
  try { localStorage.setItem(key, JSON.stringify([...s].slice(-200))) } catch { /* private mode: forget */ }
}
function useStoredSet(key: string): [Set<string>, (v: string) => void] {
  const [set, setSet] = useState(() => readSet(key))
  const add = useCallback((v: string) => setSet(prev => {
    if (prev.has(v)) return prev
    const next = new Set(prev).add(v)
    writeSet(key, next)
    return next
  }), [key])
  return [set, add]
}

/** What Layout hands every player screen through the Outlet context. */
export interface HandoutOutlet {
  handouts: HandoutRow[]
  seenHandouts: Set<string>
  markHandoutSeen: (id: string) => void
  /** Open one in the dock, settled — reading, not an arrival. */
  openHandout: (id: string) => void
}

export interface PlayerHandouts {
  /** Every handout this character holds — RLS already scoped it. Newest first. */
  handouts: HandoutRow[]
  seen: Set<string>
  markSeen: (id: string) => void
  dismissed: Set<string>
  dismiss: (h: HandoutRow) => void
}

/** Called ONCE, from Layout, so the dock, the Journal and the Story screen all
 *  read the same list through one subscription. Same realtime rule as
 *  loot_open.ts: the event is a signal, the row is refetched, never adopted. */
export function useHandouts(characterId: string | undefined): PlayerHandouts {
  const [handouts, setHandouts] = useState<HandoutRow[]>([])
  const [seen, markSeen] = useStoredSet(SEEN)
  const [dismissed, addDismissed] = useStoredSet(DISMISSED)

  const fetchAll = useCallback(async () => {
    if (!characterId) { setHandouts([]); return }
    const { data } = await supabase.from('handouts').select('*').order('created_at', { ascending: false })
    // RLS already limits a player to their own — but the DM's own character reads
    // EVERY row, so the list says what it means instead of trusting the role.
    setHandouts(((data as HandoutRow[]) ?? []).filter(h => h.recipients.includes(characterId)))
  }, [characterId])

  useEffect(() => { void fetchAll() }, [fetchAll])

  useEffect(() => {
    if (!characterId) return
    const ch = supabase
      .channel('handouts-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'handouts' }, () => void fetchAll())
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [characterId, fetchAll])

  const dismiss = useCallback((h: HandoutRow) => addDismissed(pushKey(h)), [addDismissed])
  return { handouts, seen, markSeen, dismissed, dismiss }
}

export interface DmHandoutsState {
  handouts: HandoutRow[]
  loading: boolean
  error: string | null
  create: (fields: HandoutInsert) => Promise<HandoutRow | null>
  update: (id: string, patch: HandoutUpdate) => Promise<boolean>
  remove: (id: string) => Promise<void>
}

/** The console's side: the whole table (dm_handouts policy). No subscription —
 *  the DM is the only writer, and every write here re-reads its own row. */
export function useDmHandouts(): DmHandoutsState {
  const { session } = useAuth()
  const [handouts, setHandouts] = useState<HandoutRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!session) { setHandouts([]); setLoading(false); return }
    void supabase.from('handouts').select('*').order('created_at', { ascending: false }).then(({ data, error: err }) => {
      setError(err ? err.message : null)
      setHandouts((data as HandoutRow[]) ?? [])
      setLoading(false)
    })
  }, [session])

  const create = useCallback<DmHandoutsState['create']>(async fields => {
    const { data, error: err } = await supabase.from('handouts').insert(fields).select().single<HandoutRow>()
    if (err) { setError(err.message); return null }
    setHandouts(prev => [data, ...prev])
    return data
  }, [])

  const update = useCallback<DmHandoutsState['update']>(async (id, patch) => {
    const { data, error: err } = await supabase.from('handouts').update(patch).eq('id', id).select().single<HandoutRow>()
    if (err) { setError(err.message); return false }
    setError(null)
    setHandouts(prev => prev.map(h => (h.id === id ? data : h)))
    return true
  }, [])

  const remove = useCallback<DmHandoutsState['remove']>(async id => {
    const { error: err } = await supabase.from('handouts').delete().eq('id', id)
    if (err) { setError(err.message); return }
    setHandouts(prev => prev.filter(h => h.id !== id))
  }, [])

  return { handouts, loading, error, create, update, remove }
}
