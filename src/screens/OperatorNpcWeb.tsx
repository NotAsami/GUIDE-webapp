import { ImageUpload } from '../components/ImageUpload'
/**
 * Operator Console — the NPC web: who knows whom, laid out for the DM.
 *
 * Nothing here is placed by hand. lib/npcWeb.ts derives the graph (PC relations,
 * quest givers and mentions, NPC ↔ NPC links) and lays it out as an orbit; the
 * drawing is components/NpcWebView.tsx, shared with the player's own relations
 * web so the two can never disagree. This file owns the console's half: the
 * editor, the ties, and who has been told about them.
 *
 * Design canvas: "Codex NPC Web", page "B · Orbit, chosen".
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { CharacterRow, NpcAttitude, NpcRow, QuestRow } from '../lib/database.types'
import {
  ATTITUDE_CYCLE, ATTITUDE_LABEL, LINK_TYPES, PARTY,
  asSeenBy, derive, layout, type Web, type WebEdge, type WebNode,
} from '../lib/npcWeb'
import { ATT_VAR, KnownCard, NpcWebView, SHOW_ALL, initials, type Show } from '../components/NpcWebView'
import type { DmNpcsState } from '../lib/npcs'
import { Prose } from '../lib/markdown'
import { proseField } from '../lib/textareaHooks'
import { ProsePreview } from '../components/ProsePreview'
import { Btn } from './OperatorBtn'
import styles from './OperatorNpcWeb.module.css'
import web from '../components/NpcWebView.module.css'
import con from './OperatorConsole.module.css'

const cx = (...xs: (string | false | undefined | null)[]) => xs.filter(Boolean).join(' ')

const DRAWER_W = 372

export function OperatorNpcWeb({ lib, party, quests, log }: {
  lib: DmNpcsState
  party: CharacterRow[]
  quests: QuestRow[]
  log: (node: ReactNode, kind?: 'cyan' | 'danger') => void
}) {
  /** Whose eyes: null is the Operator, seeing everything. Anyone else and the
   *  web is rebuilt from exactly what 0024's policies would hand that player. */
  const [asPc, setAsPc] = useState<string | null>(null)
  const seen = useMemo(() => (asPc ? asSeenBy(lib.npcs, lib.links, asPc) : { npcs: lib.npcs, links: lib.links }), [asPc, lib.npcs, lib.links])
  const cast = useMemo(() => (asPc ? party.filter(p => p.id === asPc) : party), [asPc, party])
  const graph = useMemo(() => derive(seen.npcs, seen.links, cast, quests), [seen, cast, quests])
  const orbit = useMemo(() => layout(graph), [graph])
  const nodeById = useMemo(() => new Map(graph.nodes.map(n => [n.id, n])), [graph])

  const [sel, setSel] = useState<string | null>(null)
  /** The drawer's form: a record id, or null with an optional name to start from. */
  const [editing, setEditing] = useState<{ id: string | null; name?: string } | null>(null)
  const [show, setShow] = useState<Show>(SHOW_ALL)
  const selected = sel ? nodeById.get(sel) ?? null : null
  // A selection whose node vanished (its record deleted, a reveal taken back).
  useEffect(() => { if (sel && !selected) setSel(null) }, [sel, selected])

  useEffect(() => {
    if (!sel && !editing) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select')) return
      setSel(null); setEditing(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sel, editing])

  const locations = useMemo(() => [...new Set([...quests.map(q => q.location), ...lib.npcs.map(n => n.location)]
    .map(s => s.trim()).filter(Boolean))].sort(), [quests, lib.npcs])

  async function save(id: string | null, fields: Omit<NpcRow, 'id' | 'known_to' | 'created_at' | 'updated_at'>, notes: string) {
    if (id) {
      if (!(await lib.update(id, fields))) return
      if (notes !== (lib.notes[id] ?? '')) await lib.saveNotes(id, notes)
      log(<>NPC <span className={con.obj}>{fields.name}</span> saved</>)
      setEditing(null)
      return
    }
    const row = await lib.create(fields)
    if (!row) return
    if (notes.trim()) await lib.saveNotes(row.id, notes)
    log(<>NPC <span className={con.obj}>{row.name}</span> added to the web</>, 'cyan')
    setEditing(null)
    setSel(`npc:${row.id}`)
  }

  const drawerOpen = !!(selected || editing)
  return (
    <div className={web.web}>
      <NpcWebView
        web={graph} orbit={orbit} sel={sel} show={show} drawerOpen={drawerOpen} drawerW={DRAWER_W}
        onSelect={id => { setEditing(null); setSel(id) }}
        empty={
          <div className={web.empty}>
            <span className={web.emptyT}>{asPc ? 'They have met nobody yet' : 'No one on the web yet'}</span>
            <span>{asPc
              ? 'Their own Lore relations and the quest givers appear here by themselves; everything else is what you reveal.'
              : 'A PC’s Lore relations, every quest giver, and each NPC you add here all appear on it by themselves.'}</span>
          </div>
        }
      >
        <div className={web.toolbar}>
          <button type="button" className={web.tool} onClick={() => { setSel(null); setEditing({ id: null }) }}>+ NPC</button>
          <span className={web.toolSep} />
          {([['relation', 'Relations'], ['quest', 'Quests'], ['link', 'NPC links']] as const).map(([k, label]) => (
            <button key={k} type="button" className={cx(web.tool, show[k] && web.on)} aria-pressed={show[k]}
              onClick={() => setShow(s => ({ ...s, [k]: !s[k] }))}>{label}</button>
          ))}
          <span className={web.toolSep} />
          {/* WHAT THEY SEE, without signing in as them: the same filter the
              player's own screen gets from RLS. */}
          <select className={cx(styles.viewAs, asPc && styles.on)} value={asPc ?? ''} aria-label="View as"
            onChange={e => { setSel(null); setEditing(null); setAsPc(e.target.value || null) }}>
            <option value="">View as Operator</option>
            {party.map(p => <option key={p.id} value={p.id}>View as {p.name}</option>)}
          </select>
          {selected && (
            <span className={web.focusTag}>
              {selected.name} and their ties
              <button type="button" className={web.tool} onClick={() => setSel(null)}>Esc · whole web</button>
            </span>
          )}
          <span className={web.count}>{graph.nodes.length} people · {orbit.sectors.length} places</span>
        </div>

        {drawerOpen && (
          <aside className={web.drawer} style={{ width: DRAWER_W }} aria-label={editing ? 'Edit NPC' : selected?.name}>
            {editing ? (
              <NpcForm
                key={editing.id ?? `new:${editing.name ?? ''}`}
                record={editing.id ? lib.npcs.find(r => r.id === editing.id) ?? null : null}
                notes={editing.id ? lib.notes[editing.id] ?? '' : ''}
                startName={editing.name} locations={locations} error={lib.error}
                onSave={(f, notes) => void save(editing.id, f, notes)}
                onDelete={editing.id ? async () => {
                  const r = lib.npcs.find(x => x.id === editing.id)
                  await lib.remove(editing.id!)
                  log(<>NPC <span className={con.obj}>{r?.name}</span> removed from the web</>, 'danger')
                  setEditing(null); setSel(null)
                } : undefined}
                onCancel={() => setEditing(null)}
              />
            ) : selected && (asPc ? (
              <KnownCard n={selected} web={graph} onSelect={setSel} onClose={() => setSel(null)} />
            ) : (
              <Dossier
                n={selected} web={graph} lib={lib} party={party}
                onSelect={setSel}
                onEdit={() => setEditing(selected.record ? { id: selected.record.id } : { id: null, name: selected.name })}
                onClose={() => setSel(null)}
                log={log}
              />
            ))}
          </aside>
        )}
      </NpcWebView>
    </div>
  )
}

function Dossier({ n, web: graph, lib, party, onSelect, onEdit, onClose, log }: {
  n: WebNode; web: Web; lib: DmNpcsState; party: CharacterRow[]
  onSelect: (id: string) => void
  onEdit: () => void
  onClose: () => void
  log: (node: ReactNode, kind?: 'cyan' | 'danger') => void
}) {
  const ties = graph.edges.filter(e => e.from === n.id || e.to === n.id)
  const [tieTo, setTieTo] = useState('')
  const nameOf = (id: string) => (id === PARTY ? 'The party' : graph.nodes.find(o => o.id === id)?.name ?? party.find(p => p.id === id)?.name ?? '?')
  const linked = new Set(ties.filter(e => e.kind === 'link').map(e => (e.from === n.id ? e.to : e.from)))
  const candidates = graph.nodes.filter(o => o.record && o.id !== n.id && !linked.has(o.id))
  const r = n.record

  return (
    <div className={web.dossier}>
      <div className={web.dHead}>
        <span className={web.dDisc}>{n.system ? <span className={web.diamond} /> : initials(n.name)}</span>
        <div className={web.dTx}>
          <div className={web.dName}>{n.name}</div>
          <div className={web.dMeta}>{[r?.role, n.sector].filter(Boolean).join(' · ')}{!r && ' · no record yet'}</div>
        </div>
        <button type="button" className={web.x} onClick={onClose} aria-label="Close"><i className="fa-solid fa-xmark" /></button>
      </div>
      {r?.blurb.trim() && <Prose text={r.blurb} className={web.blurb} />}

      {r && (
        <>
          <div className={web.dSub}>Revealed to</div>
          <div className={styles.reveal}>
            {party.map(p => {
              const on = r.known_to.includes(p.id)
              return (
                <button key={p.id} type="button" aria-pressed={on} className={cx(styles.chip, on && styles.on)}
                  onClick={async () => {
                    if (await lib.reveal(r.id, p.id, !on)) {
                      log(<>{on ? 'Hid' : 'Revealed'} <span className={con.obj}>{n.name}</span> {on ? 'from' : 'to'} <span className={con.who}>{p.name}</span></>, on ? 'danger' : 'cyan')
                    }
                  }}>
                  {p.name}
                </button>
              )
            })}
          </div>
          <div className={styles.hint}>They may already know the name from a relation or a quest. Revealing shows them the rest.</div>
        </>
      )}

      <div className={web.dSub}>Ties <span>{ties.length}</span></div>
      {ties.map(e => {
        const other = e.from === n.id ? e.to : e.from
        const toNode = other !== PARTY && graph.nodes.some(o => o.id === other)
        const pcName = party.find(p => p.id === e.from)?.name
        return (
          <div key={e.id} className={web.tie}>
            <span className={cx(web.tGlyph, e.kind === 'link' ? web.tLink : e.kind === 'relation' ? web.tRel : web.tQuest)}>
              {e.kind === 'link' ? '◊' : e.kind === 'relation' ? '●' : '◇'}
            </span>
            {toNode
              ? <button type="button" className={web.tWho} onClick={() => onSelect(other)}>{nameOf(other)}</button>
              : <span className={web.tWho}>{nameOf(other)}</span>}
            <span />
            {e.kind === 'link' ? (
              <LinkControls e={e} lib={lib} party={party} log={log}
                onRemove={() => log(<>Tie between <span className={con.obj}>{n.name}</span> and <span className={con.obj}>{nameOf(other)}</span> removed</>, 'danger')} />
            ) : (
              <span className={web.tWhat}>
                {e.kind === 'relation' ? `${e.label}${e.attitude ? ` · ${ATTITUDE_LABEL[e.attitude]}` : ''}`
                  : e.kind === 'quest' ? `Gave ${e.label}${e.done ? ' · closed' : ''}` : `Named in ${e.label}`}
                <span className={web.tSrc}> · {e.kind === 'relation' ? `${pcName ?? 'their'}'s lore` : 'Quest Log'}</span>
              </span>
            )}
          </div>
        )
      })}

      {r && (
        <div className={styles.addTie}>
          <select className={con.selIn} value={tieTo} onChange={e => setTieTo(e.target.value)} aria-label="Tie to">
            <option value="">Tie to someone…</option>
            {candidates.map(o => <option key={o.id} value={o.record!.id}>{o.name}</option>)}
          </select>
          <Btn tone="ghost" sm icon="fa-link" label="Tie" disabled={!tieTo} onClick={async () => {
            if (await lib.link({ a: r.id, b: tieTo, kind: LINK_TYPES[0] })) {
              log(<>Tied <span className={con.obj}>{n.name}</span> to <span className={con.obj}>{lib.npcs.find(x => x.id === tieTo)?.name}</span></>, 'cyan')
              setTieTo('')
            }
          }} />
        </div>
      )}
      {lib.error && <div className={styles.err}>{lib.error}</div>}

      {r && lib.notes[r.id]?.trim() && (
        <div className={styles.gm}><span className={styles.gmT}>GM Notes</span><span className={styles.gmB}>{lib.notes[r.id]}</span></div>
      )}

      <div className={styles.dActions}>
        <Btn tone="amber" icon={r ? 'fa-pen' : 'fa-plus'} label={r ? 'Edit NPC' : 'Create a record'} onClick={onEdit} />
      </div>
    </div>
  )
}

function LinkControls({ e, lib, party, onRemove, log }: {
  e: WebEdge; lib: DmNpcsState; party: CharacterRow[]
  onRemove: () => void
  log: (node: ReactNode, kind?: 'cyan' | 'danger') => void
}) {
  const row = lib.links.find(l => l.id === e.linkId)
  const [label, setLabel] = useState(row?.label ?? '')
  if (!row) return null
  const next = ATTITUDE_CYCLE[(ATTITUDE_CYCLE.indexOf(row.attitude as NpcAttitude) + 1) % ATTITUDE_CYCLE.length]
  return (
    <div className={styles.linkBox}>
      <span className={styles.lc}>
        <select className={styles.lcKind} value={row.kind} onChange={ev => void lib.updateLink(row.id, { kind: ev.target.value })} aria-label="Kind of tie">
          {LINK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <button type="button" className={styles.lcAtt} title={`${ATTITUDE_LABEL[row.attitude ?? ''] ?? 'Unknown'} — click to cycle`} aria-label="Cycle attitude"
          onClick={() => void lib.updateLink(row.id, { attitude: next })}>
          <i style={{ background: ATT_VAR[row.attitude ?? ''] ?? 'transparent' }} />
        </button>
        <input className={styles.lcLabel} value={label} placeholder="Label…" aria-label="Label"
          onChange={ev => setLabel(ev.target.value)}
          onBlur={() => { if (label !== row.label) void lib.updateLink(row.id, { label }) }} />
        <button type="button" className={styles.lcX} aria-label="Remove tie" onClick={async () => { await lib.unlink(row.id); onRemove() }}>
          <i className="fa-solid fa-xmark" />
        </button>
      </span>
      {/* Revealing a tie reveals both people on it — see revealTie(). */}
      <span className={styles.reveal}>
        <span className={styles.revealT}>Known to</span>
        {party.map(p => {
          const on = row.known_to.includes(p.id)
          return (
            <button key={p.id} type="button" aria-pressed={on} className={cx(styles.chip, on && styles.on)}
              title={on ? `Hide this tie from ${p.name}` : `Reveal this tie to ${p.name}, and both people on it`}
              onClick={async () => {
                if (await lib.revealLink(row.id, p.id, !on)) {
                  log(<>{on ? 'Hid a tie from' : 'Revealed a tie to'} <span className={con.who}>{p.name}</span></>, on ? 'danger' : 'cyan')
                }
              }}>
              {initials(p.name)}
            </button>
          )
        })}
      </span>
    </div>
  )
}

function NpcForm({ record, notes, startName, locations, error, onSave, onDelete, onCancel }: {
  record: NpcRow | null
  notes: string
  startName?: string
  locations: string[]
  error: string | null
  onSave: (fields: Omit<NpcRow, 'id' | 'known_to' | 'created_at' | 'updated_at'>, notes: string) => void
  onDelete?: () => void
  onCancel: () => void
}) {
  const [name, setName] = useState(record?.name ?? startName ?? '')
  const [role, setRole] = useState(record?.role ?? '')
  const [location, setLocation] = useState(record?.location ?? '')
  const [portrait, setPortrait] = useState(record?.portrait ?? '')
  const [imagePending, setImagePending] = useState(false)
  const [blurb, setBlurb] = useState(record?.blurb ?? '')
  const [gm, setGm] = useState(notes)
  const fields = { name: name.trim(), role: role.trim(), location: location.trim(), portrait: portrait.trim(), blurb }

  return (
    <div className={styles.form}>
      <div className={styles.fHead}>
        <span className={styles.fT}>{record ? 'Edit NPC' : 'New NPC'}</span>
        <button type="button" className={web.x} onClick={onCancel} aria-label="Cancel"><i className="fa-solid fa-xmark" /></button>
      </div>
      <label className={con.fieldLab} htmlFor="npc-name">Name</label>
      <input id="npc-name" className={con.sessIn} value={name} onChange={e => setName(e.target.value)} placeholder="As the party and the Quest Log call them" />
      <label className={con.fieldLab} htmlFor="npc-role">Role or epithet</label>
      <input id="npc-role" className={con.sessIn} value={role} onChange={e => setRole(e.target.value)} placeholder="e.g. the title they go by" />
      <label className={con.fieldLab} htmlFor="npc-loc">Location · their place on the web</label>
      <input id="npc-loc" className={con.sessIn} value={location} onChange={e => setLocation(e.target.value)} list="npc-locations" placeholder="Empty: the place of a quest they gave, else Unplaced" />
      <datalist id="npc-locations">{locations.map(l => <option key={l} value={l} />)}</datalist>
      <span className={con.fieldLab}>Portrait · optional</span>
      <ImageUpload value={portrait} onChange={setPortrait} onPendingChange={setImagePending} scope="npcs" aspect={1} />
      <div className={con.qLabRow}>
        <span className={con.fieldLab}>What the party knows</span>
        <ProsePreview text={blurb} />
      </div>
      <textarea className={cx(con.qPlayerDesc, styles.ta)} value={blurb} onChange={e => setBlurb(e.target.value)}
        {...proseField(setBlurb)} placeholder="What a player reads once this NPC is revealed to them…" />
      <span className={con.fieldLab}>GM Notes · npc_secrets, never readable by a player</span>
      <textarea className={cx(con.gmNotes, styles.ta)} value={gm} onChange={e => setGm(e.target.value)} placeholder="Their secret, their agenda — DM eyes only…" />
      {error && <div className={styles.err}>{error}</div>}
      <div className={styles.fActions}>
        <Btn tone="amber" icon="fa-floppy-disk" label={record ? 'Save NPC' : 'Add to the web'} onClick={() => onSave(fields, gm)} disabled={!fields.name || imagePending} />
        {onDelete && <Btn tone="danger" icon="fa-trash" label="Delete" onClick={onDelete} />}
      </div>
    </div>
  )
}
