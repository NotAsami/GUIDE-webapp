/**
 * The SRD dataset gate. One check, run by BOTH stages.
 *
 * Stage 1 runs it before writing JSON. Stage 2 runs it before writing rows —
 * and that second call is the one that matters. The first import has a human
 * reading the output; a re-import six months later, after a schema change,
 * does not. This and the `modified` skip are the two things standing between a
 * re-run and quietly destroyed work.
 *
 * It either says ALL CLEAR or names what is wrong. Everything it checks was a
 * real defect at some point in this import's life, which is why each one is
 * here rather than in a comment about being careful:
 *
 *   audits      unlabelled `boost` nodes would have been refused by the editor
 *               at publish time — content the app itself would not accept
 *   icons       `fa-baton` and `fa-graduation-cap` were invented and are not
 *               Font Awesome names; both render as NOTHING, which reads as a
 *               rendering glitch rather than bad data
 *   node ids    117 item nodes shared one id
 *   references  every species trait and background feat pointed at nothing
 *   value types `add` takes a formula string, `boost` takes a plain number;
 *               unifying them would break one of the two
 */

import { auditNode } from '../src/lib/graph.ts'
import { ICONS } from '../src/lib/icons.ts'

const VETTED = new Set(ICONS)

/**
 * @param {{items:any[],spells:any[],races:any[],features:any[],backgrounds:any[]}} data
 * @returns {string[]} failures — empty means clear
 */
export function verify(data) {
  const { items = [], spells = [], races = [], features = [], backgrounds = [], classes = [] } = data
  const fail = []
  const add = (what, detail) => fail.push(`${what}: ${detail}`)

  // ── every generated node must pass the audit the editor would run ──
  for (const r of races) {
    for (const a of auditNode({ graph: r.graph, vars: r.vars }, [])) {
      if (a.sev === 'err') add('race audit', `${r.name} — ${a.t}`)
    }
  }
  for (const i of items) {
    if (!i.graph?.length) continue
    for (const a of auditNode({ graph: i.graph, vars: [] }, [])) {
      if (a.sev === 'err') add('item audit', `${i.name} — ${a.t}`)
    }
  }

  // ── an icon outside the vetted palette renders as nothing ──
  for (const i of items) if (!VETTED.has(i.icon)) add('item icon', `${i.name} — ${i.icon}`)
  for (const f of features) if (f.icon && !VETTED.has(f.icon)) add('feature icon', `${f.name} — ${f.icon}`)
  for (const b of backgrounds) if (b.icon && !VETTED.has(b.icon)) add('background icon', `${b.name} — ${b.icon}`)
  for (const r of races) if (r.icon && !VETTED.has(r.icon)) add('race icon', `${r.name} — ${r.icon}`)
  for (const c of classes) if (c.icon && !VETTED.has(c.icon)) add('class icon', `${c.name} — ${c.icon}`)

  // ── node ids unique across the set ──
  const nodeIds = items.flatMap(i => (i.graph ?? []).map(n => n.id))
  if (new Set(nodeIds).size !== nodeIds.length) {
    add('node ids', `${nodeIds.length} item nodes, only ${new Set(nodeIds).size} distinct`)
  }

  // ── every reference resolves ──
  /* Checked against `feature_id`, the field FeatureGrantRef actually declares.
     This first read `ref.id` — the shape the transform happened to emit — so
     it validated the emitter against itself and passed while every race in the
     library said "undefined was referenced but no longer exists". A gate that
     shares the emitter's assumption checks nothing. */
  const fids = new Set(features.map(f => f.id))
  const refOf = (ref, owner, kind) => {
    if (!ref.feature_id) return add(`${kind} ref shape`, `${owner} — ref has no feature_id: ${JSON.stringify(ref)}`)
    if (!fids.has(ref.feature_id)) add(`dangling ${kind} ref`, `${owner} → ${ref.feature_id}`)
  }
  for (const r of races) for (const ref of r.features ?? []) refOf(ref, r.name, 'race')
  for (const c of classes) for (const ref of c.features ?? []) refOf(ref, c.name, 'class')
  for (const b of backgrounds) for (const ref of b.features ?? []) refOf(ref, b.name, 'background')

  /* FIELD NAMES THE APP ACTUALLY READS.
     Twice now the transform wrote a field the schema does not declare — `desc`
     on a Feature (which has light_description/deep_description) and `id` on a
     FeatureGrantRef (which declares feature_id). Both stored fine, both read as
     empty, and neither was visible until someone opened the editor. The gate
     cannot type-check, but it can assert the handful of names that matter. */
  for (const f of features) {
    if (!f.light_description && !f.deep_description) {
      add('feature prose', `${f.name} — no light_description`)
    }
    /* A placeholder body is not prose. Open5e returns the class progression
       table as features, 98 of which carry the literal text "[Column data]" —
       they loaded fine, read as real rows in the editor, and said nothing. */
    if (/^\[[\w\s]+\]$/.test((f.light_description ?? '').trim())) {
      add('placeholder prose', `${f.name} — "${f.light_description}"`)
    }
    if (!f.folder) add('feature folder', `${f.name} — imported features belong in a folder`)
  }

  /* A subclass is a row with a parent; a parent naming nothing would leave it
     orphaned in the editor's tree with no way to reach it. */
  /* Supplied data must actually be supplied. `primaryAbility` comes from a
     hand-kept table because Open5e ships none; an absent entry used to fall
     back to 'str', which is a plausible wrong answer rather than a visible
     one. ClassDef requires the field, so a missing one is a broken row. */
  for (const c of classes) {
    if (!c.parent && !c.primaryAbility) add('class primaryAbility', `${c.name} — none supplied`)
  }

  const classKeys = new Set(classes.map(c => c.srd_key))
  for (const c of classes) if (c.parent && !classKeys.has(c.parent)) {
    add('orphan subclass', `${c.name} → parent ${c.parent} is not in the set`)
  }

  // ── value types, per op ──
  for (const i of items) for (const n of i.graph ?? []) {
    if (n.op === 'add' && typeof n.value !== 'string') add('add value', `${i.name} — expected a formula string`)
  }
  for (const r of races) for (const n of r.graph ?? []) {
    if (n.op === 'boost' && typeof n.value !== 'number') add('boost value', `${r.name} — expected a plain number`)
  }

  // ── provenance, without which re-import cannot find the row again ──
  for (const [name, rows] of Object.entries({ items, spells, races, features, backgrounds, classes })) {
    for (const r of rows) if (!r.srd_key && !r.id) add('provenance', `${name}: "${r.name}" has neither srd_key nor id`)
  }

  return fail
}

/** Prints the verdict. Returns true when clear. */
export function report(fail, label = 'dataset') {
  if (!fail.length) {
    console.log(`✓ ${label}: ALL CLEAR — audits pass, icons vetted, ids unique, refs resolve, value types correct`)
    return true
  }
  console.error(`✗ ${label}: ${fail.length} problem${fail.length === 1 ? '' : 's'}`)
  for (const f of fail.slice(0, 20)) console.error(`   ${f}`)
  if (fail.length > 20) console.error(`   …and ${fail.length - 20} more`)
  return false
}
