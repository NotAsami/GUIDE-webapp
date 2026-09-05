import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useOutletContext } from 'react-router-dom'
import type { CharacterRow, CharacterSection, CharacterSpellbook, ShardTree, Spell, SpellSchool, SpellSlot } from '../lib/database.types'
import { gid, resolve, rollResolution } from '../lib/graph'
import { formatMod } from '../lib/dnd'
import { rollAttack } from '../lib/weapons'
import { useFoundryTarget } from '../lib/target'
import { applyOutcomes, outcomeLine, planActivation } from '../lib/graphState'
import { useGraph } from '../lib/useGraph'
import { Nav } from '../components/Nav'
import { Deco } from '../components/Deco'
import { Prose } from '../lib/markdown'
import { rollHeal } from '../lib/dice'
import { useRollLog, type RollLine } from '../lib/rolls'
import { castPartyEffect, fetchPartyRoster } from '../lib/party'
import { colorOf } from '../lib/palette'
import type { PartyRosterRow } from '../lib/database.types'
import {
  damageAt, isCaster, maxCastLevel, pactSlotCount, pactSlotLevel, pactSlotsAvail,
  preparedUsed, preparesSpells, rollSpellDamage,
} from '../lib/spells'
import { Icon } from '../components/Icon'
import styles from './Spellbook.module.css'

interface RouteContext {
  character: CharacterRow
  updateSection: <K extends CharacterSection>(section: K, next: CharacterRow[K]) => Promise<void>
  /** Casting spends a slot AND may arm a modifier — two sections, one write. */
  updateSections: (patch: Partial<Pick<CharacterRow, CharacterSection>>) => Promise<void>
  /** Slotted shards are active sources, so their nodes can target a spell. */
  shardTrees?: Record<string, ShardTree>
}

const SLOT_LABEL = ['', '1ST', '2ND', '3RD', '4TH', '5TH', '6TH', '7TH', '8TH', '9TH']
const GROUP_LABEL = [
  'Cantrips', '1st Level', '2nd Level', '3rd Level', '4th Level',
  '5th Level', '6th Level', '7th Level', '8th Level', '9th Level',
]
const SCHOOL_ICON: Record<SpellSchool, string> = {
  Evocation: 'fa-fire-flame-curved',
  Conjuration: 'fa-hand-sparkles',
  Transmutation: 'fa-arrows-spin',
  Illusion: 'fa-ghost',
  Abjuration: 'fa-shield-halved',
  Divination: 'fa-eye',
  Necromancy: 'fa-skull',
  Enchantment: 'fa-wand-magic-sparkles',
}
const schoolIcon = (school: SpellSchool) => SCHOOL_ICON[school] ?? 'fa-star'
/** DM-authored icon override (Catalog · Spells tab); falls back to the
 *  school glyph when unset. */
const spellIcon = (sp: Spell) => sp.icon || schoolIcon(sp.school)
const isReaction = (castingTime: string) => /reaction/i.test(castingTime)

/** Always 9 entries (levels 1..9), defensively filling any missing level with
 *  an empty slot — the DM caster profile writes all 9, but partial/legacy
 *  data shouldn't crash the render. */
function normalizedSlots(slots: SpellSlot[] | undefined): SpellSlot[] {
  const byLevel = new Map((slots ?? []).map(s => [s.level, s]))
  return Array.from({ length: 9 }, (_, i) => byLevel.get(i + 1) ?? { level: i + 1, total: 0, expended: 0 })
}

/** Warlock Pact Magic: a single derived slot pool (all slots the same
 *  level), never the standard ladder. `total`/`level` are pure functions of
 *  character level (lib/spells.ts) — never DM-authored, same principle as
 *  cantrip scaling. */
type PactInfo = { total: number; level: number; avail: number }
function pactInfoFor(sb: CharacterSpellbook, charLevel: number): PactInfo | null {
  if (!sb.pactMagic) return null
  return { total: pactSlotCount(charLevel), level: pactSlotLevel(charLevel), avail: pactSlotsAvail(sb, charLevel) }
}

/** Spellbook — caster profile + spell-slot tracker (01), the grimoire spell
 *  list grouped by level (02), and a spell detail panel with cast/prepare/
 *  upcast (03). Renders entirely from `character.spellbook`; a non-caster
 *  (or a caster with no known spells) gets the designed empty state rather
 *  than a broken screen. Cantrips scale by CHARACTER level (CLAUDE.md canon)
 *  — no upcast stepper on them, unlike the mockup. */
export function Spellbook() {
  const { character, updateSection, updateSections, shardTrees = {} } = useOutletContext<RouteContext>()
  // Built once per character, not per cast — see lib/useGraph.ts.
  const graph = useGraph(character, shardTrees)
  /* Who Foundry says this caster is aiming at. Null with the bridge down, which
     is every case that existed before it. */
  const target = useFoundryTarget(character?.id)
  const { addRoll } = useRollLog()
  const sb: CharacterSpellbook = character.spellbook ?? {}
  const charLevel = character.identity?.level ?? 1
  const caster = isCaster(sb)
  const preparing = preparesSpells(sb)
  const spells = sb.spells ?? []
  const slots = normalizedSlots(sb.slots)
  const pactInfo = pactInfoFor(sb, charLevel)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [castLevelById, setCastLevelById] = useState<Record<string, number>>({})
  const [lastRollById, setLastRollById] = useState<Record<string, NonNullable<ReturnType<typeof rollSpellDamage>>>>({})
  const [freshId, setFreshId] = useState<string | null>(null)
  const [flashOn, setFlashOn] = useState(false)
  const [transientNote, setTransientNote] = useState<{ msg: string; seq: number } | null>(null)
  const noteSeq = useRef(0)
  const didAutoSelect = useRef(false)

  // Auto-select the first spell once, for an immediate read (mirrors the mockup).
  useEffect(() => {
    if (didAutoSelect.current || !caster || spells.length === 0) return
    didAutoSelect.current = true
    setSelectedId(spells[0].id)
  }, [caster, spells])

  const selectedSpell = spells.find(s => s.id === selectedId) ?? null
  const cantrip = selectedSpell?.level === 0
  // The upcast stepper only exists for a levelled spell that deals damage —
  // a non-damage levelled spell always casts at its own level (matches mockup).
  // A Pact Magic caster never gets one: every pact slot is the same level,
  // so there's nothing to pick. Neither does a spell explicitly authored
  // `canUpcast: false` (some spells simply do nothing on upcast) — in both
  // cases the control is ABSENT, not disabled.
  const showStepper = !!selectedSpell && !cantrip && selectedSpell.hasDamage && !pactInfo && selectedSpell.canUpcast !== false
  const min = selectedSpell ? selectedSpell.level : 0
  const max = selectedSpell ? maxCastLevel(selectedSpell, sb) : 0
  const castLevel = !selectedSpell ? 0
    : cantrip ? 0
    : pactInfo ? Math.max(min, pactInfo.level)
    : showStepper ? Math.max(min, Math.min(max, castLevelById[selectedSpell.id] ?? min))
    : min
  const selectedSlot = (!cantrip && !pactInfo) ? slots.find(s => s.level === castLevel) : undefined
  const slotAvail = pactInfo ? pactInfo.avail : (selectedSlot ? selectedSlot.total - selectedSlot.expended : 0)
  const canCast = !selectedSpell ? false : cantrip ? true : slotAvail > 0
  const dmgInfo = selectedSpell?.hasDamage ? damageAt(selectedSpell, castLevel, charLevel) : null
  const persistentNote = selectedSpell && !cantrip && !canCast
    ? (pactInfo ? 'No Pact Slots Remaining' : `No L${castLevel} Slots Remaining`)
    : null
  const noteText = persistentNote ?? transientNote?.msg ?? null
  const noteFlash = !persistentNote && !!transientNote

  function pushNote(msg: string) {
    noteSeq.current += 1
    setTransientNote({ msg, seq: noteSeq.current })
  }

  /** Boundary semantics (deliberate, matches the mockup): clicking a FILLED
   *  pip `i` expends down to (and including) it; clicking a SPENT pip
   *  restores up to (and including) it. Not a per-pip toggle. */
  function togglePip(level: number, i: number) {
    const slot = slots.find(s => s.level === level)
    if (!slot) return
    const avail = slot.total - slot.expended
    let nextExpended = i < avail ? slot.total - i : slot.total - (i + 1)
    nextExpended = Math.max(0, Math.min(slot.total, nextExpended))
    const nextSlots = slots.map(s => (s.level === level ? { ...s, expended: nextExpended } : s))
    void updateSection('spellbook', { ...sb, slots: nextSlots })
  }

  /** Same boundary semantics as `togglePip`, over the single derived Pact
   *  Magic pool instead of the standard per-level ladder. */
  function togglePactPip(i: number) {
    if (!pactInfo) return
    const { total, avail } = pactInfo
    let nextExpended = i < avail ? total - i : total - (i + 1)
    nextExpended = Math.max(0, Math.min(total, nextExpended))
    void updateSection('spellbook', { ...sb, pactExpended: nextExpended })
  }

  function stepCast(delta: number) {
    if (!selectedSpell || !showStepper) return
    const next = Math.max(min, Math.min(max, castLevel + delta))
    setCastLevelById(prev => ({ ...prev, [selectedSpell.id]: next }))
  }

  function castSpell() {
    if (!selectedSpell) return
    const sp = selectedSpell
    let nextSb: CharacterSpellbook | null = null
    if (!cantrip) {
      if (pactInfo) {
        if (pactInfo.avail <= 0) { pushNote('No Pact Slots Remaining'); return }
        nextSb = { ...sb, pactExpended: (sb.pactExpended ?? 0) + 1 }
      } else {
        const slot = slots.find(s => s.level === castLevel)
        const avail = slot ? slot.total - slot.expended : 0
        if (avail <= 0) { pushNote(`No L${castLevel} Slots Remaining`); return }
        const nextSlots = slots.map(s => (s.level === castLevel ? { ...s, expended: s.expended + 1 } : s))
        nextSb = { ...sb, slots: nextSlots }
      }
    }

    // CASTING IS AN ACTIVATION. A `once` contribution on a spell arms rather
    // than applying, exactly as it does on a feature — but a feature arms from
    // its Use button and nothing armed a spell, so ticking "Arms once" on one
    // silently turned the effect off instead.
    //
    // Every outcome is accepted. A feature's Use shows a confirm sheet where an
    // `ask` can be declined; casting has no second step to hang one on, because
    // the cast IS the deliberate act — the slot is already spent by the time
    // this runs.
    const outcomes = planActivation(sp, graph, character, gid('spell', sp))
    const answers = new Set(outcomes.map(o => o.ask).filter((a): a is string => !!a))
    const { resources, usesPatch, applied } = applyOutcomes(character, outcomes, answers)

    /* A cast can move a FEATURE's use counter (`addUses`), and those live on
       `sheet` rather than in `resources` — so this joins the same write. Dropping
       it would be the quietest possible bug: the spell fires, the log says the
       charge came back, and the sheet never hears about it. */
    const nextFeatures = usesPatch
      ? (character.sheet?.features ?? []).map(f =>
        usesPatch[f.id] !== undefined ? { ...f, uses: { ...f.uses!, current: usesPatch[f.id] } } : f)
      : null

    // ONE round trip. The slot spend and the armed modifier are the same press,
    // and two writes could land apart — leaving a slot spent with nothing armed.
    void updateSections({
      ...(nextSb ? { spellbook: nextSb } : {}),
      ...(applied.length ? { resources: resources as CharacterRow['resources'] } : {}),
      ...(nextFeatures ? { sheet: { ...(character.sheet ?? {}), features: nextFeatures } } : {}),
    })

    let noteMsg: string
    const subject = gid('spell', sp)
    const targetAc = target?.ac

    /* THE ATTACK, when the spell calls for one. Fire Bolt is a d20 before it is
       damage, and the app rolled only the damage — the player threw the attack
       die somewhere else and the two halves of one cast lived apart.
       `sub: 'spell'` is what `roll:attack.spell` matches; the melee/ranged half
       rides on `ability` for the same reason a greataxe swing is both. Same
       roller the weapon card uses, so the crit threshold cannot drift. */
    const atkRes = sp.attack
      ? resolve(graph, {
        kind: 'attack', sub: 'spell', ability: sp.attack, subject, tags: sp.tags,
        cast: castLevel, proficient: true, targetAc,
      })
      : null
    const atkGraph = atkRes ? rollResolution(atkRes) : null
    const spellAtk = atkRes
      ? rollAttack(
        (sb.attackBonus ?? 0) + (atkGraph?.flat ?? 0),
        [
          { label: 'SPELL ATK', value: sb.attackBonus ?? 0 },
          { label: 'FEAT', value: atkGraph?.flat ?? 0 },
        ],
        atkRes, targetAc,
      )
      : null
    const crit = spellAtk?.attack.crit ?? false

    // The same boundary the weapon roller uses, on the roll kind a spell has:
    // the spell IS the subject, so a feature can target it by gid or by tag.
    // `cast` becomes real here: the level the slot was actually spent at, which
    // is what "1d6 per level above 1st" has always wanted to read.
    //
    // RESOLVED AFTER THE D20 on an attack spell, so an on-hit contribution can
    // read `hit` — the same ordering rollWeaponAttack keeps.
    const res = resolve(graph, {
      kind: 'damage', sub: 'spell', subject, tags: sp.tags, cast: castLevel,
      targetAc, ...(spellAtk ? { hit: spellAtk.hit } : {}),
    })
    const roll = sp.hasDamage ? rollSpellDamage(sp, castLevel, charLevel, rollResolution(res, crit), crit) : null
    if (roll) {
      setLastRollById(prev => ({ ...prev, [sp.id]: roll }))
      setFreshId(sp.id)
      window.setTimeout(() => setFreshId(f => (f === sp.id ? null : f)), 950)
      noteMsg = spellAtk
        ? `${sp.name} — ${spellAtk.attack.total} to hit`
          + (spellAtk.hit === undefined ? '' : spellAtk.hit ? ' · HIT' : ' · MISS')
          + ` · ${roll.total} ${roll.type} damage`
        : `${sp.name} — ${roll.total} ${roll.type} damage (${roll.expr})`
      addRoll({
        kind: 'custom',
        title: sp.name,
        subtitle: cantrip ? 'Cantrip' : `Level ${castLevel} slot`,
        icon: spellIcon(sp),
        subject: { kind: 'spell', id: sp.id },
        ...(spellAtk ? { attack: spellAtk.attack } : {}),
        ...(target ? { target: { name: target.name, hit: spellAtk?.hit } } : {}),
        // The DC the target rolls against, in the slot an attack roll would
        // fill. Shown only when the SPELL says it calls for a save; the DC is
        // the caster's, because 5e derives it once per caster.
        ...(sp.save && sb.saveDC !== undefined ? { saveDC: sb.saveDC, saveAbility: sp.save } : {}),
        // A real DamageRoll rather than a prose line: that is what gives a spell
        // die chips, a rerollable die, the contribution list and the catalog
        // sheet. Every panel surface built in 5b–5e applies the moment the shape
        // is right, and none of it had to know spells existed.
        damage: {
          diceExpr: roll.expr, dice: roll.rolls, bonus: roll.mod,
          total: roll.total, type: roll.type, crit: false,
          breakdown: `${roll.expr} = ${roll.total}`,
        },
        riderGroups: [
          { label: 'Attack', riders: atkGraph?.riders ?? [] },
          { label: 'Damage', riders: roll.riders },
        ].filter(g => g.riders.length),
        notes: [...(atkRes?.notes ?? []), ...res.notes].length
          ? [...(atkRes?.notes ?? []), ...res.notes] : undefined,
        problems: [...(atkRes?.problems ?? []), ...res.problems].length
          ? [...(atkRes?.problems ?? []), ...res.problems] : undefined,
      })
    } else {
      noteMsg = spellAtk
        ? `${sp.name} — ${spellAtk.attack.total} to hit`
          + (spellAtk.hit === undefined ? '' : spellAtk.hit ? ' · HIT' : ' · MISS')
        : cantrip ? `${sp.name} cast · at-will` : `${sp.name} cast · L${castLevel} slot expended`
      // EVERY cast gets an entry, not just one that damages or arms. This used
      // to be gated on `applied.length`, so a utility spell — Detect Magic,
      // Shield, most of the list — logged nothing at all: no toast, no roll in
      // the context panel, and therefore no "open panel" either. The player
      // pressed Cast, saw a note flash by, and had to trust a slot had gone.
      // §16's visibility argument does not stop at spells that roll dice.
      addRoll({
        kind: 'custom', title: sp.name,
        subtitle: cantrip ? 'Cantrip' : `Level ${castLevel} slot`,
        icon: spellIcon(sp),
        subject: { kind: 'spell', id: sp.id },
        /* AN ATTACK SPELL NEED NOT DEAL DAMAGE. Shocking Grasp's rider is the
           lost reaction, not the die — so the d20 rides on this entry too,
           rather than only on the damage branch. */
        ...(spellAtk ? { attack: spellAtk.attack } : {}),
        ...(target ? { target: { name: target.name, hit: spellAtk?.hit } } : {}),
        ...(atkGraph?.riders.length ? { riderGroups: [{ label: 'Attack', riders: atkGraph.riders }] } : {}),
        lines: applied.length
          ? applied.map(outcomeLine)
          // Nothing mechanical to report, so the line states what the cast COST.
          // An entry with no lines renders as an empty card, which reads as a bug.
          : [{
            label: 'Cast',
            total: cantrip ? 'at-will' : `L${castLevel} slot`,
            breakdown: `${sp.name} cast${cantrip ? ' at will' : ` using a level ${castLevel} slot`}.`,
          }],
      })
    }
    if (applied.some(o => o.kind === 'arm')) noteMsg = `${sp.name} — armed for your next roll`
    pushNote(noteMsg)
    setFlashOn(true)
    window.setTimeout(() => setFlashOn(false), 620)
  }

  function togglePrepare() {
    if (!selectedSpell || selectedSpell.level === 0 || !preparing) return
    const sp = selectedSpell
    if (!sp.prepared && preparedUsed(sb) >= (sb.preparedMax ?? 0)) {
      pushNote('Prepared Limit Reached')
      return
    }
    const nextSpells = spells.map(s => (s.id === sp.id ? { ...s, prepared: !s.prepared } : s))
    void updateSection('spellbook', { ...sb, spells: nextSpells })
    pushNote(sp.prepared ? 'Unprepared' : 'Prepared')
  }

  const meta = (
    <>
      <span className="dim">◇</span>
      <span>Section</span>
      <span className="acc">/ Spellbook</span>
      <span className="dim">·</span>
      <span>Grimoire</span>
      <span className="dim">·</span>
      {caster && preparing ? (
        <span>Prepared <span className="acc">::</span> {`${preparedUsed(sb)}/${sb.preparedMax ?? 0}`}</span>
      ) : (
        <span>Known <span className="acc">::</span> {caster ? spells.filter(s => s.level > 0).length : 0}</span>
      )}
      <span className="dim">//</span>
      <span className="stamp">{character.name.toUpperCase().replace(/\s+/g, '.')}</span>
    </>
  )

  return (
    <>
      <Deco
        left={<><span className="acc">SPELLBOOK</span> &nbsp;//&nbsp; GRIMOIRE &nbsp;//&nbsp; WEAVE {caster ? 'OK' : 'INERT'}</>}
        right={<>Grimoire <span className="acc">{character.name.toUpperCase()}</span> &nbsp;//&nbsp; DM-Authored</>}
      />
      <Nav variant="dock" meta={meta} />

      <main className={styles.spellbook}>
        {/* ============ 01 CASTER PROFILE (top band) ============ */}
        <section className={`${styles.col} ${styles.sbBand}`} aria-label="Caster profile">
          <div className={styles.colHeader}>
            <span className={styles.chNum}>01</span>
            <span className={styles.chTitle}>Caster Profile</span>
            <span className={styles.chMeta}>
              {caster ? <><span className="acc">Arcane</span> · Bound</> : <><span className="acc">None</span> · Inert</>}
            </span>
          </div>
          <div className={styles.region}>
            <div className={styles.rFrame} /><div className={styles.rGap} /><div className={styles.rLine} />
            <div className={styles.rInner}>
              <span className={`${styles.rCorner} ${styles.tl}`} />
              <span className={`${styles.rCorner} ${styles.br}`} />
              <div className={styles.profilePad}>
                {caster ? (
                  <CasterProfile
                    sb={sb} slots={slots} preparing={preparing} pactInfo={pactInfo}
                    onTogglePip={togglePip} onTogglePactPip={togglePactPip}
                  />
                ) : (
                  <div className={styles.castStats}>
                    <div className={styles.csItem}>
                      <span className={styles.csK}>Spellcasting</span>
                      <span className={`${styles.csV} ${styles.text} ${styles.muted}`}>None</span>
                    </div>
                    <div className={styles.csItem}>
                      <span className={styles.csK}>Source</span>
                      <span className={`${styles.csV} ${styles.text} ${styles.dim}`}>—</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        <div className={styles.sbBody}>
          {/* ============ 02 GRIMOIRE ============ */}
          <section className={styles.col} aria-label="Grimoire">
            <div className={styles.colHeader}>
              <span className={styles.chNum}>02</span>
              <span className={styles.chTitle}>Grimoire</span>
              <span className={styles.chMeta}><span className="acc">{spells.length}</span> Spells Inscribed</span>
            </div>
            <div className={styles.region}>
              <div className={styles.rFrame} /><div className={styles.rGap} /><div className={styles.rLine} />
              <div className={styles.rInner}>
                <span className={`${styles.rCorner} ${styles.tl}`} />
                <span className={`${styles.rCorner} ${styles.br}`} />
                <div className={styles.grimPad}>
                  <div className={`${styles.grimScroll} ${styles.scrollY}`}>
                    {caster ? (
                      <Grimoire spells={spells} slots={slots} preparing={preparing} pactInfo={pactInfo} selectedId={selectedId} onSelect={setSelectedId} />
                    ) : (
                      <div className={styles.emptyState}>
                        <i className={`${styles.esGlyph} fa-solid fa-book-skull`} aria-hidden="true" />
                        <div className={styles.esTitle}>No Arcane Current Detected</div>
                        <div className={styles.esSub}>Spellcasting :: None</div>
                        <div className={styles.esLine}>// This bearer channels no spells<span className={styles.esCur}>█</span></div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ============ 03 SPELL DETAIL ============ */}
          <section className={`${styles.col} ${styles.detailCol}`} aria-label="Spell detail">
            <div className={styles.colHeader}>
              <span className={styles.chNum}>03</span>
              <span className={styles.chTitle}>Spell Detail</span>
              <span className={styles.chMeta}>
                {!caster ? 'Inert' : selectedSpell ? <span className="acc">{selectedSpell.school}</span> : 'No Selection'}
              </span>
            </div>
            <div className={styles.region}>
              <div className={styles.rFrame} /><div className={styles.rGap} /><div className={styles.rLine} />
              <div className={styles.rInner}>
                <span className={`${styles.rCorner} ${styles.tl}`} />
                <span className={`${styles.rCorner} ${styles.br}`} />
                <div className={styles.detailPad}>
                  {selectedSpell ? (
                    <SpellDetail
                      key={selectedSpell.id}
                      spell={selectedSpell}
                      cantrip={!!cantrip}
                      preparing={preparing}
                      pact={!!pactInfo}
                      showStepper={showStepper}
                      castLevel={castLevel}
                      min={min}
                      max={max}
                      canCast={canCast}
                      dmgInfo={dmgInfo}
                      attackBonus={sb.attackBonus}
                      roll={lastRollById[selectedSpell.id] ?? null}
                      fresh={freshId === selectedSpell.id}
                      flashOn={flashOn}
                      noteText={noteText}
                      noteFlash={noteFlash}
                      onStep={stepCast}
                      onCast={castSpell}
                      onTogglePrepare={togglePrepare}
                    />
                  ) : (
                    <div className={styles.detailEmpty}>
                      {caster ? (
                        <>
                          <span className={styles.prompt}>Select Spell</span>
                          <span className={styles.cur}>█</span>
                          <span className={styles.hint}>// Choose any spell from the grimoire</span>
                        </>
                      ) : (
                        <>
                          <span className={styles.prompt} style={{ color: 'var(--beige-dim)' }}>Weave Silent</span>
                          <span className={styles.hint}>// No spells to inspect</span>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
    </>
  )
}

function CasterProfile({
  sb, slots, preparing, pactInfo, onTogglePip, onTogglePactPip,
}: {
  sb: CharacterSpellbook
  slots: SpellSlot[]
  preparing: boolean
  pactInfo: PactInfo | null
  onTogglePip: (level: number, i: number) => void
  onTogglePactPip: (i: number) => void
}) {
  const used = preparedUsed(sb)
  const max = sb.preparedMax ?? 0
  const known = (sb.spells ?? []).filter(s => s.level > 0).length
  return (
    <>
      <div className={styles.castStats}>
        <div className={styles.csItem}>
          <span className={styles.csK}>Spellcasting</span>
          <span className={`${styles.csV} ${styles.text}`}>
            {sb.class ?? '—'} <span className={styles.unit}>({(sb.ability ?? '').toString().toUpperCase() || '—'})</span>
          </span>
        </div>
        <div className={styles.csItem}><span className={styles.csK}>Save DC</span><span className={styles.csV}>{sb.saveDC ?? '—'}</span></div>
        <div className={styles.csItem}>
          <span className={styles.csK}>Spell Atk</span>
          <span className={styles.csV}>{sb.attackBonus != null ? `+${sb.attackBonus}` : '—'}</span>
        </div>
        {/* Known-style casters (Sorcerer/Bard/Ranger/Warlock/…) have no daily
            prep step and no cap — the "Prepared" stat doesn't apply to them. */}
        {preparing ? (
          <div className={styles.csItem}>
            <span className={styles.csK}>Prepared</span>
            <span className={`${styles.csV} ${used >= max ? styles.full : ''}`}>
              {used} <span className={styles.unit}>/ {max}</span>
            </span>
          </div>
        ) : (
          <div className={styles.csItem}>
            <span className={styles.csK}>Known</span>
            <span className={styles.csV}>{known}</span>
          </div>
        )}
      </div>
      <div className={styles.profileRule} />
      <div className={styles.slotTrack}>
        <span className={styles.slotLabel}>Spell<br />Slots</span>
        <div className={styles.slotCells}>
          <div className={`${styles.slotCell} ${styles.cantripCell}`}>
            <span className={styles.scLvl}>Cant</span>
            <span className={styles.scInf}>∞</span>
            <span className={styles.scCount}>At-Will</span>
          </div>
          {pactInfo ? (
            // Pact Magic: ONE cell for the whole pool — every slot is the
            // same derived level, so there's no per-level ladder to show.
            <div className={`${styles.slotCell} ${styles.pactCell}`}>
              <span className={styles.scLvl}>Pact</span>
              <span className={styles.scPips}>
                {Array.from({ length: pactInfo.total }, (_, i) => {
                  const filled = i < pactInfo.avail
                  return (
                    <button
                      type="button"
                      key={i}
                      className={`${styles.pip} ${filled ? styles.filled : styles.spent}`}
                      aria-label={`Pact slot ${i + 1} ${filled ? 'available' : 'expended'}`}
                      onClick={() => onTogglePactPip(i)}
                    />
                  )
                })}
              </span>
              <span className={styles.scCount}>{pactInfo.avail}/{pactInfo.total} · Level {pactInfo.level}</span>
            </div>
          ) : (
            slots.map(slot => {
              if (slot.total === 0) {
                return (
                  <div className={`${styles.slotCell} ${styles.inert}`} key={slot.level}>
                    <span className={styles.scLvl}>{SLOT_LABEL[slot.level]}</span>
                    <span className={styles.scNone}>—</span>
                    <span className={styles.scCount}>No Slots</span>
                  </div>
                )
              }
              const avail = slot.total - slot.expended
              return (
                <div className={styles.slotCell} key={slot.level}>
                  <span className={styles.scLvl}>{SLOT_LABEL[slot.level]}</span>
                  <span className={styles.scPips}>
                    {Array.from({ length: slot.total }, (_, i) => {
                      const filled = i < avail
                      return (
                        <button
                          type="button"
                          key={i}
                          className={`${styles.pip} ${filled ? styles.filled : styles.spent}`}
                          aria-label={`Level ${slot.level} slot ${i + 1} ${filled ? 'available' : 'expended'}`}
                          onClick={() => onTogglePip(slot.level, i)}
                        />
                      )
                    })}
                  </span>
                  <span className={styles.scCount}>{avail}/{slot.total}</span>
                </div>
              )
            })
          )}
        </div>
      </div>
    </>
  )
}

function Grimoire({
  spells, slots, preparing, pactInfo, selectedId, onSelect,
}: {
  spells: Spell[]
  slots: SpellSlot[]
  preparing: boolean
  pactInfo: PactInfo | null
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const byLevel = new Map<number, Spell[]>()
  for (const sp of spells) {
    const arr = byLevel.get(sp.level) ?? []
    arr.push(sp)
    byLevel.set(sp.level, arr)
  }
  const levels = [...byLevel.keys()].sort((a, b) => a - b)
  return (
    <>
      {levels.map(lvl => {
        const slot = lvl > 0 ? slots.find(s => s.level === lvl) : null
        // Every non-cantrip level draws from the SAME shared pact pool, not
        // its own row — the pool number shows under every level group.
        const slotNote = lvl === 0 ? 'At-Will'
          : pactInfo ? `${pactInfo.avail}/${pactInfo.total} Pact`
          : slot ? `${slot.total - slot.expended}/${slot.total} Slots` : '0/0 Slots'
        return (
          <div key={lvl}>
            <div className={`${styles.lvlHead} ${lvl === 0 ? styles.cantripHead : ''}`}>
              {GROUP_LABEL[lvl] ?? `Level ${lvl}`}
              <span className={styles.lhSlots}>{slotNote}</span>
            </div>
            {byLevel.get(lvl)!.map(sp => (
              <SpellRow key={sp.id} sp={sp} selected={sp.id === selectedId} preparing={preparing} onSelect={() => onSelect(sp.id)} />
            ))}
          </div>
        )
      })}
    </>
  )
}

function SpellRow({ sp, selected, preparing, onSelect }: { sp: Spell; selected: boolean; preparing: boolean; onSelect: () => void }) {
  const cantrip = sp.level === 0
  // A known-style caster's levelled spells are always ready — only a
  // preparing caster's un-prepared spells read as dimmed/"not prepared".
  const ready = cantrip || !preparing || !!sp.prepared
  const unprepared = !ready
  return (
    <button
      type="button"
      className={[styles.spellRow, selected ? styles.selected : '', unprepared ? styles.unprepared : ''].filter(Boolean).join(' ')}
      onClick={onSelect}
    >
      {cantrip ? (
        <span className={`${styles.prepDot} ${styles.prepCantrip}`} title="Always prepared">∞</span>
      ) : !preparing ? (
        <span className={`${styles.prepDot} ${styles.prep}`} title="Known · always ready">
          <span className={styles.dot} />
        </span>
      ) : (
        <span className={`${styles.prepDot} ${sp.prepared ? styles.prep : styles.unprep}`} title={sp.prepared ? 'Prepared' : 'Known · not prepared'}>
          <span className={styles.dot} />
        </span>
      )}
      <span className={styles.spellMain}>
        <span className={styles.spellName}>{sp.name}</span>
        <span className={styles.spellSub}>
          <span className={styles.school}><Icon name={spellIcon(sp)} className={styles.schoolIc} style={sp.iconColor ? { color: sp.iconColor } : undefined} />{sp.school}</span>
        </span>
      </span>
      <span className={styles.spellTags}>
        {sp.concentration && <span className={styles.tagChip} title="Concentration"><i className="fa-solid fa-eye" /></span>}
        {sp.ritual && <span className={`${styles.tagChip} ${styles.txt}`} title="Ritual">R</span>}
        {isReaction(sp.castingTime) && <span className={`${styles.tagChip} ${styles.txt}`} title="Reaction"><i className="fa-solid fa-bolt" /></span>}
      </span>
    </button>
  )
}

function SpellDetail({
  spell, cantrip, preparing, pact, showStepper, castLevel, min, max, canCast, dmgInfo, attackBonus, roll, fresh, flashOn,
  noteText, noteFlash, onStep, onCast, onTogglePrepare,
}: {
  spell: Spell
  cantrip: boolean
  preparing: boolean
  pact: boolean
  showStepper: boolean
  castLevel: number
  min: number
  max: number
  canCast: boolean
  dmgInfo: ReturnType<typeof damageAt>
  /** The caster's spell attack bonus, for a spell that calls for an attack
   *  roll. Undefined when the profile has none — the row then says so rather
   *  than showing a confident +0. */
  attackBonus?: number
  roll: NonNullable<ReturnType<typeof rollSpellDamage>> | null
  fresh: boolean
  flashOn: boolean
  noteText: string | null
  noteFlash: boolean
  onStep: (delta: number) => void
  onCast: () => void
  onTogglePrepare: () => void
}) {
  const ic = spellIcon(spell)
  const lvlLine = cantrip ? 'Cantrip' : `Level ${spell.level}`
  const castLabel = cantrip ? 'Cast · At-Will' : pact ? `Cast · Pact L${castLevel}` : `Cast · L${castLevel} Slot`
  /* ONE HOME FOR THE DAMAGE PALETTE. This used to read an authored per-spell
     `dmgColor` hex, so Fire Bolt was seeded orange (#f3a216) here while the roll
     context panel — which asks lib/palette.ts — drew the same fire damage red.
     Two records of one fact, and the authored one always won on this screen.
     Now both screens ask the palette and a damage type has exactly one colour. */
  const dmgColorStyle = (() => {
    const c = spell.dmgType ? colorOf(spell.dmgType.toLowerCase()) : null
    return c ? { ['--dmg-color' as string]: c } : undefined
  })()

  return (
    <div className={styles.detailActive}>
      {flashOn && <div className={styles.daFlashPulse} aria-hidden="true" />}
      <div className={styles.daHead}>
        <div className={styles.daName}>{spell.name}</div>
        <div className={styles.daLine}>
          {lvlLine}
          <span className={styles.sep}>·</span>
          <span className={styles.school}><Icon name={ic} className={styles.schoolIc} style={spell.iconColor ? { color: spell.iconColor } : undefined} />{spell.school}</span>
        </div>
      </div>

      <div className={`${styles.daBody} ${styles.scrollY}`}>
        <div className={styles.daGrid}>
          <div className={styles.daCell}><span className={styles.dcK}>Casting Time</span><span className={styles.dcV}>{spell.castingTime}</span></div>
          <div className={styles.daCell}><span className={styles.dcK}>Range</span><span className={styles.dcV}>{spell.range}</span></div>
          <div className={styles.daCell}>
            <span className={styles.dcK}>Components</span>
            <span className={styles.dcV}>
              <span className={styles.compSet}>
                <span className={`${styles.comp} ${spell.v ? styles.on : ''}`} title="Verbal">V</span>
                <span className={`${styles.comp} ${spell.s ? styles.on : ''}`} title="Somatic">S</span>
                <span className={`${styles.comp} ${spell.m ? styles.on : ''}`} title="Material">M</span>
              </span>
              {spell.m && spell.material && <span className={styles.mat}>{spell.material}</span>}
            </span>
          </div>
          <div className={styles.daCell}><span className={styles.dcK}>Duration</span><span className={styles.dcV}>{spell.duration}</span></div>
        </div>

        {(spell.concentration || spell.ritual) && (
          <div className={styles.daFlags}>
            {spell.concentration && <span className={styles.daFlag}><i className="fa-solid fa-eye" /> Concentration</span>}
            {spell.ritual && <span className={styles.daFlag}><i className="fa-solid fa-hourglass-half" /> Ritual</span>}
          </div>
        )}

        <span className={styles.daDescLabel}>// Effect</span>
        <Prose text={spell.desc || '—'} className={styles.daDesc} />

        {/* THE ATTACK, before the damage, because that is the order it happens
            in. A spell that calls for one says so here rather than only in the
            roll it produces — the player needs to know Cast is about to throw a
            d20. The bonus is the caster's profile number, and a profile without
            one is stated, never rendered as +0. */}
        {spell.attack && (
          <div>
            <span className={styles.daDescLabel} style={{ marginTop: 18 }}>// Attack</span>
            <div className={styles.ddControl}>
              <span className={styles.ddClab}>{spell.attack === 'melee' ? 'Melee' : 'Ranged'} spell attack</span>
              <span className={styles.ddExpr}>
                <i className="fa-solid fa-dice-d20" />{' '}
                {attackBonus === undefined ? 'no spell attack bonus on the profile' : `${formatMod(attackBonus)} to hit`}
              </span>
            </div>
          </div>
        )}

        {spell.hasDamage && (
          <div style={dmgColorStyle}>
            <span className={styles.daDescLabel} style={{ marginTop: 18 }}>// Damage</span>
            {dmgInfo ? (
              <div className={styles.ddControl}>
                <span className={styles.ddClab}>Cast At</span>
                {showStepper ? (
                  <div className={styles.ddStepper}>
                    <button type="button" className={styles.ddStep} disabled={castLevel <= min} aria-label="Lower cast level" onClick={() => onStep(-1)}>
                      <i className="fa-solid fa-minus" />
                    </button>
                    <span className={styles.ddLvl}>Level {castLevel}</span>
                    <button type="button" className={styles.ddStep} disabled={castLevel >= max} aria-label="Raise cast level" onClick={() => onStep(1)}>
                      <i className="fa-solid fa-plus" />
                    </button>
                  </div>
                ) : (
                  <span className={styles.ddLvl}>{cantrip ? 'Will' : pact ? `Pact · L${castLevel}` : `Level ${castLevel}`}</span>
                )}
                <span className={styles.ddExpr}>
                  <i className="fa-solid fa-dice-d6" /> {dmgInfo.expr} <span className={styles.ddType}>{dmgInfo.type}</span>
                </span>
                {showStepper && castLevel > min && <span className={styles.ddUp}>▲ Upcast +{castLevel - min}</span>}
              </div>
            ) : (
              <div className={styles.ddControl}>
                <span className={styles.ddClab}>{spell.dice ? `"${spell.dice}" — unparseable, roll disabled` : 'No dice authored'}</span>
              </div>
            )}
            {roll && (
              <div className={`${styles.dmgRoll} ${fresh ? styles.fresh : ''}`}>
                <span className={styles.drFrame} />
                <div className={styles.drInner}>
                  <span className={styles.drName}>{spell.name} · {roll.cantrip ? `Lvl ${roll.level}` : `L${roll.level}`}</span>
                  <span className={styles.drTotal}>{roll.total}</span>
                  <span className={styles.drDice}>
                    {roll.rolls.map((d, i) => (
                      <span key={i} className={`${styles.die} ${d.v === d.sides ? styles.max : ''}`}>{d.v}</span>
                    ))}
                  </span>
                  <span className={styles.drBreak}>{roll.expr} <span className={styles.eq}>= {roll.total}</span> {roll.type}</span>
                  <span className={styles.drStamp}>{roll.stamp}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className={styles.daFoot}>
        <div className={[styles.daNote, noteText ? styles.show : '', noteFlash ? styles.flash : ''].filter(Boolean).join(' ')}>
          {noteText ? `// ${noteText}` : ''}
        </div>
        <div className={styles.daActions}>
          <button type="button" className={styles.actBtn} disabled={!canCast} onClick={onCast}>
            <span className={styles.abFrame} /><span className={styles.abInner}><i className="fa-solid fa-wand-sparkles" /> {castLabel}</span>
          </button>
          {!cantrip && preparing && (
            <button type="button" className={`${styles.actBtn} ${styles.secondary}`} onClick={onTogglePrepare}>
              <span className={styles.abFrame} />
              <span className={styles.abInner}>
                <i className={`fa-${spell.prepared ? 'solid' : 'regular'} fa-bookmark`} /> {spell.prepared ? 'Unprepare' : 'Prepare'}
              </span>
            </button>
          )}
          {spell.partyCastable && <PartyCastButton spell={spell} />}
        </div>
      </div>
    </div>
  )
}

/** "Cast at party member" — a target picker for a spell the DM marked
 *  `partyCastable`. Self-contained (mirrors RestButton's modal pattern):
 *  fetches the roster on open, applies via the `cast_party_effect` RPC (the
 *  only path that can touch another PC's row, migration 0011), and logs a
 *  roll-log entry for the caster's own toast. Deliberately dumb, per the
 *  handoff: no range check, no concentration tracking, no save adjudication —
 *  it just rolls (heal mode) or authors (effect mode) the number/status and
 *  applies it. */
function PartyCastButton({ spell }: { spell: Spell }) {
  const { addRoll } = useRollLog()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [roster, setRoster] = useState<PartyRosterRow[]>([])
  const [note, setNote] = useState<string | null>(null)
  const isHeal = spell.partyCastMode !== 'effect'

  async function openPicker() {
    setOpen(true)
    setNote(null)
    setLoading(true)
    try {
      setRoster(await fetchPartyRoster())
    } catch {
      setNote('Could not load the party.')
    } finally {
      setLoading(false)
    }
  }

  async function castOn(member: PartyRosterRow) {
    setBusy(true)
    let heal: number | null = null
    let line: RollLine
    if (isHeal) {
      const { total, breakdown } = rollHeal(spell.healDice || '0')
      heal = total
      line = { label: 'Healed', total: `+${total}`, breakdown: `${breakdown} → ${member.name}`, tone: 'heal' }
    } else {
      line = { label: 'Effect', total: spell.name, breakdown: `Applied to ${member.name}${spell.effectNote ? ` · ${spell.effectNote}` : ''}`, tone: 'buff' }
    }
    const effect = isHeal ? null : { name: spell.name, icon: spellIcon(spell), kind: spell.effectTone ?? 'buff', note: spell.effectNote }
    const res = await castPartyEffect(member.id, heal, effect)
    setBusy(false)
    if (!res.ok) { setNote('Cast failed — try again.'); return }
    addRoll({ kind: 'custom', title: spell.name, subtitle: `Cast on ${member.name}`, icon: spellIcon(spell), lines: [line] })
    setOpen(false)
  }

  return (
    <>
      <button type="button" className={`${styles.actBtn} ${styles.party}`} onClick={() => void openPicker()} aria-label={`Cast ${spell.name} on a party member`}>
        <span className={styles.abFrame} /><span className={styles.abInner}><i className="fa-solid fa-hand-holding-heart" /></span>
      </button>
      {open && createPortal(
        <div className={styles.pcOverlay} onClick={() => setOpen(false)}>
          <div className={styles.pcPanel} onClick={e => e.stopPropagation()} role="dialog" aria-label="Cast on party member">
            <div className={styles.pcHead}>
              <span className={styles.pcTitle}>{spell.name}</span>
              <span className={styles.pcSub}>{isHeal ? `Heal · ${spell.healDice || '—'}` : `Effect · ${spell.effectTone ?? 'buff'}`}</span>
            </div>
            <div className={styles.pcBody}>
              {loading ? (
                <div className={styles.pcEmpty}>Loading party…</div>
              ) : roster.length === 0 ? (
                <div className={styles.pcEmpty}>No other party members bound</div>
              ) : roster.map(m => (
                <button key={m.id} type="button" className={styles.pcRow} disabled={busy} onClick={() => void castOn(m)}>
                  <span className={styles.pcName}>{m.name}</span>
                  {m.hp_max != null && m.hp_max > 0 && <span className={styles.pcHp}>{m.hp_current}/{m.hp_max} HP</span>}
                </button>
              ))}
              {note && <div className={styles.pcNote}>{note}</div>}
            </div>
            <div className={styles.pcFoot}>
              <button type="button" className={styles.pcCancel} onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
