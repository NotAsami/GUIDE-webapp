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
  { to: '/character', label: 'Character', marker: '04 ◇', icon: 'fa-user-shield' },
  { to: '/journal',   label: 'Journal',   marker: '05 ◇', icon: 'fa-clipboard' },
]

/** Routes that live "under" the Equipment slot — when one is active the
 *  Equipment parent button reads lit, the same as the mockup's treatment. */
const EQUIPMENT_GROUP = ['/equipment', '/inventory', '/stat-panel']

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

  // Dock lights the Equipment parent for any route in its group; hero lights it
  // only on /equipment itself (sub-routes light their own sub-button).
  const equipmentLit = isDock ? EQUIPMENT_GROUP.includes(pathname) : pathname === '/equipment'

  return (
    <>
      <nav
        className={`${styles.navbar} ${isDock ? styles.dock : styles.hero}`}
        aria-label="Primary"
      >
        {PRIMARY.map(item =>
          // The hover-expand sub-modules (Inventory / Stat Panel) belong to the
          // hero launcher only. The dock bar renders Equipment as a plain button.
          item.to === '/equipment' && !isDock ? (
            <div key={item.to} className={`${styles.slot} ${styles.equipment}`}>
              <div className={`${styles.sub} ${styles.above}`}>
                <NavBtn
                  item={{ to: '/inventory', label: 'Inventory', marker: '◇', icon: 'fa-bag-shopping' }}
                  subActive={pathname === '/inventory'}
                />
              </div>
              <NavBtn item={item} active={equipmentLit} />
              <div className={`${styles.sub} ${styles.below}`}>
                <NavBtn
                  item={{ to: '/stat-panel', label: 'Stat Panel', marker: '◇', icon: 'fa-chart-simple' }}
                  subActive={pathname === '/stat-panel'}
                />
              </div>
            </div>
          ) : (
            <div key={item.to} className={styles.slot}>
              <NavBtn
                item={item}
                active={item.to === '/equipment' ? equipmentLit : pathname === item.to}
              />
            </div>
          ),
        )}
      </nav>

      {isDock ? (
        meta && <div className={styles.navMeta}>{meta}</div>
      ) : (
        <div className={styles.hint}>
          Hover <span className={styles.k}>Equipment</span> to reveal sub-modules
          &nbsp;·&nbsp; <NavLink to="/shard">Shard</NavLink>
        </div>
      )}
    </>
  )
}
