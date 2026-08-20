import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import {
  useDmStatus, useDmParty, useDmCampaign, useDmCatalog, useDmConfiscated, useDmFeatures, useDmEffects, useDmSpells, useDmShops, useDmClasses, useDmRaces, classContent, raceContent, featureContent, type DmCampaignState, type DmCatalogState, type DmFeaturesState, type DmEffectsState, type DmSpellsState, type DmShopsState, type DmClassesState, type DmRacesState, useDmLoot, useDmLootOpen, lootContent, useDmBackgrounds, backgroundContent, type DmBackgroundsState,
} from '../lib/dm'
import { useDmShards, type DmShardsState } from '../lib/dmShards'
import { OperatorShops } from './OperatorShops'
import { parseCatalogQuery, matchesCatalogQuery, hasPositiveTerm } from '../lib/catalogSearch'
import { SHARD_SLOT_KEYS, ejectShard, installShard, shardAvailable, shardSpent, type ShardSlotKey } from '../lib/shards'
import { MOD_STATS, SKILL_STATS, isAbility, compileEffects, type Mod } from '../lib/modEditor'
import type { GraphEffect, GraphState, ProgressStory, ShardSlot, ShardTree, VarDef } from '../lib/database.types'
import { auditNode, characterVars, type AuditItem } from '../lib/graph'
import type { DmLootState } from '../lib/dm'
import { chanceOfNothing, expectedYield, poolItems, rollLoot } from '../lib/loot'
import { AuditPanel, GraphEffects, TagsBlock, VarsBlock, revealAudit } from '../components/GraphEffects'
import { useCatalogNodes } from '../lib/useCatalogNodes'
import { consumeArmed, scopedVars, setDmVars, type VarRow } from '../lib/graphState'
import { longRestPatch } from '../lib/rest'
import { durationTurns } from '../lib/turns'
import { effectiveSheet } from '../lib/effects'
import { pactSlotCount, pactSlotLevel } from '../lib/spells'
import {
  CASTER_LABEL, assignClass, assignSubclass, casterSlots, casterSummary, castingNumbers,
  castingRules, gateLevel, hitPointRules, ordinal,
} from '../lib/classes'
import { assignRace } from '../lib/races'
import { useGuideVoice, ALL_PARTY, type VoiceMsg, type VoiceTone } from '../lib/voice'
import { usePartyPresence } from '../lib/presence'
import { useFullscreen } from '../lib/fullscreen'
import { renderInline } from '../lib/markdown'
import { markdownShortcuts } from '../lib/textareaHooks'
import { useLocalDraft } from '../lib/draft'
import { useAutoPublish, useAutoSave } from '../lib/autopublish'
import type {
  CharacterRow, CharacterUpdate, CharacterSecret, CharacterSecretUpdate, HP, Json, QuestRow, QuestStatus, QuestType, QuestObjective, RelatedTag, SessionRow, CatalogItemRow, CatalogItemData, InventoryItem, ItemCategory, ItemRarity, ItemSlot, AbilityKey, WeaponAbility, ActiveEffect, Feature, FeatureCategory, FeatureKind, CatalogFeatureRow, EffectKind, EffectFlagMode, EffectFlag, EffectDef, CatalogEffectRow, EffectDuration, EffectRef, Spell, SpellSchool, SpellSlot, CatalogSpellRow, CatalogSpellData, CatalogClassRow, ClassDef, ClassCasterType, FeatureGrantRef, CatalogFeatureData, CatalogRaceRow, RaceDef, CatalogBackgroundRow, BackgroundDef, EquipChoice, EquipEntry, EquipOption, EquipPick, EquipRef, EquippedGear, CharacterLore, Relation, CatalogLootRow, LootTable, LootRow, LootOpenLine, CharacterSheet,
} from '../lib/database.types'
import { ITEM_SLOTS, isRingSlot } from '../lib/equip'
import { SKILLS, ABILITY_ORDER, ABILITY_ABBR, ABILITY_NAMES, abilityMod } from '../lib/dnd'
import { grantMany, isStackable } from '../lib/placement'
import { kitChoices, legacyKitText, resolvePool } from '../lib/kit'
import { isEquipPick } from '../lib/database.types'
import { OperatorInventory } from './OperatorInventory'
import { normalizeTag } from '../lib/graph'
import styles from './OperatorConsole.module.css'
import { IconPicker } from '../components/IconPicker'
import { Icon } from '../components/Icon'
import { ProsePreview } from '../components/ProsePreview'
import { leafOf } from '../lib/folders'
import { LootRollOverlay } from '../components/LootRollOverlay'

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
type CatTab = 'items' | 'features' | 'spells' | 'effects' | 'shops' | 'classes' | 'races' | 'backgrounds' | 'loot'

export function OperatorConsole() {
  const { session, loading: authLoading } = useAuth()
  const { isDm, loading: dmLoading } = useDmStatus()
  const shardLib = useDmShards()
  // EditorTree is a superset of ShardTree (catalog geometry + merged DM
  // secrets) — safe to feed straight into effectiveSheet()'s shardTrees arg.
  const shardCatalog = useMemo<Record<string, ShardTree>>(
    () => Object.fromEntries(shardLib.trees.map(t => [t.id, t])), [shardLib.trees])
  const { party, secrets, loading: partyLoading, error, updateCharacter, updateSecret } = useDmParty(shardCatalog)
  const campaign = useDmCampaign()
  const catalog = useDmCatalog()
  const featureLib = useDmFeatures()
  const effectLib = useDmEffects()
  const spellLib = useDmSpells()
  const shopLib = useDmShops()
  const classLib = useDmClasses()
  const lootLib = useDmLoot()
  const lootOpen = useDmLootOpen()
  const raceLib = useDmRaces()
  const backgroundLib = useDmBackgrounds()
  const confiscated = useDmConfiscated()
  const onlineIds = usePartyPresence()
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen()

  /** An editor that was opened from a surface here sends you back to it via
      router state, so returning does not dump you on the overview. */
  const navState = useLocation().state as { view?: View } | null
  const [view, setView] = useState<View>(navState?.view ?? 'overview')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  /** Which per-character tab is showing when a PC is selected. */
  const [charTab, setCharTab] = useState<CharTab>('actions')
  /** Which catalog is showing. Lives here, not in CatalogSurface, because the
      rail that switches it hangs off region 01 while the catalog renders in 02. */
  const [catTab, setCatTab] = useState<CatTab>('items')
  const nav = useNavigate()
  const catTabs: { key: string; label: string; icon: string; n?: number; soon: boolean }[] = [
    { key: 'items', label: 'Items', icon: 'fa-box-open', n: catalog.items.length, soon: false },
    { key: 'spells', label: 'Spells', icon: 'fa-wand-sparkles', n: spellLib.spells.length, soon: false },
    { key: 'effects', label: 'Effects', icon: 'fa-bolt', n: effectLib.effects.length, soon: false },
    { key: 'shops', label: 'Shopkeepers', icon: 'fa-shop', n: shopLib.shops.length, soon: false },
    /* Loot sits with Shopkeepers because they are the same job: both are
       containers of catalog items the DM OPENS for the party, and both are
       reached the same way once open. */
    { key: 'loot', label: 'Loot', icon: 'fa-sack-dollar', n: lootLib.tables.length, soon: false },
    { key: 'classes', label: 'Classes', icon: 'fa-shield-halved', n: classLib.classes.length, soon: false },
    { key: 'races', label: 'Races', icon: 'fa-leaf', n: raceLib.races.length, soon: false },
    { key: 'backgrounds', label: 'Backgrounds', icon: 'fa-scroll', n: backgroundLib.backgrounds.length, soon: false },
    /* Last on purpose: these two LEAVE the catalog for their own editor, so they
       are an exit rather than another tab, and reading order should say so. */
    { key: 'features', label: 'Features', icon: 'fa-star', n: featureLib.features.length, soon: false },
    { key: 'shards', label: 'Shards', icon: 'fa-gem', soon: false },
  ]

  // The G.U.I.D.E. voice (slice 6): DM → player broadcast channel. Send-only here.
  const sendVoice = useGuideVoice()
  // Session-local activity log, newest first, capped like the mockup's logAct.
  const [logEntries, setLogEntries] = useState<LogEntry[]>([])
  const log = (node: ReactNode, kind?: LogEntry['kind']) =>
    setLogEntries(prev => [{ id: crypto.randomUUID(), node, kind, time: nowStamp() }, ...prev].slice(0, 24))

  /* The loot roll lives at console level, not inside the catalog tab: it has to
     survive the DM navigating away (the mockup's index row offers "Resume"),
     and it is a portal anyway. `lootMin` hides it without closing it —
     minimize and close are different verbs here. */
  const [lootMin, setLootMin] = useState(false)

  /** Roll a table and park the result, CLOSED. Only hits are stored: the party
   *  sees what is in the container, and a miss is not in the container. */
  const rollLootTable = useCallback(async (tableId: string, table: LootTable) => {
    const byId = new Map(catalog.items.map(r => [r.id, r.data]))
    const result = rollLoot(table, byId)
    const lines: LootOpenLine[] = result.items.map((it, i) => ({
      key: `${tableId}_${i}_${Date.now().toString(36)}`,
      item_id: it.item_id,
      item: it.data,
      qty: it.qty,
      assigned_to: null,
      assigned_name: null,
    }))
    await lootOpen.create(tableId, {
      icon: table.icon, name: table.name, kind: table.kind, location: table.location, desc: table.desc,
    }, lines)
    setLootMin(false)
    log(<>Rolled <span className={styles.obj}>{table.name || 'Untitled'}</span> · {lines.length
      ? `${lines.length} item${lines.length === 1 ? '' : 's'}` : 'nothing of value'}</>, lines.length ? 'cyan' : 'danger')
  }, [catalog.items, lootOpen, log])

  /** Assigning is a REAL GRANT — the item lands on that character's sheet
   *  through the same grantMany path Grant Item uses, so it arrives
   *  indistinguishably from a hand-granted item. */
  const assignLootLine = useCallback(async (key: string, memberId: string) => {
    const roll = lootOpen.roll
    if (!roll) return
    const line = (roll.lines ?? []).find(l => l.key === key)
    const target = party.find(c => c.id === memberId)
    if (!line || !target) return

    const gear = (target.equipped ?? {}) as EquippedGear
    const inv = (target.inventory ?? []) as unknown as InventoryItem[]
    const ok = await updateCharacter(memberId, {
      inventory: grantMany(line.item, line.item_id, line.qty, gear, inv) as unknown as Json[],
    })
    if (!ok) return

    const name = target.name ?? 'Unknown'
    await lootOpen.setLines((roll.lines ?? []).map(l =>
      l.key === key ? { ...l, assigned_to: memberId, assigned_name: name } : l))
    void sendVoice({ kind: 'item', target: memberId, name: line.item?.name ?? 'Item', icon: line.item?.icon, rarity: line.item?.rarity })
    log(<>Assigned <span className={styles.obj}>{line.item?.name}</span> to <span className={styles.who}>{firstName(name)}</span></>)
  }, [lootOpen, party, updateCharacter, sendVoice, log])

  /** Clears the assignment MARK only. The item stays on their sheet — taking it
   *  back would need a remove path that does not exist, and silently deleting
   *  someone's item because the DM mis-clicked a dropdown is worse than a stale
   *  mark the DM can simply re-assign. */
  const unassignLootLine = useCallback(async (key: string) => {
    const roll = lootOpen.roll
    if (!roll) return
    await lootOpen.setLines((roll.lines ?? []).map(l =>
      l.key === key ? { ...l, assigned_to: null, assigned_name: null } : l))
    log(<>Unassigned a loot line · <span className={styles.obj}>the item stays on their sheet</span></>, 'danger')
  }, [lootOpen, log])


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
    // usePartyPresence now maps id -> broadcast vitals; the LEDs only need the keys.
    prevOnlineRef.current = new Set(onlineIds.keys())
    if (!presenceReadyRef.current) return
    for (const id of onlineIds.keys()) {
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
                        <span className={styles.pcPortrait}><Icon name={p.icon} /></span>
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

          {/* CATALOG RAIL — icon-only chamfered tabs hung off THIS panel's
              right edge, overlapping the work area beside it, exactly as the
              authoring editor's `.gbtn` hangs off its Features panel. It sits
              outside .rInner on purpose: that element is overflow:hidden, so a
              child of it could never cross the panel edge.

              Stacked with flex, deliberately unlike `.gbtn`, which hardcodes a
              `top` per index and stops working at four. No room for a label at
              34px, so the name, count, and a note for the two entries that
              leave the catalog live in the tooltip instead. */}
          {view === 'catalog' && (
            <nav className={styles.catRail} aria-label="Catalog sections">
              {catTabs.map(t => {
                const leaves = t.key === 'shards' || t.key === 'features'
                const title = t.label
                  + (t.n != null ? ` (${t.n})` : '')
                  + (t.soon ? ' · its own later slice' : leaves ? ' · opens its own screen' : '')
                return (
                  <button key={t.key} className={cx(styles.crTab, t.key === catTab && styles.sel, t.soon && styles.stub)}
                    disabled={t.soon} title={title}
                    onClick={() => { if (t.soon) return; if (t.key === 'shards') nav('/dm/shards'); else if (t.key === 'features') nav('/dm/features'); else setCatTab(t.key as CatTab) }}>
                    <Icon name={t.icon} className={styles.crGlyph} />
                    <span className={styles.crLab}>{t.label}</span>
                  </button>
                )
              })}
            </nav>
          )}
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
            <div className={cx(styles.workBody, view === 'catalog' && styles.catBody)}>
              {error ? (
                <div className={styles.soonPanel}><i className="fa-solid fa-triangle-exclamation" /><span className={styles.big}>Link Error</span><span>{error}</span></div>
              ) : partyLoading ? (
                <div className={styles.soonPanel}><i className="fa-solid fa-spinner" /><span>Loading party…</span></div>
              ) : view === 'quests' ? (
                <QuestsSurface campaign={campaign} />
              ) : view === 'sessions' ? (
                <SessionsSurface campaign={campaign} />
              ) : view === 'catalog' ? (
                <CatalogSurface tab={catTab} catalog={catalog} featureLib={featureLib} effectLib={effectLib} spellLib={spellLib} shopLib={shopLib} classLib={classLib} raceLib={raceLib} lootLib={lootLib} backgroundLib={backgroundLib} members={members}
                  onRollLoot={(id, t) => { void rollLootTable(id, t) }}
                  openLootId={lootOpen.roll?.table_id ?? null}
                  onResumeLoot={() => setLootMin(false)} />
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
                  <ActionsTab row={selectedRow} member={selected} catalog={catalog.items} featureLib={featureLib.features} effectLib={effectLib.effects} spellLib={spellLib.spells} classLib={classLib} raceLib={raceLib} shardCatalog={shardCatalog} onUpdate={patch => updateCharacter(selectedRow.id, patch)} onVoice={sendVoice} log={log} />
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

      {/* The loot roll. Portalled from inside the component, so it renders over
          everything regardless of where the DM has navigated — and survives
          switching tabs, which is what makes "Resume" on the index row work. */}
      {lootOpen.roll && !lootMin && (
        <LootRollOverlay
          roll={lootOpen.roll}
          members={members.map(m => ({ id: m.id, name: m.name }))}
          onAssign={(k, id) => void assignLootLine(k, id)}
          onUnassign={k => void unassignLootLine(k)}
          onPush={() => { void lootOpen.push(null); log(<>Pushed <span className={styles.obj}>{lootOpen.roll?.container?.name}</span> to the party</>, 'cyan') }}
          onReroll={() => {
            const t = lootOpen.roll?.table_id
            const row = t ? lootLib.tables.find(r => r.id === t) : null
            if (row) void rollLootTable(row.id, lootContent(row))
          }}
          onClose={() => {
            const left = (lootOpen.roll?.lines ?? []).filter(l => !l.assigned_to).length
            void lootOpen.close()
            setLootMin(false)
            log(<>Closed the loot roll{left ? ` · ${left} line${left === 1 ? '' : 's'} left unassigned` : ''}</>, 'danger')
          }}
          onMinimize={() => setLootMin(true)}
        />
      )}

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
function ActionsTab({ row, member, catalog, featureLib, effectLib, spellLib, classLib, raceLib, shardCatalog, onUpdate, onVoice, log }: {
  row: CharacterRow
  member: PartyMember
  catalog: CatalogItemRow[]
  featureLib: CatalogFeatureRow[]
  effectLib: CatalogEffectRow[]
  spellLib: CatalogSpellRow[]
  classLib: DmClassesState
  raceLib: DmRacesState
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
        <span className={styles.selPortrait}><Icon name={member.icon} /></span>
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

        {/* B — CURRENCY */}
        <div className={styles.actCard}>
          <div className={styles.acTitle}><i className="fa-solid fa-coins lead" /><span className={styles.num}>B</span><span className={styles.t}>Currency</span></div>
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

        {/* C — APPLY EFFECT: push a status effect onto this PC (slice 6) */}
        <ApplyEffectCard member={member} effectLib={effectLib} row={row} onUpdate={onUpdate} onVoice={onVoice} log={log} />

        {/* D — GRANT ITEM: snapshot a catalog template into this PC's inventory */}
        <GrantItemCard member={member} catalog={catalog} row={row} onUpdate={onUpdate} onVoice={onVoice} log={log} />

        {/* E — ABILITY SCORES (wide): six numbers read as one block, and the
            base -> effective readout needs the room. */}
        <AbilityScoresCard
          member={member} row={row} shardCatalog={shardCatalog} onUpdate={onUpdate} log={log}
        />

        {/* F — STATUS: death saves + exhaustion (wide) */}
        <div className={cx(styles.actCard, styles.wide)}>
          <div className={styles.acTitle}><i className="fa-solid fa-heart-crack lead" /><span className={styles.num}>F</span><span className={styles.t}>Status</span></div>
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

        {/* ---- COLLAPSED BY DEFAULT ----
            Everything above is what a DM touches mid-session; everything below is
            character BUILD — set once, revisited rarely. Folding it keeps the tab
            scannable without hiding it, and each folder groups the two cards that
            are always edited together. */}
        {/* RACE, CLASS AND SKILLS ARE ONE ACT, so they are one folder. Assigning
            a race or a class PARKS a skill prompt (`sheet.pendingSkills`) for
            the player's picks, and the proficiency card is where those get
            resolved — three folders meant opening three to finish one job, and
            the middle one silently changed what the third was showing.

            Order inside is the order they happen: race is the half of a
            character that exists before any class does, and its skill prompt
            wants to be parked before a class overwrites the same slot; the
            training both of them granted reads last. */}
        <Folder label="Race, Class & Skills" icon="fa-user-shield">
        <AssignRaceCard
          member={member} row={row} raceLib={raceLib} featureLib={featureLib}
          shardCatalog={shardCatalog} onUpdate={onUpdate} log={log}
        />

        <AssignClassCard
          member={member} row={row} classLib={classLib} featureLib={featureLib}
          itemCatalog={catalog} shardCatalog={shardCatalog} onUpdate={onUpdate} log={log}
        />

        <ProficienciesCard member={member} row={row} classLib={classLib} onUpdate={onUpdate} log={log} />
        </Folder>

        <Folder label="Spells" icon="fa-hat-wizard">
        <CasterProfileCard key={row.id} member={member} row={row} onUpdate={onUpdate} log={log} />

        <GrantSpellCard member={member} row={row} spellLib={spellLib} onUpdate={onUpdate} onVoice={onVoice} log={log} />
        </Folder>

        <Folder label="Features" icon="fa-star">
        <GrantFeatureCard member={member} row={row} featureLib={featureLib} onUpdate={onUpdate} onVoice={onVoice} log={log} />

        <FeatureStateCard member={member} row={row} shardCatalog={shardCatalog} onUpdate={onUpdate} log={log} />
        </Folder>

        <Folder label="Standing & Story" icon="fa-ranking-star">
        <StandingCard key={row.id} member={member} row={row} onUpdate={onUpdate} log={log} />
        </Folder>

      </div>

    </>
  )
}

// ============================================================
// STANDING & STORY (Actions card L) — the two readouts the player
// screens render and nothing could write.
// ============================================================

/** Reputation drives the Topbar's 00-100 bar; `progress.stories[]` IS the Codex
 *  home screen — its three cards render from nothing else, and Codex.tsx's empty
 *  state literally told you to seed the row by hand. Both were readable by the
 *  player and unsettable by the DM, which is the same gap twice.
 *
 *  One card because it is one act: what this character's standing looks like
 *  right now. One save, one patch — `identity` and `progress` are different
 *  sections, so they go in a single update rather than two writes that every
 *  realtime subscriber would see as two separate events. */
function StandingCard({ member, row, onUpdate, log }: {
  member: PartyMember
  row: CharacterRow
  onUpdate: (patch: CharacterUpdate) => Promise<boolean>
  log: (node: ReactNode, kind?: 'cyan' | 'danger') => void
}) {
  const first = firstName(member.name)
  const [rep, setRep] = useState(row.identity?.reputation ?? 0)
  const [stories, setStories] = useState<ProgressStory[]>(() => row.progress?.stories ?? [])
  const [busy, setBusy] = useState(false)

  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n) || 0))
  const patchStory = (i: number, patch: Partial<ProgressStory>) =>
    setStories(list => list.map((st, j) => (j === i ? { ...st, ...patch } : st)))
  const move = (i: number, by: number) => setStories(list => {
    const j = i + by
    if (j < 0 || j >= list.length) return list
    const next = [...list]
    const tmp = next[i]
    next[i] = next[j]
    next[j] = tmp
    return next
  })
  const addStory = () => setStories(list => [...list, {
    // Stable within the row is all this needs to be: it is a React key, and the
    // Codex renders these by position.
    id: 'story-' + Date.now().toString(36),
    title: '', label: '', emblem: 'character', percent: 0,
  }])

  async function save() {
    setBusy(true)
    const ok = await onUpdate({
      identity: { ...row.identity, reputation: clamp(rep) },
      progress: { ...row.progress, stories },
    } as CharacterUpdate)
    setBusy(false)
    if (ok) {
      log(<>Standing of <span className={styles.who}>{first}</span> to <span className={styles.obj}>REP {clamp(rep)}</span> · {stories.length} {stories.length === 1 ? 'story' : 'stories'}</>)
    }
  }

  return (
    <div className={styles.actCard}>
      <div className={styles.acTitle}><i className="fa-solid fa-ranking-star lead" /><span className={styles.num}>N</span><span className={styles.t}>Standing &amp; Story</span></div>

      <div className={styles.catGrid2}>
        <div>
          <span className={styles.fieldLab}>Reputation</span>
          <input
            className={styles.sessIn} type="number" min={0} max={100} value={rep}
            onChange={e => setRep(clamp(parseInt(e.target.value || '0', 10)))}
          />
        </div>
        <div>
          <span className={styles.fieldLab}>Topbar reads</span>
          {/* The same 0-100 bar the player sees, so the number is set against the
              thing it renders rather than in the abstract. */}
          <div className={styles.stdBar}><i style={{ width: clamp(rep) + '%' }} /></div>
          <span className={styles.stdBarNum}>{clamp(rep).toString().padStart(2, '0')} / 100</span>
        </div>
      </div>

      <div className={styles.efBh}>
        <span>Story Progress</span>
        <span className={styles.efRule} />
        <span className={styles.stdCount}>{stories.length} {stories.length === 1 ? 'card' : 'cards'} on the Codex</span>
      </div>

      {stories.length === 0 && (
        <div className={styles.efNone}>No cards — the player&apos;s Codex home shows its empty state.</div>
      )}

      {stories.map((st, i) => (
        <div key={st.id} className={styles.stdStory}>
          <div className={styles.stdHead}>
            <select
              className={styles.selIn} value={st.emblem} aria-label="Emblem"
              onChange={e => patchStory(i, { emblem: e.target.value as ProgressStory['emblem'] })}
            >
              <option value="character">Character</option>
              <option value="main">Main Story</option>
              <option value="region">Region</option>
            </select>
            <input
              className={styles.sessIn} value={st.title} placeholder="Title — e.g. The Reclamation"
              aria-label="Title" {...NO_AUTOFILL}
              onChange={e => patchStory(i, { title: e.target.value })}
            />
            <span className={styles.stdMove}>
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up"><i className="fa-solid fa-angle-up" /></button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === stories.length - 1} aria-label="Move down"><i className="fa-solid fa-angle-down" /></button>
              <button type="button" className={styles.stdDel} onClick={() => setStories(l => l.filter((_, j) => j !== i))} aria-label="Remove"><i className="fa-solid fa-xmark" /></button>
            </span>
          </div>

          <div className={styles.catGrid3}>
            <div>
              <span className={styles.fieldLab}>Label</span>
              <input className={styles.sessIn} value={st.label} placeholder="e.g. Chapter II" {...NO_AUTOFILL}
                onChange={e => patchStory(i, { label: e.target.value })} />
            </div>
            <div>
              <span className={styles.fieldLab}>Percent</span>
              <input className={styles.sessIn} type="number" min={0} max={100} value={st.percent}
                onChange={e => patchStory(i, { percent: clamp(parseInt(e.target.value || '0', 10)) })} />
            </div>
            <div>
              <span className={styles.fieldLab}>Chapter</span>
              <input className={styles.sessIn} value={st.chapter ?? ''} placeholder="optional" {...NO_AUTOFILL}
                onChange={e => patchStory(i, { chapter: e.target.value || undefined })} />
            </div>
          </div>

          <div className={styles.catGrid2}>
            <div>
              <span className={styles.fieldLab}>Telemetry</span>
              <input className={styles.sessIn} value={st.telemetry ?? ''} placeholder="small mono line under the title" {...NO_AUTOFILL}
                onChange={e => patchStory(i, { telemetry: e.target.value || undefined })} />
            </div>
            <div>
              <span className={styles.fieldLab}>Hover text</span>
              <input className={styles.sessIn} value={st.tooltip ?? ''} placeholder="shown on hover" {...NO_AUTOFILL}
                onChange={e => patchStory(i, { tooltip: e.target.value || undefined })} />
            </div>
          </div>
        </div>
      ))}

      <div className={styles.efAdd}>
        <Btn tone="ghost" icon="fa-plus" label="Add Story Card" onClick={addStory} />
      </div>

      <div className={styles.grantAction}>
        <Btn tone="amber" icon="fa-floppy-disk" label={busy ? 'Saving…' : 'Save Standing'} onClick={() => void save()} disabled={busy} />
      </div>
    </div>
  )
}

// ============================================================
// LOOT LIBRARY (Catalog · Loot tab) — named roll tables.
//
// The seventh authoring library, same list+form shell as Classes and Races. A
// table is a list of things that MIGHT be somewhere, each with its own quantity
// range and its own chance; lib/loot.ts rollLoot is the only implementation of
// the roll, and the DM card on the Actions tab is its only caller.
//
// ROWS ROLL INDEPENDENTLY, which is why the header shows an EXPECTED YIELD and
// a chance-of-nothing rather than asking the percentages to sum to 100. Five
// rows at 5% look like a full table and produce nothing four times in five —
// invisible until you either do that arithmetic or roll it twenty times.
// ============================================================

const BLANK_LOOT: LootTable = { name: '', icon: 'fa-box-open', desc: '', rows: [], published: false }

const COIN_LABEL: Record<'gold' | 'silver' | 'copper', string> = {
  gold: 'Gold', silver: 'Silver', copper: 'Copper',
}

function LootLibrarySurface({ lib, itemCatalog, onRoll, openLootId, onResume }: {
  lib: DmLootState
  itemCatalog: CatalogItemRow[]
  onRoll: (id: string, table: LootTable) => void
  openLootId: string | null
  onResume: () => void
}) {
  const { tables, loading } = lib
  const [selId, setSelId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [query, setQuery] = useState('')

  const shown = useMemo(() => {
    const q = parseCatalogQuery(query)
    return tables.filter(r => matchesCatalogQuery(lootContent(r), q))
  }, [tables, query])

  const activeId = creating ? null : (selId ?? tables[0]?.id ?? null)
  const selected = tables.find(r => r.id === activeId) ?? null

  return (
    <div className={styles.catLayout}>
      <div className={styles.catIndex}>
        <div className={styles.catNew}>
          <Btn tone="cyan" icon="fa-plus" label="New Table" onClick={() => { setCreating(true); setSelId(null) }} />
        </div>
        <div className={cx(styles.searchWrap, styles.catSearch)}>
          <i className="fa-solid fa-magnifying-glass" />
          <input className={styles.searchIn} value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search loot tables…" autoComplete="off" spellCheck={false} />
          {query && <i className={cx('fa-solid fa-xmark', styles.catSearchClr)} onClick={() => setQuery('')} />}
        </div>
        <div className={styles.catRows}>
          {shown.map(r => {
            const d = lootContent(r)
            const rows = (d.rows ?? []).length
            const rolling = openLootId === r.id
            return (
              <div key={r.id} className={styles.lootIndexRow}>
              <button className={cx(styles.catRow, r.id === activeId && !creating && styles.sel)}
                style={{ ['--rar' as string]: 'var(--amber)' }} onClick={() => { setCreating(false); setSelId(r.id) }}>
                <span className={styles.crIc}><Icon name={d.icon || 'fa-box-open'} /></span>
                <span className={styles.crTx}>
                  <span className={styles.crT}>{d.name || 'Untitled'}</span>
                  <span className={styles.crS}>
                    {/* Kind leads, because that is how the DM thinks of the row
                        — "the corpse", "the strongbox" — and the line count is
                        the detail underneath. */}
                    {d.kind?.trim() || 'Container'}<span className={styles.op}> · </span>
                    {rows} line{rows === 1 ? '' : 's'}
                    {r.draft && <><span className={styles.op}> · </span>draft</>}
                    {!r.draft && !d.published && <><span className={styles.op}> · </span>unpublished</>}
                    {rolling && <><span className={styles.op}> · </span><span className={styles.rollOpen}>roll open</span></>}
                  </span>
                </span>
              </button>
              {/* Rolling is a different verb from editing, so it is a separate
                  control rather than a mode of the row. Resume reopens a roll
                  the DM minimized; rolling again would discard it. */}
              <button type="button" className={cx(styles.lootRollBtn, rolling && styles.on)}
                title={rolling ? 'Reopen this roll' : 'Roll this table'}
                onClick={e => { e.stopPropagation(); if (rolling) onResume(); else onRoll(r.id, d) }}>
                {rolling ? 'Resume' : 'Roll'} <span className={styles.arr}>▸</span>
              </button>
              </div>
            )
          })}
        </div>
        {tables.length === 0 && <div className={styles.catEmpty}>{loading ? '· loading ·' : '— library empty —'}</div>}
        {tables.length > 0 && shown.length === 0 && <div className={styles.catEmpty}>— nothing matches —</div>}
      </div>

      <div className={styles.catForm}>
        <LootForm
          row={selected} creating={creating} lib={lib} itemCatalog={itemCatalog}
          onSelected={id => { setCreating(false); setSelId(id) }}
          onCleared={() => { setCreating(false); setSelId(null) }}
        />
      </div>
    </div>
  )
}

function LootForm({ row, creating, lib, itemCatalog, onSelected, onCleared }: {
  row: CatalogLootRow | null
  creating: boolean
  lib: DmLootState
  itemCatalog: CatalogItemRow[]
  onSelected: (id: string) => void
  onCleared: () => void
}) {
  const selId = row?.id ?? null
  const base = creating ? BLANK_LOOT : row ? lootContent(row) : null
  const { draft, dirty, savedAt, update, reset, clear } =
    useLocalDraft<LootTable>(creating ? 'loot:__new__' : `loot:${selId ?? 'none'}`, base)

  const [confirm, setConfirm] = useState<null | 'revert' | 'delete'>(null)
  const [pick, setPick] = useState<number | null>(null)
  // Add-From-Catalog panel. Its own filters rather than the row-level picker's:
  // this one APPENDS lines and is used repeatedly while building a table, so it
  // stays open and keeps its narrowing between picks.
  const [pickQ, setPickQ] = useState('')
  const [pickRar, setPickRar] = useState<ItemRarity | 'all'>('all')
  const [pickCat, setPickCat] = useState<ItemCategory | 'all'>('all')

  const set = (p: Partial<LootTable>) => update(x => ({ ...x, ...p }))
  const rows = draft?.rows ?? []
  const setRow = (i: number, p: Partial<LootRow>) =>
    update(x => ({ ...x, rows: (x.rows ?? []).map((r, j) => (j === i ? { ...r, ...p } as LootRow : r)) }))
  const moveRow = (i: number, by: number) => update(x => {
    const list = [...(x.rows ?? [])]
    const j = i + by
    if (j < 0 || j >= list.length) return x
    const tmp = list[i]; list[i] = list[j]; list[j] = tmp
    return { ...x, rows: list }
  })

  const byId = useMemo(() => new Map(itemCatalog.map(r => [r.id, r.data])), [itemCatalog])
  /** How many catalog items a pool query matches right now. Recomputed per
   *  keystroke against a map that is already in memory, so no caching earns
   *  its keep here. */
  const poolCount = useCallback((from: string) => poolItems(from, byId).length, [byId])
  /** The Add-From-Catalog list. Text goes through the same parseCatalogQuery as
   *  every other index, so `tag:martial !relic` narrows here too; the chips are
   *  a separate axis on top of it. */
  const pickable = useMemo(() => {
    const q = parseCatalogQuery(pickQ)
    return itemCatalog.filter(r => {
      if (pickRar !== 'all' && (r.data?.rarity ?? 'common') !== pickRar) return false
      if (pickCat !== 'all' && (r.data?.category ?? 'misc') !== pickCat) return false
      return matchesCatalogQuery(r.data, q)
    }).slice(0, 60)
  }, [itemCatalog, pickQ, pickRar, pickCat])
  const yields = useMemo(() => (draft ? expectedYield(draft) : null), [draft])
  const nothing = useMemo(() => (draft ? chanceOfNothing(draft) : 1), [draft])

  const audit: AuditItem[] = useMemo(() => {
    if (!draft) return []
    const out: AuditItem[] = []
    if (!draft.name?.trim()) {
      out.push({ sev: 'err', id: 'field:name', t: 'Unnamed table', s: 'A loot table needs a name before it can be rolled.' })
    }
    (draft.rows ?? []).forEach((r, i) => {
      const where = `Row ${i + 1}`
      if (r.kind === 'item' && !byId.has(r.item_id)) {
        out.push({
          sev: 'err', id: `row:${i}`, t: `${where} points at a missing item`,
          s: 'That item is no longer in the catalog. The roll reports it rather than quietly yielding less — fix or remove the row.',
        })
      }
      if (r.kind === 'pool') {
        if (!r.from.trim()) {
          out.push({
            sev: 'err', id: `row:${i}`, t: `${where} has no query`,
            s: 'An empty query would mean "any item in the game". It resolves to nothing instead — say what the row should pick from.',
          })
        } else if (!poolCount(r.from)) {
          out.push({
            sev: 'err', id: `row:${i}`, t: `${where} matches no items`,
            s: `Nothing in the catalog matches ${r.from}. A misspelt tag yields silently forever — the row would just never produce anything.`,
          })
        } else if (!hasPositiveTerm(parseCatalogQuery(r.from))) {
          out.push({
            sev: 'warn', id: `row:${i}`, t: `${where} only excludes`,
            s: `${r.from} says what NOT to pick, so the row draws from the whole catalog minus those. Add a term saying what it should be.`,
          })
        }
      }
      if (r.chance <= 0 || r.chance > 100) {
        out.push({ sev: 'err', id: `row:${i}`, t: `${where} has an impossible chance`, s: `${r.chance}% — a chance must be between 1 and 100.` })
      }
      if (r.max < r.min) {
        out.push({ sev: 'err', id: `row:${i}`, t: `${where} has an inverted range`, s: `Max (${r.max}) is below min (${r.min}).` })
      }
    })
    if (!rows.length) {
      out.push({ sev: 'warn', id: null, t: 'No rows', s: 'An empty table always rolls nothing.' })
    } else if (nothing > 0.75) {
      out.push({
        sev: 'warn', id: null, t: 'Usually yields nothing',
        s: `${Math.round(nothing * 100)}% of rolls come up completely empty. Raise some chances, or that is what the table is for.`,
      })
    }
    if (!out.length) out.push({ sev: 'ok', id: null, t: 'Clean', s: 'No errors, no warnings. Safe to publish.' })
    return out
  }, [draft, byId, rows.length, nothing])

  const errs = audit.filter(a => a.sev === 'err').length
  const warns = audit.filter(a => a.sev === 'warn').length

  /* Typing saves; a clean record publishes itself. `creating ? null : selId`
     is the id contract the writers already had — the first write of a new
     record mints one, and onCreated adopts it so the next keystroke updates
     that row instead of inserting another. */
  const { busy: autoBusy } = useAutoPublish<LootTable>({
    draft, dirty, errs, id: creating ? null : selId,
    saveDraft: (id, value) => lib.saveDraft(id, value),
    publish: (id, value) => lib.publishTable(id, value),
    onCreated: id => { clear(); onSelected(id) },
  })
  function onRevert() {
    setConfirm(null)
    reset(row ? row.data : null)
    if (!row) onCleared()
  }
  async function onDuplicate() {
    if (!selId) return
    const id = await lib.duplicateTable(selId)
    if (id) onSelected(id)
  }
  async function onDelete() {
    if (!selId) return
    setConfirm(null)
    await lib.deleteTable(selId)
    clear(); onCleared()
  }

  /* AFTER every hook, never before one. This guard used to sit higher, and
     `useAutoPublish` below it is a hook where onSaveDraft/onPublish used to
     be plain functions — so the render after a delete (draft becomes null)
     called fewer hooks than the one before it and React tore the tree down:
     "Rendered fewer hooks than expected." */
  if (!draft) {
    return <div className={styles.catEmpty} style={{ marginTop: 40 }}>Select a loot table, or start a new one.</div>
  }

  return (
    <div className={styles.clsForm}>
      <div className={styles.catFormHead}>
        <Icon name={draft.icon || 'fa-box-open'} />
        <span className={styles.cfhT}>{draft.name || (creating ? 'New Loot Table' : 'Untitled')}</span>
        <span className={styles.cfhId}>{rows.length} row{rows.length === 1 ? '' : 's'}</span>
      </div>

      {/* The container as the PLAYER will meet it. Every field below feeds this
          card, which is the point of showing it: `kind` and `location` are
          flavour that only makes sense read together with the name. */}
      <div className={styles.catPrev} style={{ ['--rar' as string]: 'var(--amber)' }}>
        <span className={styles.pvCell}>
          <Icon name={draft.icon || 'fa-box-archive'} />
          <span className={styles.pvCorner}><i className="fa-solid fa-dice-d6" /></span>
        </span>
        <span className={styles.pvTx}>
          <span className={styles.pvName}>{draft.name || 'Untitled Loot Table'}</span>
          <span className={styles.pvMeta}>
            <span>{draft.kind?.trim() || 'Container'}</span>
            <span className={styles.rar}>{rows.length} line{rows.length === 1 ? '' : 's'}</span>
            <span>~{(yields?.items ?? 0).toFixed(1)} expected drops</span>
          </span>
        </span>
      </div>

      <div className={styles.catGrid2}>
        <div>
          <span className={styles.fieldLab}>Name</span>
          <input data-audit="field:name" className={styles.sessIn} value={draft.name}
            placeholder="e.g. The Drowned Quartermaster" {...NO_AUTOFILL}
            onChange={e => set({ name: e.target.value })} />
        </div>
        <div>
          <span className={styles.fieldLab}>Icon</span>
          <IconPicker value={draft.icon} onPick={ic => set({ icon: ic })} />
        </div>
      </div>

      <div className={styles.catGrid2}>
        <div>
          <span className={styles.fieldLab}>
            Kind <span className={styles.labHint}>· chest, corpse, bookshelf, reliquary — freeform</span>
          </span>
          <input className={styles.sessIn} value={draft.kind ?? ''}
            placeholder="e.g. Corpse" {...NO_AUTOFILL}
            onChange={e => set({ kind: e.target.value })} />
        </div>
        <div>
          <span className={styles.fieldLab}>Location <span className={styles.labHint}>· optional</span></span>
          <input className={styles.sessIn} value={draft.location ?? ''}
            placeholder="e.g. Sunken Hold · Deck Three" {...NO_AUTOFILL}
            onChange={e => set({ location: e.target.value })} />
        </div>
      </div>

      {/* Player-facing since the takeover renders it. It was a DM note that
          nothing displayed, which is why it carried no markdown and no badge. */}
      <div className={styles.qLabRow}>
        <span className={styles.fieldLab}>Description</span>
        <span className={cx(styles.qFacing, styles.player)}><i className="fa-solid fa-eye" /> Player-facing</span>
        <ProsePreview text={draft.desc ?? ''} />
      </div>
      <textarea className={styles.catProse} value={draft.desc ?? ''}
        placeholder="The prose the player reads when the loot is pushed…"
        onKeyDown={markdownShortcuts(desc => set({ desc }))}
        onChange={e => set({ desc: e.target.value })} />

      {/* THE ONE NUMBER THAT SAYS WHETHER THE TABLE IS TUNED. Rows roll
          independently, so the percentages tell you nothing on their own. */}
      <div className={styles.efBh}>
        <span>Rows</span>
        <span className={styles.efRule} />
        <span className={styles.lootYield}>
          {rows.length === 0 ? 'empty' : <>
            ~{yields!.items.toFixed(1)} item{yields!.items === 1 ? '' : 's'}
            {(yields!.coins.gold + yields!.coins.silver + yields!.coins.copper) > 0 && <>
              {' · ~'}
              {[
                yields!.coins.gold ? `${yields!.coins.gold.toFixed(0)}g` : '',
                yields!.coins.silver ? `${yields!.coins.silver.toFixed(0)}s` : '',
                yields!.coins.copper ? `${yields!.coins.copper.toFixed(0)}c` : '',
              ].filter(Boolean).join(' ')}
            </>}
            <span className={cx(styles.lootEmpty, nothing > 0.75 && styles.bad)}>
              {' · '}{Math.round(nothing * 100)}% empty
            </span>
          </>}
        </span>
      </div>

      {rows.length === 0 && <div className={styles.efNone}>No rows — this table always rolls nothing.</div>}

      {rows.map((r, i) => {
        const item = r.kind === 'item' ? byId.get(r.item_id) : null
        const gone = r.kind === 'item' && !item
        return (
          <div key={i} data-audit={`row:${i}`} className={cx(styles.lootRow, gone && styles.bad)}>
            <select className={styles.selIn} value={r.kind} aria-label="Row kind"
              onChange={e => {
                const kind = e.target.value as LootRow['kind']
                update(x => ({
                  ...x,
                  rows: (x.rows ?? []).map((old, j) => {
                    if (j !== i) return old
                    // Range and chance survive every switch — they are the row's,
                    // not the kind's, and retyping "1-10, 50%" because you picked
                    // the wrong kind first is pure friction.
                    const keep = { min: old.min, max: old.max, chance: old.chance }
                    if (kind === 'coin') return { kind: 'coin', coin: 'gold', ...keep }
                    if (kind === 'pool') return { kind: 'pool', from: '', ...keep }
                    return { kind: 'item', item_id: '', ...keep }
                  }),
                }))
              }}>
              <option value="item">Item</option>
              <option value="pool">Any of…</option>
              <option value="coin">Coin</option>
            </select>

            {r.kind === 'coin' ? (
              <select className={styles.selIn} value={r.coin} aria-label="Denomination"
                onChange={e => setRow(i, { coin: e.target.value as 'gold' | 'silver' | 'copper' })}>
                {(['gold', 'silver', 'copper'] as const).map(c => <option key={c} value={c}>{COIN_LABEL[c]}</option>)}
              </select>
            ) : r.kind === 'pool' ? (
              /* A query, not a picker. The live count is the whole safety net:
                 `tag:martail` is a typo that silently matches nothing, and the
                 only moment anyone would notice is a chest that never yields —
                 long after authoring. */
              <span className={styles.lootPool}>
                <i className="fa-solid fa-filter" aria-hidden="true" />
                <input className={styles.lootPoolIn} value={r.from}
                  onChange={e => setRow(i, { from: e.target.value })}
                  placeholder="tag:martial !relic"
                  aria-label="Pool query" autoComplete="off" spellCheck={false} />
                <span className={cx(styles.lootPoolN, !poolCount(r.from) && styles.bad)}>
                  {poolCount(r.from)} match{poolCount(r.from) === 1 ? '' : 'es'}
                </span>
              </span>
            ) : (
              <button type="button" className={cx(styles.lootPick, gone && styles.bad)} onClick={() => setPick(i)}>
                {item ? <><Icon name={item.icon || 'fa-box'} /> {item.name}</>
                  : r.item_id ? <><i className="fa-solid fa-triangle-exclamation" /> missing item</>
                    : <><i className="fa-solid fa-magnifying-glass" /> pick an item…</>}
              </button>
            )}

            <span className={styles.lootRange}>
              <input className={styles.sessIn} type="number" min={0} value={r.min} aria-label="Minimum"
                onChange={e => setRow(i, { min: Math.max(0, parseInt(e.target.value || '0', 10) || 0) })} />
              <span className={styles.op}>–</span>
              <input className={styles.sessIn} type="number" min={0} value={r.max} aria-label="Maximum"
                onChange={e => setRow(i, { max: Math.max(0, parseInt(e.target.value || '0', 10) || 0) })} />
            </span>

            <span className={styles.lootChance}>
              <input className={styles.sessIn} type="number" min={1} max={100} value={r.chance} aria-label="Chance percent"
                onChange={e => setRow(i, { chance: Math.max(0, Math.min(100, parseInt(e.target.value || '0', 10) || 0)) })} />
              <span className={styles.op}>%</span>
            </span>

            <span className={styles.stdMove}>
              <button type="button" onClick={() => moveRow(i, -1)} disabled={i === 0} aria-label="Move up"><i className="fa-solid fa-angle-up" /></button>
              <button type="button" onClick={() => moveRow(i, 1)} disabled={i === rows.length - 1} aria-label="Move down"><i className="fa-solid fa-angle-down" /></button>
              <button type="button" className={styles.stdDel} aria-label="Remove row"
                onClick={() => update(x => ({ ...x, rows: (x.rows ?? []).filter((_, j) => j !== i) }))}><i className="fa-solid fa-xmark" /></button>
            </span>
          </div>
        )
      })}

      <div className={styles.efAdd}>
        <Btn tone="ghost" icon="fa-plus" label="Add Row"
          onClick={() => update(x => ({ ...x, rows: [...(x.rows ?? []), { kind: 'item', item_id: '', min: 1, max: 1, chance: 50 }] }))} />
      </div>

      {/* ADD FROM CATALOG — the same panel the Shop stock form uses, because in
          the mockup they are the same control and the DM does the same job at
          both: browse the catalog, click, keep browsing.

          It APPENDS a line rather than filling one in, which is why it lives
          below the rows and keeps its filters between picks. The per-row picker
          above is the other direction — changing what an existing line points
          at — and both are worth having. */}
      <div className={styles.skPick}>
        <div className={styles.catFxHead}>
          <i className="fa-solid fa-box-open" />
          <span className={styles.t}>Add From Catalog</span>
          <span className={styles.s}>each line rolls independently — chance and quantity are yours to tune</span>
        </div>
        <div className={styles.searchWrap}>
          <i className="fa-solid fa-magnifying-glass" />
          <input className={styles.searchIn} value={pickQ} onChange={e => setPickQ(e.target.value)}
            placeholder="Search the item catalog…" autoComplete="off" spellCheck={false} />
        </div>
        <div className={styles.skFilters}>
          <div>
            <div className={styles.fl}>Rarity</div>
            <div className={styles.acRow}>
              <span className={cx(styles.acChip, pickRar === 'all' && styles.on)} onClick={() => setPickRar('all')}>All</span>
              {RAR_ORDER.map(r => (
                <span key={r} className={cx(styles.acChip, pickRar === r && styles.on)}
                  onClick={() => setPickRar(r)}>{RAR_DEF[r].label}</span>
              ))}
            </div>
          </div>
          <div>
            <div className={styles.fl}>Category</div>
            <div className={styles.acRow}>
              <span className={cx(styles.acChip, pickCat === 'all' && styles.on)} onClick={() => setPickCat('all')}>All</span>
              {CAT_ORDER.map(c => (
                <span key={c} className={cx(styles.acChip, pickCat === c && styles.on)}
                  onClick={() => setPickCat(c)}>{CAT_DEF[c].label}</span>
              ))}
            </div>
          </div>
        </div>
        <div className={styles.skPicklist}>
          {pickable.length === 0
            ? <div className={styles.catFxNone}>No catalog items match this filter.</div>
            : pickable.map(it => {
              const rar = it.data?.rarity ?? 'common'
              return (
                <button key={it.id} type="button" className={styles.skPi}
                  style={{ ['--rar' as string]: RAR_DEF[rar].token }}
                  onClick={() => update(x => ({
                    ...x,
                    rows: [...(x.rows ?? []), { kind: 'item', item_id: it.id, min: 1, max: 1, chance: 50 }],
                  }))}>
                  <span className={styles.piIc}><Icon name={it.data?.icon || 'fa-box'} /></span>
                  <span className={styles.piT}>{it.data?.name ?? 'Untitled'}</span>
                  <span className={styles.piM}>{RAR_DEF[rar].label}</span>
                </button>
              )
            })}
        </div>
      </div>

      {/* .clsAudit, the same wrapper the Class and Race forms use — .catFx is the
          amber chamfered box the EFFECTS fold lives in, and wearing it made this
          panel read as a different kind of thing from its two siblings. */}
      <div className={styles.clsAudit}>
        <AuditPanel title="Loot Audit" audit={audit} onJump={a => revealAudit(a.id)} />
      </div>

      <div className={styles.clsBar}>
        {/* INSIDE the sticky footer, not above it. The footer pins itself to
            the bottom of the scroller, so its Delete button is always on
            screen — while a confirm rendered as a preceding sibling sat far
            down the scrolling flow, off screen, and the click read as a
            no-op. A confirmation has to appear where the control that opened
            it is. */}
        {confirm === 'revert' && (
          <div className={styles.skWarn}>
            <i className="fa-solid fa-triangle-exclamation" />
            <span>
              <b>Discard this draft?</b>{' '}
              {row?.data?.published
                ? 'The published version comes back.'
                : 'This table has never been published, so discarding removes it entirely.'}
            </span>
            <Btn tone="danger" sm icon="fa-rotate-left" label="Discard" onClick={onRevert} />
            <Btn tone="ghost" sm icon="fa-xmark" label="Cancel" onClick={() => setConfirm(null)} />
          </div>
        )}
        {confirm === 'delete' && (
          <div className={styles.skWarn}>
            <i className="fa-solid fa-triangle-exclamation" />
            <span><b>Delete {draft.name || 'this table'}?</b> Nothing already granted from it is affected.</span>
            <Btn tone="danger" sm icon="fa-trash" label="Delete" onClick={() => void onDelete()} />
            <Btn tone="ghost" sm icon="fa-xmark" label="Cancel" onClick={() => setConfirm(null)} />
          </div>
        )}
        <div className={styles.clsBarInfo}>
          <div className={cx(styles.clsStat, errs ? styles.bad : warns ? styles.warn : undefined)}>
            <span className={styles.dot} />
            <span>
              {errs ? `${errs} error${errs === 1 ? '' : 's'} — publish blocked`
                : warns ? `${warns} warning${warns === 1 ? '' : 's'} — publishable`
                  : 'Draft valid · publishable'}
            </span>
          </div>
          {/* Replaces the Save/Publish buttons as the thing you read to know
              where the work is. An error is not a failure to save — it saved,
              as a draft; it is a refusal to publish. */}
          <span className={cx(styles.clsDirty, (autoBusy || dirty) && styles.on)}>
            {autoBusy ? '● Saving…'
              : errs > 0 ? '● Draft — errors block publish'
                : dirty ? '● Saving…'
                  : '● Published automatically'}
          </span>
          <span className={styles.clsSaved}>
            {savedAt ? `Autosaved ${savedAt.toLocaleTimeString([], { hour12: false })}` : ''}
          </span>
        </div>
        {selId && (
          <div className={cx(styles.clsActs, styles.rowActs)}>
            <Btn tone="ghost" sm icon="fa-clone" label="Duplicate" onClick={() => void onDuplicate()} />
            <Btn tone="ghost" sm icon="fa-trash" label="Delete" onClick={() => setConfirm('delete')} />
          </div>
        )}
        {/* No Save Draft, no Publish: typing saves, and a clean record publishes
            itself. Revert stays because throwing work away must never be
            something that happens automatically. */}
        <div className={styles.clsActs}>
          <Btn tone="ghost" sm icon="fa-rotate-left" label="Revert" onClick={() => setConfirm('revert')} disabled={!dirty} />
        </div>
      </div>

      {pick !== null && (
        <LootItemPicker
          catalog={itemCatalog}
          onClose={() => setPick(null)}
          onPick={id => { setRow(pick, { item_id: id }); setPick(null) }}
        />
      )}
    </div>
  )
}

/** Item chooser for a loot row. Its own overlay rather than a long select: the
 *  catalog is searched by name and tag through the same parseCatalogQuery the
 *  library index uses. */
function LootItemPicker({ catalog, onPick, onClose }: {
  catalog: CatalogItemRow[]
  onPick: (id: string) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const shown = useMemo(() => {
    const parsed = parseCatalogQuery(q)
    return catalog.filter(r => matchesCatalogQuery(r.data, parsed)).slice(0, 60)
  }, [catalog, q])

  return createPortal(
    <div className={styles.lootScrim} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={styles.lootPop} role="dialog" aria-label="Pick an item">
        <div className={styles.lootPopHead}>
          <i className="fa-solid fa-box" />
          <span>Pick an item</span>
          <button type="button" className={styles.lootPopX} onClick={onClose} aria-label="Close"><i className="fa-solid fa-xmark" /></button>
        </div>
        <div className={cx(styles.searchWrap, styles.catSearch)}>
          <i className="fa-solid fa-magnifying-glass" />
          <input className={styles.searchIn} value={q} onChange={e => setQ(e.target.value)} autoFocus
            placeholder="Search items, or tag:fire" autoComplete="off" spellCheck={false} />
        </div>
        <div className={styles.lootPopList}>
          {shown.map(r => (
            <button key={r.id} type="button" className={styles.catRow} onClick={() => onPick(r.id)}>
              <span className={styles.crIc}><Icon name={r.data?.icon || 'fa-box'} /></span>
              <span className={styles.crTx}>
                <span className={styles.crT}>{r.data?.name ?? r.id}</span>
                <span className={styles.crS}>{r.data?.category ?? 'gear'}</span>
              </span>
            </button>
          ))}
          {!shown.length && <div className={styles.catEmpty}>— nothing matches —</div>}
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ============================================================
// ABILITY SCORES (Actions card B) — the six numbers everything
// else on the sheet is computed from.
// ============================================================

/** The six ability scores, editable at last.
 *
 *  Nothing in this app could write `sheet.abilities` before now: the Stat
 *  Panel's AbilityScores widget takes no updater and is read-only by
 *  construction, so scores arrived by SQL seed and could never be changed. The
 *  console even warns "Save DC and spell attack need ability scores on the
 *  sheet first" — the app describing a gap it gave you no way to fill.
 *
 *  IT EDITS THE BASE, AND SAYS SO. A racial +2 DEX is a `boost` rule layered by
 *  effectiveSheet, so the number a player sees is not the number stored here.
 *  Typing 16 and watching the sheet read 18 looks like the field ignoring you
 *  unless the card shows both — so when they differ, the effective value and
 *  its source are printed beside the input. The base stays canon underneath,
 *  which is the whole reason the boost is a rule and not a write. */
function AbilityScoresCard({ member, row, shardCatalog, onUpdate, log }: {
  member: PartyMember
  row: CharacterRow
  shardCatalog: Record<string, ShardTree>
  onUpdate: (patch: CharacterUpdate) => Promise<boolean>
  log: (node: ReactNode, kind?: 'cyan' | 'danger') => void
}) {
  const sheet = row.sheet ?? {}
  const base = sheet.abilities ?? ({} as Partial<Record<AbilityKey, number>>)
  const view = useMemo(() => effectiveSheet(row, shardCatalog), [row, shardCatalog])
  const [busy, setBusy] = useState<AbilityKey | null>(null)

  async function setScore(key: AbilityKey, next: number) {
    const value = Math.max(1, Math.min(30, Math.round(next) || 0))
    if (value === (base[key] ?? 10)) return
    setBusy(key)
    const ok = await onUpdate({
      sheet: { ...sheet, abilities: { ...base, [key]: value } as CharacterSheet['abilities'] },
    })
    setBusy(null)
    if (ok) {
      log(<><span className={styles.who}>{firstName(member.name)}</span> {ABILITY_NAMES[key]} → <span className={styles.obj}>{value}</span></>)
    }
  }

  return (
    <div className={cx(styles.actCard, styles.wide)}>
      <div className={styles.acTitle}><i className="fa-solid fa-dumbbell lead" /><span className={styles.num}>E</span><span className={styles.t}>Ability Scores</span></div>

      <div className={styles.abGrid}>
        {ABILITY_ORDER.map(key => {
          const raw = base[key] ?? 10
          const eff = view.abilities?.[key] ?? raw
          const mod = abilityMod(eff)
          const boosted = eff !== raw
          return (
            <div key={key} className={cx(styles.abCell, boosted && styles.boosted)}>
              <span className={styles.abKey}>{ABILITY_ABBR[key].toUpperCase()}</span>
              <input
                className={styles.abIn}
                type="number" min={1} max={30} value={raw}
                aria-label={ABILITY_NAMES[key]}
                disabled={busy === key}
                onChange={e => void setScore(key, parseInt(e.target.value || '0', 10))}
              />
              <span className={styles.abMod}>{mod >= 0 ? `+${mod}` : mod}</span>
              {/* Only when they differ — printing "16 → 16" on four of six rows
                  is noise that trains you to stop reading the one that matters. */}
              {boosted && (
                <span className={styles.abEff} title="Base score plus rules layered by effectiveSheet">
                  {raw} → <b>{eff}</b>
                </span>
              )}
            </div>
          )
        })}
      </div>

      <p className={styles.abHint}>
        Base scores. A racial bonus is a <b>boost</b> rule on the race, so it layers on top and comes back off with the race — set the un-boosted number here.
      </p>
    </div>
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
      <div className={styles.acTitle}><i className="fa-solid fa-diagram-project lead" /><span className={styles.num}>M</span><span className={styles.t}>Feature State</span></div>

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
  'very-rare': { label: 'Very Rare', token: 'var(--rar-vrare)' },
  legendary: { label: 'Legendary', token: 'var(--rar-legend)' },
  artifact: { label: 'Artifact', token: 'var(--rar-artifact)' },
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
const rarColor = (r?: ItemRarity) => RAR_DEF[r ?? 'common']?.token ?? 'var(--muted)'
const catDef = (c?: ItemCategory) => CAT_DEF[c ?? 'misc'] ?? CAT_DEF.misc

function firstName(name: string) { return name.split(' ')[0] }

/** Grant `qty` of a template, however that template counts — five javelins as
 *  five rows, twenty arrows as one stack. Both callers (this card and a class's
 *  starting kit) go through lib/placement.ts grantMany, so they cannot disagree
 *  about what a quantity means. */
function grantSnapshots(
  item: CatalogItemRow, qty: number, gear: EquippedGear, inventory: InventoryItem[],
): InventoryItem[] {
  return grantMany(item.data ?? ({} as CatalogItemData), item.id, qty, gear, inventory)
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
      <div className={styles.acTitle}><i className="fa-solid fa-box-open lead" /><span className={styles.num}>D</span><span className={styles.t}>Grant Item</span></div>
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
              <span className={styles.ciIc} style={{ color: col }}><Icon name={it.data?.icon ?? 'fa-box'} /></span>
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
  const [tick, setTick] = useState('')
  const [conc, setConc] = useState(false)
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
      /* DERIVED from the duration already chosen, not re-typed: the DM picks
         "1 minute" and the tracker gets 10. "Until rest" yields undefined, which
         means UNTRACKED — it never ticks and never expires on its own. */
      ...(untilRest ? {} : (() => { const t = durationTurns(durN, durUnit); return t ? { turns: t } : {} })()),
      ...(tick.trim() ? { tick: tick.trim() } : {}),
      ...(conc ? { concentration: true } : {}),
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
              <span className={styles.ciIc} style={{ color: K.color }}><Icon name={e.data?.icon ?? 'fa-bolt'} /></span>
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

      {/* Per-turn damage and concentration. Both sit with the duration because
          all three answer "how does this end" — and the turn count itself is
          derived from the row above rather than typed again. */}
      <div className={styles.durRow}>
        <span className={styles.fieldLab}>Per turn</span>
        <input className={styles.sessIn} value={tick} onChange={e => setTick(e.target.value)}
          placeholder="1d6 — damage at the start of each turn, left blank for none" spellCheck={false} />
        <button className={cx(styles.durOpt, conc && styles.sel)} onClick={() => setConc(c => !c)} aria-pressed={conc}
          title="Marked only — losing concentration is a save made at the table, never something the app decides">
          Concentration
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
/** `tab` is owned by OperatorConsole: the rail that switches it hangs off
    region 01, so the state has to live above both. */
function CatalogSurface({ tab, catalog, featureLib, effectLib, spellLib, shopLib, classLib, raceLib, lootLib, backgroundLib, members, onRollLoot, openLootId, onResumeLoot }: {
  tab: CatTab
  catalog: DmCatalogState; featureLib: DmFeaturesState; effectLib: DmEffectsState; spellLib: DmSpellsState; shopLib: DmShopsState; classLib: DmClassesState; raceLib: DmRacesState; lootLib: DmLootState; backgroundLib: DmBackgroundsState; members: PartyMember[]
  onRollLoot: (id: string, table: LootTable) => void
  /** The table whose roll is currently open, so its index row can offer
   *  Resume instead of Roll. */
  openLootId: string | null
  onResumeLoot: () => void
}) {
  const { items, createItem, updateItem, deleteItem, loading, error } = catalog
  const [selId, setSelId] = useState<string | null>(null)
  const [itemQuery, setItemQuery] = useState('')
  const shownItems = useMemo(() => {
    const q = parseCatalogQuery(itemQuery)
    return items.filter(it => matchesCatalogQuery(it.data ?? {}, q))
  }, [items, itemQuery])
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

  return (
    <>
      <div className={styles.ovBanner}>
        <span className={styles.big}>Catalog</span>
        <span>Content library · author once, grant from anywhere</span>
        <span className={styles.dmonly}><i className="fa-solid fa-box-archive" /> Templates — not a grant</span>
      </div>

      {(tab === 'features' ? featureLib.error : tab === 'spells' ? spellLib.error : tab === 'effects' ? effectLib.error : tab === 'shops' ? shopLib.error : tab === 'classes' ? classLib.error : tab === 'races' ? raceLib.error : tab === 'loot' ? lootLib.error : error) ? (
        <div className={styles.soonPanel}>
          <i className="fa-solid fa-triangle-exclamation" /><span className={styles.big}>Link Error</span>
          <span>{tab === 'features' ? featureLib.error : tab === 'spells' ? spellLib.error : tab === 'effects' ? effectLib.error : tab === 'shops' ? shopLib.error : tab === 'classes' ? classLib.error : tab === 'races' ? raceLib.error : tab === 'loot' ? lootLib.error : error}</span>
        </div>
      ) : tab === 'spells' ? (
        <SpellLibrarySurface lib={spellLib} />
      ) : tab === 'effects' ? (<>
        <div className={styles.catNote}>
          <i className="fa-solid fa-circle-info" />
          <span>
            An <b>effect</b> is something applied to a character or carried by an object, and it can
            end — Bless, Poisoned, a gem’s enchantment. For what a thing simply <b>is</b> (a race’s
            +2 DEX), use a <b>boost</b> in that thing’s own Rules block instead.
          </span>
        </div>
        <EffectLibrarySurface lib={effectLib} />
      </>
      ) : tab === 'loot' ? (
        <LootLibrarySurface lib={lootLib} itemCatalog={items}
          onRoll={onRollLoot} openLootId={openLootId} onResume={onResumeLoot} />
      ) : tab === 'races' ? (
        <RaceLibrarySurface lib={raceLib} featureLib={featureLib} members={members} />
      ) : tab === 'backgrounds' ? (
        <BackgroundLibrarySurface lib={backgroundLib} featureLib={featureLib} />
      ) : tab === 'classes' ? (
        <ClassLibrarySurface lib={classLib} featureLib={featureLib} itemCatalog={items} members={members} />
      ) : tab === 'shops' ? (
        <OperatorShops shopLib={shopLib} itemCatalog={items} members={members} />
      ) : (
        <div className={styles.catLayout}>
          <div className={styles.catIndex}>
            <div className={styles.catNew}>
              <Btn tone="cyan" icon="fa-plus" label="New Item" onClick={() => { setCreating(true); setSelId(null) }} />
            </div>
            {/* Sticky, so it stays put as the list scrolls under it — a search
                box that scrolls away recreates the up-and-down it exists to
                stop. */}
            <div className={cx(styles.searchWrap, styles.catSearch)}>
              <i className="fa-solid fa-magnifying-glass" />
              <input className={styles.searchIn} value={itemQuery} onChange={e => setItemQuery(e.target.value)}
                placeholder="Search items, or tag:fire_damage" autoComplete="off" spellCheck={false} />
              {itemQuery && <i className={cx('fa-solid fa-xmark', styles.catSearchClr)} onClick={() => setItemQuery('')} />}
            </div>
            {CAT_ORDER.map(cat => {
              const rows = shownItems.filter(it => (it.data?.category ?? 'misc') === cat)
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
                          <span className={styles.crIc}><Icon name={it.data?.icon ?? 'fa-box'} /></span>
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
            {/* "no matches" and "nothing authored yet" are different states and
                the empty catalog message reads as a bug when you have 20 items
                and simply mistyped a tag. */}
            {items.length === 0
              ? <div className={styles.catEmpty}>{loading ? '· loading ·' : '— catalog empty —'}</div>
              : shownItems.length === 0
                ? <div className={styles.catEmpty}>— nothing matches —</div>
                : null}
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
  // Roll contributions, beside `effectRefs` and deliberately not the same thing:
  // effects are the passive numeric layer, a graph is per-roll and conditional.
  const [graph, setGraph] = useState<GraphEffect[]>(d?.graph ?? [])
  const [vars, setVars] = useState<VarDef[]>(d?.vars ?? [])
  const [tags, setTags] = useState<string[]>(d?.tags ?? [])
  const [gfxOpen, setGfxOpen] = useState(false)
  const { nodes, namesByGid, tagUse, ready } = useCatalogNodes()
  const gAudit = ready ? auditNode({ graph, vars }, nodes) : []
  const gErrs = gAudit.filter(a => a.sev === 'err')
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
  const [ranged, setRanged] = useState(!!d?.ranged)
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
        ? {
          ability, ...(ranged ? { ranged: true } : {}),
          ...(damageDice.trim() ? { damageDice: damageDice.trim() } : {}),
          ...(dmgType.trim() ? { type: dmgType.trim() } : {}),
        }
        : {}),
      ...(category === 'consumable'
        ? { ...(heal.trim() ? { heal: heal.trim() } : {}), ...(duration.trim() ? { duration: duration.trim() } : {}) }
        : {}),
    }
    // effectRefs is the authored source; `effects` is a COMPILED CACHE recomputed
    // here on every save so the equip/grant engine keeps reading plain
    // ItemEffects with no changes (see EffectRef's doc comment).
    const referenced = effectRefs.map(r => effectLib.find(e => e.id === r.effectId)?.data).filter(Boolean) as EffectDef[]
    const referencedMods = referenced.flatMap(e => e.mods ?? [])
    const effects = compileEffects(referencedMods, referenced)
    if (effects) data.effects = effects
    if (effectRefs.length) data.effectRefs = effectRefs
    if (feats.length) data.features = feats
    if (rows.length) data.rows = rows
    // Hand-enumerated, like everything above it — which is exactly why these two
    // were dropped on every save until now.
    if (graph.length) data.graph = graph
    if (vars.length) data.vars = vars
    if (tags.length) data.tags = tags
    return data
  }
  /* Typing saves. No button: the guard the Save button carried is now the
     `ready` condition, so an incomplete form simply holds the write. */
  const { busy: autoBusy } = useAutoSave({
    value: build(), ready: !!name.trim() && gErrs.length === 0, id: item?.id ?? null,
    save: (v: CatalogItemData) => onSubmit(v),
  })

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
          <Icon name={icon} />
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

      <div className={cx(styles.catGrid3, styles.catGridDims)}>
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
      <IconPicker value={icon} onPick={setIcon} />

      {category === 'weapon' && (
        <div className={styles.catGrid3}>
          {/* FIRST in the weapon block, because it is the question that changes
              the answers below it — everything ranged hangs off this one flag:
              the empty-quiver refusal, the ammunition spend, and the `ranged` sub
              that makes `roll:attack.ranged` match. */}
          <div className={styles.catSpan3}>
            <label className={styles.catCheck}>
              <input type="checkbox" checked={ranged}
                onChange={e => {
                  setRanged(e.target.checked)
                  // A convenience, not a lock: bows are DEX weapons, so offer it
                  // when the ability is still the untouched default.
                  if (e.target.checked && ability === 'str') setAbility('dex')
                }} />
              <span>Ranged <span className={styles.dimLab}>— fires ammunition, spends a shaft per attack</span></span>
            </label>
          </div>
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
        <ProsePreview text={flavor} />
      </div>
      <textarea className={styles.catProse} value={flavor} onChange={e => setFlavor(e.target.value)}
        onKeyDown={markdownShortcuts(setFlavor)}
        placeholder="The prose the player reads when they examine this item…" />

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
                      <span className={styles.ic}><Icon name={eff.data.icon} /></span>
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
                          <span className={styles.piIc}><Icon name={e.data.icon} /></span>
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
                <Icon name={f.icon ?? 'fa-star'} /> {f.name}
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
                  <option key={f.id} value={f.id}>{f.data?.name ?? 'Untitled'} · {featureOrigin(f.data)}</option>
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

      {/* TAGS LIVE OUTSIDE THE RULES FOLD. They were inside it, which made them
          invisible until you expanded a collapsed section about something else —
          and tagging is not a rules-authoring job. An item's tags are what
          `tag:` selectors match, AND what Equipment passes into every attack it
          rolls with this weapon, so plenty of items want tags and no rules. */}
      <div className={styles.catSecLab}><span className={styles.fieldLab}>Targeting tags</span></div>
      <TagsBlock tags={tags} tagUse={tagUse} onChange={setTags} />

      {/* ROLL CONTRIBUTIONS — the same block the feature editor and the spell
          form author. Beside Effects Granted and deliberately distinct from it:
          `effects` is the passive numeric layer compiled from the effect
          library, this is per-roll and conditional (database.types.ts:513).
          Applies while the item is EQUIPPED. */}
      <div className={cx(styles.catFx, styles.fold, gfxOpen && styles.open)}>
        <div className={styles.fxfHead} onClick={() => setGfxOpen(o => !o)} role="button" tabIndex={0} aria-expanded={gfxOpen}>
          <span className={styles.car}><i className="fa-solid fa-caret-right" /></span>
          <i className="fa-solid fa-diagram-project" style={{ color: 'var(--cyan-hot)', fontSize: 11 }} />
          <span className={styles.t}>Rules</span>
          <span className={styles.s}>
            {graph.length
              ? `${graph.length} effect${graph.length === 1 ? '' : 's'}${gErrs.length ? ` · ${gErrs.length} error${gErrs.length === 1 ? '' : 's'}` : ''}`
              : 'none · what this item adds to a roll while equipped'}
          </span>
        </div>
        {gfxOpen && (
          <div className={styles.gfxBody}>
            <GraphEffects graph={graph} vars={vars} nodes={nodes} namesByGid={namesByGid} onChange={setGraph} onVarsChange={setVars} />
            <VarsBlock vars={vars} onChange={setVars} />
          </div>
        )}
      </div>

      {/* Clickable, like the Feature/Class/Race audit panels: opens the Rules
          fold and jumps to the node or variable that is wrong, rather than
          naming it and leaving you to find it. */}
      {gErrs.map((a, i) => (
        <button key={i} type="button" className={styles.skWarn}
          onClick={() => { setGfxOpen(true); revealAudit(a.id) }}>
          <i className="fa-solid fa-triangle-exclamation" /> <b>{a.t}</b> — {a.s}
        </button>
      ))}

      <div className={styles.qActions}>
        {/* Replaces the Save button. These tables have no draft column, so an
            invalid form holds the write rather than parking it — the last good
            version stays live, which is the same promise the draft-backed forms
            make by a different route. */}
        <span className={styles.autoState}>
          {autoBusy ? '● Saving…' : !!name.trim() && gErrs.length === 0 ? '● Saved automatically' : '● Not saved — needs a name, and no graph errors'}
        </span>
        {onDelete && <Btn tone="danger" lg icon="fa-trash" label="Delete" onClick={onDelete} disabled={autoBusy} />}
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

  const [query, setQuery] = useState('')

  const sheet = row.sheet ?? {}
  const current = sheet.features ?? []
  const first = firstName(member.name)

  /* Name, source and category, because those are the three things a DM knows
     about a feature they are hunting for — "the Fighter one", "Second Wind",
     "racial". Same shape as the Apply Effect and Grant Item searches above. */
  const q = query.trim().toLowerCase()
  const shown = q
    ? featureLib.filter(f => {
      const d = f.data
      const cat = FEAT_CATS.find(c => c.key === d?.category)?.label ?? ''
      return [d?.name, d?.source, cat, d?.usage].some(v => (v ?? '').toLowerCase().includes(q))
    })
    : featureLib
  // Same rule as Grant Spell: the selection is whatever is visible.
  const selected = shown.find(f => f.id === selId) ?? null

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
      <div className={styles.acTitle}><i className="fa-solid fa-star lead" /><span className={styles.num}>L</span><span className={styles.t}>Grant Feature</span></div>
      <div className={styles.featGrantSplit}>
        <div className={styles.fgCol}>
          <span className={styles.fieldLab}>Library · roleplay boons &amp; perks</span>
          <div className={styles.searchWrap}>
            <i className="fa-solid fa-magnifying-glass" />
            <input className={styles.searchIn} value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Search features by name, source or kind…" />
          </div>
          <div className={styles.catList}>
            {featureLib.length === 0 ? (
              <div className={styles.catListEmpty}>Library is empty — author features in the Catalog's Features tab.</div>
            ) : shown.length === 0 ? (
              <div className={styles.catListEmpty}>Nothing matches “{query.trim()}”.</div>
            ) : shown.map(f => (
              <button key={f.id} className={cx(styles.catItem, f.id === selId && styles.sel)} onClick={() => setSelId(f.id)}>
                <span className={styles.ciIc} style={{ color: 'var(--amber)' }}><Icon name={f.data?.icon ?? 'fa-star'} /></span>
                <span className={styles.ciTx}>
                  <span className={styles.ciNm}>{f.data?.name ?? 'Untitled'}</span>
                  <span className={styles.ciTy} title={f.data?.folder ?? undefined}>{featureOrigin(f.data)}</span>
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
                <span className={styles.nm}><Icon name={f.icon ?? 'fa-star'} /> {f.name}</span>
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

/** A collapsible group of action cards, closed until asked for.
 *
 *  The Actions tab had grown to ten cards with no hierarchy, and the ones a DM
 *  reaches for mid-session were scrolling off the bottom behind character BUILD
 *  data that is set once and rarely revisited. Folding the build cards keeps them
 *  one click away rather than hidden, and each folder holds the pair that is
 *  always edited together — a caster profile without its spell list is half a job.
 *
 *  Cards inside stack rather than sharing the two-column grid: they are already
 *  the wide ones, and a folder that reflows its contents into columns reads as a
 *  different screen rather than the same one opened up.
 *
 *  Local state on purpose. Which folders you have open is how you are reading the
 *  tab right now, not something worth persisting into the next session. */
function Folder({ label, icon, children }: { label: string; icon: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={cx(styles.folder, open && styles.folderOpen)}>
      <button type="button" className={styles.folderHead} onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className={styles.fdCar}><i className="fa-solid fa-caret-right" /></span>
        <Icon name={icon} className={styles.fdIc} />
        <span className={styles.fdT}>{label}</span>
        <span className={styles.fdHint}>{open ? 'collapse' : 'expand'}</span>
      </button>
      {open && <div className={styles.folderBody}>{children}</div>}
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
function ProficienciesCard({ member, row, classLib, onUpdate, log }: {
  member: PartyMember
  row: CharacterRow
  classLib: DmClassesState
  onUpdate: (patch: CharacterUpdate) => Promise<boolean>
  log: (node: ReactNode, kind?: 'cyan' | 'danger') => void
}) {
  const sheet = row.sheet ?? {}
  const saveProfs = sheet.saveProficiencies ?? []
  const skillProfs = sheet.skillProficiencies ?? []
  const skillExp = sheet.skillExpertise ?? []
  const first = firstName(member.name)

  /* WHICH SKILLS THIS CHARACTER'S CLASS OFFERS, and how many they may take.
     A class stores an ELIGIBLE list and a count, never the picks themselves —
     the pick is the player's, so assignClass deliberately writes nothing here.
     That left the list reaching only the Assign preview, which is gone by the
     time anyone acts on it. This is the card that does the ticking, so this is
     where the class's answer has to show up.

     Matched on name because identity.class stores the name, which is the only
     thing the sheet actually records. */
  const cls = classLib.classes.find(c => c.data?.published && c.data.name === row.identity?.class)?.data ?? null
  const offered = new Set(cls?.skillChoices ?? [])
  const allowed = cls?.skillChooseN ?? 0
  const takenFromClass = [...offered].filter(k => skillProfs.includes(k) || skillExp.includes(k)).length
  // Offered first, in SKILLS order, then everything else — a background or race
  // can still grant a skill the class never offered, so nothing is hidden.
  const orderedSkills = offered.size
    ? [...SKILLS.filter(s => offered.has(s.key)), ...SKILLS.filter(s => !offered.has(s.key))]
    : SKILLS
  const firstUnoffered = offered.size ? SKILLS.filter(s => offered.has(s.key)).length : -1

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
      <div className={styles.acTitle}><i className="fa-solid fa-graduation-cap lead" /><span className={styles.num}>I</span><span className={styles.t}>Proficiencies</span></div>

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
                <ProfDots n={on ? 1 : 0} of={1} />
                {ABILITY_ABBR[key].toUpperCase()}
              </button>
            )
          })}
        </div>
      </div>

      <div className={styles.profRow}>
        <span className={styles.profLab}>
          Skills · click cycles none → proficient → expertise
          {cls && allowed > 0 && (
            <span className={cx(styles.clsAllow, takenFromClass === allowed && styles.met, takenFromClass > allowed && styles.over)}>
              {cls.name} allows {allowed} of {offered.size}
              <b>{takenFromClass} / {allowed}</b>
              {takenFromClass === allowed ? <i className="fa-solid fa-check" /> : null}
            </span>
          )}
        </span>
        <div className={styles.profGrid}>
          {orderedSkills.map((skill, idx) => {
            const isExp = skillExp.includes(skill.key)
            const isProf = skillProfs.includes(skill.key)
            return (
              <Fragment key={skill.key}>
              {idx === firstUnoffered && <span className={styles.profSplit}>not offered by {cls?.name ?? 'this class'}</span>}
              <button
                type="button"
                className={cx(styles.profChip, isProf && styles.on, isExp && styles.exp, offered.has(skill.key) && styles.offered)}
                onClick={() => void cycleSkill(skill.key, skill.name)}
                title={isExp ? 'Expertise (×2 proficiency) — click to clear' : isProf ? 'Proficient — click for expertise' : 'Click to grant proficiency'}
              >
                <ProfDots n={isExp ? 2 : isProf ? 1 : 0} />
                {skill.name} <span className={styles.ab}>{ABILITY_ABBR[skill.ability].toUpperCase()}</span>
              </button>
              </Fragment>
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
const clipTx = (s: string, n: number) => {
  const t = (s ?? '').trim()
  return t.length > n ? `${t.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : t
}
/** `+2 AC` for a flat bonus, `STR = 21` for a set-to floor. */
const modText = (m: Mod) => (m.set ? `${m.stat} = ${m.amt}` : `${m.amt < 0 ? '−' : '+'}${Math.abs(m.amt)} ${m.stat}`)
const flagText = (f: EffectFlag) => `${EF_FLAG_MODES[f.mode].short} ${f.target || '—'}`
/** Mods then flags, as short human strings — used everywhere an effect is
 *  summarised: the index row, the preview strip, an item's reference row. */
/** One effect, summarised as chips — used by the Apply Effect list, the item
 *  form's Effects Granted rows, and its picker.
 *
 *  Skill proficiency is included because without it an effect whose ONLY content
 *  is "proficient in Stealth" summarised as nothing at all, in all three places:
 *  you would attach it to an item and the row would sit there blank, which reads
 *  as "this effect does nothing". */
const SKILL_NAME: Record<string, string> = Object.fromEntries(SKILLS.map(sk => [sk.key, sk.name]))
const effectParts = (e: { mods: Mod[]; flags: EffectFlag[]; skillProficiencies?: string[]; skillExpertise?: string[] }) => [
  ...e.mods.map(modText),
  ...e.flags.map(flagText),
  ...(e.skillProficiencies ?? [])
    .filter(k => !(e.skillExpertise ?? []).includes(k))
    .map(k => `Prof: ${SKILL_NAME[k] ?? k}`),
  ...(e.skillExpertise ?? []).map(k => `Expertise: ${SKILL_NAME[k] ?? k}`),
]

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
                      <span className={styles.crIc}><Icon name={e.data?.icon ?? 'fa-bolt'} /></span>
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

/** The proficiency pips on a .profChip.
 *
 *  ALWAYS RENDERED, even when nothing is earned. Inserting the diamond only on
 *  the selected state makes the chip wider the moment it is clicked, which
 *  reflows every chip after it in the wrapped grid — so the one you meant to
 *  click next has moved out from under the cursor. Reserving the slot costs a
 *  few pixels and makes the grid stand still.
 *
 *  `of` is how many states the host cycles through: 1 for a plain on/off list
 *  (saves, a class's eligible skills), 2 where expertise is reachable. */
function ProfDots({ n, of = 2 }: { n: number; of?: 1 | 2 }) {
  return (
    <span className={styles.profDots} style={{ ['--dots' as string]: of === 1 ? '5px' : '12px' }}>
      {Array.from({ length: of }, (_, i) => (
        <span key={i} className={cx(styles.profDot, i >= n && styles.off)} />
      ))}
    </span>
  )
}

/** Skill proficiency for an effect — one list, three states.
 *
 *  Mirrors card G (ProficienciesCard), because they are the same question asked
 *  of different subjects: a skill is untrained, proficient, or expert, and those
 *  are three points on ONE axis. Two separate checkbox grids made it possible to
 *  tick expertise without proficiency — a state 5e has no name for, which
 *  lib/effects.ts then had to quietly repair on every read.
 *
 *  Click cycles none -> proficient -> expertise -> none. */
function SkillPicker({ profs, exp, onChange }: {
  profs: string[]; exp: string[]
  onChange: (next: { profs: string[]; exp: string[] }) => void
}) {
  const cycle = (key: string) => {
    const isExp = exp.includes(key)
    const isProf = profs.includes(key)
    if (!isProf && !isExp) return onChange({ profs: [...profs, key], exp })
    if (isProf && !isExp) return onChange({ profs, exp: [...exp, key] })
    return onChange({ profs: profs.filter(k => k !== key), exp: exp.filter(k => k !== key) })
  }
  return (
    <div className={styles.profGrid}>
      {SKILLS.map(skill => {
        const isExp = exp.includes(skill.key)
        const isProf = profs.includes(skill.key) || isExp
        return (
          <button
            key={skill.key} type="button"
            className={cx(styles.profChip, isProf && styles.on, isExp && styles.exp)}
            onClick={() => cycle(skill.key)}
            title={isExp ? 'Expertise (x2 proficiency) — click to clear' : isProf ? 'Proficient — click for expertise' : 'Click to grant proficiency'}
          >
            <ProfDots n={isExp ? 2 : isProf ? 1 : 0} />
            {skill.name} <span className={styles.ab}>{ABILITY_ABBR[skill.ability].toUpperCase()}</span>
          </button>
        )
      })}
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
  const [skillProfs, setSkillProfs] = useState<string[]>(d?.skillProficiencies ?? [])
  const [skillExp, setSkillExp] = useState<string[]>(d?.skillExpertise ?? [])
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
    return {
      name: name.trim(), icon, kind, tags, mods, flags, desc,
      ...(skillProfs.length ? { skillProficiencies: skillProfs } : {}),
      ...(skillExp.length ? { skillExpertise: skillExp } : {}),
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
        <span className={styles.cfhT}>{effect ? 'Edit Effect' : 'New Effect'}</span>
        <span className={styles.cfhId}>{effect ? effect.id : 'unsaved template'}</span>
      </div>

      <div className={styles.efPrev} style={{ ['--k' as string]: K.color }}>
        <span className={styles.pc}><Icon name={icon} /></span>
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
      <IconPicker value={icon} onPick={setIcon} />

      <span className={styles.fieldLab}>Kind <span style={{ color: 'var(--beige-dim)' }}>· drives the tint wherever this effect appears</span></span>
      <div className={styles.efKind}>
        {EFFECT_KIND_ORDER.map(k => {
          const KK = EFFECT_KINDS[k]
          return (
            <button key={k} className={cx(styles.k, k === kind && styles.on)} style={{ ['--k' as string]: KK.color }} onClick={() => setKind(k)}>
              <Icon name={KK.icon} /><span className={styles.t}>{KK.label}</span>
            </button>
          )
        })}
      </div>

      {/* Not modifier rows: a modifier is a number, and being PROFICIENT scales
          with the proficiency bonus instead. One list rather than two, because
          untrained / proficient / expert are three points on one axis — see
          SkillPicker. */}
      <span className={styles.fieldLab}>Skill proficiency <span className={styles.dimLab}>— click cycles none → proficient → expertise</span></span>
      <SkillPicker
        profs={skillProfs} exp={skillExp}
        onChange={next => { setSkillProfs(next.profs); setSkillExp(next.exp) }}
      />

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
                  {/* Grouped: eighteen skills would otherwise bury the fifteen stats
                      above them in one flat list. */}
                  <optgroup label="Stats">
                    {MOD_STATS.map(s => <option key={s} value={s}>{s}</option>)}
                  </optgroup>
                  <optgroup label="Skill bonus">
                    {SKILL_STATS.map(s => <option key={s} value={s}>{s}</option>)}
                  </optgroup>
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
        <textarea className={styles.catProse} value={desc} onChange={e => setDesc(e.target.value)}
          onKeyDown={markdownShortcuts(setDesc)}
          placeholder="e.g. At the start of each of their turns the creature takes 1d6 damage…" />
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
                      <Icon name={s.data?.icon || SPELL_SCHOOL_ICON[s.data?.school ?? 'Evocation']} style={s.data?.iconColor ? { color: s.data.iconColor } : undefined} />
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
  const { nodes, namesByGid, tagUse, ready } = useCatalogNodes()
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
  const [tags, setTags] = useState<string[]>(d?.tags ?? [])
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
      ...(tags.length ? { tags } : {}),
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
      {/* The school glyph is this spell's icon until one is chosen, so it goes
          in the picker's own chosen-icon slot. As a separate chip above it, the
          spell editor showed two icons where every other editor shows one. */}
      <IconPicker value={icon} onPick={setIcon}
        auto={{ icon: SPELL_SCHOOL_ICON[school], label: `${school} — by school` }} />
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
        <ProsePreview text={desc} />
      </div>
      <textarea className={cx(styles.catProse, styles.player)} value={desc} onChange={e => setDesc(e.target.value)}
        onKeyDown={markdownShortcuts(setDesc)}
        placeholder="The prose the player reads in their Spellbook…" />

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
      {/* Outside the Rules fold, same reasoning as the item form: a spell's
          tags are what `tag:` selectors match, and a spell can want tags
          without carrying a single rule. */}
      <div className={styles.catSecLab}><span className={styles.fieldLab}>Targeting tags</span></div>
      <TagsBlock tags={tags} tagUse={tagUse} onChange={setTags} />

      <div className={cx(styles.catFx, styles.fold, gfxOpen && styles.open)}>
        <div className={styles.fxfHead} onClick={() => setGfxOpen(o => !o)} role="button" tabIndex={0} aria-expanded={gfxOpen}>
          <span className={styles.car}><i className="fa-solid fa-caret-right" /></span>
          <i className="fa-solid fa-diagram-project" style={{ color: 'var(--cyan-hot)', fontSize: 11 }} />
          <span className={styles.t}>Rules</span>
          <span className={styles.s}>
            {graph.length
              ? `${graph.length} effect${graph.length === 1 ? '' : 's'}${gErrs.length ? ` · ${gErrs.length} error${gErrs.length === 1 ? '' : 's'}` : ''}`
              : 'none · what this spell adds to a roll'}
          </span>
        </div>
        {gfxOpen && (
          <div className={styles.gfxBody}>
            <GraphEffects graph={graph} vars={vars} nodes={nodes} namesByGid={namesByGid} onChange={setGraph} onVarsChange={setVars} />
            <VarsBlock vars={vars} onChange={setVars} />
            {/* Tags reach ACROSS catalogs — `tag:fire` should match this spell,
                a weapon and a shard node alike. */}
          </div>
        )}
      </div>

      {/* An error means the node would not resolve. Same gate the feature editor
          puts on Publish (§17) — an audit that does not block is a suggestion. */}
      {/* Clickable, like the Feature/Class/Race audit panels: opens the Rules
          fold and jumps to the node or variable that is wrong, rather than
          naming it and leaving you to find it. */}
      {gErrs.map((a, i) => (
        <button key={i} type="button" className={styles.skWarn}
          onClick={() => { setGfxOpen(true); revealAudit(a.id) }}>
          <i className="fa-solid fa-triangle-exclamation" /> <b>{a.t}</b> — {a.s}
        </button>
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

  const [query, setQuery] = useState('')

  const sb = row.spellbook ?? {}
  const current = sb.spells ?? []
  const first = firstName(member.name)

  /* Name, school and level — a spell list is long and those are the three ways a
     DM narrows it. "3" and "cantrip" both work, because the level label is what
     the row itself shows. */
  const q = query.trim().toLowerCase()
  const shown = q
    ? spellLib.filter(sp => {
      const d = sp.data
      return [d?.name, d?.school, spellLevelLabel(d?.level ?? 0)].some(v => (v ?? '').toLowerCase().includes(q))
    })
    : spellLib
  /* Chosen from the VISIBLE list, not the whole library: search past your own
     selection and Grant would otherwise stay armed on something no longer on
     screen, and a grant you cannot see is a grant you did not check. */
  const selected = shown.find(sp => sp.id === selId) ?? null
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
      <div className={styles.acTitle}><i className="fa-solid fa-wand-sparkles lead" /><span className={styles.num}>K</span><span className={styles.t}>Grant Spell</span></div>
      <div className={styles.featGrantSplit}>
        <div className={styles.fgCol}>
          <span className={styles.fieldLab}>Library · Catalog · Spells tab</span>
          <div className={styles.searchWrap}>
            <i className="fa-solid fa-magnifying-glass" />
            <input className={styles.searchIn} value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Search spells by name, school or level…" />
          </div>
          <div className={styles.catList}>
            {spellLib.length === 0 ? (
              <div className={styles.catListEmpty}>Library is empty — author spells in the Catalog's Spells tab.</div>
            ) : shown.length === 0 ? (
              <div className={styles.catListEmpty}>Nothing matches “{query.trim()}”.</div>
            ) : shown.map(sp => (
              <button key={sp.id} className={cx(styles.catItem, sp.id === selId && styles.sel)} onClick={() => setSelId(sp.id)}>
                <span className={styles.ciIc} style={{ color: sp.data?.iconColor || 'var(--cyan)' }}>
                  <Icon name={sp.data?.icon || SPELL_SCHOOL_ICON[sp.data?.school ?? 'Evocation']} />
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
                  <Icon name={sp.icon || SPELL_SCHOOL_ICON[sp.school]} style={sp.iconColor ? { color: sp.iconColor } : undefined} /> {sp.name}
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
      <div className={styles.acTitle}><i className="fa-solid fa-hat-wizard lead" /><span className={styles.num}>J</span><span className={styles.t}>Spellcasting</span></div>

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

// ============================================================
// CLASS LIBRARY (Catalog · Classes tab) + ASSIGN CLASS —
// the fifth authoring library. Same list+form shell as Effects and Spells, the
// same shared authoring blocks the item and spell forms host, and the same
// draft->publish ladder the Feature Editor runs — so it is a sibling of those
// forms rather than a new kind of screen.
//
// TWO THINGS IT DELIBERATELY DOES NOT HAVE:
//
//  * a per-level progression grid. A level is a gate condition on a feature
//    reference (`when: "level >= 3"`), and the picker groups its rows by the
//    level their own condition names — so the ladder is a VIEW of the gates
//    rather than a second copy of them. Twenty rows of table would duplicate
//    both the gates and the byLevel arrays that already exist.
//  * an authored slot table. Full/half/third slots are derived by
//    lib/classes.ts casterSlots, pact slots by lib/spells.ts. See classes.ts.
// ============================================================

const HIT_DICE: ClassDef['hitDie'][] = [6, 8, 10, 12]

const CASTER_ORDER: ClassCasterType[] = ['none', 'full', 'half', 'third', 'pact']

/** Short badge for the index row. `CASTER_LABEL` is the long form. */
const CASTER_BADGE: Record<ClassCasterType, string> = {
  none: 'martial', full: 'full', half: 'half', third: 'third', pact: 'pact',
}

const BLANK_CLASS: ClassDef = {
  name: '', icon: 'fa-shield-halved', desc: '', hitDie: 8, primaryAbility: 'str',
  saveProficiencies: [], skillChoices: [], skillChooseN: 2,
  proficiencies: {}, startingEquipment: [], caster: 'none',
  features: [], tags: [], vars: [], graph: [], published: false,
}

function ClassLibrarySurface({ lib, featureLib, itemCatalog, members }: {
  lib: DmClassesState
  featureLib: DmFeaturesState
  itemCatalog: CatalogItemRow[]
  members: PartyMember[]
}) {
  const { classes, loading } = lib
  const [selId, setSelId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [query, setQuery] = useState('')

  const shown = useMemo(() => {
    const q = parseCatalogQuery(query)
    return classes.filter(c => matchesCatalogQuery(classContent(c), q))
  }, [classes, query])

  const activeId = creating ? null : (selId ?? classes[0]?.id ?? null)
  const selected = classes.find(c => c.id === activeId) ?? null

  return (
    <div className={styles.catLayout}>
      <div className={styles.catIndex}>
        <div className={styles.catNew}>
          <Btn tone="cyan" icon="fa-plus" label="New Class" onClick={() => { setCreating(true); setSelId(null) }} />
        </div>
        <div className={cx(styles.searchWrap, styles.catSearch)}>
          <i className="fa-solid fa-magnifying-glass" />
          <input className={styles.searchIn} value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search classes, or tag:martial" autoComplete="off" spellCheck={false} />
          {query && <i className={cx('fa-solid fa-xmark', styles.catSearchClr)} onClick={() => setQuery('')} />}
        </div>
        {CASTER_ORDER.map(kind => {
          /* Grouped by caster type, but a PATH sits under the class it belongs
             to rather than in its own group — an Eldritch Knight is a third
             caster and its parent is not, and listing it under "Third casters"
             away from the Arbiter would hide the relationship that matters. */
          const rows = shown.filter(c => {
            const d = classContent(c)
            return !d.parent && (d.caster ?? 'none') === kind
          })
          if (!rows.length) return null
          return (
            <div key={kind} className={styles.catGrp}>
              <div className={styles.catGrpHead}>
                <span className={styles.ghT}>{CASTER_LABEL[kind]}{kind === 'none' ? '' : 's'}</span>
                <span className={styles.ghC}>{rows.length}</span>
              </div>
              <div className={styles.catRows}>
                {rows.flatMap(c => [c, ...shown.filter(x => classContent(x).parent === c.id)]).map(c => {
                  const d = classContent(c)
                  const col = d.color || 'var(--amber)'
                  const isPath = !!d.parent
                  return (
                    <button key={c.id} className={cx(styles.catRow, c.id === activeId && !creating && styles.sel, isPath && styles.subRow)}
                      style={{ ['--rar' as string]: col }} onClick={() => { setCreating(false); setSelId(c.id) }}>
                      <span className={styles.crIc}><Icon name={d.icon || 'fa-shield-halved'} /></span>
                      <span className={styles.crTx}>
                        <span className={styles.crT}>{d.name || 'Untitled'}</span>
                        <span className={styles.crS}>
                          {isPath
                            ? <>path</>
                            : <>d{d.hitDie ?? 8}{(d.subclassLevel ?? 0) > 0 && <><span className={styles.op}> · </span>paths at {d.subclassLevel}</>}</>}
                          <span className={styles.op}> · </span>
                          {(d.features ?? []).length} feature{(d.features ?? []).length === 1 ? '' : 's'}
                          {c.draft && <><span className={styles.op}> · </span>draft</>}
                          {!c.draft && !d.published && <><span className={styles.op}> · </span>unpublished</>}
                        </span>
                      </span>
                      <span className={styles.crTag} style={{ color: col, borderColor: col }}>
                        {CASTER_BADGE[d.caster ?? 'none']}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
        {classes.length === 0 && <div className={styles.catEmpty}>{loading ? '· loading ·' : '— library empty —'}</div>}
        {classes.length > 0 && shown.length === 0 && <div className={styles.catEmpty}>— nothing matches —</div>}
      </div>

      <div className={styles.catForm}>
        <ClassForm
          row={selected} creating={creating} lib={lib} featureLib={featureLib}
          itemCatalog={itemCatalog} members={members}
          onSelected={id => { setCreating(false); setSelId(id) }}
          onCleared={() => { setCreating(false); setSelId(null) }}
        />
      </div>
    </div>
  )
}

/** A list of plain display strings — armour training, weapon training, tools.
 *
 *  Chips plus a text field, the same shape as TagsBlock but WITHOUT
 *  normalisation: these are prose a player reads ("All armor", "Shields"), not
 *  selectors anything matches on, so lowercasing them would be wrong.
 *
 *  ONE ROW, not a label/chips/input stack. Three of these stacked read as one
 *  undifferentiated column — the label sits on its own line, the chips on
 *  another, the field on a third, and by the third repetition you cannot tell
 *  where armour ended and weapons began. Pulling the label into a fixed left
 *  column (the .detailRow idiom already in this file) makes each one a single
 *  scannable line and the set of them read as a set. No empty-state chip
 *  either: the field's own placeholder says what to type, so "none" was one
 *  more thing between the label and the control. */
function TrainingRow({ label, values, placeholder, onChange }: {
  label: string; values: string[]; placeholder: string
  onChange: (next: string[]) => void
}) {
  const [input, setInput] = useState('')
  const add = (raw: string) => {
    const v = raw.trim()
    if (v && !values.includes(v)) onChange([...values, v])
    setInput('')
  }
  return (
    <div className={styles.trainRow}>
      <span className={styles.trLab}>{label}</span>
      <div className={styles.trBody}>
        {values.map((v, i) => (
          <span key={i} className={styles.efChip}>{v}
            <i className="fa-solid fa-xmark" onClick={() => onChange(values.filter((_, j) => j !== i))} />
          </span>
        ))}
        <input
          className={cx(styles.sessIn, styles.trIn)} value={input} placeholder={placeholder}
          aria-label={label} {...NO_AUTOFILL}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(input) } }}
        />
      </div>
    </div>
  )
}

/**
 * PACT MAGIC — its own control, not the standard grid with the cells removed.
 *
 * Both numbers are pure step functions of character level with four and five
 * breakpoints between them (lib/spells.ts), so the honest render is the
 * breakpoints. Filled pips for the count against numbers-in-a-grid for the
 * standard table is what makes the two read as different systems, which they
 * are: one slot level and at most four slots, refreshed by a SHORT rest.
 */
function PactLadder() {
  const countSteps = [1, 2, 11, 17]
  const levelSteps = [1, 3, 5, 7, 9]
  return (
    <div className={styles.pactLadder}>
      <div className={styles.plNote}>
        <i className="fa-solid fa-hourglass-half" /> Derived from character level — never authored here
      </div>
      <div className={styles.plRow}>
        <span className={styles.plLab}>Slots</span>
        <div className={styles.plSteps}>
          {countSteps.map(l => (
            <span key={l} className={styles.plStep}>
              <span className={styles.plPips}>
                {Array.from({ length: pactSlotCount(l) }, (_, i) => <span key={i} className={styles.plPip} />)}
              </span>
              <span className={styles.plAt}>L{l}</span>
            </span>
          ))}
        </div>
      </div>
      <div className={styles.plRow}>
        <span className={styles.plLab}>Slot level</span>
        <div className={styles.plSteps}>
          {levelSteps.map(l => (
            <span key={l} className={styles.plStep}>
              <span className={styles.plOrd}>{ordinal(pactSlotLevel(l))}</span>
              <span className={styles.plAt}>L{l}</span>
            </span>
          ))}
        </div>
      </div>
      <div className={styles.plRest}>
        <i className="fa-solid fa-rotate" /> Refreshes on a <b>short</b> or long rest — unlike every other caster
      </div>
    </div>
  )
}

/**
 * The standard progression, DERIVED and read-only.
 *
 * Closed by default with the whole shape in its header, because the numbers
 * themselves are the SRD's and a DM rarely needs to read them cell by cell.
 * Opened, cell tint is keyed to the slot count so the staircase of a full caster
 * against the shallow ramp of a third caster is visible as a shape rather than
 * as a hundred and eighty numbers.
 */
function SlotProgression({ caster }: { caster: ClassCasterType }) {
  const [open, setOpen] = useState(false)
  const rows = useMemo(
    () => Array.from({ length: 20 }, (_, i) => ({ level: i + 1, slots: casterSlots(caster, i + 1) })),
    [caster],
  )
  return (
    <div className={cx(styles.catFx, styles.fold, open && styles.open)}>
      <div className={styles.fxfHead} onClick={() => setOpen(o => !o)} role="button" tabIndex={0} aria-expanded={open}>
        <span className={styles.car}><i className="fa-solid fa-caret-right" /></span>
        <i className="fa-solid fa-table-cells" style={{ color: 'var(--cyan-hot)', fontSize: 11 }} />
        <span className={styles.t}>Slot Progression</span>
        <span className={styles.s}>{casterSummary(caster)}</span>
      </div>
      {open && (
        <div className={styles.gfxBody}>
          <div className={styles.slotGridRO} role="table" aria-label="Spell slots by character level">
            <div className={cx(styles.sgRow, styles.sgHead)} role="row">
              <span className={styles.sgLvl}>lvl</span>
              {Array.from({ length: 9 }, (_, i) => <span key={i} className={styles.sgCell}>{i + 1}</span>)}
            </div>
            {rows.map(r => (
              <div key={r.level} className={styles.sgRow} role="row">
                <span className={styles.sgLvl}>{r.level}</span>
                {r.slots.map((n, i) => (
                  <span key={i} className={cx(styles.sgCell, n > 0 && styles.on)}
                    style={n > 0 ? { ['--fill' as string]: String(0.08 + n * 0.06) } : undefined}>
                    {n > 0 ? n : '·'}
                  </span>
                ))}
              </div>
            ))}
          </div>
          <div className={styles.sgFoot}>
            Read-only. A class stores a caster TYPE, not a table — these come from the SRD
            progression in <code>lib/classes.ts</code>, so they cannot drift from what the player's
            Spellbook spends.
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * FEATURES — a searchable picker plus removable rows, grouped by the level each
 * row's own gate names.
 *
 * The grouping IS the progression display. `gateLevel` (lib/classes.ts) reads
 * the floor out of the expression; anything it cannot read lands under
 * CONDITIONAL with its expression shown verbatim, so nothing is ever hidden by
 * being un-sortable. Edit a gate and the row moves.
 *
 * References, not snapshots: the row stores a feature_catalog id and the name
 * is read live, so re-authoring a feature updates every class that grants it.
 * The snapshot still happens — at assign time (lib/classes.ts assignClass).
 */
/** What tells two identically-named features apart in a list.
 *
 *  `source` used to do this job and stopped the moment the SRD landed: 259 rows
 *  all say "srd", five of them are called "Weapon Mastery", and the picker gave
 *  a DM no way to tell the Barbarian's from the Paladin's. The folder already
 *  holds the answer — the import files by class — so `SRD/Barbarian` shows as
 *  "Barbarian". Source and category remain the fallback for unfiled rows.
 *
 *  Searching already worked: imported features carry their class as a tag, so
 *  "barbarian weapon" narrows to one. Only the display was blind. */
function featureOrigin(d?: { folder?: string; source?: string; category?: string } | null): string {
  if (d?.folder) return leafOf(d.folder)
  return d?.source ?? FEAT_CATS.find(c => c.key === d?.category)?.label ?? 'Feature'
}

function ClassFeaturePicker({ refs, featureLib, onChange }: {
  refs: FeatureGrantRef[]
  featureLib: CatalogFeatureRow[]
  onChange: (next: FeatureGrantRef[]) => void
}) {
  const [query, setQuery] = useState('')
  const attached = new Set(refs.map(r => r.feature_id))

  const hits = useMemo(() => {
    const q = parseCatalogQuery(query)
    return featureLib
      .filter(f => !attached.has(f.id))
      .filter(f => matchesCatalogQuery(featureContent(f), q))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featureLib, query, refs])

  const nameOf = (id: string) => featureLib.find(f => f.id === id)
  const patch = (i: number, p: Partial<FeatureGrantRef>) =>
    onChange(refs.map((r, j) => (j === i ? { ...r, ...p } : r)))

  /* One pass, keeping each row's index so the inline gate field can still write
     back to the right entry after grouping reorders them. */
  const groups = useMemo(() => {
    const by = new Map<number | null, { ref: FeatureGrantRef; i: number }[]>()
    refs.forEach((ref, i) => {
      const g = gateLevel(ref.when)
      if (!by.has(g)) by.set(g, [])
      by.get(g)!.push({ ref, i })
    })
    const levels = [...by.keys()].filter((k): k is number => k !== null).sort((a, b) => a - b)
    return [
      ...levels.map(l => ({ key: String(l), label: String(l).padStart(2, '0'), rows: by.get(l)! })),
      ...(by.has(null) ? [{ key: 'cond', label: 'Conditional', rows: by.get(null)! }] : []),
    ]
  }, [refs])

  const CAP = 6
  const capped = hits.slice(0, CAP)

  return (
    <div className={cx(styles.efBlock, styles.mods)}>
      <div className={styles.efBh}>
        <i className="fa-solid fa-star" />
        <span className={styles.t}>Features</span>
        <span className={styles.n}>{refs.length} referenced</span>
      </div>
      <div className={styles.efRule}>Grouped by the level each gate names — that IS the progression</div>

      <div className={styles.searchWrap}>
        <i className="fa-solid fa-magnifying-glass" />
        <input className={styles.searchIn} value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Search the feature library, or tag:sanctity" autoComplete="off" spellCheck={false} />
      </div>
      {query.trim() && (
        <div className={styles.skPicklist}>
          {capped.length === 0
            ? <div className={styles.fxNone}>Nothing matches “{query.trim()}”.</div>
            : capped.map(f => {
              const d = featureContent(f)
              return (
                <button key={f.id} className={styles.catItem}
                  onClick={() => { onChange([...refs, { feature_id: f.id, when: 'level >= 1' }]); setQuery('') }}>
                  <span className={styles.ciIc} style={{ color: d.color || 'var(--amber)' }}>
                    <Icon name={d.icon ?? 'fa-star'} />
                  </span>
                  <span className={styles.ciTx}>
                    <span className={styles.ciNm}>{d.name || f.id}</span>
                    <span className={styles.ciTy} title={d.folder ?? undefined}>{featureOrigin(d)}</span>
                  </span>
                  {!d.published && <span className={styles.ciRar} style={{ color: 'var(--amber)' }}>unpublished</span>}
                </button>
              )
            })}
          {hits.length > CAP && (
            <div className={styles.catFxNone}>{hits.length - CAP} more — keep typing to narrow.</div>
          )}
        </div>
      )}

      {refs.length === 0 ? (
        <div className={styles.efNone}>
          No features yet. Search above to reference one, then say when it is granted —
          <code> level &gt;= 3</code>. There is no progression table to fill in; these gates are it.
        </div>
      ) : (
        /* ONE FLAT PARENT, not a div per group.
           The gate field regroups its own row on every keystroke — type the "3"
           of `level >= 3` and the row leaves group 01 for group 03. With a
           wrapper div per group that is a change of PARENT, so React unmounts
           the row and mounts a new one: the <input> is a different DOM node and
           the field loses focus after a single character, which makes a gate
           impossible to type. Keyed siblings of ONE parent are reordered with
           insertBefore instead — the node survives, and so does the caret. */
        <div className={styles.clsSpine}>
          {groups.flatMap(g => [
            <div key={`h:${g.key}`} className={cx(styles.clsGrpHead, g.key === 'cond' && styles.cond)}>
              <span className={styles.cgN}>{g.label}</span>
              <span className={styles.cgRule} />
              <span className={styles.cgC}>{g.rows.length}</span>
            </div>,
            ...g.rows.map(({ ref, i }) => {
              const f = nameOf(ref.feature_id)
              const d = f ? featureContent(f) : null
              return (
                <div key={ref.feature_id} className={cx(styles.clsRow, !f && styles.bad)}>
                  <span className={styles.crFIc} style={{ color: d?.color || 'var(--amber)' }}>
                    <Icon name={d?.icon ?? 'fa-star'} />
                  </span>
                  <span className={styles.crFNm} title={ref.feature_id}>
                    {d?.name ?? ref.feature_id}
                    {/* The attached list is where a wrong pick becomes invisible —
                        five "Weapon Mastery" rows look identical once chosen. */}
                    {d?.folder && <span className={styles.crFOrg}>{leafOf(d.folder)}</span>}
                    {!f && <span className={styles.crFGone}> · not in the library</span>}
                  </span>
                  <input
                    className={cx(styles.sessIn, styles.crFWhen)} value={ref.when ?? ''} {...NO_AUTOFILL}
                    onChange={e => patch(i, { when: e.target.value })}
                    aria-label="When the class grants this feature"
                    placeholder="always" 
                    title="When the class grants this — an expression over level and the class's own variables"
                  />
                  <span className={styles.x} onClick={() => onChange(refs.filter((_, j) => j !== i))}>
                    <i className="fa-solid fa-xmark" />
                  </span>
                </div>
              )
            }),
          ])}
        </div>
      )}
    </div>
  )
}

const newId = () => `k${globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Math.random().toString(36).slice(2, 10)}`

/** Keep password managers off an authoring field.
 *
 *  A bare text input with no label, no name and no autocomplete hint is exactly
 *  what Bitwarden, 1Password and LastPass look for, so they offer to fill a
 *  class's kit-option label with somebody's credentials. `autoComplete="off"`
 *  alone is widely ignored by them, hence the three vendor opt-outs.
 *
 *  Spread onto any authoring input whose label lives in its placeholder. */
const NO_AUTOFILL = {
  autoComplete: 'off',
  spellCheck: false,
  'data-1p-ignore': true,
  'data-lpignore': 'true',
  'data-bwignore': true,
} as const

/**
 * STARTING KIT — a list of decisions, not a list of items.
 *
 * 5e hands a new character "(a) scale mail or (b) leather armour, a longbow and
 * 20 arrows", so the unit of authoring is the CHOICE. A group with one option
 * is a fixed grant and the player is never asked about it; two or more is a
 * question that reaches their screen.
 *
 * Items are referenced by catalog id here. The snapshot happens at assign
 * (lib/kit.ts) — see the note there for why a reference cannot survive the trip
 * to a player's screen.
 */
function KitEditor({ raw, itemCatalog, onChange }: {
  /** Whatever the row holds — an EquipChoice[], or the prose this field used
   *  to be. Typed loose on purpose: JSONB does not migrate itself. */
  raw: unknown
  itemCatalog: CatalogItemRow[]
  onChange: (next: EquipChoice[]) => void
}) {
  const choices = kitChoices(raw)
  const legacy = legacyKitText(raw)
  const [pick, setPick] = useState<{ choice: string; option: string } | null>(null)
  const [query, setQuery] = useState('')

  const patchChoice = (ci: number, p: Partial<EquipChoice>) =>
    onChange(choices.map((c, i) => (i === ci ? { ...c, ...p } : c)))
  const patchOption = (ci: number, oi: number, p: Partial<EquipOption>) =>
    patchChoice(ci, { options: choices[ci].options.map((o, i) => (i === oi ? { ...o, ...p } : o)) })

  const hits = useMemo(() => {
    if (!pick) return []
    const q = parseCatalogQuery(query)
    return itemCatalog.filter(it => matchesCatalogQuery(it.data ?? {}, q)).slice(0, 8)
  }, [itemCatalog, query, pick])

  const addEntry = (ci: number, oi: number, entry: EquipEntry) => {
    const items = choices[ci].options[oi].items ?? []
    patchOption(ci, oi, { items: [...items, entry] })
    setQuery('')
    setPick(null)
  }
  const nameOf = (id: string) => itemCatalog.find(i => i.id === id)?.data?.name ?? id

  /** Item data by id, for resolving a pool query the same way assign will.
   *  Same function, so the count shown here is the count the player gets. */
  const itemData = useMemo(() => {
    const m = new Map<string, CatalogItemData>()
    for (const it of itemCatalog) if (it.data) m.set(it.id, it.data)
    return m
  }, [itemCatalog])
  const matchCountFor = (from: string) => resolvePool(from, itemData).length

  return (
    <div className={cx(styles.efBlock, styles.prose)}>
      <div className={styles.efBh}>
        <i className="fa-solid fa-sack-xmark" />
        <span className={styles.t}>Starting Kit</span>
        <span className={styles.n}>
          {choices.length ? `${choices.length} choice${choices.length === 1 ? '' : 's'}` : 'none'}
        </span>
      </div>
      <div className={styles.efRule}>
        Each group is one decision the PLAYER makes — one option means no question
      </div>

      {/* This field used to be free text. Rather than dropping what was already
          written, keep it on screen until the structured version replaces it —
          re-authoring should be transcription, not recall. */}
      {legacy && (
        <div className={styles.kitLegacy}>
          <div className={styles.klHead}>
            <i className="fa-solid fa-file-lines" /> Written before this was a picker · rebuild it below, then this goes
          </div>
          <pre className={styles.klBody}>{legacy}</pre>
        </div>
      )}

      {choices.length === 0 && !legacy && (
        <div className={styles.efNone}>
          No kit. Add a choice for each decision the class offers — "Armour: (a) scale mail,
          (b) leather armour and a longbow" — or a one-option group for something everyone gets.
        </div>
      )}

      {choices.map((ch, ci) => (
        <div key={ch.id} className={styles.kitChoice}>
          <div className={styles.kcHead}>
            <span className={styles.kcN}>{String(ci + 1).padStart(2, '0')}</span>
            <input
              className={cx(styles.sessIn, styles.kcLab)} value={ch.label} {...NO_AUTOFILL}
              onChange={e => patchChoice(ci, { label: e.target.value })}
              aria-label="What this choice is called"
              placeholder="What is being chosen — e.g. Armour" 
            />
            <span className={cx(styles.kcKind, ch.options.length < 2 && styles.fixed)}>
              {ch.options.length < 2 ? 'granted' : `${ch.options.length} options`}
            </span>
            <span className={styles.x} onClick={() => onChange(choices.filter((_, i) => i !== ci))}>
              <i className="fa-solid fa-xmark" />
            </span>
          </div>

          {ch.options.map((op, oi) => {
            const open = pick?.choice === ch.id && pick.option === op.id
            return (
              <div key={op.id} className={styles.kitOpt}>
                <div className={styles.koHead}>
                  <span className={styles.koN}>{ch.options.length > 1 ? `(${'abcdefgh'[oi]})` : '·'}</span>
                  <input
                    className={cx(styles.sessIn, styles.koLab)} value={op.label} {...NO_AUTOFILL}
                    onChange={e => patchOption(ci, oi, { label: e.target.value })}
                    aria-label="How the player reads this option"
                    placeholder="How the player reads it — e.g. Scale mail" 
                  />
                  <span className={styles.x}
                    onClick={() => patchChoice(ci, { options: ch.options.filter((_, i) => i !== oi) })}>
                    <i className="fa-solid fa-xmark" />
                  </span>
                </div>
                <div className={styles.koItems}>
                  {(op.items ?? []).map((r, ri) => (
                    isEquipPick(r)
                      ? (
                        <span key={ri} className={cx(styles.efChip, styles.poolChip)}>
                          <i className="fa-solid fa-dice-d20" />
                          {r.label || 'player picks'}{r.pick > 1 ? ` ×${r.pick}` : ''}
                          <i className="fa-solid fa-xmark"
                            onClick={() => patchOption(ci, oi, { items: op.items.filter((_, i) => i !== ri) })} />
                        </span>
                      )
                      : (
                        <span key={ri} className={styles.efChip}>
                          {nameOf(r.item_id)}{r.qty > 1 ? ` ×${r.qty}` : ''}
                          <i className="fa-solid fa-xmark"
                            onClick={() => patchOption(ci, oi, { items: op.items.filter((_, i) => i !== ri) })} />
                        </span>
                      )
                  ))}
                  <button type="button" className={styles.koAdd}
                    onClick={() => { setPick(open ? null : { choice: ch.id, option: op.id }); setQuery('') }}>
                    <i className="fa-solid fa-plus" /> Item
                  </button>
                  {/* "a martial weapon" — the class names a POOL and the player
                      picks from it. Authored as a catalog query so tagging the
                      martial weapons once serves every class. */}
                  <button type="button" className={styles.koAdd}
                    onClick={() => addEntry(ci, oi, { pick: 1, from: '', label: '' })}>
                    <i className="fa-solid fa-dice-d20" /> Player picks
                  </button>
                </div>
                {open && (
                  <div className={styles.koPick}>
                    <div className={styles.searchWrap}>
                      <i className="fa-solid fa-magnifying-glass" />
                      <input className={styles.searchIn} value={query} autoFocus
                        onChange={e => setQuery(e.target.value)}
                        placeholder="Search the item catalog…" {...NO_AUTOFILL} />
                    </div>
                    <div className={styles.skPicklist}>
                      {hits.length === 0
                        ? <div className={styles.catFxNone}>Nothing matches.</div>
                        : hits.map(it => (
                          <button key={it.id} type="button" className={styles.catItem}
                            onClick={() => addEntry(ci, oi, { item_id: it.id, qty: 1 })}>
                            <span className={styles.ciIc} style={{ color: rarColor(it.data?.rarity) }}>
                              <Icon name={it.data?.icon ?? 'fa-box'} />
                            </span>
                            <span className={styles.ciTx}>
                              <span className={styles.ciNm}>{it.data?.name ?? it.id}</span>
                              <span className={styles.ciTy}>{catDef(it.data?.category).label}</span>
                            </span>
                          </button>
                        ))}
                    </div>
                  </div>
                )}

                {/* Per-entry detail. A plain item asks HOW MANY; a pool asks
                    WHICH ITEMS QUALIFY and how many the player takes.

                    The count applies to everything, not just stacks — what
                    differs is the shape it takes on the sheet: five javelins
                    are five rows, twenty arrows are one "Arrows x20".
                    lib/placement.ts grantMany decides which, off the item's
                    category, so the author sets a number and never has to know
                    the rule. */}
                {(op.items ?? []).length > 0 && (
                  <div className={styles.koQty}>
                    {op.items.map((r, ri) => {
                      const patchEntry = (p: Partial<EquipPick> & Partial<EquipRef>) => patchOption(ci, oi, {
                        items: op.items.map((x, i) => (i === ri ? { ...x, ...p } as EquipEntry : x)),
                      })
                      if (isEquipPick(r)) {
                        const n = matchCountFor(r.from)
                        return (
                          <div key={ri} className={styles.kqPool}>
                            <span className={styles.kqNm}><i className="fa-solid fa-dice-d20" /> Player picks</span>
                            <input className={cx(styles.sessIn, styles.num)} type="number" min={1} value={r.pick}
                              aria-label="How many the player picks"
                              onChange={e => patchEntry({ pick: Math.max(1, parseInt(e.target.value || '1', 10) || 1) })} />
                            <span className={styles.kqOf}>of</span>
                            <input className={cx(styles.sessIn, styles.kqFrom)} value={r.from} {...NO_AUTOFILL}
                              aria-label="Which items qualify"
                              placeholder="tag:martial — or any search that names the pool"
                              onChange={e => patchEntry({ from: e.target.value })} />
                            <span className={cx(styles.kqHit, n === 0 && styles.zero)}>
                              {r.from.trim() ? `${n} match${n === 1 ? '' : 'es'}` : 'name a pool'}
                            </span>
                            <input className={cx(styles.sessIn, styles.kqLabel)} value={r.label ?? ''} {...NO_AUTOFILL}
                              aria-label="What the player is asked"
                              placeholder="What they are asked — e.g. A martial weapon"
                              onChange={e => patchEntry({ label: e.target.value })} />
                          </div>
                        )
                      }
                      const cat = itemCatalog.find(i => i.id === r.item_id)?.data?.category
                      return (
                        <span key={ri} className={styles.kqRow}>
                          <span className={styles.kqNm}>{nameOf(r.item_id)}</span>
                          <input className={cx(styles.sessIn, styles.num)} type="number" min={1} value={r.qty}
                            aria-label={`How many ${nameOf(r.item_id)}`}
                            onChange={e => patchEntry({ qty: Math.max(1, parseInt(e.target.value || '1', 10) || 1) })} />
                          {r.qty > 1 && (
                            <span className={styles.kqNote}>
                              {isStackable(cat) ? 'one stack' : `${r.qty} separate`}
                            </span>
                          )}
                        </span>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}

          <div className={styles.efAdd}>
            <Btn tone="ghost" sm icon="fa-plus" label="Option"
              onClick={() => patchChoice(ci, { options: [...ch.options, { id: newId(), label: '', items: [] }] })} />
          </div>
        </div>
      ))}

      <div className={styles.efAdd}>
        <Btn tone="ghost" sm icon="fa-plus" label="Choice"
          onClick={() => onChange([...choices, { id: newId(), label: '', options: [{ id: newId(), label: '', items: [] }] }])} />
      </div>
    </div>
  )
}

function ClassForm({ row, creating, lib, featureLib, itemCatalog, members, onSelected, onCleared }: {
  row: CatalogClassRow | null
  creating: boolean
  lib: DmClassesState
  featureLib: DmFeaturesState
  itemCatalog: CatalogItemRow[]
  members: PartyMember[]
  onSelected: (id: string) => void
  onCleared: () => void
}) {
  const selId = row?.id ?? null
  // `base` is what the draft is measured against: a parked draft if there is
  // one, else the published content. Reopening a parked draft must read clean.
  const base = creating ? BLANK_CLASS : row ? classContent(row) : null
  const { draft, dirty, savedAt, update, reset, clear } =
    useLocalDraft<ClassDef>(creating ? 'class:__new__' : `class:${selId ?? 'none'}`, base)

  const { nodes, namesByGid, tagUse, ready } = useCatalogNodes()
  const [varsOpen, setVarsOpen] = useState(false)
  const [fxOpen, setFxOpen] = useState(false)
  const [confirm, setConfirm] = useState<null | 'revert' | 'delete'>(null)

  const set = (p: Partial<ClassDef>) => update(x => ({ ...x, ...p }))

  /** Characters this class is on. A name match, because that is what
   *  identity.class stores — the delete warning has to ask the question the
   *  data can actually answer. */
  const usedBy = useMemo(
    () => (draft?.name ? members.filter(m => m.cls === draft.name) : []),
    [members, draft?.name],
  )

  const audit: AuditItem[] = useMemo(() => {
    if (!draft) return []
    // `ready` gates the node list: auditNode skips dangling-target detection
    // entirely when it is empty, so an audit run before the libraries load
    // would report a clean class that is not clean.
    const out = auditNode({ graph: draft.graph, vars: draft.vars }, ready ? nodes : [])

    if (!draft.name?.trim()) {
      out.unshift({ sev: 'err', id: 'field:name', t: 'Unnamed class', s: 'A class needs a name before it can be assigned.' })
    }
    // A subclass inherits its saves; only a class in its own right declares them.
    if (!draft.parent && (draft.saveProficiencies ?? []).length !== 2) {
      out.push({
        sev: 'err', id: 'field:saves', t: 'Saving throws must be exactly two',
        s: `Currently ${(draft.saveProficiencies ?? []).length}. Every 5e class grants two save proficiencies.`,
      })
    }
    if (draft.parent && !lib.classes.some(c => c.id === draft.parent)) {
      out.push({ sev: 'err', id: 'field:parent', t: 'Parent class is gone', s: 'This path points at a class that no longer exists.' })
    }
    if (draft.parent) {
      const p = lib.classes.find(c => c.id === draft.parent)
      if (p && (classContent(p).subclassLevel ?? 0) === 0) {
        out.push({
          sev: 'err', id: null, t: `${classContent(p).name} offers no paths`,
          s: 'Its "path chosen at level" is 0, so this path can never be picked. Set a level on the parent.',
        })
      }
    }
    // A class that offers paths but has none authored asks a question with no
    // answers — the player would be prompted and shown an empty list.
    if (!draft.parent && (draft.subclassLevel ?? 0) > 0) {
      const paths = lib.classes.filter(c => classContent(c).parent === selId)
      if (!paths.length) {
        out.push({
          sev: 'warn', id: null, t: 'No paths authored',
          s: `This class asks for a path at level ${draft.subclassLevel}, but none belongs to it yet.`,
        })
      }
      if (!draft.subclassLabel?.trim()) {
        out.push({ sev: 'warn', id: 'field:pathPrompt', t: 'Path prompt unnamed', s: 'The player is asked to choose with nothing naming the question.' })
      }
    }
    if (draft.caster !== 'none' && !draft.castingAbility) {
      out.push({
        sev: 'err', id: 'field:castingAbility', t: 'No casting ability',
        s: 'A caster needs the ability that backs its save DC and spell attack bonus.',
      })
    }
    if ((draft.skillChooseN ?? 0) > (draft.skillChoices ?? []).length) {
      out.push({
        sev: 'err', id: 'field:skillChooseN', t: 'More skill picks than choices',
        s: `Choose ${draft.skillChooseN} from a list of ${(draft.skillChoices ?? []).length}. Widen the list or lower the count.`,
      })
    }
    if (ready) {
      for (const r of draft.features ?? []) {
        const f = featureLib.features.find(x => x.id === r.feature_id)
        if (!f) {
          out.push({
            sev: 'err', id: null, t: 'Feature not in the library',
            s: `"${r.feature_id}" was referenced but no longer exists. Remove the row or restore the feature.`,
          })
        } else if (!featureContent(f).published) {
          out.push({
            sev: 'warn', id: null, t: `${featureContent(f).name} is unpublished`,
            s: 'Assigning this class will skip it — publish the feature first.',
          })
        }
      }
    }
    if (!draft.desc?.trim()) {
      out.push({ sev: 'warn', id: 'field:desc', t: 'No description', s: 'The player has nothing to read about what this class is.' })
    }
    if ((draft.skillChooseN ?? 0) > 0 && !(draft.skillChoices ?? []).length) {
      out.push({
        sev: 'warn', id: null, t: 'No eligible skills',
        s: `The class says pick ${draft.skillChooseN}, but offers nothing to pick from.`,
      })
    }
    for (const ch of kitChoices(draft.startingEquipment)) {
      if (!ch.label?.trim()) {
        out.push({ sev: 'warn', id: null, t: 'Unlabelled kit choice', s: 'The player will be asked to choose with nothing naming the question.' })
      }
      const empty = (ch.options ?? []).filter(o => !(o.items ?? []).length)
      if (empty.length) {
        out.push({
          sev: 'err', id: null, t: `"${ch.label || 'A kit choice'}" has an empty option`,
          s: 'An option that hands over no items is dropped at assign — the player would pick it and receive nothing.',
        })
      }
      const unlabelled = (ch.options ?? []).filter(o => !o.label?.trim())
      if (unlabelled.length && (ch.options ?? []).length > 1) {
        out.push({ sev: 'warn', id: null, t: `"${ch.label || 'A kit choice'}" has an unnamed option`, s: 'The player picks by label — an unnamed one reads as a blank button.' })
      }
    }
    if (!(draft.features ?? []).length) {
      out.push({ sev: 'warn', id: null, t: 'No features', s: 'A class with no features grants nothing when assigned.' })
    }
    // Pushed LAST on purpose: a graph error must never render beside
    // "Safe to publish".
    if (!out.length) out.push({ sev: 'ok', id: null, t: 'Clean', s: 'No errors, no warnings. Safe to publish.' })
    return out
  }, [draft, nodes, ready, featureLib.features, lib.classes, selId])

  const errs = audit.filter(a => a.sev === 'err').length
  const warns = audit.filter(a => a.sev === 'warn').length

  /* Typing saves; a clean record publishes itself. `creating ? null : selId`
     is the id contract the writers already had — the first write of a new
     record mints one, and onCreated adopts it so the next keystroke updates
     that row instead of inserting another. */
  const { busy: autoBusy } = useAutoPublish<ClassDef>({
    draft, dirty, errs, id: creating ? null : selId,
    saveDraft: (id, value) => lib.saveDraft(id, value),
    publish: (id, value) => lib.publishClass(id, value),
    onCreated: id => { clear(); onSelected(id) },
  })

  function onRevert() {
    setConfirm(null)
    reset(row ? row.data : null)
    if (!row) onCleared()
  }

  async function onDuplicate() {
    if (!selId) return
    const id = await lib.duplicateClass(selId)
    if (id) onSelected(id)
  }

  async function onDelete() {
    if (!selId) return
    setConfirm(null)
    await lib.deleteClass(selId)
    onCleared()
  }

  /* A SUBCLASS is a row with a parent, not a nested structure — it grants
     features, rules and proficiencies exactly as a class does, so it wants the
     whole editor. What it does NOT get is the fields it inherits: hit die,
     primary ability and saving throws are the parent's answer, and an override
     here would be a control nothing reads.

     It DOES keep spellcasting: an Eldritch Knight makes a martial class into a
     third caster, and that was the whole argument for a subclass being a row. */
  /* `draft?.` because the null guard now sits below the hooks — see the note
     there. These are derived reads, and every one of them is only rendered
     from JSX that the guard has already protected. */
  const isSub = !!draft?.parent
  const parentClass = draft?.parent ? lib.classes.find(c => c.id === draft.parent) : null
  const parentOptions = lib.classes.filter(c => c.id !== selId && !classContent(c).parent)

  const saves = draft?.saveProficiencies ?? []
  /** Toggling a third save drops the oldest rather than refusing the click —
   *  a control that silently does nothing reads as broken. */
  const toggleSave = (k: AbilityKey) => set({
    saveProficiencies: saves.includes(k)
      ? saves.filter(x => x !== k)
      : [...saves, k].slice(-2),
  })

  const skillChoices = draft?.skillChoices ?? []
  const toggleSkill = (k: string) => set({
    skillChoices: skillChoices.includes(k) ? skillChoices.filter(x => x !== k) : [...skillChoices, k],
  })

  /* AFTER every hook, never before one. This guard used to sit higher, and
     `useAutoPublish` below it is a hook where onSaveDraft/onPublish used to
     be plain functions — so the render after a delete (draft becomes null)
     called fewer hooks than the one before it and React tore the tree down:
     "Rendered fewer hooks than expected." */
  if (!draft) {
    return (
      <div className={styles.catEmpty} style={{ marginTop: 40 }}>
        Select a class, or start a new one.
      </div>
    )
  }

  return (
    /* One wrapper so the form's vertical rhythm can be set once. A bare
       .fieldLab gets its gap from the line box of the inline-block <input>
       that follows it — but before a BLOCK-level widget (a flex chip row, a
       grid) there is no line box and the control sits flush against its own
       label. .clsForm normalises both cases to the same measure. */
    <div className={styles.clsForm}>
      <div className={styles.catFormHead}>
        <span className={styles.cfhT}>
          {draft.parent ? (creating ? 'New Path' : 'Edit Path') : (creating ? 'New Class' : 'Edit Class')}
        </span>
        <span className={styles.cfhId}>{selId ?? 'id minted on first save'}</span>
      </div>

      {/* ---- IDENTITY ---- */}
      <span className={styles.fieldLab}>Name</span>
      <input data-audit="field:name" className={styles.sessIn} value={draft.name} onChange={e => set({ name: e.target.value })}
        placeholder="Name the class…" />

      <span className={styles.fieldLab}>Icon</span>
      <IconPicker value={draft.icon} onPick={ic => set({ icon: ic })} />

      <div className={cx(styles.catGrid3, isSub && styles.hidden)}>
        <div>
          <span className={styles.fieldLab}>Hit die</span>
          <select className={styles.selIn} value={draft.hitDie}
            onChange={e => set({ hitDie: Number(e.target.value) as ClassDef['hitDie'] })}>
            {HIT_DICE.map(d => <option key={d} value={d}>d{d}</option>)}
          </select>
        </div>
        <div>
          <span className={styles.fieldLab}>Primary ability</span>
          <select className={styles.selIn} value={draft.primaryAbility}
            onChange={e => set({ primaryAbility: e.target.value as AbilityKey })}>
            {ABILITY_ORDER.map(a => <option key={a} value={a}>{ABILITY_ABBR[a].toUpperCase()}</option>)}
          </select>
        </div>
        <div>
          <span className={styles.fieldLab}>Tint</span>
          <input className={styles.sessIn} type="color" value={draft.color || '#e2b021'}
            onChange={e => set({ color: e.target.value })} />
        </div>
      </div>

      <div className={styles.catGrid2}>
        <div>
          <span className={styles.fieldLab}>
            Belongs to <span className={styles.dimLab}>— makes this a subclass</span>
          </span>
          <select data-audit="field:parent" className={styles.selIn} value={draft.parent ?? ''}
            onChange={e => set({ parent: e.target.value || undefined })}>
            <option value="">— a class in its own right —</option>
            {parentOptions.map(c => <option key={c.id} value={c.id}>{classContent(c).name || c.id}</option>)}
          </select>
        </div>
        {!isSub && (
          <div>
            <span className={styles.fieldLab}>
              Path chosen at level <span className={styles.dimLab}>— 0 = no subclasses</span>
            </span>
            <input className={cx(styles.sessIn, styles.num)} type="number" min={0} max={20}
              value={draft.subclassLevel ?? 0}
              aria-label="Level at which the player picks a subclass"
              onChange={e => set({ subclassLevel: Math.max(0, Math.min(20, parseInt(e.target.value || '0', 10) || 0)) })} />
          </div>
        )}
      </div>

      {!isSub && (draft.subclassLevel ?? 0) > 0 && (
        <>
          <span className={styles.fieldLab}>
            Path prompt <span className={styles.dimLab}>— what this decision is called in your world</span>
          </span>
          <input data-audit="field:pathPrompt" className={styles.sessIn} value={draft.subclassLabel ?? ''} {...NO_AUTOFILL}
            onChange={e => set({ subclassLabel: e.target.value || undefined })}
            aria-label="What choosing a subclass is called"
            placeholder="e.g. Arbiter Path, Martial Archetype" />
        </>
      )}

      {isSub && (
        <div className={styles.subNote}>
          <i className="fa-solid fa-code-branch" />
          <span>
            A path of <b>{parentClass ? classContent(parentClass).name : draft.parent}</b>. Hit die, primary
            ability and saving throws come from it — set them there, not here. Spellcasting stays: a path
            can make a martial class into a caster.
          </span>
        </div>
      )}

      {/* HIT POINTS ARE NOT AUTHORED. Both lines fall out of the hit die above,
          so they are shown rather than typed — a second field here would be a
          second answer to the same question. A subclass inherits the die, so it
          inherits these too. */}
      <div className={cx(styles.hpRule, isSub && styles.hidden)}>
        <div className={styles.hrHead}>
          <i className="fa-solid fa-heart-pulse" /> Hit points · derived from the hit die
        </div>
        <div className={styles.hrRow}>
          <span className={styles.hrK}>1st level</span>
          <span className={styles.hrV}>{hitPointRules(draft.hitDie).first}</span>
        </div>
        <div className={styles.hrRow}>
          <span className={styles.hrK}>Higher levels</span>
          <span className={styles.hrV}>{hitPointRules(draft.hitDie).higher}</span>
        </div>
      </div>

      <div className={cx(styles.efBlock, styles.prose)}>
        <div className={styles.efBh}>
          <i className="fa-solid fa-feather" /><span className={styles.t}>Description</span>
          <span className={styles.n}><i className="fa-solid fa-eye" /> player-facing · **bold** *italics*</span>
        </div>
        <div className={styles.efRule}>What this class is, in the player's language</div>
        <textarea data-audit="field:desc" className={styles.catProse} value={draft.desc} onChange={e => set({ desc: e.target.value })}
          onKeyDown={markdownShortcuts(desc => set({ desc }))}
          placeholder="e.g. Sworn adjudicators of the Lattice, who read a verdict into every strike…" />
      </div>

      {/* ---- PROFICIENCIES ----
          One block rather than five bare label/control pairs in a row. The
          Effects form groups by block (Modifiers / Flags / Description), and a
          long stack of naked pairs does not read as a sibling of it. */}
      <div className={cx(styles.efBlock, styles.mods)}>
        <div className={styles.efBh}>
          <i className="fa-solid fa-graduation-cap" />
          <span className={styles.t}>Proficiencies</span>
          <span className={styles.n}>{saves.length}/2 saves · {skillChoices.length} skills</span>
        </div>
        <div className={styles.efRule}>What a member of this class is trained in</div>

      <div className={cx(styles.clsSub, isSub && styles.hidden)}>
      <span className={styles.fieldLab}>
        Saving throws <span className={styles.dimLab}>— pick two; a third replaces the oldest</span>
      </span>
      <div data-audit="field:saves" className={styles.profGrid}>
        {ABILITY_ORDER.map(k => {
          const on = saves.includes(k)
          return (
            <button key={k} type="button" className={cx(styles.profChip, on && styles.on)}
              onClick={() => toggleSave(k)} aria-pressed={on}>
              <ProfDots n={on ? 1 : 0} of={1} />
              {ABILITY_ABBR[k].toUpperCase()}
            </button>
          )
        })}
      </div>
      </div>

      <div className={styles.clsSub}>
      <span className={styles.fieldLab}>
        Skill proficiencies <span className={styles.dimLab}>— the eligible list; the player chooses from it</span>
      </span>
      <div className={styles.profGrid}>
        {SKILLS.map(sk => {
          const on = skillChoices.includes(sk.key)
          return (
            <button key={sk.key} type="button" className={cx(styles.profChip, on && styles.on)}
              onClick={() => toggleSkill(sk.key)} aria-pressed={on}>
              <ProfDots n={on ? 1 : 0} of={1} />
              {sk.name} <span className={styles.ab}>{ABILITY_ABBR[sk.ability].toUpperCase()}</span>
            </button>
          )
        })}
      </div>
      <div className={styles.clsChoose}>
        <span className={styles.fieldLab} style={{ margin: 0 }}>Choose</span>
        <input className={cx(styles.sessIn, styles.num)} type="number" min={0} max={skillChoices.length || 18}
          data-audit="field:skillChooseN" value={draft.skillChooseN}
          onChange={e => set({ skillChooseN: Math.max(0, parseInt(e.target.value || '0', 10) || 0) })} />
        <span className={styles.clsChooseS}>
          of {skillChoices.length} eligible. Assigning the class never ticks them — the pick is the player's.
        </span>
      </div>
      </div>
      </div>

      {/* ---- TRAINING & STARTING KIT ---- */}
      <div className={cx(styles.efBlock, styles.flags)}>
        <div className={styles.efBh}>
          <i className="fa-solid fa-shield" />
          <span className={styles.t}>Training &amp; Kit</span>
          <span className={styles.n}>Enter to add</span>
        </div>
        <div className={styles.efRule}>Free text — what the player reads on their sheet</div>
        <TrainingRow
          label="Armour" values={draft.proficiencies?.armor ?? []}
          placeholder="All armor, Shields…"
          onChange={armor => set({ proficiencies: { ...draft.proficiencies, armor } })}
        />
        <TrainingRow
          label="Weapons" values={draft.proficiencies?.weapons ?? []}
          placeholder="Simple weapons, Martial weapons…"
          onChange={weapons => set({ proficiencies: { ...draft.proficiencies, weapons } })}
        />
        <TrainingRow
          label="Tools" values={draft.proficiencies?.tools ?? []}
          placeholder="Thieves' tools…"
          onChange={tools => set({ proficiencies: { ...draft.proficiencies, tools } })}
        />
      </div>

      {/* The kit is its own block, not a field inside Training: training is what
          you are ALLOWED to use, a kit is what you actually walk in carrying —
          and the player answers this one. */}
      {!isSub && (
        <KitEditor
          raw={draft.startingEquipment} itemCatalog={itemCatalog}
          onChange={startingEquipment => set({ startingEquipment })}
        />
      )}

      {/* ---- SPELLCASTING ---- */}
      <div className={styles.catSecLab}><span className={styles.fieldLab}>Spellcasting</span></div>
      <div className={styles.catGrid2}>
        <div>
          <span className={styles.fieldLab}>Caster type</span>
          <select className={styles.selIn} value={draft.caster}
            onChange={e => set({ caster: e.target.value as ClassCasterType })}>
            {CASTER_ORDER.map(c => <option key={c} value={c}>{c === 'none' ? 'None' : CASTER_LABEL[c]}</option>)}
          </select>
        </div>
        {draft.caster !== 'none' && (
          <div>
            <span className={styles.fieldLab}>Casting ability</span>
            <select data-audit="field:castingAbility" className={styles.selIn} value={draft.castingAbility ?? ''}
              onChange={e => set({ castingAbility: (e.target.value || undefined) as AbilityKey | undefined })}>
              <option value="">— pick one —</option>
              {CASTER_ABILITIES.map(a => <option key={a} value={a}>{ABILITY_ABBR[a].toUpperCase()}</option>)}
            </select>
          </div>
        )}
      </div>
      {/* SPELL SAVE DC AND ATTACK BONUS ARE NOT AUTHORED — the class decides the
          FORMULA, the character supplies the numbers. Stated here for the same
          reason the hit-point rule is: it is the class's answer, and it was
          otherwise only visible in the Assign card, long after you had stopped
          thinking about it. lib/classes.ts castingNumbers computes the values. */}
      {draft.caster !== 'none' && (
        <div className={cx(styles.hpRule, styles.castRule)}>
          <div className={styles.hrHead}>
            <i className="fa-solid fa-hat-wizard" /> Spellcasting numbers · derived per character
          </div>
          <div className={styles.hrRow}>
            <span className={styles.hrK}>Save DC</span>
            <span className={styles.hrV}>{castingRules(draft.castingAbility).dc}</span>
          </div>
          <div className={styles.hrRow}>
            <span className={styles.hrK}>Spell attack</span>
            <span className={styles.hrV}>{castingRules(draft.castingAbility).atk}</span>
          </div>
        </div>
      )}

      {draft.caster === 'pact' ? <PactLadder />
        : draft.caster !== 'none' ? <SlotProgression caster={draft.caster} />
          : null}

      {/* ---- FEATURES ---- */}
      <div className={styles.catSecLab}><span className={styles.fieldLab}>Contents</span></div>
      <ClassFeaturePicker
        refs={draft.features ?? []} featureLib={featureLib.features}
        onChange={features => set({ features })}
      />

      {/* ---- SHARED AUTHORING BLOCKS — identical to the item and spell forms ---- */}
      <div className={styles.catSecLab}><span className={styles.fieldLab}>Authoring</span></div>
      <span className={styles.fieldLab}>Targeting tags</span>
      <TagsBlock tags={draft.tags ?? []} tagUse={tagUse} onChange={tags => set({ tags })} />

      <div className={cx(styles.catFx, styles.fold, varsOpen && styles.open)}>
        <div className={styles.fxfHead} onClick={() => setVarsOpen(o => !o)} role="button" tabIndex={0} aria-expanded={varsOpen}>
          <span className={styles.car}><i className="fa-solid fa-caret-right" /></span>
          <i className="fa-solid fa-database" style={{ color: 'var(--cyan-hot)', fontSize: 11 }} />
          <span className={styles.t}>Variables</span>
          <span className={styles.s}>
            {(draft.vars ?? []).length
              ? `${(draft.vars ?? []).length} declared · ${(draft.vars ?? []).map(v => v.name || '?').join(', ')}`
              : 'none · the state this class shares — a save DC, a path counter'}
          </span>
        </div>
        {varsOpen && (
          <div className={styles.gfxBody}>
            <VarsBlock vars={draft.vars ?? []} onChange={vars => set({ vars })} />
          </div>
        )}
      </div>

      <div className={cx(styles.catFx, styles.fold, fxOpen && styles.open)}>
        <div className={styles.fxfHead} onClick={() => setFxOpen(o => !o)} role="button" tabIndex={0} aria-expanded={fxOpen}>
          <span className={styles.car}><i className="fa-solid fa-caret-right" /></span>
          <i className="fa-solid fa-diagram-project" style={{ color: 'var(--cyan-hot)', fontSize: 11 }} />
          <span className={styles.t}>Rules</span>
          <span className={styles.s}>
            {(draft.graph ?? []).length
              ? `${(draft.graph ?? []).length} effect${(draft.graph ?? []).length === 1 ? '' : 's'}`
              : 'none · what the class itself contributes to a roll'}
          </span>
        </div>
        {fxOpen && (
          <div className={styles.gfxBody}>
            <GraphEffects
              graph={draft.graph ?? []} vars={draft.vars ?? []} nodes={nodes} namesByGid={namesByGid}
              onChange={graph => set({ graph })} onVarsChange={vars => set({ vars })}
            />
          </div>
        )}
      </div>

      {/* ---- AUDIT ---- */}
      <div className={styles.clsAudit}>
        <AuditPanel title="Class Audit" audit={audit}
          onJump={a => { setVarsOpen(true); setFxOpen(true); revealAudit(a.id) }} />
      </div>

      {/* ---- ACTIONS ---- */}

      {/* Two explicit rows. Five buttons on one wrap line put PUBLISH — the
          whole point of the bar — alone on an orphan row below the others. */}
      <div className={styles.clsBar}>
        {/* INSIDE the sticky footer — see the note in the loot form. A confirm
            rendered above it sits far down the scrolling flow while the button
            that opened it stays pinned on screen, so the click reads as a
            no-op. */}
        {confirm === 'revert' && (
          <div className={styles.skWarn}>
            <i className="fa-solid fa-triangle-exclamation" />
            <span>
              <b>Discard this draft?</b>{' '}
              {row?.data?.published
                ? 'The published version comes back and nothing a player sees changes.'
                : 'This class has never been published, so discarding removes it entirely.'}
            </span>
            <Btn tone="danger" sm icon="fa-rotate-left" label="Discard" onClick={onRevert} />
            <Btn tone="ghost" sm icon="fa-xmark" label="Cancel" onClick={() => setConfirm(null)} />
          </div>
        )}
        {confirm === 'delete' && (
          <div className={styles.skWarn}>
            <i className="fa-solid fa-triangle-exclamation" />
            <span>
              <b>Delete {draft.name || 'this class'}?</b>{' '}
              {usedBy.length
                ? `${usedBy.map(m => firstName(m.name)).join(', ')} ${usedBy.length === 1 ? 'is' : 'are'} on it. Their sheet keeps what it was already granted — but nothing can be re-assigned from this class again.`
                : 'No character is on it.'}
            </span>
            <Btn tone="danger" sm icon="fa-trash" label="Delete" onClick={() => void onDelete()} />
            <Btn tone="ghost" sm icon="fa-xmark" label="Cancel" onClick={() => setConfirm(null)} />
          </div>
        )}
        <div className={styles.clsBarInfo}>
          <div className={cx(styles.clsStat, errs ? styles.bad : warns ? styles.warn : undefined)}>
            <span className={styles.dot} />
            <span>
              {errs ? `${errs} error${errs === 1 ? '' : 's'} — publish blocked`
                : warns ? `${warns} warning${warns === 1 ? '' : 's'} — publishable`
                  : 'Draft valid · publishable'}
            </span>
          </div>
          {/* Replaces the Save/Publish buttons as the thing you read to know
              where the work is. An error is not a failure to save — it saved,
              as a draft; it is a refusal to publish. */}
          <span className={cx(styles.clsDirty, (autoBusy || dirty) && styles.on)}>
            {autoBusy ? '● Saving…'
              : errs > 0 ? '● Draft — errors block publish'
                : dirty ? '● Saving…'
                  : '● Published automatically'}
          </span>
          <span className={styles.clsSaved}>
            {savedAt ? `Autosaved ${savedAt.toLocaleTimeString([], { hour12: false })}` : ''}
          </span>
        </div>
        {/* Two rows, split by what the action is ABOUT: the row itself, then
            the draft ladder. Five across shared the width equally, which left
            "Save Draft" narrower than its own label — and .btn's label is
            absolutely positioned under a clip-path, so it clips rather than
            overflowing and the icon loses half of itself. */}
        {selId && (
          <div className={cx(styles.clsActs, styles.rowActs)}>
            <Btn tone="ghost" sm icon="fa-clone" label="Duplicate" onClick={() => void onDuplicate()} />
            <Btn tone="ghost" sm icon="fa-trash" label="Delete" onClick={() => setConfirm('delete')} />
          </div>
        )}
        {/* No Save Draft, no Publish: typing saves, and a clean record publishes
            itself. Revert stays because throwing work away must never be
            something that happens automatically. */}
        <div className={styles.clsActs}>
          <Btn tone="ghost" sm icon="fa-rotate-left" label="Revert" onClick={() => setConfirm('revert')} disabled={!dirty} />
        </div>
      </div>
    </div>
  )
}

/**
 * ASSIGN RACE (Actions card) — the class card's twin, and the other half of a
 * character. Everything it writes is derived by lib/races.ts assignRace, which
 * is pure and tested; this is the picker and the report.
 */
function AssignRaceCard({ member, row, raceLib, featureLib, shardCatalog, onUpdate, log }: {
  member: PartyMember
  row: CharacterRow
  raceLib: DmRacesState
  featureLib: CatalogFeatureRow[]
  shardCatalog: Record<string, ShardTree>
  onUpdate: (patch: CharacterUpdate) => Promise<boolean>
  log: (node: ReactNode, kind?: 'cyan' | 'danger') => void
}) {
  const [selId, setSelId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const first = firstName(member.name)

  const published = raceLib.races.filter(r => r.data?.published)
  const shown = useMemo(() => {
    const q = parseCatalogQuery(query)
    // Only races in their own right: a subrace is reached through its parent's
    // dropdown, never assigned on its own.
    return published.filter(r => !r.data.parent && matchesCatalogQuery(r.data, q))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raceLib.races, query])
  const selected = shown.find(r => r.id === selId) ?? null

  const featureData = useMemo(() => {
    const m = new Map<string, CatalogFeatureData>()
    for (const f of featureLib) if (f.data?.published) m.set(f.id, f.data)
    return m
  }, [featureLib])

  /** Subraces of whatever is highlighted. Picked HERE rather than parked for
   *  the player: a subrace is chosen at level 1 alongside the race, with the DM
   *  in the room — unlike a class path, taken levels later. */
  const subraces = useMemo(
    () => (selected ? raceLib.races.filter(r => r.data?.published && r.data.parent === selected.id) : []),
    [raceLib.races, selected],
  )
  const [subId, setSubId] = useState<string | null>(null)
  const sub = subraces.find(r => r.id === subId) ?? null

  const preview = useMemo(
    () => (selected
      ? assignRace(row, selected.id, selected.data, featureData, shardCatalog,
        sub ? { id: sub.id, data: sub.data } : undefined)
      : null),
    [selected, row, featureData, shardCatalog, sub],
  )

  /** What its boost rules do to the sheet. Read off the same rules the engine
   *  compiles, so the preview cannot promise a number the sheet will not get. */
  const boosts = useMemo(
    () => (selected?.data.graph ?? []).filter(g => g.op === 'boost'),
    [selected],
  )

  async function assign() {
    if (!selected || !preview) return
    setBusy(true)
    const ok = await onUpdate(preview.patch)
    setBusy(false)
    if (!ok) return
    log(
      <>Set <span className={styles.who}>{first}</span> to <span className={styles.obj}>{selected.data.name}</span>
        {preview.granted.length ? <> · granted {preview.granted.length} trait{preview.granted.length === 1 ? '' : 's'}</> : null}
      </>,
      'cyan',
    )
  }

  return (
    <div className={cx(styles.actCard, styles.wide)}>
      <div className={styles.acTitle}>
        <i className="fa-solid fa-leaf lead" /><span className={styles.num}>G</span>
        <span className={styles.t}>Race</span>
      </div>

      <div className={styles.detailRow}>
        <span className={styles.drLab}>Currently</span>
        <span className={styles.drVal}>
          {row.identity?.race || '— none —'}
          {row.identity?.subrace ? ` · ${row.identity.subrace}` : ''}
        </span>
      </div>

      <span className={styles.fieldLab}>Library · published races only</span>
      <div className={styles.searchWrap}>
        <i className="fa-solid fa-magnifying-glass" />
        <input className={styles.searchIn} value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Search races…" autoComplete="off" spellCheck={false} />
      </div>
      <div className={styles.catList}>
        {published.length === 0 ? (
          <div className={styles.catListEmpty}>No published races — author one in the Catalog&apos;s Races tab.</div>
        ) : shown.length === 0 ? (
          <div className={styles.catListEmpty}>Nothing matches “{query.trim()}”.</div>
        ) : shown.map(r => (
          <button key={r.id} className={cx(styles.catItem, r.id === selId && styles.sel)}
            onClick={() => { setSelId(r.id); setSubId(null) }}>
            <span className={styles.ciIc} style={{ color: r.data.color || 'var(--good)' }}>
              <Icon name={r.data.icon || 'fa-leaf'} />
            </span>
            <span className={styles.ciTx}>
              <span className={styles.ciNm}>{r.data.name}</span>
              <span className={styles.ciTy}>
                {r.data.parent ? 'subrace' : 'race'} · {(r.data.features ?? []).length} traits
              </span>
            </span>
          </button>
        ))}
      </div>

      {selected && subraces.length > 0 && (
        <>
          <span className={styles.fieldLab}>
            {selected.data.subraceLabel || 'Lineage'} <span className={styles.dimLab}>— chosen now, with you</span>
          </span>
          <select className={styles.selIn} value={subId ?? ''} onChange={e => setSubId(e.target.value || null)}>
            <option value="">— none —</option>
            {subraces.map(r => <option key={r.id} value={r.id}>{r.data.name}</option>)}
          </select>
        </>
      )}

      {preview && selected && (
        <div className={styles.clsPreview}>
          {boosts.length > 0 && (
            <div className={styles.cpLine}>
              <i className="fa-solid fa-arrow-up-right-dots" /> Sheet
              <span className={styles.cpNames}>
                {boosts.map(b => `${b.stat} ${Number(b.value) >= 0 ? '+' : ''}${b.value}`).join(' · ')}
                {' — layered, and removed if the race changes'}
              </span>
            </div>
          )}
          <div className={styles.cpLine}>
            <i className="fa-solid fa-star" /> Grants <b>{preview.granted.length}</b> trait{preview.granted.length === 1 ? '' : 's'}
            {preview.granted.length > 0 && <span className={styles.cpNames}>{preview.granted.join(', ')}</span>}
          </div>
          {preview.pending.length > 0 && (
            <div className={cx(styles.cpLine, styles.dim)}>
              <i className="fa-solid fa-lock" /> <b>{preview.pending.length}</b> still gated
              <span className={styles.cpNames}>
                {preview.pending.slice(0, 4).map(p => `${p.name} (${p.when})`).join(', ')}
              </span>
            </div>
          )}
          {(selected.data.languages ?? []).length > 0 && (
            <div className={cx(styles.cpLine, styles.dim)}>
              <i className="fa-solid fa-language" /> Speaks
              <span className={styles.cpNames}>
                {(selected.data.languages ?? []).join(', ')}
                {preview.languagePicks > 0 ? ` + ${preview.languagePicks} of their choosing` : ''}
              </span>
            </div>
          )}
          {preview.skillPicks > 0 && (
            <div className={cx(styles.cpLine, styles.dim)}>
              <i className="fa-solid fa-graduation-cap" /> Player picks <b>{preview.skillPicks}</b> skill
              <span className={styles.cpNames}>waits on their Codex until they choose</span>
            </div>
          )}
          {row.identity?.race && row.identity.race !== selected.data.name && (
            <div className={cx(styles.cpLine, styles.warn)}>
              <i className="fa-solid fa-triangle-exclamation" /> Replaces <b>{row.identity.race}</b> — its traits and
              its sheet bonuses come off. Class grants are untouched.
            </div>
          )}
        </div>
      )}

      <div className={styles.grantAction}>
        <Btn tone="amber" icon="fa-arrow-right-to-bracket"
          label={busy ? 'Assigning…' : selected ? `Assign to ${first}` : 'Assign race'}
          onClick={() => void assign()} disabled={!selected || busy} />
      </div>
    </div>
  )
}

/**
 * ASSIGN CLASS (Actions card) — the boundary where a template becomes state.
 *
 * Everything it writes is derived by lib/classes.ts assignClass, which is pure
 * and tested; this card is the picker and the report. It seeds the two cards
 * below it in the same tab (Spells, Skills), which is why it reads first.
 *
 * Only PUBLISHED classes appear, matching the Grant Feature and Grant Spell
 * pickers — a draft is the DM's unfinished work, not something to put on a
 * character.
 */
function AssignClassCard({ member, row, classLib, featureLib, itemCatalog, shardCatalog, onUpdate, log }: {
  member: PartyMember
  row: CharacterRow
  classLib: DmClassesState
  featureLib: CatalogFeatureRow[]
  itemCatalog: CatalogItemRow[]
  shardCatalog: Record<string, ShardTree>
  onUpdate: (patch: CharacterUpdate) => Promise<boolean>
  log: (node: ReactNode, kind?: 'cyan' | 'danger') => void
}) {
  const [selId, setSelId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const first = firstName(member.name)
  const level = row.identity?.level ?? 1

  const published = classLib.classes.filter(c => c.data?.published)
  const shown = useMemo(() => {
    const q = parseCatalogQuery(query)
    return published.filter(c => matchesCatalogQuery(c.data, q))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classLib.classes, query])
  // Same rule as Grant Feature and Grant Spell: the selection is whatever is
  // visible, so searching past your choice disarms the button rather than
  // assigning something off-screen.
  const selected = shown.find(c => c.id === selId) ?? null

  /** Published feature content by id — what a grant is allowed to snapshot. */
  const featureData = useMemo(() => {
    const m = new Map<string, CatalogFeatureData>()
    for (const f of featureLib) if (f.data?.published) m.set(f.id, f.data)
    return m
  }, [featureLib])

  /** Item content by id — what the kit snapshot resolves against. */
  const itemData = useMemo(() => {
    const m = new Map<string, CatalogItemData>()
    for (const it of itemCatalog) if (it.data) m.set(it.id, it.data)
    return m
  }, [itemCatalog])

  /** The paths belonging to whatever is highlighted, so assigning parks the
   *  player's choice in the same write. */
  const selectedPaths = useMemo(
    () => (selected
      ? classLib.classes.filter(c => c.data?.published && c.data.parent === selected.id)
        .map(c => ({ id: c.id, data: c.data }))
      : []),
    [classLib.classes, selected],
  )

  const preview = useMemo(
    () => (selected ? assignClass(row, selected.id, selected.data, featureData, itemData, shardCatalog, selectedPaths) : null),
    [selected, row, featureData, itemData, shardCatalog, selectedPaths],
  )

  /** The class this character is ACTUALLY on — not whatever is highlighted in
   *  the picker above, which is a proposal until Assign is pressed. */
  const onClass = classLib.classes.find(c => c.data?.published && c.data.name === row.identity?.class) ?? null
  const paths = onClass
    ? classLib.classes.filter(c => c.data?.published && c.data.parent === onClass.id)
    : []

  async function takePath(pth: CatalogClassRow) {
    if (busy) return
    setBusy(true)
    const r = assignSubclass(row, pth.id, pth.data, featureData, shardCatalog)
    const ok = await onUpdate(r.patch)
    setBusy(false)
    if (!ok) return
    log(
      <><span className={styles.who}>{first}</span> takes the <span className={styles.obj}>{pth.data.name}</span> path
        {r.granted.length ? <> · granted {r.granted.length} feature{r.granted.length === 1 ? '' : 's'}</> : null}
      </>,
      'cyan',
    )
  }

  async function assign() {
    if (!selected || !preview) return
    setBusy(true)
    const ok = await onUpdate(preview.patch)
    setBusy(false)
    if (!ok) return
    log(
      <>Set <span className={styles.who}>{first}</span> to <span className={styles.obj}>{selected.data.name}</span>
        {preview.granted.length ? <> · granted {preview.granted.length} feature{preview.granted.length === 1 ? '' : 's'}</> : null}
      </>,
      'cyan',
    )
  }

  return (
    <div className={cx(styles.actCard, styles.wide)}>
      <div className={styles.acTitle}>
        <i className="fa-solid fa-shield-halved lead" /><span className={styles.num}>H</span>
        <span className={styles.t}>Class</span>
      </div>

      <div className={styles.detailRow}>
        <span className={styles.drLab}>Currently</span>
        <span className={styles.drVal}>{row.identity?.class || '— none —'} · level {level}</span>
      </div>

      <span className={styles.fieldLab}>Library · published classes only</span>
      <div className={styles.searchWrap}>
        <i className="fa-solid fa-magnifying-glass" />
        <input className={styles.searchIn} value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Search classes…" autoComplete="off" spellCheck={false} />
      </div>
      <div className={styles.catList}>
        {published.length === 0 ? (
          <div className={styles.catListEmpty}>No published classes — author one in the Catalog's Classes tab.</div>
        ) : shown.length === 0 ? (
          <div className={styles.catListEmpty}>Nothing matches “{query.trim()}”.</div>
        ) : shown.map(c => (
          <button key={c.id} className={cx(styles.catItem, c.id === selId && styles.sel)} onClick={() => setSelId(c.id)}>
            <span className={styles.ciIc} style={{ color: c.data.color || 'var(--amber)' }}>
              <Icon name={c.data.icon || 'fa-shield-halved'} />
            </span>
            <span className={styles.ciTx}>
              <span className={styles.ciNm}>{c.data.name}</span>
              <span className={styles.ciTy}>d{c.data.hitDie} · {CASTER_LABEL[c.data.caster ?? 'none']}</span>
            </span>
            <span className={styles.ciRar} style={{ color: 'var(--muted)' }}>
              {(c.data.features ?? []).length} feat
            </span>
          </button>
        ))}
      </div>

      {/* Say what the button will do before it is pressed — assigning rewrites
          hit die, saves, armour training and the slot ladder, which is a lot to
          discover afterwards. */}
      {preview && selected && (
        <div className={styles.clsPreview}>
          <div className={styles.cpLine}>
            <i className="fa-solid fa-dice-d20" /> Hit die <b>d{selected.data.hitDie}</b>
            <span className={styles.op}> · </span>
            saves <b>{(selected.data.saveProficiencies ?? []).map(k => ABILITY_ABBR[k].toUpperCase()).join(' + ') || '—'}</b>
            {selected.data.caster !== 'none' && (
              <>
                <span className={styles.op}> · </span>
                {selected.data.caster === 'pact'
                  ? <>pact <b>{pactSlotCount(level)}× {ordinal(pactSlotLevel(level))}</b></>
                  : <>slots <b>{casterSlots(selected.data.caster, level).filter(n => n > 0).join('/') || 'none yet'}</b></>}
              </>
            )}
          </div>
          {selected.data.caster !== 'none' && (() => {
            const cast = castingNumbers(row.sheet ?? {}, selected.data.castingAbility)
            return (
              <div className={styles.cpLine}>
                <i className="fa-solid fa-hat-wizard" />
                {cast
                  ? <>Save DC <b>{cast.saveDC}</b><span className={styles.op}> · </span>spell attack <b>+{cast.attackBonus}</b>
                    <span className={styles.cpNames}>
                      8 + proficiency + {ABILITY_ABBR[selected.data.castingAbility as AbilityKey]?.toUpperCase()} —
                      seeded here, overridable in the Spellcasting card
                    </span></>
                  : <>Save DC and spell attack need ability scores on the sheet first</>}
              </div>
            )
          })()}
          {preview.hpFromClass != null && (
            <div className={cx(styles.cpLine, !preview.hpSeeded && styles.dim)}>
              <i className="fa-solid fa-heart-pulse" />
              {preview.hpSeeded
                ? <>Max HP <b>{preview.hpFromClass}</b> at level {level}
                  <span className={styles.cpNames}>
                    d{selected.data.hitDie} + CON at 1st, then the average each level — the sheet has none yet
                  </span></>
                : <>Max HP stays <b>{row.sheet?.hp?.max ?? 0}</b>
                  <span className={styles.cpNames}>
                    this class would give {preview.hpFromClass} on the average — not overwritten, because
                    that would throw away what was actually rolled. Set it in Vitals if you want it.
                  </span></>}
            </div>
          )}
          <div className={styles.cpLine}>
            <i className="fa-solid fa-star" /> Grants <b>{preview.granted.length}</b> feature{preview.granted.length === 1 ? '' : 's'} at level {level}
            {preview.granted.length > 0 && <span className={styles.cpNames}>{preview.granted.join(', ')}</span>}
          </div>
          {preview.pending.length > 0 && (
            <div className={cx(styles.cpLine, styles.dim)}>
              <i className="fa-solid fa-lock" /> <b>{preview.pending.length}</b> still gated
              <span className={styles.cpNames}>
                {preview.pending.slice(0, 4).map(p => `${p.name} (${p.when})`).join(', ')}
                {preview.pending.length > 4 ? ` +${preview.pending.length - 4} more` : ''}
              </span>
            </div>
          )}
          {(preview.kitChoices > 0 || preview.kitGranted > 0) && (
            <div className={cx(styles.cpLine, styles.dim)}>
              <i className="fa-solid fa-sack-xmark" /> Starting kit ·{' '}
              {preview.kitGranted > 0 && <><b>{preview.kitGranted}</b> item{preview.kitGranted === 1 ? '' : 's'} into the pack now</>}
              {preview.kitGranted > 0 && preview.kitChoices > 0 && <span className={styles.op}> · </span>}
              {preview.kitChoices > 0 && <><b>{preview.kitChoices}</b> choice{preview.kitChoices === 1 ? '' : 's'} for {first}</>}
              {preview.kitChoices > 0 && (
                <span className={styles.cpNames}>the choices wait on their Codex until they pick</span>
              )}
            </div>
          )}
          {selectedPaths.length > 0 && (
            <div className={cx(styles.cpLine, styles.dim)}>
              <i className="fa-solid fa-code-branch" /> {selected.data.subclassLabel || 'Path'} ·{' '}
              <b>{selectedPaths.length}</b> to choose from
              <span className={styles.cpNames}>
                {level >= (selected.data.subclassLevel ?? 0)
                  ? `waits on ${first}'s Codex — they pick it`
                  : `parked now, offered at level ${selected.data.subclassLevel}`}
              </span>
            </div>
          )}
          {(selected.data.skillChooseN ?? 0) > 0 && (
            <div className={cx(styles.cpLine, styles.dim)}>
              <i className="fa-solid fa-graduation-cap" /> Player picks <b>{selected.data.skillChooseN}</b> of{' '}
              {(selected.data.skillChoices ?? []).map(k => SKILLS.find(s => s.key === k)?.name ?? k).join(', ') || '—'}
              <span className={styles.cpNames}>tick them in Proficiencies below</span>
            </div>
          )}
          {row.identity?.class && row.identity.class !== selected.data.name && (
            <div className={cx(styles.cpLine, styles.warn)}>
              <i className="fa-solid fa-triangle-exclamation" /> Replaces <b>{row.identity.class}</b> — everything that
              class granted comes off the sheet. Features from anywhere else stay.
            </div>
          )}
        </div>
      )}

      <div className={styles.grantAction}>
        <Btn tone="amber" icon="fa-arrow-right-to-bracket"
          label={busy ? 'Assigning…' : selected ? `Assign to ${first}` : 'Assign class'}
          onClick={() => void assign()} disabled={!selected || busy} />
      </div>

      {/* THE PATH, once the class is on. Separate from the picker above because
          it is a separate decision made at a separate time — a class is chosen
          at level 1 and its path several levels later. Assigning a path never
          disturbs the class (lib/classes.ts assignSubclass); re-assigning the
          CLASS clears the path, because the path belonged to it. */}
      {onClass && (onClass.data.subclassLevel ?? 0) > 0 && (
        <div className={styles.pathPick}>
          <div className={styles.ppHead}>
            <i className="fa-solid fa-code-branch" />
            <span className={styles.t}>{onClass.data.subclassLabel || 'Path'}</span>
            <span className={styles.n}>
              {level >= (onClass.data.subclassLevel ?? 0)
                ? `chosen at level ${onClass.data.subclassLevel}`
                : `not until level ${onClass.data.subclassLevel}`}
            </span>
          </div>
          {paths.length === 0 ? (
            <div className={styles.catListEmpty}>
              No paths authored for {onClass.data.name} yet.
            </div>
          ) : (
            <div className={styles.ppRows}>
              {paths.map(pth => {
                const on = row.identity?.archetype === pth.data.name
                return (
                  <button key={pth.id} type="button"
                    className={cx(styles.ppRow, on && styles.on)}
                    disabled={busy || level < (onClass.data.subclassLevel ?? 0)}
                    onClick={() => void takePath(pth)}>
                    <span className={styles.ciIc} style={{ color: pth.data.color || 'var(--amber)' }}>
                      <Icon name={pth.data.icon || 'fa-code-branch'} />
                    </span>
                    <span className={styles.ciTx}>
                      <span className={styles.ciNm}>{pth.data.name}</span>
                      <span className={styles.ciTy}>
                        {(pth.data.features ?? []).length} features
                        {pth.data.caster !== 'none' && <> · {CASTER_LABEL[pth.data.caster]}</>}
                      </span>
                    </span>
                    {on && <span className={styles.ppOn}><i className="fa-solid fa-check" /> current</span>}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ============================================================
// RACE LIBRARY (Catalog · Races tab) + ASSIGN RACE
//
// The class editor's twin, and deliberately assembled from its parts: the same
// list+form shell, the same draft ladder, the same gate-grouped feature spine,
// the same shared authoring blocks, the same audit panel. A race is the same
// KIND of object as a class, so the only things that differ are the fields it
// does not have (hit die, saves, spellcasting) and the ones it does (languages).
//
// A RACE HAS NO NUMBER FIELDS. Its +2 DEX, its speed and its darkvision are
// `boost` rules in its own Rules block — they layer through effectiveSheet and
// come back off when the race changes, which a written score never could.
// ============================================================

const BLANK_RACE: RaceDef = {
  name: '', icon: 'fa-leaf', desc: '',
  skillChoices: [], skillChooseN: 0,
  languages: [], languageChooseN: 0,
  proficiencies: {}, features: [], tags: [], vars: [], graph: [], published: false,
}

function RaceLibrarySurface({ lib, featureLib, members }: {
  lib: DmRacesState
  featureLib: DmFeaturesState
  members: PartyMember[]
}) {
  const { races, loading } = lib
  const [selId, setSelId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [query, setQuery] = useState('')

  const shown = useMemo(() => {
    const q = parseCatalogQuery(query)
    return races.filter(r => matchesCatalogQuery(raceContent(r), q))
  }, [races, query])

  const activeId = creating ? null : (selId ?? races[0]?.id ?? null)
  const selected = races.find(r => r.id === activeId) ?? null

  /* Subraces are rows too, so the index nests them under their parent rather
     than listing eleven elf variants beside eleven dwarf ones. A subrace whose
     parent is gone falls back to the top level rather than disappearing. */
  const parents = shown.filter(r => !raceContent(r).parent)
  const orphans = shown.filter(r => {
    const p = raceContent(r).parent
    return p && !races.some(x => x.id === p)
  })
  const childrenOf = (id: string) => shown.filter(r => raceContent(r).parent === id)

  const row = (r: CatalogRaceRow, child = false) => {
    const d = raceContent(r)
    const col = d.color || 'var(--good)'
    const kids = childrenOf(r.id).length
    return (
      <button key={r.id} className={cx(styles.catRow, r.id === activeId && !creating && styles.sel, child && styles.subRow)}
        style={{ ['--rar' as string]: col }} onClick={() => { setCreating(false); setSelId(r.id) }}>
        <span className={styles.crIc}><Icon name={d.icon || 'fa-leaf'} /></span>
        <span className={styles.crTx}>
          <span className={styles.crT}>{d.name || 'Untitled'}</span>
          <span className={styles.crS}>
            {(d.features ?? []).length} feature{(d.features ?? []).length === 1 ? '' : 's'}
            {kids > 0 && <><span className={styles.op}> · </span>{kids} subrace{kids === 1 ? '' : 's'}</>}
            {r.draft && <><span className={styles.op}> · </span>draft</>}
            {!r.draft && !d.published && <><span className={styles.op}> · </span>unpublished</>}
          </span>
        </span>
        {child && <span className={styles.crTag} style={{ color: col, borderColor: col }}>sub</span>}
      </button>
    )
  }

  return (
    <div className={styles.catLayout}>
      <div className={styles.catIndex}>
        <div className={styles.catNew}>
          <Btn tone="cyan" icon="fa-plus" label="New Race" onClick={() => { setCreating(true); setSelId(null) }} />
        </div>
        <div className={cx(styles.searchWrap, styles.catSearch)}>
          <i className="fa-solid fa-magnifying-glass" />
          <input className={styles.searchIn} value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search races, or tag:fey" autoComplete="off" spellCheck={false} />
          {query && <i className={cx('fa-solid fa-xmark', styles.catSearchClr)} onClick={() => setQuery('')} />}
        </div>
        <div className={styles.catRows}>
          {parents.map(p => (
            <Fragment key={p.id}>
              {row(p)}
              {childrenOf(p.id).map(c => row(c, true))}
            </Fragment>
          ))}
          {orphans.map(o => row(o))}
        </div>
        {races.length === 0 && <div className={styles.catEmpty}>{loading ? '· loading ·' : '— library empty —'}</div>}
        {races.length > 0 && shown.length === 0 && <div className={styles.catEmpty}>— nothing matches —</div>}
      </div>

      <div className={styles.catForm}>
        <RaceForm
          row={selected} creating={creating} lib={lib} featureLib={featureLib} members={members}
          onSelected={id => { setCreating(false); setSelId(id) }}
          onCleared={() => { setCreating(false); setSelId(null) }}
        />
      </div>
    </div>
  )
}

function RaceForm({ row, creating, lib, featureLib, members, onSelected, onCleared }: {
  row: CatalogRaceRow | null
  creating: boolean
  lib: DmRacesState
  featureLib: DmFeaturesState
  members: PartyMember[]
  onSelected: (id: string) => void
  onCleared: () => void
}) {
  const selId = row?.id ?? null
  const base = creating ? BLANK_RACE : row ? raceContent(row) : null
  const { draft, dirty, savedAt, update, reset, clear } =
    useLocalDraft<RaceDef>(creating ? 'race:__new__' : `race:${selId ?? 'none'}`, base)

  const { nodes, namesByGid, tagUse, ready } = useCatalogNodes()
  const [varsOpen, setVarsOpen] = useState(false)
  const [fxOpen, setFxOpen] = useState(false)
  const [confirm, setConfirm] = useState<null | 'revert' | 'delete'>(null)

  const set = (p: Partial<RaceDef>) => update(x => ({ ...x, ...p }))

  /* MATCHED BY NAME, because that is what a character stores: `identity.race`
     is the string "Elf", not a race_catalog id. So two rows sharing a name are
     genuinely indistinguishable from the character's side — the warning below
     will name the same player on both, and no amount of care here can tell
     them apart. The audit flags the collision instead. */
  const usedBy = useMemo(
    () => (draft?.name ? members.filter(m => m.race === draft.name) : []),
    [members, draft?.name],
  )
  const nameTwins = useMemo(
    () => (draft?.name
      ? lib.races.filter(r => r.id !== selId && raceContent(r).name === draft.name)
      : []),
    [lib.races, selId, draft?.name],
  )
  /** Races this one could belong to — anything that is not itself and not
   *  already a subrace, so the tree stays one level deep. */
  const parentOptions = lib.races.filter(r => r.id !== selId && !raceContent(r).parent)
  const isSub = !!draft?.parent

  const audit: AuditItem[] = useMemo(() => {
    if (!draft) return []
    const out = auditNode({ graph: draft.graph, vars: draft.vars }, ready ? nodes : [])
    if (nameTwins.length) {
      out.unshift({
        sev: 'warn', id: 'field:name',
        t: `Another race is also called "${draft.name}"`,
        s: `A character records its race by NAME (identity.race is a string), so "${draft.name}" cannot point at one of these two rows rather than the other — the in-use warning below will name the same players on both. Rename one, or delete the one you do not want.`,
      })
    }

    if (!draft.name?.trim()) {
      out.unshift({ sev: 'err', id: 'field:name', t: 'Unnamed race', s: 'A race needs a name before it can be assigned.' })
    }
    if ((draft.skillChooseN ?? 0) > (draft.skillChoices ?? []).length) {
      out.push({
        sev: 'err', id: 'field:skillChooseN', t: 'More skill picks than choices',
        s: `Choose ${draft.skillChooseN} from a list of ${(draft.skillChoices ?? []).length}. Widen the list or lower the count.`,
      })
    }
    if (draft.parent && !lib.races.some(r => r.id === draft.parent)) {
      out.push({ sev: 'err', id: 'field:parent', t: 'Parent race is gone', s: 'This subrace points at a race that no longer exists.' })
    }
    if (ready) {
      for (const r of draft.features ?? []) {
        const f = featureLib.features.find(x => x.id === r.feature_id)
        if (!f) {
          out.push({
            sev: 'err', id: null, t: 'Feature not in the library',
            s: `"${r.feature_id}" was referenced but no longer exists. Remove the row or restore the feature.`,
          })
        } else if (!featureContent(f).published) {
          out.push({
            sev: 'warn', id: null, t: `${featureContent(f).name} is unpublished`,
            s: 'Assigning this race will skip it — publish the feature first.',
          })
        }
      }
    }
    if (!draft.desc?.trim()) {
      out.push({ sev: 'warn', id: 'field:desc', t: 'No description', s: 'The player has nothing to read about what this race is.' })
    }
    if (!(draft.graph ?? []).some(g => g.op === 'boost') && !isSub) {
      out.push({
        sev: 'warn', id: null, t: 'No ability score increase',
        s: 'Nearly every race moves at least one score. Add a boost rule below — a field would not come back off when the race changes.',
      })
    }
    if (!(draft.languages ?? []).length && (draft.languageChooseN ?? 0) === 0 && !isSub) {
      out.push({ sev: 'warn', id: 'field:languages', t: 'No languages', s: 'A race usually speaks at least Common.' })
    }
    if (!out.length) out.push({ sev: 'ok', id: null, t: 'Clean', s: 'No errors, no warnings. Safe to publish.' })
    return out
  }, [draft, nodes, ready, featureLib.features, lib.races, isSub])

  const errs = audit.filter(a => a.sev === 'err').length
  const warns = audit.filter(a => a.sev === 'warn').length

  /* Typing saves; a clean record publishes itself. `creating ? null : selId`
     is the id contract the writers already had — the first write of a new
     record mints one, and onCreated adopts it so the next keystroke updates
     that row instead of inserting another. */
  const { busy: autoBusy } = useAutoPublish<RaceDef>({
    draft, dirty, errs, id: creating ? null : selId,
    saveDraft: (id, value) => lib.saveDraft(id, value),
    publish: (id, value) => lib.publishRace(id, value),
    onCreated: id => { clear(); onSelected(id) },
  })
  function onRevert() {
    setConfirm(null)
    reset(row ? row.data : null)
    if (!row) onCleared()
  }
  async function onDuplicate() {
    if (!selId) return
    const id = await lib.duplicateRace(selId)
    if (id) onSelected(id)
  }
  async function onDelete() {
    if (!selId) return
    setConfirm(null)
    await lib.deleteRace(selId)
    onCleared()
  }

  const skillChoices = draft?.skillChoices ?? []
  const toggleSkill = (k: string) => set({
    skillChoices: skillChoices.includes(k) ? skillChoices.filter(x => x !== k) : [...skillChoices, k],
  })

  /* AFTER every hook, never before one. This guard used to sit higher, and
     `useAutoPublish` below it is a hook where onSaveDraft/onPublish used to
     be plain functions — so the render after a delete (draft becomes null)
     called fewer hooks than the one before it and React tore the tree down:
     "Rendered fewer hooks than expected." */
  if (!draft) {
    return <div className={styles.catEmpty} style={{ marginTop: 40 }}>Select a race, or start a new one.</div>
  }

  return (
    <div className={styles.clsForm}>
      <div className={styles.catFormHead}>
        <span className={styles.cfhT}>{creating ? 'New Race' : isSub ? 'Edit Subrace' : 'Edit Race'}</span>
        <span className={styles.cfhId}>{selId ?? 'id minted on first save'}</span>
      </div>

      <span className={styles.fieldLab}>Name</span>
      <input data-audit="field:name" className={styles.sessIn} value={draft.name} onChange={e => set({ name: e.target.value })}
        placeholder="Name the race…" />

      <span className={styles.fieldLab}>Icon</span>
      <IconPicker value={draft.icon} onPick={ic => set({ icon: ic })} />

      <div className={styles.catGrid2}>
        <div>
          <span className={styles.fieldLab}>
            Belongs to <span className={styles.dimLab}>— makes this a subrace</span>
          </span>
          <select data-audit="field:parent" className={styles.selIn} value={draft.parent ?? ''}
            onChange={e => set({ parent: e.target.value || undefined })}>
            <option value="">— a race in its own right —</option>
            {parentOptions.map(r => <option key={r.id} value={r.id}>{raceContent(r).name || r.id}</option>)}
          </select>
        </div>
        <div>
          <span className={styles.fieldLab}>Tint</span>
          <input className={styles.sessIn} type="color" value={draft.color || '#4fae6b'}
            onChange={e => set({ color: e.target.value })} />
        </div>
      </div>

      {!isSub && (
        <>
          <span className={styles.fieldLab}>
            Subrace prompt <span className={styles.dimLab}>— what the player is asked; blank = no subraces</span>
          </span>
          <input className={styles.sessIn} value={draft.subraceLabel ?? ''} {...NO_AUTOFILL}
            onChange={e => set({ subraceLabel: e.target.value || undefined })}
            aria-label="What choosing a subrace is called"
            placeholder="e.g. Elf Lineage" />
        </>
      )}

      <div className={cx(styles.efBlock, styles.prose)}>
        <div className={styles.efBh}>
          <i className="fa-solid fa-feather" /><span className={styles.t}>Description</span>
          <span className={styles.n}><i className="fa-solid fa-eye" /> player-facing · **bold** *italics*</span>
        </div>
        <div className={styles.efRule}>What this race is, in the player's language</div>
        <textarea data-audit="field:desc" className={styles.catProse} value={draft.desc} onChange={e => set({ desc: e.target.value })}
          onKeyDown={markdownShortcuts(desc => set({ desc }))}
          placeholder="e.g. Long-lived and watchful, elves measure a human life in seasons…" />
      </div>

      {/* THE NUMBERS ARE NOT HERE. +2 DEX, speed and darkvision are boost rules
          in the Rules block below — see the note there. */}
      <div className={styles.raceNums}>
        <i className="fa-solid fa-arrow-up-right-dots" />
        <span>
          Ability increases, speed and darkvision are <b>boost</b> rules, not fields — add them in
          <b> Rules</b> below. They layer onto the sheet and come back off when the race changes.
        </span>
      </div>

      <div className={cx(styles.efBlock, styles.mods)}>
        <div className={styles.efBh}>
          <i className="fa-solid fa-graduation-cap" />
          <span className={styles.t}>Proficiencies &amp; Tongues</span>
          <span className={styles.n}>{skillChoices.length} skills · {(draft.languages ?? []).length} languages</span>
        </div>
        <div className={styles.efRule}>What every member of this race is trained in</div>

        <div className={styles.clsSub}>
          <span className={styles.fieldLab}>
            Skill choices <span className={styles.dimLab}>— the eligible list; the player chooses from it</span>
          </span>
          <div className={styles.profGrid}>
            {SKILLS.map(sk => {
              const on = skillChoices.includes(sk.key)
              return (
                <button key={sk.key} type="button" className={cx(styles.profChip, on && styles.on)}
                  onClick={() => toggleSkill(sk.key)} aria-pressed={on}>
                  <ProfDots n={on ? 1 : 0} of={1} />
                  {sk.name} <span className={styles.ab}>{ABILITY_ABBR[sk.ability].toUpperCase()}</span>
                </button>
              )
            })}
          </div>
          <div className={styles.clsChoose}>
            <span className={styles.fieldLab} style={{ margin: 0 }}>Choose</span>
            <input className={cx(styles.sessIn, styles.num)} type="number" min={0} max={skillChoices.length || 18}
              data-audit="field:skillChooseN" value={draft.skillChooseN}
              onChange={e => set({ skillChooseN: Math.max(0, parseInt(e.target.value || '0', 10) || 0) })} />
            <span className={styles.clsChooseS}>
              of {skillChoices.length} eligible. Most races offer none — leave it at 0 unless this one does.
            </span>
          </div>
        </div>

        <div data-audit="field:languages">
          <TrainingRow
            label="Languages" values={draft.languages ?? []}
            placeholder="Common, Elvish…"
            onChange={languages => set({ languages })}
          />
        </div>
        <div className={styles.clsChoose}>
          <span className={styles.fieldLab} style={{ margin: 0 }}>Plus</span>
          <input className={cx(styles.sessIn, styles.num)} type="number" min={0} value={draft.languageChooseN}
            onChange={e => set({ languageChooseN: Math.max(0, parseInt(e.target.value || '0', 10) || 0) })} />
          <span className={styles.clsChooseS}>of the player's choosing, on top of the fixed ones above.</span>
        </div>

        <TrainingRow
          label="Armour" values={draft.proficiencies?.armor ?? []}
          placeholder="Light armor…"
          onChange={armor => set({ proficiencies: { ...draft.proficiencies, armor } })}
        />
        <TrainingRow
          label="Weapons" values={draft.proficiencies?.weapons ?? []}
          placeholder="Longsword, Shortbow…"
          onChange={weapons => set({ proficiencies: { ...draft.proficiencies, weapons } })}
        />
        <TrainingRow
          label="Tools" values={draft.proficiencies?.tools ?? []}
          placeholder="Smith's tools…"
          onChange={tools => set({ proficiencies: { ...draft.proficiencies, tools } })}
        />
      </div>

      <div className={styles.catSecLab}><span className={styles.fieldLab}>Contents</span></div>
      <ClassFeaturePicker
        refs={draft.features ?? []} featureLib={featureLib.features}
        onChange={features => set({ features })}
      />

      <div className={styles.catSecLab}><span className={styles.fieldLab}>Authoring</span></div>
      <span className={styles.fieldLab}>Targeting tags</span>
      <TagsBlock tags={draft.tags ?? []} tagUse={tagUse} onChange={tags => set({ tags })} />

      <div className={cx(styles.catFx, styles.fold, varsOpen && styles.open)}>
        <div className={styles.fxfHead} onClick={() => setVarsOpen(o => !o)} role="button" tabIndex={0} aria-expanded={varsOpen}>
          <span className={styles.car}><i className="fa-solid fa-caret-right" /></span>
          <i className="fa-solid fa-database" style={{ color: 'var(--cyan-hot)', fontSize: 11 }} />
          <span className={styles.t}>Variables</span>
          <span className={styles.s}>
            {(draft.vars ?? []).length
              ? `${(draft.vars ?? []).length} declared · ${(draft.vars ?? []).map(v => v.name || '?').join(', ')}`
              : 'none · the state this race shares'}
          </span>
        </div>
        {varsOpen && (
          <div className={styles.gfxBody}>
            <VarsBlock vars={draft.vars ?? []} onChange={vars => set({ vars })} />
          </div>
        )}
      </div>

      <div className={cx(styles.catFx, styles.fold, fxOpen && styles.open)}>
        <div className={styles.fxfHead} onClick={() => setFxOpen(o => !o)} role="button" tabIndex={0} aria-expanded={fxOpen}>
          <span className={styles.car}><i className="fa-solid fa-caret-right" /></span>
          <i className="fa-solid fa-diagram-project" style={{ color: 'var(--cyan-hot)', fontSize: 11 }} />
          <span className={styles.t}>Rules</span>
          <span className={styles.s}>
            {(draft.graph ?? []).length
              ? `${(draft.graph ?? []).length} rule${(draft.graph ?? []).length === 1 ? '' : 's'} · ${(draft.graph ?? []).filter(g => g.op === 'boost').length} boost`
              : 'none · ability increases, speed and darkvision go here'}
          </span>
        </div>
        {fxOpen && (
          <div className={styles.gfxBody}>
            <GraphEffects
              graph={draft.graph ?? []} vars={draft.vars ?? []} nodes={nodes} namesByGid={namesByGid}
              onChange={graph => set({ graph })} onVarsChange={vars => set({ vars })}
            />
          </div>
        )}
      </div>

      <div className={styles.clsAudit}>
        <AuditPanel title="Race Audit" audit={audit}
          onJump={a => { setVarsOpen(true); setFxOpen(true); revealAudit(a.id) }} />
      </div>

      <div className={styles.clsBar}>
        {/* INSIDE the sticky footer, not above it. The footer pins itself to
            the bottom of the scroller, so its Delete button is always on
            screen — while a confirm rendered as a preceding sibling sat far
            down the scrolling flow, off screen, and the click read as a
            no-op. A confirmation has to appear where the control that opened
            it is. */}
        {confirm === 'revert' && (
          <div className={styles.skWarn}>
            <i className="fa-solid fa-triangle-exclamation" />
            <span>
              <b>Discard this draft?</b>{' '}
              {row?.data?.published
                ? 'The published version comes back and nothing a player sees changes.'
                : 'This race has never been published, so discarding removes it entirely.'}
            </span>
            <Btn tone="danger" sm icon="fa-rotate-left" label="Discard" onClick={onRevert} />
            <Btn tone="ghost" sm icon="fa-xmark" label="Cancel" onClick={() => setConfirm(null)} />
          </div>
        )}
        {confirm === 'delete' && (
          <div className={styles.skWarn}>
            <i className="fa-solid fa-triangle-exclamation" />
            <span>
              <b>Delete {draft.name || 'this race'}?</b>{' '}
              {usedBy.length
                ? `${usedBy.map(m => firstName(m.name)).join(', ')} ${usedBy.length === 1 ? 'is' : 'are'} on it. Their sheet keeps what it was already granted — but nothing can be re-assigned from this race again.`
                : 'No character is on it.'}
            </span>
            <Btn tone="danger" sm icon="fa-trash" label="Delete" onClick={() => void onDelete()} />
            <Btn tone="ghost" sm icon="fa-xmark" label="Cancel" onClick={() => setConfirm(null)} />
          </div>
        )}
        <div className={styles.clsBarInfo}>
          <div className={cx(styles.clsStat, errs ? styles.bad : warns ? styles.warn : undefined)}>
            <span className={styles.dot} />
            <span>
              {errs ? `${errs} error${errs === 1 ? '' : 's'} — publish blocked`
                : warns ? `${warns} warning${warns === 1 ? '' : 's'} — publishable`
                  : 'Draft valid · publishable'}
            </span>
          </div>
          {/* Replaces the Save/Publish buttons as the thing you read to know
              where the work is. An error is not a failure to save — it saved,
              as a draft; it is a refusal to publish. */}
          <span className={cx(styles.clsDirty, (autoBusy || dirty) && styles.on)}>
            {autoBusy ? '● Saving…'
              : errs > 0 ? '● Draft — errors block publish'
                : dirty ? '● Saving…'
                  : '● Published automatically'}
          </span>
          <span className={styles.clsSaved}>
            {savedAt ? `Autosaved ${savedAt.toLocaleTimeString([], { hour12: false })}` : ''}
          </span>
        </div>
        {selId && (
          <div className={cx(styles.clsActs, styles.rowActs)}>
            <Btn tone="ghost" sm icon="fa-clone" label="Duplicate" onClick={() => void onDuplicate()} />
            <Btn tone="ghost" sm icon="fa-trash" label="Delete" onClick={() => setConfirm('delete')} />
          </div>
        )}
        {/* No Save Draft, no Publish: typing saves, and a clean record publishes
            itself. Revert stays because throwing work away must never be
            something that happens automatically. */}
        <div className={styles.clsActs}>
          <Btn tone="ghost" sm icon="fa-rotate-left" label="Revert" onClick={() => setConfirm('revert')} disabled={!dirty} />
        </div>
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
// ============================================================
// BACKGROUNDS (migration 0021) — the race editor's sibling.
// ============================================================

/** Deliberately NOT a clone of RaceForm. A background shares the race's shape
 *  where it matters — proficiencies, granted features, boost rules, the same
 *  authoring blocks — and carries none of its subrace/parent/language
 *  machinery, which would be dead controls on every row. */
function BackgroundLibrarySurface({ lib, featureLib }: {
  lib: DmBackgroundsState
  featureLib: DmFeaturesState
}) {
  const { backgrounds, loading } = lib
  const [selId, setSelId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [query, setQuery] = useState('')

  const shown = useMemo(() => {
    const q = parseCatalogQuery(query)
    return backgrounds.filter(r => matchesCatalogQuery(backgroundContent(r), q))
  }, [backgrounds, query])

  const activeId = creating ? null : (selId ?? backgrounds[0]?.id ?? null)
  const selected = backgrounds.find(r => r.id === activeId) ?? null

  return (
    <div className={styles.catLayout}>
      <div className={styles.catIndex}>
        <div className={styles.catNew}>
          <Btn tone="cyan" icon="fa-plus" label="New Background" onClick={() => { setCreating(true); setSelId(null) }} />
        </div>
        <div className={cx(styles.searchWrap, styles.catSearch)}>
          <i className="fa-solid fa-magnifying-glass" />
          <input className={styles.searchIn} value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search backgrounds…" autoComplete="off" spellCheck={false} />
          {query && <i className={cx('fa-solid fa-xmark', styles.catSearchClr)} onClick={() => setQuery('')} />}
        </div>
        <div className={styles.catRows}>
          {shown.map(r => {
            const d = backgroundContent(r)
            const n = (d.features ?? []).length
            return (
              <button key={r.id} className={cx(styles.catRow, r.id === activeId && !creating && styles.sel)}
                style={{ ['--rar' as string]: 'var(--cyan)' }} onClick={() => { setCreating(false); setSelId(r.id) }}>
                <span className={styles.crIc}><Icon name={d.icon || 'fa-scroll'} /></span>
                <span className={styles.crTx}>
                  <span className={styles.crT}>{d.name || 'Untitled'}</span>
                  <span className={styles.crS}>
                    {(d.skills ?? []).length} skill{(d.skills ?? []).length === 1 ? '' : 's'}
                    <span className={styles.op}> · </span>{n} feature{n === 1 ? '' : 's'}
                    {d.source === 'srd' && <><span className={styles.op}> · </span><span className={styles.srdBadge}>SRD</span></>}
                    {d.modified && <><span className={styles.op}> · </span>edited</>}
                    {r.draft && <><span className={styles.op}> · </span>draft</>}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
        {backgrounds.length === 0 && <div className={styles.catEmpty}>{loading ? '· loading ·' : '— library empty —'}</div>}
        {backgrounds.length > 0 && shown.length === 0 && <div className={styles.catEmpty}>— nothing matches —</div>}
      </div>

      <div className={styles.catForm}>
        <BackgroundForm
          row={selected} creating={creating} lib={lib} featureLib={featureLib}
          onSelected={id => { setCreating(false); setSelId(id) }}
          onCleared={() => { setCreating(false); setSelId(null) }}
        />
      </div>
    </div>
  )
}

const BLANK_BACKGROUND: BackgroundDef = {
  name: '', icon: 'fa-scroll', desc: '',
  abilityOptions: [], skills: [], skillChooseN: 0,
  proficiencies: {}, features: [], equipment: [],
  tags: [], vars: [], graph: [],
}

function BackgroundForm({ row, creating, lib, featureLib, onSelected, onCleared }: {
  row: CatalogBackgroundRow | null
  creating: boolean
  lib: DmBackgroundsState
  featureLib: DmFeaturesState
  onSelected: (id: string) => void
  onCleared: () => void
}) {
  const selId = row?.id ?? null
  const base = creating ? BLANK_BACKGROUND : row ? backgroundContent(row) : null
  const { draft, dirty, savedAt, update, reset, clear } =
    useLocalDraft<BackgroundDef>(creating ? 'background:__new__' : `background:${selId ?? 'none'}`, base)

  const [confirm, setConfirm] = useState<null | 'revert' | 'delete'>(null)
  const set = (p: Partial<BackgroundDef>) => update(x => ({ ...x, ...p }))

  const { nodes, namesByGid, ready } = useCatalogNodes()

  const audit: AuditItem[] = useMemo(() => {
    if (!draft) return []
    const out = auditNode({ graph: draft.graph, vars: draft.vars }, ready ? nodes : [])
    if (!draft.name?.trim()) {
      out.unshift({ sev: 'err', id: 'field:name', t: 'Unnamed background', s: 'A background needs a name before it can be assigned.' })
    }
    if ((draft.abilityOptions ?? []).length && (draft.abilityOptions ?? []).length !== 3) {
      out.push({
        sev: 'warn', id: 'field:abilities', t: 'Unusual ability spread',
        s: `SRD backgrounds offer exactly three abilities to spend the increase across; this offers ${(draft.abilityOptions ?? []).length}.`,
      })
    }
    if (!out.length) out.push({ sev: 'ok', id: null, t: 'Clean', s: 'No errors, no warnings.' })
    return out
  }, [draft, nodes, ready])

  const errs = audit.filter(a => a.sev === 'err').length

  const { busy: autoBusy } = useAutoPublish<BackgroundDef>({
    draft, dirty, errs, id: creating ? null : selId,
    saveDraft: (id, value) => lib.saveDraft(id, value),
    publish: (id, value) => lib.publishBackground(id, value),
    onCreated: id => { clear(); onSelected(id) },
  })

  function onRevert() {
    setConfirm(null)
    reset(row ? row.data : null)
    if (!row) onCleared()
  }
  async function onDuplicate() {
    if (!selId) return
    const id = await lib.duplicateBackground(selId)
    if (id) onSelected(id)
  }
  async function onDelete() {
    if (!selId) return
    setConfirm(null)
    await lib.deleteBackground(selId)
    clear(); onCleared()
  }

  if (!draft) {
    return <div className={styles.catEmpty} style={{ marginTop: 40 }}>Select a background, or start a new one.</div>
  }

  const abil = draft.abilityOptions ?? []

  return (
    <div className={styles.clsForm}>
      <div className={styles.catFormHead}>
        <Icon name={draft.icon || 'fa-scroll'} />
        <span className={styles.cfhT}>{draft.name || (creating ? 'New Background' : 'Untitled')}</span>
        <span className={styles.cfhId}>{draft.srd_key ?? (selId ?? 'unsaved')}</span>
      </div>

      <div className={styles.catGrid2}>
        <div>
          <span className={styles.fieldLab}>Name</span>
          <input data-audit="field:name" className={styles.sessIn} value={draft.name}
            placeholder="e.g. Acolyte" {...NO_AUTOFILL}
            onChange={e => set({ name: e.target.value })} />
        </div>
        <div>
          <span className={styles.fieldLab}>Icon</span>
          <IconPicker value={draft.icon} onPick={ic => set({ icon: ic })} />
        </div>
      </div>

      <div className={styles.qLabRow}>
        <span className={styles.fieldLab}>Description</span>
        <span className={cx(styles.qFacing, styles.player)}><i className="fa-solid fa-eye" /> Player-facing</span>
        <ProsePreview text={draft.desc ?? ''} />
      </div>
      <textarea className={styles.catProse} value={draft.desc ?? ''}
        placeholder="What this background is, in the player's words…"
        onKeyDown={markdownShortcuts(desc => set({ desc }))}
        onChange={e => set({ desc: e.target.value })} />

      {/* ---- ABILITY INCREASE ----
          The three abilities the increase may be spent across. This records the
          OFFER, not the result: the SRD lets the player split +2/+1 or +1/+1/+1,
          so the actual numbers are a boost rule added at assign time. Writing a
          guessed +2 here would be a wrong number on a sheet. */}
      <div data-audit="field:abilities" className={styles.catSecLab}>
        <span className={styles.fieldLab}>Ability Increase <span className={styles.labHint}>· the three it may be spent across</span></span>
      </div>
      <div className={styles.acRow}>
        {ABILITY_ORDER.map(k => (
          <span key={k}
            className={cx(styles.acChip, abil.includes(k) && styles.on)}
            onClick={() => set({ abilityOptions: abil.includes(k) ? abil.filter(a => a !== k) : [...abil, k] })}>
            {ABILITY_ABBR[k].toUpperCase()}
          </span>
        ))}
      </div>

      {/* ---- SKILLS ---- */}
      <div className={styles.catSecLab}><span className={styles.fieldLab}>Skill Proficiencies</span></div>
      <div className={styles.acRow}>
        {SKILLS.map(sk => {
          const on = (draft.skills ?? []).includes(sk.name)
          return (
            <span key={sk.name} className={cx(styles.acChip, on && styles.on)}
              onClick={() => set({ skills: on ? (draft.skills ?? []).filter(x => x !== sk.name) : [...(draft.skills ?? []), sk.name] })}>
              {sk.name}
            </span>
          )
        })}
      </div>

      {/* ---- TOOLS / LANGUAGES ---- */}
      <div className={styles.catGrid2}>
        <div>
          <span className={styles.fieldLab}>Tool Proficiencies <span className={styles.labHint}>· comma separated</span></span>
          <input className={styles.sessIn} value={(draft.proficiencies?.tools ?? []).join(', ')}
            placeholder="e.g. Calligrapher's Supplies" {...NO_AUTOFILL}
            onChange={e => set({ proficiencies: { ...draft.proficiencies, tools: e.target.value.split(',').map(x => x.trim()).filter(Boolean) } })} />
        </div>
        <div>
          <span className={styles.fieldLab}>Languages <span className={styles.labHint}>· comma separated</span></span>
          <input className={styles.sessIn} value={(draft.proficiencies?.languages ?? []).join(', ')}
            placeholder="e.g. Celestial" {...NO_AUTOFILL}
            onChange={e => set({ proficiencies: { ...draft.proficiencies, languages: e.target.value.split(',').map(x => x.trim()).filter(Boolean) } })} />
        </div>
      </div>

      {/* ---- GRANTED FEATURES — the SRD's feat lands here ---- */}
      <div className={styles.catSecLab}><span className={styles.fieldLab}>Granted Features</span></div>
      <ClassFeaturePicker
        refs={draft.features ?? []} featureLib={featureLib.features}
        onChange={features => set({ features })}
      />

      {/* ---- SHARED AUTHORING BLOCKS — identical to the class and race forms ---- */}
      <GraphEffects graph={draft.graph ?? []} vars={draft.vars ?? []} nodes={nodes} namesByGid={namesByGid}
        onChange={graph => set({ graph })} onVarsChange={vars => set({ vars })} />
      <VarsBlock vars={draft.vars ?? []} onChange={vars => set({ vars })} />
      <div className={styles.catSecLab}><span className={styles.fieldLab}>Targeting tags</span></div>
      <TagsBlock tags={draft.tags ?? []} tagUse={new Map()} onChange={tags => set({ tags })} />

      <div className={styles.clsAudit}>
        <AuditPanel title="Background Audit" audit={audit} onJump={a => revealAudit(a.id)} />
      </div>

      <div className={styles.clsBar}>
        {/* INSIDE the sticky footer, not above it. The footer pins itself to
            the bottom of the scroller, so its Delete button is always on
            screen — while a confirm rendered as a preceding sibling sat far
            down the scrolling flow, off screen, and the click read as a
            no-op. A confirmation has to appear where the control that opened
            it is. */}
        {confirm === 'revert' && (
          <div className={styles.skWarn}>
            <i className="fa-solid fa-triangle-exclamation" />
            <span><b>Discard this draft?</b> {row?.data?.published ? 'The published version comes back.' : 'This background has never been published, so discarding removes it entirely.'}</span>
            <Btn tone="danger" sm icon="fa-rotate-left" label="Discard" onClick={onRevert} />
            <Btn tone="ghost" sm icon="fa-xmark" label="Cancel" onClick={() => setConfirm(null)} />
          </div>
        )}
        {confirm === 'delete' && (
          <div className={styles.skWarn}>
            <i className="fa-solid fa-triangle-exclamation" />
            <span><b>Delete {draft.name || 'this background'}?</b> Characters already assigned it keep what it granted.</span>
            <Btn tone="danger" sm icon="fa-trash" label="Delete" onClick={() => void onDelete()} />
            <Btn tone="ghost" sm icon="fa-xmark" label="Cancel" onClick={() => setConfirm(null)} />
          </div>
        )}
        <div className={styles.clsBarInfo}>
          <span className={cx(styles.clsDirty, (autoBusy || dirty) && styles.on)}>
            {autoBusy ? '● Saving…'
              : errs > 0 ? '● Draft — errors block publish'
                : dirty ? '● Saving…'
                  : '● Published automatically'}
          </span>
          <span className={styles.clsSaved}>
            {savedAt ? `Autosaved ${savedAt.toLocaleTimeString([], { hour12: false })}` : ''}
          </span>
        </div>
        {selId && (
          <div className={cx(styles.clsActs, styles.rowActs)}>
            <Btn tone="ghost" sm icon="fa-clone" label="Duplicate" onClick={() => void onDuplicate()} />
            <Btn tone="ghost" sm icon="fa-trash" label="Delete" onClick={() => setConfirm('delete')} />
          </div>
        )}
        <div className={styles.clsActs}>
          <Btn tone="ghost" sm icon="fa-rotate-left" label="Revert" onClick={() => setConfirm('revert')} disabled={!dirty} />
        </div>
      </div>
    </div>
  )
}

function LoreSecHead({ icon, label, first }: { icon: string; label: string; first?: boolean }) {
  return (
    <div className={cx(styles.loreSecH, first && styles.first)}>
      <Icon name={icon} />
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
                  <span className={styles.ciIc}><Icon name={t.icon} /></span>
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
        <span className={styles.selPortrait}><Icon name={icon} /></span>
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
        <ProsePreview text={backstory} />
      </div>
      <textarea
        className={styles.qPlayerDesc}
        value={backstory}
        onChange={e => setBackstory(e.target.value)}
        onKeyDown={markdownShortcuts(setBackstory)}
        placeholder="The prose players read on the Lore screen…"
      />
      <p className={styles.acHint}>**bold**  *italics*  [text](url)  ## heading · blank line = new paragraph</p>

      {/* nature — trait/ideal/bond/flaw */}
      <LoreSecHead icon="fa-circle-dot" label="Personality / Nature" />
      <div className={styles.catGrid2}>
        <div><span className={styles.fieldLab}>Personality Trait</span><textarea className={styles.loreNatArea} value={trait} onChange={e => setTrait(e.target.value)} onKeyDown={markdownShortcuts(setTrait)} /></div>
        <div><span className={styles.fieldLab}>Ideal</span><textarea className={styles.loreNatArea} value={ideal} onChange={e => setIdeal(e.target.value)} onKeyDown={markdownShortcuts(setIdeal)} /></div>
        <div><span className={styles.fieldLab}>Bond</span><textarea className={styles.loreNatArea} value={bond} onChange={e => setBond(e.target.value)} onKeyDown={markdownShortcuts(setBond)} /></div>
        <div><span className={styles.fieldLab}>Flaw</span><textarea className={styles.loreNatArea} value={flaw} onChange={e => setFlaw(e.target.value)} onKeyDown={markdownShortcuts(setFlaw)} /></div>
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
            <input className={cx(styles.sessIn, styles.loreRelDesc)} value={r.desc}
              onChange={e => patchRelation(i, { desc: e.target.value })}
              onKeyDown={markdownShortcuts(desc => patchRelation(i, { desc }))}
              placeholder="Description…" />
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
            <Icon name={icon} />
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
        <ProsePreview text={description} />
      </div>
      <textarea className={styles.qPlayerDesc} value={description} onChange={e => setDescription(e.target.value)}
        onKeyDown={markdownShortcuts(setDescription)} placeholder="The prose the players read in their Journal…" />

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
      <textarea className={styles.sessRecap} value={recap} onChange={e => setRecap(e.target.value)}
        onKeyDown={markdownShortcuts(setRecap)} placeholder="Write the session recap — what happened, who did what, where it left off…" />

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
      <span className={styles.bi}><Icon name={icon} /> {label}</span>
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
