import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CharacterRow, CharacterSection, ShardTree } from '../lib/database.types'
import { useRollLog, type RollLine } from '../lib/rolls'
import { effectiveSheet } from '../lib/effects'
import { parseDice, rollDice } from '../lib/dice'
import { longRestPatch, pactShortRestPatch, shortRestPatch } from '../lib/rest'
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
  const { addRoll } = useRollLog()
  /* ITS OWN TOAST, not the general roll one.
     The roll toast was retired because the Roll Context Panel already showed
     everything it did and the ROLLS button's ping says when to look. A rest is
     the exception: it is a deliberate press that CHANGES the sheet — hit dice
     spent, slots back, features recharged — and the confirmation belongs beside
     the button you just pressed, not behind a panel you have to open. */
  const [toast, setToast] = useState<{ title: string; sub: string; icon: string; lines: RollLine[] } | null>(null)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 5200)
    return () => clearTimeout(t)
  }, [toast])

  // Short-rest inputs.
  const hd = character.sheet?.hitDice
  const hdAvail = hd?.current ?? 0
  const hdDie = hd?.die ?? 'd10'
  const hdSides = parseDice(hdDie)?.sides ?? 10
  const conMod = Math.floor(((effectiveSheet(character, shardTrees).abilities?.con ?? 10) - 10) / 2)
  const activeCount = Array.isArray(character.resources?.activeEffects)
    ? (character.resources!.activeEffects as unknown[]).length : 0
  // A short rest is worth taking (even with 0 dice) if it would recharge a feature.
  const shortRechargeable = (character.sheet?.features ?? [])
    .some(f => f.recharge === 'short' && f.uses && f.uses.current < f.uses.max)
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
    addRoll({ kind: 'custom', title: 'Long Rest', subtitle: 'Daily resources restored', icon: 'fa-moon', lines: longLines, quiet: true })
    setToast({ title: 'Long Rest', sub: 'Daily resources restored', icon: 'fa-moon', lines: longLines })
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
    addRoll({ kind: 'custom', title: 'Short Rest', subtitle: 'One hour · hit dice spent', icon: 'fa-campground', lines, quiet: true })
    setToast({ title: 'Short Rest', sub: 'One hour · hit dice spent', icon: 'fa-campground', lines })
  }

  return (
    <>
      <button type="button" className={styles.restBtn} onClick={openModal}>
        <i className="fa-solid fa-moon" aria-hidden="true" /> Rest
      </button>

      {toast && createPortal(
        <div className={styles.toast} role="status" onClick={() => setToast(null)} title="Dismiss">
          <div className={styles.tHead}>
            <span className={styles.tIcon}><i className={`fa-solid ${toast.icon}`} /></span>
            <div className={styles.tTitles}>
              <span className={styles.tTitle}>{toast.title}</span>
              <span className={styles.tSub}>{toast.sub}</span>
            </div>
            <span className={styles.tX}><i className="fa-solid fa-xmark" /></span>
          </div>
          {toast.lines.length === 0
            ? <div className={styles.tEmpty}>Nothing left to restore.</div>
            : toast.lines.map((l, i) => (
              <div key={i} className={`${styles.tLine}${l.tone === 'heal' ? ' ' + styles.heal : l.tone === 'buff' ? ' ' + styles.buff : ''}`}>
                <span className={styles.tLab}>{l.label}</span>
                <span className={styles.tTot}>{l.total}</span>
                {l.breakdown && <span className={styles.tBd}>{l.breakdown}</span>}
              </div>
            ))}
        </div>,
        document.body,
      )}

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

/** One result line: label + value on a single row (value flush-right, never
 *  wrapping), with the breakdown on its own muted line below. */
function Line({ line }: { line: RollLine }) {
  return (
    <div className={`${styles.line} ${line.tone ? styles[line.tone] : ''}`}>
      <div className={styles.lineMain}>
        <span className={styles.lab}>{line.label}</span>
        <span className={styles.total}>{line.total}</span>
      </div>
      {line.breakdown && <span className={styles.bd}>{line.breakdown}</span>}
    </div>
  )
}
