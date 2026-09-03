// Run: node --test src/lib/foundryChat.test.ts
//
// The chat card is the roll leaving the app. A wrong number here is a number a
// player reads in Foundry and cannot check against the panel.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Rider } from './graph.ts'
import type { RollEntry } from './rolls.tsx'
import { rollChatHtml } from './foundryChat.ts'

const rider = (over: Partial<Rider>): Rider => ({
  label: 'R', source: 'Src', op: 'add', formula: '2', flat: 2, dice: [],
  when: 'always', on: true, ...over,
})
const entry = (over: Partial<RollEntry>): RollEntry => ({
  id: 'r1', at: 0, kind: 'weapon', title: 'Longsword', ...over,
} as RollEntry)

const faces = (sides: number, ...vs: number[]) => vs.map(v => ({ v, sides }))
const ATTACK = { d20: 14, rolls: faces(20, 14), mode: 'normal' as const, bonus: 6, total: 20, crit: false, fumble: false, breakdown: '' }
const DAMAGE = { diceExpr: '1d8', dice: faces(8, 5), bonus: 3, total: 8, type: 'slashing', crit: false, breakdown: '' }

/** Stands in for the browser's computed styles: the palette says `slashing` is
 *  `var(--muted)`, and this is what a stylesheet would have resolved it to. */
const resolve = (spec: string | null) => (spec === 'var(--muted)' ? '#8a8a8a' : spec)

test('the totals in the card are the panel’s totals', () => {
  const html = rollChatHtml(entry({ attack: ATTACK, damage: DAMAGE }), resolve)
  assert.match(html, /<b>20<\/b> to hit/)
  assert.match(html, /<b>8<\/b> slashing/)
})

/* THE SAME SPLIT §49 GUARDS. The roller already folded a non-manual rider into
   the line, so the card must show it as working without adding it again. */
test('an always-on rider is named but not added twice', () => {
  const html = rollChatHtml(entry({
    attack: ATTACK, damage: DAMAGE,
    riderGroups: [{ label: 'Damage', riders: [rider({ label: 'Rage', source: 'Barbarian', flat: 2 })] }],
  }), resolve)
  assert.match(html, /Barbarian · Rage/)
  assert.match(html, /<b>8<\/b> slashing/)   // still 8, not 10
})

test('a manual rider the player left off contributes nothing and is not listed', () => {
  const html = rollChatHtml(entry({
    attack: ATTACK, damage: DAMAGE,
    riderGroups: [{ label: 'Damage', riders: [rider({ label: 'Sneak', source: 'Rogue', when: 'manual', on: false, flat: 7 })] }],
  }), resolve)
  assert.ok(!html.includes('Sneak'))
  assert.match(html, /<b>8<\/b> slashing/)
})

test('a damage type carries its palette colour, resolved to a literal', () => {
  const html = rollChatHtml(entry({ damage: DAMAGE }), resolve)
  assert.ok(html.includes('color:#8a8a8a'))
  // A `var()` reaching Foundry would render as inherited text — it has no tokens.
  assert.ok(!html.includes('var(--'))
})

test('an unresolvable colour is omitted rather than emitted as var()', () => {
  const html = rollChatHtml(entry({ damage: { ...DAMAGE, type: 'fire' } }), () => null)
  assert.ok(!html.includes('var(--'))
  assert.match(html, /<b>8<\/b> fire/)
})

/* AUTHORED PROSE REACHES FOUNDRY. A title is DM-written free text and the chat
   log renders HTML, so anything unescaped here is markup we did not intend. */
test('authored text is escaped', () => {
  const html = rollChatHtml(entry({ title: 'Bite <script>alert(1)</script>' }), resolve)
  assert.ok(!html.includes('<script>'))
  assert.match(html, /&lt;script&gt;/)
})

test('a dropped die is struck through, not dropped from the card', () => {
  const html = rollChatHtml(entry({
    attack: { ...ATTACK, rolls: faces(20, 14, 3), mode: 'adv' },
  }), resolve)
  assert.match(html, /line-through/)
  assert.ok(html.includes('>3<'))
})

/* A NOTE IS WHAT HAPPENED TO THE TARGET. Brutal Strike's chosen effect adds no
   number, so a card built only from arithmetic left the DM with a damage total
   and no idea the target had been pushed 15 feet. */
test('an answered note reaches the card, rendered as prose', () => {
  const html = rollChatHtml(entry({
    damage: DAMAGE,
    riderGroups: [{ label: 'Damage', riders: [rider({
      op: 'note', label: 'Forceful Blow', source: 'Brutal Strike',
      text: '**Forceful Blow:** the target is pushed 15 feet.',
      when: 'manual', on: true,
    })] }],
  }), resolve)
  assert.match(html, /<strong>Forceful Blow:<\/strong>/)
  assert.match(html, /pushed 15 feet/)
  // The source string must not survive — that is the "prose printed raw" bug.
  assert.ok(!html.includes('**'))
})

test('an option the player did not choose stays out of the card', () => {
  const html = rollChatHtml(entry({
    damage: DAMAGE,
    riderGroups: [{ label: 'Damage', riders: [rider({
      op: 'note', label: 'Hamstring Blow', source: 'Brutal Strike',
      text: '**Hamstring Blow:** speed reduced by 15 feet.',
      when: 'manual', on: false,
    })] }],
  }), resolve)
  assert.ok(!html.includes('Hamstring'))
})

test('a note computes against the scope, as the panel does', () => {
  const html = rollChatHtml(entry({
    damage: DAMAGE,
    riderGroups: [{ label: 'Damage', riders: [rider({
      op: 'note', label: 'Extra', source: 'Brutal Strike',
      text: 'Adds {level >= 17 ? 2d10 : 1d10} damage.',
      when: 'manual', on: true,
    })] }],
  }), resolve, { level: 18 } as never)
  assert.match(html, /Adds 2d10 damage/)
})
