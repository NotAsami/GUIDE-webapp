import type { EffectDuration, EffectFlag, EffectFlagMode, EffectKind, FeatureCategory, ItemCategory, ItemRarity, ItemSlot, WeaponAbility } from '../lib/database.types'
import { SKILLS } from '../lib/dnd'
import { ITEM_SLOTS } from '../lib/equip'
import { leafOf } from '../lib/folders'
import type { Mod } from '../lib/modEditor'
export const CAT_ORDER: ItemCategory[] = [
  'weapon', 'ammo', 'armor', 'consumable', 'tool', 'quest', 'misc',
]
export const CAT_DEF: Record<ItemCategory, { label: string; corner: string }> = {
  weapon: { label: 'Weapon', corner: 'fa-gavel' },
  ammo: { label: 'Ammunition', corner: 'fa-location-arrow' },
  armor: { label: 'Armor', corner: 'fa-shield-halved' },
  consumable: { label: 'Consumable', corner: 'fa-flask' },
  tool: { label: 'Tool', corner: 'fa-screwdriver-wrench' },
  quest: { label: 'Quest', corner: 'fa-scroll' },
  misc: { label: 'Misc', corner: 'fa-box' },
}
/** Categories that occupy a worn gear slot, and so get the Equip Slot picker.
 *  In the expanded taxonomy that is `armor` alone — weapons go to hands and
 *  containers to the carry sidebar, so neither needs a slot. */
export const isSlotted = (c: ItemCategory) => c === 'armor'

export const RAR_ORDER: ItemRarity[] = ['common', 'uncommon', 'rare', 'legendary']
export const RAR_DEF: Record<ItemRarity, { label: string; token: string }> = {
  common: { label: 'Common', token: 'var(--rar-common)' },
  uncommon: { label: 'Uncommon', token: 'var(--rar-uncommon)' },
  rare: { label: 'Rare', token: 'var(--rar-rare)' },
  'very-rare': { label: 'Very Rare', token: 'var(--rar-vrare)' },
  legendary: { label: 'Legendary', token: 'var(--rar-legend)' },
  artifact: { label: 'Artifact', token: 'var(--rar-artifact)' },
}
export const GEAR_SLOTS: readonly ItemSlot[] = ITEM_SLOTS
/** Ring I and Ring II are mechanically identical (lib/equip.ts isRingSlot) —
 *  the catalog offers ONE "Ring" choice rather than making the DM pre-commit
 *  an item to a specific finger. Equip-time resolution picks whichever ring
 *  slot is actually free. */
export const SLOT_OPTIONS: readonly ItemSlot[] = GEAR_SLOTS.filter(s => s !== 'ring2')
export const SLOT_LABEL: Record<ItemSlot, string> = {
  helmet: 'Helmet', armor: 'Armor', cloak: 'Cloak', boots: 'Boots',
  gloves: 'Gloves', neck: 'Neck', ring1: 'Ring', ring2: 'Ring',
}
export const WEAPON_ABILITIES: WeaponAbility[] = ['str', 'dex', 'finesse']
export const rarColor = (r?: ItemRarity) => RAR_DEF[r ?? 'common']?.token ?? 'var(--muted)'
export const catDef = (c?: ItemCategory) => CAT_DEF[c ?? 'misc'] ?? CAT_DEF.misc


export const EFFECT_KIND_ORDER: EffectKind[] = ['buff', 'debuff', 'condition']
/** Colour deviates from the mockup (which ties debuff AND condition to the
 *  same red) to match the vocabulary the rest of the app already uses for
 *  ActiveEffect.kind — "cyan buff, amber condition, red debuff"
 *  (database.types.ts) — and the roster chips already fixed to that scheme. */
export const EFFECT_KINDS: Record<EffectKind, { label: string; icon: string; color: string }> = {
  buff: { label: 'Buff', icon: 'fa-arrow-up-right-dots', color: 'var(--cyan)' },
  debuff: { label: 'Debuff', icon: 'fa-arrow-down-short-wide', color: 'var(--danger)' },
  condition: { label: 'Condition', icon: 'fa-triangle-exclamation', color: 'var(--amber)' },
}
export const EF_FLAG_ORDER: EffectFlagMode[] = ['advantage', 'disadvantage', 'resistance', 'vulnerability', 'immunity']
export const EF_FLAG_MODES: Record<EffectFlagMode, { label: string; short: string; on: 'roll' | 'dmg' }> = {
  advantage: { label: 'Advantage on', short: 'advantage', on: 'roll' },
  disadvantage: { label: 'Disadvantage on', short: 'disadvantage', on: 'roll' },
  resistance: { label: 'Resistance to', short: 'resistance', on: 'dmg' },
  vulnerability: { label: 'Vulnerability to', short: 'vulnerability', on: 'dmg' },
  immunity: { label: 'Immunity to', short: 'immunity', on: 'dmg' },
}
export const EF_ROLL_TARGETS = [
  'all saves', 'STR saves', 'DEX saves', 'CON saves', 'INT saves', 'WIS saves', 'CHA saves',
  'saves vs poison', 'saves vs charm', 'saves vs fear',
  'attack rolls', 'melee attacks', 'ranged attacks', 'spell attacks', 'ability checks',
  'Stealth checks', 'Perception checks', 'Athletics checks', 'initiative', 'death saves', 'concentration checks',
]
export const EF_DMG_TYPES = [
  'acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic',
  'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder', 'all damage',
]
/** Durations offered wherever an effect is APPLIED (never on the definition). */
export const EF_DURATIONS: EffectDuration[] = ['Rounds', 'Minutes', 'Hours', 'Until rest', 'Permanent while equipped']
export const EF_TICKING: EffectDuration[] = ['Rounds']
export const EF_COUNTED: EffectDuration[] = ['Rounds', 'Minutes', 'Hours']
export const clipTx = (s: string, n: number) => {
  const t = (s ?? '').trim()
  return t.length > n ? `${t.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : t
}
/** `+2 AC` for a flat bonus, `STR = 21` for a set-to floor. */
export const modText = (m: Mod) => (m.set ? `${m.stat} = ${m.amt}` : `${m.amt < 0 ? '−' : '+'}${Math.abs(m.amt)} ${m.stat}`)
export const flagText = (f: EffectFlag) => `${EF_FLAG_MODES[f.mode].short} ${f.target || '—'}`
/** Mods then flags, as short human strings — used everywhere an effect is
 *  summarised: the index row, the preview strip, an item's reference row. */
/** One effect, summarised as chips — used by the Apply Effect list, the item
 *  form's Effects Granted rows, and its picker.
 *
 *  Skill proficiency is included because without it an effect whose ONLY content
 *  is "proficient in Stealth" summarised as nothing at all, in all three places:
 *  you would attach it to an item and the row would sit there blank, which reads
 *  as "this effect does nothing". */
export const SKILL_NAME: Record<string, string> = Object.fromEntries(SKILLS.map(sk => [sk.key, sk.name]))
export const effectParts = (e: { mods: Mod[]; flags: EffectFlag[]; skillProficiencies?: string[]; skillExpertise?: string[] }) => [
  ...e.mods.map(modText),
  ...e.flags.map(flagText),
  ...(e.skillProficiencies ?? [])
    .filter(k => !(e.skillExpertise ?? []).includes(k))
    .map(k => `Prof: ${SKILL_NAME[k] ?? k}`),
  ...(e.skillExpertise ?? []).map(k => `Expertise: ${SKILL_NAME[k] ?? k}`),
]



export const FEAT_CATS: { key: FeatureCategory; label: string }[] = [
  { key: 'class', label: 'Class' },
  { key: 'feat', label: 'Feat' },
  { key: 'racial', label: 'Racial' },
  { key: 'background', label: 'Background' },
  { key: 'sense', label: 'Sense' },
  { key: 'other', label: 'Other' },
]
export function featureOrigin(d?: { folder?: string; source?: string; category?: string } | null): string {
  if (d?.folder) return leafOf(d.folder)
  return d?.source ?? FEAT_CATS.find(c => c.key === d?.category)?.label ?? 'Feature'
}
