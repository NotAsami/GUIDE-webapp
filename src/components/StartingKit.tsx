import { useEffect, useState } from 'react'
import type {
  CharacterRow, CharacterUpdate, EquippedGear, InventoryItem, Json, PendingPathOption,
} from '../lib/database.types'
import {
  grantKitItems, grantKitOption, kitEntriesText, openQuestions, poolKey,
  type KitQuestion,
} from '../lib/kit'
import { SKILLS } from '../lib/dnd'
import styles from './StartingKit.module.css'

const cx = (...v: (string | false | undefined | null)[]) => v.filter(Boolean).join(' ')

/**
 * The decisions a class hands to the PLAYER.
 *
 * Two kinds, both of which are theirs rather than the DM's:
 *
 *  - STARTING KIT. "(a) a martial weapon and a shield, or (b) two martial
 *    weapons" — and once (a) is taken, WHICH martial weapon. Assign resolves
 *    every option and every pool against the item catalog (which players cannot
 *    read) and parks the result on `sheet.pendingKit`.
 *  - SKILL PROFICIENCIES. The class offers a list and a count; the pick is the
 *    player's, so assign parks it on `sheet.pendingSkills` rather than choosing.
 *  - THE PATH. Which subclass they take. Parked at class-assign time whatever
 *    their level, and surfaced here only once they reach the level the class
 *    names — which is what lets a level-3 choice appear at level 3 with no
 *    level-up hook to run.
 *
 * IT DOES NOT OPEN ITSELF. It is a card the player taps, sitting above the
 * story row until the last decision is made and then gone for good — no modal
 * ambush on a screen someone opened to read their campaign progress. Anything
 * with only one answer never appears here at all: assign granted it outright,
 * because a question with one answer is not a question.
 */
export function StartingKit({ character, onUpdate }: {
  character: CharacterRow
  onUpdate: (patch: CharacterUpdate) => Promise<void>
}) {
  const sheet = character.sheet ?? {}
  const kit = sheet.pendingKit
  const skills = sheet.pendingSkills
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  // An overlay that traps you in it is worse than one that pushes layout
  // around. Escape closes, same as every other panel in the app.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const questions = openQuestions(kit)
  const path = sheet.pendingPath
  const level = character.identity?.level ?? 1
  // Parked early, asked late. Below the class's own level this is not a
  // decision yet, so it is not a decision the card counts or shows.
  const pathDue = !!path && level >= path.level && (path.options?.length ?? 0) > 0
  const skillsTaken = (skills?.from ?? []).filter(k => (sheet.skillProficiencies ?? []).includes(k)).length
  const skillsLeft = skills ? Math.max(0, skills.count - skillsTaken) : 0
  const total = questions.length + (skillsLeft > 0 ? 1 : 0) + (pathDue ? 1 : 0)

  if (!kit && !skills && !path) return null
  if (total === 0) return null

  /** One write per answer. Everything that becomes settled by this answer is
   *  granted in the same patch, so a refresh can never land between "chosen"
   *  and "in the pack". */
  async function answerOption(q: Extract<KitQuestion, { kind: 'option' }>, optionId: string) {
    if (!kit || busy) return
    const option = q.options.find(o => o.id === optionId)
    if (!option) return
    setBusy(true)
    const gear = (character.equipped ?? {}) as EquippedGear
    const inventory = ((character.inventory as unknown as InventoryItem[]) ?? [])
    const nextKit = { ...kit, picked: { ...(kit.picked ?? {}), [q.choiceId]: optionId } }
    const stillOpen = openQuestions(nextKit).length > 0
    await onUpdate({
      inventory: grantKitOption(option, gear, inventory) as unknown as Json[],
      sheet: { ...sheet, ...(stillOpen ? { pendingKit: nextKit } : { pendingKit: undefined }) },
    })
    setBusy(false)
  }

  async function answerPool(q: Extract<KitQuestion, { kind: 'pool' }>, itemId: string) {
    if (!kit || busy) return
    const chosen = q.pool.find(p => p.item_id === itemId)
    if (!chosen) return
    setBusy(true)
    const gear = (character.equipped ?? {}) as EquippedGear
    const inventory = ((character.inventory as unknown as InventoryItem[]) ?? [])
    const key = poolKey(q.choiceId, q.entry)
    const nextKit = {
      ...kit,
      picks: { ...(kit.picks ?? {}), [key]: [...(kit.picks?.[key] ?? []), itemId] },
    }
    const stillOpen = openQuestions(nextKit).length > 0
    await onUpdate({
      inventory: grantKitItems([chosen], gear, inventory) as unknown as Json[],
      sheet: { ...sheet, ...(stillOpen ? { pendingKit: nextKit } : { pendingKit: undefined }) },
    })
    setBusy(false)
  }

  async function toggleSkill(key: string) {
    if (!skills || busy) return
    const have = sheet.skillProficiencies ?? []
    const on = have.includes(key)
    // Never past the allowance: an over-picked sheet is a rules error the DM
    // then has to find. Clicking a chosen one gives the pick back.
    if (!on && skillsLeft === 0) return
    setBusy(true)
    const next = on ? have.filter(k => k !== key) : [...have, key]
    const takenAfter = skills.from.filter(k => next.includes(k)).length
    await onUpdate({
      sheet: {
        ...sheet,
        skillProficiencies: next,
        ...(takenAfter >= skills.count ? { pendingSkills: undefined } : {}),
      },
    })
    setBusy(false)
  }

  async function takePath(option: PendingPathOption) {
    if (!path || busy) return
    setBusy(true)
    // The options are alternatives, so taking one clears any other's grants —
    // a player who changes their mind must not end up carrying both.
    const otherIds = path.options.filter(o => o.id !== option.id).map(o => `cls:${o.id}`)
    const kept = (sheet.features ?? []).filter(
      f => !otherIds.some(pre => f.id?.startsWith(pre)) && !f.id?.startsWith(`cls:${option.id}`),
    )
    await onUpdate({
      identity: { ...(character.identity ?? {}), archetype: option.name },
      sheet: { ...sheet, features: [...option.features, ...kept], pendingPath: undefined },
      ...(option.spellbook ? { spellbook: { ...(character.spellbook ?? {}), ...option.spellbook } } : {}),
    })
    setBusy(false)
  }

  if (!open) {
    return (
      <button type="button" className={styles.prompt} onClick={() => setOpen(true)}>
        <span className={styles.pIc}><i className="fa-solid fa-sack-xmark" /></span>
        <span className={styles.pTx}>
          <span className={styles.pT}>Finish your character</span>
          <span className={styles.pS}>
            {kit?.className ?? skills?.className ?? path?.className} · {total} decision{total === 1 ? '' : 's'} left
          </span>
        </span>
        <span className={styles.pGo}>Open <i className="fa-solid fa-chevron-right" /></span>
      </button>
    )
  }

  return (
    <>
      {/* A button, not a div: clicking away is a real affordance and should be
          reachable from the keyboard too. */}
      <button type="button" className={styles.scrim} aria-label="Close class setup"
        onClick={() => setOpen(false)} />
      <section className={styles.kit} role="dialog" aria-modal="true" aria-label="Class setup">
      <div className={styles.kHead}>
        <i className="fa-solid fa-sack-xmark" />
        <span className={styles.kT}>Class Setup</span>
        <span className={styles.kS}>{kit?.className ?? skills?.className ?? path?.className}</span>
        <button type="button" className={styles.kX} onClick={() => setOpen(false)}>
          <i className="fa-solid fa-xmark" /> Later
        </button>
      </div>

      {skillsLeft > 0 && skills && (
        <div className={styles.kChoice}>
          <div className={styles.kcLab}>
            Skill proficiencies
            <span className={styles.kcCount}>{skillsTaken} / {skills.count}</span>
          </div>
          <div className={styles.skillGrid}>
            {skills.from.map(key => {
              const sk = SKILLS.find(x => x.key === key)
              const on = (sheet.skillProficiencies ?? []).includes(key)
              return (
                <button
                  key={key} type="button" className={cx(styles.skillChip, on && styles.on)}
                  disabled={busy || (!on && skillsLeft === 0)}
                  aria-pressed={on}
                  onClick={() => void toggleSkill(key)}
                >
                  <span className={styles.scDot} />
                  {sk?.name ?? key}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {pathDue && path && (
        <div className={styles.kChoice}>
          <div className={styles.kcLab}>{path.label}</div>
          <div className={styles.kcOpts}>
            {path.options.map(op => (
              <button
                key={op.id} type="button" className={cx(styles.kOpt, busy && styles.busy)}
                disabled={busy} onClick={() => void takePath(op)}
              >
                <span className={styles.koN} style={op.color ? { color: op.color } : undefined}>
                  <i className={`fa-solid ${op.icon || 'fa-code-branch'}`} />
                </span>
                <span className={styles.koTx}>
                  <span className={styles.koL}>{op.name}</span>
                  <span className={styles.koI}>
                    {op.features.length} feature{op.features.length === 1 ? '' : 's'}
                    {op.spellbook ? ' · unlocks spellcasting' : ''}
                  </span>
                  {op.desc?.trim() && <span className={styles.koD}>{op.desc}</span>}
                </span>
                <span className={styles.koGo}><i className="fa-solid fa-arrow-right" /></span>
              </button>
            ))}
          </div>
          <p className={styles.kcNote}>
            This one is permanent — ask your DM if you need it changed later.
          </p>
        </div>
      )}

      {questions.map(q => (
        <div key={q.kind === 'option' ? q.choiceId : `${q.choiceId}.${q.entry}`} className={styles.kChoice}>
          <div className={styles.kcLab}>
            {q.kind === 'option' ? (q.label || 'Choose one') : q.label}
            {q.kind === 'pool' && (
              <span className={styles.kcCount}>{q.chosen.length} / {q.count}</span>
            )}
          </div>

          {q.kind === 'option' ? (
            <div className={styles.kcOpts}>
              {q.options.map((op, i) => (
                <button
                  key={op.id} type="button" className={cx(styles.kOpt, busy && styles.busy)}
                  disabled={busy} onClick={() => void answerOption(q, op.id)}
                >
                  <span className={styles.koN}>{'abcdefgh'[i]}</span>
                  <span className={styles.koTx}>
                    <span className={styles.koL}>{op.label || 'Unnamed option'}</span>
                    <span className={styles.koI}>{kitEntriesText(op.items)}</span>
                  </span>
                  <span className={styles.koGo}><i className="fa-solid fa-arrow-right" /></span>
                </button>
              ))}
            </div>
          ) : (
            /* A pool is a grid, not a stack: it can hold a dozen weapons, and a
               dozen full-width rows buries every other question below it. */
            <div className={styles.poolGrid}>
              {q.pool.map(it => (
                <button
                  key={it.item_id} type="button" className={cx(styles.poolItem, busy && styles.busy)}
                  disabled={busy} onClick={() => void answerPool(q, it.item_id)}
                >
                  <span className={styles.piIc}><i className={`fa-solid ${it.data.icon ?? 'fa-box'}`} /></span>
                  <span className={styles.piNm}>{it.data.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ))}

      {/* Only when there IS gear to pick. A card asking nothing but a path was
          still telling the player where their gear would land. */}
      {questions.length > 0 && (
        <p className={styles.kFoot}>
          Picked gear drops straight into your pack. Nothing here can be undone from this screen —
          ask your DM if you need it moved.
        </p>
      )}
      </section>
    </>
  )
}
