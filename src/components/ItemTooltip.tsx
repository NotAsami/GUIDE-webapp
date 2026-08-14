/**
 * The app's one item tooltip. Extracted from Equipment during the Inventory
 * refactor so both screens hover-preview identically — the spec's "one gesture
 * app-wide" applies to the preview as much as to the popup.
 *
 * FACTS ONLY: name, category, rarity, weight, one key stat. No prose, no
 * buttons. It exists for scanning; anything you'd want to read or act on lives
 * in the item popup, one click away. (Put the description in here and you have
 * quietly rebuilt the persistent detail panel this refactor deleted.)
 *
 * Desktop: hover → tooltip → click → popup. Touch: tap → popup, no tooltip.
 * The suppression is CSS, gated on pointer capability rather than width.
 */

import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { ItemRarity } from '../lib/database.types'
import { renderInline } from '../lib/markdown'
import styles from './ItemTooltip.module.css'

export type TooltipData = {
  name: string
  sub?: string
  rows?: [string, string][]
  flavor?: string
  attune?: string
  rarity?: ItemRarity | 'empty'
}

export type Bind = (data: TooltipData) => {
  onMouseEnter: () => void
  onMouseLeave: () => void
  onFocus: () => void
  onBlur: () => void
}

/** Renders a single fixed element positioned to the right of the anchor (flips
 *  left when it would overflow), vertically centred and clamped to the viewport. */
export function useItemTooltip() {
  const [data, setData] = useState<TooltipData | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const anchorRef = useRef<DOMRect | null>(null)
  const ttRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!data || !anchorRef.current || !ttRef.current) return
    const r = anchorRef.current
    const { offsetWidth: w, offsetHeight: h } = ttRef.current
    const margin = 12
    let left = r.right + margin
    if (left + w > window.innerWidth - 12) left = r.left - w - margin
    left = Math.max(12, Math.min(left, window.innerWidth - w - 12))
    // Keep clear of the fixed top/bottom bars: the tooltip lives inside .main's
    // z-index:10 stacking context, so it can't paint over the bottombar
    // (z-index:50) — clamp it into the band between the bars instead.
    const cs = getComputedStyle(document.documentElement)
    const barTop = parseInt(cs.getPropertyValue('--bar-top-h')) || 62
    const barBottom = parseInt(cs.getPropertyValue('--bar-bottom-h')) || 50
    let top = r.top + r.height / 2 - h / 2
    top = Math.max(barTop + margin, Math.min(top, window.innerHeight - barBottom - h - margin))
    setPos({ left, top })
  }, [data])

  const bind = useCallback<Bind>(d => {
    const show = (e: { currentTarget: Element }) => {
      anchorRef.current = e.currentTarget.getBoundingClientRect()
      setPos(null)
      setData(d)
    }
    return {
      onMouseEnter: show as unknown as () => void,
      onMouseLeave: () => setData(null),
      onFocus: show as unknown as () => void,
      onBlur: () => setData(null),
    }
  }, [])

  /** Dismiss without waiting for a mouseleave — e.g. when a popup opens over it. */
  const hide = useCallback(() => setData(null), [])

  const tooltip = (
    <div
      ref={ttRef}
      className={`${styles.tt}${data && pos ? ' ' + styles.show : ''}`}
      data-rarity={data?.rarity ?? 'common'}
      role="tooltip"
      aria-hidden={!data}
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
    >
      {data && (
        <>
          <div className={styles.ttName}>{data.name}</div>
          {data.sub && <div className={styles.ttSub}>{data.sub}</div>}
          {(data.rows ?? []).map(([k, v], i) => (
            <div key={i} className={styles.ttRow}><span className={styles.k}>{k}</span><span className={styles.v}>{v}</span></div>
          ))}
          {data.flavor && <div className={styles.ttFlavor}>{renderInline(data.flavor)}</div>}
          {data.attune && (
            <div className={`${styles.ttAttune}${/^not|^none/i.test(data.attune) ? ' ' + styles.no : ''}`}>Attuned: {data.attune}</div>
          )}
        </>
      )}
    </div>
  )

  return { tooltip, bind, hide }
}
