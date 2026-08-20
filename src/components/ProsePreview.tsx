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

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Prose } from '../lib/markdown'
import styles from './ProsePreview.module.css'

/** The left edge this popover will actually be cut off at.
 *
 *  NOT the viewport. The editor's form sits in a scrolling panel that starts a
 *  third of the way across the window, and a popover overflowing THAT is
 *  clipped just as hard while still being nowhere near the window edge — which
 *  is what a naive `rect.left < 0` check misses entirely. */
function clipLeftOf(el: HTMLElement): number {
  for (let n = el.parentElement; n; n = n.parentElement) {
    const o = getComputedStyle(n)
    if (/auto|scroll|hidden|clip/.test(o.overflowX + o.overflowY)) return n.getBoundingClientRect().left
  }
  return 0
}

export function ProsePreview({ text, label = 'Preview' }: {
  text: string
  /** Overridable for fields where "as the player reads it" is not literally
   *  the framing — a shop greeting, a session recap. */
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const [flip, setFlip] = useState(false)
  const wrap = useRef<HTMLSpanElement>(null)
  const pop = useRef<HTMLSpanElement>(null)

  /* WHICH SIDE IT OPENS ON, measured rather than assumed.
   *
   *  Right-anchoring is correct for a button at the end of a wide row, which is
   *  where the first six of these live. Put one in the Feature Editor's section
   *  header and the button sits a third of the way across a narrower panel, so
   *  a 460px popover hanging off its right edge runs past the panel's left edge
   *  and gets clipped — heading cut in half, prose cut down the side.
   *
   *  So: place it, look at where it actually landed, and flip it if it fell off.
   *  useLayoutEffect, not useEffect, so the correction happens before paint and
   *  nobody sees it jump. Flipping only ever sets `true`, so the re-measure it
   *  triggers cannot bounce back and loop. */
  useLayoutEffect(() => {
    if (!open) { setFlip(false); return }
    const el = pop.current
    if (!el) return
    if (el.getBoundingClientRect().left < clipLeftOf(el) + 8) setFlip(true)
  }, [open])

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
        <span ref={pop} className={flip ? `${styles.pop} ${styles.popLeft}` : styles.pop}
          role="dialog" aria-label="Player preview">
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
