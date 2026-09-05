/**
 * WHO THE ROLL IS AGAINST — the target the DM has selected in Foundry.
 *
 * EPHEMERAL, like the voice channel and for the same reason: a target is a
 * moment, not a record. It never reaches the character row, so a closed Foundry
 * simply means no target, and the app behaves exactly as it did before the
 * bridge existed. Nothing here is spoiler-safe to display — the AC arrives so
 * the app can decide hit or miss, and the screens show the VERDICT, never the
 * number.
 *
 * A module-level latch rather than a context provider: the bridge delivers a
 * target once, and a screen mounted afterwards (opening Equipment) must not
 * come up empty because it missed the message. Subscribers re-render; the latch
 * is what a new one reads on its first paint.
 */

import { useEffect, useState } from 'react'
import { useFoundryMessages } from './foundry.ts'

export type FoundryTarget = {
  /** The Foundry token id — identity, and the handle a later slice needs to
   *  write damage or a condition back onto it. */
  token: string
  name: string
  /** Absent when the module could not read it; the app then has no verdict to
   *  offer and every on-hit contribution stays a question. */
  ac?: number
}

/** WHOSE target it is, latched with it. Keyed rather than cleared on unmount:
 *  the latch exists so a screen mounted after the message still knows, and
 *  Equipment unmounts every time the player looks at their Spellbook. Clearing
 *  it there threw away the only copy — a target that survives being looked away
 *  from is the whole point. */
let latest: { characterId: string; target: FoundryTarget | null } | null = null

/** The current target, or null. Re-renders when Foundry's selection changes. */
export function useFoundryTarget(characterId: string | undefined): FoundryTarget | null {
  const [target, setTarget] = useState<FoundryTarget | null>(
    () => (latest && latest.characterId === characterId ? latest.target : null),
  )
  useFoundryMessages(msg => {
    if (msg.kind !== 'target' || !characterId || msg.character !== characterId) return
    latest = { characterId, target: msg.token }
    setTarget(msg.token)
  })
  /* A DIFFERENT CHARACTER IS A DIFFERENT TABLE. Nothing carries across, and the
     latch is keyed rather than wiped so leaving a screen is not the same event
     as changing who you are. */
  useEffect(() => {
    if (latest && latest.characterId !== characterId) { latest = null; setTarget(null) }
  }, [characterId])
  return target
}
