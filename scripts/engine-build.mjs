#!/usr/bin/env node
/**
 * Build the Rust rules engine to packages/engine-wasm/.
 *
 *   node scripts/engine-build.mjs           build, optimise, stamp SOURCE_HASH
 *   node scripts/engine-build.mjs --check   fail if the committed build is stale
 *
 * `--check` needs no Rust: it only re-hashes the sources, which is why the main
 * CI job (and Vercel, which never compiles Rust) can run it.
 *
 * The wasm-bindgen CLI must be EXACTLY the library version in Cargo.lock — a
 * mismatch produces glue that does not load. The version is read from the
 * lockfile here so there is one place it is written down.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'packages/engine-wasm')
const stamp = join(out, 'SOURCE_HASH')

function walk(dir) {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

/** Everything that can change the built artefact, hashed in a stable order. */
function sourceHash() {
  const files = [
    ...walk(join(root, 'engine')).filter(f => /\.rs$|Cargo\.toml$/.test(f)),
    ...['Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml'].map(f => join(root, f)),
  ].sort()
  const h = createHash('sha256')
  for (const f of files) h.update(relative(root, f)).update('\0').update(readFileSync(f)).update('\0')
  return h.digest('hex')
}

if (process.argv.includes('--check')) {
  const want = sourceHash()
  let have = ''
  try { have = readFileSync(stamp, 'utf8').trim() } catch { /* never built */ }
  if (have !== want) {
    console.error('packages/engine-wasm is out of date with engine/. Run: npm run engine:build')
    process.exit(1)
  }
  console.log('engine build is current')
  process.exit(0)
}

// Panic messages embed source paths, and an absolute path makes the binary
// differ between this machine and CI for no reason. Remap them away.
const cargoHome = process.env.CARGO_HOME ?? join(process.env.HOME ?? '', '.cargo')
const env = {
  ...process.env,
  RUSTFLAGS: `${process.env.RUSTFLAGS ?? ''} --remap-path-prefix=${root}=. --remap-path-prefix=${cargoHome}=cargo`.trim(),
}
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', env })

const lock = readFileSync(join(root, 'Cargo.lock'), 'utf8')
const want = /name = "wasm-bindgen"\nversion = "([^"]+)"/.exec(lock)?.[1]
const have = execFileSync('wasm-bindgen', ['--version'], { encoding: 'utf8' }).trim().split(' ')[1]
if (!want || have !== want) {
  console.error(`wasm-bindgen CLI is ${have}, Cargo.lock wants ${want}. Run: cargo install wasm-bindgen-cli --version ${want} --locked`)
  process.exit(1)
}

run('cargo', ['build', '--release', '--locked', '-p', 'engine_wasm', '--target', 'wasm32-unknown-unknown'])
run('wasm-bindgen', ['--target', 'web', '--out-dir', out, '--out-name', 'engine',
  join(root, 'target/wasm32-unknown-unknown/release/engine_wasm.wasm')])
const wasm = join(out, 'engine_bg.wasm')
// Only the features rustc's wasm target already emits — naming them keeps wasm-opt
// from validating against (or reaching for) anything a browser might not have.
run('wasm-opt', ['-Oz', '--enable-bulk-memory', '--enable-bulk-memory-opt', '--enable-nontrapping-float-to-int',
  '--enable-sign-ext', '--enable-mutable-globals', '--enable-multivalue', '--enable-reference-types', wasm, '-o', wasm])
writeFileSync(stamp, sourceHash() + '\n')

const bytes = readFileSync(wasm)
console.log(`engine_bg.wasm: ${bytes.length} bytes raw, ${gzipSync(bytes).length} gzipped`)
