/**
 * Hand-written types for the Phase 0 schema (supabase/migrations/0001_init.sql).
 * Replace with `supabase gen types typescript` output once the CLI is wired in.
 *
 * Implementation note: we use `type` aliases (not interfaces) so the row shapes
 * satisfy supabase-js's `Record<string, unknown>` generic constraint — interfaces
 * fail that check because they're open to declaration merging.
 */

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

export type CharacterIdentity = {
  race?: string
  class?: string
  archetype?: string | null
  background?: string | null
  level?: number
  reputation?: number
  flavor?: string[]
}

export type AbilityScores = {
  str: number
  dex: number
  con: number
  int: number
  wis: number
  cha: number
}

export type HP = {
  current: number
  max: number
  temp?: number
}

export type CharacterSheet = {
  abilities?: AbilityScores
  hp?: HP
  hitDice?: { current: number; max: number; die: string }
  ac?: number
  initiative?: number
  speed?: number
  proficiencyBonus?: number
  coins?: { gold: number; silver?: number; copper?: number }
}

export type ProgressStory = {
  id: string
  title: string
  label: string
  emblem: 'character' | 'main' | 'region'
  telemetry?: string
  percent: number
  chapter?: string
  tooltip?: string
}

export type CharacterProgress = {
  stories?: ProgressStory[]
}

export type CharacterRow = {
  id: string
  owner: string
  name: string
  identity: CharacterIdentity
  sheet: CharacterSheet
  resources: Record<string, Json>
  inventory: Json[]
  equipped: Record<string, Json>
  shards: Record<string, Json>
  spellbook: Record<string, Json> & { spellcasting?: boolean }
  lore: Record<string, Json>
  progress: CharacterProgress
  updated_at: string
}

export type CharacterSection = Exclude<keyof CharacterRow, 'id' | 'owner' | 'name' | 'updated_at'>

export type CharacterInsert = Omit<CharacterRow, 'id' | 'updated_at'> & {
  id?: string
  updated_at?: string
}
export type CharacterUpdate = Partial<Omit<CharacterRow, 'id' | 'owner'>>

export type Database = {
  public: {
    Tables: {
      characters: {
        Row: CharacterRow
        Insert: CharacterInsert
        Update: CharacterUpdate
        Relationships: []
      }
      dm_users: {
        Row: { user_id: string }
        Insert: { user_id: string }
        Update: { user_id?: string }
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
