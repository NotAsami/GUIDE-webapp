/** Mutations must distinguish a confirmed write from a handled failure. */
export type SaveResult = { ok: true } | { ok: false; message: string }
