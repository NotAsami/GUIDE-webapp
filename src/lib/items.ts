/**
 * Item presentation vocabulary — the category taxonomy as the UI shows it.
 *
 * Lives here rather than on the Inventory screen because the popup, the tooltip,
 * the container lists and (later) the DM console all need the same labels, and
 * importing them from the screen made Inventory <-> InventoryPopup a circular
 * import. It happened to work — both are only read during render — but a cycle
 * that resolves by luck is a bug waiting for a bundler change.
 */

import type { ItemCategory, ItemRarity } from './database.types'

/** Corner glyph per category — the at-a-glance "what kind of thing is this". */
export const CAT_CORNER: Record<ItemCategory, string> = {
  weapon: 'fa-khanda',
  ammo: 'fa-location-arrow',
  armor: 'fa-shield-halved',
  consumable: 'fa-flask-vial',
  tool: 'fa-screwdriver-wrench',
  quest: 'fa-scroll',
  misc: 'fa-circle-dot',
}

export const CAT_LABEL: Record<ItemCategory, string> = {
  weapon: 'Weapon',
  ammo: 'Ammunition',
  armor: 'Armor',
  consumable: 'Consumable',
  tool: 'Tool',
  quest: 'Quest',
  misc: 'Misc',
}

/** Display + filter-chip order. Weapons and ammunition lead because that's what
 *  gets looked for mid-combat; misc is the junk drawer and sorts last. */
export const CAT_ORDER: ItemCategory[] = [
  'weapon', 'ammo', 'armor', 'consumable', 'tool', 'quest', 'misc',
]

/** `very-rare` is hyphenated on the wire (it is an Open5e key and a CSS token
 *  suffix) and two words on screen. Capitalising the first letter alone gave
 *  "Very-rare", so the exceptions are spelled out rather than derived. */
const RARITY_LABEL: Partial<Record<ItemRarity, string>> = { 'very-rare': 'Very Rare' }

export function rarityLabel(r: ItemRarity): string {
  return RARITY_LABEL[r] ?? r.charAt(0).toUpperCase() + r.slice(1)
}

/** Ascending, the order a shelf sorts in. One list, so a new tier cannot be
 *  added to the type without a sort position. */
export const RARITY_ORDER: ItemRarity[] = [
  'common', 'uncommon', 'rare', 'very-rare', 'legendary', 'artifact',
]
