/**
 * Operator Console — Handouts. Author a document or image, link it to a quest,
 * and hand it to players (migration 0023, lib/handouts.ts).
 *
 * Delivering SAVES FIRST, in the same write: pushing a handout with an unsaved
 * edit in the form would otherwise put the old text on the player's screen and
 * the new text nowhere.
 */
import { ImageUpload } from '../components/ImageUpload'
import { useState, type ReactNode } from 'react'
import type { HandoutRow, HandoutUpdate, QuestRow } from '../lib/database.types'
import { RECALL, filePatch, pushPatch, stateOf, takeBackPatch, type DmHandoutsState, type HandoutState } from '../lib/handouts'
import type { VoiceMsg } from '../lib/voice'
import { proseField } from '../lib/textareaHooks'
import { ProsePreview } from '../components/ProsePreview'
import { Btn } from './OperatorBtn'
import styles from './OperatorConsole.module.css'

const cx = (...xs: (string | false | undefined)[]) => xs.filter(Boolean).join(' ')

const GROUPS: { key: HandoutState; label: string; cls?: string }[] = [
  { key: 'live', label: 'Live', cls: styles.active },
  { key: 'filed', label: 'Filed' },
  { key: 'draft', label: 'Draft' },
]

type Member = { id: string; name: string }
type Fields = Pick<HandoutRow, 'title' | 'body' | 'image_url' | 'quest_id'>

export function OperatorHandouts({ lib, quests, members, onVoice, log }: {
  lib: DmHandoutsState
  quests: QuestRow[]
  members: Member[]
  onVoice: (msg: VoiceMsg) => Promise<boolean>
  log: (node: ReactNode, kind?: 'cyan' | 'danger') => void
}) {
  const { handouts, loading, error } = lib
  const [selId, setSelId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const activeId = creating ? null : (selId ?? handouts[0]?.id ?? null)
  const selected = handouts.find(h => h.id === activeId) ?? null

  return (
    <>
      <div className={styles.ovBanner}>
        <span className={styles.big}>Handouts</span>
        <span>Documents and images for players · filed in their Journal</span>
        <span className={styles.sessCount}>{handouts.length} authored</span>
      </div>
      {error && <div className={styles.subNote}><i className="fa-solid fa-triangle-exclamation" /> {error}</div>}

      <div className={styles.questLayout}>
        <div className={styles.qIndex}>
          {GROUPS.map(g => {
            const items = handouts.filter(h => stateOf(h) === g.key)
            return (
              <div key={g.key} className={cx(styles.qGroup, g.cls)}>
                <div className={styles.qGroupHead}><span className={styles.ghT}>{g.label}</span><span className={styles.ghC}>{items.length}</span></div>
                <div className={styles.qRows}>
                  {items.length ? items.map(h => (
                    <button key={h.id} className={cx(styles.qRow, h.id === activeId && !creating && styles.sel)} onClick={() => { setCreating(false); setSelId(h.id) }}>
                      <span className={styles.qGlyph}><i className={`fa-solid ${h.image_url ? 'fa-image' : 'fa-file-lines'}`} /></span>
                      <span className={styles.qRtx}>
                        <span className={styles.qRt}>{h.title || 'Untitled'}</span>
                        <span className={styles.qRl}>{holders(h, members, g.key)}</span>
                      </span>
                    </button>
                  )) : <div className={styles.qEmpty}>{loading ? '· loading ·' : '— none —'}</div>}
                </div>
              </div>
            )
          })}
        </div>

        <div className={styles.qForm}>
          <HandoutForm
            key={activeId ?? 'new'}
            h={selected} quests={quests} members={members}
            onNew={() => { setCreating(true); setSelId(null) }}
            onCreate={async fields => {
              const row = await lib.create(fields)
              if (row) { setCreating(false); setSelId(row.id) }
            }}
            onSave={(id, patch) => lib.update(id, patch)}
            onDelete={async id => { await lib.remove(id); setSelId(null) }}
            onVoice={onVoice} log={log}
          />
        </div>
      </div>
    </>
  )
}

/** "On screen · Ros", "Filed · party" — who has it, in the index row. */
function holders(h: HandoutRow, members: Member[], state: HandoutState): string {
  if (state === 'draft') return 'Nobody has it'
  const ids = state === 'live' ? h.on_screen : h.recipients
  const names = ids.length === members.length && members.length > 1
    ? 'party'
    : ids.map(id => members.find(m => m.id === id)?.name.split(' ')[0] ?? '?').join(', ')
  return `${state === 'live' ? 'On screen' : 'Filed'} · ${names}`
}

function HandoutForm({ h, quests, members, onNew, onCreate, onSave, onDelete, onVoice, log }: {
  h: HandoutRow | null
  quests: QuestRow[]
  members: Member[]
  onNew: () => void
  onCreate: (fields: Fields) => Promise<void>
  onSave: (id: string, patch: HandoutUpdate) => Promise<boolean>
  onDelete: (id: string) => Promise<void>
  onVoice: (msg: VoiceMsg) => Promise<boolean>
  log: (node: ReactNode, kind?: 'cyan' | 'danger') => void
}) {
  const [title, setTitle] = useState(h?.title ?? '')
  const [questId, setQuestId] = useState(h?.quest_id ?? '')
  const [imageUrl, setImageUrl] = useState(h?.image_url ?? '')
  const [imagePending, setImagePending] = useState(false)
  const [body, setBody] = useState(h?.body ?? '')
  const [pick, setPick] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const fields: Fields = { title: title.trim(), body, image_url: imageUrl.trim(), quest_id: questId || null }
  const name = fields.title || 'Untitled'
  const whole = members.length > 0 && pick.length === members.length
  const toggle = (id: string) => setPick(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]))
  const who = (ids: string[]) => ids.length === members.length && members.length > 1
    ? 'the party'
    : ids.map(id => members.find(m => m.id === id)?.name ?? '?').join(', ')

  async function run(patch: HandoutUpdate) {
    if (!h || imagePending) return false
    setBusy(true)
    const ok = await onSave(h.id, { ...fields, ...patch })
    setBusy(false)
    return ok
  }

  async function push() {
    if (!h || !(await run(pushPatch(h, pick)))) return
    log(<>Handout <span className={styles.obj}>{name}</span> on screen → <span className={styles.who}>{who(pick)}</span></>, 'cyan')
  }
  async function file() {
    if (!h) return
    const fresh = pick.filter(id => !h.recipients.includes(id))
    if (!(await run(filePatch(h, pick)))) return
    for (const id of fresh) void onVoice({ kind: 'handout', target: id, name, image: !!fields.image_url })
    log(<>Handout <span className={styles.obj}>{name}</span> filed → <span className={styles.who}>{who(pick)}</span></>)
  }
  async function recall() {
    if (!(await run(RECALL))) return
    log(<>Handout <span className={styles.obj}>{name}</span> recalled · stays filed</>)
  }
  async function takeBack() {
    if (!h || !(await run(takeBackPatch(h, pick)))) return
    log(<>Handout <span className={styles.obj}>{name}</span> taken back from <span className={styles.who}>{who(pick)}</span></>, 'danger')
  }
  async function save() {
    if (imagePending) return
    setBusy(true)
    if (h) await onSave(h.id, fields)
    else await onCreate(fields)
    setBusy(false)
  }

  return (
    <>
      <div className={styles.qTitleRow}>
        <div className={styles.qTitleField}>
          <span className={styles.fieldLab}>Title</span>
          <input className={styles.sessIn} value={title} onChange={e => setTitle(e.target.value)} placeholder="Name the handout…" />
        </div>
        <Btn tone="cyan" icon="fa-plus" label="New Handout" onClick={onNew} />
      </div>

      <div className={styles.qGrid2}>
        <div>
          <span className={styles.fieldLab}>Quest</span>
          <select className={styles.selIn} value={questId} onChange={e => setQuestId(e.target.value)}>
            <option value="">— None —</option>
            {quests.map(q => <option key={q.id} value={q.id}>{q.title || 'Untitled'}</option>)}
          </select>
        </div>
        <div>
          <span className={styles.fieldLab}>Image · optional</span>
          <ImageUpload value={imageUrl} onChange={setImageUrl} onPendingChange={setImagePending} scope="handouts" disabled={busy} />
        </div>
      </div>
      <div className={styles.subNote}>
        <i className="fa-solid fa-circle-info" />
        <span>With an image, the text below becomes its caption. A linked quest shows the handout on that quest's thread, to the players who hold it.</span>
      </div>

      <div className={styles.qLabRow}>
        <span className={styles.fieldLab}>Text</span>
        <span className={cx(styles.qFacing, styles.player)}><i className="fa-solid fa-eye" /> Players see this</span>
        <ProsePreview text={body} />
      </div>
      <textarea className={styles.qPlayerDesc} value={body} onChange={e => setBody(e.target.value)}
        {...proseField(setBody)} placeholder="The document as the players will read it…" />

      <div className={styles.qActions}>
        <Btn tone="amber" lg icon="fa-floppy-disk" label={busy ? 'Saving…' : h ? 'Save Handout' : 'Create Handout'} onClick={() => void save()} disabled={busy || imagePending || !fields.title} />
        {h && <Btn tone="danger" lg icon="fa-trash" label="Delete" onClick={() => void onDelete(h.id)} disabled={busy || imagePending} />}
      </div>

      {h && (
        <>
          <div className={styles.gmHead}>
            <i className="fa-solid fa-paper-plane" />
            <span className={styles.t}>Deliver</span>
            <span className={styles.s}>{h.on_screen.length ? `On screen for ${who(h.on_screen)}` : h.recipients.length ? `Filed for ${who(h.recipients)}` : 'Nobody has it yet'}</span>
          </div>
          <div className={styles.qSeg}>
            {members.map(m => (
              <button key={m.id} className={cx(styles.qSegOpt, pick.includes(m.id) && styles.sel)} onClick={() => toggle(m.id)} aria-pressed={pick.includes(m.id)}>
                {m.name}
                {h.on_screen.includes(m.id) ? ' · on screen' : h.recipients.includes(m.id) ? ' · filed' : ''}
              </button>
            ))}
            {members.length > 1 && (
              <button className={cx(styles.qSegOpt, whole && styles.sel)} onClick={() => setPick(whole ? [] : members.map(m => m.id))} aria-pressed={whole}>
                Whole party
              </button>
            )}
          </div>
          {/* Four verbs in a column this narrow: they wrap to two rows. */}
          <div className={styles.qActions} style={{ flexWrap: 'wrap' }}>
            <Btn tone="amber" icon="fa-display" label="Push to screen" onClick={() => void push()} disabled={busy || imagePending || !pick.length || !fields.title} />
            <Btn tone="cyan" icon="fa-box-archive" label="File quietly" onClick={() => void file()} disabled={busy || imagePending || !pick.length || !fields.title} />
            <Btn tone="ghost" icon="fa-eye-slash" label="Recall" onClick={() => void recall()} disabled={busy || imagePending || !h.on_screen.length} />
            <Btn tone="danger" icon="fa-rotate-left" label="Take back" onClick={() => void takeBack()} disabled={busy || imagePending || !pick.some(id => h.recipients.includes(id))} />
          </div>
        </>
      )}
    </>
  )
}
