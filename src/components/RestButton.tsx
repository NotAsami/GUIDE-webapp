import { useState } from 'react'
import { createPortal } from 'react-dom'
import type { CharacterRow, CharacterSection, ShardTree } from '../lib/database.types'
import { useRollLog, type RollLine } from '../lib/rolls'
import { effectiveSheet } from '../lib/effects'
import { parseDice, rollDice } from '../lib/dice'
import { longRestPatch, pactShortRestPatch, shortRestPatch } from '../lib/rest'
import { characterVars } from '../lib/graph'
import { usesOf } from '../lib/featureView'
import styles from './RestButton.module.css'

interface Props {
  character: CharacterRow
  /** Atomic multi-section write (sheet + resources) from the shared hook. */
  updateSections: (patch: Partial<Pick<CharacterRow, CharacterSection>>) => Promise<void>
  shardTrees?: Record<string, ShardTree>
}

type Mode = 'short' | 'long'

export function RestButton({ character, updateSections, shardTrees = {} }: Props) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('long')
  const [busy, setBusy] = useState(false)
  /** Hit dice chosen to spend on a short rest. */
  const [spend, setSpend] = useState(0)
  /* No private toast here. It existed only while the roll toast was deleted; now
     that the roll toast is back, a rest goes through addRoll like everything else
     and gets the same card in the same corner. Two toasts would be two designs
     drifting apart for one job. */
  const { addRoll } = useRollLog()

  // Short-rest inputs.
  const hd = character.sheet?.hitDice
  const hdAvail = hd?.current ?? 0
  const hdDie = hd?.die ?? 'd10'
  const hdSides = parseDice(hdDie)?.sides ?? 10
  const conMod = Math.floor(((effectiveSheet(character, shardTrees).abilities?.con ?? 10) - 10) / 2)
  // A use count can be a formula, so deciding whether a rest would recharge
  // anything needs the character's variable scope — see Feature.uses.
  const scope = characterVars(character, shardTrees).scope
  const activeCount = Array.isArray(character.resources?.activeEffects)
    ? (character.resources!.activeEffects as unknown[]).length : 0
  // A short rest is worth taking (even with 0 dice) if it would recharge a feature.
  const shortRechargeable = (character.sheet?.features ?? []).some(f => {
    // A partial refill counts too — a Barbarian sits down for an hour and gets a
    // Rage back, so the button must not claim there is nothing to gain.
    if (f.recharge !== 'short' && !f.shortRecharge) return false
    const u = usesOf(f, scope)
    return !!u && u.current < u.max
  })
  // ...or restore a Warlock's Pact Magic slots — their defining trait.
  const pactPatch = pactShortRestPatch(character)

  const { patch: longPatch, lines: longLines } = longRestPatch(character, shardTrees)

  function openModal() {
    setSpend(Math.min(1, hdAvail))
    setMode('long')
    setOpen(true)
  }

  async function confirmLong() {
    setBusy(true)
    setOpen(false) // close before the toast — a portaled modal would bury it (z120)
    await updateSections(longPatch)
    setBusy(false)
    addRoll({ kind: 'custom', title: 'Long Rest', subtitle: 'Daily resources restored', icon: 'fa-moon', lines: longLines })
  }

  async function confirmShort() {
    setBusy(true)
    // The dice are rolled HERE, not in rest.ts: the player chooses how many hit
    // dice to spend, and Math.random must never run somewhere a render could
    // call twice.
    const { patch, lines } = shortRestPatch(
      character,
      { spend, rolls: rollDice(spend, hdSides), conMod },
      shardTrees,
    )
    setOpen(false)
    await updateSections(patch)
    setBusy(false)
    addRoll({ kind: 'custom', title: 'Short Rest', subtitle: 'One hour · hit dice spent', icon: 'fa-campground', lines })
  }

  return (
    <>
      <button type="button" className={styles.restBtn} onClick={openModal}>
        <i className="fa-solid fa-moon" aria-hidden="true" /> Rest
      </button>

      {open && createPortal(
        <div className={styles.overlay} onClick={() => setOpen(false)}>
          <div className={styles.panel} onClick={e => e.stopPropagation()} role="dialog" aria-label="Rest">
            <div className={styles.head}>
              <span className={styles.icon}><i className={`fa-solid ${mode === 'long' ? 'fa-moon' : 'fa-campground'}`} /></span>
              <div className={styles.titles}>
                <div className={styles.title}>Rest</div>
                <div className={styles.sub}>{mode === 'long' ? 'Make camp · 8 hours' : 'Catch your breath · 1 hour'}</div>
              </div>
            </div>

            <div className={styles.tabs}>
              <button type="button" className={`${styles.tab} ${mode === 'short' ? styles.tabOn : ''}`} onClick={() => setMode('short')}>Short Rest</button>
              <button type="button" className={`${styles.tab} ${mode === 'long' ? styles.tabOn : ''}`} onClick={() => setMode('long')}>Long Rest</button>
            </div>

            {mode === 'long' ? (
              <div className={styles.body}>
                {longLines.map((l, i) => <Line key={i} line={l} />)}
              </div>
            ) : (
              <div className={styles.body}>
                <div className={styles.spendRow}>
                  <span className={styles.spendLab}>Spend Hit Dice</span>
                  <div className={styles.stepper}>
                    <button type="button" onClick={() => setSpend(s => Math.max(0, s - 1))} disabled={spend <= 0} aria-label="Spend fewer">−</button>
                    <span className={styles.stepVal}>{spend}</span>
                    <button type="button" onClick={() => setSpend(s => Math.min(hdAvail, s + 1))} disabled={spend >= hdAvail} aria-label="Spend more">+</button>
                  </div>
                </div>
                <div className={styles.spendMeta}>
                  <span>{hdAvail}{hdDie} available</span>
                  <span className={styles.dim}>
                    {spend > 0 ? `roll ${spend}${hdDie}${conMod ? ` ${conMod > 0 ? '+' : '−'} ${Math.abs(conMod * spend)}` : ''}` : 'heal by spending dice'}
                  </span>
                </div>
                {activeCount > 0 && <Line line={{ label: 'Effects Cleared', total: `${activeCount}`, breakdown: 'potions worn off', tone: 'buff' }} />}
                {pactPatch && <Line line={pactPatch.lines[0]} />}
                {hdAvail === 0 && <p className={styles.note}>No hit dice remaining — take a long rest to regain some.</p>}
              </div>
            )}

            <div className={styles.foot}>
              <button type="button" className={styles.cancel} onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
              {mode === 'long' ? (
                <button type="button" className={styles.confirm} onClick={confirmLong} disabled={busy}>
                  {busy ? 'Resting…' : 'Take Long Rest'}
                </button>
              ) : (
                <button type="button" className={styles.confirm} onClick={confirmShort} disabled={busy || (spend === 0 && activeCount === 0 && !shortRechargeable && !pactPatch)}>
                  {busy ? 'Resting…' : 'Take Short Rest'}
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

/** One result line, on ONE row: label, the muted breakdown taking the slack, then
 *  the value flush-right. The breakdown used to be a second row under every line,
 *  which made a four-result rest eight rows tall and read as each result wrapping
 *  onto two lines. */
function Line({ line }: { line: RollLine }) {
  return (
    <div className={`${styles.line} ${line.tone ? styles[line.tone] : ''}`}>
      <div className={styles.lineMain}>
        <span className={styles.lab}>{line.label}</span>
        {line.breakdown && <span className={styles.bd}>{line.breakdown}</span>}
        <span className={styles.total}>{line.total}</span>
      </div>
    </div>
  )
}
