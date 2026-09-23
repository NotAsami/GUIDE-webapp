/**
 * What firing a prep-board card DOES — in one place, because two surfaces press
 * the same button: the board itself and the tray that rides along on every
 * other console screen. Two copies of this dispatch would be two answers to
 * "what does Reveal mean", and the second one would drift.
 *
 * Every branch calls the system that already owns the thing; nothing here
 * writes a player-facing row by hand. The card is stamped played only once its
 * own system says yes.
 */
import type { PlanCardRow } from './database.types'
import type { DmCampaignState, DmShopsState } from './dm'
import type { DmHandoutsState } from './handouts'
import { pushPatch } from './handoutPatches'
import type { DmNpcsState } from './npcs'
import type { DmPlansState } from './plans'
import { targetNames } from './prep'

export interface FireContext {
  party: { id: string; name: string }[]
  shopLib: DmShopsState
  handoutLib: DmHandoutsState
  npcLib: DmNpcsState
  campaign: DmCampaignState
  /** Rolls the table and puts it in front of the party — the console's path. */
  rollLoot: (tableId: string) => Promise<boolean>
  plans: Pick<DmPlansState, 'setFired'>
}

/** Fires the card and stamps it. Returns what happened, in words, for the
 *  activity log — or null if its system refused, in which case nothing is
 *  stamped and the card stays staged. */
export async function fireCard(c: PlanCardRow, ctx: FireContext): Promise<string | null> {
  const names = new Map(ctx.party.map(p => [p.id, p.name]))
  const who = targetNames(c.target, names)
  const targets = c.target.length ? c.target : ctx.party.map(p => p.id)
  let ok = true
  let what: string

  if (c.kind === 'shop' && c.ref) {
    await ctx.shopLib.openShop(c.ref, c.target[0] ?? null)
    what = `opened for ${who}`
  } else if (c.kind === 'loot' && c.ref) {
    ok = await ctx.rollLoot(c.ref)
    what = 'rolled and pushed'
  } else if (c.kind === 'handout' && c.ref) {
    const h = ctx.handoutLib.handouts.find(x => x.id === c.ref)
    ok = h ? await ctx.handoutLib.update(h.id, pushPatch(h, targets)) : false
    what = `pushed to ${who}`
  } else if (c.kind === 'npc' && c.ref) {
    for (const t of targets) ok = (await ctx.npcLib.reveal(c.ref, t, true)) && ok
    what = `revealed to ${who}`
  } else if (c.kind === 'quest' && c.ref) {
    const q = ctx.campaign.quests.find(x => x.id === c.ref)
    if (!q) { ok = false; what = 'gone' }
    else if (q.visible) { await ctx.campaign.updateQuest(q.id, { status: 'completed' }); what = 'closed' }
    else { await ctx.campaign.updateQuest(q.id, { visible: true }); what = 'revealed to the party' }
  } else {
    what = 'marked played'
  }

  if (!ok) return null
  await ctx.plans.setFired(c.id, true)
  return what
}
