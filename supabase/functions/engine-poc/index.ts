/**
 * PROOF OF CONCEPT: the rules engine in a Supabase edge function.
 *
 * Loads the same WebAssembly module the codex runs (packages/engine-wasm, built
 * from engine/) and answers two questions with it: a formula, and what applies
 * to a roll for a character sent in the request. Nothing in the app calls this
 * and it reads no table; it exists to show the engine runs on the server.
 *
 *   POST { "expr": "level / 2 + 1d6", "scope": { "level": 7 } }
 *   POST { "character": {…}, "trees": {…}, "req": { "kind": "attack" } }
 *
 * Run it locally:  deno run --allow-net --allow-read supabase/functions/engine-poc/index.ts
 *
 * NOT DEPLOYED, and deploying needs one thing this file cannot do for itself:
 * the .wasm sits outside the function folder, so supabase/config.toml must list
 * it under this function's `static_files`. Unverified — there is no Supabase CLI
 * project in this repository yet.
 */
import init, { evalExpr, loadCharacter } from '../../../packages/engine-wasm/engine.js'

await init({ module_or_path: await Deno.readFile(new URL('../../../packages/engine-wasm/engine_bg.wasm', import.meta.url)) })

Deno.serve(async request => {
  try {
    const body = await request.json()
    if (typeof body.expr === 'string') return Response.json({ value: evalExpr(body.expr, body.scope ?? {}) })
    const view = loadCharacter(body.character, body.trees ?? {})
    const context = view.buildContext({})
    const answer = { scope: context.scope, resolution: context.resolve(body.req ?? { kind: 'attack' }) }
    context.free()
    view.free()
    return Response.json(answer)
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 400 })
  }
})
