// Run: node --test src/lib/palette.test.ts
//
// The damage palette was stated in five places — four blocks of `[data-t="…"]`
// rules in RollContextPanel.module.css and a table for inline colours — with
// nothing making them agree. These tests are what keeps it at one.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DAMAGE, chipOn, colorOf } from './palette.ts'

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

/* THE CHIP IS THE PALETTE PAINTED RATHER THAN GLOWING. These colours are built
   for the codex's near-black ground; the Foundry chat log is hard-coded light,
   so the card fills a chip per damage type and the fill carries its own
   contrast. The fill is shaded until WHITE clears AA, rather than the ink being
   picked to suit the colour — near-black on a saturated red measured 5.98:1 and
   still read badly, which is where ratios and eyes stop agreeing. */
const contrast = (a: string, b: string) => {
  const lum = (h: string) => {
    const n = parseInt(h.slice(1), 16)
    const chan = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
    return 0.2126 * chan((n >> 16) & 255) + 0.7152 * chan((n >> 8) & 255) + 0.0722 * chan(n & 255)
  }
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

test('every chip fill carries its white ink at AA', () => {
  // The property, not a table of answers: whatever the colour, the pair is legible.
  for (const c of ['#ff5454', '#e2b021', '#4dd6ff', '#3fc7b4', '#a07ad6', '#a594ba', '#4fae6b', '#00a6d6', '#aaaaaa', '#ffffff']) {
    const chip = chipOn(c)!
    assert.ok(chip, `${c} should yield a chip`)
    assert.equal(chip.ink, '#ffffff')
    assert.ok(contrast(chip.fill, chip.ink) >= 4.5, `${c} → ${chip.fill} is only ${contrast(chip.fill, chip.ink).toFixed(2)}:1`)
  }
})

test('the shade keeps the hue — fire is still red', () => {
  const { fill } = chipOn('#ff5454')!
  const [r, g, b] = [1, 3, 5].map(i => parseInt(fill.slice(i, i + 2), 16))
  assert.ok(r > g && r > b, `${fill} stopped being red`)
  // Already dark enough to carry white: left alone rather than shaded further.
  assert.equal(chipOn('#000000')!.fill, '#000000')
})

test('short hex is the same colour as its long form', () => {
  assert.deepEqual(chipOn('#f55'), chipOn('#ff5555'))
})

test('a colour that is not a hex gets no chip, so the caller fills nothing', () => {
  // `cssVar` hands back whatever the stylesheet held; anything but a hex means
  // the chip cannot be proven legible, and an outlined label is the safe render.
  for (const bad of ['var(--fire)', 'rebeccapurple', 'oklch(70% .1 20)', '', '#zz']) {
    assert.equal(chipOn(bad), null, `${bad} must not yield a chip`)
  }
})
