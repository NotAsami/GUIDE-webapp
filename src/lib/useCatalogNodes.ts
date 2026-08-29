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
import {
  useDmBackgrounds, useDmCatalog, useDmClasses, useDmFeatures, useDmRaces, useDmSpells,
  backgroundContent, classContent, featureContent, raceContent,
} from './dm.ts'
import { useShardCatalog } from './shardCatalog.ts'
import { gid, nodeGid, normalizeTag, probeScope, type AuthoredNode } from './graph.ts'
import type { VarDef } from './database.types.ts'

export type CatalogNodes = {
  nodes: AuthoredNode[]
  /** gid → display name and kind, for pickers and collapsed rows. */
  namesByGid: Map<string, { name: string; kind: string }>
  /** Every tag in use anywhere, with how many things carry it — the
   *  autocomplete source. Counted across all four catalogs, because a tag's
   *  whole purpose is to reach across them. */
  tagUse: Map<string, number>
  /** Every VARIABLE declared anywhere in the catalog, name → type.
   *
   *  A graph reaches across nodes and so does its state: Brutal Strike is gated
   *  `when: reckless`, and `reckless` is declared on Reckless Attack. At runtime
   *  the scope is flat across every active source, so that works — but the
   *  audit only ever saw the node in front of it and called the name unknown,
   *  which blocks Publish. Cross-feature state was unauthorable until this
   *  existed. Same job as `characterVars`' `catalogTypes`, one layer up.
   *
   *  First declaration wins on a collision, matching `collectVars`; the
   *  duplicate itself is reported by the audit, not re-reported here. */
  catalogTypes: Record<string, 'num' | 'bool'>
  /** Just the FEATURES, gid + name, sorted. A use-counter variable points at one
   *  (VarDef.uses), and every editor that shows the variables block needs the
   *  same list — deriving it per screen would be seven copies of one filter. */
  featureList: { gid: string; name: string }[]
  /** False until every library has loaded. See the note above. */
  ready: boolean
}

export function useCatalogNodes(): CatalogNodes {
  const lib = useDmFeatures()
  const itemLib = useDmCatalog()
  const spellLib = useDmSpells()
  const { catalog: shardCatalog } = useShardCatalog()
  /* CARRIERS DECLARE VARIABLES TOO. A class/race/background is not TARGETABLE —
     it has no gid, so it contributes nothing to `nodes` — but assignClass and its
     twins snapshot its `vars` onto the sheet as a carrier feature, which puts
     them in the flat runtime scope like any other. Without them here the audit
     called `rageDamage` unknown, and an unknown identifier is an error that
     blocks Publish: a feature reading its own class's progression was
     authorable only by hand-editing the row. */
  const classLib = useDmClasses()
  const raceLib = useDmRaces()
  const bgLib = useDmBackgrounds()

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

  const catalogTypes = useMemo(() => {
    const m: Record<string, 'num' | 'bool'> = {}
    /* DERIVED VARIABLES COUNT. Their type is not declared — it comes from the
       formula — so this runs probeScope, the same walk auditNode uses to type a
       node's own declarations. Skipping them meant every progression table
       (`rageDamage`, `weaponMastery`) read as unknown, since a table is always
       derived. Defaulting them to `num` instead would make a derived BOOL a type
       error wherever another node read it. */
    const take = (defs: VarDef[] | undefined) => {
      if (!defs?.length) return
      const scope = probeScope(defs)
      for (const d of defs) {
        if (!d.name || m[d.name] || !(d.name in scope)) continue
        m[d.name] = typeof scope[d.name] === 'boolean' ? 'bool' : 'num'
      }
    }
    for (const r of lib.features) take(featureContent(r).vars)
    for (const r of spellLib.spells) take(r.data?.vars)
    for (const r of itemLib.items) take(r.data?.vars)
    for (const tree of Object.values(shardCatalog)) {
      for (const n of tree.nodes ?? []) take(n.vars)
    }
    for (const r of classLib.classes) take(classContent(r).vars)
    for (const r of raceLib.races) take(raceContent(r).vars)
    for (const r of bgLib.backgrounds) take(backgroundContent(r).vars)
    return m
  }, [lib.features, spellLib.spells, itemLib.items, shardCatalog, classLib.classes, raceLib.races, bgLib.backgrounds])

  const featureList = useMemo(() =>
    lib.features
      .map(r => ({ gid: gid('feature', { feature_id: r.id }), name: featureContent(r).name ?? r.id }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  [lib.features])

  const tagUse = useMemo(() => {
    const m = new Map<string, number>()
    for (const n of nodes) for (const t of n.tags ?? []) m.set(normalizeTag(t), (m.get(normalizeTag(t)) ?? 0) + 1)
    return m
  }, [nodes])

  /* The carrier libraries join `ready` for the same reason the others are in it:
     an audit that runs before they load sees a whitelist missing their variables
     and reports a clean node as broken. */
  return {
    nodes, namesByGid, tagUse, catalogTypes, featureList,
    ready: !lib.loading && !itemLib.loading && !spellLib.loading
      && !classLib.loading && !raceLib.loading && !bgLib.loading,
  }
}
