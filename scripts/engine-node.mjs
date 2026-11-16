/**
 * Boot the WebAssembly engine under Node — for the test suite and scripts.
 *
 * `npm test` preloads it (`node --import`), so every test file has the engine.
 * A script imports it for its side effect before anything that computes. In a browser the app calls initEngine() instead, which
 * fetches the .wasm; Node has no fetch for a file, so the bytes are read here.
 */
import { readFileSync } from 'node:fs'
import { initEngineSync } from '../src/lib/engine/index.ts'

initEngineSync(readFileSync(new URL('../packages/engine-wasm/engine_bg.wasm', import.meta.url)))
