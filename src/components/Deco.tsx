import type { ReactNode } from 'react'
import styles from './Deco.module.css'

interface Props {
  left: ReactNode
  right: ReactNode
  /** Codex-only corner brackets (the "mainframe" frame). Other screens drop
   *  them and keep just the vertical side-rail flavour text. */
  corners?: boolean
}

/** Fixed vertical side-rails (+ optional corner frame) flanking the content
 *  area. Each screen owns its own rail text — pass `<span className="acc">…`
 *  for the cyan-accented fragments. */
export function Deco({ left, right, corners }: Props) {
  return (
    <div className={`${styles.decoLayer}${corners ? ' ' + styles.framed : ''}`} aria-hidden="true">
      {corners && (
        <>
          <div className={`${styles.corner} ${styles.tl}`} />
          <div className={`${styles.corner} ${styles.tr}`} />
          <div className={`${styles.corner} ${styles.bl}`} />
          <div className={`${styles.corner} ${styles.br}`} />
        </>
      )}
      <div className={`${styles.sideLabel} ${styles.left}`}>{left}</div>
      <div className={`${styles.sideLabel} ${styles.right}`}>{right}</div>
    </div>
  )
}
