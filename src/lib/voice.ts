/**
 * The G.U.I.D.E. "voice" — a Supabase Realtime broadcast channel carrying the
 * Operator's pushes to player clients: system notices, ITEM ACQUIRED pings and
 * effect notifications. Ephemeral by design (no table, no migration): a notice
 * is a moment, not a record — an offline player simply misses it, exactly like
 * a tabletop aside. The DM console SENDS on this channel; the player Layout
 * LISTENS and renders toasts (components/SystemToasts.tsx).
 *
 * Scope note: broadcast channels are not row-secured like Postgres tables — any
 * authenticated client that knows the channel name could listen. Acceptable for
 * a private 3–4 player campaign; nothing spoiler-grade is ever sent here (the
 * DM-only layer stays in the RLS-walled tables).
 */

import { useEffect, useRef } from 'react'
import { supabase } from './supabase'

export type VoiceTone = 'normal' | 'corrupted'

export type VoiceMsg =
  /** Free-text system notice (the Broadcast panel). */
  | { kind: 'notice'; target: string; message: string; tone: VoiceTone }
  /** Grant Item ping — the ITEM ACQUIRED toast. */
  | { kind: 'item'; target: string; name: string; icon?: string; rarity?: string }
  /** Apply Effect ping. */
  | { kind: 'effect'; target: string; name: string; dur?: string }
  /** Currency ping — coins awarded to / deducted from the PC. */
  | { kind: 'coins'; target: string; amount: number; coin: 'gold' | 'silver' | 'copper'; op: 'award' | 'deduct' }

/** `target` is a character id, or 'all' for the whole party. */
export const ALL_PARTY = 'all'

const CHANNEL = 'guide-voice'
const EVENT = 'voice'

/**
 * Join the voice channel. Pass `onMessage` to listen (player side); use the
 * returned `send` to push (DM side). One hook serves both ends — the callback
 * lives in a ref so re-renders never tear the subscription down.
 * `send` resolves false when the push didn't go through (still connecting).
 */
export function useGuideVoice(onMessage?: (msg: VoiceMsg) => void): (msg: VoiceMsg) => Promise<boolean> {
  const cbRef = useRef(onMessage)
  cbRef.current = onMessage
  const chRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  useEffect(() => {
    const ch = supabase.channel(CHANNEL)
    ch.on('broadcast', { event: EVENT }, ({ payload }) => {
      cbRef.current?.(payload as VoiceMsg)
    })
    ch.subscribe()
    chRef.current = ch
    return () => {
      chRef.current = null
      void supabase.removeChannel(ch)
    }
  }, [])

  return async (msg: VoiceMsg) => {
    const ch = chRef.current
    if (!ch || ch.state !== 'joined') return false
    const res = await ch.send({ type: 'broadcast', event: EVENT, payload: msg })
    return res === 'ok'
  }
}
