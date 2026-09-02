/**
 * TWO PROSE REGISTERS, and only one of them is a class.
 *
 * The slant used to be a per-stylesheet habit: eleven blocks each declared
 * `font-style: italic` because the one beside them did. Italic became the body
 * text of the app, which meant it could no longer MEAN anything — an authored
 * `*Intelligence*` read as ordinary prose in a slightly different colour — and
 * `**bold**` fell out of the slant entirely, because the font was requested
 * without a single italic face above 400.
 *
 * The rule now: RULES is the default and needs no class; VOICE is the deviation
 * and says so, with `.prose-voice` from global.css. A `.module.css` that
 * declares the slant itself is the twelfth block deciding on its own, so this
 * fails on it.
 *
 * WHY A TEST RATHER THAN A CONVENTION. This is the same defect the icons and
 * prose-field guards already catch in two other materials: a value with two
 * render paths where only one gets upgraded, failing silently — no error, no
 * fallback, just text that looks deliberate and is wrong. Nothing about a new
 * `font-style: italic` in a stylesheet announces itself.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(import.meta.dirname, '..')

/**
 * A serif italic that is NOT authored prose, and so is not in the register
 * system at all. Each entry says why — a stale one fails its own test below,
 * the way every other guard here works.
 *
 * The line these draw is the one that matters: the register system covers text
 * a DM WROTE, which is exactly the text that reaches the screen through
 * `<Inline>` or `<Prose>`. App-generated chrome that happens to be set in the
 * prose face is styling, not a claim about a voice.
 */
const NOT_PROSE: Record<string, string> = {
  'components/RollContextPanel.module.css:.eFlavor':
    'The roll entry subtitle, printed raw. Never authored — it is app copy ' +
    '("Ability Check", "Cantrip", "Daily resources restored") from the addRoll ' +
    'call sites, so there is no field to assign a register to.',
  'components/RollContextPanel.module.css:.catDm .v':
    'Dead rule. Only the unrelated .catDmg is mounted; .catDm has no markup.',
  'components/LootTakeover.module.css:.leSub':
    'The empty-state sentence, a literal in LootTakeover.tsx, not a field.',
  'components/LootTakeover.module.css:.assignRow .who':
    'A player name, not prose.',
  'components/LootRollOverlay.module.css:.assigned .who':
    'A player name, not prose.',
  'components/ShopTakeover.module.css:.toastInner .nm':
    'An item name in the acquisition toast, not prose.',
  'components/PrimeSheet.module.css:.flavor':
    'The prime sheet subtitle — the weapon or spell being rolled, printed raw.',
  'screens/Spellbook.module.css:.daCell .dcV .mat':
    'The material component parenthetical ("a pinch of soot"), a fragment of ' +
    'the spell row rather than a prose field of its own.',
  'components/authoring.module.css:.originAuto':
    'An operator-side "derived automatically" hint. DM chrome, never player prose.',
  'screens/Shard.module.css:.scBuffs.italic':
    'The empty-slot placeholder line on a shard card — a literal in Shard.tsx, ' +
    'swapped in for the mono buff list when there is nothing slotted.',

  /* THE OPERATOR CATALOG'S LISTING CELLS. These three do run authored text
     through renderInline, so the exemption is worth stating carefully: they are
     clipped SUMMARIES in a dense DM-side list (60-180 chars, beige-dim, 12px),
     and the same class also carries plain labels like a category or a spell
     school. The slant there says "this cell is a description", which is list
     chrome — it is not a claim about a voice, and no player ever sees it. The
     register is about what the PLAYER reads. */
  'screens/OperatorConsole.module.css:.efPrev .pm .pr':
    'Operator effect-preview summary, clipped to 90 chars beside a fallback literal.',
  'screens/OperatorConsole.module.css:.efRefSum.prose':
    'Operator catalog row summary of an effect description, clipped to 180 chars.',
  'screens/OperatorConsole.module.css:.catRow .crS.prose':
    'Operator catalog row summary, clipped to 62 chars; the class also holds ' +
    'plain labels (category, spell school) in the same column.',
}

function cssFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) cssFiles(p, out)
    else if (name.endsWith('.module.css')) out.push(p)
  }
  return out
}

/** Every `selector { … }` block that sets the slant, as `selector` → true. */
function italicSelectors(css: string): string[] {
  const out: string[] = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(css)) !== null) {
    if (!/font-style:\s*italic/.test(m[2])) continue
    for (const sel of m[1].split(',')) {
      const s = sel.replace(/\/\*[\s\S]*?\*\//g, '').trim()
      if (s) out.push(s)
    }
  }
  return out
}

const found = new Map<string, string>()
for (const file of cssFiles(SRC)) {
  const rel = file.slice(SRC.length + 1).replace(/\\/g, '/')
  for (const sel of italicSelectors(readFileSync(file, 'utf8'))) found.set(`${rel}:${sel}`, rel)
}

test('THE SLANT IS NOT A STYLESHEET DECISION — voice asks for it by class', () => {
  const rogue = [...found.keys()].filter(k => !(k in NOT_PROSE))
  assert.deepEqual(
    rogue, [],
    'These rules set `font-style: italic` themselves. If the text is a DM-authored\n' +
    'field rendered through <Inline> or <Prose>, drop the declaration and add the\n' +
    "global `prose-voice` class in the markup instead (className={`${styles.x}\n" +
    'prose-voice`}). If it is app chrome that merely uses the prose face, add it to\n' +
    'NOT_PROSE above with the reason.',
  )
})

test('the scanner actually sees the stylesheets', () => {
  // Without this, a broken path or a renamed extension turns the guard above
  // into a test that passes because it looked at nothing.
  assert.ok(cssFiles(SRC).length > 20, 'expected the app\'s .module.css files')
  assert.ok(found.size > 0, 'expected to find at least one italic rule')
})

test('every excuse in NOT_PROSE still matches something', () => {
  const stale = Object.keys(NOT_PROSE).filter(k => !found.has(k))
  assert.deepEqual(
    stale, [],
    'These exemptions no longer match a rule — the selector was renamed or the\n' +
    'italic was removed. Delete the entry.',
  )
})

test('the voice register is defined exactly once, globally', () => {
  const global = readFileSync(join(SRC, 'styles/global.css'), 'utf8')
  assert.match(global, /\.prose-voice\s*\{[^}]*font-style:\s*italic/,
    '.prose-voice must carry the slant')
  // Emphasis works by CONTRAST with its surroundings, so inside an italic
  // passage the emphatic face is the upright one. Without this, `*word*` inside
  // voice text is invisible — italic inside italic.
  assert.match(global, /\.prose-voice em\s*\{[^}]*font-style:\s*normal/,
    'emphasis inside voice text must go roman, or *word* renders as nothing')
})

test('the bold-italic faces are actually loaded', () => {
  /* THE ORIGINAL BUG, and the one thing here that is not a style choice.
     `strong` is 600; a 600 inside an italic block with no italic face above 400
     falls back to the UPRIGHT 600, so bold text jumped out of the slant. */
  const html = readFileSync(join(SRC, '..', 'index.html'), 'utf8')
  const link = /EB\+Garamond:ital,wght@([^&"]+)/.exec(html)
  assert.ok(link, 'expected an EB Garamond request in index.html')
  for (const w of ['1,500', '1,600', '1,700']) {
    assert.ok(link[1].includes(w), `italic ${w.slice(2)} must be requested — bold voice text needs it`)
  }
})
