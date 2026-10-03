import { ManagedImage } from '../components/ManagedImage'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useOutletContext } from 'react-router-dom'
import type { CharacterRow } from '../lib/database.types'
import type { HandoutOutlet } from '../lib/handouts'
import { Nav } from '../components/Nav'
import { Deco } from '../components/Deco'
import { Creep } from '../components/Creep'
import { KnownCard, NpcWebView } from '../components/NpcWebView'
import { Prose, Inline } from '../lib/markdown'
import { origins } from '../lib/featureView'
import { useCampaign } from '../lib/campaign'
import { useKnownNpcs } from '../lib/npcs'
import { derive, groupByTie, layout } from '../lib/npcWeb'
import { integrityOf, overallIntegrity, parseLore, type LoreCard, type LoreSection } from '../lib/loreDoc'
import { placeId, placesFrom } from '../lib/storyLattice'
import { Icon } from '../components/Icon'
import web from '../components/NpcWebView.module.css'
import styles from './Lore.module.css'

interface RouteContext extends HandoutOutlet {
  character: CharacterRow
}

const VITALS: { k: string; v: (c: CharacterRow) => string | undefined }[] = [
  { k: 'Race', v: c => c.identity?.race ?? undefined },
  { k: 'Class', v: c => c.identity?.class ?? undefined },
  { k: 'Archetype', v: c => c.identity?.archetype ?? undefined },
  { k: 'Background', v: c => c.identity?.background ?? undefined },
  { k: 'Alignment', v: c => c.lore?.identity?.alignment },
  { k: 'Age', v: c => c.lore?.identity?.age },
  { k: 'Height', v: c => c.lore?.identity?.height },
  { k: 'Deity', v: c => c.lore?.identity?.deity },
  { k: 'Homeland', v: c => c.lore?.identity?.homeland },
]

const NATURE: { key: 'trait' | 'ideal' | 'bond' | 'flaw'; label: string }[] = [
  { key: 'trait', label: 'Personality Trait' },
  { key: 'ideal', label: 'Ideal' },
  { key: 'bond', label: 'Bond' },
  { key: 'flaw', label: 'Flaw' },
]

const DRAWER_W = 320

/** Scroll the page to a heading. A button rather than an `#anchor` link: the
 *  router owns the URL, and a hash there would be a navigation. */
const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ block: 'start' })

/** Lore — the character's record as they remember it, read back by G.U.I.D.E.
 *
 *  The backstory is the page: `#` groups and `##` sections from the author's own
 *  article (lib/loreDoc.ts), sections of `**Name** - text` lines shown as cards,
 *  and a section G.U.I.D.E. is taking rendered as its letters falling to 1s and
 *  0s. After it: the sessions lived, what they've been handed and told, and the
 *  people they know. Read-only for players; authored DM-side. */
export function Lore() {
  const { character, handouts } = useOutletContext<RouteContext>()
  const { quests, sessions } = useCampaign(character.id)
  const { npcs, links } = useKnownNpcs(character.id)
  const identity = character.identity ?? {}
  const lore = character.lore ?? {}
  const origin = origins(character.sheet?.features)
  const doc = useMemo(() => parseLore(lore.backstory), [lore.backstory])
  const integ = lore.integrity
  const overall = overallIntegrity(doc, integ)
  const sections = doc.groups.flatMap(g => g.sections)
  const taking = sections.filter(s => integrityOf(integ, s.name) < 100)

  const graph = useMemo(() => groupByTie(derive(npcs, links, [character], quests)), [npcs, links, character, quests])
  const orbit = useMemo(() => layout(graph), [graph])
  const [sel, setSel] = useState<string | null>(null)
  const selected = sel ? graph.nodes.find(n => n.id === sel) ?? null : null
  useEffect(() => { if (sel && !selected) setSel(null) }, [sel, selected])

  // Full screen is an app layer, not the browser's Fullscreen API: that can be
  // refused (a hidden tab, a permission) with nothing to show for the click, and
  // iPhone Safari has no element fullscreen at all. The web's box just covers the
  // app; NpcWebView refits because it measures its pane. Esc closes a selected
  // person first, then the layer.
  const [full, setFull] = useState(false)
  useEffect(() => {
    if (!full) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (sel) setSel(null); else setFull(false) } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [full, sel])

  // The Journal owns sessions and handouts, the Region story card owns places;
  // Lore only says what it knows about them and links there.
  const latest = sessions[0]                           // newest first, from useCampaign
  const recent = handouts.slice(0, 3)                  // newest first, from useHandouts
  const home = lore.identity?.homeland?.trim()
  const visited = placesFrom(quests)
  const places = home && !visited.some(p => p.id === placeId(home))
    ? [{ id: placeId(home), name: home, quests: [] }, ...visited] : visited
  const region = (character.progress?.stories ?? []).find(s => s.emblem === 'region')
  const byId = new Map(npcs.map(n => [n.id, n.name]))
  const ties = links.filter(l => byId.has(l.a) && byId.has(l.b))
  const hasNature = NATURE.some(n => lore.personality?.[n.key])

  const webView = (
    <NpcWebView
      tone="player" web={graph} orbit={orbit} sel={sel} onSelect={setSel}
      drawerOpen={!!selected} drawerW={DRAWER_W}
      empty={<div className={web.empty}><span className={web.emptyT}>Nobody on your web yet</span></div>}
    >
      <div className={web.toolbar}>
        <span className={web.count}>{graph.nodes.length} known</span>
        <button type="button" className={web.tool} onClick={() => setFull(f => !f)} aria-pressed={full}>
          {full ? 'Esc · leave full screen' : '⛶ Full screen'}
        </button>
      </div>
      {selected && (
        <aside className={web.drawer} style={{ width: DRAWER_W }} aria-label={selected.name}>
          <KnownCard n={selected} web={graph} onSelect={setSel} onClose={() => setSel(null)} />
        </aside>
      )}
    </NpcWebView>
  )

  const idLine = [identity.race, identity.class].filter(Boolean).join(' ')
  const meta = (
    <>
      <span className="dim">◇</span>
      <span>Section</span>
      <span className="acc">/ Lore</span>
      <span className="dim">·</span>
      <span>Bio-Record</span>
      <span className="dim">::</span>
      <span className="acc">Integrity {overall}%</span>
    </>
  )

  return (
    <>
      <Deco
        left={<><span className="acc">LORE</span> &nbsp;//&nbsp; BIO_RECORD &nbsp;//&nbsp; SYNC OK</>}
        right={<>Record <span className="acc">{character.name.toUpperCase()}</span> &nbsp;//&nbsp; DM-Authored</>}
      />
      <Nav variant="dock" meta={meta} />

      <main className={styles.lore}>
        <div className={styles.page}>
          <aside className={styles.rail} aria-label="Dossier">
            <BioPortrait character={character} />
            <div className={styles.nameplate}>
              <div className={styles.npName}>{character.name}</div>
              {idLine && <div className={styles.npSub}>{idLine}</div>}
            </div>
            <div className={styles.vitals}>
              {VITALS.map(({ k, v }) => {
                const value = v(character)
                return value ? (
                  <div className={styles.vital} key={k}>
                    <span className={styles.vK}>{k}</span>
                    <span className={styles.vV}>{value}</span>
                  </div>
                ) : null
              })}
            </div>

            <nav className={styles.contents} aria-label="Contents">
              <div className={styles.cHead}><span>Contents · integrity</span><span>{overall}%</span></div>
              {doc.groups.map(g => {
                const gi = groupIntegrity(g.sections, integ)
                return (
                  <div key={g.id} className={`${styles.cGroup} ${gi < 100 ? styles.taking : ''}`}>
                    <div className={styles.cGroupRow}>
                      <button type="button" className={styles.cGroupName} onClick={() => jump(g.id)}>{g.name ? <Inline text={g.name} /> : 'Record'}</button>
                      <span className={styles.cPct}>{gi}%</span>
                    </div>
                    <div className={styles.cBar}><i style={{ width: `${gi}%` }} /></div>
                    {g.sections.filter(s => s.name).map(s => (
                      <button key={s.id} type="button" onClick={() => jump(s.id)}
                        className={`${styles.cSec} ${integrityOf(integ, s.name) < 100 ? styles.taking : ''}`}>
                        <Inline text={s.name} />{integrityOf(integ, s.name) < 100 ? ' ◇' : ''}
                      </button>
                    ))}
                  </div>
                )
              })}
              {origin.length > 0 && <div className={styles.cGroup}><button type="button" className={styles.cGroupName} onClick={() => jump('lore-origin')}>Origin</button></div>}
              {hasNature && <div className={styles.cGroup}><button type="button" className={styles.cGroupName} onClick={() => jump('lore-nature')}>Nature</button></div>}
              {[['lore-chronicle', 'Chronicle'], ['lore-learned', 'What you’ve learned'], ['lore-people', 'People']].map(([id, label]) => (
                <div key={id} className={styles.cGroup}><button type="button" className={styles.cGroupName} onClick={() => jump(id)}>{label}</button></div>
              ))}
            </nav>
          </aside>

          <article className={styles.article}>
            <div className={styles.readout}>
              <span className={styles.sys}>◆ G.U.I.D.E.</span>
              <span>Bio-record</span>
              <span>Subject · {character.name}</span>
              <span className={styles.end}>Integrity {overall}%</span>
            </div>
            <div className={styles.kicker}>Bio-record · as {character.name.split(' ')[0]} remembers it</div>
            <h1 className={styles.title}>{character.name}</h1>
            {sections.length > 0 && (
              <div className={styles.chips}>
                <span className={styles.chip}>{sections.length - taking.length} sections intact</span>
                {taking.length > 0 && <span className={`${styles.chip} ${styles.taking}`}>{taking.length} digitising</span>}
              </div>
            )}

            {!lore.backstory?.trim() && <p className={styles.stateSub}>// No record on file</p>}
            {doc.intro && <Prose text={doc.intro} className={`${styles.record} ${styles.intro}`} />}

            {doc.groups.map(g => (
              <section key={g.id} aria-label={g.name || 'Record'}>
                {g.name && <div id={g.id} className={styles.group}><h2 className={styles.groupName}><Inline text={g.name} /></h2></div>}
                {!g.name && <span id={g.id} />}
                {g.sections.map(s => <SectionView key={s.id} s={s} remaining={integrityOf(integ, s.name)} />)}
              </section>
            ))}

            {origin.length > 0 && (
              <section aria-label="Origin">
                <div id="lore-origin" className={styles.after}><h2>Origin</h2></div>
                {origin.map(o => (
                  <div key={o.kind} className={styles.originRow}>
                    <div className={styles.originHead}>
                      <span className={styles.originKind}>{o.kind}</span>
                      <span className={styles.originName}>{o.name}</span>
                    </div>
                    <Prose text={o.desc} className={styles.record} />
                  </div>
                ))}
              </section>
            )}

            {hasNature && (
              <section aria-label="Nature">
                <div id="lore-nature" className={styles.after}><h2>Nature</h2></div>
                <div className={styles.natureGrid}>
                  {NATURE.map(({ key, label }) => (
                    <div className={styles.natCard} key={key}>
                      <div className={styles.ncFrame} />
                      <div className={styles.ncInner}>
                        <div className={styles.ncKey}><i className="fa-solid fa-circle-dot" /> {label}</div>
                        <div className={styles.ncVal}>{lore.personality?.[key] ? <Inline text={lore.personality[key]!} /> : '—'}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section aria-label="Chronicle">
              <div id="lore-chronicle" className={styles.after}><h2>Chronicle</h2></div>
              {latest ? (
                <Link to="/journal" state={{ tab: 'sessions' }} className={styles.onward}>
                  {sessions.length} {sessions.length === 1 ? 'session' : 'sessions'} lived
                  <span className={styles.sep}> · </span>latest: <b>{latest.title}</b>
                  <span className={styles.go}> ▸</span>
                </Link>
              ) : <p className={styles.stateSub}>// Nothing lived yet</p>}
            </section>

            <section aria-label="What you've learned">
              <div id="lore-learned" className={styles.after}><h2>What you&rsquo;ve learned</h2></div>
              <div className={styles.subhead}>Handouts · {handouts.length}</div>
              {handouts.length === 0 ? <p className={styles.stateSub}>// Nothing handed to you yet</p> : (
                <div className={styles.learnGrid}>
                  {recent.map(h => (
                    <Link key={h.id} to="/journal" state={{ handout: h.id }} className={styles.handout}>{h.title || 'Untitled'}</Link>
                  ))}
                  <Link to="/journal" state={{ tab: 'handouts' }} className={styles.onward}>
                    All handouts<span className={styles.go}> ▸</span>
                  </Link>
                </div>
              )}
              <div className={styles.subhead}>Ties revealed to you · {ties.length}</div>
              {ties.length === 0 ? <p className={styles.stateSub}>// None yet</p> : (
                <ul className={styles.ties}>
                  {ties.map(l => (
                    <li key={l.id}><b>{byId.get(l.a)}</b> &amp; <b>{byId.get(l.b)}</b> <span>— {l.label.trim() || l.kind}</span></li>
                  ))}
                </ul>
              )}
              <div className={styles.subhead}>Places · {places.length}</div>
              {places.length === 0 ? <p className={styles.stateSub}>// No places yet</p> : (
                <div className={styles.places}>
                  {places.map(p => {
                    const label = <>
                      <span className={styles.placeName}>{p.name}</span>
                      {p.id === (home && placeId(home)) && <span className={styles.placeHome}>Home</span>}
                      <span className={styles.placeLine}>{p.quests.length ? `${p.quests.length} ${p.quests.length === 1 ? 'quest' : 'quests'}` : 'no quests yet'}</span>
                    </>
                    // A place opens as its thread on the Region card — the map owns it.
                    return region && p.quests.length
                      ? <Link key={p.id} to={`/story/${region.id}/${p.id}`} className={styles.place}>{label}<span className={styles.go}> ▸</span></Link>
                      : <div key={p.id} className={styles.place}>{label}</div>
                  })}
                </div>
              )}
            </section>

            <section aria-label="People">
              <div id="lore-people" className={styles.after}><h2>The people you know</h2></div>
              {/* The same web, either in its place on the page or lifted over the whole
                  app. Full screen goes through a portal: .lore is a fixed stacking
                  context, so nothing inside it can rise above the bars. */}
              {full
                ? <>
                    <div className={styles.webBox} />
                    {createPortal(<div className={styles.webFull} role="dialog" aria-label="The people you know">{webView}</div>, document.body)}
                  </>
                : <div className={styles.webBox}>{webView}</div>}
            </section>
          </article>
        </div>
      </main>
    </>
  )
}

function groupIntegrity(sections: LoreSection[], integ: Record<string, number> | undefined): number {
  let total = 0, kept = 0
  for (const s of sections) { total += s.body.length; kept += s.body.length * integrityOf(integ, s.name) / 100 }
  return total ? Math.round((kept / total) * 100) : 100
}

function SectionView({ s, remaining }: { s: LoreSection; remaining: number }) {
  const taking = remaining < 100
  return (
    <div id={s.id} className={styles.section}>
      {s.name && <h3 className={`${styles.secName} ${taking ? styles.taking : ''}`}><Inline text={s.name} /></h3>}
      {taking && <div className={styles.takingNote}>◇ G.U.I.D.E. · digitising · {remaining}% of this memory remains in ink</div>}
      {taking ? <Creep text={s.body} remaining={remaining} />
        : s.cards ? <Cards cards={s.cards} section={s.name} />
        : <Prose text={s.body} className={styles.record} />}
    </div>
  )
}

/** A like is green, a dislike or a vice red, everything else gold. Two labelled
 *  groups (Likes / Dislikes) sit side by side so they read as a pair. */
function Cards({ cards, section }: { cards: LoreCard[]; section: string }) {
  const tone = (c: LoreCard) => /dislike/i.test(c.label ?? '') || /vice|flaw/i.test(section) ? styles.toneBad
    : /like/i.test(c.label ?? '') ? styles.toneGood : ''
  const labels = [...new Set(cards.map(c => c.label ?? ''))]
  const card = (c: LoreCard, i: number) => (
    <div key={i} className={`${styles.card} ${tone(c)}`}>
      <div className={styles.cardName}><Inline text={c.name} />{c.note && <span className={styles.cardNote}> (<Inline text={c.note} />)</span>}</div>
      <div className={styles.cardText}><Inline text={c.text} /></div>
    </div>
  )
  if (labels.length > 1) {
    return (
      <div className={styles.cards}>
        {labels.map(l => (
          <div key={l} className={`${styles.cardCol} ${tone({ name: '', text: '', label: l })}`}>
            {l && <div className={styles.cardLabel} style={{ color: 'var(--tone)' }}>{l}</div>}
            {cards.filter(c => (c.label ?? '') === l).map(card)}
          </div>
        ))}
      </div>
    )
  }
  return <div className={styles.cards}>{cards.map(card)}</div>
}

function BioPortrait({ character }: { character: CharacterRow }) {
  const id = character.identity ?? {}
  const [imgFailed, setImgFailed] = useState(false)
  useEffect(() => { setImgFailed(false) }, [id.portrait])
  const showImage = !!id.portrait && !imgFailed

  return (
    <div className={styles.bioPortrait} tabIndex={0} aria-label={`Bio-portrait of ${character.name}`}>
      <div className={styles.bpLine} />
      <div className={styles.bpInner}>
        <span className={`${styles.bpCorner} ${styles.tl}`} />
        <span className={`${styles.bpCorner} ${styles.tr}`} />
        <span className={`${styles.bpCorner} ${styles.bl}`} />
        <span className={`${styles.bpCorner} ${styles.br}`} />
        <span className={styles.bpGrid} />
        <div className={styles.bpArt}>
          {showImage ? (
            <ManagedImage
              className={styles.bpImg}
              src={id.portrait ?? undefined}
              alt={character.name}
              style={{ objectPosition: id.portraitFocus ?? 'center top' }}
              onError={() => setImgFailed(true)}
            />
          ) : (
            <Icon name={id.icon ?? 'fa-user'} className={styles.bpFigure} />
          )}
        </div>
        <span className={styles.bpTag}>
          <span className={styles.lockDot} />
          <span>Bio-Scan: Locked</span>
        </span>
      </div>
    </div>
  )
}
