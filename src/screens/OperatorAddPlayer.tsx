/**
 * ADD PLAYER — the foot of the Party Roster. The DM types the email the player
 * signs in with and a character name; the server finds that account and gives
 * it a blank level-1 character (migration 0030), which then opens so race,
 * class and background can be assigned with the console's own tools.
 *
 * Folded to one button until wanted: the roster is the party, and a form
 * standing open under it on every visit would be noise after day one.
 */
import { useState, type FormEvent } from 'react'
import styles from './OperatorConsole.module.css'

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ')

export function OperatorAddPlayer({ empty, onAdd, onAdded }: {
  /** No characters yet: say what this is for, and start unfolded. */
  empty: boolean
  onAdd: (email: string, name: string) => Promise<{ id: string } | { error: string }>
  onAdded: (id: string) => void
}) {
  const [open, setOpen] = useState(empty)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const r = await onAdd(email.trim(), name.trim())
    setBusy(false)
    if ('error' in r) { setError(r.error); return }
    setEmail('')
    setName('')
    setOpen(false)
    onAdded(r.id)
  }

  if (!open) {
    return (
      <button type="button" className={cx(styles.btn, styles.ghost, styles.sm)} onClick={() => setOpen(true)}>
        <span className={styles.bf} />
        <span className={styles.bi}><i className="fa-solid fa-user-plus" aria-hidden="true" />Add player</span>
      </button>
    )
  }

  return (
    <form onSubmit={submit} aria-label="Add player">
      {empty && (
        <p className={styles.fieldLab} style={{ textTransform: 'none', letterSpacing: '0.04em', margin: '0 0 10px' }}>
          No players yet. Each player signs in once with their email, then you add them here.
        </p>
      )}
      <label>
        <span className={styles.fieldLab}>Player's email</span>
        <input className={styles.sessIn} type="email" required autoComplete="off" value={email}
          onChange={e => setEmail(e.target.value)} placeholder="player@example.com" disabled={busy} />
      </label>
      <label>
        <span className={styles.fieldLab}>Character name</span>
        <input className={styles.sessIn} type="text" required autoComplete="off" value={name}
          onChange={e => setName(e.target.value)} disabled={busy} />
      </label>
      {error && <p role="alert" style={{ color: 'var(--danger-hot)', font: '11px/1.5 var(--font-mono)', margin: '0 0 10px' }}>{error}</p>}
      <div className={styles.btnRow}>
        <button type="submit" className={cx(styles.btn, styles.good, styles.sm)} disabled={busy}>
          <span className={styles.bf} />
          <span className={styles.bi}>{busy ? 'Adding…' : 'Add'}</span>
        </button>
        {!empty && (
          <button type="button" className={cx(styles.btn, styles.ghost, styles.sm)} disabled={busy}
            onClick={() => { setOpen(false); setError(null) }}>
            <span className={styles.bf} />
            <span className={styles.bi}>Cancel</span>
          </button>
        )}
      </div>
    </form>
  )
}
