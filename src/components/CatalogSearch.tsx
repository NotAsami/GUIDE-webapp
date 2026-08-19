/**
 * CATALOG SEARCH — "what is Sanctity, and what else touches it?"
 *
 * A global overlay rather than a tab, because the question comes up while you
 * are in the middle of something else: authoring a shard node, wiring a
 * feature's targets, halfway through a class. A rail tab would mean leaving the
 * form you are filling in to go and look, which is the thing that made you not
 * bother looking. Ctrl/Cmd+K from anywhere, Escape to leave, and the form you
 * were in is exactly where you left it.
 *
 * SEARCHES NAMES AND TAGS TOGETHER. A DM does not know, at the moment of asking,
 * whether "Sanctity" is a feature, a tag or both — that is usually the question.
 * So one field matches either, tags are shown on every row, and clicking a tag
 * re-runs the search for it. That loop is the feature: find the word, see what
 * carries it, see everything else that carries it.
 *
 * Reads `useCatalogNodes`, which every authoring screen already mounts — so
 * opening this costs no extra fetch. That index covers features, spells, items,
 * weapons and shard nodes; effects, classes and races are not in it (it is the
 * TARGETING index, and those cannot be targeted). Worth extending if the gap
 * bites.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useCatalogNodes } from '../lib/useCatalogNodes'
import { normalizeTag } from '../lib/graph'
import styles from './CatalogSearch.module.css'

const LIMIT = 40

type Hit = { gid: string; name: string; kind: string; tags: string[]; why: 'name' | 'tag' }

export function CatalogSearch() {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const { nodes, namesByGid, tagUse, ready } = useCatalogNodes()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(o => !o)
        return
      }
      // Escape closes, but only ours — a picker or dialog on top of this one
      // gets it first because it is mounted later and stops propagation.
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => { if (open) inputRef.current?.focus() }, [open])

  const term = q.trim().toLowerCase()

  const { hits, tags } = useMemo(() => {
    if (!term) return { hits: [] as Hit[], tags: [] as [string, number][] }

    // Matching TAGS first, as their own row: the answer to "what is Sanctity"
    // is often "a tag on nine things", and that should not be buried under the
    // nine things.
    const tagRows = [...tagUse.entries()]
      .filter(([t]) => t.includes(normalizeTag(term)))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)

    const out: Hit[] = []
    for (const n of nodes) {
      const meta = namesByGid.get(n.gid)
      if (!meta) continue
      const nTags = (n.tags ?? []).map(normalizeTag)
      const byName = meta.name.toLowerCase().includes(term)
      const byTag = nTags.some(t => t.includes(normalizeTag(term)))
      if (!byName && !byTag) continue
      out.push({ gid: n.gid, name: meta.name, kind: meta.kind, tags: nTags, why: byName ? 'name' : 'tag' })
    }
    // A name match is the thing you asked for; a tag match is the neighbourhood.
    out.sort((a, b) => (a.why === b.why ? a.name.localeCompare(b.name) : a.why === 'name' ? -1 : 1))
    return { hits: out, tags: tagRows }
  }, [term, nodes, namesByGid, tagUse])

  if (!open) return null

  return createPortal(
    <div className={styles.scrim} onClick={e => { if (e.target === e.currentTarget) setOpen(false) }}>
      <div className={styles.panel} role="dialog" aria-label="Catalog search" aria-modal="true">
        <div className={styles.field}>
          <i className={`fa-solid fa-magnifying-glass ${styles.mag}`} aria-hidden="true" />
          <input
            ref={inputRef}
            className={styles.in}
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search the catalog — a name or a tag…"
            aria-label="Search the catalog"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className={styles.kbd}>ESC</kbd>
        </div>

        <div className={styles.body}>
          {!ready && <div className={styles.none}>Loading the catalog…</div>}

          {ready && !term && (
            <div className={styles.none}>
              Type a name or a tag. {tagUse.size} tags across {nodes.length} entries.
            </div>
          )}

          {ready && term && !tags.length && !hits.length && (
            <div className={styles.none}>Nothing in the catalog matches “{q.trim()}”.</div>
          )}

          {tags.length > 0 && (
            <>
              <div className={styles.sec}>Tags</div>
              <div className={styles.tagRow}>
                {tags.map(([t, n]) => (
                  <button key={t} type="button" className={styles.tagBig} onClick={() => setQ(t)}>
                    {t}<span>{n}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {hits.length > 0 && (
            <>
              <div className={styles.sec}>
                Entries
                <span className={styles.count}>
                  {hits.length > LIMIT ? `showing ${LIMIT} of ${hits.length}` : `${hits.length}`}
                </span>
              </div>
              {hits.slice(0, LIMIT).map(h => (
                <div key={h.gid} className={styles.hit}>
                  <div className={styles.hitHead}>
                    <span className={styles.hitName}>{h.name}</span>
                    <span className={styles.kind}>{h.kind}</span>
                  </div>
                  {h.tags.length > 0 && (
                    <div className={styles.tags}>
                      {h.tags.map(t => (
                        <button
                          key={t}
                          type="button"
                          className={`${styles.tag}${t.includes(normalizeTag(term)) ? ' ' + styles.on : ''}`}
                          onClick={() => setQ(t)}
                          title={`Search for ${t}`}
                        >{t}</button>
                      ))}
                    </div>
                  )}
                  {/* The gid is what a target field stores, so it is the one
                      value worth being able to read off directly. */}
                  <div className={styles.gid}>{h.gid}</div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
