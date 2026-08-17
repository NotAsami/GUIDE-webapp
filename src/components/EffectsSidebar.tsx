/**
 * Active Effects — a slide-over listing every temporary effect currently on
 * the character (potions, DM-applied buffs/conditions/debuffs). Extracted
 * from Equipment.tsx (docs/notes.md:68: "Move the effects panel to the
 * stat-panel subscreen, as a button that opens the panel of effects") so it
 * can mount from the Stat Panel instead — the component and its data
 * (lib/effects.ts's activeEffects/summarizeEffects) didn't change, only
 * where it's launched from.
 *
 * Chip colour reads `kind` the same way the DM's own effect list already
 * does (OperatorConsole.tsx's ApplyEffectCard / .fxLine): buff = cyan,
 * cond = amber, debuff = danger-hot. Previously every chip here rendered
 * cyan regardless of kind — docs/notes.md:77's "no way to display debuffs,
 * like red entries" — this is that fix.
 *
 * Click a chip → the same "click anything, get a focused detail panel"
 * pattern items use (InventoryPopup.tsx / OperatorShops.tsx's OpenShopPopup),
 * reusing that popup's chrome directly rather than re-authoring the same
 * chamfered-frame CSS a third time.
 */
import { useState } from 'react'
import { createPortal } from 'react-dom'
import type { ActiveEffect } from '../lib/database.types'
import { summarizeEffects } from '../lib/effects'
import { renderInline } from '../lib/markdown'
import { useItemTooltip } from './ItemTooltip'
import styles from './EffectsSidebar.module.css'
import pop from '../screens/InventoryPopup.module.css'
import { turnsLabel } from '../lib/turns'

const cx = (...xs: (string | false | undefined)[]) => xs.filter(Boolean).join(' ')
const KIND_LABEL: Record<'buff' | 'cond' | 'debuff', string> = { buff: 'Buff', cond: 'Condition', debuff: 'Debuff' }

export function EffectsSidebar({ open, effects, onRemove, onClose }: {
  open: boolean; effects: ActiveEffect[]; onRemove: (id: string) => void; onClose: () => void
}) {
  // .sidebar animates via `transform`, which gives `position: fixed`
  // descendants a new containing block — the tooltip and popup are rendered
  // as siblings below, outside that transform, so they position off the
  // real viewport instead of the sliding panel.
  const { tooltip, bind, hide } = useItemTooltip()
  const [detailId, setDetailId] = useState<string | null>(null)
  const detail = effects.find(e => e.id === detailId) ?? null

  return (
    <>
      {open && <div className={styles.sidebarScrim} onClick={onClose} aria-hidden="true" />}
      <aside className={cx(styles.sidebar, open && styles.open)} aria-hidden={!open}>
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
              effects.map(e => {
                const grants = e.effects && Object.keys(e.effects).length > 0 ? summarizeEffects(e.effects) : undefined
                return (
                  <div key={e.id} className={cx(styles.statusChip, styles[e.kind ?? 'buff'])}
                    role="button" tabIndex={0}
                    onClick={() => setDetailId(e.id)}
                    onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setDetailId(e.id) } }}
                    {...bind({ name: e.name, sub: KIND_LABEL[e.kind ?? 'buff'], rows: grants ? [['Grants', grants]] : undefined, flavor: e.desc })}>
                    <span className={styles.scIcon}><i className={`fa-solid ${e.icon ?? 'fa-wand-sparkles'}`} /></span>
                    {/* The countdown, where the effect is. A number only the roll
                        panel knows is one the player cannot plan around. */}
                    {turnsLabel(e) && <span className={styles.scTurns}>{turnsLabel(e)}</span>}
                    <span className={styles.scBody}>
                      <span className={styles.scName}>{e.name}</span>
                      <span className={styles.scMeta}>{summarizeEffects(e.effects)}{e.note ? ` · ${e.note}` : ''}</span>
                      {e.source && <span className={styles.scSource}>From: {e.source}</span>}
                    </span>
                    <button className={styles.scRemove} onClick={ev => { ev.stopPropagation(); hide(); onRemove(e.id) }} aria-label={`End ${e.name}`}>
                      <i className="fa-solid fa-xmark" />
                    </button>
                  </div>
                )
              })
            )}
          </div>

          <footer className={styles.sidebarFoot}>Effects clear on a rest, or end one early with ✕.</footer>
        </div>
      </aside>
      {tooltip}
      {detail && (
        <EffectDetailPopup
          effect={detail}
          onRemove={() => { hide(); onRemove(detail.id); setDetailId(null) }}
          onClose={() => setDetailId(null)}
        />
      )}
    </>
  )
}

/** The effect's full detail, one click away — mirrors ItemPopup/OpenShopPopup:
 *  facts row (what it mechanically grants, how long), then the full prose
 *  description (markdown-rendered, unlike the clipped tooltip), then the one
 *  action that applies here. */
function EffectDetailPopup({ effect, onRemove, onClose }: {
  effect: ActiveEffect
  onRemove: () => void
  onClose: () => void
}) {
  const grants = effect.effects && Object.keys(effect.effects).length > 0 ? summarizeEffects(effect.effects) : undefined

  return createPortal(
    <div className={pop.imodal} role="dialog" aria-modal="true" aria-label={effect.name}>
      <div className={pop.imScrim} onClick={onClose} aria-hidden="true" />
      <div className={pop.imPanel}>
        <span className={pop.pnGap} />
        <span className={pop.pnLine} />
        <div className={pop.imInner}>
          <span className={`${pop.imCorner} ${pop.tl}`} />
          <span className={`${pop.imCorner} ${pop.br}`} />

          <header className={pop.imHead}>
            {/* The `kind` class was missing here, so a debuff's chip went red and
                its opened crystal stayed cyan — the same effect, two colours. */}
            <span className={cx(pop.imCrystal, pop[effect.kind ?? 'buff'])}>
              <i className={`fa-solid ${effect.icon ?? 'fa-wand-sparkles'}`} />
            </span>
            <div className={pop.imTitles}>
              <span className={pop.imName}>{effect.name}</span>
              <span className={pop.imTags}>
                <span className={pop.imTag}>{KIND_LABEL[effect.kind ?? 'buff']}</span>
                {effect.source && <span className={pop.imTag}>From {effect.source}</span>}
              </span>
            </div>
            <button type="button" className={pop.imClose} onClick={onClose} aria-label="Close">
              <i className="fa-solid fa-xmark" />
            </button>
          </header>

          <div className={pop.imBody}>
            {(grants || effect.note) && (
              <div className={pop.imFacts}>
                {grants && <div className={pop.f}><span className={pop.k}>Grants</span><span className={pop.v}>{grants}</span></div>}
                {effect.note && <div className={pop.f}><span className={pop.k}>Duration</span><span className={pop.v}>{effect.note}</span></div>}
              </div>
            )}
            <div className={pop.imDesc}>{effect.desc ? renderInline(effect.desc) : 'No description recorded.'}</div>
          </div>

          <div className={pop.imActions}>
            {/* .ia.drop is 104px fixed-width in InventoryPopup, sized to sit
                beside Equip/Use/Stow — here it's the only action, so it needs
                to fill the row instead (inline: wins over the class's fixed
                flex-basis without touching the shared rule other popups use). */}
            <button type="button" className={`${pop.ia} ${pop.drop}`} style={{ flex: 1 }} onClick={onRemove}>
              <span className={pop.af} />
              <span className={pop.ai}><i className="fa-solid fa-xmark" />Clear Effect</span>
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
