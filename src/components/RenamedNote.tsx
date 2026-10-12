import { useEffect, useState } from 'react'
import type { RenameMark } from '../lib/rename'
import { Inline } from '../lib/markdown'
import styles from './RenamedNote.module.css'

/** "Fire Beam · was Fire Bolt · altered by Pyromancer" — shown the FIRST time
 *  this browser shows a given rename, then never again. Remembered per rename
 *  (old → new name), so a later, different rename of the same spell is news
 *  again. Storage can be unavailable (private mode); then it just shows. */
export function RenamedNote({ obj }: { obj: { name?: string } & RenameMark }) {
  const key = '__baseName' in obj ? `guide.renameSeen:${obj.__baseName ?? ''}→${obj.name ?? ''}` : null
  const [show] = useState(() => {
    if (!key) return false
    try { return localStorage.getItem(key) === null } catch { return true }
  })
  useEffect(() => {
    if (key && show) try { localStorage.setItem(key, '1') } catch { /* not remembered; shows again */ }
  }, [key, show])
  if (!key || !show) return null
  return (
    <div className={styles.note} role="note">
      <span className={styles.head}>
        Was <b>{obj.__baseName}</b>{obj.__renamedBy && <> · altered by <b>{obj.__renamedBy}</b></>}
      </span>
      {obj.__renameText && <span className={styles.text}><Inline text={obj.__renameText} /></span>}
    </div>
  )
}
