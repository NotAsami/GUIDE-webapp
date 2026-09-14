// Run: node --test src/lib/palette.test.ts
//
// The damage palette was stated in five places — four blocks of `[data-t="…"]`
// rules in RollContextPanel.module.css and a table for inline colours — with
// nothing making them agree. These tests are what keeps it at one.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DAMAGE, colorOf, inkOn } from './palette.ts'

test('every damage type resolves to a design token, never a literal', () => {
  // The whole argument for preferring a name over a hex. A literal here would be
  // exactly the drift this file exists to prevent.
  for (const [type, token] of Object.entries(DAMAGE)) {
    assert.equal(colorOf(type), `var(--${token})`, `${type} should resolve`)
    assert.doesNotMatch(token, /^#/, `${type} must name a token, not a hex`)
  }
})

test('the four types the roll panel tints are all present', () => {
  // These were the ones hardcoded in CSS. Losing one silently drops a colour
  // that used to be there.
  for (const t of ['radiant', 'fire', 'psychic', 'cold']) {
    assert.ok(DAMAGE[t], `${t} lost its entry`)
  }
})

test('the stylesheet names no damage types', () => {
  // The collapse itself. A re-added `[data-t="fire"]` rule is a second answer to
  // "what colour is fire", and the second answer is the one that drifts.
  const css = readFileSync(new URL('../components/RollContextPanel.module.css', import.meta.url), 'utf8')
  const strays = css.match(/\[data-t="[a-z]+"\]/g) ?? []
  assert.deepEqual(strays, [], 'per-type CSS rules are back — set --dt from lib/palette.ts instead')
})

test('an unknown colour is null, so callers can fail closed', () => {
  for (const bad of ['plaid', 'javascript:alert(1)', '#zz', '--Bad_Token', '']) {
    assert.equal(colorOf(bad), null, `${bad} must not resolve`)
  }
})

/* THE PALETTE INVERTS ON A FILL. These colours are built to glow on the codex's
   near-black ground; painted as a swatch they are light, and light wants dark
   ink. The Foundry chat card fills a chip per damage type precisely so the
   colour stops depending on what ground the reader's chat log happens to be. */
test('a filled swatch gets ink that can be read on it', () => {
  assert.equal(inkOn('#ff5454'), '#111111')   // --danger-hot, fire
  assert.equal(inkOn('#4dd6ff'), '#111111')   // --cyan-hot, lightning
  assert.equal(inkOn('#e2b021'), '#111111')   // --gold-rare, radiant
  // …and the one that does not: --danger is dark enough to carry white.
  assert.equal(inkOn('#b93a3a'), '#ffffff')
  assert.equal(inkOn('#000000'), '#ffffff')
})

test('short hex is the same colour as its long form', () => {
  assert.equal(inkOn('#fff'), inkOn('#ffffff'))
  assert.equal(inkOn('#F00'), inkOn('#ff0000'))
})

test('a colour that is not a hex gets no ink, so the caller fills nothing', () => {
  // `cssVar` hands back whatever the stylesheet held; anything but a hex means
  // the chip cannot be proven legible, and a tinted label is the safe render.
  for (const bad of ['var(--fire)', 'rebeccapurple', 'oklch(70% .1 20)', '', '#zz']) {
    assert.equal(inkOn(bad), null, `${bad} must not yield an ink`)
  }
})
