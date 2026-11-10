/* tslint:disable */
/* eslint-disable */
export const memory: WebAssembly.Memory;
export const engineConstants: () => [number, number, number];
export const evalExpr: (a: number, b: number, c: any) => [number, number, number];
export const freeIdents: (a: number, b: number) => [number, number];
export const hasIdent: (a: number, b: number) => [number, number];
export const interpolate: (a: number, b: number, c: any) => [number, number, number];
export const interpolations: (a: number, b: number) => [number, number];
export const isHasIdent: (a: number, b: number) => number;
export const start: () => void;
export const __wbindgen_malloc: (a: number, b: number) => number;
export const __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
export const __wbindgen_free: (a: number, b: number, c: number) => void;
export const __wbindgen_exn_store: (a: number) => void;
export const __externref_table_alloc: () => number;
export const __wbindgen_externrefs: WebAssembly.Table;
export const __externref_table_dealloc: (a: number) => void;
export const __externref_drop_slice: (a: number, b: number) => void;
export const __wbindgen_start: () => void;
