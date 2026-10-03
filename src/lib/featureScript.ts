/**
 * The Script view's text. THE SYNTAX IS A PLACEHOLDER — the tab is a locked
 * mock-up (docs/GUIDE_Codex_Deferred.md, "The feature Script view's
 * language") so the space exists and line ↔ node linking can be judged. Nothing
 * parses this and nothing writes it back. Ported from the mockup's `ser()`
 * (guide-hud/project/feature-script.js), walking the same projection the canvas
 * draws, so the three views cannot disagree about what a feature contains.
 */
import type { CatalogFeatureData, GraphEffect } from './database.types.ts'
import type { FeatureGraph, GNode } from './featureGraph.ts'
import { HAS_TARGET, IS_SHEET } from './opSchema.ts'

export type ScriptLine = { text: string; key: string | null }

const amt = (x: unknown) => { const s = String(x ?? ''); return /\s/.test(s) ? `(${s})` : s }
const ACT: Record<string, string> = { action: 'action', bonus: 'bonus', reaction: 'reaction', free: 'free' }
const RESET: Record<string, string> = { turn: 'turnStart', short: 'shortRest', long: 'longRest' }

function rule(e: GraphEffect, armed: boolean): string {
  const targets = e.target ?? []
  const to = HAS_TARGET(e.op) ? ` -> ${targets.length ? targets.join(e.match === 'and' ? ' & ' : ', ') : 'own'}` : ''
  const head =
    e.op === 'add' ? `add ${amt(e.value)}${e.dmgType ? ' ' + e.dmgType : ''}`
      : e.op === 'setVar' ? `set ${e.variable ?? '?'} = ${e.value ?? ''}`
      : e.op === 'addVar' ? `addVar ${e.variable ?? '?'} + ${e.value ?? ''}`
      : e.op === 'boost' ? `sheet boost ${e.stat ?? '?'} +${e.value ?? ''}`
      : IS_SHEET(e.op) ? `sheet ${e.op}`
      : e.value ? `${e.op} ${amt(e.value)}` : e.op
  return `${head} "${e.label ?? ''}"${to}${!armed && e.once ? ' once' : ''}${e.oneOf ? ' oneOf' : ''}`
}

export function serialize(f: CatalogFeatureData, g: FeatureGraph): ScriptLine[] {
  const out: ScriptLine[] = []
  const put = (text: string, key: string | null = null) => out.push({ text, key })
  const node = new Map(g.nodes.map(n => [n.key, n]))
  const effOf = (n: GNode | undefined) => (n && 'eff' in n ? n.eff : null)
  const withGates = (n: GNode, ind: string, armed: boolean) => {
    const e = effOf(n)!
    put(`${ind}${rule(e, armed)}`, n.key)
    if (e.when && n.kind !== 'outcome') put(`${ind}  when ${e.when}`, n.key)
    if (e.ask && n.kind !== 'outcome') put(`${ind}  ask "${e.ask}"`, n.key)
  }

  put('# placeholder syntax — illustrative, not a spec')
  put(`feature "${f.name ?? ''}"`)
  if (f.category) put(`  source ${f.category}`)
  if (f.tags?.length) put(`  tags ${f.tags.join(', ')}`)
  if (node.has('press')) {
    const uses = f.uses?.max != null ? String(f.uses.max) : 'unlimited'
    put(`  activation ${ACT[f.activation ?? ''] ?? 'none'} uses ${amt(uses)} reset ${RESET[f.recharge ?? ''] ?? 'manual'}`, 'press')
  }

  const ext = g.nodes.filter(n => n.kind === 'ext' || n.kind === 'ctx')
  const vars = g.nodes.filter(n => n.kind === 'var')
  if (ext.length || vars.length) put('')
  for (const n of ext) put(n.kind === 'ext' ? `  external ${n.ident} from ${n.decl}` : `  roll ${n.ident}`, n.key)
  for (const n of vars) {
    if (n.kind !== 'var') continue
    const d = n.def
    put(d.kind === 'derived'
      ? `  derived ${d.name} = ${d.uses ? `uses("${d.uses}")` : d.formula ?? ''}`
      : `  stored ${d.name}: ${d.type === 'bool' ? 'boolean' : 'number'} = ${d.initial ?? (d.type === 'bool' ? 'false' : 0)}${d.resetOn ? ' reset ' + RESET[d.resetOn] : ''}`, n.key)
  }

  const passive = g.nodes.filter(n => (n.kind === 'contrib' && !effOf(n)!.once) || n.kind === 'sheet')
  if (passive.length) put('')
  for (const n of passive) withGates(n, '  ', false)

  if (node.has('press')) {
    put('')
    put('  on press:', 'press')
    const start = out.length
    const walk = (from: string, ind: string, depth: number) => {
      if (depth > 12) return
      for (const e of g.edges) {
        if (e.kind !== 'flow' || e.from !== from) continue
        const n = node.get(e.to)
        if (!n) continue
        if (n.kind === 'ask') { put(`${ind}ask "${n.ask}":`, n.key); walk(n.key, ind + '  ', depth + 1) }
        else if (n.kind === 'cond') { put(`${ind}if ${n.when}:`, n.key); walk(n.key, ind + '  ', depth + 1) }
        else put(`${ind}${rule(effOf(n)!, true)}`, n.key)
      }
    }
    walk('press', '    ', 0)
    const armed = g.nodes.filter(n => n.kind === 'contrib' && effOf(n)!.once)
    const offers = new Set(g.edges.filter(e => e.kind === 'offer').map(e => e.from))
    const take = armed.filter(n => !offers.has(n.key)), pick = armed.filter(n => offers.has(n.key))
    if (take.length) { put('    take:'); for (const n of take) withGates(n, '      ', true) }
    if (pick.length) { put(`    pick ${amt(f.picks ?? 1)} of:`, node.has('picks') ? 'picks' : null); for (const n of pick) withGates(n, '      ', true) }
    if (out.length === start) put('    pass', 'press')
  }
  return out
}

/* ---------- colouring ---------- */

export type Tok = { v: string; c: string }
const CONTRIB = new Set(['add', 'adv', 'dis', 'note', 'crit', 'floor', 'reroll', 'resist', 'vuln', 'immune'])
const ACTION = new Set(['set', 'addVar', 'setHp', 'addUses', 'addSlot', 'grant'])

/** The mockup's lexer + first-word classifier, flattened. Colour only. */
export function colour(line: string, varNames: Set<string>): Tok[] {
  const re = /(#.*$)|("[^"]*"?)|(->)|((?:tag|roll):[\w.]*|(?:spell|item|weapon|feature|shardnode):\w*)|(\d+d\d+|\d+(?:\.\d+)?)|([A-Za-z_]\w*\*?)|(\s+)|([\s\S])/g
  const out: Tok[] = []
  let first: string | null = null, prev: string | null = null, m: RegExpExecArray | null
  while ((m = re.exec(line))) {
    const v = m[0]
    let c = ''
    if (m[1]) c = 'com'
    else if (m[2]) c = prev === 'ask' ? 'askS' : prev === 'feature' ? 'feat' : 'str'
    else if (m[3]) c = 'arrow'
    else if (m[4]) c = v.startsWith('tag:') ? 'tag' : v.startsWith('roll:') ? 'roll' : 'thing'
    else if (m[5]) c = 'num'
    else if (m[6]) {
      if (first === null) {
        first = v
        c = v === 'on' ? 'ev' : v === 'if' || v === 'when' ? 'cond' : v === 'ask' ? 'ask' : CONTRIB.has(v) ? 'con'
          : ACTION.has(v) ? 'act' : ['external', 'stored', 'derived', 'roll'].includes(v) ? 'var'
          : v === 'take' || v === 'pick' ? 'pk' : v === 'pass' ? 'mut' : 'meta'
      } else c = prev === 'on' ? 'ev' : ['from', 'reset', 'uses', 'once', 'oneOf', 'of'].includes(v) ? 'meta'
        : varNames.has(v) ? 'var' : ['and', 'or', 'not', 'true', 'false'].includes(v) ? 'op' : 'id'
      prev = v
    } else if (m[8]) c = 'op'
    out.push({ v, c })
  }
  return out
}
