import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useDmStatus, useDmParty, useDmCampaign, useDmCatalog, useDmConfiscated, useDmFeatures, useDmEffects, useDmSpells, useDmShops, type DmCampaignState, type DmCatalogState, type DmFeaturesState, type DmEffectsState, type DmSpellsState, type DmShopsState } from '../lib/dm'
import { useDmShards, type DmShardsState } from '../lib/dmShards'
import { OperatorShops } from './OperatorShops'
import { SHARD_SLOT_KEYS, ejectShard, installShard, shardAvailable, shardSpent, type ShardSlotKey } from '../lib/shards'
import { MOD_STATS, isAbility, compileEffects, type Mod } from '../lib/modEditor'
import type { GraphEffect, GraphState, ShardSlot, ShardTree, VarDef } from '../lib/database.types'
import { auditNode, characterVars } from '../lib/graph'
import { GraphEffects, VarsBlock } from '../components/GraphEffects'
import { useCatalogNodes } from '../lib/useCatalogNodes'
import { consumeArmed, scopedVars, setDmVars, type VarRow } from '../lib/graphState'
import { longRestPatch } from '../lib/rest'
import { effectiveSheet } from '../lib/effects'
import { pactSlotCount, pactSlotLevel } from '../lib/spells'
import { useGuideVoice, ALL_PARTY, type VoiceMsg, type VoiceTone } from '../lib/voice'
import { usePartyPresence } from '../lib/presence'
import { useFullscreen } from '../lib/fullscreen'
import { renderInline } from '../lib/markdown'
import type {
  CharacterRow, CharacterUpdate, CharacterSecret, CharacterSecretUpdate, HP, Json,
  QuestRow, QuestStatus, QuestType, QuestObjective, RelatedTag, SessionRow,
  CatalogItemRow, CatalogItemData, InventoryItem, ItemCategory, ItemRarity,
  ItemSlot, AbilityKey, WeaponAbility, ActiveEffect,
  Feature, FeatureCategory, FeatureKind, CatalogFeatureRow,
  EffectKind, EffectFlagMode, EffectFlag, EffectDef, CatalogEffectRow,
  EffectDuration, EffectRef,
  Spell, SpellSchool, SpellSlot, CatalogSpellRow, CatalogSpellData,
  EquippedGear, CharacterLore, Relation,
} from '../lib/database.types'
import { ITEM_SLOTS, PERSON, isRingSlot } from '../lib/equip'
import { SKILLS, ABILITY_ORDER, ABILITY_ABBR } from '../lib/dnd'
import { isStackable, place, routeItem } from '../lib/placement'
import { OperatorInventory } from './OperatorInventory'
import { normalizeTag } from '../lib/graph'
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
  effects: { name: string; kind: 'buff' | 'cond' | 'debuff'; source?: string }[]
}

function toMember(c: CharacterRow, secret: CharacterSecret | undefined, online: boolean, shardCatalog: Record<string, ShardTree>): PartyMember {
  const hp = (c.sheet?.hp?.current ?? 0) as number
  // Effective max (authored base + shard bonuses) — the overview list and
  // header must agree with what the player's Topbar shows, not just canon.
  const hpMax = effectiveSheet(c, shardCatalog).hp?.max ?? (c.sheet?.hp?.max ?? 0)
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
    effects: raw.map(e => ({ name: e.name ?? 'Effect', kind: e.kind ?? ('buff' as const), source: e.source })),
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
type CharTab = 'actions' | 'inventory' | 'lore' | 'shards'

export function OperatorConsole() {
  const { session, loading: authLoading } = useAuth()
  const { isDm, loading: dmLoading } = useDmStatus()
  const { party, secrets, loading: partyLoading, error, updateCharacter, updateSecret } = useDmParty()
  const campaign = useDmCampaign()
  const catalog = useDmCatalog()
  const featureLib = useDmFeatures()
  const effectLib = useDmEffects()
  const spellLib = useDmSpells()
  const shardLib = useDmShards()
  const shopLib = useDmShops()
  // EditorTree is a superset of ShardTree (catalog geometry + merged DM
  // secrets) — safe to feed straight into effectiveSheet()'s shardTrees arg.
  const shardCatalog = useMemo<Record<string, ShardTree>>(
    () => Object.fromEntries(shardLib.trees.map(t => [t.id, t])), [shardLib.trees])
  const confiscated = useDmConfiscated()
  const onlineIds = usePartyPresence()
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen()

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

  // Notify the DM when a party member's client connects or disconnects — matches the
  // mockup's own "<who> connection offline" log-line precedent. The presence channel
  // settles in a couple of sync events right after subscribing (an early sync or two
  // before every already-connected player shows up), so a 2.5s grace period gates
  // logging — otherwise everyone already online reads as "just joined" the instant
  // the DM opens the console.
  // ponytail: fixed grace window, not a real "initial sync complete" signal from
  // usePartyPresence — fine for a 3-4 player table, revisit if it ever misses a
  // same-second reconnect or fires early on a slow connection.
  const presenceReadyRef = useRef(false)
  const prevOnlineRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const t = setTimeout(() => { presenceReadyRef.current = true }, 2500)
    return () => clearTimeout(t)
  }, [])
  useEffect(() => {
    const prev = prevOnlineRef.current
    prevOnlineRef.current = onlineIds
    if (!presenceReadyRef.current) return
    for (const id of onlineIds) {
      if (prev.has(id)) continue
      const member = party.find(c => c.id === id)
      if (!member) continue
      log(<><span className={styles.who}>{firstName(member.name)}</span> connection <span className={styles.obj}>online</span></>, 'cyan')
    }
    for (const id of prev) {
      if (onlineIds.has(id)) continue
      const member = party.find(c => c.id === id)
      if (!member) continue
      log(<><span className={styles.who}>{firstName(member.name)}</span> connection <span className={styles.obj}>offline</span></>, 'danger')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlineIds])

  if (authLoading || dmLoading) return <Boot>Authorizing operator link…</Boot>
  if (!session) return <Navigate to="/login" replace />
  if (!isDm) return <Navigate to="/" replace />

  const members = party.map(m => toMember(m, secrets[m.id], onlineIds.has(m.id), shardCatalog))
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
          <button
            type="button" className={styles.glyphBtn} onClick={toggleFullscreen}
            title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} aria-label="Toggle fullscreen"
          >
            <i className={`fa-solid ${isFullscreen ? 'fa-compress' : 'fa-expand'}`} />
          </button>
          <div className={styles.opRootpill}><span className={styles.dot} /> Root Access Granted</div>
        </div>
      </header>

      {/* ===== CONSOLE GRID ===== */}
      <div className={styles.console}>
        {/* LEFT — ROSTER */}
        <section className={styles.region} aria-label="Party roster">
          <div className={styles.rFrame} />
          <div className={styles.rInner}>
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
                    <span className={styles.ovS}>{catalog.items.length} items · {featureLib.features.length} features · {spellLib.spells.length} spells</span>
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
                          ? p.effects.map((e, i) => (
                              <span key={i} className={cx(styles.fxDot, styles[e.kind])} title={`${e.name}${e.source ? ` · From: ${e.source}` : ''}`}><i /></span>
                            ))
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
                <div
                  className={cx(styles.wtab, charTab === 'shards' && styles.active)}
                  onClick={() => setCharTab('shards')}
                  title="Shard slots, points, reveals"
                >
                  Shards
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
                <CatalogSurface catalog={catalog} featureLib={featureLib} effectLib={effectLib} spellLib={spellLib} shopLib={shopLib} members={members} />
              ) : view === 'character' && selected && selectedRow ? (
                charTab === 'lore' ? (
                  <LoreTab key={selectedRow.id} row={selectedRow} member={selected} secret={secrets[selectedRow.id]} onUpdateSecret={patch => updateSecret(selectedRow.id, patch)} onUpdateChar={patch => updateCharacter(selectedRow.id, patch)} />
                ) : charTab === 'shards' ? (
                  <ShardsTab key={selectedRow.id} row={selectedRow} member={selected} shardLib={shardLib} onUpdate={patch => updateCharacter(selectedRow.id, patch)} onVoice={sendVoice} log={log} />
                ) : charTab === 'inventory' ? (
                  <OperatorInventory
                    key={selectedRow.id} row={selectedRow} member={selected}
                    confiscated={confiscated}
                    onUpdate={patch => updateCharacter(selectedRow.id, patch)}
                    log={log}
                  />
                ) : (
                  <ActionsTab row={selectedRow} member={selected} catalog={catalog.items} featureLib={featureLib.features} effectLib={effectLib.effects} spellLib={spellLib.spells} shardCatalog={shardCatalog} onUpdate={patch => updateCharacter(selectedRow.id, patch)} onVoice={sendVoice} log={log} />
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
                  ? p.effects.map((e, i) => (
                      <span key={i} className={cx(styles.chip, styles[e.kind])} title={e.source ? `From: ${e.source}` : undefined}>{e.name}</span>
                    ))
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
function ActionsTab({ row, member, catalog, featureLib, effectLib, spellLib, shardCatalog, onUpdate, onVoice, log }: {
  row: CharacterRow
  member: PartyMember
  catalog: CatalogItemRow[]
  featureLib: CatalogFeatureRow[]
  effectLib: CatalogEffectRow[]
  spellLib: CatalogSpellRow[]
  shardCatalog: Record<string, ShardTree>
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
  // `baseMax` is authored canon and what every write must persist; `hpMax` is
  // the effective ceiling (+ shard bonuses) used for display and clamping —
  // same split as the player Stat Panel's HitPoints widget.
  const baseMax = hp.max ?? 0
  const hpMax = effectiveSheet(row, shardCatalog).hp?.max ?? baseMax
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
    onUpdate({ sheet: { ...sheet, hp: { ...hp, current: next, max: baseMax, temp: nextTemp } } })
  const heal = () => { void writeHp(Math.min(hpMax, hpCur + hpAmt)); log(<>Healed {who} <span className={styles.obj}>+{hpAmt} HP</span></>) }
  const damage = () => { void writeHp(Math.max(0, hpCur - hpAmt)); log(<>Damaged {who} <span className={styles.obj}>−{hpAmt} HP</span></>, 'danger') }
  const setHp = () => { void writeHp(Math.max(0, Math.min(hpMax, hpAmt))); log(<>Set {who} HP to <span className={styles.obj}>{Math.max(0, Math.min(hpMax, hpAmt))}</span></>) }
  const addTemp = () => { void writeHp(hpCur, tempHp + hpAmt); log(<>Granted {who} <span className={styles.obj}>+{hpAmt} temp HP</span></>) }
  const longRest = () => { void onUpdate(longRestPatch(row, shardCatalog).patch); log(<>Applied <span className={styles.obj}>Long Rest</span> to {who}</>) }

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
        <ApplyEffectCard member={member} effectLib={effectLib} row={row} onUpdate={onUpdate} onVoice={onVoice} log={log} />

        {/* D — CURRENCY */}
        <div className={styles.actCard}>
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

        {/* G — PROFICIENCIES (wide): saving throws (binary) + skills (none →
            proficient → expertise). Character-build data, so it's DM-authored
            here rather than player-editable — see Character.tsx / lib/dnd.ts,
            which already read these three sheet arrays for the Rolls screen. */}
        <ProficienciesCard member={member} row={row} onUpdate={onUpdate} log={log} />

        {/* H — SPELLCASTING (wide): interim caster-profile editor — class,
            ability, save DC, attack bonus, prepared max, slot totals. Writes
            the SAME `spellbook` fields the player Spellbook screen reads, so
            there is exactly one owner (CLAUDE.md). Level-Up (disabled above)
            will become the primary way this gets set once it exists; this
            stays as the manual fallback. */}
        <CasterProfileCard key={row.id} member={member} row={row} onUpdate={onUpdate} log={log} />

        {/* I — GRANT SPELL: snapshot a spell_catalog template onto this PC's
            spellbook.spells, mirroring Grant Feature (F). */}
        <GrantSpellCard member={member} row={row} spellLib={spellLib} onUpdate={onUpdate} onVoice={onVoice} log={log} />

        {/* J — FEATURE STATE (wide): what the graph is holding for this PC, and
            the DM's own variable bucket — which had no writer anywhere in the
            app until this card, despite the engine reading it and migration
            0015 guarding it. */}
        <FeatureStateCard member={member} row={row} shardCatalog={shardCatalog} onUpdate={onUpdate} log={log} />
      </div>

    </>
  )
}

// ============================================================
// FEATURE STATE (Actions card J) — §8 #4 + §31's DM bucket
// ============================================================

/** What the feature graph is holding for this character, and the one bucket the
 *  DM owns.
 *
 *  THE SHAPE IS THE PERMISSION (§31). Player variables read out; DM variables
 *  edit. Postgres RLS is row-level and cannot allow writing
 *  `resources.graph.vars` while refusing `…dmVars`, so which bucket a value
 *  lives in is who may write it — and migration 0015's trigger enforces that
 *  from the other side. A card that let the DM edit both would make the split
 *  invisible exactly where it is being explained.
 *
 *  Live with no extra wiring: lib/dm.ts subscribes to postgres_changes on
 *  `characters`, so a player toggling Rage lands here within a round trip. */
function FeatureStateCard({ member, row, shardCatalog, onUpdate, log }: {
  member: PartyMember
  row: CharacterRow
  shardCatalog: Record<string, ShardTree>
  onUpdate: (patch: CharacterUpdate) => Promise<boolean>
  log: (node: ReactNode, kind?: 'cyan' | 'danger') => void
}) {
  const first = firstName(member.name)
  const playerState = scopedVars(row, 'player', shardCatalog)
  const dmState = scopedVars(row, 'dm', shardCatalog)
  const armed = ((row.resources as { graph?: GraphState } | undefined)?.graph?.armed) ?? []
  // The collisions §30 promises land here: deterministic and loud, so the DM
  // sees the clash the session it happens rather than a value quietly winning.
  const collisions = characterVars(row, shardCatalog).audit.filter(a => a.sev === 'err')

  const nothing = !playerState.length && !dmState.length && !armed.length && !collisions.length

  async function writeDm(name: string, value: number | boolean, label: string) {
    const ok = await onUpdate({ resources: setDmVars(row, { [name]: value }) as CharacterRow['resources'] })
    if (ok) log(<>Set <b>{label}</b> to <b>{String(value)}</b> on {first}</>)
  }

  async function disarm(id: string, label: string) {
    // The DM's remove and the player's consume are the same operation.
    const ok = await onUpdate({ resources: consumeArmed(row, id) as CharacterRow['resources'] })
    if (ok) log(<>Cleared armed <b>{label}</b> from {first}</>, 'danger')
  }

  return (
    <div className={cx(styles.actCard, styles.wide)}>
      <div className={styles.acTitle}><i className="fa-solid fa-diagram-project lead" /><span className={styles.num}>J</span><span className={styles.t}>Feature State</span></div>

      {collisions.map(a => (
        <div key={a.id ?? a.t} className={styles.skWarn}>
          <i className="fa-solid fa-triangle-exclamation" /> <b>{a.t}</b> — {a.s}
        </div>
      ))}

      {nothing && (
        <div className={styles.profRow}>
          <span className={styles.profLab}>Nothing authored</span>
          <span className={styles.dvSrc}>No feature on {first} declares a variable yet.</span>
        </div>
      )}

      {playerState.length > 0 && (
        <div className={styles.profRow}>
          <span className={styles.profLab}>Player State</span>
          <div className={styles.profGrid}>
            {playerState.map(v => (
              <span key={v.def.name} className={cx(styles.profChip, v.value !== false && v.value !== 0 && styles.on)}
                title={`${v.def.name} · from ${v.from.obj.name} · theirs to change`}>
                {v.def.label ?? v.def.name}
                <span className={styles.ab}>{typeof v.value === 'boolean' ? (v.value ? 'on' : 'off') : v.value}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {dmState.length > 0 && (
        <div className={styles.profRow}>
          <span className={styles.profLab}>DM Variables</span>
          <div className={styles.dmVarList}>
            {dmState.map(v => <DmVarRow key={v.def.name} v={v} onWrite={writeDm} />)}
          </div>
        </div>
      )}

      {armed.length > 0 && (
        <div className={styles.profRow}>
          <span className={styles.profLab}>Armed</span>
          <div className={styles.dmVarList}>
            {armed.map(m => (
              <div key={m.id} className={styles.dmVarRow}>
                <span className={styles.dvName}>{m.label}</span>
                <span className={styles.dvSrc}>
                  {m.sourceName ? `${m.sourceName} · ` : ''}
                  next {m.sub ? `${m.kind} ${m.sub}` : m.kind}{m.value ? ` · ${m.value}` : ''}
                </span>
                <Btn tone="danger" sm icon="fa-xmark" label="Clear" onClick={() => void disarm(m.id, m.label)} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** One DM variable. A bool is a switch; a number is an input that writes when it
 *  SETTLES — the console's realtime channel fans every write out to every
 *  connected client, so a stepper firing per keystroke is not free. */
function DmVarRow({ v, onWrite }: {
  v: VarRow
  onWrite: (name: string, value: number | boolean, label: string) => Promise<void>
}) {
  const label = v.def.label ?? v.def.name
  const [local, setLocal] = useState<number | null>(null)
  const timer = useRef<number>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  if (v.def.type === 'bool') {
    const on = v.value === true
    return (
      <div className={cx(styles.catTog, on && styles.on)} onClick={() => void onWrite(v.def.name, !on, label)}
        role="switch" aria-checked={on}>
        <span className={styles.tgSw} />
        <span className={styles.tgLab}>
          <span className={styles.t}>{label}</span>
          <span className={styles.s}>{v.def.name} · from {v.from.obj.name} · DM-only</span>
        </span>
      </div>
    )
  }

  const shown = local ?? (typeof v.value === 'number' ? v.value : 0)
  const set = (n: number) => {
    setLocal(n)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => { setLocal(null); void onWrite(v.def.name, n, label) }, 450)
  }
  return (
    <div className={styles.dmVarRow}>
      <span className={styles.dvName}>{label}</span>
      <span className={styles.dvSrc}>{v.def.name} · from {v.from.obj.name}</span>
      <div className={styles.stepper}>
        <input className={styles.numIn} type="number" value={shown}
          onChange={e => set(parseInt(e.target.value || '0', 10) || 0)} />
      </div>
    </div>
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
/** Ring I and Ring II are mechanically identical (lib/equip.ts isRingSlot) —
 *  the catalog offers ONE "Ring" choice rather than making the DM pre-commit
 *  an item to a specific finger. Equip-time resolution picks whichever ring
 *  slot is actually free. */
const SLOT_OPTIONS: readonly ItemSlot[] = GEAR_SLOTS.filter(s => s !== 'ring2')
const SLOT_LABEL: Record<ItemSlot, string> = {
  helmet: 'Helmet', armor: 'Armor', cloak: 'Cloak', boots: 'Boots',
  gloves: 'Gloves', neck: 'Neck', ring1: 'Ring', ring2: 'Ring',
}
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
 *  snapshot of the template `data` + a unique instance id + the `item_id`
 *  back-ref, routed to its destination. Stackable categories carry `qty`;
 *  everything else is always exactly one unit. */
function grantSnapshot(
  item: CatalogItemRow, qty: number, gear: EquippedGear, inventory: InventoryItem[],
): InventoryItem {
  const inst = `inst-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`
  const data = item.data ?? ({} as CatalogItemData)
  const fresh = {
    ...data, id: inst, item_id: item.id,
    containerId: PERSON,
    ...(isStackable(data.category) ? { qty } : {}),
  } as InventoryItem
  // Granted items go through the SAME routing chain as anything else picked up:
  // arrows fall into the quiver, everything else takes the first free cell on
  // person and overflows to a bag. This is what retired the grant-destination
  // picker — the DM never has to choose a container.
  return { ...place(fresh, routeItem(fresh, gear, inventory)), isNew: true }
}

/** Grant `qty` copies of a catalog template in ONE inventory write. Stackable
 *  categories merge into a matching stack already sitting in the routed
 *  destination — same name, same category, same container, not locked —
 *  instead of adding a second row: granting 20 arrows into a quiver that
 *  already holds 12 produces one "Arrows ×32" stack. Gear and weapons are
 *  always distinct instances: qty copies route one at a time (routing sees
 *  each previous copy already placed), the same result as clicking Grant qty
 *  times, just one DB write instead of qty round trips. */
/** The numeric capacity of the equipped container with this id, or null for
 *  an uncapped one (bag of holding, backpack) — mirrors the lookup routeItem
 *  does internally, needed here to know how many units still fit before a
 *  merge would silently push a capped container (a quiver) over its cap. */
function containerCapacity(gear: EquippedGear, containerId: string): number | null {
  for (const c of Object.values(gear.containers ?? {})) {
    if (c?.id === containerId) return c.container?.capacity ?? null
  }
  return null
}

function grantSnapshots(
  item: CatalogItemRow, qty: number, gear: EquippedGear, inventory: InventoryItem[],
): InventoryItem[] {
  const data = item.data ?? ({} as CatalogItemData)
  if (!isStackable(data.category)) {
    let next = inventory
    for (let i = 0; i < qty; i++) next = [...next, grantSnapshot(item, 1, gear, next)]
    return next
  }
  // Route and merge in BATCHES per destination, not per unit — a batch that
  // fills a capped container (the quiver) short of the full qty falls
  // through to the next chain step for the remainder, exactly like N solo
  // grants would, but in as many iterations as there are destinations
  // (typically 1, at most a handful), never qty of them.
  let next = inventory
  let remaining = qty
  while (remaining > 0) {
    const probe = grantSnapshot(item, remaining, gear, next)
    const dest = probe.containerId
    const cap = containerCapacity(gear, dest)
    const already = cap != null ? next.filter(i => i.containerId === dest).reduce((n, i) => n + (i.qty ?? 1), 0) : 0
    const take = cap != null ? Math.max(1, Math.min(remaining, cap - already)) : remaining
    const existing = next.find(i =>
      i.containerId === dest && i.name === probe.name && i.category === probe.category && !i.locked)
    next = existing
      ? next.map(i => (i === existing ? { ...i, qty: (i.qty ?? 1) + take, isNew: true } : i))
      : [...next, { ...probe, qty: take }]
    remaining -= take
  }
  return next
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
  const [qty, setQty] = useState(1)
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
    const ok = await onUpdate({ inventory: grantSnapshots(selected, qty, gear, inv) as unknown as Json[] })
    setBusy(false)
    if (!ok) return
    const d = selected.data
    const name = d?.name ?? 'Item'
    // One toast/log line per grant action, not per copy — a stack of 10
    // wouldn't need 10 separate ITEM ACQUIRED pings on the player's screen.
    void onVoice({ kind: 'item', target: member.id, name: qty > 1 ? `${name} ×${qty}` : name, icon: d?.icon, rarity: d?.rarity })
    log(<>Granted <span className={styles.obj}>{qty > 1 ? `${name} ×${qty}` : name}</span> to <span className={styles.who}>{firstName(member.name)}</span></>, 'cyan')
    setFlash(`Granted ${qty > 1 ? `×${qty} ` : ''}${name}`)
    setSelId(null)
    setQty(1)
    setTimeout(() => setFlash(''), 2400)
  }

  return (
    <div className={styles.actCard}>
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
        <input
          className={cx(styles.numIn, styles.grantQty)} type="number" min={1} max={99}
          value={qty} onChange={e => setQty(Math.max(1, Math.min(99, parseInt(e.target.value, 10) || 1)))}
          aria-label="Quantity to grant"
        />
        <Btn tone="amber" icon="fa-arrow-right-to-bracket"
          label={flash || (busy ? 'Granting…' : qty > 1 ? `Grant ×${qty} to ${firstName(member.name)}` : `Grant to ${firstName(member.name)}`)}
          onClick={() => void grant()} disabled={!selected || busy} />
      </div>
    </div>
  )
}

const DUR_UNITS = ['round', 'minute', 'hour', 'day'] as const
/** ActiveEffect.kind predates the effect library and spells 'condition' as
 *  'cond'. Bridges the two vocabularies at the one point they meet. */
const EFFECT_KIND_TO_ACTIVE: Record<'buff' | 'debuff' | 'condition', 'buff' | 'cond' | 'debuff'> = { buff: 'buff', debuff: 'debuff', condition: 'cond' }

/** Apply Effect (card C): push a status onto the PC's `resources.activeEffects` —
 *  the SAME field the player's potion-drinking writes and the effects tray reads,
 *  so the DM's push shows up in the tray, layers into the effective sheet, clears
 *  on rest, and the player can shrug it off manually (all existing behavior). */
function ApplyEffectCard({ member, effectLib, row, onUpdate, onVoice, log }: {
  member: PartyMember
  effectLib: CatalogEffectRow[]
  row: CharacterRow
  onUpdate: (patch: CharacterUpdate) => Promise<boolean>
  onVoice: (msg: VoiceMsg) => Promise<boolean>
  log: (node: ReactNode, kind?: 'cyan' | 'danger') => void
}) {
  const [query, setQuery] = useState('')
  const [effId, setEffId] = useState<string | null>(null)
  // Duration = amount × unit, or the until-rest override (rests clear effects
  // anyway, so "until rest" is the natural upper bound).
  const [durN, setDurN] = useState(1)
  const [durUnit, setDurUnit] = useState<typeof DUR_UNITS[number]>('round')
  const [untilRest, setUntilRest] = useState(false)
  const [busy, setBusy] = useState(false)
  const dur = untilRest ? 'until rest' : `${durN} ${durUnit}${durN === 1 ? '' : 's'}`

  const q = query.trim().toLowerCase()
  const list = q
    ? effectLib.filter(e => (e.data?.name ?? '').toLowerCase().includes(q) || (e.data?.tags ?? []).some(t => t.includes(q)))
    : effectLib
  const selected = effectLib.find(e => e.id === effId) ?? null

  const resources = row.resources ?? {}
  const active = (resources.activeEffects as ActiveEffect[] | undefined) ?? []
  const first = firstName(member.name)

  async function apply() {
    if (!selected) return
    const d = selected.data
    setBusy(true)
    // Modifiers compile into the same ItemEffects the engine already reads
    // (compileEffects, mirrors the item form's Effects Granted). Flags are
    // never numeric, so they surface as note text alongside the duration —
    // a pure-prose effect falls back to a clipped description.
    const noteParts = [dur, ...d.flags.map(flagText), d.mods.length === 0 && d.flags.length === 0 ? clipTx(d.desc, 60) : undefined]
    const eff: ActiveEffect = {
      id: crypto.randomUUID(), name: d.name, icon: d.icon, kind: EFFECT_KIND_TO_ACTIVE[d.kind],
      effects: compileEffects(d.mods) ?? {}, source: 'G.U.I.D.E. Operator',
      note: noteParts.filter(Boolean).join(' · '),
      // Full description, snapshotted — the player never reads the effect
      // catalog, so this is the one copy their Effects panel tooltip has.
      desc: d.desc.trim() || undefined, at: Date.now(),
    }
    const ok = await onUpdate({ resources: { ...resources, activeEffects: [...active, eff] } as CharacterRow['resources'] })
    setBusy(false)
    if (!ok) return
    void onVoice({ kind: 'effect', target: member.id, name: d.name, dur, fxKind: EFFECT_KIND_TO_ACTIVE[d.kind] })
    log(<>Applied <span className={styles.obj}>{d.name}</span> to <span className={styles.who}>{first}</span></>, d.kind === 'buff' ? 'cyan' : 'danger')
    setEffId(null)
    setQuery('')
  }

  async function remove(id: string) {
    const gone = active.find(e => e.id === id)
    const ok = await onUpdate({ resources: { ...resources, activeEffects: active.filter(e => e.id !== id) } as CharacterRow['resources'] })
    if (ok && gone) log(<>Cleared <span className={styles.obj}>{gone.name}</span> from <span className={styles.who}>{first}</span></>)
  }

  return (
    <div className={styles.actCard}>
      <div className={styles.acTitle}><i className="fa-solid fa-wand-sparkles lead" /><span className={styles.num}>C</span><span className={styles.t}>Apply Effect</span></div>

      <div className={styles.searchWrap}>
        <i className="fa-solid fa-magnifying-glass" />
        <input className={styles.searchIn} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search effects by name or tag…" />
      </div>
      <div className={styles.catList}>
        {effectLib.length === 0 ? (
          <div className={styles.catListEmpty}>Library is empty — author effects in the Catalog's Effects tab.</div>
        ) : list.length === 0 ? (
          <div className={styles.catListEmpty}>No effects match.</div>
        ) : list.map(e => {
          const K = EFFECT_KINDS[e.data?.kind ?? 'buff']
          const parts = effectParts(e.data ?? { mods: [], flags: [] })
          return (
            <button key={e.id} className={cx(styles.catItem, e.id === effId && styles.sel)} onClick={() => setEffId(e.id)}>
              <span className={styles.ciIc} style={{ color: K.color }}><i className={`fa-solid ${e.data?.icon ?? 'fa-bolt'}`} /></span>
              <span className={styles.ciTx}>
                <span className={styles.ciNm}>{e.data?.name ?? 'Untitled'}</span>
                <span className={styles.ciTy}>{parts.length ? parts.join(' · ') : 'prose only'}</span>
              </span>
              <span className={styles.ciRar} style={{ color: K.color }}>{K.label}</span>
            </button>
          )
        })}
      </div>

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
        <Btn tone="amber" icon="fa-bolt" label={busy ? 'Applying…' : selected ? `Apply ${selected.data?.name ?? 'Effect'}` : 'Apply Effect'} onClick={() => void apply()} disabled={busy || !selected} />
      </div>

      <div className={styles.fxActive}>
        <div className={styles.faHead}>Active on {first}</div>
        {active.length ? active.map(e => (
          <div key={e.id} className={cx(styles.fxLine, styles[e.kind ?? 'buff'])}>
            <span className={styles.nm}>
              {e.name}
              {e.source && <span className={styles.src}>From: {e.source}</span>}
            </span>
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
      <>Pushed {tone === 'corrupted' ? <span style={{ color: 'var(--amber-hot)' }}>corrupted </span> : null}notice <span className={styles.obj}>"{msg}"</span> to <span className={styles.who}>{effTarget ? firstName(effTarget.name) : 'All Party'}</span></>,
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

/** Catalog Manager: the DM's item-authoring library. Left = index grouped by
 *  category; right = the item form. Spells / Features / Shards are their own future
 *  catalogs, shown as inert "soon" tabs to reserve their place (matches the mockup).
 *  Items are stored in the app's structured shape (NOT the mockup's string effects)
 *  so a granted copy is mechanically real the instant it lands. */
function CatalogSurface({ catalog, featureLib, effectLib, spellLib, shopLib, members }: {
  catalog: DmCatalogState; featureLib: DmFeaturesState; effectLib: DmEffectsState; spellLib: DmSpellsState; shopLib: DmShopsState; members: PartyMember[]
}) {
  const { items, createItem, updateItem, deleteItem, loading, error } = catalog
  const nav = useNavigate()
  const [tab, setTab] = useState<'items' | 'features' | 'spells' | 'effects' | 'shops'>('items')
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
    { key: 'spells', label: 'Spells', icon: 'fa-wand-sparkles', n: spellLib.spells.length, soon: false },
    { key: 'effects', label: 'Effects', icon: 'fa-bolt', n: effectLib.effects.length, soon: false },
    { key: 'shops', label: 'Shopkeepers', icon: 'fa-shop', n: shopLib.shops.length, soon: false },
    { key: 'shards', label: 'Shards', icon: 'fa-gem', soon: false },
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
            onClick={() => { if (t.soon) return; if (t.key === 'shards') nav('/dm/shards'); else if (t.key === 'features') nav('/dm/features'); else setTab(t.key as 'items' | 'features' | 'spells' | 'effects' | 'shops') }}>
            <i className={`fa-solid ${t.icon}`} />{t.label}
            {t.n != null && <span className={styles.ctC}>{t.n}</span>}
          </button>
        ))}
      </div>

      {(tab === 'features' ? featureLib.error : tab === 'spells' ? spellLib.error : tab === 'effects' ? effectLib.error : tab === 'shops' ? shopLib.error : error) ? (
        <div className={styles.soonPanel}>
          <i className="fa-solid fa-triangle-exclamation" /><span className={styles.big}>Link Error</span>
          <span>{tab === 'features' ? featureLib.error : tab === 'spells' ? spellLib.error : tab === 'effects' ? effectLib.error : tab === 'shops' ? shopLib.error : error}</span>
        </div>
      ) : tab === 'spells' ? (
        <SpellLibrarySurface lib={spellLib} />
      ) : tab === 'effects' ? (
        <EffectLibrarySurface lib={effectLib} />
      ) : tab === 'shops' ? (
        <OperatorShops shopLib={shopLib} itemCatalog={items} members={members} />
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
            <CatalogForm key={activeId ?? 'new'} item={selected} featureLib={featureLib.features} effectLib={effectLib.effects} onSubmit={handleSubmit} onDelete={selected ? handleDelete : undefined} />
          </div>
        </div>
      )}
    </>
  )
}

function CatalogForm({ item, featureLib, effectLib, onSubmit, onDelete }: {
  item: CatalogItemRow | null
  featureLib: CatalogFeatureRow[]
  effectLib: CatalogEffectRow[]
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
  const [valueUnit, setValueUnit] = useState<'gp' | 'sp' | 'cp'>(d?.valueUnit ?? 'gp')
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
  const [effectRefs, setEffectRefs] = useState<EffectRef[]>(d?.effectRefs ?? [])
  const [fxOpen, setFxOpen] = useState(false)
  const [fxQuery, setFxQuery] = useState('')
  const [feats, setFeats] = useState<Feature[]>(d?.features ?? [])
  const [rows, setRows] = useState<[string, string][]>(d?.rows ?? [])
  const [rowLab, setRowLab] = useState('')
  const [rowVal, setRowVal] = useState('')
  const [busy, setBusy] = useState(false)

  const rd = RAR_DEF[rarity]
  const def = CAT_DEF[category]

  // Effects Granted picker pool — every library effect not already referenced,
  // filtered over name + tags, capped at 5 (mirrors the shop stock picker).
  const fxQ = fxQuery.trim().toLowerCase()
  const fxPool = effectLib
    .filter(e => !effectRefs.some(r => r.effectId === e.id))
    .filter(e => !fxQ || (e.data.name + ' ' + (e.data.tags ?? []).join(' ')).toLowerCase().includes(fxQ))
  const fxShown = fxPool.slice(0, 5)

  function build(): CatalogItemData {
    const weightNum = parseFloat(weight)
    const valueNum = parseInt(value, 10)
    const data: CatalogItemData = {
      name: name.trim(), category, rarity, icon, w, h,
      ...(Number.isFinite(weightNum) ? { weight: weightNum } : {}),
      ...(Number.isFinite(valueNum) ? { value: valueNum, valueUnit } : {}),
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
    // effectRefs is the authored source; `effects` is a COMPILED CACHE recomputed
    // here on every save so the equip/grant engine keeps reading plain
    // ItemEffects with no changes (see EffectRef's doc comment).
    const referencedMods = effectRefs.flatMap(r => effectLib.find(e => e.id === r.effectId)?.data.mods ?? [])
    const effects = compileEffects(referencedMods)
    if (effects) data.effects = effects
    if (effectRefs.length) data.effectRefs = effectRefs
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
        <div>
          <span className={styles.fieldLab}>Value</span>
          <div className={styles.catDim}>
            <input className={styles.sessIn} type="number" min={0} value={value} onChange={e => setValue(e.target.value)} placeholder="0" />
            <select className={styles.selIn} value={valueUnit} onChange={e => setValueUnit(e.target.value as 'gp' | 'sp' | 'cp')}>
              <option value="gp">gp</option>
              <option value="sp">sp</option>
              <option value="cp">cp</option>
            </select>
          </div>
        </div>
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

      <div
        className={cx(styles.catTog, isContainer && styles.on)}
        onClick={() => setIsContainer(v => !v)}
        role="switch" aria-checked={isContainer}
      >
        <span className={styles.tgSw} />
        <span className={styles.tgLab}>
          <span className={styles.t}>This Item Is A Container</span>
          <span className={styles.s}>Holds other items — gets a tab or a carry row</span>
        </span>
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
            <div
              className={cx(styles.catTog, styles.ctrTog, ctrWeightless && styles.on)}
              onClick={() => setCtrWeightless(v => !v)}
              role="switch" aria-checked={ctrWeightless}
            >
              <span className={styles.tgSw} />
              <span className={styles.tgLab}>
                <span className={styles.t}>Weightless</span>
                <span className={styles.s}>Contents excluded from Burden (the bag itself still weighs)</span>
              </span>
            </div>
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
          <select
            className={cx(styles.selIn, styles.slotSel)}
            value={isRingSlot(slot) ? 'ring1' : slot}
            onChange={e => setSlot(e.target.value as ItemSlot)}
          >
            {SLOT_OPTIONS.map(s => <option key={s} value={s}>{SLOT_LABEL[s]}</option>)}
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

      {/* effects granted — reference picker into the effect library. Each
          reference carries its own duration; the item's own `effects` field is
          recompiled from the referenced mods on save (build(), above) so the
          equip/grant engine keeps reading plain ItemEffects unchanged. */}
      <div className={cx(styles.catFx, styles.fold, fxOpen && styles.open)}>
        <div className={styles.fxfHead} onClick={() => setFxOpen(o => !o)} role="button" tabIndex={0} aria-expanded={fxOpen}>
          <span className={styles.car}><i className="fa-solid fa-caret-right" /></span>
          <i className="fa-solid fa-flask-vial" style={{ color: 'var(--amber-hot)', fontSize: 11 }} />
          <span className={styles.t}>Effects Granted</span>
          <span className={styles.s}>
            {effectRefs.length
              ? `${effectRefs.length} referenced · ${clipTx(effectRefs.map(r => effectLib.find(e => e.id === r.effectId)?.data.name).filter(Boolean).join(', '), 42)}`
              : 'none · references the effect library'}
          </span>
        </div>
        {fxOpen && (
          <>
            <div className={styles.efRefs}>
              {effectRefs.length ? effectRefs.map((r, i) => {
                const eff = effectLib.find(e => e.id === r.effectId)
                if (!eff) return null
                const K = EFFECT_KINDS[eff.data.kind]
                const parts = effectParts(eff.data)
                const counted = EF_COUNTED.includes(r.dur)
                const ticks = EF_TICKING.includes(r.dur)
                const patchRef = (p: Partial<EffectRef>) => setEffectRefs(list => list.map((x, j) => (j === i ? { ...x, ...p } : x)))
                return (
                  <div key={i} className={styles.efRefRow} style={{ ['--k' as string]: K.color }}>
                    <div className={styles.efRefTop}>
                      <span className={styles.ic}><i className={`fa-solid ${eff.data.icon}`} /></span>
                      <span className={styles.nm}>{eff.data.name}</span>
                      <span className={styles.efBadge} style={{ ['--k' as string]: K.color }}>{K.label}</span>
                      <span className={styles.x} onClick={() => setEffectRefs(list => list.filter((_, j) => j !== i))}><i className="fa-solid fa-xmark" /></span>
                    </div>
                    {parts.length ? (
                      <div className={styles.efRefSum}>{parts.map((p, pi) => <span key={pi}>{p}</span>)}</div>
                    ) : (
                      <div className={cx(styles.efRefSum, styles.prose)}>{renderInline(clipTx(eff.data.desc, 180))}</div>
                    )}
                    <div className={styles.efRefDur}>
                      <span className={styles.dl}>Duration</span>
                      {counted && (
                        <input className={cx(styles.sessIn, styles.num)} type="number" min={1} value={r.amount ?? 1}
                          onChange={e => patchRef({ amount: Math.max(1, parseInt(e.target.value, 10) || 1) })} />
                      )}
                      <select className={styles.selIn} value={r.dur} onChange={e => {
                        const dur = e.target.value as EffectDuration
                        const needsAmount = EF_COUNTED.includes(dur) && !r.amount
                        patchRef({ dur, ...(needsAmount ? { amount: dur === 'Rounds' ? 3 : 10 } : {}) })
                      }}>
                        {EF_DURATIONS.map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                      <span className={cx(styles.tick, ticks && styles.on)}>{ticks ? 'ticks down' : 'cleared by hand'}</span>
                    </div>
                  </div>
                )
              }) : <div className={styles.catFxNone}>No effects referenced — search the library below. Each line carries its own duration, because duration belongs to whoever applies it.</div>}
            </div>
            <div className={styles.efPick}>
              <div className={styles.searchWrap}>
                <i className="fa-solid fa-magnifying-glass" />
                <input className={styles.searchIn} value={fxQuery} onChange={e => setFxQuery(e.target.value)} placeholder="Search effects by name or tag…" />
              </div>
              <div className={styles.skPicklist}>
                {!fxPool.length ? (
                  <div className={styles.catFxNone}>{fxQ ? `No effect matches "${fxQuery.trim()}".` : 'Every effect in the library is already referenced.'}</div>
                ) : (
                  <>
                    {fxShown.map(e => {
                      const K = EFFECT_KINDS[e.data.kind]
                      const parts = effectParts(e.data)
                      return (
                        <button key={e.id} className={styles.skPi} style={{ ['--rar' as string]: K.color }} onClick={() => {
                          setEffectRefs(list => [...list, category === 'consumable'
                            ? { effectId: e.id, dur: 'Minutes', amount: 10 }
                            : { effectId: e.id, dur: 'Permanent while equipped', amount: 1 }])
                          setFxQuery('')
                        }}>
                          <span className={styles.piIc}><i className={`fa-solid ${e.data.icon}`} /></span>
                          <span className={styles.piT}>{e.data.name}</span>
                          <span className={styles.piM}>{parts.length ? parts.join(' · ') : 'prose only'}</span>
                          <span className={styles.piV}>{K.label}</span>
                        </button>
                      )
                    })}
                    {fxPool.length > fxShown.length && <div className={styles.catFxNone}>{fxPool.length - fxShown.length} more — keep typing to narrow.</div>}
                  </>
                )}
              </div>
            </div>
          </>
        )}
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

/** Grant Feature (Actions card F) writes immediately per click, same as every
 *  other card on this tab — Proficiencies (G) follows suit rather than
 *  introducing a dirty/Save form for what's just two fixed toggle sets.
 *  Skills cycle none → proficient → expertise → none in one click; saves are
 *  a plain on/off. Both write straight to `sheet`, spread so siblings (hp,
 *  abilities, …) survive — lib/dnd.ts's saveTotal/skillTotal already read
 *  these three arrays, so nothing downstream needs to change. */
function ProficienciesCard({ member, row, onUpdate, log }: {
  member: PartyMember
  row: CharacterRow
  onUpdate: (patch: CharacterUpdate) => Promise<boolean>
  log: (node: ReactNode, kind?: 'cyan' | 'danger') => void
}) {
  const sheet = row.sheet ?? {}
  const saveProfs = sheet.saveProficiencies ?? []
  const skillProfs = sheet.skillProficiencies ?? []
  const skillExp = sheet.skillExpertise ?? []
  const first = firstName(member.name)

  async function toggleSave(key: AbilityKey) {
    const granting = !saveProfs.includes(key)
    const next = granting ? [...saveProfs, key] : saveProfs.filter(k => k !== key)
    const ok = await onUpdate({ sheet: { ...sheet, saveProficiencies: next } })
    if (ok) log(<>{granting ? 'Granted' : 'Removed'} <span className={styles.obj}>{ABILITY_ABBR[key].toUpperCase()} save proficiency</span> for <span className={styles.who}>{first}</span></>)
  }

  async function cycleSkill(key: string, label: string) {
    const isExp = skillExp.includes(key)
    const isProf = skillProfs.includes(key)
    const [nextProf, nextExp, stateLabel] =
      !isProf && !isExp ? [[...skillProfs, key], skillExp, 'proficient']
      : isProf && !isExp ? [skillProfs, [...skillExp, key], 'expertise']
      : [skillProfs.filter(k => k !== key), skillExp.filter(k => k !== key), 'untrained']
    const ok = await onUpdate({ sheet: { ...sheet, skillProficiencies: nextProf, skillExpertise: nextExp } })
    if (ok) log(<>Set <span className={styles.obj}>{label}</span> to <span className={styles.obj}>{stateLabel}</span> for <span className={styles.who}>{first}</span></>)
  }

  return (
    <div className={cx(styles.actCard, styles.wide)}>
      <div className={styles.acTitle}><i className="fa-solid fa-graduation-cap lead" /><span className={styles.num}>G</span><span className={styles.t}>Proficiencies</span></div>

      <div className={styles.profRow}>
        <span className={styles.profLab}>Saving Throws</span>
        <div className={styles.profGrid}>
          {ABILITY_ORDER.map(key => {
            const on = saveProfs.includes(key)
            return (
              <button
                key={key} type="button"
                className={cx(styles.profChip, on && styles.on)}
                onClick={() => void toggleSave(key)}
                aria-pressed={on}
              >
                {on && <span className={styles.profDots}><span className={styles.profDot} /></span>}
                {ABILITY_ABBR[key].toUpperCase()}
              </button>
            )
          })}
        </div>
      </div>

      <div className={styles.profRow}>
        <span className={styles.profLab}>Skills · click cycles none → proficient → expertise</span>
        <div className={styles.profGrid}>
          {SKILLS.map(skill => {
            const isExp = skillExp.includes(skill.key)
            const isProf = skillProfs.includes(skill.key)
            return (
              <button
                key={skill.key} type="button"
                className={cx(styles.profChip, isProf && styles.on, isExp && styles.exp)}
                onClick={() => void cycleSkill(skill.key, skill.name)}
                title={isExp ? 'Expertise (×2 proficiency) — click to clear' : isProf ? 'Proficient — click for expertise' : 'Click to grant proficiency'}
              >
                {isProf && (
                  <span className={styles.profDots}>
                    <span className={styles.profDot} />
                    {isExp && <span className={styles.profDot} />}
                  </span>
                )}
                {skill.name} <span className={styles.ab}>{ABILITY_ABBR[skill.ability].toUpperCase()}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/* The Features tab now navigates to /dm/features — the standalone Feature
   Editor. FeatureLibrarySurface + FeatureForm lived here and were deleted with
   it: that form could only author prose, and rebuilt `data` field-by-field on
   every save, so it silently dropped `vars`, `tags` and `graph` — the exact
   fields the graph engine reads. */

// ============================================================
// EFFECT LIBRARY (Catalog · Effects tab) — the single source for what an
// effect IS. Referenced by items (Effects Granted, below); a spell/feature/
// console consumer is future work (see the plan's §5). An effect DEFINITION
// is three things, kept visually distinct on purpose: MODIFIERS (amber,
// numeric, `Mod[]` — the same shape lib/modEditor.ts already compiles into
// ItemEffects), FLAGS (cyan, never numeric), DESCRIPTION (beige, prose).
// Duration is deliberately absent — the applier owns it (EffectRef).
// ============================================================
const EFFECT_KIND_ORDER: EffectKind[] = ['buff', 'debuff', 'condition']
/** Colour deviates from the mockup (which ties debuff AND condition to the
 *  same red) to match the vocabulary the rest of the app already uses for
 *  ActiveEffect.kind — "cyan buff, amber condition, red debuff"
 *  (database.types.ts) — and the roster chips already fixed to that scheme. */
const EFFECT_KINDS: Record<EffectKind, { label: string; icon: string; color: string }> = {
  buff: { label: 'Buff', icon: 'fa-arrow-up-right-dots', color: 'var(--cyan)' },
  debuff: { label: 'Debuff', icon: 'fa-arrow-down-short-wide', color: 'var(--danger)' },
  condition: { label: 'Condition', icon: 'fa-triangle-exclamation', color: 'var(--amber)' },
}
const EF_FLAG_ORDER: EffectFlagMode[] = ['advantage', 'disadvantage', 'resistance', 'vulnerability', 'immunity']
const EF_FLAG_MODES: Record<EffectFlagMode, { label: string; short: string; on: 'roll' | 'dmg' }> = {
  advantage: { label: 'Advantage on', short: 'advantage', on: 'roll' },
  disadvantage: { label: 'Disadvantage on', short: 'disadvantage', on: 'roll' },
  resistance: { label: 'Resistance to', short: 'resistance', on: 'dmg' },
  vulnerability: { label: 'Vulnerability to', short: 'vulnerability', on: 'dmg' },
  immunity: { label: 'Immunity to', short: 'immunity', on: 'dmg' },
}
const EF_ROLL_TARGETS = [
  'all saves', 'STR saves', 'DEX saves', 'CON saves', 'INT saves', 'WIS saves', 'CHA saves',
  'saves vs poison', 'saves vs charm', 'saves vs fear',
  'attack rolls', 'melee attacks', 'ranged attacks', 'spell attacks', 'ability checks',
  'Stealth checks', 'Perception checks', 'Athletics checks', 'initiative', 'death saves', 'concentration checks',
]
const EF_DMG_TYPES = [
  'acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic',
  'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder', 'all damage',
]
/** Durations offered wherever an effect is APPLIED (never on the definition). */
const EF_DURATIONS: EffectDuration[] = ['Rounds', 'Minutes', 'Hours', 'Until rest', 'Permanent while equipped']
const EF_TICKING: EffectDuration[] = ['Rounds']
const EF_COUNTED: EffectDuration[] = ['Rounds', 'Minutes', 'Hours']
const EFFECT_ICONS = [
  'fa-bolt', 'fa-arrow-up-right-dots', 'fa-arrow-down-short-wide', 'fa-triangle-exclamation',
  'fa-skull', 'fa-ghost', 'fa-fire', 'fa-snowflake', 'fa-droplet', 'fa-hand-fist',
  'fa-shield-halved', 'fa-hands-praying', 'fa-wind', 'fa-heart-pulse', 'fa-eye',
  'fa-moon', 'fa-gem', 'fa-flask', 'fa-ring', 'fa-khanda', 'fa-location-arrow', 'fa-star',
]

const clipTx = (s: string, n: number) => {
  const t = (s ?? '').trim()
  return t.length > n ? `${t.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : t
}
/** `+2 AC` for a flat bonus, `STR = 21` for a set-to floor. */
const modText = (m: Mod) => (m.set ? `${m.stat} = ${m.amt}` : `${m.amt < 0 ? '−' : '+'}${Math.abs(m.amt)} ${m.stat}`)
const flagText = (f: EffectFlag) => `${EF_FLAG_MODES[f.mode].short} ${f.target || '—'}`
/** Mods then flags, as short human strings — used everywhere an effect is
 *  summarised: the index row, the preview strip, an item's reference row. */
const effectParts = (e: { mods: Mod[]; flags: EffectFlag[] }) => [...e.mods.map(modText), ...e.flags.map(flagText)]

/** The Effects tab of the Catalog: author-once library of effect DEFINITIONS,
 *  grouped by kind (mirrors the mockup). Same index+form pattern as Items/
 *  Features/Spells — `key={activeId ?? 'new'}` on the form is the load/new
 *  draft mechanism, no draft functions needed. */
function EffectLibrarySurface({ lib }: { lib: DmEffectsState }) {
  const { effects, createEffect, updateEffect, deleteEffect, loading } = lib
  const [selId, setSelId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const activeId = creating ? null : (selId ?? effects[0]?.id ?? null)
  const selected = effects.find(e => e.id === activeId) ?? null

  async function handleSubmit(data: EffectDef) {
    if (selected) {
      await updateEffect(selected.id, { data })
    } else {
      const created = await createEffect({ data })
      if (created) { setCreating(false); setSelId(created.id) }
    }
  }
  async function handleDelete() {
    if (!selected) return
    await deleteEffect(selected.id)
    setSelId(null)
  }

  return (
    <div className={styles.catLayout}>
      <div className={styles.catIndex}>
        <div className={styles.catNew}>
          <Btn tone="cyan" icon="fa-plus" label="New Effect" onClick={() => { setCreating(true); setSelId(null) }} />
        </div>
        {EFFECT_KIND_ORDER.map(kind => {
          const rows = effects.filter(e => (e.data?.kind ?? 'buff') === kind)
          if (!rows.length) return null
          const K = EFFECT_KINDS[kind]
          return (
            <div key={kind} className={styles.catGrp}>
              <div className={styles.catGrpHead}><span className={styles.ghT}>{K.label}s</span><span className={styles.ghC}>{rows.length}</span></div>
              <div className={styles.catRows}>
                {rows.map(e => {
                  const parts = effectParts(e.data ?? { mods: [], flags: [] })
                  return (
                    <button key={e.id} className={cx(styles.catRow, e.id === activeId && !creating && styles.sel)}
                      style={{ ['--rar' as string]: K.color }} onClick={() => { setCreating(false); setSelId(e.id) }}>
                      <span className={styles.crIc}><i className={`fa-solid ${e.data?.icon ?? 'fa-bolt'}`} /></span>
                      <span className={styles.crTx}>
                        <span className={styles.crT}>{e.data?.name ?? 'Untitled'}</span>
                        {parts.length ? (
                          <span className={styles.crS}>
                            {parts.map((p, i) => (
                              <span key={i}>{i > 0 && <span className={styles.op}> · </span>}{p}</span>
                            ))}
                          </span>
                        ) : (
                          <span className={cx(styles.crS, styles.prose)}>{renderInline(clipTx(e.data?.desc ?? '', 62))}</span>
                        )}
                      </span>
                      <span className={styles.crTag} style={{ color: K.color, borderColor: K.color }}>
                        {parts.length
                          ? `${e.data.mods.length ? `${e.data.mods.length}M` : ''}${e.data.mods.length && e.data.flags.length ? ' ' : ''}${e.data.flags.length ? `${e.data.flags.length}F` : ''}`
                          : 'prose'}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
        {effects.length === 0 && <div className={styles.catEmpty}>{loading ? '· loading ·' : '— library empty —'}</div>}
      </div>

      <div className={styles.catForm}>
        <EffectForm key={activeId ?? 'new'} effect={selected} effectLib={effects} onSubmit={handleSubmit} onDelete={selected ? handleDelete : undefined} />
      </div>
    </div>
  )
}

function EffectForm({ effect, effectLib, onSubmit, onDelete }: {
  effect: CatalogEffectRow | null
  effectLib: CatalogEffectRow[]
  onSubmit: (data: EffectDef) => Promise<void>
  onDelete?: () => void
}) {
  const d = effect?.data
  const [name, setName] = useState(d?.name ?? '')
  const [icon, setIcon] = useState(d?.icon ?? 'fa-bolt')
  const [kind, setKind] = useState<EffectKind>(d?.kind ?? 'buff')
  const [tags, setTags] = useState<string[]>(d?.tags ?? [])
  const [tagInput, setTagInput] = useState('')
  const [tagAcOpen, setTagAcOpen] = useState(false)
  const [mods, setMods] = useState<Mod[]>(d?.mods ?? [])
  const [flags, setFlags] = useState<EffectFlag[]>(d?.flags ?? [])
  const [desc, setDesc] = useState(d?.desc ?? '')
  const [busy, setBusy] = useState(false)

  const K = EFFECT_KINDS[kind]
  const parts = effectParts({ mods, flags })

  // Tags in use across the library ∪ this draft's own — autocomplete source.
  const allTags = useMemo(() => {
    const set = new Set<string>()
    effectLib.forEach(e => (e.data?.tags ?? []).forEach(t => set.add(t)))
    tags.forEach(t => set.add(t))
    return [...set].sort()
  }, [effectLib, tags])
  const tagUses = (t: string) => effectLib.filter(e => (e.data?.tags ?? []).includes(t)).length
  const tagHits = allTags.filter(t => t.includes(tagInput.trim().toLowerCase()) && !tags.includes(t)).slice(0, 8)

  function addTag(raw: string) {
    // normalizeTag, not a local copy: the resolver matches tags through it, and
    // two normalisers that disagree make targeting fail with no error at all.
    const t = normalizeTag(raw)
    if (t && !tags.includes(t)) setTags(list => [...list, t])
    setTagInput('')
  }

  function build(): EffectDef {
    return { name: name.trim(), icon, kind, tags, mods, flags, desc }
  }
  async function submit() {
    setBusy(true)
    await onSubmit(build())
    setBusy(false)
  }

  return (
    <>
      <div className={styles.catFormHead}>
        <span className={styles.cfhT}>{effect ? 'Edit Effect' : 'New Effect'}</span>
        <span className={styles.cfhId}>{effect ? effect.id : 'unsaved template'}</span>
      </div>

      <div className={styles.efPrev} style={{ ['--k' as string]: K.color }}>
        <span className={styles.pc}><i className={`fa-solid ${icon}`} /></span>
        <span className={styles.pt}>
          <span className={styles.pn}>{name || 'Untitled Effect'}</span>
          <span className={styles.pm}>
            <span className={styles.g}>{K.label}</span>
            {parts.length
              ? parts.map((p, i) => <span key={i}>{p}</span>)
              : <span className={styles.pr}>{desc.trim() ? renderInline(clipTx(desc, 90)) : 'prose only — the description carries the rule'}</span>}
          </span>
        </span>
      </div>

      <span className={styles.fieldLab}>Name</span>
      <input className={styles.sessIn} value={name} onChange={e => setName(e.target.value)} placeholder="Name the effect…" />

      <span className={styles.fieldLab}>Icon</span>
      <div className={styles.catIcons}>
        {EFFECT_ICONS.map(ic => (
          <button key={ic} className={cx(styles.catIc, ic === icon && styles.sel)} onClick={() => setIcon(ic)} title={ic} aria-label={ic}>
            <i className={`fa-solid ${ic}`} />
          </button>
        ))}
      </div>

      <span className={styles.fieldLab}>Kind <span style={{ color: 'var(--beige-dim)' }}>· drives the tint wherever this effect appears</span></span>
      <div className={styles.efKind}>
        {EFFECT_KIND_ORDER.map(k => {
          const KK = EFFECT_KINDS[k]
          return (
            <button key={k} className={cx(styles.k, k === kind && styles.on)} style={{ ['--k' as string]: KK.color }} onClick={() => setKind(k)}>
              <i className={`fa-solid ${KK.icon}`} /><span className={styles.t}>{KK.label}</span>
            </button>
          )
        })}
      </div>

      <span className={styles.fieldLab}>Tags</span>
      <div className={styles.efTags}>
        {tags.length ? tags.map((t, i) => (
          <span key={i} className={styles.efChip}>{t}<i className="fa-solid fa-xmark" onClick={() => setTags(list => list.filter((_, j) => j !== i))} /></span>
        )) : <span className={cx(styles.efChip, styles.empty)}>no tags</span>}
      </div>
      <div className={styles.efTagbox}>
        <input
          className={styles.sessIn} value={tagInput}
          onChange={e => { setTagInput(e.target.value); setTagAcOpen(true) }}
          onFocus={() => setTagAcOpen(true)}
          onBlur={() => setTimeout(() => setTagAcOpen(false), 140)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(tagInput) }
            if (e.key === 'Escape') setTagAcOpen(false)
          }}
          placeholder="Add a tag — lowercased on save" autoComplete="off" spellCheck={false}
        />
        {tagAcOpen && tagHits.length > 0 && (
          <div className={cx(styles.efAc, styles.on)}>
            {tagHits.map(t => (
              <button key={t} className={styles.t2} onMouseDown={e => e.preventDefault()} onClick={() => addTag(t)}>
                {t}<span className={styles.n}>{tagUses(t)} in use</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={styles.efNoduration}>
        <i className="fa-solid fa-hourglass-half" /> No duration here — a definition says what it does; whoever applies it says how long
      </div>

      <div className={cx(styles.efBlock, styles.mods)}>
        <div className={styles.efBh}><i className="fa-solid fa-calculator" /><span className={styles.t}>Modifiers</span><span className={styles.n}>{mods.length} row{mods.length === 1 ? '' : 's'}</span></div>
        <div className={styles.efRule}>Numbers only · stat, operator, value</div>
        <div className={styles.efRows}>
          {mods.length ? mods.map((m, i) => {
            const patchMod = (p: Partial<Mod>) => setMods(list => list.map((x, j) => (j === i ? { ...x, ...p } : x)))
            return (
              <div key={i} className={styles.efRow}>
                <select className={cx(styles.selIn, styles.st)} value={m.stat}
                  onChange={e => patchMod({ stat: e.target.value, set: isAbility(e.target.value) ? m.set : false })}>
                  {MOD_STATS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <span className={styles.efOps}>
                  {/* a debuff subtracts, not adds — the segment reads "−" and forces the
                      sign to match, so the toggle, the number, and the preview never disagree */}
                  <span className={cx(styles.o, !m.set && styles.on)}
                    onClick={() => patchMod({ set: false, amt: kind === 'debuff' ? -Math.abs(m.amt || 1) : Math.abs(m.amt || 1) })}>
                    {kind === 'debuff' ? '−' : '+'}
                  </span>
                  {isAbility(m.stat) && <span className={cx(styles.o, m.set && styles.on)} onClick={() => patchMod({ set: true })}>=</span>}
                </span>
                <input className={cx(styles.sessIn, styles.num)} type="number" step="any" value={m.amt}
                  onChange={e => patchMod({ amt: e.target.value === '' ? 0 : Number(e.target.value) })} />
                <span className={styles.pv}>{modText(m)}</span>
                <span className={styles.x} onClick={() => setMods(list => list.filter((_, j) => j !== i))}><i className="fa-solid fa-xmark" /></span>
              </div>
            )
          }) : <div className={styles.efNone}>No modifiers — this effect changes no number. That is a complete answer.</div>}
        </div>
        <div className={styles.efAdd}>
          <Btn tone="ghost" sm icon="fa-plus" label="Modifier" onClick={() => setMods(list => [...list, { stat: 'AC', amt: kind === 'debuff' ? -1 : 1 }])} />
        </div>
      </div>

      <div className={cx(styles.efBlock, styles.flags)}>
        <div className={styles.efBh}><i className="fa-solid fa-flag" /><span className={styles.t}>Flags</span><span className={styles.n}>{flags.length} row{flags.length === 1 ? '' : 's'}</span></div>
        <div className={styles.efRule}>Never numbers · advantage, resistance, immunity</div>
        <div className={styles.efRows}>
          {flags.length ? flags.map((f, i) => {
            const mode = EF_FLAG_MODES[f.mode]
            const targetList = mode.on === 'roll' ? EF_ROLL_TARGETS : EF_DMG_TYPES
            return (
              <div key={i} className={styles.efRow}>
                <select className={cx(styles.selIn, styles.fm)} value={f.mode} onChange={e => {
                  const nextMode = e.target.value as EffectFlagMode
                  const nextList = EF_FLAG_MODES[nextMode].on === 'roll' ? EF_ROLL_TARGETS : EF_DMG_TYPES
                  setFlags(fl => fl.map((x, j) => (j === i ? { mode: nextMode, target: nextList[0] } : x)))
                }}>
                  {EF_FLAG_ORDER.map(k => <option key={k} value={k}>{EF_FLAG_MODES[k].label}</option>)}
                </select>
                <select className={cx(styles.selIn, styles.tgt)} value={f.target} onChange={e => setFlags(fl => fl.map((x, j) => (j === i ? { ...x, target: e.target.value } : x)))}>
                  {targetList.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <span className={styles.x} onClick={() => setFlags(fl => fl.filter((_, j) => j !== i))}><i className="fa-solid fa-xmark" /></span>
              </div>
            )
          }) : <div className={styles.efNone}>No flags — no advantage, resistance or immunity to record.</div>}
        </div>
        <div className={styles.efAdd}>
          <Btn tone="ghost" sm icon="fa-plus" label="Flag" onClick={() => setFlags(fl => [...fl, { mode: 'advantage', target: EF_ROLL_TARGETS[0] }])} />
        </div>
      </div>

      <div className={cx(styles.efBlock, styles.prose)}>
        <div className={styles.efBh}><i className="fa-solid fa-feather" /><span className={styles.t}>Description</span><span className={styles.n}><i className="fa-solid fa-eye" /> player-facing · **bold** *italics*</span></div>
        <div className={styles.efRule}>Everything neither numeric nor a flag — often the real rule</div>
        <textarea className={styles.catProse} value={desc} onChange={e => setDesc(e.target.value)} placeholder="e.g. At the start of each of their turns the creature takes 1d6 damage…" />
      </div>

      <div className={styles.qActions}>
        <Btn tone="amber" lg icon="fa-floppy-disk" label={busy ? 'Saving…' : effect ? 'Save Effect' : 'Create Effect'} onClick={() => void submit()} disabled={busy || !name.trim()} />
        {onDelete && <Btn tone="danger" lg icon="fa-trash" label="Delete" onClick={onDelete} disabled={busy} />}
      </div>
    </>
  )
}

// ============================================================
// SPELL LIBRARY (Catalog · Spells tab) + GRANT SPELL + SPELLCASTING —
// the Spellbook slice's DM half. Same list+form / snapshot pattern as
// Features. Damage is authored as free text (dice/scaling strings) and
// parsed at the player boundary (lib/spells.ts) rather than here.
// ============================================================
const SPELL_SCHOOLS: SpellSchool[] = [
  'Abjuration', 'Conjuration', 'Divination', 'Enchantment',
  'Evocation', 'Illusion', 'Necromancy', 'Transmutation',
]
const spellLevelLabel = (l: number) => (l === 0 ? 'Cantrip' : `Level ${l}`)
const SPELL_SCHOOL_ICON: Record<SpellSchool, string> = {
  Evocation: 'fa-fire-flame-curved', Conjuration: 'fa-hand-sparkles', Transmutation: 'fa-arrows-spin',
  Illusion: 'fa-ghost', Abjuration: 'fa-shield-halved', Divination: 'fa-eye',
  Necromancy: 'fa-skull', Enchantment: 'fa-wand-magic-sparkles',
}
const SPELL_ICONS = [
  'fa-wand-sparkles', 'fa-fire', 'fa-fire-flame-curved', 'fa-snowflake', 'fa-bolt', 'fa-water',
  'fa-wind', 'fa-mountain', 'fa-meteor', 'fa-explosion', 'fa-skull', 'fa-ghost', 'fa-spider',
  'fa-eye', 'fa-moon', 'fa-sun', 'fa-star', 'fa-shield-halved', 'fa-hand-sparkles', 'fa-hand-fist',
  'fa-heart-pulse', 'fa-brain', 'fa-leaf', 'fa-droplet', 'fa-bone', 'fa-gem', 'fa-book-skull',
]
/** Default swatch shown in the color inputs when no override is authored yet
 *  — matches the player screen's hardcoded cyan fallback (tokens.css --cyan). */
const DEFAULT_SPELL_COLOR = '#00a6d6'

/** The Spells tab of the Catalog: author-once library of spells, grouped by
 *  level (mirrors the player Grimoire). Same index+form pattern as Items/
 *  Features. */
function SpellLibrarySurface({ lib }: { lib: DmSpellsState }) {
  const { spells, createSpell, updateSpell, deleteSpell, loading } = lib
  const [selId, setSelId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const activeId = creating ? null : (selId ?? spells[0]?.id ?? null)
  const selected = spells.find(s => s.id === activeId) ?? null

  async function handleSubmit(data: CatalogSpellData) {
    if (selected) {
      await updateSpell(selected.id, { data })
    } else {
      const created = await createSpell({ data })
      if (created) { setCreating(false); setSelId(created.id) }
    }
  }
  async function handleDelete() {
    if (!selected) return
    await deleteSpell(selected.id)
    setSelId(null)
  }

  const levels = [...new Set(spells.map(s => s.data?.level ?? 0))].sort((a, b) => a - b)

  return (
    <div className={styles.catLayout}>
      <div className={styles.catIndex}>
        <div className={styles.catNew}>
          <Btn tone="cyan" icon="fa-plus" label="New Spell" onClick={() => { setCreating(true); setSelId(null) }} />
        </div>
        {levels.map(lvl => {
          const rows = spells.filter(s => (s.data?.level ?? 0) === lvl)
          return (
            <div key={lvl} className={styles.catGrp}>
              <div className={styles.catGrpHead}><span className={styles.ghT}>{spellLevelLabel(lvl)}</span><span className={styles.ghC}>{rows.length}</span></div>
              <div className={styles.catRows}>
                {rows.map(s => (
                  <button key={s.id} className={cx(styles.catRow, s.id === activeId && !creating && styles.sel)}
                    style={{ ['--rar' as string]: 'var(--cyan)' }} onClick={() => { setCreating(false); setSelId(s.id) }}>
                    <span className={styles.crIc}>
                      <i className={`fa-solid ${s.data?.icon || SPELL_SCHOOL_ICON[s.data?.school ?? 'Evocation']}`} style={s.data?.iconColor ? { color: s.data.iconColor } : undefined} />
                    </span>
                    <span className={styles.crTx}>
                      <span className={styles.crT}>{s.data?.name ?? 'Untitled'}</span>
                      <span className={styles.crS}>{s.data?.school ?? '—'}</span>
                    </span>
                    <span className={styles.crTag}>{spellLevelLabel(lvl)}</span>
                  </button>
                ))}
              </div>
            </div>
          )
        })}
        {spells.length === 0 && <div className={styles.catEmpty}>{loading ? '· loading ·' : '— library empty —'}</div>}
      </div>

      <div className={styles.catForm}>
        <SpellForm key={activeId ?? 'new'} spell={selected} onSubmit={handleSubmit} onDelete={selected ? handleDelete : undefined} />
      </div>
    </div>
  )
}

function SpellForm({ spell, onSubmit, onDelete }: {
  spell: CatalogSpellRow | null
  onSubmit: (data: CatalogSpellData) => Promise<void>
  onDelete?: () => void
}) {
  const d = spell?.data
  const [name, setName] = useState(d?.name ?? '')
  // Roll contributions and the variables they read. Slice 6a made these resolve;
  // until 6b nothing could write them, so `graph` was a field the engine read and
  // no DM could set.
  const [graph, setGraph] = useState<GraphEffect[]>(d?.graph ?? [])
  const [vars, setVars] = useState<VarDef[]>(d?.vars ?? [])
  const [gfxOpen, setGfxOpen] = useState(false)
  const { nodes, namesByGid, ready } = useCatalogNodes()
  // auditNode skips dangling-target detection on an empty catalog, so a clean
  // report before the libraries load would be a lie. See lib/useCatalogNodes.ts.
  const gAudit = ready ? auditNode({ graph, vars }, nodes) : []
  const gErrs = gAudit.filter(a => a.sev === 'err')
  const [level, setLevel] = useState(d?.level ?? 0)
  const [school, setSchool] = useState<SpellSchool>(d?.school ?? 'Evocation')
  const [icon, setIcon] = useState(d?.icon ?? '')
  const [iconColor, setIconColor] = useState(d?.iconColor ?? '')
  const [castingTime, setCastingTime] = useState(d?.castingTime ?? '1 Action')
  const [range, setRange] = useState(d?.range ?? '')
  const [v, setV] = useState(d?.v ?? true)
  const [s, setS] = useState(d?.s ?? true)
  const [m, setM] = useState(d?.m ?? false)
  const [material, setMaterial] = useState(d?.material ?? '')
  const [duration, setDuration] = useState(d?.duration ?? 'Instantaneous')
  const [concentration, setConcentration] = useState(d?.concentration ?? false)
  const [ritual, setRitual] = useState(d?.ritual ?? false)
  const [desc, setDesc] = useState(d?.desc ?? '')
  const [save, setSave] = useState<AbilityKey | ''>(d?.save ?? '')
  const [hasDamage, setHasDamage] = useState(d?.hasDamage ?? false)
  const [dice, setDice] = useState(d?.dice ?? '')
  const [scaling, setScaling] = useState(d?.scaling ?? '')
  const [dmgType, setDmgType] = useState(d?.dmgType ?? '')
  const [dmgColor, setDmgColor] = useState(d?.dmgColor ?? '')
  // Absent (undefined in stored data) reads as "can upcast" — mirror that
  // here so a spell nobody has touched this field on still shows ON.
  const [canUpcast, setCanUpcast] = useState(d?.canUpcast !== false)
  const [maxUpcastLevel, setMaxUpcastLevel] = useState(d?.maxUpcastLevel ?? 0)
  const [partyCastable, setPartyCastable] = useState(d?.partyCastable ?? false)
  const [partyCastMode, setPartyCastMode] = useState<'heal' | 'effect'>(d?.partyCastMode ?? 'heal')
  const [healDice, setHealDice] = useState(d?.healDice ?? '')
  const [effectTone, setEffectTone] = useState<'buff' | 'cond' | 'debuff'>(d?.effectTone ?? 'buff')
  const [effectNote, setEffectNote] = useState(d?.effectNote ?? '')
  const [busy, setBusy] = useState(false)

  function build(): CatalogSpellData {
    return {
      name: name.trim(), level, school,
      ...(icon ? { icon } : {}),
      ...(iconColor ? { iconColor } : {}),
      castingTime: castingTime.trim(), range: range.trim(),
      v, s, m,
      ...(m && material.trim() ? { material: material.trim() } : {}),
      duration: duration.trim(), concentration, ritual, desc: desc.trim(), hasDamage,
      // Absent means "no save", which is what the roll panel reads to decide
      // whether to show a DC at all.
      ...(save ? { save } : {}),
      // Omitted when empty so a spell with no graph never grows the keys — the
      // same discipline withVars() keeps on `resources`.
      ...(graph.length ? { graph } : {}),
      ...(vars.length ? { vars } : {}),
      ...(hasDamage ? {
        dice: dice.trim(), scaling: scaling.trim(), dmgType: dmgType.trim(),
        ...(dmgColor ? { dmgColor } : {}),
        canUpcast,
        ...(canUpcast && maxUpcastLevel > 0 ? { maxUpcastLevel } : {}),
      } : {}),
      ...(partyCastable ? {
        partyCastable: true, partyCastMode,
        ...(partyCastMode === 'heal'
          ? { healDice: healDice.trim() }
          : { effectTone, ...(effectNote.trim() ? { effectNote: effectNote.trim() } : {}) }),
      } : {}),
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
        <span className={styles.cfhT}>{spell ? 'Edit Spell' : 'New Spell'}</span>
        <span className={styles.cfhId}>{spell ? spell.id : 'unsaved template'}</span>
      </div>

      <span className={styles.fieldLab}>Name</span>
      <input className={styles.sessIn} value={name} onChange={e => setName(e.target.value)} placeholder="Name the spell…" />

      <div className={styles.catGrid2}>
        <div>
          <span className={styles.fieldLab}>Level</span>
          <select className={styles.selIn} value={level} onChange={e => setLevel(parseInt(e.target.value, 10))}>
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(l => <option key={l} value={l}>{spellLevelLabel(l)}</option>)}
          </select>
        </div>
        <div>
          <span className={styles.fieldLab}>School</span>
          <select className={styles.selIn} value={school} onChange={e => setSchool(e.target.value as SpellSchool)}>
            {SPELL_SCHOOLS.map(sc => <option key={sc} value={sc}>{sc}</option>)}
          </select>
        </div>
      </div>

      <span className={styles.fieldLab}>Icon</span>
      <div className={styles.catIcons}>
        <button
          className={cx(styles.catIc, !icon && styles.sel)} onClick={() => setIcon('')}
          title={`Auto (by school — ${SPELL_SCHOOL_ICON[school]})`} aria-label="Auto icon by school"
        >
          <i className={`fa-solid ${SPELL_SCHOOL_ICON[school]}`} style={{ opacity: 0.5 }} />
        </button>
        {SPELL_ICONS.map(ic => (
          <button key={ic} className={cx(styles.catIc, ic === icon && styles.sel)} onClick={() => setIcon(ic)} title={ic} aria-label={ic}>
            <i className={`fa-solid ${ic}`} />
          </button>
        ))}
      </div>
      <div className={styles.catGrid2}>
        <div>
          <span className={styles.fieldLab}>Icon Color</span>
          <div className={styles.colorField}>
            <input type="color" className={styles.colorIn} value={iconColor || DEFAULT_SPELL_COLOR} onChange={e => setIconColor(e.target.value)} />
            {iconColor && <button type="button" className={styles.colorReset} onClick={() => setIconColor('')}>Auto</button>}
          </div>
        </div>
      </div>

      <div className={styles.catGrid2}>
        <div><span className={styles.fieldLab}>Casting Time</span><input className={styles.sessIn} value={castingTime} onChange={e => setCastingTime(e.target.value)} placeholder="e.g. 1 Action" /></div>
        <div><span className={styles.fieldLab}>Range</span><input className={styles.sessIn} value={range} onChange={e => setRange(e.target.value)} placeholder="e.g. 120 ft" /></div>
      </div>

      <span className={styles.fieldLab}>Components</span>
      <div className={styles.catComp}>
        <div className={cx(styles.ccOpt, v && styles.on)} onClick={() => setV(x => !x)}><span className={styles.ccB}>{v && <i className="fa-solid fa-check" />}</span>Verbal</div>
        <div className={cx(styles.ccOpt, s && styles.on)} onClick={() => setS(x => !x)}><span className={styles.ccB}>{s && <i className="fa-solid fa-check" />}</span>Somatic</div>
        <div className={cx(styles.ccOpt, m && styles.on)} onClick={() => setM(x => !x)}><span className={styles.ccB}>{m && <i className="fa-solid fa-check" />}</span>Material</div>
      </div>
      {m && (
        <>
          <span className={styles.fieldLab}>Material Component</span>
          <input className={styles.sessIn} value={material} onChange={e => setMaterial(e.target.value)} placeholder="e.g. a tiny ball of bat guano and sulfur" />
        </>
      )}

      <span className={styles.fieldLab}>Duration</span>
      <input className={styles.sessIn} value={duration} onChange={e => setDuration(e.target.value)} placeholder="e.g. Instantaneous" />

      <div className={cx(styles.catTog, concentration && styles.on)} onClick={() => setConcentration(c => !c)} role="switch" aria-checked={concentration}>
        <span className={styles.tgSw} />
        <span className={styles.tgLab}><span className={styles.t}>Concentration</span><span className={styles.s}>Drops if the caster's focus breaks</span></span>
      </div>
      <div className={cx(styles.catTog, ritual && styles.on)} onClick={() => setRitual(r => !r)} role="switch" aria-checked={ritual}>
        <span className={styles.tgSw} />
        <span className={styles.tgLab}><span className={styles.t}>Ritual</span><span className={styles.s}>Castable without expending a slot</span></span>
      </div>

      <div className={styles.qLabRow}>
        <span className={styles.fieldLab}>Description</span>
        <span className={cx(styles.qFacing, styles.player)}><i className="fa-solid fa-eye" /> Player-facing · **bold** *italics*</span>
      </div>
      <textarea className={cx(styles.catProse, styles.player)} value={desc} onChange={e => setDesc(e.target.value)} placeholder="The prose the player reads in their Spellbook…" />

      <div className={styles.catSecLab}><span className={styles.fieldLab}>Saving throw (optional)</span></div>
      <div>
        <span className={styles.fieldLab}>Target’s saving throw</span>
        <select className={styles.selIn} value={save} onChange={e => setSave(e.target.value as AbilityKey | '')}>
          <option value="">— no save —</option>
          {ABILITY_ORDER.map(k => <option key={k} value={k}>{ABILITY_ABBR[k].toUpperCase()}</option>)}
        </select>
        <div className={styles.qHint}>
          Which save the <b>target</b> rolls — e.g. Fireball → DEX, Hold Person → WIS.
          <br />
          The <b>DC</b> is the caster’s, from their profile (8 + prof + their spellcasting ability),
          so the same spell is a harder save from a caster with a better score. A spell never names
          that ability — the class does.
        </div>
      </div>

      <div className={styles.catSecLab}><span className={styles.fieldLab}>Damage (optional)</span></div>
      <div className={cx(styles.catTog, hasDamage && styles.on)} onClick={() => setHasDamage(h => !h)} role="switch" aria-checked={hasDamage}>
        <span className={styles.tgSw} />
        <span className={styles.tgLab}><span className={styles.t}>This spell deals damage</span><span className={styles.s}>Adds a dice expression + per-level scaling</span></span>
      </div>
      {hasDamage && (
        <div className={styles.catDmg}>
          <div className={styles.catGrid3}>
            <div><span className={styles.fieldLab}>Dice</span><input className={styles.sessIn} value={dice} onChange={e => setDice(e.target.value)} placeholder="e.g. 8d6" /></div>
            <div><span className={styles.fieldLab}>Per Level Above</span><input className={styles.sessIn} value={scaling} onChange={e => setScaling(e.target.value)} placeholder="e.g. 1d6" /></div>
            <div><span className={styles.fieldLab}>Damage Type</span><input className={styles.sessIn} value={dmgType} onChange={e => setDmgType(e.target.value)} placeholder="e.g. Fire" /></div>
          </div>
          <div className={styles.catGrid2}>
            <div>
              <span className={styles.fieldLab}>Damage Color</span>
              <div className={styles.colorField}>
                <input type="color" className={styles.colorIn} value={dmgColor || DEFAULT_SPELL_COLOR} onChange={e => setDmgColor(e.target.value)} />
                {dmgColor && <button type="button" className={styles.colorReset} onClick={() => setDmgColor('')}>Auto</button>}
              </div>
            </div>
            <div>
              <span className={styles.fieldLab}>Max Upcast Level</span>
              <input
                className={styles.sessIn} type="number" min={0} max={9} value={maxUpcastLevel || ''} disabled={!canUpcast}
                placeholder="No cap (owned slots only)"
                onChange={e => setMaxUpcastLevel(Math.max(0, Math.min(9, parseInt(e.target.value || '0', 10) || 0)))}
              />
            </div>
          </div>
          <div className={cx(styles.catTog, canUpcast && styles.on)} onClick={() => setCanUpcast(c => !c)} role="switch" aria-checked={canUpcast}>
            <span className={styles.tgSw} />
            <span className={styles.tgLab}>
              <span className={styles.t}>Can Upcast</span>
              <span className={styles.s}>Off = always casts at its own level — no stepper on the player screen. Some spells simply do nothing on upcast.</span>
            </span>
          </div>
        </div>
      )}

      <div className={styles.catSecLab}><span className={styles.fieldLab}>Party Cast (optional)</span></div>
      <div className={cx(styles.catTog, partyCastable && styles.on)} onClick={() => setPartyCastable(p => !p)} role="switch" aria-checked={partyCastable}>
        <span className={styles.tgSw} />
        <span className={styles.tgLab}>
          <span className={styles.t}>Castable at Party</span>
          <span className={styles.s}>Adds a target picker on the player screen — heals or applies an effect to an ally</span>
        </span>
      </div>
      {partyCastable && (
        <div className={styles.catDmg}>
          <span className={styles.fieldLab}>Mode</span>
          <select className={styles.selIn} value={partyCastMode} onChange={e => setPartyCastMode(e.target.value as 'heal' | 'effect')}>
            <option value="heal">Heal</option>
            <option value="effect">Effect</option>
          </select>
          {partyCastMode === 'heal' ? (
            <>
              <span className={styles.fieldLab}>Heal Dice</span>
              <input className={styles.sessIn} value={healDice} onChange={e => setHealDice(e.target.value)} placeholder="e.g. 1d8 + 3" />
            </>
          ) : (
            <div className={styles.catGrid2}>
              <div>
                <span className={styles.fieldLab}>Effect Tone</span>
                <select className={styles.selIn} value={effectTone} onChange={e => setEffectTone(e.target.value as 'buff' | 'cond' | 'debuff')}>
                  <option value="buff">Buff</option>
                  <option value="cond">Condition</option>
                  <option value="debuff">Debuff</option>
                </select>
              </div>
              <div>
                <span className={styles.fieldLab}>Effect Note</span>
                <input className={styles.sessIn} value={effectNote} onChange={e => setEffectNote(e.target.value)} placeholder="e.g. speed x2, extra action" />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ROLL CONTRIBUTIONS — the same block the feature editor authors, in the
          fold idiom the item form's "Effects Granted" already uses. Collapsed by
          default, because most spells have none.

          Distinct from an item's `effects`: that is the passive numeric layer,
          this is per-roll and conditional (database.types.ts:513). */}
      <div className={cx(styles.catFx, styles.fold, gfxOpen && styles.open)}>
        <div className={styles.fxfHead} onClick={() => setGfxOpen(o => !o)} role="button" tabIndex={0} aria-expanded={gfxOpen}>
          <span className={styles.car}><i className="fa-solid fa-caret-right" /></span>
          <i className="fa-solid fa-diagram-project" style={{ color: 'var(--cyan-hot)', fontSize: 11 }} />
          <span className={styles.t}>Roll Contributions</span>
          <span className={styles.s}>
            {graph.length
              ? `${graph.length} effect${graph.length === 1 ? '' : 's'}${gErrs.length ? ` · ${gErrs.length} error${gErrs.length === 1 ? '' : 's'}` : ''}`
              : 'none · what this spell adds to a roll'}
          </span>
        </div>
        {gfxOpen && (
          <div className={styles.gfxBody}>
            <GraphEffects graph={graph} vars={vars} nodes={nodes} namesByGid={namesByGid} onChange={setGraph} />
            <VarsBlock vars={vars} onChange={setVars} />
          </div>
        )}
      </div>

      {/* An error means the node would not resolve. Same gate the feature editor
          puts on Publish (§17) — an audit that does not block is a suggestion. */}
      {gErrs.map((a, i) => (
        <div key={i} className={styles.skWarn}>
          <i className="fa-solid fa-triangle-exclamation" /> <b>{a.t}</b> — {a.s}
        </div>
      ))}

      <div className={styles.qActions}>
        <Btn tone="amber" lg icon="fa-floppy-disk" label={busy ? 'Saving…' : spell ? 'Save Spell' : 'Create Spell'} onClick={() => void submit()} disabled={busy || !name.trim() || gErrs.length > 0} />
        {onDelete && <Btn tone="danger" lg icon="fa-trash" label="Delete" onClick={onDelete} disabled={busy} />}
      </div>
    </>
  )
}

/** Stamp a library template into a grantable Spell copy (fresh instance id +
 *  back-ref), mirroring featureSnapshot. Cantrips are always effectively
 *  "prepared" (never counted against the cap — lib/spells.ts preparedUsed);
 *  a levelled spell arrives known-but-unprepared, same as the player screen's
 *  default read for a spell with no `prepared` flag set. */
function spellSnapshot(row: CatalogSpellRow): Spell {
  return {
    ...row.data,
    id: `spell-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
    spell_id: row.id,
    prepared: row.data.level === 0,
  }
}

/** Grant Spell (Actions card I): copies a library spell onto
 *  `spellbook.spells`, spread so the caster profile / slot state survive.
 *  Refuses a duplicate grant of the same catalog spell (by `spell_id`). */
function GrantSpellCard({ member, row, spellLib, onUpdate, onVoice, log }: {
  member: PartyMember
  row: CharacterRow
  spellLib: CatalogSpellRow[]
  onUpdate: (patch: CharacterUpdate) => Promise<boolean>
  onVoice: (msg: VoiceMsg) => Promise<boolean>
  log: (node: ReactNode, kind?: 'cyan' | 'danger') => void
}) {
  const [selId, setSelId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const sb = row.spellbook ?? {}
  const current = sb.spells ?? []
  const selected = spellLib.find(s => s.id === selId) ?? null
  const first = firstName(member.name)
  const alreadyKnown = selected ? current.some(s => s.spell_id === selected.id) : false

  async function grant() {
    if (!selected || alreadyKnown) return
    setBusy(true)
    const copy = spellSnapshot(selected)
    const ok = await onUpdate({ spellbook: { ...sb, spells: [...current, copy] } })
    setBusy(false)
    if (!ok) return
    void onVoice({ kind: 'spell', target: member.id, name: copy.name, level: copy.level })
    log(<>Granted spell <span className={styles.obj}>{copy.name}</span> to <span className={styles.who}>{first}</span></>, 'cyan')
    setSelId(null)
  }

  async function remove(id: string) {
    const gone = current.find(s => s.id === id)
    const ok = await onUpdate({ spellbook: { ...sb, spells: current.filter(s => s.id !== id) } })
    if (ok && gone) log(<>Removed spell <span className={styles.obj}>{gone.name}</span> from <span className={styles.who}>{first}</span></>, 'danger')
  }

  return (
    <div className={cx(styles.actCard, styles.wide)}>
      <div className={styles.acTitle}><i className="fa-solid fa-wand-sparkles lead" /><span className={styles.num}>I</span><span className={styles.t}>Grant Spell</span></div>
      <div className={styles.featGrantSplit}>
        <div className={styles.fgCol}>
          <span className={styles.fieldLab}>Library · Catalog · Spells tab</span>
          <div className={styles.catList}>
            {spellLib.length === 0 ? (
              <div className={styles.catListEmpty}>Library is empty — author spells in the Catalog's Spells tab.</div>
            ) : spellLib.map(sp => (
              <button key={sp.id} className={cx(styles.catItem, sp.id === selId && styles.sel)} onClick={() => setSelId(sp.id)}>
                <span className={styles.ciIc} style={{ color: sp.data?.iconColor || 'var(--cyan)' }}>
                  <i className={`fa-solid ${sp.data?.icon || SPELL_SCHOOL_ICON[sp.data?.school ?? 'Evocation']}`} />
                </span>
                <span className={styles.ciTx}>
                  <span className={styles.ciNm}>{sp.data?.name ?? 'Untitled'}</span>
                  <span className={styles.ciTy}>{sp.data?.school ?? '—'}</span>
                </span>
                <span className={styles.ciRar} style={{ color: 'var(--muted)' }}>{spellLevelLabel(sp.data?.level ?? 0)}</span>
              </button>
            ))}
          </div>
          <div className={styles.grantAction}>
            <Btn
              tone="amber" icon="fa-arrow-right-to-bracket"
              label={busy ? 'Granting…' : alreadyKnown ? 'Already Known' : `Grant to ${first}`}
              onClick={() => void grant()} disabled={!selected || alreadyKnown || busy}
            />
          </div>
        </div>
        <div className={styles.fgCol}>
          <span className={styles.fieldLab}>In {first}'s grimoire · {current.length}</span>
          <div className={cx(styles.fxActive, styles.fgList)}>
            {current.length ? current.map(sp => (
              <div key={sp.id} className={cx(styles.fxLine, styles.buff)}>
                <span className={styles.nm}>
                  <i className={`fa-solid ${sp.icon || SPELL_SCHOOL_ICON[sp.school]}`} style={sp.iconColor ? { color: sp.iconColor } : undefined} /> {sp.name}
                </span>
                <span className={styles.du}>{spellLevelLabel(sp.level)}</span>
                <span className={styles.x} onClick={() => void remove(sp.id)} title="Remove spell"><i className="fa-solid fa-xmark" /></span>
              </div>
            )) : <div className={styles.fxNone}>— no spells known —</div>}
          </div>
        </div>
      </div>
    </div>
  )
}

const CASTER_ABILITIES: AbilityKey[] = ['int', 'wis', 'cha']

/** Spellcasting (Actions card H): interim caster-profile editor. Unlike every
 *  other card here (immediate per-click writes), this is a dirty/Save form —
 *  changing class/DC/slots one keystroke at a time isn't a "grant", it's
 *  configuration, so it follows the FeatureForm/SpellForm draft convention
 *  instead. The caller passes `key={row.id}` so switching the selected
 *  character remounts this (and re-seeds the draft from the new row) instead
 *  of leaking the previous character's in-progress edits; within one
 *  character the draft stays local until Save. */
function CasterProfileCard({ member, row, onUpdate, log }: {
  member: PartyMember
  row: CharacterRow
  onUpdate: (patch: CharacterUpdate) => Promise<boolean>
  log: (node: ReactNode, kind?: 'cyan' | 'danger') => void
}) {
  const sb = row.spellbook ?? {}
  const first = firstName(member.name)
  const slotByLevel = new Map((sb.slots ?? []).map(sl => [sl.level, sl]))

  const charLevel = row.identity?.level ?? 1

  const [caster, setCaster] = useState(!!sb.spellcasting)
  const [cls, setCls] = useState(sb.class ?? '')
  const [ability, setAbility] = useState<AbilityKey>((sb.ability?.toLowerCase() as AbilityKey) ?? 'int')
  const [saveDC, setSaveDC] = useState(sb.saveDC ?? 10)
  const [attackBonus, setAttackBonus] = useState(sb.attackBonus ?? 0)
  // Prepared style (Wizard/Cleric/Druid/Paladin) vs. Known style (Sorcerer/
  // Bard/Ranger/Warlock/…) — see lib/spells.ts `preparesSpells`. Known casters
  // have every spell ready at all times; Prepared Max is meaningless for them.
  const [preparesSpells, setPreparesSpells] = useState(sb.preparesSpells !== false)
  const [preparedMax, setPreparedMax] = useState(sb.preparedMax ?? 0)
  // Warlock Pact Magic — see lib/spells.ts pactSlotCount/pactSlotLevel. Slot
  // count AND level are DERIVED from character level (not authored here, same
  // principle as cantrip scaling); this card only flips the switch. On, it
  // replaces the standard 9-level ladder below entirely — Pact Magic ignores
  // `slots[]` and is always Known-style regardless of the toggle above.
  const [pactMagic, setPactMagic] = useState(!!sb.pactMagic)
  const [slotTotals, setSlotTotals] = useState<number[]>(
    () => Array.from({ length: 9 }, (_, i) => slotByLevel.get(i + 1)?.total ?? 0),
  )
  const [busy, setBusy] = useState(false)

  function setSlotAt(i: number, total: number) {
    setSlotTotals(prev => prev.map((t, idx) => (idx === i ? Math.max(0, total) : t)))
  }

  async function save() {
    setBusy(true)
    const nextSlots: SpellSlot[] = slotTotals.map((total, i) => {
      const level = i + 1
      const prevExpended = slotByLevel.get(level)?.expended ?? 0
      return { level, total, expended: Math.min(prevExpended, total) }
    })
    const ok = await onUpdate({
      spellbook: {
        ...sb,
        spellcasting: caster,
        ...(cls.trim() ? { class: cls.trim() } : {}),
        ability,
        saveDC,
        attackBonus,
        preparesSpells,
        preparedMax,
        pactMagic,
        slots: nextSlots,
      },
    })
    setBusy(false)
    if (ok) log(<>Updated <span className={styles.who}>{first}</span>'s <span className={styles.obj}>spellcasting profile</span></>, 'cyan')
  }

  return (
    <div className={cx(styles.actCard, styles.wide)}>
      <div className={styles.acTitle}><i className="fa-solid fa-hat-wizard lead" /><span className={styles.num}>H</span><span className={styles.t}>Spellcasting</span></div>

      <div className={cx(styles.catTog, caster && styles.on)} onClick={() => setCaster(c => !c)} role="switch" aria-checked={caster}>
        <span className={styles.tgSw} />
        <span className={styles.tgLab}><span className={styles.t}>{first} Is A Caster</span><span className={styles.s}>Off = Spellbook renders the "no arcane current" empty state</span></span>
      </div>

      <div className={cx(styles.catTog, pactMagic && styles.on)} onClick={() => setPactMagic(p => !p)} role="switch" aria-checked={pactMagic}>
        <span className={styles.tgSw} />
        <span className={styles.tgLab}>
          <span className={styles.t}>Pact Magic (Warlock)</span>
          <span className={styles.s}>On = one small pool of same-level slots, derived from character level, that refresh on a SHORT rest. Replaces the standard ladder below and forces Known-style — no Prepare cap.</span>
        </span>
      </div>

      {!pactMagic && (
        <div className={cx(styles.catTog, preparesSpells && styles.on)} onClick={() => setPreparesSpells(p => !p)} role="switch" aria-checked={preparesSpells}>
          <span className={styles.tgSw} />
          <span className={styles.tgLab}>
            <span className={styles.t}>Prepares Spells</span>
            <span className={styles.s}>On = Wizard/Cleric/Druid/Paladin (daily prep + cap). Off = Sorcerer/Bard/Ranger/… — every known spell is always ready, no Prepare button on the player screen.</span>
          </span>
        </div>
      )}

      <div className={styles.catGrid3}>
        <div><span className={styles.fieldLab}>Class</span><input className={styles.sessIn} value={cls} onChange={e => setCls(e.target.value)} placeholder="e.g. Wizard" /></div>
        <div>
          <span className={styles.fieldLab}>Ability</span>
          <select className={styles.selIn} value={ability} onChange={e => setAbility(e.target.value as AbilityKey)}>
            {CASTER_ABILITIES.map(a => <option key={a} value={a}>{ABILITY_ABBR[a].toUpperCase()}</option>)}
          </select>
        </div>
        <div>
          <span className={styles.fieldLab}>Prepared Max</span>
          <input
            className={styles.sessIn} type="number" min={0} value={preparedMax} disabled={pactMagic || !preparesSpells}
            onChange={e => setPreparedMax(Math.max(0, parseInt(e.target.value || '0', 10) || 0))}
          />
        </div>
      </div>
      <div className={styles.catGrid2}>
        <div><span className={styles.fieldLab}>Save DC</span><input className={styles.sessIn} type="number" min={0} value={saveDC} onChange={e => setSaveDC(Math.max(0, parseInt(e.target.value || '0', 10) || 0))} /></div>
        <div><span className={styles.fieldLab}>Spell Attack Bonus</span><input className={styles.sessIn} type="number" value={attackBonus} onChange={e => setAttackBonus(parseInt(e.target.value || '0', 10) || 0)} /></div>
      </div>

      {pactMagic ? (
        <div className={styles.pactPreview}>
          <span className={styles.fieldLab}>Pact Magic Slots (derived from character level {charLevel} — not authored)</span>
          <div className={styles.pactPreviewRow}>
            <i className="fa-solid fa-hat-wizard" />
            <span>{pactSlotCount(charLevel)} slot{pactSlotCount(charLevel) === 1 ? '' : 's'}, all Level {pactSlotLevel(charLevel)}</span>
          </div>
        </div>
      ) : (
        <>
          <span className={styles.fieldLab}>Spell Slots (total per level)</span>
          <div className={styles.spellSlotRow}>
            {slotTotals.map((total, i) => (
              <div key={i} className={styles.spellSlotCell}>
                <span className={styles.lvl}>L{i + 1}</span>
                <input className={styles.sessIn} type="number" min={0} value={total} onChange={e => setSlotAt(i, parseInt(e.target.value || '0', 10) || 0)} />
              </div>
            ))}
          </div>
        </>
      )}

      <div className={styles.grantAction}>
        <Btn tone="amber" icon="fa-floppy-disk" label={busy ? 'Saving…' : 'Save Profile'} onClick={() => void save()} disabled={busy} />
      </div>
    </div>
  )
}

/** Memory-fidelity levels (eerie player-facing horror descriptor), ordered from
 *  intact to fully corrupted — mirrors the design's MEM_LEVELS. */
const MEM_LEVELS = ['INTACT', 'PARTIAL', 'DEGRADED', 'FRAGMENTED', 'CORRUPTED'] as const

/** Preset roster glyphs the DM can assign as a character's menu portrait. */
const GLYPHS = ['fa-user', 'fa-chess-rook', 'fa-hat-wizard', 'fa-shield-halved', 'fa-mask', 'fa-skull', 'fa-dragon', 'fa-khanda', 'fa-cross', 'fa-feather', 'fa-hand-fist', 'fa-eye']

/** Fixed relation-type vocabulary — "System · Bonded" is the one value that gets the
 *  amber G.U.I.D.E. styling, both here and on the player Lore screen. */
const REL_TYPES = ['Ally', 'Mentor', 'Rival', 'Enigma', 'System · Bonded']
/** Click-to-cycle order for the relation dot. Unset (`indexOf` = -1) lands on 'friendly' first. */
const ATTITUDE_CYCLE = ['friendly', 'neutral', 'wary', 'hostile'] as const
const ATTITUDE_LABEL: Record<string, string> = { friendly: 'Friendly', neutral: 'Neutral', wary: 'Wary', hostile: 'Hostile' }
function attitudeClass(a?: Relation['attitude'] | null): 'fr' | 'ne' | 'wa' | 'ho' | 'un' {
  return a === 'friendly' ? 'fr' : a === 'neutral' ? 'ne' : a === 'wary' ? 'wa' : a === 'hostile' ? 'ho' : 'un'
}

/** Flat section divider (label + hairline rule) — the Lore tab's section idiom, replacing
 *  a boxed .actCard per section so a long form reads as one column, not stacked panels. */
function LoreSecHead({ icon, label, first }: { icon: string; label: string; first?: boolean }) {
  return (
    <div className={cx(styles.loreSecH, first && styles.first)}>
      <i className={`fa-solid ${icon}`} />
      <span className={styles.t}>{label}</span>
    </div>
  )
}

/** Shards tab — Satchel (Grant Shard: who owns which trees), slot assignment,
 *  the per-shard `earned` point grant, a Reset Tree escape hatch (attuned →
 *  [], no separate refund needed since `spent` is derived, never stored),
 *  and revealing a concealed node's real text once its prereqs have
 *  resolved. `shardLib` is the SAME merged catalog+secrets working set the
 *  Lattice Editor uses — reveal needs the real name/effect a player session
 *  can never read directly.
 *
 *  `shards.owned` (ShardsField) is the satchel: ids the DM has granted this
 *  character. The player's install picker only offers owned-and-unslotted
 *  trees — granting here is the only way a player gets access to a shard
 *  they don't already have slotted. Slotting a shard directly (the per-port
 *  dropdown below) also adds it to owned, so an Eject always leaves it
 *  reinstallable from the player's own picker. */
function ShardsTab({ row, member, shardLib, onUpdate, onVoice, log }: {
  row: CharacterRow
  member: PartyMember
  shardLib: DmShardsState
  onUpdate: (patch: CharacterUpdate) => Promise<boolean>
  onVoice: (msg: VoiceMsg) => Promise<boolean>
  log: (node: ReactNode, kind?: 'cyan' | 'danger') => void
}) {
  const slots = (row.shards ?? {}) as Record<string, ShardSlot>
  const owned = row.shards?.owned ?? []
  const installable = shardLib.trees.filter(t => t.published && t.id !== 'guide')

  async function writeSlot(key: ShardSlotKey, next: ShardSlot) {
    await onUpdate({ shards: { ...row.shards, [key]: next } })
  }

  async function toggleOwned(id: string) {
    const has = owned.includes(id)
    await onUpdate({ shards: { ...row.shards, owned: has ? owned.filter(o => o !== id) : [...owned, id] } })
    const tree = shardLib.trees.find(t => t.id === id)
    if (has) {
      log(<>Revoked <span className={styles.obj}>{tree?.name}</span> from <span className={styles.who}>{firstName(member.name)}</span>'s satchel</>, 'danger')
    } else {
      void onVoice({ kind: 'item', target: member.id, name: tree?.name ?? 'Shard', icon: tree?.icon, rarity: tree?.rarity })
      log(<>Granted <span className={styles.obj}>{tree?.name}</span> to <span className={styles.who}>{firstName(member.name)}</span></>, 'cyan')
    }
  }

  return (
    <div className={styles.actGrid}>
      <div className={cx(styles.actCard, styles.wide)}>
        <div className={styles.acTitle}><i className="fa-solid fa-box-open lead" /><span className={styles.num}>S</span><span className={styles.t}>Satchel — Grant Shards</span></div>
        {installable.length === 0 ? (
          <div className={styles.catListEmpty}>No published shards — author &amp; publish in the Lattice Editor.</div>
        ) : (
          <div className={styles.catList}>
            {installable.map(t => {
              const has = owned.includes(t.id)
              return (
                <button key={t.id} className={cx(styles.catItem, has && styles.sel)} onClick={() => void toggleOwned(t.id)}>
                  <span className={styles.ciIc}><i className={`fa-solid ${t.icon}`} /></span>
                  <span className={styles.ciTx}>
                    <span className={styles.ciNm}>{t.name}</span>
                    <span className={styles.ciTy}>{t.module}</span>
                  </span>
                  <span className={styles.ciRar}>{has ? 'Granted ✓' : t.rarity}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {SHARD_SLOT_KEYS.map(key => {
        const slot: ShardSlot = slots[key] ?? { shardId: null, earned: 0, attuned: [] }
        const tree = slot.shardId ? shardLib.trees.find(t => t.id === slot.shardId) : undefined
        const available = shardAvailable(tree, slot)
        const spent = shardSpent(tree, slot)
        const concealedToReveal = tree
          ? tree.nodes.filter(n => n.concealed && slot.attuned.includes(n.id) && !slot.revealed?.[n.id])
          : []

        return (
          <div key={key} className={cx(styles.actCard, styles.wide)}>
            <div className={styles.acTitle}>
              <i className={`fa-solid ${slot.locked ? 'fa-lock' : 'fa-gem'} lead`} />
              <span className={styles.num}>{key.slice(-1)}</span>
              <span className={styles.t}>{tree ? tree.name : `Shard Port ${key.slice(-1)}`}</span>
            </div>

            {slot.locked ? (
              <div className={styles.catCtrNote}>Permanent — cannot be reassigned or ejected.</div>
            ) : !slot.shardId ? (
              <select className={styles.numIn} style={{ width: '100%' }} value="" onChange={e => {
                const shardId = e.target.value
                if (!shardId) return
                const next = installShard(row, key, shardId)
                void onUpdate({ shards: { ...next, owned: owned.includes(shardId) ? owned : [...owned, shardId] } })
                log(<>Slotted <span className={styles.obj}>{shardLib.trees.find(t => t.id === shardId)?.name}</span> into {key}</>)
              }}>
                <option value="">Assign a shard…</option>
                {installable.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            ) : (
              <>
                <div className={styles.vitRead}>
                  <span className={styles.hpnum}>{available}</span><span className={styles.hpmax}>/ {tree?.capacity ?? 0} available</span>
                </div>
                <div className={styles.catCtrNote}>Earned {slot.earned} · Spent {spent} · Attuned {slot.attuned.length}/{tree?.nodes.length ?? 0}</div>
                <div className={styles.stepper} style={{ marginTop: 4 }}>
                  <input className={styles.numIn} type="number" min={0} max={tree?.capacity ?? 0} value={slot.earned}
                    onChange={e => {
                      const cap = tree?.capacity ?? 0
                      const next = Math.max(0, Math.min(cap, parseInt(e.target.value || '0', 10) || 0))
                      void writeSlot(key, { ...slot, earned: next })
                    }} />
                </div>
                <div className={styles.btnRow} style={{ marginTop: 4 }}>
                  <Btn tone="amber" sm icon="fa-plus" label="+1 Earned" onClick={() => {
                    const cap = tree?.capacity ?? 0
                    void writeSlot(key, { ...slot, earned: Math.min(cap, slot.earned + 1) })
                    log(<>Granted {key} <span className={styles.obj}>+1 attunement point</span></>)
                  }} />
                  <Btn tone="danger" sm icon="fa-rotate-left" label="Reset Tree" onClick={() => {
                    void writeSlot(key, { ...slot, attuned: [] })
                    log(<>Reset <span className={styles.obj}>{tree?.name}</span> — all nodes un-attuned</>, 'danger')
                  }} />
                </div>
                <div className={styles.btnRow} style={{ marginTop: 4 }}>
                  <Btn tone="ghost" sm icon="fa-eject" label="Eject" onClick={() => {
                    void onUpdate({ shards: ejectShard(row, key) })
                    log(<>Ejected <span className={styles.obj}>{tree?.name}</span> from {key}</>)
                  }} />
                </div>

                {concealedToReveal.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div className={styles.catCtrNote}>Concealed — attuned, unrevealed</div>
                    {concealedToReveal.map(n => (
                      <div key={n.id} className={styles.btnRow} style={{ marginTop: 4 }}>
                        <span className={styles.obj}>{n.name}</span>
                        <Btn tone="cyan" sm icon="fa-eye" label="Reveal" onClick={() => {
                          void writeSlot(key, { ...slot, revealed: { ...slot.revealed, [n.id]: { name: n.name, effect: n.effect } } })
                          log(<>Revealed <span className={styles.obj}>{n.name}</span> to the player</>, 'cyan')
                        }} />
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** The DM-only Lore tab. Two layers in ONE save:
 *   - `character_secrets` (DM-only, RLS, migration 0002): digitization + true lore —
 *     a player can NEVER read these.
 *   - `characters` row (player-readable): everything else — memory-fidelity descriptor,
 *     menu glyph, portrait, and the full player-facing lore form (backstory / nature /
 *     relations / identity). All of it folds into ONE `patch.lore` + `patch.identity`
 *     write so no widget's draft can clobber another's.
 *  Drafts are local with a single explicit "Save Lore" (matches the design) so typing
 *  can't spam writes; mount with key={characterId} so drafts reset on switch. */
function LoreTab({ row, member, secret, onUpdateSecret, onUpdateChar }: {
  row: CharacterRow
  member: PartyMember
  secret?: CharacterSecret
  onUpdateSecret: (patch: CharacterSecretUpdate) => Promise<void>
  onUpdateChar: (patch: CharacterUpdate) => Promise<boolean>
}) {
  const savedDig = secret?.digitization ?? 0
  const savedLore = secret?.true_lore ?? ''
  const savedMem = row.lore?.memoryFidelity ?? 'INTACT'
  const savedIcon = row.identity?.icon ?? 'fa-user'
  const savedPortrait = row.identity?.portrait ?? ''
  const savedFocus = row.identity?.portraitFocus ?? 'center top'
  const savedBackstory = row.lore?.backstory ?? ''
  const savedPersonality = row.lore?.personality ?? {}
  const savedRelations = row.lore?.relations ?? []
  const savedIdentity = row.lore?.identity ?? {}

  const [dig, setDig] = useState(savedDig)
  const [lore, setLore] = useState(savedLore)
  const [mem, setMem] = useState(savedMem)
  const [icon, setIcon] = useState(savedIcon)
  const [portrait, setPortrait] = useState(savedPortrait)
  const [portraitFailed, setPortraitFailed] = useState(false)
  const [focus, setFocus] = useState(savedFocus)
  const [backstory, setBackstory] = useState(savedBackstory)
  const [trait, setTrait] = useState(savedPersonality.trait ?? '')
  const [ideal, setIdeal] = useState(savedPersonality.ideal ?? '')
  const [bond, setBond] = useState(savedPersonality.bond ?? '')
  const [flaw, setFlaw] = useState(savedPersonality.flaw ?? '')
  const [relations, setRelations] = useState<Relation[]>(savedRelations)
  const [alignment, setAlignment] = useState(savedIdentity.alignment ?? '')
  const [age, setAge] = useState(savedIdentity.age ?? '')
  const [height, setHeight] = useState(savedIdentity.height ?? '')
  const [deity, setDeity] = useState(savedIdentity.deity ?? '')
  const [homeland, setHomeland] = useState(savedIdentity.homeland ?? '')
  const [busy, setBusy] = useState(false)

  const secretDirty = dig !== savedDig || lore !== savedLore
  const personality = { trait, ideal, bond, flaw }
  const identityLore = { alignment, age, height, deity, homeland }
  const charDirty = mem !== savedMem || icon !== savedIcon || portrait !== savedPortrait || focus !== savedFocus
    || backstory !== savedBackstory
    || JSON.stringify(personality) !== JSON.stringify({ trait: savedPersonality.trait ?? '', ideal: savedPersonality.ideal ?? '', bond: savedPersonality.bond ?? '', flaw: savedPersonality.flaw ?? '' })
    || JSON.stringify(relations) !== JSON.stringify(savedRelations)
    || JSON.stringify(identityLore) !== JSON.stringify({ alignment: savedIdentity.alignment ?? '', age: savedIdentity.age ?? '', height: savedIdentity.height ?? '', deity: savedIdentity.deity ?? '', homeland: savedIdentity.homeland ?? '' })
  const dirty = secretDirty || charDirty
  const digClass: '' | 'high' | 'crit' = dig >= 80 ? 'crit' : dig >= 50 ? 'high' : ''

  const patchRelation = (i: number, p: Partial<Relation>) =>
    setRelations(list => list.map((r, j) => (j === i ? { ...r, ...p } : r)))

  async function save() {
    setBusy(true)
    const jobs: Promise<unknown>[] = []
    if (secretDirty) jobs.push(onUpdateSecret({ digitization: dig, true_lore: lore }))
    if (charDirty) {
      const patch: CharacterUpdate = {}
      const nextLore: CharacterLore = {
        ...(row.lore ?? {}),
        memoryFidelity: mem,
        backstory,
        personality,
        relations,
        identity: identityLore,
      }
      patch.lore = nextLore
      const nextIdentity = { ...row.identity, icon, portrait: portrait.trim() || null, portraitFocus: focus }
      patch.identity = nextIdentity
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

      {/* backstory */}
      <LoreSecHead icon="fa-scroll" label="Backstory" first />
      <div className={styles.qLabRow}>
        <span className={cx(styles.qFacing, styles.player)}><i className="fa-solid fa-eye" /> Players see this</span>
      </div>
      <textarea
        className={styles.qPlayerDesc}
        value={backstory}
        onChange={e => setBackstory(e.target.value)}
        placeholder="The prose players read on the Lore screen…"
      />
      <p className={styles.acHint}>**bold**  *italics*  [text](url)  ## heading · blank line = new paragraph</p>

      {/* nature — trait/ideal/bond/flaw */}
      <LoreSecHead icon="fa-circle-dot" label="Personality / Nature" />
      <div className={styles.catGrid2}>
        <div><span className={styles.fieldLab}>Personality Trait</span><textarea className={styles.loreNatArea} value={trait} onChange={e => setTrait(e.target.value)} /></div>
        <div><span className={styles.fieldLab}>Ideal</span><textarea className={styles.loreNatArea} value={ideal} onChange={e => setIdeal(e.target.value)} /></div>
        <div><span className={styles.fieldLab}>Bond</span><textarea className={styles.loreNatArea} value={bond} onChange={e => setBond(e.target.value)} /></div>
        <div><span className={styles.fieldLab}>Flaw</span><textarea className={styles.loreNatArea} value={flaw} onChange={e => setFlaw(e.target.value)} /></div>
      </div>

      {/* relations — colored-strip rows, click the dot to cycle attitude */}
      <LoreSecHead icon="fa-diagram-project" label="Relations" />
      {relations.length ? relations.map((r, i) => {
        const cls = attitudeClass(r.attitude)
        const sys = r.type === 'System · Bonded'
        return (
          <div key={i} className={cx(styles.loreRel, styles[cls], sys && styles.sys)}>
            <div className={styles.loreRelTop}>
              <button
                type="button"
                className={cx(styles.loreDot, (cls === 'ho' || cls === 'un') && styles.hollow)}
                onClick={() => patchRelation(i, {
                  attitude: ATTITUDE_CYCLE[(ATTITUDE_CYCLE.indexOf(r.attitude as typeof ATTITUDE_CYCLE[number]) + 1) % ATTITUDE_CYCLE.length],
                })}
                title={`${ATTITUDE_LABEL[r.attitude ?? ''] ?? 'Unknown'} — click to cycle attitude`}
                aria-label="Cycle attitude"
              />
              <input className={cx(styles.sessIn, styles.rn)} value={r.name} onChange={e => patchRelation(i, { name: e.target.value })} placeholder="Name" />
              <select className={cx(styles.selIn, styles.rt)} value={r.type} onChange={e => patchRelation(i, { type: e.target.value })}>
                <option value="">Type…</option>
                {REL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <span className={styles.loreAttLab}>{ATTITUDE_LABEL[r.attitude ?? ''] ?? '—'}</span>
              <span className={styles.qOx} onClick={() => setRelations(list => list.filter((_, j) => j !== i))}><i className="fa-solid fa-xmark" /></span>
            </div>
            <input className={cx(styles.sessIn, styles.loreRelDesc)} value={r.desc} onChange={e => patchRelation(i, { desc: e.target.value })} placeholder="Description…" />
          </div>
        )
      }) : <div className={styles.fxNone}>No relations yet — add allies, mentors, rivals, or the system itself.</div>}
      <div className={styles.loreRelAdd}>
        <Btn tone="ghost" sm icon="fa-plus" label="Add Relation" onClick={() => setRelations(list => [...list, { name: '', type: '', desc: '' }])} />
      </div>

      {/* identity vitals — the fields the player Lore dossier shows beyond race/class */}
      <LoreSecHead icon="fa-id-card" label="Identity" />
      <div className={styles.catGrid2}>
        <div><span className={styles.fieldLab}>Alignment</span><input className={styles.sessIn} value={alignment} onChange={e => setAlignment(e.target.value)} placeholder="e.g. Lawful Neutral" /></div>
        <div><span className={styles.fieldLab}>Age</span><input className={styles.sessIn} value={age} onChange={e => setAge(e.target.value)} /></div>
        <div><span className={styles.fieldLab}>Height</span><input className={styles.sessIn} value={height} onChange={e => setHeight(e.target.value)} /></div>
        <div><span className={styles.fieldLab}>Deity</span><input className={styles.sessIn} value={deity} onChange={e => setDeity(e.target.value)} /></div>
        <div><span className={styles.fieldLab}>Homeland</span><input className={styles.sessIn} value={homeland} onChange={e => setHomeland(e.target.value)} /></div>
      </div>

      {/* portrait — the image the player Lore screen + Equipment screen both show */}
      <LoreSecHead icon="fa-image" label="Portrait" />
      <div className={styles.loreGrid}>
        <div className={styles.portraitPrev}>
          {portrait && !portraitFailed ? (
            <img src={portrait} alt="" style={{ objectPosition: focus }} onError={() => setPortraitFailed(true)} />
          ) : (
            <i className={`fa-solid ${icon}`} />
          )}
        </div>
        <div>
          <span className={styles.fieldLab}>Public Image URL</span>
          <input
            className={styles.sessIn} value={portrait}
            onChange={e => { setPortrait(e.target.value); setPortraitFailed(false) }}
            placeholder="https://…/storage/v1/object/public/portraits/…"
          />
          <Btn tone="ghost" sm icon="fa-xmark" label="Clear" onClick={() => setPortrait('')} disabled={!portrait} />
          <p className={styles.acHint}>Paste the public URL of a file already uploaded to the Storage "portraits" bucket. Absent/failed → the menu glyph below is shown instead.</p>
        </div>
      </div>
      <div className={styles.glyphRow}>
        <span className={styles.glyphLab}>Face Focus</span>
        <div className={styles.glyphBtns}>
          {(['center top', 'center center', 'center bottom'] as const).map(f => (
            <button
              key={f} type="button"
              className={cx(styles.durOpt, focus === f && styles.sel)}
              onClick={() => setFocus(f)}
              aria-pressed={focus === f}
            >
              {f === 'center top' ? 'Top' : f === 'center center' ? 'Center' : 'Bottom'}
            </button>
          ))}
        </div>
      </div>
      <p className={styles.acHint}>Keeps the face in frame when the source image is tall or off-center — applies everywhere this portrait renders (Lore, Equipment).</p>
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

      {/* DM-only tools — digitization, memory fidelity, true lore. Never sent to players
          (memory fidelity is the one exception: it's a player-readable descriptor). */}
      <LoreSecHead icon="fa-satellite-dish" label="DM Intelligence" />
      <div className={styles.loreGrid}>
        <div className={styles.actCard}>
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

      {/* Portaled to <body> — .console clips overflow for its scrolling panels, and that
          clip applies to position:fixed descendants too (fixed only escapes the LAYOUT
          containing-block chain, not an ancestor's paint/overflow clip), so a fixed button
          left in place here renders with correct geometry but never actually paints. */}
      {dirty && createPortal(
        <div className={styles.loreFloatSave}>
          <Btn tone="amber" lg icon="fa-floppy-disk" label={busy ? 'Saving…' : 'Save Lore'} onClick={() => void save()} disabled={busy} />
        </div>,
        document.body,
      )}
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

/** Rows written before Related tags carried a `url` are plain strings —
 *  normalize on read so the form only ever handles the object shape. */
function toRelatedTag(r: RelatedTag | string): RelatedTag {
  return typeof r === 'string' ? { name: r } : r
}

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
              onNew={() => { setCreating(true); setSelId(null) }}
            />
          </div>
        </div>
      )}
    </>
  )
}

function QuestForm({ quest, gmNotes, onSubmit, onDelete, onNew }: {
  quest: QuestRow | null
  gmNotes: string
  onSubmit: (fields: QuestFields, gmNotes: string) => Promise<void>
  onDelete?: () => void
  onNew: () => void
}) {
  const [title, setTitle] = useState(quest?.title ?? '')
  const [type, setType] = useState<QuestType>(quest?.type ?? 'side')
  const [status, setStatus] = useState<QuestStatus>(quest?.status ?? 'active')
  const [location, setLocation] = useState(quest?.location ?? '')
  const [givenBy, setGivenBy] = useState(quest?.given_by ?? '')
  const [description, setDescription] = useState(quest?.description ?? '')
  const [objectives, setObjectives] = useState<QuestObjective[]>(quest?.objectives ?? [])
  const [related, setRelated] = useState<RelatedTag[]>((quest?.related ?? []).map(toRelatedTag))
  const [gm, setGm] = useState(gmNotes)
  const [objInput, setObjInput] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [tagUrlInput, setTagUrlInput] = useState('')
  const [busy, setBusy] = useState(false)

  function addObjective() {
    const t = objInput.trim()
    if (!t) return
    setObjectives(o => [...o, { text: t, done: false }])
    setObjInput('')
  }
  function addTag() {
    const name = tagInput.trim()
    if (!name || related.some(r => r.name === name)) { setTagInput(''); setTagUrlInput(''); return }
    const url = tagUrlInput.trim()
    setRelated(r => [...r, url ? { name, url } : { name }])
    setTagInput('')
    setTagUrlInput('')
  }
  async function submit() {
    setBusy(true)
    await onSubmit({ title, type, status, location, given_by: givenBy, description, objectives, related }, gm)
    setBusy(false)
  }

  return (
    <>
      <div className={styles.qTitleRow}>
        <div className={styles.qTitleField}>
          <span className={styles.fieldLab}>Title</span>
          <input className={styles.sessIn} value={title} onChange={e => setTitle(e.target.value)} placeholder="Name the quest…" />
        </div>
        <Btn tone="cyan" sm icon="fa-plus" label="New Quest" onClick={onNew} />
      </div>

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
        {related.length ? related.map((r, i) => (
          <span key={i} className={styles.qTag}>
            {r.url && <i className="fa-solid fa-link" aria-hidden="true" />}
            {r.name}
            <span className={styles.qTx2} onClick={() => setRelated(list => list.filter((_, j) => j !== i))}><i className="fa-solid fa-xmark" /></span>
          </span>
        )) : <span className={styles.qTagNone}>No related tags</span>}
      </div>
      <div className={styles.qTagAdd}>
        <input className={styles.sessIn} value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && addTag()} placeholder="Add a related NPC or place…" />
        <input className={styles.sessIn} value={tagUrlInput} onChange={e => setTagUrlInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && addTag()} placeholder="Link (optional) — https://…" />
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
