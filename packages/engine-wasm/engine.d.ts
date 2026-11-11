/* tslint:disable */
/* eslint-disable */

export type Scope = Record<string, number | boolean>;
export type EngineConstants = {
    VAR_IDENTS: string[]; ROLL_IDENTS: string[]; BOOST_IDENTS: string[];
    ROLL_IDENT_PROBE: Scope; HIT_ASK: string; HAS_PREFIX: string;
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


export function activeSources(character: any, shard_trees: any): any;

export function carryMultiplier(character: any, shard_trees: any): number;

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

export function hasIdent(feature_name: string): string;

export function interpolate(text: string | null | undefined, scope: Scope): Interpolated;

export function interpolations(text?: string | null): string[];

export function isHasIdent(id: string): boolean;

export function parseDice(expr: string): ParsedDice | null;

export function rerollDie(die: RolledDie, random: () => number): RolledDie;

export function rollDice(count: number, sides: number, random: () => number): number[];

export function rollHeal(amount: number | string, random: () => number): HealRoll;

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

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly activeSources: (a: any, b: any) => [number, number, number];
    readonly carryMultiplier: (a: any, b: any) => [number, number, number];
    readonly compileEffects: (a: any, b: any) => any;
    readonly currentBurden: (a: any) => number;
    readonly effectiveSheet: (a: any, b: any) => [number, number, number];
    readonly engineConstants: () => [number, number, number];
    readonly evalExpr: (a: number, b: number, c: any) => [number, number, number];
    readonly freeIdents: (a: number, b: number) => [number, number];
    readonly gearFeatures: (a: any) => any;
    readonly hasIdent: (a: number, b: number) => [number, number];
    readonly interpolate: (a: number, b: number, c: any) => [number, number, number];
    readonly interpolations: (a: number, b: number) => [number, number];
    readonly isHasIdent: (a: number, b: number) => number;
    readonly parseDice: (a: number, b: number) => [number, number, number];
    readonly rerollDie: (a: any, b: any) => [number, number, number];
    readonly rollDice: (a: number, b: number, c: any) => [number, number, number];
    readonly rollHeal: (a: any, b: any) => [number, number, number];
    readonly rolledDice: (a: number, b: number, c: any) => [number, number, number];
    readonly rolledDiceTerms: (a: number, b: number, c: number, d: any) => [number, number, number];
    readonly shardFeatures: (a: any, b: any) => any;
    readonly sheetEffects: (a: any, b: any) => [number, number, number];
    readonly start: () => void;
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
