import { useState } from 'react'
import { createPortal } from 'react-dom'
import type { CharacterRow, CharacterSection, CharacterSheet } from '../lib/database.types'
import { useRollLog, type RollLine } from '../lib/rolls'
import { effectiveSheet } from '../lib/effects'
import { parseDice, rollDice } from '../lib/dice'
import styles from './RestButton.module.css'

interface Props {
  character: CharacterRow
  /** Atomic multi-section write (sheet + resources) from the shared hook. */
  updateSections: (patch: Partial<Pick<CharacterRow, CharacterSection>>) => Promise<void>
}

type Mode = 'short' | 'long'

/** Build the long-rest result: faithful 5e long-rest defaults, applied in ONE
 *  atomic write (both sections spread from the existing data — never replaced).
 *   - HP -> max, temp cleared
 *   - hit dice: regain floor(max/2), min 1 (capped)
 *   - exhaustion -1, death saves cleared
 *   - active effects cleared (the "buffs reset on rest" decision)
 *  Spell slots are intentionally NOT touched yet (no `spellbook.slots` shape;
 *  wire that with the Spellbook port). Attunement is a slot budget, not refilled. */
function longRestPatch(character: CharacterRow): {
  patch: Partial<Pick<CharacterRow, CharacterSection>>
  lines: RollLine[]
} {
  const sheet = character.sheet ?? {}
  const resources = character.resources ?? {}
  const lines: RollLine[] = []

  const hp = sheet.hp ?? { current: 0, max: 0 }
  const hpMax = hp.max ?? 0
  const hpHealed = Math.max(0, hpMax - (hp.current ?? 0))
  const nextSheet: CharacterSheet = { ...sheet, hp: { ...hp, current: hpMax, max: hpMax, temp: 0 } }
  lines.push({
    label: 'HP', total: `${hpMax} / ${hpMax}`,
    breakdown: hpHealed > 0 ? `+${hpHealed} restored` : 'already full', tone: 'heal',
  })

  const hd = sheet.hitDice
  if (hd && hd.max > 0) {
    const regain = Math.max(1, Math.floor(hd.max / 2))
    const nextCur = Math.min(hd.max, (hd.current ?? 0) + regain)
    const gained = nextCur - (hd.current ?? 0)
    nextSheet.hitDice = { ...hd, current: nextCur }
    if (gained > 0) lines.push({ label: 'Hit Dice', total: `${nextCur}${hd.die}`, breakdown: `+${gained} regained` })
  }

  // Every limited-use feature recharges on a long rest.
  const features = sheet.features
  if (features && features.length) {
    let recharged = 0
    nextSheet.features = features.map(f => {
      if (f.uses && f.uses.current < f.uses.max) { recharged++; return { ...f, uses: { ...f.uses, current: f.uses.max } } }
      return f
    })
    if (recharged > 0) lines.push({ label: 'Features', total: 'recharged', breakdown: `${recharged} restored` })
  }

  const exhaustion = typeof resources.exhaustion === 'number' ? resources.exhaustion : 0
  const nextExhaustion = Math.max(0, exhaustion - 1)
  if (exhaustion > 0) lines.push({ label: 'Exhaustion', total: `${nextExhaustion}`, breakdown: '−1 level' })

  const effects = Array.isArray(resources.activeEffects) ? resources.activeEffects : []
  if (effects.length > 0) lines.push({ label: 'Effects Cleared', total: `${effects.length}`, breakdown: 'potions worn off', tone: 'buff' })

  const ds = resources.deathSaves as { successes?: number; failures?: number } | undefined
  if (ds && ((ds.successes ?? 0) > 0 || (ds.failures ?? 0) > 0)) lines.push({ label: 'Death Saves', total: 'reset', breakdown: '0 / 0' })

  return {
    patch: {
      sheet: nextSheet,
      resources: { ...resources, deathSaves: { successes: 0, failures: 0 }, exhaustion: nextExhaustion, activeEffects: [] },
    },
    lines,
  }
}

export function RestButton({ character, updateSections }: Props) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('long')
  const [busy, setBusy] = useState(false)
  /** Hit dice chosen to spend on a short rest. */
  const [spend, setSpend] = useState(0)
  const { addRoll } = useRollLog()

  // Short-rest inputs.
  const hd = character.sheet?.hitDice
  const hdAvail = hd?.current ?? 0
  const hdDie = hd?.die ?? 'd10'
  const hdSides = parseDice(hdDie)?.sides ?? 10
  const conMod = Math.floor(((effectiveSheet(character).abilities?.con ?? 10) - 10) / 2)
  const activeCount = Array.isArray(character.resources?.activeEffects)
    ? (character.resources!.activeEffects as unknown[]).length : 0
  // A short rest is worth taking (even with 0 dice) if it would recharge a feature.
  const shortRechargeable = (character.sheet?.features ?? [])
    .some(f => f.recharge === 'short' && f.uses && f.uses.current < f.uses.max)

  const { patch: longPatch, lines: longLines } = longRestPatch(character)

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
    const rolls = rollDice(spend, hdSides)
    const healed = Math.max(0, rolls.reduce((a, b) => a + b, 0) + conMod * spend)
    const hp = character.sheet?.hp ?? { current: 0, max: 0 }
    const hpMax = hp.max ?? 0
    const nextHp = Math.min(hpMax, (hp.current ?? 0) + healed)
    const gained = nextHp - (hp.current ?? 0)
    const nextSheet: CharacterSheet = { ...character.sheet, hp: { ...hp, current: nextHp, max: hpMax } }
    if (hd) nextSheet.hitDice = { ...hd, current: Math.max(0, hdAvail - spend) }
    const resources = character.resources ?? {}

    const lines: RollLine[] = []

    // Features that recharge on a short rest come back.
    const features = character.sheet?.features
    if (features && features.length) {
      let recharged = 0
      nextSheet.features = features.map(f => {
        if (f.recharge === 'short' && f.uses && f.uses.current < f.uses.max) { recharged++; return { ...f, uses: { ...f.uses, current: f.uses.max } } }
        return f
      })
      if (recharged > 0) lines.push({ label: 'Features', total: 'recharged', breakdown: `${recharged} restored` })
    }
    if (spend > 0) {
      const modStr = conMod ? ` ${conMod > 0 ? '+' : '−'} ${Math.abs(conMod * spend)}` : ''
      lines.push({ label: 'HP', total: `${nextHp} / ${hpMax}`, breakdown: `+${gained} · rolled ${rolls.join(' + ')}${modStr}`, tone: 'heal' })
      lines.push({ label: 'Hit Dice', total: `${Math.max(0, hdAvail - spend)}${hdDie}`, breakdown: `−${spend} spent` })
    }
    if (activeCount > 0) lines.push({ label: 'Effects Cleared', total: `${activeCount}`, breakdown: 'potions worn off', tone: 'buff' })

    setOpen(false)
    await updateSections({ sheet: nextSheet, resources: { ...resources, activeEffects: [] } })
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
                <button type="button" className={styles.confirm} onClick={confirmShort} disabled={busy || (spend === 0 && activeCount === 0 && !shortRechargeable)}>
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
