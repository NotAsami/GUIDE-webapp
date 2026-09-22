import { useEffect, useState } from 'react'
import { FRAME, SETTLE, noise } from '../lib/resolve'
import styles from './Resolve.module.css'

/**
 * The resolve's clock: epoch ms, ticking on animation frames until `until` (the
 * roll's last lock), once more when the last settle has played, then still.
 *
 * Under reduced motion it is Infinity from the first paint — every value is
 * already past its lock, so the number simply appears, the dropped die already
 * dimmed. That is the whole reduced-motion path; nothing else checks.
 */
export function useResolveClock(until: number): number {
  const [reduce] = useState(() =>
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (reduce || Date.now() >= until + SETTLE) return
    let raf = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = () => {
      const n = Date.now()
      setNow(n)
      if (n < until) raf = requestAnimationFrame(tick)
      // One last tick so the settle classes come off. Left on, remounting the
      // value (unfolding the entry) would replay its flash.
      else if (n < until + SETTLE) timer = setTimeout(tick, until + SETTLE - n)
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); clearTimeout(timer) }
  }, [until, reduce])
  return reduce ? Infinity : now
}

/**
 * One resolving number. The REAL value is in the DOM from frame 0, invisible
 * until `lockAt`; the noise over it is aria-hidden. So a live region announces
 * the result once, a copy copies it, and the lock swaps paint, never layout —
 * the hidden glyph has been holding its exact width all along.
 */
export function Val({ v, lockAt, now, seed, tone }: {
  v: number | string
  lockAt: number
  now: number
  seed: number
  /** The kept d20's natural face: a flare for a 20, a stutter for a 1. */
  tone?: 'nat20' | 'nat1'
}) {
  const text = String(v)
  const noisy = now < lockAt
  const settling = !noisy && now - lockAt < SETTLE
  return (
    <span className={[styles.val, noisy && styles.noisy, settling && styles.lock, settling && tone && styles[tone]]
      .filter(Boolean).join(' ')}>
      <span className={styles.real}>{text}</span>
      {noisy && <span className={styles.noise} aria-hidden="true">{noise(text.length, seed, Math.floor(now / FRAME))}</span>}
    </span>
  )
}
