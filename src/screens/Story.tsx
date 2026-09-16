import { useMemo } from 'react'
import { Link, Navigate, useOutletContext, useParams } from 'react-router-dom'
import type { CharacterRow, SessionRow } from '../lib/database.types'
import { Nav } from '../components/Nav'
import { Deco } from '../components/Deco'
import { useCampaign } from '../lib/campaign'
import { Prose } from '../lib/markdown'
/* Geometry and thread sources live in lib/ with storyLattice.test.ts beside
   them: a leader that misses its node by four pixels reads as a rendering
   quirk, so the invariants are asserted rather than eyeballed. */
import type { Thread } from '../lib/storyLattice'
import {
  COL, CX, CY, FOCAL_BREAK, R_ARC, ROW_H, SIDE_GAP, SIDE_ROW_H,
  arcPath, completionFor, recordFor, threadsFor, wiresFor, zoomTo,
} from '../lib/storyLattice'
import styles from './Story.module.css'

interface RouteContext {
  character: CharacterRow
}

/** One thread. A LINK, which is what makes both descending and hopping free —
 *  and 44px tall for a side quest against 92 for a main one, because the rank
 *  difference has to be visible without reading the glyph. */
function Row({ t, story, open }: { t: Thread; story: string; open: boolean }) {
  const side = t.kind === 'side'
  return (
    <Link
      to={`/story/${story}/${t.id}`}
      className={`${styles.row} ${side ? styles.sideRow : ''}`
        + ` ${t.tone === 'closed' ? styles.closed : t.tone === 'current' ? styles.current : ''}`
        + ` ${open ? styles.open : ''}`}
      style={{ height: side ? SIDE_ROW_H : ROW_H }}
      aria-current={open ? 'page' : undefined}
    >
      <div className={styles.rowTop}>
        <span className={styles.rowGlyph} aria-hidden="true">{side ? '◇' : '◈'}</span>
        <span className={styles.rowTitle}>{t.title}</span>
        <span className={styles.rowTone}>
          {t.tone === 'closed' ? 'Closed' : t.tone === 'current' ? 'Current' : 'Active'}
        </span>
      </div>
      {!side && <div className={styles.rowMeta}>{t.meta}</div>}
    </Link>
  )
}

/** The story screen: a Codex card, opened.
 *
 *  DEPTH IS THE URL. `/story/:storyId` is this screen; the thread depth will be
 *  `/story/:storyId/:threadId`. Nothing mirrors that into component state — the
 *  browser's back button and a shareable link both come free, and there is no
 *  second source of truth for "where am I".
 *
 *  Deliberately NOT an overlay. Six components already wear this app's centred
 *  chamfered panel (ShopTakeover, LootTakeover, LevelUpOverlay, LootRollOverlay,
 *  ActivationSheet, PrimeSheet) and it reads as "the DM opened something for
 *  you", which a story you chose to read is not. There is no scrim here at all,
 *  so the sigil keeps turning and no backdrop-filter ever runs over it. */
export function Story() {
  const { character } = useOutletContext<RouteContext>()
  const { storyId, threadId } = useParams()
  const { quests, sessions, loading, error } = useCampaign()

  const stories = character.progress?.stories ?? []
  const story = stories.find(s => s.id === storyId)

  const threads = useMemo(
    () => (story ? threadsFor(story, quests, character) : []),
    [story, quests, character],
  )
  // wiresFor reads each thread's KIND, so this can no longer key on the count
  // alone — three main and three side do not solve the same as six main.
  const wires = useMemo(() => wiresFor(threads), [threads])

  // A card the DM deleted, or a hand-typed id. The route table's `*` cannot
  // catch this one — it matched a real route with an id that finds nothing.
  if (!story) return <Navigate to="/" replace />

  // DEPTH IS THE URL: a :threadId in the path IS the thread depth. Nothing
  // mirrors it into state, so back and a shared link both work for free.
  const record = threadId ? recordFor(story, threadId, quests, character) : null
  // Only redirect once the campaign has actually loaded — quests start empty, so
  // resolving this during the fetch would bounce every deep link on arrival.
  if (threadId && !loading && !record) return <Navigate to={`/story/${story.id}`} replace />

  const focus = threadId ? threads.findIndex(t => t.id === threadId) : -1
  // At the thread depth the instrument zooms so the open node comes to rest
  // beside its own row. The leaders stay OUT of this transform — they have to
  // reach rows that never move, which is the whole point of them.
  // With nothing open the halo marks the CURRENT thread, which is the first main
  // one — never a side quest, even when it happens to sort first.
  const lit = focus >= 0 ? focus : threads.findIndex(t => t.kind === 'main')
  const zoom = focus >= 0 && wires[focus] ? zoomTo(wires[focus]!, wires[focus]!.ey) : null
  const mainThreads = threads.filter(t => t.kind === 'main')
  const sideThreads = threads.filter(t => t.kind === 'side')
  // Must match sideRowY's arithmetic exactly — it is the same stack.
  const listH = mainThreads.length * ROW_H
    + (sideThreads.length ? SIDE_GAP + sideThreads.length * SIDE_ROW_H : 0)
  // THE PERCENT IS COMPLETION, not narrative progress — closed quests over all
  // of them, side quests included. Null where there is nothing countable (region
  // has no locations table, a relation never completes), and there the DM's
  // authored number still stands.
  const done = completionFor(story, quests, character)
  const pct = done ? done.percent : story.percent
  const arc = arcPath(pct)
  const latest: SessionRow | undefined = sessions[0]

  return (
    <>
      <Deco
        left={<><span className="acc">CODEX</span> &nbsp;//&nbsp; {story.title.toUpperCase()} &nbsp;//&nbsp; SYNC OK</>}
        right={<>{story.telemetry ?? 'Story Lattice'} &nbsp;//&nbsp; <span className="acc">{pct}%</span></>}
      />
      <Nav
        variant="dock"
        meta={<>
          <span className="dim">◇</span>
          <span>Section</span>
          <span className="acc">/ Codex</span>
          <span className="dim">·</span>
          <span>{story.title}</span>
          <span className="dim">::</span>
          <span className="acc">{story.label}</span>
        </>}
      />

      <div className={styles.story}>
        <div className={styles.body}>

          {/* ---- the instrument: sigil, ring, arc and nodes. This is what zooms. ---- */}
          <div className={styles.instrument} style={zoom ? { transform: zoom.transform } : undefined}>
            <div className={styles.lattice} aria-hidden="true">
              <svg viewBox="0 0 640 640" fill="none" stroke="currentColor" strokeWidth="1.2">
                <g className={styles.rotSlow} strokeOpacity="0.26">
                  <circle cx="320" cy="320" r="300" />
                  <circle cx="320" cy="320" r="292" strokeOpacity="0.5" />
                  <polygon points="320,80 528,200 528,440 320,560 112,440 112,200" />
                  <polygon points="320,108 504,214 504,426 320,532 136,426 136,214" strokeOpacity="0.5" />
                </g>
                <g className={styles.rotRev} strokeOpacity="0.26">
                  <line x1="320" y1="40" x2="320" y2="600" />
                  <line x1="40" y1="320" x2="600" y2="320" />
                  <line x1="120" y1="120" x2="520" y2="520" />
                  <line x1="520" y1="120" x2="120" y2="520" />
                  <polygon points="320,140 447,193 500,320 447,447 320,500 193,447 140,320 193,193" />
                  <polygon points="320,210 430,320 320,430 210,320" strokeOpacity="0.5" />
                  <circle cx="320" cy="320" r="220" strokeOpacity="0.3" strokeDasharray="3 6" />
                </g>
              </svg>
            </div>

            <svg className={styles.marks} aria-hidden="true" fill="none">
              <circle className={styles.ring} cx={CX} cy={CY} r={R_ARC} strokeWidth="3" />
              {arc && <path className={styles.arc} d={arc} strokeWidth="3.5" />}
              {wires.map((w, i) => w && (
                <g
                  key={threads[i].id}
                  className={`${threads[i].kind === 'side' ? styles.wireSide : threads[i].tone === 'closed' ? styles.wireOff : styles.wire}`
                    + `${focus >= 0 && i !== focus ? ' ' + styles.wireDim : ''}`}
                >
                  {threads[i].kind === 'side'
                    ? <circle cx={w.nx} cy={w.ny} r="4" className={styles.sideNode} />
                    : <circle cx={w.nx} cy={w.ny} r={i === lit ? 5.5 : 4.5} className={styles.node} />}
                  {i === lit && <circle cx={w.nx} cy={w.ny} r="13" className={styles.halo} />}
                </g>
              ))}
            </svg>

            {/* The node is a way IN, not decoration — the wiring runs both ways, so
                what the leader points at is also what you can click. HTML rather
                than SVG so it inherits the instrument's transform without any
                namespace questions, and aria-hidden + tabIndex -1 because the row
                is the same link: a screen reader should hear it once, not twice. */}
            {wires.map((w, i) => w && (
              <Link
                key={threads[i].id}
                to={`/story/${story.id}/${threads[i].id}`}
                className={`${styles.nodeHit} ${threads[i].id === threadId ? styles.nodeOpen : ''}`}
                style={{ left: w.nx, top: w.ny }}
                aria-hidden="true"
                tabIndex={-1}
              />
            ))}
          </div>

          {/* ---- the leaders, in the body's own px and never zoomed ---- */}
          <svg className={styles.leaders} aria-hidden="true" fill="none">
            {zoom ? (
              /* Zoomed in, one thread is open and only its wire is drawn — from
                 where the node actually came to rest, so it still reads as the
                 same circuit rather than a line to nowhere. */
              <g className={threads[focus].kind === 'side' ? styles.wireSide : threads[focus].tone === 'closed' ? styles.wireOff : styles.wire}>
                <line x1={zoom.focal.x} y1={zoom.focal.y} x2={zoom.focal.x + FOCAL_BREAK} y2={wires[focus]!.ey} />
                <line x1={zoom.focal.x + FOCAL_BREAK} y1={wires[focus]!.ey} x2={COL - 4} y2={wires[focus]!.ey} />
              </g>
            ) : wires.map((w, i) => w && (
              <g key={threads[i].id} className={threads[i].kind === 'side' ? styles.wireSide : threads[i].tone === 'closed' ? styles.wireOff : styles.wire}>
                <line x1={w.nx} y1={w.ny} x2={w.ex} y2={w.ey} />
                <line x1={w.ex} y1={w.ey} x2={COL - 4} y2={w.ey} />
              </g>
            ))}
          </svg>

          {/* ---- the payoff, where the sigil's decorative centre used to be ---- */}
          <div className={`${styles.centre} ${zoom ? styles.gone : ''}`}>
            <div className={styles.centreLabel}>{story.label}</div>
            <div className={styles.pct}>
              {pct}<span className={styles.pctSign}>%</span>
            </div>
            {done && <div className={styles.centreDone}>{done.done} / {done.total} closed</div>}
            <div className={styles.centreRule} />
            {story.chapter && <div className={styles.chapter}>{story.chapter}</div>}
            {story.telemetry && <div className={styles.centreMeta}>{story.telemetry}</div>}
          </div>

          {/* ---- the dossier: hairlines and type, no frame ---- */}
          <div className={styles.dossier}>
            <Link to={threadId ? `/story/${story.id}` : '/'} className={styles.back}>
              <span className={styles.backGlyph} aria-hidden="true">◀</span>{' '}
              {threadId ? story.title : 'Codex'}
            </Link>

            <div className={styles.tabs} role="tablist">
              {stories.map(s => (
                <Link
                  key={s.id} to={`/story/${s.id}`} role="tab"
                  aria-selected={s.id === story.id}
                  className={`${styles.tab} ${s.id === story.id ? styles.on : ''}`}
                >
                  {s.title}<span className={styles.tabPct}>{s.percent}%</span>
                </Link>
              ))}
            </div>

            {/* THE DOSSIER IS TWO COLUMNS, NOT A STACK. Measured live, the chrome
                leaves this screen 472px of height on a 746px viewport but 882px of
                width, so the reading half sits BESIDE the threads rather than under
                them — stacked, it fell entirely below the fold. The heading band is
                grid row 1 and the rows are row 2, which is what makes ROWS_TOP =
                HEADS_TOP + HEAD_H rather than a second hand-typed number. */}
            <div className={styles.stack}>
              <div className={styles.head}>
                Threads <span className="acc">::</span>{' '}
                <span className={styles.headCount}>
                  {loading ? 'syncing…' : `${threads.filter(t => t.tone !== 'closed').length} open · ${threads.filter(t => t.tone === 'closed').length} closed`}
                </span>
              </div>
              <div className={styles.vrule} />
              <div className={styles.head}>
                {record
                  ? <>{record.kicker}{record.status && <span className={styles.headCount}> :: {record.status}</span>}</>
                  : <>Last Session{latest && <span className={styles.headCount}> :: {String(latest.num).padStart(2, '0')}</span>}</>}
              </div>

              <div className={styles.rows} style={{ height: listH || undefined }}>
                {error && <p className={styles.state}>{error}</p>}
                {!loading && !error && threads.length === 0 && (
                  <p className={styles.state}>
                    Nothing wired to this card yet. The DM authors these in the Operator Console.
                  </p>
                )}
                {mainThreads.map(t => <Row key={t.id} t={t} story={story.id} open={t.id === threadId} />)}

                {/* The outer orbit. Side quests are the same campaign one rank
                    down — their own rule, their own 44px row, and out on the
                    sigil's outer circle rather than the inner ring. */}
                {sideThreads.length > 0 && (
                  <div className={styles.sideRule}>
                    Side<span className={styles.sideCount}>{sideThreads.length}</span>
                  </div>
                )}
                {sideThreads.map(t => <Row key={t.id} t={t} story={story.id} open={t.id === threadId} />)}
              </div>

              {/* Only this column scrolls. The threads never can — their rows ARE the
                  y's the leaders were solved against. */}
              <div className={`${styles.reading} ${styles.scrollY}`}>
                {record ? (
                  <>
                    <h2 className={styles.sessTitle}>{record.title}</h2>
                    {record.meta.length > 0 && (
                      <div className={styles.recMeta}>
                        {record.meta.map(m => (
                          <span key={m.k}><span className={styles.recK}>{m.k}:</span> {m.v}</span>
                        ))}
                      </div>
                    )}
                    {/* <Prose>, never printed raw: this is authored in a
                        markdownShortcuts textarea and proseFields.test.ts guards it. */}
                    {record.body && <Prose text={record.body} className={styles.prose} />}

                    {record.objectives.length > 0 && (
                      <>
                        <div className={styles.subHead}>
                          Objectives <span className="acc">::</span>{' '}
                          {record.objectives.filter(o => o.done).length} / {record.objectives.length}
                        </div>
                        {record.objectives.map((o, i) => (
                          <div key={i} className={`${styles.objRow} ${o.done ? styles.done : ''}`}>
                            <span className={styles.objBox} aria-hidden="true">{o.done ? '◆' : '◇'}</span>
                            <span className={styles.objText}>{o.text}</span>
                          </div>
                        ))}
                      </>
                    )}

                    {record.links.length > 0 && (
                      <>
                        <div className={styles.subHead}>Quests here</div>
                        {record.links.map(l => (
                          <div key={l.id} className={styles.logRow}>
                            <span className={styles.logNum} aria-hidden="true">◈</span>
                            <div>
                              <div className={styles.logTitle}>{l.title}</div>
                              <div className={styles.logDate}>{l.meta}</div>
                            </div>
                          </div>
                        ))}
                      </>
                    )}

                    {record.related.length > 0 && (
                      <>
                        <div className={styles.subHead}>Related</div>
                        {/* Inert text, not links. A tag's `url` is DM-authored free
                            text, and rendering it as an href would need the Journal's
                            scheme check; there is nowhere to navigate to from here. */}
                        <div className={styles.chips}>
                          {record.related.map((r, i) => <span key={i} className={styles.chip}>{r.name}</span>)}
                        </div>
                      </>
                    )}
                  </>
                ) : latest ? (
                  <>
                    <h2 className={styles.sessTitle}>{latest.title}</h2>
                    <div className={styles.sessDate}>{latest.date}</div>
                    <Prose text={latest.recap} className={styles.prose} />
                    {latest.events.length > 0 && (
                      <div className={styles.events}>
                        {latest.events.map((e, i) => (
                          <div key={i} className={styles.event}>
                            <span className={styles.evMark} aria-hidden="true">▸</span>{e}
                          </div>
                        ))}
                      </div>
                    )}
                    {sessions.length > 1 && (
                      <>
                        <div className={styles.subHead}>Log</div>
                        {sessions.slice(1).map(sn => (
                          <div key={sn.id} className={styles.logRow}>
                            <span className={styles.logNum}>{String(sn.num).padStart(2, '0')}</span>
                            <div>
                              <div className={styles.logTitle}>{sn.title}</div>
                              <div className={styles.logDate}>{sn.date}</div>
                            </div>
                          </div>
                        ))}
                      </>
                    )}
                  </>
                ) : (
                  <p className={styles.state}>{loading ? 'Syncing campaign log…' : 'No sessions logged yet.'}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
