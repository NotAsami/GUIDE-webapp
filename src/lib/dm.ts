import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import type {
  CharacterRow, CharacterUpdate, CharacterSecret, CharacterSecretUpdate,
  QuestRow, QuestInsert, QuestUpdate, QuestSecret, QuestSecretUpdate,
  SessionRow, SessionInsert, SessionUpdate,
  CatalogItemRow, CatalogItemInsert, CatalogItemUpdate,
  CatalogFeatureRow, CatalogFeatureInsert, CatalogFeatureUpdate,
  ConfiscatedItemRow, ConfiscatedItemInsert, InventoryItem,
  ShopCatalogRow, Shop,
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
   *  or for a row you own). Optimistic, with reconcile from the returned row.
   *  Resolves true on success so callers can gate follow-ups (toast, log) on a
   *  write that actually landed. */
  updateCharacter: (id: string, patch: CharacterUpdate) => Promise<boolean>
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

  // Live read-sync (slice 6): player-side writes (HP pill, equip, rest…) stream
  // into the party view as row UPDATEs, so the dashboard tracks the table live.
  // The DM token passes the `dm_all` RLS check, so every character's changes
  // arrive. INSERT/DELETE don't happen in normal play.
  //
  // IMPORTANT: the event is only a SIGNAL — `payload.new` omits unchanged
  // TOASTed columns (all the big JSONB sections), so adopting it directly guts
  // the row (see the matching note in character.ts). Refetch the full row by id
  // (the primary key is always present in the payload) and merge that.
  useEffect(() => {
    if (!session) return
    const ch = supabase
      .channel('dm-party-sync')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'characters' },
        payload => {
          const id = (payload.new as { id?: string }).id
          if (!id) return
          void supabase
            .from('characters')
            .select('*')
            .eq('id', id)
            .maybeSingle<CharacterRow>()
            .then(({ data }) => {
              if (data) setParty(prev => prev.map(c => (c.id === id ? data : c)))
            })
        },
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(ch)
    }
  }, [session])

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
      return false
    }
    if (data) setParty(prev => prev.map(c => (c.id === id ? data : c)))
    return true
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

export interface DmCatalogState {
  items: CatalogItemRow[]
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
  createItem: (item: CatalogItemInsert) => Promise<CatalogItemRow | null>
  updateItem: (id: string, patch: CatalogItemUpdate) => Promise<void>
  deleteItem: (id: string) => Promise<void>
}

/** The DM's item-authoring library (`item_catalog`, migration 0004). DM-only RLS
 *  (no player policy), so a non-DM gets an empty list. Grant Item lives in the
 *  Actions tab and snapshots one of these `items` into a player's inventory — the
 *  grant WRITE is a `characters` update, so it goes through useDmParty, not here.
 *  Rows are ordered by name for a stable, browsable library. */
export function useDmCatalog(): DmCatalogState {
  const { session } = useAuth()
  const [items, setItems] = useState<CatalogItemRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const byName = (a: CatalogItemRow, b: CatalogItemRow) =>
    (a.data?.name ?? '').localeCompare(b.data?.name ?? '')

  const fetchAll = useCallback(async () => {
    if (!session) { setItems([]); setLoading(false); return }
    setLoading(true)
    const { data, error: err } = await supabase.from('item_catalog').select('*')
    if (err) { setError(err.message); setItems([]) }
    else { setItems(((data as CatalogItemRow[]) ?? []).sort(byName)); setError(null) }
    setLoading(false)
  }, [session])

  useEffect(() => { void fetchAll() }, [fetchAll])

  const createItem = useCallback<DmCatalogState['createItem']>(async (item) => {
    const { data, error: err } = await supabase.from('item_catalog').insert(item).select().single<CatalogItemRow>()
    if (err) { setError(err.message); return null }
    setItems(prev => [...prev, data].sort(byName))
    return data
  }, [])

  const updateItem = useCallback<DmCatalogState['updateItem']>(async (id, patch) => {
    let previous: CatalogItemRow | undefined
    setItems(prev => prev.map(it => { if (it.id !== id) return it; previous = it; return { ...it, ...patch } as CatalogItemRow }))
    const { data, error: err } = await supabase.from('item_catalog').update(patch).eq('id', id).select().single<CatalogItemRow>()
    if (err) { setError(err.message); if (previous) setItems(prev => prev.map(it => (it.id === id ? previous! : it))) }
    else if (data) setItems(prev => prev.map(it => (it.id === id ? data : it)).sort(byName))
  }, [])

  const deleteItem = useCallback<DmCatalogState['deleteItem']>(async (id) => {
    const snapshot = items
    setItems(prev => prev.filter(it => it.id !== id))
    const { error: err } = await supabase.from('item_catalog').delete().eq('id', id)
    if (err) { setError(err.message); setItems(snapshot) }
  }, [items])

  return { items, loading, error, refetch: fetchAll, createItem, updateItem, deleteItem }
}

/* ============================================================
   CONFISCATED ITEMS (migration 0006)
   ============================================================ */

export interface DmConfiscatedState {
  /** Everything currently held, newest first, across all characters. */
  rows: ConfiscatedItemRow[]
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
  /** Take an item off a character. Returns the stored row so the caller can undo. */
  confiscate: (characterId: string, item: InventoryItem, note?: string) => Promise<ConfiscatedItemRow | null>
  /** Give it back. The caller writes the character row; this only drops the record. */
  release: (id: string) => Promise<void>
}

/** The DM-side store for items taken off characters (`confiscated_items`, 0006).
 *
 *  Confiscation and LOCKING are different mechanics. A locked item stays in the
 *  player's inventory with `locked: true` — carried, weighed, visibly present and
 *  refusing to be used — and never touches this table. A confiscated item LEAVES
 *  the character row entirely and lands here, which is what makes it invisible:
 *  the table has DM-only RLS and no player policy, so invisibility is enforced by
 *  Postgres rather than by a filter in the player's browser.
 *
 *  `from` is the item's placement copied verbatim at the moment it was taken, so
 *  restoring is just putting it back where it was. */
export function useDmConfiscated(): DmConfiscatedState {
  const { session } = useAuth()
  const [rows, setRows] = useState<ConfiscatedItemRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    if (!session) { setRows([]); setLoading(false); return }
    setLoading(true)
    const { data, error: err } = await supabase
      .from('confiscated_items').select('*').order('taken_at', { ascending: false })
    if (err) { setError(err.message); setRows([]) }
    else { setRows((data as ConfiscatedItemRow[]) ?? []); setError(null) }
    setLoading(false)
  }, [session])

  useEffect(() => { void fetchAll() }, [fetchAll])

  const confiscate = useCallback<DmConfiscatedState['confiscate']>(async (characterId, item, note) => {
    const row: ConfiscatedItemInsert = {
      character_id: characterId,
      item,
      // The placement object verbatim — col/row are simply absent when the item
      // came out of a container, because a list has no geometry.
      from: {
        containerId: item.containerId,
        ...(item.col != null ? { col: item.col } : {}),
        ...(item.row != null ? { row: item.row } : {}),
      },
      ...(note ? { note } : {}),
    }
    const { data, error: err } = await supabase
      .from('confiscated_items').insert(row).select().single<ConfiscatedItemRow>()
    if (err) { setError(err.message); return null }
    setRows(prev => [data, ...prev])
    return data
  }, [])

  const release = useCallback<DmConfiscatedState['release']>(async (id) => {
    const snapshot = rows
    setRows(prev => prev.filter(r => r.id !== id))
    const { error: err } = await supabase.from('confiscated_items').delete().eq('id', id)
    if (err) { setError(err.message); setRows(snapshot) }
  }, [rows])

  return { rows, loading, error, refetch: fetchAll, confiscate, release }
}

export interface DmFeaturesState {
  features: CatalogFeatureRow[]
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
  createFeature: (f: CatalogFeatureInsert) => Promise<CatalogFeatureRow | null>
  updateFeature: (id: string, patch: CatalogFeatureUpdate) => Promise<void>
  deleteFeature: (id: string) => Promise<void>
}

/** The DM's feature-authoring library (`feature_catalog`, migration 0005) —
 *  structurally the twin of useDmCatalog. Consumed by the item form (embed
 *  copies onto an item) and the Grant Feature card (copy onto a character);
 *  both take SNAPSHOTS, so this table stays DM-only. */
export function useDmFeatures(): DmFeaturesState {
  const { session } = useAuth()
  const [features, setFeatures] = useState<CatalogFeatureRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const byName = (a: CatalogFeatureRow, b: CatalogFeatureRow) =>
    (a.data?.name ?? '').localeCompare(b.data?.name ?? '')

  const fetchAll = useCallback(async () => {
    if (!session) { setFeatures([]); setLoading(false); return }
    setLoading(true)
    const { data, error: err } = await supabase.from('feature_catalog').select('*')
    if (err) { setError(err.message); setFeatures([]) }
    else { setFeatures(((data as CatalogFeatureRow[]) ?? []).sort(byName)); setError(null) }
    setLoading(false)
  }, [session])

  useEffect(() => { void fetchAll() }, [fetchAll])

  const createFeature = useCallback<DmFeaturesState['createFeature']>(async (f) => {
    const { data, error: err } = await supabase.from('feature_catalog').insert(f).select().single<CatalogFeatureRow>()
    if (err) { setError(err.message); return null }
    setFeatures(prev => [...prev, data].sort(byName))
    return data
  }, [])

  const updateFeature = useCallback<DmFeaturesState['updateFeature']>(async (id, patch) => {
    let previous: CatalogFeatureRow | undefined
    setFeatures(prev => prev.map(f => { if (f.id !== id) return f; previous = f; return { ...f, ...patch } as CatalogFeatureRow }))
    const { data, error: err } = await supabase.from('feature_catalog').update(patch).eq('id', id).select().single<CatalogFeatureRow>()
    if (err) { setError(err.message); if (previous) setFeatures(prev => prev.map(f => (f.id === id ? previous! : f))) }
    else if (data) setFeatures(prev => prev.map(f => (f.id === id ? data : f)).sort(byName))
  }, [])

  const deleteFeature = useCallback<DmFeaturesState['deleteFeature']>(async (id) => {
    const snapshot = features
    setFeatures(prev => prev.filter(f => f.id !== id))
    const { error: err } = await supabase.from('feature_catalog').delete().eq('id', id)
    if (err) { setError(err.message); setFeatures(snapshot) }
  }, [features])

  return { features, loading, error, refetch: fetchAll, createFeature, updateFeature, deleteFeature }
}

/* ============================================================
   SHOP CATALOG (migration 0009) — shop feature, part 1
   ============================================================ */

export interface DmShopsState {
  shops: ShopCatalogRow[]
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
  saveShop: (id: string, data: Shop) => Promise<void>
  createShop: (data: Shop) => Promise<ShopCatalogRow | null>
  deleteShop: (id: string) => Promise<void>
  /** Fires a shop live for one character (or the whole party if `characterId`
   *  is null). Closes every other shop first — at most one can be open at a
   *  time, so the player takeover never has to pick between two. */
  openShop: (id: string, characterId: string | null) => Promise<void>
  closeShop: (id: string) => Promise<void>
}

/** The DM's shopkeeper-authoring library (`shop_catalog`) — structurally the
 *  twin of useDmCatalog/useDmFeatures, plus open/close since a shop (unlike an
 *  item or feature template) has a live on/off state the console drives. */
export function useDmShops(): DmShopsState {
  const { session } = useAuth()
  const [shops, setShops] = useState<ShopCatalogRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const byName = (a: ShopCatalogRow, b: ShopCatalogRow) => (a.data?.name ?? '').localeCompare(b.data?.name ?? '')

  const fetchAll = useCallback(async () => {
    if (!session) { setShops([]); setLoading(false); return }
    setLoading(true)
    const { data, error: err } = await supabase.from('shop_catalog').select('*')
    if (err) { setError(err.message); setShops([]) }
    else { setShops(((data as ShopCatalogRow[]) ?? []).sort(byName)); setError(null) }
    setLoading(false)
  }, [session])

  useEffect(() => { void fetchAll() }, [fetchAll])

  const saveShop = useCallback<DmShopsState['saveShop']>(async (id, data) => {
    let previous: ShopCatalogRow | undefined
    setShops(prev => prev.map(s => { if (s.id !== id) return s; previous = s; return { ...s, data } }))
    const { data: row, error: err } = await supabase.from('shop_catalog').upsert({ id, data }).select().single<ShopCatalogRow>()
    if (err) { setError(err.message); if (previous) setShops(prev => prev.map(s => (s.id === id ? previous! : s))) }
    else if (row) setShops(prev => prev.map(s => (s.id === id ? row : s)).sort(byName))
  }, [])

  const createShop = useCallback<DmShopsState['createShop']>(async (data) => {
    const { data: row, error: err } = await supabase.from('shop_catalog').insert({ data }).select().single<ShopCatalogRow>()
    if (err) { setError(err.message); return null }
    setShops(prev => [...prev, row].sort(byName))
    return row
  }, [])

  const deleteShop = useCallback<DmShopsState['deleteShop']>(async (id) => {
    const snapshot = shops
    setShops(prev => prev.filter(s => s.id !== id))
    const { error: err } = await supabase.from('shop_catalog').delete().eq('id', id)
    if (err) { setError(err.message); setShops(snapshot) }
  }, [shops])

  const openShop = useCallback<DmShopsState['openShop']>(async (id, characterId) => {
    const snapshot = shops
    setShops(prev => prev.map(s => ({ ...s, is_open: s.id === id, open_for: s.id === id ? characterId : null })))
    // One atomic RPC (migration 0009), not two client UPDATEs — see its
    // header comment for why "close everything, then open this one" as two
    // separate writes can't actually guarantee at most one shop open.
    const { error: err } = await supabase.rpc('shop_open', { p_id: id, p_character_id: characterId })
    if (err) { setError(err.message); setShops(snapshot); void fetchAll(); return }
    void fetchAll()
  }, [shops, fetchAll])

  const closeShop = useCallback<DmShopsState['closeShop']>(async (id) => {
    let previous: ShopCatalogRow | undefined
    setShops(prev => prev.map(s => { if (s.id !== id) return s; previous = s; return { ...s, is_open: false, open_for: null } }))
    const { error: err } = await supabase.from('shop_catalog').update({ is_open: false, open_for: null }).eq('id', id)
    if (err) { setError(err.message); if (previous) setShops(prev => prev.map(s => (s.id === id ? previous! : s))) }
  }, [])

  return { shops, loading, error, refetch: fetchAll, saveShop, createShop, deleteShop, openShop, closeShop }
}
