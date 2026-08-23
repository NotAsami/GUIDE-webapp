/**
 * Level Up — guided advancement, as a focused overlay.
 *
 * ONE PANEL, TWO TONES. The DM runs it from the console (amber, the operator
 * accent); the player runs it from their Codex once the DM has RELEASED the
 * level (cyan, the player accent). The steps are identical because the
 * decisions are — the only difference is who is making them, which `tone`
 * carries into the accent variables and three lines of copy. A second
 * component would have drifted from this one a fix at a time.
 *
 * A CHECKLIST THE TAKER CONFIRMS, not a rules engine. Every number here is a
 * suggestion computed by lib/levelup.ts; nothing is written until Apply, and
 * the summary in the footer is the full cascade so the commit is never a
 * surprise. That framing is the mockup's and it is what makes the screen
 * survive homebrew — no class table is authoritative.
 *
 * The overlay OWNS the DM's choices and nothing else. It never touches the
 * character row: `onApply` hands the choices back to the console, which builds
 * the one patch through `levelUpPatch`. Two places deciding what a level costs
 * is exactly the split this codebase keeps paying for.
 *
 * Chrome is the amber sibling of LootRollOverlay — same portal, same layered
 * chamfer, same Escape effect. Escape CLOSES here rather than minimising: an
 * abandoned level-up has written nothing, so there is no state worth parking.
 */

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AbilityKey, CatalogFeatureRow, CatalogFeatureData, CharacterRow, Feature, ShardTree } from '../lib/database.types'
import { ABILITY_ABBR, ABILITY_ORDER, formatMod } from '../lib/dnd'
import { ordinal } from '../lib/classes'
import { ASI_LEVELS, asiUsed, hpGainOf, nextCurrentHp, type LevelUpChoices, type LevelUpPlan } from '../lib/levelup'
import { prereqMet, prereqSummary } from '../lib/feats'
import { useBackdropFreeze } from '../lib/backdropFreeze'
import { renderInline } from '../lib/markdown'
import { Icon } from './Icon'
import styles from './LevelUpOverlay.module.css'
/* The console's chamfered button, reused rather than re-cut — its `.bf`/`.bi`
 * two-layer recipe is the clip-path-plus-border trap documented in
 * docs/Chamfered_clip-path_corners_fix.md, and a second copy is a second chance
 * to get the corners wrong. LootRollOverlay reaches for it for the same reason. */
import con from '../screens/OperatorConsole.module.css'

const cx = (...c: (string | false | undefined | null)[]) => c.filter(Boolean).join(' ')

type HpMode = 'roll' | 'average' | 'manual'

/** Card text, in the order the player's dossier falls back through. */
const blurb = (d: CatalogFeatureData) =>
  (d.light_description || d.summary || d.description || '').trim()

export function LevelUpOverlay({ plan, feats, row, shardTrees, hp, tone = 'dm', blurBackdrop = true, onApply, onClose }: {
  plan: LevelUpPlan
  /** Who is walking it. Repoints the accent (operator amber ↔ player cyan) and
   *  the copy that says whose decision this is; the steps are identical,
   *  because the decisions are. */
  tone?: 'dm' | 'player'
  /** False when something already-scrimmed is underneath. Two stacked
   *  `backdrop-filter`s blur an already-blurred image for no visual gain and
   *  double the per-frame cost, so the panel opened from the decisions card
   *  turns its own off. */
  blurBackdrop?: boolean
  /** Published `category: 'feat'` rows — the library a feat pick assigns from. */
  feats: CatalogFeatureRow[]
  /** The character, so a feat's prerequisite can be CHECKED rather than printed.
   *  Passed whole because a prerequisite may ask about level, an effective
   *  ability score, or a feature on the sheet. */
  row: CharacterRow
  shardTrees: Record<string, ShardTree>
  /** Current base HP, so step 01 can show the before/after without the overlay
   *  reaching into the row itself. */
  hp: { current: number; max: number }
  onApply: (choices: LevelUpChoices) => Promise<boolean>
  onClose: () => void
}) {
  const [mode, setMode] = useState<HpMode>('roll')
  const [roll, setRoll] = useState(() => 1 + Math.floor(Math.random() * plan.hitDie))
  const [manual, setManual] = useState(plan.avg)
  const [flash, setFlash] = useState(false)
  const [adv, setAdv] = useState<'asi' | 'feat'>('asi')
  const [alloc, setAlloc] = useState<Partial<Record<AbilityKey, number>>>({})
  const [featId, setFeatId] = useState<string | null>(null)
  /* Gates that open AT the new level arrive checked; ones that were already open
     and never granted arrive unchecked, so the default commit is "what this
     level unlocked" and the rest is an offer, not a surprise. */
  const [picks, setPicks] = useState<string[]>(() => plan.offers.filter(o => o.fresh).map(o => o.id))
  const [busy, setBusy] = useState(false)

  /* Pause the decorations under the scrim. Without this the rotating Codex
     sigil invalidates the backdrop blur every frame — see lib/backdropFreeze. */
  useBackdropFreeze()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const die = mode === 'average' ? plan.avg
    : mode === 'manual' ? Math.max(1, Math.min(plan.hitDie, manual))
      : roll
  const gain = hpGainOf(plan, die)
  /* The SAME function the patch uses. Recomputing it here is how the note
     came to promise a number the write never made. */
  const nextCur = nextCurrentHp(hp.current, gain, hp.max + gain, plan.hpMaxBonus)
  const used = asiUsed(alloc)
  const feat = feats.find(f => f.id === featId) ?? null
  /** Prerequisite verdicts, one per feat. Computed once per render rather than
   *  per row — `prereqMet` reads the effective sheet, which is not free. */
  const prereq = useMemo(
    () => new Map(feats.map(f => [f.id, prereqMet(f.data.prerequisite, row, shardTrees)])),
    [feats, row, shardTrees],
  )
  /* ---- PREREQUISITES ON THE CLASS OFFERS ----
     Checked against the sheet PLUS whatever is ticked right now. A level that
     opened both halves of a dependency — take Reckless Attack, then Brutal
     Strike — would otherwise refuse the second for lacking a first that the
     very same write is granting. Ticking one unlocks the other, live. */
  const offerPrereq = useMemo(() => {
    const chosen = plan.offers.filter(o => picks.includes(o.id)).map(o => o.data as unknown as Feature)
    const withPicks = {
      ...row,
      sheet: { ...(row.sheet ?? {}), features: [...(row.sheet?.features ?? []), ...chosen] },
    } as CharacterRow
    return new Map(plan.offers.map(o => [o.id, prereqMet(o.data.prerequisite, withPicks, shardTrees)]))
  }, [plan.offers, picks, row, shardTrees])

  /** What Apply actually grants. A pre-ticked offer whose prerequisite turns out
   *  unmet is dropped here rather than pruned out of `picks` by an effect — one
   *  derivation, so the footer summary and the write can never disagree about
   *  what is being taken. */
  const effectivePicks = picks.filter(id => offerPrereq.get(id)?.ok !== false)

  const isAsiLevel = ASI_LEVELS.includes(plan.toLevel)
  const profChanged = plan.profTo !== plan.profFrom
  const dcChanged = !!plan.castFrom && !!plan.castTo && plan.castTo.saveDC !== plan.castFrom.saveDC

  const reroll = () => {
    setRoll(1 + Math.floor(Math.random() * plan.hitDie))
    setFlash(true)
    // Re-arm the animation next time rather than leaving the class on.
    window.setTimeout(() => setFlash(false), 480)
  }

  const bump = (k: AbilityKey, by: 1 | -1) => setAlloc(prev => {
    const at = prev[k] ?? 0
    if (by > 0 && (asiUsed(prev) >= 2 || plan.abilityScores[k] + at >= 20)) return prev
    if (by < 0 && at <= 0) return prev
    return { ...prev, [k]: at + by }
  })

  const toggle = (id: string) =>
    setPicks(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))

  const apply = async () => {
    setBusy(true)
    const ok = await onApply({
      die,
      asiAlloc: adv === 'asi' ? alloc : {},
      feat: adv === 'feat' ? feat : null,
      featureIds: effectivePicks,
    })
    setBusy(false)
    if (ok) onClose()
  }

  /** "This is mine to take" — the player tone. Read once so the copy and the
   *  accent can never disagree about whose screen this is. */
  const mine = tone === 'player'

  const asiParts = ABILITY_ORDER.filter(k => (alloc[k] ?? 0) > 0)
    .map(k => `+${alloc[k]} ${ABILITY_ABBR[k].toUpperCase()}`)
  const takenFeatures = plan.offers.filter(o => effectivePicks.includes(o.id))
  const slotsGained = plan.slotsTo.reduce((a, b) => a + b, 0) - plan.slotsFrom.reduce((a, b) => a + b, 0)

  return createPortal(
    <div className={cx(styles.overlay, mine && styles.player)} role="dialog" aria-modal="true"
      aria-label={mine ? `Take level ${plan.toLevel}` : `Level up ${plan.name}`}>
      <div className={cx(styles.scrim, !blurBackdrop && styles.noBlur)} onClick={onClose} />
      <div className={styles.panel}>
        <div className={styles.pnGap} />
        <div className={styles.pnLine} />
        <div className={styles.pnInner}>
          <span className={cx(styles.pnCorner, styles.tl)} />
          <span className={cx(styles.pnCorner, styles.br)} />

          {/* ---- header ---- */}
          <header className={styles.head}>
            <div className={styles.sigil}><i className="fa-solid fa-angles-up" /></div>
            <div className={styles.titles}>
              <div className={styles.kicker}>{mine ? 'Your Advancement' : 'Guided Advancement · Operator'}</div>
              <div className={styles.hname}>{plan.name}</div>
              <div className={styles.hclass}>
                {plan.className}
                {plan.archetype && <><span className={styles.sep}>·</span>{plan.archetype}</>}
              </div>
            </div>
            <div className={styles.trans}>
              <div className={styles.stat}>
                <span className={styles.statL}>Level</span>
                <span className={styles.statV}>
                  <span className={styles.from}>{plan.fromLevel}</span>
                  <span className={styles.arrow}>→</span>
                  <span className={styles.to}>{plan.toLevel}</span>
                </span>
              </div>
              <div className={styles.vrule} />
              <div className={cx(styles.stat, styles.dice)}>
                <span className={styles.statL}>Hit Dice</span>
                <span className={styles.statV}>
                  <span className={styles.from}>{plan.hitDiceFrom}</span>
                  <span className={styles.arrow}>→</span>
                  <span className={styles.to}>{plan.hitDiceTo}</span>
                </span>
              </div>
            </div>
            <button type="button" className={styles.close} onClick={onClose} aria-label="Cancel level up">
              <span className={styles.clf} /><span className={styles.cli}><i className="fa-solid fa-xmark" /></span>
            </button>
          </header>

          <div className={styles.body}>
            {plan.classMissing && (
              <div className={styles.empty}>
                <i className="fa-solid fa-triangle-exclamation" />
                <span>
                  No class in the catalog matches <b>{plan.className}</b>, so there is no hit
                  die, no gated feature list and no slot table to read. Level, HP and hit dice
                  still apply — assign a class under Oversee to get the rest.
                </span>
              </div>
            )}

            {/* ---- 01 HIT POINTS ---- */}
            <section className={styles.step}>
              <div className={styles.stepHead}>
                <span className={styles.sn}>01</span>
                <span className={styles.st}>Hit Points</span>
                <span className={styles.tag}>Confirm</span>
              </div>
              <div className={styles.card}>
                <div className={styles.modes}>
                  {([
                    ['roll', 'fa-dice-d20', 'Roll the die'],
                    ['average', 'fa-equals', 'Average'],
                    ['manual', 'fa-pen', 'Manual'],
                  ] as const).map(([k, ic, lab]) => (
                    <div key={k} className={cx(styles.mode, mode === k && styles.sel)}
                      role="button" tabIndex={0}
                      onClick={() => setMode(k)}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setMode(k) } }}>
                      <Icon name={ic} />{lab}
                    </div>
                  ))}
                </div>

                <div className={styles.modebody}>
                  <div className={cx(styles.die, mode === 'roll' && flash && styles.flash)}>{die}</div>
                  <div className={styles.dievals}>
                    {mode === 'roll' && <>
                      <span className={styles.lab}>d{plan.hitDie} roll</span>
                      <button type="button" className={cx(con.btn, con.ghost, con.sm, styles.reroll)} onClick={reroll}>
                        <span className={con.bf} />
                        <span className={con.bi}><i className="fa-solid fa-dice-d20" /> Re-roll d{plan.hitDie}</span>
                      </button>
                    </>}
                    {mode === 'average' && <>
                      <span className={styles.lab}>Average of d{plan.hitDie}</span>
                      <span className={styles.big}>Fixed · takes the guesswork out</span>
                    </>}
                    {mode === 'manual' && <>
                      <span className={styles.lab}>Manual d{plan.hitDie} result</span>
                      <div className={styles.stepperbox}>
                        <button type="button" disabled={die <= 1} aria-label="Lower the die result"
                          onClick={() => setManual(Math.max(1, die - 1))}>−</button>
                        <span className={styles.val}>{die}</span>
                        <button type="button" disabled={die >= plan.hitDie} aria-label="Raise the die result"
                          onClick={() => setManual(Math.min(plan.hitDie, die + 1))}>+</button>
                      </div>
                    </>}
                  </div>
                </div>

                <div className={styles.calc}>
                  <span className={styles.chip}>d{plan.hitDie} result <b>{die}</b></span>
                  <span className={styles.op}>+</span>
                  <span className={styles.chip}>CON mod <b>{formatMod(plan.conMod)}</b></span>
                  <span className={styles.res}>= <span className={styles.pl}>+{gain}</span> max HP</span>
                </div>

                <div className={styles.newmax}>
                  <span className={styles.l}>New Max HP</span>
                  <span className={styles.from}>{hp.max}</span>
                  <span className={styles.arrow}>→</span>
                  <span className={styles.to}>{hp.max + gain}</span>
                </div>
                <div className={styles.note}>
                  {nextCur > hp.current
                    ? <>Current HP also rises by <b>+{nextCur - hp.current}</b> ({hp.current} → {nextCur}).
                      Levelling does not fully heal — only a rest restores the rest.</>
                    : <>Current HP stays at <b>{hp.current}</b> — already at or above the new maximum.
                      Levelling never takes hit points away.</>}
                </div>
              </div>
            </section>

            {/* ---- 02 PROFICIENCY / DERIVED ---- */}
            <section className={styles.step}>
              <div className={styles.stepHead}>
                <span className={styles.sn}>02</span>
                <span className={styles.st}>Proficiency / Derived</span>
                <span className={cx(styles.tag, styles.off)}>Auto</span>
              </div>
              <div className={styles.card}>
                <div className={styles.derived}>
                  <div className={cx(styles.pill, !plan.profWritable ? styles.held : profChanged ? styles.changed : styles.nochange)}>
                    <span className={styles.pl}>Proficiency Bonus</span>
                    <span className={styles.pv}>
                      <span className={styles.from}>{formatMod(plan.profFrom)}</span>
                      {profChanged && plan.profWritable && <span className={styles.arrow}>→</span>}
                      <span className={styles.to}>{formatMod(plan.profWritable ? plan.profTo : plan.profFrom)}</span>
                    </span>
                    <span className={styles.badge}>
                      {!plan.profWritable ? 'Held' : profChanged ? 'Increases' : 'No Change'}
                    </span>
                  </div>

                  {plan.castFrom && plan.castTo && (
                    <div className={cx(styles.pill, !plan.castWritable ? styles.held : dcChanged ? styles.changed : styles.nochange)}>
                      <span className={styles.pl}>Save DC / Atk</span>
                      <span className={styles.pv}>
                        <span className={styles.from}>{plan.castFrom.saveDC} / {formatMod(plan.castFrom.attackBonus)}</span>
                        {dcChanged && plan.castWritable && <>
                          <span className={styles.arrow}>→</span>
                          <span className={styles.to}>{plan.castTo.saveDC} / {formatMod(plan.castTo.attackBonus)}</span>
                        </>}
                      </span>
                      <span className={styles.badge}>
                        {!plan.castWritable ? 'Held' : dcChanged ? 'Reseeds' : 'No Change'}
                      </span>
                    </div>
                  )}

                  <div className={styles.dnote}>
                    {!plan.profWritable
                      ? <>The stored bonus is not what level {plan.fromLevel} implies, so it was set by
                        hand. Apply <b>holds</b> it rather than resetting it to {formatMod(plan.profTo)} —
                        change it in the sheet if that is wrong.</>
                      : profChanged
                        ? <>At level {plan.toLevel} the bonus steps up; every proficient attack, check
                          and save shifts with it.</>
                        : <>At {plan.fromLevel}→{plan.toLevel} it holds at {formatMod(plan.profTo)}. The
                          slot stays so a level like 9 reads <b>+3 → +4</b>.</>}
                    {plan.castFrom && !plan.castWritable && <> The save DC was tuned in the Spellcasting card, so it is held too.</>}
                  </div>
                </div>
              </div>
            </section>

            {/* ---- 03 ABILITY SCORE / FEAT ---- */}
            <section className={styles.step}>
              <div className={styles.stepHead}>
                <span className={styles.sn}>03</span>
                <span className={styles.st}>Ability Score / Feat</span>
                <span className={cx(styles.tag, isAsiLevel ? styles.cond : styles.off)}>
                  {isAsiLevel ? 'ASI level' : 'Off-schedule'}
                </span>
              </div>
              <div className={styles.card}>
                <div className={styles.seg}>
                  {([
                    ['asi', 'fa-arrow-up-9-1', 'Ability Score Improvement', '+2 to one, or +1 to two'],
                    ['feat', 'fa-star', 'Take a Feat', 'Pick one from the catalog'],
                  ] as const).map(([k, ic, t, s]) => (
                    <button key={k} type="button" className={cx(styles.segopt, adv === k && styles.sel)}
                      onClick={() => setAdv(k)}>
                      <Icon name={ic} />
                      <span className={styles.sx}><span className={styles.t}>{t}</span><span className={styles.s}>{s}</span></span>
                    </button>
                  ))}
                </div>

                {!isAsiLevel && (
                  <div className={styles.subnote} style={{ marginTop: 0, marginBottom: 11 }}>
                    <i className="fa-solid fa-circle-info" /> Level {plan.toLevel} is not on the
                    standard 4 · 8 · 12 · 16 · 19 ladder. A Fighter (6, 14), a Rogue (10) and plenty
                    of homebrew get one anyway — the step stays open, so commit only if the class
                    grants one here. Leave it untouched and nothing is written.
                  </div>
                )}

                {adv === 'asi' ? <>
                  <div className={styles.asibank}>
                    Points allocated
                    <span className={styles.pips}>
                      {[0, 1].map(i => <span key={i} className={cx(styles.pip, i < used && styles.used)} />)}
                    </span>
                    <span className={styles.ct}>{used} / 2</span>
                    &nbsp;·&nbsp; +2 to one ability, or +1 to two
                  </div>
                  <div className={styles.abils}>
                    {ABILITY_ORDER.map(k => {
                      const base = plan.abilityScores[k]
                      const add = alloc[k] ?? 0
                      const nv = base + add
                      return (
                        <div key={k} className={cx(styles.ab, add > 0 && styles.bumped)}>
                          <div className={styles.abtop}>
                            <span className={styles.abname}>{ABILITY_ABBR[k]}</span>
                            <span className={styles.abval}>
                              {add > 0
                                ? <><span className={styles.nv}>{nv}</span><span className={styles.pl}>+{add}</span></>
                                : nv}
                            </span>
                          </div>
                          <div className={styles.abctl}>
                            <button type="button" aria-label={`Lower ${ABILITY_ABBR[k]}`}
                              disabled={add <= 0} onClick={() => bump(k, -1)}>−</button>
                            <button type="button" aria-label={`Raise ${ABILITY_ABBR[k]}`}
                              disabled={used >= 2 || nv >= 20} onClick={() => bump(k, 1)}>+</button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </> : feats.length ? <>
                  <div className={styles.pick}>
                    {feats.map(f => {
                      const pr = prereq.get(f.id)
                      const blocked = pr ? !pr.ok : false
                      return (
                        <button key={f.id} type="button" disabled={blocked}
                          className={cx(styles.row, featId === f.id && styles.sel, blocked && styles.locked)}
                          title={blocked ? prereqSummary(pr!) ?? undefined : undefined}
                          onClick={() => setFeatId(featId === f.id ? null : f.id)}>
                          <span className={styles.rk}>
                            <Icon name={blocked ? 'fa-lock' : f.data.icon || 'fa-star'} />
                          </span>
                          <span className={styles.rx}>
                            <span className={styles.rn}>{f.data.name}</span>
                            {blurb(f.data) && <span className={styles.rd}>{renderInline(blurb(f.data))}</span>}
                            {f.data.prerequisite && (
                              <span className={cx(styles.rpre, blocked && styles.rpreUnmet)}>
                                {blocked
                                  ? <>Requires {pr!.unmet.join(', ')} — not met</>
                                  : <>Requires {renderInline(f.data.prerequisite)}
                                    {pr?.unparsed.length ? <> · <span className={styles.rpreOpen}>{pr.unparsed.join(', ')} not checked</span></> : null}</>}
                              </span>
                            )}
                          </span>
                          <span className={styles.rsrc}>Feat</span>
                          <span className={styles.rcheck}><i className="fa-solid fa-check" /></span>
                        </button>
                      )
                    })}
                  </div>
                  <div className={styles.subnote}>
                    <i className="fa-solid fa-arrow-turn-up" /> Taking a feat assigns that catalog
                    feature to {plan.name.split(' ')[0]} — the same library the Features catalog
                    feeds. Prerequisites are shown, <b>not enforced</b>.
                  </div>
                </> : (
                  <div className={styles.empty}>
                    <i className="fa-solid fa-circle-info" />
                    <span>No <b>Feat</b> features in the catalog yet. Author one under Catalog →
                      Features with category <b>Feat</b>, and it appears here.</span>
                  </div>
                )}
              </div>
            </section>

            {/* ---- 04 NEW FEATURES ---- */}
            <section className={styles.step}>
              <div className={styles.stepHead}>
                <span className={styles.sn}>04</span>
                <span className={styles.st}>New Features</span>
                <span className={cx(styles.tag, plan.offers.length ? styles.cond : styles.off)}>
                  {plan.offers.length ? 'Assign' : 'Conditional'}
                </span>
              </div>
              <div className={styles.card}>
                {plan.offers.length ? <>
                  <div className={styles.pick}>
                    {plan.offers.map(o => {
                      /* A gate says WHEN a feature becomes available; a
                         prerequisite says WHAT ELSE it needs. Both have to hold,
                         and until now only the gate was read here — so a feature
                         requiring another arrived pre-ticked with nothing on
                         screen to say it should not have. */
                      const pr = offerPrereq.get(o.id)
                      const blocked = pr ? !pr.ok : false
                      return (
                        <button key={o.id} type="button" disabled={blocked}
                          className={cx(styles.row, !blocked && picks.includes(o.id) && styles.sel, blocked && styles.locked)}
                          title={blocked ? prereqSummary(pr!) ?? undefined : undefined}
                          onClick={() => toggle(o.id)}>
                          <span className={styles.rk}>
                            <Icon name={blocked ? 'fa-lock' : o.data.icon || 'fa-certificate'} />
                          </span>
                          <span className={styles.rx}>
                            <span className={styles.rn}>{o.data.name}</span>
                            {blurb(o.data) && <span className={styles.rd}>{renderInline(blurb(o.data))}</span>}
                            {o.data.prerequisite && (
                              <span className={cx(styles.rpre, blocked && styles.rpreUnmet)}>
                                {blocked
                                  ? `Requires ${pr!.unmet.join(', ')}`
                                  : <>Requires {renderInline(o.data.prerequisite)}
                                    {pr?.unparsed.length ? <> · <span className={styles.rpreOpen}>{pr.unparsed.join(', ')} not checked</span></> : null}</>}
                              </span>
                            )}
                          </span>
                          <span className={styles.rsrc}>
                            {o.source}{o.at != null && ` ${o.at}`}
                            {!o.fresh && <span className={styles.stale}>Already open</span>}
                          </span>
                          <span className={styles.rcheck}><i className="fa-solid fa-check" /></span>
                        </button>
                      )
                    })}
                  </div>
                  <div className={styles.subnote}>
                    <i className="fa-solid fa-arrow-turn-up" /> Assigns these catalog features to
                    {' '}{plan.name.split(' ')[0]}. Rows marked <b>Already open</b> unlocked at an
                    earlier level and were never granted — they stay on offer every level until
                    they are, so unticking one here does not lose it.
                  </div>
                </> : (
                  <div className={styles.empty}>
                    <i className="fa-solid fa-check-double" />
                    <span>No ungranted class features at <b>{plan.className} {plan.toLevel}</b>. The
                      step stays — at feature-granting levels, catalog picks appear here to assign
                      (library → character).</span>
                  </div>
                )}
              </div>
            </section>

            {/* ---- 05 SPELL SLOTS ---- */}
            <section className={cx(styles.step, plan.caster === 'none' && styles.dim)}>
              <div className={styles.stepHead}>
                <span className={styles.sn}>05</span>
                <span className={styles.st}>Spell Slots</span>
                <span className={cx(styles.tag, plan.caster === 'none' ? styles.off : styles.cond)}>
                  {plan.caster === 'none' ? 'Non-caster' : plan.caster === 'pact' ? 'Pact Magic' : 'Caster'}
                </span>
              </div>
              <div className={styles.card}>
                {plan.caster === 'none' ? (
                  <div className={styles.empty}>
                    <i className="fa-solid fa-wand-sparkles" />
                    <span>{plan.className} doesn’t cast — no spell slots to update. The step stays
                      visible so the structure reads; for a caster it shows the new slot table and
                      max spell level.</span>
                  </div>
                ) : plan.caster === 'pact' && plan.pactFrom && plan.pactTo ? <>
                  <div className={styles.pactline}>
                    <span className={styles.from}>
                      {plan.pactFrom.count} × {ordinal(plan.pactFrom.level)}
                    </span>
                    <span className={styles.arrow}>→</span>
                    <span className={styles.to}>
                      {plan.pactTo.count} slot{plan.pactTo.count === 1 ? '' : 's'}, all {ordinal(plan.pactTo.level)}
                    </span>
                  </div>
                  <div className={styles.subnote}>
                    <i className="fa-solid fa-circle-info" /> Pact Magic derives <b>both</b> its
                    count and its slot level from character level, so nothing is written here — the
                    numbers move the moment the level does, and they refresh on a <b>short</b> rest.
                  </div>
                </> : <>
                  <div className={styles.slottab}>
                    {plan.slotsTo.map((n, i) => n > 0 && (
                      <div key={i} className={styles.slot}>
                        <span className={styles.sl}>{ordinal(i + 1)}</span>
                        <div className={styles.pips}>
                          {Array.from({ length: n }, (_, j) => (
                            <span key={j} className={cx(styles.pip, j < (plan.slotsFrom[i] ?? 0) ? styles.on : styles.new)} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className={styles.subnote}>
                    <i className="fa-solid fa-circle-info" /> Derived from the class’s caster type —
                    amber pips are gained at level {plan.toLevel}. Spent slots carry over; a level
                    that shrinks a row clamps them down rather than leaving more spent than exist.
                  </div>
                </>}
              </div>
            </section>
          </div>

          {/* ---- footer ---- */}
          <footer className={styles.foot}>
            <div className={styles.sumhead}>
              <span className={styles.sg}>Σ</span>
              <span className={styles.st}>Apply Summary</span>
              <span className={styles.warn}>
                {mine ? 'One write · your DM sees the result' : 'Review the full cascade before committing'}
              </span>
            </div>
            <div className={styles.footrow}>
              <div className={styles.summary}>
                <div className={styles.sumline}>
                  <i className="fa-solid fa-angles-up" /><span className={styles.k}>Level</span>
                  <span className={styles.v}>{plan.fromLevel} → {plan.toLevel}</span>
                </div>
                <div className={styles.sumline}>
                  <i className="fa-solid fa-dice-d20" /><span className={styles.k}>Hit Dice</span>
                  <span className={styles.v}>{plan.hitDiceTo}</span>
                </div>
                <div className={cx(styles.sumline, styles.add)}>
                  <i className="fa-solid fa-heart" /><span className={styles.k}>Max HP</span>
                  <span className={styles.v}>+{gain} → {hp.max + gain}</span>
                </div>
                <div className={cx(styles.sumline, (!plan.profWritable || !profChanged) && styles.muted)}>
                  <i className="fa-solid fa-certificate" /><span className={styles.k}>Prof</span>
                  <span className={styles.v}>
                    {!plan.profWritable ? `${formatMod(plan.profFrom)} · held`
                      : profChanged ? `${formatMod(plan.profFrom)} → ${formatMod(plan.profTo)}`
                        : `${formatMod(plan.profTo)} · no change`}
                  </span>
                </div>
                {plan.castFrom && (
                  <div className={cx(styles.sumline, (!plan.castWritable || !dcChanged) && styles.muted)}>
                    <i className="fa-solid fa-hat-wizard" /><span className={styles.k}>Save DC</span>
                    <span className={styles.v}>
                      {!plan.castWritable ? `${plan.castFrom.saveDC} · held`
                        : dcChanged ? `${plan.castFrom.saveDC} → ${plan.castTo?.saveDC}`
                          : `${plan.castFrom.saveDC} · no change`}
                    </span>
                  </div>
                )}
                {adv === 'asi' ? (
                  <div className={cx(styles.sumline, asiParts.length ? styles.add : styles.muted)}>
                    <i className="fa-solid fa-arrow-up-9-1" /><span className={styles.k}>ASI</span>
                    <span className={styles.v}>{asiParts.length ? asiParts.join(', ') : 'unassigned'}</span>
                  </div>
                ) : (
                  <div className={cx(styles.sumline, feat ? styles.add : styles.muted)}>
                    <i className="fa-solid fa-star" /><span className={styles.k}>Feat</span>
                    <span className={styles.v}>{feat ? feat.data.name : 'none chosen'}</span>
                  </div>
                )}
                {takenFeatures.length > 0 && (
                  <div className={cx(styles.sumline, styles.add)}>
                    <i className="fa-solid fa-plus" /><span className={styles.k}>Features</span>
                    <span className={styles.v}>{takenFeatures.map(o => o.data.name).join(', ')}</span>
                  </div>
                )}
                {plan.caster !== 'none' && plan.caster !== 'pact' && (
                  <div className={cx(styles.sumline, slotsGained > 0 ? styles.add : styles.muted)}>
                    <i className="fa-solid fa-wand-sparkles" /><span className={styles.k}>Slots</span>
                    <span className={styles.v}>{slotsGained > 0 ? `+${slotsGained}` : 'no change'}</span>
                  </div>
                )}
              </div>
              <div className={styles.actions}>
                <button type="button" className={cx(con.btn, con.ghost)} onClick={onClose} disabled={busy}>
                  <span className={con.bf} /><span className={con.bi}><i className="fa-solid fa-xmark" /> {mine ? 'Not yet' : 'Cancel'}</span>
                </button>
                <button type="button" className={cx(con.btn, mine ? con.cyan : con.amber)} onClick={() => void apply()} disabled={busy}>
                  <span className={con.bf} />
                  <span className={con.bi}>
                    <i className="fa-solid fa-circle-check" />{' '}
                    {busy ? 'Applying…' : mine ? `Confirm Level ${plan.toLevel}` : 'Apply Level-Up'}
                  </span>
                </button>
              </div>
            </div>
          </footer>
        </div>
      </div>
    </div>,
    document.body,
  )
}
