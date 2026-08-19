/**
 * The key/value/hint hover strip.
 *
 * Lifted out of RollContextPanel, where it was written for the roll modifiers,
 * because the party HUD wants the SAME popup on its status pips — and the one
 * thing worse than two tooltip implementations is three. (`useItemTooltip` is
 * the other one and stays separate on purpose: it is a facts-only item CARD
 * that parks to the right of its anchor, a different shape for a different job.)
 *
 * Three slots, in this order:
 *   k     the label, mono caps
 *   v     what it is
 *   hint  the caveat, optional
 *
 * Rendered through a portal to document.body so it escapes any `overflow:
 * hidden` or stacking context its anchor happens to live in — the party HUD row
 * clips its own content, and a tooltip drawn inside it would be sliced off.
 */

import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import styles from './Tip.module.css'

export type TipData = { k: string; v: ReactNode; hint?: string | null }
export type Tip = TipData & { rect: DOMRect }
export type ShowTip = (t: (TipData & { rect?: DOMRect }) | null) => void

function TipLayer({ tip }: { tip: Tip | null }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !tip) return
    // Measured AFTER the content is in, or the flip decision uses a stale height.
    const t = el.getBoundingClientRect()
    const top = tip.rect.top - t.height - 8
    el.style.top = `${top < 8 ? tip.rect.bottom + 8 : top}px`
    el.style.left = `${Math.max(8, Math.min(tip.rect.left - 6, window.innerWidth - t.width - 12))}px`
  }, [tip])
  if (!tip) return null
  return createPortal(
    <div ref={ref} className={`${styles.tip} ${styles.show}`} role="tooltip">
      <div className={styles.tK}>{tip.k}</div>
      <div className={styles.tV}>{tip.v}</div>
      {tip.hint && <div className={styles.tHint}>{tip.hint}</div>}
    </div>,
    document.body,
  )
}

/** Bind a tooltip to an element: hover AND focus, so a keyboard reaches it. */
export function tipProps(show: ShowTip, data: () => TipData) {
  const open = (e: { currentTarget: HTMLElement }) =>
    show({ ...data(), rect: e.currentTarget.getBoundingClientRect() })
  return { onMouseEnter: open, onFocus: open, onMouseLeave: () => show(null), onBlur: () => show(null) }
}

/** Owns the state and the layer. Spread `bind(() => ({ k, v }))` on an anchor,
 *  and render `layer` once anywhere in the tree. */
export function useTip() {
  const [tip, setTip] = useState<Tip | null>(null)
  const showTip = useCallback<ShowTip>(t => setTip(t as Tip | null), [])
  const bind = useCallback((data: () => TipData) => tipProps(showTip, data), [showTip])
  return { tip, showTip, bind, layer: <TipLayer tip={tip} /> }
}
