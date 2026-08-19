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
 */

import type { CSSProperties, HTMLAttributes } from 'react'
import styles from './Icon.module.css'
import { gameIconUrl, isGameIcon } from '../lib/icons'

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

  if (isGameIcon(name)) {
    return (
      <span
        className={`${styles.gi}${className ? ' ' + className : ''}`}
        // The stencil. Set inline because it is per-icon data, not a rule —
        // 4180 classes would be absurd, and the mask shorthand needs the URL.
        style={{ ['--gi' as string]: `url("${gameIconUrl(name)}")`, ...style }}
        role={title ? 'img' : 'presentation'}
        aria-label={title}
        title={title}
        {...rest}
      />
    )
  }

  return (
    <i
      className={`fa-solid ${name}${className ? ' ' + className : ''}`}
      style={style}
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      title={title}
      {...rest}
    />
  )
}
