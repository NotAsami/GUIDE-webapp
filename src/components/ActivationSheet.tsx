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
import { gid, resolve, rollResolution, type GraphContext } from '../lib/graph'
import { applyOutcomes, gateOf, outcomeLine, planActivation, slotLadder, type GrantOutcome, type Outcome, type SlotOutcome } from '../lib/graphState'
import { grantPartyArm, usePartyRoster } from '../lib/party'
import { usesOf } from '../lib/featureView'
import type { ExprScope } from '../lib/expr'
import styles from './ActivationSheet.module.css'
import { Icon } from './Icon'

export type ActivationHost = {
  character: CharacterRow
  graph: GraphContext
  shardTrees?: Record<string, ShardTree>
  updateSection: <K extends CharacterSection>(section: K, next: CharacterRow[K]) => Promise<void>
  updateSections: (patch: Partial<Pick<CharacterRow, CharacterSection>>) => Promise<void>
}

/** Can this feature be pressed at all? A spent one cannot.
 *
 *  Takes the SCOPE because `uses.max` is a formula and `current` is clamped to
 *  it — a feature whose max is `rages` is spent when the level table says it is,
 *  not when a stored number happens to reach zero. */
export const canUse = (f: Feature, scope: ExprScope) => {
  const u = usesOf(f, scope)
  return !(u && u.current <= 0)
}

export function useActivation(host: ActivationHost) {
  const { character, graph, shardTrees = {}, updateSection, updateSections } = host
  const { addRoll } = useRollLog()
  const [busy, setBusy] = useState(false)
  /** A pending activation awaiting the player's answers. Null = nothing to confirm. */
  const [pending, setPending] = useState<{ feature: Feature; outcomes: Outcome[] } | null>(null)

  /** Pressing Use.
   *
   *  A CONFIRM IS FOR A QUESTION. It used to appear whenever the press would
   *  write anything at all, which meant every activation ended in a second
   *  dialog listing its own internals — "Attacking Recklessly → true" is a
   *  variable flipping somewhere, and the player neither asked to see it nor has
   *  any way to act on it. Two presses to use a feature, and the second one
   *  reads like a warning about nothing.
   *
   *  So the sheet appears only when an outcome genuinely asks something the
   *  engine cannot decide. Everything else runs on the press, which is what
   *  pressing Use always meant. (Since an `ask` on a `once` effect became a
   *  roll-time question rather than an activation one, the common case has no
   *  questions left at all.) */
  function start(f: Feature) {
    if (busy || !canUse(f, graph.scope)) return
    /* GATED SHUT — every activation this feature has is `when`-false, so the
       press would plan nothing, write nothing, and still log an empty entry.
       The guard lives HERE rather than on the Features screen because the
       weapon card presses Use too, and a prerequisite enforced on one surface
       is a prerequisite. See gateOf. */
    if (gateOf(f, graph, character, gid('feature', f))) return
    const outcomes = planActivation(f, graph, character, gid('feature', f))
    /* A GRANT IS A QUESTION THE ENGINE CANNOT ANSWER — who gets the die. Same
       reason an `ask` opens this sheet: the press cannot complete without a
       human, so it stops and asks rather than guessing at a recipient. */
    if (outcomes.some(o => o.ask || o.kind === 'grant' || (o.kind === 'slot' && o.level === undefined))) {
      setPending({ feature: f, outcomes }); return
    }
    void run(f, outcomes)
  }

  /** Spend/roll a feature: roll its expression (if any), decrement its use
   *  counter (if any), apply the accepted activation outcomes — in ONE write. */
  /** What the confirm sheet came back with. An object rather than three
   *  positional arguments: the sheet now asks up to three different questions
   *  (which `ask`s, who receives a grant, which slot to spend) and a fourth
   *  would have been a fourth parameter nobody could read at the call site. */
  async function run(f: Feature, outcomes: Outcome[], picked: Picked = { answers: new Set() }) {
    const { answers, recipient, slotLevel } = picked
    if (busy || !canUse(f, graph.scope)) return
    setBusy(true)

    /* THE GRANTS GO FIRST, and a failure aborts the whole press.
       Everything else in this function is a local write that cannot fail
       halfway; a grant is a network call to another player's row. Spending the
       die and then discovering the RPC refused would leave the bard a use down
       with nothing delivered — so the fallible half runs while there is still
       nothing to undo. */
    const grants = outcomes.filter((o): o is GrantOutcome => o.kind === 'grant' && (!o.ask || answers.has(o.ask)))
    const granted: RollLine[] = []
    for (const g of grants) {
      const res = recipient
        ? await grantPartyArm(recipient, g.mod)
        : ({ ok: false, reason: 'no_recipient' } as const)
      if (!res.ok) {
        setBusy(false)
        addRoll({
          kind: 'custom', title: f.name, subtitle: 'Not delivered', icon: f.icon,
          lines: [{ label: g.mod.label, total: 'failed', breakdown: `The grant was refused (${res.reason}) — nothing was spent.` }],
          subject: { kind: 'feature', id: f.id },
        })
        return
      }
      granted.push({ label: res.target_name, total: res.value ?? g.mod.label, breakdown: `${g.mod.label} armed on their sheet`, tone: 'buff' })
    }

    const sheet = character.sheet ?? {}
    const features = sheet.features ?? []
    let nextSheet = sheet
    const lines: RollLine[] = []

    // A feature could contribute to every roll in the app except its own. Its
    // `roll` is a roll like any other, and §4's "no target = this node's own
    // roll" is exactly the selector that reaches it.
    const res = resolve(graph, { kind: 'feature', subject: gid('feature', f), tags: f.tags })
    const contrib = rollResolution(res)

    if (f.roll) {
      const { total: rolled, breakdown } = rollHeal(f.roll)
      const total = Math.max(0, rolled + contrib.flat)
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

    // Spend from the RESOLVED count, but write back the authored `max`
    // untouched — it is a formula, and resolving it into the row would freeze
    // this character's Rages at whatever the table said the day they pressed it.
    const u = usesOf(f, graph.scope)
    let remaining = u?.current ?? null
    if (u) {
      remaining = u.current - 1
      nextSheet = { ...nextSheet, features: features.map(x =>
        x.id === f.id ? { ...x, uses: { ...f.uses!, current: remaining! } } : x) }
    }

    // The variable writes join the SAME write as the roll and the use counter —
    // two writes could land apart and leave a feature spent but not activated.
    const { resources, usesPatch, spellbook, applied } = applyOutcomes(character, outcomes, answers, { slotLevel })
    // A grant already has its line — naming the recipient, which the plan could
    // not — so it is not re-summarised from the outcome.
    for (const o of applied) if (o.kind !== 'grant') lines.push(outcomeLine(o))
    lines.push(...granted)
    /* Folded in AFTER the spend above, and as a patch, so a press that spends
       its own charge AND moves another feature's counter lands both — Persistent
       Rage spends itself to refill Rage in one write. */
    if (usesPatch) {
      nextSheet = { ...nextSheet, features: (nextSheet.features ?? []).map(x =>
        usesPatch[x.id] !== undefined ? { ...x, uses: { ...x.uses!, current: usesPatch[x.id] } } : x) }
    }

    /* THREE COLUMNS, ONE WRITE. Variables land in `resources`, use counters on
       `sheet`, spell slots in `spellbook` — and a press that spends a slot to
       refill a counter has to land both or neither. */
    if (applied.length) {
      await updateSections({
        ...(nextSheet !== sheet ? { sheet: nextSheet } : {}),
        ...(spellbook ? { spellbook } : {}),
        resources: resources as CharacterRow['resources'],
      })
    } else if (nextSheet !== sheet) {
      await updateSection('sheet', nextSheet)
    }
    setBusy(false)

    const subtitle = u ? `${remaining} / ${u.max} uses left` : (f.usage ?? 'Feature')
    addRoll({
      kind: 'custom', title: f.name, subtitle, icon: f.icon, lines,
      subject: { kind: 'feature', id: f.id },
      riderGroups: contrib.riders.length ? [{ label: 'Feature', riders: contrib.riders }] : undefined,
      notes: res.notes.length ? res.notes : undefined,
      problems: res.problems.length ? res.problems : undefined,
    })
  }

  const sheet = pending && createPortal(
    <ActivationConfirm
      feature={pending.feature} outcomes={pending.outcomes} character={character} busy={busy}
      onCancel={() => setPending(null)}
      onConfirm={picked => { const p = pending; setPending(null); void run(p.feature, p.outcomes, picked) }}
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
export type Picked = { answers: Set<string>; recipient?: string; slotLevel?: number }

function ActivationConfirm({ feature, outcomes, character, busy, onCancel, onConfirm }: {
  feature: Feature; outcomes: Outcome[]; character: CharacterRow; busy: boolean
  onCancel: () => void; onConfirm: (picked: Picked) => void
}) {
  /* PRE-TICKED. The sheet already lists everything the press will do, so
     Confirm accepting it is the plain reading and unticking is how you decline —
     §32 still holds, because each one is shown and each one can be refused. An
     empty start meant Use → tick → Confirm for the common case of wanting the
     whole thing. */
  const [answers, setAnswers] = useState<Set<string>>(
    () => new Set(outcomes.filter(o => o.ask).map(o => o.ask!)),
  )
  const toggle = (label: string) =>
    setAnswers(prev => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label); else next.add(label)
      return next
    })

  /* WHO GETS IT. Only asked when a grant is actually on the plan, and only
     ONE recipient per press: every rule shaped like this hands the die to "a
     creature", singular, and a picker that allowed two would be inventing a
     feature the rules do not have. */
  const grants = outcomes.filter((o): o is GrantOutcome => o.kind === 'grant')
  const [recipient, setRecipient] = useState<string | undefined>(undefined)
  const needsRecipient = grants.some(o => !o.ask || answers.has(o.ask))

  /* WHICH SLOT. "Expend a spell slot" does not name a level, so the player picks
     — from what they actually have left, since an empty level is not a choice.
     Only asked when the author left the level open; a rule that names one, and
     a Pact Magic caster, both arrive already answered. */
  const slots = outcomes.filter((o): o is SlotOutcome => o.kind === 'slot')
  const openSlot = slots.find(o => o.level === undefined && (!o.ask || answers.has(o.ask)))
  const [slotLevel, setSlotLevel] = useState<number | undefined>(undefined)
  const ladder = openSlot ? slotLadder(character).filter(r => r.avail >= Math.abs(openSlot.delta)) : []

  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.confirm} onClick={e => e.stopPropagation()} role="dialog" aria-label={`Use ${feature.name}`}>
        <div className={styles.cfHead}>
          <span className={styles.pIcon}><Icon name={feature.icon ?? 'fa-bolt'} /></span>
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

        {needsRecipient && <RecipientPicker value={recipient} onPick={setRecipient} />}

        {openSlot && (
          <div className={styles.cfGrant}>
            <div className={styles.cfGrantHead}>Which slot to {openSlot.delta < 0 ? 'spend' : 'restore'}</div>
            {ladder.length === 0 && (
              <div className={styles.cfGrantNote}>No slot is available to pay this, so the feature cannot be used.</div>
            )}
            {ladder.map(r => (
              <button
                key={r.level} type="button"
                className={`${styles.cfRow} ${styles.cfAsk} ${slotLevel === r.level ? styles.cfOn : ''}`}
                aria-pressed={slotLevel === r.level} onClick={() => setSlotLevel(r.level)}
              >
                <i className={`fa-${slotLevel === r.level ? 'solid fa-circle-dot' : 'regular fa-circle'}`} />
                <span className={styles.cfLabel}>Level {r.level}</span>
                <span className={styles.cfVal}>{r.avail} / {r.total} left</span>
              </button>
            ))}
          </div>
        )}

        <div className={styles.cfFoot}>
          <button type="button" className={styles.cfCancel} onClick={onCancel}>Cancel</button>
          <button
            type="button" className={styles.pUse}
            disabled={busy || (needsRecipient && !recipient) || (!!openSlot && slotLevel === undefined)}
            onClick={() => onConfirm({ answers, recipient, slotLevel })}
          >Confirm</button>
        </div>
      </div>
    </div>
  )
}

/** The party roster as a one-of list — the recipient of a `grant`.
 *
 *  Its own component so the roster is fetched only when a press actually needs
 *  it: every other confirm sheet in the app is a local question, and making all
 *  of them wait on a round trip to answer one would be a cost paid by the
 *  common case for the rare one.
 *
 *  An empty roster DISABLES the press rather than letting it through: a die
 *  granted to nobody is a use spent for nothing, and "no party members are
 *  bound" is something the player needs told, not worked around.
 */
function RecipientPicker({ value, onPick }: { value?: string; onPick: (id: string) => void }) {
  const { roster, loading, error } = usePartyRoster()

  return (
    <div className={styles.cfGrant}>
      <div className={styles.cfGrantHead}>Who receives it</div>
      {loading && <div className={styles.cfGrantNote}>Reading the party roster…</div>}
      {!loading && error && <div className={styles.cfGrantNote}>The roster could not be read — {error}</div>}
      {!loading && !error && roster.length === 0 && (
        <div className={styles.cfGrantNote}>No other characters are bound, so there is nobody to give this to.</div>
      )}
      {roster.map(p => (
        <button
          key={p.id} type="button"
          className={`${styles.cfRow} ${styles.cfAsk} ${value === p.id ? styles.cfOn : ''}`}
          aria-pressed={value === p.id} onClick={() => onPick(p.id)}
        >
          <i className={`fa-${value === p.id ? 'solid fa-circle-dot' : 'regular fa-circle'}`} />
          <span className={styles.cfLabel}>{p.name}</span>
          <span className={styles.cfVal}>{[p.class, p.level ? `L${p.level}` : null].filter(Boolean).join(' · ')}</span>
        </button>
      ))}
    </div>
  )
}
