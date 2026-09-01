/**
 * The one place an icon becomes pixels.
 *
 * TWO SETS, ONE COMPONENT. Everything authored before this change is a Font
 * Awesome class name (`fa-shield-halved`) stored bare, and there are hundreds of
 * those across the catalogs. game-icons.net values carry a `gi:` prefix
 * (`gi:lorc/aura`). Branching here rather than at 128 call sites is what lets
 * both sets coexist with NO data migration — an unprefixed value is, and stays,
 * Font Awesome.
 *
 * WHY A CSS MASK AND NOT AN <img>. Icons in this app inherit their colour
 * everywhere: a feature's authored `color`, `var(--cyan)` on a pip, the
 * `.crit` red on a party row. An <img> paints its own pixels and cannot be
 * recoloured. A mask uses the SVG only as a stencil and fills it with
 * `currentColor`, so a game icon obeys exactly the same `color` rules a
 * FontAwesome glyph does — which is the whole reason the downloaded set is
 * white-on-transparent.
 *
 * The files are served from public/icons/, so nothing is bundled and only the
 * icons actually shown are ever fetched.
 *
 * A PLAIN `.ts` FILE, BUILT WITH createElement, and not for style. `renderInline`
 * (lib/markdown.ts) renders the `[]{icon fa-fire}` token, so it has to import
 * this — and markdown.ts is deliberately `.ts` with no CSS import so that
 * `node --test` can load it with nothing but Node's type stripping. Node strips
 * types from `.ts`; it does not compile `.tsx`, and it cannot resolve a
 * `.module.css` import at all. Either one would leave markdown untestable, or
 * would fork icon rendering into a second implementation — the exact defect
 * CLAUDE.md names. So the JSX goes, and `.gi` lives in global.css as `.gicon`.
 */

import { createElement, type CSSProperties, type HTMLAttributes } from 'react'
import { gameIconUrl, isGameIcon } from '../lib/icons.ts'

type IconProps = Omit<HTMLAttributes<HTMLElement>, 'title'> & {
  name: string | undefined
  className?: string
  style?: CSSProperties
  title?: string
}

/** `rest` is passed through so the call sites this replaced keep their own
 *  attributes — `aria-hidden`, `onClick`, data-* — without each becoming a
 *  named prop here. */
export function Icon({ name, className, style, title, ...rest }: IconProps) {
  if (!name) return null

  const shared = {
    role: title ? 'img' : 'presentation',
    'aria-label': title,
    title,
    ...rest,
  }

  if (isGameIcon(name)) {
    /* AN <i>, THE SAME TAG FONT AWESOME USES, and that is load-bearing rather
       than tidy. Half the app colours an icon through a descendant selector
       written against the tag — `.frIcFrame i`, `.nbtn i`, `.nInner i`. Those
       rules are how the feature editor, the grant widget and both shard trees
       tint a glyph, and every one of them silently skipped a <span>: the game
       icon rendered fine and stayed the wrong colour, which reads as an icon
       that "does not support tinting" rather than a selector that missed.
       Around twenty rules were affected. Matching the tag fixes them all and
       keeps the next one from being written wrong, since the two branches are
       now indistinguishable to CSS. There is no text inside, so `<i>`'s
       italics are moot. */
    return createElement('i', {
      className: `gicon${className ? ' ' + className : ''}`,
      // The stencil. Set inline because it is per-icon data, not a rule —
      // 4180 classes would be absurd, and the mask shorthand needs the URL.
      style: { ['--gi' as string]: `url("${gameIconUrl(name)}")`, ...style },
      ...shared,
    })
  }

  return createElement('i', {
    className: `fa-solid ${name}${className ? ' ' + className : ''}`,
    style,
    ...shared,
  })
}
