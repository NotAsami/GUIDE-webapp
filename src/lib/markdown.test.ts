// Run: node --test src/lib/markdown.test.ts
// (Node's built-in test runner + type stripping — no framework, no new dep.)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { renderInline, Prose } from './markdown.ts'

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
  const out = renderToStaticMarkup(Prose({ text: 'first\n\nsecond' }) as any)
  assert.equal(out, '<div><p>first</p><p>second</p></div>')
})

test('heading levels', () => {
  assert.match(renderToStaticMarkup(Prose({ text: '# H1' }) as any), /<h1>H1<\/h1>/)
  assert.match(renderToStaticMarkup(Prose({ text: '## H2' }) as any), /<h2>H2<\/h2>/)
  assert.match(renderToStaticMarkup(Prose({ text: '### H3' }) as any), /<h3>H3<\/h3>/)
})

test('heading immediately followed by body text, no blank line', () => {
  const out = renderToStaticMarkup(Prose({ text: '## Title\nbody text' }) as any)
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
