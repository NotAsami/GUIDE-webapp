import { supabase } from './supabase'
import type { CharacterRow } from './database.types'
import type { CharacterStore } from './characterWrite'

export const characterStore: CharacterStore = {
  async read(id) {
    const { data, error } = await supabase.from('characters').select('*').eq('id', id).single<CharacterRow>()
    if (error) throw new Error(error.message)
    return data
  },
  async compareAndSwap(row, patch) {
    const { data, error } = await supabase.from('characters').update(patch)
      .eq('id', row.id).eq('updated_at', row.updated_at).select().maybeSingle<CharacterRow>()
    if (error) throw new Error(error.message)
    return data
  },
}
