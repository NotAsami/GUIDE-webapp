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

/** WCAG relative luminance of a hex colour, or null if it is not one. */
function luminance(hex: string): number | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const full = m[1].length === 3 ? m[1].replace(/./g, c => c + c) : m[1]
  const n = parseInt(full, 16)
  const chan = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * chan((n >> 16) & 255) + 0.7152 * chan((n >> 8) & 255) + 0.0722 * chan(n & 255)
}

/**
 * The ink that stays readable on a FILLED swatch of `colour`.
 *
 * WHY THIS IS COMPUTED AND NOT A TABLE. This palette is built to glow on the
 * codex's near-black ground, so on a fill it inverts: eleven of the twelve
 * colours above want dark ink, and `--danger` is the one that wants white.
 * A table of that would be a second statement about colour, drifting from the
 * first the moment a token moves — and `colorOf` lets an author write a literal
 * hex, so the set of colours this can be asked about is open anyway.
 *
 * Null for anything that is not a hex, and null is load-bearing exactly as it
 * is in `colorOf`: a caller that cannot be told the readable ink must not paint
 * a fill it cannot guarantee is legible — it falls back to tinted text.
 */
export function inkOn(colour: string): string | null {
  const l = luminance(colour)
  if (l === null) return null
  const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  // 1 is white's luminance; the dark ink is #111111.
  return contrast(l, 1) > contrast(l, luminance('#111111')!) ? '#ffffff' : '#111111'
}
