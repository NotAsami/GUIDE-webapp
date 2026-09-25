import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation, useOutletContext } from 'react-router-dom'
import { Nav } from '../components/Nav'
import { Deco } from '../components/Deco'
import { HandoutPage } from '../components/Handout'
import type { HandoutOutlet } from '../lib/handouts'
import { useCampaign } from '../lib/campaign'
import { useKnownNpcs } from '../lib/npcs'
import { nameKey } from '../lib/npcWeb'
import { placeId, placesFrom } from '../lib/storyLattice'
import { boardOf, hang, roman, sessionsByRef } from '../lib/journalBoard'
import type { CharacterRow, HandoutRow, QuestRow, RelatedTag, SessionRow } from '../lib/database.types'
import { Prose, isSafeUrl } from '../lib/markdown'
import styles from './Journal.module.css'

/* THE BOUNTY BOARD. Ink is the human and the world; mono is the system. Paper,
   wood and handwriting are ink. Anything G.U.I.D.E. says about them is a mono
   AR tag floating above, upright, never tilted with the paper. */

/** Rows written before Related tags carried a `url` are plain strings —
 *  normalize on read so rendering only ever handles the object shape. */
const toRelatedTag = (r: RelatedTag | string): RelatedTag => (typeof r === 'string' ? { name: r } : r)

/** The DM form nudges toward a URL but writes free text, and this is the
 *  actual security boundary — a `javascript:` or other scheme in a related tag
 *  renders as inert text, not a clickable href, however it got into the row. */
const safeHref = (url: string | undefined): string | null => (url && isSafeUrl(url) ? url : null)

const receivedAt = (h: HandoutRow) => new Date(h.pushed_at ?? h.created_at)
  .toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

const objDone = (q: QuestRow) => q.objectives.filter(o => o.done).length
const STATUS = { active: 'Active', completed: 'Completed', failed: 'Failed' } as const
const kindLabel = (q: QuestRow) => (q.character_id ? 'Personal quest' : q.type === 'main' ? 'Main quest' : 'Side quest')

/** The one paper. Filters are defined once, at the screen root (FILTERS). */
const EDGE = [styles.edge1, styles.edge2, styles.edge3]
function Sheet({ id, stain = 'spots', className = '', style, children }: {
  id: string; stain?: 'cup' | 'spots'; className?: string; style?: CSSProperties; children: ReactNode
}) {
  return (
    <span className={`${styles.sheet} ${EDGE[hang(id).edge]} ${className}`} style={style}>
      <svg className={`${styles.fx} ${styles.crumple}`} aria-hidden="true"><rect width="100%" height="100%" filter="url(#journal-crumple)" /></svg>
      <svg className={`${styles.fx} ${styles.grain}`} aria-hidden="true"><rect width="100%" height="100%" filter="url(#journal-grain)" /></svg>
      <span className={`${styles.fx} ${styles.stains} ${stain === 'cup' ? styles.cup : styles.spots}`} />
      <span className={styles.ink}>{children}</span>
    </span>
  )
}

const FILTERS = (
  <svg width="0" height="0" className={styles.defs} aria-hidden="true">
    <filter id="journal-grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="3" stitchTiles="stitch" />
      <feColorMatrix type="saturate" values="0" />
      <feComponentTransfer><feFuncA type="table" tableValues="0 .3" /></feComponentTransfer>
    </filter>
    <filter id="journal-crumple" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency=".022" numOctaves="4" seed="3" result="n" />
      <feDiffuseLighting in="n" lightingColor="#fff" surfaceScale="2.4"><feDistantLight azimuth="235" elevation="52" /></feDiffuseLighting>
    </filter>
  </svg>
)

/** A reader over the board: portalled (a transformed ancestor would trap it),
 *  Esc handled by the screen, focus handed back to whatever opened it. */
function Dialog({ label, onClose, className, children }: { label: string; onClose: () => void; className: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null
    ref.current?.focus()
    return () => back?.focus?.()
  }, [])
  return createPortal(
    <div className={styles.overlay} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} className={className}>{children}</div>
      <div className={styles.lens} /><div className={styles.vignette} />
    </div>,
    document.body,
  )
}

type Open =
  | { kind: 'quest'; id: string }
  | { kind: 'session'; id: string }
  | { kind: 'archive'; handout?: string }
  | null

export function Journal() {
  const { character, handouts, seenHandouts, markHandoutSeen, openHandout } =
    useOutletContext<HandoutOutlet & { character: CharacterRow }>()
  const { quests, sessions, loading, error } = useCampaign(character.id)
  const { npcs, links } = useKnownNpcs(character.id)
  const [open, setOpen] = useState<Open>(null)

  // Arrivals from other screens, keyed on the navigation so they also fire
  // when the Journal is already open: the dock's "Open in Journal" and Lore's
  // recent handouts land on a handout, Lore's chronicle on the latest session.
  const loc = useLocation()
  const arrival = loc.state as { handout?: string; tab?: 'sessions' | 'handouts' } | null
  useEffect(() => {
    if (arrival?.handout) setOpen({ kind: 'archive', handout: arrival.handout })
    else if (arrival?.tab === 'handouts') setOpen({ kind: 'archive' })
  }, [loc.key]) // eslint-disable-line react-hooks/exhaustive-deps
  const latest = sessions[0]   // useCampaign orders by num, newest first
  useEffect(() => {
    if (arrival?.tab === 'sessions' && latest) setOpen({ kind: 'session', id: latest.id })
  }, [loc.key, latest?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // Reading it here is reading it: the NEW dot goes out.
  const openHandoutId = open?.kind === 'archive' ? open.handout : undefined
  useEffect(() => { if (openHandoutId) markHandoutSeen(openHandoutId) }, [openHandoutId, markHandoutSeen])

  const board = useMemo(() => boardOf(quests, handouts), [quests, handouts])
  const moved = useMemo(() => sessionsByRef(sessions), [sessions])
  const unseen = handouts.filter(h => !seenHandouts.has(h.id)).length
  const chronicle = useMemo(() => [...sessions].reverse(), [sessions])
  const PILE = 3
  const pile = board.closed.slice(0, PILE)

  const openQuest = (id: string) => setOpen({ kind: 'quest', id })
  const quest = open?.kind === 'quest' ? quests.find(q => q.id === open.id) : undefined
  const session = open?.kind === 'session' ? sessions.find(s => s.id === open.id) : undefined

  const meta = (
    <>
      <span className="dim">◇</span><span>Section</span><span className="acc">/ Journal</span>
      <span className="dim">·</span><span>Quest Board</span>
      <span className="dim">·</span><span className="stamp">BOARD</span><span className="dim">::</span><span className="acc">Online</span>
    </>
  )

  return (
    <>
      <Deco
        left={<><span className="acc">JOURNAL</span> &nbsp;//&nbsp; QUEST_BOARD &nbsp;//&nbsp; SYNC OK</>}
        right={<>Log <span className="acc">ENTRIES :: {quests.length + sessions.length}</span> &nbsp;//&nbsp; Auto-Log</>}
      />
      <Nav variant="dock" meta={meta} />
      {FILTERS}

      <div className={styles.journal}>
        <section className={styles.sessions} aria-label="Sessions">
          <div className={styles.colHeader}>
            <span className={styles.chNum}>01</span>
            <span className={styles.chTitle}>Sessions</span>
            <span className={styles.chMeta}><span className="acc">{sessions.length}</span> Logged</span>
          </div>
          {sessions.length === 0 ? (
            <p className={styles.empty}>{loading ? 'Syncing…' : 'No sessions logged yet.'}</p>
          ) : (
            <div className={styles.strip} ref={el => { if (el) el.scrollLeft = el.scrollWidth }}>
              {chronicle.map(s => (
                <button key={s.id} type="button" className={`${styles.stop} ${s.id === latest?.id ? styles.latest : ''}`}
                  onClick={() => setOpen({ kind: 'session', id: s.id })}>
                  <span className={styles.diamond} />
                  <span className={styles.stopTitle}><span className={styles.num}>{roman(s.num)}</span> {s.title}</span>
                  <span className={styles.stopDate}>{s.date}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className={styles.boardCol} aria-label="Quest board">
          <div className={styles.colHeader}>
            <span className={styles.chNum}>02</span>
            <span className={styles.chTitle}>Quest Board</span>
            <span className={styles.chMeta}>
              <span className="acc">{board.main.length + board.side.length}</span> Open <span className="dim">·</span> {board.closed.length} Closed <span className="dim">·</span> {handouts.length} Handouts
            </span>
          </div>
          <div className={styles.region}>
            <div className={styles.rFrame} /><div className={styles.rGap} /><div className={styles.rLine} />
            <div className={`${styles.rInner} ${styles.wood}`}>
              <span className={`${styles.rCorner} ${styles.tl}`} />
              <span className={`${styles.rCorner} ${styles.br}`} />
              {error ? (
                <p className={`${styles.empty} ${styles.bad}`}>{error}</p>
              ) : (
                <div className={styles.boardGrid}>
                  <div className={`${styles.notices} ${styles.scrollY}`}>
                    {!loading && board.main.length + board.side.length === 0 && (
                      <p className={styles.empty}>Nothing pinned to the board.</p>
                    )}
                    {board.main.length > 0 && <>
                      <div className={styles.rank}><span>Main</span><i /></div>
                      <div className={styles.mainRow}>
                        {board.main.map(q => <MainNotice key={q.id} q={q} clipped={board.clipped.get(q.id)} onOpen={() => openQuest(q.id)} />)}
                      </div>
                    </>}
                    {board.side.length > 0 && <>
                      <div className={styles.rank}><span>Side</span><i /></div>
                      <div className={styles.sideRow}>
                        {board.side.map(q => <SideNotice key={q.id} q={q} clipped={board.clipped.get(q.id)} onOpen={() => openQuest(q.id)} />)}
                      </div>
                    </>}
                  </div>

                  <aside className={styles.aside} aria-label="Closed and loose">
                    <div className={styles.rank}><span>Closed</span><i /></div>
                    <div className={styles.pile} style={{ height: pile.length ? 70 + (pile.length - 1) * 58 : 0 }}>
                      {pile.map((q, i) => (
                        <button key={q.id} type="button" className={styles.lift}
                          style={{ top: i * 58, transform: `rotate(${hang(q.id).rot * 1.5}deg)` }} onClick={() => openQuest(q.id)}>
                          <Sheet id={q.id} className={styles.closedSheet}>
                            <span className={styles.closedTitle}>{q.title}</span>
                            {q.location && <span className={`${styles.place} prose-voice`}>{q.location}</span>}
                            <span className={`${styles.stamp} ${q.status === 'failed' ? styles.failed : ''}`}>{q.status === 'failed' ? 'FAILED' : 'DONE'}</span>
                          </Sheet>
                        </button>
                      ))}
                    </div>
                    {board.loose.length > 0 && <>
                      <div className={styles.rank}><span>Loose</span><i /></div>
                      <div className={styles.loose}>
                        {board.loose.slice(0, 3).map(h => (
                          <button key={h.id} type="button" className={styles.lift} style={{ transform: `rotate(${hang(h.id).rot * 3}deg)` }}
                            onClick={() => setOpen({ kind: 'archive', handout: h.id })} aria-label={`Read ${h.title || 'Untitled'}`}>
                            <Sheet id={h.id} className={styles.scrap}>
                              <span className={styles.scrapTitle}>{h.title || 'Untitled'}</span>
                            </Sheet>
                            {!seenHandouts.has(h.id) && <span className={`${styles.ar} ${styles.arNew}`}>New</span>}
                          </button>
                        ))}
                      </div>
                    </>}
                    <button type="button" className={`${styles.ar} ${styles.archiveBtn}`} onClick={() => setOpen({ kind: 'archive' })}>
                      {handouts.length} handouts{board.closed.length > PILE ? ` · ${board.closed.length} closed` : ''} · archive ▸
                      {unseen > 0 && <span className={styles.newCount}>{unseen} new</span>}
                    </button>
                  </aside>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
      <div className={styles.lensFixed} aria-hidden="true" />

      {quest && (
        <QuestReader
          q={quest} quests={quests} character={character} npcs={npcs} links={links}
          clipped={board.clipped.get(quest.id) ?? []} sessions={moved.get(quest.id) ?? []}
          onClose={() => setOpen(null)} onQuest={openQuest}
          onSession={id => setOpen({ kind: 'session', id })}
          onHandout={id => setOpen({ kind: 'archive', handout: id })}
        />
      )}
      {session && (
        <SessionReader
          s={session} sessions={chronicle} quests={quests} handouts={handouts}
          onClose={() => setOpen(null)} onSession={id => setOpen({ kind: 'session', id })}
          onQuest={openQuest} onHandout={id => setOpen({ kind: 'archive', handout: id })}
        />
      )}
      {open?.kind === 'archive' && (
        <Archive
          handouts={handouts} closed={board.closed} quests={quests} seen={seenHandouts} character={character}
          selected={open.handout} onSelect={id => setOpen({ kind: 'archive', handout: id })}
          onQuest={openQuest} onOpenBeside={openHandout} onClose={() => setOpen(null)}
        />
      )}
    </>
  )
}

/* ---------------- notices ---------------- */

function Clip({ h, className }: { h: HandoutRow; className: string }) {
  return (
    <Sheet id={h.id} className={className}>
      <span className={styles.clipTitle}>{h.title || 'Untitled'}</span>
    </Sheet>
  )
}

function ObjTag({ q }: { q: QuestRow }) {
  const total = q.objectives.length
  if (total === 0) return <>Open · no objectives</>
  const done = objDone(q)
  return <>Obj {done}/{total} <span className={styles.bar}><i style={{ width: `${Math.round((done / total) * 100)}%` }} /></span></>
}

function MainNotice({ q, clipped, onOpen }: { q: QuestRow; clipped?: HandoutRow[]; onOpen: () => void }) {
  return (
    <div className={styles.slot}>
      <button type="button" className={styles.lift} style={{ transform: `rotate(${hang(q.id).rot}deg)` }} onClick={onOpen}>
        {clipped?.[0] && <Clip h={clipped[0]} className={styles.clipMain} />}
        <Sheet id={q.id} stain="cup" className={styles.mainSheet}>
          {q.given_by && <span className={`${styles.posted} prose-voice`}>Posted by {q.given_by}</span>}
          <span className={styles.mainTitle}>{q.title}</span>
          {q.location && <span className={styles.placeCaps}>{q.location}</span>}
          {q.objectives.length > 0 && <span className={styles.rule} />}
          {q.objectives.map((o, i) => (
            <span key={i} className={`${styles.obj} ${o.done ? styles.objDone : ''}`}>{o.done ? '✓' : '○'} {o.text}</span>
          ))}
        </Sheet>
        <span className={`${styles.pin} ${styles.pinRed}`} />
      </button>
      <span className={styles.ar}>{q.character_id && <>Yours ·{' '}</>}<ObjTag q={q} /></span>
    </div>
  )
}

function SideNotice({ q, clipped, onOpen }: { q: QuestRow; clipped?: HandoutRow[]; onOpen: () => void }) {
  return (
    <div className={styles.slot}>
      <button type="button" className={styles.lift} style={{ transform: `rotate(${hang(q.id).rot * 1.3}deg)` }} onClick={onOpen}>
        {clipped?.[0] && <Clip h={clipped[0]} className={styles.clipSide} />}
        <Sheet id={q.id} className={styles.sideSheet}>
          <span className={styles.sideTitle}>{q.title}</span>
          {(q.location || q.given_by) && (
            <span className={`${styles.place} prose-voice`}>{[q.location, q.given_by].filter(Boolean).join(' · ')}</span>
          )}
        </Sheet>
        <span className={`${styles.pin} ${styles.pinCyan}`} />
      </button>
      <span className={styles.ar}>{q.character_id && <>Yours ·{' '}</>}<ObjTag q={q} /></span>
    </div>
  )
}

/* ---------------- the opened notice ---------------- */

function QuestReader({ q, quests, character, npcs, links, clipped, sessions, onClose, onQuest, onSession, onHandout }: {
  q: QuestRow; quests: QuestRow[]; character: CharacterRow
  npcs: ReturnType<typeof useKnownNpcs>['npcs']; links: ReturnType<typeof useKnownNpcs>['links']
  clipped: HandoutRow[]; sessions: SessionRow[]
  onClose: () => void; onQuest: (id: string) => void; onSession: (id: string) => void; onHandout: (id: string) => void
}) {
  const giver = q.given_by ? npcs.find(n => nameKey(n.name) === nameKey(q.given_by)) : undefined
  const ties = giver ? links.filter(l => l.a === giver.id || l.b === giver.id).flatMap(l => {
    const other = npcs.find(n => n.id === (l.a === giver.id ? l.b : l.a))
    return other ? [{ id: l.id, kind: l.kind, name: other.name, label: l.label }] : []
  }) : []
  const place = q.location ? placesFrom(quests).find(p => p.id === placeId(q.location)) : undefined
  const stories = character.progress?.stories ?? []
  const region = stories.find(s => s.emblem === 'region')
  const thread = stories.find(s => s.emblem === (q.character_id ? 'character' : 'main'))
  const related = q.related.map(toRelatedTag)
  const initials = (q.given_by || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()

  return (
    <Dialog label={q.title} onClose={onClose} className={styles.reader}>
      <div className={styles.lift}>
        <Sheet id={q.id} stain="cup" className={styles.readerSheet}>
          <span className={styles.readerTitle}>{q.title}</span>
          {(q.given_by || q.location) && (
            <span className={`${styles.readerBy} prose-voice`}>
              {[q.given_by && `Posted by ${q.given_by}`, q.location].filter(Boolean).join(' · ')}
            </span>
          )}
          <span className={styles.rule} />
          <Prose text={q.description} className={styles.readerProse} />
          {q.objectives.length > 0 && <span className={styles.rule} />}
          {q.objectives.map((o, i) => (
            <span key={i} className={`${styles.obj} ${styles.objBig} ${o.done ? styles.objDone : ''}`}>{o.done ? '✓' : '○'} {o.text}</span>
          ))}
        </Sheet>
        <span className={`${styles.pin} ${q.type === 'main' ? styles.pinRed : styles.pinCyan} ${styles.pinBig}`} />
        <span className={`${styles.ar} ${styles.arTop}`}>{kindLabel(q)} · {STATUS[q.status].toLowerCase()}</span>
        {q.objectives.length > 0 && <span className={`${styles.ar} ${styles.arBottom}`}><ObjTag q={q} /></span>}
      </div>

      <div className={styles.readerSide}>
        <div className={styles.readerHead}>
          <span className={`${styles.chip} ${styles.chipCyan}`}>{STATUS[q.status]}</span>
          <span className={styles.chip}>{kindLabel(q)}</span>
          <button type="button" className={styles.close} onClick={onClose}>Esc · back to the board</button>
        </div>

        <div className={styles.panels}>
          <div className={styles.panelCol}>
            <section className={styles.panel} aria-label="Who gave it">
              <div className={styles.panelLabel}>Who gave it</div>
              {q.given_by ? <>
                <div className={styles.who}>
                  <span className={styles.initials}>{initials}</span>
                  <div><div className={styles.whoName}>{q.given_by}</div>{giver?.role && <div className={styles.whoRole}>{giver.role}</div>}</div>
                </div>
                {giver?.blurb.trim() && <Prose text={giver.blurb} className={styles.panelProse} />}
                {ties.slice(0, 3).map(t => (
                  <div key={t.id} className={styles.tie}><span className={styles.tieKind}>{t.kind}</span> {t.name}{t.label && <span className={`${styles.tieLabel} prose-voice`}> — {t.label}</span>}</div>
                ))}
                {giver && <Link to="/lore" className={styles.go}>On your web ▸</Link>}
              </> : <p className={styles.quiet}>Nobody put a name to it.</p>}
            </section>

            <section className={`${styles.panel} ${styles.grow}`} aria-label="Where">
              <div className={styles.panelLabel}>Where{q.location && <> · {q.location}</>}</div>
              {place ? <>
                <div className={styles.here}>
                  {place.quests.map(o => o.id === q.id ? (
                    <div key={o.id}><span className={styles.mark}>◆</span> {o.title} <span className={styles.note}>this notice</span></div>
                  ) : (
                    <button key={o.id} type="button" className={styles.hereLink} onClick={() => onQuest(o.id)}>
                      <span className={o.status === 'completed' ? styles.good : styles.mark}>{o.status === 'completed' ? '✓' : '◇'}</span> {o.title}
                      {o.status !== 'active' && <span className={styles.note}>{o.status === 'completed' ? 'done' : 'failed'}</span>}
                    </button>
                  ))}
                </div>
                {region && <Link to={`/story/${region.id}/${place.id}`} className={styles.go}>On the Region card ▸</Link>}
              </> : <p className={styles.quiet}>No place named.</p>}
            </section>
          </div>

          <div className={styles.panelCol}>
            {clipped.length > 0 && (
              <section className={`${styles.panel} ${styles.clippedPanel}`} aria-label="Clipped to it">
                <button type="button" className={styles.lift} style={{ transform: 'rotate(-2deg)' }} onClick={() => onHandout(clipped[0].id)} aria-label={`Read ${clipped[0].title || 'Untitled'}`}>
                  <Sheet id={clipped[0].id} className={styles.preview}>
                    <span className={styles.previewTitle}>{clipped[0].title || 'Untitled'}</span>
                    <Prose text={clipped[0].body} className={styles.previewBody} />
                  </Sheet>
                </button>
                <div>
                  <div className={styles.panelLabel}>Clipped to it</div>
                  {clipped.map(h => (
                    <button key={h.id} type="button" className={styles.clipLink} onClick={() => onHandout(h.id)}>
                      <span className={styles.clipName}>{h.title || 'Untitled'}</span>
                      <span className={styles.note}>{receivedAt(h)}</span>
                    </button>
                  ))}
                  <button type="button" className={styles.go} onClick={() => onHandout(clipped[0].id)}>Read it ▸</button>
                </div>
              </section>
            )}

            <section className={`${styles.panel} ${styles.grow}`} aria-label="Sessions it moved">
              <div className={styles.panelLabel}>Sessions it moved</div>
              {sessions.length === 0 ? <p className={styles.quiet}>No session logged against it yet.</p> : (
                [...sessions].reverse().map(s => (
                  <button key={s.id} type="button" className={styles.moved} onClick={() => onSession(s.id)}>
                    <span className={styles.movedHead}><span className={styles.num}>{roman(s.num)}</span> {s.title}<span className={styles.note}>{s.date}</span></span>
                    {s.recap.trim() && <Prose text={s.recap} className={styles.movedRecap} />}
                  </button>
                ))
              )}
            </section>
          </div>
        </div>

        <div className={styles.readerFoot}>
          {related.length > 0 && <>
            <span className={styles.panelLabel}>Related</span>
            <span className={styles.related}>
              {related.map((t, i) => {
                const href = safeHref(t.url)
                return href
                  ? <a key={i} href={href} target="_blank" rel="noopener noreferrer">{t.name} ↗</a>
                  : <span key={i}>{t.name}</span>
              })}
            </span>
          </>}
          {thread && <Link to={`/story/${thread.id}/${q.id}`} className={styles.threadLink}>Open its story thread ▸</Link>}
        </div>
      </div>
    </Dialog>
  )
}

/* ---------------- a session: the system's log, so mono-framed, not paper ---------------- */

function SessionReader({ s, sessions, quests, handouts, onClose, onSession, onQuest, onHandout }: {
  s: SessionRow; sessions: SessionRow[]; quests: QuestRow[]; handouts: HandoutRow[]
  onClose: () => void; onSession: (id: string) => void; onQuest: (id: string) => void; onHandout: (id: string) => void
}) {
  const i = sessions.findIndex(x => x.id === s.id)
  const prev = sessions[i - 1], next = sessions[i + 1]
  // References resolve against what THIS reader may see; the rest drop silently.
  const movedQuests = (s.links ?? []).filter(l => l.kind === 'quest').flatMap(l => quests.filter(q => q.id === l.ref))
  const movedHandouts = (s.links ?? []).filter(l => l.kind === 'handout').flatMap(l => handouts.filter(h => h.id === l.ref))
  return (
    <Dialog label={`Session ${s.num}: ${s.title}`} onClose={onClose} className={styles.log}>
      <div className={styles.readerHead}>
        <span className={`${styles.chip} ${styles.chipCyan}`}>Session log</span>
        <span className={styles.chip}>Session {roman(s.num)}</span>
        <button type="button" className={styles.close} onClick={onClose}>Esc · back to the board</button>
      </div>
      <div className={`${styles.logBody} ${styles.scrollY}`}>
        <div className={styles.logDate}>{s.date}</div>
        <h1 className={styles.logTitle}><span className={styles.num}>{roman(s.num)}</span> {s.title}</h1>
        <div className={styles.attrib}>Recorded by G.U.I.D.E. // Auto-Log</div>
        <Prose text={s.recap} className={styles.logProse} />
        {s.events.length > 0 && <>
          <div className={styles.panelLabel}>Key events</div>
          {s.events.map((e, k) => <div key={k} className={styles.event}><span className={styles.mark}>◆</span> {e}</div>)}
        </>}
        {movedQuests.length + movedHandouts.length > 0 && <>
          <div className={styles.panelLabel}>It moved</div>
          <div className={styles.movedList}>
            {movedQuests.map(q => <button key={q.id} type="button" className={styles.hereLink} onClick={() => onQuest(q.id)}><span className={styles.mark}>◇</span> {q.title}</button>)}
            {movedHandouts.map(h => <button key={h.id} type="button" className={styles.hereLink} onClick={() => onHandout(h.id)}><i className={`fa-solid fa-file-lines ${styles.mark}`} aria-hidden="true" /> {h.title || 'Untitled'}</button>)}
          </div>
        </>}
      </div>
      <div className={styles.logNav}>
        {prev ? <button type="button" className={styles.go} onClick={() => onSession(prev.id)}>◂ {roman(prev.num)} {prev.title}</button> : <span />}
        {next && <button type="button" className={styles.go} onClick={() => onSession(next.id)}>{roman(next.num)} {next.title} ▸</button>}
      </div>
    </Dialog>
  )
}

/* ---------------- the archive: every handout, and closed notices past the pile ---------------- */

function Archive({ handouts, closed, quests, seen, character, selected, onSelect, onQuest, onOpenBeside, onClose }: {
  handouts: HandoutRow[]; closed: QuestRow[]; quests: QuestRow[]; seen: Set<string>; character: CharacterRow
  selected?: string; onSelect: (id: string) => void; onQuest: (id: string) => void
  onOpenBeside: (id: string) => void; onClose: () => void
}) {
  const onScreen = handouts.filter(h => h.on_screen.includes(character.id))
  const filed = handouts.filter(h => !h.on_screen.includes(character.id))
  const h = handouts.find(x => x.id === selected)
  const quest = h?.quest_id ? quests.find(q => q.id === h.quest_id) : undefined
  const row = (x: HandoutRow) => (
    <button key={x.id} type="button" className={`${styles.archRow} ${x.id === selected ? styles.on : ''}`} onClick={() => onSelect(x.id)}>
      <span className={styles.archName}>{x.title || 'Untitled'}</span>
      {!seen.has(x.id) && <span className={styles.newCount}>New</span>}
      <span className={styles.note}>{receivedAt(x)}</span>
    </button>
  )
  return (
    <Dialog label="Archive" onClose={onClose} className={styles.archive}>
      <div className={styles.readerHead}>
        <span className={`${styles.chip} ${styles.chipCyan}`}>Archive</span>
        <span className={styles.chip}>{handouts.length} handouts · {closed.length} closed</span>
        <button type="button" className={styles.close} onClick={onClose}>Esc · back to the board</button>
      </div>
      <div className={styles.archGrid}>
        <nav className={`${styles.archList} ${styles.scrollY}`} aria-label="Handouts and closed notices">
          {handouts.length === 0 && <p className={styles.quiet}>Nothing handed to you yet.</p>}
          {onScreen.length > 0 && <><div className={styles.panelLabel}>On screen</div>{onScreen.map(row)}</>}
          {filed.length > 0 && <><div className={styles.panelLabel}>Filed</div>{filed.map(row)}</>}
          {closed.length > 0 && <>
            <div className={styles.panelLabel}>Closed notices</div>
            {closed.map(q => (
              <button key={q.id} type="button" className={styles.archRow} onClick={() => onQuest(q.id)}>
                <span className={styles.archName}>{q.title}</span><span className={styles.note}>{STATUS[q.status]}</span>
              </button>
            ))}
          </>}
        </nav>
        <div className={`${styles.archRead} ${styles.scrollY}`}>
          {h ? <>
            <div className={styles.archMeta}>
              Received {receivedAt(h)}
              {quest && <> · <button type="button" className={styles.go} onClick={() => onQuest(quest.id)}>{quest.title} ▸</button></>}
            </div>
            <div className={styles.archPage}><HandoutPage h={h} /></div>
            <button type="button" className={styles.threadLink} onClick={() => onOpenBeside(h.id)}>Open beside the game</button>
          </> : <p className={styles.quiet}>Pick a handout to read it.</p>}
        </div>
      </div>
    </Dialog>
  )
}
