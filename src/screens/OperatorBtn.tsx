import { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import styles from './OperatorConsole.module.css'

const cx = (...xs: (string | false | undefined)[]) => xs.filter(Boolean).join(' ')

/** The console's chamfered button (styles.btn/.bf/.bi), for the surfaces that
 *  live in their own files. Not imported from OperatorConsole itself, which
 *  imports those surfaces: that would be a screen<->screen cycle. */
export function Btn({ tone, sm, lg, icon, label, onClick, disabled, title }: {
  tone: 'amber' | 'cyan' | 'good' | 'danger' | 'ghost'
  sm?: boolean; lg?: boolean; icon: string; label: string
  onClick?: () => void; disabled?: boolean; title?: string
}) {
  return (
    <button className={cx(styles.btn, styles[tone], sm && styles.sm, lg && styles.lg)} onClick={onClick} disabled={disabled} title={title}>
      <span className={styles.bf} />
      <span className={styles.bi}><Icon name={icon} /> {label}</span>
    </button>
  )
}

/**
 * A Btn that asks first. The first press ARMS it; Cancel then takes the
 * pressed button's exact spot (so a double-click lands on Cancel, not through
 * the confirm — the lesson OperatorInventory's Destroy learned), and the real
 * action sits beside it, named. Disarms itself after a few seconds so a
 * forgotten armed button can't be hit by accident later.
 *
 * For actions with no undo: deletes, Long Rest. Anything that CAN be undone
 * from its log line should not use this — a confirm there is just friction.
 */
export function ConfirmBtn({ confirmLabel, ...btn }: Parameters<typeof Btn>[0] & {
  /** What the second press does, said plainly: "Delete for good". */
  confirmLabel: string
}) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 5000)
    return () => clearTimeout(t)
  }, [armed])
  if (!armed) return <Btn {...btn} onClick={() => setArmed(true)} />
  return (
    <>
      <Btn tone="ghost" sm={btn.sm} lg={btn.lg} icon="fa-xmark" label="Cancel" onClick={() => setArmed(false)} />
      <Btn {...btn} label={confirmLabel} onClick={() => { setArmed(false); btn.onClick?.() }} />
    </>
  )
}
