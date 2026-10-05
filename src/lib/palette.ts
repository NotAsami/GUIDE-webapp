/**
 * The damage-type palette — ONE record of which colour a damage type is.
 *
 * It used to be stated in five places: four near-identical blocks of
 * `[data-t="…"]` rules in RollContextPanel.module.css (`.lType`, `.cVal`,
 * `.tot .split span b`, `.catDmg span`) and, once inline colours arrived, a
 * table in markdown.ts. Sixteen CSS rules and a TypeScript map that all had to
 * agree, with nothing to make them — so `[radiant damage]{radiant}` in a
 * feature's prose could quietly stop matching the number the roll panel showed
 * for that same radiant damage.
 *
 * Now the CSS knows no damage types at all. A consumer sets `--dt` from here and
 * every rule reads `var(--dt, <fallback>)`, so adding a type is one line in this
 * file and nothing else anywhere.
 *
 * VALUES ARE TOKEN REFERENCES, NEVER LITERALS. That is the whole argument for
 * preferring a name over a hex — if the palette hardcoded `#e2b021` it would be
 * the exact drift it exists to prevent.
 */

/** Damage type → design token. Lowercase keys: every caller has a free-text
 *  `dmgType` off an authored effect, so matching is case-insensitive by
 *  normalising here rather than at each of the call sites. */
export const DAMAGE: Record<string, string> = {
  radiant: 'gold-rare', fire: 'danger-hot', psychic: 'violet-hot', cold: 'teal',
  necrotic: 'violet', poison: 'good', acid: 'good', lightning: 'cyan-hot',
  thunder: 'cyan', force: 'violet-hot', bludgeoning: 'muted', piercing: 'muted',
  slashing: 'muted',
}

/** Colours that are not damage types, for prose that is about something else.
 *  Kept separate so the damage table stays a statement about damage — the roll
 *  panel iterates DAMAGE and must not pick up `beige` as a damage type. */
const GENERIC: Record<string, string> = {
  red: 'danger-hot', gold: 'gold-rare', amber: 'amber', cyan: 'cyan-hot',
  violet: 'violet', green: 'good', beige: 'beige', muted: 'muted',
  /** Not damage — what an attack roll's own contributions are tinted. */
  atk: 'cyan-hot',
}

/** A colour written by an author: a name, a design token, or a literal hex.
 *
 *  Returns null for anything else, and null is load-bearing — this is the only
 *  path from authored prose to a style attribute, so an unrecognised spec must
 *  fail closed and let the caller render the source verbatim.
 *
 *    [Fire Damage]{fire}        a name          (preferred — follows the theme)
 *    [Fire Damage]{--cyan-hot}  any token
 *    [Fire Damage]{#e2b021}     a literal hex   (escape hatch)
 */
export function colorOf(spec: string): string | null {
  const token = DAMAGE[spec] ?? GENERIC[spec]
  if (token) return `var(--${token})`
  if (/^--[a-z0-9-]+$/.test(spec)) return `var(${spec})`
  if (/^#[0-9a-fA-F]{3,6}$/.test(spec)) return spec
  return null
}

type RGB = [number, number, number]

function parseHex(hex: string): RGB | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const full = m[1].length === 3 ? m[1].replace(/./g, c => c + c) : m[1]
  const n = parseInt(full, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** WCAG relative luminance. */
function lumOf([r, g, b]: RGB): number {
  const chan = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b)
}

const toHex = (c: RGB) => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')

/** The brightest a fill can be and still carry white text at 4.5:1 — AA for
 *  small text, which is what a chip is. Derived from the ratio, not picked. */
const MAX_FILL_LUM = 1.05 / 4.5 - 0.05

/**
 * A damage colour as a FILLED CHIP: the shade to paint and the ink to write on
 * it. Null when `colour` is not a hex — load-bearing exactly as in `colorOf`,
 * because a caller that cannot be given a legible pair must not paint one.
 *
 * ONE INK, ALWAYS WHITE, and the fill moves to meet it. The obvious version of
 * this picked the ink to suit the colour, which put near-black on `--danger-hot`
 * — legible by the numbers at 5.98:1 and genuinely hard to read at 8px, because
 * dark text on a saturated bright red is where contrast ratios and eyes stop
 * agreeing. Shading the fill instead gives every chip the same treatment, which
 * is also one less thing for a reader to parse.
 *
 * A SHADE, NOT A TINT: the channels scale toward black, so the hue survives.
 * Fire stays unmistakably fire (#ff5454 → #d14545); it just stops shouting.
 */
export function chipOn(colour: string): { fill: string; ink: string } | null {
  const base = parseHex(colour)
  if (!base) return null
  for (let k = 1; k > 0; k -= 0.02) {
    const shade = base.map(v => v * k) as RGB
    if (lumOf(shade) <= MAX_FILL_LUM) return { fill: toHex(shade), ink: '#ffffff' }
  }
  return { fill: '#000000', ink: '#ffffff' }
}
