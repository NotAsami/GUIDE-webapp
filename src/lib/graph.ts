/**
 * The variable DAG — the first half of the feature graph engine.
 *
 * Variables are declared ON the node that introduces them (`vars?: VarDef[]` on
 * Feature / Spell / EquippedItem / ShardNode), so scoping falls out of
 * effects.ts activeSources() for free: an unequipped item's variables stop
 * existing exactly as its features do.
 *
 * TWO DAGs, and the boundary between them is the whole design:
 *
 *   > Variables never read roll contributions. Contributions never read
 *   > contributions. Variables read only variables and character state.
 *
 * Enforcement is by grammar and costs nothing: a contribution has no name, and
 * the scope handed to evalExpr here never contains roll context, so a variable
 * formula reading `cast` is rejected by the same lookup that rejects a typo. If
 * a variable could read `cast`, this whole module would stop being a function of
 * character state and become a function of one particular roll.
 *
 * Output is an ExprScope — exactly what lib/expr.ts consumes. The two halves
 * meet at `Record<string, number | boolean>`, which is also VarDef.type's
 * `'num' | 'bool'`. One representation, no adapter.
 */

import type { ArmedMod, CharacterRow, GraphEffect, GraphOp, GraphState, ShardTree, VarDef } from './database.types.ts'
import type { ExprScope, FormulaValue } from './expr.ts'
import { ROLL_IDENTS, VAR_IDENTS, evalExpr, freeIdents, interpolate, interpolations } from './expr.ts'
import { type ActiveSource, activeEffects, activeSources, effectiveSheet } from './effects.ts'
import { IS_ACTIVATION, IS_SHEET, OPS, OP_TITLE } from './opSchema.ts'
import { MOD_STAT_SET, isAbility } from './modEditor.ts'
import { abilities, abilityMod, proficiency } from './dnd.ts'
/* No cycle: featureView imports only database.types, opSchema and expr. */
import { usesOf } from './featureView.ts'
import { rolledDiceTerms, type RolledDie } from './dice.ts'

/** Lifted from ShardLattice.tsx so the engine and the lattice editor share one
 *  audit vocabulary rather than growing two. `t` is the title, `s` the sentence,
 *  `id` the offending node (null for findings with no single owner). */
export type AuditSev = 'err' | 'warn' | 'ok'
export type AuditItem = { sev: AuditSev; id: string | null; t: string; s: string }

/** A declaration plus where it came from — collision reporting needs the source. */
export type VarBinding = { def: VarDef; from: ActiveSource }

const NAME_RE = /^[a-z][a-zA-Z0-9]*$/

/** The zero a character WITHOUT this variable reads. Not a guess — it reads the
 *  declared type, which is why `type` is required on stored variables. A `num`
 *  substituted for a `bool` would make `isMercy && x` a type error on exactly
 *  the characters who don't have the path. */
const zero = (t: 'num' | 'bool' | undefined) => (t === 'bool' ? false : 0)

const label = (d: VarDef) => d.label ?? d.name

/** The value a variable takes in the AUTHOR-TIME probe scope (§41). Type-correct
 *  like `zero`, but the numeric one is 1, not 0 — see probeScope. */
const probe = (t: 'num' | 'bool' | undefined) => (t === 'bool' ? false : 1)

/** One lazy memoized walk over derived variables: the memo IS the topological
 *  order and the visiting set IS the cycle check. A cycle degrades to a dropped
 *  variable, never a hung tab.
 *
 *  Two callers — characterVars binds real values, probeScope binds type probes —
 *  so the traversal exists once and cannot drift between runtime and author time.
 *  `bind` returns null to reject a value the scope cannot hold. */
function walkDerived(
  defs: Iterable<VarDef>,
  scope: ExprScope,
  bind: (v: FormulaValue) => number | boolean | null,
  audit?: AuditItem[],
): void {
  const byName = new Map<string, VarDef>()
  for (const d of defs) if (!byName.has(d.name)) byName.set(d.name, d)
  const visiting = new Set<string>()
  const failed = new Set<string>()

  function resolve(name: string): void {
    if (name in scope || failed.has(name)) return
    const def = byName.get(name)
    if (!def || def.kind !== 'derived') return // not ours; evalExpr will reject it
    if (visiting.has(name)) {
      failed.add(name)
      audit?.push({ sev: 'err', id: name, t: 'Variable cycle', s: `${label(def)} depends on itself. It resolves to nothing until the loop is broken.` })
      return
    }
    visiting.add(name)
    const formula = def.formula ?? ''
    for (const dep of freeIdents(formula)) resolve(dep)
    visiting.delete(name)
    if (failed.has(name)) return

    const v = evalExpr(formula, scope)
    const bound = v === null ? null : bind(v)
    if (bound === null) {
      failed.add(name)
      audit?.push({ sev: 'err', id: name, t: 'Variable did not resolve', s: `${label(def)} = "${formula}" produced no usable value at these values.` })
      return
    }
    scope[name] = bound
  }

  for (const name of byName.keys()) resolve(name)
}

/** The scope the AUDIT evaluates formulas against — type-correct and NON-ZERO.
 *
 *  §39 left this open and named half the problem. Both halves matter, because a
 *  scope of all-zeros produces blocking errors on legal content:
 *
 *    x / mercy            → 0 / 0 → rejected on EVERY character
 *    isRaging && hasCharge → both bind to the NUMBER 0 → type error
 *
 *  Types come from the declarations, which is the reason `VarDef.type` is
 *  required at all (§30) — an audit that discards it re-introduces the error the
 *  field exists to prevent. The numeric probe is 1 rather than 0 so that a
 *  LITERAL division by zero (`5 / 0`, wrong in every scope) still blocks, while a
 *  division by a VARIABLE stops being reported here — it is not knowable at
 *  author time, and §40 already built the runtime answer for it in
 *  `Resolution.problems`. Author time and roll time now cover disjoint cases
 *  instead of the former swallowing content it cannot judge. */
export function probeScope(
  defs: VarDef[] = [],
  audit?: AuditItem[],
  /** Variables declared ELSEWHERE in the catalog, name -> type.
   *
   *  SEEDED HERE rather than by each caller, because a caller that forgot is
   *  exactly the bug this argument exists to end: the Feature Editor checked
   *  "max uses reads a name nothing declares" against a whitelist that INCLUDED
   *  the catalog and "max uses evaluates" against a scope that did not — so
   *  Rage's `rages`, declared on the class, passed the first and failed the
   *  second, and the feature could not be saved.
   *
   *  Seeded UNDER the node's own declarations, never over them: a local variable
   *  of the same name is the one this node reads, and letting the catalog win
   *  would type-check the author's formula against somebody else's variable. */
  catalogTypes: Record<string, 'num' | 'bool'> = {},
): ExprScope {
  const scope: ExprScope = {}
  for (const k of VAR_IDENTS) scope[k] = 1
  for (const k of ROLL_IDENTS) scope[k] = 1
  for (const d of defs) if (d.kind === 'stored') scope[d.name] = probe(d.type)
  /* A use-counter variable is a number the author cannot be shown at author time
     — it depends on the character — so it probes like any other. Bound BEFORE
     the derived walk here only so that a formula reading one is a known
     identifier rather than an unknown one; auditVars is what refuses it, with
     the reason, instead of letting the walk report "unknown". */
  for (const d of defs) if (d.kind === 'derived' && d.uses) scope[d.name] = 1

  // Only the derived variable's TYPE is wanted, never its probe value: binding
  // the computed number would let `level - 1` reintroduce the zero this exists
  // to avoid.
  walkDerived(defs, scope, v => (v.t === 'arr' ? null : v.t === 'bool' ? false : 1), audit)

  // A derived variable that did not resolve still needs a binding, or every
  // reference to it reads as an unknown identifier and the error lands on the
  // reader instead of the declaration.
  for (const d of defs) if (!(d.name in scope)) scope[d.name] = probe(d.type)
  for (const [name, t] of Object.entries(catalogTypes)) {
    if (!(name in scope)) scope[name] = probe(t)
  }
  return scope
}

/** Declarations on one active source. `shard` (the tree) and `effect` (a potion)
 *  carry no `vars` — §12 refuses a tree-level graph, and an applied effect is a
 *  snapshot with nowhere to hang state. */
function declsOf(s: ActiveSource): VarDef[] {
  return 'vars' in s.obj ? s.obj.vars ?? [] : []
}

/* ---------- collection ---------- */

/** Declared variables on the active set, FIRST WINS on a duplicate name.
 *  activeSources() order — sheet features → gear → shards → spells — is what
 *  makes that deterministic: behaviour stays stable while it is broken, and the
 *  collision surfaces as an error rather than silently last-writer-winning. */
export function collectVars(sources: ActiveSource[]): Map<string, VarBinding> {
  const out = new Map<string, VarBinding>()
  for (const from of sources) {
    for (const def of declsOf(from)) {
      if (!out.has(def.name)) out.set(def.name, { def, from })
    }
  }
  return out
}

/* ---------- character state (the base whitelist) ---------- */

/** The non-variable half of a variable formula's scope. Its keys are exactly
 *  VAR_IDENTS — graph.test.ts pins that, so the whitelist and its values cannot
 *  drift apart.
 *
 *  Ability modifiers and hpMax come off the EFFECTIVE sheet so gear and shard
 *  boosts flow through; `hp` is the base current, which effectiveSheet never
 *  touches. */
export function baseScope(character: CharacterRow, shardTrees: Record<string, ShardTree> = {}): ExprScope {
  const view = effectiveSheet(character, shardTrees)
  const ab = abilities(view)
  return {
    level: character.identity?.level ?? 1,
    prof: proficiency(view),
    str: abilityMod(ab.str), dex: abilityMod(ab.dex), con: abilityMod(ab.con),
    int: abilityMod(ab.int), wis: abilityMod(ab.wis), cha: abilityMod(ab.cha),
    /* The raw scores, beside their modifiers. Same source, so the two can never
       disagree about a character. */
    strScore: ab.str, dexScore: ab.dex, conScore: ab.con,
    intScore: ab.int, wisScore: ab.wis, chaScore: ab.cha,
    hp: character.sheet?.hp?.current ?? 0,
    hpMax: view.hp?.max ?? character.sheet?.hp?.max ?? 0,
    /* The spell save DC the character IMPOSES. Read from the spellbook rather
       than recomputed, because which ability backs it is the DM's answer and it
       is already stored beside `attackBonus` — deriving it here would be a second
       answer to a question the spellbook has already settled. Prose reaches it as
       `{saveDc}`, which is what asked for it. */
    saveDc: character.spellbook?.saveDC ?? 0,
    /* Read straight off the store rather than through storedValue: this is not
       an authored variable and has no VarDef to carry an initial. */
    attacksThisTurn:
      ((character.resources as { graph?: GraphState } | undefined)?.graph?.attacks) ?? 0,
  }
}

/** Stored values, split by who may write them. The split is a LOCATION, not a
 *  flag: Postgres RLS is row-level and cannot permit writing
 *  `resources.graph.vars.karmicReserve` while refusing `…dmVars.mercy`, so the
 *  permission is which bucket the value lives in. */
function storedValue(def: VarDef, state: GraphState): number | boolean {
  const bucket = def.scope === 'dm' ? state.dmVars : state.vars
  return bucket?.[def.name] ?? def.initial ?? zero(def.type)
}

/* ---------- evaluation ---------- */

/** Every variable's settled value, ready to hand straight to evalExpr as its
 *  scope. Derived variables are computed here and NEVER stored — same discipline
 *  as a shard slot's `spent` and a spellbook's prepared count.
 *
 *  `catalogTypes` supplies the declared type of variables that exist in the
 *  CATALOG but are not on this character, so a formula referencing one reads the
 *  type's zero instead of failing. Omit it and those names read as unknown
 *  identifiers instead — degrades safely, same contract as effects.ts's optional
 *  `shardTrees`.
 *
 *  ponytail: rebuilt per call, like activeSources() below it. Memoize per
 *  character row when the resolver lands and makes the cost visible. */
export function characterVars(
  character: CharacterRow,
  shardTrees: Record<string, ShardTree> = {},
  catalogTypes: Record<string, 'num' | 'bool'> = {},
): { scope: ExprScope; audit: AuditItem[] } {
  const sources = activeSources(character, shardTrees)
  const bindings = collectVars(sources)
  const state = ((character.resources as { graph?: GraphState } | undefined)?.graph ?? {}) as GraphState

  const audit: AuditItem[] = varCollisions(
    sources.flatMap(from => declsOf(from).map(def => ({ name: def.name, from: from.obj.name }))),
    'err',
  )

  const scope: ExprScope = baseScope(character, shardTrees)

  // Declared in the catalog but not active here: the type's zero, so a character
  // who was never granted the Arbiter path simply has no `mercy` rather than a
  // broken formula. The author-time check on undeclared names is what makes this
  // runtime default safe to be silent.
  for (const [name, t] of Object.entries(catalogTypes)) {
    if (!bindings.has(name) && !(name in scope)) scope[name] = zero(t)
  }

  for (const { def } of bindings.values()) {
    if (def.kind === 'stored') scope[def.name] = storedValue(def, state)
  }

  // The shared walk (see walkDerived): here it binds the real computed value.
  // A variable carrying dice or an array has no scalar to store, so it fails.
  walkDerived(
    [...bindings.values()].map(b => b.def),
    scope,
    // A variable is num or bool (§30). An array, an unrolled dice term, or §25's
    // display-only string are all "not a value this can store".
    v => (v.t === 'arr' || v.t === 'str' || (v.t === 'num' && v.dice.length) ? null : v.t === 'bool' ? v.v : v.flat),
    audit,
  )

  /* USE COUNTERS, LAST. A counter's ceiling is itself a formula (Rage's max is
     `rages`, off the class carrier), so resolving one needs the scope the walk
     above has only just finished producing — which is why a derived variable
     cannot read one and auditVars says so. Everything that runs against the
     FINISHED scope can: a `when`, a contribution, an activation, a note.

     A feature that is not on the sheet reads 0 rather than going missing, the
     same silence catalogTypes buys one declared elsewhere: "how many Rages have
     I got" on a character who was never granted Rage is none, not an error. */
  for (const { def } of bindings.values()) {
    if (def.kind !== 'derived' || !def.uses) continue
    const target = (character.sheet?.features ?? []).find(f => gid('feature', f) === def.uses)
    scope[def.name] = (target && usesOf(target, scope)?.current) ?? 0
  }

  return { scope, audit }
}

/* ---------- audit ---------- */

/** Duplicate declarations of one name. The namespace is flat and global per
 *  character, knowingly — namespacing per source would cost exactly the
 *  authoring ergonomics variables exist to buy. The price is paid in two phases:
 *  two CATALOG entries declaring `charges` is a warn (they may be mutually
 *  exclusive content that never coexists on one character), two ACTIVE entries
 *  is an error, because now it is real. */
export function varCollisions(decls: { name: string; from: string }[], sev: 'warn' | 'err'): AuditItem[] {
  const seen = new Map<string, string[]>()
  for (const d of decls) seen.set(d.name, [...(seen.get(d.name) ?? []), d.from])

  const out: AuditItem[] = []
  for (const [name, froms] of seen) {
    if (froms.length < 2) continue
    out.push({
      sev, id: name, t: 'Duplicate variable',
      s: `${name} is declared by ${froms.join(' and ')}. The first declaration wins.`,
    })
  }
  return out
}

/** Author-time checks on declarations alone — no character needed. Everything
 *  here is catchable when the DM saves the node, which is the entire reason the
 *  runtime defaults above are allowed to be silent. */
export function auditVars(defs: VarDef[]): AuditItem[] {
  const out: AuditItem[] = []
  const declared = new Set(defs.map(d => d.name))
  // Which of them read a feature's use counter — see the rule below.
  const usesVars = new Set(defs.filter(d => d.kind === 'derived' && d.uses).map(d => d.name))

  for (const d of defs) {
    if (!NAME_RE.test(d.name)) {
      out.push({ sev: 'err', id: d.name, t: 'Bad variable name', s: `"${d.name}" must start with a lowercase letter and contain only letters and digits.` })
    }
    if (d.kind === 'stored') {
      if (!d.type) {
        out.push({ sev: 'err', id: d.name, t: 'Missing type', s: `${label(d)} is stored, so it must declare num or bool — it is what a character without this variable reads.` })
      } else if (d.initial !== undefined && typeof d.initial !== (d.type === 'bool' ? 'boolean' : 'number')) {
        out.push({ sev: 'err', id: d.name, t: 'Initial disagrees with type', s: `${label(d)} is ${d.type} but its initial value is ${typeof d.initial}.` })
      }
      if (d.formula) {
        out.push({ sev: 'err', id: d.name, t: 'Stored variable has a formula', s: `${label(d)} is stored — it is written, never computed. Make it derived or drop the formula.` })
      }
    } else if (d.uses) {
      // A use counter is READ, not computed: the two are alternatives, and a
      // variable carrying both says two different things about where its value
      // comes from.
      if (d.formula?.trim()) {
        out.push({ sev: 'err', id: d.name, t: 'Both a formula and a use counter', s: `${label(d)} reads a feature's uses AND has a formula. It can only have one source — drop whichever is not meant.` })
      }
      if (!d.uses.startsWith('feature:')) {
        out.push({ sev: 'err', id: d.name, t: 'Not a feature', s: `${label(d)} reads uses from "${d.uses}". Only a feature has a use counter.` })
      }
    } else {
      if (!d.formula) {
        out.push({ sev: 'err', id: d.name, t: 'Missing formula', s: `${label(d)} is derived, so it needs a formula or a feature to read uses from.` })
      }
      for (const id of freeIdents(d.formula ?? '')) {
        /* A DERIVED VARIABLE CANNOT READ A USE COUNTER, and this is the only
           place that can say so. Counters are bound after the derived walk (see
           characterVars) because resolving one needs the finished scope, so a
           formula reading one would silently see zero — a wrong number with no
           error, on content that looks perfectly reasonable. */
        if (usesVars.has(id)) {
          out.push({ sev: 'err', id: d.name, t: 'A derived variable cannot read a use counter', s: `${label(d)} reads "${id}", which is a feature's use count. Those are resolved after every derived variable — a formula would read zero. Put the condition on the effect's when instead, where it works.` })
          continue
        }
        if (declared.has(id) || (VAR_IDENTS as readonly string[]).includes(id)) continue
        out.push({ sev: 'err', id: d.name, t: 'Unknown identifier', s: `${label(d)} reads "${id}", which no variable declares and the character state whitelist does not contain.` })
      }
    }
  }

  // Cycles are catchable here, from the declarations alone. Without this a
  // self-referential variable saves clean and breaks at the table, where
  // characterVars reports it to nobody who can fix it.
  probeScope(defs, out)
  return out
}

/* ==========================================================================
 * The contribution graph — the second half.
 *
 * Identity is NOMINAL, not structural: a reference names its target and does not
 * care which source it came from, so a shard feature retyping a spell works the
 * same whether that spell arrived from an import or from homebrew. Targets
 * resolve at READ time, so a `tag:fire` effect written today already covers the
 * forty fire spells an import lands tomorrow.
 * ========================================================================== */

export type GidKind = 'feature' | 'spell' | 'item' | 'weapon' | 'shardnode'
export type Gid = `${GidKind}:${string}`

type GidSource = { feature_id?: string; spell_id?: string; item_id?: string; id?: string }

/** Stable graph id. Reads the CATALOG back-ref first, falling back to the
 *  instance id for hand-seeded content that predates the catalogs.
 *
 *  The back-ref-first order is load-bearing, not a preference: gearFeatures() and
 *  shardFeatures() both REWRITE `id` when they derive a granted feature
 *  (`gear-<item>-<n>`, `shard-<slot>-<node>-<n>`) so React keys can't collide.
 *  Keying the graph off `id` would give the same feature a different identity
 *  depending on which item granted it. */
export function gid(kind: GidKind, x: GidSource): Gid {
  return `${kind}:${x.feature_id ?? x.spell_id ?? x.item_id ?? x.id ?? ''}`
}

/** A shard node has no catalog back-ref, and its id is unique only WITHIN a tree
 *  — installShard() seeds every shard with a node called `core`, so two slotted
 *  shards would otherwise share one gid. Qualifying by shard id costs nothing and
 *  needs no schema change. */
export function nodeGid(shardId: string, nodeId: string): Gid {
  return `shardnode:${shardId}.${nodeId}`
}

/** Free-text tags fragment silently — `radiant` / `Radiant` / `radient` all look
 *  correct and match nothing. One normalisation, shared by the matcher and (from
 *  the editor slice) by the input that writes them; if they ever disagree,
 *  targeting fails with no error at all. Matches the effect form's existing rule. */
export function normalizeTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '_')
}

/** The identity of an `ask`, for grouping. §32 makes effects sharing one ask into
 *  ONE checkbox, which means the sentence is a KEY as well as prose — and a key
 *  compared byte-for-byte fragments exactly the way free-text tags do. A trailing
 *  space, a capital, a double space between words: two toggles for one decision,
 *  looking identical on screen.
 *
 *  Only the key is normalised. The rider still carries the authored text
 *  verbatim, because that is what the player reads. */
export const askKey = (raw: string): string => raw.trim().toLowerCase().replace(/\s+/g, ' ')

/** The ops whose target names a DAMAGE KIND rather than a roll. They never reach
 *  a Resolution — see damageFlags(). */
const DAMAGE_FLAGS: GraphOp[] = ['resist', 'vuln', 'immune']

/** The formula a level table yields at this character level, or undefined when
 *  there is no table. Sugar for `[…][level]`, with two rules that make it match
 *  how 5e progressions are actually written:
 *
 *  - SPARSE means STEP. A table filled at 1/5/11 reads "3 from level 11 up", so
 *    an empty slot walks DOWN to the last filled one rather than contributing
 *    nothing. Requiring all twenty to be filled would be the same table typed
 *    out four times.
 *  - Out of range clamps to the nearest end, matching array indexing — level 21
 *    is not an error.
 *
 *  Index 0 is skipped on purpose: character levels start at 1, and putting that
 *  off-by-one in one place beats living with it in every authored expression.
 *
 *  EXPORTED because resolve() is not the only reader. An `once` contribution
 *  never passes through here — it is armed by graphState.ts armedFrom(), which
 *  snapshots the value onto the ArmedMod — so a level table on an armed effect
 *  silently produced the level-1 value forever. Brutal Strike's 1d10 stayed 1d10
 *  at level 17. One table, one reader. */
export function levelFormula(eff: GraphEffect, level: number | boolean | undefined): string | undefined {
  const arr = eff.byLevel
  if (!arr?.some((x, i) => i > 0 && String(x ?? '').trim())) return undefined
  const lvl = typeof level === 'number' ? level : 1
  const start = Math.min(Math.max(1, Math.round(lvl)), arr.length - 1)
  for (let i = start; i >= 1; i--) {
    const cell = String(arr[i] ?? '').trim()
    if (cell) return cell
  }
  // Below the first filled slot: the feature has not come online yet.
  return '0'
}

export type RollKind = 'attack' | 'damage' | 'save' | 'check' | 'feature'

export type ResolveReq = {
  kind: RollKind
  /** Sub-key: 'dex' for a save, 'investigation' for a check. */
  sub?: string
  /** The gid of the thing being rolled — a weapon, spell, or feature. */
  subject?: Gid
  /** The subject's tags, so `tag:` selectors match. */
  tags?: string[]
  /** ATTACKS ONLY: which ability the attack actually used, so
   *  `roll:attack.str` can mean "Strength-based attacks" — Reckless Attack's
   *  whole condition.
   *
   *  A SIBLING OF `sub`, not a value inside it. `sub` already carries
   *  melee/ranged/spell and is one string; folding the ability in would make
   *  `attack.melee` and `attack.str` mutually exclusive when a greataxe swing
   *  is honestly both. Both become match keys, and the target list is an OR, so
   *  an author can narrow by either without the other going quiet. */
  ability?: string
}

export type Rider = {
  label: string
  source: string
  /** The source's gid, so the Roll Context Panel's catalog sheet can LINK to it
   *  instead of naming it and stopping there. `source` above is deliberately a
   *  bare display name; this is the identity beside it.
   *
   *  Only a `feature:` gid is navigable today — that is the one kind the
   *  Features screen can open (its byGid map) — but the gid is stored unfiltered
   *  so the panel decides, not the engine. */
  sourceGid?: Gid
  /** What this rider grants. A toggled `adv` is not a number, so the panel has to
   *  be told which it is — §13's shape carried flat/dice only. */
  op: GraphOp
  /** Shown when the player still has to decide. */
  formula: string
  /** THE contribution — §49 removed the Resolution-level copy, so this and
   *  `dice` are the only record of what this rider is worth. */
  flat: number
  /** UNROLLED — the caller rolls, so a crit can still double these. Once rolled,
   *  the faces land on `rolledDice` beside them. */
  dice: string[]
  when: 'always' | 'manual' | 'active'
  /** `active` and `always` riders arrive already resolved; `manual` ones start off. */
  on: boolean
  /** Set on a rider that came from the armed queue rather than from the graph.
   *  It is already applied — §8 #1 — and this is the handle the panel consumes
   *  it by. Consumed-ness is NOT stored here: the panel asks whether this id is
   *  still in `resources.graph.armed`, so one record answers it everywhere. */
  armedId?: string
  /** What answering YES reveals — §25 inline compute already applied. A `note`
   *  carrying an interpolation is the one prose shape a toggle earns its place
   *  on: the DC exists only if the hit landed, so it is shown only once the
   *  player says it did. Absent on every other rider. */
  reveal?: string
  /** The QUESTION, for a `manual` rider — the authored `ask` sentence, verbatim.
   *  It is prose ("at least one of them failed the save"), so it reads as prose
   *  under the rider's name rather than being crushed into the uppercased,
   *  letter-spaced name slot. */
  text?: string
  dmgType?: string
  /** The source's own card text, so the panel can answer "should this have
   *  applied?" without leaving the roll. `source` is a bare display NAME and a
   *  roll entry is not a catalog row, so without this the prose is unreachable
   *  from the panel — it lives on a DM-only table the player never reads. */
  sourceText?: string
  /** The operands a formula was built from, at the values it used. `formula`
   *  says `level + wis`; this says level was 7 and wis was +3.
   *
   *  Captured at resolve time because it CANNOT be recovered later: the scope is
   *  a snapshot of the character mid-roll, and by the time anything renders the
   *  log the values may have moved. Absent for a flat number or a bare die,
   *  which have no derivation worth showing. */
  parts?: { name: string; value: number }[]
  /** Set once the player has answered a `manual` rider and its dice were rolled.
   *  Written by the Roll Context Panel, never by resolve() — which keeps the
   *  engine pure and makes the lock trivial: once this is set the roll
   *  affordance is gone and toggling reuses the value, so reopening the panel
   *  can never re-roll (§8 #2). */
  rolled?: boolean
  /** EXCLUSIVE GROUP KEY. Riders sharing one are a pick-one: answering any of
   *  them declines the rest. Set on offered arms, keyed by the source that armed
   *  them — Brutal Strike's two blows are one choice between two, which the
   *  engine has always known (auditNode says so) and the panel could not say. */
  choice?: string
  /** HOW MANY of that group may be taken. Absent = one, which is what a pick-one
   *  has always been. Carried from the armed mod so the panel stops accepting
   *  clicks at the limit rather than after the first — Improved Brutal Strike
   *  (Enhanced) is "two different Brutal Strike effects" and nothing else. */
  picks?: number
  /** The faces that came up, once `rolled`. `dice` stays the unrolled formula.
   *  Full dice, not bare numbers: a chip that does not know it is a d4 cannot
   *  say whether a 4 was a maximum, and cannot be rerolled. */
  rolledDice?: RolledDie[]
}

export type Resolution = {
  adv: boolean
  dis: boolean
  crit: boolean
  /** The lowest this roll's TOTAL may come to, when a `floor` node applied one.
   *  Absent = no floor. HIGHEST wins — two features each guaranteeing a minimum
   *  both hold, so the better guarantee is the one in force. The mirror of
   *  `critFrom`, which takes the lowest. Applied by composeCheck, after every
   *  contribution, because a minimum on a total means nothing until the total
   *  exists. */
  floor?: number
  /** Lowest d20 face that crits, when a `crit` node applied one. Absent = 20.
   *  Lowest wins: Improved Critical (19) and a hypothetical 18 node give 18, not
   *  17 — a crit range is a threshold, not a bonus that stacks. */
  critFrom?: number
  /** EVERY contribution, and the only record of one.
   *
   *  There used to be a second: `flat`/`dice` held an "unconditional fold" that
   *  the `always` riders duplicated exactly. Two records of one fact do not stay
   *  in agreement — that pair produced the same double-count twice (§45 in
   *  total(), §48 in the panel's footer), each time fixed with a filter rather
   *  than a removal, and it made a rolled face impossible to attribute back to
   *  the contribution that owned it. See §49. */
  riders: Rider[]
  /** `note` ops — authored prose the player reads. */
  notes: string[]
  /** Engine failures. Deliberately NOT folded into `notes`: a formula that broke
   *  is not rule text, and rendering it as such would make it indistinguishable
   *  from something the DM wrote. */
  problems: AuditItem[]
}

type IndexedEffect = { eff: GraphEffect; from: ActiveSource; owner: Gid }

/** Built once per character load and reused across every roll. This is the memo
 *  the `ponytail:` comments in effects.ts and graph.ts have been deferring to —
 *  activeSources(), the variable scope and the edge index are all computed here,
 *  once, instead of per roll. */
export type GraphContext = {
  scope: ExprScope
  index: Map<string, IndexedEffect[]>
  byOwner: Map<Gid, IndexedEffect[]>
  problems: AuditItem[]
  /** §16's one-shot queue, as stored. Read here rather than passed per roll so
   *  every caller of resolve() gets it without opting in — an armed modifier the
   *  roller forgot to look up is a bonus the player was promised and did not
   *  get. */
  armed: ArmedMod[]
}

/** Does this armed modifier belong to this roll?
 *
 *  Exported because the pre-roll chips on the weapon and feature cards must give
 *  the SAME answer resolve() will — §16's visibility rule is worthless if the
 *  card promises a bonus the roll then does not apply. One predicate, three
 *  readers.
 *
 *  Deliberately not tag-matched, unlike a graph selector: an armed mod is minted
 *  by one activation naming one target, so it says what it hits rather than
 *  describing it. An absent `sub`/`subject` is a WIDER match ("the next attack"),
 *  not a narrower one. */
/**
 * Armed modifiers whose CONDITION has since gone false — the ones to drop when
 * a turn ends.
 *
 * Brutal Strike arms four mods, every one of them gated `when: reckless`. If
 * Reckless Attack lapses before the swing lands, those four are promises about
 * a state that no longer exists, and an arm that survives what authorised it is
 * a bonus the player will spend next turn believing they earned it.
 *
 * Only GATED arms are touched. A held smite with no `when` is a deliberate
 * decision to save something, and Advance Turn has no business spending it.
 * A source that has gone missing entirely (feature unequipped, item dropped) is
 * also left alone: an arm the player can still see and dismiss beats one that
 * vanishes without a line saying why.
 *
 * Pass the scope AFTER the turn's variable resets, or `reckless` is still true
 * and nothing is ever stale.
 */
export function staleArmed(ctx: GraphContext, scope: ExprScope = ctx.scope): string[] {
  const out: string[] = []
  for (const m of ctx.armed) {
    /* op + label is the address. `ArmedMod` records the owner gid, not the
       effect id, so this is what narrows a node's several ops down to the one
       that minted this mod — the same pair the breakdown shows the player. */
    const effs = (ctx.byOwner.get(m.source as Gid) ?? [])
      .filter(e => e.eff.op === m.op && e.eff.label === m.label)
    if (!effs.length) continue
    const live = effs.some(e => {
      /* AN UNGATED HOLD IS NOT A LEFTOVER. Held says every held thing has a
         deadline, and the stuck-arm incident made a turn deadline tempting —
         but that bug was a MATCH failure (see armedMatches), not a missing
         expiry, and it is fixed at the cause. An ungated hold still has a
         deadline: the next rest empties the queue. Confiscating a deliberately
         held smite at turn end would take a decision away from the player to
         solve a problem that is already solved. */
      if (e.eff.when === undefined) return true
      const cond = evalExpr(e.eff.when, scope)
      // Unresolvable reads as STILL LIVE. A condition the engine cannot answer
      // is the author's problem to see in the audit, not a reason to silently
      // confiscate something the player armed.
      return cond === null || cond.t !== 'bool' || cond.v
    })
    if (!live) out.push(m.id)
  }
  return out
}

/** Every index key a roll answers to. Extracted from resolve() because a second
 *  caller needs the same answer: deciding whether activating a stance would put
 *  a contribution on THIS roll means asking "does this effect target this roll",
 *  and asking it a second way is how the offer and the roll come to disagree. */
export function reqKeys(req: ResolveReq): string[] {
  return [
    req.subject,
    ...(req.tags ?? []).map(t => `tag:${normalizeTag(t)}`),
    `roll:${req.kind}`,
    req.sub ? `roll:${req.kind}.${req.sub}` : null,
    /* `roll:attack.str`. Its own key rather than a second meaning for `sub`,
       because a greataxe swing is melee AND Strength-based, and an author
       narrowing to one must not silence the other. Abilities and the existing
       subs share no names (melee/ranged/spell vs str…cha), so one namespace
       holds both without ambiguity. */
    req.ability ? `roll:${req.kind}.${req.ability}` : null,
  ].filter((k): k is string => !!k)
}

/** A target selector as the index keys it — tags normalised, everything else
 *  verbatim. */
export const asKey = (t: string) => (t.startsWith('tag:') ? `tag:${normalizeTag(t.slice(4))}` : t)

export function armedMatches(m: ArmedMod, req: ResolveReq): boolean {
  return m.kind === req.kind
    /* A SUB IS EITHER NAMESPACE, exactly as reqKeys treats it. One swing answers
       to `roll:attack.melee` AND `roll:attack.str`, and `armedFrom` flattens
       whichever the author wrote into the same `sub` slot — so comparing it
       against `req.sub` alone made every ability-targeted arm unmatchable.
       Brutal Strike's "Remove Advantage" (`roll:attack.str`) therefore never
       applied, could never be consumed because nothing ever showed it, and sat
       in the queue suppressing the feature's own future offers. */
    && (!m.sub || m.sub === req.sub || m.sub === req.ability)
    && (!m.subject || m.subject === req.subject)
}

/** The gid of an active source, or null for the kinds that have none — a potion
 *  and a shard tree are effect-only, and §12 refuses a tree-level graph.
 *
 *  A shard NODE has one, and until slice 6a it did not: buildContext() skips any
 *  source without a gid, so an attuned node's authored graph was indexed nowhere
 *  and silently did nothing — while the feature editor happily offered
 *  `shardnode:` targets and `GidKind` already listed the kind. */
function sourceGid(s: ActiveSource): Gid | null {
  switch (s.kind) {
    case 'feature': return gid('feature', s.obj)
    case 'spell': return gid('spell', s.obj)
    case 'item': return gid('item', s.obj)
    case 'weapon': return gid('weapon', s.obj)
    case 'shardnode': return nodeGid(s.shardId, s.obj.id)
    default: return null
  }
}

export function buildContext(
  character: CharacterRow,
  shardTrees: Record<string, ShardTree> = {},
  catalogTypes: Record<string, 'num' | 'bool'> = {},
): GraphContext {
  const { scope, audit } = characterVars(character, shardTrees, catalogTypes)
  const index = new Map<string, IndexedEffect[]>()
  const byOwner = new Map<Gid, IndexedEffect[]>()

  const push = (key: string, e: IndexedEffect) => index.set(key, [...(index.get(key) ?? []), e])

  for (const from of activeSources(character, shardTrees)) {
    const owner = sourceGid(from)
    if (!owner) continue
    const graph = 'graph' in from.obj ? from.obj.graph ?? [] : []
    for (const eff of graph) {
      const e: IndexedEffect = { eff, from, owner }
      byOwner.set(owner, [...(byOwner.get(owner) ?? []), e])
      // No target = this node's own roll. Indexed under its own gid, which is
      // exactly what "self" means once identity is nominal.
      for (const t of eff.target?.length ? eff.target : [owner]) {
        push(t.startsWith('tag:') ? `tag:${normalizeTag(t.slice(4))}` : t, e)
      }
    }
  }

  // `resources` is Json-typed, so the graph blob needs the same narrowing
  // lib/graphState.ts uses on the write side.
  const graphState = (character.resources as { graph?: GraphState } | undefined)?.graph
  return { scope, index, byOwner, problems: audit, armed: graphState?.armed ?? [] }
}

/* ---------- the walk ---------- */

/** WHO TARGETS THIS NODE — the reverse of what the index is normally asked.
 *
 *  The Features popup's "Affected by" section. It is NOT a second authored list:
 *  authoring one would mean the DM writing the same relationship twice and the
 *  two drifting the first time an effect is retargeted. `ctx.index` is already
 *  keyed by target selector, so the reverse lookup is a read of the forward one.
 *
 *  Matched by gid AND by every tag the node carries, because `tag:fire` hitting
 *  this feature is exactly as much "affected by" as naming it outright. An
 *  effect owned by the node itself is excluded — a feature is not affected by
 *  itself, and §51's boost path already treats self-targeting as its own case.
 *
 *  Deliberately unfiltered by `when`/`ask`: this answers "what could reach this",
 *  which is a question about the graph, not about one roll. */
export function affectedBy(ctx: GraphContext, target: Gid, tags: string[] = []): {
  /** The effect doing the reaching. */
  eff: GraphEffect
  /** Display name of the node it was authored on. */
  source: string
  /** Its gid, so the popup can navigate to it. Null for a source with no gid
   *  of its own (a potion, a shard tree — see sourceGid). */
  sourceGid: Gid | null
}[] {
  const keys = [target, ...tags.map(t => `tag:${normalizeTag(t)}`)]
  const seen = new Set<GraphEffect>()
  const out: { eff: GraphEffect; source: string; sourceGid: Gid | null }[] = []
  for (const k of keys) {
    for (const e of ctx.index.get(k) ?? []) {
      if (e.owner === target || seen.has(e.eff)) continue
      seen.add(e.eff)
      out.push({ eff: e.eff, source: e.from.obj.name, sourceGid: e.owner ?? null })
    }
  }
  return out
}

/** An active source's card text, whatever that source calls the field.
 *
 *  Four node kinds keep their prose under four different names — a feature's
 *  precedence mirrors `cardText` in screens/Features.tsx, an item and a spell use
 *  `description`, a shard node uses `effect`. One lookup, so the panel does not
 *  have to know which kind it is holding. */
function summaryOf(obj: unknown): string | undefined {
  const o = obj as Record<string, unknown>
  for (const k of ['light_description', 'summary', 'description', 'effect']) {
    const v = o?.[k]
    if (typeof v === 'string' && v.trim()) return v
  }
  return undefined
}

/** The operands of a formula at the values it actually used.
 *
 *  Only identifiers the scope resolves to a NUMBER: a boolean gate contributes
 *  nothing a reader could add up, and an unresolved name is already reported as
 *  a problem rather than shown as part of a sum. Undefined for a formula with no
 *  identifiers at all — `2d6` derives from nothing. */
function partsOf(formula: string | undefined, scope: ExprScope): Rider['parts'] {
  if (!formula) return undefined
  const seen = new Set<string>()
  const parts: { name: string; value: number }[] = []
  for (const id of freeIdents(formula)) {
    if (seen.has(id)) continue
    seen.add(id)
    const v = scope[id]
    if (typeof v === 'number') parts.push({ name: id, value: v })
  }
  return parts.length ? parts : undefined
}

export function resolve(ctx: GraphContext, req: ResolveReq): Resolution {
  const out: Resolution = { adv: false, dis: false, crit: false, riders: [], notes: [], problems: [] }

  // 2. Match: the subject itself, each of its tags, the roll kind, the sub-kind,
  //    and — on an attack — the ability it was made with.
  const keys = reqKeys(req)

  // The index is keyed the same way, so a tag target must be normalised before
  // it can be compared against the request's keys.
  const keySet = new Set(keys)

  const seen = new Set<GraphEffect>()
  const matched: IndexedEffect[] = []
  for (const k of keys) {
    for (const e of ctx.index.get(k) ?? []) {
      if (seen.has(e.eff)) continue // an OR across selectors applies once, not twice
      seen.add(e.eff)
      // `and` means every selector must hold of THIS roll. It is what says "a
      // fire weapon, on its damage roll": `tag:fire` alone rides into the attack
      // roll too, because the weapon carries its tags into both resolves.
      if (e.eff.match === 'and' && !(e.eff.target ?? []).every(t => keySet.has(asKey(t)))) continue
      matched.push(e)
    }
  }

  // 3. A node's contribution can itself be boosted by effects targeting that
  //    node's gid. Memoized by gid so a node feeding six rolls is walked once;
  //    visited-set guarded so a cycle drops a contribution instead of hanging.
  const memo = new Map<Gid, { flat: number; dice: string[] }>()
  const visiting = new Set<Gid>()

  function boost(owner: Gid): { flat: number; dice: string[] } {
    const hit = memo.get(owner)
    if (hit) return hit
    if (visiting.has(owner)) {
      out.problems.push({ sev: 'err', id: owner, t: 'Contribution cycle', s: `${owner} feeds itself. Its chained bonus is dropped until the loop is broken.` })
      return { flat: 0, dice: [] }
    }
    visiting.add(owner)
    const acc = { flat: 0, dice: [] as string[] }
    for (const e of ctx.index.get(owner) ?? []) {
      // `seen` holds everything that already matched the ROLL. An effect
      // targeting `spell:S` is one statement — "+4 to Sacred Flame" — and when
      // the roll's subject IS S it lands directly; boosting S's own
      // contributions with it as well counts the same +4 twice. Chaining is for
      // nodes the roll did not name (§4's "B boosts A, A contributes"), which
      // are exactly the ones not in `seen`.
      if (e.eff.op !== 'add' || e.owner === owner || seen.has(e.eff)) continue
      const v = value(e)
      if (!v) continue
      acc.flat += v.flat
      acc.dice.push(...v.dice)
    }
    visiting.delete(owner)
    memo.set(owner, acc)
    return acc
  }

  function value(e: IndexedEffect): { flat: number; dice: string[] } | null {
    const src = levelFormula(e.eff, ctx.scope.level) ?? e.eff.value ?? ''
    const v = evalExpr(src, ctx.scope)
    if (v === null || v.t !== 'num') {
      out.problems.push({
        sev: 'err', id: e.eff.id, t: 'Contribution did not resolve',
        s: `${e.eff.label} = "${src}" produced no usable value at these values.`,
      })
      return null
    }
    const chained = boost(e.owner)
    return { flat: v.flat + chained.flat, dice: [...v.dice, ...chained.dice] }
  }

  /** A crit node sets the flag and, if it named one, lowers the threshold. An
   *  unevaluable threshold leaves the flag standing — the improvement is real
   *  even when the number is broken, and the problem is reported either way. */
  function applyCrit(eff: GraphEffect): void {
    out.crit = true
    if (!eff.threshold) return
    const t = evalExpr(eff.threshold, ctx.scope)
    if (t === null || t.t !== 'num' || t.dice.length) {
      out.problems.push({ sev: 'err', id: eff.id, t: 'Crit range did not resolve', s: `${eff.label}'s threshold "${eff.threshold}" produced no number at these values.` })
      return
    }
    out.critFrom = out.critFrom === undefined ? t.flat : Math.min(out.critFrom, t.flat)
  }

  /** A floor raises the total to a minimum. HIGHEST wins, because two guarantees
   *  both hold and the better one is the one you feel. */
  function applyFloor(eff: GraphEffect): void {
    const t = evalExpr(eff.minimum ?? '', ctx.scope)
    if (t === null || t.t !== 'num' || t.dice.length) {
      out.problems.push({ sev: 'err', id: eff.id, t: 'Minimum did not resolve', s: `${eff.label}'s minimum "${eff.minimum ?? ''}" produced no number at these values.` })
      return
    }
    out.floor = out.floor === undefined ? t.flat : Math.max(out.floor, t.flat)
  }

  // 4. Partition. `when` gates EXISTENCE, `ask` gates RESOLUTION — orthogonal.
  //    Two of the six combinations do not surface at all.
  const askGroups = new Map<string, Rider>()

  for (const e of matched) {
    const { eff, from } = e

    if (eff.when !== undefined) {
      const cond = evalExpr(eff.when, ctx.scope)
      if (cond === null || cond.t !== 'bool') {
        out.problems.push({ sev: 'err', id: eff.id, t: 'Condition did not resolve', s: `${eff.label}'s condition "${eff.when}" is not a yes/no answer at these values.` })
        continue
      }
      if (!cond.v) continue // false → does not surface, with or without `ask`
    }

    // A note is prose, and §25's inline compute is what keeps that prose from
    // quietly lying: `{level * 2}` renders as the number, never as the source.
    // This is display only — nothing here reaches a total.
    //
    // `ask` on a note is NOT always an authoring error. A note that only carries
    // text has nothing to resolve, and §40 was right to refuse a toggle on it.
    // A note whose text computes something is the opposite case: the value is
    // worth revealing exactly when the player confirms the condition, and
    // refusing that shape forces the author into a meaningless `add` of 0 to buy
    // a checkbox. So it falls through to the rider path below and rides on the
    // same `ask` group as any contribution sharing the question — one fact, one
    // checkbox, whether the fact is a bonus or a DC.
    let reveal: string | undefined
    if (eff.op === 'note') {
      const { text, bad } = interpolate(eff.text || eff.label, ctx.scope)
      for (const src of bad) {
        out.problems.push({
          sev: 'err', id: eff.id, t: 'Note did not compute',
          s: `${eff.label}'s text reads "{${src}}", which produced no value at these values.`,
        })
      }
      if (!eff.ask) {
        out.notes.push(text)
        continue
      }
      reveal = text
    }

    // Damage flags are not roll modifiers — they answer "what happens when fire
    // lands on me", and no ResolveReq asks that. damageFlags() reads them.
    if (DAMAGE_FLAGS.includes(eff.op)) continue

    // Activation outcomes run on a PRESS and they write. Folding one into a
    // Resolution would fire it on every roll that matched — a `setVar` is not a
    // contribution to a number. lib/graphState.ts runs them.
    if (IS_ACTIVATION(eff.op)) continue

    // A `boost` never reaches a roll: it moves a number on the SHEET, and
    // lib/effects.ts effectiveSheet has already layered it in before any roll is
    // made. Resolving it here too would count a racial +2 DEX twice — once in
    // the score the roll is built from, and again as a contribution.
    if (IS_SHEET(eff.op)) continue

    // §16: a `once` effect ARMS, it does not apply. It waits in
    // resources.graph.armed for the next matching roll, and the armed loop
    // below is what puts it on a number. Skipping it here is the whole
    // difference between "the next attack" and "every attack" — the field has
    // existed since 1a with nothing reading it, so until now it meant the
    // second.
    if (eff.once) continue

    const v = eff.op === 'add' ? value(e) : { flat: 0, dice: [] }
    if (!v) continue

    // Unconditional and undecided → folds into flat/dice, AND surfaces as an
    // `always` rider carrying its label and source.
    //
    // The fold alone used to be the whole story, which threw the attribution
    // away: the roll knew it was +2 but not that the +2 was Rage. §7 asks every
    // number to be traceable, and the panel's contribution lines are where that
    // is finally read. `flat`/`dice` keep their exact previous meaning — the
    // rider is additional, not a replacement — which is why total() must skip
    // `always` riders or every one of these counts twice.
    if (eff.when === undefined && !eff.ask) {
      if (eff.op === 'adv') out.adv = true
      if (eff.op === 'dis') out.dis = true
      if (eff.op === 'crit') applyCrit(eff)
      if (eff.op === 'floor') applyFloor(eff)
      out.riders.push({
        label: eff.label, source: from.obj.name, sourceGid: e.owner, op: eff.op,
        formula: eff.value ?? '', flat: v.flat, dice: v.dice,
        when: 'always', on: true, dmgType: eff.dmgType,
        sourceText: summaryOf(from.obj), parts: partsOf(eff.value, ctx.scope),
      })
      continue
    }

    const rider: Rider = {
      label: eff.label,
      source: from.obj.name,
      sourceGid: e.owner,
      op: eff.op,
      formula: eff.value ?? '',
      flat: v.flat,
      dice: v.dice,
      when: eff.ask ? 'manual' : 'active',
      on: !eff.ask,
      text: eff.ask,
      reveal,
      dmgType: eff.dmgType,
      sourceText: summaryOf(from.obj),
      parts: partsOf(eff.value, ctx.scope),
    }

    // One fact, one checkbox: effects sharing an `ask` label are one decision.
    if (eff.ask) {
      const existing = askGroups.get(askKey(eff.ask))
      if (existing) {
        existing.flat += rider.flat
        existing.dice.push(...rider.dice)
        // A note sharing the question with a contribution is the whole point of
        // grouping: "+2d8 radiant" and "DC 16, Wisdom" are one confirmation.
        if (rider.reveal) existing.reveal = existing.reveal ? `${existing.reveal}

${rider.reveal}` : rider.reveal

        // ORDER MUST NOT DECIDE WHAT THE GROUP DOES. The group's op comes from
        // its first member, and a `note` contributes prose and nothing else — so
        // a note authored ABOVE its contribution made the whole group a note:
        // the toggle revealed the text and silently dropped the dice, with no
        // roll button and no way to notice. A real contribution outranks prose.
        if (existing.op === 'note' && rider.op !== 'note') {
          existing.op = rider.op
          existing.formula = rider.formula
          existing.dmgType = rider.dmgType
        }
        continue
      }
      askGroups.set(askKey(eff.ask), rider)
      // The rider keeps the FIRST contributor's label as its name and carries the
      // ask sentence as its question. Effects sharing an ask are one decision, so
      // one of them has to speak for the group; the sentence is what they all
      // actually have in common and it is shown in full either way.
    }

    // An `active` rider is already resolved, so its value applies now — the
    // player has no decision to make, only a source to be able to see.
    if (!eff.ask) {
      if (eff.op === 'adv') out.adv = true
      if (eff.op === 'dis') out.dis = true
      if (eff.op === 'crit') applyCrit(eff)
      if (eff.op === 'floor') applyFloor(eff)
    }
    out.riders.push(rider)
  }

  /* 5. The armed queue. Two kinds, and the difference is whether the author
        attached a question.

        TAKEN (no `ask`) — spent on an activation and waiting for this roll, so
        it applies to the number automatically and is never a toggle.
        `when: 'always'` says exactly that: the roller folds it in, the panel
        does not, and it needs no answer.

        OFFERED (`ask`) — minted undecided, because a blow lands at the end of
        the attack and a miss means neither. It arrives as a `manual` rider,
        which keeps it out of the roller's total until answered, and carries
        `choice` so the panel can render the source's offers as one pick-one. */
  const offeredBySource = new Map<string, number>()
  for (const m of ctx.armed) {
    if (m.ask && !m.spent && armedMatches(m, req)) offeredBySource.set(m.source, (offeredBySource.get(m.source) ?? 0) + 1)
  }
  for (const m of ctx.armed) {
    if (!armedMatches(m, req)) continue
    /* ALREADY ANSWERED. Held's release rule: taking the thing a hold offered
       spends it, so it is not offered again on the next roll. The roll that
       answered it still shows it — an entry is a snapshot — and undo clears the
       mark, which is why this is a flag and not a deletion. */
    if (m.spent) continue
    const v = m.op === 'add' ? evalExpr(m.value ?? '', ctx.scope) : null
    if (m.op === 'add') {
      if (v === null || v.t !== 'num') {
        out.problems.push({
          sev: 'err', id: m.id, t: 'Armed modifier did not resolve',
          s: `${m.label} = "${m.value ?? ''}" produced no usable value at these values. It stays armed.`,
        })
        continue
      }
    }
    // An OFFERED arm has not been taken, so it grants nothing yet. Flipping a
    // flag here would hand the roll an advantage the player never accepted.
    if (!m.ask) {
      if (m.op === 'adv') out.adv = true
      if (m.op === 'dis') out.dis = true
      if (m.op === 'crit') out.crit = true
    }
    out.riders.push({
      // The NAME if it was captured, never the gid — every other rider's
      // `source` is a human name, and this is the same column on screen.
      label: m.label, source: m.sourceName || m.source, sourceGid: m.source as Gid, op: m.op,
      formula: m.value ?? '', flat: v?.t === 'num' ? v.flat : 0, dice: v?.t === 'num' ? v.dice : [],
      when: m.ask ? 'manual' : 'always', on: !m.ask, armedId: m.id, dmgType: m.dmgType,
      // The question, and what saying yes reveals. `text` on a rider is the ask
      // sentence and `reveal` is the prose, matching what a graph-built rider
      // does — so the panel needs no second shape for an offered arm.
      ...(m.ask ? { text: m.ask, reveal: m.text } : {}),
      /* Only a REAL choice gets a group. A lone offered arm is a yes/no, and
         painting one option as a pick-one implies a sibling that is not there. */
      ...(m.ask && (offeredBySource.get(m.source) ?? 0) > 1
        ? { choice: m.source, ...(m.picks && m.picks > 1 ? { picks: m.picks } : {}) }
        : {}),
      // No `sourceText`: an armed mod is a stored snapshot naming its source,
      // not a live handle on the node, so the prose is genuinely not in hand.
      parts: partsOf(m.value, ctx.scope),
    })
  }

  return out
}

/** §25's damage-type modifiers. Deliberately NOT part of `Resolution`: that type
 *  answers "what modifies this roll", and being hit by fire is not a roll the
 *  player makes — there is no ResolveReq that means it. Overloading
 *  `kind: 'damage'` (a damage roll the player rolls) would make the two
 *  indistinguishable. Same matcher, same `when` gate, separate question.
 *
 *  Flags, never numbers — the ItemEffects rule. `immune` is not "resist twice". */
export function damageFlags(ctx: GraphContext, dmgType: string): { resist: boolean; vuln: boolean; immune: boolean } {
  const out = { resist: false, vuln: false, immune: false }
  for (const e of ctx.index.get(`tag:${normalizeTag(dmgType)}`) ?? []) {
    const { eff } = e
    if (!DAMAGE_FLAGS.includes(eff.op)) continue
    if (eff.when !== undefined) {
      const cond = evalExpr(eff.when, ctx.scope)
      if (cond === null || cond.t !== 'bool' || !cond.v) continue
    }
    if (eff.op === 'resist') out.resist = true
    if (eff.op === 'vuln') out.vuln = true
    if (eff.op === 'immune') out.immune = true
  }
  return out
}

/**
 * Is this character immune to a NAMED thing right now — a condition, by name?
 *
 * ONE MATCHER, TWO QUESTIONS. `damageFlags` asks it of a damage type and this
 * asks it of a condition, because "immune to fire" and "immune to Frightened"
 * are the SAME authored statement: an `immune` op targeting a tag. Giving
 * conditions an op of their own would be a second way to write one rule, and the
 * two would drift the first time either gained a feature.
 *
 * `when` is honoured by the shared matcher, which is what makes "while your Rage
 * is active" expressible at all — Mindless Rage is `immune → tag:frightened`
 * gated on `isRaging`, and nothing else.
 */
export const immuneTo = (ctx: GraphContext, name: string): boolean => damageFlags(ctx, name).immune

/**
 * The active effects an immunity is currently suppressing, by id.
 *
 * MATCHED BY NAME, because an ActiveEffect is a SNAPSHOT: the catalog row it came
 * from carries tags, the copy on the character does not, and the name is the one
 * thing the player and the author both see. `normalizeTag` on both sides means
 * "Frightened" matches `tag:frightened` without the DM having to think about it.
 *
 * Suppression rather than deletion: an immunity can be conditional, and a
 * condition removed while raging could not come back when the rage ended. The
 * DM's ✕ is still how something is really gone.
 */
export function suppressedEffects(ctx: GraphContext, character: CharacterRow): Set<string> {
  const out = new Set<string>()
  for (const e of activeEffects(character)) if (immuneTo(ctx, e.name)) out.add(e.id)
  return out
}

/** What this roll's contributions come to. Dice come back UNROLLED, because a
 *  crit doubles damage dice and a pre-rolled term cannot be doubled.
 *
 *  THE SPLIT, and it is the whole of it:
 *
 *    > The ROLLER folds every rider that is not `manual`.
 *    > The PANEL adds only the ones that are.
 *
 *  A `manual` rider is answered and rolled AFTER the roll — which is the entire
 *  reason the panel can change a total at all. Everything else is already inside
 *  the line's modifier before the roll entry exists. Between them each rider is
 *  counted exactly once, and neither side needs to know what the other did.
 *
 *  Keyed on `when` rather than on `r.on`: a non-manual rider is always on, so
 *  the two agree today, and naming the rule after the invariant means it keeps
 *  agreeing. */
export function total(res: Resolution): { flat: number; dice: string[] } {
  const on = res.riders.filter(r => r.op === 'add' && r.when !== 'manual')
  return {
    flat: on.reduce((n, r) => n + r.flat, 0),
    dice: on.flatMap(r => r.dice),
  }
}

/** `total()`, rolled — every contribution's dice thrown ONCE, with the faces
 *  kept on the rider that owns them.
 *
 *  This is the only function here that touches randomness, and it is deliberately
 *  not `resolve()`: a crit doubles damage dice, so the engine must hand them over
 *  unrolled and let the roller decide. `double` is that decision.
 *
 *  Attribution is the point. The roller used to flatten first and roll the
 *  resulting list, which summed correctly and lost track of which contribution
 *  each face belonged to — so a rider could be named but its result could not be
 *  shown, and the player was asked to trust a number they could not check. */
export function rollResolution(res: Resolution, double = false): {
  flat: number
  riders: Rider[]
} {
  let flat = 0
  const riders = res.riders.map(r => {
    if (r.op !== 'add' || r.when === 'manual') return r
    flat += r.flat
    if (!r.dice.length) return r
    const rolledDice = rolledDiceTerms(r.dice, double)
    flat += rolledDice.reduce((n, d) => n + d.v, 0)
    return { ...r, rolledDice }
  })
  return { flat, riders }
}

/* ---------- author-time (§17) ---------- */

/** One authored thing the editor knows about, for counting matches against the
 *  CATALOG rather than against one character. */
export type AuthoredNode = { gid: Gid; tags?: string[] }

const SELECTOR_KINDS: readonly string[] = ['feature', 'spell', 'item', 'weapon', 'shardnode']
const ROLL_KINDS: readonly RollKind[] = ['attack', 'damage', 'save', 'check', 'feature']

/** How many catalogued things a selector currently matches. `roll:` selectors
 *  match a roll, not a node, so they have no count — they are always live. */
export function matchCount(selector: string, nodes: AuthoredNode[]): number {
  if (selector.startsWith('roll:')) return Infinity
  if (selector.startsWith('tag:')) {
    const tag = normalizeTag(selector.slice(4))
    return nodes.filter(n => (n.tags ?? []).some(t => normalizeTag(t) === tag)).length
  }
  return nodes.filter(n => n.gid === selector).length
}

/** Author-time checks on one node's contributions. Runs on save, against the
 *  rest of the catalog.
 *
 *  Zero live matches is deliberately NOT an error: a target matching nothing yet
 *  is normal — the character simply doesn't own that spell. What IS an error is a
 *  DANGLING target, one naming a catalog row that does not exist. Conflating the
 *  two makes the linter useless, which is why matchCount is a separate signal the
 *  editor renders rather than a severity here. */
export function auditNode(
  /** `prose` is the node's own player-facing text. A variable read only by a
   *  description is READ — §25 interpolation is a consumer just like a
   *  condition is. Without it, moving a progression variable onto the feature
   *  whose prose prints it earns a "never used" warning for doing the right
   *  thing, and a warning that fires on correct authoring is one the DM learns
   *  to scroll past. */
  node: { graph?: GraphEffect[]; vars?: VarDef[]; prose?: (string | undefined)[] },
  nodes: AuthoredNode[] = [],
  /** Variables declared ELSEWHERE in the catalog, name → type.
   *
   *  Without this the audit builds its scope from the node's OWN declarations
   *  and nothing else, so a feature reading another's variable — Brutal Strike
   *  gated `when: reckless`, where Reckless Attack declares `reckless` — reports
   *  "Unknown identifier" and errors block Publish. At RUNTIME the scope is flat
   *  across every active source, so the same graph works perfectly; only the
   *  editor could not see it. Cross-feature state was unauthorable.
   *
   *  Deliberately mirrors `characterVars`' `catalogTypes` argument, which exists
   *  for exactly the same reason one layer down: a name that is declared
   *  somewhere real is not a typo. Absent (a caller with no catalog to hand) it
   *  degrades to the old behaviour rather than guessing. */
  catalogTypes: Record<string, 'num' | 'bool'> = {},
): AuditItem[] {
  const out: AuditItem[] = auditVars(node.vars ?? [])
  const known = new Set(nodes.map(n => n.gid))
  const declared = new Set((node.vars ?? []).map(v => v.name))
  // Type-correct, non-zero — §41. auditVars already reported anything wrong with
  // the declarations themselves, so no audit sink here.
  const scope = probeScope(node.vars ?? [], undefined, catalogTypes)

  for (const eff of node.graph ?? []) {
    if (!eff.label) {
      out.push({ sev: 'err', id: eff.id, t: 'Missing label', s: 'Every contribution needs a label — an unlabelled number in a breakdown cannot be checked.' })
    }
    // Required-ness comes from the op schema, not from a branch per op — the
    // renderer walks the same declaration, so a new op cannot arrive with a form
    // field the audit does not know about. Array fields are exempt: an empty
    // level table means "no progression", which is a legitimate answer.
    for (const fd of OPS[eff.op]?.fields ?? []) {
      if (!fd.required || fd.type === 'array') continue
      const v = (eff as unknown as Record<string, unknown>)[fd.key]
      if (v === undefined || v === null || String(v).trim() === '') {
        out.push({ sev: 'err', id: eff.id, t: `Missing ${fd.label.toLowerCase()}`, s: `${eff.label || eff.id} is ${eff.op}, whose schema requires ${fd.label}.` })
      }
    }
    // `boost` carries a value too — the amount the sheet stat moves by. It is
    // not a flag; its own checks below hold it to a plain number.
    if (eff.op !== 'add' && !IS_ACTIVATION(eff.op) && !IS_SHEET(eff.op) && eff.value) {
      out.push({ sev: 'err', id: eff.id, t: 'Value on a flag', s: `${eff.label || eff.id} is ${eff.op}, which is a flag, never a number. Advantage is not a bonus.` })
    }
    /* A FLAG CANNOT BE DECIDED AFTER THE DICE LAND.
       `ask` is answered in the roll panel, which is by definition after the roll:
       a number can still be added there, but advantage changes HOW the d20 is
       rolled, and §8 #2 forbids re-rolling one that already exists. So an
       ask-gated adv/dis/crit silently does nothing — the panel offers a toggle,
       the player says yes, and the roll it was meant to change is already spent.

       The fix is always the same shape, and it is the one §04 of the authoring
       guide describes: a stance the player holds is a stored bool they flip
       BEFORE rolling, with `when` reading it, so the engine knows in time. */
    /* A FLOOR NEEDS A TOTAL TO RAISE, and only a d20 roll has one that reaches
       composeCheck. On a damage roll it would be stored, shown in the editor and
       silently do nothing — so the target is checked rather than the shape being
       left to the author to discover at the table. */
    if (eff.op === 'floor') {
      const ts = eff.target ?? []
      const bad = ts.filter(t => !/^roll:(check|save)(\.|$)/.test(t))
      if (!ts.length || bad.length) {
        out.push({
          sev: 'err', id: eff.id, t: 'A floor needs a check or a save',
          s: `${eff.label || eff.id} ${ts.length ? `aims at "${bad[0]}"` : 'has no target'}. Only a d20 roll has a total to raise — target roll:check or roll:save.`,
        })
      }
    }
    if (eff.ask?.trim() && (eff.op === 'adv' || eff.op === 'dis' || eff.op === 'crit' || eff.op === 'floor')) {
      out.push({
        sev: 'err', id: eff.id, t: `${OP_TITLE[eff.op]} cannot be asked`,
        s: `${eff.label || eff.id} asks "${eff.ask.trim()}", but ${eff.op} changes how the roll itself resolves and an ask is answered after it already has. Use a player toggle instead: press "player toggle" on the when row, and the player holds it before rolling.`,
      })
    }
    // Not an error — §32 makes the combination legal and §24 needs it. But the
    // consequence is invisible from the editor: while the condition is false the
    // node does not appear AT ALL, not even as an unticked toggle, because a
    // toggle nobody can satisfy reads as a decision the player is getting wrong.
    // An author who has not read §32 sees a node that silently does nothing.
    if (eff.when && eff.ask) {
      out.push({
        sev: 'warn', id: eff.id, t: 'Vanishes when the condition is false',
        s: `${eff.label || eff.id} has both a condition and a toggle. While "${eff.when}" is false it does not surface at all — the player is not offered a choice they could not take.`,
      })
    }
    /* §40 refused every toggle on a note, on the grounds that prose has nothing
       to resolve. That holds for a note that only carries text — and NOT for one
       whose text computes something, where the toggle is what decides whether
       the player should see the number at all. The rule asks the question it
       always meant: does answering this reveal anything?

       AN ARMED NOTE IS A THIRD CASE, and the rule was blind to it. With `once`
       the toggle is not a "may I hide this paragraph" — it is a COMMITMENT, and
       Brutal Strike offering Forceful Blow or Hamstring Blow is one choice
       between two. Arming both unconditionally would hand the player both blows'
       text on every swing and lose the choice the feature is made of.

       WHERE it is answered moved, and this rule did not have to: the question
       used to be settled on the activation sheet, which pre-ticked it and armed
       both. A blow lands at the END of the attack — on a miss the answer is
       neither — so an asked arm is now minted undecided and the roll panel puts
       the source's offers up as one pick-one. See ArmedMod.ask. */
    if (eff.op === 'note' && eff.ask && !eff.once && !interpolations(eff.text || eff.label).length) {
      out.push({ sev: 'err', id: eff.id, t: 'Toggle on a note', s: `${eff.label || eff.id} is prose with nothing to reveal — there is nothing for the player to resolve. Use \`when\` if it should be conditional, or interpolate a value into the text if the toggle is what decides whether they see it.` })
    }
    // An `and` list can be unsatisfiable, and silently: a roll has ONE kind and
    // ONE subject, so naming two of either can never hold at once. That is the
    // price of the toggle, and the audit is where it gets paid.
    if (eff.match === 'and') {
      const ts = eff.target ?? []
      const kinds = new Set(ts.filter(t => t.startsWith('roll:')).map(t => t.slice(5).split('.')[0]))
      const things = new Set(ts.filter(t => !t.startsWith('roll:') && !t.startsWith('tag:')))
      const subs = new Set(ts.filter(t => t.startsWith('roll:') && t.includes('.')).map(t => t.slice(5)))
      const clash = kinds.size > 1 ? `roll kinds (${[...kinds].join(', ')})`
        : things.size > 1 ? `things (${[...things].join(', ')})`
        : subs.size > 1 ? `sub-kinds (${[...subs].join(', ')})`
        : null
      if (clash) {
        out.push({
          sev: 'err', id: eff.id, t: 'This AND can never match',
          s: `${eff.label || eff.id} requires ALL of its targets at once, but a roll has one kind and one subject — ${clash} cannot both hold. Use OR, or split it into two nodes.`,
        })
      }
      if (ts.length < 2) {
        out.push({
          sev: 'warn', id: eff.id, t: 'AND with one target',
          s: `${eff.label || eff.id} is set to match ALL targets but has ${ts.length === 1 ? 'only one' : 'none'} — the toggle is doing nothing.`,
        })
      }
    }

    // §16 keys the armed queue by ROLL KIND, so an armed effect's target has to
    // be expressible as one. A gid or a tag cannot be, and would arm something
    // that then matches no roll — a bonus the player was promised, sees on a
    // chip, and never receives.
    if (eff.once && (eff.target ?? []).some(t => !t.startsWith('roll:'))) {
      out.push({
        sev: 'err', id: eff.id, t: 'Armed modifier needs a roll target',
        s: `${eff.label || eff.id} arms once, so every target must be a roll: kind — "roll:attack", not a thing or a tag. Leave the target empty to arm this node's own roll.`,
      })
    }

    if (IS_SHEET(eff.op)) {
      // A sheet op applies to whoever carries the node, so a target is not just
      // unnecessary — it is a claim the engine cannot honour.
      if ((eff.target ?? []).length) {
        out.push({
          sev: 'err', id: eff.id, t: `${OP_TITLE[eff.op]} cannot target`,
          s: `${eff.label || eff.id} applies to the sheet of whoever carries it. It has no target, and one set here does nothing.`,
        })
      }
      // effectiveSheet is a pure function of the sheet with no expression scope,
      // so a condition here would silently never fire. Refuse it rather than
      // quietly dropping it.
      if (eff.when?.trim()) {
        out.push({
          sev: 'err', id: eff.id, t: `${OP_TITLE[eff.op]} cannot be conditional`,
          s: `${eff.label || eff.id} has a "when", but the sheet is computed without one. Use a roll contribution if it is conditional.`,
        })
      }
      /* A hand-edited or migrated node can name an ability that does not exist.
         It would compile to nothing and the attack would silently keep using
         Strength, which is indistinguishable from the feature not being there. */
      if (eff.op === 'useability' && eff.ability?.trim()
          && !['str', 'dex', 'con', 'int', 'wis', 'cha'].includes(eff.ability.trim().toLowerCase())) {
        out.push({
          sev: 'err', id: eff.id, t: 'Unknown ability',
          s: `${eff.label || eff.id} names "${eff.ability}", which is not one of STR, DEX, CON, INT, WIS or CHA. Attacks would keep using the weapon's own ability.`,
        })
      }
      /* THE REST OF THIS BRANCH IS BOOST'S. `stat` and a numeric `value` are
         boost's own fields — `useability` carries an `ability` and no value at
         all, so running these against it reported a missing number on a node
         that never had one, quoting an empty string back at the author. The
         two rules above (no target, no `when`) are true of every sheet op; from
         here down is one op's schema. */
      if (eff.op !== 'boost') continue

      // An EMPTY stat is already reported by the schema's required-field check
      // above; saying "unknown stat: ''" as well is two errors for one blank.
      if (eff.stat?.trim() && !MOD_STAT_SET.has(eff.stat)) {
        out.push({
          sev: 'err', id: eff.id, t: 'Unknown stat',
          s: `${eff.label || eff.id} boosts "${eff.stat ?? ''}", which is not a sheet stat.`,
        })
      }
      if (!Number.isFinite(Number(eff.value))) {
        out.push({
          sev: 'err', id: eff.id, t: 'Boost needs a plain number',
          s: `${eff.label || eff.id} has "${eff.value ?? ''}". The sheet has no roll to compute against, so dice and formulas cannot apply here.`,
        })
      }
      /* A CAP ONLY MEANS SOMETHING ON AN ABILITY SCORE. effectiveSheet clamps
         `abilities`, and nothing else — a ceiling typed onto Speed or AC would
         be stored, shown in the editor, and quietly do nothing, which is the
         defect this file exists to refuse. */
      if (eff.cap !== undefined && String(eff.cap).trim() !== '') {
        if (!Number.isFinite(Number(eff.cap))) {
          out.push({
            sev: 'err', id: eff.id, t: 'Cap needs a plain number',
            s: `${eff.label || eff.id} caps at "${eff.cap}". Like the amount, a ceiling on the sheet has nothing to compute against.`,
          })
        } else if (!isAbility(eff.stat ?? '')) {
          out.push({
            sev: 'err', id: eff.id, t: 'Cap on a stat that has no ceiling',
            s: `${eff.label || eff.id} boosts "${eff.stat ?? ''}", and only ability scores are clamped. A cap here would be stored and never applied.`,
          })
        }
      }
      continue
    }

    if (IS_ACTIVATION(eff.op)) {
      /* `addUses` IS THE ONE THAT REACHES OUT. It writes a use counter rather
         than a variable, and the counter it writes is usually somebody else's —
         "expend a use of your Rage to restore this" is Intimidating Presence
         aiming at Rage. So it keeps the normal target list, and everything below
         (which is about naming a variable) does not apply to it. */
      if (eff.op === 'addUses') {
        for (const t of eff.target ?? []) {
          if (!t.startsWith('feature:')) {
            out.push({
              sev: 'err', id: eff.id, t: 'addUses targets a feature',
              s: `${eff.label || eff.id} aims at "${t}". Only a feature has a use counter — pick one from the catalog, or leave the target empty to move this feature's own.`,
            })
          }
        }
        continue
      }
      // Every other activation names a variable rather than a target: it writes
      // state, it does not reach out at other nodes.
      const v = (node.vars ?? []).find(x => x.name === eff.variable)
      if (!v) {
        out.push({ sev: 'err', id: eff.id, t: 'Unknown variable', s: `${eff.label || eff.id} writes "${eff.variable ?? ''}", which this node does not declare.` })
      } else if (v.kind !== 'stored') {
        out.push({ sev: 'err', id: eff.id, t: 'Writing a derived variable', s: `${label(v)} is derived — it is computed from its formula on every read, so writing it would be discarded.` })
      } else if (v.scope === 'dm') {
        // §31's whole point: writability is a LOCATION. A player presses this
        // button, and migration 0015's trigger reverts a player write to dmVars —
        // so without this check the activation would silently no-op at the table.
        out.push({ sev: 'err', id: eff.id, t: 'Activation writes a DM variable', s: `${label(v)} is DM-only, and the player is the one pressing this. The write would be reverted by the database.` })
      }
      if (eff.target?.length) {
        out.push({ sev: 'err', id: eff.id, t: 'Target on an activation', s: `${eff.label || eff.id} writes a variable on this character; it has no target to reach out at.` })
      }
    }

    if (DAMAGE_FLAGS.includes(eff.op)) {
      // The target IS the statement: with no selector, "resist" names no damage
      // kind and says nothing at all.
      if (!eff.target?.length) {
        out.push({ sev: 'err', id: eff.id, t: 'Damage flag with no target', s: `${eff.label || eff.id} is ${eff.op}, whose target names the damage kind. Add a tag: selector — with none it applies to nothing.` })
      }
      // Same reasoning as a note: incoming damage raises no roll, so there is no
      // surface to hang a checkbox on. Gate it with `when` instead.
      if (eff.ask) {
        out.push({ sev: 'err', id: eff.id, t: 'Toggle on a damage flag', s: `${eff.label || eff.id} applies when damage lands, which raises no roll for the player to answer. Use \`when\`.` })
      }
    }

    for (const t of eff.target ?? []) {
      const kind = t.slice(0, t.indexOf(':'))
      if (t.startsWith('tag:')) continue // a tag matching nothing is legal — see matchCount
      if (t.startsWith('roll:')) {
        const [k, sub] = t.slice(5).split('.')
        if (!(ROLL_KINDS as readonly string[]).includes(k) || (sub !== undefined && !sub)) {
          out.push({ sev: 'err', id: eff.id, t: 'Unknown roll kind', s: `"${t}" is not a roll. Kinds are ${ROLL_KINDS.join(', ')}.` })
        }
        continue
      }
      if (!SELECTOR_KINDS.includes(kind)) {
        out.push({ sev: 'err', id: eff.id, t: 'Unknown selector', s: `"${t}" names no namespace. Use one of ${SELECTOR_KINDS.join(', ')}, tag:, or roll:.` })
        continue
      }
      if (nodes.length && !known.has(t as Gid)) {
        out.push({ sev: 'err', id: eff.id, t: 'Dangling target', s: `"${t}" names nothing in the catalog. A target that matches nothing YET is fine; one that cannot ever match is a typo.` })
      }
    }

    // Formulas and conditions are checked against the variable whitelist plus
    // roll context. A contribution has no name and a gid cannot be an identifier,
    // so "conditions never read another node's computed value" needs no check of
    // its own — the unknown-identifier rejection already covers it.
    /* `catalogTypes` joins the whitelist for the same reason it seeds the probe
       scope: a name declared on ANOTHER node is real, and at runtime the scope
       is flat across every active source. Without it a feature reading another
       feature's variable is unpublishable. */
    const allowed = new Set<string>([...VAR_IDENTS, ...ROLL_IDENTS, ...declared, ...Object.keys(catalogTypes)])
    for (const [src, what] of [[eff.value, 'formula'], [eff.when, 'condition'], [eff.threshold, 'crit range']] as const) {
      if (!src) continue
      for (const id of freeIdents(src)) {
        if (allowed.has(id)) continue
        out.push({ sev: 'err', id: eff.id, t: 'Unknown identifier', s: `${eff.label || eff.id}'s ${what} reads "${id}", which nothing declares.` })
      }
      if (evalExpr(src, scope) === null && !freeIdents(src).some(i => !allowed.has(i))) {
        out.push({ sev: 'err', id: eff.id, t: `Bad ${what}`, s: `${eff.label || eff.id}'s ${what} "${src}" does not evaluate.` })
      }
    }

    // §25's inline compute is a formula in a sentence, and gets the same two
    // checks as one in a field. Without this the author discovers a typo when a
    // player sees raw braces in their rule text.
    if (eff.op === 'note') {
      for (const src of interpolations(eff.text || eff.label)) {
        const unknown = freeIdents(src).filter(id => !allowed.has(id))
        if (unknown.length) {
          out.push({ sev: 'err', id: eff.id, t: 'Unknown identifier', s: `${eff.label || eff.id}'s text reads "${unknown[0]}", which nothing declares.` })
        } else if (evalExpr(src, scope) === null) {
          out.push({ sev: 'err', id: eff.id, t: 'Bad note text', s: `${eff.label || eff.id}'s text computes "{${src}}", which does not evaluate.` })
        }
      }
    }

    // Every filled cell of a level table is a formula too. Reported once rather
    // than twenty times — the author fixes the table, not each slot.
    const badCells = (eff.byLevel ?? [])
      .map((cell, i) => ({ cell: String(cell ?? '').trim(), i }))
      .filter(({ cell, i }) => i > 0 && cell && (evalExpr(cell, scope) === null || freeIdents(cell).some(id => !allowed.has(id))))
    if (badCells.length) {
      out.push({ sev: 'err', id: eff.id, t: 'Bad level table', s: `${eff.label || eff.id}'s table does not evaluate at level ${badCells.map(b => b.i).join(', ')}.` })
    }
  }

  // §32 folds effects sharing an `ask` into ONE rider, and a rider carries one
  // op. A note merging with a contribution is fine — prose plus a number is
  // exactly what the fold is for. TWO contributions of different kinds is not:
  // one of them defines the group and the other's effect is silently dropped.
  // Reported rather than blocked, because the fix is the author's call: two
  // asks, or one op.
  const byAsk = new Map<string, GraphEffect[]>()
  for (const eff of node.graph ?? []) {
    if (!eff.ask) continue
    const k = askKey(eff.ask)
    byAsk.set(k, [...(byAsk.get(k) ?? []), eff])
  }
  for (const [, group] of byAsk) {
    const ops = [...new Set(group.map(e => e.op).filter(op => op !== 'note'))]
    if (ops.length > 1) {
      out.push({
        sev: 'warn', id: group[0].id, t: 'One checkbox, two kinds of effect',
        s: `"${group[0].ask}" groups ${ops.join(' and ')} into a single toggle, and a toggle carries one. ${ops[0]} will apply and the rest will not. Give them separate asks, or make them the same op.`,
      })
    }
  }

  // A variable nothing reads and nothing writes is state with no mechanism: the
  // player gets a control that moves a value the engine never consults. This is
  // the authoring-side twin of a field that never reaches the form. A warning,
  // not an error — declaring the variable before wiring it is a legitimate order
  // of work, and the DM should be told, not blocked.
  const referenced = new Set<string>()
  for (const d of node.vars ?? []) for (const id of freeIdents(d.formula ?? '')) referenced.add(id)
  for (const eff of node.graph ?? []) {
    if (eff.variable) referenced.add(eff.variable)
    for (const src of [eff.value, eff.when, eff.threshold, ...(eff.byLevel ?? [])]) {
      for (const id of freeIdents(src ?? '')) referenced.add(id)
    }
    // A variable read ONLY by §25's inline compute is still read. Missing these
    // would warn on most of what inline compute exists for — a value the player
    // reads in prose and nothing else consults — and train the author to ignore
    // the one warning that catches real dead state.
    if (eff.op === 'note') {
      for (const src of interpolations(eff.text || eff.label)) {
        for (const id of freeIdents(src)) referenced.add(id)
      }
    }
  }
  for (const src of node.prose ?? []) {
    for (const span of interpolations(src ?? '')) {
      for (const id of freeIdents(span)) referenced.add(id)
    }
  }
  for (const d of node.vars ?? []) {
    if (referenced.has(d.name)) continue
    out.push({
      sev: 'warn', id: d.name, t: 'Variable is never used',
      s: `${label(d)} is declared but no condition reads it and no activation writes it, so changing it does nothing.`,
    })
  }
  return out
}
