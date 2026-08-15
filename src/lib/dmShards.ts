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
  ShardNode, ShardTree, ShardTreeCatalogRow, ShardTreeSecretData, ShardTreeSecretRow,
} from './database.types'

/** Derived from the stored shape so the two can't drift — adding a field to
 *  ShardTreeSecretData is all it takes for splitForSave to be able to carry it. */
type SecretNodes = NonNullable<ShardTreeSecretData['nodes']>

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
      return { ...n, name: s.name, effect: s.effect, dm: s.dm, mods: s.mods ?? n.mods, features: s.features ?? n.features, perks: s.perks ?? n.perks, vars: s.vars ?? n.vars, tags: s.tags ?? n.tags, graph: s.graph ?? n.graph }
    }),
  }
}

/** Reverse the merge for a write: concealed nodes lose name/effect/mods/
 *  features/perks/vars/dm from the catalog copy (geometry only survives there)
 *  and gain them back in the returned secrets payload; every OTHER node's `dm`
 *  note (if any) moves to secrets too, catalog keeps everything else.
 *
 *  The concealed branch rebuilds the node field-by-field rather than spreading,
 *  so that a field added to ShardNode can never leak to the player catalog by
 *  default. The cost is that every new MECHANICAL field must be added here too
 *  or it is silently dropped on save — `vars` is the most recent. */
function splitForSave(tree: EditorTree): { catalog: ShardTree; secretsData: { dm?: string; nodes: SecretNodes } } {
  const secretNodes: SecretNodes = {}
  const catalogNodes: ShardNode[] = tree.nodes.map(n => {
    const { dm, ...node } = n
    if (n.concealed) {
      secretNodes[n.id] = { name: node.name, effect: node.effect, dm, mods: node.mods, features: node.features, perks: node.perks, vars: node.vars, tags: node.tags, graph: node.graph }
      // Geometry only — no name/effect/mods/features/perks/vars/tags/graph reach
      // the catalog row.
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
