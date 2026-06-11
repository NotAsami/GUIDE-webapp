import { useAuth } from '../lib/auth'
import type { CharacterRow, CharacterSection } from '../lib/database.types'
import styles from './Layout.module.css'

interface Props {
  character: CharacterRow
  /** Same hook instance as Layout — so optimistic writes re-render the topbar
   *  immediately. (A second useCharacter() here would render from a detached
   *  state and only update on reload.) */
  updateSection: <K extends CharacterSection>(section: K, next: CharacterRow[K]) => Promise<void>
}

/** Shared chrome. The HP pill on the right is the Phase 0 write surface:
 *  pressing ± writes through to characters.sheet.hp.current. Every screen
 *  reads from the same field — that's the single-source-of-truth contract. */
export function Topbar({ character, updateSection }: Props) {
  const { signOut } = useAuth()

  const level = character.identity?.level ?? 1
  const reputation = character.identity?.reputation ?? 0
  const gold = character.sheet?.coins?.gold ?? 0
  const hpCurrent = character.sheet?.hp?.current ?? 0
  const hpMax = character.sheet?.hp?.max ?? 0
  const hpLow = hpMax > 0 && hpCurrent / hpMax <= 0.25

  // burden is derived from inventory weights — postponed until inventory port.
  const burdenCurrent = 0
  const burdenMax = 120

  async function bumpHP(delta: number) {
    if (!character.sheet) return
    const next = Math.max(0, Math.min(hpMax, hpCurrent + delta))
    if (next === hpCurrent) return
    await updateSection('sheet', {
      ...character.sheet,
      hp: { ...character.sheet.hp, current: next, max: hpMax },
    })
  }

  const flavor = [character.identity?.race, character.identity?.class].filter(Boolean) as string[]
  if (character.identity?.archetype) flavor.push(character.identity.archetype)
  if (character.identity?.background) flavor.push(character.identity.background)

  return (
    <header className={styles.topbar} role="banner">
      <div className={styles.topLeft}>
        <div className={styles.statBlock} aria-label="Level">
          <div className={styles.statRow}>
            <span className={styles.statNum}>{level.toString().padStart(2, '0')}</span>
            <span className={styles.statLabel}>Level</span>
          </div>
          <div className={styles.bar} aria-hidden="true"><i style={{ width: `${pct(level, 20)}%` }} /></div>
        </div>
        <div className={styles.statBlock} aria-label="Reputation">
          <div className={styles.statRow}>
            <span className={styles.statNum}>{reputation.toString().padStart(2, '0')}</span>
            <span className={styles.statLabel}>Reputation</span>
          </div>
          <div className={styles.bar} aria-hidden="true"><i style={{ width: `${pct(reputation, 100)}%` }} /></div>
        </div>
        <div className={styles.hpBlock} aria-label="HP">
          <span className="ic">♥</span>
          <span className={`val${hpLow ? ' low' : ''}`}>{hpCurrent} / {hpMax}</span>
          <span className="lab">HP</span>
          <span className={styles.hpStepper}>
            <button type="button" onClick={() => bumpHP(-1)} disabled={hpCurrent <= 0} aria-label="Decrease HP">−</button>
            <button type="button" onClick={() => bumpHP(+1)} disabled={hpCurrent >= hpMax} aria-label="Increase HP">+</button>
          </span>
        </div>
      </div>

      <div className={styles.topCenter}>
        <div className={styles.charName}>{character.name}<span className={styles.cursor}>█</span></div>
        {flavor.length > 0 && (
          <div className={styles.charSub}>
            {flavor.map((f, i) => (
              <span key={f}>
                {i > 0 && <span className="sep">/</span>}
                {' '}{f}{' '}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className={styles.topRight}>
        <div className={styles.burdenBlock} aria-label="Burden">
          <span className="ic">⚖</span>
          <span className="val">{burdenCurrent} / {burdenMax}</span>
          <span className="lab">Burden</span>
        </div>
        <div className={styles.coinBlock} aria-label="Gold">
          <span className="ic">⊙</span>
          <span className="val">{gold.toLocaleString()}</span>
          <span className="lab">Gold</span>
        </div>
        <button type="button" className={styles.signOut} onClick={() => signOut()}>Sign out</button>
      </div>
    </header>
  )
}

function pct(value: number, max: number): number {
  if (max <= 0) return 0
  return Math.max(0, Math.min(100, (value / max) * 100))
}
