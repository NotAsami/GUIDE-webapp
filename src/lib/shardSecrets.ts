/**
 * The concealed-node boundary: what a player may see, and what only the DM may.
 *
 * Split out of dmShards.ts so it can be TESTED. `shard_tree_secrets` has no
 * player policy — ever (migration 0008) — so `splitForSave` deciding which
 * fields reach `shard_tree_catalog.data` is the only thing standing between a
 * concealed node's mechanics and every bound player's client. That is worth a
 * test, and dmShards.ts cannot have one: it imports the supabase client, which
 * reads `import.meta.env` and does not load outside Vite.
 *
 * Pure, no React, no network.
 */
import type {
  ShardNode, ShardTree, ShardTreeSecretData, ShardTreeSecretRow,
} from './database.types.ts'

/** Derived from the stored shape so the two can't drift — adding a field to
 *  ShardTreeSecretData is all it takes for splitForSave to be able to carry it. */
type SecretNodes = NonNullable<ShardTreeSecretData['nodes']>

/** The editor's working copy: a ShardTree with `dm` notes merged onto the
 *  tree and every node, straight from secrets. Never sent to the DB as-is —
 *  `splitForSave` below un-merges it first. */
export type EditorNode = ShardNode & { dm?: string }
export type EditorTree = Omit<ShardTree, 'nodes'> & { dm?: string; nodes: EditorNode[] }

export function mergeTree(tree: ShardTree, secret: ShardTreeSecretRow | undefined): EditorTree {
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
export function splitForSave(tree: EditorTree): { catalog: ShardTree; secretsData: { dm?: string; nodes: SecretNodes } } {
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
