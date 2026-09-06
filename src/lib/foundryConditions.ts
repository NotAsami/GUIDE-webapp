/**
 * Conditions Foundry says a character has.
 *
 * A DM drops Blinded on a token and the player, who is looking at their codex
 * rather than at the map, has no idea. This mirrors those statuses into the
 * Effects panel.
 *
 * A MIRROR, NOT A RECORD. `resources.activeEffects` is the app's own list, with
 * mechanics, durations and a DM who can lift them; Foundry's statuses are ids
 * on a token. Writing one into the other would make two writers for one list
 * and leave the app holding effects it cannot explain or remove. So these are
 * ephemeral, exactly like the target: they arrive over the bridge, they are
 * shown as what they are, and when Foundry goes away so do they.
 *
 * Which means the panel shows two kinds of thing in one list, and the id says
 * which — `isMirrored` is the one place that question is answered.
 */

import { useEffect, useState } from 'react'
import { useFoundryMessages } from './foundry.ts'

let latest: { characterId: string; statuses: string[] } | null = null

/** The statuses Foundry currently reports for this character. Empty when the
 *  bridge is down, which is every case that existed before it. */
export function useFoundryConditions(characterId: string | undefined): string[] {
  const [statuses, setStatuses] = useState<string[]>(
    () => (latest && latest.characterId === characterId ? latest.statuses : []),
  )
  useFoundryMessages(msg => {
    if (msg.kind !== 'conditions' || !characterId || msg.character !== characterId) return
    latest = { characterId, statuses: msg.statuses }
    setStatuses(msg.statuses)
  })
  /* A different character is a different table — the same rule the target
     latch keeps, and for the same reason: leaving a screen is not the same
     event as changing who you are. */
  useEffect(() => {
    if (latest && latest.characterId !== characterId) { latest = null; setStatuses([]) }
  }, [characterId])
  return statuses
}

