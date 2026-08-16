/**
 * Using a feature — the whole press, in one place.
 *
 * It lived inside the Features screen until the armed queue gave a second
 * surface a reason to press Use: §16's chip says a bonus you cannot see is worse
 * than no bonus, and the same argument one step earlier says a bonus you could
 * ARM but the roll surface never mentions is one you will forget exists. So the
 * weapon card offers it too.
 *
 * ONE DEFINITION, because a press does four things that must not drift: it rolls
 * the feature's expression, spends a use, applies the activation outcomes, and
 * writes all of it in a SINGLE round trip. Two copies of that would eventually
 * be a feature spent on one screen and not the other.
 */
import { useState } from 'react'
import { createPortal } from 'react-dom'
import type { CharacterRow, CharacterSection, Feature, ShardTree } from '../lib/database.types'
import { rollHeal } from '../lib/dice'
import { useRollLog, type RollLine } from '../lib/rolls'
import { effectiveSheet } from '../lib/effects'
import { gid, type GraphContext } from '../lib/graph'
import { applyOutcomes, planActivation, type Outcome } from '../lib/graphState'
import styles from './ActivationSheet.module.css'

export type ActivationHost = {
  character: CharacterRow
  graph: GraphContext
  shardTrees?: Record<string, ShardTree>
  updateSection: <K extends CharacterSection>(section: K, next: CharacterRow[K]) => Promise<void>
  updateSections: (patch: Partial<Pick<CharacterRow, CharacterSection>>) => Promise<void>
}

/** Can this feature be pressed at all? A spent one cannot. */
export const canUse = (f: Feature) => !(f.uses && f.uses.current <= 0)

export function useActivation(host: ActivationHost) {
  const { character, graph, shardTrees = {}, updateSection, updateSections } = host
  const { addRoll } = useRollLog()
  const [busy, setBusy] = useState(false)
  /** A pending activation awaiting the player's answers. Null = nothing to confirm. */
  const [pending, setPending] = useState<{ feature: Feature; outcomes: Outcome[] } | null>(null)

  /** Pressing Use. Anything the feature would WRITE is shown first: an
   *  activation is a deliberate press, so a confirm step costs nothing and is
   *  the natural place to answer an `ask`. A feature with nothing to write skips
   *  straight through. */
  function start(f: Feature) {
    if (busy || !canUse(f)) return
    const outcomes = planActivation(f, graph, character, gid('feature', f))
    if (outcomes.length) { setPending({ feature: f, outcomes }); return }
    void run(f, [])
  }

  /** Spend/roll a feature: roll its expression (if any), decrement its use
   *  counter (if any), apply the accepted activation outcomes — in ONE write. */
  async function run(f: Feature, outcomes: Outcome[], answers = new Set<string>()) {
    if (busy || !canUse(f)) return
    setBusy(true)

    const sheet = character.sheet ?? {}
    const features = sheet.features ?? []
    let nextSheet = sheet
    const lines: RollLine[] = []

    if (f.roll) {
      const { total, breakdown } = rollHeal(f.roll)
      if (f.rollTone === 'heal') {
        // Heal-tagged rolls raise real HP, like a potion — clamped to the
        // EFFECTIVE max, but the persisted `max` stays the authored base.
        const hp = sheet.hp ?? { current: 0, max: 0 }
        const baseMax = hp.max ?? 0
        const healMax = effectiveSheet(character, shardTrees).hp?.max ?? baseMax
        const cur = hp.current ?? 0
        const next = Math.min(healMax, cur + total)
        nextSheet = { ...nextSheet, hp: { ...hp, current: next, max: baseMax } }
        lines.push({ label: f.rollLabel ?? 'Healed', total: `+${next - cur}`, breakdown: `${breakdown} · HP ${cur} → ${next}`, tone: 'heal' })
      } else {
        // Other rolls are show-only — the player applies the effect (like an attack).
        lines.push({ label: f.rollLabel ?? 'Result', total: `${total}`, breakdown, tone: f.rollTone })
      }
    }

    let remaining = f.uses?.current ?? null
    if (f.uses) {
      remaining = f.uses.current - 1
      nextSheet = { ...nextSheet, features: features.map(x =>
        x.id === f.id ? { ...x, uses: { ...f.uses!, current: remaining! } } : x) }
    }

    // The variable writes join the SAME write as the roll and the use counter —
    // two writes could land apart and leave a feature spent but not activated.
    const { resources, applied } = applyOutcomes(character, outcomes, answers)
    for (const o of applied) {
      lines.push(o.kind === 'arm'
        // An armed modifier has no number yet — it has a promise. Saying "armed"
        // rather than a value is the honest line, and the chip on the target's
        // card is where it becomes visible (§16).
        ? { label: o.mod.label, total: 'armed', breakdown: o.summary, tone: 'buff' }
        : { label: o.def.label ?? o.def.name, total: String(o.delta !== undefined ? (o.current as number) + o.delta : o.set), breakdown: o.summary, tone: 'buff' })
    }

    if (applied.length) {
      await updateSections({ ...(nextSheet !== sheet ? { sheet: nextSheet } : {}), resources: resources as CharacterRow['resources'] })
    } else if (nextSheet !== sheet) {
      await updateSection('sheet', nextSheet)
    }
    setBusy(false)

    const subtitle = f.uses ? `${remaining} / ${f.uses.max} uses left` : (f.usage ?? 'Feature')
    addRoll({ kind: 'custom', title: f.name, subtitle, icon: f.icon, lines, subject: { kind: 'feature', id: f.id } })
  }

  const sheet = pending && createPortal(
    <ActivationConfirm
      feature={pending.feature} outcomes={pending.outcomes} busy={busy}
      onCancel={() => setPending(null)}
      onConfirm={answers => { const p = pending; setPending(null); void run(p.feature, p.outcomes, answers) }}
    />,
    document.body,
  )

  return { start, sheet, busy }
}

/** What pressing Use will do, before it does it.
 *
 *  Every outcome is listed, so a write is never invisible. Ones carrying an
 *  `ask` are unticked checkboxes — §32 makes that a human's call, and unlike a
 *  roll rider this is answered on a deliberate press, so it needs no panel. */
function ActivationConfirm({ feature, outcomes, busy, onCancel, onConfirm }: {
  feature: Feature; outcomes: Outcome[]; busy: boolean
  onCancel: () => void; onConfirm: (answers: Set<string>) => void
}) {
  const [answers, setAnswers] = useState<Set<string>>(new Set())
  const toggle = (label: string) =>
    setAnswers(prev => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label); else next.add(label)
      return next
    })

  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.confirm} onClick={e => e.stopPropagation()} role="dialog" aria-label={`Use ${feature.name}`}>
        <div className={styles.cfHead}>
          <span className={styles.pIcon}><i className={`fa-solid ${feature.icon ?? 'fa-bolt'}`} /></span>
          <div className={styles.pTitles}>
            <div className={styles.pName}>{feature.name}</div>
            <div className={styles.pSub}>Will apply</div>
          </div>
        </div>

        <div className={styles.cfList}>
          {outcomes.map((o, i) => (
            o.ask ? (
              <button
                key={i} type="button"
                className={`${styles.cfRow} ${styles.cfAsk} ${answers.has(o.ask) ? styles.cfOn : ''}`}
                aria-pressed={answers.has(o.ask)} onClick={() => toggle(o.ask!)}
              >
                <i className={`fa-${answers.has(o.ask) ? 'solid fa-square-check' : 'regular fa-square'}`} />
                <span className={styles.cfLabel}>{o.ask}</span>
                <span className={styles.cfVal}>{o.summary}</span>
              </button>
            ) : (
              <div key={i} className={styles.cfRow}>
                <i className="fa-solid fa-check" />
                <span className={styles.cfLabel}>{o.eff.label}</span>
                <span className={styles.cfVal}>{o.summary}</span>
              </div>
            )
          ))}
        </div>

        <div className={styles.cfFoot}>
          <button type="button" className={styles.cfCancel} onClick={onCancel}>Cancel</button>
          <button type="button" className={styles.pUse} disabled={busy} onClick={() => onConfirm(answers)}>Confirm</button>
        </div>
      </div>
    </div>
  )
}
