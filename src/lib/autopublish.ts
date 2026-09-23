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
 * Local recovery writes immediately so leaving a record loses no keystrokes.
 * This tier writes to Postgres, so it waits longer and
 * refuses to overlap — a fast typist should produce one round trip after they
 * stop, not one per character.
 *
 * Features and the shard lattice deliberately keep their manual flow.
 */
import { useEffect, useRef, useState } from 'react'
import { SaveQueue, type SaveStatus } from './saveQueue.ts'

/**
 * Stamp an SRD-imported row as edited, the moment a human changes it.
 *
 * THE SKIP RULE IS INERT WITHOUT THIS. scripts/srd-load.mjs refuses to
 * overwrite a row carrying `modified`, which is what stops a re-import
 * destroying hand-authored effects — but the flag has to be SET by something,
 * and for a while nothing did. The importer wrote `source`, the loader read
 * `modified`, and the write path in between never joined them: a re-run would
 * have reported "941 updated, 0 skipped" while erasing every effect authored
 * onto an SRD item.
 *
 * Stamped HERE, in the save path, because that is the one place every catalog
 * edit passes through. Doing it in each form would be six chances to forget.
 *
 * Only touches rows that came from the import — a hand-authored row has no
 * `source`, is never re-imported, and gains nothing from the flag.
 */
export function markEdited<T>(value: T): T {
  const v = value as { source?: string; modified?: boolean } | null
  if (!v || typeof v !== 'object') return value
  if (v.source !== 'srd' || v.modified) return value
  return { ...(value as object), modified: true } as T
}

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
  busy: boolean
  status: SaveStatus
  error: string | null
  retry: () => void
}

/** Backup for forms with no server draft column. Restored when reopened, even
 * if an invalid name or graph prevented the last version reaching the server. */
export function readAutoSaveDraft<T>(key: string): T | null {
  try { return JSON.parse(localStorage.getItem(`guide:autosave:${key}`) ?? 'null') as T | null } catch { return null }
}
function backup<T>(key: string, value: T) {
  try { localStorage.setItem(`guide:autosave:${key}`, JSON.stringify(value)) } catch { /* Pending state remains visible. */ }
}
function clearBackup<T>(key: string, value: T) {
  try {
    if (localStorage.getItem(`guide:autosave:${key}`) === JSON.stringify(value)) localStorage.removeItem(`guide:autosave:${key}`)
  } catch { /* Retain the recovery copy. */ }
}

function useQueue(key: string) {
  const [queue] = useState(() => new SaveQueue())
  const [, render] = useState(0)
  useEffect(() => {
    queue.onChange = () => render(n => n + 1)
    return () => { queue.onChange = undefined; void queue.flush() }
  }, [queue])
  const snapshot = queue.state(key)
  return { queue, state: { ...snapshot, busy: snapshot.status === 'saving', retry: () => { void queue.flush() } } }
}

export function useAutoPublish<T>({
  draft, dirty, errs, id, saveDraft, publish, onCreated, enabled = true,
}: AutoPublishArgs<T>): AutoPublishState {
  const target = useRef({ id, propId: id, notify: id === null, key: id ?? crypto.randomUUID() })
  if (target.current.propId !== id) target.current = { id, propId: id, notify: id === null, key: id ?? crypto.randomUUID() }
  const record = target.current
  const { queue, state } = useQueue(record.key)
  useEffect(() => () => { void queue.flush() }, [queue, record])
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const json = JSON.stringify(draft)
  const latest = useRef({ draft, saveDraft, publish, onCreated })
  latest.current = { draft, saveDraft, publish, onCreated }

  useEffect(() => {
    if (!enabled || latest.current.draft === null) { queue.cancel(record.key); return }
    if (!dirty && queue.state(record.key).status !== 'saving') { queue.cancel(record.key); return }
    const { draft: value, saveDraft: park, publish: promote, onCreated: created } = latest.current
    const write = errs > 0 ? park : promote
    queue.enqueue({ key: record.key, version: `${errs > 0}:${json}`, write: async () => {
      const got = await write(record.id, markEdited(value))
      if (!got) throw new Error('Changes were not saved. Please retry.')
      record.id = got
      // Wait for the latest edit before remounting a new record under its id.
      if (record.notify && mounted.current && target.current === record
        && JSON.stringify(latest.current.draft) === JSON.stringify(value)) {
        record.notify = false
        record.propId = got
        created(got)
      }
    } })
    const timer = window.setTimeout(() => { void queue.flush() }, SETTLE_MS)
    return () => window.clearTimeout(timer)
  }, [json, dirty, errs, enabled, record, queue])
  return state
}

export interface AutoSaveArgs<T> {
  value: T
  ready: boolean
  id: string | null
  /** A stable recovery key, including catalog and record identity. */
  draftKey: string
  save: (value: T, id: string | null) => Promise<string | null | void>
  onCreated?: (id: string) => void
  enabled?: boolean
}

export function useAutoSave<T>({ value, ready, id, draftKey, save, onCreated, enabled = true }: AutoSaveArgs<T>): AutoPublishState {
  const { queue, state } = useQueue(draftKey)
  const latest = useRef({ value, save, onCreated })
  latest.current = { value, save, onCreated }
  const json = JSON.stringify(value)
  const baseline = useRef<string | null>(null)
  const owner = useRef(id)
  const target = useRef({ id, notify: id === null })
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  useEffect(() => {
    if (owner.current !== id) { owner.current = id; baseline.current = null; target.current = { id, notify: id === null } }
    if (baseline.current === null) {
      baseline.current = json
      if (!readAutoSaveDraft(draftKey)) { queue.baseline(draftKey, json); return }
    }
    if (!enabled) return
    if (json === baseline.current && !readAutoSaveDraft(draftKey)) return
    const { value: captured, save: write, onCreated: created } = latest.current
    backup(draftKey, captured)
    if (!ready) { queue.cancel(draftKey); return }
    const record = target.current
    queue.enqueue({ key: draftKey, version: json, write: async () => {
      const got = await write(markEdited(captured), record.id)
      if (got === null) throw new Error('Changes were not saved. Please retry.')
      clearBackup(draftKey, captured)
      if (owner.current === id) baseline.current = json
      if (got) {
        record.id = got
        if (record.notify && mounted.current && target.current === record
          && JSON.stringify(latest.current.value) === JSON.stringify(captured)) {
          record.notify = false
          created?.(got)
        }
      }
    } })
    const timer = window.setTimeout(() => { void queue.flush() }, SETTLE_MS)
    return () => window.clearTimeout(timer)
  }, [json, ready, id, draftKey, enabled, queue])
  return state
}
