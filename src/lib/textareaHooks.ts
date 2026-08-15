/** Textarea behaviour every DM editor pane needs, lifted out of ShardLattice so
 *  the Feature Editor does not re-derive it. Both exist because a textarea inside
 *  an `overflow-y: auto` panel misbehaves in two ways that are not obvious until
 *  someone reports the panel "jumping". */
import { useEffect, useRef } from 'react'

/** Stops a textarea's wheel gesture being stolen by the scroll panel around it.
 *
 *  Must be a native listener with `{ passive: false }`: React's `onWheel` is
 *  registered passive, so `preventDefault()` inside it is a silent no-op. */
export function useNoScrollChain() {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      // 110%-zoom subpixel rounding can make scrollHeight-clientHeight read as
      // 1-2px even when the field has no real overflow, which used to trip the
      // boundary check into thinking there was room to scroll — capturing the
      // event, moving scrollTop by that same 1-2px, then eating the rest of the
      // gesture instead of letting it chain to the panel. Below this tolerance,
      // don't intercept at all.
      const range = el.scrollHeight - el.clientHeight
      if (range <= 2) return
      const atTop = e.deltaY < 0 && el.scrollTop <= 0
      const atBottom = e.deltaY > 0 && el.scrollTop >= range
      if (atTop || atBottom) return
      el.scrollTop += e.deltaY
      e.stopPropagation()
      e.preventDefault()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])
  return ref
}

/** Auto-grows a textarea to fit its content, up to the CSS `max-height` cap where
 *  `overflow-y: auto` takes over — so the field is only scrollable when the text
 *  genuinely overflows, not by default just because it is a fixed-height box. The
 *  inline height is clamped to that same cap in JS rather than left at the full
 *  scrollHeight for CSS to visually clip, keeping the element's real size equal to
 *  what is rendered. Wires up the wheel fix on the same ref, since every such
 *  field needs both. */
export function useAutoGrow(value: string) {
  const ref = useNoScrollChain()
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    const cap = parseFloat(getComputedStyle(el).maxHeight)
    const target = Number.isFinite(cap) ? Math.min(el.scrollHeight, cap) : el.scrollHeight
    el.style.height = `${target}px`
  }, [value, ref])
  return ref
}
