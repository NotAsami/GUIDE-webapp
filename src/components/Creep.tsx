import { useEffect, useRef, useState } from 'react'
import { useLive } from '../lib/markdown'
import { creep, plainText } from '../lib/loreDoc'
import styles from './Creep.module.css'

const TICK_MS = 140

/** A memory G.U.I.D.E. is taking: the section's text with its letters falling
 *  to amber 1s and 0s, `remaining` percent still in ink. The frontier flickers
 *  while it is on screen; offscreen, or with reduced motion, it holds still.
 *
 *  The text goes through the same `{variable}` resolution as Prose FIRST, then
 *  loses its markdown — the creep works on the letters a reader sees, and a `**`
 *  falling to a 1 would be a bit of syntax, not of memory. A quote (`>`) keeps
 *  its shape; its attribution line is part of what is being lost. */
export function Creep({ text, remaining }: { text: string; remaining: number }) {
  const live = useLive(text)
  const ref = useRef<HTMLDivElement>(null)
  const [tick, setTick] = useState(0)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting))
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    // Nothing to animate at the ends: 100% is pure ink, 0% pure bits.
    if (!visible || still || remaining >= 100 || remaining <= 0) return
    const id = window.setInterval(() => setTick(t => t + 1), TICK_MS)
    return () => window.clearInterval(id)
  }, [visible, remaining])

  // One running letter index across paragraphs, so the same letter keeps the
  // same threshold wherever the paragraph breaks fall.
  let offset = 0
  const paras = live.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean).map(p => {
    const quote = /^>/.test(p)
    const words = plainText(quote ? p.split('\n').map(l => l.replace(/^>\s?/, '')).join(' ') : p)
    const runs = creep(words, remaining, tick, offset)
    offset += words.length + 1
    return { quote, runs }
  })

  return (
    <div ref={ref} className={styles.creep} aria-label={`A memory, ${remaining}% intact`}>
      {paras.map((p, i) => (
        // The markdown (and with it the author's *italics*) is gone by here, so a
        // quote asks for the voice register rather than setting a slant itself.
        <p key={i} className={p.quote ? `${styles.quote} prose-voice` : undefined}>
          {p.runs.map((r, j) => r.bit
            ? <span key={j} className={r.hot ? `${styles.bit} ${styles.hot}` : styles.bit} aria-hidden="true">{r.t}</span>
            : <span key={j}>{r.t}</span>)}
        </p>
      ))}
    </div>
  )
}
