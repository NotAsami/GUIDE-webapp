/**
 * Pan and zoom for a node canvas: a stage element with a child transformed by
 * `translate(x, y) scale(z)` from `transform-origin: 0 0`.
 *
 * ShardLattice and ShardTree each carry a copy of this (not migrated yet). This
 * one fixes what those copies get wrong:
 *
 *  - The wheel listener is attached with `{ passive: false }`. React's `onWheel`
 *    is passive, so `preventDefault()` there is a silent no-op and the page
 *    scrolls under the canvas while it zooms.
 *  - Pan and zoom are ONE state. Two setters meant a burst of wheel ticks read a
 *    stale pan with a fresh zoom, and the point under the cursor drifted.
 *  - A drag that pans reports `wasDrag()`, so the click the browser fires on
 *    pointerup can be ignored instead of deselecting what you were looking at.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

export type View = { x: number; y: number; z: number }
export type Box = { x0: number; y0: number; x1: number; y1: number }

/** Zoom by `k` keeping the stage point (ox, oy) fixed under the cursor. */
export function zoomView(v: View, k: number, ox: number, oy: number, min: number, max: number): View {
  const z = Math.min(max, Math.max(min, v.z * k))
  return { z, x: ox - ((ox - v.x) * z) / v.z, y: oy - ((oy - v.y) * z) / v.z }
}

/** The view that centres `box` in a `w`×`h` stage, `pad` from every edge. */
export function fitView(box: Box, w: number, h: number, pad: number, min: number, max: number): View {
  const bw = Math.max(1, box.x1 - box.x0), bh = Math.max(1, box.y1 - box.y0)
  const z = Math.min(max, Math.max(min, Math.min((w - 2 * pad) / bw, (h - 2 * pad) / bh)))
  return { z, x: (w - bw * z) / 2 - box.x0 * z, y: (h - bh * z) / 2 - box.y0 * z }
}

export function usePanZoom({ min = 0.25, max = 2.2, fitMax = 1.15, skip }: {
  min?: number
  max?: number
  /** The most `fit` may zoom in. The graph caps it so a two-node feature does
   *  not balloon; a shard tree is meant to fill its stage, so passes its max. */
  fitMax?: number
  /** A pointerdown on this target starts no pan (a node, a port, a button). */
  skip?: (target: Element) => boolean
} = {}) {
  /* A CALLBACK ref, and the element in state. A stage that mounts after the
     hook does — the Shard Lattice renders a loading placeholder first — would
     otherwise never get its wheel listener: an effect keyed on a ref object
     runs once, while the ref is still empty. */
  const node = useRef<HTMLDivElement | null>(null)
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const ref = useCallback((n: HTMLDivElement | null) => { node.current = n; setEl(n) }, [])
  const [view, setView] = useState<View>({ x: 0, y: 0, z: 1 })
  const [grabbing, setGrabbing] = useState(false)
  const viewRef = useRef(view)
  viewRef.current = view
  const dragged = useRef(false)

  const zoomAt = useCallback((k: number, ox?: number, oy?: number) => {
    const r = node.current?.getBoundingClientRect()
    setView(v => zoomView(v, k, ox ?? (r ? r.width / 2 : 0), oy ?? (r ? r.height / 2 : 0), min, max))
  }, [min, max])

  /** Fit a world box, zooming in no further than `fitMax`. */
  const fit = useCallback((box: Box, pad = 48, coveredRight = 0) => {
    const r = node.current?.getBoundingClientRect()
    if (!r || !r.width || !r.height) return
    // A panel floating over the right edge (an inspector) is not stage.
    setView(fitView(box, Math.max(200, r.width - coveredRight), r.height, pad, min, Math.min(max, fitMax)))
  }, [min, max, fitMax])

  /** Centre a world point without changing the zoom. */
  const centreOn = useCallback((wx: number, wy: number, coveredRight = 0) => {
    const r = node.current?.getBoundingClientRect()
    if (!r) return
    setView(v => ({ ...v, x: (r.width - coveredRight) / 2 - wx * v.z, y: r.height / 2 - wy * v.z }))
  }, [])

  useEffect(() => {
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [el, zoomAt])

  const onPointerDown = useCallback((e: ReactPointerEvent) => {
    if (e.button !== 0 || (skip && skip(e.target as Element))) return
    const start = viewRef.current, sx = e.clientX, sy = e.clientY
    dragged.current = false
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy
      if (!dragged.current && Math.abs(dx) + Math.abs(dy) < 4) return
      dragged.current = true
      setGrabbing(true)
      setView({ ...start, x: start.x + dx, y: start.y + dy })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setGrabbing(false)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }, [skip])

  /** A client (screen) point in world coordinates. */
  const toWorld = useCallback((cx: number, cy: number): [number, number] => {
    const r = node.current?.getBoundingClientRect(), v = viewRef.current
    return r ? [(cx - r.left - v.x) / v.z, (cy - r.top - v.y) / v.z] : [0, 0]
  }, [])

  /** `ref` goes on the stage; `node` reads it; `el` changes when it mounts. */
  return { ref, node, el, view, zoomAt, fit, centreOn, toWorld, onPointerDown, grabbing, wasDrag: () => dragged.current }
}
