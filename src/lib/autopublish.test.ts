import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { useLocalDraft } from './draft.ts'
import { act, create } from 'react-test-renderer'
import { useAutoSave, useAutoPublish, readAutoSaveDraft, type AutoPublishState, type AutoSaveArgs, type AutoPublishArgs } from './autopublish.ts'

const memory = new Map<string, string>()
Object.assign(globalThis, {
  window: { setTimeout, clearTimeout },
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) },
})
type Value = { name: string }
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r }); return { promise, resolve } }
let state: AutoPublishState
function Form(props: AutoSaveArgs<Value>) { state = useAutoSave(props); return null }
function Publisher(props: AutoPublishArgs<Value>) { state = useAutoPublish(props); return null }

test('autosave shows failure, retains recovery data and retries the actual write', async () => {
  memory.clear()
  let calls = 0
  const props = { id: 'a', draftKey: 'item:a', ready: true, value: { name: 'Original' }, save: async () => { if (++calls === 1) throw new Error('offline'); return 'a' } }
  let root: ReturnType<typeof create>
  await act(async () => { root = create(createElement(Form, props)) })
  await act(async () => { root.update(createElement(Form, { ...props, value: { name: 'Edited' } })) })
  assert.equal(state.status, 'pending')
  await act(async () => state.retry())
  assert.equal(state.status, 'failed')
  assert.deepEqual(readAutoSaveDraft('item:a'), { name: 'Edited' })
  await act(async () => state.retry())
  assert.equal(state.status, 'saved')
  assert.equal(readAutoSaveDraft('item:a'), null)
  assert.equal(calls, 2)
  await act(async () => root.unmount())
})

test('switching before the debounce flushes the captured record', async () => {
  memory.clear()
  const writes: string[] = []
  const props = { id: 'a', draftKey: 'item:a', ready: true, value: { name: 'Original' }, save: async (v: Value, id: string | null) => { writes.push(`${id}:${v.name}`); return id } }
  let root: ReturnType<typeof create>
  await act(async () => { root = create(createElement(Form, { ...props, key: 'a' })) })
  await act(async () => { root.update(createElement(Form, { ...props, key: 'a', value: { name: 'Edited' } })) })
  await act(async () => { root.update(createElement(Form, { ...props, key: 'b', id: 'b', draftKey: 'item:b', value: { name: 'B' } })) })
  assert.deepEqual(writes, ['a:Edited'])
  await act(async () => root.unmount())
})

test('edits during creation reuse the minted row id rather than inserting twice', async () => {
  memory.clear()
  const wait = deferred(), ids: (string | null)[] = []
  const props = { id: null, draftKey: 'item:new', ready: true, value: { name: '' }, save: async (_v: Value, id: string | null) => {
    ids.push(id)
    if (!id) await wait.promise
    return 'minted'
  } }
  let root: ReturnType<typeof create>
  await act(async () => { root = create(createElement(Form, props)) })
  await act(async () => { root.update(createElement(Form, { ...props, value: { name: 'First' } })) })
  await act(async () => state.retry())
  assert.equal(state.busy, true)
  await act(async () => { root.update(createElement(Form, { ...props, value: { name: 'Latest' } })) })
  await act(async () => wait.resolve())
  assert.deepEqual(ids, [null, 'minted'])
  assert.equal(state.status, 'saved')
  await act(async () => root.unmount())
})

test('invalid edits survive unmount without publishing', async () => {
  memory.clear()
  const props = { id: 'a', draftKey: 'item:a', ready: true, value: { name: 'Original' }, save: async () => assert.fail('invalid data must not publish') }
  let root: ReturnType<typeof create>
  await act(async () => { root = create(createElement(Form, props)) })
  await act(async () => { root.update(createElement(Form, { ...props, ready: false, value: { name: '' } })) })
  await act(async () => root.unmount())
  assert.deepEqual(readAutoSaveDraft('item:a'), { name: '' })
})

test('a null publish result is a retryable failure; switching records cannot redirect it', async () => {
  const ids: (string | null)[] = []
  const props = { id: 'a', dirty: true, errs: 0, draft: { name: 'A' }, onCreated: () => {}, saveDraft: async () => null, publish: async (id: string | null) => { ids.push(id); return null } }
  let root: ReturnType<typeof create>
  await act(async () => { root = create(createElement(Publisher, props)) })
  await act(async () => state.retry())
  assert.equal(state.status, 'failed')
  await act(async () => { root.update(createElement(Publisher, { ...props, id: 'b', draft: { name: 'B' }, dirty: false })) })
  assert.ok(ids.every(id => id === 'a'))
  await act(async () => root.unmount())
})

test('reverting a queued unpublished edit cancels it before navigation', async () => {
  let writes = 0
  const props = { id: 'a', dirty: false, errs: 0, draft: { name: 'Original' }, onCreated: () => {}, saveDraft: async () => 'a', publish: async () => { writes++; return 'a' } }
  let root: ReturnType<typeof create>
  await act(async () => { root = create(createElement(Publisher, props)) })
  await act(async () => { root.update(createElement(Publisher, { ...props, dirty: true, draft: { name: 'Edited' } })) })
  await act(async () => { root.update(createElement(Publisher, props)) })
  await act(async () => root.unmount())
  assert.equal(writes, 0)
})

test('creation reports its id only after the latest queued edit is confirmed', async () => {
  memory.clear()
  const first = deferred(), second = deferred(), created: string[] = []
  let calls = 0
  const props = { id: null, draftKey: 'item:new', ready: true, value: { name: '' }, onCreated: (id: string) => { created.push(id) }, save: async () => {
    await (++calls === 1 ? first.promise : second.promise)
    return 'minted'
  } }
  let root: ReturnType<typeof create>
  await act(async () => { root = create(createElement(Form, props)) })
  await act(async () => { root.update(createElement(Form, { ...props, value: { name: 'First' } })) })
  await act(async () => state.retry())
  await act(async () => { root.update(createElement(Form, { ...props, value: { name: 'Latest' } })) })
  await act(async () => first.resolve())
  assert.deepEqual(created, [])
  await act(async () => second.resolve())
  assert.deepEqual(created, ['minted'])
  await act(async () => root.unmount())
})


test('draft hydration cannot publish A under B when selection changes', async () => {
  memory.clear()
  const writes: string[] = []
  let edit: (value: Value) => void
  const original = { name: 'Original' }
  function Editor({ id }: { id: string }) {
    const box = useLocalDraft(`test:${id}`, original)
    edit = value => box.update(() => value)
    state = useAutoPublish({
      id, draft: box.draft, dirty: box.dirty, errs: 0, onCreated: () => {},
      saveDraft: async key => key,
      publish: async (key, value) => { writes.push(`${key}:${value.name}`); return key },
    })
    return null
  }
  let root: ReturnType<typeof create>
  await act(async () => { root = create(createElement(Editor, { id: 'a' })) })
  await act(async () => edit({ name: 'Edited A' }))
  await act(async () => root.update(createElement(Editor, { id: 'b' })))
  await act(async () => state.retry())
  assert.deepEqual(writes, ['a:Edited A'])
  await act(async () => root.unmount())
})

test('reverting to the originally loaded value after a successful save persists the revert', async () => {
  memory.clear()
  const writes: string[] = []
  const props = { id: 'a', draftKey: 'item:a', ready: true, value: { name: 'Original' }, save: async (v: Value) => { writes.push(v.name); return 'a' } }
  let root: ReturnType<typeof create>
  await act(async () => { root = create(createElement(Form, props)) })
  await act(async () => { root.update(createElement(Form, { ...props, value: { name: 'Edited' } })) })
  await act(async () => state.retry())
  await act(async () => { root.update(createElement(Form, props)) })
  await act(async () => state.retry())
  assert.deepEqual(writes, ['Edited', 'Original'])
  await act(async () => root.unmount())
})
