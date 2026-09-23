/**
 * The prep board's rows (0027): a plan per night, and the cards staged on it.
 *
 * DM-only, no subscription: the console is the only reader and the only writer,
 * and a card's EFFECT is a write to whichever table already owns it. What lives
 * here is the intention and the time it was carried out.
 */
import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { useAuth } from './auth'
import type { PlanCardInsert, PlanCardRow, PlanCardUpdate, SessionPlanRow } from './database.types'

export interface DmPlansState {
  plans: SessionPlanRow[]
  cards: PlanCardRow[]
  loading: boolean
  error: string | null
  createPlan: (title: string) => Promise<SessionPlanRow | null>
  renamePlan: (id: string, title: string) => Promise<void>
  deletePlan: (id: string) => Promise<void>
  addCard: (fields: PlanCardInsert) => Promise<PlanCardRow | null>
  updateCard: (id: string, patch: PlanCardUpdate) => Promise<void>
  removeCard: (id: string) => Promise<void>
  /** Stamp a card played, or take the stamp back off (the fire itself is the
   *  caller's job — the shop, the handout, the quest). */
  setFired: (id: string, fired: boolean) => Promise<void>
  /** The night became this log entry. */
  wrap: (planId: string, sessionId: string) => Promise<void>
}

export function useDmPlans(): DmPlansState {
  const { session } = useAuth()
  const [plans, setPlans] = useState<SessionPlanRow[]>([])
  const [cards, setCards] = useState<PlanCardRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!session) { setPlans([]); setCards([]); setLoading(false); return }
    void Promise.all([
      supabase.from('session_plans').select('*').order('created_at', { ascending: false }),
      supabase.from('plan_cards').select('*'),
    ]).then(([p, c]) => {
      const err = p.error ?? c.error
      setError(err ? err.message : null)
      setPlans((p.data as SessionPlanRow[]) ?? [])
      setCards((c.data as PlanCardRow[]) ?? [])
      setLoading(false)
    })
  }, [session])

  const createPlan = useCallback<DmPlansState['createPlan']>(async title => {
    const { data, error: err } = await supabase.from('session_plans').insert({ title }).select().single<SessionPlanRow>()
    if (err) { setError(err.message); return null }
    setPlans(prev => [data, ...prev])
    return data
  }, [])

  const renamePlan = useCallback<DmPlansState['renamePlan']>(async (id, title) => {
    const { data, error: err } = await supabase.from('session_plans').update({ title }).eq('id', id).select().single<SessionPlanRow>()
    if (err) { setError(err.message); return }
    setPlans(prev => prev.map(p => (p.id === id ? data : p)))
  }, [])

  const deletePlan = useCallback<DmPlansState['deletePlan']>(async id => {
    const { error: err } = await supabase.from('session_plans').delete().eq('id', id)
    if (err) { setError(err.message); return }
    setPlans(prev => prev.filter(p => p.id !== id))
    setCards(prev => prev.filter(c => c.plan_id !== id))   // mirrors the cascade
  }, [])

  const addCard = useCallback<DmPlansState['addCard']>(async fields => {
    const { data, error: err } = await supabase.from('plan_cards').insert(fields).select().single<PlanCardRow>()
    if (err) { setError(err.message); return null }
    setCards(prev => [...prev, data])
    return data
  }, [])

  const updateCard = useCallback<DmPlansState['updateCard']>(async (id, patch) => {
    const { data, error: err } = await supabase.from('plan_cards').update(patch).eq('id', id).select().single<PlanCardRow>()
    if (err) { setError(err.message); return }
    setCards(prev => prev.map(c => (c.id === id ? data : c)))
  }, [])

  const removeCard = useCallback<DmPlansState['removeCard']>(async id => {
    const { error: err } = await supabase.from('plan_cards').delete().eq('id', id)
    if (err) { setError(err.message); return }
    setCards(prev => prev.filter(c => c.id !== id))
  }, [])

  const setFired = useCallback<DmPlansState['setFired']>(async (id, fired) => {
    await updateCard(id, { fired_at: fired ? new Date().toISOString() : null })
  }, [updateCard])

  const wrap = useCallback<DmPlansState['wrap']>(async (planId, sessionId) => {
    const { data, error: err } = await supabase.from('session_plans')
      .update({ session_id: sessionId, closed_at: new Date().toISOString() })
      .eq('id', planId).select().single<SessionPlanRow>()
    if (err) { setError(err.message); return }
    setPlans(prev => prev.map(p => (p.id === planId ? data : p)))
  }, [])

  return { plans, cards, loading, error, createPlan, renamePlan, deletePlan, addCard, updateCard, removeCard, setFired, wrap }
}
