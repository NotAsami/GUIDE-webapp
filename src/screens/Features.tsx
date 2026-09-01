import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useOutletContext, useSearchParams } from 'react-router-dom'
import type { CharacterRow, CharacterSection, Feature, ShardPerk, ShardTree } from '../lib/database.types'
import type { CSSProperties } from 'react'
import { Nav } from '../components/Nav'
import { Deco } from '../components/Deco'
import { gearFeatures } from '../lib/effects'
import { shardFeatures, shardPerks } from '../lib/shards'
import { Prose } from '../lib/markdown'
import { interpolate } from '../lib/expr'
import { colorOf } from '../lib/palette'
import { affectedBy, gid, type Gid } from '../lib/graph'
import { featureEffects, isCarrier, isUsable, originChain, runsActivation, toggleVar, usesOf } from '../lib/featureView'
import { useGraph } from '../lib/useGraph'
import { gateOf, playerVars, setVars, type VarRow } from '../lib/graphState'
import type { ExprScope } from '../lib/expr'
import { useActivation } from '../components/ActivationSheet'
import styles from './Features.module.css'
import { Icon } from '../components/Icon'

interface RouteContext {
  character: CharacterRow
  updateSection: <K extends CharacterSection>(section: K, next: CharacterRow[K]) => Promise<void>
  /** Needed when a use writes `sheet` AND `resources` — one round trip, not two
   *  that could land apart. Provided by Layout. */
  updateSections: (patch: Partial<Pick<CharacterRow, CharacterSection>>) => Promise<void>
  shardTrees?: Record<string, ShardTree>
}

/** A feature plus WHERE IT CAME FROM, which the feature itself cannot say.
 *  `category` is the DM's filing for a sheet feature; gear and shard features
 *  have no category at all because they are derived, so the provenance has to
 *  ride alongside rather than inside. */
type Row = { f: Feature; group: string }

/** Filter chips, in order. Derived from what the character actually has — a chip
 *  for a source nobody has is a dead control, so zero-count chips dim and the
 *  set never claims a category the data model does not have (the mockup's
 *  "Subclass" is not a FeatureCategory). */
const CHIPS: { key: string; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'class', label: 'Class' },
  { key: 'feat', label: 'Feat' },
  { key: 'racial', label: 'Racial' },
  { key: 'background', label: 'Background' },
  { key: 'sense', label: 'Sense' },
  { key: 'other', label: 'Other' },
  { key: 'gear', label: 'Gear' },
  { key: 'shard', label: 'Shard' },
]

const ACTS: Record<string, string> = { action: 'Action', bonus: 'Bonus', reaction: 'Reaction', free: 'Free' }

/** Built-in scope identifiers said as a player would say them.
 *
 *  An authored variable has a `label` the DM wrote; `attacksThisTurn` has only
 *  its name, and "Requires attacksThisTurn" is the engine talking to itself
 *  again. A full phrase rather than a noun, because the sentence it replaces
 *  ("Requires …") does not fit a condition about timing. */
const GATE_PHRASE: Record<string, string> = {
  attacksThisTurn: 'Only on your first attack',
}
/** Usable features cluster by activation so "what can I do as a reaction"
 *  survives the loss of group headers. */
const ACT_ORDER = ['action', 'bonus', 'reaction', 'free', '']

const cx = (...v: (string | false | undefined | null)[]) => v.filter(Boolean).join(' ')

/** The damage colour, as custom properties the stylesheet reads via `var(--dt)`.
 *  Shared with the roll panel through lib/palette.ts, so radiant is the same gold
 *  in a feature's effect row as in the roll that row produces. */
function dt(type: string | undefined): CSSProperties | undefined {
  const c = type ? colorOf(type.toLowerCase()) : null
  return c ? ({ ['--dt' as string]: c } as CSSProperties) : undefined
}

/** The short text shown on the card. Falls back to the legacy summary/description
 *  fields so pre-migration data still renders. */
const cardText = (f: Feature) => f.light_description ?? f.summary ?? f.description ?? ''

/** Authored prose with `{...}` references resolved against the character.
 *
 *  Runs BEFORE markdown, so `**{saveDc}**` still bolds and `[x]{fire}` still
 *  colours the substituted text. An unresolvable reference is left as the literal
 *  source — a visible `{saveDc}` is how an author learns it did not resolve, and
 *  blanking it would hide both the typo and the sentence. */
const live = (text: string, scope: ExprScope) => interpolate(text, scope).text

/**
 * Features — the character's abilities as a single continuous stream.
 *
 * Ported from `guide-hud/project/G.U.I.D.E. Features.html`. Three things carry
 * the design and are worth naming, because each replaced something weaker:
 *
 *   THE HEXAGON IS THE USE CONTROL. Not a `Use` button beside the card — the
 *   feature's own icon, which spends, holds or releases and says which underneath.
 *
 *   TABS AND CHIPS ARE INDEPENDENT. Usable/Passive splits by what you can DO;
 *   the chips narrow by where it came from. Group headers are gone entirely, so
 *   a character with two feats does not get a two-card section.
 *
 *   THE TINT IS THE DM'S, THE STATE IS THE APP'S. `Feature.color` washes the card
 *   header and fills the hexagon; spent (red), held (cyan) and hover always
 *   override it, so a colour can never hide whether a feature is available.
 */
export function Features() {
  const { character, updateSection, updateSections, shardTrees = {} } = useOutletContext<RouteContext>()
  const nav = useNavigate()
  const graph = useGraph(character, shardTrees)
  const vars = playerVars(character, shardTrees)

  /* THE DEFAULT TAB IS WHICHEVER HAS ANYTHING IN IT.
     Usable first when it is not empty — it is the half you act on. But a
     character can legitimately have nothing pressable (every one of this
     character's features is a passive `add`), and opening on an empty tab makes a
     fully-populated screen look broken. Computed once on mount, not per render:
     spending the last use of the last usable feature must not yank the player to
     another tab mid-press. */
  const [tab, setTab] = useState<'usable' | 'passive'>(() =>
    (character.sheet?.features ?? []).some(isUsable)
      || gearFeatures(character).some(isUsable)
      || shardFeatures(character, shardTrees).some(isUsable)
      ? 'usable' : 'passive')
  const [src, setSrc] = useState('all')
  /** The open popup, plus the trail that got there. Features reach other
   *  features through AFFECTED BY, so opening a contributor pushes and BACK
   *  pops — without the stack, following a link is a one-way trip. */
  const [params, setParams] = useSearchParams()
  const [popup, setPopup] = useState<string | null>(null)
  const [stack, setStack] = useState<string[]>([])
  /** The card that just refused a press, for the shake. */
  const [denied, setDenied] = useState<string | null>(null)

  const sheetFeatures = character.sheet?.features ?? []
  const fromGear = gearFeatures(character)
  const fromShards = shardFeatures(character, shardTrees)
  const perks = shardPerks(character, shardTrees)

  const rows: Row[] = useMemo(() => [
    /* Carriers are filtered from the LIST only. `cls:<id>` / `race:<id>` are
       synthetic rows holding a class's vars and graph for the engine — they
       grant nothing and rendered as a card with a description and no effects.
       They stay in `character.sheet.features`, so activeSources still reads
       them; this screen just stops calling them features. Their prose is on
       Lore's dossier instead. */
    ...sheetFeatures.filter(f => !isCarrier(f.id)).map(f => ({ f, group: f.category ?? 'other' })),
    ...fromGear.map(f => ({ f, group: 'gear' })),
    ...fromShards.map(f => ({ f, group: 'shard' })),
  ], [sheetFeatures, fromGear, fromShards])

  const byId = useMemo(() => new Map(rows.map(r => [r.f.id, r])), [rows])
  /** gid → row, so an AFFECTED BY link can open the feature that contributed. */
  const byGid = useMemo(
    () => new Map(rows.map(r => [gid('feature', r.f), r] as const)),
    [rows],
  )

  const usable = rows.filter(r => isUsable(r.f))
  const tabPool = tab === 'usable' ? usable : rows.filter(r => !isUsable(r.f))
  const pool = useMemo(() => {
    const p = src === 'all' ? tabPool : tabPool.filter(r => r.group === src)
    return tab !== 'usable' ? p : [...p].sort((a, b) =>
      ACT_ORDER.indexOf(a.f.activation ?? '') - ACT_ORDER.indexOf(b.f.activation ?? ''))
  }, [tabPool, src, tab])

  /* THE PRESS OWNS WHAT THE PRESS WRITES. A variable some activation sets is
     not the player's to flip by hand — the switch was a second door into the
     same room with no use counter on it, so Reckless Attack's advantage could
     be had for free with its use still in the bank. It is not shown read-only
     either: a row saying `recklessAttack: false` is engine bookkeeping the
     player never asked to see. The feature's own card says whether it is on. */
  const settable = vars.filter(v => !v.locked)

  /** Variables this feature declares that the player may write. */
  const varsOf = (f: Feature) => settable.filter(v => (f.vars ?? []).some(d => d.name === v.def.name))
  /* Reads the UNFILTERED list on purpose. A stance's hexagon is the feature's
     own press, not the hand switch the lock removes, so a toggle variable an
     activation also writes must still be able to report that it is on. */
  const isOn = (f: Feature) => {
    const t = toggleVar(f)
    return !!t && vars.find(v => v.def.name === t.name)?.value === true
  }

  /* Toggles with no feature to live under — a bool declared on an equipped item
     or an attuned shard node. `playerVars` walks every active source, but only a
     FEATURE has a card to hang a switch on, so without this block a bool on the
     Cloak of Elvenkind is authorable, resolvable and impossible to flip. */
  const looseVars = settable.filter(v => !rows.some(r => (r.f.vars ?? []).some(d => d.name === v.def.name)))
  const looseBySource = [...looseVars.reduce((m, v) => {
    const key = v.from.obj.name
    return m.set(key, [...(m.get(key) ?? []), v])
  }, new Map<string, VarRow[]>())]

  async function writeVar(name: string, value: number | boolean) {
    await updateSection('resources', setVars(character, { [name]: value }) as CharacterRow['resources'])
  }

  const { start: onUse, sheet: activationSheet, busy } = useActivation({
    character, graph, shardTrees, updateSection, updateSections,
  })

  /** WHAT THIS FEATURE IS WAITING ON, already said in the player's words.
   *
   *  `gateOf` hands back identifiers because the engine has no labels; the
   *  variable rows do, and a gate on ANOTHER feature's variable (Brutal Strike
   *  reads Reckless Attack's) is exactly the case, so the lookup is across
   *  every player variable rather than the feature's own. Null = pressable. */
  const gateFor = (f: Feature): string | null => {
    const idents = gateOf(f, graph, character, gid('feature', f))
    if (!idents) return null
    const parts = idents.map(id =>
      GATE_PHRASE[id] ?? `Requires ${vars.find(v => v.def.name === id)?.def.label ?? id}`)
    return parts.length ? parts.join(' · ') : 'Not available yet'
  }

  /** Armed modifiers this feature queued and nobody has spent yet. Matched by
   *  SOURCE, not by roll: the card's claim is "you armed this and it is still
   *  pending", which is a fact about the feature. */
  const armedOf = (f: Feature) => graph.armed.filter(m => m.source === gid('feature', f)).length

  /** Pressing the hexagon. Three answers, and the split is what lets a stance
   *  cost something to enter:
   *
   *   - RELEASING is free. Ending a Rage spends nothing and runs nothing, so it
   *     never reaches the activation path — otherwise turning it off would cost
   *     a second Rage.
   *   - ENTERING runs the activation when there is one. That is where the use is
   *     spent and the variable written, in a single write, so "spending a use"
   *     keeps exactly one definition.
   *   - A stance with nothing to run (a cloak's `hoodUp`) is the write alone.
   *
   *  An exhausted feature shakes rather than silently doing nothing. */
  function press(f: Feature) {
    if (busy) return
    const t = toggleVar(f)
    if (t && isOn(f)) { void writeVar(t.name, false); return }
    /* A GATED-SHUT FEATURE REFUSES THE SAME WAY A SPENT ONE DOES. Without
       this the press planned nothing, wrote nothing, and still logged an empty
       roll entry — which reads as "Brutal Strike works without Reckless
       Attack", because nothing on screen said otherwise. */
    const u = usesOf(f, graph.scope)
    if ((u && u.current <= 0) || gateFor(f)) {
      setDenied(f.id)
      setTimeout(() => setDenied(d => (d === f.id ? null : d)), 300)
      return
    }
    if (t && !runsActivation(f)) { void writeVar(t.name, true); return }
    onUse(f)
  }

  function openPopup(id: string, push = false) {
    setStack(s => (push && popup && popup !== id ? [...s, popup] : s))
    setPopup(id)
  }

  /* DEEP LINK — `/features?f=<gid>`, which the Roll Context Panel's catalog
     sheet uses to hand a rider's source over for inspection. Resolved through
     the SAME byGid map an "affected by" link already uses, so a gid that isn't
     on the sheet (unequipped since the roll, a shard node, an item) simply
     opens nothing rather than erroring.

     The param is cleared once consumed: leaving it in the URL would reopen the
     popup on every refresh and on Back, which is exactly the self-opening
     behaviour this screen's popups are not allowed to have. */
  useEffect(() => {
    const gidParam = params.get('f')
    if (!gidParam) return
    const row = byGid.get(gidParam as ReturnType<typeof gid>)
    if (row) openPopup(row.f.id)
    setParams(p => { const next = new URLSearchParams(p); next.delete('f'); return next }, { replace: true })
    // byGid is rebuilt on every sheet change; this must run for the param only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, byGid])
  const closePopup = () => { setPopup(null); setStack([]) }
  const popBack = () => {
    const prev = stack[stack.length - 1]
    if (!prev) return closePopup()
    setStack(s => s.slice(0, -1))
    setPopup(prev)
  }

  useEffect(() => {
    if (!popup) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closePopup() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [popup])

  const meta = (
    <>
      <span className="dim">◇</span>
      <span>Section</span>
      <span className="acc">/ Features</span>
      <span className="dim">·</span>
      <span>Resolved Graph</span>
    </>
  )

  const openRow = popup ? byId.get(popup) : null

  return (
    <>
      <Deco
        left={<><span className="acc">FEATURES</span> &nbsp;//&nbsp; GRAPH RESOLVED &nbsp;//&nbsp; GATES OK</>}
        right={<>Nodes {rows.length} &nbsp;//&nbsp; <span className="acc">GEAR :: BOUND</span> &nbsp;//&nbsp; Live Derive</>}
      />
      <Nav variant="dock" meta={meta} />

      <main className={styles.features}>
        <div className={styles.colHeader}>
          <span className={styles.chNum}>01</span>
          <span className={styles.chTitle}>Features</span>
          <span className={styles.chMeta}>
            <span>Catalogued <span className="acc">{rows.length}</span></span>
            <span className="dim">|</span>
            <span>Loadout <span className="acc">Bound</span></span>
          </span>
          <button type="button" className={styles.closeScreen} onClick={() => nav('/equipment')}>
            <i className="fa-solid fa-xmark" aria-hidden="true" /> Close
          </button>
        </div>

        {/* ONE ROW. The tabs are 46px tall and the chips 28px, and stacking them
            spent two bands of a laptop's vertical budget on controls while
            leaving a wide empty gutter to the right of the tabs. The chips fill
            that gutter instead. */}
        <div className={styles.controls}>
        <div className={styles.tabrow}>
          {(['usable', 'passive'] as const).map(t => (
            <button key={t} type="button" className={cx(styles.tab, tab === t && styles.tabOn)}
              onClick={() => setTab(t)} aria-pressed={tab === t}>
              <span className={styles.tFrame} />
              <span className={styles.tInner}>
                <span className={styles.tLab}>{t}</span>
                <span className={styles.tCount}>{t === 'usable' ? usable.length : rows.length - usable.length}</span>
              </span>
            </button>
          ))}
        </div>

        <div className={styles.filterrow}>
          <div className={styles.chips}>
            {CHIPS.map(c => {
              const n = c.key === 'all' ? tabPool.length : tabPool.filter(r => r.group === c.key).length
              // A source nobody has at all is not worth a control; one that is
              // empty only in THIS tab dims instead, so the count still teaches.
              if (n === 0 && c.key !== 'all' && !rows.some(r => r.group === c.key)) return null
              return (
                <button key={c.key} type="button"
                  className={cx(styles.chip, src === c.key && styles.chipOn, n === 0 && styles.chipZero)}
                  onClick={() => setSrc(c.key)} aria-pressed={src === c.key}>
                  <span className={styles.cf} />
                  <span className={styles.ci}>{c.label} <b>{n}</b></span>
                </button>
              )
            })}
          </div>
          {(src === 'gear' || (src === 'all' && tabPool.some(r => r.group === 'gear'))) && (
            <div className={styles.gearNote}>
              <span className={styles.lk} /> Derived from equipped items
              <span className="dim"> · never stored on the character</span>
            </div>
          )}
        </div>
        </div>

        <div className={styles.region}>
          <div className={styles.rFrame} /><div className={styles.rGap} /><div className={styles.rLine} />
          <div className={styles.rInner}>
            <div className={cx(styles.rCorner, styles.tl)} /><div className={cx(styles.rCorner, styles.br)} />
            <div className={styles.featScroll}>
              {pool.length > 0 ? (
                <div className={styles.gGrid}>
                  {pool.map(r => (
                    <FeatureCard
                      key={r.f.id} row={r} busy={busy} scope={graph.scope}
                      on={isOn(r.f)} armed={armedOf(r.f)} denied={denied === r.f.id}
                      gate={gateFor(r.f)}
                      onOpen={() => openPopup(r.f.id)} onPress={() => press(r.f)}
                    />
                  ))}
                </div>
              ) : (
                <div className={styles.streamEmpty}>
                  <div className={styles.geGlyph}><i className="fa-regular fa-square" /></div>
                  <div className={styles.geT}>Nothing here</div>
                  <div className={styles.geS}>
                    No {tab} features from this source are currently available.
                  </div>
                </div>
              )}

              {/* Not in the mockup, and kept deliberately: these belong to items
                  and shard nodes, which have no card of their own. */}
              {looseBySource.length > 0 && (
                <section className={styles.extra}>
                  <div className={styles.exHead}>
                    <i className="fa-solid fa-sliders" />Gear &amp; Shard State
                    <span className={styles.exCount}>{looseVars.length}</span>
                  </div>
                  <div className={styles.looseState}>
                    {looseBySource.map(([source, list]) => (
                      <div key={source} className={styles.pState}>
                        <div className={styles.psHead}>{source}</div>
                        {list.map(v => <VarControl key={v.def.name} row={v} disabled={busy} onWrite={writeVar} />)}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {perks.length > 0 && (
                <section className={styles.extra}>
                  <div className={styles.exHead}>
                    <i className="fa-solid fa-wand-magic-sparkles" />Passive Perks
                    <span className={styles.exCount}>{perks.length}</span>
                  </div>
                  <div className={styles.perkGrid}>
                    {perks.map((p, i) => <PerkCard key={`${p.name}-${i}`} perk={p} />)}
                  </div>
                </section>
              )}
            </div>
          </div>
        </div>
      </main>

      {openRow && createPortal(
        <FeaturePopup
          row={openRow} busy={busy} scope={graph.scope} on={isOn(openRow.f)} vars={varsOf(openRow.f)}
          gate={gateFor(openRow.f)}
          back={stack.length ? byId.get(stack[stack.length - 1])?.f.name ?? null : null}
          affected={affectedBy(graph, gid('feature', openRow.f), openRow.f.tags)}
          resolveGid={g => byGid.get(g)?.f ?? null}
          onOpenSource={id => openPopup(id, true)}
          onBack={popBack} onClose={closePopup}
          onPress={() => { press(openRow.f); if (!toggleVar(openRow.f)) closePopup() }}
          onWriteVar={writeVar}
        />,
        document.body,
      )}

      {activationSheet}
    </>
  )
}

/* ---------------- card ---------------- */

function FeatureCard({ row, busy, scope, on, armed, denied, gate, onOpen, onPress }: {
  row: Row; busy: boolean; scope: ExprScope; on: boolean; armed: number; denied: boolean
  /** Why a press would do nothing right now, or null. */
  gate: string | null
  onOpen: () => void; onPress: () => void
}) {
  const { f, group } = row
  const usable = isUsable(f)
  const toggle = toggleVar(f)
  // Resolved, never raw: `uses.max` is a formula on anything that scales.
  const uses = usesOf(f, scope)
  const spent = !!uses && uses.current <= 0
  const fx = featureEffects(f)
  const text = cardText(f)
  const tag = f.source ?? f.usage ?? (f.level ? `Lv ${f.level}` : group)

  // The pip under the hexagon says what pressing it does, in the imperative.
  /* ON WINS OUTRIGHT, because a held stance can always be released — even when
     its last use is spent, which is the state a raging Barbarian is usually in. */
  const pip = on ? 'On' : gate ? 'Locked' : spent ? 'Spent' : toggle ? 'Hold' : uses ? 'Spend' : 'Use'

  return (
    <div
      className={cx(styles.fcard, on && styles.isOn, (spent || !!gate) && styles.spent,
        denied && styles.denied, f.color && styles.tinted)}
      style={f.color ? ({ ['--tint' as string]: f.color } as React.CSSProperties) : undefined}
      role="button" tabIndex={0} aria-haspopup="dialog"
      onClick={onOpen}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
    >
      <div className={styles.fcFrame} />
      <div className={styles.fcInner}>
        <div className={styles.fcTop}>
          {/* THE HEXAGON IS THE CONTROL. It stops propagation so pressing it
              spends the feature instead of opening the popup behind it. */}
          {usable ? (
            <button type="button"
              className={cx(styles.fcHex, styles.usable, on && styles.held, (spent || !!gate) && styles.exhausted)}
              disabled={busy}
              title={gate ?? `${toggle ? (on ? 'End' : 'Hold') : 'Use'} ${f.name}`}
              onClick={e => { e.stopPropagation(); onPress() }}
            >
              <span className={styles.hxFrame} />
              <span className={styles.hxInner}><Icon name={f.icon ?? 'fa-diamond'} className={styles.fcIcon} /></span>
              <span className={cx(styles.hxPip, (spent || !!gate) && styles.pipOff)}>{pip}</span>
            </button>
          ) : (
            <span className={styles.fcHex}>
              <span className={styles.hxFrame} />
              <span className={styles.hxInner}><Icon name={f.icon ?? 'fa-diamond'} className={styles.fcIcon} /></span>
            </span>
          )}

          <div className={styles.fcMid}>
            <div className={styles.fcName}>{f.name}</div>
            {text && <Prose text={live(text, scope)} className={styles.fcSummary} />}
            <div className={styles.fcMeta}>
              {f.activation && f.activation !== 'none' && (
                <span className={cx(styles.actBadge, styles[f.activation])}>{ACTS[f.activation]}</span>
              )}
              <span className={cx(styles.srcTag, (group === 'gear' || group === 'shard') && styles.gearTag)}>{tag}</span>
              {on && (
                <span className={cx(styles.actBadge, styles.reaction)}>
                  <i className="fa-solid fa-circle" style={{ fontSize: 6, verticalAlign: 'middle' }} /> Active
                </span>
              )}
              {/* A bonus waiting in the armed queue that the card does not mention
                  is one the player rolls without and never learns about. */}
              {armed > 0 && (
                <span className={styles.armed} title="Armed — applies to your next matching roll">
                  <i className="fa-solid fa-bolt" />{armed > 1 ? ` ${armed}` : ''}
                </span>
              )}
            </div>
          </div>

          <div className={styles.fcUse}>
            {/* A COUNT AND A STANCE ARE NOT EXCLUSIVE — Rage is both, so the
                count leads (it is the number the player is rationing) and the
                label says what the press will do with it. */}
            {!usable ? <span className={styles.passBadge}>Passive</span>
              : uses ? (<>
                <span className={cx(styles.useCount, spent && !on && styles.empty)}>
                  {uses.current}<span className={styles.of}>/{uses.max}</span>
                </span>
                <span className={styles.useLab}>
                  {toggle ? (on ? 'Held · tap to end' : spent ? 'Spent' : 'Tap to hold')
                    : spent ? 'Spent' : 'Uses'}
                </span>
              </>)
              : toggle ? <span className={styles.useLab}>{on ? 'Held · tap to end' : 'At will · tap to hold'}</span>
              : (<>
                <span className={styles.atwill}><span className={styles.inf}>∞</span> At will</span>
                <span className={styles.useLab}>Tap glyph</span>
              </>)}
          </div>
        </div>

        {fx.length > 0 && (
          <div className={styles.fx}>
            {fx.map((n, i) => (
              <div key={i} className={styles.fxRow} style={dt(n.dmgType)}>
                <span className={styles.fxOp}>{n.glyph}</span>
                <Prose text={live(n.text, scope)} className={styles.fxTxt} />
                <span className={styles.fxTag}>
                  {n.dmgType && <span className={styles.fxType}>{n.dmgType}</span>}
                  {n.dmgType && n.tag && <span className={styles.fxSep}>·</span>}
                  {n.tag}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ---------------- popup ---------------- */

function FeaturePopup({ row, busy, scope, on, vars, gate, back, affected, resolveGid, onOpenSource, onBack, onClose, onPress, onWriteVar }: {
  row: Row; busy: boolean; scope: ExprScope; on: boolean; vars: VarRow[]
  /** Why a press would do nothing right now, or null. */
  gate: string | null
  back: string | null
  affected: ReturnType<typeof affectedBy>
  resolveGid: (g: Gid) => Feature | null
  onOpenSource: (id: string) => void
  onBack: () => void; onClose: () => void; onPress: () => void
  onWriteVar: (name: string, value: number | boolean) => void | Promise<void>
}) {
  const { f, group } = row
  const usable = isUsable(f)
  const toggle = toggleVar(f)
  const uses = usesOf(f, scope)
  const spent = !!uses && uses.current <= 0
  const fx = featureEffects(f)
  const chain = originChain(f)
  const text = cardText(f)

  const facts: [string, string, string?][] = []
  if (f.activation && f.activation !== 'none') facts.push(['Activation', ACTS[f.activation], 'acc'])
  // A count beats "at will" even on a stance: entering Rage costs one.
  if (uses) facts.push(['Uses', `${uses.current} / ${uses.max}`, spent && !on ? 'empty' : 'acc'])
  else if (toggle) facts.push(['Uses', '∞ At will', 'acc'])
  else if (usable) facts.push(['Uses', '∞ At will', 'acc'])
  if (f.recharge) {
    // A partial short-rest refill is part of the answer to "when does this come
    // back", so it belongs on that line rather than nowhere.
    const partial = f.recharge === 'long' && f.shortRecharge ? ` · +${f.shortRecharge} on a short` : ''
    facts.push(['Resets on', (f.recharge === 'short' ? 'Short rest' : f.recharge === 'turn' ? 'Every turn' : 'Long rest') + partial])
  }
  if (toggle) facts.push(['State', on ? 'Held · on' : 'Off', on ? 'acc' : undefined])
  if (group === 'gear') facts.push(['Derived from', `Equipped · ${f.source ?? 'gear'}`])
  if (group === 'shard') facts.push(['Derived from', `Shard · ${f.source ?? 'attuned'}`])

  return (
    <div className={styles.imodal} role="dialog" aria-modal="true" aria-label={f.name}>
      <div className={styles.imScrim} onClick={onClose} aria-hidden="true" />
      <div className={styles.imPanel}>
        <div className={styles.pnGap} /><div className={styles.pnLine} />
        <div className={styles.imInner}>
          <span className={cx(styles.imCorner, styles.tl)} /><span className={cx(styles.imCorner, styles.br)} />

          <div className={cx(styles.imHead, f.color && styles.tinted, spent && styles.spent)}
            style={f.color ? ({ ['--tint' as string]: f.color } as React.CSSProperties) : undefined}>
            <div className={cx(styles.imCrystal, !usable && styles.passive)}>
              <Icon name={f.icon ?? 'fa-diamond'} />
            </div>
            <div className={styles.imTitles}>
              <div className={cx(styles.imName, on && styles.on)}>{f.name}</div>
              <div className={styles.imTags}>
                {f.activation && f.activation !== 'none'
                  ? <span className={cx(styles.actBadge, styles[f.activation])}>{ACTS[f.activation]}</span>
                  : <span className={styles.passBadge} style={{ borderLeft: 0, paddingLeft: 0 }}>Passive</span>}
                <span className={cx(styles.srcTag, (group === 'gear' || group === 'shard') && styles.gearTag)}>
                  {f.source ?? group}
                </span>
                {on && <span className={cx(styles.actBadge, styles.reaction)}>Active</span>}
              </div>
            </div>
            {back && (
              <button type="button" className={styles.imBack} onClick={onBack}
                title={`Back to ${back}`} aria-label={`Back to ${back}`}>&lt;</button>
            )}
            <button type="button" className={styles.imClose} onClick={onClose} aria-label="Close">
              <i className="fa-solid fa-xmark" />
            </button>
          </div>

          <div className={styles.imBody}>
            <div className={styles.imOrigin}>
              <span className={styles.ok}>Origin</span>
              {/* A Fragment, not `display: contents` — a contents-display flex
                  child makes `gap` unreliable, and the arrows rendered flush
                  against the steps: "Class→Condeming Strike". */}
              {chain.map((s, i) => (
                <Fragment key={i}>
                  <span className={cx(styles.step, i === chain.length - 1 && styles.last)}>{s}</span>
                  {i < chain.length - 1 && <span className={styles.arw}>→</span>}
                </Fragment>
              ))}
            </div>

            {facts.length > 0 && (
              <div className={styles.imFacts}>
                {facts.map(([k, v, tone], i) => (
                  <div key={i} className={styles.fact}>
                    <span className={styles.k}>{k}</span>
                    <span className={cx(styles.v, tone === 'acc' && styles.acc, tone === 'empty' && styles.emptyV)}>{v}</span>
                  </div>
                ))}
              </div>
            )}

            {text && <Prose text={live(text, scope)} className={styles.imSum} />}
            {f.deep_description && <Prose text={live(f.deep_description, scope)} className={styles.imDesc} />}
            {!text && !f.deep_description && <p className={styles.imDesc}>No description provided.</p>}

            {vars.length > 0 && (
              <div className={styles.imSec}>
                <div className={styles.imSecH}>State <span className="dim">· yours to set · {vars.length}</span></div>
                <div className={styles.pState}>
                  {vars.map(v => <VarControl key={v.def.name} row={v} disabled={busy} onWrite={onWriteVar} />)}
                </div>
              </div>
            )}

            {fx.length > 0 && (
              <div className={styles.imSec}>
                <div className={styles.imSecH}>Effects <span className="dim">· resolved nodes · {fx.length}</span></div>
                <div className={styles.imFx}>
                  {fx.map((n, i) => (
                    <div key={i} className={styles.imRow} style={dt(n.dmgType)}>
                      <span className={styles.op}>{n.glyph}</span>
                      <Prose text={live(n.text, scope)} className={styles.imRowTxt} />
                      <span className={styles.s}>
                        {n.dmgType && <span className={styles.fxType}>{n.dmgType}</span>}
                        {n.dmgType && n.tag && <span className={styles.fxSep}>·</span>}
                        {n.tag}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* NOT a second authored list — the engine's own index, read backwards.
                Authoring this relationship twice is how the two drift. */}
            {affected.length > 0 && (
              <div className={styles.imSec}>
                <div className={styles.imSecH}>Affected by <span className="dim">· reverse lookup · {affected.length}</span></div>
                <div className={styles.imFx}>
                  {affected.map((a, i) => {
                    const target = a.sourceGid ? resolveGid(a.sourceGid) : null
                    return (
                      <div key={i} className={cx(styles.imRow, styles.aff)}>
                        <span className={cx(styles.op, target && styles.link)}>↤</span>
                        <span>
                          {target
                            ? <button type="button" className={styles.affLink} onClick={() => onOpenSource(target.id)}>{a.source}</button>
                            : <b>{a.source}</b>}
                        </span>
                        <span className={styles.s}>{a.eff.label || a.eff.value || ''}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          <div className={styles.imActions}>
            {usable && (
              <button type="button" className={cx(styles.ia, toggle && on && styles.ghost, (spent || !!gate) && styles.out)}
                disabled={busy} onClick={onPress}>
                <span className={styles.af} />
                <span className={styles.ai}>
                  {toggle && on ? <><i className="fa-solid fa-square-xmark" /> End stance</>
                    /* THE REASON, not just the refusal. A locked button that
                       does not say what unlocks it is the silent no-op with a
                       nicer shape. */
                    : gate ? <><i className="fa-solid fa-lock" /> {gate}</>
                    : spent ? <><i className="fa-solid fa-ban" /> No uses left</>
                    : toggle ? <><i className="fa-solid fa-play" /> Hold stance{uses ? ` · ${uses.current} left` : ''}</>
                    : uses ? <><i className="fa-solid fa-bolt" /> Spend · {uses.current} left</>
                    : <><i className="fa-solid fa-bolt" /> Use · at will</>}
                </span>
              </button>
            )}
            <button type="button" className={cx(styles.ia, styles.ghost)}
              style={usable ? { flex: '0 0 116px' } : undefined} onClick={onClose}>
              <span className={styles.af} /><span className={styles.ai}>Close</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---------------- shared bits ---------------- */

/** One player-writable variable. A bool is a toggle; a number is a stepper.
 *
 *  The stepper keeps its own value and writes on SETTLE, because updateSection
 *  is optimistic but not debounced — holding `+` would otherwise fire one
 *  `UPDATE … RETURNING *` per click. */
function VarControl({ row, disabled, onWrite }: {
  row: VarRow; disabled: boolean
  onWrite: (name: string, value: number | boolean) => void | Promise<void>
}) {
  const name = row.def.label ?? row.def.name
  const [local, setLocal] = useState<number | null>(null)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  if (row.def.type === 'bool') {
    const on = row.value === true
    return (
      <button type="button" className={cx(styles.psRow, on && styles.psOn)}
        disabled={disabled} aria-pressed={on}
        onClick={() => void onWrite(row.def.name, !on)}>
        <i className={`fa-${on ? 'solid fa-toggle-on' : 'regular fa-circle'}`} />
        <span className={styles.psName}>{name}</span>
        <span className={styles.psVal}>{on ? 'on' : 'off'}</span>
      </button>
    )
  }

  const shown = local ?? (typeof row.value === 'number' ? row.value : 0)
  const bump = (by: number) => {
    const next = shown + by
    setLocal(next)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => { setLocal(null); void onWrite(row.def.name, next) }, 450)
  }
  return (
    <div className={styles.psRow}>
      <i className="fa-solid fa-hashtag" />
      <span className={styles.psName}>{name}</span>
      <span className={styles.psStep}>
        <button type="button" disabled={disabled} onClick={() => bump(-1)}>−</button>
        <span className={styles.psVal}>{shown}</span>
        <button type="button" disabled={disabled} onClick={() => bump(1)}>+</button>
      </span>
    </div>
  )
}

function PerkCard({ perk }: { perk: ShardPerk }) {
  return (
    <div className={styles.perk}>
      <span className={styles.perkIcon}><Icon name={perk.icon ?? 'fa-wand-magic-sparkles'} /></span>
      <div>
        <div className={styles.perkName}>{perk.name}</div>
        {perk.description && <Prose text={perk.description} className={styles.perkDesc} />}
      </div>
    </div>
  )
}
