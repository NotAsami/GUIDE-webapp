// Run: node --test src/lib/markdown.test.ts
// (Node's built-in test runner + type stripping — no framework, no new dep.)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { Inline, ScopeContext, insertIcon, renderInline, Prose, toggleWrap, wrapLink } from './markdown.ts'

function html(nodes: ReactNode): string {
  return renderToStaticMarkup(createElement('div', null, nodes))
}

test('bold', () => {
  assert.equal(html(renderInline('a **b** c')), '<div>a <strong>b</strong> c</div>')
})

test('italics', () => {
  assert.equal(html(renderInline('a *b* c')), '<div>a <em>b</em> c</div>')
})

test('link with safe scheme', () => {
  const out = html(renderInline('see [here](https://example.com)'))
  assert.match(out, /<a href="https:\/\/example\.com" target="_blank" rel="noopener noreferrer">here<\/a>/)
})

test('javascript: link falls back to plain text', () => {
  const out = html(renderInline('see [here](javascript:alert)'))
  assert.equal(out, '<div>see here</div>')
  assert.doesNotMatch(out, /<a/)
})

test('unmatched marker renders literally', () => {
  assert.equal(html(renderInline('a * b')), '<div>a * b</div>')
})

test('paragraph splitting on blank lines', () => {
  const out = renderToStaticMarkup(createElement(Prose, { text: 'first\n\nsecond' }))
  assert.equal(out, '<div><p>first</p><p>second</p></div>')
})

test('heading levels', () => {
  assert.match(renderToStaticMarkup(createElement(Prose, { text: '# H1' })), /<h1>H1<\/h1>/)
  assert.match(renderToStaticMarkup(createElement(Prose, { text: '## H2' })), /<h2>H2<\/h2>/)
  assert.match(renderToStaticMarkup(createElement(Prose, { text: '### H3' })), /<h3>H3<\/h3>/)
})

test('heading immediately followed by body text, no blank line', () => {
  const out = renderToStaticMarkup(createElement(Prose, { text: '## Title\nbody text' }))
  assert.equal(out, '<div><h2>Title</h2><p>body text</p></div>')
})

/* ---------- inline colour: [text]{colour} ---------- */

test('a named colour resolves to its design token', () => {
  // The preferred form. A NAME survives a theme change; a hex does not, which
  // is the entire reason this table exists.
  assert.equal(
    html(renderInline('deals [Fire Damage]{fire} on a hit')),
    '<div>deals <span style="color:var(--danger-hot)">Fire Damage</span> on a hit</div>',
  )
})

test('every damage type the roll panel colours has a name here', () => {
  // These four are styled as `[data-t="…"]` in RollContextPanel.module.css. If
  // one is missing, prose about that damage type cannot match the number the
  // panel shows for it.
  for (const [type, token] of [['radiant', 'gold-rare'], ['fire', 'danger-hot'],
    ['psychic', 'violet-hot'], ['cold', 'teal']]) {
    assert.equal(html(renderInline(`[x]{${type}}`)),
      `<div><span style="color:var(--${token})">x</span></div>`)
  }
})

test('a raw design token and a raw hex both still resolve', () => {
  assert.equal(html(renderInline('[a]{--cyan-hot}')),
    '<div><span style="color:var(--cyan-hot)">a</span></div>')
  assert.equal(html(renderInline('[b]{#e2b021}')),
    '<div><span style="color:#e2b021">b</span></div>')
})

test('colour nests, so markers inside it still apply', () => {
  assert.equal(html(renderInline('[**Fire**]{fire}')),
    '<div><span style="color:var(--danger-hot)"><strong>Fire</strong></span></div>')
})

test('a link is still a link — ]( and ]{ do not collide', () => {
  assert.match(html(renderInline('[here](https://example.com)')), /<a href="https:\/\/example\.com"/)
})

test('an unknown colour renders the source verbatim', () => {
  // The security-relevant half: this is the only construct that reaches a style
  // attribute, so a near-miss must fail closed AND visibly, never be coerced.
  for (const bad of [
    '[x]{javascript:alert(1)}',
    '[x]{url(evil)}',
    '[x]{#zz}',           // not hex
    '[x]{#12345678}',     // too long
    '[x]{plaid}',         // not a name we know
    '[x]{--Bad_Token}',   // uppercase and underscore are outside the token shape
  ]) {
    const out = html(renderInline(bad))
    assert.equal(out, `<div>${bad}</div>`, `${bad} should render literally`)
    assert.doesNotMatch(out, /<span/, `${bad} must not reach a style attribute`)
  }
})

test('an unclosed or empty colour renders literally', () => {
  assert.equal(html(renderInline('[x]{fire')), '<div>[x]{fire</div>')
  assert.equal(html(renderInline('[x]{}')), '<div>[x]{}</div>')
  assert.equal(html(renderInline('[]{fire}')), '<div>[]{fire}</div>')
})

/* ---------- Ctrl+B / Ctrl+I ---------- */

const wrap = (t: string, a: number, b: number, m = '**') => toggleWrap(t, a, b, m)

test('wrapping a selection puts the markers around it and keeps the selection', () => {
  const r = wrap('deals fire damage', 6, 10)
  assert.equal(r.text, 'deals **fire** damage')
  assert.equal(r.text.slice(r.start, r.end), 'fire', 'the same words stay selected')
})

test('pressing it twice returns the original, rather than nesting', () => {
  // The toggle is the whole point: **** is not bolder, it is broken.
  const once = wrap('deals fire damage', 6, 10)
  const twice = wrap(once.text, once.start, once.end)
  assert.equal(twice.text, 'deals fire damage')
  assert.equal(twice.text.slice(twice.start, twice.end), 'fire')
})

test('it unwraps whether the markers are inside or outside the selection', () => {
  // Selecting the word and selecting the word-with-markers are both "this is
  // already bold" to a human, so both have to undo it.
  assert.equal(wrap('deals **fire** damage', 6, 14).text, 'deals fire damage')
  assert.equal(wrap('deals **fire** damage', 8, 12).text, 'deals fire damage')
})

test('with nothing selected it opens an empty pair and lands the caret inside', () => {
  const r = wrap('deals  damage', 6, 6)
  assert.equal(r.text, 'deals **** damage')
  assert.equal(r.start, 8)
  assert.equal(r.start, r.end, 'a caret, not a selection')
})

test('italics use the same machinery with a single marker', () => {
  const r = wrap('a whisper', 2, 9, '*')
  assert.equal(r.text, 'a *whisper*')
  assert.equal(wrap(r.text, r.start, r.end, '*').text, 'a whisper')
})

test('bold and italic nest rather than cancelling each other', () => {
  const b = wrap('fire', 0, 4)
  const i = wrap(b.text, b.start, b.end, '*')
  assert.equal(i.text, '***fire***')
})

// -- wrapLink (Ctrl+K) -------------------------------------------------------

test('wrapLink turns a selection into a link with the URL selected', () => {
  // The useful thing right after pressing Ctrl+K is to be typing the URL, so
  // that is what ends up selected.
  const r = wrapLink('see the docs', 4, 12)
  assert.equal(r.text, 'see [the docs](url)')
  assert.equal(r.text.slice(r.start, r.end), 'url')
})

test('wrapLink with nothing selected leaves the caret in the label', () => {
  const r = wrapLink('see ', 4, 4)
  assert.equal(r.text, 'see []()')
  assert.equal(r.start, 5)
  assert.equal(r.end, 5)
})

test('wrapLink toggles: pressing it on a link gives the label back', () => {
  const link = '[the docs](https://x.dev)'
  const r = wrapLink(`see ${link} now`, 4, 4 + link.length)
  assert.equal(r.text, 'see the docs now')
  assert.equal(r.text.slice(r.start, r.end), 'the docs')
})

test('wrapLink round-trips a selection', () => {
  const once = wrapLink('the docs', 0, 8)
  const back = wrapLink(once.text, 0, once.text.length)
  assert.equal(back.text, 'the docs')
})

/* ---------- a typed newline is a line break ---------- */

test('a single newline breaks the line, without a blank line or two spaces', () => {
  // Strict markdown collapses this into one paragraph. A DM typing into a
  // textarea pressed Enter and means it — the "two trailing spaces" rule is
  // not something anyone knows, and the description came out as one long line.
  const out = html(renderInline('first\nsecond'))
  assert.match(out, /first<br\/?>second/)
})

test('breaks compose with the rest of the inline syntax', () => {
  const out = html(renderInline('**bold**\n[Mercy]{radiant}'))
  assert.match(out, /<strong>bold<\/strong><br\/?>/)
  assert.match(out, /Mercy/)
})

test('Prose still separates PARAGRAPHS on a blank line', () => {
  // The two mechanisms are different: <br> inside a block, <p> between blocks.
  // Collapsing them would make every newline a paragraph, which is not the same
  // shape and loses the tighter spacing a break gives.
  const out = html(createElement(Prose, { text: 'one\ntwo\n\nthree' }))
  assert.equal((out.match(/<p>/g) || []).length, 2)
  assert.match(out, /one<br\/?>two/)
})

/* THE AMBIENT SCOPE.
   S25's `{...}` used to be honoured by exactly one of forty-one render sites -
   the Features screen, which had its own private `live()` helper - so a DM's
   "Add {level >= 17 ? 2d10 : 1d10} to Damage Roll" computed there and printed
   its braces in the item tooltip, the shop, the loot takeover and the roll
   panel. The renderer reads the scope now, so the default is correct and a
   screen cannot forget. */

const ROOT = fileURLToPath(new URL('../..', import.meta.url))

const inScope = (scope: Record<string, number | boolean>, node: ReactNode) =>
  renderToStaticMarkup(createElement(ScopeContext.Provider, { value: scope }, node))

test('PROSE COMPUTES AGAINST THE AMBIENT SCOPE', () => {
  const out = inScope({ level: 17 }, createElement(Prose, {
    text: 'Add {level >= 17 ? 2d10 : 1d10} to Damage Roll',
  }))
  assert.match(out, /Add 2d10 to Damage Roll/)
  assert.ok(!out.includes('{'), 'no authored braces reach the page')
})

test('the same text takes the other branch for a different character', () => {
  const out = inScope({ level: 7 }, createElement(Prose, {
    text: 'Add {level >= 17 ? 2d10 : 1d10} to Damage Roll',
  }))
  assert.match(out, /Add 1d10 to Damage Roll/)
})

test('<Inline> computes too — the same text in a one-line slot', () => {
  assert.match(
    inScope({ level: 7, prof: 3 }, createElement(Inline, { text: 'A **DC {8 + prof}** save' })),
    /A <strong>DC 11<\/strong> save/,
  )
})

test('WITH NO CHARACTER IN VIEW THE SOURCE SHOWS, which is what an author wants', () => {
  // The DM's catalogs render outside the provider. Printing a half-resolved
  // sentence there would hide the very thing being edited.
  const out = renderToStaticMarkup(createElement(Prose, { text: 'Deal {level}d6' }))
  assert.match(out, /Deal \{level\}d6/)
})

test('an unresolvable span survives verbatim rather than blanking', () => {
  const out = inScope({ level: 7 }, createElement(Inline, { text: 'Deal {levle}d6' }))
  assert.match(out, /Deal \{levle\}d6/)
})

test('NO PLAYER SCREEN CALLS THE BARE renderInline — that is how site 42 goes wrong', () => {
  /* The function stays exported and pure: markdown's own tests drive it, and
     the DM console deliberately uses it (nothing supplies a scope there, and
     its three call sites clip the text first, which could cut a computed span
     in half). Everything a PLAYER reads must go through <Inline>, or it is one
     more surface that silently shows source. */
  const AUTHORING_ONLY = ['src/screens/OperatorConsole.tsx', 'src/screens/FeatureEditor.tsx']
  const bad: string[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      if (e.isDirectory()) { walk(`${dir}/${e.name}`); continue }
      if (!e.name.endsWith('.tsx')) continue
      const f = `${dir}/${e.name}`
      if (AUTHORING_ONLY.includes(f)) continue
      const src = readFileSync(join(ROOT, f), 'utf8')
      for (const m of src.matchAll(/\brenderInline\s*\(/g)) {
        bad.push(`${f}:${src.slice(0, m.index).split('\n').length}`)
      }
    }
  }
  walk('src')
  assert.deepEqual(bad, [], `use <Inline text={...} /> so the text computes: ${bad.join(', ')}`)
})

/* THE INLINE ICON TOKEN, `[label]{icon name}`.
   The colour token's sibling, sharing its bracket-span grammar. It renders
   through <Icon> and no other path - painting a glyph here instead would be a
   second implementation of the thing CLAUDE.md names as the one that must not
   fork, and the game-icons half would go missing without a word. */

test('AN INLINE ICON RENDERS THROUGH <Icon>, BOTH SETS', () => {
  // Font Awesome is a class on an <i>; a game icon is the same <i> carrying a
  // mask. If the game-icons branch were ever bypassed this is where it shows.
  assert.match(html(renderInline('Deal []{icon fa-fire} damage')),
    /Deal <i class="fa-solid fa-fire"[^>]*><\/i> damage/)
  const gi = html(renderInline('[]{icon gi:lorc/screaming}'))
  assert.match(gi, /class="gicon"/)
  assert.match(gi, /--gi:url\(&quot;\/icons\/lorc\/screaming\.svg&quot;\)/)
})

test('a labelled icon keeps its word on the same line', () => {
  const out = html(renderInline('[Rage]{icon fa-fire} ends'))
  assert.match(out, /class="gicon-wrap"/)
  assert.match(out, /Rage/)
})

test('THE ICON TOKEN TAKES ITS OWN COLOUR', () => {
  const out = html(renderInline('[]{icon fa-fire fire}'))
  assert.match(out, /fa-solid fa-fire/)
  assert.match(out, /style="color:/, 'the palette name tints the glyph')
})

test('a labelled icon tints the glyph AND the word together', () => {
  const out = html(renderInline('[Fire]{icon fa-fire fire}'))
  assert.match(out, /<span class="gicon-wrap" style="color:[^"]+">/)
})

test('NESTING AN ICON IN A COLOUR SPAN DOES NOT WORK, and that is why the token has a colour', () => {
  /* The colour span matches its label with [^\]]+, which stops at the inner
     token closing bracket. The nested form parses as an icon followed by
     literal text - no crash, no silence, just not the composition it looks
     like. Pinned so nobody removes the colour argument believing nesting
     covers it. */
  const out = html(renderInline('[[]{icon fa-fire} Fire]{fire}'))
  assert.ok(!/<span style="color:/.test(out), 'the outer span never forms')
  assert.match(out, /Fire\]\{fire\}/, 'the remainder shows as written')
})

test('an unknown palette name leaves the glyph uncoloured rather than eating the token', () => {
  const out = html(renderInline('[]{icon fa-fire notacolour}'))
  assert.match(out, /fa-solid fa-fire/)
  assert.ok(!out.includes('style="color:'))
})

test('the label may itself carry markdown', () => {
  assert.match(html(renderInline('[**Rage**]{icon fa-fire}')), /<strong>Rage<\/strong>/)
})

test('an icon token does not steal from a link or a colour span', () => {
  // All three share the bracket shape, so the alternation order is load-bearing.
  assert.equal(html(renderInline('[a](https://x.test)')),
    '<div><a href="https://x.test" target="_blank" rel="noopener noreferrer">a</a></div>')
  assert.match(html(renderInline('[hot]{fire}')), /<span style="color:/)
})

test('a malformed icon token renders as written rather than vanishing', () => {
  // No name after the keyword: nothing matches, so the source shows. Silence
  // here would delete the author's text and look like a rendering bug.
  assert.equal(html(renderInline('[]{icon}')), '<div>[]{icon}</div>')
})

test('AN ICON SURVIVES INTERPOLATION — the two syntaxes do not fight', () => {
  // Interpolation runs first and owns `{...}`. `{icon fa-fire}` is not a valid
  // expression, and interpolate() leaves what it cannot resolve exactly as
  // written - which is the whole reason the token needs the bracket prefix.
  const out = inScope({ level: 7 }, createElement(Inline, {
    text: 'Level {level}: deal []{icon fa-fire} damage',
  }))
  assert.match(out, /Level 7: deal <i class="fa-solid fa-fire"/)
})

/* INSERTING the token. The picker supplies a name; this decides where it lands
   and where the caret goes after. Same contract as wrapLink - a shortcut that
   drops the caret to the end of the field is worse than no shortcut. */

test('inserting with nothing selected drops the glyph at the caret', () => {
  const r = insertIcon('Deal  damage', 5, 5, 'fa-fire')
  assert.equal(r.text, 'Deal []{icon fa-fire} damage')
  assert.equal(r.start, 5 + '[]{icon fa-fire}'.length, 'caret lands after the token')
  assert.equal(r.start, r.end, 'nothing left selected')
})

test('A SELECTION BECOMES THE LABEL — the gesture that makes a glyph-plus-word', () => {
  const r = insertIcon('Rage ends', 0, 4, 'fa-fire')
  assert.equal(r.text, '[Rage]{icon fa-fire} ends')
})

test('what it writes is what the parser reads', () => {
  // The two halves have to agree or the DM inserts something that renders as
  // source. Round-trip rather than assert on a hand-written string.
  const r = insertIcon('x', 1, 1, 'gi:lorc/screaming')
  const out = html(renderInline(r.text))
  assert.match(out, /class="gicon"/)
  assert.ok(!out.includes('{icon'), 'the inserted token parsed, it did not print')
})

test('a selection carrying markdown keeps it', () => {
  const r = insertIcon('**Rage** ends', 0, 8, 'fa-fire')
  assert.equal(r.text, '[**Rage**]{icon fa-fire} ends')
  assert.match(html(renderInline(r.text)), /<strong>Rage<\/strong>/)
})

test('EVERY PROSE FIELD SITS UNDER A MOUNTED TOOLBAR', () => {
  /* The button follows focus into any `data-prose` field, which `proseField()`
     stamps. A file that authors prose but never renders beneath a mounted
     <ProseToolbar/> gives the DM shortcuts and no way to reach the icon picker,
     and nothing about the screen looks wrong.

     Reachability, not the route table: OperatorShops authors prose and is not
     routed at all - it is a child of OperatorConsole, which is. So the check
     walks imports down from the routes that mount the toolbar. */
  const read = (f: string) => readFileSync(join(ROOT, f), 'utf8')
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      if (e.isDirectory()) walk(`${dir}/${e.name}`, out)
      else if (e.name.endsWith('.tsx')) out.push(`${dir}/${e.name}`)
    }
    return out
  }
  const files = walk('src')
  const byName = new Map(files.map(f => [f.split('/').pop()!.replace('.tsx', ''), f]))

  // Routes that mount the toolbar, and everything they pull in.
  const routes = read('src/routes.tsx')
  const roots = routes.split('\n')
    .filter(l => l.includes('<ProseToolbar />'))
    .flatMap(l => [...l.matchAll(/<([A-Z]\w+) \/>/g)].map(m => m[1]))
    .filter(n => n !== 'ProseToolbar' && byName.has(n))
  assert.ok(roots.length >= 3, `only ${roots.length} routes mount the toolbar`)

  const covered = new Set<string>()
  const visit = (name: string) => {
    if (covered.has(name)) return
    covered.add(name)
    const f = byName.get(name)
    if (!f) return
    for (const m of read(f).matchAll(/^import .*?from '\.[^']*\/([A-Z]\w+)'/gm)) visit(m[1])
    for (const m of read(f).matchAll(/^import \{([^}]*)\} from '\.[^']*'/gm)) {
      for (const part of m[1].split(',')) {
        const n = part.trim().replace(/^type\s+/, '')
        if (/^[A-Z]/.test(n) && byName.has(n)) visit(n)
      }
    }
  }
  roots.forEach(visit)

  const orphaned = files
        // The SPREAD, not the bare name: ProseToolbar's own comment names the
    // helper it looks for, and matching that made the toolbar report itself.
    .filter(f => read(f).includes('{...proseField('))
    .map(f => f.split('/').pop()!.replace('.tsx', ''))
    .filter(n => !covered.has(n))
  assert.deepEqual(orphaned, [],
    `these author prose out of the toolbar's reach: ${orphaned.join(', ')}`)
})

/* NESTING INSIDE BOLD AND ITALICS.
   These two branches used to hand their contents through as a raw string, so
   everything nested in them printed as source. Reported as "icons don't render
   in bold", which was the visible half of "nothing renders in bold". */

test('AN ICON RENDERS INSIDE BOLD', () => {
  const out = html(renderInline('**[]{icon fa-fire} Rage**'))
  assert.match(out, /<strong>.*fa-solid fa-fire.*<\/strong>/)
  assert.ok(!out.includes('{icon'), 'the token parsed rather than printing')
})

test('and inside italics, and with a label', () => {
  assert.match(html(renderInline('*[Rage]{icon fa-fire}*')), /<em>.*fa-solid fa-fire.*Rage.*<\/em>/)
})

test('the other inline syntaxes nest in bold too — it was never icon-specific', () => {
  assert.match(html(renderInline('**[hot]{fire}**')), /<strong><span style="color:[^"]+">hot<\/span><\/strong>/)
  assert.match(html(renderInline('**[a](https://x.test)**')), /<strong><a href="https:\/\/x\.test"/)
})

test('a colour span inside bold survives BOTH ways round', () => {
  assert.match(html(renderInline('[**hot**]{fire}')), /<span style="color:[^"]+"><strong>hot<\/strong><\/span>/)
})

test('plain bold is untouched', () => {
  assert.equal(html(renderInline('a **b** c')), '<div>a <strong>b</strong> c</div>')
})

/* ---- `---` IS A DIVIDER, and an em-dash sentence is not ----
   The risk in this token is entirely the false positive: these descriptions are
   full of em-dashes and hyphenated words, and a rule that fired mid-sentence
   would cut a paragraph in half with no error to say why. */

test('a line of three hyphens becomes a divider', () => {
  const out = renderToStaticMarkup(createElement(Prose, { text: 'before\n---\nafter' }))
  assert.match(out, /<p>before<\/p><hr\/?><p>after<\/p>/)
})

test('it splits the paragraph rather than landing inside one', () => {
  const out = renderToStaticMarkup(createElement(Prose, { text: 'a\nb\n---\nc' }))
  // a and b are one paragraph joined by a line break; the rule closes it.
  assert.match(out, /<p>a<br\/?>b<\/p><hr\/?>/)
})

test('more than three hyphens still rules, and surrounding space is tolerated', () => {
  assert.match(renderToStaticMarkup(createElement(Prose, { text: 'a\n-----\nb' })), /<hr\/?>/)
  assert.match(renderToStaticMarkup(createElement(Prose, { text: 'a\n  ---  \nb' })), /<hr\/?>/)
})

test('A SENTENCE IS NEVER A DIVIDER — the false positives that would matter', () => {
  for (const text of [
    'minimum +1 — currently +3',       // the em-dash these descriptions are full of
    'a --- b',                          // hyphens with words on the line
    'well---known',                     // no spaces at all
    '--',                               // two is not three
    'Str -- Dex',
  ]) {
    const out = renderToStaticMarkup(createElement(Prose, { text }))
    assert.ok(!out.includes('<hr'), `"${text}" must not rule`)
  }
})

test('the divider does not exist inline — three hyphens mid-string stay text', () => {
  assert.equal(html(renderInline('a --- b')), '<div>a --- b</div>')
})

/* ---- SPACING TOKENS ----
   HTML collapses runs of spaces, so an author lining up two columns in a
   textarea had no way to ask for the gap. */

test('&nbsp; and &emsp; become their characters', () => {
  assert.equal(html(renderInline('Reach&nbsp;10 ft.')), '<div>Reach 10 ft.</div>')
  assert.equal(html(renderInline('Str&emsp;18')), '<div>Str 18</div>')
})

test('they survive nesting, like every other token here', () => {
  assert.match(html(renderInline('**Str&emsp;18**')), /<strong>Str 18<\/strong>/)
  assert.match(html(renderInline('[Str&nbsp;18]{fire}')), /<span style="color:[^"]+">Str 18<\/span>/)
})

test('a lone ampersand or a half-written token is left alone', () => {
  assert.equal(html(renderInline('Tom & Jerry')), '<div>Tom &amp; Jerry</div>')
  assert.equal(html(renderInline('&nbsp')), '<div>&amp;nbsp</div>')
  assert.equal(html(renderInline('&emsp')), '<div>&amp;emsp</div>')
})

test('NO OTHER ENTITY IS DECODED — these are names for characters, not HTML', () => {
  /* The parser returns React nodes and never interprets markup; that is what
     makes it injection-safe. Two recognised tokens must not read as "entities
     work now". */
  assert.equal(html(renderInline('&lt;script&gt;')), '<div>&amp;lt;script&amp;gt;</div>')
  assert.equal(html(renderInline('&amp;')), '<div>&amp;amp;</div>')
})
