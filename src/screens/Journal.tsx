import { useEffect, useState } from 'react'
import { Nav } from '../components/Nav'
import { Deco } from '../components/Deco'
import { useCampaign } from '../lib/campaign'
import type { QuestRow, QuestStatus, QuestType, RelatedTag, SessionRow } from '../lib/database.types'
import styles from './Journal.module.css'

const TYPE_LABEL: Record<QuestType, string> = { main: 'Main Quest', side: 'Side Quest' }
const STATUS_LABEL: Record<QuestStatus, string> = { active: 'Active', completed: 'Completed', failed: 'Failed' }
/** Same rule the DM console's authoring twin uses (OperatorConsole.tsx questGlyph) —
 *  there is no `glyph` column, it's derived from `type` on both sides. */
const questGlyph = (t: QuestType) => (t === 'main' ? '◈' : '◇')

/** Rows written before Related tags carried a `url` are plain strings —
 *  normalize on read so rendering only ever handles the object shape. */
function toRelatedTag(r: RelatedTag | string): RelatedTag {
  return typeof r === 'string' ? { name: r } : r
}

/** Only ever render an http(s) URL as a real link. The DM form nudges toward
 *  a URL but writes free text, and this is the actual security boundary — a
 *  `javascript:` or other scheme in a related tag renders as inert text, not
 *  a clickable href, however the value got into the row. */
function safeHref(url: string | undefined): string | null {
  if (!url) return null
  return /^https?:\/\//i.test(url) ? url : null
}

/** The DM writes one textarea; split on blank lines into paragraphs, falling
 *  back to the whole string as one paragraph when there's no blank line. */
function paragraphs(text: string): string[] {
  const parts = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
  return parts.length ? parts : (text.trim() ? [text.trim()] : [])
}

type Selection = { kind: 'quest'; id: string } | { kind: 'session'; id: string } | null

export function Journal() {
  const { quests, sessions, loading, error } = useCampaign()
  const [tab, setTab] = useState<'quests' | 'sessions'>('quests')
  const [selected, setSelected] = useState<Selection>(null)

  // Main quests lead, side quests follow — within that, useCampaign()'s
  // created_at order holds (stable sort), so edits never reshuffle the list.
  const byType = (a: QuestRow, b: QuestRow) => (a.type === b.type ? 0 : a.type === 'main' ? -1 : 1)
  const active = quests.filter(q => q.status === 'active').sort(byType)
  const completed = quests.filter(q => q.status === 'completed').sort(byType)
  const failed = quests.filter(q => q.status === 'failed').sort(byType)

  // Auto-select the first entry of whichever tab is showing, so the list
  // highlight and the reading panel can never disagree (the mockup's global
  // selectedId + one-shot sessionsVisited latch let them drift apart).
  useEffect(() => {
    if (loading) return
    const list = tab === 'quests' ? [...active, ...completed, ...failed] : sessions
    if (selected && selected.kind === (tab === 'quests' ? 'quest' : 'session')
      && list.some(e => e.id === selected.id)) return
    setSelected(list.length ? { kind: tab === 'quests' ? 'quest' : 'session', id: list[0].id } : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, loading, quests, sessions])

  const meta = (
    <>
      <span className="dim">◇</span>
      <span>Section</span>
      <span className="acc">/ Journal</span>
      <span className="dim">·</span>
      <span>Log Index</span>
      <span className="dim">·</span>
      <span className="stamp">LOG_INDEX</span>
      <span className="dim">::</span>
      <span className="acc">Online</span>
    </>
  )

  const selectedQuest = selected?.kind === 'quest' ? quests.find(q => q.id === selected.id) ?? null : null
  const selectedSession = selected?.kind === 'session' ? sessions.find(s => s.id === selected.id) ?? null : null

  return (
    <>
      <Deco
        left={<><span className="acc">JOURNAL</span> &nbsp;//&nbsp; LOG_INDEX &nbsp;//&nbsp; SYNC OK</>}
        right={<>Log <span className="acc">ENTRIES :: {quests.length + sessions.length}</span> &nbsp;//&nbsp; Auto-Log</>}
      />
      <Nav variant="dock" meta={meta} />

      <div className={styles.journal}>
        <section className={styles.col} aria-label="Log index">
          <div className={styles.colHeader}>
            <span className={styles.chNum}>01</span>
            <span className={styles.chTitle}>Log Index</span>
            <span className={styles.chMeta}>
              <span className="acc">{active.length}</span> Active <span className="dim">·</span> {completed.length} Done
            </span>
          </div>
          <div className={styles.region}>
            <div className={styles.rFrame} /><div className={styles.rGap} /><div className={styles.rLine} />
            <div className={styles.rInner}>
              <span className={`${styles.rCorner} ${styles.tl}`} />
              <span className={`${styles.rCorner} ${styles.br}`} />
              <div className={styles.indexPad}>
                <div className={styles.tabBar} role="tablist">
                  <button
                    type="button" role="tab" aria-selected={tab === 'quests'}
                    className={`${styles.tab} ${tab === 'quests' ? styles.on : ''}`}
                    onClick={() => setTab('quests')}
                  >
                    Quests<span className={styles.tCount}>{String(quests.length).padStart(2, '0')}</span>
                  </button>
                  <button
                    type="button" role="tab" aria-selected={tab === 'sessions'}
                    className={`${styles.tab} ${tab === 'sessions' ? styles.on : ''}`}
                    onClick={() => setTab('sessions')}
                  >
                    Sessions<span className={styles.tCount}>{String(sessions.length).padStart(2, '0')}</span>
                  </button>
                </div>

                <div className={`${styles.indexScroll} ${styles.scrollY}`}>
                  {loading ? null : tab === 'quests' ? (
                    quests.length === 0 ? (
                      <EmptyIndex text="No quests logged yet." />
                    ) : (
                      <>
                        {active.length > 0 && <QuestGroup label="Active" cls={styles.grpActive} n={active.length} quests={active} selected={selected} onSelect={setSelected} />}
                        {completed.length > 0 && <QuestGroup label="Completed" n={completed.length} quests={completed} selected={selected} onSelect={setSelected} />}
                        {failed.length > 0 && <QuestGroup label="Failed" cls={styles.grpFailed} n={failed.length} quests={failed} selected={selected} onSelect={setSelected} />}
                      </>
                    )
                  ) : (
                    sessions.length === 0 ? (
                      <EmptyIndex text="No sessions logged yet." />
                    ) : (
                      sessions.map(s => (
                        <SessionRowBtn key={s.id} s={s} selected={selected?.kind === 'session' && selected.id === s.id}
                          onSelect={() => setSelected({ kind: 'session', id: s.id })} />
                      ))
                    )
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.col} aria-label="Entry">
          <div className={styles.colHeader}>
            <span className={styles.chNum}>02</span>
            <span className={styles.chTitle}>Entry</span>
            <span className={styles.chMeta}>
              {selectedQuest && <>{STATUS_LABEL[selectedQuest.status]} <span className="dim">·</span> {TYPE_LABEL[selectedQuest.type]}</>}
              {selectedSession && <>Session {selectedSession.num} <span className="dim">·</span> Auto-Log</>}
            </span>
          </div>
          <div className={styles.region}>
            <div className={styles.rFrame} /><div className={styles.rGap} /><div className={styles.rLine} />
            <div className={styles.rInner}>
              <span className={`${styles.rCorner} ${styles.tl}`} />
              <span className={`${styles.rCorner} ${styles.br}`} />
              <div className={`${styles.readPad} ${styles.scrollY}`}>
                {loading ? (
                  <div className={styles.state}>
                    <i className="fa-solid fa-spinner fa-spin" aria-hidden="true" />
                    <p>Syncing campaign log&hellip;</p>
                  </div>
                ) : error ? (
                  <div className={`${styles.state} ${styles.bad}`}>
                    <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />
                    <p>{error}</p>
                  </div>
                ) : selectedQuest ? (
                  <QuestEntry q={selectedQuest} />
                ) : selectedSession ? (
                  <SessionEntry s={selectedSession} />
                ) : (
                  <div className={styles.state}>
                    <i className="fa-solid fa-folder-open" aria-hidden="true" />
                    <p>Nothing logged yet.</p>
                    <p className={styles.stateSub}>
                      The DM authors quests and sessions in the Operator Console, into <code>quests</code> and <code>sessions</code>.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  )
}

function EmptyIndex({ text }: { text: string }) {
  return <p className={styles.stateSub} style={{ padding: '16px 6px' }}>{text}</p>
}

function QuestGroup({
  label, cls, n, quests, selected, onSelect,
}: { label: string; cls?: string; n: number; quests: QuestRow[]; selected: Selection; onSelect: (s: Selection) => void }) {
  return (
    <>
      <div className={`${styles.groupHead} ${cls ?? ''}`}>{label}<span className={styles.gN}>{n}</span></div>
      {quests.map(q => (
        <QuestRowBtn key={q.id} q={q} selected={selected?.kind === 'quest' && selected.id === q.id}
          onSelect={() => onSelect({ kind: 'quest', id: q.id })} />
      ))}
    </>
  )
}

const QUEST_ST_CLS: Record<QuestStatus, string> = { active: styles.stActive, completed: styles.stCompleted, failed: styles.stFailed }

function QuestRowBtn({ q, selected, onSelect }: { q: QuestRow; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button" onClick={onSelect}
      className={`${styles.idxRow} ${QUEST_ST_CLS[q.status]} ${selected ? styles.selected : ''}`}
    >
      <span className={styles.irTop}>
        <span className={styles.irGlyph}>{questGlyph(q.type)}</span>
        <span className={styles.irTitle}>{q.title}</span>
        {q.status === 'completed' && <span className={styles.irCheck}><i className="fa-solid fa-check" /></span>}
      </span>
      <span className={styles.irMeta}>{q.type.toUpperCase()}<span className="sep">·</span>{q.location.toUpperCase()}</span>
    </button>
  )
}

function SessionRowBtn({ s, selected, onSelect }: { s: SessionRow; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" onClick={onSelect} className={`${styles.idxRow} ${styles.session} ${selected ? styles.selected : ''}`}>
      <span className={styles.irTop}><span className={styles.irNo}>SESSION {String(s.num).padStart(2, '0')}</span></span>
      <span className={styles.irTop}><span className={styles.irTitle}>{s.title}</span></span>
      <span className={styles.irMeta}>{s.date}</span>
    </button>
  )
}

function QuestEntry({ q }: { q: QuestRow }) {
  const badgeCls = q.status === 'active' ? styles.bActive : q.status === 'completed' ? styles.bCompleted : styles.bFailed
  const entryStCls = q.status === 'active' ? styles.stActive : q.status === 'completed' ? styles.stCompleted : styles.stFailed
  const done = q.objectives.filter(o => o.done).length
  return (
    <div className={`${styles.entry} ${entryStCls}`}>
      <div className={styles.badges}>
        <span className={`${styles.badge} ${badgeCls}`}>{STATUS_LABEL[q.status]}</span>
        <span className={`${styles.badge} ${styles.bType}`}>{TYPE_LABEL[q.type]}</span>
      </div>
      <h1 className={styles.entryTitle}>{q.title}</h1>
      <div className={styles.entryMeta}>
        <span className="k">Given By:</span> <span className="v">{q.given_by}</span>
        <span className="sep">·</span>
        <span className="k">Location:</span> <span className="v">{q.location}</span>
      </div>
      <div className={styles.entryRule} />
      <div className={styles.prose}>
        {paragraphs(q.description).map((p, i) => <p key={i}>{p}</p>)}
      </div>
      {q.objectives.length > 0 && (
        <>
          <div className={styles.subLabel}>Objectives <span className="acc">::</span> {done} / {q.objectives.length}</div>
          <div className={styles.objList}>
            {q.objectives.map((o, i) => (
              <div key={i} className={`${styles.objRow} ${o.done ? styles.done : ''}`}>
                <span className={styles.objBox}><i className={o.done ? 'fa-solid fa-circle-check' : 'fa-regular fa-circle'} /></span>
                <span className={styles.objText}>{o.text}</span>
              </div>
            ))}
          </div>
        </>
      )}
      {q.related.length > 0 && (
        <>
          <div className={styles.subLabel}>Related</div>
          <div className={styles.related}>
            {q.related.map(toRelatedTag).map((tag, i) => {
              const href = safeHref(tag.url)
              return href ? (
                <a key={i} className={styles.chip} href={href} target="_blank" rel="noopener noreferrer">
                  {tag.name}<i className={`fa-solid fa-arrow-up-right-from-square ${styles.cLink}`} aria-hidden="true" />
                </a>
              ) : (
                <span key={i} className={styles.chip}><span className={styles.cG}>◇</span>{tag.name}</span>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function SessionEntry({ s }: { s: SessionRow }) {
  return (
    <div className={`${styles.entry} ${styles.session}`}>
      <div className={styles.badges}>
        <span className={`${styles.badge} ${styles.bLog}`}>Session Log</span>
        <span className={`${styles.badge} ${styles.bType}`}>Session {s.num}</span>
      </div>
      <div className={styles.entryMeta}>
        <span className="k">Session {s.num}</span> <span className="sep">·</span> <span className="v">{s.date}</span>
      </div>
      <h1 className={styles.entryTitle}>{s.title}</h1>
      <div className={styles.attrib}>Recorded by G.U.I.D.E. &nbsp;//&nbsp; Auto-Log</div>
      <div className={styles.entryRule} />
      <div className={styles.prose}>
        {paragraphs(s.recap).map((p, i) => <p key={i}>{p}</p>)}
      </div>
      {s.events.length > 0 && (
        <>
          <div className={styles.subLabel}>Key Events</div>
          <div className={styles.events}>
            {s.events.map((e, i) => (
              <div key={i} className={styles.eventRow}><span className={styles.evMark}>◆</span><span>{e}</span></div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
