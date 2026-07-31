/**
 * Party presence — who is actually connected right now. A single Supabase
 * Realtime presence channel: player clients ANNOUNCE themselves (keyed by their
 * character id) and the Operator Console LISTENS, lighting the Link/Off LEDs
 * that were hardcoded offline until this slice.
 *
 * Presence is ephemeral channel state (no table, no migration): close the tab
 * and the entry evaporates after the heartbeat times out. Like the voice
 * channel, it isn't row-secured — fine for a private campaign; the only thing
 * shared is "this character's player has the app open".
 */

import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'

const CHANNEL = 'guide-presence'

/** Player side: announce this character as online while mounted. */
export function usePresenceAnnounce(characterId: string | undefined) {
  useEffect(() => {
    if (!characterId) return
    const ch = supabase.channel(CHANNEL, { config: { presence: { key: characterId } } })
    ch.subscribe(status => {
      // track() only sticks once the channel is joined.
      if (status === 'SUBSCRIBED') void ch.track({ at: Date.now() })
    })
    return () => {
      void supabase.removeChannel(ch) // untrack + leave
    }
  }, [characterId])
}

/** DM side: the set of character ids currently online, live-updated. */
export function usePartyPresence(): Set<string> {
  const [online, setOnline] = useState<Set<string>>(() => new Set())
  // Stable identity across syncs with identical membership, so consumers keyed
  // on the set don't re-render on every heartbeat.
  const lastKey = useRef('')

  useEffect(() => {
    const ch = supabase.channel(CHANNEL)
    const sync = () => {
      const ids = Object.keys(ch.presenceState())
      const key = ids.sort().join(',')
      if (key === lastKey.current) return
      lastKey.current = key
      setOnline(new Set(ids))
    }
    ch.on('presence', { event: 'sync' }, sync)
    ch.subscribe()
    return () => {
      void supabase.removeChannel(ch)
    }
  }, [])

  return online
}
