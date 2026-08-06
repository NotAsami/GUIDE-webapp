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
