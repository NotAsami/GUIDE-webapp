/**
 * Guard: every `styles.foo` a component references must actually exist in the
 * stylesheet that component imports.
 *
 * A CSS-module lookup that misses returns `undefined`, not an error. The
 * element renders with `class="undefined"` and NO layout at all — and unstyled
 * markup does not look like a missing import, it looks like many separate
 * design bugs: a number stacking above its input, no gaps, no colour, controls
 * full-width in a column.
 *
 * This has now shipped twice. Once when the origin-chain editor's stylesheet
 * was never imported (b05a4ed), and once when the starting-kit editor was
 * written referencing fifteen class names that had never been added to the
 * stylesheet at all. Both were found by a person using the screen, because
 * everything typechecks and builds perfectly: `styles` is a plain object.
 *
 * So it is checked here instead. The scan is deliberately conservative — it
 * only flags a NAME THAT APPEARS NOWHERE in the imported file, so a selector
 * written any of the ways this codebase writes them (`.a.b`, `.p .c`, a
 * comma list, `&`-free nesting) still counts as present.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const SRC = join(ROOT, 'src')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, name.name)
    if (name.isDirectory()) walk(full, out)
    else if (name.name.endsWith('.tsx')) out.push(full)
  }
  return out
}

/** Blank comments so a commented-out `styles.foo` is not reported. Newlines are
 *  preserved so line numbers still point at the real line. */
const decomment = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length))

/** `import styles from './X.module.css'` — the binding name and the file. */
function styleImports(src: string, fromFile: string): { binding: string; css: string }[] {
  const out: { binding: string; css: string }[] = []
  for (const m of src.matchAll(/import\s+(\w+)\s+from\s+['"]([^'"]+\.module\.css)['"]/g)) {
    out.push({ binding: m[1], css: resolve(dirname(fromFile), m[2]) })
  }
  return out
}

/** Class names a stylesheet defines. Any `.name` token counts, wherever it
 *  appears in a selector — this asks "is this name styled at all", not "is this
 *  exact selector present", because the codebase nests heavily. */
function definedClasses(css: string): Set<string> {
  const out = new Set<string>()
  // Selector text only: everything before each `{`, minus declaration bodies.
  const stripped = css.replace(/\{[^{}]*\}/g, '{}')
  for (const m of stripped.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) out.add(m[1])
  return out
}

const files = walk(SRC)

test('the scanner actually sees components and stylesheets', () => {
  assert.ok(files.length > 20, `expected to find .tsx files under src, found ${files.length}`)
  const withStyles = files.filter(f => styleImports(readFileSync(f, 'utf8'), f).length > 0)
  assert.ok(withStyles.length > 10, `expected many components importing a module.css, found ${withStyles.length}`)
})

test('every styles.foo a component uses exists in the stylesheet it imports', () => {
  const bad: string[] = []

  for (const file of files) {
    const raw = readFileSync(file, 'utf8')
    const src = decomment(raw)
    const imports = styleImports(src, file)
    if (!imports.length) continue

    for (const { binding, css } of imports) {
      if (!existsSync(css)) {
        bad.push(`${file.slice(ROOT.length)}  imports ${css.slice(ROOT.length)} — file does not exist`)
        continue
      }
      const defined = definedClasses(readFileSync(css, 'utf8'))
      // `styles.foo`, but never `styles[expr]` — a computed lookup is keyed on
      // a runtime value (a severity, a tone) and cannot be checked statically.
      for (const m of src.matchAll(new RegExp(`\\b${binding}\\.([A-Za-z_][\\w]*)\\b`, 'g'))) {
        const name = m[1]
        if (defined.has(name)) continue
        const line = src.slice(0, m.index).split('\n').length
        bad.push(`${file.slice(ROOT.length)}:${line}  ${binding}.${name}  (not in ${css.slice(ROOT.length)})`)
      }
    }
  }

  assert.deepEqual(bad, [], `A CSS-module lookup that misses returns undefined, so the element renders
with class="undefined" and no layout — which reads as a pile of separate design
bugs, not as a missing rule. Add the rule, or fix the name.\n  ${bad.join('\n  ')}\n`)
})
