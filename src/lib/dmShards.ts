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
  Feature, ItemEffects, ShardNode, ShardPerk, ShardTree, ShardTreeCatalogRow, ShardTreeSecretRow,
} from './database.types'

/** The editor's working copy: a ShardTree with `dm` notes merged onto the
 *  tree and every node, straight from secrets. Never sent to the DB as-is —
 *  `splitForSave` below un-merges it first. */
export type EditorNode = ShardNode & { dm?: string }
export type EditorTree = Omit<ShardTree, 'nodes'> & { dm?: string; nodes: EditorNode[] }

function mergeTree(tree: ShardTree, secret: ShardTreeSecretRow | undefined): EditorTree {
  const secretNodes = secret?.data.nodes ?? {}
  return {
    ...tree,
    dm: secret?.data.dm,
    nodes: tree.nodes.map((n): EditorNode => {
      const s = secretNodes[n.id]
      if (!s) return n
      return { ...n, name: s.name, effect: s.effect, dm: s.dm, mods: s.mods ?? n.mods, features: s.features ?? n.features, perks: s.perks ?? n.perks }
    }),
  }
}

/** Reverse the merge for a write: concealed nodes lose name/effect/mods/
 *  features/perks/dm from the catalog copy (geometry only survives there) and
 *  gain them back in the returned secrets payload; every OTHER node's `dm`
 *  note (if any) moves to secrets too, catalog keeps everything else. */
function splitForSave(tree: EditorTree): { catalog: ShardTree; secretsData: { dm?: string; nodes: Record<string, { name: string; effect: string; dm?: string; mods?: ItemEffects; features?: Feature[]; perks?: ShardPerk[] }> } } {
  const secretNodes: Record<string, { name: string; effect: string; dm?: string; mods?: ItemEffects; features?: Feature[]; perks?: ShardPerk[] }> = {}
  const catalogNodes: ShardNode[] = tree.nodes.map(n => {
    const { dm, ...node } = n
    if (n.concealed) {
      secretNodes[n.id] = { name: node.name, effect: node.effect, dm, mods: node.mods, features: node.features, perks: node.perks }
      // Geometry only — no name/effect/mods/features/perks reach the catalog row.
      const geometry: ShardNode = {
        id: node.id, name: '', tier: node.tier, branch: node.branch, angle: node.angle,
        cost: node.cost, icon: node.icon, prereqs: node.prereqs, effect: '', concealed: true,
      }
      return geometry
    }
    if (dm) secretNodes[n.id] = { name: node.name, effect: node.effect, dm }
    return node
  })
  const { dm: treeDm, ...catalog } = tree
  return { catalog: { ...catalog, nodes: catalogNodes }, secretsData: { dm: treeDm, nodes: secretNodes } }
}

export interface DmShardsState {
  trees: EditorTree[]
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
  /** Persists a tree exactly as given (published flag untouched) — "Save Draft". */
  saveTree: (tree: EditorTree) => Promise<void>
  /** Persists with `published: true` forced — "Publish". */
  publishTree: (tree: EditorTree) => Promise<void>
  createTree: () => Promise<EditorTree | null>
  deleteTree: (id: string) => Promise<void>
}

/** The DM's shard-authoring library — structurally the twin of useDmFeatures,
 *  except every write fans out to two tables (see splitForSave above). */
export function useDmShards(): DmShardsState {
  const { session } = useAuth()
  const [trees, setTrees] = useState<EditorTree[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    if (!session) { setTrees([]); setLoading(false); return }
    setLoading(true)
    const [catalogRes, secretsRes] = await Promise.all([
      supabase.from('shard_tree_catalog').select('*'),
      supabase.from('shard_tree_secrets').select('*'),
    ])
    if (catalogRes.error) { setError(catalogRes.error.message); setTrees([]); setLoading(false); return }
    const secretsById = new Map(((secretsRes.data as ShardTreeSecretRow[] | null) ?? []).map(r => [r.shard_id, r]))
    const merged = ((catalogRes.data as ShardTreeCatalogRow[] | null) ?? [])
      .map(row => mergeTree(row.data, secretsById.get(row.id)))
      .sort((a, b) => a.name.localeCompare(b.name))
    setTrees(merged)
    setError(null)
    setLoading(false)
  }, [session])

  useEffect(() => { void fetchAll() }, [fetchAll])

  const writeTree = useCallback(async (tree: EditorTree) => {
    const { catalog, secretsData } = splitForSave(tree)
    const { error: err1 } = await supabase.from('shard_tree_catalog').upsert({ id: catalog.id, data: catalog })
    if (err1) { setError(err1.message); return }
    const { error: err2 } = await supabase.from('shard_tree_secrets').upsert({ shard_id: catalog.id, data: secretsData })
    if (err2) { setError(err2.message); return }
    setError(null)
    setTrees(prev => prev.map(t => (t.id === tree.id ? tree : t)))
  }, [])

  const saveTree = useCallback<DmShardsState['saveTree']>(async (tree) => { await writeTree(tree) }, [writeTree])
  const publishTree = useCallback<DmShardsState['publishTree']>(async (tree) => { await writeTree({ ...tree, published: true }) }, [writeTree])

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
    await writeTree(blank)
    setTrees(prev => [...prev, blank].sort((a, b) => a.name.localeCompare(b.name)))
    return blank
  }, [trees, writeTree])

  const deleteTree = useCallback<DmShardsState['deleteTree']>(async (id) => {
    const snapshot = trees
    setTrees(prev => prev.filter(t => t.id !== id))
    const { error: err } = await supabase.from('shard_tree_catalog').delete().eq('id', id)
    if (err) { setError(err.message); setTrees(snapshot) }
  }, [trees])

  return { trees, loading, error, refetch: fetchAll, saveTree, publishTree, createTree, deleteTree }
}
