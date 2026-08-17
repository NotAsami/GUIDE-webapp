import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link, useOutletContext } from 'react-router-dom'
import type {
  CharacterRow, CharacterSection, CharacterSheet, ContainerKind,
  EquippedGear, EquippedItem, EquippedWeapon, Feature, InventoryItem, ItemRarity, ItemSlot,
  Json, ShardTree, WeaponHand,
} from '../lib/database.types'
import { Nav } from '../components/Nav'
import { Deco } from '../components/Deco'
import { formatMod } from '../lib/dnd'
import {
  attunedCount, attunementCap, consumesAttunement, containerContents,
  equipContainerPatch, equipGearPatch, equipWeaponPatch, getContainers, isRingSlot,
  stowedContainers, unequipContainerPatch, unequipGearPatch, unequipWeaponPatch,
} from '../lib/equip'
import { CarrySidebar } from './EquipmentCarry'
import { effectiveSheet } from '../lib/effects'
import {
  handLabel, isRanged, rollWeaponAttack, weaponAttackBonus, weaponDamageString,
  type AmmoBonus,
} from '../lib/weapons'
import { PERSON } from '../lib/placement'
import { useRollLog } from '../lib/rolls'
import { useItemTooltip, type Bind, type TooltipData } from '../components/ItemTooltip'
import { SHARD_SLOT_KEYS, shardSlots } from '../lib/shards'
import { useGraph } from '../lib/useGraph'
import { armedMatches, gid, resolve } from '../lib/graph'
import { armableFor } from '../lib/graphState'
import { useActivation } from '../components/ActivationSheet'
import styles from './Equipment.module.css'

interface RouteContext {
  character: CharacterRow
  updateSection: <K extends CharacterSection>(section: K, next: CharacterRow[K]) => Promise<void>
  updateSections: (patch: Partial<Pick<CharacterRow, CharacterSection>>) => Promise<void>
  shardTrees?: Record<string, ShardTree>
}

/** Equipment — a read-only loadout view of `equipped` (7 gear slots + weapons)
 *  alongside a quick stats mirror of `sheet`. Every value renders from the
 *  character row; empty slots show honest "unequipped" states (nothing is
 *  equipped yet, and there's no item catalog to pull from). No mutation this
 *  pass: editing HP stays in the Stat Panel; equipping needs Inventory first. */
export function Equipment() {
  const { character, updateSection, updateSections, shardTrees = {} } = useOutletContext<RouteContext>()
  // Built once per character, not per roll — see lib/useGraph.ts.
  const graph = useGraph(character, shardTrees)
  const sheet = effectiveSheet(character, shardTrees)
  const gear = (character.equipped ?? {}) as EquippedGear
  const weapons = gear.weapons ?? []
  const inventory = (character.inventory as unknown as InventoryItem[]) ?? []
  const { tooltip, bind } = useItemTooltip()
  const { addRoll } = useRollLog()

  /** Which gear slot's modal is open (null = none). */
  const [openSlot, setOpenSlot] = useState<ItemSlot | null>(null)
  /** Which hand's equipped-weapon manage modal is open (null = none). */
  const [manageWeapon, setManageWeapon] = useState<WeaponHand | null>(null)
  /** Which hand the weapon picker is equipping into (null = closed). */
  const [weaponPicker, setWeaponPicker] = useState<WeaponHand | null>(null)
  /** Which slide-over is open. Only Storage lives here now — Active Effects
   *  moved to the Stat Panel (docs/notes.md:68) — kept as a drawer slot
   *  rather than a plain boolean in case another gear-column slide-over
   *  joins it later. */
  const [drawer, setDrawer] = useState<'carry' | null>(null)
  const carryOpen = drawer === 'carry'

  /** Which ammunition stack is nocked. Deliberately NOT persisted: which arrow
   *  you are firing is a property of the attack, not state the character carries
   *  between sessions. */
  const [nocked, setNocked] = useState<string | null>(null)

  // Close any open modal / the sidebar on Escape.
  const overlayOpen = openSlot !== null || manageWeapon !== null || weaponPicker !== null
    || drawer !== null
  useEffect(() => {
    if (!overlayOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpenSlot(null); setManageWeapon(null); setWeaponPicker(null)
      setDrawer(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [overlayOpen])

  /** Move an inventory item into a gear slot — single atomic write so the item
   *  is never in both places (or neither) on a partial failure. The move math is
   *  shared with Inventory (lib/equip) so there's one owner of the operation —
   *  including the attunement cap check, enforced inside equipGearPatch itself
   *  so Inventory's one-tap equip can't bypass it. */
  async function equip(slot: ItemSlot, item: InventoryItem) {
    const p = equipGearPatch(item, slot, gear, inventory, character)
    if (!p) return
    setOpenSlot(null)
    await updateSections(p)
  }

  /** Move the equipped item in a slot back to the inventory (atomic). */
  async function unequip(slot: ItemSlot) {
    const p = unequipGearPatch(slot, gear, inventory)
    if (!p) return
    setOpenSlot(null)
    await updateSections(p)
  }

  /** Equip an inventory weapon into a specific hand. A weapon already in that hand
   *  is displaced back to the inventory so a hand never holds two — one item, one
   *  place. Atomic, like gear equip. */
  async function equipWeapon(item: InventoryItem, hand: WeaponHand) {
    setWeaponPicker(null)
    await updateSections(equipWeaponPatch(item, hand, gear, inventory))
  }

  /** Move the weapon in a given hand back to the inventory (atomic). */
  async function unequipWeapon(hand: WeaponHand) {
    const p = unequipWeaponPatch(hand, gear, inventory)
    if (!p) return
    setManageWeapon(null)
    await updateSections(p)
  }

  // Using a feature from the weapon card — the same press the Features screen
  // makes, so a use spent here spends exactly what it spends there.
  const activation = useActivation({ character, graph, shardTrees, updateSection, updateSections })

  /** Features that could arm something for this weapon's roll but have not been
   *  pressed yet. Offered ON the card, because arming is a pre-roll decision and
   *  making the player go find the feature puts it on another screen. */
  const armableOn = (w: EquippedWeapon) => {
    const subject = gid('weapon', w)
    const seen = new Map<string, Feature>()
    for (const kind of ['attack', 'damage'] as const) {
      for (const a of armableFor(character, graph, { kind, subject, tags: w.tags }, shardTrees)) {
        seen.set(a.source, a.feature)
      }
    }
    return [...seen.values()]
  }

  /** Armed modifiers that will land on this weapon's next roll. Asked with the
   *  SAME requests attack() will resolve with, so the chip cannot promise a
   *  bonus the roll then fails to apply — that is why armedMatches is exported
   *  rather than living inside resolve(). */
  const armedOn = (w: EquippedWeapon) => {
    const subject = gid('weapon', w)
    return graph.armed.filter(m =>
      armedMatches(m, { kind: 'attack', subject }) || armedMatches(m, { kind: 'damage', subject })).length
  }

  /** Roll a weapon's attack AND damage as one action, pushing the combined result
   *  to the shared roll log → the toast surfaces it (bottom-right, above .main so
   *  it stays visible — which is exactly why Attack lives on the card, not in a
   *  modal whose overlay would bury the toast). */
  function attack(weapon: EquippedWeapon) {
    // A bow with an empty quiver and empty pockets has nothing to loose. Refuse
    // rather than roll — the alternative silently produces a damage number the
    // player has no way to deliver.
    if (isRanged(weapon) && !activeAmmo) {
      addRoll({
        kind: 'custom', title: weapon.name, subtitle: 'No ammunition',
        icon: weapon.icon ?? 'fa-bullseye',
        lines: [{ label: 'Cannot fire', total: '—', breakdown: 'Nothing in the quiver or on person' }],
      })
      return
    }
    const stack = isRanged(weapon) ? activeAmmo : null

    // Two resolutions, because a feature can target one without the other:
    // "advantage on attacks with fire weapons" is not "+2 fire damage". The
    // subject and its tags are the same for both; only the roll kind differs.
    const subject = gid('weapon', weapon)
    const tags = weapon.tags
    // The sub NARROWS the kind: `roll:damage` still matches this, and
    // `roll:damage.melee` matches only a melee weapon — which is how "damage
    // dealt by a weapon, not a spell" gets said, with no new vocabulary beyond
    // the sub mechanism `roll:save.dex` already uses.
    //
    // Both rolls take it, and they are separate statements: "advantage on melee
    // attacks" is `roll:attack.melee`, "+2 melee damage" is `roll:damage.melee`.
    // The attack subs had sat in the editor's dropdown since slice 3 with
    // nothing passing one, so authoring `roll:attack.melee` matched nothing.
    const sub = isRanged(weapon) ? 'ranged' : 'melee'
    const atkRes = resolve(graph, { kind: 'attack', subject, sub, tags })
    const dmgRes = resolve(graph, { kind: 'damage', subject, sub, tags })

    // `riders` comes back ANNOTATED — each contribution carrying the faces it
    // rolled — so the panel shows "1d6 → +4" rather than a promise.
    const { attack: atk, damage, riders } = rollWeaponAttack(weapon, sheet, ammoBonusOf(stack), {
      attack: atkRes, damage: dmgRes,
    })
    addRoll({
      kind: 'weapon',
      title: weapon.name,
      subtitle: stack
        ? `${handLabel(weapon.hand)} · ${stack.name}`
        : `${handLabel(weapon.hand)} · Attack`,
      icon: weapon.icon ?? 'fa-khanda',
      // What the roll was ABOUT, so the panel can open its catalog entry.
      subject: weapon.id ? { kind: 'weapon' as const, id: weapon.id } : undefined,
      attack: atk,
      damage,
      // Grouped, not concatenated: a rider on the attack and one on the damage
      // are different statements, and a flat list cannot tell them apart.
      riderGroups: [
        { label: 'Attack', riders: riders.attack },
        { label: 'Damage', riders: riders.damage },
      ].filter(g => g.riders.length),
      // Notes and problems stay flat — a note is prose about the action and a
      // problem is an engine failure; neither needs attributing to a sub-roll.
      notes: [...atkRes.notes, ...dmgRes.notes],
      problems: [...atkRes.problems, ...dmgRes.problems],
    })
    // Firing spends a shaft. The count is derived from quiver contents, so this
    // is an ordinary inventory write — no separate ammo counter to drift.
    if (stack) void spendAmmo(stack)
  }

  /** Decrement (and remove at zero) the nocked ammunition stack. */
  async function spendAmmo(stack: InventoryItem) {
    const left = (stack.qty ?? 1) - 1
    const next = left > 0
      ? inventory.map(i => (i.id === stack.id ? { ...i, qty: left } : i))
      : inventory.filter(i => i.id !== stack.id)
    await updateSection('inventory', next as unknown as Json[])
  }

  /** Equip a carried container into its kind's slot. Its CONTENTS don't move —
   *  they point at the container's id either way — so the Inventory tab simply
   *  unlocks with everything already inside it. */
  async function equipContainer(item: InventoryItem) {
    const p = equipContainerPatch(item, gear, inventory)
    if (!p) return
    await updateSections(p)
  }

  /** Unequip a container. Contents travel with it: they stay in `inventory`
   *  under its id and become unreachable until it is worn again, which is what
   *  makes losing your pack a real stake rather than a bookkeeping event. */
  async function unequipContainer(kind: ContainerKind) {
    const p = unequipContainerPatch(kind, gear, inventory)
    if (!p) return
    await updateSections(p)
  }

  /** Ammunition available to a ranged attack.
   *
   *  Drawn from the quiver AND from what's on person — a quiver is a convenience,
   *  not a prerequisite. Twenty arrows in your pack are still arrows, and reading
   *  only the quiver meant a character without one could never fire at all.
   *  Quiver stacks lead, since that is the one you would actually reach for. */
  const containers = getContainers(gear)
  const quiver = containers.find(c => c.container?.mode === 'inline')
  const ammoStacks = [
    ...containerContents(quiver?.id, inventory),
    ...inventory.filter(i => i.containerId === PERSON && i.category === 'ammo'),
  ]
  const activeAmmo = ammoStacks.find(a => a.id === nocked) ?? ammoStacks[0] ?? null

  const attuned = attunedCount(gear)
  const attCap = attunementCap(character)
  const stowed = stowedContainers(inventory)

  const meta = (
    <>
      <span className="dim">◇</span>
      <span>Section</span>
      <span className="acc">/ Equipment</span>
      <span className="dim">·</span>
      <span>Loadout 02</span>
      <span className="dim">·</span>
      <span>Slots <span className="acc">{equippedCount(gear)} / 8</span></span>
      <span className="dim">·</span>
      <span>Attuned <span className={attuned >= attCap ? styles.attMaxed : 'acc'}>{attuned} / {attCap}</span></span>
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
        <div className={styles.eqGrid}>
        {/* ---------- LEFT: Weapons + Stats ---------- */}
        <section className={styles.col} aria-label="Weapons and stats">
          <ColHeader num="01" title="Weapons" meta="Loadout 02" />

          <div className={styles.weaponList}>
            {WEAPON_HANDS.map(({ hand, label }) => {
              const w = weapons.find(wp => wp.hand === hand) ?? null
              return w ? (
                <WeaponCard
                  key={hand} weapon={w} sheet={sheet} bind={bind}
                  armed={armedOn(w)} armable={armableOn(w)} onArm={activation.start}
                  dry={isRanged(w) && !activeAmmo}
                  ammo={isRanged(w) ? ammoStacks : null}
                  active={activeAmmo}
                  onNock={setNocked}
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
          <ColHeader
            num="04" title="Gear"
            meta={<>Attuned <span className={attuned >= attCap ? styles.attMaxed : 'acc'}>{attuned} / {attCap}</span></>}
          />
          <div className={styles.gearGrid}>
            {GEAR_SLOTS.map(s => (
              <GearSlot
                key={s.key} slot={s} item={gear[s.key] ?? null} bind={bind}
                onOpen={() => setOpenSlot(s.key)}
              />
            ))}
          </div>

          {/* Containers extend what Ros can HOLD, shards extend what Ros can DO.
              The button sits between them because that is the boundary it
              straddles — and the panel itself is a slide-over rather than a
              third block, so the gear column keeps its shape. */}
          <button
            type="button"
            className={`${styles.carryBtn}${carryOpen ? ' ' + styles.on : ''}`}
            onClick={() => setDrawer(d => (d === 'carry' ? null : 'carry'))}
            aria-expanded={carryOpen}
          >
            <span className={styles.cbFrame} />
            <span className={styles.cbInner}>
              <i className="fa-solid fa-boxes-stacked" aria-hidden="true" />
              <span className={styles.cbLabel}>Storage Containers</span>
              <span className={styles.cbCount}>{containers.length}</span>
              <i className={`fa-solid fa-chevron-${carryOpen ? 'right' : 'left'} ${styles.cbChev}`} aria-hidden="true" />
            </span>
          </button>

          <ShardBar character={character} shardTrees={shardTrees} bind={bind} />
        </section>
        </div>
      </div>

      {tooltip}
      {activation.sheet}

      {openSlot && (
        <EquipModal
          slot={GEAR_SLOTS.find(s => s.key === openSlot)!}
          item={gear[openSlot] ?? null}
          candidates={inventory.filter(i => (
            isRingSlot(openSlot) ? (i.slot && isRingSlot(i.slot)) : i.slot === openSlot
          ))}
          attuned={attuned}
          attCap={attCap}
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

      {drawer && (
        <div className={styles.sidebarScrim} onClick={() => setDrawer(null)} aria-hidden="true" />
      )}
      <CarrySidebar
        open={carryOpen}
        containers={containers}
        stowed={stowed}
        inventory={inventory}
        styles={styles}
        bind={bind}
        onUnequip={unequipContainer}
        onEquip={equipContainer}
        onClose={() => setDrawer(null)}
      />
    </>
  )
}

/* ---------- equipped gear shape (local view onto `equipped`) ---------- */

type SlotConfig = { key: ItemSlot; label: string; icon: string; type: string }

const GEAR_SLOTS: SlotConfig[] = [
  { key: 'helmet',    label: 'Helmet',    icon: 'fa-helmet-safety', type: 'Head' },
  { key: 'armor',     label: 'Armor',     icon: 'fa-shield-halved', type: 'Body' },
  { key: 'cloak',     label: 'Cloak',     icon: 'fa-user-tie',      type: 'Back' },
  { key: 'boots',     label: 'Boots',     icon: 'fa-shoe-prints',   type: 'Feet' },
  { key: 'gloves',    label: 'Gloves',    icon: 'fa-mitten',        type: 'Hands' },
  { key: 'neck',      label: 'Neck',      icon: 'fa-gem',           type: 'Amulet' },
  { key: 'ring1',     label: 'Ring I',    icon: 'fa-ring',          type: 'Ring' },
  { key: 'ring2',     label: 'Ring II',   icon: 'fa-ring',          type: 'Ring' },
]

/** The two weapon hands rendered as fixed slots (mirrors the gear-slot model). */
const WEAPON_HANDS: { hand: WeaponHand; label: string }[] = [
  { hand: 'main', label: 'Main weapon' },
  { hand: 'off', label: 'Side weapon' },
]

function weaponHandLabel(hand: WeaponHand): string {
  return hand === 'main' ? 'Main Weapon' : 'Side Weapon'
}

/** How many of the EIGHT worn slots are filled. The G.U.I.D.E. shard is not one
 *  of them (it has its own panel), so counting it here made the readout able to
 *  show 9 / 8. Slice 3 replaces this with ATTUNED n / 3 anyway. */
function equippedCount(gear: EquippedGear): number {
  let n = 0
  for (const s of GEAR_SLOTS) if (gear[s.key]) n++
  return n
}

/* ---------- small chrome helpers ---------- */

function ColHeader({ num, title, meta }: { num: string; title: string; meta: ReactNode }) {
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

function WeaponCard({ weapon, sheet, bind, dry, ammo, active, armed, armable, onArm, onNock, onAttack, onManage }: {
  weapon: EquippedWeapon; sheet: CharacterSheet; bind: Bind
  /** Armed modifiers that will land on this weapon's next roll (§16). */
  armed: number
  /** Features that COULD arm one but have not been pressed. */
  armable: Feature[]
  onArm: (f: Feature) => void
  /** Ranged, with nothing left to fire. */
  dry: boolean
  /** Stacks available to this weapon, or null when it takes no ammunition. */
  ammo: InventoryItem[] | null
  active: InventoryItem | null
  onNock: (id: string) => void
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
          {/* §16: a pending bonus the player cannot see is worse than no bonus,
              because they roll without it and never learn why the number was
              low. Inside the grid cell — the card is clip-pathed, so anything
              overflowing gets sliced. */}
          {armed > 0 && (
            <span className={styles.wcArmed} title="Armed — applies to this roll">
              <i className="fa-solid fa-bolt" />Armed{armed > 1 ? ` ${armed}` : ''}
            </span>
          )}
          {/* Offered, not taken — dashed, the same thing a ghost flag means in
              the roll panel. Pressing it is the feature's Use, in full: it
              spends the use and asks whatever the author attached. */}
          {armable.map(f => (
            <button
              key={f.id} type="button" className={styles.wcArmable}
              onClick={e => { e.stopPropagation(); onArm(f) }}
              title={`Use ${f.name} — arms it for this roll`}
            >
              <i className="fa-regular fa-circle-dot" />{f.name}
            </button>
          ))}
          <button
            className={`${styles.wcAttack}${dry ? ' ' + styles.dry : ''}`}
            onClick={e => { e.stopPropagation(); onAttack() }}
            title={dry ? 'No ammunition — nothing to fire' : undefined}
            aria-label={`Roll attack with ${weapon.name}`}
          >
            <i className={`fa-solid ${dry ? 'fa-ban' : 'fa-dice-d20'}`} /> Attack
          </button>
          {/* Which arrow is nocked belongs to the ATTACK, not to the quiver —
              so the selector lives here. Absent, not empty, when nothing is
              equipped to draw from. */}
          {ammo && (active
            ? <AmmoPicker stacks={ammo} active={active} onNock={onNock} />
            : <span className={styles.ammoNone}>No ammunition</span>)}
        </div>
      </div></div>
    </div>
  )
}

/** An ammunition stack's flat damage contribution, or null when it grants none.
 *  Reuses `effects.damage` — the same field a magic weapon uses — so authoring an
 *  arrow that hits harder needs no new concept in the catalog. */
export function ammoBonusOf(stack: InventoryItem | null): AmmoBonus | null {
  const d = stack?.effects?.damage
  return d ? { damage: d, label: stack!.name } : null
}

/** A weapon draws from the quiver if it takes ammunition. Read off the SRD
 *  `properties` the DM already authors, so no new field is needed. */
function buildWeaponRows(w: EquippedWeapon, sheet: CharacterSheet): [string, string][] {
  const rows: [string, string][] = []
  rows.push(['Attack', formatMod(weaponAttackBonus(w, sheet))])
  rows.push(['Damage', `${weaponDamageString(w, sheet)}${w.type ? ` ${w.type.toLowerCase()}` : ''}`])
  if (w.hand) rows.push(['Slot', handLabel(w.hand)])
  return rows
}

/** The nocked-ammunition selector. Sits beside ATTACK because which arrow is
 *  fired is a property of the attack; the quiver only answers "what do I have".
 *
 *  The menu is PORTALLED to a fixed layer on document.body, not rendered as a
 *  child of the button. The weapon card is clip-pathed, and clip-path clips
 *  descendants regardless of z-index or overflow — an in-card menu is silently
 *  sliced off along the card's 45° corner as soon as it has more than a row or
 *  two. It opens upward, flipping below when the button is too near the top. */
function AmmoPicker({ stacks, active, onNock }: {
  stacks: InventoryItem[]; active: InventoryItem; onNock: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    if (!open || !btnRef.current || !menuRef.current) return
    const b = btnRef.current.getBoundingClientRect()
    const m = menuRef.current
    const gap = 6
    // Right-align to the button so the control and its menu share an edge.
    let left = b.right - m.offsetWidth
    left = Math.max(12, Math.min(left, window.innerWidth - m.offsetWidth - 12))
    let top = b.top - m.offsetHeight - gap
    if (top < 12) top = b.bottom + gap          // not enough room above — flip down
    setPos({ left, top })
  }, [open, stacks.length])

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('click', close)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [open])

  return (
    <span className={`${styles.ammo}${open ? ' ' + styles.open : ''}`}>
      <button
        ref={btnRef}
        type="button" className={styles.ammoBtn}
        onClick={e => { e.stopPropagation(); setOpen(o => !o); setPos(null) }}
        aria-haspopup="listbox" aria-expanded={open}
        aria-label={`Nocked: ${active.name}, ${active.qty ?? 1} left`}
      >
        <i className="fa-solid fa-location-arrow" aria-hidden="true" />
        <span className={styles.amName}>{active.name}</span>
        {ammoBonusOf(active) && <span className={styles.amDmg}>+{ammoBonusOf(active)!.damage}</span>}
        <span className={styles.amCt}>×{active.qty ?? 1}</span>
        <i className={`fa-solid fa-chevron-down ${styles.amChev}`} aria-hidden="true" />
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          className={styles.ammoMenu}
          role="listbox"
          style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
          onClick={e => e.stopPropagation()}
        >
          {stacks.map(a => (
            <button
              key={a.id} type="button" role="option" aria-selected={a.id === active.id}
              className={`${styles.amOpt}${a.id === active.id ? ' ' + styles.on : ''}`}
              onClick={() => { onNock(a.id!); setOpen(false) }}
            >
              <span className={styles.amOptName}>{a.name}</span>
              {ammoBonusOf(a) && <span className={styles.amDmg}>+{ammoBonusOf(a)!.damage}</span>}
              <span className={styles.q}>×{a.qty ?? 1}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </span>
  )
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
      {/* Only slots actually spending one of the three attunement slots get the
          pip — so the gear grid and the ATTUNED readout can't disagree. */}
      {consumesAttunement(item) && <span className={styles.sAtt} aria-hidden="true">◈</span>}
      <span className={styles.rarityDot} />
    </button>
  )
}


/** Shard trees use a free-form rarity string (D&D has no "Very Rare" tier in
 *  ItemRarity) — fold it down to the 4-value scale the shared tooltip uses. */
function tooltipRarity(rarity: string): ItemRarity {
  const r = rarity.toLowerCase()
  if (r === 'uncommon') return 'uncommon'
  if (r === 'rare' || r === 'very rare') return 'rare'
  if (r === 'legendary' || r === 'artifact') return 'legendary'
  return 'common'
}

/** The shard bar — a wide row spanning the gear grid, split by dividers into
 *  the 3 real shard slots (lib/shards.ts `ShardSlot`, the same state the
 *  Shard screen reads/writes — this is a launcher + live mirror, not its own
 *  copy). Install/remove happens on the Shard menu; empty slots show a "+"
 *  and filled ones show the slotted shard's own icon/name. */
function ShardBar({ character, shardTrees, bind }: { character: CharacterRow; shardTrees: Record<string, ShardTree>; bind: Bind }) {
  const slots = shardSlots(character)
  return (
    <Link
      to="/shard"
      className={`${styles.slot} ${styles.special} ${styles.shardBar} ${styles.clickable}`}
      aria-label="Open Shard menu"
    >
      <span className={styles.sFrame} />
      <span className={styles.sInner}>
        <span className={styles.shardLabel}>Shards <span className={styles.shardLink}>open menu →</span></span>
        <div className={styles.shardSubs}>
          {SHARD_SLOT_KEYS.map(key => {
            const slot = slots[key]
            const tree = slot.shardId ? shardTrees[slot.shardId] : undefined
            const filled = !!tree || slot.locked
            const tt: TooltipData = tree
              ? { name: tree.name, sub: [tree.rarity, tree.module].filter(Boolean).join(' · '), rows: (tree.baseDetails ?? []).map(d => [d.l, d.v] as [string, string]), flavor: tree.flavor, attune: slot.locked ? 'Shard-bound' : 'Requires attunement', rarity: tooltipRarity(tree.rarity) }
              : slot.locked
                ? { name: 'G.U.I.D.E. Shard', sub: 'Core Module · Locked', rows: [['Status', 'Soulbound'], ['Type', 'Shard slot']], flavor: 'The core interface shard. Manage it in the Shard menu.', attune: 'Shard-bound', rarity: 'common' }
                : { name: 'Shard Slot', sub: 'Vacant', rows: [['Status', 'No shard installed']], flavor: 'Install a shard from the Shard menu.', rarity: 'empty' }
            return (
              // Plain spans, not their own <Link> — the whole bar is one
              // pressable link now, and an <a> can't nest inside an <a>.
              <span
                key={key}
                className={`${styles.shardSub}${filled ? '' : ' ' + styles.empty}`}
                {...bind(tt)}
              >
                <i className={`fa-solid ${tree?.icon ?? (slot.locked ? 'fa-gem' : 'fa-plus')}`} />
                <span className={styles.shardSubLabel}>{tree ? tree.name : slot.locked ? 'G.U.I.D.E.' : 'Empty'}</span>
              </span>
            )
          })}
        </div>
      </span>
    </Link>
  )
}

/* ---------- equip / unequip modal ---------- */

function EquipModal({ slot, item, candidates, attuned, attCap, onEquip, onUnequip, onClose }: {
  slot: SlotConfig
  item: EquippedItem | null
  candidates: InventoryItem[]
  attuned: number
  attCap: number
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
              <SelectorBody slot={slot} candidates={candidates} attuned={attuned} attCap={attCap} onEquip={onEquip} />
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
function SelectorBody({ slot, candidates, attuned, attCap, onEquip }: {
  slot: SlotConfig; candidates: InventoryItem[]; attuned: number; attCap: number; onEquip: (item: InventoryItem) => void
}) {
  if (candidates.length === 0) {
    return (
      <div className={styles.selectorEmpty}>
        No {slot.label.toLowerCase()} items in your inventory
        <span className={styles.em}>Items the DM grants you appear here</span>
      </div>
    )
  }
  const attunementFull = attuned >= attCap
  return (
    <div className={styles.selectorList}>
      {candidates.map(it => {
        // A slot picked from here is always currently empty, so equipping is
        // always a net +1 — block only the items that would actually spend a
        // slot, not the whole list, when attunement is already at cap.
        const locked = attunementFull && consumesAttunement(it)
        return (
          <div key={it.id ?? it.name} className={`${styles.pickRow}${locked ? ' ' + styles.locked : ''}`} data-rarity={it.rarity ?? 'common'}>
            <span className={styles.pkIcon}><i className={`fa-solid ${it.icon ?? slot.icon}`} /></span>
            <span className={styles.pkBody}>
              <span className={styles.pkName}>{it.name}</span>
              <span className={styles.pkMeta}>
                {locked ? `Attunement full · ${attuned} / ${attCap}` : `${rarityLabel(it.rarity ?? 'common')}${it.qty && it.qty > 1 ? ` · × ${it.qty}` : ''}`}
              </span>
            </span>
            <button className={styles.pkBtn} onClick={() => onEquip(it)} disabled={locked}>Equip</button>
          </div>
        )
      })}
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
                style={{ objectPosition: id.portraitFocus ?? 'center top' }}
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

/** Capitalised rarity for display ("uncommon" -> "Uncommon"). */
function rarityLabel(r: ItemRarity | 'empty'): string {
  return r.charAt(0).toUpperCase() + r.slice(1)
}
