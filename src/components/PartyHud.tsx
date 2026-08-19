/**
 * PARTY HUD — the rest of the party, in the flanks beside the nav.
 *
 * Three rows per side, six slots total. Each row is one other player character:
 * identity colour, class diamond, name, HP, running conditions, death saves
 * when they are down, and effective AC.
 *
 * WHERE THE NUMBERS COME FROM — two transports, one compiler:
 *
 *   offline / first paint   `list_party_roster()` → the stored `public_vitals`
 *   online / live           the presence channel's payload (lib/presence.ts)
 *
 * Realtime respects RLS, so a player can never subscribe to another player's
 * row UPDATEs — the DM console's live-sync pattern is not available here. Both
 * values are produced by `publicVitals()` in lib/vitals.ts, so the two paths
 * cannot disagree; the merge is `presence.get(id) ?? row.public_vitals`.
 *
 * An offline member keeps their slot, dimmed, showing what was last known. The
 * list does not reshuffle when somebody closes a tab.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { usePartyRoster } from '../lib/party'
import type { PartyRosterRow, PublicVitals } from '../lib/database.types'
import styles from './PartyHud.module.css'

/** Six identity hues, assigned by character id so a player's colour is stable
 *  across sessions. Chosen clear of every colour that already MEANS something
 *  in this UI — cyan is a buff and a full HP bar, --danger is a fail and a crit
 *  row, beige is the chrome. A stripe that could be mistaken for any of those
 *  would be reporting a status it does not know. */
const HUES = ['#8b6dd6', '#c8578f', '#4aa882', '#d1893f', '#9aab45', '#6f7fa8'] as const

export function hueFor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return HUES[h % HUES.length]
}

const CLASS_ICONS: Record<string, string> = {
  fighter: 'fa-shield-halved', barbarian: 'fa-hand-fist', monk: 'fa-hand-back-fist',
  paladin: 'fa-cross', ranger: 'fa-bullseye', rogue: 'fa-mask',
  wizard: 'fa-hat-wizard', sorcerer: 'fa-wand-sparkles', warlock: 'fa-book-skull',
  cleric: 'fa-place-of-worship', druid: 'fa-leaf', bard: 'fa-music',
  artificer: 'fa-gears',
}

/** Best icon for a class name. Unknown or homebrew classes (this campaign has
 *  its own) fall back rather than guessing. */
export function iconFor(cls: string | null): string {
  const key = (cls ?? '').trim().toLowerCase()
  return CLASS_ICONS[key] ?? 'fa-user'
}

/** How many condition pips fit before the row starts to crowd the AC. */
const MAX_PIPS = 4

/** `presence` is passed in rather than hooked here on purpose: there is one
 *  channel per topic, and Layout already joins it to announce this character.
 *  A second `usePartyPresence()` in this component would resolve to that same
 *  channel and quietly discard its presence key. */
export function PartyHud({ presence }: { presence: Map<string, PublicVitals | null> }) {
  const { roster } = usePartyRoster()

  // Stable order, so a row never swaps sides when presence changes.
  const members = useMemo(
    () => [...roster].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 6),
    [roster],
  )

  /* Rows that just came online, so the pop-out plays once and does not replay
     on every later heartbeat. */
  const [entering, setEntering] = useState<Set<string>>(() => new Set())
  const prevOnline = useRef<Set<string> | null>(null)
  useEffect(() => {
    const now = new Set(presence.keys())
    const prev = prevOnline.current
    prevOnline.current = now
    if (!prev) return // first sync: no pop, the HUD is simply already there
    const fresh = [...now].filter(id => !prev.has(id))
    if (!fresh.length) return
    setEntering(new Set(fresh))
    const t = setTimeout(() => setEntering(new Set()), 400)
    return () => clearTimeout(t)
  }, [presence])

  if (!members.length) return null

  const column = (rows: PartyRosterRow[], side: 'left' | 'right') => (
    <aside
      className={`${styles.hud} ${styles[side]}`}
      aria-label={side === 'left' ? 'Party status' : 'Party status, continued'}
    >
      {rows.map(m => (
        <Row
          key={m.id}
          row={m}
          vitals={presence.get(m.id) ?? m.public_vitals}
          online={presence.has(m.id)}
          entering={entering.has(m.id)}
        />
      ))}
    </aside>
  )

  return (
    <>
      {column(members.slice(0, 3), 'left')}
      {members.length > 3 && column(members.slice(3, 6), 'right')}
    </>
  )
}

function Row({ row, vitals, online, entering }: {
  row: PartyRosterRow
  vitals: PublicVitals | null
  online: boolean
  entering: boolean
}) {
  // The roster's raw hp_* columns are the floor: a character whose client has
  // never run under migration 0018 still gets a bar rather than a blank row.
  const hp = vitals?.hp ?? row.hp_current ?? 0
  const hpMax = vitals?.hpMax ?? row.hp_max ?? 0
  const pct = hpMax > 0 ? Math.max(0, Math.min(1, hp / hpMax)) : 0
  const crit = hpMax > 0 && pct <= 0.5
  const down = hp <= 0

  const effects = vitals?.effects ?? []
  const shown = effects.slice(0, MAX_PIPS)
  const hidden = effects.length - shown.length

  const cls = [styles.row, online ? '' : styles.off, crit ? styles.crit : '', entering ? styles.enter : '']
    .filter(Boolean).join(' ')

  return (
    <div
      className={cls}
      style={{ ['--hue' as string]: hueFor(row.id) }}
      title={`${row.name}${row.class ? ` · ${row.class}` : ''}${row.level ? ` · level ${row.level}` : ''}`
        + `${online ? '' : ' · offline'}`}
    >
      <span className={styles.line} aria-hidden="true" />
      <span className={styles.dia} aria-hidden="true"><i className={`fa-solid ${iconFor(row.class)}`} /></span>

      <span className={styles.nm}>{row.name}</span>

      <span className={styles.hp}>
        <span>{hp}</span>
        <span className={styles.sl}>/{hpMax}</span>
        {!!vitals?.temp && <span className={styles.temp} title="Temporary HP">+{vitals.temp}</span>}
      </span>

      {!!shown.length && (
        <span className={styles.chips}>
          {shown.map((e, i) => (
            <span
              key={`${e.name}-${i}`}
              className={`${styles.pip} ${e.kind === 'buff' ? '' : styles.bad}`}
              title={e.name}
              aria-label={e.name}
            >
              <i className={`fa-solid ${e.icon ?? (e.kind === 'buff' ? 'fa-arrow-up' : 'fa-triangle-exclamation')}`} />
            </span>
          ))}
          {hidden > 0 && <span className={styles.more} title={effects.slice(MAX_PIPS).map(e => e.name).join(', ')}>+{hidden}</span>}
        </span>
      )}

      {/* Death saves appear only while they are actually down — three empty
          circles on a healthy row would be furniture reporting nothing. */}
      {down && (
        <span className={styles.ds} title={`Death saves — ${vitals?.deathOk ?? 0} succeeded, ${vitals?.deathFail ?? 0} failed`}>
          {[0, 1, 2].map(i => (
            <b key={i} className={
              i < (vitals?.deathFail ?? 0) ? styles.fail
                : i < (vitals?.deathFail ?? 0) + (vitals?.deathOk ?? 0) ? styles.ok : ''
            } />
          ))}
        </span>
      )}

      <span className={styles.ac}>
        <span className={styles.k}>AC</span>
        <span>{vitals?.ac ?? '—'}</span>
      </span>

      <span className={styles.track} aria-hidden="true"><i style={{ width: `${pct * 100}%` }} /></span>
    </div>
  )
}
