/**
 * The DM's loot roll — what came up, and who gets it.
 *
 * ROLLING AND PUSHING ARE SEPARATE, which is the decision the whole component
 * turns on. `is_open` on the row IS "pushed": until the DM presses Push To
 * Party, the party's RLS policy matches nothing and the roll does not exist as
 * far as they are concerned. That gap is what makes Reroll usable — a result
 * the DM does not like can be thrown away before anyone has seen it.
 *
 * ASSIGNMENT KEEPS WORKING AFTER A PUSH, on purpose. The party watching the
 * distribution resolve line by line is the point of the player screen; if
 * assignment had to finish first they would only ever see the final answer.
 *
 * ASSIGNING IS A REAL GRANT. It writes the item onto that character's sheet
 * through the same path Grant Item uses, so loot arrives indistinguishably from
 * a hand-granted item. Unassigning does NOT take it back — see `onUnassign`.
 *
 * MINIMIZE vs CLOSE are different verbs and the mockup is explicit about it:
 * Escape and the scrim MINIMIZE (the roll stays open, the index row offers
 * "Resume"), while Close Loot Roll dismisses it for everyone including whatever
 * is still unassigned.
 */

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { LootOpenRow, ItemRarity } from '../lib/database.types'
import { Icon } from './Icon'
import styles from './LootRollOverlay.module.css'
/* The console's chamfered button, reused rather than re-cut. Its `.bf`/`.bi`
 * two-layer recipe is exactly the clip-path-plus-border trap documented in
 * docs/Chamfered_clip-path_corners_fix.md, and a second copy of it is a second
 * chance to get the corners wrong. OperatorShops.tsx reaches for this same
 * stylesheet for the same reason. */
import con from '../screens/OperatorConsole.module.css'

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ')

const RAR_TOKEN: Record<ItemRarity, string> = {
  common: 'var(--beige)',
  uncommon: 'var(--cyan)',
  rare: 'var(--cyan-hot)',
  legendary: 'var(--gold-rare)',
}
const RAR_LABEL: Record<ItemRarity, string> = {
  common: 'Common', uncommon: 'Uncommon', rare: 'Rare', legendary: 'Legendary',
}

export type LootRollMember = { id: string; name: string }

export function LootRollOverlay({ roll, members, onAssign, onUnassign, onPush, onReroll, onClose, onMinimize }: {
  roll: LootOpenRow
  members: LootRollMember[]
  onAssign: (key: string, memberId: string) => void
  onUnassign: (key: string) => void
  onPush: () => void
  onReroll: () => void
  onClose: () => void
  onMinimize: () => void
}) {
  const lines = roll.lines ?? []
  const n = lines.length
  const done = lines.filter(l => l.assigned_to).length
  const pushed = roll.is_open
  const c = roll.container ?? { icon: 'fa-box-archive', name: 'Loot' }

  /* Escape minimizes rather than closes — closing is destructive (it dismisses
     the roll for the whole party) and destructive should never be the thing a
     stray keypress does. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onMinimize() } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onMinimize])

  return createPortal(
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={`Loot roll — ${c.name}`}>
      <div className={styles.scrim} onClick={onMinimize} />
      <div className={styles.panel}>
        <div className={styles.pnGap} />
        <div className={styles.pnLine} />
        <div className={styles.pnInner}>
          <span className={cx(styles.pnCorner, styles.tl)} />
          <span className={cx(styles.pnCorner, styles.br)} />

          <header className={styles.head}>
            <div className={styles.sigil}><Icon name={c.icon || 'fa-box-archive'} /></div>
            <div className={styles.titles}>
              <div className={styles.kicker}>Loot Roll · DM Only{pushed && ' · Pushed To Party'}</div>
              <div className={styles.hname}>{c.name || 'Untitled'}</div>
              <div className={styles.hclass}>
                {c.kind?.trim() || 'Container'}
                {c.location?.trim() && <><span className={styles.sep}>·</span>{c.location}</>}
              </div>
            </div>
            <div className={styles.trans}>
              <div className={styles.stat}>
                <span className={styles.l}>Rolled</span>
                <span className={styles.v}>{n}</span>
              </div>
              <div className={styles.vrule} />
              <div className={styles.stat}>
                <span className={styles.l}>Assigned</span>
                <span className={cx(styles.v, n > 0 && done === n && styles.done)}>{done} / {n}</span>
              </div>
            </div>
            <button type="button" className={styles.close} onClick={onMinimize} aria-label="Minimize">
              <span className={styles.clf} /><span className={styles.cli}><i className="fa-solid fa-xmark" /></span>
            </button>
          </header>

          <div className={styles.body}>
            {n === 0 ? (
              <div className={styles.empty}>
                <i className="fa-solid fa-ghost" />
                Nothing of value — every line failed its drop check. A legitimate empty
                roll; push it or close it, there is nothing to assign.
              </div>
            ) : (
              <div className={styles.rows}>
                {lines.map(line => {
                  const rar = (line.item?.rarity ?? 'common') as ItemRarity
                  return (
                    <div key={line.key} className={styles.row} style={{ ['--rar' as string]: RAR_TOKEN[rar] }}>
                      <span className={styles.rowIc}><Icon name={line.item?.icon || 'fa-box'} /></span>
                      <span className={styles.rowTx}>
                        <span className={styles.rowT}>
                          {line.item?.name ?? line.item_id}{line.qty > 1 && ` ×${line.qty}`}
                        </span>
                        <span className={styles.rowS}>
                          {line.item?.category ?? 'misc'} · <span className={styles.rar}>{RAR_LABEL[rar]}</span>
                        </span>
                      </span>
                      {line.assigned_to ? (
                        <span className={styles.assigned}>
                          <i className="fa-solid fa-circle-check" />
                          <span className={styles.who}>{line.assigned_name ?? 'Assigned'}</span>
                          <button type="button" className={styles.unassign} onClick={() => onUnassign(line.key)}
                            title="Unassign — this does NOT take the item back off their sheet">
                            <i className="fa-solid fa-xmark" />
                          </button>
                        </span>
                      ) : (
                        <select className={styles.pick} value="" aria-label={`Assign ${line.item?.name ?? 'item'}`}
                          onChange={e => { if (e.target.value) onAssign(line.key, e.target.value) }}>
                          <option value="">Assign to…</option>
                          {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </select>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <footer className={styles.foot}>
            <div className={styles.sumhead}>
              <span className={styles.sg}><i className="fa-solid fa-tower-broadcast" /></span>
              <span className={styles.st}>Party Distribution</span>
              <span className={cx(styles.warn, pushed && styles.live)}>
                {pushed ? 'Live — players are watching this resolve' : 'Not yet pushed — the party cannot see this roll'}
              </span>
            </div>
            <div className={styles.footrow}>
              <button type="button" className={cx(con.btn, con.ghost, styles.narrow)} onClick={onReroll}
                title="Reroll this table — the current result is discarded">
                <span className={con.bf} /><span className={con.bi}><i className="fa-solid fa-dice-d6" /></span>
              </button>
              <button type="button" className={cx(con.btn, pushed ? con.ghost : con.amber, styles.grow)}
                onClick={onPush} disabled={pushed}>
                <span className={con.bf} />
                <span className={con.bi}><i className="fa-solid fa-tower-broadcast" /> {pushed ? 'Pushed To Party' : 'Push To Party'}</span>
              </button>
              <button type="button" className={cx(con.btn, con.danger, styles.grow)} onClick={onClose}>
                <span className={con.bf} />
                <span className={con.bi}><i className="fa-solid fa-box-archive" /> Close Loot Roll</span>
              </button>
            </div>
          </footer>
        </div>
      </div>
    </div>,
    document.body,
  )
}
