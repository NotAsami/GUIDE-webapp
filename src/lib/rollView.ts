/**
 * The Roll Context Panel's view model — a `RollEntry` reshaped into what the
 * rail renders, and nothing else.
 *
 * Pure and separate from the component for one reason: the totals arithmetic is
 * the part that can be silently wrong. A rider counted twice, or a rolled `ask`
 * that fails to reach the total, is a number a player trusts and shouldn't.
 * Here it is testable without a renderer.
 *
 * THE THREE RIDER STATES ARE THE ENGINE'S, not a second vocabulary:
 *
 *   resolved   — the engine decided it applies. A breakdown line, never a control.
 *   unresolved — depends on something only a human knows. A toggle.
 *   (absent)   — §32's two non-surfacing rows never reach here at all; resolve()
 *                already dropped them, which is why there is no third case.
 */
import type { Rider } from './graph.ts'
import type { RollEntry } from './rolls.tsx'
import { ABILITY_ABBR, type CheckTerm } from './dnd.ts'
import type { CharacterRow, ShardTree } from './database.types.ts'
import { activeSources } from './effects.ts'
import { rerollDie, type RolledDie } from './dice.ts'

/** `dropped` is a property of this LINE, not of the die — the same face is kept
 *  under advantage and discarded under disadvantage — so it lives here and not
 *  on `RolledDie`. Everything else the chip needs (sides, orig, rerolled) rides
 *  with the die itself. */
export type Die = RolledDie & { dropped?: boolean }

export type RollLineView = {
  kind: 'attack' | 'damage' | 'check'
  label: string
  formula: string
  dice: Die[]
  /** 'vs' joins the dice under adv/dis — two contested rolls, not a sum. */
  mode?: 'adv' | 'dis'
  mods: number
  /** `mods`, itemised, for the modifier read-out. Empty when the producer did
   *  not name its parts — the chip still shows the sum. */
  modParts: CheckTerm[]
  type?: string
  crit?: boolean
  total: number
  /** What the FOOTER calls this line's total. Absent = "Total <label>", which is
   *  right for a roll and wrong for a DC — "Total Save DC" is not a total. */
  totalLabel?: string
}

export type FlagName = 'ADVANTAGE' | 'DISADVANTAGE' | 'CRIT'

/** A rider plus everything the panel needs to draw it without re-deriving. */
export type RiderView = {
  rider: Rider
  /** Index within the entry's flattened rider list — the patch address. */
  index: number
  group: string
  /** `note` contributes nothing and grants nothing: answering it REVEALS. It is
   *  its own kind rather than a flag with no flag, which is what it would look
   *  like otherwise. */
  kind: 'value' | 'flag' | 'note'
  grants?: FlagName
  /** Contributing right now: resolved, or a flag the player switched on, or an
   *  answered value rider whose dice have been rolled. */
  live: boolean
  value: number
}

const FLAG: Partial<Record<Rider['op'], FlagName>> = {
  adv: 'ADVANTAGE', dis: 'DISADVANTAGE', crit: 'CRIT',
}

/** What a rider contributes. A `manual` rider contributes its ROLLED faces, not
 *  its formula — the formula is what it shows before the player answers. */
export function riderValue(r: Rider): number {
  if (r.op !== 'add') return 0
  if (r.when === 'manual') return r.rolled ? faceSum(r) + r.flat : 0
  return r.flat
}

const faceSum = (r: Rider) => (r.rolledDice ?? []).reduce((a, b) => a + b.v, 0)

/** What a rider contributes, as TEXT. Separate from riderValue because a dice
 *  contribution has no number here: `1d6` is rolled by the roller and folded into
 *  the line's modifier, so the rider itself carries an unrolled expression and a
 *  flat of zero. Printing riderValue() for it says "+0", which is the one thing
 *  it definitely is not.
 *
 *  Shared with the toast, which had its own correct copy while the panel had an
 *  incorrect one — two implementations of the same sentence, and the wrong one
 *  was on the surface that exists to be trusted. */
export function riderAmount(r: Rider): string {
  if (r.op !== 'add') return r.op.toUpperCase()
  // Unanswered: the FORMULA, never a value. §7 — a number shown before the
  // player decides puts a thumb on the decision.
  if (r.when === 'manual' && !r.rolled) return r.formula || '—'
  if (r.when === 'manual') return signed(String(riderValue(r)))
  // Rolled by the roller (§49): the faces are on the rider, so say what came up
  // rather than what could. "+1d6" is a promise; "+4" is a number the player can
  // check against the line above.
  if (r.rolledDice?.length) return signed(String(faceSum(r) + r.flat))
  const dice = r.dice.join(' + ')
  if (dice && r.flat) return `${signed(dice)} ${r.flat > 0 ? '+' : '−'} ${Math.abs(r.flat)}`
  if (dice) return signed(dice)
  return signed(String(r.flat))
}

/** Dice terms carry their own sign ("-1d4"); everything else needs one. */
const signed = (s: string) => (s.startsWith('-') || s.startsWith('−') || s.startsWith('+') ? s : `+${s}`)

export function riderViews(entry: RollEntry): RiderView[] {
  const out: RiderView[] = []
  let i = 0
  for (const g of entry.riderGroups ?? []) {
    for (const rider of g.riders) {
      const kind = rider.op === 'add' ? 'value' as const
        : rider.op === 'note' ? 'note' as const
        : 'flag' as const
      // A flag and a note both settle the moment they are switched on — there is
      // nothing left to roll. Only a value rider waits on dice.
      const live = rider.when !== 'manual'
        ? true
        : rider.on && (kind !== 'value' || !!rider.rolled)
      out.push({ rider, index: i++, group: g.label, kind, grants: FLAG[rider.op], live, value: riderValue(rider) })
    }
  }
  return out
}

export const resolvedOf = (v: RiderView[]) => v.filter(r => r.rider.when !== 'manual')
export const unresolvedOf = (v: RiderView[]) => v.filter(r => r.rider.when === 'manual')

/* ---------- what "unresolved" means, once ---------- */

/** The count of things on one roll that still want the player.
 *
 *  ONE DEFINITION FOR THREE SURFACES: the toast's "2 unresolved · open panel"
 *  line, the nav badge's number, and the panel itself. Three answers to "how many
 *  things need me" is how a badge ends up pulsing at nothing, so the arithmetic
 *  lives here with the rest of the read-model rather than in whichever component
 *  asked first.
 *
 *  SEEING THE PANEL SETTLES ALL OF IT (`acked`), asks included — and that is the
 *  correction that matters. An unanswered ask looks like a decision still owed,
 *  but LEAVING A TOGGLE OFF IS AN ANSWER: the attack missed, so the feature did
 *  not apply, and the player is done. Counting that as outstanding would pulse
 *  the badge for the rest of the session at someone who already dealt with it —
 *  which is the failure the badge exists to avoid, not an edge case.
 *
 *  The two kinds are still counted apart because the toast words them
 *  differently, not because they dismiss differently. */
export type Pending = {
  /** Unanswered `ask` riders. Actionable — resolvable by answering. */
  asks: number
  /** `err` problems: a formula that resolved to nothing at these values.
   *  Informational — zeroed by `acked`. */
  problems: number
  total: number
}

export function pendingOf(entry: RollEntry): Pending {
  if (entry.acked) return { asks: 0, problems: 0, total: 0 }
  const asks = unresolvedOf(riderViews(entry)).filter(v => !v.rider.on).length
  /* `err` ONLY. An AuditItem can be 'ok' or 'warn', and counting an authoring
     note as something the player must deal with is the badge lying about the
     roll — the same filter the panel makes for the same reason. */
  const problems = (entry.problems ?? []).filter(p => p.sev === 'err').length
  /* A TURN TICK WOULD BELONG HERE. There is no such mechanic yet — `duration` on
     an item or an active effect is a free-text reminder ("10 rounds") that
     nothing counts down — so this contributes nothing today. When something does
     tick, it is one more line here and all three surfaces pick it up unchanged. */
  return { asks, problems, total: asks + problems }
}

/** Everything still waiting, across the whole log. What the nav badge counts:
 *  "2" has to mean two things need you, not two rolls happened. */
export const pendingTotal = (rolls: RollEntry[]) =>
  rolls.reduce((n, r) => n + pendingOf(r).total, 0)

/** The d20 line for a check or an attack: both dice, the loser struck through. */
function d20Line(
  kind: 'attack' | 'check', label: string,
  rolls: RolledDie[], pick: number, mods: number, modParts: CheckTerm[],
  mode: 'normal' | 'adv' | 'dis', crit: boolean,
): RollLineView {
  // Mark exactly ONE die as kept, even when both show the same face — otherwise
  // a double 17 under advantage renders as two dropped dice and no winner.
  let kept = false
  const list: Die[] = rolls.map(d => {
    const isPick = !kept && d.v === pick
    if (isPick) kept = true
    return { ...d, dropped: rolls.length > 1 && !isPick }
  })
  return {
    kind, label, formula: rolls.length > 1 ? '2d20' : 'd20', dice: list,
    mode: mode === 'normal' ? undefined : mode,
    mods, modParts: modParts.filter(t => t.value !== 0), crit, total: pick + mods,
  }
}

export function lineViews(entry: RollEntry): RollLineView[] {
  const out: RollLineView[] = []

  // A save DC leads, because it occupies the slot an attack roll would: it is
  // the number the roll is ABOUT. Dice-less on purpose — the caster does not
  // roll it — which the math line already renders as "15 = 15" rather than
  // "+ 15 = 15".
  if (entry.saveDC !== undefined) {
    const label = entry.saveAbility ? `${ABILITY_ABBR[entry.saveAbility].toUpperCase()} Save DC` : 'Save DC'
    out.push({
      kind: 'check', label, formula: '', dice: [],
      mods: entry.saveDC, modParts: [], total: entry.saveDC, totalLabel: label,
    })
  }

  const a = entry.attack
  if (a) {
    const rolls = a.rolls ?? [{ v: a.d20, sides: 20 }]
    out.push(d20Line('attack', 'Attack', rolls, a.d20, a.bonus, a.terms ?? [], a.mode ?? 'normal', a.crit))
  }

  const d = entry.damage
  if (d) {
    out.push({
      kind: 'damage', label: 'Damage', formula: d.diceExpr,
      dice: d.dice, mods: d.bonus, modParts: (d.terms ?? []).filter(t => t.value !== 0), type: d.type,
      crit: d.crit, total: damageTotal(d.dice, d.bonus),
    })
  }

  const c = entry.check
  if (c) {
    const mods = c.total - c.pick
    out.push(d20Line('check', entry.kind === 'save' ? 'Save' : 'Check', c.rolls, c.pick, mods, c.terms ?? [], c.mode, c.crit))
  }
  return out
}

/* ---------------- reroll ----------------
 *
 * One die, rerolled in place, and every number above it moves. Totals are stored
 * on the roll (they were computed when it happened), so this recomputes the ones
 * the die feeds and returns them as a patch — the log stays the single writer.
 *
 * WHAT IT DELIBERATELY DOES NOT TOUCH: `crit` and `fumble`. The crit already
 * decided how many damage dice exist; un-deciding it from a rerolled d20 would
 * leave a doubled damage roll attached to a hit that is no longer a crit. The
 * mockup freezes them at roll time for the same reason. */

const damageTotal = (dice: RolledDie[], bonus: number) =>
  Math.max(0, dice.reduce((a, b) => a + b.v, 0) + bonus)

/** Which die the panel is pointing at — `line` indexes lineViews().
 *
 *  A rider's dice are deliberately NOT addressable: they only ever exist once
 *  the rider is locked, and a locked value is settled (§8 #2). That is also why
 *  the mockup's own reroll handler skips them. */
export type DieAddr = { line: number; die: number }

const pickOf = (rolls: RolledDie[], mode: 'normal' | 'adv' | 'dis') => {
  const faces = rolls.map(d => d.v)
  return mode === 'adv' ? Math.max(...faces) : mode === 'dis' ? Math.min(...faces) : faces[0]
}

/** Reroll one die and return the entry patch, or null if that die cannot be
 *  rerolled — a dropped die never counted, and a locked rider's value is settled
 *  (§8 #2). Pure: it rolls, but it does not write. */
export function rerollAt(entry: RollEntry, addr: DieAddr): Partial<RollEntry> | null {
  const line = lineViews(entry)[addr.line]
  const die = line?.dice[addr.die]
  if (!die || die.dropped) return null
  const roll = (list: RolledDie[]) => list.map((d, k) => (k === addr.die ? rerollDie(d) : d))

  if (line.kind === 'damage' && entry.damage) {
    const dice = roll(entry.damage.dice)
    return { damage: { ...entry.damage, dice, total: damageTotal(dice, entry.damage.bonus) } }
  }
  if (line.kind === 'attack' && entry.attack) {
    const rolls = roll(entry.attack.rolls ?? [])
    const d20 = pickOf(rolls, entry.attack.mode ?? 'normal')
    return { attack: { ...entry.attack, rolls, d20, total: d20 + entry.attack.bonus } }
  }
  if (line.kind === 'check' && entry.check) {
    const rolls = roll(entry.check.rolls)
    const pick = pickOf(rolls, entry.check.mode)
    return { check: { ...entry.check, rolls, pick, total: pick + line.mods } }
  }
  return null
}

/* ---------------- the catalog sheet ----------------
 *
 * WHY THIS READS THE CHARACTER AND NOT A CATALOG TABLE: every catalog
 * (`item_catalog`, `spell_catalog`, `feature_catalog`, `effect_catalog`) is
 * DM-only — checked across all 13 migrations, none of them carries a player
 * policy. A player's client gets zero rows. So the sheet reads the snapshots on
 * their own character row, which is the pattern the rest of the app already
 * uses: "the player never reads the effect catalog, so this is the one copy
 * their Effects panel has."
 *
 * A subject that is no longer active resolves to null — gear unequipped, a
 * feature removed since the roll. The panel says so rather than drawing a blank
 * sheet. */
export type CatalogView = {
  name: string
  /** The line under the name — "Martial Weapon · Two-Handed". */
  kind: string
  icon: string
  /** Second half of that line, when there is one (a spell's school). */
  school?: string
  stats: [string, string][]
  damage: [string, string][]
  /** Markdown; rendered with the app's own Prose. */
  desc: string
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const joinKind = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(' · ')

export function catalogView(
  character: CharacterRow | null,
  subject: RollEntry['subject'],
  shardTrees: Record<string, ShardTree> = {},
): CatalogView | null {
  if (!character || !subject) return null
  const src = activeSources(character, shardTrees)
    .find(s => s.kind === subject.kind && (s.obj as { id?: string }).id === subject.id)
  if (!src) return null

  if (src.kind === 'weapon') {
    const w = src.obj
    return {
      name: w.name, icon: w.icon ?? 'fa-khanda',
      kind: joinKind(w.rarity && cap(w.rarity), 'Weapon', ...(w.properties ?? [])),
      stats: [
        ['Hand', w.hand === 'main' ? 'Main Hand' : w.hand === 'off' ? 'Off Hand' : 'Equipped'],
        ['Ability', (w.ability ?? 'str').toUpperCase()],
        ...(w.weight ? [['Weight', `${w.weight} lb`] as [string, string]] : []),
        ...(w.rows ?? []),
      ],
      damage: w.damageDice ? [[w.damageDice, w.type ?? '—']] : [],
      desc: w.flavor ?? '',
    }
  }
  if (src.kind === 'feature') {
    const f = src.obj
    return {
      name: f.name, icon: f.icon ?? 'fa-star',
      kind: joinKind(f.kind && cap(f.kind), f.source, f.level ? `Level ${f.level}` : undefined),
      stats: [
        ...(f.usage ? [['Usage', f.usage] as [string, string]] : []),
        ...(f.uses ? [['Uses', `${f.uses.current} / ${f.uses.max}`] as [string, string]] : []),
        ...(f.rows ?? []),
      ],
      damage: [],
      desc: [f.light_description ?? f.summary, f.deep_description ?? f.description]
        .filter(Boolean).join('\n\n'),
    }
  }
  if (src.kind === 'spell') {
    const s = src.obj
    return {
      name: s.name, icon: s.icon ?? 'fa-wand-sparkles', school: cap(s.school),
      kind: s.level === 0 ? 'Cantrip · Level 0' : `Level ${s.level}`,
      stats: [
        ['Casting Time', s.castingTime], ['Range', s.range], ['Duration', s.duration],
        ['Components', [s.v && 'V', s.s && 'S', s.m && 'M'].filter(Boolean).join(', ') || '—'],
      ],
      damage: s.hasDamage && s.dice ? [[s.dice, s.dmgType ?? '—']] : [],
      desc: s.desc,
    }
  }
  if (src.kind === 'item') {
    const it = src.obj
    return {
      name: it.name, icon: it.icon ?? 'fa-cube',
      kind: joinKind(it.rarity && cap(it.rarity), it.category && cap(it.category), it.attune),
      stats: [
        ...(it.weight ? [['Weight', `${it.weight} lb`] as [string, string]] : []),
        ...(it.rows ?? []),
      ],
      damage: [],
      desc: it.flavor ?? '',
    }
  }
  return null
}

export type RollTotals = {
  attack?: number
  damage?: number
  /** Damage split by type. One entry today; spells bring more. */
  byType: Record<string, number>
  flags: FlagName[]
  /** Unresolved riders the player has not settled — the "still waiting on you" note. */
  pending: number
}

export function rollTotals(entry: RollEntry, views: RiderView[]): RollTotals {
  const lines = lineViews(entry)
  const attackLine = lines.find(l => l.kind === 'attack' || l.kind === 'check')
  const byType: Record<string, number> = {}
  for (const l of lines.filter(x => x.kind === 'damage')) {
    byType[l.type ?? 'damage'] = (byType[l.type ?? 'damage'] ?? 0) + l.total
  }

  let attack = attackLine?.total
  const flags: FlagName[] = []
  for (const v of views) {
    if (!v.live) continue
    if (v.kind === 'flag') {
      if (v.grants && !flags.includes(v.grants)) flags.push(v.grants)
      continue
    }
    // The PANEL half of §49's split, and the mirror of total()'s: the roller
    // folded in every rider that is not `manual`, so those are already inside
    // the line's modifier and adding them again doubles them. A `manual` rider
    // is answered and rolled AFTER the roll, which is the whole reason this
    // panel can change a total at all.
    if (v.rider.when !== 'manual') continue
    if (v.group === 'Attack' || v.group === 'Check' || v.group === 'Save') {
      if (attack !== undefined) attack += v.value
    } else {
      const t = v.rider.dmgType ?? entry.damage?.type ?? 'damage'
      byType[t] = (byType[t] ?? 0) + v.value
    }
  }

  const damageKeys = Object.keys(byType)
  return {
    attack,
    damage: damageKeys.length ? Object.values(byType).reduce((a, b) => a + b, 0) : undefined,
    byType,
    flags,
    pending: unresolvedOf(views).filter(v => !v.live).length,
  }
}
