/**
 * The fetch half of the shard catalog, kept out of lib/shards.ts so that file
 * stays what its header claims: pure domain logic, a function of its arguments.
 *
 * The split is load-bearing for tests, not just tidiness — lib/supabase.ts reads
 * `import.meta.env` at module scope and throws outside Vite, so anything that
 * transitively imports it cannot be reached by `node --test`. effects.ts needs
 * shards.ts, and effects.ts has a test.
 */

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from './auth'
import { supabase } from './supabase'
import type { ShardTree, ShardTreeCatalogRow } from './database.types'

export interface ShardCatalogState {
  catalog: Record<string, ShardTree>
  loading: boolean
  refetch: () => Promise<void>
}

/** Player-side read of PUBLISHED shard trees (shard_tree_catalog, migration
 *  0008). A handful of small, rarely-changing rows — one fetch on mount, no
 *  realtime; a DM publish takes effect on the player's next reload/nav. */
export function useShardCatalog(): ShardCatalogState {
  const { session } = useAuth()
  const [catalog, setCatalog] = useState<Record<string, ShardTree>>({})
  const [loading, setLoading] = useState(true)

  const fetchAll = useCallback(async () => {
    if (!session) { setCatalog({}); setLoading(false); return }
    setLoading(true)
    const { data } = await supabase.from('shard_tree_catalog').select('*')
    const map: Record<string, ShardTree> = {}
    for (const row of (data as ShardTreeCatalogRow[] | null) ?? []) map[row.id] = row.data
    setCatalog(map)
    setLoading(false)
  }, [session])

  useEffect(() => { void fetchAll() }, [fetchAll])

  return { catalog, loading, refetch: fetchAll }
}
