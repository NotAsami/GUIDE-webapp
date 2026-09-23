import type { CharacterRow, CharacterUpdate, ShardTree } from './database.types.ts'
import { CharacterConflict, mergeCharacterPatch } from './characterMerge.ts'
import { publicVitals } from './vitals.ts'

export type CharacterWriteResult =
  | { ok: true; row: CharacterRow }
  | { ok: false; message: string; row?: CharacterRow }

/** Injected transport keeps the concurrency protocol testable without a live DB. */
export interface CharacterStore {
  read: (id: string) => Promise<CharacterRow>
  compareAndSwap: (row: CharacterRow, patch: CharacterUpdate) => Promise<CharacterRow | null>
}

export async function writeCharacter(
  store: CharacterStore, base: CharacterRow, patch: CharacterUpdate,
  shardTrees: Record<string, ShardTree>,
): Promise<CharacterWriteResult> {
  let current: CharacterRow | undefined
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      // FIRST TRY BLIND. The row on screen is almost always the latest one, and
      // the CAS already refuses a stale base — so reading first only doubled
      // every save's latency (~250 ms each way). Read and merge only after a miss.
      current = attempt === 0 ? base : await store.read(base.id)
      const merged = mergeCharacterPatch(base, patch as Partial<CharacterRow>, current) as CharacterUpdate
      // Never accept a stale derived cache from the caller.
      merged.public_vitals = publicVitals({ ...current, ...merged } as CharacterRow, shardTrees)
      const row = await store.compareAndSwap(current, merged)
      if (row) return { ok: true, row }
    }
    throw new CharacterConflict('this character')
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not save. Please try again.', row: current }
  }
}
