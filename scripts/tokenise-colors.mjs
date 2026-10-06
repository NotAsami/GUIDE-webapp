// Rewrites CSS colour literals that equal a token value into the token itself:
//   rgba(0,166,214,0.3) -> color-mix(in srgb, var(--cyan) 30%, transparent)
//   rgb(0,166,214) / #00a6d6 -> var(--cyan)
// Value-preserving (mixing with transparent in srgb only scales alpha), idempotent,
// re-runnable after a merge. Token values are parsed from tokens.css, never typed here.
// Black/white and colours with no token are left alone. Run: node scripts/tokenise-colors.mjs
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const TOKENS = 'src/styles/tokens.css'
const hexToRgb = (h) => {
  h = h.slice(1).toLowerCase()
  if (h.length === 3) h = [...h].map((c) => c + c).join('')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(',')
}

// triplet -> token names; rarity / gold-rare aliases only win when the rule already uses them
const byRgb = new Map()
for (const [, name, hex] of readFileSync(TOKENS, 'utf8').matchAll(/--([\w-]+):\s*(#[0-9a-f]{3,6})\b/gi)) {
  const k = hexToRgb(hex)
  if (!byRgb.has(k)) byRgb.set(k, [])
  byRgb.get(k).push(name)
}
const secondary = (n) => /^rar-|^gold-rare$/.test(n)
for (const names of byRgb.values()) names.sort((a, b) => secondary(a) - secondary(b))

const ambiguous = new Map() // file -> count of picks among aliases
function pick(rgb, block, file) {
  const names = byRgb.get(rgb)
  if (!names) return null
  if (names.length > 1) {
    const inRule = names.find((n) => block.includes(`var(--${n})`))
    if (inRule) return inRule
    ambiguous.set(file, (ambiguous.get(file) ?? 0) + 1)
  }
  return names[0]
}

const pct = (a) => {
  const n = a.trim().endsWith('%') ? parseFloat(a) : parseFloat(a) * 100
  return +n.toFixed(2)
}

function convertBlock(block, file) {
  // leave url(...) untouched (data URIs, the leather texture)
  return block.split(/(url\([^)]*\))/).map((seg, i) => {
    if (i % 2) return seg
    seg = seg.replace(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+%?)\s*)?\)/g, (m, r, g, b, a) => {
      const name = pick(`${+r},${+g},${+b}`, block, file)
      if (!name) return m
      if (a === undefined || pct(a) === 100) return `var(--${name})`
      return `color-mix(in srgb, var(--${name}) ${pct(a)}%, transparent)`
    })
    return seg.replace(/#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/gi, (m) => {
      const name = pick(hexToRgb(m), block, file)
      return name ? `var(--${name})` : m
    })
  }).join('')
}

const files = []
const walk = (d) => readdirSync(d).forEach((f) => {
  const p = join(d, f)
  if (statSync(p).isDirectory()) walk(p)
  else if (p.endsWith('.css') && p !== TOKENS) files.push(p)
})
walk('src')

let changed = 0
for (const file of files) {
  const src = readFileSync(file, 'utf8')
  // innermost {...} = declaration blocks and keyframe steps; selectors are never touched
  const out = src.replace(/\{([^{}]*)\}/g, (_, body) => `{${convertBlock(body, file)}}`)
  const selfRef = out.match(/--([\w-]+):\s*var\(--\1\)\s*[;}]/)
  if (selfRef) throw new Error(`${file}: would create self-referencing ${selfRef[0]}`)
  if (out !== src) { writeFileSync(file, out); changed++ }
}
console.log(`rewrote ${changed} files`)
if (ambiguous.size) {
  console.log('alias picks defaulted to the primary token (amber/cyan/good/violet), not rar-*/gold-rare:')
  for (const [f, n] of [...ambiguous].sort((a, b) => b[1] - a[1])) console.log(`  ${n}\t${f}`)
}
