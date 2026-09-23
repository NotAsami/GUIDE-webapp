// Run: node --test src/lib/loreDoc.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cardsOf, creep, integrityOf, overallIntegrity, parseLore, placesOf, plainText } from './loreDoc.ts'

// The shape World Anvil exports convert to: quote, intro, # groups, ## sections.
const ARTICLE = `> *"He doesn't talk much about the war."*
> — An old fisherman, anonymous

**Ros Chrisstone** is the mayor of Castella.

# Physical Description

## Facial Features

The most notable feature is the **scar**.

## Special Abilities

**Dual-Wielding Claymores** - Two massive swords.

**Crisis Management** - Stays calm.

---

# Personality Characteristics

## Likes & Dislikes

**Likes:**

**Cats** - His orange tabby, Ember.

**Dislikes:**

**The Sea** - It reminds him of the war.

## Motivation

What Ros wants is **acceptance**.

**Not a card** - but this section is prose, so this line stays prose too.`

test('groups and sections come from # and ##; the text before them is the intro', () => {
  const d = parseLore(ARTICLE)
  assert.deepEqual(d.groups.map(g => g.name), ['Physical Description', 'Personality Characteristics'])
  assert.deepEqual(d.groups[0].sections.map(s => s.name), ['Facial Features', 'Special Abilities'])
  assert.match(d.intro, /^> \*"He doesn't/)
  assert.match(d.intro, /mayor of Castella/)
})

test('a section is cards only when EVERY paragraph is a **Name** - text line', () => {
  const [phys, pers] = parseLore(ARTICLE).groups
  assert.equal(phys.sections[0].cards, null)                         // plain prose
  assert.deepEqual(phys.sections[1].cards?.map(c => c.name), ['Dual-Wielding Claymores', 'Crisis Management'])
  // One card-shaped line inside a prose section must not turn the section into cards.
  assert.equal(pers.sections[1].cards, null)
})

test('**Likes:** / **Dislikes:** labels carry onto the cards under them', () => {
  const cards = parseLore(ARTICLE).groups[1].sections[0].cards!
  assert.deepEqual(cards.map(c => [c.name, c.label]), [['Cats', 'Likes'], ['The Sea', 'Dislikes']])
})

test('a parenthetical after the name is kept as a note', () => {
  const cards = cardsOf('**Mira Saltwhisper** (Guild Office) - Cordial.\n\n**Mother** - Strained.')!
  assert.deepEqual(cards[0], { name: 'Mira Saltwhisper', note: 'Guild Office', text: 'Cordial.' })
})

test('one card is not a set: a single matching line stays prose', () => {
  assert.equal(cardsOf('**Only** - one.'), null)
})

test('an article with no headings is all intro — no groups, so no contents rail', () => {
  const d = parseLore('Just a paragraph.\n\nAnd another.')
  assert.equal(d.groups.length, 0)
  assert.equal(d.intro, 'Just a paragraph.\n\nAnd another.')
  assert.deepEqual(parseLore(undefined), { intro: '', groups: [] })
})

test('a ## before any # still lands in a group, and prose under a # is kept', () => {
  const d = parseLore('## Early Years\n\nA town.\n\n# War\n\nIt was naval.\n\n## After\n\nPeace.')
  assert.equal(d.groups[0].name, '')
  assert.equal(d.groups[0].sections[0].name, 'Early Years')
  assert.equal(d.groups[1].sections[0].body, 'It was naval.')     // untitled first section of "War"
  assert.equal(d.groups[1].sections[1].name, 'After')
})

test('a heading without a blank line before it still starts its section', () => {
  assert.deepEqual(parseLore('# A\n## B\ntext').groups[0].sections.map(s => [s.name, s.body]), [['B', 'text']])
})

test('section ids are unique even when two headings share a name', () => {
  const ids = parseLore('# G\n\n## Notes\n\na\n\n# H\n\n## Notes\n\nb').groups.flatMap(g => g.sections.map(s => s.id))
  assert.equal(new Set(ids).size, ids.length)
})

test('integrity defaults to 100, clamps, and ignores junk', () => {
  assert.equal(integrityOf(undefined, 'X'), 100)
  assert.equal(integrityOf({ X: 39 }, 'X'), 39)
  assert.equal(integrityOf({ X: 140 }, 'X'), 100)
  assert.equal(integrityOf({ X: -5 }, 'X'), 0)
  assert.equal(integrityOf({ X: Number.NaN }, 'X'), 100)
})

test('overall integrity weights sections by how much they say', () => {
  const d = parseLore('# G\n\n## Long\n\n' + 'x'.repeat(300) + '\n\n## Short\n\n' + 'y'.repeat(100))
  assert.equal(overallIntegrity(d, { Long: 0 }), 25)
  assert.equal(overallIntegrity(d, {}), 100)
})

test('THE CREEP: 100% is always pure ink and 0% always pure bits, at every tick', () => {
  const text = 'He rose to leadership through competence and bravery, commanding a unit.'
  for (let tick = 0; tick < 400; tick++) {
    assert.ok(creep(text, 100, tick).every(r => !r.bit), `ink broke at tick ${tick}`)
    assert.equal(creep(text, 0, tick).filter(r => !r.bit).map(r => r.t).join('').trim(), '', `a letter survived 0% at tick ${tick}`)
  }
})

test('the creep keeps the text length, turns only letters to 1s and 0s, and keeps spaces', () => {
  const text = 'A debt unpaid festers.'
  const runs = creep(text, 50, 7)
  assert.equal(runs.map(r => r.t).join('').length, text.length)
  for (const r of runs.filter(r => r.bit)) assert.match(r.t, /^[01]+$/)
  assert.equal(runs.map(r => r.t).join('').split(' ').length, text.split(' ').length)
})

test('less memory means more bits', () => {
  const text = 'x'.repeat(2000)
  const bits = (rem: number) => creep(text, rem, 3).filter(r => r.bit).reduce((n, r) => n + r.t.length, 0)
  assert.ok(bits(80) < bits(40) && bits(40) < bits(10))
})

test('plainText drops markdown markers but keeps the words', () => {
  assert.equal(plainText('**bold** *it* ***both*** [link](https://x) [red]{danger}'), 'bold it both link red')
})

test('places: homeland first, then quest locations with their quests and givers', () => {
  const places = placesOf([
    { id: '1', title: 'Clear Your Name', status: 'active', location: 'Brettany', given_by: 'Magistrate Voss' },
    { id: '2', title: 'Arrival', status: 'completed', location: 'brettany ', given_by: '' },
    { id: '3', title: 'Stolen Tome', status: 'active', location: 'Davelguay', given_by: 'The Lady' },
    { id: '4', title: 'Nowhere', status: 'active', location: '', given_by: 'X' },
  ], 'Castella')
  assert.deepEqual(places.map(p => [p.name, p.home, p.quests.length]), [['Castella', true, 0], ['Brettany', false, 2], ['Davelguay', false, 1]])
  assert.deepEqual(places[1].people, ['Magistrate Voss'])
})
