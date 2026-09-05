/**
 * The Foundry bridge channel — a Supabase Realtime broadcast carrying messages
 * between this app and the `guide-bridge` module running in the DM's Foundry
 * client (foundry/guide-bridge/).
 *
 * Its own topic, never `guide-voice`: a second channel on one topic silently
 * reuses the first socket and drops its config (see lib/presence.ts). For the
 * same reason this module owns ONE channel for the whole app and hands out
 * listeners, rather than a hook that opens a channel per component — the roll
 * panel and the operator console both send on it, and two subscriptions to one
 * topic is the trap, not the fix.
 *
 * Ephemeral by design, like the voice: Foundry is the record of the combat and
 * this app is the record of the character. Neither needs a log of the wire.
 *
 * Scope note: a broadcast channel is not row-secured. Same call as voice.ts —
 * acceptable for a private table, and nothing spoiler-grade travels here.
 */

import { useEffect, useRef } from 'react'
import { supabase } from './supabase'
import type { DamageAmount } from './foundryDamage.ts'

/** The dnd5e actor document the exporter builds. Deliberately loose: the shape
 *  is dnd5e's, not ours, and typing it here would be a second claim about a
 *  schema we do not own. */
export type FoundryActorData = Record<string, unknown>

export type BridgeMsg =
  /** Foundry → app. A combat turn began for the mapped character. */
  | { kind: 'turn'; character: string; combat: string; round: number; turn: number }
  /** App → Foundry. Post a settled roll to chat, spoken by the character. */
  | { kind: 'roll'; character: string; title: string; html: string }
  /** Foundry → app. The GM targeted (or cleared) a token for this character.
   *  `token: null` is an untarget — the message always states the whole
   *  selection, so a dropped message cannot leave a stale target behind. */
  | { kind: 'target'; character: string; token: { token: string; name: string; ac?: number } | null }
  /** App → Foundry. Apply this roll's damage to the token it was against.
   *  Typed, so dnd5e's own resistance and immunity maths runs on the way in —
   *  the app never second-guesses what the creature is made of. */
  | { kind: 'apply'; token: string; damage: DamageAmount[] }
  /** App → Foundry. Toggle a condition on a targeted creature. `on: false`
   *  clears it. Foundry's own status ids — see FOUNDRY_CONDITIONS. */
  | { kind: 'condition'; token: string; status: string; on: boolean }
  /** App → Foundry. Create or update the party actors. */
  | { kind: 'actors'; actors: { character: string; data: FoundryActorData }[] }
  /** Foundry → app. A creature the party is fighting has dropped to 0 HP.
   *  Party-wide and nameless of a character on purpose: who felled it is a
   *  question the table answers, not the bridge. */
  | { kind: 'downed'; name: string }
  /** Foundry → app. The actor-id → character-id map after a sync. */
  | { kind: 'mapped'; map: Record<string, string> }

const CHANNEL = 'guide-foundry'
const EVENT = 'fvtt'

const listeners = new Set<(msg: BridgeMsg) => void>()
let joined: Promise<boolean> | null = null

/** Join once, lazily. Every later caller gets the same channel and the same
 *  promise, so a send that races the subscription waits for it instead of
 *  failing on a channel that is one tick from ready. */
function bridge(): Promise<boolean> {
  if (joined) return joined
  const ch = supabase.channel(CHANNEL)
  ch.on('broadcast', { event: EVENT }, ({ payload }) => {
    for (const fn of listeners) fn(payload as BridgeMsg)
  })
  joined = new Promise<boolean>(resolve => {
    ch.subscribe(status => {
      if (status === 'SUBSCRIBED') resolve(true)
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') resolve(false)
    })
  }).then(ok => {
    send.ch = ok ? ch : null
    return ok
  })
  return joined
}

async function send(msg: BridgeMsg): Promise<boolean> {
  const ok = await bridge()
  if (!ok || !send.ch) return false
  return (await send.ch.send({ type: 'broadcast', event: EVENT, payload: msg })) === 'ok'
}
send.ch = null as ReturnType<typeof supabase.channel> | null

/** Push a message to the Foundry client. Resolves false when the channel never
 *  joined — no bridge is a normal state (Foundry closed), never an error. */
export const sendFoundry = send

/** Listen. The callback lives in a ref so re-renders never re-register it. */
export function useFoundryMessages(onMessage: (msg: BridgeMsg) => void): void {
  const cbRef = useRef(onMessage)
  cbRef.current = onMessage
  useEffect(() => {
    const fn = (msg: BridgeMsg) => cbRef.current(msg)
    listeners.add(fn)
    void bridge()
    return () => { listeners.delete(fn) }
  }, [])
}

/**
 * The turn half, filtered and deduplicated so the caller only has to say what a
 * turn boundary DOES.
 *
 * A turn advance is a WRITE (effects tick, per-turn variables reset, uses
 * recharge). A re-broadcast — a reconnect, the GM stepping back and forward —
 * must not run it twice, so the same `${combat}:${round}:${turn}` position is
 * accepted exactly once. A position, not a counter: stepping back to a turn
 * already advanced is the one case where doing nothing is right.
 */
export function useFoundryTurn(characterId: string | undefined, onTurn: () => void): void {
  const seen = useRef<string | null>(null)
  const cbRef = useRef(onTurn)
  cbRef.current = onTurn
  useFoundryMessages(msg => {
    if (msg.kind !== 'turn' || !characterId || msg.character !== characterId) return
    const at = `${msg.combat}:${msg.round}:${msg.turn}`
    if (seen.current === at) return
    seen.current = at
    cbRef.current()
  })
}
