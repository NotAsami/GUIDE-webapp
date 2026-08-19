/**
 * The slice of a character other players are allowed to see.
 *
 * `characters` has exactly one player policy — you may read your own row and
 * nobody else's (0001_init.sql). The party HUD needs a handful of numbers about
 * everyone else, so `list_party_roster()` is the narrow, SECURITY DEFINER hole
 * in that wall (0011). It can only project columns, though, and two of the
 * numbers the HUD wants are DERIVED rather than stored:
 *
 *   - effective AC  = authored `sheet.ac` + every worn item and slotted shard
 *   - effective max HP = authored `sheet.hp.max` + shard bonuses
 *
 * Computing those in SQL would mean a second implementation of
 * lib/effects.ts effectiveSheet living in Postgres, drifting the first time
 * either changed. So the OWNER computes them — they can read their own row, and
 * they already run effectiveSheet on every render — and writes the result to
 * `public_vitals`, which the roster projects.
 *
 * A COMPILED CACHE, exactly like an item's `effects` from its `effectRefs`:
 * one COMPILER (this file), one consumer (the roster). Never hand-edited,
 * never authored.
 *
 * Two write paths call it, because two exist: the player's own sheet
 * (lib/character.ts) and the DM console (lib/dm.ts `updateCharacter` — a
 * granted ring or a level-up moves these numbers just as surely). Both fold
 * the SAME pure function into the SAME patch, so the cache cannot lag the row
 * it summarises. A third writer that forgets is caught by the guard in
 * vitals.test.ts rather than by a player seeing a stale AC.
 *
 * WHAT IT DELIBERATELY DOES NOT CARRY: inventory, gold, lore, secrets, spell
 * lists, variables. Condition NAMES only, never their mechanics. If a field is
 * not needed by the party HUD it does not belong here — this is a hole in a
 * wall, and it should stay the size of the thing going through it.
 */
import { effectiveSheet } from './effects.ts'
import type { ActiveEffect, CharacterRow, PublicVitals, ShardTree } from './database.types.ts'

/** Death saves live on `resources.deathSaves`, written by the player's own
 *  screen and by the DM's console. Plain stored data — no derivation. */
function deathSaves(c: CharacterRow): { ok: number; fail: number } {
  const ds = (c.resources as { deathSaves?: { successes?: number; failures?: number } } | undefined)?.deathSaves
  return { ok: ds?.successes ?? 0, fail: ds?.failures ?? 0 }
}

/**
 * Build the public slice. Pure, so it can be tested without a database and
 * called from the write path without a round trip.
 *
 * `shardTrees` matters: without it the effective max HP and AC silently fall
 * back to the authored base, and the party HUD would disagree with the owner's
 * own Topbar for anyone wearing a +maxHP shard.
 */
export function publicVitals(
  c: CharacterRow,
  shardTrees: Record<string, ShardTree> = {},
): PublicVitals {
  const view = effectiveSheet(c, shardTrees)
  const ds = deathSaves(c)
  const raw = ((c.resources as { activeEffects?: ActiveEffect[] } | undefined)?.activeEffects) ?? []

  return {
    hp: c.sheet?.hp?.current ?? 0,
    hpMax: view.hp?.max ?? c.sheet?.hp?.max ?? 0,
    temp: c.sheet?.hp?.temp ?? 0,
    ac: view.ac ?? c.sheet?.ac ?? 0,
    deathOk: ds.ok,
    deathFail: ds.fail,
    // Name, kind and icon — enough to render a pip and a tooltip, and nothing
    // that says what the effect DOES. A condition's mechanics are the owner's.
    effects: raw.map(e => ({
      name: e.name ?? 'Effect',
      kind: e.kind ?? 'buff',
      ...(e.icon ? { icon: e.icon } : {}),
    })),
  }
}

/** Has anything a watcher would see actually changed?
 *
 *  Every player write recomputes this, and most writes (a journal entry, a
 *  prepared spell, moving an item between bags) change nothing here. Comparing
 *  first keeps those from writing a column nobody's screen will re-render for.
 */
export function vitalsEqual(a: PublicVitals | null | undefined, b: PublicVitals): boolean {
  if (!a) return false
  return a.hp === b.hp && a.hpMax === b.hpMax && a.temp === b.temp && a.ac === b.ac
    && a.deathOk === b.deathOk && a.deathFail === b.deathFail
    && a.effects.length === b.effects.length
    && a.effects.every((e, i) => e.name === b.effects[i].name && e.kind === b.effects[i].kind)
}

export type PresenceEntry = { at?: number; v?: PublicVitals | null }

/** A client re-announces itself this often, so `at` stays fresh while it is
 *  open. Only used to reason about staleness here; the timer lives in
 *  presence.ts. */
export const PRESENCE_HEARTBEAT_MS = 20_000
/** Three missed heartbeats and we call it gone. */
export const PRESENCE_STALE_MS = 70_000

/**
 * Who is actually online, and what they last broadcast.
 *
 * TWO THINGS MAKE THIS MORE THAN A MAP LOOKUP, both observed live:
 *
 * 1. `presenceState()[key]` is an ARRAY that GROWS — one entry per track() and
 *    per socket. Reading [0] pins the OLDEST payload, so the row shows the HP
 *    someone had when they connected and never moves again. Newest `at` wins.
 *
 * 2. Entries from dead sockets are not reaped promptly — a client that has been
 *    gone for minutes was still listed, with its stale numbers. Presence alone
 *    therefore cannot answer "is this player here right now", so liveness is
 *    decided by the clock: a key whose freshest heartbeat is older than
 *    PRESENCE_STALE_MS is dropped, and its row goes offline.
 *
 * An entry with no `at` at all comes from a client on an older build. It is
 * kept rather than aged out — unknown is not the same as gone.
 */
export function livePresence(
  state: Record<string, PresenceEntry[]>,
  now: number = Date.now(),
): Map<string, PublicVitals | null> {
  const out = new Map<string, PublicVitals | null>()
  for (const id of Object.keys(state).sort()) {
    const entries = state[id]
    if (!entries?.length) continue
    let best = entries[0]
    for (const e of entries) if ((e.at ?? 0) >= (best.at ?? 0)) best = e
    if (best.at !== undefined && now - best.at > PRESENCE_STALE_MS) continue
    out.set(id, best.v ?? null)
  }
  return out
}

/** The freshest payload for one key, ignoring liveness. Split out because the
 *  newest-entry rule is the part most likely to be got wrong twice. */
export function newestVitals(entries: readonly PresenceEntry[] | undefined): PublicVitals | null {
  if (!entries?.length) return null
  let best = entries[0]
  for (const e of entries) if ((e.at ?? 0) >= (best.at ?? 0)) best = e
  return best.v ?? null
}
