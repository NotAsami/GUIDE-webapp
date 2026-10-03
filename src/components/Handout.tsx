import { ManagedImage } from './ManagedImage'
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { HandoutRow } from '../lib/database.types'
import { Prose } from '../lib/markdown'
import { FRAME, noise } from '../lib/resolve'
import styles from './Handout.module.css'

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ')

/* THE DECRYPTION — the dice resolve's cipher, run across a page of prose.
   One sweep for any length: a short note and a long letter both land in SWEEP,
   so the effect never becomes the thing the player waits on. A FRONT-wide band
   of glyphs leads; behind it is ink, ahead of it the text is already laid out
   in transparent ink, so no line ever moves while it resolves. */
const SWEEP = 1600
const FRONT = 16

function sweepAt(t: number, total: number) {
  const head = Math.min(total + FRONT, Math.floor((Math.max(0, t) / SWEEP) * (total + FRONT)))
  return { settled: Math.max(0, head - FRONT), head, done: head >= total + FRONT }
}

/** Runs the sweep over the text inside `hosts`, as one sequence.
 *
 *  React owns those elements, so nothing of theirs is touched: each host gets an
 *  overlay CLONE of its own content, split into one span per character, and the
 *  original is hidden underneath until the sweep ends. Kerning and ligatures are
 *  off on the paper (Handout.module.css) so the split clone lays out exactly
 *  like the original — without that, the swap at the end would nudge a line.
 *
 *  The clock starts on the first painted frame, not on mount: a push that lands
 *  while the player is in another tab decrypts when they come back to it. */
function useDecrypt(hosts: RefObject<HTMLElement>[], on: boolean, runKey: string, onDone?: () => void) {
  const doneRef = useRef(onDone)
  doneRef.current = onDone
  useLayoutEffect(() => {
    const els = hosts.map(r => r.current).filter((e): e is HTMLElement => !!e)
    if (!on || !els.length || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      doneRef.current?.()
      return
    }
    const chars: HTMLSpanElement[] = []
    const layers = els.map(host => {
      const layer = document.createElement('div')
      layer.className = styles.dcLayer
      layer.setAttribute('aria-hidden', 'true')
      for (const n of Array.from(host.childNodes)) layer.appendChild(n.cloneNode(true))
      const walk = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT)
      const texts: Text[] = []
      while (walk.nextNode()) texts.push(walk.currentNode as Text)
      for (const t of texts) {
        const frag = document.createDocumentFragment()
        for (const ch of t.data) {
          if (/\s/.test(ch)) { frag.appendChild(document.createTextNode(ch)); continue }
          const s = document.createElement('span')
          s.className = styles.dcAhead
          s.textContent = ch
          frag.appendChild(s)
          chars.push(s)
        }
        t.replaceWith(frag)
      }
      host.classList.add(styles.dcOn)
      host.appendChild(layer)
      return { host, layer }
    })

    let raf = 0
    let t0: number | null = null
    let from = 0
    const finish = () => {
      for (const { host, layer } of layers) { layer.remove(); host.classList.remove(styles.dcOn) }
    }
    const tick = (now: number) => {
      t0 ??= now
      const { settled, head, done } = sweepAt(now - t0, chars.length)
      const frame = Math.floor((now - t0) / FRAME)
      for (let i = from; i < Math.min(head, chars.length); i++) {
        const s = chars[i]
        if (i < settled) { s.className = ''; continue }
        s.className = styles.dcGlyph
        s.dataset.g = noise(1, i, frame)
      }
      from = settled
      if (done) { finish(); doneRef.current?.(); return }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); finish() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, runKey])
}

/** The handout as a physical page. `arrive` runs the decryption and develops
 *  the image; without it the page is simply there — the Journal, like the dice
 *  history, never replays an arrival. */
export function HandoutPage({ h, arrive = false, onSettled, onEnlarge }: {
  h: HandoutRow
  arrive?: boolean
  onSettled?: () => void
  onEnlarge?: () => void
}) {
  const titleRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [broken, setBroken] = useState(false)
  useDecrypt([titleRef, bodyRef], arrive, `${h.id}@${h.pushed_at}`, onSettled)
  useEffect(() => setBroken(false), [h.image_url])

  return (
    <div className={styles.frame}>
      <span className={cx(styles.corner, styles.tl)} aria-hidden="true" />
      <span className={cx(styles.corner, styles.tr)} aria-hidden="true" />
      <span className={cx(styles.corner, styles.bl)} aria-hidden="true" />
      <span className={cx(styles.corner, styles.br)} aria-hidden="true" />
      <div className={styles.tilt}>
        <div className={styles.paper}>
          <div className={styles.dc} ref={titleRef}>
            <h2 className={styles.title}>{h.title || 'Untitled'}</h2>
          </div>
          {h.image_url && (
            <figure className={cx(styles.print, arrive && styles.develop)}>
              {broken ? (
                <div className={styles.broken}>Image could not be loaded</div>
              ) : (
                <ManagedImage src={h.image_url} alt={h.title} onError={() => setBroken(true)} />
              )}
              <span className={styles.veil} aria-hidden="true" />
              <span className={styles.beam} aria-hidden="true" />
              {onEnlarge && !broken && (
                <button type="button" className={styles.enlarge} onClick={onEnlarge} aria-label="Enlarge image">
                  <i className="fa-solid fa-expand" aria-hidden="true" />
                </button>
              )}
            </figure>
          )}
          {h.body.trim() && (
            <div className={styles.dc} ref={bodyRef}>
              {/* <Prose>, never printed raw — authored through proseField. */}
              <Prose text={h.body} className={cx(styles.prose, h.image_url && styles.caption)} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const clock = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '')

/** The handout beside the game, never over it: a dock on the right edge with no
 *  scrim, so a player mid-fight reads it when they have a moment. */
export function HandoutDock({ h, arrive, onClose, onJournal }: {
  h: HandoutRow
  arrive: boolean
  onClose: () => void
  onJournal: () => void
}) {
  // No reset effect: Layout keys the dock by push, so a new arrival remounts.
  const [decrypting, setDecrypting] = useState(arrive)
  const [enlarged, setEnlarged] = useState(false)

  return (
    <aside className={styles.dock} aria-label={h.title || 'Handout'}>
      <div className={styles.head}>
        <div className={styles.headTx}>
          <div className={styles.eyebrow}>
            <span className={styles.tick} aria-hidden="true" />
            {arrive ? (h.image_url ? 'Incoming Image' : 'Incoming Document') : 'Handout'}
            <span className={styles.dim}>// from the Operator</span>
          </div>
          <div className={styles.meta}>
            {clock(h.pushed_at ?? h.created_at)}
            <span className={styles.sep}>·</span>
            {decrypting ? <span className={styles.acc}>Decrypting</span> : 'Filed to Journal'}
          </div>
        </div>
        <button type="button" className={styles.x} onClick={onClose} aria-label="Dismiss">
          <i className="fa-solid fa-xmark" aria-hidden="true" />
        </button>
      </div>
      <div className={styles.body}>
        <HandoutPage h={h} arrive={arrive} onSettled={() => setDecrypting(false)} onEnlarge={() => setEnlarged(true)} />
      </div>
      <div className={styles.foot}>
        <button type="button" className={styles.ghost} onClick={onJournal}>Open in Journal</button>
        <button type="button" className={styles.primary} onClick={onClose}>Dismiss</button>
      </div>
      {enlarged && <Enlarged h={h} onClose={() => setEnlarged(false)} />}
    </aside>
  )
}

/** The one handout view that covers the app — and only because the player
 *  asked for it. The image, whole, as large as the window allows. */
function Enlarged({ h, onClose }: { h: HandoutRow; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <div className={styles.lightbox} role="dialog" aria-modal="true" aria-label={h.title || 'Handout image'} onClick={onClose}>
      <ManagedImage src={h.image_url} alt={h.title} onClick={e => e.stopPropagation()} />
      <button type="button" className={styles.primary} onClick={onClose}>Close</button>
    </div>,
    document.body,
  )
}
