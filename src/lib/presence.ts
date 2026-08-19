/**
 * Party presence — who is actually connected right now, and the vitals each of
 * them is broadcasting. A single Supabase Realtime presence channel: clients
 * ANNOUNCE themselves (keyed by their character id) and everyone LISTENS —
 * the Operator Console for its Link/Off LEDs, the party HUD for live numbers.
 *
 * ONE HOOK, because there can only be ONE channel per topic. Announcing and
 * listening used to be separate hooks that were never mounted on the same page
 * (the console only listened, the player app only announced). The party HUD put
 * both in the player app, and the second `supabase.channel('guide-presence')`
 * did not get its own socket — it resolved to the one already open, silently
 * DISCARDING the `presence: { key: characterId }` config that came with it. The
 * player then announced under a random UUID instead of their character id,
 * which breaks every lookup keyed on that id, the console's LEDs included.
 *
 * Presence is ephemeral channel state (no table, no migration): close the tab
 * and the entry evaporates after the heartbeat times out. Like the voice
 * channel, it isn't row-secured — fine for a private campaign; the only thing
 * shared is "this character's player has the app open".
 */

import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import type { PublicVitals } from './database.types'
import { livePresence, PRESENCE_HEARTBEAT_MS, type PresenceEntry } from './vitals.ts'

const CHANNEL = 'guide-presence'
/**
 * Join the party-presence channel and read it.
 *
 * Pass `selfId` to announce this character as online while mounted; omit it to
 * listen only (the Operator Console). `vitals` rides along in the payload —
 * Realtime respects RLS, so a player subscribing to `characters` UPDATEs only
 * ever receives their OWN row, and the DM console's live-sync trick is not
 * available to the party HUD. The presence channel is already open and already
 * syncing, so the numbers travel in it: live, instant, no extra database load.
 *
 * `characters.public_vitals` remains the source for anyone OFFLINE. Both values
 * come from the same lib/vitals.ts compiler — one answer, two transports.
 *
 * Returns the online character ids mapped to what each is broadcasting. A Map
 * rather than a Set because the payload matters now; `.has()` and `.size` are
 * unchanged, so presence-only callers read exactly as they did before.
 */
export function usePartyPresence(
  selfId?: string,
  vitals?: PublicVitals | null,
): Map<string, PublicVitals | null> {
  const [online, setOnline] = useState<Map<string, PublicVitals | null>>(() => new Map())
  // Stable identity across syncs with identical membership AND identical
  // vitals, so consumers don't re-render on every heartbeat.
  const lastKey = useRef('')
  const chRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const vitalsRef = useRef<PublicVitals | null | undefined>(vitals)
  vitalsRef.current = vitals

  useEffect(() => {
    const ch = selfId
      ? supabase.channel(CHANNEL, { config: { presence: { key: selfId } } })
      : supabase.channel(CHANNEL)
    chRef.current = ch

    const sync = () => {
      const next = livePresence(ch.presenceState<PresenceEntry>())
      const key = JSON.stringify([...next])
      if (key === lastKey.current) return
      lastKey.current = key
      setOnline(next)
    }
    ch.on('presence', { event: 'sync' }, sync)

    let beat: ReturnType<typeof setInterval> | undefined
    ch.subscribe(status => {
      // track() only sticks once the channel is joined.
      if (status !== 'SUBSCRIBED') return
      if (selfId) {
        void ch.track({ at: Date.now(), v: vitalsRef.current ?? null })
        /* HEARTBEAT. Presence entries from dead sockets were observed lingering
           for minutes, so "still listed" cannot mean "still here" — liveness is
           decided from `at` instead, and that only works if a client that IS
           here keeps refreshing it. */
        beat = setInterval(() => {
          void ch.track({ at: Date.now(), v: vitalsRef.current ?? null })
        }, PRESENCE_HEARTBEAT_MS)
      }
    })

    /* Staleness passes with the clock, not with an event: the last watcher to
       hear from someone gets no notification when they stop talking. Re-derive
       on a timer so a row can go offline on its own. */
    const sweep = setInterval(sync, PRESENCE_HEARTBEAT_MS)

    return () => {
      chRef.current = null
      if (beat) clearInterval(beat)
      clearInterval(sweep)
      void supabase.removeChannel(ch) // untrack + leave
    }
  }, [selfId])

  // A vitals change re-TRACKS on the live channel rather than rejoining it,
  // which would drop this character off every watcher's HUD and pop them back.
  useEffect(() => {
    if (!selfId || !chRef.current) return
    void chRef.current.track({ at: Date.now(), v: vitals ?? null })
  }, [selfId, vitals])

  return online
}
