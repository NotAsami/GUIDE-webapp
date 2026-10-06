/**
 * Where triggers land — lib/triggers.ts. Mounted once in Layout, for the bound
 * character only, so an event is answered by the one client that owns the row.
 *
 * ONE PRESS AT A TIME. Two features on one event (Perfect Focus and Superior
 * Inspiration both answer initiative) would each write from the same stale
 * row, and the second write would quietly undo the first. So events queue
 * feature ids, and the queue drains one press per render: the next waits until
 * the last one's write has landed and the row has re-rendered.
 * ponytail: two tabs open on one character would each answer the event. A
 * lease in `resources` if anyone ever does that at the table.
 */
import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { Feature } from '../lib/database.types'
import { useRollLog, type RollEntry } from '../lib/rolls'
import { droppedToZero, fireTrigger, onTrigger, triggerOf, type TriggerEvent } from '../lib/triggers'
import { useActivation, type ActivationHost } from './ActivationSheet'

export function Triggers({ offerRef, ...host }: ActivationHost & {
  /** Where the roll panel's Use / Dismiss reaches this component. */
  offerRef: MutableRefObject<((entry: RollEntry, use: boolean) => void) | null>
}) {
  const act = useActivation(host)
  const { rolls, addRoll, updateRoll } = useRollLog()
  const features: Feature[] = host.character.sheet?.features ?? []
  const [queue, setQueue] = useState<{ id: string; via: TriggerEvent }[]>([])

  const live = useRef({ features, rolls })
  live.current = { features, rolls }
  useEffect(() => onTrigger(via => {
    /* The moment an offer was about has passed once the same event comes
       round again — a second initiative is a second fight. */
    for (const r of live.current.rolls) {
      if (r.offer && !r.offer.state && r.offer.via === via) updateRoll(r.id, { offer: { ...r.offer, state: 'lapsed' } })
    }
    const hit = live.current.features.filter(f => f.trigger === via)
    if (hit.length) setQueue(q => [...q, ...hit.map(f => ({ id: f.id, via }))])
  }), [updateRoll])

  /* DROPPING TO 0 is watched here rather than at each writer, so the topbar,
     a damage roll and the DM's console all count — and only the crossing. */
  const hp = host.character.sheet?.hp?.current
  const prevHp = useRef(hp)
  useEffect(() => {
    if (droppedToZero(prevHp.current, hp)) fireTrigger('hpZero')
    prevHp.current = hp
  }, [hp])

  useEffect(() => {
    if (!queue.length || act.busy) return
    const [head, ...rest] = queue
    setQueue(rest)
    const f = features.find(x => x.id === head.id)
    if (!f || act.fire(f, head.via) !== 'offer') return
    addRoll({
      kind: 'custom', title: f.name, subtitle: triggerOf(head.via)?.label, icon: f.icon,
      subject: { kind: 'feature', id: f.id }, offer: { feature: f.id, via: head.via },
    })
  }, [queue, act, features, addRoll])

  offerRef.current = (entry, use) => {
    const o = entry.offer
    if (!o) return
    updateRoll(entry.id, { offer: { ...o, state: use ? 'used' : 'dismissed' } })
    const f = features.find(x => x.id === o.feature)
    if (use && f) act.start(f)
  }

  return act.sheet || null
}
