import { NavLink } from 'react-router-dom'
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

/** Framed navigation button. `<NavLink>` supplies the active state so the
 *  current screen reads lit, the same as the mockup's hover treatment. */
function NavBtn({ to, label, icon, marker }: NavItem) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => `${styles.btn}${isActive ? ' ' + styles.active : ''}`}
    >
      <span className={styles.frame} />
      {marker && <span className={styles.marker}>{marker}</span>}
      <span className={styles.inner}>
        <span className={styles.icon}><i className={`fa-solid ${icon}`} /></span>
        <span className={styles.label}>{label}</span>
      </span>
    </NavLink>
  )
}

export function Nav() {
  return (
    <>
      <nav className={styles.navbar} aria-label="Primary">
        {PRIMARY.map(item =>
          item.to === '/equipment' ? (
            <div key={item.to} className={`${styles.slot} ${styles.equipment}`}>
              <div className={`${styles.sub} ${styles.above}`}>
                <NavBtn to="/inventory" label="Inventory" icon="fa-bag-shopping" />
              </div>
              <NavBtn {...item} />
              <div className={`${styles.sub} ${styles.below}`}>
                <NavBtn to="/stat-panel" label="Stat Panel" icon="fa-chart-simple" />
              </div>
            </div>
          ) : (
            <div key={item.to} className={styles.slot}>
              <NavBtn {...item} />
            </div>
          ),
        )}
      </nav>
      <div className={styles.hint}>
        Hover <span className={styles.k}>Equipment</span> to reveal sub-modules
        &nbsp;·&nbsp; <NavLink to="/shard">Shard</NavLink>
      </div>
    </>
  )
}
