/**
 * The NPC web as drawn — shared by the Operator Console (OperatorNpcWeb) and
 * the player's web on the Lore screen. Both pass a Web from derive() and
 * an Orbit from layout(); this owns only the drawing, the fit-or-focus
 * transform, and the read-only card. Selection state belongs to the caller.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import {
  ATTITUDE_LABEL, LABEL_GAP, LABEL_W, NAME_LINE, NODE_SIZE, PARTY, PC_SIZE, SUB_LINE, SYSTEM_TYPE,
  endpoint, fitView, focusView, neighbourhood, onEllipse, type Orbit, type Web, type WebEdge, type WebNode,
} from '../lib/npcWeb'
import { Prose } from '../lib/markdown'
import styles from './NpcWebView.module.css'

const cx = (...xs: (string | false | undefined | null)[]) => xs.filter(Boolean).join(' ')

export type Show = Record<'relation' | 'quest' | 'link', boolean>
export const SHOW_ALL: Show = { relation: true, quest: true, link: true }
const shown = (e: WebEdge, show: Show) => (e.kind === 'mention' ? show.quest : show[e.kind])

/** First word and last word: Magistrate Voss → MV, The Lady → TL,
 *  Maren of the Waterfront → MW. */
export const initials = (name: string) => {
  const words = name.split(/\s+/).filter(w => /\w/.test(w))
  if (!words.length) return '?'
  return (words[0]![0]! + (words.length > 1 ? words[words.length - 1]![0]! : '')).toUpperCase()
}

export const ATT_VAR: Record<string, string> = { friendly: 'var(--good)', neutral: 'var(--muted)', wary: 'var(--amber)', hostile: 'var(--danger-hot)' }

/** One line under a node: how the party knows them, or through whom. */
function caption(web: Web, n: WebNode, nameOf: (id: string) => string): string {
  const ties = web.edges.filter(e => e.from === n.id || e.to === n.id)
  if (n.ring === 1) {
    const rel = ties.find(e => e.kind === 'relation')
    if (rel) return rel.label || 'Relation'
    const q = ties.find(e => e.kind === 'quest')
    if (q) return q.done ? 'Quest done' : 'Quest giver'
    return 'Named in a quest'
  }
  const via = ties.find(e => e.kind === 'link')
  return via ? `Via ${nameOf(via.from === n.id ? via.to : via.from)}` : 'No ties yet'
}

export const TOOLBAR_H = 52

export function NpcWebView({ web, orbit, sel, onSelect, show = SHOW_ALL, drawerOpen, drawerW, tone = 'operator', empty, children }: {
  web: Web
  orbit: Orbit
  sel: string | null
  onSelect: (id: string | null) => void
  show?: Show
  drawerOpen: boolean
  drawerW: number
  tone?: 'operator' | 'player'
  /** Shown instead of the web when nobody is on it. */
  empty?: ReactNode
  /** Overlays: the toolbar, the drawer. */
  children?: ReactNode
}) {
  const paneRef = useRef<HTMLDivElement>(null)
  const [pane, setPane] = useState({ w: 1040, h: 744 })
  useLayoutEffect(() => {
    const el = paneRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setPane({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const nodeById = new Map(web.nodes.map(n => [n.id, n]))
  const nameOf = (id: string) => (id === PARTY ? 'The party' : nodeById.get(id)?.name ?? web.pcs.find(p => p.id === id)?.name ?? '?')
  const selected = sel ? nodeById.get(sel) ?? null : null
  const view = selected
    ? focusView(orbit, web, selected.id, { w: pane.w, h: pane.h, drawer: drawerW, top: TOOLBAR_H })
    : (() => {
        const v = fitView(orbit, pane.w - (drawerOpen ? drawerW : 0), pane.h - TOOLBAR_H)
        return { ...v, y: v.y + TOOLBAR_H }
      })()
  const near = selected ? neighbourhood(web, selected.id) : null
  const lit = (e: WebEdge) => !selected || e.from === selected.id || e.to === selected.id
  const edgeRing = orbit.rings[orbit.rings.length - 1]!
  const outer = { rx: edgeRing.rx + 24, ry: edgeRing.ry + (24 * edgeRing.ry) / edgeRing.rx }

  return (
    <div className={cx(styles.pane, tone === 'player' && styles.player)} ref={paneRef}>
      {web.nodes.length === 0 && empty ? empty : (
        <div className={styles.world} style={{ width: orbit.w, height: orbit.h, transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
          <svg className={styles.svg} width={orbit.w} height={orbit.h} viewBox={`0 0 ${orbit.w} ${orbit.h}`} fill="none" aria-hidden="true">
            {orbit.rings.map((r, i) => (
              <ellipse key={i} cx={orbit.cx} cy={orbit.cy} rx={r.rx} ry={r.ry} className={i ? styles.ring2 : styles.ring1} />
            ))}
            {orbit.sectors.length > 1 && orbit.sectors.map(s => {
              const a = onEllipse(orbit.cx, orbit.cy, { rx: 80, ry: 80 * (edgeRing.ry / edgeRing.rx) }, s.from)
              const b = onEllipse(orbit.cx, orbit.cy, outer, s.from)
              return <line key={s.name} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={styles.spoke} />
            })}
            {web.edges.filter(e => shown(e, show)).map(e => {
              const a = endpoint(orbit, e.from), b = endpoint(orbit, e.to)
              if (!a || !b) return null
              const off = !lit(e)
              if (e.kind === 'link') {
                const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
                const q = { x: mx + (orbit.cx - mx) * 0.25, y: my + (orbit.cy - my) * 0.25 }
                return <path key={e.id} d={`M ${a.x} ${a.y} Q ${q.x} ${q.y} ${b.x} ${b.y}`} className={cx(styles.eLink, selected && !off && styles.hot, off && styles.off)} />
              }
              const stroke = e.kind === 'relation'
                ? (e.label === SYSTEM_TYPE ? 'var(--amber)' : ATT_VAR[e.attitude ?? ''] ?? 'var(--beige-dim)')
                : undefined
              return <line key={e.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} style={stroke ? { stroke } : undefined}
                className={cx(e.kind === 'relation' ? styles.eRel : styles.eQuest, e.done && styles.done, off && styles.off)} />
            })}
          </svg>

          {orbit.sectors.map(s => (
            <span key={s.name} className={styles.sector} style={{ left: s.at.x, top: s.at.y }}>{s.name}</span>
          ))}

          {/* Ties spelled out, only for the selection — a label on every line at
              once is what makes a web unreadable. A party or PC tie is short and
              ends on a node's name, so its tag sits nearer the party end. */}
          {selected && web.edges.filter(e => lit(e) && shown(e, show)).map(e => {
            const a = endpoint(orbit, e.from), b = endpoint(orbit, e.to)
            if (!a || !b) return null
            const text = e.kind === 'quest' ? `Quest · ${e.label}` : e.kind === 'mention' ? `Named · ${e.label}` : e.label
            const t = e.kind === 'link' ? 0.5 : 0.4
            return <span key={e.id} className={styles.eLabel} style={{ left: a.x + (b.x - a.x) * t, top: a.y + (b.y - a.y) * t }}>{text}</span>
          })}

          {web.nodes.map(n => {
            const p = orbit.pos.get(n.id)!
            const size = NODE_SIZE[n.ring]
            const ties = web.edges.filter(e => e.from === n.id || e.to === n.id)
            const closed = ties.length > 0 && ties.every(e => e.done)
            return (
              <button
                key={n.id} type="button"
                className={cx(styles.node, n.system && styles.system, !n.record && styles.unrecorded,
                  n.id === sel && styles.sel, (near ? !near.has(n.id) : closed) && styles.faded)}
                style={{ left: p.x - LABEL_W / 2, top: p.y - size / 2, width: LABEL_W }}
                onClick={() => onSelect(n.id === sel ? null : n.id)}
                aria-pressed={n.id === sel}
              >
                <span className={styles.disc} style={{ width: size, height: size }}>
                  {n.system ? <span className={styles.diamond} /> : initials(n.name)}
                  {n.record?.portrait && <img src={n.record.portrait} alt="" onError={e => { e.currentTarget.style.display = 'none' }} />}
                </span>
                <span className={styles.name} style={{ marginTop: LABEL_GAP, lineHeight: `${NAME_LINE}px`, maxHeight: NAME_LINE * 2 }}>{n.name}</span>
                <span className={styles.cap} style={{ marginTop: LABEL_GAP / 2, lineHeight: `${SUB_LINE}px` }}>{caption(web, n, nameOf)}</span>
              </button>
            )
          })}

          {web.pcs.map(pc => {
            const p = orbit.pcs.get(pc.id)!
            // A quest tie is to the whole party, so it lights every PC.
            const off = near && !near.has(pc.id) && !near.has(PARTY)
            return (
              <div key={pc.id} className={cx(styles.pc, off && styles.faded)} style={{ left: p.x - LABEL_W / 2, top: p.y - PC_SIZE / 2, width: LABEL_W }}>
                <span className={styles.hex} style={{ width: PC_SIZE, height: PC_SIZE }}><span>{initials(pc.name)}</span></span>
                <span className={styles.pcName}>{pc.name}</span>
              </div>
            )
          })}
        </div>
      )}

      <div className={styles.legend} aria-hidden="true">
        <span><i className={styles.lgRel} />Relation{tone === 'player' ? ' · your lore' : ' · a PC’s lore'}</span>
        <span><i className={styles.lgQuest} />Quest · the Quest Log</span>
        <span><i className={styles.lgLink} />{tone === 'player' ? 'Tie · learned from the Operator' : 'NPC link · authored here'}</span>
      </div>

      {children}
    </div>
  )
}

/** What a PLAYER may know about someone: their record once revealed, their own
 *  relation, the quests, and the ties revealed to them. Never GM notes — this
 *  component is never handed them. The console's "View as" uses it too. */
export function KnownCard({ n, web, onSelect, onClose }: {
  n: WebNode
  web: Web
  onSelect: (id: string) => void
  onClose: () => void
}) {
  const ties = web.edges.filter(e => e.from === n.id || e.to === n.id)
  const nameOf = (id: string) => (id === PARTY ? 'The party' : web.nodes.find(o => o.id === id)?.name ?? web.pcs.find(p => p.id === id)?.name ?? '?')
  const r = n.record
  return (
    <div className={styles.dossier}>
      <div className={styles.dHead}>
        <span className={styles.dDisc}>{n.system ? <span className={styles.diamond} /> : initials(n.name)}</span>
        <div className={styles.dTx}>
          <div className={styles.dName}>{n.name}</div>
          <div className={styles.dMeta}>{[r?.role, r?.location || (() => { const at = n.place ?? n.sector; return at !== 'Unplaced' && at !== 'System' ? at : '' })()].filter(Boolean).join(' · ') || 'Little is known'}</div>
        </div>
        <button type="button" className={styles.x} onClick={onClose} aria-label="Close"><i className="fa-solid fa-xmark" /></button>
      </div>
      {r?.blurb.trim() && <Prose text={r.blurb} className={styles.blurb} />}

      <div className={styles.dSub}>What you know <span>{ties.length}</span></div>
      {ties.map(e => {
        const other = e.from === n.id ? e.to : e.from
        const toNode = web.nodes.some(o => o.id === other)
        return (
          <div key={e.id} className={styles.tie}>
            <span className={cx(styles.tGlyph, e.kind === 'link' ? styles.tLink : e.kind === 'relation' ? styles.tRel : styles.tQuest)}>
              {e.kind === 'link' ? '◊' : e.kind === 'relation' ? '●' : '◇'}
            </span>
            {toNode
              ? <button type="button" className={styles.tWho} onClick={() => onSelect(other)}>{nameOf(other)}</button>
              : <span className={styles.tWho}>{nameOf(other)}</span>}
            <span />
            <span className={styles.tWhat}>
              {e.kind === 'relation' ? `${e.label}${e.attitude ? ` · ${ATTITUDE_LABEL[e.attitude]}` : ''}`
                : e.kind === 'quest' ? `Gave you ${e.label}${e.done ? ' · closed' : ''}`
                : e.kind === 'mention' ? `Named in ${e.label}`
                : `${e.label}${e.attitude ? ` · ${ATTITUDE_LABEL[e.attitude]}` : ''}`}
              {e.kind === 'relation' && e.desc?.trim() && <Prose text={e.desc} className={styles.relDesc} />}
            </span>
          </div>
        )
      })}
    </div>
  )
}
