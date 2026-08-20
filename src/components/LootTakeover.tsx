/**
 * The party's view of an open loot roll.
 *
 * READ ONLY, AND IT SAYS SO. There is no take button anywhere, because there is
 * no player write path — migration 0020 gives the party a SELECT policy and
 * nothing else. A screen showing unclaimed items with no way to take them would
 * read as broken, so the header carries a "Read Only — the DM assigns" chip and
 * the distribution meter spells it out: table talk decides this, not this
 * screen.
 *
 * WATCHING IT RESOLVE IS THE POINT. `useOpenLoot` subscribes to the row, so a
 * line the DM assigns lands here within a tick, and the card flashes. That
 * flash is how a player finds out they got the sword — without it this is just
 * a list, and the party might as well have been told out loud.
 *
 * LEAVING IS LOCAL ONLY, exactly as ShopTakeover works: a player cannot close a
 * roll server-side. Dismissal is remembered in Layout so the Bottombar can
 * reopen it, and a fresh push clears a stale dismissal.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { LootOpenRow, LootOpenLine, ItemCategory, ItemRarity } from '../lib/database.types'
import { renderInline } from '../lib/markdown'
import { Icon } from './Icon'
import styles from './LootTakeover.module.css'
/* The item detail modal is the same one the Inventory and the shop use — same
   chrome, same facts block. Only its ACTIONS differ, and here there are none. */
import pop from '../screens/InventoryPopup.module.css'

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ')

const CAT: Record<ItemCategory, { corner: string; label: string; tint: string }> = {
  weapon: { corner: 'fa-khanda', label: 'Weapon', tint: styles.catWeapon },
  ammo: { corner: 'fa-location-arrow', label: 'Ammunition', tint: styles.catAmmo },
  armor: { corner: 'fa-shield-halved', label: 'Armor', tint: styles.catArmor },
  consumable: { corner: 'fa-flask-vial', label: 'Consumable', tint: styles.catConsumable },
  tool: { corner: 'fa-screwdriver-wrench', label: 'Tool', tint: styles.catTool },
  quest: { corner: 'fa-scroll', label: 'Quest', tint: styles.catQuest },
  misc: { corner: 'fa-circle-dot', label: 'Misc', tint: styles.catMisc },
}
const RAR: Record<ItemRarity, { label: string; frame: string }> = {
  common: { label: 'Common', frame: styles.rarCommon },
  uncommon: { label: 'Uncommon', frame: styles.rarUncommon },
  rare: { label: 'Rare', frame: styles.rarRare },
  'very-rare': { label: 'Very Rare', frame: styles.rarVrare },
  legendary: { label: 'Legendary', frame: styles.rarLegendary },
  artifact: { label: 'Artifact', frame: styles.rarArtifact },
}

const firstName = (n: string) => (n || '').split(' ')[0]
const catOf = (c?: string) => CAT[(c as ItemCategory) in CAT ? (c as ItemCategory) : 'misc']
const rarOf = (r?: string) => RAR[(r as ItemRarity) in RAR ? (r as ItemRarity) : 'common']

export function LootTakeover({ roll, dismissed, onDismiss }: {
  roll: LootOpenRow | null
  dismissed: boolean
  onDismiss: () => void
}) {
  const [openId, setOpenId] = useState<string | null>(null)

  const lines = useMemo(() => roll?.lines ?? [], [roll])
  const n = lines.length
  const done = lines.filter(l => l.assigned_to).length

  /* Which lines have JUST been assigned, so their card can flash once. Compared
     against the previous render rather than stored on the row: "new to me" is a
     property of this viewer's screen, not of the data — two players open the
     panel at different times and each should see their own arrivals. */
  const seenRef = useRef<Set<string>>(new Set())
  const [flash, setFlash] = useState<Set<string>>(new Set())
  useEffect(() => {
    const assigned = new Set(lines.filter(l => l.assigned_to).map(l => l.key))
    const fresh = [...assigned].filter(k => !seenRef.current.has(k))
    seenRef.current = assigned
    if (!fresh.length) return
    setFlash(new Set(fresh))
    const t = setTimeout(() => setFlash(new Set()), 1200)
    return () => clearTimeout(t)
  }, [lines])

  /* Escape closes the detail modal first, then leaves — the same nesting rule
     the Inventory popup follows, so one key never does two things at once. */
  useEffect(() => {
    if (!roll || dismissed) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      if (openId) setOpenId(null)
      else onDismiss()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [roll, dismissed, openId, onDismiss])

  if (!roll || dismissed) return null

  const c = roll.container ?? { icon: 'fa-box-archive', name: 'Loot' }
  const detail = openId ? lines.find(l => l.key === openId) ?? null : null

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={`Loot — ${c.name}`}>
      <div className={styles.scrim} />
      <div className={styles.panel}>
        <div className={styles.pnGap} />
        <div className={styles.pnLine} />
        <div className={styles.pnInner}>
          <span className={cx(styles.pnCorner, styles.tl)} />
          <span className={cx(styles.pnCorner, styles.br)} />

          <header className={styles.head}>
            <span className={styles.portrait}><Icon name={c.icon || 'fa-box-archive'} /></span>
            <div className={styles.titles}>
              <div className={styles.eyebrow}>
                <span className={styles.tick} />
                <span>Loot Distribution</span>
                <span className={styles.dim}>//</span>
                <span>{c.kind?.trim() || 'Container'}</span>
              </div>
              <h1 className={styles.name}>{c.name || 'Loot'}</h1>
              <div className={styles.meta}>
                {c.location?.trim() && (
                  <span className={cx(styles.chip, styles.acc)}><i className="fa-solid fa-location-dot" />{c.location}</span>
                )}
                <span className={styles.chip}><i className="fa-solid fa-eye" />Read Only — the DM assigns</span>
              </div>
            </div>
            <button type="button" className={styles.leave} onClick={onDismiss} aria-label="Close">
              <span className={styles.leaveFrame} />
              <span className={styles.leaveInner}><i className="fa-solid fa-xmark" /> Close</span>
            </button>
            {c.desc?.trim() && <p className={styles.desc}>{renderInline(c.desc)}</p>}
          </header>

          <div className={styles.dist}>
            <div className={styles.distLead}>
              <div className={styles.subHead}>Distribution</div>
              <div className={styles.distReadout}>
                <span className={styles.cur}>{n ? `${done} / ${n}` : '—'}</span>
                <span className={styles.unit}>assigned</span>
              </div>
            </div>
            <div className={styles.distBar}><i style={{ width: n ? `${Math.round(done / n * 100)}%` : '0%' }} /></div>
            <div className={styles.distNote}>
              <span className={styles.k}>Table talk decides this, not this screen.</span>{' '}
              <span className={styles.acc}>The DM assigns each item — you cannot claim one directly.</span>
            </div>
          </div>

          <section className={styles.stock} aria-label="Contents">
            <div className={styles.stockBar}>
              <span className={styles.sh}>Contents</span>
              <span className={styles.n}>
                {n ? <><span className={styles.acc}>{n}</span> item{n === 1 ? '' : 's'} rolled</> : <span className={styles.acc}>Rolled</span>}
              </span>
            </div>
            <div className={styles.stockScroll}>
              {n === 0 ? (
                <div className={styles.empty}>
                  <span className={styles.leGlyph}><Icon name={c.icon || 'fa-box-archive'} /></span>
                  <span className={styles.leTitle}>Nothing Of Value</span>
                  <span className={styles.leSub}>
                    {c.name} turned up empty. Not every roll owes the party a reward — this one
                    is just a legitimate blank.
                  </span>
                  <span className={styles.leStamp}>Roll Resolved &nbsp;·&nbsp; No Distribution Needed</span>
                </div>
              ) : (
                <div className={styles.grid}>
                  {lines.map(line => <Card key={line.key} line={line} flashing={flash.has(line.key)} onOpen={() => setOpenId(line.key)} />)}
                </div>
              )}
            </div>
          </section>

          <footer className={styles.foot}>
            <span className={styles.dot} /><span>Channel:</span><span className={styles.acc}>Loot · DM-gated</span>
            <span className={styles.sep}>|</span><span>Distribution:</span>
            <span className={styles.acc}>{done === n && n > 0 ? 'Resolved' : 'In progress'}</span>
            <div className={styles.right}>
              <span>Leave anytime</span><span className={styles.kbd}>ESC</span>
            </div>
          </footer>
        </div>
      </div>

      {detail && <Detail line={detail} container={c.name} onClose={() => setOpenId(null)} />}
    </div>
  )
}

function Card({ line, flashing, onOpen }: { line: LootOpenLine; flashing: boolean; onOpen: () => void }) {
  const cat = catOf(line.item?.category)
  const rar = rarOf(line.item?.rarity)
  const claimed = !!line.assigned_to
  return (
    <button
      type="button"
      className={cx(styles.sc, flashing && styles.justAssigned)}
      onClick={onOpen}
      aria-label={`${line.item?.name ?? 'Item'}, ${claimed ? `assigned to ${line.assigned_name}` : 'unclaimed'}`}
    >
      <span className={cx(styles.scBody, cat.tint, rar.frame)}>
        <span className={styles.scArt}>
          <span className={styles.catCorner}><Icon name={cat.corner} /></span>
          <span className={styles.rarCorner}>{rar.label}</span>
          <span className={styles.glyph}><Icon name={line.item?.icon || 'fa-box'} /></span>
        </span>
        <span className={styles.scFoot}>
          <span className={styles.nm}>{line.item?.name ?? 'Unknown'}</span>
          <span className={styles.metaRow}>
            <span className={styles.qty}>×{line.qty}</span><span>{cat.label}</span>
          </span>
          {claimed ? (
            <span className={cx(styles.assignRow, styles.claimed, flashing && styles.justIn)}>
              <i className="fa-solid fa-circle-check" />
              <span className={styles.who}>→ {firstName(line.assigned_name ?? '').toUpperCase()}</span>
            </span>
          ) : (
            <span className={cx(styles.assignRow, styles.unclaimed)}>
              <i className="fa-solid fa-hourglass-half" /><span>Unclaimed</span>
            </span>
          )}
        </span>
      </span>
    </button>
  )
}

/** Read-only detail: what it is, who has it, and one way back. No equip, no
 *  stow, no take — none of those are things a player can do from here. */
function Detail({ line, container, onClose }: { line: LootOpenLine; container: string; onClose: () => void }) {
  const cat = catOf(line.item?.category)
  const rar = rarOf(line.item?.rarity)
  const it = line.item ?? {}
  return (
    <div className={pop.imodal} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={pop.imScrim} onClick={onClose} />
      <div className={pop.imPanel} data-rar={it.rarity ?? 'common'}>
        <div className={pop.imInner}>
          <span className={cx(pop.imCorner, pop.tl)} />
          <span className={cx(pop.imCorner, pop.br)} />
          <div className={pop.imHead}>
            <span className={pop.imCrystal}><Icon name={it.icon || 'fa-box'} /></span>
            <span className={pop.imTitles}>
              <span className={pop.imName}>{it.name ?? 'Unknown'}</span>
              <span className={pop.imTags}>
                <span className={pop.imTag}>{cat.label}</span>
                <span className={cx(pop.imTag, it.rarity && it.rarity !== 'common' && pop.acc)}>{rar.label}</span>
                <span className={cx(pop.imTag, pop.acc)}>{container}</span>
              </span>
            </span>
            <button type="button" className={pop.imClose} onClick={onClose} aria-label="Close"><i className="fa-solid fa-xmark" /></button>
          </div>
          <div className={pop.imBody}>
            <div className={pop.imFacts}>
              <div className={pop.f}><span className={pop.k}>Quantity</span><span className={pop.v}>×{line.qty}</span></div>
              <div className={pop.f}>
                <span className={pop.k}>Assigned To</span>
                <span className={cx(pop.v, line.assigned_to ? pop.acc : styles.factDim)}>
                  {line.assigned_name ?? 'Not yet assigned'}
                </span>
              </div>
              {/* Same trap as the Inventory popup: a weapon carries no `slot`,
                  it carries a hand. */}
              <div className={pop.f}><span className={pop.k}>Slot</span><span className={pop.v}>
                {it.slot ?? (it.category === 'weapon' ? 'Held — main or off hand' : 'Not equippable')}
              </span></div>
              <div className={pop.f}><span className={pop.k}>Weight</span><span className={pop.v}>{it.weight ? `${it.weight} lb` : '—'}</span></div>
            </div>
            {it.flavor?.trim() && <div className={pop.imDesc}>{renderInline(it.flavor)}</div>}
          </div>
          <div className={pop.imActions}>
            <button type="button" className={pop.ia} onClick={onClose}>
              <span className={pop.af} />
              <span className={pop.ai}><i className="fa-solid fa-arrow-left-long" />Back To Loot</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
