import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useDmStatus, useDmParty, useDmCampaign, type DmCampaignState } from '../lib/dm'
import { longRestPatch } from '../lib/rest'
import type {
  CharacterRow, CharacterUpdate, CharacterSecret, CharacterSecretUpdate, HP,
  QuestRow, QuestStatus, QuestType, QuestObjective, SessionRow,
} from '../lib/database.types'
import styles from './OperatorConsole.module.css'

/** Exhaustion effect text per level (SRD), indexed 0–6. Mirrors the player
 *  Stat Panel / the Operator Console mockup. */
const EXH_EFFECTS = [
  'No effect',
  'Disadvantage on ability checks',
  'Speed halved',
  'Disadvantage on attacks & saves',
  'Hit point max halved',
  'Speed reduced to 0',
  'Death',
]

const cx = (...xs: (string | false | undefined)[]) => xs.filter(Boolean).join(' ')

/** A character row flattened into the fields the roster + overview render — the
 *  mockup's `PARTY` shape, mapped onto the real `characters` row. */
interface PartyMember {
  id: string
  name: string
  race: string
  cls: string
  level: number | string
  icon: string
  hp: number
  hpMax: number
  tempHp: number
  online: boolean
  digitization: number
  effects: { name: string; kind: 'buff' | 'cond' | 'debuff' }[]
}

function toMember(c: CharacterRow, secret?: CharacterSecret): PartyMember {
  const hp = (c.sheet?.hp?.current ?? 0) as number
  const hpMax = (c.sheet?.hp?.max ?? 0) as number
  const tempHp = (c.sheet?.hp?.temp ?? 0) as number
  const raw = (c.resources?.activeEffects as { name?: string }[] | undefined) ?? []
  return {
    id: c.id,
    name: c.name,
    race: c.identity?.race ?? '—',
    cls: c.identity?.class ?? '—',
    level: c.identity?.level ?? '—',
    icon: c.identity?.icon ?? 'fa-user',
    hp,
    hpMax,
    tempHp,
    // Presence is a realtime concern (a later slice) — unknown for now.
    online: false,
    // DM-only horror gauge from the `character_secrets` table (RLS = DM-only).
    // Absent until the DM first authors it, so default to 0.
    digitization: secret?.digitization ?? 0,
    effects: raw.map(e => ({ name: e.name ?? 'Effect', kind: 'buff' as const })),
  }
}

const hpClassOf = (p: PartyMember): '' | 'warn' | 'crit' => {
  if (!p.hpMax) return ''
  const r = p.hp / p.hpMax
  return r <= 0.25 ? 'crit' : r <= 0.55 ? 'warn' : ''
}
const pctOf = (p: PartyMember) => (p.hpMax ? Math.max(0, Math.round((p.hp / p.hpMax) * 100)) : 0)

type View = 'overview' | 'character' | 'quests' | 'sessions'
type CharTab = 'actions' | 'lore'

export function OperatorConsole() {
  const { session, loading: authLoading } = useAuth()
  const { isDm, loading: dmLoading } = useDmStatus()
  const { party, secrets, loading: partyLoading, error, updateCharacter, updateSecret } = useDmParty()
  const campaign = useDmCampaign()

  const [view, setView] = useState<View>('overview')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  /** Which per-character tab is showing when a PC is selected. */
  const [charTab, setCharTab] = useState<CharTab>('actions')

  if (authLoading || dmLoading) return <Boot>Authorizing operator link…</Boot>
  if (!session) return <Navigate to="/login" replace />
  if (!isDm) return <Navigate to="/" replace />

  const members = party.map(m => toMember(m, secrets[m.id]))
  const selected = members.find(m => m.id === selectedId) ?? null
  const selectedRow = party.find(c => c.id === selectedId) ?? null

  function openOverview() {
    setView('overview')
    setSelectedId(null)
  }
  function openQuests() {
    setView('quests')
    setSelectedId(null)
  }
  function openSessions() {
    setView('sessions')
    setSelectedId(null)
  }
  function openCharacter(id: string) {
    setView('character')
    setSelectedId(id)
    setCharTab('actions')
  }

  return (
    <div className={styles.root}>
      <div className="stage" />
      <div className="scanlines" />
      <div className="vignette" />

      {/* ===== OPERATOR HEADER ===== */}
      <header className={styles.opbar}>
        <div className={styles.opSigil}><i className="fa-solid fa-terminal" /></div>
        <div className={styles.opId}>
          <div className={styles.opTitle}>G.U.I.D.E.<span className={styles.slash}>//</span>Operator Console</div>
          <div className={styles.opSub}>
            <span className={styles.acc}>Root :: Architect View</span>
            <span className={styles.sep}>//</span><span>DM Mode</span>
            <span className={styles.sep}>//</span><span>Brettany Theater</span>
          </div>
        </div>
        <div className={styles.opRight}>
          <div className={styles.opStat}><span className={styles.v}>{members.length}</span><span className={styles.l}>Linked PCs</span></div>
          <div className={styles.opStat}><span className={cx(styles.v, styles.cyan)}>Standby</span><span className={styles.l}>Encounter</span></div>
          <div className={styles.opRootpill}><span className={styles.dot} /> Root Access Granted</div>
        </div>
      </header>

      {/* ===== CONSOLE GRID ===== */}
      <div className={styles.console}>
        {/* LEFT — ROSTER */}
        <section className={styles.region} aria-label="Party roster">
          <div className={styles.rFrame} />
          <div className={styles.rInner}>
            <span className={cx(styles.rCorner, styles.tl)} /><span className={cx(styles.rCorner, styles.br)} />
            <div className={styles.rHead}>
              <span className={styles.rhNum}>01</span>
              <span className={styles.rhTitle}>Party Roster</span>
              <span className={styles.rhMeta}><span className={styles.acc}>{members.length}</span> Tracked</span>
            </div>
            <div className={styles.rScroll}>
              <div className={styles.rosterList}>
                <div className={styles.rosterDiv}>Campaign</div>
                <button className={cx(styles.ovEntry, view === 'overview' && styles.active)} onClick={openOverview}>
                  <span className={styles.ovIc}><i className="fa-solid fa-table-cells-large" /></span>
                  <span className={styles.ovTx}>
                    <span className={styles.ovT}>Party Overview</span>
                    <span className={styles.ovS}>Combat Dashboard · All PCs</span>
                  </span>
                </button>
                <button className={cx(styles.ovEntry, view === 'quests' && styles.active)} onClick={openQuests}>
                  <span className={styles.ovIc}><i className="fa-solid fa-scroll" /></span>
                  <span className={styles.ovTx}>
                    <span className={styles.ovT}>Quest Log</span>
                    <span className={styles.ovS}>{campaign.quests.filter(q => q.status === 'active').length} active · {campaign.quests.length} total</span>
                  </span>
                </button>
                <button className={cx(styles.ovEntry, view === 'sessions' && styles.active)} onClick={openSessions}>
                  <span className={styles.ovIc}><i className="fa-solid fa-book-bookmark" /></span>
                  <span className={styles.ovTx}>
                    <span className={styles.ovT}>Session Log</span>
                    <span className={styles.ovS}>Recaps · {campaign.sessions.length} logged</span>
                  </span>
                </button>
                <CampaignEntry icon="fa-box-archive" title="Catalog" sub="Shared library" />

                <div className={styles.rosterDiv}>Characters</div>
                {members.map(p => {
                  const hc = hpClassOf(p)
                  return (
                    <button
                      key={p.id}
                      className={cx(styles.pcCard, view === 'character' && selectedId === p.id && styles.active)}
                      onClick={() => openCharacter(p.id)}
                    >
                      <div className={styles.pcTop}>
                        <span className={styles.pcPortrait}><i className={`fa-solid ${p.icon}`} /></span>
                        <span className={styles.pcNamewrap}>
                          <div className={styles.pcName}>{p.name}</div>
                          <div className={styles.pcMeta}>{p.race} · {p.cls} · Lv {p.level}</div>
                        </span>
                        <span className={cx(styles.pcConn, p.online ? styles.on : styles.off)}>
                          <span className={styles.led} />{p.online ? 'Link' : 'Off'}
                        </span>
                      </div>
                      <div className={cx(styles.hpbar, hc && styles[hc])}><i style={{ width: `${pctOf(p)}%` }} /></div>
                      <div className={cx(styles.hpRead, hc && styles[hc])}>
                        <span className={styles.n}><b>{p.hp}</b> / {p.hpMax} HP{p.tempHp ? <span className={styles.temp}> +{p.tempHp}</span> : null}</span>
                        <span className={styles.lvl}>Lv {p.level}</span>
                      </div>
                      <div className={styles.fxDots}>
                        {p.effects.length
                          ? p.effects.map((e, i) => <span key={i} className={cx(styles.fxDot, styles[e.kind])}><i /></span>)
                          : <span className={styles.fxNone}>No active effects</span>}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </section>

        {/* MAIN — WORK AREA */}
        <section className={styles.region} aria-label="Work area">
          <div className={styles.rFrame} />
          <div className={styles.rInner}>
            <span className={cx(styles.rCorner, styles.tl)} /><span className={cx(styles.rCorner, styles.br)} />
            <div className={styles.workTabs}>
              {/* "Oversee" is the oversight pane — party dashboard when nothing is
                  selected, the selected PC's action console otherwise. Clicking it
                  zooms back out to the party overview. */}
              <div
                className={cx(styles.wtab, (view === 'overview' || (view === 'character' && charTab === 'actions')) && styles.active)}
                onClick={() => (view === 'character' ? setCharTab('actions') : openOverview())}
                title={view === 'character' ? 'Action console' : 'Party overview'}
              >
                Oversee
              </div>
              <div
                className={cx(styles.wtab, view !== 'character' && styles.disabled, view === 'character' && charTab === 'lore' && styles.active)}
                onClick={() => view === 'character' && setCharTab('lore')}
                title={view === 'character' ? 'Lore & corruption (DM-only)' : 'Select a character first'}
              >
                Lore Editor
              </div>
              <div className={cx(styles.wtab, styles.lvl, styles.disabled)} title="Level-up — later slice">
                <i className="fa-solid fa-arrow-up-right-dots" /> Level Up
              </div>
            </div>
            <div className={styles.workBody}>
              {error ? (
                <div className={styles.soonPanel}><i className="fa-solid fa-triangle-exclamation" /><span className={styles.big}>Link Error</span><span>{error}</span></div>
              ) : partyLoading ? (
                <div className={styles.soonPanel}><i className="fa-solid fa-spinner" /><span>Loading party…</span></div>
              ) : view === 'quests' ? (
                <QuestsSurface campaign={campaign} />
              ) : view === 'sessions' ? (
                <SessionsSurface campaign={campaign} />
              ) : view === 'character' && selected && selectedRow ? (
                charTab === 'lore' ? (
                  <LoreTab key={selectedRow.id} row={selectedRow} member={selected} secret={secrets[selectedRow.id]} onUpdateSecret={patch => updateSecret(selectedRow.id, patch)} onUpdateChar={patch => updateCharacter(selectedRow.id, patch)} />
                ) : (
                  <ActionsTab row={selectedRow} member={selected} onUpdate={patch => updateCharacter(selectedRow.id, patch)} />
                )
              ) : (
                <OverviewDashboard members={members} selectedId={selectedId} onSelect={openCharacter} />
              )}
            </div>
          </div>
        </section>

        {/* RIGHT — BROADCAST (scaffolding; wired in the realtime slice) */}
        <section className={styles.region} aria-label="Broadcast and system log">
          <div className={styles.rFrame} />
          <div className={styles.rInner}>
            <span className={cx(styles.rCorner, styles.tl)} /><span className={cx(styles.rCorner, styles.br)} />
            <div className={styles.rHead}>
              <span className={styles.rhNum}>03</span>
              <span className={styles.rhTitle}>Broadcast</span>
              <span className={styles.rhMeta}>G.U.I.D.E. Voice</span>
            </div>
            <div className={styles.rScroll}>
              <div className={styles.bcPad}>
                <span className={styles.fieldLab}>System message</span>
                <textarea className={styles.bcArea} placeholder="Compose a G.U.I.D.E. system notice…" disabled />
                <span className={styles.fieldLab}>Broadcast + activity log arrive with the realtime slice.</span>
                <div className={styles.bcDivider}>Activity Log</div>
              </div>
              <div className={styles.logEmpty}>No operator actions yet.</div>
            </div>
          </div>
        </section>
      </div>

      {/* ===== OPERATOR FOOTER ===== */}
      <footer className={styles.opfoot}>
        <div className={styles.ft}>
          <span className={styles.dot} /><span className={styles.lab}>Operator Link:</span><span className={styles.val}>Root</span>
          <span className={styles.sep}>|</span><span className={styles.lab}>Player Visibility:</span><span className={styles.val}>Concealed</span>
        </div>
        <div className={cx(styles.ft, styles.ftRight)}>
          <span className={styles.lab}>Console</span><span className={styles.val}>v2.4.7-dm</span>
        </div>
      </footer>
    </div>
  )
}

function CampaignEntry({ icon, title, sub }: { icon: string; title: string; sub: string }) {
  return (
    <button className={cx(styles.ovEntry, styles.disabled)} disabled title="Built in a later slice">
      <span className={styles.ovIc}><i className={`fa-solid ${icon}`} /></span>
      <span className={styles.ovTx}>
        <span className={styles.ovT}>{title}</span>
        <span className={styles.ovS}>{sub}</span>
      </span>
    </button>
  )
}

function OverviewDashboard({
  members, selectedId, onSelect,
}: { members: PartyMember[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <>
      <div className={styles.ovBanner}>
        <span className={styles.big}>Party Overview</span>
        <span>Combat dashboard · live vitals</span>
        <span className={styles.dmonly}><i className="fa-solid fa-eye-slash" /> Digitization — DM only</span>
      </div>
      {members.map(p => {
        const hc = hpClassOf(p)
        const pct = pctOf(p)
        const hpColor = hc === 'crit' ? 'var(--danger-hot)' : hc === 'warn' ? 'var(--amber)' : 'var(--good)'
        const high = p.digitization >= 50
        return (
          <button key={p.id} className={cx(styles.dashRow, selectedId === p.id && styles.active)} onClick={() => onSelect(p.id)}>
            <div className={styles.drMain}>
              <div className={styles.drName}>
                <span className={styles.nm}>{p.name}</span>
                <span className={styles.cl}><span className={cx(styles.led, p.online ? styles.on : styles.off)} />{p.race} · {p.cls} · Lv {p.level}</span>
              </div>
              <div className={styles.drHp}>
                <div className={styles.lab}>
                  <span><b style={{ color: hpColor }}>{p.hp}</b>/{p.hpMax}{p.tempHp ? ` +${p.tempHp}` : ''}</span>
                  <span>{pct}%</span>
                </div>
                <div className={cx(styles.hpbar, hc && styles[hc])}><i style={{ width: `${pct}%` }} /></div>
              </div>
              <div className={styles.drFx}>
                {p.effects.length
                  ? p.effects.map((e, i) => <span key={i} className={cx(styles.chip, styles[e.kind])}>{e.name}</span>)
                  : <span className={styles.none}>— clear —</span>}
              </div>
            </div>
            <div className={styles.drInt}>
              <div className={styles.lab}><span className={styles.t}>Digitization</span><span className={cx(styles.v, high && styles.high)}>{p.digitization}%</span></div>
              <div className={styles.intbar}><i style={{ width: `${p.digitization}%` }} /></div>
            </div>
          </button>
        )
      })}
    </>
  )
}

/** The selected-character Actions console (slice 2). Five cards in the mockup;
 *  three are wired here (Vitals, Currency, Status). Grant Item + Apply Effect
 *  wait on the catalog / effect-catalog slices and render as inert placeholders
 *  so the grid layout matches the design.
 *
 *  EVERY write spreads its JSONB section off the RAW row so sibling fields are
 *  never clobbered, and targets the same fields the player screens read — HP and
 *  coins on `sheet`, death saves + exhaustion on `resources` (see Stats.tsx) —
 *  keeping one source of truth per value. */
function ActionsTab({ row, member, onUpdate }: {
  row: CharacterRow
  member: PartyMember
  onUpdate: (patch: CharacterUpdate) => Promise<void>
}) {
  const [hpAmt, setHpAmt] = useState(5)
  const [goldAmt, setGoldAmt] = useState(50)

  const sheet = row.sheet ?? {}
  const hp = (sheet.hp ?? { current: 0, max: 0 }) as HP
  const hpCur = hp.current ?? 0
  const hpMax = hp.max ?? 0
  const tempHp = hp.temp ?? 0
  const hc = hpClassOf(member)
  const pct = pctOf(member)

  const coins = sheet.coins ?? { gold: 0 }
  const gold = coins.gold ?? 0
  const silver = coins.silver ?? 0
  const copper = coins.copper ?? 0

  const resources = row.resources ?? {}
  const ds = (resources.deathSaves as { successes?: number; failures?: number } | undefined) ?? { successes: 0, failures: 0 }
  const dsSucc = ds.successes ?? 0
  const dsFail = ds.failures ?? 0
  const exh = (resources.exhaustion as number | undefined) ?? 0

  // ---- writes (each pre-spreads its section) ----
  const writeHp = (next: number, nextTemp = tempHp) =>
    onUpdate({ sheet: { ...sheet, hp: { ...hp, current: next, max: hpMax, temp: nextTemp } } })
  const heal = () => writeHp(Math.min(hpMax, hpCur + hpAmt))
  const damage = () => writeHp(Math.max(0, hpCur - hpAmt))
  const setHp = () => writeHp(Math.max(0, Math.min(hpMax, hpAmt)))
  const addTemp = () => writeHp(hpCur, tempHp + hpAmt)
  const longRest = () => onUpdate(longRestPatch(row).patch)

  const award = () => onUpdate({ sheet: { ...sheet, coins: { ...coins, gold: gold + goldAmt } } })
  const deduct = () => onUpdate({ sheet: { ...sheet, coins: { ...coins, gold: Math.max(0, gold - goldAmt) } } })

  const writeDeath = (next: { successes: number; failures: number }) =>
    onUpdate({ resources: { ...resources, deathSaves: next } })
  const setExh = (next: number) =>
    onUpdate({ resources: { ...resources, exhaustion: Math.max(0, Math.min(6, next)) } })

  const death = deathState(dsSucc, dsFail)

  return (
    <>
      {/* selected-character header */}
      <div className={styles.selHead}>
        <span className={styles.selPortrait}><i className={`fa-solid ${member.icon}`} /></span>
        <div className={styles.selTitles}>
          <div className={styles.selName}>{member.name}</div>
          <div className={styles.selMeta}>
            {member.race} {member.cls}
            <span className={styles.sep}>·</span> Level {member.level}
            <span className={styles.sep}>·</span>
            <span className={cx(styles.conn, member.online && styles.on)}>{member.online ? 'Linked' : 'Offline'}</span>
          </div>
        </div>
        <div className={styles.selInt}>
          <div className={styles.t}>G.U.I.D.E. Integrity · DM Only</div>
          <div className={cx(styles.v, member.digitization >= 50 && styles.high)}>{member.digitization}%</div>
          <div className={styles.intbar}><i style={{ width: `${member.digitization}%` }} /></div>
        </div>
      </div>

      <div className={styles.actGrid}>
        {/* A — VITALS */}
        <div className={styles.actCard}>
          <span className={cx(styles.acCorner, styles.tl)} /><span className={cx(styles.acCorner, styles.br)} />
          <div className={styles.acTitle}><i className="fa-solid fa-heart-pulse lead" /><span className={styles.num}>A</span><span className={styles.t}>Vitals</span></div>
          <div className={cx(styles.vitRead, hc && styles[hc])}>
            <span className={styles.hpnum}>{hpCur}</span><span className={styles.hpmax}>/ {hpMax} HP</span>
            <span className={styles.temp}><div className={styles.v}>{tempHp}</div><div className={styles.l}>Temp HP</div></span>
          </div>
          <div className={cx(styles.vitBar, hc && styles[hc])}><i style={{ width: `${pct}%` }} /></div>
          <div className={styles.stepper}>
            <input className={styles.numIn} type="number" min={1} value={hpAmt}
              onChange={e => setHpAmt(Math.max(0, parseInt(e.target.value || '0', 10) || 0))} />
          </div>
          <div className={styles.btnRow} style={{ marginBottom: 7 }}>
            <Btn tone="good" sm icon="fa-plus" label="Heal" onClick={heal} />
            <Btn tone="danger" sm icon="fa-bolt" label="Damage" onClick={damage} />
          </div>
          <div className={styles.btnRow}>
            <Btn tone="ghost" sm icon="fa-pen" label="Set HP" onClick={setHp} />
            <Btn tone="cyan" sm icon="fa-shield" label="+Temp" onClick={addTemp} />
          </div>
          <div className={styles.restRow}>
            <Btn tone="amber" sm icon="fa-campground" label="Long Rest" onClick={longRest} />
          </div>
        </div>

        {/* B — GRANT ITEM (deferred to the catalog slice) */}
        <div className={cx(styles.actCard, styles.soon)}>
          <span className={cx(styles.acCorner, styles.tl)} /><span className={cx(styles.acCorner, styles.br)} />
          <div className={styles.acTitle}><i className="fa-solid fa-box-open lead" /><span className={styles.num}>B</span><span className={styles.t}>Grant Item</span></div>
          <div className={styles.acSoon}><i className="fa-solid fa-box-archive" /><span>Arrives with the item catalog slice</span></div>
        </div>

        {/* C — APPLY EFFECT (deferred to the effect-catalog slice) */}
        <div className={cx(styles.actCard, styles.soon)}>
          <span className={cx(styles.acCorner, styles.tl)} /><span className={cx(styles.acCorner, styles.br)} />
          <div className={styles.acTitle}><i className="fa-solid fa-wand-sparkles lead" /><span className={styles.num}>C</span><span className={styles.t}>Apply Effect</span></div>
          <div className={styles.acSoon}><i className="fa-solid fa-wand-sparkles" /><span>Arrives with the effect catalog slice</span></div>
        </div>

        {/* D — CURRENCY */}
        <div className={styles.actCard}>
          <span className={cx(styles.acCorner, styles.tl)} /><span className={cx(styles.acCorner, styles.br)} />
          <div className={styles.acTitle}><i className="fa-solid fa-coins lead" /><span className={styles.num}>D</span><span className={styles.t}>Currency</span></div>
          <div className={styles.coinDisplay}><span className={styles.gp}>{gold.toLocaleString()}</span><span className={styles.gl}>Gold Pieces</span></div>
          <div className={styles.coinBreak}>
            <div className={cx(styles.coinCell, styles.gp)}><div className={styles.cn}>{gold.toLocaleString()}</div><div className={styles.ct}>GP</div></div>
            <div className={cx(styles.coinCell, styles.sp)}><div className={styles.cn}>{silver.toLocaleString()}</div><div className={styles.ct}>SP</div></div>
            <div className={cx(styles.coinCell, styles.cp)}><div className={styles.cn}>{copper.toLocaleString()}</div><div className={styles.ct}>CP</div></div>
          </div>
          <div className={styles.stepper}>
            <input className={styles.numIn} type="number" min={1} value={goldAmt}
              onChange={e => setGoldAmt(Math.max(0, parseInt(e.target.value || '0', 10) || 0))} />
          </div>
          <div className={styles.btnRow}>
            <Btn tone="amber" sm icon="fa-plus" label="Award" onClick={award} />
            <Btn tone="danger" sm icon="fa-minus" label="Deduct" onClick={deduct} />
          </div>
        </div>

        {/* E — STATUS: death saves + exhaustion (wide) */}
        <div className={cx(styles.actCard, styles.wide)}>
          <span className={cx(styles.acCorner, styles.tl)} /><span className={cx(styles.acCorner, styles.br)} />
          <div className={styles.acTitle}><i className="fa-solid fa-heart-crack lead" /><span className={styles.num}>E</span><span className={styles.t}>Status</span></div>
          <div className={styles.statusSplit}>
            {/* death saves */}
            <div className={styles.stCol}>
              <div className={styles.stSub}>
                <span className={styles.stH}>Death Saves</span>
                <span className={cx(styles.dsState, styles[death.c])}>{death.t}</span>
                <button className={styles.dsClear} onClick={() => void writeDeath({ successes: 0, failures: 0 })}>Clear</button>
              </div>
              <DeathRow kind="succ" label="Successes" count={dsSucc}
                onSet={n => void writeDeath({ successes: n, failures: dsFail })} />
              <DeathRow kind="fail" label="Failures" count={dsFail}
                onSet={n => void writeDeath({ successes: dsSucc, failures: n })} />
            </div>
            {/* exhaustion */}
            <div className={styles.stCol}>
              <div className={styles.stSub}><span className={styles.stH}>Exhaustion</span><span className={styles.stMeta}>0–6 · death @ 6</span></div>
              <div className={styles.exhRow}>
                <button className={styles.exhBtn} aria-label="Decrease exhaustion" onClick={() => void setExh(exh - 1)}><i className="fa-solid fa-minus" /></button>
                <div className={styles.exhTrack}>
                  {[1, 2, 3, 4, 5, 6].map(l => (
                    <button key={l} className={cx(styles.exhCell, l <= exh && styles.on, l === exh && styles.cur)} data-lvl={l}
                      onClick={() => void setExh(exh === l ? l - 1 : l)}>
                      <span className={styles.exFrame} /><span className={styles.exInner}>{l}</span>
                    </button>
                  ))}
                </div>
                <button className={styles.exhBtn} aria-label="Increase exhaustion" onClick={() => void setExh(exh + 1)}><i className="fa-solid fa-plus" /></button>
              </div>
              <div className={styles.exhReadout}>
                <span>Current: <span className={styles.level}>Level {exh}</span></span>
                <span className={cx(styles.effect, exh >= 5 && styles.danger)}>{EXH_EFFECTS[exh]}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <p className={styles.deferNote}>
        Grant Item, Apply Effect &amp; the activity log arrive in later slices.
      </p>
    </>
  )
}

/** Memory-fidelity levels (eerie player-facing horror descriptor), ordered from
 *  intact to fully corrupted — mirrors the design's MEM_LEVELS. */
const MEM_LEVELS = ['INTACT', 'PARTIAL', 'DEGRADED', 'FRAGMENTED', 'CORRUPTED'] as const

/** Preset roster glyphs the DM can assign as a character's menu portrait. */
const GLYPHS = ['fa-user', 'fa-chess-rook', 'fa-hat-wizard', 'fa-shield-halved', 'fa-mask', 'fa-skull', 'fa-dragon', 'fa-khanda', 'fa-cross', 'fa-feather', 'fa-hand-fist', 'fa-eye']

/** The DM-only Lore tab. Two layers in ONE save:
 *   - `character_secrets` (DM-only, RLS, migration 0002): digitization + true lore —
 *     a player can NEVER read these.
 *   - `characters` row (player-readable): memory-fidelity descriptor + menu glyph.
 *  Drafts are local with a single explicit "Save Lore" (matches the design) so the
 *  slider can't spam writes; mount with key={characterId} so drafts reset on switch.
 *  The full player-facing lore form (backstory / personality / relations / identity)
 *  is a separate slice that lands with the player Lore screen. */
function LoreTab({ row, member, secret, onUpdateSecret, onUpdateChar }: {
  row: CharacterRow
  member: PartyMember
  secret?: CharacterSecret
  onUpdateSecret: (patch: CharacterSecretUpdate) => Promise<void>
  onUpdateChar: (patch: CharacterUpdate) => Promise<void>
}) {
  const savedDig = secret?.digitization ?? 0
  const savedLore = secret?.true_lore ?? ''
  const savedMem = (row.lore?.memoryFidelity as string | undefined) ?? 'INTACT'
  const savedIcon = row.identity?.icon ?? 'fa-user'

  const [dig, setDig] = useState(savedDig)
  const [lore, setLore] = useState(savedLore)
  const [mem, setMem] = useState(savedMem)
  const [icon, setIcon] = useState(savedIcon)
  const [busy, setBusy] = useState(false)

  const secretDirty = dig !== savedDig || lore !== savedLore
  const charDirty = mem !== savedMem || icon !== savedIcon
  const dirty = secretDirty || charDirty
  const digClass: '' | 'high' | 'crit' = dig >= 80 ? 'crit' : dig >= 50 ? 'high' : ''

  async function save() {
    setBusy(true)
    const jobs: Promise<void>[] = []
    if (secretDirty) jobs.push(onUpdateSecret({ digitization: dig, true_lore: lore }))
    if (charDirty) {
      const patch: CharacterUpdate = {}
      if (mem !== savedMem) patch.lore = { ...(row.lore ?? {}), memoryFidelity: mem }
      if (icon !== savedIcon) patch.identity = { ...(row.identity ?? {}), icon }
      jobs.push(onUpdateChar(patch))
    }
    await Promise.all(jobs)
    setBusy(false)
  }

  return (
    <>
      <div className={styles.selHead}>
        <span className={styles.selPortrait}><i className={`fa-solid ${icon}`} /></span>
        <div className={styles.selTitles}>
          <div className={styles.selName}>{member.name}</div>
          <div className={styles.selMeta}>
            {member.race} {member.cls}
            <span className={styles.sep}>·</span> Level {member.level}
            <span className={styles.sep}>·</span>
            <span className={styles.dmTag}><i className="fa-solid fa-lock" /> DM-Only Intel</span>
          </div>
        </div>
        <div className={styles.selInt}>
          <div className={styles.t}>G.U.I.D.E. Integrity · DM Only</div>
          <div className={cx(styles.v, savedDig >= 50 && styles.high)}>{savedDig}%</div>
          <div className={styles.intbar}><i style={{ width: `${savedDig}%` }} /></div>
        </div>
      </div>

      {/* digitization + memory fidelity side by side */}
      <div className={styles.loreGrid}>
        <div className={styles.actCard}>
          <span className={cx(styles.acCorner, styles.tl)} /><span className={cx(styles.acCorner, styles.br)} />
          <div className={styles.acTitle}><i className="fa-solid fa-radiation lead" /><span className={styles.t}>Digitization</span></div>
          <div className={cx(styles.digRead, digClass && styles[digClass])}>
            <span className={styles.digNum}>{dig}</span><span className={styles.digPct}>%</span>
          </div>
          <input
            className={cx(styles.digSlider, digClass && styles[digClass])}
            type="range" min={0} max={100} value={dig}
            aria-label="Digitization level"
            onChange={e => setDig(Number(e.target.value))}
          />
          <div className={styles.digSteps}>
            <Btn tone="ghost" sm icon="fa-minus" label="5" onClick={() => setDig(d => Math.max(0, d - 5))} disabled={dig <= 0} />
            <Btn tone="ghost" sm icon="fa-plus" label="5" onClick={() => setDig(d => Math.min(100, d + 5))} disabled={dig >= 100} />
          </div>
          <p className={styles.acHint}>Hidden corruption metric · DM only</p>
        </div>

        <div className={styles.actCard}>
          <span className={cx(styles.acCorner, styles.tl)} /><span className={cx(styles.acCorner, styles.br)} />
          <div className={styles.acTitle}><i className="fa-solid fa-wave-square lead" /><span className={styles.t}>Memory Fidelity</span></div>
          <select className={styles.memSelect} value={mem} onChange={e => setMem(e.target.value)} aria-label="Memory fidelity">
            {MEM_LEVELS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <div className={styles.memBars} aria-hidden="true">
            {MEM_LEVELS.map((m, i) => (
              <span key={m} className={cx(styles.memBar, i <= MEM_LEVELS.indexOf(mem as typeof MEM_LEVELS[number]) && styles.on, i >= 3 && styles.warn)} />
            ))}
          </div>
          <p className={styles.acHint}>System descriptor · shown on the player Lore screen</p>
        </div>
      </div>

      {/* menu glyph picker */}
      <div className={styles.glyphRow}>
        <span className={styles.glyphLab}>Menu Glyph</span>
        <div className={styles.glyphBtns}>
          {GLYPHS.map(g => (
            <button key={g} className={cx(styles.glyphBtn, g === icon && styles.on)} onClick={() => setIcon(g)} title={g} aria-label={g} aria-pressed={g === icon}>
              <i className={`fa-solid ${g}`} />
            </button>
          ))}
        </div>
      </div>

      {/* true lore — the dramatic-irony layer (design: q-gm-head + q-gmnotes) */}
      <div className={styles.gmHead}>
        <i className="fa-solid fa-user-secret" />
        <span className={styles.t}>True Lore</span>
        <span className={styles.s}><i className="fa-solid fa-eye-slash" /> Hidden from players</span>
      </div>
      <textarea
        className={styles.gmNotes}
        value={lore}
        placeholder={`What is actually true behind what ${member.name.split(' ')[0]} believes — DM eyes only…`}
        onChange={e => setLore(e.target.value)}
      />

      <div className={styles.qActions}>
        <Btn tone="amber" lg icon="fa-floppy-disk" label={busy ? 'Saving…' : dirty ? 'Save Lore' : 'Saved'} onClick={() => void save()} disabled={!dirty || busy} />
      </div>

      <p className={styles.deferNote}>
        Backstory, personality &amp; relations authoring arrives with the player Lore screen.
      </p>
    </>
  )
}

// ============================================================
// QUEST LOG (campaign-level authoring surface) — slice 4
// ============================================================
const Q_STATUS: { key: QuestStatus; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'completed', label: 'Completed' },
  { key: 'failed', label: 'Failed' },
]
const questGlyph = (t: QuestType) => (t === 'main' ? '◈' : '◇')

type QuestFields = Omit<QuestRow, 'id' | 'created_at' | 'updated_at'>

/** Quest Log: grouped index (left) + create/edit form (right) — the authoring
 *  twin of the player Journal's quest log. gmNotes round-trips through the DM-only
 *  `quest_secrets` table; everything else is on the player-facing `quests` row. */
function QuestsSurface({ campaign }: { campaign: DmCampaignState }) {
  const { quests, questSecrets, createQuest, updateQuest, deleteQuest, updateQuestSecret, loading, error } = campaign
  const [selId, setSelId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const activeId = creating ? null : (selId ?? quests[0]?.id ?? null)
  const selected = quests.find(q => q.id === activeId) ?? null

  async function handleSubmit(fields: QuestFields, gmNotes: string) {
    if (selected) {
      await updateQuest(selected.id, fields)
      if (gmNotes !== (questSecrets[selected.id]?.gm_notes ?? '')) await updateQuestSecret(selected.id, { gm_notes: gmNotes })
    } else {
      const created = await createQuest(fields)
      if (created) {
        if (gmNotes) await updateQuestSecret(created.id, { gm_notes: gmNotes })
        setCreating(false)
        setSelId(created.id)
      }
    }
  }

  async function handleDelete() {
    if (!selected) return
    await deleteQuest(selected.id)
    setSelId(null)
  }

  return (
    <>
      <div className={styles.ovBanner}>
        <span className={styles.big}>Quest Log</span>
        <span>Campaign quests · authoring twin of the player Journal</span>
        <span className={styles.sessCount}>{quests.length} quests</span>
      </div>

      {error ? (
        <div className={styles.soonPanel}><i className="fa-solid fa-triangle-exclamation" /><span className={styles.big}>Link Error</span><span>{error}</span></div>
      ) : (
        <div className={styles.questLayout}>
          {/* index */}
          <div className={styles.qIndex}>
            <Btn tone="cyan" sm icon="fa-plus" label="New Quest" onClick={() => { setCreating(true); setSelId(null) }} />
            {Q_STATUS.map(st => {
              const items = quests.filter(q => q.status === st.key)
              return (
                <div key={st.key} className={cx(styles.qGroup, styles[st.key])}>
                  <div className={styles.qGroupHead}><span className={styles.ghT}>{st.label}</span><span className={styles.ghC}>{items.length}</span></div>
                  <div className={styles.qRows}>
                    {items.length ? items.map(q => (
                      <button key={q.id} className={cx(styles.qRow, q.id === activeId && !creating && styles.sel)} onClick={() => { setCreating(false); setSelId(q.id) }}>
                        <span className={styles.qGlyph}>{questGlyph(q.type)}</span>
                        <span className={styles.qRtx}>
                          <span className={styles.qRt}>{q.title || 'Untitled'}</span>
                          <span className={styles.qRl}>{q.location || '—'}</span>
                        </span>
                      </button>
                    )) : <div className={styles.qEmpty}>{loading ? '· loading ·' : '— none —'}</div>}
                  </div>
                </div>
              )
            })}
          </div>

          {/* form */}
          <div className={styles.qForm}>
            <QuestForm
              key={activeId ?? 'new'}
              quest={selected}
              gmNotes={selected ? (questSecrets[selected.id]?.gm_notes ?? '') : ''}
              onSubmit={handleSubmit}
              onDelete={selected ? handleDelete : undefined}
            />
          </div>
        </div>
      )}
    </>
  )
}

function QuestForm({ quest, gmNotes, onSubmit, onDelete }: {
  quest: QuestRow | null
  gmNotes: string
  onSubmit: (fields: QuestFields, gmNotes: string) => Promise<void>
  onDelete?: () => void
}) {
  const [title, setTitle] = useState(quest?.title ?? '')
  const [type, setType] = useState<QuestType>(quest?.type ?? 'side')
  const [status, setStatus] = useState<QuestStatus>(quest?.status ?? 'active')
  const [location, setLocation] = useState(quest?.location ?? '')
  const [givenBy, setGivenBy] = useState(quest?.given_by ?? '')
  const [description, setDescription] = useState(quest?.description ?? '')
  const [objectives, setObjectives] = useState<QuestObjective[]>(quest?.objectives ?? [])
  const [related, setRelated] = useState<string[]>(quest?.related ?? [])
  const [gm, setGm] = useState(gmNotes)
  const [objInput, setObjInput] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [busy, setBusy] = useState(false)

  function addObjective() {
    const t = objInput.trim()
    if (!t) return
    setObjectives(o => [...o, { text: t, done: false }])
    setObjInput('')
  }
  function addTag() {
    const t = tagInput.trim()
    if (!t || related.includes(t)) { setTagInput(''); return }
    setRelated(r => [...r, t])
    setTagInput('')
  }
  async function submit() {
    setBusy(true)
    await onSubmit({ title, type, status, location, given_by: givenBy, description, objectives, related }, gm)
    setBusy(false)
  }

  return (
    <>
      <span className={styles.fieldLab}>Title</span>
      <input className={styles.sessIn} value={title} onChange={e => setTitle(e.target.value)} placeholder="Name the quest…" />

      <div className={styles.qGrid2}>
        <div>
          <span className={styles.fieldLab}>Type</span>
          <div className={styles.qSeg}>
            <button className={cx(styles.qSegOpt, type === 'main' && styles.sel)} onClick={() => setType('main')}><span className={styles.qGly}>◈</span> Main</button>
            <button className={cx(styles.qSegOpt, type === 'side' && styles.sel)} onClick={() => setType('side')}><span className={styles.qGly}>◇</span> Side</button>
          </div>
        </div>
        <div>
          <span className={styles.fieldLab}>Status</span>
          <select className={styles.selIn} value={status} onChange={e => setStatus(e.target.value as QuestStatus)}>
            {Q_STATUS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </div>
      </div>

      <div className={styles.qGrid2}>
        <div><span className={styles.fieldLab}>Location</span><input className={styles.sessIn} value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. Brettany" /></div>
        <div><span className={styles.fieldLab}>Given By</span><input className={styles.sessIn} value={givenBy} onChange={e => setGivenBy(e.target.value)} placeholder="e.g. Wren, Archivist" /></div>
      </div>

      <div className={styles.qLabRow}>
        <span className={styles.fieldLab}>Player Description</span>
        <span className={cx(styles.qFacing, styles.player)}><i className="fa-solid fa-eye" /> Players see this</span>
      </div>
      <textarea className={styles.qPlayerDesc} value={description} onChange={e => setDescription(e.target.value)} placeholder="The prose the players read in their Journal…" />

      <span className={styles.fieldLab}>Objectives</span>
      <div className={styles.qObjList}>
        {objectives.length ? objectives.map((o, i) => (
          <div key={i} className={cx(styles.qObjLine, o.done && styles.done)}>
            <button className={cx(styles.qCheck, o.done && styles.on)} aria-label="Toggle objective"
              onClick={() => setObjectives(list => list.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))} />
            <span className={styles.qOtx}>{o.text}</span>
            <span className={styles.qOx} onClick={() => setObjectives(list => list.filter((_, j) => j !== i))}><i className="fa-solid fa-xmark" /></span>
          </div>
        )) : <div className={styles.fxNone} style={{ padding: '4px 2px' }}>No objectives yet — add the steps the party must complete.</div>}
      </div>
      <div className={styles.qObjAdd}>
        <input className={styles.sessIn} value={objInput} onChange={e => setObjInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && addObjective()} placeholder="Add an objective…" />
        <Btn tone="ghost" sm icon="fa-plus" label="Add" onClick={addObjective} />
      </div>

      <span className={styles.fieldLab}>Related</span>
      <div className={styles.qTags}>
        {related.length ? related.map((t, i) => (
          <span key={i} className={styles.qTag}>{t}<span className={styles.qTx2} onClick={() => setRelated(r => r.filter((_, j) => j !== i))}><i className="fa-solid fa-xmark" /></span></span>
        )) : <span className={styles.qTagNone}>No related tags</span>}
      </div>
      <div className={styles.qTagAdd}>
        <input className={styles.sessIn} value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && addTag()} placeholder="Add a related NPC or place…" />
        <Btn tone="ghost" sm icon="fa-plus" label="Add" onClick={addTag} />
      </div>

      <div className={styles.gmHead}>
        <i className="fa-solid fa-user-secret" />
        <span className={styles.t}>GM Notes</span>
        <span className={styles.s}><i className="fa-solid fa-eye-slash" /> Hidden from players</span>
      </div>
      <textarea className={styles.gmNotes} value={gm} onChange={e => setGm(e.target.value)} placeholder="The true purpose, the secret, the twist — DM eyes only…" />

      <div className={styles.qActions}>
        <Btn tone="amber" lg icon="fa-floppy-disk" label={busy ? 'Saving…' : quest ? 'Save Quest' : 'Create Quest'} onClick={() => void submit()} disabled={busy || !title.trim()} />
        {onDelete && <Btn tone="danger" lg icon="fa-trash" label="Delete" onClick={onDelete} disabled={busy} />}
      </div>
    </>
  )
}

// ============================================================
// SESSION LOG (campaign-level recap authoring) — slice 4
// ============================================================
type SessionFields = Omit<SessionRow, 'id' | 'updated_at'>

/** Session Log: a session picker + recap form. All fields are player-facing (the
 *  campaign recap the players read), so there's no secret table — just `sessions`. */
function SessionsSurface({ campaign }: { campaign: DmCampaignState }) {
  const { sessions, createSession, updateSession, deleteSession, error } = campaign
  const [selId, setSelId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  // Default to the latest session (highest num), matching the mockup.
  const activeId = creating ? null : (selId ?? sessions[sessions.length - 1]?.id ?? null)
  const selected = sessions.find(s => s.id === activeId) ?? null
  const nextNum = sessions.reduce((m, s) => Math.max(m, s.num), 0) + 1

  async function handleSubmit(fields: SessionFields) {
    if (selected) {
      await updateSession(selected.id, fields)
    } else {
      const created = await createSession(fields)
      if (created) { setCreating(false); setSelId(created.id) }
    }
  }
  async function handleDelete() {
    if (!selected) return
    await deleteSession(selected.id)
    setSelId(null)
  }

  return (
    <>
      <div className={styles.ovBanner}>
        <span className={styles.big}>Session Log</span>
        <span>Campaign recap · Brettany Theater</span>
        <span className={styles.sessCount}>{sessions.length} logged</span>
      </div>

      {error ? (
        <div className={styles.soonPanel}><i className="fa-solid fa-triangle-exclamation" /><span className={styles.big}>Link Error</span><span>{error}</span></div>
      ) : (
        <>
          <div className={styles.sessPick}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span className={styles.fieldLab}>Editing session</span>
              <select
                className={styles.selIn} style={{ marginBottom: 0 }}
                value={activeId ?? 'new'}
                onChange={e => { if (e.target.value === 'new') { setCreating(true); setSelId(null) } else { setCreating(false); setSelId(e.target.value) } }}
              >
                {activeId === null && <option value="new">— New session (unsaved) —</option>}
                {sessions.map(s => <option key={s.id} value={s.id}>S{String(s.num).padStart(2, '0')} · {s.title || 'Untitled'} · {s.date || '—'}</option>)}
              </select>
            </div>
            <Btn tone="cyan" icon="fa-plus" label="New Session" onClick={() => { setCreating(true); setSelId(null) }} />
          </div>

          <div className={styles.sessForm}>
            <SessionForm
              key={activeId ?? 'new'}
              session={selected}
              nextNum={nextNum}
              onSubmit={handleSubmit}
              onDelete={selected ? handleDelete : undefined}
            />
          </div>
        </>
      )}
    </>
  )
}

function SessionForm({ session, nextNum, onSubmit, onDelete }: {
  session: SessionRow | null
  nextNum: number
  onSubmit: (fields: SessionFields) => Promise<void>
  onDelete?: () => void
}) {
  const [num, setNum] = useState(session?.num ?? nextNum)
  const [date, setDate] = useState(session?.date ?? '')
  const [title, setTitle] = useState(session?.title ?? '')
  const [recap, setRecap] = useState(session?.recap ?? '')
  const [events, setEvents] = useState<string[]>(session?.events ?? [])
  const [evInput, setEvInput] = useState('')
  const [busy, setBusy] = useState(false)

  function addEvent() {
    const t = evInput.trim()
    if (!t) return
    setEvents(e => [...e, t])
    setEvInput('')
  }
  async function submit() {
    setBusy(true)
    await onSubmit({ num, title, date, recap, events })
    setBusy(false)
  }

  return (
    <>
      <div className={styles.sessGrid2}>
        <div><span className={styles.fieldLab}>Session #</span><input className={styles.numIn} type="number" min={1} value={num} onChange={e => setNum(Number(e.target.value) || 1)} /></div>
        <div><span className={styles.fieldLab}>Date</span><input className={styles.sessIn} value={date} onChange={e => setDate(e.target.value)} placeholder="e.g. 14th of Mistmoon" /></div>
      </div>
      <span className={styles.fieldLab}>Title</span>
      <input className={styles.sessIn} value={title} onChange={e => setTitle(e.target.value)} placeholder="Give the session a title…" />
      <span className={styles.fieldLab}>Recap</span>
      <textarea className={styles.sessRecap} value={recap} onChange={e => setRecap(e.target.value)} placeholder="Write the session recap — what happened, who did what, where it left off…" />

      <span className={styles.fieldLab}>Key Events</span>
      <div className={styles.evList}>
        {events.length ? events.map((ev, i) => (
          <div key={i} className={styles.evLine}>
            <span className={styles.evDot} />
            <span className={styles.evTx}>{ev}</span>
            <span className={styles.evX} onClick={() => setEvents(list => list.filter((_, j) => j !== i))}><i className="fa-solid fa-xmark" /></span>
          </div>
        )) : <div className={styles.fxNone} style={{ padding: '4px 2px' }}>No key events yet — add the beats that mattered.</div>}
      </div>
      <div className={styles.evAdd}>
        <input className={styles.sessIn} value={evInput} onChange={e => setEvInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && addEvent()} placeholder="Add a key event…" />
        <Btn tone="ghost" sm icon="fa-plus" label="Add" onClick={addEvent} />
      </div>

      <div className={styles.qActions}>
        <Btn tone="amber" lg icon="fa-floppy-disk" label={busy ? 'Saving…' : session ? 'Save Session' : 'Create Session'} onClick={() => void submit()} disabled={busy || !title.trim()} />
        {onDelete && <Btn tone="danger" lg icon="fa-trash" label="Delete" onClick={onDelete} disabled={busy} />}
      </div>
    </>
  )
}

type DeathStatusClass = 'stable' | 'dying' | 'stab' | 'dead'

/** Death-save banner state, derived from the success/failure counts — same
 *  thresholds as the player Stat Panel. */
function deathState(succ: number, fail: number): { t: string; c: DeathStatusClass } {
  if (fail >= 3) return { t: 'Dead', c: 'dead' }
  if (succ >= 3) return { t: 'Stabilized', c: 'stab' }
  if (succ > 0 || fail > 0) return { t: 'Dying', c: 'dying' }
  return { t: 'Stable', c: 'stable' }
}

/** One death-save row (3 pips). Clicking pip i sets the count to i+1; clicking an
 *  already-filled pip steps it back to i — identical to the player Stat Panel. */
function DeathRow({ kind, label, count, onSet }: {
  kind: 'succ' | 'fail'; label: string; count: number; onSet: (n: number) => void
}) {
  return (
    <div className={cx(styles.dsRow, styles[kind])}>
      <span className={styles.lab}>{label}</span>
      <div className={styles.dsDots}>
        {[0, 1, 2].map(i => (
          <button key={i} className={cx(styles.dsDot, i < count && styles.on)}
            aria-label={`${label} ${i + 1}`} onClick={() => onSet(i < count ? i : i + 1)} />
        ))}
      </div>
    </div>
  )
}

/** Clip-path action button (amber/cyan/good/danger/ghost), matching the mockup's
 *  two-layer `.btn > .bf + .bi` structure. */
function Btn({ tone, sm, lg, icon, label, onClick, disabled, title }: {
  tone: 'amber' | 'cyan' | 'good' | 'danger' | 'ghost'
  sm?: boolean; lg?: boolean; icon: string; label: string
  onClick?: () => void; disabled?: boolean; title?: string
}) {
  return (
    <button className={cx(styles.btn, styles[tone], sm && styles.sm, lg && styles.lg)} onClick={onClick} disabled={disabled} title={title}>
      <span className={styles.bf} />
      <span className={styles.bi}><i className={`fa-solid ${icon}`} /> {label}</span>
    </button>
  )
}

function Boot({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="stage" />
      <div className="scanlines" />
      <div className="vignette" />
      <div style={{
        position: 'fixed', inset: 0, display: 'grid', placeItems: 'center',
        fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.22em',
        color: 'var(--amber)', textTransform: 'uppercase', zIndex: 100,
      }}>{children}</div>
    </>
  )
}
