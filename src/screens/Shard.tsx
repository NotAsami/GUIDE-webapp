import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import type { CharacterRow, CharacterSection, ShardSlot, ShardTree } from '../lib/database.types'
import { Nav } from '../components/Nav'
import { Deco } from '../components/Deco'
import { SHARD_SLOT_KEYS, shardAvailable, shardSlots, type ShardSlotKey } from '../lib/shards'
import { summarizeEffects } from '../lib/effects'
import { ShardTreeModal } from './ShardTree'
import styles from './Shard.module.css'

interface RouteContext {
  character: CharacterRow
  updateSection: <K extends CharacterSection>(section: K, next: CharacterRow[K]) => Promise<void>
  shardTrees?: Record<string, ShardTree>
}

/** Fixed head-scan overlay positions, calibrated to head-scan.png — percentage
 *  coords relative to .headStage (the image's own display rect, so they stay
 *  correct at any screen size). Ported 1:1 from the mockup's inline styles. */
const SLOT_POS: Record<ShardSlotKey, { top: string; left: string; height?: string }> = {
  slot1: { top: '38%', left: '73%', height: '30px' },
  slot2: { top: '48%', left: '71%' },
  slot3: { top: '58%', left: '69%' },
}

type Variant = 'guide' | 'filled' | 'empty'

/** Shard Interface — ported from G.U.I.D.E. Shard.html. Two columns: the
 *  head-scan Neural Interface (3 embedded slot-ports) and the Shard Manifest
 *  (one card per slot), joined by an SVG connector overlay that hover-links
 *  a slot to its card. Calibrate opens the Shard Upgrade Tree modal (Phase C);
 *  Eject clears a slot but keeps its earned/attuned progress so re-slotting
 *  the same shard restores it. */
export function Shard() {
  const { character, updateSection, shardTrees = {} } = useOutletContext<RouteContext>()
  const slots = shardSlots(character)

  const [linked, setLinked] = useState<ShardSlotKey | null>(null)
  const [picking, setPicking] = useState<ShardSlotKey | null>(null)
  const [shakeSlot, setShakeSlot] = useState<ShardSlotKey | null>(null)
  const [openSlot, setOpenSlot] = useState<ShardSlotKey | null>(null)

  const slotRefs = useRef<Partial<Record<ShardSlotKey, HTMLButtonElement | null>>>({})
  const cardRefs = useRef<Partial<Record<ShardSlotKey, HTMLElement | null>>>({})
  const mainRef = useRef<HTMLElement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const headImgRef = useRef<HTMLImageElement | null>(null)

  /* ---------- connector routing: slot's right edge -> card's left edge, one
     angular bend, same algorithm as the mockup's connectors() IIFE. ---------- */
  const draw = useCallback(() => {
    const main = mainRef.current, svg = svgRef.current
    if (!main || !svg) return
    const mr = main.getBoundingClientRect()
    svg.setAttribute('viewBox', `0 0 ${mr.width} ${mr.height}`)
    svg.setAttribute('width', String(mr.width))
    svg.setAttribute('height', String(mr.height))
    for (const key of SHARD_SLOT_KEYS) {
      const slotEl = slotRefs.current[key], cardEl = cardRefs.current[key]
      const path = svg.querySelector<SVGPathElement>(`[data-path="${key}"]`)
      if (!slotEl || !cardEl || !path) continue
      const sr = slotEl.getBoundingClientRect(), cr = cardEl.getBoundingClientRect()
      const x1 = sr.right - mr.left, y1 = sr.top + sr.height / 2 - mr.top
      const x2 = cr.left - mr.left, y2 = cr.top + cr.height / 2 - mr.top
      const dx = x2 - x1, dy = y2 - y1
      const stub1 = Math.min(40, dx * 0.18), stub2 = Math.min(24, dx * 0.12)
      const px1 = x1 + stub1, px2 = x2 - stub2
      const diag = Math.min(Math.abs(dy), Math.max(0, px2 - px1))
      const bendX = px1 + diag * Math.sign(dx)
      path.setAttribute('d',
        `M ${x1.toFixed(1)} ${y1.toFixed(1)} L ${px1.toFixed(1)} ${y1.toFixed(1)} L ${bendX.toFixed(1)} ${y2.toFixed(1)} L ${px2.toFixed(1)} ${y2.toFixed(1)} L ${x2.toFixed(1)} ${y2.toFixed(1)}`)
      const cap1 = svg.querySelector<SVGCircleElement>(`[data-cap="${key}-start"]`)
      const cap2 = svg.querySelector<SVGCircleElement>(`[data-cap="${key}-end"]`)
      cap1?.setAttribute('cx', x1.toFixed(1)); cap1?.setAttribute('cy', y1.toFixed(1))
      cap2?.setAttribute('cx', x2.toFixed(1)); cap2?.setAttribute('cy', y2.toFixed(1))
    }
  }, [])

  useLayoutEffect(() => {
    const redraw = () => requestAnimationFrame(draw)
    redraw()
    window.addEventListener('resize', redraw)
    window.addEventListener('scroll', redraw, true)
    document.fonts?.ready?.then(redraw)
    const img = headImgRef.current
    if (img && !img.complete) img.addEventListener('load', redraw, { once: true })
    return () => {
      window.removeEventListener('resize', redraw)
      window.removeEventListener('scroll', redraw, true)
    }
    // Redraw whenever slot contents change layout (guide/filled/empty variants
    // render different card heights).
  }, [draw, character.shards])

  async function writeSlots(next: Record<string, ShardSlot>) {
    await updateSection('shards', next)
  }

  async function eject(key: ShardSlotKey) {
    const slot = slots[key]
    if (!slot.shardId || slot.locked) return
    // Keep earned/attuned — re-slotting the same shard restores progress.
    await writeSlots({ ...character.shards, [key]: { ...slot, shardId: null } })
  }

  async function install(key: ShardSlotKey, shardId: string) {
    setPicking(null)
    if (!shardId) return
    await writeSlots({ ...character.shards, [key]: { shardId, earned: 0, attuned: ['core'] } })
  }

  function activate(key: ShardSlotKey) {
    const slot = slots[key]
    if (slot.locked) {
      setShakeSlot(key)
      window.setTimeout(() => setShakeSlot(null), 320)
      return
    }
    if (slot.shardId) setOpenSlot(key)
    else setPicking(picking === key ? null : key)
  }

  const slottedIds = new Set(Object.values(slots).map(s => s.shardId).filter((id): id is string => !!id))
  const installable = Object.values(shardTrees).filter(t => t.published && t.id !== 'guide' && !slottedIds.has(t.id))

  const meta = (
    <>
      <span className="dim">◇</span>
      <span>Section</span>
      <span className="acc">/ Equipment</span>
      <span className="dim">·</span>
      <span>Neural Interface</span>
      <span className="dim">·</span>
      <span className="acc">SHARD_LINK :: ACTIVE</span>
    </>
  )

  const occupied = Object.values(slots).filter(s => s.shardId).length

  return (
    <>
      <Deco
        left={<><span className="acc">EQUIPMENT</span> &nbsp;//&nbsp; SHARD_LINK &nbsp;//&nbsp; NEURAL_IFACE</>}
        right={<>Castella-08 &nbsp;//&nbsp; <span className="acc">PORT {occupied}/{SHARD_SLOT_KEYS.length}</span></>}
      />
      <Nav variant="dock" meta={meta} />

      <main ref={mainRef} className={styles.sd}>
        <section className={`${styles.col} ${styles.sdLeft}`} aria-label="Neural interface bio-scan">
          <div className={styles.colHeader}>
            <span className={styles.chNum}>01</span>
            <span className={styles.chTitle}>Neural Interface</span>
            <span className={styles.chMeta}>Bio-scan // Sagittal</span>
          </div>

          <div className={styles.headPanel}>
            <div className={styles.hpFrame2} />
            <div className={styles.hpInner}>
              <span className={`${styles.hpCorner} ${styles.tl}`} />
              <span className={`${styles.hpCorner} ${styles.tr}`} />
              <span className={`${styles.hpCorner} ${styles.bl}`} />
              <span className={`${styles.hpCorner} ${styles.br}`} />

              <div className={styles.hpMeta}>
                <span className="dim">SUBJ</span> · {character.name.toUpperCase()}<br />
                <span className="dim">CLASS</span> · {[character.identity?.race, character.identity?.class].filter(Boolean).join('.').toUpperCase() || '—'}
              </div>
              <div className={styles.hpMeta2}>PORT MATRIX <span className="dim">//</span> CLASS&nbsp;IV</div>

              <div className={styles.headStage}>
                <img ref={headImgRef} className={styles.headImg} src="/head-scan.png" alt="Cranial bio-scan showing brain and vasculature" onLoad={draw} />

                {SHARD_SLOT_KEYS.map(key => {
                  const slot = slots[key]
                  const variant: Variant = slot.locked ? 'guide' : slot.shardId ? 'filled' : 'empty'
                  const tree = slot.shardId ? shardTrees[slot.shardId] : undefined
                  return (
                    <button
                      key={key}
                      type="button"
                      ref={el => { slotRefs.current[key] = el }}
                      className={`${styles.slotPort} ${variant === 'guide' ? styles.locked : styles[variant]} ${linked === key ? styles.linked : ''}`}
                      style={{ top: SLOT_POS[key].top, left: SLOT_POS[key].left, height: SLOT_POS[key].height }}
                      onMouseEnter={() => setLinked(key)}
                      onMouseLeave={() => setLinked(l => (l === key ? null : l))}
                      onFocus={() => setLinked(key)}
                      onBlur={() => setLinked(l => (l === key ? null : l))}
                      onClick={() => activate(key)}
                      aria-label={tree ? `${tree.name} port` : `Shard port ${key} (empty)`}
                    >
                      <span className={styles.spGlyph}>
                        {variant === 'guide' ? <i className="fa-solid fa-lock" style={{ fontSize: 10 }} /> : variant === 'filled' ? '◆' : '+'}
                      </span>
                      <span className={styles.spLabel}>{tree ? tree.name.toUpperCase() : `PORT ${key.slice(-1)} · VACANT`}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </section>

        <section className={styles.col} aria-label="Shard manifest">
          <div className={styles.colHeader}>
            <span className={styles.chNum}>02</span>
            <span className={styles.chTitle}>Shard Manifest</span>
            <span className={styles.chMeta}>{occupied} / {SHARD_SLOT_KEYS.length} ports occupied</span>
          </div>

          <div className={styles.shardCards}>
            {SHARD_SLOT_KEYS.map(key => (
              <ShardCard
                key={key}
                slotKey={key}
                slot={slots[key]}
                tree={slot => (slot.shardId ? shardTrees[slot.shardId] : undefined)}
                linked={linked === key}
                shaking={shakeSlot === key}
                picking={picking === key}
                installable={installable}
                cardRef={el => { cardRefs.current[key] = el }}
                onMouseEnter={() => setLinked(key)}
                onMouseLeave={() => setLinked(l => (l === key ? null : l))}
                onActivate={() => activate(key)}
                onEject={() => void eject(key)}
                onInstall={id => void install(key, id)}
                onCancelPick={() => setPicking(null)}
              />
            ))}
          </div>
        </section>

        <svg ref={svgRef} className={styles.connectors} aria-hidden="true">
          {SHARD_SLOT_KEYS.map(key => {
            const slot = slots[key]
            const variant: Variant = slot.locked ? 'guide' : slot.shardId ? 'filled' : 'empty'
            return (
              <g key={key}>
                <path
                  data-path={key}
                  className={`${styles.conn} ${variant === 'guide' ? styles.guide : ''} ${variant === 'empty' ? styles.empty : ''} ${linked === key ? styles.linked : ''}`}
                />
                <circle data-cap={`${key}-start`} r="2.2" className={`${styles.connCap} ${variant === 'guide' ? styles.guide : ''}`} />
                <circle data-cap={`${key}-end`} r="2.2" className={`${styles.connCap} ${variant === 'guide' ? styles.guide : ''}`} />
              </g>
            )
          })}
        </svg>
      </main>

      {openSlot && slots[openSlot].shardId && shardTrees[slots[openSlot].shardId!] && (
        <ShardTreeModal
          character={character}
          updateSection={updateSection}
          slotKey={openSlot}
          slot={slots[openSlot]}
          tree={shardTrees[slots[openSlot].shardId!]}
          onClose={() => setOpenSlot(null)}
        />
      )}
    </>
  )
}

function ShardCard({
  slotKey, slot, tree, linked, shaking, picking, installable,
  cardRef, onMouseEnter, onMouseLeave, onActivate, onEject, onInstall, onCancelPick,
}: {
  slotKey: ShardSlotKey
  slot: ShardSlot
  tree: (slot: ShardSlot) => ShardTree | undefined
  linked: boolean
  shaking: boolean
  picking: boolean
  installable: ShardTree[]
  cardRef: (el: HTMLElement | null) => void
  onMouseEnter: () => void
  onMouseLeave: () => void
  onActivate: () => void
  onEject: () => void
  onInstall: (shardId: string) => void
  onCancelPick: () => void
}) {
  const variant: Variant = slot.locked ? 'guide' : slot.shardId ? 'filled' : 'empty'
  const t = tree(slot)

  const cls = [
    styles.shardCard, styles[variant],
    variant === 'guide' ? styles.locked : '',
    linked ? styles.linked : '',
    shaking ? styles.shake : '',
  ].filter(Boolean).join(' ')

  return (
    <article
      ref={cardRef}
      className={cls}
      tabIndex={0}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onActivate}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate() } }}
    >
      <div className={styles.scFrame} />
      <div className={styles.scInner}>
        {variant === 'guide' && (<><span className={`${styles.scCorner} ${styles.tl}`} /><span className={`${styles.scCorner} ${styles.br}`} /></>)}

        <div className={styles.scIconWrap}>
          {variant === 'guide' ? <GuideEmblem /> : variant === 'filled' && t?.id === 'vigor' ? <VigorEmblem /> : variant === 'filled' && t ? (
            <i className={`fa-solid ${t.icon}`} style={{ fontSize: 30, color: 'var(--cyan-hot)' }} />
          ) : <span className={styles.emptyPlus}>+</span>}
        </div>

        <div className={styles.scHead}>
          <div className={styles.scNameGroup}>
            <div className={styles.scName}>{variant === 'empty' ? 'Empty Port' : (t?.name ?? '—')}</div>
            <div className={styles.scSub}>
              {variant === 'empty' ? `Shard Port ${slotKey.slice(-1)} · Awaiting install` : (t?.module ?? '')}
            </div>
          </div>
          {variant === 'guide' ? (
            <div className={styles.scBadge}><span>Permanent</span><span className={styles.lock}><i className="fa-solid fa-lock" /></span></div>
          ) : variant === 'filled' ? (
            <div className={styles.scRarity}>{t?.rarity ?? ''}</div>
          ) : (
            <div className={`${styles.scRarity} ${styles.vacant}`}>Vacant</div>
          )}
        </div>

        <div className={styles.scStats}>
          {variant === 'empty' ? (
            <><Row k="Status" v="Awaiting Shard" /><Row k="Type" v="Class IV" /></>
          ) : (
            <>
              {t && t.capacity > 0 && (
                <>
                  <Row k="Points" v={`${shardAvailable(t, slot)} / ${t.capacity}`} acc={variant === 'guide'} />
                  <Row k="Attuned" v={`${slot.attuned.length} / ${t.nodes.length}`} />
                </>
              )}
              {(t?.baseDetails ?? []).map(d => <Row key={d.l} k={d.l} v={d.v} />)}
            </>
          )}
        </div>

        <div className={`${styles.scBuffs} ${variant === 'empty' ? styles.italic : ''}`}>
          {variant === 'empty' ? 'No shard installed. Insert a compatible module to bind.' : buffLines(t).map(line => (
            <span key={line} className={styles.b} style={{ display: 'block' }}>
              <span style={{ color: variant === 'guide' ? 'var(--gold-rare)' : 'var(--cyan-hot)', marginRight: 6, fontWeight: 600 }}>+</span>{line}
            </span>
          ))}
        </div>

        <div className={styles.scActions}>
          {variant === 'guide' && (
            <button type="button" className={`${styles.scBtn} ${styles.disabled}`} data-tip="// Locked" aria-label="Calibrate (locked)" onClick={e => { e.stopPropagation(); onActivate() }}>
              <span className={styles.scbFrame} /><span className={styles.scbInner}><i className="fa-solid fa-lock" /></span>
            </button>
          )}
          {variant === 'filled' && (
            <>
              <button type="button" className={styles.scBtn} data-tip="Calibrate" aria-label="Calibrate" onClick={e => { e.stopPropagation(); onActivate() }}>
                <span className={styles.scbFrame} /><span className={styles.scbInner}><i className="fa-solid fa-sliders" /></span>
              </button>
              <button type="button" className={`${styles.scBtn} ${styles.eject}`} data-tip="Eject" aria-label="Eject shard" onClick={e => { e.stopPropagation(); onEject() }}>
                <span className={styles.scbFrame} /><span className={styles.scbInner}><i className="fa-solid fa-eject" /></span>
              </button>
            </>
          )}
          {variant === 'empty' && (
            <button type="button" className={styles.scBtn} data-tip="Insert" aria-label="Install shard" onClick={e => { e.stopPropagation(); onActivate() }}>
              <span className={styles.scbFrame} /><span className={styles.scbInner}><i className="fa-solid fa-plus" /></span>
            </button>
          )}
        </div>

        {picking && (
          <div className={styles.picker} style={{ gridColumn: '1 / -1' }} onClick={e => e.stopPropagation()}>
            {installable.length === 0 ? (
              <span className={styles.pickerEmpty}>No published shards available to install.</span>
            ) : (
              <select
                className={styles.pickerSelect}
                defaultValue=""
                autoFocus
                onChange={e => onInstall(e.target.value)}
                onBlur={onCancelPick}
              >
                <option value="" disabled>Select a shard…</option>
                {installable.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
          </div>
        )}
      </div>
    </article>
  )
}

function Row({ k, v, acc }: { k: string; v: string; acc?: boolean }) {
  return <div className={styles.row}><span className={styles.k}>{k}</span> <span className={`${styles.v}${acc ? ' ' + styles.acc : ''}`}>{v}</span></div>
}

/** Buff bullets from a shard's on-slot base grant: numeric mods first (via
 *  summarizeEffects), then any base features by name. */
function buffLines(t: ShardTree | undefined): string[] {
  if (!t) return []
  const lines: string[] = []
  if (t.baseMods && Object.keys(t.baseMods).length) {
    lines.push(...summarizeEffects(t.baseMods).split(', '))
  }
  for (const f of t.baseFeatures ?? []) lines.push(f.name)
  return lines
}

function GuideEmblem() {
  return (
    <svg className={styles.guideEmblem} viewBox="0 0 100 100" aria-hidden="true">
      <polygon points="50,6 88,28 88,72 50,94 12,72 12,28" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <polygon points="50,18 78,34 78,66 50,82 22,66 22,34" fill="none" stroke="currentColor" strokeWidth="0.9" opacity="0.55" />
      <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="0.6" strokeDasharray="1.5 3" opacity="0.4" />
      <path d="M22 50 Q 50 28 78 50 Q 50 72 22 50 Z" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="50" cy="50" r="6" fill="currentColor" opacity="0.85" />
      <circle cx="50" cy="50" r="2.4" fill="#0a0805" />
      <g stroke="currentColor" strokeWidth="0.8" opacity="0.7">
        <line x1="50" y1="2" x2="50" y2="8" />
        <line x1="50" y1="92" x2="50" y2="98" />
        <line x1="8" y1="50" x2="14" y2="50" />
        <line x1="86" y1="50" x2="92" y2="50" />
      </g>
    </svg>
  )
}

function VigorEmblem() {
  return (
    <svg className={styles.vigorEmblem} viewBox="0 0 80 100" aria-hidden="true">
      <polygon className={styles.core} points="40,4 70,38 40,96 10,38" />
      <polygon className={styles.facet} points="40,4 70,38 40,38" />
      <polygon className={styles.facet} points="40,4 10,38 40,38" />
      <polygon className={styles.facet} points="10,38 40,38 40,96" />
      <polygon className={styles.facet} points="70,38 40,38 40,96" />
      <polygon className={styles.high} points="40,8 56,30 40,30" opacity="0.65" />
      <ellipse cx="40" cy="50" rx="34" ry="6" fill="none" stroke="#00a6d6" strokeWidth="0.6" opacity="0.4" />
    </svg>
  )
}
