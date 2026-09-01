import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CharacterRow, CharacterSection, ShardNode, ShardSlot, ShardTree } from '../lib/database.types'
import { RING_GAP, branchColor, nodeState, nodeXY, shardAvailable, shardSpent, type ShardSlotKey } from '../lib/shards'
import styles from './ShardTree.module.css'
import { Icon } from '../components/Icon'
import { Inline } from '../lib/markdown'

interface Props {
  character: CharacterRow
  updateSection: <K extends CharacterSection>(section: K, next: CharacterRow[K]) => Promise<void>
  slotKey: ShardSlotKey
  slot: ShardSlot
  tree: ShardTree
  onClose: () => void
}

type Edge = { key: string; parent: string; child: string }

/** What the player is allowed to see for a node. Concealed nodes ship to the
 *  catalog as bare geometry (id/tier/angle/cost/prereqs) with no name/effect
 *  — the real text lives DM-side in shard_tree_secrets and only reaches the
 *  player if the DM copies it into `slot.revealed` (Operator Console). */
function displayNode(n: ShardNode, slot: ShardSlot): { name: string; icon: string; effect: string } {
  if (!n.concealed) return { name: n.name, icon: n.icon || 'fa-gem', effect: n.effect }
  const revealed = slot.revealed?.[n.id]
  if (revealed) return { name: revealed.name, icon: n.icon || 'fa-gem', effect: revealed.effect }
  return {
    name: '???', icon: 'fa-question',
    effect: slot.attuned.includes(n.id)
      ? 'Attuned, but the DM has not revealed what it does yet.'
      : 'Node data withheld until its prerequisites resolve.',
  }
}

/** Shard Upgrade Tree — a modal drilled in from the Shard screen, ported from
 *  G.U.I.D.E. Shard Tree.html. Renders entirely from `tree` (catalog) +
 *  `slot` (this character's earned/attuned progress); the only write is
 *  attuning a node, which appends its id to `slot.attuned`. */
export function ShardTreeModal({ character, updateSection, slotKey, slot, tree, onClose }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [denyId, setDenyId] = useState<string | null>(null)
  const [denyMsg, setDenyMsg] = useState('')
  const [justId, setJustId] = useState<string | null>(null)
  const [bump, setBump] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [grabbing, setGrabbing] = useState(false)

  const stageRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef({ dragging: false, moved: false, sx: 0, sy: 0, spx: 0, spy: 0 })
  const dragMovedRef = useRef(false)

  const byId = useCallback((id: string) => tree.nodes.find(n => n.id === id), [tree])

  const maxTier = Math.max(0, ...tree.nodes.map(n => n.tier))
  const canvasR = RING_GAP * maxTier + 72
  const canvasSz = canvasR * 2
  const pos = new Map(tree.nodes.map(n => {
    const p = nodeXY(n)
    return [n.id, { x: canvasR + p.x, y: canvasR + p.y }] as const
  }))
  const edges: Edge[] = tree.nodes.flatMap(n => n.prereqs.map(p => ({ key: `${p}__${n.id}`, parent: p, child: n.id })))
  const available = shardAvailable(tree, slot)
  const spent = shardSpent(tree, slot)

  /* ---------- auto-attune free (cost-0) nodes the instant their prereqs
     resolve — the tree has no click gate for a node that costs nothing. ---------- */
  useEffect(() => {
    const freeReady = tree.nodes.filter(n =>
      n.cost === 0 && !slot.attuned.includes(n.id) && n.prereqs.every(p => slot.attuned.includes(p)))
    if (!freeReady.length) return
    void writeAttuned([...slot.attuned, ...freeReady.map(n => n.id)])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree.id, slot.attuned.join(',')])

  async function writeAttuned(nextAttuned: string[]) {
    const nextSlot: ShardSlot = { ...slot, attuned: nextAttuned }
    await updateSection('shards', { ...character.shards, [slotKey]: nextSlot })
  }

  function deny(id: string, msg: string) {
    setDenyId(id); setDenyMsg(msg); setSelectedId(id)
    window.setTimeout(() => setDenyId(d => (d === id ? null : d)), 320)
  }

  async function attune(n: ShardNode) {
    await writeAttuned([...slot.attuned, n.id])
    setSelectedId(n.id)
    setJustId(n.id); window.setTimeout(() => setJustId(null), 650)
    setBump(true); window.setTimeout(() => setBump(false), 400)
  }

  function onNodeClick(n: ShardNode) {
    if (dragMovedRef.current) return
    const state = nodeState(n, slot)
    if (state === 'attuned') { setSelectedId(n.id); return }
    if (state === 'locked') {
      const missing = n.prereqs.filter(p => !slot.attuned.includes(p)).map(p => byId(p)?.name ?? p)
      deny(n.id, `Locked — requires ${missing.join(' + ')}`)
      return
    }
    if (available < n.cost) { deny(n.id, 'Insufficient attunement'); return }
    void attune(n)
  }

  /* ---------- pan / zoom viewport ---------- */
  const clampZoom = (z: number) => Math.max(0.3, Math.min(2.6, z))

  const fitView = useCallback(() => {
    const stage = stageRef.current
    if (!stage) return
    const vw = stage.clientWidth, vh = stage.clientHeight
    if (!vw || !vh) return
    const z = clampZoom(Math.min(vw / canvasSz, vh / canvasSz) * 0.98)
    setZoom(z)
    setPan({ x: (vw - canvasSz * z) / 2, y: (vh - canvasSz * z) / 2 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasSz])

  useLayoutEffect(() => {
    fitView()
    window.addEventListener('resize', fitView)
    return () => window.removeEventListener('resize', fitView)
  }, [fitView])

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
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect) return
    zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - rect.left, e.clientY - rect.top)
  }

  function onStagePointerDown(e: React.PointerEvent) {
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
    function up() {
      const d = dragRef.current
      if (d.dragging && d.moved) { dragMovedRef.current = true; window.setTimeout(() => { dragMovedRef.current = false }, 0) }
      d.dragging = false; d.moved = false
      setGrabbing(false)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
  }, [])

  /* ---------- close on Escape ---------- */
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const detailNode = (hoverId ? byId(hoverId) : selectedId ? byId(selectedId) : null) ?? null
  const spokes = Object.entries(tree.branches).filter(([k]) => k !== 'core' && k !== 'apex').slice(0, 3)

  return createPortal(
    <div className={styles.backdrop}>
      <div className={styles.scrim} onClick={onClose} />
      <div className={styles.overlay}>
        <div className={styles.panel} role="dialog" aria-modal="true" aria-label={`${tree.name} attunement matrix`}>
          <div className={styles.pnGap} />
          <div className={styles.pnLine} />
          <div className={styles.pnInner}>
            <span className={`${styles.pnCorner} ${styles.tl}`} />
            <span className={`${styles.pnCorner} ${styles.br}`} />

            <header className={styles.pnHeader}>
              <div className={styles.hdCrystal}><Icon name={tree.icon} /></div>
              <div className={styles.hdTitles}>
                <div className={styles.hdName}>{tree.name}</div>
                <div className={styles.hdMeta}>
                  <span className={styles.hdRarity}>{tree.rarity}</span>
                  <span className={styles.hdSub}>Module · {tree.module}</span>
                </div>
              </div>
              <div className={styles.hdAttune}>
                <span className={styles.label}>Attunement</span>
                <span className={styles.read}>:: <span className={`${styles.num} ${bump ? styles.bump : ''}`}>{available}</span> Available</span>
                <span className={styles.spent}>Spent {spent} · Capacity {tree.capacity}</span>
              </div>
              <button type="button" className={styles.hdClose} onClick={onClose}>
                <span className={styles.frame} /><span className={styles.inner}><i className="fa-solid fa-arrow-left-long" /> Return to Neural Interface</span>
              </button>
            </header>

            <div className={styles.pnBody}>
              <section className={styles.col}>
                <div className={styles.colHeader}>
                  <span className={styles.chNum}>01</span>
                  <span className={styles.chTitle}>Attunement Matrix</span>
                  <span className={styles.chMeta}><span className={styles.acc}>{slot.attuned.length}</span> / {tree.nodes.length} Attuned</span>
                </div>
                <div className={styles.region}>
                  <div className={styles.frame} /><div className={styles.gap} /><div className={styles.line} />
                  <div className={styles.inner}>
                    <span className={`${styles.corner} ${styles.tl}`} /><span className={`${styles.corner} ${styles.br}`} />
                    <div
                      ref={stageRef}
                      className={`${styles.treePad} ${grabbing ? styles.grabbing : ''}`}
                      onWheel={onWheel}
                      onPointerDown={onStagePointerDown}
                    >
                      <div className={styles.treeStage}>
                        {spokes[0] && <span className={`${styles.axisLabel} ${styles.left}`}>{spokes[0][1]}</span>}
                        {spokes[1] && <span className={`${styles.axisLabel} ${styles.right}`}>{spokes[1][1]}</span>}
                        {spokes[2] && <span className={`${styles.axisLabel} ${styles.bottom}`}>{spokes[2][1]}</span>}

                        <div className={styles.treeCanvas} style={{ width: canvasSz, height: canvasSz, transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})` }}>
                          <svg className={styles.treeSvg} viewBox={`0 0 ${canvasSz} ${canvasSz}`} width={canvasSz} height={canvasSz} aria-hidden="true">
                            {Array.from({ length: maxTier }, (_, i) => i + 1).map(t => (
                              <circle key={t} className={styles.ringGuide} cx={canvasR} cy={canvasR} r={RING_GAP * t} />
                            ))}
                            {edges.map(e => {
                              const child = byId(e.child)
                              const a = pos.get(e.parent), b = pos.get(e.child)
                              if (!a || !b || !child) return null
                              const childState = nodeState(child, slot)
                              const cls = childState === 'attuned' ? styles.live : childState === 'locked' ? styles.locked : styles.open
                              return (
                                <path
                                  key={e.key}
                                  className={`${styles.edge} ${cls} ${(hoverId === e.parent || hoverId === e.child) ? styles.hl : ''}`}
                                  stroke={branchColor(tree, child.branch)}
                                  d={`M ${a.x.toFixed(1)} ${a.y.toFixed(1)} L ${b.x.toFixed(1)} ${b.y.toFixed(1)}`}
                                />
                              )
                            })}
                          </svg>

                          {tree.nodes.map(n => {
                            const p = pos.get(n.id)!
                            const state = nodeState(n, slot)
                            const d = displayNode(n, slot)
                            const cls = [
                              styles.node, styles[state],
                              n.tier === 0 ? styles.isCore : '',
                              n.branch === 'apex' ? styles.isApex : '',
                              selectedId === n.id ? styles.sel : '',
                              justId === n.id ? styles.just : '',
                              denyId === n.id ? styles.deny : '',
                            ].filter(Boolean).join(' ')
                            return (
                              <button
                                key={n.id}
                                type="button"
                                className={cls}
                                style={{ left: p.x, top: p.y, '--bc': branchColor(tree, n.branch) } as React.CSSProperties}
                                aria-label={d.name}
                                onMouseEnter={() => setHoverId(n.id)}
                                onMouseLeave={() => setHoverId(h => (h === n.id ? null : h))}
                                onFocus={() => setHoverId(n.id)}
                                onBlur={() => setHoverId(h => (h === n.id ? null : h))}
                                onClick={() => onNodeClick(n)}
                              >
                                <span className={styles.nFrame} />
                                <span className={styles.nInner}><Icon name={d.icon} /></span>
                                {n.cost > 0 && state !== 'attuned' && <span className={styles.nCost}>{n.cost}</span>}
                                {state === 'locked' && <span className={styles.nLock}><i className="fa-solid fa-lock" /></span>}
                              </button>
                            )
                          })}
                        </div>
                      </div>

                      <div className={styles.treeControls}>
                        <button type="button" onClick={() => zoomAt(1.25, (stageRef.current?.clientWidth ?? 0) / 2, (stageRef.current?.clientHeight ?? 0) / 2)} aria-label="Zoom in"><i className="fa-solid fa-plus" /></button>
                        <button type="button" onClick={() => zoomAt(1 / 1.25, (stageRef.current?.clientWidth ?? 0) / 2, (stageRef.current?.clientHeight ?? 0) / 2)} aria-label="Zoom out"><i className="fa-solid fa-minus" /></button>
                        <button type="button" onClick={fitView} aria-label="Fit to view"><i className="fa-solid fa-expand" /></button>
                      </div>
                      <span className={styles.treeHint}>Drag to pan · scroll to zoom</span>
                    </div>
                  </div>
                </div>
              </section>

              <section className={styles.col}>
                <div className={styles.colHeader}>
                  <span className={styles.chNum}>02</span>
                  <span className={styles.chTitle}>Node Detail</span>
                  <span className={styles.chMeta}>{detailNode ? (tree.branches[detailNode.branch] ?? detailNode.branch) : 'No Selection'}</span>
                </div>
                <div className={styles.region}>
                  <div className={styles.frame} /><div className={styles.gap} /><div className={styles.line} />
                  <div className={styles.inner}>
                    <span className={`${styles.corner} ${styles.tl}`} /><span className={`${styles.corner} ${styles.br}`} />
                    <div className={styles.detailPad}>
                      {!detailNode ? (
                        <div className={styles.detailEmpty}>
                          <span className={styles.prompt}>Select Node</span>
                          <span className={styles.cur}>▌</span>
                          <span className={styles.hint}>Hover or click any node</span>
                        </div>
                      ) : (
                        <NodeDetail
                          node={detailNode}
                          slot={slot}
                          tree={tree}
                          available={available}
                          denyMsg={denyId === detailNode.id ? denyMsg : ''}
                          onAttune={() => onNodeClick(detailNode)}
                        />
                      )}
                    </div>
                  </div>
                </div>
              </section>
            </div>

            <footer className={styles.pnTelemetry}>
              <span className={styles.tel}>Attunement Stream :: Monitored // G.U.I.D.E. Nominal</span>
            </footer>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function NodeDetail({
  node, slot, tree, available, denyMsg, onAttune,
}: { node: ShardNode; slot: ShardSlot; tree: ShardTree; available: number; denyMsg: string; onAttune: () => void }) {
  const state = nodeState(node, slot)
  const d = displayNode(node, slot)
  const nameCls = state === 'locked' ? styles.sLocked : styles.sAvailable
  const stateCls = state === 'attuned' ? styles.sAttuned : state === 'available' ? styles.sAvailable : styles.sLocked
  const missing = state === 'locked' ? node.prereqs.filter(p => !slot.attuned.includes(p)).map(p => tree.nodes.find(x => x.id === p)?.name ?? p) : []
  const affordable = state === 'available' && available >= node.cost

  return (
    <div className={styles.detailActive}>
      <div className={`${styles.daName} ${state === 'attuned' ? styles.sAttuned : nameCls}`}>{d.name}</div>
      <div className={styles.daTags}>
        <span className={`${styles.daTag} ${styles.cyan}`} style={{ color: branchColor(tree, node.branch), borderColor: branchColor(tree, node.branch) }}>
          {tree.branches[node.branch] ?? node.branch}
        </span>
        <span className={styles.daTag}>Tier {node.tier}</span>
        <span className={styles.daTag}>{node.cost === 0 ? 'Free' : `Cost ${node.cost}`}</span>
      </div>
      <div className={`${styles.daState} ${stateCls}`}>
        <span className={styles.dot} />
        {state === 'attuned' ? 'Attuned' : state === 'available' ? 'Available' : 'Locked'}
        {missing.length > 0 && <span className={styles.req}>— Requires: <b>{missing.join(', ')}</b></span>}
      </div>
      <div className={styles.daEffect}>
        <span className={styles.effLabel}>Effect</span>
        <Inline text={d.effect} />
      </div>
      {/* Cosmetic flavor only — concealed nodes never carry perks to the
          public catalog, so this naturally stays hidden until revealed. */}
      {node.perks && node.perks.length > 0 && (
        <div className={styles.daPerks}>
          <span className={styles.effLabel}>Passive</span>
          {node.perks.map(p => (
            <span key={p.name} className={styles.perk}>
              <span className={styles.plus}>+</span><b>{p.name}</b>{p.description && ` — ${p.description}`}
            </span>
          ))}
        </div>
      )}
      {denyMsg && <div className={styles.daNote}>// {denyMsg}</div>}
      {state === 'attuned' ? (
        <button type="button" className={styles.daAttune} disabled>
          <span className={styles.atFrame} /><span className={styles.atInner}><i className="fa-solid fa-check" /> Attuned</span>
        </button>
      ) : (
        <button type="button" className={styles.daAttune} disabled={!affordable} onClick={onAttune}>
          <span className={styles.atFrame} /><span className={styles.atInner}><i className="fa-solid fa-bolt" /> Attune · Cost {node.cost}</span>
        </button>
      )}
    </div>
  )
}
