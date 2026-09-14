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
import { colorOf } from './palette.ts'
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
  return html.replace(/var\((--[a-z0-9-]+)\)/g, m => resolve(m) ?? 'inherit')
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
  const muted = 'opacity:.6'

  const dieChip = (d: { v: number; dropped?: boolean; rerolled?: boolean }) => {
    const style = ['display:inline-block', 'min-width:1.4em', 'text-align:center', 'padding:0 .2em']
    if (d.dropped) style.push('text-decoration:line-through', 'opacity:.45')
    if (d.rerolled) style.push('font-style:italic')
    return `<span style="${style.join(';')}">${d.v}</span>`
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
    const colour = tint(l.type, resolve)
    const dice = save ? '' : l.dice.map(dieChip).join(l.mode ? ' <span style="' + muted + '">vs</span> ' : ' ')
    const mods = save || !l.mods ? '' : ` <span style="${muted}">${l.mods > 0 ? '+' : '−'}${Math.abs(l.mods)}</span>`
    const label = esc(l.label) + (l.type ? ` <span style="${muted}">${esc(l.type)}</span>` : '')
    const total = save ? `[[/save ${entry.saveAbility} ${entry.saveDC}]]{DC ${entry.saveDC}}` : String(l.total)
    return `<div style="display:flex;gap:.5em;align-items:baseline;padding:.15em 0">`
      + `<span style="flex:1${colour ? `;color:${colour}` : ''}">${label}</span>`
      + `<span>${dice}${mods}</span>`
      + `<b style="min-width:2.2em;text-align:right${colour ? `;color:${colour}` : ''}">${total}</b>`
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
    `<div style="display:flex;gap:.5em;${muted}"><span style="flex:1">${esc(v.rider.source)} · ${esc(v.rider.label)}</span>`
    + `<span>${esc(v.kind === 'flag' ? (v.grants ?? '') : riderAmount(v.rider))}</span></div>`)

  /* A CHOSEN NOTE IS THE POINT OF THE ROLL, not a footnote to it. Brutal
     Strike's Forceful Blow adds no number — it pushes the target 15 feet — and
     dropping it because it carries no arithmetic sent the DM a damage total
     with the actual consequence of the hit missing. Answered notes only: an
     option the player did not take is not what happened. */
  const notes = live.filter(v => v.kind === 'note').map(v =>
    `<div style="border-left:2px solid currentColor;padding-left:.5em;margin:.2em 0">`
    + prose(v.rider.text ?? v.rider.label, resolve, scope) + `</div>`)

  const flags = totals.flags.map(f =>
    `<span style="border:1px solid currentColor;border-radius:2px;padding:0 .3em;font-size:.85em">${f}</span>`).join(' ')

  const byType = Object.entries(totals.byType).map(([t, n]) => {
    const colour = tint(t, resolve)
    return `<span${colour ? ` style="color:${colour}"` : ''}><b>${n}</b> ${esc(t)}</span>`
  }).join(' <span style="' + muted + '">+</span> ')

  const footer = [
    totals.attack !== undefined ? `<span><b>${totals.attack}</b> to hit</span>` : '',
    byType,
    flags,
  ].filter(Boolean).join(' <span style="' + muted + '">·</span> ')

  return `<div class="guide-roll" style="font-family:inherit">`
    + `<div style="font-weight:600">${esc(entry.title)}</div>`
    + (entry.subtitle ? `<div style="${muted};font-size:.9em">${esc(entry.subtitle)}</div>` : '')
    /* The verdict travels, the AC does not — the DM already knows the number and
       the table does not need it in the log. */
    + (entry.target
      ? `<div style="${muted};font-size:.9em">vs ${esc(entry.target.name)}`
        + (entry.target.hit === undefined ? '' : ` · <b>${entry.target.hit ? 'HIT' : 'MISS'}</b>`)
        + `</div>`
      : '')
    /* `lineViews` puts the save DC first, and it is the only row that is not a
       roll — see lineRow. Without an ability there is nothing to enrich with,
       so it stays the plain number it is today. */
    + `<div style="margin:.35em 0">${lines
      .map((l, i) => lineRow(l, i === 0 && entry.saveDC !== undefined && entry.saveAbility !== undefined))
      .join('')}</div>`
    + (contributions.length ? `<div style="font-size:.9em;margin-bottom:.35em">${contributions.join('')}</div>` : '')
    + (notes.length ? `<div style="font-size:.95em;margin-bottom:.35em">${notes.join('')}</div>` : '')
    /* Foundry's own rule, not a border of ours: `hr` is styled app-wide with the
       gradient every other break line in the interface uses, so the card's
       footer is divided the way Foundry divides things. Only the margin is
       ours — 1rem inside a chat card is a gap, not a rule. */
    + (footer ? `<hr style="margin:.4em 0"><div>${footer}</div>` : '')
    + `</div>`
}
