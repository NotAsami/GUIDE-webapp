/**
 * Stop the wallpaper moving while something is on top of it.
 *
 * THE BUG THIS EXISTS FOR. A `backdrop-filter: blur()` is cheap over a STATIC
 * backdrop — the compositor blurs once and caches. It is ruinous over a moving
 * one: every changed pixel underneath invalidates the cache, so the whole
 * viewport is gaussian-blurred again, every frame, forever. The Codex has a
 * 640×640 sigil on two infinite rotations behind it, so opening a scrimmed
 * panel there pinned the GPU at ~60% to blur a glyph nobody could see.
 *
 * So: while a scrim is up, mark the document and let the decorations under it
 * pause themselves (`animation-play-state: paused`). Paused animations stop
 * producing frames, the blur caches, and the cost falls back to nothing.
 *
 * REF-COUNTED, and that is the whole subtlety. The player path stacks two
 * panels — the decisions card, then the level-up over it — and a plain boolean
 * would unfreeze the moment the inner one closed, while the outer scrim is
 * still up. Closing the last one is what thaws it.
 *
 * Decorative animation only. Nothing here should gate anything a user is
 * waiting on: a paused spinner is a lie about whether work is happening.
 */
import { useEffect } from 'react'

const ATTR = 'data-modal'

let depth = 0

/** Freeze now; call the returned function to release this holder's claim. */
export function freezeBackdrop(): () => void {
  depth += 1
  document.documentElement.setAttribute(ATTR, '')
  let released = false
  return () => {
    // Guard the double-release: React 18 StrictMode mounts effects twice in
    // dev, and a cleanup that ran once already must not take the count negative
    // — that would leave the attribute stuck on and the glyph frozen for good.
    if (released) return
    released = true
    depth = Math.max(0, depth - 1)
    if (depth === 0) document.documentElement.removeAttribute(ATTR)
  }
}

/** The hook form: frozen for as long as this component is mounted and `active`. */
export function useBackdropFreeze(active = true): void {
  useEffect(() => {
    if (!active) return
    return freezeBackdrop()
  }, [active])
}
