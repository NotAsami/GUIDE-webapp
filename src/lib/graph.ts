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

import type { CharacterRow, GraphEffect, GraphOp, ShardTree, VarDef } from './database.types.ts'
import type { ExprScope, FormulaValue } from './expr.ts'
import { ROLL_IDENTS, VAR_IDENTS, evalExpr, freeIdents } from './expr.ts'
import { type ActiveSource, activeSources, effectiveSheet } from './effects.ts'
import { IS_ACTIVATION, OPS } from './opSchema.ts'
import { abilities, abilityMod, proficiency } from './dnd.ts'

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
export function probeScope(defs: VarDef[] = [], audit?: AuditItem[]): ExprScope {
  const scope: ExprScope = {}
  for (const k of VAR_IDENTS) scope[k] = 1
  for (const k of ROLL_IDENTS) scope[k] = 1
  for (const d of defs) if (d.kind === 'stored') scope[d.name] = probe(d.type)

  // Only the derived variable's TYPE is wanted, never its probe value: binding
  // the computed number would let `level - 1` reintroduce the zero this exists
  // to avoid.
  walkDerived(defs, scope, v => (v.t === 'arr' ? null : v.t === 'bool' ? false : 1), audit)

  // A derived variable that did not resolve still needs a binding, or every
  // reference to it reads as an unknown identifier and the error lands on the
  // reader instead of the declaration.
  for (const d of defs) if (!(d.name in scope)) scope[d.name] = probe(d.type)
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
    hp: character.sheet?.hp?.current ?? 0,
    hpMax: view.hp?.max ?? character.sheet?.hp?.max ?? 0,
  }
}

type GraphState = { vars?: Record<string, number | boolean>; dmVars?: Record<string, number | boolean> }

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
    v => (v.t === 'arr' || (v.t === 'num' && v.dice.length) ? null : v.t === 'bool' ? v.v : v.flat),
    audit,
  )

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
    } else {
      if (!d.formula) {
        out.push({ sev: 'err', id: d.name, t: 'Missing formula', s: `${label(d)} is derived, so it needs one.` })
      }
      for (const id of freeIdents(d.formula ?? '')) {
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
 *  off-by-one in one place beats living with it in every authored expression. */
function levelFormula(eff: GraphEffect, level: number | boolean | undefined): string | undefined {
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
}

export type Rider = {
  label: string
  source: string
  /** What this rider grants. A toggled `adv` is not a number, so the panel has to
   *  be told which it is — §13's shape carried flat/dice only. */
  op: GraphOp
  /** Shown when the player still has to decide. */
  formula: string
  flat: number
  /** UNROLLED — the caller rolls, so a crit can still double these. */
  dice: string[]
  when: 'always' | 'manual' | 'active'
  /** `active` and `always` riders arrive already resolved; `manual` ones start off. */
  on: boolean
  dmgType?: string
  /** Set once the player has answered a `manual` rider and its dice were rolled.
   *  Written by the Roll Context Panel, never by resolve() — which keeps the
   *  engine pure and makes the lock trivial: once this is set the roll
   *  affordance is gone and toggling reuses the value, so reopening the panel
   *  can never re-roll (§8 #2). */
  rolled?: boolean
  /** The faces that came up, once `rolled`. `dice` stays the unrolled formula. */
  rolledDice?: number[]
}

export type Resolution = {
  /** Unconditional contributions, already composed. */
  flat: number
  dice: string[]
  adv: boolean
  dis: boolean
  crit: boolean
  /** Lowest d20 face that crits, when a `crit` node applied one. Absent = 20.
   *  Lowest wins: Improved Critical (19) and a hypothetical 18 node give 18, not
   *  17 — a crit range is a threshold, not a bonus that stacks. */
  critFrom?: number
  /** Everything the panel renders. */
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
}

/** The gid of an active source, or null for the kinds that have none — a potion
 *  and a shard tree are effect-only, and §12 refuses a tree-level graph. */
function sourceGid(s: ActiveSource): Gid | null {
  switch (s.kind) {
    case 'feature': return gid('feature', s.obj)
    case 'spell': return gid('spell', s.obj)
    case 'item': return gid('item', s.obj)
    case 'weapon': return gid('weapon', s.obj)
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

  return { scope, index, byOwner, problems: audit }
}

/* ---------- the walk ---------- */

export function resolve(ctx: GraphContext, req: ResolveReq): Resolution {
  const out: Resolution = { flat: 0, dice: [], adv: false, dis: false, crit: false, riders: [], notes: [], problems: [] }

  // 2. Match: the subject itself, each of its tags, the roll kind, the sub-kind.
  const keys = [
    req.subject,
    ...(req.tags ?? []).map(t => `tag:${normalizeTag(t)}`),
    `roll:${req.kind}`,
    req.sub ? `roll:${req.kind}.${req.sub}` : null,
  ].filter((k): k is string => !!k)

  const seen = new Set<GraphEffect>()
  const matched: IndexedEffect[] = []
  for (const k of keys) {
    for (const e of ctx.index.get(k) ?? []) {
      if (seen.has(e.eff)) continue // an OR across selectors applies once, not twice
      seen.add(e.eff)
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
      if (e.eff.op !== 'add' || e.owner === owner) continue
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

    // A note is prose; there is nothing for the player to resolve, so it lands
    // whenever its `when` holds. `ask` on a note is an authoring error, caught by
    // auditNode rather than half-honoured here.
    if (eff.op === 'note') {
      out.notes.push(eff.text || eff.label)
      continue
    }

    // Damage flags are not roll modifiers — they answer "what happens when fire
    // lands on me", and no ResolveReq asks that. damageFlags() reads them.
    if (DAMAGE_FLAGS.includes(eff.op)) continue

    // Activation outcomes run on a PRESS and they write. Folding one into a
    // Resolution would fire it on every roll that matched — a `setVar` is not a
    // contribution to a number. lib/graphState.ts runs them.
    if (IS_ACTIVATION(eff.op)) continue

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
      if (eff.op === 'add') { out.flat += v.flat; out.dice.push(...v.dice) }
      if (eff.op === 'adv') out.adv = true
      if (eff.op === 'dis') out.dis = true
      if (eff.op === 'crit') applyCrit(eff)
      out.riders.push({
        label: eff.label, source: from.obj.name, op: eff.op,
        formula: eff.value ?? '', flat: v.flat, dice: v.dice,
        when: 'always', on: true, dmgType: eff.dmgType,
      })
      continue
    }

    const rider: Rider = {
      label: eff.label,
      source: from.obj.name,
      op: eff.op,
      formula: eff.value ?? '',
      flat: v.flat,
      dice: v.dice,
      when: eff.ask ? 'manual' : 'active',
      on: !eff.ask,
      dmgType: eff.dmgType,
    }

    // One fact, one checkbox: effects sharing an `ask` label are one decision.
    if (eff.ask) {
      const existing = askGroups.get(eff.ask)
      if (existing) {
        existing.flat += rider.flat
        existing.dice.push(...rider.dice)
        continue
      }
      askGroups.set(eff.ask, rider)
      rider.label = eff.ask
    }

    // An `active` rider is already resolved, so its value applies now — the
    // player has no decision to make, only a source to be able to see.
    if (!eff.ask) {
      if (eff.op === 'adv') out.adv = true
      if (eff.op === 'dis') out.dis = true
      if (eff.op === 'crit') applyCrit(eff)
    }
    out.riders.push(rider)
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

/** Compose what actually applies: the unconditional fold plus every rider the
 *  player has switched on. `flat`/`dice` deliberately exclude riders — the panel
 *  renders each rider as its own line, and a caller that summed both would double
 *  count. Doing it here once means no caller can get that wrong. */
export function total(res: Resolution): { flat: number; dice: string[] } {
  // `always` riders are ALREADY inside flat/dice — they exist so the panel can
  // name the source, not to be added a second time. Getting this wrong doubles
  // every unconditional contribution silently, which is why it has its own test.
  const on = res.riders.filter(r => r.on && r.op === 'add' && r.when !== 'always')
  return {
    flat: res.flat + on.reduce((n, r) => n + r.flat, 0),
    dice: [...res.dice, ...on.flatMap(r => r.dice)],
  }
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
export function auditNode(node: { graph?: GraphEffect[]; vars?: VarDef[] }, nodes: AuthoredNode[] = []): AuditItem[] {
  const out: AuditItem[] = auditVars(node.vars ?? [])
  const known = new Set(nodes.map(n => n.gid))
  const declared = new Set((node.vars ?? []).map(v => v.name))
  // Type-correct, non-zero — §41. auditVars already reported anything wrong with
  // the declarations themselves, so no audit sink here.
  const scope = probeScope(node.vars ?? [])

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
    if (eff.op !== 'add' && !IS_ACTIVATION(eff.op) && eff.value) {
      out.push({ sev: 'err', id: eff.id, t: 'Value on a flag', s: `${eff.label || eff.id} is ${eff.op}, which is a flag, never a number. Advantage is not a bonus.` })
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
    if (eff.op === 'note' && eff.ask) {
      out.push({ sev: 'err', id: eff.id, t: 'Toggle on a note', s: `${eff.label || eff.id} is prose — there is nothing for the player to resolve. Use \`when\` if it should be conditional.` })
    }
    if (IS_ACTIVATION(eff.op)) {
      // An activation names a variable rather than a target: it writes state, it
      // does not reach out at other nodes.
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
    const allowed = new Set<string>([...VAR_IDENTS, ...ROLL_IDENTS, ...declared])
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

    // Every filled cell of a level table is a formula too. Reported once rather
    // than twenty times — the author fixes the table, not each slot.
    const badCells = (eff.byLevel ?? [])
      .map((cell, i) => ({ cell: String(cell ?? '').trim(), i }))
      .filter(({ cell, i }) => i > 0 && cell && (evalExpr(cell, scope) === null || freeIdents(cell).some(id => !allowed.has(id))))
    if (badCells.length) {
      out.push({ sev: 'err', id: eff.id, t: 'Bad level table', s: `${eff.label || eff.id}'s table does not evaluate at level ${badCells.map(b => b.i).join(', ')}.` })
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
