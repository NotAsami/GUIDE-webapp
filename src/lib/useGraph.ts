/**
 * The feature graph, wired to a live character.
 *
 * `buildContext` walks activeSources(), resolves every variable and builds the
 * edge index — real work, and work that must NOT happen per roll. This hook is
 * the memo the `ponytail:` comments in effects.ts and the engine have been
 * deferring to: keyed on the character row and the shard catalog, and on
 * nothing else.
 *
 * That key is only sound because of §33's rule that variables never read roll
 * context. If a variable could read `cast`, the scope would be a function of one
 * particular roll and this memo would need invalidating per cast level, per
 * roll — which is the whole reason the two whitelists exist.
 */
import { useMemo } from 'react'
import type { CharacterRow, ShardTree } from './database.types.ts'
import { buildContext, type GraphContext } from './engine/index.ts'

/** An empty context, for the window before a character has loaded. Callers get
 *  a real object rather than null so a roll never has to branch on it — a
 *  character with no authored contributions and a character that has not loaded
 *  resolve identically, which is correct: both add nothing.
 *
 *  Built by the engine from a blank character, because only a context that came
 *  from buildContext() can be asked anything. One object, so the memo is stable. */
const BLANK = {} as CharacterRow
const NO_TREES: Record<string, ShardTree> = {}

export function useGraph(
  character: CharacterRow | null,
  shardTrees: Record<string, ShardTree> = {},
): GraphContext {
  return useMemo(
    () => (character ? buildContext(character, shardTrees) : buildContext(BLANK, NO_TREES)),
    [character, shardTrees],
  )
}
