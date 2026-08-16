/**
 * DM-side shard authoring — fetches BOTH halves of a tree (the public
 * `shard_tree_catalog` row and its DM-only `shard_tree_secrets` row) and
 * merges them into one fully-editable `EditorTree`, so the Lattice Editor can
 * show/edit a concealed node's real name/effect and every `dm` note. Saving
 * reverses the merge: concealed-node text and `dm` notes are stripped back
 * out of the catalog write and go to secrets instead — the split that keeps
 * shard_tree_catalog safe for the player policy (migration 0008).
 */
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from './auth'
import { supabase } from './supabase'
import type {
  ShardTreeCatalogRow, ShardTreeSecretData, ShardTreeSecretRow,
} from './database.types'
// The concealed-node boundary lives apart so it can be tested — see the module.
import { mergeTree, splitForSave, type EditorNode, type EditorTree } from './shardSecrets'

export type { EditorNode, EditorTree }

export interface DmShardsState {
  /** PUBLISHED trees, as players read them. */
  trees: EditorTree[]
  /** Parked in-progress edits, by tree id. The editor edits `drafts[id] ?? tree`. */
  drafts: Record<string, EditorTree>
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
  /** "Save Draft" — parks the edit in shard_tree_secrets.data.draft. The catalog
   *  row is NOT touched, so the party keeps reading the published tree. */
  saveTree: (tree: EditorTree) => Promise<void>
  /** "Publish" — promotes the draft into the catalog with `published: true` and
   *  clears the draft slot. */
  publishTree: (tree: EditorTree) => Promise<void>
  createTree: () => Promise<EditorTree | null>
  deleteTree: (id: string) => Promise<void>
}

/** The DM's shard-authoring library — structurally the twin of useDmFeatures,
 *  except every write fans out to two tables (see splitForSave above). */
export function useDmShards(): DmShardsState {
  const { session } = useAuth()
  const [trees, setTrees] = useState<EditorTree[]>([])
  const [drafts, setDrafts] = useState<Record<string, EditorTree>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    if (!session) { setTrees([]); setDrafts({}); setLoading(false); return }
    setLoading(true)
    const [catalogRes, secretsRes] = await Promise.all([
      supabase.from('shard_tree_catalog').select('*'),
      supabase.from('shard_tree_secrets').select('*'),
    ])
    if (catalogRes.error) { setError(catalogRes.error.message); setTrees([]); setLoading(false); return }
    const secretRows = ((secretsRes.data as ShardTreeSecretRow[] | null) ?? [])
    const secretsById = new Map(secretRows.map(r => [r.shard_id, r]))
    const merged = ((catalogRes.data as ShardTreeCatalogRow[] | null) ?? [])
      .map(row => mergeTree(row.data, secretsById.get(row.id)))
      .sort((a, b) => a.name.localeCompare(b.name))
    setTrees(merged)
    setDrafts(Object.fromEntries(
      secretRows.filter(r => r.data.draft).map(r => [r.shard_id, r.data.draft as EditorTree]),
    ))
    setError(null)
    setLoading(false)
  }, [session])

  useEffect(() => { void fetchAll() }, [fetchAll])

  /** Park the edit in the DM-only secrets row, leaving the catalog alone.
   *
   *  Read-modify-write rather than a bare upsert: the same row holds the
   *  PUBLISHED tree's concealed node text and dm notes, and overwriting `data`
   *  with just `{draft}` would delete them. One extra round trip per save is a
   *  fair price for not needing a second copy of the secrets payload in state. */
  const saveTree = useCallback<DmShardsState['saveTree']>(async (tree) => {
    const { data: existing } = await supabase.from('shard_tree_secrets').select('data').eq('shard_id', tree.id).maybeSingle()
    const prev = ((existing as { data?: ShardTreeSecretData } | null)?.data ?? {}) as ShardTreeSecretData
    const { error: err } = await supabase.from('shard_tree_secrets')
      .upsert({ shard_id: tree.id, data: { ...prev, draft: tree } })
    if (err) { setError(err.message); return }
    setError(null)
    setDrafts(d => ({ ...d, [tree.id]: tree }))
  }, [])

  /** Promote: the catalog row becomes the draft's content, published, and the
   *  draft slot is cleared. splitForSave runs HERE and only here — a draft is
   *  stored merged because the secrets row is DM-only anyway. */
  const publishTree = useCallback<DmShardsState['publishTree']>(async (tree) => {
    const next = { ...tree, published: true }
    const { catalog, secretsData } = splitForSave(next)
    const { error: err1 } = await supabase.from('shard_tree_catalog').upsert({ id: catalog.id, data: catalog })
    if (err1) { setError(err1.message); return }
    // `draft` deliberately absent from the payload — publishing clears it.
    const { error: err2 } = await supabase.from('shard_tree_secrets').upsert({ shard_id: catalog.id, data: secretsData })
    if (err2) { setError(err2.message); return }
    setError(null)
    setTrees(prev => (prev.some(t => t.id === next.id)
      ? prev.map(t => (t.id === next.id ? next : t))
      : [...prev, next].sort((a, b) => a.name.localeCompare(b.name))))
    setDrafts(d => { const { [next.id]: _drop, ...rest } = d; return rest })
  }, [])

  const createTree = useCallback<DmShardsState['createTree']>(async () => {
    let id = 'new-shard', i = 2
    while (trees.some(t => t.id === id)) id = `new-shard-${i++}`
    const blank: EditorTree = {
      id, name: 'New Shard Tree', rarity: 'Common', module: 'Unclassified', icon: 'fa-gem',
      capacity: 5, published: false, flavor: '', attuneRule: 'Requires attunement · occupies 1 of 2 shard slots',
      baseMods: {}, baseFeatures: [], baseDetails: [],
      branches: { core: 'Core' },
      nodes: [{ id: 'core', name: 'Shard Core', tier: 0, branch: 'core', angle: 0, cost: 0, icon: 'fa-gem', prereqs: [], effect: 'Base attunement.' }],
    }
    await publishTree({ ...blank, published: false })
    return blank
  }, [trees, publishTree])

  const deleteTree = useCallback<DmShardsState['deleteTree']>(async (id) => {
    const snapshot = trees
    setTrees(prev => prev.filter(t => t.id !== id))
    const { error: err } = await supabase.from('shard_tree_catalog').delete().eq('id', id)
    if (err) { setError(err.message); setTrees(snapshot) }
  }, [trees])

  return { trees, drafts, loading, error, refetch: fetchAll, saveTree, publishTree, createTree, deleteTree }
}
