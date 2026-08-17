/**
 * The DM's per-character INVENTORY tab.
 *
 * Confiscation is impossible without a way to browse a player's inventory, which
 * the console had no surface for — Grant Item could only ever add. This is the
 * other direction.
 *
 * TWO MECHANICS, DELIBERATELY DIFFERENT FICTIONS:
 *
 *   LOCK        the item stays exactly where it is, keeps its weight and its
 *               cell, and shows a lock icon. It cannot be used, equipped or
 *               consumed. Cursed, sealed, or ACCESS REVOKED. The player watches
 *               a system decide they may no longer use their own possession —
 *               which is a better late-campaign menace than taking it away.
 *
 *   CONFISCATE  the item LEAVES the character row entirely. No row, no weight,
 *               no count, no trace on the player's side. The guards took your
 *               sword and the Codex declines to discuss it. Restoring puts it
 *               back exactly where it was taken from.
 */

import { useMemo, useState } from 'react'
import type {
  CharacterRow, CharacterUpdate, ConfiscatedItemRow, InventoryItem, Json,
} from '../lib/database.types'
import {
  ITEM_SLOTS, getContainers, getGear, getInventory, getWeapons,
  unequipContainerPatch, unequipGearPatch, unequipWeaponPatch,
} from '../lib/equip'
import { PERSON, freeCellFor, place, routeItem } from '../lib/placement'
import { CAT_LABEL } from '../lib/items'
import { fmtWeight, itemWeight } from '../lib/burden'
import type { DmConfiscatedState } from '../lib/dm'
import styles from './OperatorConsole.module.css'

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ')

/** Human label for where an item lives, resolving container ids to names. */
function locationLabel(item: InventoryItem, row: CharacterRow): string {
  if (item.containerId === PERSON) {
    return item.col != null ? `On person · ${item.col},${item.row}` : 'On person'
  }
  const gear = getGear(row)
  const container = Object.values(gear.containers ?? {}).find(c => c?.id === item.containerId)
  return container?.name ?? 'Unreachable container'
}

export function OperatorInventory({ row, member, confiscated, onUpdate, log }: {
  row: CharacterRow
  member: { id: string; name: string }
  confiscated: DmConfiscatedState
  onUpdate: (patch: CharacterUpdate) => Promise<boolean>
  log: (node: React.ReactNode, tone?: 'cyan' | 'danger') => void
}) {
  const inventory = getInventory(row)
  const [busy, setBusy] = useState(false)
  const [confirmTake, setConfirmTake] = useState<string | null>(null)
  const [confirmDestroy, setConfirmDestroy] = useState<string | null>(null)
  const [note, setNote] = useState('')

  const held = useMemo(
    () => confiscated.rows.filter(r => r.character_id === row.id),
    [confiscated.rows, row.id],
  )

  const first = member.name.split(' ')[0]

  /** Flip the per-item lock. The item never moves — that's the whole point. */
  async function toggleLock(item: InventoryItem) {
    if (busy) return
    setBusy(true)
    const next = inventory.map(i => (i.id === item.id ? { ...i, locked: !i.locked } : i))
    const ok = await onUpdate({ inventory: next as unknown as Json[] })
    setBusy(false)
    if (!ok) return
    log(
      <>{item.locked ? 'Unlocked' : 'Locked'} <span className={styles.obj}>{item.name}</span> on <span className={styles.who}>{first}</span></>,
      item.locked ? 'cyan' : 'danger',
    )
  }

  /* WORN GEAR, WEAPONS AND CONTAINERS — everything confiscable that is not in
     `inventory`. Each entry carries the patch that would unequip it, because
     that is the only thing that differs between the three kinds. */
  const gear = getGear(row)
  const equippedEntries: { item: InventoryItem; where: string; patch: () => ReturnType<typeof unequipGearPatch> }[] = [
    ...ITEM_SLOTS.flatMap(slot => {
      const it = (gear as Record<string, InventoryItem | null | undefined>)[slot]
      return it ? [{ item: it, where: slot, patch: () => unequipGearPatch(slot, gear, inventory) }] : []
    }),
    ...getWeapons(gear).map(w => ({
      item: w as InventoryItem,
      where: w.hand ? `${w.hand} hand` : 'weapon',
      patch: () => (w.hand ? unequipWeaponPatch(w.hand, gear, inventory) : null),
    })),
    ...getContainers(gear).map(c => ({
      item: c as InventoryItem,
      where: c.container?.kind ?? 'container',
      patch: () => (c.container?.kind ? unequipContainerPatch(c.container.kind, gear, inventory) : null),
    })),
  ]

  /** Confiscate something the character is WEARING.
   *
   *  UNEQUIP FIRST, then take it from the pack — not a shortcut, the only shape
   *  that works. `restore()` puts an item back into `inventory` and
   *  ConfiscatedFrom models an inventory placement, so an item taken straight out
   *  of a slot could never be given back to one. Unequipping is also the state
   *  the app already understands: effects, granted features and variables stop
   *  applying because the item left `equipped`, and a container's contents follow
   *  it rather than being orphaned in a bag nobody is wearing.
   *
   *  One write: the unequip patch goes out with the item already removed from the
   *  inventory it would have landed in, so the player never sees it in their pack. */
  async function confiscateEquipped(entry: { item: InventoryItem; patch: () => ReturnType<typeof unequipGearPatch> }) {
    if (busy) return
    setBusy(true)
    setConfirmTake(null)
    const p = entry.patch()
    if (!p) { setBusy(false); return }

    // `toCarried` keeps the id, so the freshly-carried copy — footprint, contents
    // and all — is the one to store and the one to drop.
    const carried = ((p.inventory ?? []) as unknown as InventoryItem[]).find(i => i.id === entry.item.id) ?? entry.item
    const stored = await confiscated.confiscate(row.id, carried, note.trim() || undefined)
    if (!stored) { setBusy(false); return }

    const ok = await onUpdate({
      ...p,
      inventory: ((p.inventory ?? []) as unknown as InventoryItem[]).filter(i => i.id !== entry.item.id) as unknown as Json[],
    })
    setBusy(false)
    if (!ok) { await confiscated.release(stored.id); return }
    setNote('')
    log(<>Confiscated <span className={styles.obj}>{carried.name}</span> from <span className={styles.who}>{first}</span> <span className={styles.dim}>(worn)</span></>, 'danger')
  }

  /** Take it. Snapshot the placement, drop it from the character, store it. */
  async function confiscate(item: InventoryItem) {
    if (busy) return
    setBusy(true)
    setConfirmTake(null)
    const stored = await confiscated.confiscate(row.id, item, note.trim() || undefined)
    if (!stored) { setBusy(false); return }
    const ok = await onUpdate({
      inventory: inventory.filter(i => i.id !== item.id) as unknown as Json[],
    })
    setBusy(false)
    if (!ok) {
      // The character write failed, so un-store it rather than leaving the item
      // in two places at once.
      await confiscated.release(stored.id)
      return
    }
    setNote('')
    log(<>Confiscated <span className={styles.obj}>{item.name}</span> from <span className={styles.who}>{first}</span></>, 'danger')
  }

  /** Give it back, to the cell it came from when that's still possible. */
  async function restore(rec: ConfiscatedItemRow) {
    if (busy) return
    setBusy(true)
    const gear = getGear(row)
    const item = rec.item

    // The stored placement wins when it's still valid. It can fail two ways: the
    // cell is occupied now, or the container is gone — both fall through to the
    // ordinary routing chain rather than dropping the item on the floor.
    const wanted = rec.from
    const containerStillExists = wanted.containerId === PERSON
      || Object.values(gear.containers ?? {}).some(c => c?.id === wanted.containerId)
    const cellFree = wanted.containerId !== PERSON
      || wanted.col == null
      || freeCellFor(inventory, item) !== null

    const dest = containerStillExists && cellFree ? wanted : routeItem(item, gear, inventory)
    const restored = place({ ...item }, dest)

    const ok = await onUpdate({ inventory: [...inventory, restored] as unknown as Json[] })
    if (!ok) { setBusy(false); return }
    await confiscated.release(rec.id)
    setBusy(false)
    log(<>Returned <span className={styles.obj}>{item.name}</span> to <span className={styles.who}>{first}</span></>, 'cyan')
  }

  /** Bin it for good — the counterpart to `restore`. Same single write (the
   *  record is the only place a confiscated item exists), minus putting it back
   *  on the character. For the item handed over by mistake, which otherwise
   *  sits in Held forever because Return is the only way out. */
  async function destroy(rec: ConfiscatedItemRow) {
    if (busy) return
    setBusy(true)
    await confiscated.release(rec.id)
    setBusy(false)
    setConfirmDestroy(null)
    log(<>Destroyed <span className={styles.obj}>{rec.item.name}</span>, taken from <span className={styles.who}>{first}</span></>, 'danger')
  }

  return (
    <div className={styles.invTab}>
      {/* ---------- carried ---------- */}
      <section className={styles.invPanel}>
        <header className={styles.invHead}>
          <span className={styles.invTitle}>Carried</span>
          <span className={styles.invMeta}>{inventory.length} items</span>
        </header>

        {inventory.length === 0 ? (
          <div className={styles.catListEmpty}>Nothing carried.</div>
        ) : (
          <div className={styles.invList}>
            {inventory.map(item => (
              <div key={item.id} className={cx(styles.invRow, item.locked && styles.isLocked)}>
                <span className={styles.irIcon}><i className={`fa-solid ${item.icon ?? 'fa-cube'}`} /></span>
                <span className={styles.irName}>
                  {item.locked && <i className={cx('fa-solid fa-lock', styles.irLock)} />}
                  {item.name}
                  {item.qty && item.qty > 1 ? <span className={styles.irQty}>×{item.qty}</span> : null}
                </span>
                <span className={styles.irWhere}>{locationLabel(item, row)}</span>
                <span className={styles.irCat}>{CAT_LABEL[item.category ?? 'misc']}</span>
                <span className={styles.irWt}>{itemWeight(item) ? `${fmtWeight(itemWeight(item))} lb` : '—'}</span>

                <button
                  className={cx(styles.irAct, item.locked && styles.on)}
                  disabled={busy}
                  onClick={() => void toggleLock(item)}
                  title={item.locked ? 'Unlock — the player can use it again' : 'Lock — carried, but unusable'}
                >
                  <i className={`fa-solid ${item.locked ? 'fa-lock-open' : 'fa-lock'}`} />
                  {item.locked ? 'Unlock' : 'Lock'}
                </button>

                {confirmTake === item.id ? (
                  <button
                    className={cx(styles.irAct, styles.danger)}
                    disabled={busy}
                    onClick={() => void confiscate(item)}
                    title="The player will see no trace of it"
                  >
                    <i className="fa-solid fa-hand" />Confirm
                  </button>
                ) : (
                  <button
                    className={cx(styles.irAct, styles.take)}
                    disabled={busy}
                    onClick={() => setConfirmTake(item.id ?? null)}
                    title="Confiscate — removes it from the player's view entirely"
                  >
                    <i className="fa-solid fa-hand" />Take
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---------- equipped ---------- */}
      {equippedEntries.length > 0 && (
        <section className={styles.invPanel}>
          <header className={styles.invHead}>
            <span className={styles.invTitle}>Equipped</span>
            <span className={styles.invMeta}>{equippedEntries.length} worn · taking one unequips it first</span>
          </header>
          <div className={styles.invRows}>
            {equippedEntries.map(entry => (
              <div key={entry.item.id} className={styles.invRow}>
                <span className={styles.irIcon}><i className={`fa-solid ${entry.item.icon ?? 'fa-cube'}`} /></span>
                <span className={styles.irName}>{entry.item.name}</span>
                <span className={styles.irWhere}>{entry.where}</span>
                <span className={styles.irCat}>{CAT_LABEL[entry.item.category ?? 'misc']}</span>
                <span className={styles.irWt}>{itemWeight(entry.item) ? `${fmtWeight(itemWeight(entry.item))} lb` : '—'}</span>
                <span className={styles.irAct} style={{ visibility: 'hidden' }} aria-hidden="true" />
                {confirmTake === entry.item.id ? (
                  <button className={cx(styles.irAct, styles.danger)} disabled={busy}
                    onClick={() => void confiscateEquipped(entry)}
                    title="Unequips it, then removes it from the player's view entirely">
                    <i className="fa-solid fa-hand" />Confirm
                  </button>
                ) : (
                  <button className={cx(styles.irAct, styles.take)} disabled={busy}
                    onClick={() => setConfirmTake(entry.item.id ?? null)}
                    title="Confiscate — unequips it first, then takes it">
                    <i className="fa-solid fa-hand" />Take
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ---------- held ---------- */}
      <section className={styles.invPanel}>
        <header className={styles.invHead}>
          <span className={styles.invTitle}>Held</span>
          <span className={styles.invMeta}>{held.length} confiscated</span>
        </header>

        <div className={styles.invNoteRow}>
          <input
            className={styles.sessIn}
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Why it was taken (DM-only, optional)"
            aria-label="Confiscation note"
          />
        </div>

        {held.length === 0 ? (
          <div className={styles.catListEmpty}>
            Nothing held. Confiscated items vanish from the player's screens entirely —
            no row, no weight, no count.
          </div>
        ) : (
          <div className={styles.invList}>
            {held.map(rec => (
              <div key={rec.id} className={cx(styles.invRow, styles.held)}>
                <span className={styles.irIcon}><i className={`fa-solid ${rec.item.icon ?? 'fa-cube'}`} /></span>
                <span className={styles.irName}>
                  {rec.item.name}
                  {rec.item.qty && rec.item.qty > 1 ? <span className={styles.irQty}>×{rec.item.qty}</span> : null}
                </span>
                <span className={styles.irWhere}>
                  from {rec.from.containerId === PERSON ? 'person' : 'a container'}
                  {rec.from.col != null ? ` · ${rec.from.col},${rec.from.row}` : ''}
                </span>
                <span className={styles.irNote}>{rec.note || '—'}</span>
                <button
                  className={cx(styles.irAct, styles.on)}
                  disabled={busy}
                  onClick={() => void restore(rec)}
                  title="Return it to where it was taken from"
                >
                  <i className="fa-solid fa-rotate-left" />Return
                </button>

                {confirmDestroy === rec.id ? (
                  <button
                    className={cx(styles.irAct, styles.danger)}
                    disabled={busy}
                    onClick={() => void destroy(rec)}
                    title="Gone for good — this cannot be undone"
                  >
                    <i className="fa-solid fa-trash" />Confirm
                  </button>
                ) : (
                  <button
                    className={cx(styles.irAct, styles.take)}
                    disabled={busy}
                    onClick={() => setConfirmDestroy(rec.id)}
                    title="Destroy it — for the item granted by mistake"
                  >
                    <i className="fa-solid fa-trash" />Destroy
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
