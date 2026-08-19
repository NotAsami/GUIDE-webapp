/**
 * The icon picker, shared by every editor.
 *
 * SEARCH FIRST, because the library is 4180 glyphs. The old picker rendered its
 * whole palette as a grid, which worked at 69 icons and is unusable at sixty
 * times that: a wall you scroll rather than a set you choose from. So nothing
 * is listed until you type — matching docs/imgs/icon-search.png — and the
 * results row is the answer to a question rather than an inventory.
 *
 * BOTH SETS IN ONE FIELD. game-icons and Font Awesome are searched together and
 * tagged in the results, so the existing FA palette is not lost and adding more
 * FA names later needs no second control.
 *
 * The manifest is imported DYNAMICALLY: 4180 names are ~83KB that only a DM
 * authoring screen ever needs, and the player bundle should not carry them.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { ICONS, GI_PREFIX, gameIconAuthor, iconLabel } from '../lib/icons'
import { Icon } from './Icon'
import styles from './IconPicker.module.css'

/** How many results to draw. Past this you are scrolling, not choosing — the
 *  answer is a better search term, which the count line nudges toward. */
const LIMIT = 60

export function IconPicker({ value, onPick, autoFocus }: {
  value?: string
  onPick: (icon: string) => void
  autoFocus?: boolean
}) {
  const [q, setQ] = useState('')
  const [gi, setGi] = useState<readonly string[] | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Loaded once, on first mount of any picker, and cached by the module system.
  useEffect(() => {
    let live = true
    void import('../lib/gameIconsManifest').then(m => { if (live) setGi(m.GAME_ICONS) })
    return () => { live = false }
  }, [])

  useEffect(() => { if (autoFocus) inputRef.current?.focus() }, [autoFocus])

  const term = q.trim().toLowerCase()

  const { rows, total } = useMemo(() => {
    if (!term) return { rows: [] as string[], total: 0 }
    const hits: string[] = []
    // Font Awesome first: it is the smaller, more familiar set, and an exact
    // word match there is almost always what was meant.
    for (const i of ICONS) if (iconLabel(i).includes(term)) hits.push(i)
    for (const g of gi ?? []) if (iconLabel(GI_PREFIX + g).includes(term)) hits.push(GI_PREFIX + g)
    return { rows: hits.slice(0, LIMIT), total: hits.length }
  }, [term, gi])

  return (
    <div className={styles.wrap}>
      <div className={styles.field}>
        <i className={`fa-solid fa-magnifying-glass ${styles.mag}`} aria-hidden="true" />
        <input
          ref={inputRef}
          className={styles.in}
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search icons — sword, potion, aura…"
          aria-label="Search icons"
          autoComplete="off"
        />
        {q && (
          <button type="button" className={styles.clear} onClick={() => { setQ(''); inputRef.current?.focus() }} aria-label="Clear search">
            <i className="fa-solid fa-xmark" />
          </button>
        )}
      </div>

      <div className={styles.meta}>
        {!term
          ? <>Type to search {gi ? (ICONS.length + gi.length).toLocaleString() : ICONS.length.toLocaleString()} icons</>
          : total === 0
            ? <>Nothing matches “{q.trim()}”</>
            : <>{total > LIMIT ? <>showing {LIMIT} of {total} — keep typing to narrow</> : <>{total} {total === 1 ? 'match' : 'matches'}</>}</>}
      </div>

      {rows.length > 0 && (
        <div className={styles.grid}>
          {rows.map(i => (
            <button
              key={i}
              type="button"
              className={`${styles.cell}${i === value ? ' ' + styles.on : ''}`}
              title={gameIconAuthor(i) ? `${iconLabel(i)} — by ${gameIconAuthor(i)}` : iconLabel(i)}
              onClick={() => onPick(i)}
            >
              <Icon name={i} />
            </button>
          ))}
        </div>
      )}

      {/* The credit, at the point of use. CC BY 3.0 asks for "Icons made by
          {author}" and the folder name is the only record of who made which —
          so the selected icon says so rather than burying it in a credits page
          nobody opens while authoring. */}
      {value && (
        <div className={styles.sel}>
          <Icon name={value} className={styles.selIcon} />
          <span className={styles.selName}>{iconLabel(value)}</span>
          <span className={styles.selSrc}>
            {gameIconAuthor(value) ? <>game-icons.net · {gameIconAuthor(value)}</> : <>Font Awesome</>}
          </span>
        </div>
      )}
    </div>
  )
}
