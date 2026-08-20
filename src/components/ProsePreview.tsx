/**
 * "See it as the player does" — a preview of an authored description, rendered
 * through the same `<Prose>` the player screens use.
 *
 * WHY IT IS THE REAL RENDERER AND NOT A LOOKALIKE. The whole value is that what
 * you see here is what they get, so this imports `Prose` rather than
 * reimplementing markdown. A preview that renders `[Mercy]{radiant}` its own
 * way would be worse than no preview: it would be confidently wrong about the
 * one thing you opened it to check.
 *
 * A POPOVER, not an inline expansion. The textarea it belongs to is often near
 * the bottom of a long form, and pushing the page down to make room moves the
 * field you were typing in.
 */

import { useEffect, useRef, useState } from 'react'
import { Prose } from '../lib/markdown'
import styles from './ProsePreview.module.css'

export function ProsePreview({ text, label = 'Preview' }: {
  text: string
  /** Overridable for fields where "as the player reads it" is not literally
   *  the framing — a shop greeting, a session recap. */
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const empty = !text?.trim()

  return (
    <span className={styles.wrap} ref={wrap}>
      <button
        type="button"
        className={styles.btn}
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        title={empty ? 'Nothing written yet' : 'Show this as the player reads it'}
      >
        <i className={`fa-solid ${open ? 'fa-eye-slash' : 'fa-eye'}`} /> {label}
      </button>

      {open && (
        <span className={styles.pop} role="dialog" aria-label="Player preview">
          <span className={styles.head}>
            <i className="fa-solid fa-user" />
            <span className={styles.t}>As the player reads it</span>
            <button type="button" className={styles.x} onClick={() => setOpen(false)} aria-label="Close preview">
              <i className="fa-solid fa-xmark" />
            </button>
          </span>
          <span className={styles.body}>
            {empty
              ? <span className={styles.none}>Nothing written yet.</span>
              : <Prose text={text} className={styles.prose} />}
          </span>
        </span>
      )}
    </span>
  )
}
