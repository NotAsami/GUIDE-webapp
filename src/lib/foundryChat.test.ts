// Run: node --test src/lib/foundryChat.test.ts
//
// The chat card is the roll leaving the app. A wrong number here is a number a
// player reads in Foundry and cannot check against the panel.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Rider } from './graph.ts'
import type { RollEntry } from './rolls.tsx'
import { rollChatHtml } from './foundryChat.ts'
import { damageAmounts } from './foundryDamage.ts'

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
  /* Foundry's own break line, not a border of ours: `hr` is styled app-wide
     with the gradient the rest of the interface uses. */
  assert.match(html, /<hr>/)
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

/* "4 5" WAS TWO NUMBERS WITH NOTHING TO SAY THEY WERE DICE. The formula in
   front of the faces is what makes the row readable, and the rows are a real
   table so the columns line up however long a formula runs. */
test('a rolled line shows its formula in front of its faces', () => {
  const html = rollChatHtml(entry({ attack: ATTACK, damage: DAMAGE }), resolve)
  assert.match(html, /<table class="gr-rows">/)
  assert.match(html, /<span class="gr-fx">1d8<\/span> \(/)
  assert.match(html, /<span class="gr-d">5<\/span>\)/)
})

/* THE DC IS A BUTTON, NOT A NUMBER TO COPY OUT. Foundry enriches a chat
   message's content when it renders, so dnd5e's own save enricher reaches the
   log as a control that rolls the save for whatever is selected. Raw: escaped,
   it would sit in the card as the literal text `[[/save dex 15]]`. */
test('a save DC crosses as dnd5e’s own save enricher', () => {
  const html = rollChatHtml(entry({ kind: 'custom', title: 'Fireball', saveDC: 15, saveAbility: 'dex' }), resolve)
  assert.match(html, /\[\[\/save dex 15\]\]\{DC 15\}/)
  // The DC is the number the TARGET rolls against, so it is never also a "+15".
  assert.ok(!html.includes('+15'))
})

test('a DC with no ability named stays a plain number — the enricher needs one', () => {
  const html = rollChatHtml(entry({ kind: 'custom', title: 'Trap', saveDC: 15 }), resolve)
  assert.ok(!html.includes('[[/save'))
  assert.match(html, />15</)
})

/* A FILLED CHIP, NOT TINTED TEXT. The palette is built to glow on the codex's
   near-black ground and Foundry's chat log is hard-coded light, so a tint could
   never be legible on both. The ink is computed from the fill — see inkOn. */
test('a damage type is a filled chip, shaded so white text survives on it', () => {
  const html = rollChatHtml(entry({ damage: DAMAGE }), resolve)
  // The fill is a SHADE of the palette colour, never the colour itself — see
  // chipOn. What the card guarantees is the pairing; palette.test.ts proves the
  // ratio.
  assert.match(html, /class="gr-type" style="background:#[0-9a-f]{6};color:#ffffff"/)
  assert.ok(!html.includes('background:#8a8a8a'), 'the raw palette colour must not be the fill')
  // A `var()` reaching Foundry would render as inherited text — it has no tokens.
  assert.ok(!html.includes('var(--'))
})

/* THE VERDICT IS A CHIP FOR THE PALETTE'S OWN REASON: green text is 2.76:1 on
   the log's white, and the log is hard-coded light. Filled and inked, it is
   legible on whatever ground it lands on. */
test('a verdict is filled and inked, and says which way it went', () => {
  const green = (s: string | null) => (s === 'var(--good)' ? '#4fae6b' : s === 'var(--danger-hot)' ? '#ff5454' : null)
  const card = (hit: boolean) =>
    rollChatHtml(entry({ attack: ATTACK, target: { token: 't1', name: 'Goblin', hit } }), green)
  assert.match(card(true), /class="gr-verdict" style="background:#[0-9a-f]{6};color:#ffffff">HIT</)
  assert.match(card(false), /class="gr-verdict" style="background:#[0-9a-f]{6};color:#ffffff">MISS</)
  // No target verdict at all: no chip to colour.
  assert.ok(!rollChatHtml(entry({ attack: ATTACK }), green).includes('gr-verdict'))
})

/* THE TYPE TRAVELS WITH THE AMOUNT. The panel appends it to the contribution
   itself, so a card printing a bare "+4" for a rider that reads "+4 radiant" is
   the same value rendered two ways — and the reader cannot tell what the 4 is. */
test('a rider carries its damage type into the card', () => {
  const html = rollChatHtml(entry({
    damage: DAMAGE,
    riderGroups: [{ label: 'Damage', riders: [
      rider({ label: 'Divine Smite', source: 'Paladin', flat: 4, dmgType: 'radiant' }),
    ] }],
  }), resolve)
  assert.match(html, /Paladin · Divine Smite/)
  assert.match(html, /\+4 <span class="gr-or">radiant<\/span>/)
})

test('an unresolvable colour outlines the type rather than filling it', () => {
  const html = rollChatHtml(entry({ damage: { ...DAMAGE, type: 'fire' } }), () => null)
  assert.ok(!html.includes('var(--'))
  /* No fill means no ink that can be proven legible on it, so the type is drawn
     in the reader's own ink instead — the same fail-closed rule colorOf has. */
  assert.ok(!html.includes('background:'))
  assert.match(html, /gr-plain/)
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
  /* The strike itself is the stylesheet's now (`gr-out` in guide-roll.css) —
     what this guards is that the losing die is still MARKED and still there.
     Seeing what you beat is most of the point of advantage. */
  assert.match(html, /class="gr-d gr-out"/)
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

/* A CONDITION IN A NOTE IS A RULE THE DM CAN ACT ON. dnd5e's reference
   enricher links the SRD entry and hangs its apply-to-selected control off it,
   so "knocked Prone" stops being a word somebody retypes into the token. */
test('a condition named in a note crosses as dnd5e’s reference enricher', () => {
  const html = rollChatHtml(entry({
    damage: DAMAGE,
    riderGroups: [{ label: 'Damage', riders: [rider({
      op: 'note', label: 'Topple', source: 'Mastery',
      text: 'the target is knocked **Prone** until it stands.',
      when: 'manual', on: true,
    })] }],
  }), resolve)
  // Lowercased for the lookup, but the sentence keeps the author's own casing.
  assert.match(html, /&Reference\[prone\]\{Prone\}/)
  // Markup is not prose: the enricher must never land inside a tag.
  assert.ok(!/<[^>]*&Reference/.test(html))
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

/* THE CARD SAID +0 for a rolled 2d6 while its own total counted it — the
   contribution formatted here instead of through the panel's own sentence. */
test('a resolved dice contribution reaches the card as what it rolled', () => {
  const html = rollChatHtml(entry({
    attack: ATTACK, damage: DAMAGE,
    riderGroups: [{
      label: 'Damage',
      riders: [rider({
        label: 'Smite', source: 'Divine Smite', when: 'always', on: true,
        flat: 0, dice: ['2d6'], formula: '2d6',
        rolledDice: [{ v: 2, sides: 6 }, { v: 3, sides: 6 }],
      })],
    }],
  }), resolve)
  assert.match(html, /Divine Smite · Smite/)
  assert.match(html, /\+5/)
  assert.ok(!html.includes('+0'))
})

/* ---------- what reaches dnd5e ----------
 *
 * `applyDamage` runs the target's resistances over TYPED amounts; handed a bare
 * number it is told to ignore all of them. So the split has to survive the trip
 * intact, and an untyped lump must travel with no type at all rather than as
 * the word "damage" — a type the system does not know is a resistance check
 * nobody asked for. */

test('the damage split travels as dnd5e wants it', () => {
  assert.deepEqual(damageAmounts({ slashing: 8, fire: 5 }), [
    { value: 8, type: 'slashing' },
    { value: 5, type: 'fire' },
  ])
  // Untyped: no `type` key at all.
  assert.deepEqual(damageAmounts({ damage: 7 }), [{ value: 7 }])
  assert.deepEqual(damageAmounts({ '': 7 }), [{ value: 7 }])
  // Case is the system's, not the author's.
  assert.deepEqual(damageAmounts({ Radiant: 4 }), [{ value: 4, type: 'radiant' }])
  // Nothing to apply is nothing sent — never a zero the log would report.
  assert.deepEqual(damageAmounts({ slashing: 0 }), [])
  assert.deepEqual(damageAmounts({}), [])
})

