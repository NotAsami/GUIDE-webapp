import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import type {
  AbilityKey, CharacterRow, CharacterSection, CharacterSheet, EquippedWeapon, Json, ShardTree,
} from '../lib/database.types'
import { Nav } from '../components/Nav'
import { Deco } from '../components/Deco'
import {
  ABILITY_ABBR, ABILITY_NAMES, ABILITY_ORDER, SKILLS,
  abilityMod, abilities, allSkillTotals, formatMod, passiveScore,
  proficientSkillCount, saveTotal,
} from '../lib/dnd'
import { activeEffects, effectiveSheet } from '../lib/effects'
import { burden, burdenTier, type BurdenTier } from '../lib/burden'
import { handLabel, weaponAttackBonus, weaponDamageString } from '../lib/weapons'
import { EffectsSidebar } from '../components/EffectsSidebar'
import styles from './Stats.module.css'

interface RouteContext {
  character: CharacterRow
  updateSection: <K extends CharacterSection>(section: K, next: CharacterRow[K]) => Promise<void>
  shardTrees?: Record<string, ShardTree>
}

type DeathSaves = { successes: number; failures: number }

const EXHAUSTION_EFFECTS = [
  'No effect',
  'Disadvantage on ability checks',
  'Speed halved',
  'Disadvantage on attacks & saves',
  'HP maximum halved',
  'Speed reduced to 0',
  'Death',
]

/** Stat Panel — a dense readout of `sheet` (+ death saves / exhaustion from
 *  `resources`). Every value renders from the character row; modifiers, saves,
 *  skills and passives are computed by SRD math (lib/dnd.ts) from the canon
 *  ability scores — never the mockup's placeholder numbers. */
export function Stats() {
  const { character, updateSection, shardTrees = {} } = useOutletContext<RouteContext>()
  // DISPLAY from the effective sheet (base + equipped-gear + shard effects).
  // Write-paths below spread from `character.sheet` (the canon base) — never
  // from `view`.
  const view = effectiveSheet(character, shardTrees)
  const base = character.sheet ?? {}

  // Disadvantage sources, computed once and threaded to every widget that
  // marks it (Ability Scores, Skills, Senses' own combined readout) so they
  // can't drift out of sync with each other.
  const exhaustion = (character.resources?.exhaustion as number | undefined) ?? 0
  const load = burden(character, shardTrees)
  const tier = burdenTier(load.current, load.max)

  // Active Effects panel — moved here from Equipment (docs/notes.md:68) as a
  // button on the Senses widget rather than its own permanent panel slot.
  const [effectsOpen, setEffectsOpen] = useState(false)
  const effects = activeEffects(character)
  async function removeEffect(id: string) {
    await updateSection('resources', {
      ...character.resources, activeEffects: effects.filter(e => e.id !== id),
    } as unknown as CharacterRow['resources'])
  }

  const meta = (
    <>
      <span className="dim">◇</span>
      <span>Section</span>
      <span className="acc">/ Stat Panel</span>
      <span className="dim">·</span>
      <span>Character Data</span>
      <span className="dim">·</span>
      <span className="stamp">STAT_READOUT</span>
      <span className="dim">::</span>
      <span className="acc">Online</span>
    </>
  )

  return (
    <>
      <Deco
        left={<><span className="acc">EQUIPMENT</span> &nbsp;//&nbsp; STAT_READOUT &nbsp;//&nbsp; VITALS OK</>}
        right={<>Castella-08 &nbsp;//&nbsp; <span className="acc">SHEET: COMPLETE</span> &nbsp;//&nbsp; Loadout 02</>}
      />
      <Nav variant="dock" meta={meta} />
      <div className={styles.dash}>
        <header className={styles.dashHead}>
          <span className={styles.dhNum}>09</span>
          <span className={styles.dhTitle}>Stat Panel</span>
          <span className={styles.dhMeta}>
            <span><span className="dim">Class</span> {classLine(character)}</span>
            <span className="dim">·</span>
            <span><span className="dim">Auto-Sync</span> <span className="acc">ON</span></span>
            <span className={styles.cursor}>▌</span>
          </span>
        </header>

        <div className={styles.grid}>
          <Combat sheet={view} />
          <HitPoints sheet={view} character={character} updateSection={updateSection} />
          <HitDice sheet={view} character={character} updateSection={updateSection} />
          <AbilityScores sheet={view} base={base.abilities} exhaustion={exhaustion} tier={tier} />
          <Senses
            sheet={view} character={character} exhaustion={exhaustion} tier={tier}
            effectCount={effects.length} onOpenEffects={() => setEffectsOpen(true)}
          />
          <SavingThrows sheet={view} />
          <DeathSavesWidget character={character} updateSection={updateSection} />
          <Exhaustion character={character} updateSection={updateSection} />
          <Skills sheet={view} exhaustion={exhaustion} tier={tier} />
          <Attacks character={character} sheet={view} />
          <Proficiencies character={character} sheet={view} />
        </div>
      </div>

      <EffectsSidebar
        open={effectsOpen} effects={effects}
        onRemove={id => void removeEffect(id)} onClose={() => setEffectsOpen(false)}
      />
    </>
  )
}

function classLine(character: CharacterRow): string {
  const cls = character.identity?.class ?? '—'
  const arch = character.identity?.archetype
  const lvl = character.identity?.level
  const name = arch ? `${cls} (${arch})` : cls
  return lvl ? `${name} · Lv ${lvl}` : name
}

/** Which abilities currently carry disadvantage on checks: SRD exhaustion
 *  (level 1+) hits all six, heavy encumbrance hits STR/DEX/CON specifically.
 *  Same two sources as the Senses widget's combined "Ability Checks" label —
 *  this just resolves them per-ability instead of as one line. No source of
 *  computed ADVANTAGE exists in the data model (database.types.ts keeps it
 *  as prose on items/features, deliberately never a flag), so there's no
 *  green-dot case to handle here yet. */
function hasDisadvantage(key: AbilityKey, exhaustion: number, tier: BurdenTier): boolean {
  if (exhaustion >= 1) return true
  if (tier === 'heavy') return key === 'str' || key === 'dex' || key === 'con'
  return false
}

/* ---------- shared widget chassis ---------- */

function Widget(props: {
  num: string; title: string; meta?: React.ReactNode; span: number; children: React.ReactNode
}) {
  return (
    <section className={styles.widget} style={{ gridColumn: `span ${props.span}` }}>
      <div className={styles.wHead}>
        <span className={styles.wNum}>{props.num}</span>
        <span className={styles.wTitle}>{props.title}</span>
        {props.meta && <span className={styles.wMeta}>{props.meta}</span>}
      </div>
      <div className={styles.wBody}>{props.children}</div>
    </section>
  )
}

/* ---------- 01 Combat ---------- */

function Combat({ sheet }: { sheet: CharacterSheet }) {
  const cells = [
    { marker: 'A.C', value: <>{sheet.ac ?? '—'}</>, label: 'Armor Class' },
    { marker: 'INIT', value: <>{formatMod(sheet.initiative ?? 0)}</>, label: 'Initiative' },
    { marker: 'SPD', value: <>{sheet.speed ?? '—'}<span className={styles.unit}>ft</span></>, label: 'Speed' },
    { marker: 'PROF', value: <>{formatMod(sheet.proficiencyBonus ?? 2)}</>, label: 'Proficiency' },
  ]
  const bd = sheet.acBreakdown
  return (
    <Widget num="01" title="Combat" meta="Quick stats" span={5}>
      <div className={styles.combatGrid}>
        {cells.map(c => (
          <div key={c.marker} className={styles.ablock}>
            <span className={styles.abFrame} /><span className={styles.abInner} />
            <span className={styles.pbMarker}>{c.marker}</span>
            <div className={styles.pbContent}>
              <div className={styles.pbValue}>{c.value}</div>
              <div className={styles.pbLabel}>{c.label}</div>
            </div>
          </div>
        ))}
      </div>
      {bd && (
        <div className={styles.acBreakdown}>
          <span className={styles.k}>AC {sheet.ac}</span>
          <span className={styles.op}>=</span>
          <span className={styles.v}>{bd.base}</span>
          {bd.source && <span className={styles.tag}>{bd.source}</span>}
          {bd.dex && (<><span className={styles.op}>+</span><span className={styles.v}>{abilityMod(abilities(sheet).dex)}</span><span className={styles.tag}>DEX</span></>)}
          {(bd.bonuses ?? []).map(b => (
            <span key={b.label}><span className={styles.op}>+</span> <span className={styles.v}>{b.value}</span> <span className={styles.tag}>{b.label}</span></span>
          ))}
        </div>
      )}
    </Widget>
  )
}

/* ---------- 02 Hit Points ---------- */

function HitPoints({ sheet, character, updateSection }: {
  sheet: CharacterSheet; character: CharacterRow
  updateSection: RouteContext['updateSection']
}) {
  const cur = sheet.hp?.current ?? 0
  const max = sheet.hp?.max ?? 0
  const temp = sheet.hp?.temp ?? 0
  const pct = max > 0 ? Math.round((cur / max) * 100) : 0
  const danger = max > 0 && cur / max <= 0.25
  const [editing, setEditing] = useState<'cur' | 'temp' | null>(null)

  async function writeHp(next: { current?: number; temp?: number }) {
    if (!character.sheet) return
    const hp = character.sheet.hp ?? { current: 0, max: 0 }
    // `max` (the prop) is the EFFECTIVE ceiling — fine to clamp `current`
    // against, but the persisted `max` must stay the AUTHORED base or a
    // shard bonus would bake into canon and survive ejecting the shard.
    const baseMax = hp.max ?? 0
    const current = next.current !== undefined ? Math.max(0, Math.min(max, next.current)) : hp.current
    const t = next.temp !== undefined ? Math.max(0, next.temp) : hp.temp
    await updateSection('sheet', { ...character.sheet, hp: { ...hp, current, max: baseMax, temp: t } })
  }

  return (
    <Widget num="02" title="Hit Points" meta={<><span className="dim">Vitals</span> {pct}%</>} span={4}>
      <div className={styles.hpBody}>
        <div className={styles.hpMain}>
          <div className={styles.hpCurrentRow}>
            {editing === 'cur' ? (
              <input
                className={styles.hpInput} type="number" autoFocus defaultValue={cur}
                onBlur={e => { setEditing(null); void writeHp({ current: Number(e.target.value) }) }}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(null) }}
              />
            ) : (
              <span
                className={`${styles.hpCurrent}${danger ? ' ' + styles.danger : ''}`}
                title="Click to edit" onClick={() => setEditing('cur')}
              >{cur}</span>
            )}
            <span className={styles.hpSlash}>/</span>
            <span className={styles.hpMax}>{max}</span>
          </div>
          <div className={styles.hpMeta}>
            <span className={styles.lab}>Current</span>
            <span className={styles.sep}>·</span>
            <span className={`${styles.pct}${danger ? ' ' + styles.danger : ''}`}>{pct}% Vitals</span>
          </div>
          <div className={styles.hpBar} aria-hidden="true">
            <div className={`${styles.fill}${danger ? ' ' + styles.danger : ''}`} style={{ width: `${pct}%` }} />
            <div className={styles.notch} title="25% danger threshold" />
          </div>
        </div>
        <div className={styles.hpSide}>
          <div className={styles.hpSteppers}>
            {[-5, -1, +1, +5].map(d => (
              <button
                key={d} className={styles.hpStep}
                onClick={() => void writeHp({ current: cur + d })}
                disabled={(d < 0 && cur <= 0) || (d > 0 && cur >= max)}
              >{d < 0 ? '−' : '+'}<span className={styles.delta}>{Math.abs(d)}</span></button>
            ))}
          </div>
          <div className={styles.tempHpRow}>
            <div className={styles.lab}>Temporary HP</div>
            <div className={styles.valWrap}>
              {editing === 'temp' ? (
                <input
                  className={styles.tempInput} type="number" autoFocus defaultValue={temp}
                  onBlur={e => { setEditing(null); void writeHp({ temp: Number(e.target.value) }) }}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(null) }}
                />
              ) : (
                <span
                  className={`${styles.tempHp}${temp === 0 ? ' ' + styles.zero : ''}`}
                  title="Click to edit" onClick={() => setEditing('temp')}
                >{temp}</span>
              )}
              <span className={styles.hint}>absorbs first</span>
            </div>
          </div>
        </div>
      </div>
    </Widget>
  )
}

/* ---------- 03 Hit Dice ---------- */

function HitDice({ sheet, character, updateSection }: {
  sheet: CharacterSheet; character: CharacterRow
  updateSection: RouteContext['updateSection']
}) {
  const hd = sheet.hitDice ?? { current: 0, max: 0, die: 'd?' }
  const cur = hd.current ?? 0
  const max = hd.max ?? 0
  const die = hd.die ?? 'd?'

  async function setRemaining(next: number) {
    if (!character.sheet) return
    await updateSection('sheet', { ...character.sheet, hitDice: { ...hd, current: Math.max(0, Math.min(max, next)) } })
  }

  return (
    <Widget
      num="03" title="Hit Dice" span={3}
      meta={<button className={styles.metaBtn} disabled title="Long rest restores hit dice — wired in Phase 1">Rest</button>}
    >
      <div className={styles.hdSummary}>
        <span className={styles.v}>{max}{die}</span>
        <span className={styles.lab}>Pool</span>
        <span className={styles.rem}><span className="acc">{cur}</span> / {max} left</span>
      </div>
      <div className={styles.hdPips}>
        {Array.from({ length: max }, (_, i) => {
          const spent = i >= cur
          return (
            <button
              key={i} className={`${styles.hdPip}${spent ? ' ' + styles.spent : ''}`}
              title={spent ? 'Restore one hit die' : 'Spend one hit die'}
              onClick={() => setRemaining(i < cur ? i : i + 1)}
            >
              <span className={styles.hpFrame} />
              <span className={styles.hpInner}>
                <span className={styles.num}>{die}</span>
                <span className={styles.pipLab}>{String(i + 1).padStart(2, '0')}</span>
              </span>
            </button>
          )
        })}
      </div>
    </Widget>
  )
}

/* ---------- 04 Ability Scores ---------- */

function AbilityScores({ sheet, base, exhaustion, tier }: {
  sheet: CharacterSheet; base?: CharacterSheet['abilities']; exhaustion: number; tier: BurdenTier
}) {
  const scores = abilities(sheet)
  const buffed = ABILITY_ORDER.some(k => base && scores[k] !== base[k])
  return (
    <Widget
      num="04" title="Ability Scores" span={8}
      meta={buffed ? <><span className="acc">gear-modified</span> <span className="dim">·</span> live</> : <>6 attributes <span className="dim">·</span> static</>}
    >
      <div className={styles.abilityGrid}>
        {ABILITY_ORDER.map(key => {
          const delta = base ? scores[key] - base[key] : 0
          const disadv = hasDisadvantage(key, exhaustion, tier)
          return (
            <div key={key} className={`${styles.ablock}${delta !== 0 ? ' ' + styles.buffed : ''}`}>
              <span className={styles.abFrame} /><span className={styles.abInner} />
              {disadv && (
                <span className={styles.abDis} title="Disadvantage on checks with this ability" />
              )}
              <div className={styles.abContent}>
                <div className={styles.abName}>{ABILITY_NAMES[key]}</div>
                <div className={styles.abMod}>{formatMod(abilityMod(scores[key]))}</div>
                <div className={styles.abScore}>
                  <span className={styles.paren}>(</span>{scores[key]}<span className={styles.paren}>)</span>
                </div>
                {delta !== 0 && (
                  <div className={styles.abDelta} title={`Base ${base![key]} ${delta > 0 ? '+' : '−'} ${Math.abs(delta)} from gear`}>
                    {formatMod(delta)}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </Widget>
  )
}

/* ---------- 05 Senses & Defenses ---------- */

function Senses({ sheet, character, exhaustion, tier, effectCount, onOpenEffects }: {
  sheet: CharacterSheet; character: CharacterRow; exhaustion: number; tier: BurdenTier
  effectCount: number; onOpenEffects: () => void
}) {
  const race = character.identity?.race ?? 'Unknown'
  const dark = sheet.senses?.darkvision ?? 0
  const condition = exhaustion > 0 ? `Exhausted L${exhaustion}` : 'Normal'

  // Disadvantage on ability checks: SRD exhaustion (level 1+) and heavy
  // encumbrance both apply it — same two sources as hasDisadvantage(), which
  // the Ability Scores / Skills widgets use to mark it per-ability/skill.
  const disadvReasons: string[] = []
  if (exhaustion >= 1) disadvReasons.push('Exhaustion')
  if (tier === 'heavy') disadvReasons.push('Heavy Load')
  const checks = disadvReasons.length ? `Disadvantage · ${disadvReasons.join(' + ')}` : 'Normal'

  return (
    <Widget
      num="05" title="Senses & Defenses" span={4}
      meta={
        <>
          Passive · Condition
          <button className={`${styles.metaBtn} ${styles.glow}`} onClick={onOpenEffects} title="Active Effects">
            Effects{effectCount > 0 ? ` (${effectCount})` : ''}
          </button>
        </>
      }
    >
      <div className={styles.sensesList}>
        <SenseRow k="Passive Perception" v={String(passiveScore(sheet, 'perception'))} acc />
        <SenseRow k="Passive Investigation" v={String(passiveScore(sheet, 'investigation'))} />
        <SenseRow k="Passive Insight" v={String(passiveScore(sheet, 'insight'))} />
        <SenseRow k="Darkvision" v={dark > 0 ? `${dark} ft` : `— (${race})`} muted={dark === 0} />
        <SenseRow k="Condition" v={condition} status />
        <SenseRow k="Ability Checks" v={checks} status danger={disadvReasons.length > 0} />
      </div>
    </Widget>
  )
}

function SenseRow({ k, v, acc, muted, status, danger }: {
  k: string; v: string; acc?: boolean; muted?: boolean; status?: boolean; danger?: boolean
}) {
  const cls = [styles.v, acc && styles.acc, muted && styles.muted, status && styles.status, danger && styles.danger]
    .filter(Boolean).join(' ')
  return (
    <div className={styles.senseRow}>
      <span className={styles.k}>{k}</span>
      <span className={cls}>{v}</span>
    </div>
  )
}

/* ---------- 06 Saving Throws ---------- */

function SavingThrows({ sheet }: { sheet: CharacterSheet }) {
  const profs = (sheet.saveProficiencies ?? [])
  const profLabel = profs.length ? profs.map(p => ABILITY_ABBR[p].toUpperCase()).join(' · ') : 'none'
  return (
    <Widget num="06" title="Saving Throws" meta={<>◆ {profLabel}</>} span={5}>
      <div className={styles.savesGrid}>
        {ABILITY_ORDER.map((key: AbilityKey) => {
          const proficient = profs.includes(key)
          return (
            <div key={key} className={`${styles.saveCell}${proficient ? ' ' + styles.prof : ''}`}>
              <span className={styles.profDot} />
              <span className={styles.name}>{ABILITY_ABBR[key]}</span>
              <span className={styles.sub}>{ABILITY_NAMES[key]}</span>
              <span className={styles.mod}>{formatMod(saveTotal(sheet, key))}</span>
            </div>
          )
        })}
      </div>
    </Widget>
  )
}

/* ---------- 07 Death Saves ---------- */

function DeathSavesWidget({ character, updateSection }: {
  character: CharacterRow; updateSection: RouteContext['updateSection']
}) {
  const ds = (character.resources?.deathSaves as unknown as DeathSaves | undefined) ?? { successes: 0, failures: 0 }

  async function write(next: DeathSaves) {
    await updateSection('resources', { ...character.resources, deathSaves: next as unknown as Json })
  }

  const banner = ds.failures >= 3
    ? { text: 'Dead', cls: styles.failed }
    : ds.successes >= 3
      ? { text: 'Stabilized', cls: styles.stable }
      : { text: 'Conscious · Standing', cls: '' }

  return (
    <Widget num="07" title="Death Saves" span={3}
      meta={<button className={styles.metaBtn} onClick={() => void write({ successes: 0, failures: 0 })} title="Clear all marks">Clear</button>}
    >
      <div className={styles.deathRows}>
        {(['successes', 'failures'] as const).map(row => (
          <div key={row} className={`${styles.deathRow} ${row === 'successes' ? styles.successes : styles.fails}`}>
            <span className={styles.lab}>{row === 'successes' ? 'Successes' : 'Failures'}</span>
            <div className={styles.deathDots}>
              {[0, 1, 2].map(i => {
                const on = i < ds[row]
                return (
                  <button
                    key={i} className={`${styles.deathDot}${on ? ' ' + styles.on : ''}`}
                    aria-label={`${row} ${i + 1}`}
                    onClick={() => void write({ ...ds, [row]: i < ds[row] ? i : i + 1 })}
                  />
                )
              })}
            </div>
          </div>
        ))}
      </div>
      <div className={`${styles.deathBanner} ${banner.cls}`}>{banner.text}</div>
    </Widget>
  )
}

/* ---------- 08 Exhaustion ---------- */

function Exhaustion({ character, updateSection }: {
  character: CharacterRow; updateSection: RouteContext['updateSection']
}) {
  const level = (character.resources?.exhaustion as number | undefined) ?? 0

  async function setLevel(next: number) {
    await updateSection('resources', { ...character.resources, exhaustion: Math.max(0, Math.min(6, next)) })
  }

  return (
    <Widget num="08" title="Exhaustion" meta={<><span className="dim">6 levels</span> · death @ 6</>} span={4}>
      <div className={styles.exhTrack}>
        {[1, 2, 3, 4, 5, 6].map(lvl => {
          const on = lvl <= level
          return (
            <button
              key={lvl} className={`${styles.exhCell}${on ? ' ' + styles.on : ''}`} data-lvl={lvl}
              onClick={() => setLevel(lvl <= level ? lvl - 1 : lvl)}
            >
              <span className={styles.exFrame} /><span className={styles.exInner}>{lvl}</span>
            </button>
          )
        })}
      </div>
      <div className={styles.exhReadout}>
        <span>Current: <span className={styles.level}>Level {level}</span></span>
        <span className={`${styles.effect}${level >= 5 ? ' ' + styles.danger : ''}`}>{EXHAUSTION_EFFECTS[level]}</span>
      </div>
    </Widget>
  )
}

/* ---------- 09 Skills ---------- */

function Skills({ sheet, exhaustion, tier }: { sheet: CharacterSheet; exhaustion: number; tier: BurdenTier }) {
  const totals = allSkillTotals(sheet)
  const profCount = proficientSkillCount(sheet)
  return (
    <Widget num="09" title="Skills" span={8}
      meta={<>{SKILLS.length} entries <span className="dim">·</span> {profCount} proficient</>}
    >
      <div className={styles.skillsGrid}>
        {totals.map(({ skill, mod, proficient, expertise }) => {
          const disadv = hasDisadvantage(skill.ability, exhaustion, tier)
          return (
            <div
              key={skill.key}
              className={`${styles.skillRow}${proficient ? ' ' + styles.prof : ''}${expertise ? ' ' + styles.exp : ''}`}
            >
              <span className={styles.skInd}>
                <span className={styles.profDot} />
                {expertise && <span className={styles.profDot} />}
              </span>
              <span className={styles.skName}>{skill.name}</span>
              <span className={styles.skAbil}>
                {ABILITY_ABBR[skill.ability]}
                {disadv && <span className={styles.disDot} title="Disadvantage" />}
              </span>
              <span className={styles.skMod}>{formatMod(mod)}</span>
            </div>
          )
        })}
      </div>
    </Widget>
  )
}

/* ---------- 10 Attacks (derived from equipped weapons) ---------- */

function Attacks({ character, sheet }: { character: CharacterRow; sheet: CharacterSheet }) {
  const weapons = (character.equipped?.weapons as unknown as EquippedWeapon[] | undefined) ?? []
  return (
    <Widget num="10" title="Attacks" meta={weapons.length ? `${weapons.length} ready` : 'None'} span={4}>
      {weapons.length === 0 ? (
        <div className={styles.emptyState}>No weapons equipped — set them in Equipment.</div>
      ) : (
        <div className={styles.attackTable}>
          {weapons.map((w, i) => (
            <div key={i} className={styles.atRow}>
              <span className={styles.atIcon}><i className={`fa-solid ${w.icon ?? 'fa-khanda'}`} style={w.flip ? { transform: 'scaleX(-1)' } : undefined} /></span>
              <span className={styles.atName}>{w.name}<span className={styles.hand}>{handLabel(w.hand)}</span></span>
              <span className={styles.atToh}>{formatMod(weaponAttackBonus(w, sheet))}</span>
              <span className={styles.atDmg}>{weaponDamageString(w, sheet)}<span className={styles.type}>{w.type}</span></span>
            </div>
          ))}
        </div>
      )}
    </Widget>
  )
}

/* ---------- 11 Proficiencies & Training ---------- */

function Proficiencies({ character, sheet }: { character: CharacterRow; sheet: CharacterSheet }) {
  const p = sheet.proficiencies ?? {}
  const groups: { icon: string; label: string; chips: string[]; tone?: 'beige' }[] = [
    { icon: 'fa-shield-halved', label: 'Armor', chips: p.armor ?? [], tone: 'beige' },
    { icon: 'fa-khanda', label: 'Weapons', chips: p.weapons ?? [] },
    { icon: 'fa-hammer', label: 'Tools', chips: p.tools ?? [] },
    { icon: 'fa-language', label: 'Languages', chips: p.languages ?? [] },
    { icon: 'fa-hand-fist', label: 'Fighting Style', chips: p.fightingStyles ?? [] },
    { icon: 'fa-id-badge', label: 'Background', chips: character.identity?.background ? [character.identity.background] : [] },
  ]
  const trained = groups.reduce((n, g) => n + g.chips.length, 0)
  return (
    <Widget num="11" title="Proficiencies & Training" span={12}
      meta={<>Class &amp; race grants <span className="dim">·</span> {trained} trained</>}
    >
      <div className={styles.profChipsGrid}>
        {groups.map(g => (
          <div key={g.label} className={styles.profGroup}>
            <div className={styles.pgHead}>
              <i className={`fa-solid ${g.icon}`} />
              <span className={styles.lab}>{g.label}</span>
              <span className={styles.ct}>{g.chips.length ? `${g.chips.length} ${g.chips.length === 1 ? 'entry' : 'entries'}` : 'none trained'}</span>
            </div>
            <div className={styles.chips}>
              {g.chips.length === 0
                ? <span className={`${styles.chip} ${styles.empty}`}>—</span>
                : g.chips.map(c => <span key={c} className={`${styles.chip}${g.tone === 'beige' ? ' ' + styles.beige : ''}`}>{c}</span>)}
            </div>
          </div>
        ))}
      </div>
    </Widget>
  )
}
