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
  const { items = [], spells = [], races = [], features = [], backgrounds = [] } = data
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

  // ── node ids unique across the set ──
  const nodeIds = items.flatMap(i => (i.graph ?? []).map(n => n.id))
  if (new Set(nodeIds).size !== nodeIds.length) {
    add('node ids', `${nodeIds.length} item nodes, only ${new Set(nodeIds).size} distinct`)
  }

  // ── every reference resolves ──
  const fids = new Set(features.map(f => f.id))
  for (const r of races) for (const ref of r.features ?? []) {
    if (!fids.has(ref.id)) add('dangling race ref', `${r.name} → ${ref.id}`)
  }
  for (const b of backgrounds) for (const ref of b.features ?? []) {
    if (!fids.has(ref.id)) add('dangling background ref', `${b.name} → ${ref.id}`)
  }

  // ── value types, per op ──
  for (const i of items) for (const n of i.graph ?? []) {
    if (n.op === 'add' && typeof n.value !== 'string') add('add value', `${i.name} — expected a formula string`)
  }
  for (const r of races) for (const n of r.graph ?? []) {
    if (n.op === 'boost' && typeof n.value !== 'number') add('boost value', `${r.name} — expected a plain number`)
  }

  // ── provenance, without which re-import cannot find the row again ──
  for (const [name, rows] of Object.entries({ items, spells, races, features, backgrounds })) {
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
