/**
 * Regenerates src/lib/gameIconsManifest.ts from public/icons/.
 *
 *   node scripts/gen-icon-manifest.mjs
 *
 * Run it after adding icons. The picker searches NAMES, and reading 4180
 * filenames off disk is not something a browser can do — so the list is baked
 * into a module the picker imports dynamically (its own chunk; the player
 * bundle never loads it).
 *
 * The folder name is the CONTRIBUTOR, and the licence (CC BY 3.0) asks for
 * "Icons made by {author}". Keep the per-author folders: flattening them would
 * throw away the one piece of information attribution needs.
 */
import { readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const ICONS = join(ROOT, 'public', 'icons')
const OUT = join(ROOT, 'src', 'lib', 'gameIconsManifest.ts')

const authors = readdirSync(ICONS).filter(d => statSync(join(ICONS, d)).isDirectory()).sort()

const entries = []
for (const author of authors) {
  for (const file of readdirSync(join(ICONS, author)).sort()) {
    if (!file.endsWith('.svg')) continue
    entries.push(`${author}/${file.slice(0, -4)}`)
  }
}

const body = `/**
 * GENERATED — do not edit. Run \`node scripts/gen-icon-manifest.mjs\`.
 *
 * Every game-icons.net glyph under public/icons, as "<author>/<name>".
 * ${entries.length} icons from ${authors.length} contributors.
 *
 * Imported DYNAMICALLY by the icon picker so it lands in its own chunk — this
 * is ~${Math.round(entries.join().length / 1024)}KB of strings that no player screen ever needs.
 */
export const GAME_ICONS: readonly string[] = [
${entries.map(e => `  '${e}',`).join('\n')}
]

/** Contributor folder names, for the credits list. */
export const GAME_ICON_AUTHORS: readonly string[] = [
${authors.map(a => `  '${a}',`).join('\n')}
]
`

writeFileSync(OUT, body)
console.log(`wrote ${entries.length} icons from ${authors.length} authors -> src/lib/gameIconsManifest.ts`)
