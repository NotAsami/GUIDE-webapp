/**
 * Player-side system toasts — the receiving end of the G.U.I.D.E. voice channel
 * (lib/voice.ts). Renders the Operator's pushes top-right, above the topbar
 * divider: ITEM ACQUIRED (grant), EFFECT APPLIED, and free-text system notices
 * in the Normal (cyan) or Corrupted (amber, glitched) tone — the toast layer the
 * Operator Console mockup simulates in `toastLayer`.
 *
 * Mounted once in Layout with the bound character's id; messages targeted at
 * another PC are ignored client-side ('all' passes). Since the roll toast was
 * retired in favour of the ROLLS button's ping, this is the only toast layer
 * left, and it keeps the top-right corner to itself.
 */

import { useEffect, useRef, useState } from 'react'
import { useGuideVoice, ALL_PARTY, type VoiceMsg } from '../lib/voice'
import styles from './SystemToasts.module.css'

const RAR_COLOR: Record<string, string> = {
  common: 'var(--rar-common)',
  uncommon: 'var(--rar-uncommon)',
  rare: 'var(--rar-rare)',
  legendary: 'var(--rar-legend)',
}

const SHOW_MS = 5200
/** Must cover the toastOut animation (420ms) so the node isn't removed mid-slide. */
const OUT_MS = 440

interface Toast {
  id: string
  msg: VoiceMsg
  out: boolean
}

export function SystemToasts({ characterId }: { characterId: string }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef<number[]>([])

  useGuideVoice(msg => {
    if (msg.target !== ALL_PARTY && msg.target !== characterId) return
    const id = crypto.randomUUID()
    setToasts(prev => [...prev, { id, msg, out: false }])
    timers.current.push(
      window.setTimeout(() => {
        setToasts(prev => prev.map(t => (t.id === id ? { ...t, out: true } : t)))
        timers.current.push(
          window.setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), OUT_MS),
        )
      }, SHOW_MS),
    )
  })

  // Clear any pending timers when the layer unmounts (sign-out, route change).
  useEffect(() => () => timers.current.forEach(t => window.clearTimeout(t)), [])

  if (!toasts.length) return null

  return (
    <div className={styles.layer} aria-live="polite">
      {toasts.map(t => (
        <ToastCard key={t.id} msg={t.msg} out={t.out} />
      ))}
    </div>
  )
}

function ToastCard({ msg, out }: { msg: VoiceMsg; out: boolean }) {
  const corrupted = msg.kind === 'notice' && msg.tone === 'corrupted'
  const fxKind = msg.kind === 'effect' ? (msg.fxKind ?? 'buff') : undefined
  const cls = [
    styles.toast, corrupted && styles.corrupted,
    fxKind === 'debuff' && styles.debuff, fxKind === 'cond' && styles.cond,
    out && styles.out,
  ].filter(Boolean).join(' ')

  if (msg.kind === 'item') {
    const col = RAR_COLOR[msg.rarity ?? ''] ?? 'var(--cyan)'
    return (
      <div className={cls}>
        <div className={styles.tgTag}>Realtime → You</div>
        <div className={styles.tgHead}>
          <span className={styles.tgIc}><i className={`fa-solid ${msg.icon ?? 'fa-box-open'}`} /></span>
          <div className={styles.tgTx}>
            <div className={styles.tgT}>Item Acquired ::</div>
            <div className={styles.tgN}>
              {msg.name}
              {msg.rarity && <span className={styles.rar} style={{ color: col }}> · {msg.rarity}</span>}
            </div>
          </div>
        </div>
        <div className={styles.tgFoot}><span className={styles.led} /> G.U.I.D.E. inventory sync</div>
      </div>
    )
  }

  if (msg.kind === 'feature') {
    return (
      <div className={cls}>
        <div className={styles.tgTag}>Realtime → You</div>
        <div className={styles.tgHead}>
          <span className={styles.tgIc}><i className={`fa-solid ${msg.icon ?? 'fa-star'}`} /></span>
          <div className={styles.tgTx}>
            <div className={styles.tgT}>Feature Acquired ::</div>
            <div className={styles.tgN}>{msg.name}</div>
          </div>
        </div>
        <div className={styles.tgFoot}><span className={styles.led} /> G.U.I.D.E. dossier sync</div>
      </div>
    )
  }

  if (msg.kind === 'spell') {
    return (
      <div className={cls}>
        <div className={styles.tgTag}>Realtime → You</div>
        <div className={styles.tgHead}>
          <span className={styles.tgIc}><i className="fa-solid fa-wand-sparkles" /></span>
          <div className={styles.tgTx}>
            <div className={styles.tgT}>Spell Learned ::</div>
            <div className={styles.tgN}>{msg.name} <span className={styles.rar}>· {msg.level === 0 ? 'Cantrip' : `Level ${msg.level}`}</span></div>
          </div>
        </div>
        <div className={styles.tgFoot}><span className={styles.led} /> G.U.I.D.E. grimoire sync</div>
      </div>
    )
  }

  if (msg.kind === 'coins') {
    const coinName = msg.coin[0].toUpperCase() + msg.coin.slice(1)
    const gained = msg.op === 'award'
    return (
      <div className={cls}>
        <div className={styles.tgTag}>Realtime → You</div>
        <div className={styles.tgHead}>
          <span className={styles.tgIc}><i className="fa-solid fa-coins" /></span>
          <div className={styles.tgTx}>
            <div className={styles.tgT}>{gained ? 'Coins Received ::' : 'Coins Deducted ::'}</div>
            <div className={styles.tgN}>
              {gained ? '+' : '−'}{msg.amount.toLocaleString()} {coinName} Coins
            </div>
          </div>
        </div>
        <div className={styles.tgFoot}><span className={styles.led} /> G.U.I.D.E. ledger sync</div>
      </div>
    )
  }

  if (msg.kind === 'effect') {
    return (
      <div className={cls}>
        <div className={styles.tgTag}>Realtime → You</div>
        <div className={styles.tgHead}>
          <span className={styles.tgIc}><i className="fa-solid fa-wand-sparkles" /></span>
          <div className={styles.tgTx}>
            <div className={styles.tgT}>Effect Applied ::</div>
            <div className={styles.tgN}>
              {msg.name}
              {msg.dur && <span className={styles.rar}> · {msg.dur}</span>}
            </div>
          </div>
        </div>
        <div className={styles.tgFoot}><span className={styles.led} /> Status condition pushed</div>
      </div>
    )
  }

  // notice
  return (
    <div className={cls}>
      <div className={styles.tgTag}>{corrupted ? 'Unknown signal → You' : 'G.U.I.D.E. notice → You'}</div>
      <div className={styles.tgHead}>
        <span className={styles.tgIc}><i className={`fa-solid ${corrupted ? 'fa-triangle-exclamation' : 'fa-circle-info'}`} /></span>
        <div className={styles.tgTx}>
          <div className={styles.tgT}>{corrupted ? 'S Y S T E M ::' : 'System Message ::'}</div>
          <div className={styles.tgN}>{msg.message}</div>
        </div>
      </div>
      <div className={styles.tgFoot}><span className={styles.led} /> {corrupted ? 'source unverified' : 'channel 1F-Δ'}</div>
    </div>
  )
}
