/**
 * The authoring catalog: every targetable thing, across all four libraries.
 *
 * A target selector reaches ACROSS catalogs by design — a feature boosts a
 * spell, a shard node boosts an item — so every editor that authors a graph
 * needs the same list. It lived inside FeatureEditor until slice 6b gave the
 * spell form a graph block; a second copy would be a second answer to "what can
 * be targeted", and the two would drift the first time a catalog gained a kind.
 *
 * `ready` is load-bearing, not a convenience. `auditNode` SKIPS dangling-target
 * detection entirely when the node list is empty, so an audit that runs before
 * the libraries load reports a clean node that is not clean. Every caller must
 * gate on it.
 */
import { useMemo } from 'react'
import { useDmCatalog, useDmFeatures, useDmSpells, featureContent } from './dm.ts'
import { useShardCatalog } from './shardCatalog.ts'
import { gid, nodeGid, normalizeTag, type AuthoredNode } from './graph.ts'

export type CatalogNodes = {
  nodes: AuthoredNode[]
  /** gid → display name and kind, for pickers and collapsed rows. */
  namesByGid: Map<string, { name: string; kind: string }>
  /** Every tag in use anywhere, with how many things carry it — the
   *  autocomplete source. Counted across all four catalogs, because a tag's
   *  whole purpose is to reach across them. */
  tagUse: Map<string, number>
  /** False until every library has loaded. See the note above. */
  ready: boolean
}

export function useCatalogNodes(): CatalogNodes {
  const lib = useDmFeatures()
  const itemLib = useDmCatalog()
  const spellLib = useDmSpells()
  const { catalog: shardCatalog } = useShardCatalog()

  /* A WEAPON IS AN ITEM WEARING A SECOND GID. `gid('weapon', …)` and
     `gid('item', …)` both resolve for a catalog row with category 'weapon';
     emitting only `item:` would make every `weapon:` target read as a dangling
     reference. */
  const nodes: AuthoredNode[] = useMemo(() => [
    ...lib.features.map(r => ({ gid: gid('feature', { feature_id: r.id }), tags: featureContent(r).tags })),
    ...spellLib.spells.map(r => ({ gid: gid('spell', { spell_id: r.id }), tags: r.data?.tags })),
    ...itemLib.items.flatMap(r => {
      const t = r.data?.tags
      const base = [{ gid: gid('item', { item_id: r.id }), tags: t }]
      return r.data?.category === 'weapon' ? [...base, { gid: gid('weapon', { item_id: r.id }), tags: t }] : base
    }),
    ...Object.entries(shardCatalog).flatMap(([tid, tree]) =>
      (tree.nodes ?? []).map(n => ({ gid: nodeGid(tid, n.id), tags: n.tags }))),
  ], [lib.features, spellLib.spells, itemLib.items, shardCatalog])

  const namesByGid = useMemo(() => {
    const m = new Map<string, { name: string; kind: string }>()
    for (const r of lib.features) m.set(gid('feature', { feature_id: r.id }), { name: featureContent(r).name ?? r.id, kind: 'Feature' })
    for (const r of spellLib.spells) m.set(gid('spell', { spell_id: r.id }), { name: r.data?.name ?? r.id, kind: 'Spell' })
    for (const r of itemLib.items) {
      const nm = { name: r.data?.name ?? r.id, kind: r.data?.category === 'weapon' ? 'Weapon' : 'Item' }
      m.set(gid('item', { item_id: r.id }), nm)
      if (r.data?.category === 'weapon') m.set(gid('weapon', { item_id: r.id }), nm)
    }
    for (const [tid, tree] of Object.entries(shardCatalog)) {
      for (const n of tree.nodes ?? []) m.set(nodeGid(tid, n.id), { name: `${tree.name} · ${n.name || n.id}`, kind: 'Shard node' })
    }
    return m
  }, [lib.features, spellLib.spells, itemLib.items, shardCatalog])

  const tagUse = useMemo(() => {
    const m = new Map<string, number>()
    for (const n of nodes) for (const t of n.tags ?? []) m.set(normalizeTag(t), (m.get(normalizeTag(t)) ?? 0) + 1)
    return m
  }, [nodes])

  return { nodes, namesByGid, tagUse, ready: !lib.loading && !itemLib.loading && !spellLib.loading }
}
