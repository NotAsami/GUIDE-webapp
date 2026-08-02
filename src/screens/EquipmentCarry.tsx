/**
 * The storage-containers sidebar — everything the character can carry things IN.
 *
 * A slide-over rather than a block in the gear column: containers are a system
 * extension like shards, but unlike shards they change another SCREEN (the
 * Inventory tab bar) rather than this one, so they don't earn permanent space
 * here. The button sits between the gear grid and the shard panel because that
 * is the boundary it straddles — gear modifies the character, containers modify
 * what the character can hold.
 *
 * Equip and unequip live HERE and nowhere else. A container's tab on the
 * Inventory screen is a consequence of this list, never its own control — one
 * mental model: gear is managed where gear lives.
 */

import { useState } from 'react'
import type { ContainerKind, EquippedItem, InventoryItem } from '../lib/database.types'
import { fmtWeight, itemWeight } from '../lib/burden'
import { containerContents } from '../lib/equip'
import { CAT_LABEL, rarityLabel } from '../lib/items'
import type { Bind } from '../components/ItemTooltip'

/** How many contents rows an `inline` container shows before deferring to the
 *  popup. Expansion has to be BOUNDED or the panel below shifts by an
 *  unpredictable amount; three covers the common case (most characters carry
 *  1–3 ammunition types) and the tail gets a surface built for length. */
const INLINE_ROWS = 3

type Styles = Record<string, string>

export function CarrySidebar({
  open, containers, stowed, inventory, styles, bind, onEquip, onUnequip, onClose,
}: {
  open: boolean
  containers: EquippedItem[]
  stowed: InventoryItem[]
  inventory: InventoryItem[]
  /** The shared tooltip binder, so an expanded ammunition row can say what the
   *  arrow actually is without opening anything. */
  bind: Bind
  /** Equipment.module.css, passed in so both sidebars share one stylesheet and
   *  the slide-over chrome is defined exactly once. */
  styles: Styles
  onEquip: (item: InventoryItem) => void
  onUnequip: (kind: ContainerKind) => void
  onClose: () => void
}) {
  return (
    <aside className={`${styles.sidebar}${open ? ' ' + styles.open : ''}`} aria-hidden={!open}>
      <div className={styles.sidebarFrame} />
      <div className={styles.sidebarInner}>
        <header className={styles.sidebarHead}>
          <div className={styles.shTitles}>
            <span className={styles.shKicker}>Carry</span>
            <span className={styles.shName}>Storage Containers</span>
          </div>
          <button className={styles.modalClose} onClick={onClose} aria-label="Close storage">
            <i className="fa-solid fa-xmark" />
          </button>
        </header>

        <div className={styles.sidebarBody}>
          {containers.length === 0 && stowed.length === 0 ? (
            <div className={styles.selectorEmpty}>
              No containers
              <span className={styles.em}>A backpack, sack, bag of holding or quiver would extend what you can carry</span>
            </div>
          ) : (
            <>
              {containers.map(c => (
                <ContainerRow
                  key={c.id} container={c} inventory={inventory} styles={styles} bind={bind}
                  onUnequip={() => c.container && onUnequip(c.container.kind)}
                />
              ))}

              {/* Owned but not worn. One strip for all of them, so stowing a sack
                  never grows the panel — and so "where did my backpack go" always
                  has a visible answer. */}
              {stowed.length > 0 && (
                <div className={styles.carryStowed}>
                  <span className={styles.csKey}>Stowed</span>
                  {stowed.map(c => (
                    <span key={c.id} className={styles.csRow}>
                      <span className={styles.csName}>{c.name}</span>
                      <button
                        type="button" className={`${styles.cAct} ${styles.equip}`}
                        onClick={() => onEquip(c)}
                      >
                        Equip
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <footer className={styles.sidebarFoot}>
          Unequipping a container takes its contents with it.
        </footer>
      </div>
    </aside>
  )
}

function ContainerRow({ container, inventory, styles, bind, onUnequip }: {
  container: EquippedItem; inventory: InventoryItem[]; styles: Styles
  bind: Bind; onUnequip: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const def = container.container
  const contents = containerContents(container.id, inventory)
  const inline = def?.mode === 'inline'

  const held = contents.reduce((n, i) => n + (i.qty ?? 1), 0)
  const weight = contents.reduce((n, i) => n + itemWeight(i), 0)

  /** page rows report bulk; inline rows report capacity, because that's the
   *  number that decides whether you can keep shooting. */
  const readout = inline
    ? <><span className={styles.cap}>{held}{def?.capacity ? ` / ${def.capacity}` : ''}</span> held</>
    : <>{contents.length} · {def?.weightless ? 'Weightless' : `${fmtWeight(weight)} lb`}</>

  const shown = contents.slice(0, INLINE_ROWS)
  const more = contents.length - shown.length

  return (
    <div className={`${styles.carryRow}${expanded ? ' ' + styles.expanded : ''}`}>
      <div className={styles.crMain}>
        <span className={styles.crIcon}><i className={`fa-solid ${container.icon ?? 'fa-box'}`} aria-hidden="true" /></span>
        <span className={styles.crName}>{container.name}</span>
        <span className={styles.crRead}>{readout}</span>

        {inline && contents.length > 0 && (
          <button
            type="button" className={styles.crChev}
            onClick={() => setExpanded(e => !e)}
            aria-expanded={expanded} aria-label={`${expanded ? 'Hide' : 'Show'} ${container.name} contents`}
          >
            <i className="fa-solid fa-chevron-right" aria-hidden="true" />
          </button>
        )}

        {confirm ? (
          <button
            type="button" className={`${styles.cAct} ${styles.danger}`}
            onClick={onUnequip}
          >
            Confirm?
          </button>
        ) : (
          <button
            type="button" className={styles.cAct}
            // A non-empty container takes its contents with it — worth one
            // confirmation so it never reads as data loss.
            onClick={() => (contents.length > 0 ? setConfirm(true) : onUnequip())}
          >
            Unequip
          </button>
        )}
      </div>

      {inline && expanded && (
        <div className={styles.crBody}>
          {shown.map(a => (
            <div
              key={a.id} className={styles.crLine} tabIndex={0}
              {...bind({
                name: a.name,
                sub: `${rarityLabel(a.rarity ?? 'common')} · ${CAT_LABEL[a.category ?? 'misc']}`,
                rows: [
                  ['Quantity', `×${a.qty ?? 1}`],
                  ['Weight', `${fmtWeight(itemWeight(a))} lb`],
                  // The whole reason to hover an arrow: does it hit harder?
                  ...(a.effects?.damage ? [['Damage', `+${a.effects.damage}`] as [string, string]] : []),
                  ...(a.rows ?? []),
                ],
                flavor: a.flavor,
                rarity: a.rarity ?? 'common',
              })}
            >
              <span>{a.name}</span>
              <span className={styles.q}>×{a.qty ?? 1}</span>
            </div>
          ))}
          {more > 0 && (
            <div className={`${styles.crLine} ${styles.crMore}`}>
              <span>+{more} more</span>
              <span className={styles.q}>open the item for the full list</span>
            </div>
          )}
        </div>
      )}

      {confirm && (
        <div className={styles.crWarn}>
          // {contents.length} item{contents.length === 1 ? '' : 's'} go with it
        </div>
      )}
    </div>
  )
}
