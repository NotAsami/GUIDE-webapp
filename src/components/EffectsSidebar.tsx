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
 */
import type { ActiveEffect } from '../lib/database.types'
import { summarizeEffects } from '../lib/effects'
import styles from './EffectsSidebar.module.css'

const cx = (...xs: (string | false | undefined)[]) => xs.filter(Boolean).join(' ')

export function EffectsSidebar({ open, effects, onRemove, onClose }: {
  open: boolean; effects: ActiveEffect[]; onRemove: (id: string) => void; onClose: () => void
}) {
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
              effects.map(e => (
                <div key={e.id} className={cx(styles.statusChip, styles[e.kind ?? 'buff'])}>
                  <span className={styles.scIcon}><i className={`fa-solid ${e.icon ?? 'fa-wand-sparkles'}`} /></span>
                  <span className={styles.scBody}>
                    <span className={styles.scName}>{e.name}</span>
                    <span className={styles.scMeta}>{summarizeEffects(e.effects)}{e.note ? ` · ${e.note}` : ''}</span>
                    {e.source && <span className={styles.scSource}>From: {e.source}</span>}
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
    </>
  )
}
