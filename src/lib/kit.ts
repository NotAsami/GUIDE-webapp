/**
 * The starting kit — a class's opening equipment, and the choices in it.
 *
 * 5e does not hand you a list, it hands you a set of decisions, and some of
 * those are open-ended: "(a) a martial weapon and a shield, or (b) two martial
 * weapons". So there are TWO kinds of question here:
 *
 *   OPTION — pick (a) or (b).
 *   POOL   — the option you picked says "a martial weapon"; pick which one.
 *
 * A pool is authored as a catalog QUERY (`tag:martial`) rather than a hand-
 * picked list, so tagging the martial weapons once serves every class.
 *
 * THE SNAPSHOT HAPPENS AT ASSIGN, and that is not a style preference. A class
 * authors item references and queries, but `item_catalog` has no player policy
 * at all (migration 0004) — a player selecting it gets zero rows. The one
 * screen that has to render this payload is the PLAYER's, so a parked query
 * would show them an empty pool. `snapshotKit` runs every reference and every
 * query while the DM (who can read the catalog) is the one acting, and parks
 * the result on the sheet. Same boundary every other grant crosses.
 *
 * A group with ONE option and nothing to pick inside it is not a question at
 * all: assign grants those items outright and parks only the real decisions.
 */
import { grantMany } from './placement.ts'
import { matchesCatalogQuery, parseCatalogQuery } from './catalogSearch.ts'
import { isEquipPick, isPendingPool } from './database.types.ts'
import type {
  CatalogItemData, ClassDef, EquipChoice, EquipEntry, EquippedGear, InventoryItem,
  PendingKit, PendingKitChoice, PendingKitEntry, PendingKitItem, PendingKitOption,
} from './database.types.ts'

export type KitSnapshot = {
  /** Items with no decision attached — granted at assign, never asked about. */
  fixed: PendingKitItem[]
  /** The real questions, parked for the player. Null when there are none. */
  kit: PendingKit | null
}

/**
 * `startingEquipment` was free prose before it was a list of choices, and rows
 * authored then still hold a string. These two read whichever shape is there
 * rather than trusting the type: JSONB does not migrate itself, and `.map` on a
 * string takes the whole editor down.
 */
export const kitChoices = (v: unknown): EquipChoice[] => (Array.isArray(v) ? (v as EquipChoice[]) : [])

/** The old prose, when that is what the row holds. Kept visible in the editor
 *  so re-authoring against the catalog is a transcription, not a memory test. */
export const legacyKitText = (v: unknown): string | null =>
  (typeof v === 'string' && v.trim() ? v : null)

/** The key a pool's answer is stored under. Position-based, because a pool has
 *  no id of its own — two "a martial weapon" entries in one option are two
 *  separate questions and must not collapse into one. */
export const poolKey = (choiceId: string, entry: number) => `${choiceId}.${entry}`

/** Items matching a DM's pool query. Capped: a query that matches the whole
 *  catalog is an authoring mistake, and parking hundreds of items on a sheet to
 *  render as buttons is not the way to report it — the editor shows the real
 *  match count so it gets caught before it ships. */
export const POOL_CAP = 60

export function resolvePool(
  from: string, itemData: Map<string, CatalogItemData>,
): PendingKitItem[] {
  const q = parseCatalogQuery(from)
  // `mode: 'all'` means the query was blank, which reads as "every item in the
  // game" — never what an author meant. Resolve it to nothing; the audit says so.
  if (q.mode === 'all') return []
  const out: PendingKitItem[] = []
  for (const [item_id, data] of itemData) {
    if (!matchesCatalogQuery(data, q)) continue
    out.push({ item_id, qty: 1, data })
    if (out.length >= POOL_CAP) break
  }
  return out
}

/** Resolve one authored option's entries. A reference to an item that no longer
 *  exists is DROPPED rather than carried as a hole; a pool matching nothing goes
 *  the same way. */
function resolveEntries(
  entries: EquipEntry[] | undefined,
  itemData: Map<string, CatalogItemData>,
): PendingKitEntry[] {
  const out: PendingKitEntry[] = []
  for (const e of entries ?? []) {
    if (isEquipPick(e)) {
      const pool = resolvePool(e.from, itemData)
      if (pool.length) out.push({ pick: Math.max(1, e.pick), label: e.label, pool })
      continue
    }
    const data = itemData.get(e.item_id)
    if (data) out.push({ item_id: e.item_id, qty: e.qty, data })
  }
  return out
}

/** Does this option hand everything over without asking anything further? */
const isSettled = (o: PendingKitOption) => !o.items.some(isPendingPool)

/** The plain items in an option — what arrives the moment it is chosen. Its
 *  pools arrive later, as each is answered. */
export const settledItems = (option: PendingKitOption): PendingKitItem[] =>
  option.items.filter(e => !isPendingPool(e)) as PendingKitItem[]

/**
 * Split a class's authored kit into what is granted outright and what the
 * player still has to answer.
 *
 * An option left with no entries after resolution is dropped, and a choice left
 * with no options goes with it — offering "(b)" and then handing over nothing
 * is worse than not offering it. The editor's audit flags this at author time;
 * this is the runtime half of the same rule.
 */
export function snapshotKit(
  classId: string,
  cls: ClassDef,
  itemData: Map<string, CatalogItemData>,
): KitSnapshot {
  const fixed: PendingKitItem[] = []
  const choices: PendingKitChoice[] = []

  for (const ch of kitChoices(cls.startingEquipment)) {
    const options: PendingKitOption[] = []
    for (const op of ch.options ?? []) {
      const items = resolveEntries(op.items, itemData)
      if (items.length) options.push({ id: op.id, label: op.label, items })
    }
    if (!options.length) continue
    // One option AND nothing to pick inside it — no question exists.
    if (options.length === 1 && isSettled(options[0])) fixed.push(...settledItems(options[0]))
    else choices.push({ id: ch.id, label: ch.label, options })
  }

  return {
    fixed,
    kit: choices.length ? { classId, className: cls.name, choices, picked: {}, picks: {} } : null,
  }
}

// ── what is still being asked ───────────────────────────────────────────────

export type KitQuestion =
  | { kind: 'option'; choiceId: string; label: string; options: PendingKitOption[] }
  | {
    kind: 'pool'; choiceId: string; entry: number; label: string
    count: number; pool: PendingKitItem[]; chosen: string[]
  }

/**
 * Every question the kit still has, in order.
 *
 * A choice contributes its OPTION question until that is answered, then a pool
 * question for each unfilled pool inside the option chosen. Asking "which
 * martial weapon" before "(a) or (b)" would be asking about a branch they may
 * not even take.
 */
export function openQuestions(kit: PendingKit | undefined | null): KitQuestion[] {
  if (!kit) return []
  const picked = kit.picked ?? {}
  const picks = kit.picks ?? {}
  const out: KitQuestion[] = []

  for (const ch of kit.choices) {
    const chosenId = picked[ch.id]
    if (!chosenId) {
      out.push({ kind: 'option', choiceId: ch.id, label: ch.label, options: ch.options })
      continue
    }
    const option = ch.options.find(o => o.id === chosenId)
    if (!option) continue
    option.items.forEach((e, i) => {
      if (!isPendingPool(e)) return
      const chosen = picks[poolKey(ch.id, i)] ?? []
      if (chosen.length >= e.pick) return
      out.push({
        kind: 'pool', choiceId: ch.id, entry: i,
        label: e.label || `Choose ${e.pick}`,
        count: e.pick, pool: e.pool, chosen,
      })
    })
  }
  return out
}

/** Nothing left to ask — the kit should come off the sheet entirely. A prompt
 *  that survives being answered is how a screen starts nagging. */
export const kitDone = (kit: PendingKit | undefined | null) => openQuestions(kit).length === 0

// ── granting ────────────────────────────────────────────────────────────────

/**
 * Route a set of kit items into an inventory.
 *
 * Routing is SEQUENTIAL, not a map: each item placed changes where the next one
 * can go, so the accumulating list has to be fed back in. `.map` would put two
 * items in the same cell. `grantMany`, not one instance per entry, because a
 * count means "five javelins" as well as "twenty arrows" and only one of those
 * is a stack — calling grantInstance once and handing it a qty granted a SINGLE
 * javelin, silently.
 */
export function grantKitItems(
  items: PendingKitItem[], gear: EquippedGear, inventory: InventoryItem[],
): InventoryItem[] {
  let next = [...inventory]
  for (const it of items) next = grantMany(it.data, it.item_id, it.qty, gear, next)
  return next
}

/** What a chosen option puts in the pack IMMEDIATELY — its plain items. Pools
 *  inside it arrive as each is answered. */
export const grantKitOption = (
  option: PendingKitOption, gear: EquippedGear, inventory: InventoryItem[],
): InventoryItem[] => grantKitItems(settledItems(option), gear, inventory)

/** A one-line summary of what an option hands over, for both the DM's preview
 *  and the player's button. One reader, so the two cannot describe it
 *  differently — and a pool reads as the question it is, not as a blank. */
export const kitEntriesText = (entries: PendingKitEntry[]): string =>
  entries
    .map(e => (isPendingPool(e)
      ? `${e.label || 'your choice'}${e.pick > 1 ? ` ×${e.pick}` : ''}`
      : `${e.data.name}${e.qty > 1 ? ` ×${e.qty}` : ''}`))
    .join(' · ')

/** The DM preview only ever holds plain items, but it reads through the same
 *  formatter so the two descriptions cannot drift. */
export const kitItemsText = (items: PendingKitItem[]): string => kitEntriesText(items)
