/* tslint:disable */
/* eslint-disable */

export type Scope = Record<string, number | boolean>;
export type EngineConstants = {
    VAR_IDENTS: string[]; ROLL_IDENTS: string[]; BOOST_IDENTS: string[];
    ROLL_IDENT_PROBE: Scope; HIT_ASK: string; HAS_PREFIX: string;
    OPS: Record<string, { group: string; fields: { key: string; label: string; required: boolean; array: boolean }[] }>;
};


/**
 * dice.ts:18's result. `mod` is always present, 0 when the expression has none.
 */
export interface ParsedDice {
    count: number;
    sides: number;
    mod: number;
}

/**
 * dice.ts:47. One die as it sits in a roll record.
 */
export interface RolledDie {
    v: number;
    sides: number;
    orig?: number;
    rerolled?: boolean;
    crit?: boolean;
}

/**
 * dice.ts:62's result.
 */
export interface HealRoll {
    total: number;
    breakdown: string;
}

/**
 * expr.ts:15. `num` carries a flat part and unrolled dice terms.
 */
export type FormulaValue = { t: "num"; flat: number; dice: string[] } | { t: "bool"; v: boolean } | { t: "arr"; v: number[] } | { t: "str"; v: string };

export interface Interpolated {
    text: string;
    bad: string[];
}


/**
 * The feature graph of one character, built once and asked many times. It lives
 * in WebAssembly memory so that a roll sends a small request across the
 * boundary, not the whole character.
 */
export class GraphContext {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    affectedBy(target: string, tags: any): any;
    /**
     * `{ resist, vuln, immune }`.
     */
    damageFlags(dmg_type: string): any;
    /**
     * `[index, byOwner]`, each a list of `[key, entries]` in order. Large: only
     * the two callers that walk the whole index should ask.
     */
    indexDump(): any;
    resolve(req: any): any;
    /**
     * `scope` defaults to the context's own.
     */
    staleArmed(scope: any): any;
    /**
     * The ids, in order; the facade makes the `Set`.
     */
    suppressedEffects(character: any): any;
    readonly armed: any;
    readonly problems: any;
    readonly scope: any;
}

export function activeSources(character: any, shard_trees: any): any;

export function armedMatches(m: any, req: any): boolean;

export function asKey(target: string): string;

export function askKey(raw: string): string;

export function auditNode(node: any, nodes: any, catalog_types: any): any;

export function auditVars(defs: any, catalog_types: any): any;

export function baseScope(character: any, shard_trees: any): any;

export function buildContext(character: any, shard_trees: any, catalog_types: any): GraphContext;

export function carryMultiplier(character: any, shard_trees: any): number;

export function characterVars(character: any, shard_trees: any, catalog_types: any): any;

/**
 * `[name, { def, from }]` pairs, in order; the facade makes the `Map`.
 */
export function collectVars(sources: any): any;

export function compileEffects(mods: any, skills: any): any;

export function currentBurden(character: any): number;

export function effectiveSheet(character: any, shard_trees: any): any;

/**
 * The engine's constant lists, read once at boot.
 */
export function engineConstants(): EngineConstants;

export function evalExpr(src: string, scope: Scope): FormulaValue | null;

export function freeIdents(src: string): string[];

export function gearFeatures(character: any): any;

export function gid(kind: string, x: any): string;

export function hasIdent(feature_name: string): string;

export function interpolate(text: string | null | undefined, scope: Scope): Interpolated;

export function interpolations(text?: string | null): string[];

export function isHasIdent(id: string): boolean;

export function matchCount(selector: string, nodes: any): number;

export function nodeGid(shard_id: string, node_id: string): string;

export function normalizeTag(raw: string): string;

export function parseDice(expr: string): ParsedDice | null;

/**
 * `{ scope, audit }`. The original appends to an array it is handed; the facade does that part.
 */
export function probeScope(defs: any, catalog_types: any): any;

export function reqKeys(req: any): string[];

export function rerollDie(die: RolledDie, random: () => number): RolledDie;

export function rollDice(count: number, sides: number, random: () => number): number[];

export function rollHeal(amount: number | string, random: () => number): HealRoll;

export function rollResolution(res: any, double: boolean, own_type: any, random: Function): any;

export function rolledDice(count: number, sides: number, random: () => number): RolledDie[];

export function rolledDiceTerms(exprs: string[], double: boolean, random: () => number): RolledDie[];

export function shardFeatures(character: any, catalog: any): any;

/**
 * `scope` is read in place, like every scope; omit it and every boost must be a literal.
 */
export function sheetEffects(graph: any, scope: any): any;

/**
 * Development only: a panic prints its message instead of `unreachable`.
 */
export function start(): void;

export function total(res: any): any;

/**
 * `decls` is `[{ name, from }]`.
 */
export function varCollisions(decls: any, sev: string): any;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_graphcontext_free: (a: number, b: number) => void;
    readonly activeSources: (a: any, b: any) => [number, number, number];
    readonly armedMatches: (a: any, b: any) => number;
    readonly asKey: (a: number, b: number) => [number, number];
    readonly askKey: (a: number, b: number) => [number, number];
    readonly auditNode: (a: any, b: any, c: any) => [number, number, number];
    readonly auditVars: (a: any, b: any) => [number, number, number];
    readonly baseScope: (a: any, b: any) => [number, number, number];
    readonly buildContext: (a: any, b: any, c: any) => [number, number, number];
    readonly carryMultiplier: (a: any, b: any) => [number, number, number];
    readonly characterVars: (a: any, b: any, c: any) => [number, number, number];
    readonly collectVars: (a: any) => any;
    readonly compileEffects: (a: any, b: any) => any;
    readonly currentBurden: (a: any) => number;
    readonly effectiveSheet: (a: any, b: any) => [number, number, number];
    readonly engineConstants: () => [number, number, number];
    readonly evalExpr: (a: number, b: number, c: any) => [number, number, number];
    readonly freeIdents: (a: number, b: number) => [number, number];
    readonly gearFeatures: (a: any) => any;
    readonly gid: (a: number, b: number, c: any) => [number, number];
    readonly graphcontext_affectedBy: (a: number, b: number, c: number, d: any) => any;
    readonly graphcontext_armed: (a: number) => any;
    readonly graphcontext_damageFlags: (a: number, b: number, c: number) => [number, number, number];
    readonly graphcontext_indexDump: (a: number) => any;
    readonly graphcontext_problems: (a: number) => any;
    readonly graphcontext_resolve: (a: number, b: any) => [number, number, number];
    readonly graphcontext_scope: (a: number) => any;
    readonly graphcontext_staleArmed: (a: number, b: any) => [number, number, number];
    readonly graphcontext_suppressedEffects: (a: number, b: any) => [number, number, number];
    readonly hasIdent: (a: number, b: number) => [number, number];
    readonly interpolate: (a: number, b: number, c: any) => [number, number, number];
    readonly interpolations: (a: number, b: number) => [number, number];
    readonly isHasIdent: (a: number, b: number) => number;
    readonly matchCount: (a: number, b: number, c: any) => number;
    readonly nodeGid: (a: number, b: number, c: number, d: number) => [number, number];
    readonly normalizeTag: (a: number, b: number) => [number, number];
    readonly parseDice: (a: number, b: number) => [number, number, number];
    readonly probeScope: (a: any, b: any) => [number, number, number];
    readonly reqKeys: (a: any) => [number, number];
    readonly rerollDie: (a: any, b: any) => [number, number, number];
    readonly rollDice: (a: number, b: number, c: any) => [number, number, number];
    readonly rollHeal: (a: any, b: any) => [number, number, number];
    readonly rollResolution: (a: any, b: number, c: any, d: any) => [number, number, number];
    readonly rolledDice: (a: number, b: number, c: any) => [number, number, number];
    readonly rolledDiceTerms: (a: number, b: number, c: number, d: any) => [number, number, number];
    readonly shardFeatures: (a: any, b: any) => any;
    readonly sheetEffects: (a: any, b: any) => [number, number, number];
    readonly start: () => void;
    readonly total: (a: any) => any;
    readonly varCollisions: (a: any, b: number, c: number) => any;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __externref_drop_slice: (a: number, b: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
