import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useOutletContext } from 'react-router-dom'
import type { AbilityKey, CharacterRow, CharacterSheet, ShardTree } from '../lib/database.types'
import { Nav } from '../components/Nav'
import { Deco } from '../components/Deco'
import {
  ABILITY_ABBR, ABILITY_NAMES, SKILLS,
  abilityCheckTerms, abilityMod, abilities, composeCheck, effectiveMode, formatMod,
  proficiency, saveTerms, saveTotal, skillTerms, skillTotal, type CheckTerm,
} from '../lib/dnd'
import type { Skill } from '../lib/dnd'
import { effectiveSheet } from '../lib/effects'
import { rolledDice, type RolledDie } from '../lib/dice'
import { useRollLog } from '../lib/rolls'
import type { RollEntry, CheckRoll } from '../lib/rolls'
import { Riders } from '../components/Riders'
import { useGraph } from '../lib/useGraph'
import { resolve, rollResolution } from '../lib/graph'
import styles from './Character.module.css'

interface RouteContext {
  character: CharacterRow
  shardTrees?: Record<string, ShardTree>
}

type Mode = 'normal' | 'adv' | 'dis'
type FlashState = { value: number; crit: boolean; fumble: boolean }

const RING_W = 540
const RING_H = 420
const CLUSTER_ORDER: AbilityKey[] = ['str', 'con', 'dex', 'wis', 'int', 'cha']
const LEFT_SIDE: AbilityKey[] = ['str', 'dex', 'int']
const FLASH_MS = 2000

/** Character screen ("Rolls" in the nav) — the ability hex-ring rolls checks
 *  and saves; skill flyouts roll skill checks. Every value renders from
 *  `character.sheet` (via effectiveSheet, so worn-gear bonuses apply) through
 *  the SRD math in lib/dnd.ts — never the mockup's placeholder numbers.
 *  Rolling is ephemeral: entries go into the shared lib/rolls.tsx log, which
 *  this screen renders in full (every roll made anywhere in the app, not just
 *  here), not persisted to the character row. */
export function Character() {
  const { character, shardTrees = {} } = useOutletContext<RouteContext>()
  const view = effectiveSheet(character, shardTrees)
  const { rolls, addRoll } = useRollLog()
  // Built once per character, not per roll — see lib/useGraph.ts.
  const graph = useGraph(character, shardTrees)
  const [mode, setMode] = useState<Mode>('normal')
  const [flash, setFlash] = useState<Partial<Record<AbilityKey, FlashState>>>({})
  const flashTimers = useRef<Partial<Record<AbilityKey, number>>>({})

  useEffect(() => {
    const timers = flashTimers.current
    return () => { for (const t of Object.values(timers)) if (t) window.clearTimeout(t) }
  }, [])

  const stageRef = useRef<HTMLDivElement>(null)
  const scalerRef = useRef<HTMLDivElement>(null)
  useRingScale(stageRef, scalerRef)

  /** `eff` is the mode AFTER the graph has had its say — see pushCheck. */
  function rollD20Set(eff: 'normal' | 'adv' | 'dis'): { rolls: RolledDie[]; pick: number } {
    const rolls = rolledDice(eff === 'normal' ? 1 : 2, 20)
    const faces = rolls.map(d => d.v)
    return { rolls, pick: eff === 'adv' ? Math.max(...faces) : eff === 'dis' ? Math.min(...faces) : faces[0] }
  }

  function flashHex(key: AbilityKey, value: number, crit: boolean, fumble: boolean) {
    const existing = flashTimers.current[key]
    if (existing) window.clearTimeout(existing)
    setFlash(f => ({ ...f, [key]: { value, crit, fumble } }))
    flashTimers.current[key] = window.setTimeout(() => {
      setFlash(f => ({ ...f, [key]: undefined }))
    }, FLASH_MS)
  }

  /** Roll and render. Every number in here comes from lib/dnd.ts — this
   *  function owns the dice and the log entry, nothing arithmetic. */
  function pushCheck(opts: {
    key: AbilityKey; kind: 'check' | 'save'; title: string; subtitle: string
    /** The named parts, from saveTerms/skillTerms/abilityCheckTerms. */
    terms: CheckTerm[]
    /** Sub-key for `roll:<kind>.<sub>` — the ability for a save or an ability
     *  check, the skill for a skill check. */
    sub: string
  }) {
    // The same boundary the weapon roller uses, on a roll kind that has no
    // subject at all — which is the point of doing both in one slice.
    const res = resolve(graph, { kind: opts.kind, sub: opts.sub })
    // Graph dice on a d20 roll are rolled now — the total is one number and an
    // unrolled term has nowhere to live. (Damage dice stay unrolled so a crit
    // can double them; a check has no crit multiplier, so `double` is never set
    // here.) The riders come back carrying the faces they rolled.
    const contrib = rollResolution(res)

    const eff = effectiveMode(mode, res.adv, res.dis)
    const { rolls: dice, pick } = rollD20Set(eff)

    const terms = [...opts.terms, { label: 'FEAT', value: contrib.flat }]
    const { total: totalRoll, breakdown, crit, fumble } = composeCheck(pick, terms, res.critFrom)

    const check: CheckRoll = { mode: eff, rolls: dice, pick, breakdown, terms, total: totalRoll, crit, fumble }
    flashHex(opts.key, totalRoll, crit, fumble)
    addRoll({
      kind: opts.kind, title: opts.title, subtitle: opts.subtitle, icon: 'fa-dice-d20', check,
      riderGroups: contrib.riders.length ? [{ label: opts.kind === 'save' ? 'Save' : 'Check', riders: contrib.riders }] : undefined,
      notes: res.notes.length ? res.notes : undefined,
      problems: res.problems.length ? res.problems : undefined,
    })
  }

  function rollAbilityCheck(key: AbilityKey) {
    pushCheck({
      key, kind: 'check', sub: key, title: `${ABILITY_NAMES[key].toUpperCase()} CHECK`,
      subtitle: 'Ability Check', terms: abilityCheckTerms(view, key),
    })
  }

  function rollSave(key: AbilityKey) {
    pushCheck({
      key, kind: 'save', sub: key, title: `${ABILITY_NAMES[key].toUpperCase()} SAVE`,
      subtitle: 'Saving Throw', terms: saveTerms(view, key),
    })
  }

  function rollSkill(skill: Skill) {
    pushCheck({
      key: skill.ability, kind: 'check', sub: skill.key, title: skill.name.toUpperCase(),
      subtitle: `${ABILITY_ABBR[skill.ability].toUpperCase()} · Skill Check`,
      terms: skillTerms(view, skill),
    })
  }

  const meta = (
    <>
      <span className="dim">◇</span>
      <span>Section</span>
      <span className="acc">/ Rolls</span>
      <span className="dim">·</span>
      <span>Ability Array</span>
      <span className="dim">·</span>
      <span className="stamp">D20_ENGINE</span>
      <span className="dim">::</span>
      <span className="acc">Online</span>
    </>
  )

  return (
    <>
      <Deco
        left={<><span className="acc">ROLLS</span> &nbsp;//&nbsp; ABILITY_ARRAY &nbsp;//&nbsp; SYNC OK</>}
        right={<>Castella-08 &nbsp;//&nbsp; <span className="acc">PROF {formatMod(proficiency(view))}</span> &nbsp;//&nbsp; d20 Ready</>}
      />
      <Nav variant="dock" meta={meta} />

      <main className={styles.rolls}>
        <section className={styles.arrayCol} aria-label="Ability array">
          <div className={styles.colHeader}>
            <span className={styles.chNum}>01</span>
            <span className={styles.chTitle}>Ability Array</span>
            <span className={styles.chMeta}>6 / 6 calibrated</span>
          </div>
          <div className={styles.ringStage} ref={stageRef}>
            <div className={styles.ringScaler} ref={scalerRef}>
              <div className={styles.hexRing}>
                <RingGlyph />
                {CLUSTER_ORDER.map(key => (
                  <AbilityCluster
                    key={key}
                    abilityKey={key}
                    sheet={view}
                    flash={flash[key]}
                    onRollCheck={() => rollAbilityCheck(key)}
                    onRollSave={() => rollSave(key)}
                    onRollSkill={rollSkill}
                  />
                ))}
              </div>
            </div>
          </div>
        </section>

        <aside className={styles.rollCol} aria-label="Roll log">
          <div className={styles.colHeader}>
            <span className={styles.chNum}>02</span>
            <span className={styles.chTitle}>Roll_Log</span>
            <span className={styles.chMeta}>{rolls.length > 0 ? stampOf(rolls[0].at) : 'standing by'}</span>
          </div>

          <div className={styles.advToggles}>
            <button
              type="button"
              className={`${styles.advBtn} ${styles.adv}${mode === 'adv' ? ' ' + styles.isActive : ''}`}
              aria-pressed={mode === 'adv'}
              onClick={() => setMode(m => (m === 'adv' ? 'normal' : 'adv'))}
            >
              <span className={styles.abFrame} />
              <span className={styles.abInner}><span className={styles.abDot} />ADV</span>
            </button>
            <button
              type="button"
              className={`${styles.advBtn} ${styles.dis}${mode === 'dis' ? ' ' + styles.isActive : ''}`}
              aria-pressed={mode === 'dis'}
              onClick={() => setMode(m => (m === 'dis' ? 'normal' : 'dis'))}
            >
              <span className={styles.abFrame} />
              <span className={styles.abInner}><span className={styles.abDot} />DIS</span>
            </button>
          </div>

          <div className={styles.rollLog} aria-live="polite">
            {rolls.length === 0
              ? <div className={styles.emptyLog}>Awaiting Roll</div>
              : rolls.map(r => <RollLogEntry key={r.id} entry={r} />)}
          </div>
        </aside>
      </main>
    </>
  )
}

/** Scales the fixed 540x420 hex-ring coordinate space to fit whatever room the
 *  column actually has (ported from the mockup's autoFitRing IIFE). */
function useRingScale(stageRef: RefObject<HTMLDivElement | null>, scalerRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const stage = stageRef.current
    const scaler = scalerRef.current
    if (!stage || !scaler) return
    function fit() {
      if (!stage || !scaler) return
      const s = Math.min(1, stage.clientHeight / RING_H, stage.clientWidth / RING_W)
      scaler.style.setProperty('--ring-scale', s > 0 ? s.toFixed(3) : '1')
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(stage)
    return () => ro.disconnect()
  }, [stageRef, scalerRef])
}

/* ---------- Ability cluster: hex + skill flyout ---------- */

function AbilityCluster({
  abilityKey, sheet, flash, onRollCheck, onRollSave, onRollSkill,
}: {
  abilityKey: AbilityKey
  sheet: CharacterSheet
  flash?: FlashState
  onRollCheck: () => void
  onRollSave: () => void
  onRollSkill: (skill: Skill) => void
}) {
  const score = abilities(sheet)[abilityKey]
  const mod = abilityMod(score)
  const save = saveTotal(sheet, abilityKey)
  const saveProf = (sheet.saveProficiencies ?? []).includes(abilityKey)
  const skills = SKILLS.filter(s => s.ability === abilityKey)
  const side = LEFT_SIDE.includes(abilityKey) ? 'left' : 'right'

  const hexClass = [
    styles.hex,
    saveProf && styles.profSav,
    flash && styles.rolling,
    flash?.crit && styles.critSuccess,
    flash?.fumble && styles.critFail,
  ].filter(Boolean).join(' ')

  return (
    <div className={styles.cluster} data-ability={abilityKey.toUpperCase()}>
      {/* A plain div, not <button> — .hSav below is its own real button, and
          a <button> cannot legally contain interactive descendants. */}
      <div
        className={hexClass}
        role="button"
        tabIndex={0}
        onClick={onRollCheck}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRollCheck() } }}
        aria-label={`${ABILITY_NAMES[abilityKey]} ability — score ${score}, modifier ${formatMod(mod)}, saving throw ${formatMod(save)}${saveProf ? ' (proficient)' : ''}`}
      >
        <span className={styles.hFrame} />
        <span className={styles.hInner}>
          <span className={styles.hName}>{ABILITY_ABBR[abilityKey].toUpperCase()}</span>
          <span className={styles.hScore}>{flash ? flash.value : score}</span>
          <span className={styles.hMod}>{formatMod(mod)}</span>
          <button
            type="button"
            className={styles.hSav}
            title="Roll saving throw"
            onClick={e => { e.stopPropagation(); onRollSave() }}
          >
            {saveProf && <span className={styles.profShield} aria-hidden="true" />}
            SAV {formatMod(save)}
          </button>
        </span>
      </div>

      {skills.length > 0 && (
        <div className={styles.skillList} data-side={side} role="list">
          <span className={styles.slFrame} />
          <div className={styles.slInner}>
            {skills.map(skill => (
              <SkillCard key={skill.key} skill={skill} sheet={sheet} onRoll={() => onRollSkill(skill)} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function SkillCard({ skill, sheet, onRoll }: { skill: Skill; sheet: CharacterSheet; onRoll: () => void }) {
  const { mod, proficient, expertise } = skillTotal(sheet, skill)
  const cls = [styles.skillCard, proficient && styles.prof, expertise && styles.exp].filter(Boolean).join(' ')
  return (
    <button
      type="button"
      className={cls}
      title={expertise ? 'Expertise (double proficiency)' : proficient ? 'Proficient' : undefined}
      onClick={onRoll}
    >
      <span className={styles.scName}>{skill.name}</span>
      <span className={styles.scMod}>{formatMod(mod)}</span>
    </button>
  )
}

/* ---------- Background ring glyph (decorative) ---------- */

function RingGlyph() {
  const ticks = Array.from({ length: 60 }, (_, i) => {
    const long = i % 5 === 0
    const angle = (i * 6 - 90) * (Math.PI / 180)
    const rOuter = 308
    const rInner = long ? 294 : 300
    return (
      <line
        key={i}
        x1={320 + rOuter * Math.cos(angle)} y1={320 + rOuter * Math.sin(angle)}
        x2={320 + rInner * Math.cos(angle)} y2={320 + rInner * Math.sin(angle)}
        strokeOpacity={long ? 0.9 : 0.4}
      />
    )
  })

  return (
    <div className={styles.ringGlyphWrap} aria-hidden="true">
      <svg className={styles.ringGlyph} viewBox="0 0 640 640" fill="none" stroke="currentColor" strokeWidth={1.2}>
        <g className={styles.rotateSlow}>
          <circle cx={320} cy={320} r={300} strokeOpacity={0.6} />
          <circle cx={320} cy={320} r={292} strokeOpacity={0.3} />
          <g>{ticks}</g>
          <polygon points="320,80 528,200 528,440 320,560 112,440 112,200" strokeOpacity={0.5} />
          <polygon points="320,108 504,214 504,426 320,532 136,426 136,214" strokeOpacity={0.25} />
        </g>
        <g className={styles.rotateRev}>
          <g strokeOpacity={0.6}>
            <line x1={320} y1={40} x2={320} y2={600} />
            <line x1={40} y1={320} x2={600} y2={320} />
            <line x1={120} y1={120} x2={520} y2={520} />
            <line x1={520} y1={120} x2={120} y2={520} />
          </g>
          <circle cx={320} cy={320} r={220} strokeOpacity={0.6} strokeDasharray="3 6" />
          <polygon points="320,140 447,193 500,320 447,447 320,500 193,447 140,320 193,193" strokeOpacity={0.55} />
          <polygon points="320,210 430,320 320,430 210,320" strokeOpacity={0.7} />
        </g>
        <g>
          <circle cx={320} cy={320} r={84} strokeOpacity={0.55} />
          <circle cx={320} cy={320} r={60} strokeOpacity={0.4} strokeDasharray="2 4" />
          <polygon points="320,250 380,355 260,355" strokeOpacity={0.8} />
          <polygon points="320,390 260,285 380,285" strokeOpacity={0.8} />
          <g className={styles.pulse}>
            <circle cx={320} cy={320} r={14} fill="rgba(0,166,214,0.45)" stroke="#00a6d6" strokeOpacity={0.9} strokeWidth={0.8} />
            <circle cx={320} cy={320} r={4} fill="#00a6d6" />
          </g>
        </g>
      </svg>
    </div>
  )
}

/* ---------- Roll log entry (renders any RollEntry kind) ---------- */

function stampOf(at: number): string {
  return new Date(at).toLocaleTimeString('en-GB', { hour12: false })
}

function RollLogEntry({ entry }: { entry: RollEntry }) {
  const crit = !!(entry.check?.crit || entry.attack?.crit)
  const fumble = !!(entry.check?.fumble || entry.attack?.fumble)
  const total = entry.check?.total ?? entry.attack?.total ?? entry.damage?.total ?? entry.lines?.[0]?.total ?? '—'

  const entryClass = [styles.rollEntry, crit && styles.critSuccess, fumble && !crit && styles.critFail]
    .filter(Boolean).join(' ')

  return (
    <div className={entryClass}>
      {crit && <span className={styles.reCrit}>CRIT</span>}
      {fumble && !crit && <span className={styles.reCrit}>FUMBLE</span>}
      <span className={styles.reFrame} />
      <div className={styles.reInner}>
        <span className={styles.reName}>{entry.title}</span>
        <span className={styles.reTotal}>{total}</span>

        {entry.check ? (
          <>
            <span className={styles.reD20}>
              d20:{' '}
              {entry.check.rolls.length > 1 ? (
                <>
                  {entry.check.rolls.map((r, i) => (
                    <span key={i} className={styles.v}>{r.v}{i === 0 ? ', ' : ''}</span>
                  ))}
                  {' → '}
                  <span className={styles.pick}>{entry.check.pick}</span>{' '}
                  <span className={`${styles.mode} ${entry.check.mode === 'adv' ? styles.adv : styles.dis}`}>
                    ({entry.check.mode.toUpperCase()})
                  </span>
                </>
              ) : (
                <span className={styles.pick}>{entry.check.pick}</span>
              )}
            </span>
            <span className={styles.reBreak}>
              {entry.check.breakdown} <span className={styles.eq}>= {entry.check.total}</span>
            </span>
          </>
        ) : entry.attack || entry.damage ? (
          <span className={styles.reBreak}>
            {entry.attack && <>ATK {entry.attack.breakdown}</>}
            {entry.attack && entry.damage && <br />}
            {entry.damage && <>DMG {entry.damage.breakdown}</>}
          </span>
        ) : (
          <span className={styles.reBreak}>
            {(entry.lines ?? []).map(l => `${l.label}: ${l.total}`).join(' · ')}
          </span>
        )}

        {/* Riders get their own row rather than squeezing into the fixed
            3-row grid above. This log is the better rider surface than the
            toast: it persists and it already scrolls. */}
        <Riders groups={entry.riderGroups} notes={entry.notes} problems={entry.problems} />

        <span className={styles.reStamp}>{stampOf(entry.at)}</span>
      </div>
    </div>
  )
}
