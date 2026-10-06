/**
 * Triggers other than the press — a feature that starts from something that
 * HAPPENED rather than from the player pressing Use.
 *
 * A TRIGGER IS ANOTHER WAY TO PRESS. The event goes through the same
 * useActivation path the hexagon does (canUse, gateOf, planActivation), so a
 * use count, a gate and an ask mean exactly what they mean on a press. What the
 * event cannot do is CHOOSE: a press that would spend something or ask
 * something is OFFERED to the player instead of run — see triggerMode.
 *
 * Three events, chosen by the catalog rather than by the mockup's list: these
 * are the ones content actually waits on AND the app actually sees. "When you
 * are hit" and "end of your turn" are in the Deferred register.
 */

import type { Feature } from './database.types.ts'
import type { ExprScope } from './expr.ts'
import type { Outcome } from './graphState.ts'
import { isUsable, usesOf } from './featureView.ts'

export type TriggerEvent = NonNullable<Feature['trigger']>

export const TRIGGERS: { k: TriggerEvent; label: string; via: string; note: string }[] = [
  { k: 'initiative', label: 'When you roll initiative', via: 'on initiative',
    note: 'The codex’s own initiative roll — the INIT cell, or Foundry asking for one.' },
  { k: 'hpZero', label: 'When you drop to 0 HP', via: 'at 0 HP',
    note: 'Hit Points crossing from above 0 to 0, whichever screen wrote them.' },
  { k: 'turnStart', label: 'At the start of your turn', via: 'on your turn',
    note: 'Foundry’s tracker reaching you, or Advance Turn in the roll panel.' },
]
export const triggerOf = (k: TriggerEvent | undefined) => TRIGGERS.find(t => t.k === k)

/** Run it, or offer it. AN EVENT MAY NOT SPEND OR DECIDE FOR THE PLAYER:
 *  anything that costs a use, a slot or another feature's counter, or that
 *  asks a question, waits for them. Everything else (Perfect Focus topping up
 *  focus) just happens, because offering a free refill is a tap for nothing. */
export function triggerMode(f: Pick<Feature, 'uses'>, outcomes: Outcome[], scope: ExprScope): 'run' | 'offer' {
  if (usesOf(f, scope)) return 'offer'
  const spends = outcomes.some(o => !!o.ask || o.kind === 'grant'
    || (o.kind === 'slot' && (o.delta < 0 || o.budget !== undefined))
    || (o.kind === 'uses' && o.next < o.current))
  return spends ? 'offer' : 'run'
}

/** A trigger needs something to press. One on a feature that only ever
 *  applies passively would fire, plan nothing, and look like a broken event. */
export function triggerProblem(f: Pick<Feature, 'trigger' | 'roll' | 'uses' | 'activation' | 'vars' | 'graph'>): string | null {
  if (!f.trigger || isUsable(f)) return null
  return `${triggerOf(f.trigger)?.label ?? 'The trigger'} presses this feature, but there is nothing to press: no roll, no use count, no activation outcome and no armed effect. Add what should happen, or set the trigger back to Press only.`
}

/** Dropping to 0 is the CROSSING, not the state — a character lying at 0 who
 *  is healed by 0, or reloaded, has not dropped again. */
export const droppedToZero = (prev: number | undefined, next: number | undefined) =>
  prev !== undefined && next !== undefined && prev > 0 && next <= 0

/* THE BUS. The initiative roll lives in a lib function two surfaces call, and
   what answers it lives in Layout; a listener set is the smallest join. */
const listeners = new Set<(e: TriggerEvent) => void>()
export function fireTrigger(e: TriggerEvent) { for (const l of listeners) l(e) }
export function onTrigger(fn: (e: TriggerEvent) => void) { listeners.add(fn); return () => { listeners.delete(fn) } }
