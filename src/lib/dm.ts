import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import type {
  CharacterRow, CharacterUpdate, CharacterSecret, CharacterSecretUpdate,
  QuestRow, QuestInsert, QuestUpdate, QuestSecret, QuestSecretUpdate,
  SessionRow, SessionInsert, SessionUpdate,
  CatalogItemRow, CatalogItemInsert, CatalogItemUpdate,
  CatalogFeatureRow, CatalogFeatureInsert, CatalogFeatureUpdate, CatalogFeatureData,
  CatalogEffectRow, CatalogEffectInsert, CatalogEffectUpdate,
  CatalogSpellRow, CatalogSpellInsert, CatalogSpellUpdate,
  CatalogClassRow, CatalogClassUpdate, ClassDef,
  CatalogRaceRow, CatalogRaceUpdate, RaceDef,
  ConfiscatedItemRow, ConfiscatedItemInsert, InventoryItem,
  ShopCatalogRow, Shop, ShardTree,
} from './database.types'
import { useAuth } from './auth'
import { publicVitals, vitalsEqual } from './vitals.ts'

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
export function useDmParty(shardTrees: Record<string, ShardTree> = {}): DmPartyState {
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
    /* THE PARTY HUD'S CACHE — recomputed here for exactly the same reason
       lib/character.ts does it on the player side. The DM writes characters
       through THIS path (granting a +1 AC ring, a level-up, a long rest), and
       every one of those can move a number other players see. Skip it and the
       cache only heals the next time the PLAYER happens to touch their sheet.

       Same pure compiler, two write paths — not two implementations. */
    const merged = party.find(c => c.id === id)
    const withVitals = (() => {
      if (!merged) return {}
      const next = { ...merged, ...patch } as CharacterRow
      const v = publicVitals(next, shardTrees)
      return vitalsEqual(next.public_vitals, v) ? {} : { public_vitals: v }
    })()

    // Optimistic: row-level shallow merge (caller already spread the section).
    let previous: CharacterRow | undefined
    setParty(prev => prev.map(c => {
      if (c.id !== id) return c
      previous = c
      return { ...c, ...patch, ...withVitals } as CharacterRow
    }))
    const { data, error: err } = await supabase
      .from('characters')
      .update({ ...patch, ...withVitals })
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
  }, [party, shardTrees])

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
  /** Drop the record, which is the only place a confiscated item exists. Both
   *  outcomes route through here: returning it (caller writes the character row
   *  first) and destroying it outright (caller writes nothing). */
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
  /** Park an in-progress edit. Writes `draft`, never `data`, so a granted
   *  feature's template can be rewritten without disturbing what the Grant
   *  picker offers. `id` null mints a row for a feature that has never been
   *  published — the returned id is the one it keeps forever. */
  saveDraft: (id: string | null, data: CatalogFeatureData) => Promise<string | null>
  /** Promote a draft into `data` with `published: true` and clear the draft
   *  slot. The id is minted here on FIRST publish and never again: other
   *  features target this one by id, so renaming must not touch it. */
  publishFeature: (id: string | null, data: CatalogFeatureData) => Promise<string | null>
  /** Copy everything under a fresh id. What makes 46 near-identical Sanctity
   *  features tractable. */
  duplicateFeature: (id: string) => Promise<string | null>
}

/** The editable payload: the parked draft if there is one, else what is
 *  published. Every list, count and audit in the editor reads through this;
 *  only the Grant picker reads `data` directly. */
export const featureContent = (r: CatalogFeatureRow): CatalogFeatureData => r.draft ?? r.data

/** One past the last `order` in this folder — where a newly created feature
 *  goes. Folders are compared on their stored value, so undefined (unfiled) is
 *  its own bucket rather than colliding with a folder literally named it. */
function nextOrder(rows: CatalogFeatureRow[], folder: string | undefined): number {
  const orders = rows
    .map(featureContent)
    .filter(d => d.folder === folder && typeof d.order === 'number')
    .map(d => d.order as number)
  return orders.length ? Math.max(...orders) + 1 : 0
}

/** Ids are derived from the name ONCE and then frozen (§11 — no slug field, so
 *  the id is the stable name). Lowercase, underscores, deduped against the rest
 *  of the catalog. */
function mintId(name: string, taken: Set<string>): string {
  const base = name.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') || `feature_${Date.now()}`
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}_${n}`
  return id
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

  /** One write path for both rungs of the ladder. `promote` decides whether the
   *  payload lands in the published slot or the draft slot — the difference
   *  between the two buttons is one boolean, which is the point. */
  const write = useCallback(async (id: string | null, data: CatalogFeatureData, promote: boolean): Promise<string | null> => {
    const patch = promote
      ? { data: { ...data, published: true }, draft: null }
      : { draft: data }
    if (id) {
      const { data: row, error: err } = await supabase.from('feature_catalog').update(patch).eq('id', id).select().single<CatalogFeatureRow>()
      if (err) { setError(err.message); return null }
      setFeatures(prev => prev.map(f => (f.id === id ? row : f)).sort(byName))
      return id
    }
    // Never published: mint the id now. A draft-only row still needs `data`,
    // which is not null in the schema — '{}' is the honest value for "nothing
    // has been published yet", and the Grant picker skips it for want of
    // `published`.
    const fresh = mintId(data.name ?? '', new Set(features.map(f => f.id)))
    // A new feature lands at the END of its folder. Assigning `order` here is
    // what keeps every later drag a single row write: the drop handler picks the
    // midpoint between two neighbours, which needs both of them to have one.
    const seeded = data.order !== undefined ? data : { ...data, order: nextOrder(features, data.folder) }
    const body = { ...patch, ...(promote ? { data: { ...seeded, published: true } } : { draft: seeded }) }
    const { data: row, error: err } = await supabase.from('feature_catalog')
      .insert({ id: fresh, ...body, ...(promote ? {} : { data: {} as CatalogFeatureData }) })
      .select().single<CatalogFeatureRow>()
    if (err) { setError(err.message); return null }
    setFeatures(prev => [...prev, row].sort(byName))
    return fresh
  }, [features])

  const saveDraft = useCallback<DmFeaturesState['saveDraft']>((id, data) => write(id, data, false), [write])
  const publishFeature = useCallback<DmFeaturesState['publishFeature']>((id, data) => write(id, data, true), [write])

  const duplicateFeature = useCallback<DmFeaturesState['duplicateFeature']>(async (id) => {
    const src = features.find(f => f.id === id)
    if (!src) return null
    const content = featureContent(src)
    const copy: CatalogFeatureData = { ...content, name: `${content.name ?? 'Untitled'} (copy)`, published: false }
    // A copy starts as a draft: it is a starting point to edit, not something to
    // put in front of the DM's grant list before it has been looked at.
    return write(null, copy, false)
  }, [features, write])

  return {
    features, loading, error, refetch: fetchAll, createFeature, updateFeature, deleteFeature,
    saveDraft, publishFeature, duplicateFeature,
  }
}

// ── Race catalog (migration 0017) ───────────────────────────────────────────

export interface DmRacesState {
  races: CatalogRaceRow[]
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
  updateRace: (id: string, patch: CatalogRaceUpdate) => Promise<void>
  deleteRace: (id: string) => Promise<void>
  saveDraft: (id: string | null, data: RaceDef) => Promise<string | null>
  publishRace: (id: string | null, data: RaceDef) => Promise<string | null>
  duplicateRace: (id: string) => Promise<string | null>
}

/** The editable payload: the parked draft if there is one, else what is
 *  published. Twin of classContent/featureContent. */
export const raceContent = (r: CatalogRaceRow): RaceDef => r.draft ?? r.data

/** The DM's race-authoring library (`race_catalog`, migration 0017) — the same
 *  hook as useDmClasses against a different table, because a race is the same
 *  kind of object as a class. Consumed by Assign Race, which SNAPSHOTS onto the
 *  character (lib/races.ts assignRace), so this table stays DM-only. */
export function useDmRaces(): DmRacesState {
  const { session } = useAuth()
  const [races, setRaces] = useState<CatalogRaceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const byName = (a: CatalogRaceRow, b: CatalogRaceRow) =>
    (raceContent(a).name ?? '').localeCompare(raceContent(b).name ?? '')

  const fetchAll = useCallback(async () => {
    if (!session) { setRaces([]); setLoading(false); return }
    setLoading(true)
    const { data, error: err } = await supabase.from('race_catalog').select('*')
    if (err) { setError(err.message); setRaces([]) }
    else { setRaces(((data as CatalogRaceRow[]) ?? []).sort(byName)); setError(null) }
    setLoading(false)
  }, [session])

  useEffect(() => { void fetchAll() }, [fetchAll])

  const updateRace = useCallback<DmRacesState['updateRace']>(async (id, patch) => {
    let previous: CatalogRaceRow | undefined
    setRaces(prev => prev.map(r => { if (r.id !== id) return r; previous = r; return { ...r, ...patch } as CatalogRaceRow }))
    const { data, error: err } = await supabase.from('race_catalog').update(patch).eq('id', id).select().single<CatalogRaceRow>()
    if (err) { setError(err.message); if (previous) setRaces(prev => prev.map(r => (r.id === id ? previous! : r))) }
    else if (data) setRaces(prev => prev.map(r => (r.id === id ? data : r)).sort(byName))
  }, [])

  const deleteRace = useCallback<DmRacesState['deleteRace']>(async (id) => {
    const snapshot = races
    setRaces(prev => prev.filter(r => r.id !== id))
    const { error: err } = await supabase.from('race_catalog').delete().eq('id', id)
    if (err) { setError(err.message); setRaces(snapshot) }
  }, [races])

  const write = useCallback(async (id: string | null, data: RaceDef, promote: boolean): Promise<string | null> => {
    const patch = promote ? { data: { ...data, published: true }, draft: null } : { draft: data }
    if (id) {
      const { data: row, error: err } = await supabase.from('race_catalog').update(patch).eq('id', id).select().single<CatalogRaceRow>()
      if (err) { setError(err.message); return null }
      setRaces(prev => prev.map(r => (r.id === id ? row : r)).sort(byName))
      return id
    }
    // Minted once and frozen: a subrace names its parent by this id, and every
    // character assigned the race keeps it.
    const fresh = mintId(data.name ?? '', new Set(races.map(r => r.id)))
    const { data: row, error: err } = await supabase.from('race_catalog')
      .insert({ id: fresh, ...patch, ...(promote ? {} : { data: {} as RaceDef }) })
      .select().single<CatalogRaceRow>()
    if (err) { setError(err.message); return null }
    setRaces(prev => [...prev, row].sort(byName))
    return fresh
  }, [races])

  const saveDraft = useCallback<DmRacesState['saveDraft']>((id, data) => write(id, data, false), [write])
  const publishRace = useCallback<DmRacesState['publishRace']>((id, data) => write(id, data, true), [write])

  const duplicateRace = useCallback<DmRacesState['duplicateRace']>(async (id) => {
    const src = races.find(r => r.id === id)
    if (!src) return null
    const content = raceContent(src)
    return write(null, { ...content, name: `${content.name ?? 'Untitled'} (copy)`, published: false }, false)
  }, [races, write])

  return { races, loading, error, refetch: fetchAll, updateRace, deleteRace, saveDraft, publishRace, duplicateRace }
}

// ── Class catalog (migration 0016) ──────────────────────────────────────────

export interface DmClassesState {
  classes: CatalogClassRow[]
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
  updateClass: (id: string, patch: CatalogClassUpdate) => Promise<void>
  deleteClass: (id: string) => Promise<void>
  /** Park an in-progress edit. Writes `draft`, never `data`, so a class a
   *  character has already been assigned can be rewritten without disturbing
   *  what the Assign picker offers. `id` null mints a row for a class that has
   *  never been published. */
  saveDraft: (id: string | null, data: ClassDef) => Promise<string | null>
  /** Promote a draft into `data` with `published: true` and clear the draft
   *  slot. The id is minted on FIRST publish and never again. */
  publishClass: (id: string | null, data: ClassDef) => Promise<string | null>
  duplicateClass: (id: string) => Promise<string | null>
}

/** The editable payload: the parked draft if there is one, else what is
 *  published. Every list, count and audit in the class editor reads through
 *  this; only the Assign picker reads `data` directly. Twin of featureContent. */
export const classContent = (r: CatalogClassRow): ClassDef => r.draft ?? r.data

/** The DM's class-authoring library (`class_catalog`, migration 0016) —
 *  structurally the twin of useDmFeatures, draft ladder included. Consumed by
 *  the Assign Class card, which SNAPSHOTS onto the character (lib/classes.ts
 *  assignClass), so this table stays DM-only. */
export function useDmClasses(): DmClassesState {
  const { session } = useAuth()
  const [classes, setClasses] = useState<CatalogClassRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const byName = (a: CatalogClassRow, b: CatalogClassRow) =>
    (classContent(a).name ?? '').localeCompare(classContent(b).name ?? '')

  const fetchAll = useCallback(async () => {
    if (!session) { setClasses([]); setLoading(false); return }
    setLoading(true)
    const { data, error: err } = await supabase.from('class_catalog').select('*')
    if (err) { setError(err.message); setClasses([]) }
    else { setClasses(((data as CatalogClassRow[]) ?? []).sort(byName)); setError(null) }
    setLoading(false)
  }, [session])

  useEffect(() => { void fetchAll() }, [fetchAll])

  const updateClass = useCallback<DmClassesState['updateClass']>(async (id, patch) => {
    let previous: CatalogClassRow | undefined
    setClasses(prev => prev.map(c => { if (c.id !== id) return c; previous = c; return { ...c, ...patch } as CatalogClassRow }))
    const { data, error: err } = await supabase.from('class_catalog').update(patch).eq('id', id).select().single<CatalogClassRow>()
    if (err) { setError(err.message); if (previous) setClasses(prev => prev.map(c => (c.id === id ? previous! : c))) }
    else if (data) setClasses(prev => prev.map(c => (c.id === id ? data : c)).sort(byName))
  }, [])

  const deleteClass = useCallback<DmClassesState['deleteClass']>(async (id) => {
    const snapshot = classes
    setClasses(prev => prev.filter(c => c.id !== id))
    const { error: err } = await supabase.from('class_catalog').delete().eq('id', id)
    if (err) { setError(err.message); setClasses(snapshot) }
  }, [classes])

  /** One write path for both rungs of the ladder — same shape as the feature
   *  catalog's, because it is the same ladder. */
  const write = useCallback(async (id: string | null, data: ClassDef, promote: boolean): Promise<string | null> => {
    const patch = promote
      ? { data: { ...data, published: true }, draft: null }
      : { draft: data }
    if (id) {
      const { data: row, error: err } = await supabase.from('class_catalog').update(patch).eq('id', id).select().single<CatalogClassRow>()
      if (err) { setError(err.message); return null }
      setClasses(prev => prev.map(c => (c.id === id ? row : c)).sort(byName))
      return id
    }
    // Never published: mint the id now and freeze it. Other rows (and every
    // character this class has been assigned to) key off it, so a rename must
    // never touch it.
    const fresh = mintId(data.name ?? '', new Set(classes.map(c => c.id)))
    const { data: row, error: err } = await supabase.from('class_catalog')
      .insert({ id: fresh, ...patch, ...(promote ? {} : { data: {} as ClassDef }) })
      .select().single<CatalogClassRow>()
    if (err) { setError(err.message); return null }
    setClasses(prev => [...prev, row].sort(byName))
    return fresh
  }, [classes])

  const saveDraft = useCallback<DmClassesState['saveDraft']>((id, data) => write(id, data, false), [write])
  const publishClass = useCallback<DmClassesState['publishClass']>((id, data) => write(id, data, true), [write])

  const duplicateClass = useCallback<DmClassesState['duplicateClass']>(async (id) => {
    const src = classes.find(c => c.id === id)
    if (!src) return null
    const content = classContent(src)
    // A copy starts as a draft — a starting point to edit, not something to put
    // in front of the Assign picker before it has been looked at.
    return write(null, { ...content, name: `${content.name ?? 'Untitled'} (copy)`, published: false }, false)
  }, [classes, write])

  return {
    classes, loading, error, refetch: fetchAll, updateClass, deleteClass,
    saveDraft, publishClass, duplicateClass,
  }
}

export interface DmEffectsState {
  effects: CatalogEffectRow[]
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
  createEffect: (e: CatalogEffectInsert) => Promise<CatalogEffectRow | null>
  updateEffect: (id: string, patch: CatalogEffectUpdate) => Promise<void>
  deleteEffect: (id: string) => Promise<void>
}

/** The DM's effect-authoring library (`effect_catalog`, migration 0013) —
 *  structurally the twin of useDmFeatures. Consumed by the item form's Effects
 *  Granted picker; the referenced mods get compiled into the item's own
 *  `effects` on save, so this table stays DM-only. */
export function useDmEffects(): DmEffectsState {
  const { session } = useAuth()
  const [effects, setEffects] = useState<CatalogEffectRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const byName = (a: CatalogEffectRow, b: CatalogEffectRow) =>
    (a.data?.name ?? '').localeCompare(b.data?.name ?? '')

  const fetchAll = useCallback(async () => {
    if (!session) { setEffects([]); setLoading(false); return }
    setLoading(true)
    const { data, error: err } = await supabase.from('effect_catalog').select('*')
    if (err) { setError(err.message); setEffects([]) }
    else { setEffects(((data as CatalogEffectRow[]) ?? []).sort(byName)); setError(null) }
    setLoading(false)
  }, [session])

  useEffect(() => { void fetchAll() }, [fetchAll])

  const createEffect = useCallback<DmEffectsState['createEffect']>(async (e) => {
    const { data, error: err } = await supabase.from('effect_catalog').insert(e).select().single<CatalogEffectRow>()
    if (err) { setError(err.message); return null }
    setEffects(prev => [...prev, data].sort(byName))
    return data
  }, [])

  const updateEffect = useCallback<DmEffectsState['updateEffect']>(async (id, patch) => {
    let previous: CatalogEffectRow | undefined
    setEffects(prev => prev.map(e => { if (e.id !== id) return e; previous = e; return { ...e, ...patch } as CatalogEffectRow }))
    const { data, error: err } = await supabase.from('effect_catalog').update(patch).eq('id', id).select().single<CatalogEffectRow>()
    if (err) { setError(err.message); if (previous) setEffects(prev => prev.map(e => (e.id === id ? previous! : e))) }
    else if (data) setEffects(prev => prev.map(e => (e.id === id ? data : e)).sort(byName))
  }, [])

  const deleteEffect = useCallback<DmEffectsState['deleteEffect']>(async (id) => {
    const snapshot = effects
    setEffects(prev => prev.filter(e => e.id !== id))
    const { error: err } = await supabase.from('effect_catalog').delete().eq('id', id)
    if (err) { setError(err.message); setEffects(snapshot) }
  }, [effects])

  return { effects, loading, error, refetch: fetchAll, createEffect, updateEffect, deleteEffect }
}

export interface DmSpellsState {
  spells: CatalogSpellRow[]
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
  createSpell: (s: CatalogSpellInsert) => Promise<CatalogSpellRow | null>
  updateSpell: (id: string, patch: CatalogSpellUpdate) => Promise<void>
  deleteSpell: (id: string) => Promise<void>
}

/** The DM's spell-authoring library (`spell_catalog`, migration 0010) —
 *  structurally the twin of useDmFeatures. Consumed by Grant Spell (copy onto
 *  a character's `spellbook.spells`) — a snapshot, so this table stays
 *  DM-only. Sorted by level then name so the catalog groups the same way the
 *  player Grimoire does. */
export function useDmSpells(): DmSpellsState {
  const { session } = useAuth()
  const [spells, setSpells] = useState<CatalogSpellRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const byLevelThenName = (a: CatalogSpellRow, b: CatalogSpellRow) =>
    (a.data?.level ?? 0) - (b.data?.level ?? 0) || (a.data?.name ?? '').localeCompare(b.data?.name ?? '')

  const fetchAll = useCallback(async () => {
    if (!session) { setSpells([]); setLoading(false); return }
    setLoading(true)
    const { data, error: err } = await supabase.from('spell_catalog').select('*')
    if (err) { setError(err.message); setSpells([]) }
    else { setSpells(((data as CatalogSpellRow[]) ?? []).sort(byLevelThenName)); setError(null) }
    setLoading(false)
  }, [session])

  useEffect(() => { void fetchAll() }, [fetchAll])

  const createSpell = useCallback<DmSpellsState['createSpell']>(async (s) => {
    const { data, error: err } = await supabase.from('spell_catalog').insert(s).select().single<CatalogSpellRow>()
    if (err) { setError(err.message); return null }
    setSpells(prev => [...prev, data].sort(byLevelThenName))
    return data
  }, [])

  const updateSpell = useCallback<DmSpellsState['updateSpell']>(async (id, patch) => {
    let previous: CatalogSpellRow | undefined
    setSpells(prev => prev.map(s => { if (s.id !== id) return s; previous = s; return { ...s, ...patch } as CatalogSpellRow }))
    const { data, error: err } = await supabase.from('spell_catalog').update(patch).eq('id', id).select().single<CatalogSpellRow>()
    if (err) { setError(err.message); if (previous) setSpells(prev => prev.map(s => (s.id === id ? previous! : s))) }
    else if (data) setSpells(prev => prev.map(s => (s.id === id ? data : s)).sort(byLevelThenName))
  }, [])

  const deleteSpell = useCallback<DmSpellsState['deleteSpell']>(async (id) => {
    const snapshot = spells
    setSpells(prev => prev.filter(s => s.id !== id))
    const { error: err } = await supabase.from('spell_catalog').delete().eq('id', id)
    if (err) { setError(err.message); setSpells(snapshot) }
  }, [spells])

  return { spells, loading, error, refetch: fetchAll, createSpell, updateSpell, deleteSpell }
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
