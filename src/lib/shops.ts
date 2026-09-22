/**
 * Player-side shop reads + the buy call. A shop is DM-authored content that's
 * only VISIBLE while open (migration 0009's RLS), so unlike shards/items there
 * is nothing to fetch until the DM fires one — `useOpenShop` returns null the
 * rest of the time. Mirrors character.ts's realtime rule: the postgres_changes
 * event is only a signal, never adopt `payload.new` — refetch the row.
 */
import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { CatalogItemData, CharacterRow, ShopCatalogRow, ShopStockLine, InventoryItem, Json } from './database.types'
import type { Coins } from './coins'
import { routeItem, PERSON } from './placement'
import { getGear, getInventory } from './equip'
import { purchaseKey, purchaseRequest } from './purchaseRequest'

export interface OpenShopState {
  shop: ShopCatalogRow | null
  loading: boolean
  refetch: () => Promise<void>
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

  return { shop, loading, refetch: fetchOpen }
}

export type ShopBuyResult =
  | { ok: true; item: CatalogItemData; item_id: string; coins: Coins }
  | { ok: false; reason: 'gone' | 'no_character' | 'closed' | 'blocked' | 'sold_out' | 'insufficient' | 'conflict' | 'invalid_request' | 'network' | 'storage'; short_cp?: number }

/** Payment, stock and delivery commit together. The browser supplies only a
 * routing decision; the server checks both row versions and owns item facts. */
export async function buyItem(character: CharacterRow, shop: ShopCatalogRow, line: ShopStockLine): Promise<ShopBuyResult> {
  const destination = routeItem({ ...line.item, containerId: PERSON } as InventoryItem, getGear(character), getInventory(character))
  return purchaseRequest({
    getItem: key => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value),
    removeItem: key => localStorage.removeItem(key),
  }, purchaseKey(character.id, shop.id, line.item_id), () => crypto.randomUUID(), async requestId => {
    const { data, error } = await supabase.rpc('shop_purchase', {
      p_shop_id: shop.id, p_item_id: line.item_id, p_request_id: requestId,
      p_character_id: character.id, p_character_updated_at: character.updated_at,
      p_shop_updated_at: shop.updated_at, p_destination: destination as unknown as Json,
    })
    if (error) throw new Error(error.message)
    if (!data || typeof data !== 'object' || !('ok' in data)) throw new Error('Missing purchase receipt')
    return data as ShopBuyResult
  })
}

export function hasPendingPurchase(character: string, shop: string, item: string): boolean {
  try { return !!localStorage.getItem(purchaseKey(character, shop, item)) } catch { return false }
}
