import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useDmStatus, useDmParty } from '../lib/dm'
import { longRestPatch } from '../lib/rest'
import type { CharacterRow, CharacterUpdate, HP } from '../lib/database.types'
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

function toMember(c: CharacterRow): PartyMember {
  const hp = (c.sheet?.hp?.current ?? 0) as number
  const hpMax = (c.sheet?.hp?.max ?? 0) as number
  const tempHp = (c.sheet?.hp?.temp ?? 0) as number
  const raw = (c.resources?.activeEffects as { name?: string }[] | undefined) ?? []
  return {
    id: c.id,
    name: c.name,
    race: c.identity?.race ?? '—',
    cls: c.identity?.class ?? '—',
    level: c.identity?.level ?? '—',
    icon: 'fa-user',
    hp,
    hpMax,
    tempHp,
    // Presence is a realtime concern (a later slice) — unknown for now.
    online: false,
    // DM-only horror gauge. Lives in a DM-only table (RLS = dm_all) so it can
    // never reach a player client; that table + its value land in a later slice,
    // so it reads 0 here.
    digitization: 0,
    effects: raw.map(e => ({ name: e.name ?? 'Effect', kind: 'buff' as const })),
  }
}

const hpClassOf = (p: PartyMember): '' | 'warn' | 'crit' => {
  if (!p.hpMax) return ''
  const r = p.hp / p.hpMax
  return r <= 0.25 ? 'crit' : r <= 0.55 ? 'warn' : ''
}
const pctOf = (p: PartyMember) => (p.hpMax ? Math.max(0, Math.round((p.hp / p.hpMax) * 100)) : 0)

type View = 'overview' | 'character'

export function OperatorConsole() {
  const { session, loading: authLoading } = useAuth()
  const { isDm, loading: dmLoading } = useDmStatus()
  const { party, loading: partyLoading, error, updateCharacter } = useDmParty()

  const [view, setView] = useState<View>('overview')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  if (authLoading || dmLoading) return <Boot>Authorizing operator link…</Boot>
  if (!session) return <Navigate to="/login" replace />
  if (!isDm) return <Navigate to="/" replace />

  const members = party.map(toMember)
  const selected = members.find(m => m.id === selectedId) ?? null
  const selectedRow = party.find(c => c.id === selectedId) ?? null

  function openOverview() {
    setView('overview')
    setSelectedId(null)
  }
  function openCharacter(id: string) {
    setView('character')
    setSelectedId(id)
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
                <CampaignEntry icon="fa-scroll" title="Quest Log" sub="Campaign authoring" />
                <CampaignEntry icon="fa-book-bookmark" title="Session Log" sub="Recaps" />
                <CampaignEntry icon="fa-box-archive" title="Catalog" sub="Shared library" />

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
            <div className={styles.workTabs}>
              {/* "Oversee" is the oversight pane — party dashboard when nothing is
                  selected, the selected PC's action console otherwise. Clicking it
                  zooms back out to the party overview. */}
              <div className={cx(styles.wtab, styles.active)} onClick={openOverview} title="Party overview">Oversee</div>
              <div className={cx(styles.wtab, styles.disabled)} title="Lore editor — next slice">Lore Editor</div>
              <div className={cx(styles.wtab, styles.lvl, styles.disabled)} title="Level-up — later slice">
                <i className="fa-solid fa-arrow-up-right-dots" /> Level Up
              </div>
            </div>
            <div className={styles.workBody}>
              {error ? (
                <div className={styles.soonPanel}><i className="fa-solid fa-triangle-exclamation" /><span className={styles.big}>Link Error</span><span>{error}</span></div>
              ) : partyLoading ? (
                <div className={styles.soonPanel}><i className="fa-solid fa-spinner" /><span>Loading party…</span></div>
              ) : view === 'character' && selected && selectedRow ? (
                <ActionsTab row={selectedRow} member={selected} onUpdate={patch => updateCharacter(selectedRow.id, patch)} />
              ) : (
                <OverviewDashboard members={members} selectedId={selectedId} onSelect={openCharacter} />
              )}
            </div>
          </div>
        </section>

        {/* RIGHT — BROADCAST (scaffolding; wired in the realtime slice) */}
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
                <span className={styles.fieldLab}>System message</span>
                <textarea className={styles.bcArea} placeholder="Compose a G.U.I.D.E. system notice…" disabled />
                <span className={styles.fieldLab}>Broadcast + activity log arrive with the realtime slice.</span>
                <div className={styles.bcDivider}>Activity Log</div>
              </div>
              <div className={styles.logEmpty}>No operator actions yet.</div>
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

function CampaignEntry({ icon, title, sub }: { icon: string; title: string; sub: string }) {
  return (
    <button className={cx(styles.ovEntry, styles.disabled)} disabled title="Built in a later slice">
      <span className={styles.ovIc}><i className={`fa-solid ${icon}`} /></span>
      <span className={styles.ovTx}>
        <span className={styles.ovT}>{title}</span>
        <span className={styles.ovS}>{sub}</span>
      </span>
    </button>
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
function ActionsTab({ row, member, onUpdate }: {
  row: CharacterRow
  member: PartyMember
  onUpdate: (patch: CharacterUpdate) => Promise<void>
}) {
  const [hpAmt, setHpAmt] = useState(5)
  const [goldAmt, setGoldAmt] = useState(50)

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

  // ---- writes (each pre-spreads its section) ----
  const writeHp = (next: number, nextTemp = tempHp) =>
    onUpdate({ sheet: { ...sheet, hp: { ...hp, current: next, max: hpMax, temp: nextTemp } } })
  const heal = () => writeHp(Math.min(hpMax, hpCur + hpAmt))
  const damage = () => writeHp(Math.max(0, hpCur - hpAmt))
  const setHp = () => writeHp(Math.max(0, Math.min(hpMax, hpAmt)))
  const addTemp = () => writeHp(hpCur, tempHp + hpAmt)
  const longRest = () => onUpdate(longRestPatch(row).patch)

  const award = () => onUpdate({ sheet: { ...sheet, coins: { ...coins, gold: gold + goldAmt } } })
  const deduct = () => onUpdate({ sheet: { ...sheet, coins: { ...coins, gold: Math.max(0, gold - goldAmt) } } })

  const writeDeath = (next: { successes: number; failures: number }) =>
    onUpdate({ resources: { ...resources, deathSaves: next } })
  const setExh = (next: number) =>
    onUpdate({ resources: { ...resources, exhaustion: Math.max(0, Math.min(6, next)) } })

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

        {/* B — GRANT ITEM (deferred to the catalog slice) */}
        <div className={cx(styles.actCard, styles.soon)}>
          <span className={cx(styles.acCorner, styles.tl)} /><span className={cx(styles.acCorner, styles.br)} />
          <div className={styles.acTitle}><i className="fa-solid fa-box-open lead" /><span className={styles.num}>B</span><span className={styles.t}>Grant Item</span></div>
          <div className={styles.acSoon}><i className="fa-solid fa-box-archive" /><span>Arrives with the item catalog slice</span></div>
        </div>

        {/* C — APPLY EFFECT (deferred to the effect-catalog slice) */}
        <div className={cx(styles.actCard, styles.soon)}>
          <span className={cx(styles.acCorner, styles.tl)} /><span className={cx(styles.acCorner, styles.br)} />
          <div className={styles.acTitle}><i className="fa-solid fa-wand-sparkles lead" /><span className={styles.num}>C</span><span className={styles.t}>Apply Effect</span></div>
          <div className={styles.acSoon}><i className="fa-solid fa-wand-sparkles" /><span>Arrives with the effect catalog slice</span></div>
        </div>

        {/* D — CURRENCY */}
        <div className={styles.actCard}>
          <span className={cx(styles.acCorner, styles.tl)} /><span className={cx(styles.acCorner, styles.br)} />
          <div className={styles.acTitle}><i className="fa-solid fa-coins lead" /><span className={styles.num}>D</span><span className={styles.t}>Currency</span></div>
          <div className={styles.coinDisplay}><span className={styles.gp}>{gold.toLocaleString()}</span><span className={styles.gl}>Gold Pieces</span></div>
          <div className={styles.coinBreak}>
            <div className={cx(styles.coinCell, styles.gp)}><div className={styles.cn}>{gold.toLocaleString()}</div><div className={styles.ct}>GP</div></div>
            <div className={cx(styles.coinCell, styles.sp)}><div className={styles.cn}>{silver.toLocaleString()}</div><div className={styles.ct}>SP</div></div>
            <div className={cx(styles.coinCell, styles.cp)}><div className={styles.cn}>{copper.toLocaleString()}</div><div className={styles.ct}>CP</div></div>
          </div>
          <div className={styles.stepper}>
            <input className={styles.numIn} type="number" min={1} value={goldAmt}
              onChange={e => setGoldAmt(Math.max(0, parseInt(e.target.value || '0', 10) || 0))} />
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
      </div>

      <p className={styles.deferNote}>
        Grant Item, Apply Effect &amp; the activity log arrive in later slices.
      </p>
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
function Btn({ tone, sm, icon, label, onClick, disabled, title }: {
  tone: 'amber' | 'cyan' | 'good' | 'danger' | 'ghost'
  sm?: boolean; icon: string; label: string
  onClick?: () => void; disabled?: boolean; title?: string
}) {
  return (
    <button className={cx(styles.btn, styles[tone], sm && styles.sm)} onClick={onClick} disabled={disabled} title={title}>
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
