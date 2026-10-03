/**
 * Operator Console — the session prep board: stage it before, fire it during,
 * log it after.
 *
 * A card is a reference and a time. Firing one calls the system that already
 * owns the thing — a shop opens, a loot table rolls, a handout is pushed, an
 * NPC is revealed, a quest becomes visible (0026) — and stamps the card played.
 * What was played becomes the first draft of the session's key events when the
 * DM wraps; the sessions row is written THEN, because players read every
 * session the moment it exists and the newest is their Codex recap.
 *
 * Design canvas: "Codex Session Prep Board".
 */
import { useMemo, useState, type ReactNode } from 'react'
import type { CharacterRow, PlanCardKind, PlanCardRow, QuestRow, SessionPlanRow } from '../lib/database.types'
import { lootContent, type DmCampaignState, type DmLootState, type DmShopsState } from '../lib/dm'
import type { DmHandoutsState } from '../lib/handouts'
import type { DmNpcsState } from '../lib/npcs'
import type { DmPlansState } from '../lib/plans'
import { planLinks, eventText, fireLabel, firedLabel, moveTo, planEvents, questClosedText, sortBetween, split, targetNames } from '../lib/prep'
import { fireCard } from '../lib/fireCard'
import { Prose } from '../lib/markdown'
import { proseField } from '../lib/textareaHooks'
import { Icon } from '../components/Icon'
import { Btn } from './OperatorBtn'
import styles from './OperatorPrepBoard.module.css'
import con from './OperatorConsole.module.css'

const cx = (...xs: (string | false | undefined | null)[]) => xs.filter(Boolean).join(' ')

const KIND_ICON: Record<PlanCardKind, string> = {
  shop: 'fa-store', loot: 'fa-box-open', handout: 'fa-file-lines', npc: 'fa-user', quest: 'fa-diamond', note: 'fa-note-sticky',
}
const KINDS: { key: PlanCardKind; label: string }[] = [
  { key: 'shop', label: 'Shops' }, { key: 'loot', label: 'Loot' }, { key: 'handout', label: 'Handouts' },
  { key: 'npc', label: 'NPCs' }, { key: 'quest', label: 'Quests' }, { key: 'note', label: 'Note' },
]
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
/** The night this board is for. Sessions come back in ascending order here, so
 *  the first row is session ONE — the highest num is the last one played. */
const lastSession = (sessions: { num: number; title: string }[]) =>
  sessions.reduce<{ num: number; title: string } | null>((best, s) => (!best || s.num > best.num ? s : best), null)

export function OperatorPrepBoard({ lib, campaign, shopLib, lootLib, handoutLib, npcLib, party, onRollLoot, log }: {
  lib: DmPlansState
  campaign: DmCampaignState
  shopLib: DmShopsState
  lootLib: DmLootState
  handoutLib: DmHandoutsState
  npcLib: DmNpcsState
  party: CharacterRow[]
  /** Rolls the table and pushes it to the party — the console owns that path. */
  onRollLoot: (tableId: string) => Promise<boolean>
  log: (node: ReactNode, kind?: 'cyan' | 'danger') => void
}) {
  const boards = useMemo(() => lib.plans.filter(p => !p.session_id), [lib.plans])
  const [planId, setPlanId] = useState<string | null>(null)
  const plan = lib.plans.find(p => p.id === planId) ?? boards[0] ?? null
  const cards = useMemo(() => lib.cards.filter(c => c.plan_id === plan?.id), [lib.cards, plan])
  const { staged, played } = useMemo(() => split(cards), [cards])
  const names = useMemo(() => new Map(party.map(p => [p.id, p.name])), [party])
  const questOf = (ref: string | null) => campaign.quests.find(q => q.id === ref) ?? null
  const [kind, setKind] = useState<PlanCardKind>('shop')
  const [wrapping, setWrapping] = useState(false)
  /** Discard asks first when the board holds anything: staged cards are prep,
   *  played ones are the night's record. An empty board just goes. */
  const [discarding, setDiscarding] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  async function addCard(k: PlanCardKind, ref: string | null, title: string) {
    if (!plan) return
    const last = staged[staged.length - 1]?.sort
    await lib.addCard({ plan_id: plan.id, kind: k, ref, title, sort: sortBetween(last, undefined) })
  }

  /** Fire: lib/fireCard.ts owns what each kind means — the tray presses the
   *  same button from every other screen. */
  async function fire(c: PlanCardRow) {
    setBusy(c.id)
    const what = await fireCard(c, { party, shopLib, handoutLib, npcLib, campaign, rollLoot: onRollLoot, plans: lib })
    setBusy(null)
    if (what) log(<>{c.title || 'A card'} <span className={con.obj}>{what}</span></>, 'cyan')
  }

  if (!plan) {
    return (
      <div className={styles.board}>
        <div className={styles.empty}>
          <span className={styles.emptyT}>No board yet</span>
          <span>Stage a night: the shops, loot, handouts, reveals and quests you mean to play, in the order you mean to play them.</span>
          <Btn tone="amber" icon="fa-plus" label="Start a board" onClick={() => void lib.createPlan('Tonight')} />
        </div>
      </div>
    )
  }

  return (
    <div className={styles.board}>
      <div className={styles.head}>
        <div className={styles.headTx}>
          <input
            className={styles.title} value={plan.title} aria-label="Board title"
            onChange={e => void lib.renamePlan(plan.id, e.target.value)} placeholder="Tonight"
          />
          <span className={styles.sub}>
            Session {(lastSession(campaign.sessions)?.num ?? 0) + 1} · after <span className={styles.acc}>{lastSession(campaign.sessions)?.title ?? 'nothing yet'}</span>
            <span className={styles.dot}>·</span>nothing is written to the Journal until you wrap
          </span>
        </div>
        {boards.length > 1 && (
          <select className={styles.boardPick} value={plan.id} onChange={e => { setDiscarding(false); setPlanId(e.target.value) }} aria-label="Board">
            {boards.map(b => <option key={b.id} value={b.id}>{b.title || 'Untitled board'}</option>)}
          </select>
        )}
        <span className={styles.counts}>
          <span className={styles.acc}>{staged.length}</span> staged <span className={styles.dot}>·</span>
          <span className={styles.good}>{played.length}</span> played
        </span>
        {discarding ? (
          <span className={styles.discardAsk}>
            Discard {cards.length} card{cards.length === 1 ? '' : 's'}?
            <button type="button" className={cx(styles.discard, styles.yes)} onClick={() => { setDiscarding(false); setPlanId(null); void lib.deletePlan(plan.id) }}>Discard</button>
            <button type="button" className={styles.discard} onClick={() => setDiscarding(false)}>Keep</button>
          </span>
        ) : (
          <button
            type="button" className={cx(styles.discard, styles.bin)} title="Discard this board" aria-label="Discard this board"
            onClick={() => (cards.length ? setDiscarding(true) : (setPlanId(null), void lib.deletePlan(plan.id)))}
          >
            <Icon name="fa-trash" />
          </button>
        )}
        <Btn tone="ghost" sm icon="fa-plus" label="New board" onClick={() => void lib.createPlan('Tonight').then(p => p && setPlanId(p.id))} />
        <Btn tone="amber" sm icon={wrapping ? 'fa-xmark' : 'fa-flag-checkered'} label={wrapping ? 'Keep planning' : 'Wrap the session'} onClick={() => setWrapping(w => !w)} />
      </div>

      {wrapping ? (
        <WrapForm
          plan={plan} cards={cards} names={names} campaign={campaign} questOf={questOf}
          onDone={async (sessionId) => { await lib.wrap(plan.id, sessionId); setWrapping(false); setPlanId(null) }}
          log={log}
        />
      ) : (
        <div className={styles.cols}>
          <div className={styles.staged}>
            <div className={styles.colHead}>Staged · in the order you mean to play them</div>
            <div className={styles.cards}>
              {staged.length === 0 && <p className={styles.hint}>Nothing staged. Add from the right.</p>}
              {staged.map((c, i) => (
                <Card
                  key={c.id} c={c} i={i} names={names} quest={questOf(c.ref)} party={party} busy={busy === c.id}
                  onFire={() => void fire(c)}
                  onNote={note => void lib.updateCard(c.id, { note })}
                  onTitle={title => void lib.updateCard(c.id, { title })}
                  onTarget={target => void lib.updateCard(c.id, { target })}
                  onRemove={() => void lib.removeCard(c.id)}
                  onDropAt={from => {
                    const sort = moveTo(staged, from, i)
                    if (sort !== null) void lib.updateCard(from, { sort })
                  }}
                />
              ))}
            </div>
          </div>

          <div className={styles.playedCol}>
            <div className={cx(styles.colHead, styles.goodHead)}>Played tonight{played.length ? ` · ${played.length}` : ''}</div>
            {played.length === 0
              ? <p className={styles.hint}>What you fire lands here with its time, and becomes the key events when you wrap.</p>
              : played.map(c => {
                const q = questOf(c.ref)
                return (
                  <div key={c.id} className={styles.playedRow}>
                    <span className={styles.time}>{clock(c.fired_at!)}</span>
                    <span className={styles.playedTx}>
                      <Icon name={KIND_ICON[c.kind]} className={styles[c.kind]} />
                      <span className={styles.playedName}>{c.title}</span>
                      <button type="button" className={styles.undo} onClick={() => void lib.setFired(c.id, false)}>Unplay</button>
                    </span>
                    <span />
                    <span className={styles.playedWhat}>{firedLabel(c.kind, { questClosed: !!q && q.status !== 'active' })} · {targetNames(c.target, names)}</span>
                  </div>
                )
              })}
          </div>

          <div className={styles.palette}>
            <div className={styles.colHead}>Add to this board</div>
            <div className={styles.kinds}>
              {KINDS.map(k => (
                <button key={k.key} type="button" aria-pressed={kind === k.key}
                  className={cx(styles.kindTab, kind === k.key && styles.on)} onClick={() => setKind(k.key)}>{k.label}</button>
              ))}
            </div>
            <Source
              kind={kind} shopLib={shopLib} lootLib={lootLib} handoutLib={handoutLib} npcLib={npcLib} campaign={campaign}
              staged={cards} onAdd={(ref, title) => void addCard(kind, ref, title)}
            />
            <p className={styles.note}>
              Everything here is staged where it already lives: a shop that is not open, a loot table that has not been rolled,
              a handout nobody holds, a quest the party cannot see yet. The board only decides what is on tonight&#39;s list.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

function Card({ c, i, names, quest, party, busy, onFire, onNote, onTitle, onTarget, onRemove, onDropAt }: {
  c: PlanCardRow; i: number; names: Map<string, string>; quest: QuestRow | null; party: CharacterRow[]; busy: boolean
  onFire: () => void
  onNote: (note: string) => void
  onTitle: (title: string) => void
  onTarget: (target: string[]) => void
  onRemove: () => void
  onDropAt: (id: string) => void
}) {
  const [note, setNote] = useState(c.note)
  const [open, setOpen] = useState(false)
  const label = fireLabel(c.kind, { questVisible: !!quest?.visible })
  return (
    <div
      className={cx(styles.card, styles[`k_${c.kind}`])}
      draggable onDragStart={e => e.dataTransfer.setData('text/plain', c.id)}
      onDragOver={e => e.preventDefault()}
      onDrop={e => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); if (id && id !== c.id) onDropAt(id) }}
    >
      <div className={styles.cardTop}>
        <span className={styles.grip} aria-hidden="true">⠿</span>
        <Icon name={KIND_ICON[c.kind]} className={styles[c.kind]} />
        <input className={styles.cardTitle} value={c.title} onChange={e => onTitle(e.target.value)} aria-label={`Card ${i + 1} title`} />
        <button type="button" className={styles.fire} onClick={onFire} disabled={busy}>{busy ? '…' : label}</button>
        <button type="button" className={styles.x} onClick={onRemove} aria-label="Remove from the board"><i className="fa-solid fa-xmark" /></button>
      </div>
      <button type="button" className={styles.meta} onClick={() => setOpen(o => !o)} aria-expanded={open}>
        {c.kind === 'quest' && quest ? (quest.visible ? 'Quest · the party can see it' : 'Quest · hidden until revealed') : c.kind}
        <span className={styles.dot}>·</span>{targetNames(c.target, names)}
        <span className={styles.more}>{open ? 'less' : 'edit'}</span>
      </button>
      {c.note.trim() && !open && <Prose text={c.note} className={styles.cardNote} />}
      {open && (
        <div className={styles.editor}>
          <textarea
            className={styles.noteIn} value={note} placeholder="What happens here — your own words…"
            onChange={e => setNote(e.target.value)} onBlur={() => { if (note !== c.note) onNote(note) }}
            {...proseField(setNote)}
          />
          {c.kind !== 'note' && c.kind !== 'quest' && (
            <div className={styles.targets}>
              <span className={styles.targetsT}>For</span>
              <button type="button" className={cx(styles.chip, !c.target.length && styles.on)} onClick={() => onTarget([])}>The party</button>
              {party.map(p => {
                const on = c.target.includes(p.id)
                return (
                  <button key={p.id} type="button" aria-pressed={on} className={cx(styles.chip, on && styles.on)}
                    onClick={() => onTarget(on ? c.target.filter(x => x !== p.id) : [...c.target, p.id])}>{p.name}</button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Source({ kind, shopLib, lootLib, handoutLib, npcLib, campaign, staged, onAdd }: {
  kind: PlanCardKind
  shopLib: DmShopsState; lootLib: DmLootState; handoutLib: DmHandoutsState; npcLib: DmNpcsState; campaign: DmCampaignState
  staged: PlanCardRow[]
  onAdd: (ref: string | null, title: string) => void
}) {
  const already = new Set(staged.filter(c => !c.fired_at).map(c => c.ref))
  const rows: { ref: string | null; title: string; meta: string; dim?: boolean }[] =
    kind === 'shop' ? shopLib.shops.map(s => ({ ref: s.id, title: s.data.name || 'Untitled shop', meta: s.is_open ? 'Open now' : s.data.location || 'Closed', dim: s.is_open }))
    : kind === 'loot' ? lootLib.tables.map(t => ({ ref: t.id, title: lootContent(t).name || 'Untitled table', meta: lootContent(t).kind || 'Loot table' }))
    : kind === 'handout' ? handoutLib.handouts.map(h => ({ ref: h.id, title: h.title || 'Untitled', meta: h.on_screen.length ? 'On screen' : h.recipients.length ? 'Filed' : 'Draft', dim: h.on_screen.length > 0 }))
    : kind === 'npc' ? npcLib.npcs.map(n => ({ ref: n.id, title: n.name, meta: n.known_to.length ? `Known to ${n.known_to.length}` : n.location || 'Unrevealed' }))
    : kind === 'quest' ? campaign.quests.map(q => ({ ref: q.id, title: q.title || 'Untitled quest', meta: q.visible ? `${q.status} · the party can see it` : 'Hidden until revealed' }))
    : []

  if (kind === 'note') {
    return (
      <div className={styles.sourceList}>
        <p className={styles.hint}>A beat in your own words — an encounter, an arrival, a reveal you narrate. Combat itself lives in Foundry.</p>
        <Btn tone="ghost" sm icon="fa-plus" label="Add a note" onClick={() => onAdd(null, 'A beat')} />
      </div>
    )
  }
  return (
    <div className={styles.sourceList}>
      {rows.length === 0 && <p className={styles.hint}>Nothing here yet.</p>}
      {rows.map(r => (
        <button key={r.ref} type="button" className={cx(styles.sourceRow, (r.dim || already.has(r.ref)) && styles.dim)}
          onClick={() => onAdd(r.ref, r.title)} disabled={already.has(r.ref)}>
          <Icon name={KIND_ICON[kind]} className={styles[kind]} />
          <span className={styles.sourceTx}>
            <span className={styles.sourceName}>{r.title}</span>
            <span className={styles.sourceMeta}>{already.has(r.ref) ? 'Already staged' : r.meta}</span>
          </span>
          <span className={styles.plus}>+</span>
        </button>
      ))}
    </div>
  )
}

function WrapForm({ plan, cards, names, campaign, questOf, onDone, log }: {
  plan: SessionPlanRow
  cards: PlanCardRow[]
  names: Map<string, string>
  campaign: DmCampaignState
  questOf: (ref: string | null) => QuestRow | null
  onDone: (sessionId: string) => Promise<void>
  log: (node: ReactNode, kind?: 'cyan' | 'danger') => void
}) {
  const suggested = useMemo(() => planEvents(cards, names, ref => { const q = questOf(ref); return !!q && q.status !== 'active' }), [cards, names, questOf])
  const [num, setNum] = useState(String((lastSession(campaign.sessions)?.num ?? 0) + 1))
  const [date, setDate] = useState('')
  const [title, setTitle] = useState(plan.title)
  const [events, setEvents] = useState<string[]>(suggested)
  const [busy, setBusy] = useState(false)
  const staged = cards.filter(c => !c.fired_at).length

  async function write() {
    setBusy(true)
    // The recap is the DM's to write, in the Session Log, at their own pace —
    // the board only carries across what was actually played.
    const row = await campaign.createSession({ num: Number(num) || 1, title, date, recap: '', events: events.filter(e => e.trim()), links: planLinks(cards) })
    setBusy(false)
    if (!row) return
    log(<>Session <span className={con.obj}>{row.title || row.num}</span> written from the board</>, 'cyan')
    await onDone(row.id)
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.wrapMain}>
        <div className={styles.colHead}>Wrap the session</div>
        <p className={styles.wrapNote}>
          The log entry is written now, not when you started planning: the party reads every session the moment it exists,
          and the newest one is the recap on their Codex. The recap prose stays yours — write it in the Session Log whenever you like.
        </p>
        <div className={styles.wrapGrid}>
          <label className={con.fieldLab} htmlFor="wrap-num">Session</label>
          <input id="wrap-num" className={con.sessIn} value={num} onChange={e => setNum(e.target.value)} />
          <label className={con.fieldLab} htmlFor="wrap-date">Date</label>
          <input id="wrap-date" className={con.sessIn} value={date} onChange={e => setDate(e.target.value)} placeholder="e.g. 29th of Hammerfall · 1247 PR" />
          <label className={con.fieldLab} htmlFor="wrap-title">Title</label>
          <input id="wrap-title" className={con.sessIn} value={title} onChange={e => setTitle(e.target.value)} placeholder="Name the night…" />
        </div>
        <div className={styles.colHead}>Key events · from what you played, yours to edit</div>
        <div className={styles.events}>
          {events.length === 0 && <p className={styles.hint}>Nothing was played on this board.</p>}
          {events.map((e, i) => (
            <div key={i} className={styles.eventRow}>
              <input className={styles.eventIn} value={e} aria-label={`Key event ${i + 1}`}
                onChange={ev => setEvents(list => list.map((x, j) => (j === i ? ev.target.value : x)))} />
              <button type="button" className={styles.x} aria-label="Remove event" onClick={() => setEvents(list => list.filter((_, j) => j !== i))}>
                <i className="fa-solid fa-xmark" />
              </button>
            </div>
          ))}
        </div>
        <div className={styles.wrapActions}>
          <Btn tone="amber" lg icon="fa-feather" label={busy ? 'Writing…' : 'Write the session log'} onClick={() => void write()} disabled={busy || !title.trim()} />
        </div>
      </div>
      <div className={styles.wrapSide}>
        <div className={styles.colHead}>Still staged · {staged}</div>
        <p className={styles.hint}>
          {staged
            ? 'These were never played. Start a new board and they are yours to stage again — closing this one leaves them here, on the night that is over.'
            : 'Everything on this board was played.'}
        </p>
      </div>
    </div>
  )
}

/** The played-card sentence, exported for the console's activity log. */
export { eventText, questClosedText }
