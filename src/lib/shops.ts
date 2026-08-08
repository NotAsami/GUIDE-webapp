/**
 * Player-side shop reads + the buy call. A shop is DM-authored content that's
 * only VISIBLE while open (migration 0009's RLS), so unlike shards/items there
 * is nothing to fetch until the DM fires one — `useOpenShop` returns null the
 * rest of the time. Mirrors character.ts's realtime rule: the postgres_changes
 * event is only a signal, never adopt `payload.new` — refetch the row.
 */
import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { CatalogItemData, ShopCatalogRow } from './database.types'
import type { Coins } from './coins'

export interface OpenShopState {
  shop: ShopCatalogRow | null
  loading: boolean
}

/** The shop currently open for this character, or null. `characterId` isn't
 *  used to filter the query — the `player_read_open_shops` policy already
 *  scopes rows to "open, and either whole-party or targeted at me" — it just
 *  gates the hook until a character is bound. */
export function useOpenShop(characterId: string | undefined): OpenShopState {
  const [shop, setShop] = useState<ShopCatalogRow | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchOpen = useCallback(async () => {
    if (!characterId) { setShop(null); setLoading(false); return }
    const { data } = await supabase.from('shop_catalog').select('*').eq('is_open', true)
    setShop(((data as ShopCatalogRow[]) ?? [])[0] ?? null)
    setLoading(false)
  }, [characterId])

  useEffect(() => { void fetchOpen() }, [fetchOpen])

  useEffect(() => {
    if (!characterId) return
    const ch = supabase
      .channel('shop-open-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shop_catalog' }, () => void fetchOpen())
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [characterId, fetchOpen])

  return { shop, loading }
}

export type ShopBuyResult =
  | { ok: true; item: CatalogItemData; item_id: string; coins: Coins }
  | { ok: false; reason: 'gone' | 'no_character' | 'closed' | 'blocked' | 'sold_out' | 'insufficient'; short_cp?: number }

/** Calls the `shop_buy` RPC (migration 0009) — the only path that can spend
 *  coin or decrement stock; there is no player UPDATE policy on the table. */
export async function buyItem(shopId: string, itemId: string): Promise<ShopBuyResult> {
  const { data, error } = await supabase.rpc('shop_buy', { p_shop_id: shopId, p_item_id: itemId })
  if (error) return { ok: false, reason: 'gone' }
  return data as ShopBuyResult
}
