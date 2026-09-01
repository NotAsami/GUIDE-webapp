/**
 * The icon-insert affordance for every prose field, mounted once per authoring
 * screen.
 *
 * WHY IT FLOATS RATHER THAN SITTING IN EACH FIELD. There are twenty prose
 * fields across the console, the feature editor, the shard lattice and the shop
 * editor, and not one of them shares a wrapper — each is a bare `<textarea>`
 * with its own setter. Giving every one a real toolbar means twenty pieces of
 * markup to keep in step, and the twenty-first is written without one. A single
 * button that follows the focused field is the same affordance for a twentieth
 * of the surface area, and a new field gets it by being marked `data-prose`.
 *
 * It rides alongside the authoring screens in routes.tsx exactly the way
 * CatalogSearch does, for the same reason: three screens need it and none of
 * them should have to know it exists.
 *
 * HOW THE VALUE GETS BACK INTO REACT. The toolbar knows the focused element and
 * nothing else — it cannot call a setter it was never handed. So it writes
 * through the native `value` setter and dispatches a real `input` event, which
 * is the same path a keystroke takes: React's synthetic handler fires, the
 * field's own `onChange` runs, and the draft autosaves as if the DM had typed
 * the token. Assigning `el.value` directly would NOT do this — React's
 * value-tracker sees no change and swallows the event.
 *
 * THE CARET IS CAPTURED ON MOUSEDOWN, before anything can steal focus. The
 * picker's own search input takes focus the moment it opens, so by the time an
 * icon is chosen the textarea is long since blurred and its selection is stale.
 * `preventDefault` on mousedown keeps the field focused for the common case;
 * the captured range is what makes the uncommon one correct anyway.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconPicker } from './IconPicker'
import { insertIcon } from '../lib/markdown'
import styles from './ProseToolbar.module.css'

/** A field that accepts markdown, marked by `proseField()` in textareaHooks. */
type Field = HTMLTextAreaElement | HTMLInputElement

const isProse = (el: Element | null): el is Field =>
  !!el && (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) && el.dataset.prose !== undefined

/** Write as a keystroke would, so React sees it. */
function typeInto(el: Field, next: string, caret: number) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  setter?.call(el, next)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  /* After React re-renders from the new value the caret resets to the end, so
     it has to be re-applied on the far side of that paint — the same dance
     markdownShortcuts does for Ctrl+B, and deliberately the same shape.
     Focus first, then the caret: the picker's search box held focus until it
     unmounted, so the field has to take it back before a selection means
     anything. */
  requestAnimationFrame(() => {
    el.focus()
    el.setSelectionRange(caret, caret)
  })
}

export function ProseToolbar() {
  const [field, setField] = useState<Field | null>(null)
  const [box, setBox] = useState<{ top: number; left: number } | null>(null)
  const [open, setOpen] = useState(false)
  /* The selection as it was when the button was pressed. Read at mousedown
     rather than at pick time because opening the picker moves focus. */
  const range = useRef<[number, number]>([0, 0])
  /* Read inside the focus listener, which is registered once and must not see
     a stale `open` from the render it closed over. */
  const openRef = useRef(false)
  openRef.current = open

  /* Follow focus. `focusin`/`focusout` rather than focus/blur, because the
     plain events do not bubble to the document. */
  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      const t = e.target as Element | null
      if (isProse(t)) { setField(t); setOpen(false) }
    }
    const onBlur = (e: FocusEvent) => {
      // Moving into the toolbar itself is not leaving the field.
      const to = e.relatedTarget as Element | null
      if (to?.closest(`.${styles.bar}`)) return
      if (isProse(e.target as Element)) setTimeout(() => { if (!openRef.current) setField(null) }, 0)
    }
    document.addEventListener('focusin', onFocus)
    document.addEventListener('focusout', onBlur)
    return () => {
      document.removeEventListener('focusin', onFocus)
      document.removeEventListener('focusout', onBlur)
    }
  }, [])

  /* Sit at the field's top-right corner, re-measured on scroll because every
     authoring pane scrolls under a fixed element. */
  const place = useCallback(() => {
    if (!field) { setBox(null); return }
    const r = field.getBoundingClientRect()
    /* CLAMPED INTO THE VIEWPORT, because the field's right edge is regularly
       outside it. The node editor's pane is wider than the window at anything
       under about 1600px, so anchoring naively to `r.right` put the button
       past the screen edge — present in the DOM, focused, and invisible. The
       same class of mistake as measuring a popover against the viewport when a
       scrolling ancestor is what actually clips it.
       Never left of the field's own left edge either, or on a narrow field the
       button would sit outside the box it belongs to. */
    const left = Math.max(r.left + 2, Math.min(r.right, window.innerWidth - 6) - 26)
    // Scrolled out of the pane entirely: no anchor, so nothing to offer.
    if (r.bottom < 0 || r.top > window.innerHeight) { setBox(null); return }
    setBox({ top: Math.max(r.top - 3, 4), left })
  }, [field])

  useLayoutEffect(() => {
    place()
    if (!field) return
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [field, place])

  if (!field || !box) return null

  const pick = (name: string) => {
    if (!name) return
    const [from, to] = range.current
    const r = insertIcon(field.value, from, to, name)
    typeInto(field, r.text, r.start)
    setOpen(false)
  }

  return createPortal(
    <div className={styles.bar} style={{ top: box.top, left: box.left }}>
      <button
        type="button"
        className={`${styles.btn}${open ? ' ' + styles.on : ''}`}
        title="Insert an icon — wraps the selection as its label"
        aria-label="Insert an icon"
        aria-expanded={open}
        onMouseDown={e => {
          // Hold the field's focus AND its caret before the click lands.
          e.preventDefault()
          range.current = [field.selectionStart ?? 0, field.selectionEnd ?? 0]
        }}
        onClick={() => setOpen(o => !o)}
      >
        <i className="fa-solid fa-icons" aria-hidden="true" />
      </button>

      {open && (
        <div className={styles.pop}>
          <IconPicker value="" onPick={pick} autoFocus />
          <button type="button" className={styles.close} onClick={() => setOpen(false)}>
            <i className="fa-solid fa-xmark" aria-hidden="true" /> Close
          </button>
        </div>
      )}
    </div>,
    document.body,
  )
}
