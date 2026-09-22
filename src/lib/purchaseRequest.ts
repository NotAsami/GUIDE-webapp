/** A request id survives lost replies and remounts. Never replace it while the
 * outcome is unknown: retrying must ask for the receipt, not buy another item. */
export interface PurchaseJournal {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}
export async function purchaseRequest<T extends { ok: boolean; reason?: string }>(
  journal: PurchaseJournal, key: string, mint: () => string,
  send: (id: string) => Promise<T>,
): Promise<T | { ok: false; reason: 'network' | 'storage' }> {
  let id: string
  try {
    id = journal.getItem(key) ?? mint()
    journal.setItem(key, id)
  } catch { return { ok: false, reason: 'storage' } }
  try {
    const result = await send(id)
    // Transport errors throw; a returned result is a definite server outcome.
    try { journal.removeItem(key) } catch { /* Keep the receipt key for safe replay. */ }
    return result
  } catch { return { ok: false, reason: 'network' } }
}
export const purchaseKey = (character: string, shop: string, item: string) =>
  `guide:purchase:${character}:${shop}:${item}`
