/**
 * The item popup — click any item, anywhere, and get a focused panel with its
 * full detail and every action that applies to it.
 *
 * This replaces the persistent right-column detail panel the refactor deleted.
 * The trade is deliberate: the panel cost ~40% of the right column permanently
 * to show one item that was usually nothing, and it could only ever describe
 * items in the grid. A popup costs nothing until asked for and works identically
 * from a grid tile, a container row, or (later) the DM console.
 *
 * The automatic/manual split matters here: routing NEVER blocks, but a manual
 * move can. RETRIEVE is disabled with a reason when ON PERSON has no
 * footprint-sized space, rather than silently rerouting the item somewhere the
 * player didn't ask for.
 */

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { EquippedGear, EquippedItem, InventoryItem } from '../lib/database.types'
import { fmtWeight, itemWeight } from '../lib/burden'
import { getContainers, isRingSlot, type EquipTarget } from '../lib/equip'
import { PERSON, freeCellFor, preferredDest } from '../lib/placement'
import { CAT_LABEL, rarityLabel } from '../lib/items'
import styles from './InventoryPopup.module.css'
import { Icon } from '../components/Icon'
import { Inline } from '../lib/markdown'

/** Every place this item can be moved to: ON PERSON when a footprint-sized space
 *  is free, plus every equipped container that accepts its category and has room.
 *  Deliberate movement, so unlike routing it offers a choice rather than picking.
 *
 *  Containers are included regardless of where the item currently IS — moving
 *  backpack -> bag of holding used to require a round trip through the grid
 *  (retrieve, then stow), which is two writes and a lot of clicking to express
 *  one intent. */
export function moveTargets(
  item: InventoryItem, gear: EquippedGear, inventory: InventoryItem[],
): { id: string; name: string }[] {
  const out: { id: string; name: string }[] = []
  if (item.containerId !== PERSON && freeCellFor(inventory, item)) {
    out.push({ id: PERSON, name: 'On Person' })
  }
  for (const c of stowTargets(item, gear, inventory)) {
    if (c.id) out.push({ id: c.id, name: c.name })
  }
  return out
}

function stowTargets(
  item: InventoryItem, gear: EquippedGear, inventory: InventoryItem[],
): EquippedItem[] {
  // NO NESTING (spec §10). A container can't go inside a container — that's what
  // kills recursion and the weightless-inside-weightless exploit, and 5e supplies
  // the in-fiction justification. Without this the popup happily offers to stow a
  // sack into the backpack, and it then reappears in the carry sidebar's STOWED
  // strip as equippable-from-inside-a-bag.
  if (item.container) return []

  return getContainers(gear).filter(c => {
    if (!c.id || c.id === item.containerId) return false
    const def = c.container
    if (!def) return false
    const allowed = def.allowedCategories
    if (allowed?.length && !(item.category && allowed.includes(item.category))) return false
    if (def.capacity != null) {
      // Units held, not row count — a merged stack (one entry, qty > 1)
      // still fills that many units of capacity. See lib/placement.ts
      // contentCount for the same rule.
      const held = inventory.filter(i => i.containerId === c.id).reduce((n, i) => n + (i.qty ?? 1), 0)
      if (held >= def.capacity) return false
    }
    return true
  })
}

export function ItemPopup({
  item, gear, inventory, target, busy,
  onEquip, onUse, onMove, onDrop, onOpenContainer, onClose,
}: {
  item: InventoryItem
  gear: EquippedGear
  inventory: InventoryItem[]
  target: EquipTarget
  busy: boolean
  onEquip: () => void
  onUse: () => void
  onMove: (destId: string) => void
  onDrop: () => void
  onOpenContainer: (id: string) => void
  onClose: () => void
}) {
  const [confirmDrop, setConfirmDrop] = useState(false)
  const dests = moveTargets(item, gear, inventory)
  const preferred = preferredDest(dests, gear)
  const [moveTo, setMoveTo] = useState<string>(preferred)

  useEffect(() => { setConfirmDrop(false) }, [item.id])
  useEffect(() => { setMoveTo(prev => (dests.some(d => d.id === prev) ? prev : preferred)) }, [dests, preferred])

  const cat = item.category ?? 'misc'
  const rarity = item.rarity ?? 'common'
  const onPerson = item.containerId === PERSON

  /** The container this item IS, if any (containers are items too). */
  const asContainer = item.container
  const containerEquipped = !!asContainer && Object.values(gear.containers ?? {})
    .some(c => c?.id === item.id)

  // A locked item is carried and weighed but refuses to be used — every action
  // that would exercise it is off, while pure logistics (stow, drop) stay on.
  const locked = !!item.locked
  const canEquip = target.kind !== 'none' && !locked && !asContainer
  const canUse = cat === 'consumable' && !locked && (item.heal !== undefined || !!item.effects)
  const retrieveCell = onPerson ? null : freeCellFor(inventory, item)
  const canRetrieve = !onPerson && retrieveCell !== null

  const weightlessHome = Object.values(gear.containers ?? {})
    .some(c => c?.id === item.containerId && c?.container?.weightless)

  const facts: [string, string][] = [
    ['Weight', weightlessHome ? '— cached' : item.weight != null ? `${fmtWeight(itemWeight(item))} lb` : '—'],
    ['Value', item.value ? `${item.value.toLocaleString()} gp` : '—'],
    [cat === 'weapon' ? 'Damage' : cat === 'armor' ? 'Armor' : 'Key Stat',
      item.damage ?? item.damageDice ?? item.rows?.[0]?.[1] ?? '—'],
    /* A WEAPON HAS NO `slot` — weapons live in equipped.weapons[] and are held
       in a hand, not fitted to one of the eight gear slots. Reading the absent
       slot as "Not equippable" told the player the opposite of the truth about
       every sword in the game. */
    ['Slot', item.slot
      ? isRingSlot(item.slot) ? 'Ring' : item.slot.replace(/^\w/, c => c.toUpperCase())
      : cat === 'weapon' ? (item.hand === 'off' ? 'Off hand' : item.hand === 'main' ? 'Main hand' : 'Held — main or off hand')
        : asContainer ? 'Carry' : 'Not equippable'],
  ]
  if (item.attune) facts.push(['Attunement', item.attune])
  if (asContainer) {
    const contents = inventory.filter(i => i.containerId === item.id)
    // A capacity-limited container (a quiver) reads in units — a merged
    // "Arrows ×20" stack still fills 20 of 20. An uncapped bag reads in
    // distinct items instead: how many different things are in here.
    const held = asContainer.capacity != null
      ? contents.reduce((n, i) => n + (i.qty ?? 1), 0)
      : contents.length
    facts.push(['Holds', `${held}${asContainer.capacity ? ` / ${asContainer.capacity}` : ''} items`])
    facts.push(['Access', asContainer.mode === 'inline'
      ? 'Drawn automatically'
      : containerEquipped ? 'Opens as a tab' : 'Unequipped'])
  }

  return createPortal(
    <div className={styles.imodal} role="dialog" aria-modal="true" aria-label={item.name}>
      <div className={styles.imScrim} onClick={onClose} aria-hidden="true" />
      <div className={styles.imPanel} data-rar={rarity}>
        <span className={styles.pnGap} />
        <span className={styles.pnLine} />
        <div className={styles.imInner}>
          <span className={`${styles.imCorner} ${styles.tl}`} />
          <span className={`${styles.imCorner} ${styles.br}`} />

          <header className={styles.imHead}>
            <span className={styles.imCrystal}><Icon name={item.icon ?? 'fa-cube'} aria-hidden="true" /></span>
            <div className={styles.imTitles}>
              <span className={styles.imName}>{item.name}</span>
              <span className={styles.imTags}>
                <span className={styles.imTag}>{CAT_LABEL[cat]}</span>
                <span className={`${styles.imTag}${rarity !== 'common' ? ' ' + styles.acc : ''}`}>{rarityLabel(rarity)}</span>
                {item.qty && item.qty > 1 && <span className={styles.imTag}>Qty ×{item.qty}</span>}
                {locked && <span className={`${styles.imTag} ${styles.danger}`}>Locked</span>}
              </span>
            </div>
            <button type="button" className={styles.imClose} onClick={onClose} aria-label="Close">
              <i className="fa-solid fa-xmark" aria-hidden="true" />
            </button>
          </header>

          <div className={styles.imBody}>
            <div className={styles.imFacts}>
              {facts.map(([k, v]) => (
                <div key={k} className={styles.f}>
                  <span className={styles.k}>{k}</span><span className={styles.v}>{v}</span>
                </div>
              ))}
            </div>

            {item.flavor && <div className={`${styles.imDesc} prose-voice`}><Inline text={item.flavor} /></div>}

            {locked && (
              <div className={styles.imWarn}>
                // ACCESS REVOKED — carried, but the Codex will not let you use it
              </div>
            )}

            {item.rows && item.rows.length > 0 && (
              <div className={styles.imSec}>
                <div className={styles.imSecH}>Detail</div>
                <div className={styles.imFx}>
                  {item.rows.map(([k, v], i) => (
                    <div key={i} className={styles.row}>
                      <span className={styles.k}>{k}</span><span>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {item.features && item.features.length > 0 && (
              <div className={styles.imSec}>
                <div className={styles.imSecH}>Features Granted</div>
                <div className={styles.imFx}>
                  {item.features.map(f => (
                    <div key={f.id} className={styles.row}>
                      <span className={styles.k}>{f.name}</span>
                      <span>{f.light_description ?? f.summary ?? ''}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {!onPerson && !canRetrieve && (
            <div className={`${styles.imWarn} ${styles.footWarn}`}>
              // No reachable space on person — free a cell to retrieve
              {dests.length > 0 && ', or move it to another container'}
            </div>
          )}

          <div className={styles.imActions}>
            {asContainer ? (
              containerEquipped ? (
                <button
                  type="button" className={styles.ia} disabled={busy}
                  onClick={() => item.id && onOpenContainer(item.id)}
                >
                  <span className={styles.af} />
                  <span className={styles.ai}><i className="fa-solid fa-folder-open" />Open</span>
                </button>
              ) : (
                <button type="button" className={styles.ia} onClick={onEquip} disabled={busy}>
                  <span className={styles.af} />
                  <span className={styles.ai}><i className="fa-solid fa-link" />Equip</span>
                </button>
              )
            ) : canEquip && (
              <button type="button" className={styles.ia} onClick={onEquip} disabled={busy}>
                <span className={styles.af} />
                <span className={styles.ai}><i className="fa-solid fa-circle-up" />{equipLabel(target)}</span>
              </button>
            )}

            {canUse && (
              <button type="button" className={`${styles.ia} ${styles.ghost}`} onClick={onUse} disabled={busy}>
                <span className={styles.af} />
                <span className={styles.ai}><i className="fa-solid fa-hand-holding-droplet" />Use</span>
              </button>
            )}

            {/* One control for every move. Retrieve and Stow were separate
                because the destination was implied; with any-to-any moves the
                destination is chosen, so the verb follows it. */}
            {dests.length > 0 && (
              <>
                {dests.length > 1 && (
                  <select
                    className={styles.stowPick} value={moveTo}
                    onChange={e => setMoveTo(e.target.value)}
                    aria-label="Move destination"
                  >
                    {dests.map(d => <option key={d.id} value={d.id}>To {d.name}</option>)}
                  </select>
                )}
                <button
                  type="button" className={`${styles.ia} ${styles.ghost}`}
                  onClick={() => onMove(moveTo || dests[0].id)} disabled={busy || !moveTo}
                >
                  <span className={styles.af} />
                  <span className={styles.ai}>
                    <i className={`fa-solid ${moveTo === PERSON ? 'fa-hand' : 'fa-box-archive'}`} />
                    {moveTo === PERSON ? 'Retrieve' : 'Stow'}
                  </span>
                </button>
              </>
            )}

            {/* Quest items are the campaign's, not yours — no dropping them. */}
            {cat !== 'quest' && (
              confirmDrop ? (
                <button type="button" className={`${styles.ia} ${styles.drop} ${styles.confirm}`} onClick={onDrop} disabled={busy}>
                  <span className={styles.af} />
                  <span className={styles.ai}><i className="fa-solid fa-trash-can" />Confirm?</span>
                </button>
              ) : (
                <button type="button" className={`${styles.ia} ${styles.drop}`} onClick={() => setConfirmDrop(true)} disabled={busy}>
                  <span className={styles.af} />
                  <span className={styles.ai}><i className="fa-solid fa-trash-can" />Drop</span>
                </button>
              )
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function equipLabel(target: EquipTarget): string {
  switch (target.kind) {
    case 'gear':      return 'Equip'
    case 'weapon':    return target.hand === 'main' ? 'Equip · Main' : 'Equip · Off'
    case 'container': return 'Equip'
    case 'none':      return target.reason
  }
}
