import { useAuth } from '../lib/auth'
import type { CharacterRow, CharacterSection } from '../lib/database.types'
import { burden } from '../lib/burden'
import { RestButton } from './RestButton'
import styles from './Layout.module.css'

interface Props {
  character: CharacterRow
  /** Atomic multi-section write — the Rest button resets sheet + resources together. */
  updateSections: (patch: Partial<Pick<CharacterRow, CharacterSection>>) => Promise<void>
}

/** Shared chrome. The HP pill shows current/max (editing lives in the Stat Panel);
 *  the Rest button beside it resets daily resources. */
export function Topbar({ character, updateSections }: Props) {
  const { signOut } = useAuth()

  const level = character.identity?.level ?? 1
  const reputation = character.identity?.reputation ?? 0
  const gold = character.sheet?.coins?.gold ?? 0
  const hpCurrent = character.sheet?.hp?.current ?? 0
  const hpMax = character.sheet?.hp?.max ?? 0
  const hpLow = hpMax > 0 && hpCurrent / hpMax <= 0.25

  // Burden is derived from item weights (carried + equipped) vs STR-based
  // capacity — one shared helper, also read by the Inventory screen.
  const { current: burdenCurrent, max: burdenMax, ratio: burdenRatio } = burden(character)
  const overBurdened = burdenRatio > 1

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
        <div className={styles.burdenBlock} aria-label="Burden" title={overBurdened ? 'Over capacity' : undefined}>
          <span className="ic">⚖</span>
          <span className={`val${overBurdened ? ' low' : ''}`}>{burdenCurrent} / {burdenMax}</span>
          <span className="lab">Burden</span>
        </div>
        <div className={styles.coinBlock} aria-label="Gold">
          <span className="ic">⊙</span>
          <span className="val">{gold.toLocaleString()}</span>
          <span className="lab">Gold</span>
        </div>
        <RestButton character={character} updateSections={updateSections} />
        <button type="button" className={styles.signOut} onClick={() => signOut()}>Sign out</button>
      </div>
    </header>
  )
}

function pct(value: number, max: number): number {
  if (max <= 0) return 0
  return Math.max(0, Math.min(100, (value / max) * 100))
}
