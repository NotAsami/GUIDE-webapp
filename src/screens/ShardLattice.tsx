import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useDmStatus, useDmFeatures, type DmFeaturesState } from '../lib/dm'
import { useDmShards, type EditorNode, type EditorTree } from '../lib/dmShards'
import { RING_GAP, branchColor, nodeXY } from '../lib/shards'
import { MOD_STATS, isAbility, compileEffects, effectsToMods, type Mod } from '../lib/modEditor'
import type { Feature, ItemEffects, ShardPerk } from '../lib/database.types'
import styles from './ShardLattice.module.css'

const ICONS = ['fa-gem', 'fa-hand-fist', 'fa-shield', 'fa-shield-heart', 'fa-heart-pulse', 'fa-droplet', 'fa-bolt', 'fa-anchor',
  'fa-hammer', 'fa-dumbbell', 'fa-explosion', 'fa-mountain', 'fa-angles-up', 'fa-arrows-rotate', 'fa-star', 'fa-fire',
  'fa-brain', 'fa-eye', 'fa-skull', 'fa-wave-square', 'fa-signal', 'fa-book-open']
const PALETTE = [
  { n: 'Beige', v: 'var(--beige)' }, { n: 'Amber', v: 'var(--amber)' }, { n: 'Cyan', v: 'var(--cyan)' },
  { n: 'Violet', v: 'var(--violet)' }, { n: 'Ember', v: 'var(--danger-hot)' }, { n: 'Green', v: 'var(--good)' },
]
type Tool = 'select' | 'add' | 'link'
type Mode = 'author' | 'preview'

/** Every .prose textarea in this editor sits inside the Node Inspector's own
 *  scrollable panel (.rScroll) — and something about that nesting makes the
 *  browser hand mouse-wheel input to the PANEL instead of the textarea under
 *  the cursor: confirmed live, the textarea's own scrollTop never moved in
 *  EITHER direction while the whole sidebar scrolled instead, on every
 *  .prose field tested (not just the auto-grown DM Note ones — a plain
 *  resize:vertical textarea with overflowing content did the identical
 *  thing). Taking the wheel by hand — scroll the textarea, stop the event
 *  before it reaches the panel, but only while the textarea still has room
 *  to move, so chaining to the panel still works normally at the boundary —
 *  fixes it, EXCEPT as a React `onWheel` prop: React attaches wheel/touch
 *  listeners passively by default, so `preventDefault()` there is a silent
 *  no-op (confirmed live too — the handler ran, scrollTop still never
 *  moved). Has to be a real `addEventListener('wheel', fn, {passive:false})`
 *  on the DOM node instead, which is what this hook wires up. */
function useNoScrollChain() {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      // 110%-zoom subpixel rounding can make scrollHeight-clientHeight read as
      // 1-2px even when the field has no real overflow, which used to trip the
      // boundary check into thinking there was room to scroll — capturing the
      // event, moving scrollTop by that same 1-2px, then eating the rest of the
      // gesture instead of letting it chain to the panel. Below this tolerance,
      // don't intercept at all.
      const range = el.scrollHeight - el.clientHeight
      if (range <= 2) return
      const atTop = e.deltaY < 0 && el.scrollTop <= 0
      const atBottom = e.deltaY > 0 && el.scrollTop >= range
      if (atTop || atBottom) return
      el.scrollTop += e.deltaY
      e.stopPropagation()
      e.preventDefault()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])
  return ref
}

/** Auto-grows a textarea to fit its content (up to the CSS `max-height` cap,
 *  where `.prose`'s `overflow-y: auto` takes over) — so the DM Note field is
 *  only scrollable when the text genuinely overflows the cap, not by default
 *  just because it's a fixed-height box. The inline `height` is clamped to
 *  that same max-height in JS rather than left at the full (uncapped)
 *  scrollHeight for CSS to visually clip alone — keeps the element's real
 *  size matching what's rendered instead of relying on max-height to paper
 *  over a much taller box. Also wires up useNoScrollChain's wheel fix on the
 *  same ref/element, since every DM Note field needs both. */
function useAutoGrow(value: string) {
  const ref = useNoScrollChain()
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    const cap = parseFloat(getComputedStyle(el).maxHeight)
    const target = Number.isFinite(cap) ? Math.min(el.scrollHeight, cap) : el.scrollHeight
    el.style.height = `${target}px`
  }, [value])
  return ref
}
type AuditSev = 'err' | 'warn' | 'ok'
type AuditItem = { sev: AuditSev; id: string | null; t: string; s: string }

/** Lattice audit — a direct port of shard-lattice.js's audit(): orphan nodes,
 *  unreachable branches, dangling/inward-flow links, ring overlaps, a free-node
 *  warning, and a total-cost-vs-capacity sanity check. */
function audit(tree: EditorTree): AuditItem[] {
  const out: AuditItem[] = []
  const byId = (id: string) => tree.nodes.find(n => n.id === id)
  const roots = tree.nodes.filter(n => n.tier === 0).map(n => n.id)
  const reach = new Set(roots)
  let grew = true
  while (grew) {
    grew = false
    for (const n of tree.nodes) {
      if (!reach.has(n.id) && n.prereqs.length && n.prereqs.every(p => reach.has(p))) { reach.add(n.id); grew = true }
    }
  }
  for (const n of tree.nodes) {
    if (n.tier === 0) continue
    if (!n.prereqs.length) out.push({ sev: 'err', id: n.id, t: 'Orphan node', s: `${n.name} has no prerequisite — a player can never reach it.` })
    else if (!reach.has(n.id)) out.push({ sev: 'err', id: n.id, t: 'Unreachable', s: `${n.name} chains to a node that never resolves back to the core.` })
    for (const p of n.prereqs) {
      const pn = byId(p)
      if (!pn) out.push({ sev: 'err', id: n.id, t: 'Dangling link', s: `${n.name} requires a node that no longer exists.` })
      else if (pn.tier >= n.tier) out.push({ sev: 'warn', id: n.id, t: 'Inward flow', s: `${n.name} (T${n.tier}) requires ${pn.name} (T${pn.tier}). Prereqs should sit further in.` })
    }
    if (n.cost === 0 && !n.concealed) out.push({ sev: 'warn', id: n.id, t: 'Free node', s: `${n.name} costs nothing — it will auto-attune the instant its prereqs resolve.` })
  }
  for (let i = 0; i < tree.nodes.length; i++) {
    for (let j = i + 1; j < tree.nodes.length; j++) {
      const a = tree.nodes[i], b = tree.nodes[j]
      if (a.tier === b.tier && Math.abs(a.angle - b.angle) < 9) out.push({ sev: 'warn', id: b.id, t: 'Overlap', s: `${a.name} and ${b.name} sit on the same ring within 9°.` })
    }
  }
  const total = tree.nodes.reduce((s, n) => s + n.cost, 0)
  if (total > tree.capacity * 2.2) out.push({ sev: 'warn', id: null, t: 'Cost ceiling', s: `Total cost ${total} against capacity ${tree.capacity} — most of this tree is unreachable in a campaign.` })
  if (!out.length) out.push({ sev: 'ok', id: null, t: 'Lattice valid', s: 'All nodes resolve to the core. Safe to publish.' })
  return out
}

function createsCycle(nodes: EditorNode[], parent: string, child: string): boolean {
  const seen = new Set<string>()
  const walk = (id: string): boolean => {
    if (id === child) return true
    if (seen.has(id)) return false
    seen.add(id)
    const n = nodes.find(x => x.id === id)
    return n ? n.prereqs.some(walk) : false
  }
  return walk(parent)
}

/** Shard Lattice Editor — the DM graph editor, ported from
 *  "G.U.I.D.E. Shard Lattice Editor.html" + shard-lattice.js. Standalone
 *  operator surface (amber skin), like /dm — not under the player Layout.
 *  Everything renders from `draft` (lib/dmShards.ts EditorTree, the merged
 *  catalog+secrets working copy); Save Draft / Publish split it back apart. */
export function ShardLattice() {
  const { session, loading: authLoading } = useAuth()
  const { isDm, loading: dmLoading } = useDmStatus()
  const nav = useNavigate()
  const { trees, loading, error, saveTree, publishTree, createTree, deleteTree } = useDmShards()
  const featureLib = useDmFeatures()

  const [activeId, setActiveId] = useState<string | null>(null)
  const [draft, setDraft] = useState<EditorTree | null>(null)
  const [tab, setTab] = useState<'shard' | 'node'>('shard')
  const [tool, setTool] = useState<Tool>('select')
  const [selId, setSelId] = useState<string | null>(null)
  const [selEdge, setSelEdge] = useState<string | null>(null)
  const [linkSrc, setLinkSrc] = useState<string | null>(null)
  const [snap, setSnap] = useState(true)
  const [rings, setRings] = useState(4)
  const [mode, setMode] = useState<Mode>('author')
  const [sim, setSim] = useState<Set<string> | null>(null)
  const [simPts, setSimPts] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [grabbing, setGrabbing] = useState(false)
  const [toast, setToast] = useState<{ msg: string; warn?: boolean } | null>(null)
  const [saving, setSaving] = useState(false)

  const stageRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef({ dragging: false, moved: false, sx: 0, sy: 0, spx: 0, spy: 0 })
  const nodeDragRef = useRef<{ id: string } | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)

  useEffect(() => { if (!activeId && trees.length) setActiveId(trees[0].id) }, [trees, activeId])
  useEffect(() => {
    const t = trees.find(x => x.id === activeId)
    if (t) {
      setDraft(t)
      setRings(Math.max(3, Math.max(0, ...t.nodes.map(n => n.tier)) + 1))
      setSelId(null); setSelEdge(null); setLinkSrc(null); setTab('shard'); setTool('select'); setMode('author')
    }
  }, [activeId, trees])

  const dirty = useMemo(() => {
    const saved = trees.find(t => t.id === activeId)
    return !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved)
  }, [draft, trees, activeId])

  function fireToast(msg: string, warn?: boolean) {
    window.clearTimeout(toastTimer.current)
    setToast({ msg, warn })
    toastTimer.current = window.setTimeout(() => setToast(null), 2200)
  }

  function updateDraft(fn: (t: EditorTree) => EditorTree) {
    setDraft(prev => (prev ? fn(prev) : prev))
  }

  const byId = useCallback((id: string) => draft?.nodes.find(n => n.id === id), [draft])
  const isRoot = useCallback((n: EditorNode) => !n.prereqs.length && !draft?.nodes.some(x => x.prereqs.includes(n.id) && x.tier === 0), [draft])

  /* ---------- geometry ---------- */
  const canvasR = RING_GAP * rings + 130
  const canvasSz = canvasR * 2
  const pos = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>()
    for (const n of draft?.nodes ?? []) { const p = nodeXY(n, RING_GAP); m.set(n.id, { x: canvasR + p.x, y: canvasR + p.y }) }
    return m
  }, [draft, canvasR])
  function polar(x: number, y: number) {
    const dx = x - canvasR, dy = y - canvasR
    return { r: Math.hypot(dx, dy), deg: (((Math.atan2(dx, -dy) * 180) / Math.PI) + 540) % 360 - 180 }
  }
  const edges = useMemo(() => (draft?.nodes ?? []).flatMap(n => n.prereqs.map(p => ({ key: `${p}__${n.id}`, parent: p, child: n.id }))), [draft])

  /* ---------- pan / zoom ---------- */
  const clampZoom = (z: number) => Math.max(0.28, Math.min(2.4, z))
  const fit = useCallback(() => {
    const stage = stageRef.current
    if (!stage) return
    const vw = stage.clientWidth, vh = stage.clientHeight
    if (!vw) return
    const z = clampZoom(Math.min(vw / canvasSz, vh / canvasSz) * 0.98)
    setZoom(z); setPan({ x: (vw - canvasSz * z) / 2, y: (vh - canvasSz * z) / 2 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasSz])
  useLayoutEffect(() => { fit(); window.addEventListener('resize', fit); return () => window.removeEventListener('resize', fit) }, [fit, activeId])

  function zoomAt(factor: number, ox: number, oy: number) {
    setZoom(z => {
      const nz = clampZoom(z * factor)
      const wx = (ox - pan.x) / z, wy = (oy - pan.y) / z
      setPan({ x: ox - wx * nz, y: oy - wy * nz })
      return nz
    })
  }
  function onWheel(e: React.WheelEvent) {
    e.preventDefault()
    const r = stageRef.current?.getBoundingClientRect()
    if (!r) return
    zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top)
  }
  function onPadPointerDown(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest('button')?.dataset.id) return // node drag handles itself
    dragRef.current = { dragging: true, moved: false, sx: e.clientX, sy: e.clientY, spx: pan.x, spy: pan.y }
  }
  useEffect(() => {
    function move(e: PointerEvent) {
      const d = dragRef.current
      if (!d.dragging) return
      const dx = e.clientX - d.sx, dy = e.clientY - d.sy
      if (!d.moved && Math.hypot(dx, dy) > 4) { d.moved = true; setGrabbing(true) }
      if (d.moved) setPan({ x: d.spx + dx, y: d.spy + dy })
    }
    function up() { dragRef.current.dragging = false; dragRef.current.moved = false; setGrabbing(false) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
  }, [])

  /* ---------- node drag-to-retier ---------- */
  function onNodePointerDown(e: React.PointerEvent, n: EditorNode) {
    if (mode === 'preview' || tool !== 'select') return
    e.stopPropagation()
    nodeDragRef.current = { id: n.id }
    setSelId(n.id); setTab('node'); setSelEdge(null)
    function move(ev: PointerEvent) {
      const r = stageRef.current?.getBoundingClientRect()
      if (!r) return
      const wx = (ev.clientX - r.left - pan.x) / zoom, wy = (ev.clientY - r.top - pan.y) / zoom
      const pol = polar(wx, wy)
      let tier = Math.round(pol.r / RING_GAP)
      tier = Math.max(isRoot(n) ? 0 : 1, Math.min(rings, tier))
      const deg = snap ? Math.round(pol.deg / 15) * 15 : Math.round(pol.deg)
      updateDraft(t => ({ ...t, nodes: t.nodes.map(x => (x.id === n.id ? { ...x, tier, angle: deg } : x)) }))
    }
    function up() { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); nodeDragRef.current = null }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }

  /* ---------- linking ---------- */
  function linkClick(n: EditorNode) {
    if (!linkSrc) { setLinkSrc(n.id); fireToast(`Link from ${n.name} — pick the node it unlocks`); return }
    if (linkSrc === n.id) { setLinkSrc(null); return }
    const src = linkSrc
    if (n.prereqs.includes(src)) { fireToast('Link already exists', true); setLinkSrc(null); return }
    if (!draft || createsCycle(draft.nodes, src, n.id)) { fireToast('Refused — that link creates a loop', true); setLinkSrc(null); return }
    updateDraft(t => ({ ...t, nodes: t.nodes.map(x => (x.id === n.id ? { ...x, prereqs: [...x.prereqs, src] } : x)) }))
    setLinkSrc(null); setSelId(n.id)
    fireToast(`${byId(src)?.name} → ${n.name}`)
  }

  /* ---------- add / delete ---------- */
  function addNodeAt(wx: number, wy: number) {
    if (!draft) return
    const pol = polar(wx, wy)
    const tier = Math.max(1, Math.min(rings, Math.round(pol.r / RING_GAP)))
    const deg = snap ? Math.round(pol.deg / 15) * 15 : Math.round(pol.deg)
    const keys = Object.keys(draft.branches).filter(k => k !== 'core')
    let i = 1; while (byId(`node${i}`)) i++
    const branch = keys[0] || 'core'
    const n: EditorNode = { id: `node${i}`, name: 'New Node', tier, branch, angle: deg, cost: 1, icon: 'fa-star', prereqs: [], effect: '' }
    const inner = draft.nodes.filter(x => x.tier < tier)
    if (inner.length) {
      const p = { x: canvasR + nodeXY(n, RING_GAP).x, y: canvasR + nodeXY(n, RING_GAP).y }
      inner.sort((a, b) => {
        const A = pos.get(a.id)!, B = pos.get(b.id)!
        return Math.hypot(A.x - p.x, A.y - p.y) - Math.hypot(B.x - p.x, B.y - p.y)
      })
      n.prereqs = [inner[0].id]
      n.branch = inner[0].branch === 'core' ? branch : inner[0].branch
    }
    updateDraft(t => ({ ...t, nodes: [...t.nodes, n] }))
    setSelId(n.id); setTab('node'); setTool('select')
  }

  function deleteSel() {
    if (selEdge) {
      const [p, c] = selEdge.split('__')
      updateDraft(t => ({ ...t, nodes: t.nodes.map(n => (n.id === c ? { ...n, prereqs: n.prereqs.filter(x => x !== p) } : n)) }))
      setSelEdge(null); fireToast('Link removed'); return
    }
    if (!selId) return
    const n = byId(selId)
    if (!n) return
    if (n.tier === 0) { fireToast('The core cannot be deleted', true); return }
    updateDraft(t => ({ ...t, nodes: t.nodes.filter(x => x.id !== n.id).map(x => ({ ...x, prereqs: x.prereqs.filter(p => p !== n.id) })) }))
    setSelId(null); fireToast(`${n.name} deleted`)
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA' || (e.target as HTMLElement)?.tagName === 'SELECT') return
      if (e.key === 'v' || e.key === 'V') setTool('select')
      if (e.key === 'n' || e.key === 'N') setTool('add')
      if (e.key === 'l' || e.key === 'L') setTool('link')
      if (e.key === 'Backspace' || e.key === 'Delete') deleteSel()
      if (e.key === 'Escape') { setSelId(null); setSelEdge(null); setLinkSrc(null) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selId, selEdge, draft])

  /* ---------- player preview simulation ---------- */
  function resetSim() {
    if (!draft) return
    setSim(new Set(draft.nodes.filter(n => n.tier === 0).map(n => n.id)))
    setSimPts(draft.capacity)
  }
  useEffect(() => { if (mode === 'preview') resetSim() // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, activeId])
  function canAttune(n: EditorNode) { return !!sim && !sim.has(n.id) && n.prereqs.length > 0 && n.prereqs.every(p => sim!.has(p)) }
  function previewClick(n: EditorNode) {
    if (!sim) return
    if (sim.has(n.id)) return
    if (!canAttune(n)) { fireToast('Locked — prerequisites unmet', true); return }
    if (simPts < n.cost) { fireToast('Insufficient attunement in sim', true); return }
    setSim(new Set([...sim, n.id])); setSimPts(p => p - n.cost)
  }

  /* ---------- save / publish / revert ---------- */
  async function onSaveDraft() { if (!draft) return; setSaving(true); await saveTree(draft); setSaving(false); fireToast('Draft saved') }
  async function onPublish() {
    if (!draft) return
    if (audit(draft).some(a => a.sev === 'err')) { fireToast('Blocking issues — cannot publish', true); return }
    setSaving(true); await publishTree(draft); setSaving(false); fireToast('Published — live for the party')
  }
  function onRevert() { const saved = trees.find(t => t.id === activeId); if (saved) setDraft(saved) }
  async function onNewShard() { const t = await createTree(); if (t) setActiveId(t.id) }
  async function onDeleteShard() {
    if (!draft) return
    await deleteTree(draft.id)
    setActiveId(null)
  }

  if (authLoading || dmLoading) return <Boot>Authorizing operator link…</Boot>
  if (!session) return <Navigate to="/login" replace />
  if (!isDm) return <Navigate to="/" replace />

  const auditList = draft ? audit(draft) : []
  const errs = auditList.filter(a => a.sev === 'err').length
  const warns = auditList.filter(a => a.sev === 'warn').length
  const totalCost = draft?.nodes.reduce((s, n) => s + n.cost, 0) ?? 0
  const selNode = selId ? byId(selId) : null

  return (
    <div className={styles.page}>
      <div className={styles.stage} />
      <header className={styles.opbar}>
        <div className={styles.opSigil}><i className="fa-solid fa-diamond" /></div>
        <div className={styles.opId}>
          <div className={styles.opTitle}>Operator<span className={styles.slash}>//</span>Shard Lattice Editor</div>
          <div className={styles.opSub}>Catalog <span className={styles.sep}>·</span> <span className={styles.acc}>Shards</span> <span className={styles.sep}>·</span> Authoring</div>
        </div>
        <div className={styles.opRight}>
          <div className={styles.opStat}><span className={styles.v}>{draft?.nodes.length ?? 0}</span><span className={styles.l}>Nodes</span></div>
          <div className={styles.opStat}><span className={`${styles.v} ${styles.cyan}`}>{totalCost}</span><span className={styles.l}>Total Cost</span></div>
          <div className={styles.opStat}><span className={`${styles.v}${errs ? ' ' + styles.warn : ''}`}>{errs + warns}</span><span className={styles.l}>Issues</span></div>
          <div className={styles.opRootpill}><span className={styles.dot} /> Root · Architect</div>
          <button type="button" className={styles.opBack} onClick={() => nav('/dm')}><i className="fa-solid fa-arrow-left-long" /> Console</button>
        </div>
      </header>

      <div className={styles.editor}>
        {/* 01 — LIBRARY + AUDIT */}
        <section className={styles.region}>
          <div className={styles.frame} /><div className={styles.inner}>
            <span className={`${styles.rCorner} ${styles.tl}`} /><span className={`${styles.rCorner} ${styles.br}`} />
            <div className={styles.rHead}><span className={styles.rhNum}>01</span><span className={styles.rhTitle}>Shard Library</span><span className={styles.rhMeta}><span className={styles.acc}>{trees.length}</span> Trees</span></div>
            <div className={styles.rScroll}>
              <div className={styles.lib}>
                {trees.map(t => (
                  <button key={t.id} type="button" className={`${styles.libRow} ${t.id === activeId ? styles.sel : ''}`} onClick={() => setActiveId(t.id)}>
                    <span className={styles.lrIc}><span className={styles.lrIcFrame} /><span className={styles.lrIcInner}><i className={`fa-solid ${t.icon}`} /></span></span>
                    <span className={styles.lrTx}>
                      <span className={styles.lrT}>{t.name}</span>
                      <span className={styles.lrS}>{t.nodes.length} nodes · {t.rarity}</span>
                    </span>
                    <span className={`${styles.lrPub} ${t.published ? '' : styles.draft}`} title={t.published ? 'Published' : 'Draft'} />
                  </button>
                ))}
              </div>
              <div className={styles.libNew}>
                <button type="button" className={`${styles.btn} ${styles.ghost}`} onClick={onNewShard}><span className={styles.bf} /><span className={styles.bi}><i className="fa-solid fa-plus" /> New Shard Tree</span></button>
              </div>
              <div className={styles.auditHead}><span className={styles.t}>Lattice Audit</span><span className={styles.n}>{errs + warns ? `${errs} err · ${warns} warn` : 'clean'}</span></div>
              <div className={styles.audit}>
                {auditList.map((a, i) => (
                  <div key={i} className={`${styles.auditItem} ${styles[a.sev]}`} onClick={() => { if (a.id) { setSelId(a.id); setSelEdge(null); setTab('node') } }}>
                    <i className={`fa-solid ${a.sev === 'err' ? 'fa-circle-exclamation' : a.sev === 'warn' ? 'fa-triangle-exclamation' : 'fa-circle-check'}`} />
                    <span className={styles.aiTx}><span className={styles.aiT}>{a.t}</span><span className={styles.aiS}>{a.s}</span></span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* 02 — CANVAS */}
        <section className={styles.region}>
          <div className={styles.frame} /><div className={`${styles.inner} ${styles.canvasInner}`}>
            <span className={`${styles.rCorner} ${styles.tl}`} /><span className={`${styles.rCorner} ${styles.br}`} />
            {!draft ? <div className={styles.inspEmpty}>{loading ? 'Loading…' : 'No shard trees yet.'}</div> : (
              <>
                <div className={styles.tools}>
                  <div className={styles.toolGroup}>
                    <button type="button" className={`${styles.tool} ${tool === 'select' ? styles.on : ''}`} onClick={() => setTool('select')}><i className="fa-solid fa-arrow-pointer" /> <span className={styles.lbl}>Move</span> <span className={styles.kbd}>V</span></button>
                    <button type="button" className={`${styles.tool} ${tool === 'add' ? styles.on : ''}`} onClick={() => setTool('add')}><i className="fa-solid fa-plus" /> <span className={styles.lbl}>Node</span> <span className={styles.kbd}>N</span></button>
                    <button type="button" className={`${styles.tool} ${tool === 'link' ? styles.on : ''}`} onClick={() => { setTool('link'); setLinkSrc(null) }}><i className="fa-solid fa-link" /> <span className={styles.lbl}>Link</span> <span className={styles.kbd}>L</span></button>
                    <span className={styles.toolDiv} />
                    <button type="button" className={`${styles.tool} ${snap ? styles.on : ''}`} onClick={() => setSnap(s => !s)}><i className="fa-solid fa-bullseye" /> <span className={styles.lbl}>Snap 15°</span></button>
                    <button type="button" className={styles.tool} onClick={() => setRings(r => Math.max(1, r - 1))}><i className="fa-solid fa-circle-minus" /></button>
                    <button type="button" className={styles.tool} onClick={() => setRings(r => Math.min(10, r + 1))}><i className="fa-solid fa-circle-plus" /> <span className={styles.lbl}>Ring</span></button>
                    <span className={styles.toolDiv} />
                    <button type="button" className={`${styles.tool} ${styles.danger}`} onClick={deleteSel}><i className="fa-solid fa-trash" /> <span className={styles.lbl}>Delete</span> <span className={styles.kbd}>⌫</span></button>
                  </div>
                  <div className={styles.modeSeg}>
                    <button type="button" className={mode === 'author' ? styles.on : ''} onClick={() => setMode('author')}><i className="fa-solid fa-pen-ruler" /> <span className={styles.lbl}>Author</span></button>
                    <button type="button" className={mode === 'preview' ? `${styles.on} ${styles.play}` : ''} onClick={() => setMode('preview')}><i className="fa-solid fa-eye" /> <span className={styles.lbl}>Player Preview</span></button>
                  </div>
                </div>

                <div className={styles.pad}>
                  <div
                    ref={stageRef}
                    className={`${styles.latStage} ${grabbing ? styles.grabbing : tool === 'link' ? styles.linking : tool === 'add' ? styles.adding : ''}`}
                    onWheel={onWheel}
                    onPointerDown={onPadPointerDown}
                    onClick={e => { if (tool === 'add' && stageRef.current) {
                      const r = stageRef.current.getBoundingClientRect()
                      addNodeAt((e.clientX - r.left - pan.x) / zoom, (e.clientY - r.top - pan.y) / zoom)
                    } }}
                  >
                    <div className={`${styles.latCanvas} ${mode === 'preview' ? styles.preview : ''}`} style={{ width: canvasSz, height: canvasSz, transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})` }}>
                      <svg className={styles.latSvg} viewBox={`0 0 ${canvasSz} ${canvasSz}`} width={canvasSz} height={canvasSz} aria-hidden="true">
                        {Array.from({ length: rings }, (_, i) => i + 1).map(t => (
                          <g key={t}>
                            <circle className={styles.ringGuide} cx={canvasR} cy={canvasR} r={RING_GAP * t} />
                            {mode === 'author' && <text className={styles.ringTag} x={canvasR + 6} y={canvasR - RING_GAP * t + 14}>T{t}</text>}
                          </g>
                        ))}
                        {mode === 'author' && snap && Array.from({ length: 24 }, (_, i) => i * 15).map(a => {
                          const rad = (a * Math.PI) / 180, R = RING_GAP * rings
                          return <line key={a} className={styles.spokeGuide} x1={canvasR} y1={canvasR} x2={canvasR + R * Math.sin(rad)} y2={canvasR - R * Math.cos(rad)} />
                        })}
                        {edges.map(e => {
                          const pn = byId(e.parent), cn = byId(e.child)
                          const a = pos.get(e.parent), b = pos.get(e.child)
                          if (!pn || !cn || !a || !b) return null
                          let cls = styles.edge
                          if (mode === 'preview') cls += ` ${sim?.has(e.parent) && sim?.has(e.child) ? styles.live : sim?.has(e.parent) ? styles.open : styles.dim}`
                          else if (selEdge === e.key) cls += ` ${styles.sel}`
                          else if (pn.tier >= cn.tier) cls += ` ${styles.dead}`
                          const d = `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} L ${b.x.toFixed(1)} ${b.y.toFixed(1)}`
                          return (
                            <g key={e.key}>
                              <path className={cls} stroke={branchColor(draft, cn.branch)} d={d} />
                              {mode === 'author' && (
                                <path className={styles.edgeHit} d={d} onClick={ev => { ev.stopPropagation(); setSelEdge(e.key); setSelId(null); setTab('node') }} />
                              )}
                            </g>
                          )
                        })}
                        {mode === 'author' && linkSrc && (
                          <line className={styles.linkGhost} x1={pos.get(linkSrc)?.x} y1={pos.get(linkSrc)?.y} x2={pos.get(linkSrc)?.x} y2={pos.get(linkSrc)?.y} />
                        )}
                      </svg>

                      {draft.nodes.map(n => {
                        const p = pos.get(n.id)!
                        const previewState = mode === 'preview' ? (sim?.has(n.id) ? 'pAtt' : canAttune(n) ? 'pAvail' : 'pLocked') : ''
                        const cls = [
                          styles.nd, n.tier === 0 ? styles.core : '', n.branch === 'apex' ? styles.apex : '',
                          selId === n.id ? styles.sel : '', linkSrc === n.id ? styles.linksrc : '', previewState ? styles[previewState] : '',
                        ].filter(Boolean).join(' ')
                        const concealed = n.concealed && mode === 'preview' && !sim?.has(n.id)
                        return (
                          <button
                            key={n.id}
                            type="button"
                            data-id={n.id}
                            className={cls}
                            style={{ left: p.x, top: p.y, '--bc': branchColor(draft, n.branch) } as React.CSSProperties}
                            onPointerDown={e => onNodePointerDown(e, n)}
                            onClick={e => {
                              e.stopPropagation()
                              if (mode === 'preview') { previewClick(n); return }
                              if (tool === 'link') { linkClick(n); return }
                              if (tool === 'add') return
                              setSelId(n.id); setTab('node'); setSelEdge(null)
                            }}
                          >
                            <span className={styles.nf} />
                            <span className={styles.ni}><i className={`fa-solid ${concealed ? 'fa-question' : n.icon}`} /></span>
                            {(n.cost > 0 && !(mode === 'preview' && sim?.has(n.id))) && <span className={styles.ncost}>{n.cost}</span>}
                            {mode === 'author' && n.concealed && <span className={styles.nconceal}><i className="fa-solid fa-eye-slash" /></span>}
                            {mode === 'author' && <span className={styles.ntier}>T{n.tier}·{Math.round(n.angle)}°</span>}
                            {mode === 'author' && <span className={styles.nlab}>{n.name}</span>}
                          </button>
                        )
                      })}
                    </div>

                    {mode === 'preview' && (
                      <div className={styles.pvBanner}>
                        <i className="fa-solid fa-eye" /> <span className={styles.cap}>Player Preview — simulated, nothing saved</span>
                        <span className={styles.pts}>Attunement <b>{simPts}</b></span>
                        <button type="button" className={styles.reset} onClick={resetSim}>Reset Sim</button>
                      </div>
                    )}
                    <div className={styles.zoomers}>
                      <button type="button" onClick={() => zoomAt(1.25, (stageRef.current?.clientWidth ?? 0) / 2, (stageRef.current?.clientHeight ?? 0) / 2)}><i className="fa-solid fa-plus" /></button>
                      <button type="button" onClick={() => zoomAt(1 / 1.25, (stageRef.current?.clientWidth ?? 0) / 2, (stageRef.current?.clientHeight ?? 0) / 2)}><i className="fa-solid fa-minus" /></button>
                      <button type="button" onClick={fit}><i className="fa-solid fa-expand" /></button>
                    </div>
                    <span className={styles.canvasHint}>Drag node to re-tier · Drag empty space to pan · Scroll to zoom</span>
                  </div>
                </div>
              </>
            )}
          </div>
        </section>

        {/* 03 — INSPECTOR */}
        <section className={styles.region}>
          <div className={styles.frame} /><div className={styles.inner}>
            <span className={`${styles.rCorner} ${styles.tl}`} /><span className={`${styles.rCorner} ${styles.br}`} />
            <div className={styles.rHead}><span className={styles.rhNum}>03</span><span className={styles.rhTitle}>Node Inspector</span>
              <span className={styles.rhMeta}>{mode === 'preview' ? 'Player Read' : selEdge ? 'Link' : selNode ? `${draft?.branches[selNode.branch] ?? selNode.branch} · Tier ${selNode.tier}` : 'No Selection'}</span>
            </div>
            <div className={styles.rScroll}>
              <div className={styles.insp}>
                {!draft ? null : mode === 'preview' ? (
                  <PlayerRead tree={draft} node={selNode} sim={sim} canAttune={canAttune} />
                ) : (
                  <>
                    <div className={styles.itabs}>
                      <button type="button" className={tab === 'shard' && !selEdge ? styles.on : ''} onClick={() => { setTab('shard'); setSelEdge(null) }}><i className="fa-solid fa-gem" /> Shard</button>
                      <button type="button" className={tab === 'node' ? styles.on : ''} onClick={() => setTab('node')}><i className="fa-solid fa-circle-nodes" /> Node</button>
                    </div>
                    {selEdge ? (
                      <LinkInspector tree={draft} edgeKey={selEdge} onDelete={deleteSel} />
                    ) : tab === 'shard' ? (
                      <ShardInspector draft={draft} setDraft={setDraft} onDelete={onDeleteShard} fireToast={fireToast} featureLib={featureLib} />
                    ) : selNode ? (
                      <NodeInspector draft={draft} node={selNode} snap={snap} rings={rings} isRoot={isRoot} setDraft={setDraft} onDelete={deleteSel} featureLib={featureLib} />
                    ) : (
                      <div className={styles.inspEmpty}>
                        <div className={styles.icBig}><span className={styles.icBigFrame} /><span className={styles.icBigInner}><i className="fa-solid fa-diagram-project" /></span></div>
                        <div className={styles.t}>Select a node</div>
                        <div className={styles.d}>Or drop a new one onto a ring. Position is the data — the ring is the tier, the angle is the branch spoke.</div>
                        <div className={styles.k}><b>V</b> move &nbsp; <b>N</b> new node &nbsp; <b>L</b> link<br /><b>⌫</b> delete &nbsp; <b>Esc</b> deselect</div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>

      <footer className={styles.botbar}>
        <div className={`${styles.status} ${errs ? styles.bad : ''}`}><span className={styles.dot} /><span>{errs ? `${errs} blocking issue${errs > 1 ? 's' : ''} — publish disabled` : warns ? `${warns} warning${warns > 1 ? 's' : ''} — publishable` : 'Lattice valid'}</span></div>
        <span className={`${styles.dirty} ${dirty ? styles.on : ''}`}>● Unsaved changes</span>
        <span className={styles.tel}>Lattice Stream <span className={styles.sep}>::</span> Sandboxed <span className={styles.sep}>//</span> Party unaffected until publish</span>
        <div className={styles.acts}>
          <button type="button" className={`${styles.btn} ${styles.ghost}`} disabled={!dirty} onClick={onRevert}><span className={styles.bf} /><span className={styles.bi}><i className="fa-solid fa-rotate-left" /> Revert</span></button>
          <button type="button" className={`${styles.btn} ${styles.cyan}`} disabled={saving || !draft} onClick={onSaveDraft}><span className={styles.bf} /><span className={styles.bi}><i className="fa-solid fa-floppy-disk" /> Save Draft</span></button>
          <button type="button" className={`${styles.btn} ${styles.amber}`} disabled={saving || !draft || errs > 0} onClick={onPublish}><span className={styles.bf} /><span className={styles.bi}><i className="fa-solid fa-tower-broadcast" /> Publish</span></button>
        </div>
      </footer>

      {error && <div className={styles.canvasHint} style={{ position: 'fixed', bottom: 44, left: 12, color: 'var(--danger-hot)' }}>{error}</div>}
      {toast && <div className={`${styles.toastEl} ${styles.on} ${toast.warn ? styles.warn : ''}`}><i className="fa-solid fa-circle-check" /><span>{toast.msg}</span></div>}
      <div className={styles.scanlines} /><div className={styles.vignette} />
    </div>
  )
}

function Boot({ children }: { children: React.ReactNode }) {
  return <div className={styles.page} style={{ display: 'grid', placeItems: 'center', color: 'var(--amber)', fontFamily: 'var(--font-mono)', letterSpacing: '0.2em', textTransform: 'uppercase', fontSize: 12 }}>{children}</div>
}

/* ================= Shard tab ================= */
function ShardInspector({ draft, setDraft, onDelete, fireToast, featureLib }: {
  draft: EditorTree
  setDraft: React.Dispatch<React.SetStateAction<EditorTree | null>>
  onDelete: () => void
  fireToast: (msg: string, warn?: boolean) => void
  featureLib: DmFeaturesState
}) {
  const set = (fn: (t: EditorTree) => EditorTree) => setDraft(prev => (prev ? fn(prev) : prev))
  const dmRef = useAutoGrow(draft.dm ?? '')
  const flavorRef = useNoScrollChain()
  // Whole-tree delete cascades to shard_tree_secrets and has no undo — arm on
  // the first click, only the second (within the same tree selection) fires
  // it. Same two-step idiom as InventoryPopup's Drop confirm.
  const [confirmDelete, setConfirmDelete] = useState(false)
  useEffect(() => { setConfirmDelete(false) }, [draft.id])
  return (
    <>
      <div className={styles.imeta}><i className={`fa-solid ${draft.icon}`} /><span className={styles.t}>{draft.name}</span><span className={styles.s}>{draft.id}</span></div>
      <span className={styles.fieldLab}>Shard Name</span>
      <input className={styles.in} value={draft.name} onChange={e => set(t => ({ ...t, name: e.target.value }))} />
      <span className={styles.fieldLab}>Rarity</span>
      <select className={styles.in} value={draft.rarity} onChange={e => set(t => ({ ...t, rarity: e.target.value }))}>
        {['Common', 'Uncommon', 'Rare', 'Very Rare', 'Legendary', 'Artifact'].map(r => <option key={r}>{r}</option>)}
      </select>
      <span className={styles.fieldLab}>Module / Classification</span>
      <input className={styles.in} value={draft.module} onChange={e => set(t => ({ ...t, module: e.target.value }))} />
      <div className={styles.grid2}>
        <div><span className={styles.fieldLab}>Attunement Capacity</span>
          <div className={styles.stepper}>
            <button type="button" onClick={() => set(t => ({ ...t, capacity: Math.max(0, t.capacity - 1) }))}><i className="fa-solid fa-minus" /></button>
            <span className={styles.val}>{draft.capacity}<span className={styles.u}>pt</span></span>
            <button type="button" onClick={() => set(t => ({ ...t, capacity: Math.min(20, t.capacity + 1) }))}><i className="fa-solid fa-plus" /></button>
          </div>
        </div>
        <div><span className={styles.fieldLab}>Nodes / Total Cost</span>
          <div className={styles.stepper} style={{ pointerEvents: 'none' }}>
            <span className={styles.val}>{draft.nodes.length}<span className={styles.u}>n</span></span>
            <span className={styles.val}>{draft.nodes.reduce((s, n) => s + n.cost, 0)}<span className={styles.u}>pt</span></span>
          </div>
        </div>
      </div>
      <div className={styles.sec}><span className={styles.fieldLab}>Glyph</span></div>
      <div className={styles.icons}>
        {ICONS.map(i => <div key={i} className={`${styles.ic} ${i === draft.icon ? styles.sel : ''}`} onClick={() => set(t => ({ ...t, icon: i }))}><i className={`fa-solid ${i}`} /></div>)}
      </div>
      <div className={styles.sec}><span className={styles.fieldLab}>Flavour — read on slot</span></div>
      <textarea ref={flavorRef} className={styles.prose} placeholder="What the player reads the moment the shard seats…" value={draft.flavor ?? ''} onChange={e => set(t => ({ ...t, flavor: e.target.value }))} />

      <EffectsWidget mods={draft.baseMods ?? {}} onChange={mods => set(t => ({ ...t, baseMods: mods }))} label="Base Effects" note="Applied on slot · before any node" />
      <FeaturesWidget features={draft.baseFeatures ?? []} onChange={feats => set(t => ({ ...t, baseFeatures: feats }))} label="Base Features" note="While slotted" library={featureLib} />
      <PerksWidget perks={draft.basePerks ?? []} onChange={perks => set(t => ({ ...t, basePerks: perks }))} label="Base Perks" note="While slotted" />
      <DetailsWidget rows={draft.baseDetails ?? []} onChange={rows => set(t => ({ ...t, baseDetails: rows }))} label="Detail Rows" />

      <div className={styles.sec} style={{ marginTop: 14 }}><span className={styles.fieldLab}>Branch Spokes</span></div>
      {Object.entries(draft.branches).map(([k, v]) => {
        const cnt = draft.nodes.filter(n => n.branch === k).length
        const color = draft.branchColors?.[k] ?? branchColor(draft, k)
        return (
          <div key={k} className={styles.spoke} style={{ '--sc': color } as React.CSSProperties}>
            <span className={styles.sd} />
            <input className={styles.snIn} value={v} onChange={e => set(t => ({ ...t, branches: { ...t.branches, [k]: e.target.value } }))} />
            <span className={styles.swSet}>
              {PALETTE.map(p => (
                <button key={p.n} type="button" className={`${styles.swt}${color === p.v ? ' ' + styles.on : ''}`} style={{ '--pc': p.v } as React.CSSProperties} title={p.n}
                  onClick={() => set(t => ({ ...t, branchColors: { ...t.branchColors, [k]: p.v } }))} />
              ))}
            </span>
            <span className={styles.sc}>{cnt}</span>
            {k === 'core' ? <i className={`fa-solid fa-lock ${styles.dx}`} style={{ cursor: 'default' }} title="Core spoke — cannot be removed" /> : (
              <i className={`fa-solid fa-xmark ${styles.dx}`} title={cnt ? `Remove branch (${cnt} nodes reassigned)` : 'Remove branch'} onClick={() => {
                const keys = Object.keys(draft.branches).filter(x => x !== k)
                if (!keys.length) { fireToast('A tree needs at least one branch', true); return }
                const fallback = keys.includes('core') && keys.length > 1 ? keys.find(x => x !== 'core')! : keys[0]
                set(t => ({
                  ...t,
                  nodes: t.nodes.map(n => (n.branch === k ? { ...n, branch: fallback } : n)),
                  branches: Object.fromEntries(Object.entries(t.branches).filter(([bk]) => bk !== k)),
                }))
                fireToast('Branch removed')
              }} />
            )}
          </div>
        )
      })}
      <NewBranchRow draft={draft} set={set} />
      <div className={styles.wgtEmpty} style={{ margin: '8px 0 12px' }}>Spokes are the tree&rsquo;s radial identity — colour carries into the player view. Removing one reassigns its nodes to the first remaining branch.</div>

      <div className={styles.sec}><span className={styles.fieldLab}>DM Note — never shown</span></div>
      <textarea ref={dmRef} className={`${styles.prose} ${styles.dm}`} placeholder="// operator only" value={draft.dm ?? ''} onChange={e => set(t => ({ ...t, dm: e.target.value }))} />

      <div className={styles.btnrow}>
        {confirmDelete ? (
          <button type="button" className={`${styles.btn} ${styles.danger}`} onClick={onDelete}><span className={styles.bf} /><span className={styles.bi}><i className="fa-solid fa-trash" /> Confirm Delete?</span></button>
        ) : (
          <button type="button" className={`${styles.btn} ${styles.danger}`} onClick={() => setConfirmDelete(true)}><span className={styles.bf} /><span className={styles.bi}><i className="fa-solid fa-trash" /> Delete</span></button>
        )}
      </div>
    </>
  )
}

function NewBranchRow({ draft, set }: { draft: EditorTree; set: (fn: (t: EditorTree) => EditorTree) => void }) {
  const [val, setVal] = useState('')
  function add() {
    const label = val.trim() || 'New Branch'
    let key = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'branch'
    let i = 2; const base = key
    while (draft.branches[key]) key = `${base}_${i++}`
    const used = new Set(Object.keys(draft.branches).map(k => draft.branchColors?.[k] ?? branchColor(draft, k)))
    const color = PALETTE.find(p => !used.has(p.v))?.v ?? PALETTE[Object.keys(draft.branches).length % PALETTE.length].v
    set(t => ({ ...t, branches: { ...t.branches, [key]: label }, branchColors: { ...t.branchColors, [key]: color } }))
    setVal('')
  }
  return (
    <div className={styles.dtlNew} style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
      <input placeholder="New branch name…" value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }} />
      <button type="button" className={styles.wgtBtn} onClick={add}><i className="fa-solid fa-plus" /> Add Branch</button>
    </div>
  )
}

/* ================= Node tab ================= */
function NodeInspector({ draft, node, snap, rings, isRoot, setDraft, onDelete, featureLib }: {
  draft: EditorTree; node: EditorNode; snap: boolean; rings: number
  isRoot: (n: EditorNode) => boolean
  setDraft: React.Dispatch<React.SetStateAction<EditorTree | null>>
  onDelete: () => void
  featureLib: DmFeaturesState
}) {
  const set = (fn: (t: EditorTree) => EditorTree) => setDraft(prev => (prev ? fn(prev) : prev))
  const setNode = (patch: Partial<EditorNode>) => set(t => ({ ...t, nodes: t.nodes.map(n => (n.id === node.id ? { ...n, ...patch } : n)) }))
  const dmRef = useAutoGrow(node.dm ?? '')
  const effectRef = useNoScrollChain()

  return (
    <>
      <div className={styles.imeta}><i className={`fa-solid ${node.icon}`} /><span className={styles.t}>{node.name}</span><span className={styles.s}>{node.id}</span></div>
      <span className={styles.fieldLab}>Node Name</span>
      <input className={styles.in} value={node.name} onChange={e => setNode({ name: e.target.value })} />
      <div className={styles.grid2}>
        <div><span className={styles.fieldLab}>Branch</span>
          <select className={styles.in} value={node.branch} onChange={e => setNode({ branch: e.target.value })}>
            {Object.entries(draft.branches).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div><span className={styles.fieldLab}>Angle</span>
          <input className={styles.in} type="number" step={snap ? 15 : 1} value={Math.round(node.angle)} onChange={e => setNode({ angle: Number(e.target.value) || 0 })} />
        </div>
      </div>
      <div className={styles.grid2}>
        <div><span className={styles.fieldLab}>Tier / Ring</span>
          <div className={styles.stepper}>
            <button type="button" onClick={() => setNode({ tier: Math.max(isRoot(node) ? 0 : 1, node.tier - 1) })}><i className="fa-solid fa-minus" /></button>
            <span className={styles.val}>{node.tier}</span>
            <button type="button" onClick={() => setNode({ tier: Math.min(rings, node.tier + 1) })}><i className="fa-solid fa-plus" /></button>
          </div>
        </div>
        <div><span className={styles.fieldLab}>Attunement Cost</span>
          <div className={styles.stepper}>
            <button type="button" onClick={() => setNode({ cost: Math.max(0, node.cost - 1) })}><i className="fa-solid fa-minus" /></button>
            <span className={styles.val}>{node.cost}<span className={styles.u}>pt</span></span>
            <button type="button" onClick={() => setNode({ cost: Math.min(9, node.cost + 1) })}><i className="fa-solid fa-plus" /></button>
          </div>
        </div>
      </div>
      <div className={styles.sec}><span className={styles.fieldLab}>Glyph</span></div>
      <div className={styles.icons}>
        {ICONS.map(i => <div key={i} className={`${styles.ic} ${i === node.icon ? styles.sel : ''}`} onClick={() => setNode({ icon: i })}><i className={`fa-solid ${i}`} /></div>)}
      </div>
      <div className={styles.sec}><span className={styles.fieldLab}>Prerequisites</span></div>
      <div className={styles.chips}>
        {node.prereqs.length ? node.prereqs.map(p => {
          const pn = draft.nodes.find(x => x.id === p)
          return <span key={p} className={styles.chip}>{pn ? pn.name : `${p} (missing)`}<i className={`fa-solid fa-xmark ${styles.x}`} onClick={() => setNode({ prereqs: node.prereqs.filter(x => x !== p) })} /></span>
        }) : (node.tier === 0 ? <span className={styles.chip}>Root node</span> : <span className={`${styles.chip} ${styles.none}`}><i className="fa-solid fa-circle-exclamation" /> Orphan — unreachable</span>)}
      </div>
      {node.tier !== 0 && (
        <select className={styles.in} value="" onChange={e => {
          if (!e.target.value) return
          if (createsCycle(draft.nodes, e.target.value, node.id)) return
          setNode({ prereqs: [...node.prereqs, e.target.value] })
        }}>
          <option value="">+ Add prerequisite…</option>
          {draft.nodes.filter(x => x.id !== node.id && !node.prereqs.includes(x.id)).map(x => <option key={x.id} value={x.id}>{x.name} · T{x.tier}</option>)}
        </select>
      )}
      <div className={styles.sec}><span className={styles.fieldLab}>Player-Facing Effect</span></div>
      <textarea ref={effectRef} className={styles.prose} placeholder="What the player reads in the node detail panel…" value={node.effect} onChange={e => setNode({ effect: e.target.value })} />

      <div className={`${styles.tog} ${node.concealed ? styles.on : ''}`} onClick={() => setNode({ concealed: !node.concealed })}>
        <span className={styles.sw} /><span className={styles.tl}><span className={styles.t}>Concealed</span><span className={styles.s}>Renders as ??? until its prereqs resolve</span></span>
      </div>

      <EffectsWidget mods={node.mods ?? {}} onChange={mods => setNode({ mods })} label="Effects Granted" note="Applied while attuned" />
      <FeaturesWidget features={node.features ?? []} onChange={feats => setNode({ features: feats })} label="Features Granted" note="While attuned" library={featureLib} />
      <PerksWidget perks={node.perks ?? []} onChange={perks => setNode({ perks })} label="Perks Granted" note="While attuned" />
      <DetailsWidget rows={node.detailRows ?? []} onChange={rows => setNode({ detailRows: rows })} label="Detail Rows" />

      <div className={styles.sec} style={{ marginTop: 14 }}><span className={styles.fieldLab}>DM Note — never shown</span></div>
      <textarea ref={dmRef} className={`${styles.prose} ${styles.dm}`} placeholder="// operator only" value={node.dm ?? ''} onChange={e => setNode({ dm: e.target.value })} />

      <div className={styles.btnrow}>
        <button type="button" className={`${styles.btn} ${styles.ghost}`} onClick={() => {
          let i = 1; while (draft.nodes.some(x => x.id === `${node.id}_c${i}`)) i++
          const copy: EditorNode = { ...node, id: `${node.id}_c${i}`, name: `${node.name} (copy)`, angle: node.angle + 15, prereqs: [...node.prereqs] }
          set(t => ({ ...t, nodes: [...t.nodes, copy] }))
        }}><span className={styles.bf} /><span className={styles.bi}><i className="fa-solid fa-clone" /> Duplicate</span></button>
        <button type="button" className={`${styles.btn} ${styles.danger}`} onClick={onDelete}><span className={styles.bf} /><span className={styles.bi}><i className="fa-solid fa-trash" /> Delete</span></button>
      </div>
    </>
  )
}

function LinkInspector({ tree, edgeKey, onDelete }: { tree: EditorTree; edgeKey: string; onDelete: () => void }) {
  const [p, c] = edgeKey.split('__')
  const pn = tree.nodes.find(n => n.id === p), cn = tree.nodes.find(n => n.id === c)
  return (
    <>
      <div className={styles.imeta}><i className="fa-solid fa-link" /><span className={styles.t}>Prerequisite Link</span><span className={styles.s}>{p} → {c}</span></div>
      <div className={styles.sec}><span className={styles.fieldLab}>Flow</span></div>
      <div className={styles.chips}>
        <span className={styles.chip}>{pn?.name ?? p}</span>
        <span className={styles.chip}><i className="fa-solid fa-arrow-right-long" /> unlocks</span>
        <span className={styles.chip}>{cn?.name ?? c}</span>
      </div>
      <div className={styles.btnrow}>
        <button type="button" className={`${styles.btn} ${styles.danger}`} onClick={onDelete}><span className={styles.bf} /><span className={styles.bi}><i className="fa-solid fa-link-slash" /> Remove Link</span></button>
      </div>
    </>
  )
}

/** Numeric mods editor — a direct port of the item catalog form's "Effects
 *  Granted" widget (OperatorConsole.tsx CatalogForm), down to the class names
 *  (`.catFx*`/`.fxStat`/`.fxMode`/`.fxAmt`/`.fxX`), so DM-authoring reads the
 *  same everywhere. Shares its compile/decompile logic with that form via
 *  lib/modEditor.ts — one stat list, one "bonus vs. set" rule. */
function EffectsWidget({ mods, onChange, label, note }: { mods: ItemEffects; onChange: (m: ItemEffects | undefined) => void; label: string; note: string }) {
  const rows = effectsToMods(mods)
  const patch = (next: Mod[]) => onChange(compileEffects(next))

  return (
    <div className={styles.catFx}>
      <div className={styles.catFxHead}><i className="fa-solid fa-flask-vial" /><span className={styles.t}>{label}</span><span className={styles.s}>{note}</span></div>
      <div className={styles.catFxRows}>
        {rows.length ? rows.map((m, i) => (
          <div key={i} className={styles.catFxRow}>
            <select className={`${styles.selIn} ${styles.fxStat}`} value={m.stat}
              onChange={e => patch(rows.map((x, j) => (j === i ? { ...x, stat: e.target.value, set: isAbility(e.target.value) ? x.set : false } : x)))}>
              {MOD_STATS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            {isAbility(m.stat) && (
              <select className={`${styles.selIn} ${styles.fxMode}`} value={m.set ? 'set' : 'bonus'}
                onChange={e => patch(rows.map((x, j) => (j === i ? { ...x, set: e.target.value === 'set' } : x)))}>
                <option value="bonus">Bonus +</option>
                <option value="set">Set to</option>
              </select>
            )}
            <input className={`${styles.in} ${styles.fxAmt}`} type="number" value={m.amt}
              onChange={e => patch(rows.map((x, j) => (j === i ? { ...x, amt: parseInt(e.target.value, 10) || 0 } : x)))} />
            <span className={styles.fxX} onClick={() => patch(rows.filter((_, j) => j !== i))}><i className="fa-solid fa-xmark" /></span>
          </div>
        )) : <div className={styles.catFxNone}>No modifiers — add the buffs this grants (e.g. AC +1, or +5 Max HP).</div>}
      </div>
      <div className={styles.catFxAdd}>
        <button type="button" className={`${styles.btn} ${styles.ghost}`} onClick={() => patch([...rows, { stat: 'STR', amt: 1 }])}>
          <span className={styles.bf} /><span className={styles.bi}><i className="fa-solid fa-plus" /> Add Modifier</span>
        </button>
      </div>
    </div>
  )
}

/** Features Granted / Base Features — attach a snapshot copy of a
 *  feature_catalog entry (same pattern as the item form's feature-embed and
 *  Grant Feature: `{ ...row.data, id, feature_id: row.id }`), never a bare
 *  reference. shardFeatures() (lib/shards.ts) derives the player's Features
 *  screen entries straight from these arrays. */
function FeaturesWidget({ features, onChange, label, note, library }: {
  features: Feature[]; onChange: (f: Feature[]) => void; label: string; note: string; library: DmFeaturesState
}) {
  const attachedIds = new Set(features.map(f => f.feature_id).filter((id): id is string => !!id))
  const available = library.features.filter(row => !attachedIds.has(row.id))
  return (
    <div className={styles.wgt}>
      <div className={styles.wgtHead}><i className={`fa-solid fa-star ${styles.wi}`} /><span className={styles.wt}>{label}</span><span className={styles.wn}>{note} · Snapshots from the library</span></div>
      {features.length ? features.map((f, i) => (
        <div key={f.id ?? i} className={styles.dtlRow}>
          <span className={styles.dl}>Feature</span>
          <span className={styles.dv}>{f.name}</span>
          <i className={`fa-solid fa-xmark ${styles.dx}`} onClick={() => onChange(features.filter((_, idx) => idx !== i))} />
        </div>
      )) : <div className={styles.wgtEmpty}>No features — attach perks authored in the Features tab.</div>}
      <select className={styles.in} style={{ marginBottom: 0 }} value="" onChange={e => {
        if (!e.target.value) return
        const row = library.features.find(r => r.id === e.target.value)
        if (!row) return
        onChange([...features, { ...row.data, id: `sf-${row.id}-${Date.now()}`, feature_id: row.id }])
      }}>
        <option value="" disabled>Attach a feature…</option>
        {available.map(row => <option key={row.id} value={row.id}>{row.data.name}</option>)}
      </select>
    </div>
  )
}

/** Passive flavor bullets — plain strings, not Feature snapshots. Unlike
 *  FeaturesWidget above (which attaches real, mechanical Features that flow
 *  through shardFeatures() into the player's Features screen), a perk is
 *  cosmetic-only: it shows on the shard's buffs list / node detail panel and
 *  nowhere else, so flavor text like "Quest Tracking" can't flood the real
 *  Features system. */
const PERK_ICONS = ['fa-wand-magic-sparkles', ...ICONS]

/** Icon-picker button + popup, portaled to <body> and positioned in `fixed`
 *  coordinates from the button's own rect — same pattern as Equipment.tsx's
 *  ammo menu. Required because this button lives inside `.rScroll`
 *  (overflow-y: auto): an absolutely-positioned popup nested inside it gets
 *  clipped to the scroll container's box regardless of z-index, so it has to
 *  render outside that DOM subtree entirely to appear above everything. */
function PerkIconPicker({ icon, onPick }: { icon: string; onPick: (i: string) => void }) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    if (!open || !btnRef.current || !popRef.current) return
    const b = btnRef.current.getBoundingClientRect()
    const p = popRef.current
    const gap = 6
    const left = Math.max(12, Math.min(b.left, window.innerWidth - p.offsetWidth - 12))
    let top = b.bottom + gap
    if (top + p.offsetHeight > window.innerHeight - 12) top = b.top - p.offsetHeight - gap
    setPos({ left, top })
  }, [open])

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('click', close)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [open])

  return (
    <div className={styles.iconPickWrap}>
      <button
        ref={btnRef} type="button" className={styles.iconPickBtn}
        onClick={e => { e.stopPropagation(); setOpen(o => !o); setPos(null) }}
      >
        <i className={`fa-solid ${icon}`} />
      </button>
      {open && createPortal(
        <div
          ref={popRef} className={styles.iconPickPop}
          style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
          onClick={e => e.stopPropagation()}
        >
          <div className={styles.icons}>
            {PERK_ICONS.map(i => (
              <div key={i} className={`${styles.ic} ${i === icon ? styles.sel : ''}`}
                onClick={() => { onPick(i); setOpen(false) }}>
                <i className={`fa-solid ${i}`} />
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

function PerksWidget({ perks, onChange, label, note }: {
  perks: ShardPerk[]; onChange: (p: ShardPerk[]) => void; label: string; note: string
}) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [icon, setIcon] = useState(PERK_ICONS[0])
  function add() {
    const n = name.trim()
    if (!n) return
    onChange([...perks, { name: n, description: desc.trim(), icon }])
    setName(''); setDesc('')
  }
  return (
    <div className={styles.wgt}>
      <div className={styles.wgtHead}><i className={`fa-solid fa-wand-magic-sparkles ${styles.wi}`} /><span className={styles.wt}>{label}</span><span className={styles.wn}>{note} · Flavor only, not a real Feature</span></div>
      {perks.length ? perks.map((p, i) => (
        <div key={i} className={styles.dtlRow}>
          <i className={`fa-solid ${p.icon ?? PERK_ICONS[0]}`} style={{ color: 'var(--cyan)', width: 16, flex: '0 0 auto' }} />
          <span className={styles.dl}>{p.name}</span>
          <span className={styles.dv}>{p.description}</span>
          <i className={`fa-solid fa-xmark ${styles.dx}`} onClick={() => onChange(perks.filter((_, idx) => idx !== i))} />
        </div>
      )) : <div className={styles.wgtEmpty}>No passive perks.</div>}
      <div className={styles.dtlNew} style={{ gridTemplateColumns: 'auto minmax(0,1fr) minmax(0,2fr) auto' }}>
        <PerkIconPicker icon={icon} onPick={setIcon} />
        <input placeholder="Perk name…" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }} />
        <input placeholder="Description…" value={desc} onChange={e => setDesc(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }} />
        <button type="button" className={styles.wgtBtn} onClick={add}><i className="fa-solid fa-plus" /> Add</button>
      </div>
    </div>
  )
}

function DetailsWidget({ rows, onChange, label }: { rows: { l: string; v: string }[]; onChange: (rows: { l: string; v: string }[]) => void; label: string }) {
  const [l, setL] = useState(''); const [v, setV] = useState('')
  return (
    <>
      <div className={styles.sec}><span className={styles.fieldLab}>{label}</span></div>
      {rows.map((r, i) => (
        <div key={i} className={styles.dtlRow}><span className={styles.dl}>{r.l}</span><span className={styles.dv}>{r.v}</span><i className={`fa-solid fa-xmark ${styles.dx}`} onClick={() => onChange(rows.filter((_, idx) => idx !== i))} /></div>
      ))}
      <div className={styles.dtlNew}>
        <input placeholder="Label" value={l} onChange={e => setL(e.target.value)} />
        <input placeholder="Value" value={v} onChange={e => setV(e.target.value)} />
        <button type="button" className={styles.wgtBtn} onClick={() => { if (!l.trim() || !v.trim()) return; onChange([...rows, { l, v }]); setL(''); setV('') }}><i className="fa-solid fa-plus" /> Add</button>
      </div>
    </>
  )
}

function PlayerRead({ tree, node, sim, canAttune }: { tree: EditorTree; node: EditorNode | null | undefined; sim: Set<string> | null; canAttune: (n: EditorNode) => boolean }) {
  if (!node) {
    return (
      <div className={styles.inspEmpty}>
        <div className={styles.icBig}><span className={styles.icBigFrame} /><span className={styles.icBigInner}><i className="fa-solid fa-eye" /></span></div>
        <div className={styles.t}>Preview Mode</div>
        <div className={styles.d}>This is the tree as the party sees it. Click nodes to spend simulated attunement and walk the unlock path before you publish.</div>
      </div>
    )
  }
  const state = sim?.has(node.id) ? 'Attuned' : canAttune(node) ? 'Available' : 'Locked'
  const concealed = node.concealed && !sim?.has(node.id)
  return (
    <>
      <div className={styles.imeta} style={{ borderLeftColor: 'var(--cyan)', background: 'rgba(0,166,214,.06)', borderColor: 'rgba(0,166,214,.3)' }}>
        <i className={`fa-solid ${concealed ? 'fa-question' : node.icon}`} style={{ color: 'var(--cyan-hot)' }} />
        <span className={styles.t} style={{ color: 'var(--cyan-hot)' }}>{concealed ? '???' : node.name}</span><span className={styles.s}>{state}</span>
      </div>
      <div className={styles.chips}>
        <span className={styles.chip}>{tree.branches[node.branch] ?? node.branch}</span>
        <span className={styles.chip}>Tier {node.tier}</span>
        <span className={styles.chip}>{node.cost ? `Cost ${node.cost}` : 'Free'}</span>
      </div>
      <div className={styles.sec}><span className={styles.fieldLab}>Effect</span></div>
      <div style={{ fontFamily: 'var(--font-prose)', fontSize: 15, lineHeight: 1.55, color: concealed ? 'var(--beige-dim)' : 'var(--text)' }}>
        {concealed ? 'Node data withheld until prerequisites resolve.' : node.effect || '—'}
      </div>
      {node.dm && <><div className={styles.sec}><span className={styles.fieldLab}>DM Note</span></div><div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, lineHeight: 1.6, color: 'var(--amber)' }}>// {node.dm}</div></>}
    </>
  )
}
