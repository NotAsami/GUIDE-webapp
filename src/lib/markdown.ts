import { createElement, type ReactNode } from 'react'
import { colorOf } from './palette.ts'

/** Only these schemes render as a real link; anything else (e.g. `javascript:`)
 *  falls back to plain text since the parser returns React nodes directly. */
function isSafeUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) || url.startsWith('/')
}

/** Lightweight inline markdown → React nodes: **bold**, *italics*, [text](url),
 *  and `[text]{colour}` (no raw HTML, so it's injection-safe). Unmatched markers
 *  render literally. Uses `createElement` instead of JSX so this stays a plain
 *  `.ts` file — that lets `node --test` run markdown.test.ts with no build step.
 *
 *  The colour span borrows the bracketed-span shape markdown extensions already
 *  use, so `]{` and `](` are the only thing separating it from a link — they
 *  cannot both match at one position, so the alternation order does not matter. */
export function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)\s]+)\)|\[([^\]]+)\]\{([^}\s]+)\}/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    if (m[1] !== undefined) out.push(createElement('strong', { key: i++ }, m[1]))
    else if (m[2] !== undefined) out.push(createElement('em', { key: i++ }, m[2]))
    else if (m[5] !== undefined) {
      const color = colorOf(m[6])
      // Nested, so `[**Fire**]{fire}` still bolds. `[^\]]+` cannot match a
      // closing bracket, so the inner text is strictly shorter and this
      // terminates. An unresolvable colour renders the source verbatim.
      if (color) out.push(createElement('span', { key: i++, style: { color } }, renderInline(m[5])))
      else out.push(m[0])
    } else if (isSafeUrl(m[4])) {
      out.push(createElement('a', { key: i++, href: m[4], target: '_blank', rel: 'noopener noreferrer' }, m[3]))
    } else {
      out.push(m[3])
    }
    last = re.lastIndex
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

const HEADING_RE = /^(#{1,3})\s+(.*)$/

/** Render prose with blank-line paragraph breaks, `#`/`##`/`###` headings, and
 *  inline markdown. A heading line inside a block starts its own element even
 *  without a surrounding blank line, so `## Title\nbody` needs no blank line. */
export function Prose({ text, className }: { text: string; className?: string }) {
  const blocks = text.split(/\n\s*\n/).filter(Boolean)
  const elements: ReactNode[] = []
  let key = 0
  let paraLines: string[] = []
  const flushPara = () => {
    if (paraLines.length) elements.push(createElement('p', { key: key++ }, renderInline(paraLines.join('\n'))))
    paraLines = []
  }
  for (const block of blocks) {
    for (const line of block.split('\n')) {
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
