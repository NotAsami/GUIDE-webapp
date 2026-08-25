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

/**
 * WHICH COPY THE EDITOR OPENS ON — the local autosave, or the row.
 *
 * Pure and exported so it can be tested as the real thing rather than as a
 * paraphrase of itself; the hook below is the only caller.
 *
 * The local tier is a CRASH CACHE, not a source of truth, and the only thing
 * that tells the two apart is age. Without `rowAt` the local copy won every
 * time it existed, so a single abandoned autosave shadowed the row for good:
 * edit the feature anywhere else, reopen the editor, and there is the version
 * you already replaced — flagged as unsaved changes, which reads as the editor
 * having lost the save rather than found an old one.
 *
 * `drop` is separate from "did not win": a losing copy is DELETED. Left in
 * place it wins again the moment the row is next written from this tab and its
 * timestamp moves past it — the same stale content returning after it seemed
 * to be gone, by which point nobody suspects a cache.
 *
 * No row timestamp means no row yet (a feature being created), and there the
 * local copy is the only work in existence.
 */
export function seedFrom<T>(
  local: Stored<T> | null,
  base: T | null,
  rowAt?: string | number | null,
): { value: T | null; savedAt: Date | null; drop: boolean } {
  const at = rowAt ? new Date(rowAt).getTime() : 0
  const fresh = local && (!at || !Number.isFinite(at) || local.at > at) ? local : null
  return {
    value: fresh?.value ?? base ?? null,
    savedAt: fresh ? new Date(fresh.at) : null,
    drop: !!local && !fresh,
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
 *
 * `baseAt` is the row's `updated_at`, and it is what makes the local tier a
 * CACHE rather than a trap. Without it the local copy won unconditionally, so
 * one abandoned autosave shadowed the real row for good: the DM edited the
 * feature elsewhere — another browser, another device, straight in the
 * database — reopened the editor, and got the version they had already
 * replaced, marked "unsaved changes" for good measure. Omit it and the old
 * always-local behaviour is what you get, which is right only while the thing
 * being edited has no row yet.
 */
export function useLocalDraft<T>(key: string, base: T | null, baseAt?: string | number | null): DraftBox<T> {
  const [draft, setDraft] = useState<T | null>(base)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const timer = useRef<number | undefined>(undefined)
  // The key the current `draft` belongs to. Without this, switching selection
  // races the debounce and writes one feature's edits under another's key.
  const owner = useRef(key)

  useEffect(() => {
    const seed = seedFrom(read<T>(key), base, baseAt)
    if (seed.drop) { try { localStorage.removeItem(PREFIX + key) } catch { /* see read() */ } }
    owner.current = key
    setDraft(seed.value)
    setSavedAt(seed.savedAt)
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
