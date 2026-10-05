/**
 * Initiative — rolled, logged, paid for and sent to Foundry, in ONE place.
 *
 * TWO CALLERS, ONE PATH. The Stats screen's INIT cell rolls it when the player
 * presses it; Layout rolls it when Foundry asks (the tracker's d20, Roll All,
 * the actor sheet's button — see bridge.js). Two copies of "build, log, spend
 * the arms, tell Foundry" would agree today and drift on the first change, and
 * the one that drifted would be the one nobody was looking at.
 *
 * WHEN FOUNDRY HEARS ABOUT IT. A settled roll goes straight out: card and
 * tracker. One with a rider still open does not — its total is about to move —
 * and waits for the panel's own Post control, the same rule a hotbar swing
 * follows. When Foundry was the one asking, it is told the roll is HELD, so its
 * fallback does not roll over the top of a player who is busy answering.
 */

import type { CharacterRow, CharacterSheet } from './database.types.ts'
import type { GraphContext } from './graph.ts'
import { buildCheck, type RollEntry } from './rolls.tsx'
import { armsSpent, armsSpentBy } from './graphState.ts'
import { pendingOf } from './rollView.ts'
import { sendFoundry } from './foundry.ts'
import { cssVar, rollChatHtml } from './foundryChat.ts'

export async function initiativeRoll(o: {
  character: CharacterRow
  graph: GraphContext
  /** The EFFECTIVE sheet — its `initiative` already carries worn bonuses. */
  sheet: CharacterSheet
  addRoll: (entry: Omit<RollEntry, 'id' | 'at'>, confirmedId?: string) => RollEntry
  updateRoll: (id: string, patch: Partial<RollEntry>) => void
  /** Must report failure: a roll whose arms did not get spent is not logged. */
  saveResources: (resources: CharacterRow['resources']) => Promise<{ ok: boolean }>
  /** Foundry's request id, when Foundry asked. */
  req?: string
}): Promise<RollEntry | null> {
  /* A Dexterity check on `roll:check.initiative`, which is what lets Feral
     Instinct's advantage reach it. */
  const built = buildCheck(o.graph, {
    kind: 'check', sub: 'initiative', title: 'INITIATIVE', subtitle: 'Dexterity Check',
    terms: [{ label: 'INIT', value: o.sheet.initiative ?? 0 }],
  })
  /* THE ARMS ARE PAID BEFORE THE ROLL IS LOGGED. Whatever it consumed is spent
     — see armsSpent; Superior Inspiration hands out arms right before exactly
     this roll — and a write that failed must not leave a logged roll that
     spent nothing, which would let the same arm pay out twice. */
  const rollId = crypto.randomUUID()
  const ids = armsSpentBy(...(built.riderGroups ?? []).map(g => g.riders))
  if (ids.length && !(await o.saveResources(armsSpent(o.character, ids, rollId) as CharacterRow['resources'])).ok) return null
  const logged = o.addRoll(built, rollId)

  const character = o.character.id
  if (pendingOf(logged).asks > 0) {
    if (o.req) void sendFoundry({ kind: 'initiative', character, req: o.req, held: true })
    return logged
  }
  void sendFoundry({
    kind: 'initiative', character, req: o.req,
    roll: logged.id, title: logged.title, html: rollChatHtml(logged, cssVar, o.graph.scope),
    total: built.check.total,
  }).then(ok => { if (ok) o.updateRoll(logged.id, { posted: true }) })
  return logged
}
