import type { ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import styles from './Nav.module.css'

interface NavItem {
  to: string
  label: string
  icon: string
  marker?: string
}

const PRIMARY: NavItem[] = [
  { to: '/equipment', label: 'Equipment', marker: '01 ◇', icon: 'fa-khanda' },
  { to: '/lore',      label: 'Lore',      marker: '02 ◇', icon: 'fa-book-open' },
  { to: '/spellbook', label: 'Spellbook', marker: '03 ◇', icon: 'fa-scroll' },
  { to: '/character', label: 'Rolls',     marker: '04 ◇', icon: 'fa-user-shield' },
  { to: '/journal',   label: 'Journal',   marker: '05 ◇', icon: 'fa-clipboard' },
]

/** Hover-expand sub-modules, keyed by parent route — same pattern the
 *  Equipment slot originated (docs/notes.md: "Move features as a submenu to
 *  the rolls screen... Something like we have on the navbar currently").
 *  Rendered above/below the parent in the hero variant; the dock always
 *  renders the parent as a plain button but still uses this map to light it
 *  for any route in its group. */
const SUB_MODULES: Record<string, { above?: NavItem; below?: NavItem }> = {
  '/equipment': {
    above: { to: '/inventory', label: 'Inventory', marker: '◇', icon: 'fa-bag-shopping' },
    below: { to: '/stat-panel', label: 'Stat Panel', marker: '◇', icon: 'fa-chart-simple' },
  },
  '/character': {
    below: { to: '/features', label: 'Features', marker: '◇', icon: 'fa-medal' },
  },
}

/** `parent` plus every one of its sub-module routes — the set that lights the
 *  dock's parent button. */
function groupFor(parent: string): string[] {
  const sub = SUB_MODULES[parent]
  return [parent, sub?.above?.to, sub?.below?.to].filter((x): x is string => !!x)
}

type Variant = 'hero' | 'dock'

interface Props {
  /** `hero` = large centered launcher (Codex home). `dock` = compact bar
   *  fixed below the topbar (content screens). */
  variant?: Variant
  /** Optional telemetry line under the dock navbar (ignored for hero). */
  meta?: ReactNode
}

/** Framed navigation button. `active`/`subActive` come from the current route
 *  so the lit state matches wherever you are. */
function NavBtn({
  item, active, subActive,
}: { item: NavItem; active?: boolean; subActive?: boolean }) {
  const cls = [
    styles.btn,
    active ? styles.active : '',
    subActive ? styles.subActive : '',
  ].filter(Boolean).join(' ')
  return (
    <NavLink to={item.to} className={cls} aria-current={active || subActive ? 'page' : undefined}>
      <span className={styles.frame} />
      {item.marker && <span className={styles.marker}>{item.marker}</span>}
      <span className={styles.inner}>
        <span className={styles.icon}><i className={`fa-solid ${item.icon}`} /></span>
        <span className={styles.label}>{item.label}</span>
      </span>
    </NavLink>
  )
}

export function Nav({ variant = 'hero', meta }: Props) {
  const { pathname } = useLocation()
  const isDock = variant === 'dock'

  return (
    <>
      <nav
        className={`${styles.navbar} ${isDock ? styles.dock : styles.hero}`}
        aria-label="Primary"
      >
        {PRIMARY.map(item => {
          const sub = SUB_MODULES[item.to]
          // Dock lights a parent for any route in its group; hero lights it
          // only on its own route (sub-routes light their own sub-button).
          const lit = isDock ? groupFor(item.to).includes(pathname) : pathname === item.to
          // Both variants hover-reveal sub-modules — the dock's own sizing
          // for .hasSub/.sub lives in Nav.module.css's DOCK VARIANT block.
          if (sub) {
            return (
              <div key={item.to} className={`${styles.slot} ${styles.hasSub}`}>
                {sub.above && (
                  <div className={`${styles.sub} ${styles.above}`}>
                    <NavBtn item={sub.above} subActive={pathname === sub.above.to} />
                  </div>
                )}
                <NavBtn item={item} active={lit} />
                {sub.below && (
                  <div className={`${styles.sub} ${styles.below}`}>
                    <NavBtn item={sub.below} subActive={pathname === sub.below.to} />
                  </div>
                )}
              </div>
            )
          }
          return (
            <div key={item.to} className={styles.slot}>
              <NavBtn item={item} active={lit} />
            </div>
          )
        })}
      </nav>

      {isDock ? (
        meta && <div className={styles.navMeta}>{meta}</div>
      ) : (
        <div className={styles.hint}>
          Hover <span className={styles.k}>Equipment</span> or <span className={styles.k}>Rolls</span> to reveal sub-modules
          &nbsp;·&nbsp; <NavLink to="/shard">Shard</NavLink>
        </div>
      )}
    </>
  )
}
