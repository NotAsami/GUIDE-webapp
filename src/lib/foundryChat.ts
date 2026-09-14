/**
 * A settled roll → the HTML Foundry's chat log shows.
 *
 * Built from the same view models the Roll Context Panel reads (lineViews,
 * riderViews, rollTotals) and NEVER from the panel's DOM: one roll, one set of
 * numbers, two renderers. If the panel and the chat card ever disagree, it is
 * because something stopped going through rollView.ts.
 *
 * Styles are INLINE and colours are RESOLVED. Foundry has none of this app's
 * stylesheet, so a `var(--gold-rare)` posted verbatim renders as nothing —
 * `resolve` turns the palette's token reference into the literal the chat log
 * can use, which keeps lib/palette.ts the only place a damage colour is stated.
 */

import { Fragment, createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { RollEntry } from './rolls.tsx'
import { lineViews, riderAmount, riderViews, rollTotals } from './rollView.ts'
import { colorOf, inkOn } from './palette.ts'
import { FOUNDRY_CONDITIONS } from './foundryDamage.ts'
import { renderInline } from './markdown.ts'
import { interpolate, type ExprScope } from './expr.ts'

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** A palette spec → something a stylesheet-less page can paint with. Returns
 *  null when the token cannot be resolved (no document, unknown name), and null
 *  is load-bearing: the caller then omits the colour rather than emitting a
 *  `var()` that silently renders as inherited text. */
export function cssVar(spec: string | null): string | null {
  if (!spec) return null
  const m = /^var\((--[a-z0-9-]+)\)$/.exec(spec)
  if (!m) return spec
  if (typeof document === 'undefined') return null
  return getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() || null
}

const tint = (name: string | undefined, resolve: (s: string | null) => string | null) =>
  (name ? resolve(colorOf(name.toLowerCase())) : null)

/**
 * Authored prose → the same markup the panel shows.
 *
 * ONE PARSER. `renderInline` is the only thing that knows what `**bold**` and
 * `[text]{fire}` mean, and a second implementation here is precisely the
 * "one authored value, two render paths" defect — the one that ships silently,
 * printing the source at whichever end nobody looked at. React already turns
 * those nodes into a string, so this borrows the renderer instead of the rules.
 *
 * Two things still have to be undone afterwards, because Foundry is not this
 * app: a colour arrives as `var(--token)` with no stylesheet to resolve it, and
 * the scope the panel reads from context has to be passed in by hand.
 */
function prose(text: string, resolve: (s: string | null) => string | null, scope?: ExprScope | null): string {
  const live = scope ? interpolate(text, scope).text : text
  const html = renderToStaticMarkup(createElement(Fragment, null, ...renderInline(live)))
  return linkConditions(html.replace(/var\((--[a-z0-9-]+)\)/g, m => resolve(m) ?? 'inherit'))
}

/** The vocabulary is FOUNDRY_CONDITIONS — the same list `statusOf` matches, so
 *  a word that lights an icon on the token is a word that links here. */
const CONDITIONS_RE = new RegExp(`\\b(?:${FOUNDRY_CONDITIONS.join('|')})\\b`, 'gi')

/**
 * SRD condition names in authored prose become dnd5e's own reference enricher.
 *
 * Foundry expands it into a link to the rule AND, for a condition specifically,
 * the apply-to-selected control it hangs off it — so "the target is knocked
 * Prone" becomes something the DM acts on instead of a word they retype into
 * the token's effects.
 *
 * TEXT ONLY, NEVER INSIDE A TAG. What arrives here is markup, style attributes
 * and all, and a blind replace would rewrite the inside of a tag as readily as
 * a sentence. Splitting on tags is the whole guard — cheap, and the damage it
 * prevents is the silent kind: a note that renders as broken markup in someone
 * else's window.
 */
function linkConditions(html: string): string {
  return html
    .split(/(<[^>]*>)/)
    .map(part => (part.startsWith('<')
      ? part
      : part.replace(CONDITIONS_RE, m => `&Reference[${m.toLowerCase()}]{${m}}`)))
    .join('')
}

export function rollChatHtml(
  entry: RollEntry,
  resolve: (s: string | null) => string | null = cssVar,
  /** The live scope, so `{level >= 17 ? 2d10 : 1d10}` in a note computes here
   *  exactly as it does in the panel. Null = render as authored. */
  scope: ExprScope | null = null,
): string {
  const lines = lineViews(entry)
  const views = riderViews(entry)
  const totals = rollTotals(entry, views)
  /* PRESENTATION LIVES IN THE STYLESHEET (foundry/guide-bridge/guide-roll.css),
     which is why these are classes and not inline styles: an inline style
     outranks the module's CSS, so anything stated here could never be restyled
     there. What stays inline is the one thing that is per-roll DATA — a damage
     type's colour. */
  const dieChip = (d: { v: number; dropped?: boolean; rerolled?: boolean }) => {
    const cls = ['gr-d', d.dropped ? 'gr-out' : '', d.rerolled ? 'gr-re' : ''].filter(Boolean).join(' ')
    return `<span class="${cls}">${d.v}</span>`
  }

  /**
   * `save` marks the leading save-DC row — the one line here that is not a roll
   * but a number somebody ELSE rolls against.
   *
   * It crosses as dnd5e's own `[[/save]]` enricher, which Foundry expands when
   * the message renders into a button that rolls the save for whatever is
   * selected. The DM stops copying a DC out of the card and into their own
   * roll. Raw on purpose: an escaped enricher is literal text in the log.
   *
   * ONLY THE DICE-LESS NUMBER TRAVELS THIS WAY. `[[/damage]]` is the obvious
   * next thought and it is wrong — it rolls FRESH dice for a hit this card has
   * already rolled, which is two different numbers for one swing.
   */
  const lineRow = (l: (typeof lines)[number], save = false) => {
    /* A DAMAGE TYPE IS A FILLED CHIP, not tinted text. The palette is built to
       glow on the codex's near-black ground, and Foundry's chat log is
       hard-coded light — force is `--violet-hot`, about 2.4:1 on white, which
       is how it came to read as grey. A fill carries its own contrast whatever
       ground it lands on, so the colour stops depending on the reader's theme.
       `inkOn` says which ink survives on it; without one (a colour that is not
       a hex, or a stylesheet that resolved nothing) there is no chip to prove
       legible, and the type stays plain text. */
    const fill = tint(l.type, resolve)
    const ink = fill ? inkOn(fill) : null
    const type = !l.type ? ''
      : fill && ink
        ? `<span class="gr-type" style="background:${fill};color:${ink}">${esc(l.type)}</span>`
        : `<span class="gr-type gr-plain">${esc(l.type)}</span>`
    const dice = save ? '' : l.dice.map(dieChip).join(l.mode ? ' <span class="gr-or">vs</span> ' : ' ')
    const mods = save || !l.mods ? '' : ` ${l.mods > 0 ? '+' : '−'}${Math.abs(l.mods)}`
    const total = save ? `[[/save ${entry.saveAbility} ${entry.saveDC}]]{DC ${entry.saveDC}}` : String(l.total)
    return `<div class="gr-r">`
      + `<span class="gr-k">${esc(l.label)}</span>${type}`
      + `<span class="gr-w">${dice}${mods}</span>`
      + `<b class="gr-v">${total}</b>`
      + `</div>`
  }

  /* ONLY THE LIVE ONES. A rider the player left switched off contributed
     nothing, and listing it beside the ones that did would read as though it
     had. The totals above are already the panel's arithmetic — this is the
     working, not a second sum. */
  const live = views.filter(v => v.live)
  /* riderAmount IS THE PANEL'S OWN SENTENCE. Formatting the number here again
     is how the card came to print "+0" for a rolled 2d6 while the total counted
     it — one contribution, two renderers, only one of them reading the faces. */
  const contributions = live.filter(v => v.kind !== 'note').map(v =>
    `<div class="gr-c"><span>${esc(v.rider.source)} · ${esc(v.rider.label)}</span>`
    + `<span>${esc(v.kind === 'flag' ? (v.grants ?? '') : riderAmount(v.rider))}</span></div>`)

  /* A CHOSEN NOTE IS THE POINT OF THE ROLL, not a footnote to it. Brutal
     Strike's Forceful Blow adds no number — it pushes the target 15 feet — and
     dropping it because it carries no arithmetic sent the DM a damage total
     with the actual consequence of the hit missing. Answered notes only: an
     option the player did not take is not what happened. */
  const notes = live.filter(v => v.kind === 'note').map(v =>
    `<div class="gr-note">${prose(v.rider.text ?? v.rider.label, resolve, scope)}</div>`)

  const flags = totals.flags.map(f => `<span class="gr-flag">${f}</span>`).join(' ')

  /* NO TINT DOWN HERE. The chip above already says what colour the damage is,
     and a tinted total was the half of it that could not be made legible on
     both grounds. */
  const byType = Object.entries(totals.byType)
    .map(([t, n]) => `<span><b>${n}</b> ${esc(t)}</span>`)
    .join(' <span class="gr-or">+</span> ')

  /* The verdict sits at the end of the footer rather than beside the target's
     name: it is the answer, and the answer belongs where the totals are. */
  /* A CHIP FOR THE SAME REASON THE DAMAGE TYPE IS ONE. Green text is 2.76:1 on
     the log's white; a fill of that same green, inked by `inkOn`, is 6.8:1 on
     any ground at all. No resolvable colour, no fill — the word still says it. */
  const hit = entry.target?.hit
  const vFill = hit === undefined ? null : tint(hit ? 'green' : 'red', resolve)
  const vInk = vFill ? inkOn(vFill) : null
  const verdict = hit === undefined ? ''
    : `<span class="gr-verdict"${vFill && vInk ? ` style="background:${vFill};color:${vInk}"` : ''}>`
      + `${hit ? 'HIT' : 'MISS'}</span>`
  const sums = [
    totals.attack !== undefined ? `<span><b>${totals.attack}</b> to hit</span>` : '',
    byType,
    flags,
  ].filter(Boolean).join(' <span class="gr-or">·</span> ')
  const footer = sums || verdict ? sums + verdict : ''

  /* `guide-roll` is the whole hook the module's stylesheet hangs on
     (foundry/guide-bridge/guide-roll.css). The card brings NO ground of its
     own: it borrows the log's paper and its ink and spends everything on one
     cyan rail, so it never fights whatever theme the reader is running. What
     carries colour instead is the damage chip, which carries its own. */
  return `<div class="guide-roll">`
    + `<div class="gr-h"><span class="gr-n">${esc(entry.title)}</span>`
    + (entry.subtitle ? `<span class="gr-s">${esc(entry.subtitle)}</span>` : '')
    + `</div>`
    /* The target travels, the AC does not — the DM already knows the number and
       the table does not need it in the log. The verdict is in the footer. */
    + (entry.target ? `<div class="gr-tgt">vs ${esc(entry.target.name)}</div>` : '')
    /* `lineViews` puts the save DC first, and it is the only row that is not a
       roll — see lineRow. Without an ability there is nothing to enrich with,
       so it stays the plain number it is today. */
    + lines
      .map((l, i) => lineRow(l, i === 0 && entry.saveDC !== undefined && entry.saveAbility !== undefined))
      .join('')
    + contributions.join('')
    + notes.join('')
    /* Foundry's own rule, not a border of ours — the same break line the rest of
       the interface uses. Borrowing the log's furniture is the whole idea here,
       and a rule is furniture. */
    + (footer ? `<hr><div class="gr-f">${footer}</div>` : '')
    + `</div>`
}
