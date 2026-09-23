/**
 * NPC records, their DM-only notes, and NPC ↔ NPC links (0024).
 *
 *   useDmNpcs()     the console: everything, plus writes and reveals.
 *   useKnownNpcs()  a player: only what was revealed to ONE character —
 *                   RLS for a real player, asSeenBy() for the DM's own.
 *
 * No subscription on either side: the DM is the only writer and re-reads its
 * own rows, and a reveal reaching a player the next time they open the web is
 * soon enough. The web itself is drawn by lib/npcWeb.ts.
 */
import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { useAuth } from './auth'
import type { NpcInsert, NpcLinkInsert, NpcLinkRow, NpcLinkUpdate, NpcRow, NpcSecret, NpcUpdate } from './database.types'
import { asSeenBy, revealNpc, revealTie } from './npcWeb'

export interface DmNpcsState {
  npcs: NpcRow[]
  links: NpcLinkRow[]
  /** npc id → GM notes (npc_secrets). */
  notes: Record<string, string>
  loading: boolean
  error: string | null
  create: (fields: NpcInsert) => Promise<NpcRow | null>
  update: (id: string, patch: NpcUpdate) => Promise<boolean>
  remove: (id: string) => Promise<void>
  link: (fields: NpcLinkInsert) => Promise<boolean>
  updateLink: (id: string, patch: NpcLinkUpdate) => Promise<boolean>
  unlink: (id: string) => Promise<void>
  saveNotes: (id: string, gm_notes: string) => Promise<boolean>
  /** Reveal an NPC's record to a PC, or hide it again. */
  reveal: (npcId: string, pcId: string, on: boolean) => Promise<boolean>
  /** Reveal a tie to a PC — and both people on it, see revealTie(). */
  revealLink: (linkId: string, pcId: string, on: boolean) => Promise<boolean>
}

export function useDmNpcs(): DmNpcsState {
  const { session } = useAuth()
  const [npcs, setNpcs] = useState<NpcRow[]>([])
  const [links, setLinks] = useState<NpcLinkRow[]>([])
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!session) { setNpcs([]); setLinks([]); setNotes({}); setLoading(false); return }
    void Promise.all([
      supabase.from('npcs').select('*').order('name'),
      supabase.from('npc_links').select('*').order('created_at'),
      supabase.from('npc_secrets').select('*'),
    ]).then(([n, l, sec]) => {
      const err = n.error ?? l.error ?? sec.error
      setError(err ? err.message : null)
      setNpcs((n.data as NpcRow[]) ?? [])
      setLinks((l.data as NpcLinkRow[]) ?? [])
      setNotes(Object.fromEntries(((sec.data as NpcSecret[]) ?? []).map(r => [r.npc_id, r.gm_notes])))
      setLoading(false)
    })
  }, [session])

  // The name index is unique (lower(btrim(name))), so a duplicate surfaces here
  // as an error rather than as a second, ambiguous "The Lady".
  const fail = (m: string) => { setError(m.includes('npcs_name_key') ? 'An NPC with that name already exists.' : m.includes('npc_links_pair') ? 'Those two are already tied.' : m); return false }

  const create = useCallback<DmNpcsState['create']>(async fields => {
    const { data, error: err } = await supabase.from('npcs').insert(fields).select().single<NpcRow>()
    if (err) { fail(err.message); return null }
    setError(null)
    setNpcs(prev => [...prev, data])
    return data
  }, [])

  const update = useCallback<DmNpcsState['update']>(async (id, patch) => {
    const { data, error: err } = await supabase.from('npcs').update(patch).eq('id', id).select().single<NpcRow>()
    if (err) return fail(err.message)
    setError(null)
    setNpcs(prev => prev.map(n => (n.id === id ? data : n)))
    return true
  }, [])

  const remove = useCallback<DmNpcsState['remove']>(async id => {
    const { error: err } = await supabase.from('npcs').delete().eq('id', id)
    if (err) { fail(err.message); return }
    setNpcs(prev => prev.filter(n => n.id !== id))
    // on delete cascade took its links with it; mirror that here.
    setLinks(prev => prev.filter(l => l.a !== id && l.b !== id))
  }, [])

  const link = useCallback<DmNpcsState['link']>(async fields => {
    const { data, error: err } = await supabase.from('npc_links').insert(fields).select().single<NpcLinkRow>()
    if (err) return fail(err.message)
    setError(null)
    setLinks(prev => [...prev, data])
    return true
  }, [])

  const updateLink = useCallback<DmNpcsState['updateLink']>(async (id, patch) => {
    const { data, error: err } = await supabase.from('npc_links').update(patch).eq('id', id).select().single<NpcLinkRow>()
    if (err) return fail(err.message)
    setError(null)
    setLinks(prev => prev.map(l => (l.id === id ? data : l)))
    return true
  }, [])

  const unlink = useCallback<DmNpcsState['unlink']>(async id => {
    const { error: err } = await supabase.from('npc_links').delete().eq('id', id)
    if (err) { fail(err.message); return }
    setLinks(prev => prev.filter(l => l.id !== id))
  }, [])

  const saveNotes = useCallback<DmNpcsState['saveNotes']>(async (id, gm_notes) => {
    const { error: err } = await supabase.from('npc_secrets').upsert({ npc_id: id, gm_notes })
    if (err) return fail(err.message)
    setNotes(prev => ({ ...prev, [id]: gm_notes }))
    return true
  }, [])

  const reveal = useCallback<DmNpcsState['reveal']>(async (npcId, pcId, on) => {
    const row = npcs.find(n => n.id === npcId)
    return row ? update(npcId, { known_to: revealNpc(row.known_to, pcId, on) }) : false
  }, [npcs, update])

  const revealLink = useCallback<DmNpcsState['revealLink']>(async (linkId, pcId, on) => {
    const l = links.find(x => x.id === linkId)
    const a = npcs.find(n => n.id === l?.a), b = npcs.find(n => n.id === l?.b)
    if (!l || !a || !b) return false
    const plan = revealTie(l, a, b, pcId, on)
    // Ends first: if the tie were revealed and an end's write then failed, the
    // player would hold a tie to someone they cannot see.
    for (const e of plan.ends) if (!(await update(e.id, { known_to: e.known_to }))) return false
    return updateLink(linkId, { known_to: plan.link })
  }, [links, npcs, update, updateLink])

  return { npcs, links, notes, loading, error, create, update, remove, link, updateLink, unlink, saveNotes, reveal, revealLink }
}

/** A player's view: the records and ties revealed to ONE character. Filtered
 *  here, not by each caller: RLS does it for a player, but the DM's own
 *  character reads every row, and every new list would otherwise have to
 *  remember asSeenBy(). Screen-local, same as useCampaign. */
export function useKnownNpcs(characterId: string | undefined): { npcs: NpcRow[]; links: NpcLinkRow[]; loading: boolean } {
  const { session } = useAuth()
  const [npcs, setNpcs] = useState<NpcRow[]>([])
  const [links, setLinks] = useState<NpcLinkRow[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    if (!session) { setLoading(false); return }
    void Promise.all([
      supabase.from('npcs').select('*').order('name'),
      supabase.from('npc_links').select('*'),
    ]).then(([n, l]) => {
      const seen = asSeenBy((n.data as NpcRow[]) ?? [], (l.data as NpcLinkRow[]) ?? [], characterId ?? '')
      setNpcs(seen.npcs)
      setLinks(seen.links)
      setLoading(false)
    })
  }, [session, characterId])
  return { npcs, links, loading }
}
