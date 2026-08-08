/**
 * Shard domain logic — the 3 shard slots, their per-shard point pools, and
 * node state derivation. Mirrors lib/equip.ts's attunement rule: `state`
 * (attuned/available/locked) and `spent` are NEVER stored, only `earned` and
 * `attuned` are — everything else derives from the catalog + those two
 * fields, so it can't drift out of sync (one source of truth, CLAUDE.md).
 *
 * `shardId: null` in a slot means empty. `slot1` is always the G.U.I.D.E.
 * shard (`locked: true`) — the Shard screen renders it but never offers
 * Eject/re-slot on it.
 */

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from './auth'
import { supabase } from './supabase'
import type {
  CharacterRow, Feature, ItemEffects, ShardNode, ShardPerk, ShardSlot, ShardsField, ShardTree, ShardTreeCatalogRow,
} from './database.types'

export const SHARD_SLOT_KEYS = ['slot1', 'slot2', 'slot3'] as const
export type ShardSlotKey = typeof SHARD_SLOT_KEYS[number]

const EMPTY_SLOT: ShardSlot = { shardId: null, earned: 0, attuned: [] }

/** All 3 slots, normalized — missing slots read as empty rather than undefined. */
export function shardSlots(character: CharacterRow): Record<ShardSlotKey, ShardSlot> {
  const raw = character.shards ?? {}
  const out = {} as Record<ShardSlotKey, ShardSlot>
  for (const k of SHARD_SLOT_KEYS) out[k] = raw[k] ?? EMPTY_SLOT
  return out
}

/** Eject a shard from a slot: benches its earned/attuned progress under its
 *  own id (character.shards.bench) and empties the slot. Re-slotting the
 *  SAME shard later (installShard) restores that progress exactly instead of
 *  resetting to a fresh core node — the fix for the recurring "attunement
 *  lost on re-equip" bug, shared by both the player Shard screen and the DM
 *  OperatorConsole shard assignment so neither can regress independently.
 *  No-op on an already-empty or locked slot. */
export function ejectShard(character: CharacterRow, key: ShardSlotKey): ShardsField {
  const slot = shardSlots(character)[key]
  if (!slot.shardId || slot.locked) return character.shards
  return {
    ...character.shards,
    bench: { ...character.shards?.bench, [slot.shardId]: { earned: slot.earned, attuned: slot.attuned } },
    [key]: { shardId: null, earned: 0, attuned: [] },
  }
}

/** Slot a shard into a port: restores its benched progress if this exact
 *  shard was ejected earlier, otherwise starts fresh at the core node. */
export function installShard(character: CharacterRow, key: ShardSlotKey, shardId: string): ShardsField {
  const { [shardId]: saved, ...bench } = character.shards?.bench ?? {}
  return {
    ...character.shards,
    bench,
    [key]: saved ? { shardId, earned: saved.earned, attuned: saved.attuned } : { shardId, earned: 0, attuned: ['core'] },
  }
}

/** Shard trees the DM has granted this character (their satchel) — the only
 *  ids the player's install picker will offer, whether or not currently
 *  slotted. Granting is a DM action (Operator Console); players never
 *  self-serve from the full published catalog. */
export function shardOwned(character: CharacterRow): string[] {
  return character.shards?.owned ?? []
}

/** Points spent on a shard's tree — Σ cost of its attuned nodes. The ONLY
 *  place this number is computed; it is never read off stored state. */
export function shardSpent(tree: ShardTree | undefined, slot: ShardSlot): number {
  if (!tree) return 0
  return slot.attuned.reduce((n, id) => n + (tree.nodes.find(x => x.id === id)?.cost ?? 0), 0)
}

/** Unspent points, clamped so a capacity cut by the DM after points were
 *  earned can't go negative. */
export function shardAvailable(tree: ShardTree | undefined, slot: ShardSlot): number {
  const earned = Math.min(slot.earned, tree?.capacity ?? slot.earned)
  return Math.max(0, earned - shardSpent(tree, slot))
}

/** Polar layout shared by the player tree (ShardTree.tsx) and the DM lattice
 *  editor (ShardLattice.tsx) — both must agree on where a node sits, since
 *  "position derives from tier + angle, no hardcoded pixel coords" is the
 *  whole point of the schema. Returns coords relative to the tree's own
 *  center; callers add their canvas radius. */
export const RING_GAP = 132

export function nodeXY(n: Pick<ShardNode, 'tier' | 'angle'>, ringGap: number = RING_GAP): { x: number; y: number } {
  const r = ringGap * n.tier
  const rad = (n.angle * Math.PI) / 180
  return { x: r * Math.sin(rad), y: -r * Math.cos(rad) }
}

/** Branch spoke colour, shared 1:1 by the player tree and the DM lattice
 *  editor so a spoke reads the same hue in both. A tree's own
 *  `branchColors` (set in the editor) wins; otherwise this built-in map by
 *  branch key; otherwise a neutral fallback for a DM-authored branch that
 *  was never assigned a colour. */
const BRANCH_COLOR: Record<string, string> = {
  core: 'var(--amber-hot)', might: 'var(--beige)', vitality: 'var(--cyan)',
  grit: 'var(--violet)', apex: 'var(--amber)',
  signal: 'var(--cyan)', recall: 'var(--beige)', ember: 'var(--danger-hot)', ash: 'var(--violet)',
}
export function branchColor(tree: ShardTree, branchKey: string): string {
  return tree.branchColors?.[branchKey] ?? BRANCH_COLOR[branchKey] ?? 'var(--beige-dim)'
}

export type NodeState = 'attuned' | 'available' | 'locked'

/** A node is available the instant every prereq is attuned — cost/points are
 *  checked at spend time, not reflected in state (an available-but-unaffordable
 *  node still reads "available", same as the mockup). */
export function nodeState(node: ShardNode, slot: ShardSlot): NodeState {
  if (slot.attuned.includes(node.id)) return 'attuned'
  return node.prereqs.every(p => slot.attuned.includes(p)) ? 'available' : 'locked'
}

/** ItemEffects contributed by every slotted shard: each tree's `baseMods`
 *  (granted on slot) plus every attuned node's `mods`. Feeds effectiveSheet()
 *  — read-only derivation, never written back. */
export function shardEffects(character: CharacterRow, catalog: Record<string, ShardTree>): ItemEffects[] {
  const out: ItemEffects[] = []
  for (const slot of Object.values(shardSlots(character))) {
    if (!slot.shardId) continue
    const tree = catalog[slot.shardId]
    if (!tree) continue
    if (tree.baseMods) out.push(tree.baseMods)
    for (const id of slot.attuned) {
      const mods = tree.nodes.find(n => n.id === id)?.mods
      if (mods) out.push(mods)
    }
  }
  return out
}

/** Features granted by every slotted shard, namespaced like gearFeatures()
 *  (Features.tsx) so two shards can't collide as React keys. Copies live on
 *  the shard/node, not on the character — unslot or reset and they vanish. */
export function shardFeatures(character: CharacterRow, catalog: Record<string, ShardTree>): Feature[] {
  const out: Feature[] = []
  for (const [slotKey, slot] of Object.entries(shardSlots(character))) {
    if (!slot.shardId) continue
    const tree = catalog[slot.shardId]
    if (!tree) continue
    for (const [i, f] of (tree.baseFeatures ?? []).entries()) {
      out.push({ ...f, id: `shard-${slotKey}-base-${f.id ?? i}`, kind: f.kind ?? 'equipment', source: f.source ?? tree.name })
    }
    for (const id of slot.attuned) {
      const node = tree.nodes.find(n => n.id === id)
      if (!node) continue
      for (const [i, f] of (node.features ?? []).entries()) {
        out.push({ ...f, id: `shard-${slotKey}-${id}-${f.id ?? i}`, kind: f.kind ?? 'equipment', source: f.source ?? node.name })
      }
    }
  }
  return out
}

/** Cosmetic flavor perks ("Darkvision") from every slotted shard's
 *  `basePerks` plus every attuned node's `perks`. Name + description, not
 *  Feature snapshots — display-only, and deliberately kept out of
 *  shardFeatures() so flavor text can't flood the player's Features screen.
 *  Concealed, un-revealed nodes contribute nothing. Drops any entry with no
 *  name — pre-migration rows may still carry the old bare-string perk format
 *  (a JS string has no `.name`), and a nameless entry has nothing to show. */
export function shardPerks(character: CharacterRow, catalog: Record<string, ShardTree>): ShardPerk[] {
  const out: ShardPerk[] = []
  for (const slot of Object.values(shardSlots(character))) {
    if (!slot.shardId) continue
    const tree = catalog[slot.shardId]
    if (!tree) continue
    out.push(...(tree.basePerks ?? []))
    for (const id of slot.attuned) {
      const node = tree.nodes.find(n => n.id === id)
      if (!node || (node.concealed && !slot.revealed?.[id])) continue
      out.push(...(node.perks ?? []))
    }
  }
  return out.filter(p => typeof p === 'object' && !!p?.name)
}

export interface ShardCatalogState {
  catalog: Record<string, ShardTree>
  loading: boolean
  refetch: () => Promise<void>
}

/** Player-side read of PUBLISHED shard trees (shard_tree_catalog, migration
 *  0008). A handful of small, rarely-changing rows — one fetch on mount, no
 *  realtime; a DM publish takes effect on the player's next reload/nav. */
export function useShardCatalog(): ShardCatalogState {
  const { session } = useAuth()
  const [catalog, setCatalog] = useState<Record<string, ShardTree>>({})
  const [loading, setLoading] = useState(true)

  const fetchAll = useCallback(async () => {
    if (!session) { setCatalog({}); setLoading(false); return }
    setLoading(true)
    const { data } = await supabase.from('shard_tree_catalog').select('*')
    const map: Record<string, ShardTree> = {}
    for (const row of (data as ShardTreeCatalogRow[] | null) ?? []) map[row.id] = row.data
    setCatalog(map)
    setLoading(false)
  }, [session])

  useEffect(() => { void fetchAll() }, [fetchAll])

  return { catalog, loading, refetch: fetchAll }
}
