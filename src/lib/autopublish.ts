/**
 * Autosave, and autopublish once it is clean.
 *
 * The catalog forms (loot, class, race) used to carry Save Draft and Publish.
 * They no longer do: typing saves, and the record publishes itself the moment
 * its audit has no errors.
 *
 *     typing…      → draft saved 22:41
 *     1 error      → DRAFT · 1 error blocks publish
 *     error fixed  → PUBLISHED 22:41
 *
 * ERRORS STILL HOLD IT BACK, which is the whole reason this is not just "write
 * on every keystroke". The old rule — a record with an audit error never
 * reaches a player — is preserved exactly; only the button is gone. A broken
 * record parks in the row's `draft` slot, where it is safe (those tables have
 * no player policy), and promotes itself when fixed.
 *
 * WHY NOT REUSE useLocalDraft'S DEBOUNCE: that tier writes to localStorage at
 * 400ms, which is free. This tier writes to Postgres, so it waits longer and
 * refuses to overlap — a fast typist should produce one round trip after they
 * stop, not one per character.
 *
 * Features and the shard lattice deliberately keep their manual flow.
 */
import { useCallback, useEffect, useRef } from 'react'

/** Long enough that a sentence is one write, short enough to feel immediate. */
const SETTLE_MS = 900

export interface AutoPublishArgs<T> {
  /** What is being edited. Null when nothing is selected. */
  draft: T | null
  /** Differs from what was loaded — nothing is written until this is true, so
   *  merely opening a record never writes. */
  dirty: boolean
  /** Audit error count. Zero publishes; anything else parks a draft. */
  errs: number
  /** Row id, or null while creating a brand-new record. */
  id: string | null
  /** Park in the row's draft slot. Resolves to the row id — which is how a
   *  brand-new record gets one. */
  saveDraft: (id: string | null, value: T) => Promise<string | null>
  /** Promote to the published payload. Same id contract. */
  publish: (id: string | null, value: T) => Promise<string | null>
  /** Called with the id the FIRST write minted, so the form can stop being
   *  "creating" and start editing that row. Without this every keystroke would
   *  insert another row. */
  onCreated: (id: string) => void
  /** Skip entirely — e.g. no record selected. */
  enabled?: boolean
}

export interface AutoPublishState {
  /** A write is in flight. */
  busy: boolean
}

export function useAutoPublish<T>({
  draft, dirty, errs, id, saveDraft, publish, onCreated, enabled = true,
}: AutoPublishArgs<T>): AutoPublishState {
  const busy = useRef(false)
  const timer = useRef<number | undefined>(undefined)
  /* The id to write against. Tracked in a ref, not read from props, because the
     first write of a NEW record mints one and the next write must use it — and
     props have not re-rendered yet when the debounce fires again quickly. */
  const rowId = useRef<string | null>(id)
  /* A write that arrived while one was in flight. Kept as a flag rather than a
     queue: only the newest state matters, and the latest draft is read fresh
     when the retry runs. */
  const again = useRef(false)
  const latest = useRef<{ draft: T | null; errs: number }>({ draft, errs })

  useEffect(() => { rowId.current = id }, [id])
  latest.current = { draft, errs }

  const flush = useCallback(async () => {
    if (busy.current) { again.current = true; return }
    const { draft: value, errs: e } = latest.current
    if (!value) return
    busy.current = true
    try {
      const write = e > 0 ? saveDraft : publish
      const got = await write(rowId.current, value)
      if (got && !rowId.current) { rowId.current = got; onCreated(got) }
    } finally {
      busy.current = false
      if (again.current) { again.current = false; void flush() }
    }
  }, [saveDraft, publish, onCreated])

  useEffect(() => {
    if (!enabled || !dirty || !draft) return
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => { void flush() }, SETTLE_MS)
    return () => window.clearTimeout(timer.current)
    // `errs` is deliberately a dependency: fixing the last error with no other
    // edit still has to trigger the promote from draft to published.
  }, [draft, dirty, errs, enabled, flush])

  return { busy: busy.current }
}

/**
 * Autosave for the forms with NO draft tier — items, spells, effects, shops.
 *
 * Those tables have one payload column and no `draft` beside it, so there is
 * nowhere to park a broken record: the choice is write it or do not. This hook
 * therefore holds the write while `ready` is false, exactly as the Save button
 * it replaced was disabled while the name was empty or the graph had errors.
 * The last good version stays live in the meantime, which is the same guarantee
 * the draft tier gives the other forms, reached a different way.
 *
 * COMPARED BY VALUE, not by reference. These forms rebuild their payload from a
 * dozen useState fields on every render, so a new object identity means nothing
 * and an effect keyed on it would fire forever.
 */
export interface AutoSaveArgs<T> {
  /** The built payload, rebuilt each render. */
  value: T
  /** False while the form is not safe to write — holds the save. */
  ready: boolean
  /** Row id, or null while creating. Changing it re-baselines, so SELECTING a
   *  different record never counts as an edit to it. */
  id: string | null
  save: (value: T) => Promise<string | null | void>
  onCreated?: (id: string) => void
  enabled?: boolean
}

export function useAutoSave<T>({
  value, ready, id, save, onCreated, enabled = true,
}: AutoSaveArgs<T>): AutoPublishState {
  const busy = useRef(false)
  const timer = useRef<number | undefined>(undefined)
  const again = useRef(false)
  /** What is already stored, serialised. Null until the first baseline is set,
   *  which is what stops a freshly-opened form writing itself back. */
  const saved = useRef<string | null>(null)
  const owner = useRef<string | null>(id)
  const latest = useRef<{ json: string; value: T; ready: boolean }>({ json: '', value, ready })

  const json = JSON.stringify(value)
  latest.current = { json, value, ready }

  /* Selection changed: adopt the new record as the baseline rather than
     treating it as an edit of the old one. Without this, clicking through a
     list would write every row it passed. */
  if (owner.current !== id) { owner.current = id; saved.current = json }

  const flush = useCallback(async () => {
    if (busy.current) { again.current = true; return }
    const { json: j, value: v, ready: r } = latest.current
    if (!r || j === saved.current) return
    busy.current = true
    try {
      const got = await save(v)
      saved.current = j
      if (got && !owner.current) { owner.current = got; onCreated?.(got) }
    } finally {
      busy.current = false
      if (again.current) { again.current = false; void flush() }
    }
  }, [save, onCreated])

  useEffect(() => {
    if (saved.current === null) { saved.current = json; return }
    if (!enabled || !ready || json === saved.current) return
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => { void flush() }, SETTLE_MS)
    return () => window.clearTimeout(timer.current)
  }, [json, ready, enabled, flush])

  return { busy: busy.current }
}
