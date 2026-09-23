import { Link, useLocation } from 'react-router-dom'
import styles from './NotFound.module.css'

/** Where a path that resolves to nothing lands: an unmatched route, a story
 *  card the DM deleted, a thread that is no longer in the record. All three
 *  used to redirect silently — home, or up one level — so a broken link looked
 *  like a working one that took you somewhere else.
 *
 *  ONE SCREEN, ONE COPY. It never says whether the thing was removed, sealed,
 *  or never existed: a notice that told those apart would confirm to a player
 *  that hidden content is there. `up` adds a quiet second way out for the
 *  thread case; the way home is always the loud one. */
export function NotFound({ up }: { up?: { to: string; label: string } }) {
  const { pathname } = useLocation()
  return (
    <>
      <div className={styles.world} aria-hidden="true" />
      <div className={styles.beyond} aria-hidden="true" />
      <section className={styles.notice}>
        <div className={styles.kicker}>System notice &nbsp;·&nbsp; 0x194</div>
        <h1 className={styles.title}>Boundary reached</h1>
        <div className={styles.sub}>This region is not rendered.</div>

        <div className={styles.coords}>
          <span className={styles.lab}>Coordinates</span>
          <div className={styles.coordRow}>
            <span className={styles.path}>{pathname}</span>
            <span className={styles.leader} aria-hidden="true" />
          </div>
          <span className={styles.lab}>Did not resolve</span>
        </div>

        <p className={styles.note}>No fault has been logged. You may return.</p>

        <div className={styles.actions}>
          <Link to="/" className={styles.home}>
            <span className={styles.glyph} aria-hidden="true">◀</span> Return to the Codex
          </Link>
          {up && (
            <Link to={up.to} className={styles.up}>
              <span className={styles.glyph} aria-hidden="true">◀</span> {up.label}
            </Link>
          )}
        </div>
      </section>
    </>
  )
}
