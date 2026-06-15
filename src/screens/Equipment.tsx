import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import type {
  ActiveEffect, CharacterRow, CharacterSection, CharacterSheet, EquippedItem,
  EquippedWeapon, InventoryItem, ItemRarity, ItemSlot, Json, WeaponHand,
} from '../lib/database.types'
import { Nav } from '../components/Nav'
import { Deco } from '../components/Deco'
import { formatMod } from '../lib/dnd'
import { activeEffects, effectiveSheet, summarizeEffects } from '../lib/effects'
import {
  handLabel, rollWeaponAttack, weaponAttackBonus, weaponDamageString,
} from '../lib/weapons'
import { rollHeal } from '../lib/dice'
import { useRollLog } from '../lib/rolls'
import type { RollLine } from '../lib/rolls'
import styles from './Equipment.module.css'

interface RouteContext {
  character: CharacterRow
  updateSection: <K extends CharacterSection>(section: K, next: CharacterRow[K]) => Promise<void>
  updateSections: (patch: Partial<Pick<CharacterRow, CharacterSection>>) => Promise<void>
}

/** Equipment — a read-only loadout view of `equipped` (7 gear slots + weapons)
 *  alongside a quick stats mirror of `sheet`. Every value renders from the
 *  character row; empty slots show honest "unequipped" states (nothing is
 *  equipped yet, and there's no item catalog to pull from). No mutation this
 *  pass: editing HP stays in the Stat Panel; equipping needs Inventory first. */
export function Equipment() {
  const { character, updateSections } = useOutletContext<RouteContext>()
  const sheet = effectiveSheet(character)
  const gear = (character.equipped ?? {}) as EquippedGear
  const weapons = gear.weapons ?? []
  const inventory = (character.inventory as unknown as InventoryItem[]) ?? []
  const effects = activeEffects(character)
  const quickAccess = (gear.quickAccess ?? []) as (QuickItem | null)[]
  const { tooltip, bind } = useItemTooltip()
  const { addRoll } = useRollLog()

  /** Which gear slot's modal is open (null = none). */
  const [openSlot, setOpenSlot] = useState<ItemSlot | null>(null)
  /** Which hand's equipped-weapon manage modal is open (null = none). */
  const [manageWeapon, setManageWeapon] = useState<WeaponHand | null>(null)
  /** Which hand the weapon picker is equipping into (null = closed). */
  const [weaponPicker, setWeaponPicker] = useState<WeaponHand | null>(null)
  /** Which quick-access index's consumable "use" modal is open (null = none). */
  const [useSlot, setUseSlot] = useState<number | null>(null)
  /** Which empty quick-access index's "add consumable" picker is open (null = none). */
  const [quickPicker, setQuickPicker] = useState<number | null>(null)
  /** Whether the Active Effects sidebar is expanded. */
  const [effectsOpen, setEffectsOpen] = useState(false)

  // Close any open modal / the sidebar on Escape.
  const overlayOpen = openSlot !== null || manageWeapon !== null || weaponPicker !== null
    || useSlot !== null || quickPicker !== null || effectsOpen
  useEffect(() => {
    if (!overlayOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpenSlot(null); setManageWeapon(null); setWeaponPicker(null)
      setUseSlot(null); setQuickPicker(null); setEffectsOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [overlayOpen])

  /** Move an inventory item into a gear slot — single atomic write so the item
   *  is never in both places (or neither) on a partial failure. */
  async function equip(slot: ItemSlot, item: InventoryItem) {
    const { col: _col, row: _row, ...gearItem } = item
    const nextEquipped = { ...gear, [slot]: gearItem as EquippedItem }
    const nextInventory = inventory.filter(i => i.id !== item.id)
    setOpenSlot(null)
    await updateSections({
      equipped: nextEquipped as unknown as CharacterRow['equipped'],
      inventory: nextInventory as unknown as Json[],
    })
  }

  /** Move the equipped item in a slot back to the inventory (atomic). */
  async function unequip(slot: ItemSlot) {
    const item = gear[slot]
    if (!item) return
    const nextEquipped = { ...gear, [slot]: null }
    const nextInventory = [...inventory, item as InventoryItem]
    setOpenSlot(null)
    await updateSections({
      equipped: nextEquipped as unknown as CharacterRow['equipped'],
      inventory: nextInventory as unknown as Json[],
    })
  }

  /** Equip an inventory weapon into a specific hand. A weapon already in that hand
   *  is displaced back to the inventory so a hand never holds two — one item, one
   *  place. Atomic, like gear equip. */
  async function equipWeapon(item: InventoryItem, hand: WeaponHand) {
    const { col: _col, row: _row, ...rest } = item
    const weaponItem = { ...rest, category: 'weapon' as const, hand }
    const displaced = weapons.filter(w => w.hand === hand)
    const keptWeapons = weapons.filter(w => w.hand !== hand)
    const nextEquipped = { ...gear, weapons: [...keptWeapons, weaponItem] }
    const nextInventory = [
      ...inventory.filter(i => i.id !== item.id),
      ...displaced as unknown as InventoryItem[],
    ]
    setWeaponPicker(null)
    await updateSections({
      equipped: nextEquipped as unknown as CharacterRow['equipped'],
      inventory: nextInventory as unknown as Json[],
    })
  }

  /** Move the weapon in a given hand back to the inventory (atomic). */
  async function unequipWeapon(hand: WeaponHand) {
    const w = weapons.find(wp => wp.hand === hand)
    if (!w) return
    const nextEquipped = { ...gear, weapons: weapons.filter(wp => wp.hand !== hand) }
    const nextInventory = [...inventory, w as unknown as InventoryItem]
    setManageWeapon(null)
    await updateSections({
      equipped: nextEquipped as unknown as CharacterRow['equipped'],
      inventory: nextInventory as unknown as Json[],
    })
  }

  /** Roll a weapon's attack AND damage as one action, pushing the combined result
   *  to the shared roll log → the toast surfaces it (bottom-right, above .main so
   *  it stays visible — which is exactly why Attack lives on the card, not in a
   *  modal whose overlay would bury the toast). */
  function attack(weapon: EquippedWeapon) {
    const { attack: atk, damage } = rollWeaponAttack(weapon, sheet)
    addRoll({
      kind: 'weapon',
      title: weapon.name,
      subtitle: `${handLabel(weapon.hand)} · Attack`,
      icon: weapon.icon ?? 'fa-khanda',
      attack: atk,
      damage,
    })
  }

  /** Use a quick-access consumable: heal real HP and/or apply a temporary status
   *  effect, then spend one (removed at qty 0). One atomic write across sheet
   *  (HP) + resources (active effects) + equipped (the quick-access stack). The HP
   *  patch is built from `character.sheet` (base), NEVER the effective `sheet` —
   *  writing the layered scores back would corrupt canon. Modal closes before the
   *  toast fires so the toast (z120) isn't buried under the overlay (z300). */
  async function useConsumable(index: number) {
    const item = quickAccess[index]
    if (!item) return
    const base = character.sheet
    const cur = base.hp?.current ?? 0
    const max = base.hp?.max ?? 0
    const hasEffects = !!item.effects && Object.keys(item.effects).length > 0
    const canHeal = item.heal !== undefined && (max <= 0 || cur < max)

    // A pure healing potion at full HP would only waste a charge — block it.
    if (item.heal !== undefined && !hasEffects && !canHeal) {
      setUseSlot(null)
      addRoll({
        kind: 'custom', title: item.name, subtitle: 'Already at full HP',
        icon: item.icon ?? 'fa-flask', lines: [{ label: 'No effect', total: '—' }],
      })
      return
    }

    const lines: RollLine[] = []
    const patch: Partial<Pick<CharacterRow, CharacterSection>> = {}

    if (canHeal) {
      const { total, breakdown } = rollHeal(item.heal!)
      const next = max > 0 ? Math.min(max, cur + total) : cur + total
      patch.sheet = { ...base, hp: { ...(base.hp ?? { max }), current: next } }
      lines.push({ label: 'Healed', total: `+${next - cur}`, breakdown: `${breakdown} · HP ${cur} → ${next}`, tone: 'heal' })
    }

    if (hasEffects) {
      const eff: ActiveEffect = {
        id: crypto.randomUUID(), name: item.name, icon: item.icon,
        effects: item.effects!, source: item.name, note: item.duration, at: Date.now(),
      }
      patch.resources = {
        ...character.resources, activeEffects: [...effects, eff],
      } as unknown as CharacterRow['resources']
      lines.push({
        label: 'Status', total: summarizeEffects(item.effects!),
        breakdown: `${item.name}${item.duration ? ` · ${item.duration}` : ' · until rest'}`, tone: 'buff',
      })
    }

    const nextQty = (item.qty ?? 1) - 1
    const nextItem = nextQty > 0 ? { ...item, qty: nextQty } : null
    const nextQA = quickAccess.map((it, i) => (i === index ? nextItem : it))
    patch.equipped = { ...gear, quickAccess: nextQA } as unknown as CharacterRow['equipped']

    setUseSlot(null)
    await updateSections(patch)
    addRoll({
      kind: 'custom', title: item.name, subtitle: 'Consumable used',
      icon: item.icon ?? 'fa-flask',
      lines: lines.length ? lines : [{ label: 'Used', total: '✓' }],
    })
  }

  /** Manually end an active status effect (atomic). Rest will later clear all. */
  async function removeEffect(id: string) {
    await updateSections({
      resources: {
        ...character.resources, activeEffects: effects.filter(e => e.id !== id),
      } as unknown as CharacterRow['resources'],
    })
  }

  /** Move an inventory consumable into a quick-access sub-slot (atomic), like the
   *  gear/weapon equip flow — the item lives in exactly one place. */
  async function addQuickItem(item: InventoryItem, index: number) {
    const { col: _col, row: _row, ...rest } = item
    const nextQA: (QuickItem | null)[] = [quickAccess[0] ?? null, quickAccess[1] ?? null]
    nextQA[index] = rest as QuickItem
    const nextInventory = inventory.filter(i => i.id !== item.id)
    setQuickPicker(null)
    await updateSections({
      equipped: { ...gear, quickAccess: nextQA } as unknown as CharacterRow['equipped'],
      inventory: nextInventory as unknown as Json[],
    })
  }

  /** Move a quick-access consumable back to the inventory unused (atomic). */
  async function unequipQuick(index: number) {
    const item = quickAccess[index]
    if (!item) return
    const nextQA: (QuickItem | null)[] = [quickAccess[0] ?? null, quickAccess[1] ?? null]
    nextQA[index] = null
    const nextInventory = [...inventory, item as unknown as InventoryItem]
    setUseSlot(null)
    await updateSections({
      equipped: { ...gear, quickAccess: nextQA } as unknown as CharacterRow['equipped'],
      inventory: nextInventory as unknown as Json[],
    })
  }

  const meta = (
    <>
      <span className="dim">◇</span>
      <span>Section</span>
      <span className="acc">/ Equipment</span>
      <span className="dim">·</span>
      <span>Loadout 02</span>
      <span className="dim">·</span>
      <span>Slots <span className="acc">{equippedCount(gear)} / 7</span></span>
    </>
  )

  return (
    <>
      <Deco
        left={<><span className="acc">EQUIPMENT</span> &nbsp;//&nbsp; LOADOUT 02 &nbsp;//&nbsp; SYNC OK</>}
        right={<>Castella-08 &nbsp;//&nbsp; <span className="acc">SHARD: VACANT</span> &nbsp;//&nbsp; Loadout 02</>}
      />
      <Nav variant="dock" meta={meta} />

      <div className={styles.eq}>
        {/* ---------- LEFT: Weapons + Stats ---------- */}
        <section className={styles.col} aria-label="Weapons and stats">
          <ColHeader num="01" title="Weapons" meta="Loadout 02" />

          <div className={styles.weaponList}>
            {WEAPON_HANDS.map(({ hand, label }) => {
              const w = weapons.find(wp => wp.hand === hand) ?? null
              return w ? (
                <WeaponCard
                  key={hand} weapon={w} sheet={sheet} bind={bind}
                  onAttack={() => attack(w)} onManage={() => setManageWeapon(hand)}
                />
              ) : (
                <button
                  key={hand} className={styles.weaponSlotEmpty}
                  onClick={() => setWeaponPicker(hand)}
                  aria-label={`${label}: empty, click to equip`}
                >
                  {label} not equipped
                  <span className={styles.em}>Click to equip from inventory</span>
                </button>
              )
            })}
          </div>

          <div className={styles.statsPanel}>
            <div style={{ marginTop: 18 }}>
              <ColHeader num="02" title="Stats" meta="Quick View" />
            </div>
            <div className={styles.statList}>
              <StatLine label="HP" value={<>{sheet.hp?.current ?? '—'}<span className={styles.unit}>/ {sheet.hp?.max ?? '—'}</span></>} />
              <StatLine label="AC" value={sheet.ac ?? '—'} />
              <StatLine label="Speed" value={<>{sheet.speed ?? '—'}<span className={styles.unit}>ft</span></>} />
              <StatLine label="Init" value={formatMod(sheet.initiative ?? 0)} />
              <StatLine label="Prof" value={formatMod(sheet.proficiencyBonus ?? 0)} />
              <StatLine label="Hit Dice" value={sheet.hitDice ? `${sheet.hitDice.max}${sheet.hitDice.die}` : '—'} />
            </div>
          </div>

          <div className={styles.panelActions}>
            <ActionBtn to="/stat-panel" icon="fa-chart-simple" label="Stat Panel" />
            <ActionBtn to="/inventory" icon="fa-bag-shopping" label="Inventory" />
          </div>
        </section>

        {/* ---------- CENTER: Operator portrait ---------- */}
        <section className={styles.portraitCol} aria-label="Character portrait">
          <ColHeader num="03" title="Operator" meta="Signature // 0x4F1A" />
          <Portrait character={character} />
        </section>

        {/* ---------- RIGHT: Gear grid + shards + actions ---------- */}
        <section className={styles.col} aria-label="Gear slots">
          <ColHeader num="04" title="Gear" meta="6 slots" />
          <div className={styles.gearGrid}>
            {GEAR_SLOTS.map(s => (
              <GearSlot
                key={s.key} slot={s} item={gear[s.key] ?? null} bind={bind}
                onOpen={() => setOpenSlot(s.key)}
              />
            ))}
            <QuickAccessSlot
              items={quickAccess} bind={bind}
              onUse={i => setUseSlot(i)} onPick={i => setQuickPicker(i)}
            />
          </div>

          <ShardBar guideShard={gear.guideShard ?? null} bind={bind} />

          <div className={styles.panelActions}>
            <ActionBtn
              icon="fa-bolt" label="Effects" count={effects.length}
              active={effectsOpen} onClick={() => setEffectsOpen(o => !o)}
            />
            <ActionBtn icon="fa-medal" label="Features" soon />
          </div>
        </section>
      </div>

      {tooltip}

      {openSlot && (
        <EquipModal
          slot={GEAR_SLOTS.find(s => s.key === openSlot)!}
          item={gear[openSlot] ?? null}
          candidates={inventory.filter(i => i.slot === openSlot)}
          onEquip={item => void equip(openSlot, item)}
          onUnequip={() => void unequip(openSlot)}
          onClose={() => setOpenSlot(null)}
        />
      )}

      {manageWeapon !== null && weapons.find(w => w.hand === manageWeapon) && (
        <WeaponManageModal
          weapon={weapons.find(w => w.hand === manageWeapon)!}
          sheet={sheet}
          onUnequip={() => void unequipWeapon(manageWeapon)}
          onClose={() => setManageWeapon(null)}
        />
      )}

      {weaponPicker !== null && (
        <WeaponPickerModal
          hand={weaponPicker}
          candidates={inventory.filter(i => i.category === 'weapon')}
          onEquip={item => void equipWeapon(item, weaponPicker)}
          onClose={() => setWeaponPicker(null)}
        />
      )}

      {useSlot !== null && quickAccess[useSlot] && (
        <ConsumableModal
          item={quickAccess[useSlot]!}
          onUse={() => void useConsumable(useSlot)}
          onUnequip={() => void unequipQuick(useSlot)}
          onClose={() => setUseSlot(null)}
        />
      )}

      {quickPicker !== null && (
        <QuickPickerModal
          candidates={inventory.filter(i => i.category === 'consumable')}
          onPick={item => void addQuickItem(item, quickPicker)}
          onClose={() => setQuickPicker(null)}
        />
      )}

      {effectsOpen && (
        <div className={styles.sidebarScrim} onClick={() => setEffectsOpen(false)} aria-hidden="true" />
      )}
      <EffectsSidebar
        open={effectsOpen} effects={effects}
        onRemove={id => void removeEffect(id)} onClose={() => setEffectsOpen(false)}
      />
    </>
  )
}

/* ---------- equipped gear shape (local view onto `equipped`) ---------- */

/** A quick-access consumable (potion/scroll/usable). EquippedItem already carries
 *  qty + heal + effects + duration, so no extra fields are needed. */
type QuickItem = EquippedItem

type EquippedGear = {
  weapons?: EquippedWeapon[]
  quickAccess?: (QuickItem | null)[] | null
  guideShard?: EquippedItem | null
} & { [K in ItemSlot]?: EquippedItem | null }

type SlotConfig = { key: ItemSlot; label: string; icon: string; type: string }

const GEAR_SLOTS: SlotConfig[] = [
  { key: 'helmet',    label: 'Helmet',    icon: 'fa-helmet-safety', type: 'Head' },
  { key: 'armor',     label: 'Armor',     icon: 'fa-shield-halved', type: 'Body' },
  { key: 'cloak',     label: 'Cloak',     icon: 'fa-user-tie',      type: 'Back' },
  { key: 'boots',     label: 'Boots',     icon: 'fa-shoe-prints',   type: 'Feet' },
  { key: 'accessory', label: 'Accessory', icon: 'fa-ring',          type: 'Trinket' },
]

/** The two weapon hands rendered as fixed slots (mirrors the gear-slot model). */
const WEAPON_HANDS: { hand: WeaponHand; label: string }[] = [
  { hand: 'main', label: 'Main weapon' },
  { hand: 'off', label: 'Side weapon' },
]

function weaponHandLabel(hand: WeaponHand): string {
  return hand === 'main' ? 'Main Weapon' : 'Side Weapon'
}

function equippedCount(gear: EquippedGear): number {
  let n = 0
  for (const s of GEAR_SLOTS) if (gear[s.key]) n++
  if (gear.guideShard) n++
  if ((gear.quickAccess ?? []).some(Boolean)) n++
  return n
}

/* ---------- small chrome helpers ---------- */

function ColHeader({ num, title, meta }: { num: string; title: string; meta: string }) {
  return (
    <div className={styles.colHeader}>
      <span className={styles.chNum}>{num}</span>
      <span className={styles.chTitle}>{title}</span>
      <span className={styles.chMeta}>{meta}</span>
    </div>
  )
}

function StatLine({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className={styles.statLine}>
      <span className={styles.slLabel}>{label}</span>
      <span className={styles.slValue}>{value}</span>
    </div>
  )
}

/** Left-column action button. Renders a Link when `to` is set, else a <button>
 *  (used for the Effects sidebar toggle + the placeholder Features entry). */
function ActionBtn({ to, onClick, icon, label, active, count, soon }: {
  to?: string; onClick?: () => void; icon: string; label: string
  active?: boolean; count?: number; soon?: boolean
}) {
  const cls = `${styles.paBtn}${active ? ' ' + styles.paOn : ''}${soon ? ' ' + styles.paSoon : ''}`
  const inner = (
    <>
      <span className={styles.paFrame} />
      <span className={styles.paInner}>
        <i className={`fa-solid ${icon}`} /> {label}
        {soon ? <span className={styles.paTag}>Soon</span> : count ? <span className={styles.paCount}>{count}</span> : null}
      </span>
    </>
  )
  if (to) return <Link to={to} className={cls}>{inner}</Link>
  return (
    <button type="button" className={cls} onClick={onClick} disabled={soon && !onClick} aria-pressed={active}>
      {inner}
    </button>
  )
}

/* ---------- weapon card ---------- */

function WeaponCard({ weapon, sheet, bind, onAttack, onManage }: {
  weapon: EquippedWeapon; sheet: CharacterSheet; bind: Bind
  onAttack: () => void; onManage: () => void
}) {
  const rarity = weapon.rarity ?? 'common'
  const dmg = weaponDamageString(weapon, sheet)
  const tt: TooltipData = {
    name: weapon.name,
    sub: [rarityLabel(rarity), weapon.type].filter(Boolean).join(' · '),
    rows: weapon.rows ?? buildWeaponRows(weapon, sheet),
    flavor: weapon.flavor,
    attune: weapon.attune,
    rarity,
  }
  // Outer card is a role=button (opens the manage modal); the Attack button is a
  // real nested <button> that stops propagation so rolling doesn't also "manage".
  return (
    <div
      className={`${styles.weaponCard} ${styles.clickable}`} data-rarity={rarity}
      {...bind(tt)} role="button" tabIndex={0}
      onClick={onManage}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onManage() } }}
      aria-label={`${weapon.name} — manage`}
    >
      <div className={styles.wcFrame}><div className={styles.wcInner}>
        <div className={styles.wcIcon}>
          <i className={`fa-solid ${weapon.icon ?? 'fa-khanda'}`} style={weapon.flip ? { transform: 'scaleX(-1)' } : undefined} />
        </div>
        <div className={styles.wcName}>{weapon.name}</div>
        <div className={styles.wcDmg}><span className={styles.v}>{dmg}</span>{weapon.type ? <> · {weapon.type}</> : null}</div>
        <div className={styles.wcSlot}>
          <span className={styles.label}>{handLabel(weapon.hand)}</span>
          <button
            className={styles.wcAttack}
            onClick={e => { e.stopPropagation(); onAttack() }}
            aria-label={`Roll attack with ${weapon.name}`}
          >
            <i className="fa-solid fa-dice-d20" /> Attack
          </button>
        </div>
      </div></div>
    </div>
  )
}

function buildWeaponRows(w: EquippedWeapon, sheet: CharacterSheet): [string, string][] {
  const rows: [string, string][] = []
  rows.push(['Attack', formatMod(weaponAttackBonus(w, sheet))])
  rows.push(['Damage', `${weaponDamageString(w, sheet)}${w.type ? ` ${w.type.toLowerCase()}` : ''}`])
  if (w.hand) rows.push(['Slot', handLabel(w.hand)])
  return rows
}

/* ---------- gear slots ---------- */

function slotRarity(item: EquippedItem | null): ItemRarity | 'empty' {
  return item ? (item.rarity ?? 'common') : 'empty'
}

function GearSlot({ slot, item, bind, onOpen }: {
  slot: SlotConfig; item: EquippedItem | null; bind: Bind; onOpen: () => void
}) {
  const rarity = slotRarity(item)
  const tt: TooltipData = item
    ? { name: item.name, sub: [rarityLabel(item.rarity ?? 'common'), slot.label].join(' · '), rows: item.rows ?? [['Type', slot.type]], flavor: item.flavor, attune: item.attune, rarity }
    : { name: slot.label, sub: 'Empty slot', rows: [['Status', 'Unequipped'], ['Type', slot.type]], rarity: 'empty' }
  return (
    <button
      className={`${styles.slot} ${styles.clickable}`} data-rarity={rarity}
      {...bind(tt)} onClick={onOpen}
      aria-label={item ? `${slot.label}: ${item.name}` : `${slot.label}: empty, click to equip`}
    >
      <span className={styles.sFrame} />
      <span className={styles.sInner}>
        <span className={styles.sLabel}>{slot.label}</span>
        <span className={styles.sIcon}><i className={`fa-solid ${item?.icon ?? slot.icon}`} /></span>
        <span className={styles.sName}>{item ? item.name : '— Empty —'}</span>
      </span>
      <span className={styles.rarityDot} />
    </button>
  )
}

function QuickAccessSlot({ items, bind, onUse, onPick }: {
  items: (QuickItem | null)[] | null; bind: Bind
  onUse: (index: number) => void; onPick: (index: number) => void
}) {
  const subs = [items?.[0] ?? null, items?.[1] ?? null]
  const tt: TooltipData = {
    name: 'Quick Access',
    sub: '2 sub-slots',
    rows: [
      ['Slot 1', subs[0] ? `${subs[0].name}${subs[0].qty ? ` × ${subs[0].qty}` : ''}` : 'Empty'],
      ['Slot 2', subs[1] ? `${subs[1].name}${subs[1].qty ? ` × ${subs[1].qty}` : ''}` : 'Empty'],
    ],
    flavor: 'Hot-keyed pouch. Filled slots are usable — click to use.',
    rarity: 'common',
  }
  return (
    <div className={`${styles.slot} ${styles.quick}`} data-rarity="common" {...bind(tt)} tabIndex={0}>
      <span className={styles.sFrame} />
      <span className={styles.sInner}>
        <span className={styles.sLabel}>Quick Access</span>
        <div className={styles.quickSubs}>
          {subs.map((it, i) => (
            it ? (
              <button
                key={i} className={`${styles.qsub} ${styles.usable}`}
                onClick={() => onUse(i)}
                aria-label={`Use ${it.name}${it.qty && it.qty > 1 ? ` (× ${it.qty})` : ''}`}
              >
                <i className={`fa-solid ${it.icon ?? 'fa-flask'}`} />
                {it.qty && it.qty > 1 && <span className={styles.qBadge}>{it.qty}</span>}
              </button>
            ) : (
              <button
                key={i} className={`${styles.qsub} ${styles.empty} ${styles.usable}`}
                onClick={() => onPick(i)} aria-label="Add a consumable"
              >
                <i className="fa-solid fa-plus" />
              </button>
            )
          ))}
        </div>
      </span>
      <span className={styles.rarityDot} />
    </div>
  )
}

/** The shard bar — a wide row spanning the gear grid, split by dividers into 3
 *  shard sub-slots (slot 0 = the G.U.I.D.E. shard, 2 more open slots). It's a
 *  launcher: every part links to the Shard menu (install/remove happens there),
 *  so empty slots show a "+" and filled ones show the shard's icon. */
function ShardBar({ guideShard, bind }: { guideShard: EquippedItem | null; bind: Bind }) {
  const slots: { item: EquippedItem | null; label: string; locked?: boolean }[] = [
    { item: guideShard, label: 'G.U.I.D.E.', locked: true },
    { item: null, label: 'Shard Slot' },
    { item: null, label: 'Shard Slot' },
  ]
  return (
    <div className={`${styles.slot} ${styles.special} ${styles.shardBar}`}>
      <span className={styles.sFrame} />
      <span className={styles.sInner}>
        <span className={styles.shardLabel}>Shards <Link to="/shard" className={styles.shardLink}>open menu →</Link></span>
        <div className={styles.shardSubs}>
          {slots.map((s, i) => {
            const filled = !!s.item || s.locked
            const tt: TooltipData = s.item
              ? { name: s.item.name, sub: [rarityLabel(s.item.rarity ?? 'common'), 'Codex Module'].join(' · '), rows: s.item.rows ?? [['Type', 'Shard slot']], flavor: s.item.flavor, attune: s.item.attune ?? 'Shard-bound', rarity: s.item.rarity ?? 'common' }
              : s.locked
                ? { name: 'G.U.I.D.E. Shard', sub: 'Core Module · Locked', rows: [['Status', 'Soulbound'], ['Type', 'Shard slot']], flavor: 'The core interface shard. Manage it in the Shard menu.', attune: 'Shard-bound', rarity: 'common' }
                : { name: 'Shard Slot', sub: 'Vacant', rows: [['Status', 'No shard installed']], flavor: 'Install a shard from the Shard menu.', rarity: 'empty' }
            return (
              <Link
                key={i} to="/shard"
                className={`${styles.shardSub}${filled ? '' : ' ' + styles.empty}`}
                {...bind(tt)} aria-label={s.item ? s.item.name : s.locked ? 'G.U.I.D.E. shard' : 'Empty shard slot'}
              >
                <i className={`fa-solid ${s.item?.icon ?? (s.locked ? 'fa-gem' : 'fa-plus')}`} />
                <span className={styles.shardSubLabel}>{s.item ? s.item.name : s.locked ? s.label : 'Empty'}</span>
              </Link>
            )
          })}
        </div>
      </span>
    </div>
  )
}

/* ---------- equip / unequip modal ---------- */

function EquipModal({ slot, item, candidates, onEquip, onUnequip, onClose }: {
  slot: SlotConfig
  item: EquippedItem | null
  candidates: InventoryItem[]
  onEquip: (item: InventoryItem) => void
  onUnequip: () => void
  onClose: () => void
}) {
  const rarity = slotRarity(item)
  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div
        className={styles.modal} role="dialog" aria-modal="true"
        aria-label={item ? item.name : `Equip ${slot.label}`}
        onClick={e => e.stopPropagation()}
      >
        <span className={styles.modalFrame} data-rarity={rarity} />
        <div className={styles.modalInner}>
          <header className={styles.modalHead}>
            <span className={styles.mhIcon}><i className={`fa-solid ${item?.icon ?? slot.icon}`} /></span>
            <div className={styles.mhTitles}>
              <span className={styles.mhKicker}>{item ? 'Equipped' : `Equip · ${slot.label}`}</span>
              <span className={styles.mhName}>{item ? item.name : slot.label}</span>
            </div>
            <button className={styles.modalClose} onClick={onClose} aria-label="Close">
              <i className="fa-solid fa-xmark" />
            </button>
          </header>

          <div className={styles.modalBody}>
            {item ? (
              <DetailBody item={item} slot={slot} />
            ) : (
              <SelectorBody slot={slot} candidates={candidates} onEquip={onEquip} />
            )}
          </div>

          {item && (
            <footer className={styles.modalFoot}>
              <button className={styles.unequipBtn} onClick={onUnequip}>
                <span className={styles.ubFrame} />
                <span className={styles.ubInner}><i className="fa-solid fa-circle-minus" /> Unequip</span>
              </button>
            </footer>
          )}
        </div>
      </div>
    </div>
  )
}

/** Full description of an equipped item (filled-slot modal). */
function DetailBody({ item, slot }: { item: EquippedItem; slot: SlotConfig }) {
  const rows = item.rows ?? [['Type', slot.type]]
  return (
    <>
      <div className={styles.detailSub}>{[rarityLabel(item.rarity ?? 'common'), slot.label].join(' · ')}</div>
      {rows.map(([k, v], i) => (
        <div key={i} className={styles.detailRow}><span className={styles.k}>{k}</span><span className={styles.v}>{v}</span></div>
      ))}
      {item.flavor && <div className={styles.detailFlavor}>{item.flavor}</div>}
      {item.attune && (
        <div className={`${styles.detailAttune}${/^not|^none/i.test(item.attune) ? ' ' + styles.no : ''}`}>Attuned: {item.attune}</div>
      )}
    </>
  )
}

/** Inventory picker for an empty slot. */
function SelectorBody({ slot, candidates, onEquip }: {
  slot: SlotConfig; candidates: InventoryItem[]; onEquip: (item: InventoryItem) => void
}) {
  if (candidates.length === 0) {
    return (
      <div className={styles.selectorEmpty}>
        No {slot.label.toLowerCase()} items in your inventory
        <span className={styles.em}>Items the DM grants you appear here</span>
      </div>
    )
  }
  return (
    <div className={styles.selectorList}>
      {candidates.map(it => (
        <div key={it.id ?? it.name} className={styles.pickRow} data-rarity={it.rarity ?? 'common'}>
          <span className={styles.pkIcon}><i className={`fa-solid ${it.icon ?? slot.icon}`} /></span>
          <span className={styles.pkBody}>
            <span className={styles.pkName}>{it.name}</span>
            <span className={styles.pkMeta}>{rarityLabel(it.rarity ?? 'common')}{it.qty && it.qty > 1 ? ` · × ${it.qty}` : ''}</span>
          </span>
          <button className={styles.pkBtn} onClick={() => onEquip(it)}>Equip</button>
        </div>
      ))}
    </div>
  )
}

/* ---------- weapon modals (manage / equip picker) ---------- */

/** Filled-weapon modal: detail + Unequip. Mirrors the gear detail modal.
 *  No Attack button here on purpose — rolling lives on the card so the toast
 *  (below this overlay in z-order) stays visible. */
function WeaponManageModal({ weapon, sheet, onUnequip, onClose }: {
  weapon: EquippedWeapon; sheet: CharacterSheet; onUnequip: () => void; onClose: () => void
}) {
  const rarity = weapon.rarity ?? 'common'
  const rows = weapon.rows ?? buildWeaponRows(weapon, sheet)
  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div
        className={styles.modal} role="dialog" aria-modal="true" aria-label={weapon.name}
        onClick={e => e.stopPropagation()}
      >
        <span className={styles.modalFrame} data-rarity={rarity} />
        <div className={styles.modalInner}>
          <header className={styles.modalHead}>
            <span className={styles.mhIcon}>
              <i className={`fa-solid ${weapon.icon ?? 'fa-khanda'}`} style={weapon.flip ? { transform: 'scaleX(-1)' } : undefined} />
            </span>
            <div className={styles.mhTitles}>
              <span className={styles.mhKicker}>Equipped · {handLabel(weapon.hand)}</span>
              <span className={styles.mhName}>{weapon.name}</span>
            </div>
            <button className={styles.modalClose} onClick={onClose} aria-label="Close">
              <i className="fa-solid fa-xmark" />
            </button>
          </header>

          <div className={styles.modalBody}>
            <div className={styles.detailSub}>{[rarityLabel(rarity), weapon.type].filter(Boolean).join(' · ')}</div>
            {rows.map(([k, v], i) => (
              <div key={i} className={styles.detailRow}><span className={styles.k}>{k}</span><span className={styles.v}>{v}</span></div>
            ))}
            {weapon.properties && weapon.properties.length > 0 && (
              <div className={styles.detailRow}>
                <span className={styles.k}>Properties</span>
                <span className={styles.v}>{weapon.properties.join(', ')}</span>
              </div>
            )}
            {weapon.flavor && <div className={styles.detailFlavor}>{weapon.flavor}</div>}
            {weapon.attune && (
              <div className={`${styles.detailAttune}${/^not|^none/i.test(weapon.attune) ? ' ' + styles.no : ''}`}>Attuned: {weapon.attune}</div>
            )}
          </div>

          <footer className={styles.modalFoot}>
            <button className={styles.unequipBtn} onClick={onUnequip}>
              <span className={styles.ubFrame} />
              <span className={styles.ubInner}><i className="fa-solid fa-circle-minus" /> Unequip</span>
            </button>
          </footer>
        </div>
      </div>
    </div>
  )
}

/** Equip-a-weapon picker for a specific hand: lists inventory weapons. Same
 *  one-tap flow as the gear selector. */
function WeaponPickerModal({ hand, candidates, onEquip, onClose }: {
  hand: WeaponHand; candidates: InventoryItem[]; onEquip: (item: InventoryItem) => void; onClose: () => void
}) {
  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div
        className={styles.modal} role="dialog" aria-modal="true"
        aria-label={`Equip ${weaponHandLabel(hand)}`}
        onClick={e => e.stopPropagation()}
      >
        <span className={styles.modalFrame} />
        <div className={styles.modalInner}>
          <header className={styles.modalHead}>
            <span className={styles.mhIcon}><i className="fa-solid fa-khanda" /></span>
            <div className={styles.mhTitles}>
              <span className={styles.mhKicker}>Equip · {weaponHandLabel(hand)}</span>
              <span className={styles.mhName}>Armory</span>
            </div>
            <button className={styles.modalClose} onClick={onClose} aria-label="Close">
              <i className="fa-solid fa-xmark" />
            </button>
          </header>

          <div className={styles.modalBody}>
            {candidates.length === 0 ? (
              <div className={styles.selectorEmpty}>
                No weapons in your inventory
                <span className={styles.em}>Weapons the DM grants you appear here</span>
              </div>
            ) : (
              <div className={styles.selectorList}>
                {candidates.map(it => (
                  <div key={it.id ?? it.name} className={styles.pickRow} data-rarity={it.rarity ?? 'common'}>
                    <span className={styles.pkIcon}><i className={`fa-solid ${it.icon ?? 'fa-khanda'}`} /></span>
                    <span className={styles.pkBody}>
                      <span className={styles.pkName}>{it.name}</span>
                      <span className={styles.pkMeta}>
                        {[rarityLabel(it.rarity ?? 'common'), it.damageDice ?? it.damage, it.type].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <button className={styles.pkBtn} onClick={() => onEquip(it)}>Equip</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---------- consumable use modal ---------- */

/** Detail + Use for a quick-access consumable. Use closes the modal first (the
 *  parent does the write + toast) so the toast isn't hidden under the overlay. */
function ConsumableModal({ item, onUse, onUnequip, onClose }: {
  item: QuickItem; onUse: () => void; onUnequip: () => void; onClose: () => void
}) {
  const rarity = item.rarity ?? 'common'
  const hasEffects = !!item.effects && Object.keys(item.effects).length > 0
  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div
        className={styles.modal} role="dialog" aria-modal="true" aria-label={item.name}
        onClick={e => e.stopPropagation()}
      >
        <span className={styles.modalFrame} data-rarity={rarity} />
        <div className={styles.modalInner}>
          <header className={styles.modalHead}>
            <span className={styles.mhIcon}><i className={`fa-solid ${item.icon ?? 'fa-flask'}`} /></span>
            <div className={styles.mhTitles}>
              <span className={styles.mhKicker}>Consumable{item.qty && item.qty > 1 ? ` · × ${item.qty}` : ''}</span>
              <span className={styles.mhName}>{item.name}</span>
            </div>
            <button className={styles.modalClose} onClick={onClose} aria-label="Close">
              <i className="fa-solid fa-xmark" />
            </button>
          </header>

          <div className={styles.modalBody}>
            <div className={styles.detailSub}>{rarityLabel(rarity)}</div>
            {item.heal !== undefined && (
              <div className={styles.detailRow}><span className={styles.k}>Restores</span><span className={styles.v}>{item.heal} HP</span></div>
            )}
            {hasEffects && (
              <div className={styles.detailRow}><span className={styles.k}>Effect</span><span className={styles.v}>{summarizeEffects(item.effects!)}</span></div>
            )}
            {item.duration && (
              <div className={styles.detailRow}><span className={styles.k}>Duration</span><span className={styles.v}>{item.duration}</span></div>
            )}
            {(item.rows ?? []).map(([k, v], i) => (
              <div key={i} className={styles.detailRow}><span className={styles.k}>{k}</span><span className={styles.v}>{v}</span></div>
            ))}
            {item.flavor && <div className={styles.detailFlavor}>{item.flavor}</div>}
          </div>

          <footer className={styles.modalFoot}>
            <div className={styles.modalActions}>
              <button className={styles.useBtn} onClick={onUse}>
                <span className={styles.ubFrame} />
                <span className={styles.ubInner}><i className="fa-solid fa-flask" /> Use</span>
              </button>
              <button className={styles.unequipBtn} onClick={onUnequip}>
                <span className={styles.ubFrame} />
                <span className={styles.ubInner}><i className="fa-solid fa-circle-minus" /> Unequip</span>
              </button>
            </div>
          </footer>
        </div>
      </div>
    </div>
  )
}

/* ---------- quick-access picker (add a consumable from inventory) ---------- */

function QuickPickerModal({ candidates, onPick, onClose }: {
  candidates: InventoryItem[]; onPick: (item: InventoryItem) => void; onClose: () => void
}) {
  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div
        className={styles.modal} role="dialog" aria-modal="true" aria-label="Add a consumable"
        onClick={e => e.stopPropagation()}
      >
        <span className={styles.modalFrame} />
        <div className={styles.modalInner}>
          <header className={styles.modalHead}>
            <span className={styles.mhIcon}><i className="fa-solid fa-flask" /></span>
            <div className={styles.mhTitles}>
              <span className={styles.mhKicker}>Quick Access</span>
              <span className={styles.mhName}>Consumables</span>
            </div>
            <button className={styles.modalClose} onClick={onClose} aria-label="Close">
              <i className="fa-solid fa-xmark" />
            </button>
          </header>

          <div className={styles.modalBody}>
            {candidates.length === 0 ? (
              <div className={styles.selectorEmpty}>
                No consumables in your inventory
                <span className={styles.em}>Potions and scrolls the DM grants you appear here</span>
              </div>
            ) : (
              <div className={styles.selectorList}>
                {candidates.map(it => (
                  <div key={it.id ?? it.name} className={styles.pickRow} data-rarity={it.rarity ?? 'common'}>
                    <span className={styles.pkIcon}><i className={`fa-solid ${it.icon ?? 'fa-flask'}`} /></span>
                    <span className={styles.pkBody}>
                      <span className={styles.pkName}>{it.name}</span>
                      <span className={styles.pkMeta}>
                        {[rarityLabel(it.rarity ?? 'common'), it.qty && it.qty > 1 ? `× ${it.qty}` : null].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <button className={styles.pkBtn} onClick={() => onPick(it)}>Add</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---------- active effects sidebar (slides over the gear column) ---------- */

function EffectsSidebar({ open, effects, onRemove, onClose }: {
  open: boolean; effects: ActiveEffect[]; onRemove: (id: string) => void; onClose: () => void
}) {
  return (
    <aside className={`${styles.sidebar}${open ? ' ' + styles.open : ''}`} aria-hidden={!open}>
      <div className={styles.sidebarFrame} />
      <div className={styles.sidebarInner}>
        <header className={styles.sidebarHead}>
          <div className={styles.shTitles}>
            <span className={styles.shKicker}>Status</span>
            <span className={styles.shName}>Active Effects</span>
          </div>
          <button className={styles.modalClose} onClick={onClose} aria-label="Close effects">
            <i className="fa-solid fa-xmark" />
          </button>
        </header>

        <div className={styles.sidebarBody}>
          {effects.length === 0 ? (
            <div className={styles.selectorEmpty}>
              No active effects
              <span className={styles.em}>Drink a potion or apply a buff to see it here</span>
            </div>
          ) : (
            effects.map(e => (
              <div key={e.id} className={styles.statusChip}>
                <span className={styles.scIcon}><i className={`fa-solid ${e.icon ?? 'fa-wand-sparkles'}`} /></span>
                <span className={styles.scBody}>
                  <span className={styles.scName}>{e.name}</span>
                  <span className={styles.scMeta}>{summarizeEffects(e.effects)}{e.note ? ` · ${e.note}` : ''}</span>
                </span>
                <button className={styles.scRemove} onClick={() => onRemove(e.id)} aria-label={`End ${e.name}`}>
                  <i className="fa-solid fa-xmark" />
                </button>
              </div>
            ))
          )}
        </div>

        <footer className={styles.sidebarFoot}>Effects clear on a rest, or end one early with ✕.</footer>
      </div>
    </aside>
  )
}

/* ---------- portrait (cosmetic handshake feed — no portrait asset yet) ---------- */

function Portrait({ character }: { character: CharacterRow }) {
  const id = character.identity ?? {}
  const idLine = [id.race, id.class].filter(Boolean).join('.').toUpperCase() || '—'
  const tagParts = [id.race, id.class, id.level ? `Level ${id.level}` : null].filter(Boolean)
  const archParts = [id.archetype, id.background].filter(Boolean)
  // Show the image only if a URL is set and it actually loads; otherwise fall
  // back to the handshake "PORTRAIT_FEED" panel so the layout is identical.
  const [imgFailed, setImgFailed] = useState(false)
  useEffect(() => { setImgFailed(false) }, [id.portrait])
  const showImage = !!id.portrait && !imgFailed
  return (
    <>
      <div className={styles.portraitWrap}>
        <div className={styles.portrait} tabIndex={0}>
          <div className={styles.pFrame} />
          <div className={styles.pInner}>
            <span className={`${styles.pCorner} ${styles.tl}`} />
            <span className={`${styles.pCorner} ${styles.tr}`} />
            <span className={`${styles.pCorner} ${styles.bl}`} />
            <span className={`${styles.pCorner} ${styles.br}`} />

            {showImage ? (
              <img
                className={styles.pImg}
                src={id.portrait ?? undefined}
                alt={character.name}
                onError={() => setImgFailed(true)}
              />
            ) : (
              <>
                <div className={styles.pfFeed}>
                  <span className={styles.dim}>PORTRAIT_FEED</span><br />
                  AWAITING SIGNAL
                  <span className={styles.strong}>Loading {character.name.toUpperCase().replace(/\s+/g, '.')}</span>
                  <span className={styles.metaLine}><span className={styles.k}>Identity</span> :: {idLine}</span>
                  <span className={styles.metaLine}><span className={styles.k}>Origin</span> :: CASTELLA-08</span>
                </div>

                <Loader />
              </>
            )}
          </div>
        </div>
      </div>

      <div className={styles.charInfo}>
        <div className={styles.ciName}>{character.name}</div>
        {tagParts.length > 0 && (
          <div className={styles.ciTagline}>
            {tagParts.map((p, i) => (
              <span key={i}>{i > 0 && <span className={styles.sep}>·</span>} {p}</span>
            ))}
          </div>
        )}
        {archParts.length > 0 && (
          <div className={styles.ciArch}>
            {archParts.map((p, i) => (
              <span key={i}>{i > 0 && <span className={styles.sep}>/</span>} {p}</span>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

/** Looping handshake percentage, synced loosely to the bar's 6s CSS animation. */
function Loader() {
  const [pct, setPct] = useState(0)
  useLayoutEffect(() => {
    const start = performance.now()
    const dur = 6000
    let raf = 0
    const frame = (now: number) => {
      const t = ((now - start) % dur) / dur
      setPct(t < 0.85 ? Math.round((t / 0.85) * 100) : t < 0.92 ? 100 : 0)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])
  return (
    <div className={styles.loader}>
      <div className={styles.barWrap}><div className={styles.barFill} /></div>
      <div className={styles.pctTxt}>{pct}%  ·  HANDSHAKE</div>
    </div>
  )
}

/* ---------- tooltip (ported positioning from the mockup) ---------- */

type TooltipData = {
  name: string
  sub?: string
  rows?: [string, string][]
  flavor?: string
  attune?: string
  rarity?: ItemRarity | 'empty'
}
type Bind = (data: TooltipData) => {
  onMouseEnter: () => void
  onMouseLeave: () => void
  onFocus: () => void
  onBlur: () => void
}

function rarityLabel(r: ItemRarity | 'empty'): string {
  return r.charAt(0).toUpperCase() + r.slice(1)
}

/** Shared hover/focus tooltip. Renders a single fixed element positioned to the
 *  right of the anchor (flips left when it would overflow), vertically centred
 *  and clamped to the viewport — same logic as the mockup's vanilla JS. */
function useItemTooltip() {
  const [data, setData] = useState<TooltipData | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const anchorRef = useRef<DOMRect | null>(null)
  const ttRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!data || !anchorRef.current || !ttRef.current) return
    const r = anchorRef.current
    const { offsetWidth: w, offsetHeight: h } = ttRef.current
    const margin = 12
    let left = r.right + margin
    if (left + w > window.innerWidth - 12) left = r.left - w - margin
    left = Math.max(12, Math.min(left, window.innerWidth - w - 12))
    // Keep the tooltip clear of the fixed top/bottom bars: it lives inside
    // .main's z-index:10 stacking context, so it can't paint over the bottombar
    // (z-index:50) — clamp it into the band between the bars instead.
    const cs = getComputedStyle(document.documentElement)
    const barTop = parseInt(cs.getPropertyValue('--bar-top-h')) || 62
    const barBottom = parseInt(cs.getPropertyValue('--bar-bottom-h')) || 50
    let top = r.top + r.height / 2 - h / 2
    top = Math.max(barTop + margin, Math.min(top, window.innerHeight - barBottom - h - margin))
    setPos({ left, top })
  }, [data])

  const bind = useCallback<Bind>(d => {
    const show = (e: { currentTarget: Element }) => {
      anchorRef.current = e.currentTarget.getBoundingClientRect()
      setPos(null)
      setData(d)
    }
    return {
      onMouseEnter: show as unknown as () => void,
      onMouseLeave: () => setData(null),
      onFocus: show as unknown as () => void,
      onBlur: () => setData(null),
    }
  }, [])

  const tooltip = (
    <div
      ref={ttRef}
      className={`${styles.tt}${data && pos ? ' ' + styles.show : ''}`}
      data-rarity={data?.rarity ?? 'common'}
      role="tooltip"
      aria-hidden={!data}
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
    >
      {data && (
        <>
          <div className={styles.ttName}>{data.name}</div>
          {data.sub && <div className={styles.ttSub}>{data.sub}</div>}
          {(data.rows ?? []).map(([k, v], i) => (
            <div key={i} className={styles.ttRow}><span className={styles.k}>{k}</span><span className={styles.v}>{v}</span></div>
          ))}
          {data.flavor && <div className={styles.ttFlavor}>{data.flavor}</div>}
          {data.attune && (
            <div className={`${styles.ttAttune}${/^not|^none/i.test(data.attune) ? ' ' + styles.no : ''}`}>Attuned: {data.attune}</div>
          )}
        </>
      )}
    </div>
  )

  return { tooltip, bind }
}
