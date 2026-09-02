import { Fragment, createContext, createElement, useContext, type ReactNode } from 'react'
import { colorOf } from './palette.ts'
import { Icon } from '../components/Icon.ts'
import { interpolate, type ExprScope } from './expr.ts'

/**
 * THE LIVE SCOPE, supplied once and read by the renderer.
 *
 * S25 lets a DM write `{level >= 17 ? 2d10 : 1d10}` into any authored string.
 * Honouring it was left to each call site, and exactly one call site did it -
 * the Features screen, with a private `live()` helper - so the same sentence
 * computed there and printed its own braces in the item tooltip, the loot
 * takeover, the shop, the effects sidebar and the level-up overlay. Forty-one
 * render sites, one of them correct.
 *
 * Passing a scope prop to all forty-one would fix today and rot tomorrow: the
 * forty-second is written without it and nothing complains. Reading it from
 * context instead makes the DEFAULT correct - `<Prose>` needs no argument, and
 * a screen that renders authored text cannot forget.
 *
 * Null means "no character in view", which is the honest answer on the DM's
 * authoring screens: their preview builds its own scope (lib/previewScope.ts)
 * and nothing else there has a character to resolve against. Text then renders
 * exactly as authored, which is what an author wants to see.
 */
export const ScopeContext = createContext<ExprScope | null>(null)

/** Interpolate against the ambient scope, or pass the text through untouched. */
function useLive(text: string): string {
  const scope = useContext(ScopeContext)
  return scope ? interpolate(text, scope).text : text
}

/** Only these schemes render as a real link; anything else (e.g. `javascript:`)
 *  falls back to plain text since the parser returns React nodes directly. */
function isSafeUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) || url.startsWith('/')
}

/** Lightweight inline markdown → React nodes: **bold**, *italics*, [text](url),
 *  `[text]{colour}`, and the spacing tokens `&nbsp;` / `&emsp;` (no raw HTML,
 *  so it's injection-safe). Unmatched markers
 *  render literally. Uses `createElement` instead of JSX so this stays a plain
 *  `.ts` file — that lets `node --test` run markdown.test.ts with no build step.
 *
 *  The colour span borrows the bracketed-span shape markdown extensions already
 *  use, so `]{` and `](` are the only thing separating it from a link — they
 *  cannot both match at one position, so the alternation order does not matter.
 *
 *  THE ICON TOKEN IS THE COLOUR TOKEN'S SIBLING, deliberately. `{...}` alone
 *  was unavailable: interpolation already owns braces and it runs BEFORE this,
 *  so `{icon fa-fire}` would arrive here only by surviving a failed expression
 *  parse - working by accident of an error path. Reusing the bracket-span
 *  grammar costs the parser one branch and the author no new shape, and the
 *  empty label `[]{icon fa-fire}` reads as "just the glyph".
 *
 *  IT TAKES ITS OWN COLOUR, `[]{icon fa-fire fire}`, because nesting cannot
 *  reach it. An icon is painted with `currentColor`, so in principle wrapping
 *  one in a colour span would tint it - but `[text]{colour}` matches its label
 *  with `[^\]]+`, which stops dead at the inner token's `]`. The nested form
 *  parses as an icon followed by the literal text `Fire]{fire}`. A second word
 *  in the braces costs one optional group and works; the palette name is the
 *  same vocabulary `[text]{colour}` uses, and an unknown one is ignored rather
 *  than swallowing the token. */
export function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  /* A single newline is a LINE BREAK. Strict markdown collapses it and wants
     two trailing spaces or a blank line, which is a rule nobody typing into a
     textarea knows or should have to: a DM who pressed Enter once expects a new
     line, and got one long paragraph instead. Blank-line paragraph breaks are
     still <Prose>'s job — this is only the break inside a block. */
  const re = /\n|&nbsp;|&emsp;|\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]*)\]\{icon\s+([^}\s]+)(?:\s+([^}\s]+))?\}|\[([^\]]+)\]\(([^)\s]+)\)|\[([^\]]+)\]\{([^}\s]+)\}/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    if (m[0] === '\n') out.push(createElement('br', { key: i++ }))
    /* SPACING TOKENS, and deliberately NOT entity decoding. Nothing in this
       parser ever interprets markup — returning React nodes is the whole reason
       it is injection-safe — so these are not `&…;` escapes being resolved.
       They are five characters recognised as a NAME for one character, exactly
       the way `[]{icon fa-fire}` is a name for a glyph. Adding them buys no
       path to `&lt;script&gt;`, because there is no path at all.

       They earn their place because HTML collapses runs of spaces: an author
       lining up a two-column stat block in a textarea got one long line back,
       and had no way to ask for the gap. The cost is the one every token here
       already pays — a DM writing ABOUT the syntax cannot type the word
       literally any more. */
    else if (m[0] === '&nbsp;') out.push('\u00a0')
    else if (m[0] === '&emsp;') out.push('\u2003')
    /* RECURSED, like the colour span beside them. These two were the only
       branches handing their contents straight through as a string, so anything
       nested inside bold or italics printed as source - `**[]{icon fa-fire}
       Rage**` showed the token, and a link or a colour span inside bold did the
       same. It reads as "icons do not work in bold", which is a fair reading of
       what it did and the wrong diagnosis: nothing at all worked in bold.
       Terminates for the same reason the colour branch does: `[^*]+` cannot
       match the markers it sits between, so the inner text is strictly
       shorter. */
    else if (m[1] !== undefined) out.push(createElement('strong', { key: i++ }, ...renderInline(m[1])))
    else if (m[2] !== undefined) out.push(createElement('em', { key: i++ }, ...renderInline(m[2])))
    else if (m[4] !== undefined) {
      /* A LABELLED icon is one unit: the glyph and its word must not break
         across a line, or a list of conditions wraps mid-name and the orphaned
         glyph reads as a bullet. An unlabelled one is simply the glyph. */
      // An unknown palette name leaves the glyph inheriting its surroundings,
      // which is the same forgiving behaviour `[text]{colour}` already has.
      const tint = m[5] ? colorOf(m[5]) : undefined
      const glyph = createElement(Icon, {
        key: i++, name: m[4], ...(tint ? { style: { color: tint } } : {}),
      })
      out.push(m[3]
        ? createElement('span', {
            key: i++, className: 'gicon-wrap', ...(tint ? { style: { color: tint } } : {}),
          }, glyph, '\u00a0', ...renderInline(m[3]))
        : glyph)
    }
    else if (m[8] !== undefined) {
      const color = colorOf(m[9])
      // Nested, so `[**Fire**]{fire}` still bolds. `[^\]]+` cannot match a
      // closing bracket, so the inner text is strictly shorter and this
      // terminates. An unresolvable colour renders the source verbatim.
      if (color) out.push(createElement('span', { key: i++, style: { color } }, renderInline(m[8])))
      else out.push(m[0])
    } else if (isSafeUrl(m[7])) {
      out.push(createElement('a', { key: i++, href: m[7], target: '_blank', rel: 'noopener noreferrer' }, m[6]))
    } else {
      out.push(m[6])
    }
    last = re.lastIndex
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** `renderInline` as a COMPONENT, so it can read the scope from context.
 *
 *  The plain function stays exported and pure - markdown.test.ts drives it
 *  directly, and a caller that genuinely has no character (an authoring
 *  preview rendering its own scope) still wants it. But the default a screen
 *  reaches for should be the one that computes, so every player-facing call
 *  site uses this. */
export function Inline({ text }: { text: string }) {
  return createElement(Fragment, null, ...renderInline(useLive(text)))
}

const HEADING_RE = /^(#{1,3})\s+(.*)$/

/** A LINE that is nothing but hyphens is a divider — a beat between two
 *  thoughts in the same block, drawn in global.css as a rule that breaks around
 *  a small diamond rather than a border across the card.
 *
 *  Three or more, and NOTHING else on the line, which is what keeps it safe:
 *  the em-dash sentences these descriptions are full of ("minimum +1 — currently
 *  +3") never sit alone on a line, and a hyphenated word broken across one
 *  cannot match either. Deliberately not `***` or `___`: `***` collides head-on
 *  with bold-wrapping-italic, and `---` is the spelling every author already
 *  knows from every other markdown box they have ever typed into.
 *
 *  IT LIVES HERE, not in `renderInline`, because a divider is a claim about a
 *  whole LINE and renderInline has no concept of one — it walks a string and
 *  would happily match three hyphens mid-sentence. Same reason the heading
 *  branch is here, and it sits BEFORE that branch only because both are
 *  line-shaped and neither can match what the other does. */
const RULE_RE = /^-{3,}$/

/** Render prose with blank-line paragraph breaks, `#`/`##`/`###` headings, a
 *  `---` divider, and inline markdown. A heading line inside a block starts its
 *  own element even without a surrounding blank line, so `## Title\nbody` needs
 *  no blank line. */
export function Prose({ text, className }: { text: string; className?: string }) {
  const blocks = useLive(text).split(/\n\s*\n/).filter(Boolean)
  const elements: ReactNode[] = []
  let key = 0
  let paraLines: string[] = []
  const flushPara = () => {
    if (paraLines.length) elements.push(createElement('p', { key: key++ }, renderInline(paraLines.join('\n'))))
    paraLines = []
  }
  for (const block of blocks) {
    for (const line of block.split('\n')) {
      if (RULE_RE.test(line.trim())) {
        flushPara()
        elements.push(createElement('hr', { key: key++ }))
        continue
      }
      const heading = HEADING_RE.exec(line)
      if (heading) {
        flushPara()
        elements.push(createElement(`h${heading[1].length}`, { key: key++ }, renderInline(heading[2])))
      } else {
        paraLines.push(line)
      }
    }
    flushPara()
  }
  return createElement('div', { className }, elements)
}

/** Wrap or unwrap a selection in a markdown marker — the Ctrl+B / Ctrl+I edit.
 *
 *  Pure, and separate from the keyboard handler, because the interesting part is
 *  the string arithmetic: it TOGGLES, so pressing the shortcut twice returns the
 *  text you started with rather than nesting `****bold****`. Two ways a selection
 *  can already be bold and both must unwrap — the markers inside the selection
 *  (`**bold**` selected whole) or outside it (`bold` selected within `**bold**`).
 *
 *  Returns the new text and where the selection should sit afterwards, so the
 *  caller can restore it — an editor that drops your cursor to the end on every
 *  shortcut is worse than no shortcut.
 *
 *  With nothing selected it inserts the empty pair and puts the caret between
 *  them, which is what every editor does and what makes it usable mid-sentence. */
/**
 * Ctrl+K — wrap a selection as a markdown link, or unwrap one.
 *
 * Not `toggleWrap`, because a link is not a symmetric marker: the text and the
 * destination are two different slots, and the useful thing after pressing it
 * is to be typing the URL. So a selection becomes `[selection](url)` with `url`
 * SELECTED, ready to be replaced.
 *
 * Toggles, like the other shortcuts: pressing it on an existing `[a](b)` gives
 * back `a`. With nothing selected it inserts the empty pair and puts the caret
 * in the label, which is where you start typing.
 */
const LINK_RE = /^\[([^\]]*)\]\(([^)\s]*)\)$/
const URL_PLACEHOLDER = 'url'

export function wrapLink(
  text: string, start: number, end: number,
): { text: string; start: number; end: number } {
  const sel = text.slice(start, end)

  // Selected a whole link: unwrap it back to its label.
  const inner = LINK_RE.exec(sel)
  if (inner) {
    const label = inner[1]
    return { text: text.slice(0, start) + label + text.slice(end), start, end: start + label.length }
  }

  if (!sel) {
    const ins = '[]()'
    return { text: text.slice(0, start) + ins + text.slice(end), start: start + 1, end: start + 1 }
  }

  const ins = `[${sel}](${URL_PLACEHOLDER})`
  const urlAt = start + sel.length + 3
  return {
    text: text.slice(0, start) + ins + text.slice(end),
    start: urlAt,
    end: urlAt + URL_PLACEHOLDER.length,
  }
}

/**
 * Insert `[]{icon name}` at the caret, or wrap the selection as its label.
 *
 * The same contract as `wrapLink`: pure string arithmetic, returning where the
 * selection should sit afterwards so the caller can restore it. A shortcut that
 * drops the caret to the end of the field is worse than no shortcut.
 *
 * WRAPPING, not just inserting, because the two things a DM does with a glyph
 * are different. Mid-sentence they want the icon alone. With a word selected
 * they want that word labelled - `Rage` becomes `[Rage]{icon fa-fire}`, which
 * renders glyph-then-word as one unbreakable unit. Selecting first is the
 * natural gesture for the second case and costs nothing in the first.
 *
 * Toggling is deliberately absent. Bold has an obvious inverse; an icon does
 * not - "un-icon" would have to guess whether to keep the label, and the DM
 * pressing Ctrl+Z already has the answer.
 *
 * No colour argument here. The picker chooses a glyph, and `[]{icon fa-fire fire}`
 * is a second word the author adds when they want it - putting a colour control
 * in the insert flow would make every insertion a two-part decision.
 */
export function insertIcon(
  text: string, start: number, end: number, name: string,
): { text: string; start: number; end: number } {
  const label = text.slice(start, end)
  const token = `[${label}]{icon ${name}}`
  const at = start + token.length
  return { text: text.slice(0, start) + token + text.slice(end), start: at, end: at }
}

export function toggleWrap(
  text: string, start: number, end: number, marker: string,
): { text: string; start: number; end: number } {
  const n = marker.length
  const inner = text.slice(start, end)

  // Already wrapped INSIDE the selection: **bold** selected whole.
  if (inner.length >= n * 2 && inner.startsWith(marker) && inner.endsWith(marker)) {
    const stripped = inner.slice(n, -n)
    return { text: text.slice(0, start) + stripped + text.slice(end), start, end: start + stripped.length }
  }
  /* Already wrapped OUTSIDE the selection: bold selected within **bold**.
     The guard matters for italics: in `**fire**` the `*` next to the selection is
     BOLD's marker, so without it Ctrl+I on bold text unwraps a bold marker into
     `*fire*` instead of nesting. */
  const hugged = text.slice(start - n, start) === marker && text.slice(end, end + n) === marker
  const isHalfOfDouble = n === 1 && (text[start - 2] === marker || text[end + 1] === marker)
  if (hugged && !isHalfOfDouble) {
    return {
      text: text.slice(0, start - n) + inner + text.slice(end + n),
      start: start - n,
      end: end - n,
    }
  }
  return {
    text: text.slice(0, start) + marker + inner + marker + text.slice(end),
    start: start + n,
    // Both edges shift by ONE marker: the opening one. Adding the selection
    // length again double-counts it and swallows the closing marker.
    end: end + n,
  }
}
