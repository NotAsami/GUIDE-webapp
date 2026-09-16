/**
 * `ammoBonusOf` on its own, so the weapon roller can read it without importing
 * a screen. It was exported from screens/Equipment.tsx, which would have made a
 * lib module depend on a React component — the wrong direction, and one that
 * drags a whole screen into any test of the roll.
 */

import type { InventoryItem } from './database.types.ts'
import type { AmmoBonus } from './weapons.ts'

/** A stack's damage bonus, named for the breakdown — "+1 (Silvered Arrows)"
 *  rather than a total that silently disagrees with the printed damage. */
export function ammoBonusOf(stack: InventoryItem | null): AmmoBonus | null {
  const d = stack?.effects?.damage
  return d ? { damage: d, label: stack!.name } : null
}
