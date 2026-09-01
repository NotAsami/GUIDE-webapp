import { useEffect, useState } from 'react'
import type {
  CharacterRow, CharacterUpdate, EquippedGear, InventoryItem, Json, PendingPathOption, ShardTree,
} from '../lib/database.types'
import { pendingLevelStale, takeLevelPatch, type LevelUpChoices } from '../lib/levelup'
import { useBackdropFreeze } from '../lib/backdropFreeze'
import { LevelUpOverlay } from './LevelUpOverlay'
import {
  grantKitItems, grantKitOption, kitEntriesText, openQuestions, poolKey,
  type KitQuestion,
} from '../lib/kit'
import { SKILLS } from '../lib/dnd'
import styles from './StartingKit.module.css'
import { Inline } from '../lib/markdown'
import { Icon } from './Icon'

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
export function StartingKit({ character, shardTrees, onUpdate }: {
  character: CharacterRow
  /** Needed only by the level-up: `levelUpPatch` clamps current HP against the
   *  EFFECTIVE ceiling, and a shard can move that. */
  shardTrees: Record<string, ShardTree>
  onUpdate: (patch: CharacterUpdate) => Promise<void>
}) {
  const sheet = character.sheet ?? {}
  const kit = sheet.pendingKit
  const skills = sheet.pendingSkills
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  /** The level-up overlay, opened from the level row. Its own state because it
   *  is a portal over the card, not a section of it. */
  const [levelling, setLevelling] = useState(false)

  /* This panel's scrim carries a backdrop blur, and the Codex behind it has a
     sigil on two infinite rotations — so without this the blur re-runs every
     frame for as long as the card is open. See lib/backdropFreeze. */
  useBackdropFreeze(open)

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

  /* A LEVEL THE DM RELEASED. It is the one decision here the player was looking
     forward to, so it leads the card — but it still does not open itself.
     A STALE release still shows: the plan was resolved against a level the
     character has since left and cannot be recomputed player-side (the
     catalogs are DM-only), so the only move is to ask for a new one, and a
     card that silently hid it would leave them waiting for nothing. */
  const release = sheet.pendingLevel ?? null
  const releaseStale = !!release && pendingLevelStale(character, release)
  const releaseDue = !!release && !releaseStale

  const total = questions.length + (skillsLeft > 0 ? 1 : 0) + (pathDue ? 1 : 0) + (release ? 1 : 0)

  if (!kit && !skills && !path && !release) return null
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

  /** Take the released level. ONE WRITE — `takeLevelPatch` applies the
   *  advancement and clears the release together, because a level applied
   *  without the release cleared leaves the card offering it again. */
  async function takeLevel(choices: LevelUpChoices): Promise<boolean> {
    if (!release || busy) return false
    setBusy(true)
    await onUpdate(takeLevelPatch(character, release, choices, shardTrees))
    setBusy(false)
    return true
  }

  const className = release?.plan.className ?? kit?.className ?? skills?.className ?? path?.className
  /** How many pips, and what colour each is. Cyan is the level, amber a class
   *  question — the same split the accent bar makes. */
  const pips = [
    ...(release ? ['level'] : []),
    ...Array(total - (release ? 1 : 0)).fill('kit'),
  ]

  if (!open) {
    return (
      <button type="button" className={cx(styles.prompt, release && styles.hasLevel)} onClick={() => setOpen(true)}>
        <span className={cx(styles.pIc, release && styles.pHex)}>
          {release
            ? <span className={styles.pLv}>{release.plan.toLevel}</span>
            : <i className="fa-solid fa-sack-xmark" />}
        </span>
        <span className={styles.pTx}>
          <span className={styles.pT}>
            {!release
              ? 'Finish your character'
              : releaseStale
                ? 'Your level-up is out of date'
                : total > 1
                  ? `Level ${release.plan.toLevel}, and ${total - 1} thing${total === 2 ? '' : 's'} to settle`
                  : `Level ${release.plan.toLevel} is yours to take`}
          </span>
          <span className={styles.pS}>
            {className}
            {release && !releaseStale && ' · granted by your DM'}
            {' · '}{total} decision{total === 1 ? '' : 's'}
          </span>
        </span>
        <span className={styles.pips} aria-hidden="true">
          {pips.map((kind, i) => (
            <span key={i} className={cx(styles.pip, kind === 'level' && styles.pipLevel)} />
          ))}
        </span>
        <span className={styles.pGo}>
          {release && !releaseStale ? 'Take it' : 'Open'} <i className="fa-solid fa-chevron-right" />
        </span>
      </button>
    )
  }

  return (
    <>
      {/* A button, not a div: clicking away is a real affordance and should be
          reachable from the keyboard too. */}
      <button type="button" className={styles.scrim} aria-label="Close class setup"
        onClick={() => setOpen(false)} />
      <section className={cx(styles.kit, release && styles.hasLevel)} role="dialog" aria-modal="true"
        aria-label={release ? 'Your decisions' : 'Class setup'}>
      <div className={styles.kHead}>
        <i className={release ? 'fa-solid fa-arrow-up-right-dots' : 'fa-solid fa-sack-xmark'} />
        <span className={styles.kT}>{release ? 'Your Decisions' : 'Class Setup'}</span>
        <span className={styles.kS}>{character.name} · {className}</span>
        <button type="button" className={styles.kX} onClick={() => setOpen(false)}>
          <i className="fa-solid fa-xmark" /> Later
        </button>
      </div>

      {release && (
        <div className={styles.kChoice}>
          <div className={styles.kcLab}>
            Advancement
            <span className={cx(styles.kcCount, styles.kcCyan)}>
              Released {new Date(release.releasedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
          <div className={cx(styles.lvRow, releaseStale && styles.lvStale, levelling && styles.lvQuiet)}>
            <span className={styles.lvHex}><span className={styles.lvN}>{release.plan.toLevel}</span></span>
            <span className={styles.lvTx}>
              <span className={styles.lvT}>
                <span className={styles.lvFrom}>Level {release.plan.fromLevel}</span>
                <span className={styles.lvArw}>→</span>
                <span>Level {release.plan.toLevel}</span>
              </span>
              {releaseStale ? (
                <span className={styles.lvD}>
                  This was prepared for level {release.plan.fromLevel}, and you are on{' '}
                  {character.identity?.level ?? 1} now — the numbers in it no longer fit.
                  Ask your DM to release it again.
                </span>
              ) : (
                <>
                  <span className={styles.lvD}>
                    Roll your own hit die, take what {release.plan.className} opens at{' '}
                    {release.plan.toLevel}, and spend your ability points. Nothing is written until
                    you confirm.
                  </span>
                  <span className={styles.lvMeta}>
                    <span className={styles.mchip}>1d{release.plan.hitDie} + {release.plan.conMod} HP</span>
                    {release.plan.offers.length > 0 && (
                      <span className={styles.mchip}>
                        {release.plan.offers.length} feature{release.plan.offers.length === 1 ? '' : 's'}
                      </span>
                    )}
                    <span className={styles.mchip}>Ability score or feat</span>
                  </span>
                </>
              )}
            </span>
            {releaseDue && (
              <button type="button" className={styles.lvGo} disabled={busy}
                onClick={() => setLevelling(true)}>
                Begin <i className="fa-solid fa-arrow-right" />
              </button>
            )}
          </div>
        </div>
      )}

      {levelling && release && (
        <LevelUpOverlay
          tone="player"
          blurBackdrop={false}
          plan={release.plan}
          feats={release.feats}
          row={character}
          shardTrees={shardTrees}
          hp={{ current: sheet.hp?.current ?? 0, max: sheet.hp?.max ?? 0 }}
          onApply={takeLevel}
          onClose={() => setLevelling(false)}
        />
      )}

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
                  <Icon name={op.icon || 'fa-code-branch'} />
                </span>
                <span className={styles.koTx}>
                  <span className={styles.koL}>{op.name}</span>
                  <span className={styles.koI}>
                    {op.features.length} feature{op.features.length === 1 ? '' : 's'}
                    {op.spellbook ? ' · unlocks spellcasting' : ''}
                  </span>
                  {op.desc?.trim() && <span className={styles.koD}><Inline text={op.desc} /></span>}
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
                  <span className={styles.piIc}><Icon name={it.data.icon ?? 'fa-box'} /></span>
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
