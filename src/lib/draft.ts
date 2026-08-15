/**
 * The draft ladder, shared by every DM authoring surface.
 *
 *     localStorage  ──autosave──>  row.draft  ──publish──>  row.data
 *      (keystroke)                (Save Draft)              (Publish)
 *
 * Three tiers because each one answers a question the others cannot:
 *
 *  - **localStorage** survives a refresh or a closed tab without a round trip,
 *    and without committing half-typed content to anything shared.
 *  - **the row's draft slot** parks work where another device can pick it up,
 *    while leaving the published payload untouched. This is what makes "nothing
 *    a player sees moves until Publish" true rather than aspirational: for a
 *    shard tree the row IS what players read, so a draft written over `data`
 *    would either unpublish the tree mid-session or show them the half-finished
 *    edit. Neither is acceptable, so the draft lives beside `data`, not in it.
 *  - **the published payload** is the only thing a player or a grant may copy.
 *
 * This module owns the FIRST tier and the dirty comparison. Where the other two
 * live is the caller's business — feature_catalog has a `draft` column (no
 * player policy, so a column is safe), shard drafts ride in
 * shard_tree_secrets.data.draft (players CAN select the catalog row, so a column
 * there would hand them the DM's unpublished work).
 */
import { useCallback, useEffect, useRef, useState } from 'react'

const PREFIX = 'guide:draft:'
const DEBOUNCE_MS = 400

type Stored<T> = { at: number; value: T }

function read<T>(key: string): Stored<T> | null {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw ? (JSON.parse(raw) as Stored<T>) : null
  } catch {
    // A quota error, private mode, or a payload from an older shape. Losing the
    // local tier degrades to "no autosave", which is where the shard editor
    // already lives — never worth taking the screen down for.
    return null
  }
}

export interface DraftBox<T> {
  /** What the editor edits. Null only when nothing is selected. */
  draft: T | null
  /** Differs from `base` — drives the "unsaved changes" marker. */
  dirty: boolean
  /** Last local autosave, for the "Draft autosaved 14:32:07" readout. */
  savedAt: Date | null
  update: (fn: (t: T) => T) => void
  /** Revert: adopt `to` (usually the published payload) and drop the local copy. */
  reset: (to: T | null) => void
  /** After a successful publish — the local tier has nothing left to hold. */
  clear: () => void
}

/**
 * `key` identifies the thing being edited (`feature:abc`, `shard:sh1`); switching
 * it re-hydrates from that key's local copy. `base` is what the draft is measured
 * against — pass `row.draft ?? row.data`, so an editor reopened on a parked draft
 * starts clean rather than instantly dirty.
 */
export function useLocalDraft<T>(key: string, base: T | null): DraftBox<T> {
  const [draft, setDraft] = useState<T | null>(base)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const timer = useRef<number | undefined>(undefined)
  // The key the current `draft` belongs to. Without this, switching selection
  // races the debounce and writes one feature's edits under another's key.
  const owner = useRef(key)

  useEffect(() => {
    const local = read<T>(key)
    // Only prefer the local copy when it is actually newer work. A draft saved to
    // the row on another device should win over a stale tab's leftovers, and
    // there is no way to tell them apart except that the row is the shared one —
    // so local only wins when the row has nothing parked.
    const next = local && base === null ? local.value : (local?.value ?? base)
    owner.current = key
    setDraft(next ?? null)
    setSavedAt(local ? new Date(local.at) : null)
    return () => window.clearTimeout(timer.current)
    // `base` deliberately absent: re-running on every refetch would clobber
    // in-flight edits with the server's copy. Selection changes are what re-seed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const update = useCallback((fn: (t: T) => T) => {
    setDraft(prev => {
      if (prev === null) return prev
      const next = fn(prev)
      const k = owner.current
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => {
        const at = Date.now()
        try {
          localStorage.setItem(PREFIX + k, JSON.stringify({ at, value: next } satisfies Stored<T>))
          setSavedAt(new Date(at))
        } catch {
          // Out of quota. The edit is still in React state and Save Draft still
          // works; only the crash-recovery tier is gone.
        }
      }, DEBOUNCE_MS)
      return next
    })
  }, [])

  const clear = useCallback(() => {
    window.clearTimeout(timer.current)
    try { localStorage.removeItem(PREFIX + owner.current) } catch { /* see read() */ }
    setSavedAt(null)
  }, [])

  const reset = useCallback((to: T | null) => {
    clear()
    setDraft(to)
  }, [clear])

  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(base)

  return { draft, dirty, savedAt, update, reset, clear }
}
