/**
 * FEATURE EDITOR — the DM's node-authoring surface. Ported from
 * "G.U.I.D.E. Feature Editor.html" + feature-editor.js.
 *
 * THE RULE THAT SHAPES IT: a feature can always be pure prose. Identity and tags
 * are always visible; VARIABLES and EFFECTS are collapsed and opt-in, so an
 * author writing "Second Wind, once per rest" never opens a structured block.
 *
 * THE FORM RENDERS FROM SCHEMA. Every field an effect shows comes from
 * lib/opSchema.ts — a new op is a schema entry plus a case in the resolver, and
 * this file is untouched. That is the whole requirement; if you find yourself
 * adding `if (op === …)` to a renderer here, the schema was the place.
 *
 * The audit is lib/graph.ts's auditNode/matchCount rendered, never
 * reimplemented: one vocabulary for what blocks a publish, shared with the
 * Shard Lattice Editor.
 *
 * Region 02 (the dependency graph) is a reserved overlay on purpose — panes 1
 * and 3 first, per the layout spec. The tab is there so its absence is a stated
 * decision rather than an oversight.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useDmStatus, useDmFeatures, useDmCatalog, useDmSpells, featureContent } from '../lib/dm'
import { useShardCatalog } from '../lib/shardCatalog'
import { useLocalDraft } from '../lib/draft'
import { useAutoGrow } from '../lib/textareaHooks'
import { auditNode, matchCount, normalizeTag, gid, nodeGid, type AuditItem, type AuthoredNode } from '../lib/graph'
import {
  OPS, OP_ORDER, OP_TITLE, PALETTE, PALETTE_MORE, PALETTE_ACT, ROLL_SELECTORS, SOURCES,
  ACTIVATIONS, ACT_ORDER, COLORS, DEFAULT_COLOR, IS_ACTIVATION, IS_DAMAGE_FLAG,
  type OpField, type ActivationKind,
} from '../lib/opSchema'
import type {
  CatalogFeatureData, CatalogFeatureRow, FeatureCategory, GraphEffect, GraphOp, VarDef,
} from '../lib/database.types'
import styles from './FeatureEditor.module.css'

const cx = (...v: (string | false | undefined | null)[]) => v.filter(Boolean).join(' ')

/** `inert` takes a closed overlay out of the tab order and out of the
 *  accessibility tree — `pointer-events: none` only stops the mouse, so without
 *  this the hidden panel's buttons are still reachable by keyboard. Spread
 *  rather than written as a prop because React's DOM typings only learned the
 *  attribute in v19. */
const inertWhen = (closed: boolean) => (closed ? ({ inert: '' } as Record<string, unknown>) : {})

const ICONS = ['fa-lungs', 'fa-bolt', 'fa-burst', 'fa-eye', 'fa-leaf', 'fa-hammer', 'fa-fire', 'fa-shield-halved',
  'fa-heart-pulse', 'fa-hand-fist', 'fa-dumbbell', 'fa-anchor', 'fa-mountain', 'fa-shoe-prints', 'fa-feather', 'fa-wind',
  'fa-droplet', 'fa-snowflake', 'fa-sun', 'fa-moon', 'fa-star', 'fa-gem', 'fa-diamond', 'fa-khanda', 'fa-shield',
  'fa-helmet-safety', 'fa-crosshairs', 'fa-bullseye', 'fa-dice-d20', 'fa-wand-sparkles', 'fa-hat-wizard', 'fa-book',
  'fa-scroll', 'fa-brain', 'fa-signal', 'fa-tower-broadcast', 'fa-wave-square', 'fa-skull', 'fa-ghost', 'fa-dragon',
  'fa-paw', 'fa-spider', 'fa-crow', 'fa-tree', 'fa-seedling', 'fa-flask', 'fa-vial', 'fa-mortar-pestle', 'fa-key',
  'fa-lock', 'fa-door-open', 'fa-compass', 'fa-map', 'fa-clock', 'fa-hourglass-half', 'fa-link', 'fa-shuffle',
  'fa-arrows-rotate', 'fa-explosion', 'fa-radiation', 'fa-biohazard', 'fa-dna', 'fa-microscope', 'fa-music',
  'fa-masks-theater', 'fa-comment', 'fa-handshake', 'fa-coins', 'fa-utensils']

const RECHARGES: { v: '' | 'short' | 'long'; l: string }[] = [
  { v: '', l: 'Manual (DM)' }, { v: 'short', l: 'Short rest' }, { v: 'long', l: 'Long rest' },
]

/** A target selector, split for editing. The stored form is one string
 *  (`tag:fire_damage`); the editor needs the kind and the value apart so the
 *  three-way toggle can swap between them without reparsing on every keystroke. */
type SelKind = 'thing' | 'tag' | 'roll'
const KINDS: { k: SelKind; ic: string; l: string }[] = [
  { k: 'thing', ic: 'fa-crosshairs', l: 'Thing' },
  { k: 'tag', ic: 'fa-tag', l: 'Tag' },
  { k: 'roll', ic: 'fa-dice-d20', l: 'Roll kind' },
]
function splitSel(s: string): { kind: SelKind; value: string } {
  if (s.startsWith('tag:')) return { kind: 'tag', value: s.slice(4) }
  if (s.startsWith('roll:')) return { kind: 'roll', value: s.slice(5) }
  return { kind: 'thing', value: s }
}
const joinSel = (kind: SelKind, value: string) =>
  kind === 'tag' ? `tag:${value}` : kind === 'roll' ? `roll:${value}` : value

/** The bucket a feature with no `folder` falls into. A display name, never
 *  stored — `folder: undefined` is what "unfiled" means on the row. */
const UNFILED = 'Unfiled'

const blankArr = () => new Array<string>(21).fill('')
const newId = () => `e${Math.random().toString(36).slice(2, 8)}`

function blankEffect(op: GraphOp): GraphEffect {
  const eff: GraphEffect = { id: newId(), op, target: [], label: '' }
  for (const fd of OPS[op].fields) {
    if (fd.type === 'array') (eff as unknown as Record<string, unknown>)[fd.key] = blankArr()
    else if (fd.type === 'boolean') (eff as unknown as Record<string, unknown>)[fd.key] = false
    else (eff as unknown as Record<string, unknown>)[fd.key] = ''
  }
  return eff
}

const BLANK: CatalogFeatureData = {
  name: '', category: 'class', icon: 'fa-star', color: DEFAULT_COLOR, activation: 'none',
  light_description: '', deep_description: '', tags: [], vars: [], graph: [], published: false,
}

/* ========================================================================== */

export default function FeatureEditor() {
  const { session, loading: authLoading } = useAuth()
  const { isDm, loading: dmLoading } = useDmStatus()
  const nav = useNavigate()
  const lib = useDmFeatures()
  const itemLib = useDmCatalog()
  const spellLib = useDmSpells()
  const { catalog: shardCatalog } = useShardCatalog()

  const [selId, setSelId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [query, setQuery] = useState('')
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({})
  const [open, setOpen] = useState({ vars: false, effects: false })
  const [openEffect, setOpenEffect] = useState<number | null>(null)
  const [moreOps, setMoreOps] = useState(false)
  const [helpOn, setHelpOn] = useState(false)
  const [overlay, setOverlay] = useState<'graph' | 'guide' | null>(null)
  const [menuOn, setMenuOn] = useState(false)
  const [pop, setPop] = useState<PopKind>(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ msg: string; warn?: boolean } | null>(null)
  const [tagInput, setTagInput] = useState('')
  const [tagAcOpen, setTagAcOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const row = useMemo(() => lib.features.find(f => f.id === selId) ?? null, [lib.features, selId])
  // `base` is what the draft is measured against: a parked draft if there is
  // one, else the published content. Reopening a parked draft must read clean,
  // not instantly dirty.
  const base = creating ? BLANK : row ? featureContent(row) : null
  const { draft, dirty, savedAt, update, reset, clear } =
    useLocalDraft<CatalogFeatureData>(creating ? 'feature:__new__' : `feature:${selId ?? 'none'}`, base)

  useEffect(() => {
    const t = window.setTimeout(() => setToast(null), 2400)
    return () => window.clearTimeout(t)
  }, [toast])
  const fireToast = useCallback((msg: string, warn?: boolean) => setToast({ msg, warn }), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setPop(null); setOverlay(null); setMenuOn(false); setTagAcOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /* ---- the catalog every selector is counted against ----
     Built from all four libraries. Two traps live here:
     - `weapon:` is a gid kind with no catalog of its own — weapons are item rows
       with category 'weapon'. Emitting only `item:` would make every weapon:
       target read as a dangling reference.
     - auditNode SKIPS dangling detection entirely when this array is empty, so
       the audit must not render until the libraries have loaded (see `ready`). */
  const nodes: AuthoredNode[] = useMemo(() => [
    ...lib.features.map(r => ({ gid: gid('feature', { feature_id: r.id }), tags: featureContent(r).tags })),
    ...spellLib.spells.map(r => ({ gid: gid('spell', { spell_id: r.id }), tags: r.data?.tags })),
    ...itemLib.items.flatMap(r => {
      const t = r.data?.tags
      const base = [{ gid: gid('item', { item_id: r.id }), tags: t }]
      return r.data?.category === 'weapon' ? [...base, { gid: gid('weapon', { item_id: r.id }), tags: t }] : base
    }),
    ...Object.entries(shardCatalog).flatMap(([tid, tree]) =>
      (tree.nodes ?? []).map(n => ({ gid: nodeGid(tid, n.id), tags: n.tags }))),
  ], [lib.features, spellLib.spells, itemLib.items, shardCatalog])
  const ready = !lib.loading && !itemLib.loading && !spellLib.loading

  const namesByGid = useMemo(() => {
    const m = new Map<string, { name: string; kind: string }>()
    for (const r of lib.features) m.set(gid('feature', { feature_id: r.id }), { name: featureContent(r).name ?? r.id, kind: 'Feature' })
    for (const r of spellLib.spells) m.set(gid('spell', { spell_id: r.id }), { name: r.data?.name ?? r.id, kind: 'Spell' })
    for (const r of itemLib.items) {
      const nm = { name: r.data?.name ?? r.id, kind: r.data?.category === 'weapon' ? 'Weapon' : 'Item' }
      m.set(gid('item', { item_id: r.id }), nm)
      if (r.data?.category === 'weapon') m.set(gid('weapon', { item_id: r.id }), nm)
    }
    for (const [tid, tree] of Object.entries(shardCatalog)) {
      for (const n of tree.nodes ?? []) m.set(nodeGid(tid, n.id), { name: `${tree.name} · ${n.name || n.id}`, kind: 'Shard node' })
    }
    return m
  }, [lib.features, spellLib.spells, itemLib.items, shardCatalog])

  /** Every tag in use anywhere, with how many things carry it — the autocomplete
   *  source. Counted across all four catalogs, because a tag's whole purpose is
   *  to reach across them. */
  const tagUse = useMemo(() => {
    const m = new Map<string, number>()
    for (const n of nodes) for (const t of n.tags ?? []) m.set(normalizeTag(t), (m.get(normalizeTag(t)) ?? 0) + 1)
    return m
  }, [nodes])

  const audit: AuditItem[] = useMemo(() => {
    if (!draft) return []
    const out = auditNode({ graph: draft.graph, vars: draft.vars }, ready ? nodes : [])
    if (!draft.name?.trim()) out.unshift({ sev: 'err', id: null, t: 'Unnamed feature', s: 'A feature needs a name before it can be granted.' })
    if (!draft.light_description?.trim()) out.push({ sev: 'warn', id: null, t: 'No card text', s: 'The collapsed card in play will have nothing to scan.' })
    if (!draft.deep_description?.trim()) out.push({ sev: 'warn', id: null, t: 'No detail text', s: 'The expanded card will have nothing below the card text.' })
    if ((draft.uses?.max ?? 0) > 0 && !draft.recharge) out.push({ sev: 'warn', id: null, t: 'Uses never reset', s: 'Max uses is set but no recharge was chosen — the DM restores them by hand.' })
    if (!out.length) out.push({ sev: 'ok', id: null, t: 'Clean', s: 'No errors, no warnings. Safe to publish.' })
    return out
  }, [draft, nodes, ready])

  const errs = audit.filter(a => a.sev === 'err').length
  const warns = audit.filter(a => a.sev === 'warn').length

  /** Catalog-wide error counts for the topbar Issues stat.
   *  ponytail: audits every row on every render. Memoized on the library, so it
   *  re-runs on a save rather than a keystroke; index it per row if the catalog
   *  ever gets big enough to feel. */
  const libErrs = useMemo(
    () => lib.features.reduce((n, r) => {
      const c = featureContent(r)
      return n + auditNode({ graph: c.graph, vars: c.vars }, nodes).filter(a => a.sev === 'err').length
    }, 0),
    [lib.features, nodes],
  )
  const nodeCount = lib.features.reduce((n, r) => n + (featureContent(r).graph?.length ?? 0), 0)

  /* ---- folders: derived from the features in them ---- */
  const folders = useMemo(() => {
    const set = new Set<string>()
    for (const r of lib.features) set.add(featureContent(r).folder || UNFILED)
    if (draft?.folder) set.add(draft.folder)
    return [...set].sort()
  }, [lib.features, draft?.folder])

  const parsed = useMemo(() => {
    const m = /^(tag|roll):(.*)$/i.exec(query.trim())
    return m ? { mode: m[1].toLowerCase() as 'tag' | 'roll', value: normalizeTag(m[2]) } : { mode: 'text' as const, value: query.trim().toLowerCase() }
  }, [query])

  function matches(r: CatalogFeatureRow): { hit: boolean; via?: string } {
    const d = featureContent(r)
    if (parsed.mode === 'text') {
      if (!parsed.value) return { hit: true }
      if ((d.name ?? '').toLowerCase().includes(parsed.value)) return { hit: true }
      if ((d.tags ?? []).some(t => t.includes(parsed.value))) return { hit: true, via: `tag ${parsed.value}` }
      return { hit: false }
    }
    // Selector query: which features' EFFECTS aim at this. A thin wrapper over
    // the same selector namespace the resolver matches on.
    let n = 0
    for (const eff of d.graph ?? []) {
      for (const t of eff.target ?? []) {
        const s = splitSel(t)
        if (parsed.mode === 'tag' && s.kind === 'tag' && normalizeTag(s.value) === parsed.value) n++
        if (parsed.mode === 'roll' && s.kind === 'roll' && normalizeTag(s.value).startsWith(parsed.value)) n++
      }
    }
    if (n) return { hit: true, via: `${n} target${n === 1 ? '' : 's'}` }
    if (parsed.mode === 'tag' && (d.tags ?? []).some(t => normalizeTag(t) === parsed.value)) return { hit: true, via: 'carries tag' }
    return { hit: false }
  }

  /** Rows grouped by folder and sorted WITHIN it by `order`, which is the whole
   *  point — the hook returns them alphabetically, and a catalog of 46
   *  near-identical Sanctity features needs the DM's ordering, not the
   *  alphabet's. A row with no `order` sorts last, alphabetically among its
   *  peers, which is exactly where it sat before ordering existed. */
  const foldered = useMemo(() => {
    const out: Record<string, { r: CatalogFeatureRow; m: { hit: boolean; via?: string } }[]> = {}
    for (const r of lib.features) {
      const d = featureContent(r)
      const key = d.folder || UNFILED
      ;(out[key] ??= []).push({ r, m: matches(r) })
    }
    for (const key of Object.keys(out)) {
      out[key].sort((a, b) => {
        const ao = featureContent(a.r).order ?? Number.MAX_SAFE_INTEGER
        const bo = featureContent(b.r).order ?? Number.MAX_SAFE_INTEGER
        return ao !== bo ? ao - bo : (featureContent(a.r).name ?? '').localeCompare(featureContent(b.r).name ?? '')
      })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lib.features, query])

  /* ---- actions ---- */
  function select(id: string) {
    setSelId(id); setCreating(false); setOpenEffect(null); setMenuOn(false)
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }
  function onNew() {
    setSelId(null); setCreating(true); setOpenEffect(null); setMenuOn(false)
    setOpen({ vars: false, effects: false })
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }

  async function onSaveDraft() {
    if (!draft) return
    setSaving(true)
    const id = await lib.saveDraft(creating ? null : selId, draft)
    setSaving(false)
    if (!id) { fireToast('Save failed', true); return }
    if (creating) { clear(); setCreating(false); setSelId(id) }
    fireToast('Draft saved · not yet grantable')
  }

  async function onPublish() {
    if (!draft) return
    if (errs > 0) { fireToast('Publish blocked — resolve errors', true); return }
    setSaving(true)
    const id = await lib.publishFeature(creating ? null : selId, draft)
    setSaving(false)
    if (!id) { fireToast('Publish failed', true); return }
    clear()
    if (creating) { setCreating(false) }
    setSelId(id)
    fireToast(`Published · ${id}`)
  }

  function onRevert() {
    reset(row ? row.data : null)
    setPop(null)
    if (!row) { setCreating(false); setSelId(null) }
    fireToast(row ? 'Draft discarded · published version restored' : 'Draft discarded')
  }

  async function onDuplicate() {
    if (!selId) return
    setMenuOn(false)
    const id = await lib.duplicateFeature(selId)
    if (!id) { fireToast('Duplicate failed', true); return }
    select(id)
    fireToast(`Duplicated · ${id}`)
  }

  async function onDelete() {
    if (!selId) return
    await lib.deleteFeature(selId)
    clear()
    setPop(null); setSelId(null); setCreating(false)
    fireToast('Feature deleted', true)
  }

  /** What points AT this feature — shown before deleting, because a dangling
   *  target is a blocking audit error on somebody else's node. */
  const refsToSelected = useMemo(() => {
    if (!selId) return []
    const me = gid('feature', { feature_id: selId })
    const mine = new Set((row ? featureContent(row).tags ?? [] : []).map(normalizeTag))
    const out: { name: string; how: string }[] = []
    for (const r of lib.features) {
      if (r.id === selId) continue
      const d = featureContent(r)
      for (const eff of d.graph ?? []) {
        for (const t of eff.target ?? []) {
          if (t === me) out.push({ name: d.name ?? r.id, how: 'targets it directly' })
          else if (t.startsWith('tag:') && mine.has(normalizeTag(t.slice(4)))) out.push({ name: d.name ?? r.id, how: t })
        }
      }
    }
    return out.filter((r, i, a) => a.findIndex(x => x.name === r.name && x.how === r.how) === i)
  }, [selId, row, lib.features])

  const set = useCallback((patch: Partial<CatalogFeatureData>) => update(d => ({ ...d, ...patch })), [update])
  const setEffect = useCallback((i: number, patch: Partial<GraphEffect>) =>
    update(d => ({ ...d, graph: (d.graph ?? []).map((e, j) => (j === i ? { ...e, ...patch } : e)) })), [update])
  const setVar = useCallback((i: number, patch: Partial<VarDef>) =>
    update(d => ({ ...d, vars: (d.vars ?? []).map((v, j) => (j === i ? { ...v, ...patch } : v)) })), [update])

  function addTag(raw: string) {
    const t = normalizeTag(raw)
    if (!t) return
    update(d => ((d.tags ?? []).includes(t) ? d : { ...d, tags: [...(d.tags ?? []), t] }))
    setTagInput(''); setTagAcOpen(false)
  }

  /* ---- drag to refile AND reorder ---- */
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropFolder, setDropFolder] = useState<string | null>(null)
  const [dropRow, setDropRow] = useState<{ id: string; after: boolean } | null>(null)

  /** Drop `dragId` into `folder`, at the position marked by `dropRow`.
   *
   *  ONE row write per drag, not N: the new `order` is the midpoint between the
   *  two neighbours it lands between, so the siblings never need renumbering.
   *  Fractions are why `order` is a number rather than an index — halving a gap
   *  survives far more drags than a campaign will ever produce. */
  async function onDrop(folder: string) {
    const id = dragId
    const at = dropRow
    setDragId(null); setDropFolder(null); setDropRow(null)
    if (!id) return
    const r = lib.features.find(f => f.id === id)
    if (!r) return

    // The dragged row is excluded so "drop below the row above me" is a no-op
    // rather than an off-by-one.
    const siblings = (foldered[folder] ?? []).filter(x => x.r.id !== id)
    let idx = siblings.length
    if (at) {
      const i = siblings.findIndex(x => x.r.id === at.id)
      if (i >= 0) idx = i + (at.after ? 1 : 0)
    }
    // `?? i` is a defensive fallback only: the migration backfilled every
    // existing row and dm.ts assigns one on create, so `order` should always be
    // present. A missing one lands roughly where it already appeared.
    const key = (x: { r: CatalogFeatureRow }, i: number) => featureContent(x.r).order ?? i
    const before = siblings[idx - 1] !== undefined ? key(siblings[idx - 1], idx - 1) : undefined
    const after = siblings[idx] !== undefined ? key(siblings[idx], idx) : undefined
    const order =
      before !== undefined && after !== undefined ? (before + after) / 2
      : before !== undefined ? before + 1
      : after !== undefined ? after - 1
      : 0

    const content = featureContent(r)
    const sameFolder = (content.folder || UNFILED) === folder
    if (sameFolder && content.order === order) return
    const next = { ...content, folder: folder === UNFILED ? undefined : folder, order }
    // Refiling and reordering are shape changes to whichever slot the feature
    // already lives in — they do not open a draft on a published feature.
    await lib.updateFeature(id, r.draft ? { draft: next } : { data: next })
    setOpenFolders(f => ({ ...f, [folder]: true }))
    fireToast(sameFolder ? `${content.name} reordered` : `${content.name} → ${folder}`)
  }

  if (authLoading || dmLoading) return <div className={styles.boot}>Authorizing operator link…</div>
  if (!session) return <Navigate to="/login" replace />
  if (!isDm) return <Navigate to="/" replace />

  const selectorMode = parsed.mode !== 'text'
  const canDelete = !!selId && !creating

  return (
    <div className={styles.page}>
      <div className={styles.stage} />

      <header className={styles.opbar}>
        <div className={styles.opSigil}><i className="fa-solid fa-diagram-project" /></div>
        <div className={styles.opId}>
          <div className={styles.opTitle}>Operator<span className={styles.slash}>//</span>Feature Editor</div>
          <div className={styles.opSub}>
            Catalog <span className={styles.sep}>·</span> <span className={styles.acc}>Features</span>
            <span className={styles.sep}>·</span> Node Authoring
          </div>
        </div>
        <div className={styles.opRight}>
          <div className={styles.opStat}><span className={styles.v}>{lib.features.length}</span><span className={styles.l}>Features</span></div>
          <div className={styles.opStat}><span className={cx(styles.v, styles.cyan)}>{nodeCount}</span><span className={styles.l}>Effect Nodes</span></div>
          <div className={styles.opStat}><span className={cx(styles.v, libErrs > 0 && styles.warn)}>{libErrs}</span><span className={styles.l}>Issues</span></div>
          <div className={styles.opRootpill}><span className={styles.dot} /> Root · Architect</div>
          <button type="button" className={styles.opBack} onClick={() => nav('/dm')}>
            <i className="fa-solid fa-arrow-left-long" /> Console
          </button>
        </div>
      </header>

      <div className={styles.editor}>
        {/* ---------------- 01 — FEATURE LIST ---------------- */}
        <section className={styles.region}>
          <div className={styles.frame} />
          <div className={styles.inner}>
            <span className={cx(styles.rCorner, styles.tl)} /><span className={cx(styles.rCorner, styles.br)} />
            <div className={styles.rHead}>
              <span className={styles.rhNum}>01</span><span className={styles.rhTitle}>Features</span>
              <span className={styles.rhMeta}><span className={styles.acc}>{lib.features.length}</span> Total</span>
            </div>
            <div className={styles.flTop}>
              <div className={styles.flNewrow}>
                <button type="button" className={cx(styles.btn, styles.cyan)} onClick={onNew}>
                  <span className={styles.bf} /><span className={styles.bi}><i className="fa-solid fa-plus" /> New Feature</span>
                </button>
                <button type="button" className={cx(styles.btn, styles.ghost)} onClick={() => setPop({ k: 'folder' })} title="New folder">
                  <span className={styles.bf} /><span className={styles.bi}><i className="fa-solid fa-folder-plus" /> Folder</span>
                </button>
              </div>
              <div className={cx(styles.flSrch, selectorMode && styles.sel)}>
                <i className={selectorMode ? 'fa-solid fa-crosshairs' : 'fa-solid fa-magnifying-glass'} />
                <input value={query} onChange={e => setQuery(e.target.value)}
                  placeholder="Search names, or tag:fire_damage" autoComplete="off" spellCheck={false} />
                {query && <i className={cx('fa-solid fa-xmark', styles.clr)} onClick={() => setQuery('')} />}
              </div>
              <div className={cx(styles.flHint, selectorMode && styles.sel)}>
                <i className={selectorMode ? 'fa-solid fa-crosshairs' : 'fa-solid fa-circle-info'} />
                {selectorMode
                  ? <span>Selector query — matching features whose <b>effects target</b> {parsed.mode}:{parsed.value || '…'}</span>
                  : <span>Plain text matches names. <b>tag:</b> or <b>roll:</b> matches what effects target. <b>Drag</b> a feature to reorder it, or onto another folder to refile it.</span>}
              </div>
            </div>

            <div className={styles.rScroll}>
              {(() => {
                let shown = 0
                const body = folders.map(fl => {
                  const rows = (foldered[fl] ?? []).filter(o => o.m.hit)
                  if (!rows.length && query) return null
                  shown += rows.length
                  const isOpen = openFolders[fl] !== false || selectorMode
                  return (
                    <div key={fl} className={cx(styles.fold, dropFolder === fl && styles.drop)}
                      onDragOver={e => { if (dragId) { e.preventDefault(); setDropFolder(fl) } }}
                      onDragLeave={() => setDropFolder(c => (c === fl ? null : c))}
                      onDrop={e => { e.preventDefault(); void onDrop(fl) }}>
                      <button type="button" className={cx(styles.foldHead, !isOpen && styles.closed)}
                        onClick={() => setOpenFolders(f => ({ ...f, [fl]: f[fl] === false }))}>
                        <i className={cx('fa-solid fa-chevron-down', styles.ch)} />
                        <i className={cx('fa-solid fa-folder', styles.fi)} />
                        <span className={styles.ft}>{fl}</span><span className={styles.fc}>{rows.length}</span>
                      </button>
                      {isOpen && (
                        <div className={styles.foldRows}>
                          {rows.length ? rows.map(({ r, m }) => {
                            const d = featureContent(r)
                            const bad = auditNode({ graph: d.graph, vars: d.vars }, nodes).some(a => a.sev === 'err')
                            return (
                              <button key={r.id} type="button" draggable
                                className={cx(
                                  styles.frow,
                                  r.id === selId && styles.sel,
                                  dragId === r.id && styles.dragging,
                                  dropRow?.id === r.id && (dropRow.after ? styles.dropafter : styles.dropbefore),
                                )}
                                style={{ ['--fc' as string]: d.color || DEFAULT_COLOR }}
                                onDragStart={() => setDragId(r.id)}
                                onDragEnd={() => { setDragId(null); setDropFolder(null); setDropRow(null) }}
                                onDragOver={e => {
                                  if (!dragId || dragId === r.id) return
                                  e.preventDefault()
                                  // DIRECTION, not the midpoint. A midpoint rule
                                  // means only half a row swaps — drag down and
                                  // only the lower half counts, because inserting
                                  // "before" a row you are already above is a
                                  // no-op. Comparing indices makes the WHOLE row
                                  // a target, which is what "drag it onto that
                                  // one" is supposed to mean.
                                  const list = foldered[fl] ?? []
                                  const from = list.findIndex(x => x.r.id === dragId)
                                  const over = list.findIndex(x => x.r.id === r.id)
                                  const after = from >= 0
                                    ? over > from
                                    // Arriving from another folder: no index to
                                    // compare against, so fall back to the half
                                    // of the row the cursor is actually in.
                                    : e.clientY > e.currentTarget.getBoundingClientRect().top
                                        + e.currentTarget.getBoundingClientRect().height / 2
                                  setDropRow({ id: r.id, after })
                                }}
                                onClick={() => select(r.id)}>
                                <span className={styles.frIcFrame}><i className={`fa-solid ${d.icon || 'fa-star'}`} /></span>
                                <span className={styles.frTx}>
                                  <span className={styles.frN}>{d.name || 'Untitled'}</span>
                                  <span className={styles.frM}>
                                    <span className={styles.frSrc}>{SOURCES[d.category ?? 'other'] ?? d.category}</span>
                                    {m.via && <span className={cx(styles.frSrc, styles.frHit)}>{m.via}</span>}
                                    {r.draft && <span className={styles.frDrf}>draft</span>}
                                    {!d.published && !r.draft && <span className={styles.frDrf}>unpublished</span>}
                                  </span>
                                </span>
                                <span className={cx(styles.frDot, bad && styles.err)} title={bad ? 'Unresolved audit errors' : ''} />
                              </button>
                            )
                          }) : <div className={styles.flNone} style={{ padding: '12px 8px' }}>Empty folder</div>}
                        </div>
                      )}
                    </div>
                  )
                })
                if (!shown) {
                  return (
                    <div className={styles.flNone}>
                      No match
                      {selectorMode && <><br /><span className={styles.sub}>nothing targets {parsed.mode}:{parsed.value}</span></>}
                    </div>
                  )
                }
                return body
              })()}
            </div>
          </div>

          <button type="button" className={cx(styles.gbtn, overlay === 'graph' && styles.on)}
            title="02 · Dependency Graph" onClick={() => setOverlay(o => (o === 'graph' ? null : 'graph'))}>
            <i className="fa-solid fa-circle-nodes" />
          </button>
          <button type="button" className={cx(styles.gbtn, styles.g2, overlay === 'guide' && styles.on)}
            title="Authoring Guide" onClick={() => setOverlay(o => (o === 'guide' ? null : 'guide'))}>
            <i className="fa-solid fa-question" />
          </button>
        </section>

        {/* ---------------- 03 — NODE EDITOR ---------------- */}
        <section className={styles.region}>
          <div className={styles.frame} />
          <div className={styles.inner}>
            <span className={cx(styles.rCorner, styles.tl)} /><span className={cx(styles.rCorner, styles.br)} />
            <div className={cx(styles.rHead, styles.editHead)}
              style={draft ? { background: `linear-gradient(90deg, ${draft.color || DEFAULT_COLOR}22, ${draft.color || DEFAULT_COLOR}0a 55%, transparent)` } : undefined}>
              <span className={styles.rhNum} style={draft ? { color: draft.color || DEFAULT_COLOR } : undefined}>03</span>
              <span className={styles.rhTitle}>Node Editor</span>
              <span className={styles.rhMeta}>
                <span className={styles.idtag}>
                  {draft && <i className={cx('fa-solid fa-lock', styles.lk)} />}
                  <span className={styles.k}>Id</span>
                  {selId && !creating
                    ? <span className={styles.v}>{selId}</span>
                    : <span className={cx(styles.v, styles.pend)}>{draft ? 'on first save' : '—'}</span>}
                  {draft && <button type="button" className={styles.idq} title="Why the id never changes" onClick={() => setPop({ k: 'idhelp' })}>?</button>}
                </span>
              </span>
              <button type="button" className={cx(styles.rhKebab, menuOn && styles.on)} aria-haspopup="menu" aria-expanded={menuOn}
                title="Feature actions" onClick={() => setMenuOn(v => !v)}>
                <i className="fa-solid fa-ellipsis-vertical" />
              </button>
              {menuOn && (
                <div className={styles.hmenu} role="menu">
                  <button type="button" role="menuitem" disabled={!canDelete} onClick={() => void onDuplicate()}>
                    <i className="fa-solid fa-clone" /> Duplicate feature
                  </button>
                  <div className={styles.hsep} />
                  <button type="button" role="menuitem" className={styles.danger} disabled={!canDelete}
                    onClick={() => { setMenuOn(false); setPop({ k: 'delete' }) }}>
                    <i className="fa-solid fa-trash" /> Delete feature
                  </button>
                  {!canDelete && (
                    <div className={styles.hnote}>
                      {!draft ? 'Select a feature first.' : 'Unsaved draft — save it before it can be duplicated or deleted.'}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className={styles.rScroll} ref={scrollRef}>
              <div className={cx(styles.insp, helpOn && styles.helpon)}>
                {!draft ? (
                  <div className={styles.inspEmpty}>
                    <div className={styles.icBigFrame}><i className="fa-solid fa-diagram-project" /></div>
                    <div className={styles.t}>No Feature Selected</div>
                    <div className={styles.d}>Pick a feature from the list, or start a new one.</div>
                  </div>
                ) : (
                  <FeatureForm
                    d={draft} set={set} setEffect={setEffect} setVar={setVar} update={update}
                    open={open} setOpen={setOpen} openEffect={openEffect} setOpenEffect={setOpenEffect}
                    moreOps={moreOps} setMoreOps={setMoreOps}
                    folders={folders} nodes={nodes} namesByGid={namesByGid} tagUse={tagUse}
                    tagInput={tagInput} setTagInput={setTagInput} tagAcOpen={tagAcOpen} setTagAcOpen={setTagAcOpen}
                    addTag={addTag} setPop={setPop}
                  />
                )}
              </div>
              {draft && (
                <div className={styles.edAudit}>
                  <div className={styles.auditHead}>
                    <span className={styles.t}>Feature Audit</span>
                    <span className={styles.n}>{errs + warns ? `${errs} err · ${warns} warn` : 'clean'}</span>
                  </div>
                  <div className={styles.audit}>
                    {audit.map((a, i) => (
                      <button key={i} type="button" className={cx(styles.auditItem, styles[a.sev])}
                        onClick={() => setOpen({ vars: true, effects: true })}>
                        <i className={`fa-solid ${a.sev === 'err' ? 'fa-circle-exclamation' : a.sev === 'warn' ? 'fa-triangle-exclamation' : 'fa-circle-check'}`} />
                        <span className={styles.aiTx}><span className={styles.aiT}>{a.t}</span><span className={styles.aiS}>{a.s}</span></span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Both stay mounted — see .gpanel in the stylesheet. Rendering them
              conditionally is what killed the slide-in. `inert` keeps the closed
              one out of the tab order, which `pointer-events: none` alone does
              not do. */}
          <div className={cx(styles.gpanel, overlay === 'graph' && styles.on)} {...inertWhen(overlay !== 'graph')}>
            <div className={styles.gpHead}>
              <span className={styles.n}>02</span><span className={styles.t}>Dependency Graph</span>
              <button type="button" className={styles.gpX} onClick={() => setOverlay(null)}><i className="fa-solid fa-xmark" /> Close</button>
            </div>
            <div className={styles.resv}>
              <div className={styles.resvIc}><i className="fa-solid fa-circle-nodes" /></div>
              <div className={styles.t}>Reserved</div>
              <div className={styles.s}>The graph of which features feed which — variables read across nodes, effects that grant other features — lands in this overlay.</div>
              <div className={styles.k}>Not built in this pass</div>
            </div>
          </div>
          <GuidePanel open={overlay === 'guide'} helpOn={helpOn} setHelpOn={setHelpOn} onClose={() => setOverlay(null)} />
        </section>
      </div>

      <footer className={styles.botbar}>
        <div className={cx(styles.status, errs ? styles.bad : warns ? styles.warn : undefined)}>
          <span className={styles.dot} />
          <span>{errs ? `${errs} error${errs === 1 ? '' : 's'} — publish blocked` : warns ? `${warns} warning${warns === 1 ? '' : 's'} — publishable` : draft ? 'Draft valid · publishable' : 'Catalog clean'}</span>
        </div>
        <span className={cx(styles.dirty, dirty && styles.on)}>● Unpublished changes</span>
        <span className={styles.autosv}>
          {savedAt ? `Draft autosaved ${savedAt.toLocaleTimeString([], { hour12: false })}` : ''}
        </span>
        <span className={styles.tel}>Catalog Stream <span className={styles.sep}>::</span> Sandboxed Draft <span className={styles.sep}>//</span> No player is affected until publish</span>
        <div className={styles.acts}>
          <button type="button" className={cx(styles.btn, styles.ghost)} disabled={!draft || !dirty} onClick={() => setPop({ k: 'revert' })}>
            <span className={styles.bf} /><span className={styles.bi}><i className="fa-solid fa-rotate-left" /> Revert</span>
          </button>
          <button type="button" className={cx(styles.btn, styles.cyan)} disabled={!draft || saving} onClick={() => void onSaveDraft()}>
            <span className={styles.bf} /><span className={styles.bi}><i className="fa-solid fa-floppy-disk" /> Save Draft</span>
          </button>
          <button type="button" className={cx(styles.btn, styles.amber)} disabled={!draft || saving || errs > 0} onClick={() => void onPublish()}>
            <span className={styles.bf} /><span className={styles.bi}><i className="fa-solid fa-tower-broadcast" /> Publish</span>
          </button>
        </div>
      </footer>

      {toast && <div className={cx(styles.toastEl, toast.warn && styles.warn)}>
        <i className={`fa-solid ${toast.warn ? 'fa-circle-exclamation' : 'fa-circle-check'}`} />{toast.msg}
      </div>}

      {pop && createPortal(
        <Popover
          pop={pop} onClose={() => setPop(null)} draft={draft} set={set} update={update}
          nodes={nodes} namesByGid={namesByGid}
          selId={selId} refs={refsToSelected} onDelete={onDelete} onRevert={onRevert}
          published={!!row} folders={folders}
        />, document.body)}

      <div className={styles.scanlines} />
      <div className={styles.vignette} />
    </div>
  )
}

/* ========================================================================== */
/* The form. Everything below renders FROM the op schema — see lib/opSchema.ts. */
/* ========================================================================== */

type PopKind =
  | null
  | { k: 'icon' }
  | { k: 'thing'; ei: number; ti: number }
  | { k: 'help'; which: 'when' | 'ask' | 'target' }
  | { k: 'idhelp' }
  | { k: 'delete' }
  | { k: 'revert' }
  | { k: 'folder' }

type FormProps = {
  d: CatalogFeatureData
  set: (p: Partial<CatalogFeatureData>) => void
  setEffect: (i: number, p: Partial<GraphEffect>) => void
  setVar: (i: number, p: Partial<VarDef>) => void
  update: (fn: (t: CatalogFeatureData) => CatalogFeatureData) => void
  open: { vars: boolean; effects: boolean }
  setOpen: (v: { vars: boolean; effects: boolean }) => void
  openEffect: number | null
  setOpenEffect: (v: number | null) => void
  moreOps: boolean
  setMoreOps: (v: boolean) => void
  folders: string[]
  nodes: AuthoredNode[]
  namesByGid: Map<string, { name: string; kind: string }>
  tagUse: Map<string, number>
  tagInput: string
  setTagInput: (v: string) => void
  tagAcOpen: boolean
  setTagAcOpen: (v: boolean) => void
  addTag: (raw: string) => void
  setPop: (p: PopKind) => void
}

function FeatureForm(p: FormProps) {
  const { d, set, setEffect, setVar, update } = p
  const deepRef = useAutoGrow(d.deep_description ?? '')
  const act = ACTIVATIONS[(d.activation ?? 'none') as ActivationKind] ?? ACTIVATIONS.none
  const vars = d.vars ?? []
  const graph = d.graph ?? []
  const varErr = vars.some(v => !v.name?.trim() || (v.kind === 'derived' && !v.formula?.trim()))
  const effErr = graph.some(e => !e.label?.trim())
  const tagHits = [...p.tagUse.keys()]
    .filter(t => t.includes(normalizeTag(p.tagInput)) && !(d.tags ?? []).includes(t))
    .slice(0, 8)

  return (
    <>
      {/* --- 01 identity: always visible, always sufficient --- */}
      <div className={styles.sec}><span className={styles.num}>01</span><span className={styles.fieldLab}>Identity</span></div>
      <div className={styles.namerow}>
        <div>
          <span className={styles.fieldLab}>Name<span className={styles.req}>*</span></span>
          <input className={cx(styles.in, styles.name)} value={d.name ?? ''} placeholder="Name the feature…"
            onChange={e => set({ name: e.target.value })} />
        </div>
        <div>
          <span className={styles.fieldLab}>Icon</span>
          <button type="button" className={styles.nbtn} title="Pick an icon"
            style={{ ['--nc' as string]: d.color || DEFAULT_COLOR }} onClick={() => p.setPop({ k: 'icon' })}>
            <i className={`fa-solid ${d.icon || 'fa-star'}`} />
          </button>
        </div>
        <div>
          <span className={styles.fieldLab}>Colour</span>
          <div className={styles.colorField}>
            <input type="color" className={styles.colorIn} value={d.color || DEFAULT_COLOR}
              onChange={e => set({ color: e.target.value })} />
          </div>
        </div>
      </div>

      <div className={styles.grid3}>
        <div>
          <span className={styles.fieldLab}>Source<span className={styles.ty}>enum</span></span>
          <select className={styles.in} value={d.category ?? 'other'} onChange={e => set({ category: e.target.value as FeatureCategory })}>
            {Object.entries(SOURCES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <div>
          <span className={styles.fieldLab}>Source detail</span>
          <input className={styles.in} value={d.source ?? ''} placeholder="Fighter 1" onChange={e => set({ source: e.target.value })} />
        </div>
        <div>
          <span className={styles.fieldLab}>Folder</span>
          <select className={styles.in} value={d.folder ?? UNFILED}
            onChange={e => set({ folder: e.target.value === 'Unfiled' ? undefined : e.target.value })}>
            {[...new Set([UNFILED, ...p.folders])].map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
      </div>

      <div className={styles.sec}>
        <span className={styles.fieldLab}>Card text</span>
        <span className={styles.facing}><i className="fa-solid fa-eye" /> Player-facing</span>
      </div>
      <input className={cx(styles.in, styles.sumline)} value={d.light_description ?? ''} maxLength={160}
        placeholder="One line — what the player reads while scanning the card…"
        onChange={e => set({ light_description: e.target.value })} />
      <div className={styles.subHint}>One line, on the collapsed card in play. Supports **bold** and *italics*.</div>

      <div className={styles.sec}>
        <span className={styles.fieldLab}>Detail text</span>
        <span className={styles.facing}><i className="fa-solid fa-eye" /> Player-facing</span>
      </div>
      <textarea ref={deepRef} className={styles.prose} value={d.deep_description ?? ''}
        placeholder="The full prose the player reads when the card is expanded…"
        onChange={e => set({ deep_description: e.target.value })} />
      <div className={styles.subHint}>The detail, on the expanded card.</div>

      <div className={styles.grid2}>
        <div>
          <span className={styles.fieldLab}>Activation<span className={styles.ty}>enum</span></span>
          <select className={styles.in} value={d.activation ?? 'none'} onChange={e => set({ activation: e.target.value as ActivationKind })}>
            {ACT_ORDER.map(k => <option key={k} value={k}>{ACTIVATIONS[k].label}</option>)}
          </select>
        </div>
        <div />
      </div>
      <div className={styles.actNote} style={{ ['--an' as string]: act.color }}>
        <i className={`fa-solid ${act.icon}`} /><span>{act.note}</span>
      </div>

      <div className={styles.grid2} style={{ marginBottom: 2 }}>
        <div>
          <span className={styles.fieldLab}>Max uses</span>
          <input className={styles.in} type="number" min={0} value={d.uses?.max ?? 0}
            placeholder="0 = at-will"
            onChange={e => {
              const max = Math.max(0, parseInt(e.target.value, 10) || 0)
              // Granted copies start full — same rule the old console form used.
              set({ uses: max > 0 ? { current: max, max } : undefined, ...(max > 0 ? {} : { recharge: undefined }) })
            }} />
        </div>
        <div>
          <span className={styles.fieldLab}>Resets on</span>
          <select className={styles.in} value={d.recharge ?? ''} disabled={!(d.uses?.max)}
            onChange={e => set({ recharge: (e.target.value || undefined) as 'short' | 'long' | undefined })}>
            {RECHARGES.map(r => <option key={r.v} value={r.v}>{r.l}</option>)}
          </select>
        </div>
      </div>
      <div className={styles.actNote} style={{ ['--an' as string]: 'var(--beige-dim)', marginTop: -2 }}>
        <i className="fa-solid fa-rotate" />
        <span>Uses are independent of activation — <b>0 means at-will</b>, and a passive feature can still track uses.</span>
      </div>

      {/* --- 02 tags --- */}
      <div className={styles.sec}><span className={styles.num}>02</span><span className={styles.fieldLab}>Tags</span></div>
      <div className={styles.chips}>
        {(d.tags ?? []).length
          ? (d.tags ?? []).map((t, i) => (
            <span key={t} className={styles.chip}>{t}
              <i className={cx('fa-solid fa-xmark', styles.x)}
                onClick={() => update(x => ({ ...x, tags: (x.tags ?? []).filter((_, j) => j !== i) }))} />
            </span>
          ))
          : <span className={cx(styles.chip, styles.empty)}>no tags</span>}
      </div>
      <div className={styles.tagbox}>
        <input className={styles.in} value={p.tagInput} placeholder="Add a tag — lowercased on save"
          autoComplete="off" spellCheck={false}
          onChange={e => { p.setTagInput(e.target.value); p.setTagAcOpen(true) }}
          onBlur={() => setTimeout(() => p.setTagAcOpen(false), 140)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); p.addTag(p.tagInput) }
            if (e.key === 'Escape') p.setTagAcOpen(false)
          }} />
        {p.tagAcOpen && p.tagInput.trim() && tagHits.length > 0 && (
          <div className={styles.ac}>
            <div className={styles.hd}>In use already</div>
            {tagHits.map(t => (
              <button key={t} type="button" onMouseDown={e => e.preventDefault()} onClick={() => p.addTag(t)}>
                <i className="fa-solid fa-tag" style={{ fontSize: 8, color: 'var(--amber-dim)' }} />{t}
                <span className={styles.n}>{p.tagUse.get(t)} in use</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* --- 03 variables --- */}
      <div className={cx(styles.blk, p.open.vars && styles.open)}>
        <button type="button" className={styles.blkHead} onClick={() => p.setOpen({ ...p.open, vars: !p.open.vars })}>
          <i className={cx('fa-solid fa-chevron-right', styles.ch)} />
          <span className={styles.bnum}>03</span><span className={styles.bt}>Variables</span>
          <span className={styles.bs}>{p.open.vars ? 'state this feature carries' : 'optional · leave closed for prose features'}</span>
          <span className={cx(styles.bcount, varErr ? styles.bad : vars.length ? styles.hot : undefined)}>{vars.length}</span>
        </button>
        {p.open.vars && (
          <div className={styles.blkBody}>
            <div className={styles.blkOptin}>
              <i className="fa-solid fa-circle-info" />
              <span>Only needed when an effect must read or write state. Stored variables are saved on the character; derived ones are recomputed from a formula on every read.</span>
            </div>
            {vars.map((v, vi) => {
              const stored = v.kind !== 'derived'
              const dmOnly = v.scope === 'dm'
              return (
                <div key={vi} className={cx(styles.card, !v.name?.trim() && styles.err)}>
                  <div className={styles.cardHead}>
                    <input className={styles.vname} value={v.name ?? ''} placeholder="identifier" spellCheck={false}
                      onChange={e => setVar(vi, { name: e.target.value })} />
                    <span className={styles.seg}>
                      <button type="button" className={cx(stored && styles.on)}
                        onClick={() => setVar(vi, { kind: 'stored', formula: undefined, type: v.type ?? 'num' })}>
                        <i className="fa-solid fa-database" /> Stored
                      </button>
                      <button type="button" className={cx(!stored && styles.on)}
                        onClick={() => setVar(vi, { kind: 'derived', type: undefined, initial: undefined, scope: undefined })}>
                        <i className="fa-solid fa-function" /> Derived
                      </button>
                    </span>
                    <button type="button" className={cx('fa-solid fa-trash', styles.dx)}
                      onClick={() => update(x => ({ ...x, vars: (x.vars ?? []).filter((_, j) => j !== vi) }))} />
                  </div>
                  {stored ? (
                    <>
                      <div className={styles.kindnote}>Stored — written on the character sheet and read back. Needs a type.</div>
                      <div className={styles.grid3}>
                        <div>
                          <span className={styles.fieldLab}>Type<span className={styles.req}>*</span><span className={styles.ty}>enum</span></span>
                          <select className={cx(styles.in, !v.type && styles.bad)} value={v.type ?? ''}
                            onChange={e => setVar(vi, { type: (e.target.value || undefined) as 'num' | 'bool' | undefined })}>
                            <option value="">— required —</option>
                            <option value="num">Number</option>
                            <option value="bool">Boolean</option>
                          </select>
                        </div>
                        <div>
                          <span className={styles.fieldLab}>Initial value</span>
                          <input className={styles.in} value={v.initial === undefined ? '' : String(v.initial)}
                            placeholder="optional — e.g. 0"
                            onChange={e => {
                              const raw = e.target.value.trim()
                              const initial = raw === '' ? undefined
                                : v.type === 'bool' ? raw === 'true'
                                : Number.isFinite(Number(raw)) ? Number(raw) : undefined
                              setVar(vi, { initial })
                            }} />
                        </div>
                        <div>
                          <span className={styles.fieldLab}>Resets on<span className={styles.ty}>enum</span></span>
                          <select className={styles.in} value={v.resetOn ?? ''}
                            onChange={e => setVar(vi, { resetOn: (e.target.value || undefined) as 'short' | 'long' | undefined })}>
                            <option value="">Never</option>
                            <option value="short">Short rest</option>
                            <option value="long">Long rest</option>
                          </select>
                        </div>
                      </div>
                      <div className={styles.kindnote} style={{ margin: '-6px 0 11px' }}>
                        Resets return the variable to its initial value on that rest — the same
                        rule a feature’s uses follow. A long rest includes the short-rest ones.
                        <b> Never</b> means only an activation or the player changes it.
                      </div>
                      <div className={cx(styles.perm, !dmOnly && styles.player)}>
                        <i className={`fa-solid ${dmOnly ? 'fa-lock' : 'fa-user-pen'}`} />
                        <span>
                          <span className={styles.pt}>{dmOnly ? 'DM-only' : 'Player-writable'}</span><br />
                          <span className={styles.ps}>{dmOnly
                            ? 'permission · hidden from the player sheet, only this console writes it'
                            : 'permission · the player can change this from their sheet'}</span>
                        </span>
                        <span className={cx(styles.seg, styles.tiny)}>
                          <button type="button" className={cx(!dmOnly && styles.on, !dmOnly && styles.cy)} onClick={() => setVar(vi, { scope: 'player' })}>Player</button>
                          <button type="button" className={cx(dmOnly && styles.on)} onClick={() => setVar(vi, { scope: 'dm' })}><i className="fa-solid fa-lock" /> DM-only</button>
                        </span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className={styles.kindnote}>Derived — never stored. Its type comes from the formula, so there is no type to pick.</div>
                      <span className={styles.fieldLab}>Formula<span className={styles.req}>*</span></span>
                      <input className={cx(styles.in, !v.formula?.trim() && styles.bad)} value={v.formula ?? ''} spellCheck={false}
                        placeholder="level / 4 + 1" onChange={e => setVar(vi, { formula: e.target.value })} />
                    </>
                  )}
                  <span className={styles.fieldLab}>Display label</span>
                  <input className={styles.in} value={v.label ?? ''} style={{ marginBottom: 2 }}
                    placeholder="optional — what the sheet calls it" onChange={e => setVar(vi, { label: e.target.value })} />
                </div>
              )
            })}
            <button type="button" className={styles.addbtn}
              onClick={() => update(x => ({ ...x, vars: [...(x.vars ?? []), { name: '', kind: 'stored', type: 'num', scope: 'player' }] }))}>
              <i className="fa-solid fa-plus" /> Add variable
            </button>
          </div>
        )}
      </div>

      {/* --- 04 effects --- */}
      <div className={cx(styles.blk, p.open.effects && styles.open)}>
        <button type="button" className={styles.blkHead} onClick={() => p.setOpen({ ...p.open, effects: !p.open.effects })}>
          <i className={cx('fa-solid fa-chevron-right', styles.ch)} />
          <span className={styles.bnum}>04</span><span className={styles.bt}>Effects</span>
          <span className={styles.bs}>{p.open.effects ? 'contributions this feature makes' : 'optional · prose-only features need none'}</span>
          <span className={cx(styles.bcount, effErr ? styles.bad : graph.length ? styles.hot : undefined)}>{graph.length}</span>
        </button>
        {p.open.effects && (
          <div className={styles.blkBody}>
            <div className={styles.blkOptin}>
              <i className="fa-solid fa-circle-info" />
              <span>One op per node, collapsed by default — each row says what it does and where it goes. Click a row to edit it. Pick an op below to add a node.</span>
            </div>
            <div className={styles.oppal}>
              <div className={styles.oppalGrp}><span className={styles.gl}>Contributions</span></div>
              <div className={styles.oppalRow}>
                {PALETTE.map(o => (
                  <button key={o} type="button" className={styles.opb} onClick={() => {
                    update(x => ({ ...x, graph: [...(x.graph ?? []), blankEffect(o)] }))
                    p.setOpenEffect(graph.length); p.setOpen({ ...p.open, effects: true })
                  }}><i className="fa-solid fa-plus" />{OP_TITLE[o]}</button>
                ))}
                {p.moreOps
                  ? PALETTE_MORE.map(o => (
                    <button key={o} type="button" className={styles.opb} onClick={() => {
                      update(x => ({ ...x, graph: [...(x.graph ?? []), blankEffect(o)] }))
                      p.setOpenEffect(graph.length); p.setOpen({ ...p.open, effects: true })
                    }}><i className="fa-solid fa-plus" />{OP_TITLE[o]}</button>
                  ))
                  : <button type="button" className={cx(styles.opb, styles.more)} onClick={() => p.setMoreOps(true)}>
                      <i className="fa-solid fa-ellipsis" />More
                    </button>}
              </div>
              {/* Activations answer a different question from everything above —
                  "what happens when the player presses this" rather than "what
                  modifies this roll" — so they get their own group. */}
              <div className={styles.oppalGrp}><span className={cx(styles.gl, styles.act)}>Activation outcomes</span></div>
              <div className={styles.oppalRow}>
                {PALETTE_ACT.map(o => (
                  <button key={o} type="button" className={cx(styles.opb, styles.act)} onClick={() => {
                    update(x => ({ ...x, graph: [...(x.graph ?? []), blankEffect(o)] }))
                    p.setOpenEffect(graph.length); p.setOpen({ ...p.open, effects: true })
                  }}><i className="fa-solid fa-plus" />{OP_TITLE[o]}</button>
                ))}
              </div>
            </div>

            {graph.map((eff, ei) => (
              p.openEffect === ei
                ? <EffectCard key={eff.id} eff={eff} ei={ei} d={d} setEffect={setEffect} update={update}
                    nodes={p.nodes} namesByGid={p.namesByGid} setPop={p.setPop}
                    onClose={() => p.setOpenEffect(null)} />
                : <EffectRow key={eff.id} eff={eff} namesByGid={p.namesByGid}
                    onOpen={() => p.setOpenEffect(ei)}
                    onDelete={() => {
                      update(x => ({ ...x, graph: (x.graph ?? []).filter((_, j) => j !== ei) }))
                      p.setOpenEffect(null)
                    }} />
            ))}
          </div>
        )}
      </div>
    </>
  )
}

/* ---------- collapsed effect row ---------- */

function selLabel(t: string, namesByGid: Map<string, { name: string }>): string {
  const s = splitSel(t)
  if (s.kind === 'tag') return `tag:${normalizeTag(s.value) || '?'}`
  if (s.kind === 'roll') return `roll:${s.value || '?'}`
  return namesByGid.get(t)?.name ?? t
}

function opValueBit(eff: GraphEffect): string {
  if (eff.op === 'add') {
    const byL = (eff.byLevel ?? []).some((x, i) => i > 0 && String(x).trim())
    return byL ? 'by level' : eff.value ? `+${eff.value}` : ''
  }
  if (eff.op === 'crit') return eff.threshold ? `on ${eff.threshold}+` : ''
  if (eff.op === 'note') { const t = eff.text ?? ''; return t.length > 46 ? `${t.slice(0, 46)}…` : t }
  return ''
}

function EffectRow({ eff, namesByGid, onOpen, onDelete }: {
  eff: GraphEffect; namesByGid: Map<string, { name: string }>
  onOpen: () => void; onDelete: () => void
}) {
  const cfg = OPS[eff.op]
  const badLab = !eff.label?.trim()
  const ts = eff.target ?? []
  const val = opValueBit(eff)
  const flags = [eff.when?.trim() && 'when', eff.ask?.trim() && 'ask'].filter(Boolean)
  return (
    <div className={cx(styles.efrow, IS_DAMAGE_FLAG(eff.op) && styles.flag, IS_ACTIVATION(eff.op) && styles.act, badLab && styles.bad)}
      role="button" tabIndex={0} onClick={onOpen}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}>
      <i className={cx('fa-solid fa-chevron-right', styles.ch)} />
      <span className={styles.efGlFrame}><i className={`fa-solid ${cfg?.icon ?? 'fa-circle'}`} /></span>
      <span className={styles.op}>{cfg?.label ?? eff.op}</span>
      <span className={cx(styles.lab, badLab && styles.miss)}>{badLab ? 'no label' : eff.label}</span>
      <span className={styles.sum}>
        {val && <><span className={styles.v}>{val}</span><span className={styles.sep}>·</span></>}
        <span className={cx(styles.tg, !ts.length && styles.own)}>
          {ts.length ? ts.map(t => selLabel(t, namesByGid)).join(' | ') : 'own roll'}
        </span>
        {flags.length > 0 && <><span className={styles.sep}>·</span><span className={styles.fl}>{flags.join(' + ')}</span></>}
      </span>
      <button type="button" className={cx('fa-solid fa-trash', styles.dx)}
        onClick={e => { e.stopPropagation(); onDelete() }} title="Delete node" />
    </div>
  )
}

/* ---------- expanded effect card ---------- */

function EffectCard({ eff, ei, d, setEffect, update, nodes, namesByGid, setPop, onClose }: {
  eff: GraphEffect; ei: number; d: CatalogFeatureData
  setEffect: (i: number, p: Partial<GraphEffect>) => void
  update: (fn: (t: CatalogFeatureData) => CatalogFeatureData) => void
  nodes: AuthoredNode[]; namesByGid: Map<string, { name: string; kind: string }>
  setPop: (p: PopKind) => void; onClose: () => void
}) {
  const cfg = OPS[eff.op]
  const badLab = !eff.label?.trim()
  const targets = eff.target ?? []
  const isFlag = IS_DAMAGE_FLAG(eff.op)
  const isAct = IS_ACTIVATION(eff.op)

  const counts = targets.map(t => (t.startsWith('roll:') ? Infinity : matchCount(t, nodes)))
  const thingsAndTags = counts.filter(n => Number.isFinite(n)).reduce((a: number, b) => a + b, 0)
  const rollCount = counts.filter(n => !Number.isFinite(n)).length
  const summary = !targets.length
    ? { own: true, text: 'this node’s own roll' }
    : {
        own: false,
        zero: thingsAndTags === 0 && rollCount === 0,
        text: [
          (thingsAndTags || !rollCount) ? `targets ${thingsAndTags} thing${thingsAndTags === 1 ? '' : 's'}` : '',
          rollCount ? `${rollCount} roll kind${rollCount === 1 ? '' : 's'}` : '',
        ].filter(Boolean).join(' · '),
      }

  const setTarget = (ti: number, v: string) =>
    setEffect(ei, { target: targets.map((t, j) => (j === ti ? v : t)) })

  return (
    <div className={cx(styles.card, badLab && styles.err)}>
      <div className={styles.cardHead}>
        <i className={cx('fa-solid fa-chevron-down', styles.ch)} onClick={onClose}
          style={{ fontSize: 9, color: 'var(--amber)', cursor: 'pointer' }} />
        <span className={styles.cix}>NODE {String(ei + 1).padStart(2, '0')}</span>
        <select className={styles.opSel} value={eff.op} onChange={e => {
          // Switching the op should feel like changing a verb, not losing your
          // work: targets, label and both gates survive, and so does any field
          // the new op shares with the old one.
          const next = e.target.value as GraphOp
          const fresh = blankEffect(next)
          const keep: GraphEffect = { ...fresh, id: eff.id, target: eff.target, label: eff.label, when: eff.when, ask: eff.ask }
          for (const fd of OPS[next].fields) {
            const cur = (eff as unknown as Record<string, unknown>)[fd.key]
            if (cur !== undefined) (keep as unknown as Record<string, unknown>)[fd.key] = cur
          }
          update(x => ({ ...x, graph: (x.graph ?? []).map((g, j) => (j === ei ? keep : g)) }))
        }}>
          {OP_ORDER.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <span className={cx(styles.grpPill, isFlag && styles.flag, isAct && styles.act)}>
          <i className={`fa-solid ${isAct ? 'fa-bolt' : isFlag ? 'fa-shield-halved' : 'fa-infinity'}`} />
          {isAct ? 'Activation outcome' : isFlag ? 'Damage flag' : 'Passive contribution'}
        </span>
        <button type="button" className={cx('fa-solid fa-trash', styles.dx)}
          onClick={() => { update(x => ({ ...x, graph: (x.graph ?? []).filter((_, j) => j !== ei) })); onClose() }} />
      </div>
      <div className={styles.opBlurb}>{cfg?.blurb}</div>

      {/* targets — activations have none: they write a variable on this
          character rather than reaching out at another node. */}
      {isAct ? (
        <div className={styles.tgtOwn}>
          <i className="fa-solid fa-bolt" />
          <span>No target — this writes one of this feature’s own variables when the player presses Use.</span>
        </div>
      ) : (<>
      <div className={styles.subsec}>
        <span className={styles.sl}>Target</span>
        <span className={styles.qm} onClick={() => setPop({ k: 'help', which: 'target' })}>?</span>
        <span className={cx(styles.cnt, summary.own && styles.own, !summary.own && summary.zero && styles.zero)}>
          <i className={`fa-solid ${summary.own ? 'fa-arrow-turn-down' : 'fa-crosshairs'}`} />{summary.text}
        </span>
      </div>
      {targets.map((t, ti) => {
        const s = splitSel(t)
        const n = counts[ti]
        return (
          <div key={ti} className={cx(styles.tgt, s.kind === 'thing' ? styles.kThing : s.kind === 'tag' ? styles.kTag : styles.kRoll)}>
            <span className={cx(styles.seg, styles.tiny, styles.kseg)}>
              {KINDS.map(K => (
                <button key={K.k} type="button" title={K.l}
                  className={cx(s.kind === K.k && styles.on, s.kind === K.k && styles[K.k])}
                  onClick={() => { if (s.kind !== K.k) setTarget(ti, joinSel(K.k, '')) }}>
                  <i className={`fa-solid ${K.ic}`} /> {K.l}
                </button>
              ))}
            </span>
            <span className={styles.tval}>
              {s.kind === 'thing' && (
                <button type="button" className={styles.pickbtn} style={{ flex: 1 }}
                  onClick={() => setPop({ k: 'thing', ei, ti })}>
                  <span className={styles.in} style={{ margin: 0, display: 'block', textAlign: 'left' }}>
                    {namesByGid.get(t)?.name ?? (t || 'Search the catalog…')}
                  </span>
                </button>
              )}
              {s.kind === 'tag' && (<>
                <span className={styles.pfx}>tag:</span>
                <input value={s.value} placeholder="fire_damage" spellCheck={false}
                  onChange={e => setTarget(ti, joinSel('tag', e.target.value))} />
              </>)}
              {s.kind === 'roll' && (<>
                <span className={styles.pfx}>roll:</span>
                <select value={s.value} onChange={e => setTarget(ti, joinSel('roll', e.target.value))}>
                  <option value="">— pick —</option>
                  {ROLL_SELECTORS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </>)}
            </span>
            <span className={cx(styles.n, n === 0 && styles.zero)}>
              {Number.isFinite(n) ? `${n} match${n === 1 ? '' : 'es'}` : 'always live'}
            </span>
            <button type="button" className={cx('fa-solid fa-xmark', styles.dx)}
              onClick={() => setEffect(ei, { target: targets.filter((_, j) => j !== ti) })} />
          </div>
        )
      })}
      {!targets.length && (
        <div className={styles.tgtOwn}>
          <i className="fa-solid fa-arrow-turn-down" />
          <span>No selectors — this node applies to its own roll. Add one to reach out at other things. Multiple selectors are OR.</span>
        </div>
      )}
      <button type="button" className={styles.addmini} onClick={() => setEffect(ei, { target: [...targets, 'tag:'] })}>
        <i className="fa-solid fa-plus" /> Add selector
      </button>
      </>)}

      {/* schema-driven parameters */}
      <div className={styles.subsec}><span className={styles.sl}>{cfg?.label} parameters</span></div>
      {cfg?.fields.length ? (
        <>
          {cfg.fields.filter(f => !f.wide).length > 0 && (
            <div className={cfg.fields.filter(f => !f.wide).length > 1 ? styles.grid2 : undefined}>
              {cfg.fields.filter(f => !f.wide).map(fd => (
                <div key={fd.key}><SchemaField fd={fd} eff={eff} ei={ei} setEffect={setEffect} vars={d.vars ?? []} /></div>
              ))}
            </div>
          )}
          {cfg.fields.filter(f => f.wide).map(fd => (
            <SchemaField key={fd.key} fd={fd} eff={eff} ei={ei} setEffect={setEffect} vars={d.vars ?? []} />
          ))}
        </>
      ) : (
        <div className={styles.blkOptin} style={{ marginBottom: 12 }}>
          <i className="fa-solid fa-minus" /><span>None — this op is fully described by its target list.</span>
        </div>
      )}

      {/* statement */}
      <div className={styles.subsec}><span className={styles.sl}>Statement</span></div>
      <span className={styles.fieldLab}>Label<span className={styles.req}>*</span><span className={styles.ty}>text</span></span>
      <div className={styles.hlp}>
        <span className={styles.d}>What the player sees for this node in a roll breakdown. Required on every effect.</span>
        <span className={styles.e}><b>e.g.</b>Savage damage bonus</span>
      </div>
      <input className={cx(styles.in, badLab && styles.bad)} value={eff.label ?? ''}
        placeholder="required — shown in the roll breakdown"
        onChange={e => setEffect(ei, { label: e.target.value })} />

      <div className={cx(styles.wa, styles.when)}>
        <span className={styles.tagl}>
          <span className={styles.k}><i className="fa-solid fa-code-branch" /> when</span>
          <span className={styles.who}>formula · the app decides</span>
        </span>
        <input value={eff.when ?? ''} placeholder="hp < hpMax / 2" spellCheck={false}
          onChange={e => setEffect(ei, { when: e.target.value || undefined })} />
        <span className={styles.qm} onClick={() => setPop({ k: 'help', which: 'when' })}>?</span>
      </div>
      <div className={cx(styles.wa, styles.ask)}>
        <span className={styles.tagl}>
          <span className={styles.k}><i className="fa-regular fa-square-check" /> ask</span>
          <span className={styles.who}>prose · a human decides</span>
        </span>
        <span className={styles.askbox}><i className="fa-regular fa-square" /></span>
        <input value={eff.ask ?? ''} placeholder="No checkbox — applies on its own"
          onChange={e => setEffect(ei, { ask: e.target.value || undefined })} />
        <span className={styles.qm} onClick={() => setPop({ k: 'help', which: 'ask' })}>?</span>
      </div>
    </div>
  )
}

/* ---------- the closed set of field types ---------- */

function SchemaField({ fd, eff, ei, setEffect, vars }: {
  fd: OpField; eff: GraphEffect; ei: number
  setEffect: (i: number, p: Partial<GraphEffect>) => void; vars: VarDef[]
}) {
  const raw = (eff as unknown as Record<string, unknown>)[fd.key]
  const put = (v: unknown) => setEffect(ei, { [fd.key]: v } as Partial<GraphEffect>)
  const textRef = useAutoGrow(typeof raw === 'string' ? raw : '')

  const label = (
    <>
      <span className={styles.fieldLab}>
        {fd.label}{fd.required && <span className={styles.req}>*</span>}
        <span className={styles.ty}>{fd.type}</span>
      </span>
      <div className={styles.hlp}>
        <span className={styles.d}>{fd.desc}</span>
        {fd.example && <span className={styles.e}><b>e.g.</b>{fd.example}</span>}
      </div>
    </>
  )

  if (fd.type === 'formula') {
    return <>{label}<input className={styles.in} value={String(raw ?? '')} placeholder={fd.example}
      spellCheck={false} onChange={e => put(e.target.value)} /></>
  }
  if (fd.type === 'text') {
    return <>{label}<textarea ref={textRef} className={cx(styles.prose, styles.short)} value={String(raw ?? '')}
      placeholder={fd.example} onChange={e => put(e.target.value)} /></>
  }
  if (fd.type === 'enum') {
    return <>{label}<select className={styles.in} value={String(raw ?? '')} onChange={e => put(e.target.value)}>
      {(fd.options ?? []).map(o => <option key={o}>{o}</option>)}
    </select></>
  }
  if (fd.type === 'boolean') {
    return <>{label}<div className={styles.in} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
      onClick={() => put(!raw)}>
      <i className={`fa-solid ${raw ? 'fa-square-check' : 'fa-square'}`} />{fd.label}
    </div></>
  }
  if (fd.type === 'reference' && fd.ref !== 'variable') return null
  if (fd.type === 'reference' && fd.ref === 'variable') {
    const known = vars.some(v => v.name === raw)
    const stale = !!raw && !known
    return <>{label}<select className={cx(styles.in, stale && styles.bad)} value={String(raw ?? '')}
      onChange={e => put(e.target.value)}>
      <option value="">— pick a variable —</option>
      {vars.filter(v => v.name).map(v => <option key={v.name} value={v.name}>{v.name}{v.label ? ` · ${v.label}` : ''}</option>)}
      {stale && <option value={String(raw)}>{String(raw)} · UNDECLARED</option>}
    </select></>
  }
  if (fd.type === 'array') {
    const arr = Array.isArray(raw) ? (raw as string[]) : blankArr()
    const filled = arr.filter((x, i) => i > 0 && String(x).trim()).length
    return <>{label}
      <div className={styles.arr}>
        <div className={styles.arrGrid}>
          {arr.map((x, i) => (
            <div key={i} className={cx(styles.arrSlot, i === 0 && styles.zero)}>
              <span className={styles.ix}>{i}</span>
              {i === 0
                ? <input disabled value="—" />
                : <input value={x} onChange={e => put(arr.map((y, j) => (j === i ? e.target.value : y)))} />}
            </div>
          ))}
        </div>
        <div className={styles.arrNote}>
          <i className="fa-solid fa-hashtag" />21 slots · <b>index 0 unused</b> · levels 1–20 · {filled} filled
          {filled > 0 && ' · overrides Amount'}
        </div>
      </div>
    </>
  }
  // `selector` is handled by the target list above — no op declares one as a
  // parameter yet. Rendering nothing beats rendering a control that writes
  // somewhere the engine does not read.
  return null
}

/* ---------- the authoring guide ---------- */

function GuidePanel({ open, helpOn, setHelpOn, onClose }: { open: boolean; helpOn: boolean; setHelpOn: (v: boolean) => void; onClose: () => void }) {
  return (
    <div className={cx(styles.gpanel, open && styles.on)} {...inertWhen(!open)}>
      <div className={styles.gpHead}>
        <span className={styles.n}><i className="fa-solid fa-question" /></span>
        <span className={styles.t}>Authoring Guide</span>
        <button type="button" className={cx(styles.gpX, styles.help, helpOn && styles.on)} onClick={() => setHelpOn(!helpOn)}>
          <i className="fa-regular fa-circle-question" /> Per-field help
        </button>
        <button type="button" className={cx(styles.gpX, styles.plain)} onClick={onClose}><i className="fa-solid fa-xmark" /> Close</button>
      </div>
      <div className={styles.gpBody}>
        <div className={styles.sec}><span className={styles.num}>01</span><span className={styles.fieldLab}>Prose is enough</span></div>
        <p className={styles.gtext}>Fill in identity, write the description, publish. <strong>Variables</strong> and <strong>Effects</strong> exist for features the app has to compute — they stay closed until you open them, and a feature that never opens them is a complete feature.</p>

        <div className={styles.sec}><span className={styles.num}>02</span><span className={styles.fieldLab}>when vs ask</span></div>
        <p className={styles.gtext}>Two different kinds of thing, deliberately drawn as two different rows.</p>
        <div className={styles.gdl}>
          <span className={styles.k}>when</span><span className={styles.v}>A condition the <b>app</b> evaluates over variables and the sheet. False means the node contributes nothing and is never mentioned. <code>hp &lt; hpMax / 2</code></span>
          <span className={cx(styles.k, styles.cy)}>ask</span><span className={styles.v}>A toggle a <b>human</b> flips at the table; the text is the label on it. <code>Spend a use to press the attack?</code></span>
          <span className={cx(styles.k, styles.be)}>Both</span><span className={styles.v}>Legal and common: the app checks whether the choice is available, the player decides whether to spend it.</span>
        </div>

        <div className={styles.sec}><span className={styles.num}>03</span><span className={styles.fieldLab}>Target selectors</span></div>
        <p className={styles.gtext}>A target list is a set of selectors, OR’d together. Empty means the node’s own roll.</p>
        <div className={styles.gdl}>
          <span className={cx(styles.k, styles.be)}>Thing</span><span className={styles.v}>One named entity from the catalog. Picked by name; the id is what gets stored.</span>
          <span className={styles.k}>Tag</span><span className={styles.v}><code>tag:fire_damage</code> — everything carrying the tag, following the catalog as it grows.</span>
          <span className={cx(styles.k, styles.cy)}>Roll kind</span><span className={styles.v}><code>roll:save.dex</code>, or <code>roll:save</code> for all of them. A class of roll, not a thing — so it has no match count; it is always live.</span>
          <span className={styles.k}>Match count</span><span className={styles.v}>Read it every time. It is the only signal that separates a typo from a selector that correctly matches nothing yet.</span>
        </div>

        <div className={styles.sec}><span className={styles.num}>04</span><span className={styles.fieldLab}>Variables</span></div>
        <div className={styles.gdl}>
          <span className={cx(styles.k, styles.be)}>Stored</span><span className={styles.v}>Written on the character and read back. Needs a type — Number or Boolean — and takes an optional initial value.</span>
          <span className={cx(styles.k, styles.be)}>Derived</span><span className={styles.v}>Never stored. Recomputed from its formula on every read, so it has no type to pick.</span>
          <span className={styles.k}>DM-only</span><span className={styles.v}>A permission, not a style. Amber means the player cannot write it — only this console can.</span>
        </div>

        <div className={styles.sec}><span className={styles.num}>05</span><span className={styles.fieldLab}>Field types</span></div>
        <p className={styles.gtext}>A closed set. Every op composes its parameters out of these, which is why an op you have never seen still renders as a form you already know.</p>
        <div className={styles.gdl}>
          <span className={styles.k}>formula</span><span className={styles.v}>Number or expression, evaluated by the app.</span>
          <span className={styles.k}>text</span><span className={styles.v}>Player-facing prose.</span>
          <span className={styles.k}>selector</span><span className={styles.v}>A target list — thing, tag or roll kind.</span>
          <span className={styles.k}>enum</span><span className={styles.v}>One of a fixed list.</span>
          <span className={styles.k}>boolean</span><span className={styles.v}>On or off.</span>
          <span className={styles.k}>reference</span><span className={styles.v}>A pick from the catalog, or from this feature’s own variables.</span>
          <span className={styles.k}>array</span><span className={styles.v}>Level-indexed progression: 21 slots, index 0 unused, levels 1–20.</span>
        </div>

        <div className={styles.sec}><span className={styles.num}>06</span><span className={styles.fieldLab}>Draft, save, publish</span></div>
        <div className={styles.gdl}>
          <span className={styles.k}>Autosave</span><span className={styles.v}>Local to this browser, every keystroke. Survives a refresh; reaches nobody else.</span>
          <span className={styles.k}>Save Draft</span><span className={styles.v}>Parks the edit on the row without touching the published version. A granted feature keeps working exactly as it did.</span>
          <span className={styles.k}>Publish</span><span className={styles.v}>Promotes the draft. Only a published feature can be granted — and existing grants are snapshots, so they do not change underneath a player.</span>
        </div>

        <div className={styles.sec}><span className={styles.num}>07</span><span className={styles.fieldLab}>Audit</span></div>
        <div className={styles.gdl}>
          <span className={cx(styles.k, styles.er)}>Error</span><span className={styles.v}>Blocks Publish. Something the app cannot resolve.</span>
          <span className={styles.k}>Warning</span><span className={styles.v}>Informs only. Publish is allowed — an empty tag can be a tag nothing carries yet.</span>
          <span className={cx(styles.k, styles.ok)}>Clean</span><span className={styles.v}>Nothing outstanding.</span>
        </div>
        <p className={styles.gtext} style={{ color: 'var(--muted)', fontSize: 13.5 }}>
          Per-field help — each field’s schema description and example — lives behind <strong>Per-field help</strong> above.
        </p>
      </div>
    </div>
  )
}

/* ---------- popovers ---------- */

const HELP = {
  when: {
    t: 'when — the app decides',
    body: (
      <>
        <p><code>when</code> is a condition the app evaluates. If it reads false, the node contributes nothing and the player never sees it mentioned.</p>
        <p className={styles.mono}>Written over this feature’s variables and the character sheet. No prose, no prompt, no choice.</p>
        <div className={styles.dl}>
          <span className={styles.k}>Example</span><span className={styles.v}>hp &lt; hpMax / 2</span>
          <span className={styles.k}>Example</span><span className={styles.v}>charges &gt; 0 &amp;&amp; isRaging</span>
          <span className={styles.k}>Empty</span><span className={styles.v}>Always true — the node always contributes.</span>
        </div>
      </>
    ),
  },
  ask: {
    t: 'ask — a human decides',
    body: (
      <>
        <p><code>ask</code> turns the node into a toggle the <em>player</em> flips at the table. The text you write is the label on that toggle.</p>
        <p className={styles.mono}>Orthogonal to <code>when</code>. A node can have both: the app checks whether the choice is legal, the player chooses whether to spend it. Two effects sharing one <code>ask</code> label become one checkbox.</p>
        <div className={styles.dl}>
          <span className={styles.k}>Example</span><span className={styles.v}>Spend a use to press the attack?</span>
          <span className={styles.k}>Empty</span><span className={styles.v}>No prompt — the node applies on its own.</span>
        </div>
      </>
    ),
  },
  target: {
    t: 'Target selectors',
    body: (
      <>
        <p>A target list is a set of selectors, OR’d together. Three kinds, and they resolve differently:</p>
        <div className={styles.dl}>
          <span className={styles.k}>Thing</span><span className={styles.v}>One named entity from the catalog — a spell, item or feature. Picked by name; stored as an id.</span>
          <span className={styles.k}>Tag</span><span className={styles.v}>Every entity carrying the tag. <code>tag:fire_damage</code> follows the catalog as it grows.</span>
          <span className={styles.k}>Roll kind</span><span className={styles.v}>A class of roll rather than a thing. <code>roll:save.dex</code>, or <code>roll:save</code> for all of them.</span>
          <span className={styles.k}>Empty</span><span className={styles.v}>The node’s own roll — the feature acting on itself.</span>
        </div>
        <p className={styles.mono}>The match count beside the list is the only thing that tells a typo from a selector that correctly matches nothing yet. Read it every time.</p>
      </>
    ),
  },
}

function Popover({ pop, onClose, draft, set, update, nodes, namesByGid, selId, refs, onDelete, onRevert, published, folders }: {
  pop: NonNullable<PopKind>; onClose: () => void
  draft: CatalogFeatureData | null
  set: (p: Partial<CatalogFeatureData>) => void
  update: (fn: (t: CatalogFeatureData) => CatalogFeatureData) => void
  nodes: AuthoredNode[]; namesByGid: Map<string, { name: string; kind: string }>
  selId: string | null; refs: { name: string; how: string }[]
  onDelete: () => void; onRevert: () => void; published: boolean; folders: string[]
}) {
  const [q, setQ] = useState('')
  const small = pop.k !== 'icon' && pop.k !== 'thing'

  return (
    <div className={styles.scrim} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={cx(styles.pop, small && styles.small)}>
        {pop.k === 'icon' && draft && (<>
          <div className={styles.popHead}>
            <i className={`fa-solid ${draft.icon || 'fa-star'}`} style={{ color: draft.color || DEFAULT_COLOR }} />
            <span className={styles.pt}>Pick an icon</span>
            <button type="button" className={styles.px} onClick={onClose}><i className="fa-solid fa-xmark" /></button>
          </div>
          <div className={styles.popBody}>
            <input className={styles.in} value={q} onChange={e => setQ(e.target.value)}
              placeholder="Search icons — fire, shield, brain…" autoFocus />
            {(() => {
              const rows = ICONS.filter(i => !q.trim() || i.replace('fa-', '').replace(/-/g, ' ').includes(q.toLowerCase().trim()))
              return (<>
                <div className={styles.mono} style={{ margin: '-4px 0 10px' }}>{rows.length} of {ICONS.length} glyphs</div>
                <div className={styles.icongrid}>
                  {rows.length ? rows.map(i => (
                    <button key={i} type="button" className={cx(i === draft.icon && styles.on)} title={i.replace('fa-', '')}
                      onClick={() => { set({ icon: i }); onClose() }}><i className={`fa-solid ${i}`} /></button>
                  )) : <div className={styles.pkNone}>No glyph by that name.</div>}
                </div>
                <div className={styles.sec} style={{ marginTop: 14 }}><span className={styles.fieldLab}>Console palette</span></div>
                <div className={styles.swrow}>
                  {COLORS.map(c => (
                    <button key={c} type="button" title={c} style={{ ['--c' as string]: c }}
                      className={cx(c.toLowerCase() === (draft.color || DEFAULT_COLOR).toLowerCase() && styles.on)}
                      onClick={() => set({ color: c })}><span className={styles.d} /></button>
                  ))}
                </div>
              </>)
            })()}
          </div>
        </>)}

        {pop.k === 'thing' && (<>
          <div className={styles.popHead}>
            <i className="fa-solid fa-crosshairs" style={{ color: 'var(--beige)' }} />
            <span className={styles.pt}>Pick a thing</span>
            <button type="button" className={styles.px} onClick={onClose}><i className="fa-solid fa-xmark" /></button>
          </div>
          <div className={styles.popBody}>
            <input className={styles.in} value={q} onChange={e => setQ(e.target.value)}
              placeholder="Search the catalog by name…" autoFocus />
            <div className={styles.mono} style={{ margin: '-4px 0 10px' }}>One named entity. Names only — the id is what gets stored.</div>
            <div className={styles.pkList}>
              {(() => {
                const rows = nodes
                  .map(n => ({ n, meta: namesByGid.get(n.gid) }))
                  .filter(x => x.meta && (!q.trim() || x.meta.name.toLowerCase().includes(q.toLowerCase().trim())))
                  .slice(0, 60)
                if (!rows.length) return <div className={styles.pkNone}>Nothing in the catalog matches that.</div>
                return rows.map(({ n, meta }) => (
                  <button key={n.gid} type="button" className={styles.pkRow}
                    onClick={() => {
                      update(x => ({
                        ...x,
                        graph: (x.graph ?? []).map((g, j) => (j === pop.ei
                          ? { ...g, target: (g.target ?? []).map((t, k) => (k === pop.ti ? n.gid : t)) }
                          : g)),
                      }))
                      onClose()
                    }}>
                    <span className={styles.n}>{meta!.name}</span>
                    <span className={styles.tg}>{(n.tags ?? []).slice(0, 2).map(t => `tag:${normalizeTag(t)}`).join(' ')}</span>
                    <span className={styles.k}>{meta!.kind}</span>
                  </button>
                ))
              })()}
            </div>
          </div>
        </>)}

        {pop.k === 'help' && (<>
          <div className={styles.popHead}>
            <i className="fa-regular fa-circle-question" style={{ color: 'var(--cyan-hot)' }} />
            <span className={styles.pt}>{HELP[pop.which].t}</span>
            <button type="button" className={styles.px} onClick={onClose}><i className="fa-solid fa-xmark" /></button>
          </div>
          <div className={styles.popBody}>{HELP[pop.which].body}</div>
        </>)}

        {pop.k === 'idhelp' && (<>
          <div className={styles.popHead}>
            <i className="fa-solid fa-lock" style={{ color: 'var(--beige)' }} />
            <span className={styles.pt}>Why the id is fixed</span>
            <button type="button" className={styles.px} onClick={onClose}><i className="fa-solid fa-xmark" /></button>
          </div>
          <div className={styles.popBody}>
            <div className={styles.mono} style={{ lineHeight: 1.7 }}>
              The id is generated from the name <b>once</b>, when the feature is first saved, and never changes again — renaming the feature does not touch it.
              <br /><br />
              Other features target this one <b>by id</b>. If the id moved with the name, every effect, gate and reverse lookup pointing here would break silently.
            </div>
          </div>
        </>)}

        {pop.k === 'delete' && (<>
          <div className={styles.popHead}>
            <i className="fa-solid fa-triangle-exclamation" style={{ color: 'var(--danger-hot)' }} />
            <span className={styles.pt}>Delete feature</span>
            <button type="button" className={styles.px} onClick={onClose}><i className="fa-solid fa-xmark" /></button>
          </div>
          <div className={styles.popBody}>
            <div className={styles.mono} style={{ marginBottom: 6 }}>
              Deleting <b>{draft?.name || 'this feature'}</b> · <span style={{ color: 'var(--amber)' }}>{selId}</span> removes its tags, variables, effect nodes and gates. This cannot be undone.
            </div>
            {refs.length ? (
              <div className={styles.brk}>
                <div className={styles.bh}><i className="fa-solid fa-link-slash" /> {refs.length} reference{refs.length === 1 ? '' : 's'} will break</div>
                {refs.map((r, i) => <div key={i} className={styles.br}><span className={styles.n}>{r.name}</span><span className={styles.h}>{r.how}</span></div>)}
                <div className={styles.bf2}>These become dangling references — the audit will flag them on the features listed above.</div>
              </div>
            ) : <div className={styles.mono} style={{ color: 'var(--beige-dim)' }}>Nothing currently targets this feature — no references break.</div>}
            <div className={styles.btnrow}>
              <button type="button" className={cx(styles.btn, styles.danger)} style={{ height: 34 }} onClick={onDelete}>
                <span className={styles.bf} /><span className={styles.bi}><i className="fa-solid fa-trash" /> Delete{refs.length ? ' anyway' : ''}</span>
              </button>
              <button type="button" className={cx(styles.btn, styles.ghost)} style={{ height: 34 }} onClick={onClose}>
                <span className={styles.bf} /><span className={styles.bi}>Cancel</span>
              </button>
            </div>
          </div>
        </>)}

        {pop.k === 'revert' && (<>
          <div className={styles.popHead}>
            <i className="fa-solid fa-rotate-left" style={{ color: 'var(--amber)' }} />
            <span className={styles.pt}>Discard draft</span>
            <button type="button" className={styles.px} onClick={onClose}><i className="fa-solid fa-xmark" /></button>
          </div>
          <div className={styles.popBody}>
            <div className={styles.mono} style={{ marginBottom: 8 }}>
              {published
                ? <>Every unpublished edit to <b>{draft?.name}</b> is thrown away and the editor reloads the published version. Players never saw the draft, so nothing about their sheets changes.</>
                : <>This feature was never published — discarding the draft removes it entirely.</>}
            </div>
            <div className={styles.btnrow}>
              <button type="button" className={cx(styles.btn, styles.danger)} style={{ height: 34 }} onClick={onRevert}>
                <span className={styles.bf} /><span className={styles.bi}><i className="fa-solid fa-rotate-left" /> Discard draft</span>
              </button>
              <button type="button" className={cx(styles.btn, styles.ghost)} style={{ height: 34 }} onClick={onClose}>
                <span className={styles.bf} /><span className={styles.bi}>Keep editing</span>
              </button>
            </div>
          </div>
        </>)}

        {pop.k === 'folder' && (<>
          <div className={styles.popHead}>
            <i className="fa-solid fa-folder-plus" style={{ color: 'var(--amber)' }} />
            <span className={styles.pt}>New folder</span>
            <button type="button" className={styles.px} onClick={onClose}><i className="fa-solid fa-xmark" /></button>
          </div>
          <div className={styles.popBody}>
            <span className={styles.fieldLab}>Folder name</span>
            <input className={styles.in} value={q} onChange={e => setQ(e.target.value)} autoFocus
              placeholder="Warlock Pact…"
              onKeyDown={e => { if (e.key === 'Enter' && q.trim() && draft) { set({ folder: q.trim() }); onClose() } }} />
            <div className={styles.mono} style={{ marginBottom: 8, color: 'var(--beige-dim)' }}>
              Folders are derived from the features filed in them, so the new folder appears once this feature moves into it.
              {folders.length > 0 && <><br />In use: {folders.join(' · ')}</>}
            </div>
            <div className={styles.btnrow}>
              <button type="button" className={cx(styles.btn, styles.amber)} style={{ height: 34 }} disabled={!q.trim() || !draft}
                onClick={() => { if (q.trim() && draft) { set({ folder: q.trim() }); onClose() } }}>
                <span className={styles.bf} /><span className={styles.bi}><i className="fa-solid fa-check" /> Create folder</span>
              </button>
            </div>
          </div>
        </>)}
      </div>
    </div>
  )
}
