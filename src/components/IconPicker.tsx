/**
 * The icon picker, shared by every editor.
 *
 * SEARCH FIRST, because the library is 4180 glyphs. The old picker rendered its
 * whole palette as a grid, which worked at 69 icons and is unusable at sixty
 * times that: a wall you scroll rather than a set you choose from. So nothing
 * is listed until you type — matching docs/imgs/icon-search.png.
 *
 * THE RESULTS ARE A DROPDOWN, NOT A BLOCK. They float over whatever is beneath
 * rather than pushing the rest of the form down: a picker that reflows the page
 * every keystroke moves the field you are typing into.
 *
 * PORTALLED TO THE BODY, not absolutely positioned like the `.ac` autocomplete
 * this started as. Every host panel scrolls (`.popBody`, `.rScroll`, `.gpBody`),
 * and an absolute child of a scrolling box is CLIPPED by it — in the feature
 * editor the results were cut off at the popup's bottom border. `position:
 * fixed` in a portal escapes every ancestor's overflow, at the cost of having
 * to track the field: the rect is re-measured on scroll and resize, and the
 * panel flips above the field when there is no room below.
 *
 * BOTH SETS IN ONE FIELD. game-icons and Font Awesome are searched together and
 * tagged in the results, so the existing FA palette is not lost and adding more
 * FA names later needs no second control.
 *
 * The manifest is imported DYNAMICALLY: 4180 names are ~83KB that only a DM
 * authoring screen ever needs, and the player bundle should not carry them.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ICONS, GI_PREFIX, gameIconAuthor, iconLabel, iconMatches } from '../lib/icons'
import { Icon } from './Icon'
import styles from './IconPicker.module.css'

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ')

/** How many results to draw. Past this you are scrolling, not choosing — the
 *  answer is a better search term, which the count line nudges toward. */
const LIMIT = 60

export function IconPicker({ value, onPick, autoFocus, auto }: {
  value?: string
  onPick: (icon: string) => void
  autoFocus?: boolean
  /** The "no explicit icon" fallback, where one exists — the spell form derives
   *  a glyph from the school. Rendered INSIDE the chosen-icon row rather than as
   *  a chip above the picker: a separate control meant the spell editor showed
   *  two icons where every other editor shows one, and the picker stopped
   *  looking like the same component. */
  auto?: { icon: string; label: string }
}) {
  const [q, setQ] = useState('')
  const [gi, setGi] = useState<readonly string[] | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const fieldRef = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<{ left: number; top: number; width: number; flip: boolean } | null>(null)

  const term = q.trim().toLowerCase()

  const { rows, total } = useMemo(() => {
    if (!term) return { rows: [] as string[], total: 0 }
    const hits: string[] = []
    // Font Awesome first: it is the smaller, more familiar set, and an exact
    // word match there is almost always what was meant.
    for (const i of ICONS) if (iconMatches(i, term)) hits.push(i)
    for (const g of gi ?? []) if (iconMatches(GI_PREFIX + g, term)) hits.push(GI_PREFIX + g)
    return { rows: hits.slice(0, LIMIT), total: hits.length }
  }, [term, gi])

  // Loaded once, on first mount of any picker, and cached by the module system.
  useEffect(() => {
    let live = true
    void import('../lib/gameIconsManifest').then(m => { if (live) setGi(m.GAME_ICONS) })
    return () => { live = false }
  }, [])

  useEffect(() => { if (autoFocus) inputRef.current?.focus() }, [autoFocus])

  /* Clicking away closes the results. Without this the dropdown covers whatever
     you clicked TOWARD, which is worse than it never opening. The portalled
     panel is NOT inside wrapRef, so it has to be checked separately or clicking
     an icon would count as clicking away. */
  useEffect(() => {
    if (!q.trim()) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!wrapRef.current?.contains(t) && !popRef.current?.contains(t)) setQ('')
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [q])

  /* Track the field. Measured after paint so the panel's own height is known
     before deciding which way it opens, and re-measured on scroll because the
     host panels scroll underneath a fixed element that would otherwise stay
     put while the field moved away. */
  useLayoutEffect(() => {
    if (!q.trim()) { setBox(null); return }
    const place = () => {
      const f = fieldRef.current?.getBoundingClientRect()
      if (!f) return
      const h = popRef.current?.getBoundingClientRect().height ?? 240
      const below = window.innerHeight - f.bottom
      setBox({ left: f.left, top: f.bottom, width: f.width, flip: below < h + 12 && f.top > below })
    }
    place()
    window.addEventListener('scroll', place, true)   // capture: any scrolling ancestor
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [q, rows.length])

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <div className={styles.field} ref={fieldRef}>
        <i className={`fa-solid fa-magnifying-glass ${styles.mag}`} aria-hidden="true" />
        <input
          ref={inputRef}
          className={styles.in}
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setQ('') } }}
          placeholder="Search icons — sword, potion, aura…"
          aria-label="Search icons"
          autoComplete="off"
          spellCheck={false}
        />
        {q && (
        <button type="button" className={styles.clear} onClick={() => { setQ(''); inputRef.current?.focus() }} aria-label="Clear search">
          <i className="fa-solid fa-xmark" />
        </button>
        )}
      </div>

      {/* The dropdown, PORTALLED so no scrolling ancestor can clip it — the
          feature editor's popup was cutting it off at its bottom border.
          Positioned from the field's rect, flipping above when there is no room
          below. */}
      {term && createPortal(
        (
          <div
            ref={popRef}
            className={styles.pop}
            style={box
              ? {
                  left: box.left,
                  width: box.width,
                  ...(box.flip ? { bottom: window.innerHeight - box.top + 1 } : { top: box.top - 1 }),
                }
              : { opacity: 0, pointerEvents: 'none' }}
          >
            <div className={styles.meta}>
              {total === 0
                ? <>Nothing matches “{q.trim()}”</>
                : total > LIMIT ? <>showing {LIMIT} of {total} — keep typing to narrow</>
                  : <>{total} {total === 1 ? 'match' : 'matches'}</>}
            </div>
            {rows.length > 0 && (
              <div className={styles.grid}>
                {rows.map(i => (
                  <button
                    key={i}
                    type="button"
                    className={`${styles.cell}${i === value ? ' ' + styles.on : ''}`}
                    title={gameIconAuthor(i) ? `${iconLabel(i)} — by ${gameIconAuthor(i)}` : iconLabel(i)}
                    onClick={() => { onPick(i); setQ('') }}
                  >
                    <Icon name={i} />
                  </button>
                ))}
              </div>
            )}
          </div>
        ),
        document.body,
      )}

      {/* The selected icon sits directly under the search, and the rule below it
          closes the control off from whatever field comes next. The credit is
          here because CC BY 3.0 asks for it and this is where it is being
          chosen — not buried in a credits page nobody opens while authoring. */}
      <div className={styles.sel}>
        {value ? (
          <>
            <Icon name={value} className={styles.selIcon} />
            <span className={styles.selName}>{iconLabel(value)}</span>
            <span className={styles.selSrc}>
              {gameIconAuthor(value) ? <>game-icons.net · {gameIconAuthor(value)}</> : <>Font Awesome</>}
            </span>
            {auto && (
              <button type="button" className={styles.selAuto} onClick={() => onPick('')}
                title={`Go back to the automatic icon (${auto.label})`}>
                <i className="fa-solid fa-rotate-left" /> Auto
              </button>
            )}
          </>
        ) : auto ? (
          <>
            <Icon name={auto.icon} className={cx(styles.selIcon, styles.selAutoIcon)} />
            <span className={styles.selName}>{auto.label}</span>
            <span className={styles.selSrc}>Automatic</span>
          </>
        ) : (
          <span className={styles.selNone}>
            No icon chosen — type to search {gi ? (ICONS.length + gi.length).toLocaleString() : ICONS.length.toLocaleString()}
          </span>
        )}
      </div>
    </div>
  )
}
