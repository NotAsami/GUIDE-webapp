/**
 * Folder paths for the Feature Editor's list.
 *
 * A folder is a STRING ON THE ROW, not a record: `SRD/Bard` is one value in
 * `feature.folder`. Nesting is spelled with `/`, so there is no folder table to
 * keep in sync, no reparenting migration, and no way to orphan a subtree —
 * renaming a parent is a find-and-replace over a prefix.
 *
 * The rules live here rather than inline in the editor because two of them are
 * quietly load-bearing and both are easy to get wrong: plain string sort has to
 * produce depth-first order, and a collapsed parent has to hide a subtree it
 * does not directly contain.
 */

export const SEP = '/'

/** Every ancestor of a path, shallowest first: `a/b/c` → `['a', 'a/b']`. */
export const ancestorsOf = (p: string): string[] =>
  p.split(SEP).slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join(SEP))

/** The part shown on the folder's own row — `SRD/Bard` reads as "Bard". */
export const leafOf = (p: string) => p.slice(p.lastIndexOf(SEP) + 1)

export const depthOf = (p: string) => p.split(SEP).length - 1

/** The full folder set implied by the paths in use, in render order.
 *
 *  Two things happen here. Ancestors are SYNTHESISED — filing one feature in
 *  `SRD/Bard` has to make `SRD` exist, or the child renders with nothing to
 *  nest under. And the sort is a plain string sort, which is already
 *  depth-first: a parent path is a proper PREFIX of its children, and a proper
 *  prefix always sorts first, whatever the separator happens to be.
 *
 *  What that does NOT guarantee is that siblings stay adjacent. A top-level
 *  `SRD-Extra` sorts between `SRD` and `SRD/Bard`, because `-` is below `/`.
 *  Harmless — depth drives the indent and the path drives the collapse — but it
 *  is why the render must not assume the row above it is its parent. */
export function folderSet(paths: Iterable<string>): string[] {
  const set = new Set<string>()
  for (const p of paths) {
    if (!p) continue
    for (const a of ancestorsOf(p)) set.add(a)
    set.add(p)
  }
  return [...set].sort()
}

/** Is this folder hidden because something above it is collapsed?
 *
 *  Collapse is stored per folder, but it has to act on the whole subtree —
 *  closing `SRD` while `SRD/Bard` is separately open must still hide Bard, or
 *  a "collapsed" parent leaves its grandchildren on screen. */
export const hiddenUnder = (path: string, isClosed: (f: string) => boolean) =>
  ancestorsOf(path).some(isClosed)
