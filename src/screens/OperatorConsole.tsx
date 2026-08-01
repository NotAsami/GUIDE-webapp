import { useState, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useDmStatus, useDmParty, useDmCampaign, useDmCatalog, useDmConfiscated, useDmFeatures, type DmCampaignState, type DmCatalogState, type DmFeaturesState } from '../lib/dm'
import { longRestPatch } from '../lib/rest'
import { useGuideVoice, ALL_PARTY, type VoiceMsg, type VoiceTone } from '../lib/voice'
import { usePartyPresence } from '../lib/presence'
import type {
  CharacterRow, CharacterUpdate, CharacterSecret, CharacterSecretUpdate, HP, Json,
  QuestRow, QuestStatus, QuestType, QuestObjective, SessionRow,
  CatalogItemRow, CatalogItemData, InventoryItem, ItemCategory, ItemRarity,
  ItemEffects, ItemSlot, AbilityKey, WeaponAbility, ActiveEffect,
  Feature, FeatureCategory, FeatureKind, CatalogFeatureRow, CatalogFeatureData,
  EquippedGear,
} from '../lib/database.types'
import { ITEM_SLOTS, PERSON } from '../lib/equip'
import { place, routeItem } from '../lib/placement'
import { OperatorInventory } from './OperatorInventory'
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

function toMember(c: CharacterRow, secret: CharacterSecret | undefined, online: boolean): PartyMember {
  const hp = (c.sheet?.hp?.current ?? 0) as number
  const hpMax = (c.sheet?.hp?.max ?? 0) as number
  const tempHp = (c.sheet?.hp?.temp ?? 0) as number
  const raw = (c.resources?.activeEffects as ActiveEffect[] | undefined) ?? []
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
    // Live from the party-presence channel (player Layout announces itself).
    online,
    // DM-only horror gauge from the `character_secrets` table (RLS = DM-only).
    // Absent until the DM first authors it, so default to 0.
    digitization: secret?.digitization ?? 0,
    effects: raw.map(e => ({ name: e.name ?? 'Effect', kind: e.kind ?? ('buff' as const) })),
  }
}

/** One operator-action line in the right-rail Activity Log. Session-local by
 *  design (the mockup's `logAct`): an aide-mémoire, not a stored audit trail. */
interface LogEntry {
  id: string
  node: ReactNode
  kind?: 'cyan' | 'danger'
  time: string
}

const nowStamp = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

const hpClassOf = (p: PartyMember): '' | 'warn' | 'crit' => {
  if (!p.hpMax) return ''
  const r = p.hp / p.hpMax
  return r <= 0.25 ? 'crit' : r <= 0.55 ? 'warn' : ''
}
const pctOf = (p: PartyMember) => (p.hpMax ? Math.max(0, Math.round((p.hp / p.hpMax) * 100)) : 0)

type View = 'overview' | 'character' | 'quests' | 'sessions' | 'catalog'
type CharTab = 'actions' | 'inventory' | 'lore'

export function OperatorConsole() {
  const { session, loading: authLoading } = useAuth()
  const { isDm, loading: dmLoading } = useDmStatus()
  const { party, secrets, loading: partyLoading, error, updateCharacter, updateSecret } = useDmParty()
  const campaign = useDmCampaign()
  const catalog = useDmCatalog()
  const featureLib = useDmFeatures()
  const confiscated = useDmConfiscated()
  const onlineIds = usePartyPresence()

  const [view, setView] = useState<View>('overview')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  /** Which per-character tab is showing when a PC is selected. */
  const [charTab, setCharTab] = useState<CharTab>('actions')

  // The G.U.I.D.E. voice (slice 6): DM → player broadcast channel. Send-only here.
  const sendVoice = useGuideVoice()
  // Session-local activity log, newest first, capped like the mockup's logAct.
  const [logEntries, setLogEntries] = useState<LogEntry[]>([])
  const log = (node: ReactNode, kind?: LogEntry['kind']) =>
    setLogEntries(prev => [{ id: crypto.randomUUID(), node, kind, time: nowStamp() }, ...prev].slice(0, 24))

  if (authLoading || dmLoading) return <Boot>Authorizing operator link…</Boot>
  if (!session) return <Navigate to="/login" replace />
  if (!isDm) return <Navigate to="/" replace />

  const members = party.map(m => toMember(m, secrets[m.id], onlineIds.has(m.id)))
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
  function openCatalog() {
    setView('catalog')
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
                <button className={cx(styles.ovEntry, view === 'catalog' && styles.active)} onClick={openCatalog}>
                  <span className={styles.ovIc}><i className="fa-solid fa-box-archive" /></span>
                  <span className={styles.ovTx}>
                    <span className={styles.ovT}>Catalog</span>
                    <span className={styles.ovS}>{catalog.items.length} items · {featureLib.features.length} features</span>
                  </span>
                </button>

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
            {/* Per-character tabs — campaign surfaces (overview / quests /
                sessions / catalog) have no tab modes, so no bar at all. */}
            {view === 'character' && (
              <div className={styles.workTabs}>
                <div
                  className={cx(styles.wtab, charTab === 'actions' && styles.active)}
                  onClick={() => setCharTab('actions')}
                  title="Action console"
                >
                  Oversee
                </div>
                <div
                  className={cx(styles.wtab, charTab === 'inventory' && styles.active)}
                  onClick={() => setCharTab('inventory')}
                  title="Browse, lock and confiscate carried items"
                >
                  Inventory
                </div>
                <div
                  className={cx(styles.wtab, charTab === 'lore' && styles.active)}
                  onClick={() => setCharTab('lore')}
                  title="Lore & corruption (DM-only)"
                >
                  Lore Editor
                </div>
                <div className={cx(styles.wtab, styles.lvl, styles.disabled)} title="Level-up — later slice">
                  <i className="fa-solid fa-arrow-up-right-dots" /> Level Up
                </div>
              </div>
            )}
            <div className={styles.workBody}>
              {error ? (
                <div className={styles.soonPanel}><i className="fa-solid fa-triangle-exclamation" /><span className={styles.big}>Link Error</span><span>{error}</span></div>
              ) : partyLoading ? (
                <div className={styles.soonPanel}><i className="fa-solid fa-spinner" /><span>Loading party…</span></div>
              ) : view === 'quests' ? (
                <QuestsSurface campaign={campaign} />
              ) : view === 'sessions' ? (
                <SessionsSurface campaign={campaign} />
              ) : view === 'catalog' ? (
                <CatalogSurface catalog={catalog} featureLib={featureLib} />
              ) : view === 'character' && selected && selectedRow ? (
                charTab === 'lore' ? (
                  <LoreTab key={selectedRow.id} row={selectedRow} member={selected} secret={secrets[selectedRow.id]} onUpdateSecret={patch => updateSecret(selectedRow.id, patch)} onUpdateChar={patch => updateCharacter(selectedRow.id, patch)} />
                ) : charTab === 'inventory' ? (
                  <OperatorInventory
                    key={selectedRow.id} row={selectedRow} member={selected}
                    confiscated={confiscated}
                    onUpdate={patch => updateCharacter(selectedRow.id, patch)}
                    log={log}
                  />
                ) : (
                  <ActionsTab row={selectedRow} member={selected} catalog={catalog.items} featureLib={featureLib.features} onUpdate={patch => updateCharacter(selectedRow.id, patch)} onVoice={sendVoice} log={log} />
                )
              ) : (
                <OverviewDashboard members={members} selectedId={selectedId} onSelect={openCharacter} />
              )}
            </div>
          </div>
        </section>

        {/* RIGHT — BROADCAST + ACTIVITY LOG (slice 6) */}
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
                <BroadcastPanel selected={selected} onSend={sendVoice} log={log} />
                <div className={styles.bcDivider}>Activity Log</div>
              </div>
              {logEntries.length ? (
                <div className={styles.logList}>
                  {logEntries.map(e => (
                    <div key={e.id} className={cx(styles.logItem, e.kind && styles[e.kind])}>
                      <div className={styles.lgLine}>{e.node}</div>
                      <div className={styles.lgTime}>{e.time} · this session</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={styles.logEmpty}>No operator actions yet.</div>
              )}
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
function ActionsTab({ row, member, catalog, featureLib, onUpdate, onVoice, log }: {
  row: CharacterRow
  member: PartyMember
  catalog: CatalogItemRow[]
  featureLib: CatalogFeatureRow[]
  onUpdate: (patch: CharacterUpdate) => Promise<boolean>
  onVoice: (msg: VoiceMsg) => Promise<boolean>
  log: (node: ReactNode, kind?: 'cyan' | 'danger') => void
}) {
  const [hpAmt, setHpAmt] = useState(5)
  const [coinAmt, setCoinAmt] = useState(50)
  /** Which coin the Currency card's award/deduct targets (cells select it). */
  const [coinKind, setCoinKind] = useState<'gold' | 'silver' | 'copper'>('gold')
  const first = firstName(member.name)
  const who = <span className={styles.who}>{first}</span>

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

  // ---- writes (each pre-spreads its section; log lines are optimistic — the
  //      log is a session aide-mémoire, and failures surface in the error rail) ----
  const writeHp = (next: number, nextTemp = tempHp) =>
    onUpdate({ sheet: { ...sheet, hp: { ...hp, current: next, max: hpMax, temp: nextTemp } } })
  const heal = () => { void writeHp(Math.min(hpMax, hpCur + hpAmt)); log(<>Healed {who} <span className={styles.obj}>+{hpAmt} HP</span></>) }
  const damage = () => { void writeHp(Math.max(0, hpCur - hpAmt)); log(<>Damaged {who} <span className={styles.obj}>−{hpAmt} HP</span></>, 'danger') }
  const setHp = () => { void writeHp(Math.max(0, Math.min(hpMax, hpAmt))); log(<>Set {who} HP to <span className={styles.obj}>{Math.max(0, Math.min(hpMax, hpAmt))}</span></>) }
  const addTemp = () => { void writeHp(hpCur, tempHp + hpAmt); log(<>Granted {who} <span className={styles.obj}>+{hpAmt} temp HP</span></>) }
  const longRest = () => { void onUpdate(longRestPatch(row).patch); log(<>Applied <span className={styles.obj}>Long Rest</span> to {who}</>) }

  const coinVal = { gold, silver, copper }[coinKind]
  const moveCoins = async (op: 'award' | 'deduct') => {
    const next = op === 'award' ? coinVal + coinAmt : Math.max(0, coinVal - coinAmt)
    const ok = await onUpdate({ sheet: { ...sheet, coins: { ...coins, [coinKind]: next } } })
    if (!ok) return
    void onVoice({ kind: 'coins', target: member.id, amount: coinAmt, coin: coinKind, op })
    if (op === 'award') log(<>Awarded <span className={styles.obj}>{coinAmt} {coinKind} coins</span> to {who}</>)
    else log(<>Deducted <span className={styles.obj}>{coinAmt} {coinKind} coins</span> from {who}</>, 'danger')
  }
  const award = () => void moveCoins('award')
  const deduct = () => void moveCoins('deduct')

  const writeDeath = (next: { successes: number; failures: number }) => {
    void onUpdate({ resources: { ...resources, deathSaves: next } })
    log(<>Death saves of {who} → <span className={styles.obj}>S{next.successes} / F{next.failures}</span></>, next.failures >= 3 ? 'danger' : undefined)
  }
  const setExh = (raw: number) => {
    const next = Math.max(0, Math.min(6, raw))
    void onUpdate({ resources: { ...resources, exhaustion: next } })
    log(<>Exhaustion of {who} → <span className={styles.obj}>Level {next}</span></>, next >= 5 ? 'danger' : undefined)
  }

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

        {/* B — GRANT ITEM: snapshot a catalog template into this PC's inventory */}
        <GrantItemCard member={member} catalog={catalog} row={row} onUpdate={onUpdate} onVoice={onVoice} log={log} />

        {/* C — APPLY EFFECT: push a status effect onto this PC (slice 6) */}
        <ApplyEffectCard member={member} row={row} onUpdate={onUpdate} onVoice={onVoice} log={log} />

        {/* D — CURRENCY */}
        <div className={styles.actCard}>
          <span className={cx(styles.acCorner, styles.tl)} /><span className={cx(styles.acCorner, styles.br)} />
          <div className={styles.acTitle}><i className="fa-solid fa-coins lead" /><span className={styles.num}>D</span><span className={styles.t}>Currency</span></div>
          <div className={styles.coinDisplay}><span className={styles.gp}>{gold.toLocaleString()}</span><span className={styles.gl}>Gold Coins</span></div>
          {/* the cells double as the award/deduct target selector */}
          <div className={styles.coinBreak}>
            <button className={cx(styles.coinCell, styles.gp, coinKind === 'gold' && styles.sel)} onClick={() => setCoinKind('gold')} aria-pressed={coinKind === 'gold'}>
              <div className={styles.cn}>{gold.toLocaleString()}</div><div className={styles.ct}>Gold</div>
            </button>
            <button className={cx(styles.coinCell, styles.sp, coinKind === 'silver' && styles.sel)} onClick={() => setCoinKind('silver')} aria-pressed={coinKind === 'silver'}>
              <div className={styles.cn}>{silver.toLocaleString()}</div><div className={styles.ct}>Silver</div>
            </button>
            <button className={cx(styles.coinCell, styles.cp, coinKind === 'copper' && styles.sel)} onClick={() => setCoinKind('copper')} aria-pressed={coinKind === 'copper'}>
              <div className={styles.cn}>{copper.toLocaleString()}</div><div className={styles.ct}>Copper</div>
            </button>
          </div>
          <div className={styles.stepper}>
            <input className={styles.numIn} type="number" min={1} value={coinAmt}
              onChange={e => setCoinAmt(Math.max(0, parseInt(e.target.value || '0', 10) || 0))} />
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

        {/* F — GRANT FEATURE (wide): roleplay boons straight onto the sheet;
            item-borne features travel with their item instead (Grant Item). */}
        <GrantFeatureCard member={member} row={row} featureLib={featureLib} onUpdate={onUpdate} onVoice={onVoice} log={log} />
      </div>

    </>
  )
}

// ============================================================
// GRANT ITEM (Actions card B) + CATALOG SURFACE — slice 5
// ============================================================

/** App-aligned item taxonomy (NOT the mockup's — the engine reads these). */
const CAT_ORDER: ItemCategory[] = [
  'weapon', 'ammo', 'armor', 'consumable', 'tool', 'quest', 'misc',
]
const CAT_DEF: Record<ItemCategory, { label: string; corner: string }> = {
  weapon: { label: 'Weapon', corner: 'fa-gavel' },
  ammo: { label: 'Ammunition', corner: 'fa-location-arrow' },
  armor: { label: 'Armor', corner: 'fa-shield-halved' },
  consumable: { label: 'Consumable', corner: 'fa-flask' },
  tool: { label: 'Tool', corner: 'fa-screwdriver-wrench' },
  quest: { label: 'Quest', corner: 'fa-scroll' },
  misc: { label: 'Misc', corner: 'fa-box' },
}
/** Categories that occupy a worn gear slot, and so get the Equip Slot picker.
 *  In the expanded taxonomy that is `armor` alone — weapons go to hands and
 *  containers to the carry sidebar, so neither needs a slot. */
const isSlotted = (c: ItemCategory) => c === 'armor'

const RAR_ORDER: ItemRarity[] = ['common', 'uncommon', 'rare', 'legendary']
const RAR_DEF: Record<ItemRarity, { label: string; token: string }> = {
  common: { label: 'Common', token: 'var(--rar-common)' },
  uncommon: { label: 'Uncommon', token: 'var(--rar-uncommon)' },
  rare: { label: 'Rare', token: 'var(--rar-rare)' },
  legendary: { label: 'Legendary', token: 'var(--rar-legend)' },
}
const GEAR_SLOTS: readonly ItemSlot[] = ITEM_SLOTS
const WEAPON_ABILITIES: WeaponAbility[] = ['str', 'dex', 'finesse']
const ITEM_ICONS = [
  'fa-khanda', 'fa-hammer', 'fa-bullseye', 'fa-gavel', 'fa-wand-sparkles', 'fa-staff-snake',
  'fa-shirt', 'fa-shield-halved', 'fa-helmet-safety', 'fa-user-tie', 'fa-hat-wizard', 'fa-shoe-prints',
  'fa-ring', 'fa-gem', 'fa-flask', 'fa-vial', 'fa-scroll', 'fa-book',
  'fa-key', 'fa-fire', 'fa-drumstick-bite', 'fa-link', 'fa-bed', 'fa-box',
]

const rarColor = (r?: ItemRarity) => RAR_DEF[r ?? 'common']?.token ?? 'var(--muted)'
const catDef = (c?: ItemCategory) => CAT_DEF[c ?? 'misc'] ?? CAT_DEF.misc

function firstName(name: string) { return name.split(' ')[0] }

/** Build a fresh inventory instance from a catalog template: a self-describing
 *  snapshot of the template `data` + a unique instance id + the `item_id` back-ref.
 *  Stackables (consumable/misc) get qty 1 so the grid renders a count badge. */
function grantSnapshot(
  item: CatalogItemRow, gear: EquippedGear, inventory: InventoryItem[],
): InventoryItem {
  const inst = `inst-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`
  const data = item.data ?? ({} as CatalogItemData)
  const stackable = data.category === 'consumable' || data.category === 'misc'
  const fresh = {
    ...data, id: inst, item_id: item.id,
    containerId: PERSON,
    ...(stackable ? { qty: 1 } : {}),
  } as InventoryItem
  // Granted items go through the SAME routing chain as anything else picked up:
  // arrows fall into the quiver, everything else takes the first free cell on
  // person and overflows to a bag. This is what retired the grant-destination
  // picker — the DM never has to choose a container.
  return place(fresh, routeItem(fresh, gear, inventory))
}

/** Grant Item: search the catalog, pick a template, snapshot it into this PC's
 *  inventory. The WRITE is a plain `characters.inventory` append (spread so nothing
 *  else is clobbered) — the player's verified Inventory/Equipment screens receive an
 *  ordinary self-describing item and are untouched. On success, pushes the
 *  ITEM ACQUIRED toast over the voice channel and logs the grant. */
function GrantItemCard({ member, catalog, row, onUpdate, onVoice, log }: {
  member: PartyMember
  catalog: CatalogItemRow[]
  row: CharacterRow
  onUpdate: (patch: CharacterUpdate) => Promise<boolean>
  onVoice: (msg: VoiceMsg) => Promise<boolean>
  log: (node: ReactNode, kind?: 'cyan' | 'danger') => void
}) {
  const [query, setQuery] = useState('')
  const [selId, setSelId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState('')

  const q = query.trim().toLowerCase()
  const list = q ? catalog.filter(it => (it.data?.name ?? '').toLowerCase().includes(q)) : catalog
  const selected = catalog.find(it => it.id === selId) ?? null

  async function grant() {
    if (!selected) return
    setBusy(true)
    const inv = ((row.inventory as unknown as InventoryItem[]) ?? [])
    const gear = (row.equipped ?? {}) as EquippedGear
    const ok = await onUpdate({ inventory: [...inv, grantSnapshot(selected, gear, inv)] as unknown as Json[] })
    setBusy(false)
    if (!ok) return
    const d = selected.data
    // Realtime ping → the player's ITEM ACQUIRED toast; the item itself already
    // landed via the inventory write (and streams in through live read-sync).
    void onVoice({ kind: 'item', target: member.id, name: d?.name ?? 'Item', icon: d?.icon, rarity: d?.rarity })
    log(<>Granted <span className={styles.obj}>{d?.name ?? 'item'}</span> to <span className={styles.who}>{firstName(member.name)}</span></>, 'cyan')
    setFlash(`Granted ${d?.name ?? 'item'}`)
    setSelId(null)
    setTimeout(() => setFlash(''), 2400)
  }

  return (
    <div className={styles.actCard}>
      <span className={cx(styles.acCorner, styles.tl)} /><span className={cx(styles.acCorner, styles.br)} />
      <div className={styles.acTitle}><i className="fa-solid fa-box-open lead" /><span className={styles.num}>B</span><span className={styles.t}>Grant Item</span></div>
      <div className={styles.searchWrap}>
        <i className="fa-solid fa-magnifying-glass" />
        <input className={styles.searchIn} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search catalog…" />
      </div>
      <div className={styles.catList}>
        {catalog.length === 0 ? (
          <div className={styles.catListEmpty}>Catalog is empty — author items in the Catalog surface.</div>
        ) : list.length === 0 ? (
          <div className={styles.catListEmpty}>No items match.</div>
        ) : list.map(it => {
          const col = rarColor(it.data?.rarity)
          return (
            <button key={it.id} className={cx(styles.catItem, it.id === selId && styles.sel)} onClick={() => setSelId(it.id)}>
              <span className={styles.ciIc} style={{ color: col }}><i className={`fa-solid ${it.data?.icon ?? 'fa-box'}`} /></span>
              <span className={styles.ciTx}>
                <span className={styles.ciNm}>{it.data?.name ?? 'Untitled'}</span>
                <span className={styles.ciTy}>{catDef(it.data?.category).label}</span>
              </span>
              <span className={styles.ciRar} style={{ color: col }}>{RAR_DEF[it.data?.rarity ?? 'common']?.label ?? 'Common'}</span>
            </button>
          )
        })}
      </div>
      <div className={styles.grantAction}>
        <Btn tone="amber" icon="fa-arrow-right-to-bracket"
          label={flash || (busy ? 'Granting…' : `Grant to ${firstName(member.name)}`)}
          onClick={() => void grant()} disabled={!selected || busy} />
      </div>
    </div>
  )
}

/** The Operator's quick-apply status list (mockup EFFECT_CATALOG). Static for
 *  now — a DM-authored effect library can join the Catalog surface later. Numeric
 *  modifiers are engine-real (layered by lib/effects.ts); dice/condition rules the
 *  engine can't model stay honest prose in `note`, never fake numbers. */
const EFFECT_CATALOG: { id: string; name: string; kind: 'buff' | 'cond' | 'debuff'; icon: string; effects: ItemEffects; note?: string }[] = [
  { id: 'str-potion', name: '+3 STR Potion', kind: 'buff', icon: 'fa-flask', effects: { abilities: { str: 3 } } },
  { id: 'bless', name: 'Bless', kind: 'buff', icon: 'fa-hands-praying', effects: {}, note: '+1d4 attacks & saves' },
  { id: 'haste', name: 'Haste', kind: 'buff', icon: 'fa-gauge-high', effects: { ac: 2 }, note: 'speed ×2 · extra action' },
  { id: 'poisoned', name: 'Poisoned', kind: 'cond', icon: 'fa-skull-crossbones', effects: {}, note: 'disadv. on attacks & checks' },
  { id: 'frightened', name: 'Frightened', kind: 'cond', icon: 'fa-ghost', effects: {}, note: 'disadv. while source in sight' },
  { id: 'stunned', name: 'Stunned', kind: 'debuff', icon: 'fa-bolt', effects: {}, note: 'incapacitated · auto-fail STR/DEX saves' },
]
const DUR_UNITS = ['round', 'minute', 'hour', 'day'] as const

/** Apply Effect (card C): push a status onto the PC's `resources.activeEffects` —
 *  the SAME field the player's potion-drinking writes and the effects tray reads,
 *  so the DM's push shows up in the tray, layers into the effective sheet, clears
 *  on rest, and the player can shrug it off manually (all existing behavior). */
function ApplyEffectCard({ member, row, onUpdate, onVoice, log }: {
  member: PartyMember
  row: CharacterRow
  onUpdate: (patch: CharacterUpdate) => Promise<boolean>
  onVoice: (msg: VoiceMsg) => Promise<boolean>
  log: (node: ReactNode, kind?: 'cyan' | 'danger') => void
}) {
  const [effId, setEffId] = useState(EFFECT_CATALOG[0].id)
  // Duration = amount × unit, or the until-rest override (rests clear effects
  // anyway, so "until rest" is the natural upper bound).
  const [durN, setDurN] = useState(1)
  const [durUnit, setDurUnit] = useState<typeof DUR_UNITS[number]>('round')
  const [untilRest, setUntilRest] = useState(false)
  const [busy, setBusy] = useState(false)
  const dur = untilRest ? 'until rest' : `${durN} ${durUnit}${durN === 1 ? '' : 's'}`

  const resources = row.resources ?? {}
  const active = (resources.activeEffects as ActiveEffect[] | undefined) ?? []
  const first = firstName(member.name)

  async function apply() {
    const def = EFFECT_CATALOG.find(e => e.id === effId)
    if (!def) return
    setBusy(true)
    const eff: ActiveEffect = {
      id: crypto.randomUUID(), name: def.name, icon: def.icon, kind: def.kind,
      effects: def.effects, source: 'G.U.I.D.E. Operator',
      note: [dur, def.note].filter(Boolean).join(' · '), at: Date.now(),
    }
    const ok = await onUpdate({ resources: { ...resources, activeEffects: [...active, eff] } as CharacterRow['resources'] })
    setBusy(false)
    if (!ok) return
    void onVoice({ kind: 'effect', target: member.id, name: def.name, dur })
    log(<>Applied <span className={styles.obj}>{def.name}</span> to <span className={styles.who}>{first}</span></>, def.kind === 'buff' ? 'cyan' : 'danger')
  }

  async function remove(id: string) {
    const gone = active.find(e => e.id === id)
    const ok = await onUpdate({ resources: { ...resources, activeEffects: active.filter(e => e.id !== id) } as CharacterRow['resources'] })
    if (ok && gone) log(<>Cleared <span className={styles.obj}>{gone.name}</span> from <span className={styles.who}>{first}</span></>)
  }

  return (
    <div className={styles.actCard}>
      <span className={cx(styles.acCorner, styles.tl)} /><span className={cx(styles.acCorner, styles.br)} />
      <div className={styles.acTitle}><i className="fa-solid fa-wand-sparkles lead" /><span className={styles.num}>C</span><span className={styles.t}>Apply Effect</span></div>

      <span className={styles.fieldLab}>Effect</span>
      <select className={styles.selIn} value={effId} onChange={e => setEffId(e.target.value)}>
        {EFFECT_CATALOG.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
      </select>

      <span className={styles.fieldLab}>Duration</span>
      <div className={styles.durRow}>
        <input className={styles.numIn} type="number" min={1} value={durN} disabled={untilRest}
          aria-label="Duration amount"
          onChange={e => setDurN(Math.max(1, parseInt(e.target.value || '1', 10) || 1))} />
        <select className={styles.selIn} value={durUnit} disabled={untilRest} aria-label="Duration unit"
          onChange={e => setDurUnit(e.target.value as typeof DUR_UNITS[number])}>
          {DUR_UNITS.map(u => <option key={u} value={u}>{u[0].toUpperCase() + u.slice(1)}{durN === 1 ? '' : 's'}</option>)}
        </select>
        <button className={cx(styles.durOpt, untilRest && styles.sel)} onClick={() => setUntilRest(r => !r)} aria-pressed={untilRest}>
          Until Rest
        </button>
      </div>

      <div className={styles.btnMount}>
        <Btn tone="amber" icon="fa-bolt" label={busy ? 'Applying…' : 'Apply Effect'} onClick={() => void apply()} disabled={busy} />
      </div>

      <div className={styles.fxActive}>
        <div className={styles.faHead}>Active on {first}</div>
        {active.length ? active.map(e => (
          <div key={e.id} className={cx(styles.fxLine, styles[e.kind ?? 'buff'])}>
            <span className={styles.nm}>{e.name}</span>
            {e.note && <span className={styles.du}>{e.note}</span>}
            <span className={styles.x} onClick={() => void remove(e.id)} title="Clear effect"><i className="fa-solid fa-xmark" /></span>
          </div>
        )) : <div className={styles.fxNone}>— clear —</div>}
      </div>
    </div>
  )
}

/** The Broadcast panel — compose a G.U.I.D.E. system notice and push it over the
 *  voice channel to the selected PC or the whole party. Ephemeral by design (see
 *  lib/voice.ts): an offline player misses it, like any tabletop aside. */
function BroadcastPanel({ selected, onSend, log }: {
  selected: PartyMember | null
  onSend: (msg: VoiceMsg) => Promise<boolean>
  log: (node: ReactNode, kind?: 'cyan' | 'danger') => void
}) {
  const [target, setTarget] = useState<'selected' | 'all'>('all')
  const [message, setMessage] = useState('')
  const [tone, setTone] = useState<VoiceTone>('normal')
  const [flash, setFlash] = useState('')

  // No PC selected → the Selected option is inert and 'all' takes over.
  const effTarget = target === 'selected' && selected ? selected : null

  async function push() {
    const msg = message.trim()
    if (!msg) return
    const ok = await onSend({ kind: 'notice', target: effTarget?.id ?? ALL_PARTY, message: msg, tone })
    if (!ok) {
      setFlash('Link not ready — try again')
      setTimeout(() => setFlash(''), 2000)
      return
    }
    log(
      <>Pushed {tone === 'corrupted' ? <span style={{ color: 'var(--amber-hot)' }}>corrupted </span> : null}notice to <span className={styles.who}>{effTarget ? firstName(effTarget.name) : 'All Party'}</span></>,
      tone === 'corrupted' ? 'danger' : 'cyan',
    )
    setMessage('')
    setFlash('Pushed ✓')
    setTimeout(() => setFlash(''), 1800)
  }

  return (
    <>
      <span className={styles.fieldLab}>Recipient</span>
      <div className={styles.bcTarget}>
        <button
          className={cx(styles.tg, target === 'selected' && !!selected && styles.sel, !selected && styles.off)}
          onClick={() => selected && setTarget('selected')}
          title={selected ? `Push to ${selected.name}` : 'Select a character first'}
        >
          {selected ? firstName(selected.name) : 'Selected PC'}
        </button>
        <button className={cx(styles.tg, (target === 'all' || !selected) && styles.sel)} onClick={() => setTarget('all')}>
          All Party
        </button>
      </div>

      <span className={styles.fieldLab}>System message</span>
      <textarea
        className={cx(styles.bcArea, tone === 'corrupted' && styles.corrupted)}
        value={message}
        onChange={e => setMessage(e.target.value)}
        placeholder="Compose a G.U.I.D.E. system notice to push to the player…"
      />

      <span className={styles.fieldLab}>Tone</span>
      <div className={styles.toneToggle}>
        <button className={cx(styles.toneOpt, tone === 'normal' && styles.sel)} data-tone="normal" onClick={() => setTone('normal')}>
          <span className={styles.led} /> Normal
        </button>
        <button className={cx(styles.toneOpt, tone === 'corrupted' && styles.sel)} data-tone="corrupted" onClick={() => setTone('corrupted')}>
          <span className={styles.led} /> Corrupted
        </button>
      </div>

      <div className={styles.btnMount}>
        <Btn tone="amber" icon="fa-tower-broadcast" label={flash || 'Push Notification'} onClick={() => void push()} disabled={!message.trim()} />
      </div>
    </>
  )
}

// ---- effects authoring: modifier rows <-> structured ItemEffects ----
/** The numeric modifiers the engine (lib/effects.ts) actually reads. `Note` and
 *  other descriptive perks are authored as Detail rows instead, not here. */
const MOD_STATS = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA', 'AC', 'Attack', 'Damage', 'Saves', 'Speed', 'Initiative', 'Darkvision'] as const
/** One authored modifier: a stat, an amount, and (abilities only) whether the
 *  amount is a flat bonus or a floor the score is set to (abilitySet). */
type Mod = { stat: string; amt: number; set?: boolean }
const ABIL_KEYS: Record<string, AbilityKey> = { STR: 'str', DEX: 'dex', CON: 'con', INT: 'int', WIS: 'wis', CHA: 'cha' }
const isAbility = (stat: string) => stat in ABIL_KEYS

/** Compile the GUI modifier rows into the structured `effects` the engine layers
 *  over the sheet (lib/effects.ts). Abilities can be a flat bonus OR a "set to"
 *  floor (Giant Strength); everything else is a flat bonus. */
function compileEffects(mods: Mod[]): ItemEffects | undefined {
  const eff: ItemEffects = {}
  for (const m of mods) {
    const n = m.amt
    if (!Number.isFinite(n)) continue
    const ak = ABIL_KEYS[m.stat]
    if (ak) { if (m.set) (eff.abilitySet ??= {})[ak] = n; else (eff.abilities ??= {})[ak] = n }
    else if (m.stat === 'AC') eff.ac = n
    else if (m.stat === 'Attack') eff.attack = n
    else if (m.stat === 'Damage') eff.damage = n
    else if (m.stat === 'Saves') eff.saves = n
    else if (m.stat === 'Speed') eff.speed = n
    else if (m.stat === 'Initiative') eff.initiative = n
    else if (m.stat === 'Darkvision') eff.darkvision = n
  }
  return Object.keys(eff).length ? eff : undefined
}

/** Reverse of compileEffects, to seed the editor when editing an existing item.
 *  Object-form `saves` (per-ability) isn't round-tripped — the seed never uses it
 *  and the editor only offers all-saves; such an item keeps its structured value. */
function effectsToMods(eff?: ItemEffects): Mod[] {
  if (!eff) return []
  const mods: Mod[] = []
  const up = (k: string) => k.toUpperCase()
  for (const [k, v] of Object.entries(eff.abilities ?? {})) mods.push({ stat: up(k), amt: v as number })
  for (const [k, v] of Object.entries(eff.abilitySet ?? {})) mods.push({ stat: up(k), amt: v as number, set: true })
  if (eff.ac != null) mods.push({ stat: 'AC', amt: eff.ac })
  if (eff.attack != null) mods.push({ stat: 'Attack', amt: eff.attack })
  if (eff.damage != null) mods.push({ stat: 'Damage', amt: eff.damage })
  if (typeof eff.saves === 'number') mods.push({ stat: 'Saves', amt: eff.saves })
  if (eff.speed != null) mods.push({ stat: 'Speed', amt: eff.speed })
  if (eff.initiative != null) mods.push({ stat: 'Initiative', amt: eff.initiative })
  if (eff.darkvision != null) mods.push({ stat: 'Darkvision', amt: eff.darkvision })
  return mods
}

/** Catalog Manager: the DM's item-authoring library. Left = index grouped by
 *  category; right = the item form. Spells / Features / Shards are their own future
 *  catalogs, shown as inert "soon" tabs to reserve their place (matches the mockup).
 *  Items are stored in the app's structured shape (NOT the mockup's string effects)
 *  so a granted copy is mechanically real the instant it lands. */
function CatalogSurface({ catalog, featureLib }: { catalog: DmCatalogState; featureLib: DmFeaturesState }) {
  const { items, createItem, updateItem, deleteItem, loading, error } = catalog
  const [tab, setTab] = useState<'items' | 'features'>('items')
  const [selId, setSelId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const activeId = creating ? null : (selId ?? items[0]?.id ?? null)
  const selected = items.find(it => it.id === activeId) ?? null

  async function handleSubmit(data: CatalogItemData) {
    if (selected) {
      await updateItem(selected.id, { data })
    } else {
      const created = await createItem({ data })
      if (created) { setCreating(false); setSelId(created.id) }
    }
  }
  async function handleDelete() {
    if (!selected) return
    await deleteItem(selected.id)
    setSelId(null)
  }

  const catTabs: { key: string; label: string; icon: string; n?: number; soon: boolean }[] = [
    { key: 'items', label: 'Items', icon: 'fa-box-open', n: items.length, soon: false },
    { key: 'features', label: 'Features', icon: 'fa-star', n: featureLib.features.length, soon: false },
    { key: 'spells', label: 'Spells', icon: 'fa-wand-sparkles', soon: true },
    { key: 'shards', label: 'Shards', icon: 'fa-gem', soon: true },
  ]

  return (
    <>
      <div className={styles.ovBanner}>
        <span className={styles.big}>Catalog</span>
        <span>Content library · author once, grant from anywhere</span>
        <span className={styles.dmonly}><i className="fa-solid fa-box-archive" /> Templates — not a grant</span>
      </div>

      <div className={styles.catTabs}>
        {catTabs.map(t => (
          <button key={t.key} className={cx(styles.catTab, t.key === tab && styles.sel, t.soon && styles.stub)}
            disabled={t.soon} title={t.soon ? 'Its own later slice' : undefined}
            onClick={() => !t.soon && setTab(t.key as 'items' | 'features')}>
            <i className={`fa-solid ${t.icon}`} />{t.label}
            {t.n != null && <span className={styles.ctC}>{t.n}</span>}
          </button>
        ))}
      </div>

      {error ? (
        <div className={styles.soonPanel}><i className="fa-solid fa-triangle-exclamation" /><span className={styles.big}>Link Error</span><span>{error}</span></div>
      ) : tab === 'features' ? (
        <FeatureLibrarySurface lib={featureLib} />
      ) : (
        <div className={styles.catLayout}>
          <div className={styles.catIndex}>
            <div className={styles.catNew}>
              <Btn tone="cyan" icon="fa-plus" label="New Item" onClick={() => { setCreating(true); setSelId(null) }} />
            </div>
            {CAT_ORDER.map(cat => {
              const rows = items.filter(it => (it.data?.category ?? 'misc') === cat)
              if (!rows.length) return null
              return (
                <div key={cat} className={styles.catGrp}>
                  <div className={styles.catGrpHead}><span className={styles.ghT}>{CAT_DEF[cat].label}</span><span className={styles.ghC}>{rows.length}</span></div>
                  <div className={styles.catRows}>
                    {rows.map(it => {
                      const col = rarColor(it.data?.rarity)
                      return (
                        <button key={it.id} className={cx(styles.catRow, it.id === activeId && !creating && styles.sel)}
                          style={{ ['--rar' as string]: col }} onClick={() => { setCreating(false); setSelId(it.id) }}>
                          <span className={styles.crIc}><i className={`fa-solid ${it.data?.icon ?? 'fa-box'}`} /></span>
                          <span className={styles.crTx}>
                            <span className={styles.crT}>{it.data?.name ?? 'Untitled'}</span>
                            <span className={styles.crS}>{CAT_DEF[cat].label} · {it.data?.w ?? 1}×{it.data?.h ?? 1}</span>
                          </span>
                          <span className={styles.crTag} style={{ color: col, borderColor: col }}>{RAR_DEF[it.data?.rarity ?? 'common']?.label}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
            {items.length === 0 && <div className={styles.catEmpty}>{loading ? '· loading ·' : '— catalog empty —'}</div>}
          </div>

          <div className={styles.catForm}>
            <CatalogForm key={activeId ?? 'new'} item={selected} featureLib={featureLib.features} onSubmit={handleSubmit} onDelete={selected ? handleDelete : undefined} />
          </div>
        </div>
      )}
    </>
  )
}

function CatalogForm({ item, featureLib, onSubmit, onDelete }: {
  item: CatalogItemRow | null
  featureLib: CatalogFeatureRow[]
  onSubmit: (data: CatalogItemData) => Promise<void>
  onDelete?: () => void
}) {
  const d = item?.data
  const [name, setName] = useState(d?.name ?? '')
  const [category, setCategory] = useState<ItemCategory>(d?.category ?? 'misc')
  const [rarity, setRarity] = useState<ItemRarity>(d?.rarity ?? 'common')
  const [w, setW] = useState(d?.w ?? 1)
  const [h, setH] = useState(d?.h ?? 1)
  const [weight, setWeight] = useState(String(d?.weight ?? ''))
  const [value, setValue] = useState(d?.value != null ? String(d.value) : '')
  // Container authoring. `isContainer` is its own toggle rather than being
  // inferred from the category: a backpack and a crowbar are both tools, and
  // only one of them holds things.
  const [isContainer, setIsContainer] = useState(!!d?.container)
  const [ctrKind, setCtrKind] = useState<string>(d?.container?.kind ?? 'backpack')
  const [ctrMode, setCtrMode] = useState<'page' | 'inline'>(d?.container?.mode ?? 'page')
  const [ctrWeightless, setCtrWeightless] = useState(!!d?.container?.weightless)
  const [ctrCats, setCtrCats] = useState<ItemCategory[]>(d?.container?.allowedCategories ?? [])
  const [ctrCap, setCtrCap] = useState(d?.container?.capacity != null ? String(d.container.capacity) : '')
  const [icon, setIcon] = useState(d?.icon ?? 'fa-box')
  const [slot, setSlot] = useState<ItemSlot>((d?.slot as ItemSlot) ?? 'ring1')
  const [attune, setAttune] = useState(!!d?.attune)
  const [flavor, setFlavor] = useState(d?.flavor ?? '')
  const [ability, setAbility] = useState<WeaponAbility>((d?.ability as WeaponAbility) ?? 'str')
  const [damageDice, setDamageDice] = useState(d?.damageDice ?? '')
  const [dmgType, setDmgType] = useState(d?.type ?? '')
  const [heal, setHeal] = useState(d?.heal != null ? String(d.heal) : '')
  const [duration, setDuration] = useState(d?.duration ?? '')
  const [mods, setMods] = useState<Mod[]>(effectsToMods(d?.effects))
  const [feats, setFeats] = useState<Feature[]>(d?.features ?? [])
  const [rows, setRows] = useState<[string, string][]>(d?.rows ?? [])
  const [rowLab, setRowLab] = useState('')
  const [rowVal, setRowVal] = useState('')
  const [busy, setBusy] = useState(false)

  const rd = RAR_DEF[rarity]
  const def = CAT_DEF[category]

  function build(): CatalogItemData {
    const weightNum = parseFloat(weight)
    const valueNum = parseInt(value, 10)
    const data: CatalogItemData = {
      name: name.trim(), category, rarity, icon, w, h,
      ...(Number.isFinite(weightNum) ? { weight: weightNum } : {}),
      ...(Number.isFinite(valueNum) ? { value: valueNum } : {}),
      ...(isSlotted(category) ? { slot } : {}),
      ...(isContainer ? {
        container: {
          kind: ctrKind.trim() || 'backpack',
          mode: ctrMode,
          weightless: ctrWeightless,
          ...(ctrCats.length ? { allowedCategories: ctrCats } : {}),
          ...(Number.isFinite(parseInt(ctrCap, 10)) ? { capacity: parseInt(ctrCap, 10) } : {}),
        },
      } : {}),
      ...(attune ? { attune: name.trim() } : {}),
      ...(flavor.trim() ? { flavor: flavor.trim() } : {}),
      ...(category === 'weapon'
        ? { ability, ...(damageDice.trim() ? { damageDice: damageDice.trim() } : {}), ...(dmgType.trim() ? { type: dmgType.trim() } : {}) }
        : {}),
      ...(category === 'consumable'
        ? { ...(heal.trim() ? { heal: heal.trim() } : {}), ...(duration.trim() ? { duration: duration.trim() } : {}) }
        : {}),
    }
    const effects = compileEffects(mods)
    if (effects) data.effects = effects
    if (feats.length) data.features = feats
    if (rows.length) data.rows = rows
    return data
  }
  async function submit() {
    setBusy(true)
    await onSubmit(build())
    setBusy(false)
  }
  function addRow() {
    const l = rowLab.trim()
    if (!l) return
    setRows(r => [...r, [l, rowVal.trim()]])
    setRowLab(''); setRowVal('')
  }

  return (
    <>
      <div className={styles.catFormHead}>
        <span className={styles.cfhT}>{item ? 'Edit Item' : 'New Item'}</span>
        <span className={styles.cfhId}>{item ? item.id : 'unsaved template'}</span>
      </div>

      {/* live preview tile */}
      <div className={styles.catPrev} style={{ ['--rar' as string]: rd.token }}>
        <span className={styles.pvCell}>
          <i className={`fa-solid ${icon}`} />
          <span className={styles.pvCorner}><i className={`fa-solid ${def.corner}`} /></span>
        </span>
        <span className={styles.pvTx}>
          <span className={styles.pvName}>{name || 'Untitled Item'}</span>
          <span className={styles.pvMeta}>
            <span>{def.label}</span><span className={styles.rar} style={{ color: rd.token }}>{rd.label}</span>
            <span>{w}×{h} cells</span>
            {isSlotted(category) && <span>{slot}</span>}
            {attune && <span>attunement</span>}
          </span>
        </span>
      </div>

      <span className={styles.fieldLab}>Name</span>
      <input className={styles.sessIn} value={name} onChange={e => setName(e.target.value)} placeholder="Name the item…" />

      <div className={styles.catGrid2}>
        <div>
          <span className={styles.fieldLab}>Category</span>
          <select className={styles.selIn} value={category} onChange={e => setCategory(e.target.value as ItemCategory)}>
            {CAT_ORDER.map(c => <option key={c} value={c}>{CAT_DEF[c].label}</option>)}
          </select>
        </div>
        <div>
          <span className={styles.fieldLab}>Rarity</span>
          <select className={styles.selIn} value={rarity} onChange={e => setRarity(e.target.value as ItemRarity)}>
            {RAR_ORDER.map(r => <option key={r} value={r}>{RAR_DEF[r].label}</option>)}
          </select>
        </div>
      </div>

      <div className={styles.catGrid3}>
        <div>
          <span className={styles.fieldLab}>Footprint</span>
          <div className={styles.catDim}>
            <input className={styles.sessIn} type="number" min={1} value={w} onChange={e => setW(Math.max(1, parseInt(e.target.value || '1', 10) || 1))} />
            <span className={styles.x}>×</span>
            <input className={styles.sessIn} type="number" min={1} value={h} onChange={e => setH(Math.max(1, parseInt(e.target.value || '1', 10) || 1))} />
            <span className={styles.unit}>cells</span>
          </div>
        </div>
        <div><span className={styles.fieldLab}>Weight</span><input className={styles.sessIn} type="number" min={0} step="0.1" value={weight} onChange={e => setWeight(e.target.value)} placeholder="lb" /></div>
        <div><span className={styles.fieldLab}>Value</span><input className={styles.sessIn} type="number" min={0} value={value} onChange={e => setValue(e.target.value)} placeholder="gold" /></div>
      </div>

      <span className={styles.fieldLab}>Icon</span>
      <div className={styles.catIcons}>
        {ITEM_ICONS.map(ic => (
          <button key={ic} className={cx(styles.catIc, ic === icon && styles.sel)} onClick={() => setIcon(ic)} title={ic} aria-label={ic}>
            <i className={`fa-solid ${ic}`} />
          </button>
        ))}
      </div>

      {category === 'weapon' && (
        <div className={styles.catGrid3}>
          <div>
            <span className={styles.fieldLab}>Attack Ability</span>
            <select className={styles.selIn} value={ability} onChange={e => setAbility(e.target.value as WeaponAbility)}>
              {WEAPON_ABILITIES.map(a => <option key={a} value={a}>{a === 'finesse' ? 'Finesse' : a.toUpperCase()}</option>)}
            </select>
          </div>
          <div><span className={styles.fieldLab}>Damage Dice</span><input className={styles.sessIn} value={damageDice} onChange={e => setDamageDice(e.target.value)} placeholder="e.g. 1d8" /></div>
          <div><span className={styles.fieldLab}>Damage Type</span><input className={styles.sessIn} value={dmgType} onChange={e => setDmgType(e.target.value)} placeholder="e.g. Slashing" /></div>
        </div>
      )}

      {category === 'consumable' && (
        <div className={styles.catGrid2}>
          <div><span className={styles.fieldLab}>Heal (on use)</span><input className={styles.sessIn} value={heal} onChange={e => setHeal(e.target.value)} placeholder="e.g. 2d4 + 2" /></div>
          <div><span className={styles.fieldLab}>Duration</span><input className={styles.sessIn} value={duration} onChange={e => setDuration(e.target.value)} placeholder="e.g. 1 hour" /></div>
        </div>
      )}

      <div className={styles.catCtrHead}>
        <label className={styles.catTog}>
          <input type="checkbox" checked={isContainer} onChange={e => setIsContainer(e.target.checked)} />
          <span>This item is a container</span>
        </label>
      </div>

      {isContainer && (
        <div className={styles.catCtr}>
          <div className={styles.catGrid2}>
            <div>
              <span className={styles.fieldLab}>Kind</span>
              {/* Kind is what enforces the caps — one backpack, one bag of
                  holding, one sack, one quiver. Free text so a bolt case or a
                  scroll case can be authored without a code change; a NEW `page`
                  kind, though, would become a fifth Inventory tab. */}
              <input
                className={styles.sessIn} value={ctrKind}
                onChange={e => setCtrKind(e.target.value)}
                list="container-kinds" placeholder="backpack"
              />
              <datalist id="container-kinds">
                {['backpack', 'bagOfHolding', 'sack', 'quiver', 'boltCase', 'scrollCase']
                  .map(k => <option key={k} value={k} />)}
              </datalist>
            </div>
            <div>
              <span className={styles.fieldLab}>Display Mode</span>
              <select className={styles.selIn} value={ctrMode} onChange={e => setCtrMode(e.target.value as 'page' | 'inline')}>
                <option value="page">Page — owns an Inventory tab</option>
                <option value="inline">Inline — expands in the carry panel</option>
              </select>
            </div>
          </div>

          <div className={styles.catGrid2}>
            <div>
              <span className={styles.fieldLab}>Capacity</span>
              <input
                className={styles.numIn} type="number" min={0} value={ctrCap}
                onChange={e => setCtrCap(e.target.value)} placeholder="unlimited"
              />
            </div>
            <label className={cx(styles.catTog, styles.ctrTog)}>
              <input type="checkbox" checked={ctrWeightless} onChange={e => setCtrWeightless(e.target.checked)} />
              <span>Weightless — contents don't count toward Burden</span>
            </label>
          </div>

          <span className={styles.fieldLab}>Accepts (empty = anything)</span>
          <div className={styles.catCtrCats}>
            {CAT_ORDER.map(c => (
              <button
                key={c} type="button"
                className={cx(styles.qTag, ctrCats.includes(c) && styles.sel)}
                onClick={() => setCtrCats(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c])}
              >
                {CAT_DEF[c].label}
              </button>
            ))}
          </div>
          <div className={styles.catCtrNote}>
            An ammunition-only container auto-collects what it accepts: picked-up
            arrows route themselves into a quiver before anything else.
          </div>
        </div>
      )}

      {isSlotted(category) && (
        <>
          <span className={styles.fieldLab}>Equip Slot</span>
          <select className={cx(styles.selIn, styles.slotSel)} value={slot} onChange={e => setSlot(e.target.value as ItemSlot)}>
            {GEAR_SLOTS.map(s => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
          </select>
        </>
      )}

      <div className={cx(styles.catTog, attune && styles.on)} onClick={() => setAttune(a => !a)} role="switch" aria-checked={attune}>
        <span className={styles.tgSw} />
        <span className={styles.tgLab}><span className={styles.t}>Attunement Required</span><span className={styles.s}>Binds to one bearer on a short rest</span></span>
      </div>

      <div className={styles.qLabRow}>
        <span className={styles.fieldLab}>Description</span>
        <span className={cx(styles.qFacing, styles.player)}><i className="fa-solid fa-eye" /> Player-facing</span>
      </div>
      <textarea className={styles.catProse} value={flavor} onChange={e => setFlavor(e.target.value)} placeholder="The prose the player reads when they examine this item…" />

      {/* structured effects (mechanical) — pick a stat, pick a number */}
      <div className={styles.catFx}>
        <div className={styles.catFxHead}><i className="fa-solid fa-flask-vial" /><span className={styles.t}>Effects Granted</span><span className={styles.s}>applied while equipped</span></div>
        <div className={styles.catFxRows}>
          {mods.length ? mods.map((m, i) => {
            const patchMod = (p: Partial<Mod>) => setMods(list => list.map((x, j) => (j === i ? { ...x, ...p } : x)))
            return (
              <div key={i} className={styles.catFxRow}>
                <select className={cx(styles.selIn, styles.fxStat)} value={m.stat}
                  onChange={e => patchMod({ stat: e.target.value, set: isAbility(e.target.value) ? m.set : false })}>
                  {MOD_STATS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                {isAbility(m.stat) && (
                  <select className={cx(styles.selIn, styles.fxMode)} value={m.set ? 'set' : 'bonus'} onChange={e => patchMod({ set: e.target.value === 'set' })}>
                    <option value="bonus">Bonus +</option>
                    <option value="set">Set to</option>
                  </select>
                )}
                <input className={cx(styles.sessIn, styles.fxAmt)} type="number" value={m.amt}
                  onChange={e => patchMod({ amt: parseInt(e.target.value, 10) || 0 })} />
                <span className={styles.fxX} onClick={() => setMods(list => list.filter((_, j) => j !== i))}><i className="fa-solid fa-xmark" /></span>
              </div>
            )
          }) : <div className={styles.catFxNone}>No modifiers — add the buffs this item grants while worn (e.g. AC +1, or set STR to 21).</div>}
        </div>
        <div className={styles.catFxAdd}>
          <Btn tone="ghost" sm icon="fa-plus" label="Add Modifier" onClick={() => setMods(list => [...list, { stat: 'STR', amt: 1 }])} />
        </div>
      </div>

      {/* features granted — embedded snapshots from the feature library, surfaced
          to the player as Gear Features while the item is equipped */}
      {category !== 'misc' && (
        <div className={styles.catFx}>
          <div className={styles.catFxHead}><i className="fa-solid fa-star" /><span className={styles.t}>Features Granted</span><span className={styles.s}>while equipped · snapshots from the library</span></div>
          <div className={styles.featChips}>
            {feats.length ? feats.map((f, i) => (
              <span key={i} className={styles.qTag}>
                <i className={`fa-solid ${f.icon ?? 'fa-star'}`} /> {f.name}
                <span className={styles.qTx2} onClick={() => setFeats(list => list.filter((_, j) => j !== i))}><i className="fa-solid fa-xmark" /></span>
              </span>
            )) : <div className={styles.catFxNone}>No features — attach perks authored in the Features tab (e.g. a cloak's stealth boon).</div>}
          </div>
          {featureLib.filter(f => !feats.some(x => x.feature_id === f.id)).length > 0 && (
            <div className={styles.featAdd}>
              <select className={styles.selIn} value="" onChange={e => {
                const row = featureLib.find(f => f.id === e.target.value)
                if (row) setFeats(list => [...list, { ...row.data, id: `gf-${row.id}`, feature_id: row.id }])
              }}>
                <option value="" disabled>Attach a feature…</option>
                {featureLib.filter(f => !feats.some(x => x.feature_id === f.id)).map(f => (
                  <option key={f.id} value={f.id}>{f.data?.name ?? 'Untitled'}{f.data?.source ? ` · ${f.data.source}` : ''}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* display detail rows */}
      <span className={styles.fieldLab}>Detail Rows</span>
      <div className={styles.qObjList}>
        {rows.length ? rows.map((r, i) => (
          <div key={i} className={styles.detailRow}>
            <span className={styles.drLab}>{r[0]}</span>
            <span className={styles.drVal}>{r[1]}</span>
            <span className={styles.qOx} onClick={() => setRows(list => list.filter((_, j) => j !== i))}><i className="fa-solid fa-xmark" /></span>
          </div>
        )) : <div className={styles.fxNone} style={{ padding: '4px 2px' }}>No detail rows — add label/value pairs shown on the item card (e.g. Range · 80/320).</div>}
      </div>
      <div className={styles.detailAdd}>
        <input className={styles.sessIn} value={rowLab} onChange={e => setRowLab(e.target.value)} placeholder="Label" />
        <input className={styles.sessIn} value={rowVal} onChange={e => setRowVal(e.target.value)} onKeyDown={e => e.key === 'Enter' && addRow()} placeholder="Value" />
        <Btn tone="ghost" sm icon="fa-plus" label="Add" onClick={addRow} />
      </div>

      <div className={styles.qActions}>
        <Btn tone="amber" lg icon="fa-floppy-disk" label={busy ? 'Saving…' : item ? 'Save Item' : 'Create Item'} onClick={() => void submit()} disabled={busy || !name.trim()} />
        {onDelete && <Btn tone="danger" lg icon="fa-trash" label="Delete" onClick={onDelete} disabled={busy} />}
      </div>
    </>
  )
}

// ============================================================
// FEATURE LIBRARY (catalog tab) + GRANT FEATURE (Actions card F)
// ============================================================
const FEAT_CATS: { key: FeatureCategory; label: string }[] = [
  { key: 'class', label: 'Class' },
  { key: 'feat', label: 'Feat' },
  { key: 'racial', label: 'Racial' },
  { key: 'background', label: 'Background' },
  { key: 'sense', label: 'Sense' },
  { key: 'other', label: 'Other' },
]
const FEAT_KINDS: { key: FeatureKind | ''; label: string }[] = [
  { key: '', label: 'Neutral' },
  { key: 'levelup', label: 'Level-Up (cyan)' },
  { key: 'equipment', label: 'Equipment (gold)' },
  { key: 'corruption', label: 'Corruption (violet)' },
]
const FEATURE_ICONS = [
  'fa-star', 'fa-bolt', 'fa-heart-pulse', 'fa-wind', 'fa-fire', 'fa-droplet',
  'fa-eye', 'fa-moon', 'fa-shield-halved', 'fa-hand-fist', 'fa-user-ninja', 'fa-paw',
  'fa-feather', 'fa-brain', 'fa-comments', 'fa-skull',
]

/** Stamp a library template into a grantable Feature copy (fresh instance id +
 *  back-ref), mirroring grantSnapshot for items. */
function featureSnapshot(row: CatalogFeatureRow): Feature {
  return {
    ...row.data,
    id: `feat-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
    feature_id: row.id,
  }
}

/** Grant Feature (card F): the DM's direct path for ROLEPLAY boons — copies a
 *  library feature onto `sheet.features` (the same field the player dossier
 *  reads; sheet spread so siblings survive), and lists what the PC currently
 *  has with a remove ✕. Item-borne features are NOT managed here — they live on
 *  their item and surface via the Gear Features group while equipped. Feats via
 *  Level-Up arrive with that overlay. */
function GrantFeatureCard({ member, row, featureLib, onUpdate, onVoice, log }: {
  member: PartyMember
  row: CharacterRow
  featureLib: CatalogFeatureRow[]
  onUpdate: (patch: CharacterUpdate) => Promise<boolean>
  onVoice: (msg: VoiceMsg) => Promise<boolean>
  log: (node: ReactNode, kind?: 'cyan' | 'danger') => void
}) {
  const [selId, setSelId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const sheet = row.sheet ?? {}
  const current = sheet.features ?? []
  const selected = featureLib.find(f => f.id === selId) ?? null
  const first = firstName(member.name)

  async function grant() {
    if (!selected) return
    setBusy(true)
    const copy = featureSnapshot(selected)
    const ok = await onUpdate({ sheet: { ...sheet, features: [...current, copy] } })
    setBusy(false)
    if (!ok) return
    void onVoice({ kind: 'feature', target: member.id, name: copy.name, icon: copy.icon })
    log(<>Granted feature <span className={styles.obj}>{copy.name}</span> to <span className={styles.who}>{first}</span></>, 'cyan')
    setSelId(null)
  }

  async function remove(id: string) {
    const gone = current.find(f => f.id === id)
    const ok = await onUpdate({ sheet: { ...sheet, features: current.filter(f => f.id !== id) } })
    if (ok && gone) log(<>Removed feature <span className={styles.obj}>{gone.name}</span> from <span className={styles.who}>{first}</span></>, 'danger')
  }

  const featTint = (k?: FeatureKind) => (k === 'equipment' ? 'cond' : k === 'corruption' ? 'corr' : 'buff')

  return (
    <div className={cx(styles.actCard, styles.wide)}>
      <span className={cx(styles.acCorner, styles.tl)} /><span className={cx(styles.acCorner, styles.br)} />
      <div className={styles.acTitle}><i className="fa-solid fa-star lead" /><span className={styles.num}>F</span><span className={styles.t}>Grant Feature</span></div>
      <div className={styles.featGrantSplit}>
        <div className={styles.fgCol}>
          <span className={styles.fieldLab}>Library · roleplay boons &amp; perks</span>
          <div className={styles.catList}>
            {featureLib.length === 0 ? (
              <div className={styles.catListEmpty}>Library is empty — author features in the Catalog's Features tab.</div>
            ) : featureLib.map(f => (
              <button key={f.id} className={cx(styles.catItem, f.id === selId && styles.sel)} onClick={() => setSelId(f.id)}>
                <span className={styles.ciIc} style={{ color: 'var(--amber)' }}><i className={`fa-solid ${f.data?.icon ?? 'fa-star'}`} /></span>
                <span className={styles.ciTx}>
                  <span className={styles.ciNm}>{f.data?.name ?? 'Untitled'}</span>
                  <span className={styles.ciTy}>{f.data?.source ?? FEAT_CATS.find(c => c.key === f.data?.category)?.label ?? 'Feature'}</span>
                </span>
                {f.data?.usage && <span className={styles.ciRar} style={{ color: 'var(--muted)' }}>{f.data.usage}</span>}
              </button>
            ))}
          </div>
          <div className={styles.grantAction}>
            <Btn tone="amber" icon="fa-arrow-right-to-bracket" label={busy ? 'Granting…' : `Grant to ${first}`} onClick={() => void grant()} disabled={!selected || busy} />
          </div>
        </div>
        <div className={styles.fgCol}>
          <span className={styles.fieldLab}>On {first}'s sheet · {current.length}</span>
          <div className={cx(styles.fxActive, styles.fgList)}>
            {current.length ? current.map(f => (
              <div key={f.id} className={cx(styles.fxLine, styles[featTint(f.kind)])}>
                <span className={styles.nm}><i className={`fa-solid ${f.icon ?? 'fa-star'}`} /> {f.name}</span>
                {f.usage && <span className={styles.du}>{f.usage}</span>}
                <span className={styles.x} onClick={() => void remove(f.id)} title="Remove feature"><i className="fa-solid fa-xmark" /></span>
              </div>
            )) : <div className={styles.fxNone}>— no features on the sheet —</div>}
          </div>
        </div>
      </div>
    </div>
  )
}

/** The Features tab of the Catalog: author-once library of feats/perks/boons.
 *  Same index+form pattern as the Items tab; grants/embeds are snapshots. */
function FeatureLibrarySurface({ lib }: { lib: DmFeaturesState }) {
  const { features, createFeature, updateFeature, deleteFeature, loading } = lib
  const [selId, setSelId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const activeId = creating ? null : (selId ?? features[0]?.id ?? null)
  const selected = features.find(f => f.id === activeId) ?? null

  async function handleSubmit(data: CatalogFeatureData) {
    if (selected) {
      await updateFeature(selected.id, { data })
    } else {
      const created = await createFeature({ data })
      if (created) { setCreating(false); setSelId(created.id) }
    }
  }
  async function handleDelete() {
    if (!selected) return
    await deleteFeature(selected.id)
    setSelId(null)
  }

  return (
    <div className={styles.catLayout}>
      <div className={styles.catIndex}>
        <div className={styles.catNew}>
          <Btn tone="cyan" icon="fa-plus" label="New Feature" onClick={() => { setCreating(true); setSelId(null) }} />
        </div>
        {FEAT_CATS.map(cat => {
          const rows = features.filter(f => (f.data?.category ?? 'other') === cat.key)
          if (!rows.length) return null
          return (
            <div key={cat.key} className={styles.catGrp}>
              <div className={styles.catGrpHead}><span className={styles.ghT}>{cat.label}</span><span className={styles.ghC}>{rows.length}</span></div>
              <div className={styles.catRows}>
                {rows.map(f => (
                  <button key={f.id} className={cx(styles.catRow, f.id === activeId && !creating && styles.sel)}
                    style={{ ['--rar' as string]: 'var(--amber)' }} onClick={() => { setCreating(false); setSelId(f.id) }}>
                    <span className={styles.crIc}><i className={`fa-solid ${f.data?.icon ?? 'fa-star'}`} /></span>
                    <span className={styles.crTx}>
                      <span className={styles.crT}>{f.data?.name ?? 'Untitled'}</span>
                      <span className={styles.crS}>{f.data?.source ?? cat.label}{f.data?.usage ? ` · ${f.data.usage}` : ''}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )
        })}
        {features.length === 0 && <div className={styles.catEmpty}>{loading ? '· loading ·' : '— library empty —'}</div>}
      </div>

      <div className={styles.catForm}>
        <FeatureForm key={activeId ?? 'new'} feature={selected} onSubmit={handleSubmit} onDelete={selected ? handleDelete : undefined} />
      </div>
    </div>
  )
}

function FeatureForm({ feature, onSubmit, onDelete }: {
  feature: CatalogFeatureRow | null
  onSubmit: (data: CatalogFeatureData) => Promise<void>
  onDelete?: () => void
}) {
  const d = feature?.data
  const [name, setName] = useState(d?.name ?? '')
  const [category, setCategory] = useState<FeatureCategory>(d?.category ?? 'other')
  const [kind, setKind] = useState<FeatureKind | ''>(d?.kind ?? 'equipment')
  const [source, setSource] = useState(d?.source ?? '')
  const [usage, setUsage] = useState(d?.usage ?? '')
  const [icon, setIcon] = useState(d?.icon ?? 'fa-star')
  const [light, setLight] = useState(d?.light_description ?? '')
  const [deep, setDeep] = useState(d?.deep_description ?? '')
  const [maxUses, setMaxUses] = useState(d?.uses?.max ?? 0)
  const [recharge, setRecharge] = useState<'short' | 'long' | ''>(d?.recharge ?? '')
  const [roll, setRoll] = useState(d?.roll ?? '')
  const [rollLabel, setRollLabel] = useState(d?.rollLabel ?? '')
  const [rollTone, setRollTone] = useState<'heal' | 'buff' | ''>(d?.rollTone ?? '')
  const [busy, setBusy] = useState(false)

  function build(): CatalogFeatureData {
    return {
      name: name.trim(), category, icon,
      ...(kind ? { kind } : {}),
      ...(source.trim() ? { source: source.trim() } : {}),
      ...(usage.trim() ? { usage: usage.trim() } : {}),
      ...(light.trim() ? { light_description: light.trim() } : {}),
      ...(deep.trim() ? { deep_description: deep.trim() } : {}),
      // Uses > 0 = a spendable counter (granted copies start full); 0 = passive.
      ...(maxUses > 0 ? { uses: { current: maxUses, max: maxUses }, ...(recharge ? { recharge } : {}) } : {}),
      ...(roll.trim() ? { roll: roll.trim(), ...(rollLabel.trim() ? { rollLabel: rollLabel.trim() } : {}), ...(rollTone ? { rollTone } : {}) } : {}),
    }
  }
  async function submit() {
    setBusy(true)
    await onSubmit(build())
    setBusy(false)
  }

  return (
    <>
      <div className={styles.catFormHead}>
        <span className={styles.cfhT}>{feature ? 'Edit Feature' : 'New Feature'}</span>
        <span className={styles.cfhId}>{feature ? feature.id : 'unsaved template'}</span>
      </div>

      <span className={styles.fieldLab}>Name</span>
      <input className={styles.sessIn} value={name} onChange={e => setName(e.target.value)} placeholder="Name the feature…" />

      <div className={styles.catGrid2}>
        <div>
          <span className={styles.fieldLab}>Category</span>
          <select className={styles.selIn} value={category} onChange={e => setCategory(e.target.value as FeatureCategory)}>
            {FEAT_CATS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </div>
        <div>
          <span className={styles.fieldLab}>Card Tint</span>
          <select className={styles.selIn} value={kind} onChange={e => setKind(e.target.value as FeatureKind | '')}>
            {FEAT_KINDS.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
          </select>
        </div>
      </div>

      <div className={styles.catGrid2}>
        <div><span className={styles.fieldLab}>Source</span><input className={styles.sessIn} value={source} onChange={e => setSource(e.target.value)} placeholder="e.g. Cloak of Elvenkind" /></div>
        <div><span className={styles.fieldLab}>Usage</span><input className={styles.sessIn} value={usage} onChange={e => setUsage(e.target.value)} placeholder="e.g. 1/short rest · passive" /></div>
      </div>

      <span className={styles.fieldLab}>Icon</span>
      <div className={styles.catIcons}>
        {FEATURE_ICONS.map(ic => (
          <button key={ic} className={cx(styles.catIc, ic === icon && styles.sel)} onClick={() => setIcon(ic)} title={ic} aria-label={ic}>
            <i className={`fa-solid ${ic}`} />
          </button>
        ))}
      </div>

      <div className={styles.qLabRow}>
        <span className={styles.fieldLab}>Card Text</span>
        <span className={cx(styles.qFacing, styles.player)}><i className="fa-solid fa-eye" /> Player-facing · **bold** *italics*</span>
      </div>
      <textarea className={styles.catProse} value={light} onChange={e => setLight(e.target.value)} placeholder="The short text on the feature card…" />

      <span className={styles.fieldLab}>Detail Text</span>
      <textarea className={styles.catProse} value={deep} onChange={e => setDeep(e.target.value)} placeholder="The fuller detail shown when the card is opened…" />

      <div className={styles.catGrid3}>
        <div><span className={styles.fieldLab}>Uses (0 = passive)</span><input className={styles.sessIn} type="number" min={0} value={maxUses} onChange={e => setMaxUses(Math.max(0, parseInt(e.target.value || '0', 10) || 0))} /></div>
        <div>
          <span className={styles.fieldLab}>Recharge</span>
          <select className={styles.selIn} value={recharge} disabled={maxUses <= 0} onChange={e => setRecharge(e.target.value as 'short' | 'long' | '')}>
            <option value="">Manual (DM)</option>
            <option value="short">Short rest</option>
            <option value="long">Long rest</option>
          </select>
        </div>
        <div><span className={styles.fieldLab}>Roll</span><input className={styles.sessIn} value={roll} onChange={e => setRoll(e.target.value)} placeholder="e.g. 1d10 + 7" /></div>
      </div>

      {roll.trim() && (
        <div className={styles.catGrid2}>
          <div><span className={styles.fieldLab}>Roll Label</span><input className={styles.sessIn} value={rollLabel} onChange={e => setRollLabel(e.target.value)} placeholder="e.g. Healing" /></div>
          <div>
            <span className={styles.fieldLab}>Roll Tone</span>
            <select className={styles.selIn} value={rollTone} onChange={e => setRollTone(e.target.value as 'heal' | 'buff' | '')}>
              <option value="">Show-only</option>
              <option value="heal">Heal (applies HP)</option>
              <option value="buff">Buff (cyan)</option>
            </select>
          </div>
        </div>
      )}

      <div className={styles.qActions}>
        <Btn tone="amber" lg icon="fa-floppy-disk" label={busy ? 'Saving…' : feature ? 'Save Feature' : 'Create Feature'} onClick={() => void submit()} disabled={busy || !name.trim()} />
        {onDelete && <Btn tone="danger" lg icon="fa-trash" label="Delete" onClick={onDelete} disabled={busy} />}
      </div>
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
  onUpdateChar: (patch: CharacterUpdate) => Promise<boolean>
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
    const jobs: Promise<unknown>[] = []
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
