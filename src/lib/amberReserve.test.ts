// Run: node --test src/lib/amberReserve.test.ts
/**
 * Amber is reserved. On a player screen it is the reveal's colour — the
 * G.U.I.D.E. Shard wears it on purpose, as an early tell — so every incidental
 * use (a hover, a crit glow, a condition chip) spends the effect. It leaked back
 * twice: once through `--gold-rare` sharing amber's hex, once through a dozen
 * components that reached for `--amber` as "the warm accent". The warm accent
 * for a player is `--gold`.
 *
 * So: no player-side stylesheet or component may name `--amber` unless it is
 * listed below with the reason it is allowed to. DM-side files are out of scope
 * (the operator layer is amber-led by design). A stale entry — a file that no
 * longer uses amber — fails too, so the list cannot rot into a blanket pass.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const DIRS = ['src/screens', 'src/components', 'src/styles']

/** The operator layer. Amber-led by design, so not this guard's business. */
const DM_SIDE = /Operator|ShardLattice|FeatureEditor|featureGraph|FeatureGraph|authoring|CatalogSearch|IconPicker|ImageUpload|LootRollOverlay|ProsePreview|ProseToolbar|GraphEffects|PrepTray/

const ALLOWED: Record<string, string> = {
  'src/screens/Shard.module.css': 'the G.U.I.D.E. Shard card, port and connector — the deliberate tell',
  'src/screens/Shard.tsx': 'the G.U.I.D.E. Shard card\'s "+" markers',
  'src/components/Creep.module.css': 'the creep effect — the reveal itself bleeding through',
  'src/screens/Lore.module.css': 'memories being "taken" by digitisation — reveal foreshadowing',
  'src/components/SystemToasts.module.css': 'the corrupted G.U.I.D.E. voice tone only (.toast.corrupted)',
  'src/components/NpcWebView.module.css': 'console tone (players get .player cyan overrides) and the G.U.I.D.E. system node',
  'src/components/NpcWebView.tsx': 'the G.U.I.D.E. system-type edge',
  'src/components/LevelUpOverlay.module.css': 'the DM\'s level-up overlay — the operator speaking',
  'src/components/BootMark.module.css': 'the amber tone, used only by operator screens',
  'src/components/Layout.module.css': 'the DM console link, shown to the DM only',
  'src/styles/global.css': '.sk.amber skeletons, used only by operator screens',
}

function files(): string[] {
  const out: string[] = []
  for (const dir of DIRS) {
    for (const n of readdirSync(join(ROOT, dir))) {
      if (!/\.(css|tsx?)$/.test(n) || n.endsWith('.test.ts')) continue
      const rel = `${dir}/${n}`
      if (!DM_SIDE.test(rel)) out.push(rel)
    }
  }
  return out
}

const usesAmber = (rel: string) => /var\(--amber/.test(readFileSync(join(ROOT, rel), 'utf8'))

test('no player-side file reaches for --amber without a stated reason', () => {
  const leaks = files().filter(f => usesAmber(f) && !(f in ALLOWED))
  assert.deepEqual(leaks, [], `--amber on a player surface. Use --gold for a warm accent, or add the file to ALLOWED with a reason:\n  ${leaks.join('\n  ')}`)
})

test('every exemption still uses amber (no stale entries)', () => {
  const stale = Object.keys(ALLOWED).filter(f => !usesAmber(f))
  assert.deepEqual(stale, [], `stale ALLOWED entries — remove them:\n  ${stale.join('\n  ')}`)
})
