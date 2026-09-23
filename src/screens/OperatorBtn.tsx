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
