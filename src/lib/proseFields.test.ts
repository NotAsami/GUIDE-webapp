// Run: node --test src/lib/proseFields.test.ts
//
// Guard: a field whose text is RENDERED as markdown must also OFFER markdown.
//
// The mismatch this catches is silent and one-directional. A prose textarea
// without `markdownShortcuts` still works — you can type `**bold**` by hand and
// it renders — so nothing looks broken; you simply never learn the shortcut
// exists, and the field feels different from the one beside it. That is exactly
// how eight fields ended up wired and fifteen not.
//
// Scanned rather than unit-tested because the thing being checked IS the
// wiring: no pure function can tell you whether a JSX attribute is present.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))

function tsxFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      if (e.isDirectory()) walk(`${dir}/${e.name}`)
      else if (e.name.endsWith('.tsx')) out.push(`${dir}/${e.name}`)
    }
  }
  walk('src')
  return out
}

/** Every `<textarea …/>` element, with the file and line it sits on. */
function textareas(): { file: string; line: number; tag: string }[] {
  const out: { file: string; line: number; tag: string }[] = []
  for (const f of tsxFiles()) {
    const src = readFileSync(join(ROOT, f), 'utf8')
    for (const m of src.matchAll(/<textarea\b[\s\S]{0,900}?\/>/g)) {
      out.push({ file: f, line: src.slice(0, m.index).split('\n').length, tag: m[0] })
    }
  }
  return out
}

/**
 * Fields deliberately WITHOUT markdown, and why. A DM scratch note that is
 * never rendered anywhere but the textarea it was typed in gains nothing from
 * bold, and offering it would imply a reader who does not exist.
 *
 * Adding to this list is a decision; leaving a field off it by accident is the
 * bug the test exists for.
 */
const PLAIN_ON_PURPOSE: { match: string; why: string }[] = [
  { match: 'a note to yourself, never shown to a player', why: 'loot table DM note — renders nowhere' },
  { match: 'Compose a G.U.I.D.E. system notice', why: 'broadcast — the toast renders plain text (deferred)' },
  { match: 'DM eyes only', why: 'GM notes / true lore — DM-side render undecided (deferred)' },
  { match: 'operator only', why: 'operator scratch note — renders nowhere' },
  /* The shard's seat-flavour text. Excused for a DIFFERENT reason from the
     others: it is player-FACING copy that no screen renders at all — authored
     and then dropped on the floor. Wiring markdown into it would polish a field
     nobody reads. Logged in docs/GUIDE_Codex_Deferred.md; when it gets a render
     surface it should come off this list in the same change. */
  { match: 'What the player reads the moment the shard seats', why: 'authored but rendered nowhere — see deferred register' },
]

test('EVERY PROSE TEXTAREA OFFERS THE SHORTCUTS, or is listed as plain on purpose', () => {
  const bare: string[] = []
  for (const { file, line, tag } of textareas()) {
    if (tag.includes('markdownShortcuts')) continue
    const excused = PLAIN_ON_PURPOSE.find(p => tag.includes(p.match))
    if (excused) continue
    const ph = /placeholder="([^"]{0,50})/.exec(tag)
    bare.push(`${file}:${line}  ${ph ? ph[1] : '(no placeholder)'}`)
  }
  assert.deepEqual(bare, [],
    'These prose fields render markdown but do not offer Ctrl+B/I/K.\n'
    + 'Add `onKeyDown={markdownShortcuts(setX)}`, or add the field to '
    + 'PLAIN_ON_PURPOSE with the reason it renders nowhere:\n  ' + bare.join('\n  '))
})

test('the scanner actually sees the codebase', () => {
  // Guards against the regex silently matching nothing, which would make the
  // test above pass forever — the failure mode of every source scan.
  const all = textareas()
  assert.ok(all.length > 15, `only found ${all.length} textareas`)
  assert.ok(all.some(t => t.tag.includes('markdownShortcuts')), 'found none wired at all')
})

test('every excuse in PLAIN_ON_PURPOSE still matches something', () => {
  // An excuse for a field that no longer exists is a stale exemption that would
  // silently cover the NEXT field whose placeholder happens to contain it.
  const tags = textareas().map(t => t.tag)
  for (const p of PLAIN_ON_PURPOSE) {
    assert.ok(tags.some(t => t.includes(p.match)), `stale exemption, matches nothing: "${p.match}"`)
  }
})

/* ------------------------------------------------------------------
   The MIRROR of the test above.
   
   Offering Ctrl+B on a field and then printing its text raw is the same
   mismatch seen from the other end, and it is the one that actually shipped:
   `[Mercy]{radiant}` in a weapon's description rendered as the literal
   characters on four surfaces, while ItemTooltip — reading the SAME `flavor`
   string — coloured it correctly. Nothing looked broken; the markup simply
   sat there as text, and only a side-by-side comparison of two screens
   showing one item revealed it.

   Scanned, again, because the defect IS the call site: `{item.flavor}` is
   valid React that renders something plausible.
   ------------------------------------------------------------------ */

/** Field names whose value is authored through a `markdownShortcuts` textarea
 *  somewhere, so every render of them owes the reader the formatting. */
const MARKDOWN_FIELDS = ['flavor', 'desc', 'description']

/** Renders that are deliberately raw, and why. The bar is the AUTHORING
 *  surface: if no markdown-enabled textarea ever writes the field, printing it
 *  raw is correct and wrapping it would be cargo cult. */
const RAW_ON_PURPOSE: { match: string; why: string }[] = [
  { match: '{fd.desc}', why: 'op-schema field help — hardcoded in opSchema.ts, not DM-authored' },
  { match: '{p.description}', why: 'shard perk blurb — authored in a plain <input>, no shortcuts offered' },
]

test('A FIELD AUTHORED AS MARKDOWN IS RENDERED AS MARKDOWN, everywhere it appears', () => {
  const re = new RegExp(String.raw`>\{\s*([A-Za-z_$][A-Za-z0-9_.$]*\.(?:${MARKDOWN_FIELDS.join('|')}))\s*\}<`, 'g')
  const raw: string[] = []
  for (const f of tsxFiles()) {
    const src = readFileSync(join(ROOT, f), 'utf8')
    for (const m of src.matchAll(re)) {
      if (RAW_ON_PURPOSE.some(p => m[0].includes(p.match))) continue
      raw.push(`${f}:${src.slice(0, m.index).split('\n').length}  {${m[1]}}`)
    }
  }
  assert.deepEqual(raw, [],
    'These print markdown-authored prose as literal text — bold, links and '
    + '[colour]{tags} will show as source.\n'
    + 'Wrap in renderInline() (inline) or <Prose text={…}/> (paragraphs), or add '
    + 'to RAW_ON_PURPOSE with the reason nothing authors it as markdown:\n  ' + raw.join('\n  '))
})

test('every excuse in RAW_ON_PURPOSE still matches something', () => {
  const all = tsxFiles().map(f => readFileSync(join(ROOT, f), 'utf8')).join('\n')
  for (const p of RAW_ON_PURPOSE) {
    assert.ok(all.includes(p.match), `stale exemption, matches nothing: "${p.match}"`)
  }
})
