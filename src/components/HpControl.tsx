import type { SaveResult } from '../lib/saveResult'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CharacterRow, CharacterSection, HP } from '../lib/database.types'
import { applyHp, type HpChange } from '../lib/hp'
import styles from './HpControl.module.css'
import layout from './Layout.module.css'

interface Props {
  character: CharacterRow
  /** Effective max — base + shard bonuses. Healing clamps against this. */
  effMax: number
  updateSections: (patch: Partial<Pick<CharacterRow, CharacterSection>>) => Promise<SaveResult>
}

/** How long the "−17 · Undo" echo stays under the pill. */
const ECHO_MS = 8000

/**
 * The topbar HP pill, and the at-table write surface for it: damage and heal
 * from any screen. Writes `sheet.hp` — the same field the Stat Panel edits —
 * so the hpZero trigger (components/Triggers.tsx) fires off either path.
 */
export function HpControl({ character, effMax, updateSections }: Props) {
  const hp: HP = character.sheet?.hp ?? { current: 0, max: 0 }
  const temp = hp.temp ?? 0
  const low = effMax > 0 && hp.current / effMax <= 0.25

  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [echo, setEcho] = useState<{ text: string; tone: 'dmg' | 'heal'; prev: HP } | null>(null)
  const pillRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  useEffect(() => {
    if (!echo) return
    const t = setTimeout(() => setEcho(null), ECHO_MS)
    return () => clearTimeout(t)
  }, [echo])

  // Escape and outside-press close it; focus goes back to the pill.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (!panelRef.current?.contains(t) && !pillRef.current?.contains(t)) close()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown) }
  }, [open])

  function toggle() {
    if (open) return close()
    const r = pillRef.current!.getBoundingClientRect()
    setPos({ top: r.bottom + 10, left: Math.max(12, r.left - 12) })
    setAmount('')
    setError(null)
    setOpen(true)
  }

  function close() {
    setOpen(false)
    pillRef.current?.focus()
  }

  async function write(next: HP) {
    if (!character.sheet) return false
    const result = await updateSections({ sheet: { ...character.sheet, hp: next } })
    if (!result.ok) setError('Not saved — check your connection and try again.')
    return result.ok
  }

  async function apply(kind: HpChange['kind']) {
    const n = Math.floor(Number(amount))
    if (!(n > 0) && kind !== 'temp') return
    const prev = hp
    const next = applyHp(hp, effMax, { kind, amount: n })
    if (!(await write(next))) return
    if (kind === 'damage') setEcho({ text: `−${n}`, tone: 'dmg', prev })
    else if (kind === 'heal') setEcho({ text: `+${next.current - prev.current}`, tone: 'heal', prev })
    else setEcho({ text: `${next.temp} temp`, tone: 'heal', prev })
    close()
  }

  async function undo() {
    if (!echo) return
    const { prev } = echo
    setEcho(null)
    await write({ ...hp, current: prev.current, temp: prev.temp })
  }

  const amt = Math.floor(Number(amount))

  return (
    <div className={styles.wrap}>
      <button
        ref={pillRef} type="button" className={`${layout.hpBlock} ${styles.pill}`}
        aria-haspopup="dialog" aria-expanded={open}
        aria-label={`Hit points ${hp.current} of ${effMax}${temp ? `, ${temp} temporary` : ''}. Adjust`}
        onClick={toggle}
      >
        <span className="ic" aria-hidden="true">♥</span>
        <span className={`val${low ? ' low' : ''}`}>{hp.current} / {effMax}</span>
        {temp > 0 && <span className={styles.temp}>+{temp}</span>}
        <span className="lab">HP</span>
      </button>

      {echo && !open && (
        <div className={styles.echo} role="status">
          <span className={echo.tone === 'dmg' ? styles.echoDmg : styles.echoHeal}>{echo.text}</span>
          <button type="button" className={styles.undo} onClick={() => void undo()}>Undo</button>
        </div>
      )}

      {open && createPortal(
        <div
          ref={panelRef} className={styles.panel} role="dialog" aria-label="Adjust hit points"
          style={{ top: pos.top, left: pos.left }}
        >
          <div className={styles.readout}>
            <span className={`${styles.cur}${low ? ' ' + styles.low : ''}`}>{hp.current}</span>
            <span className={styles.of}>/ {effMax}</span>
            {temp > 0 && <span className={styles.tempTag}>+{temp} temp</span>}
          </div>
          <input
            className={styles.amount} type="number" inputMode="numeric" min={0} autoFocus
            placeholder="0" aria-label="Amount" value={amount}
            onChange={e => { setAmount(e.target.value); setError(null) }}
            onKeyDown={e => { if (e.key === 'Enter') void apply(e.shiftKey ? 'heal' : 'damage') }}
          />
          <div className={styles.actions}>
            <button type="button" className={styles.dmg} disabled={!(amt > 0)} onClick={() => void apply('damage')}>Damage</button>
            <button type="button" className={styles.heal} disabled={!(amt > 0) || hp.current >= effMax} onClick={() => void apply('heal')}>Heal</button>
          </div>
          <button type="button" className={styles.setTemp} disabled={!(amt >= 0) || amount === ''} onClick={() => void apply('temp')}>
            Set temporary HP
          </button>
          {error
            ? <p className={styles.error} role="alert">{error}</p>
            : <p className={styles.hint}>Enter damages · Shift+Enter heals · temp absorbs first</p>}
        </div>,
        document.body,
      )}
    </div>
  )
}
