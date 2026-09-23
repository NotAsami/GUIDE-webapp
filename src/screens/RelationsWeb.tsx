/**
 * The player's half of the NPC web: who YOU know.
 *
 * Their own Lore relations and every quest giver are theirs already; an NPC's
 * record and an NPC ↔ NPC tie appear only once the Operator reveals them
 * (0024's known_to, enforced by RLS — this screen does no filtering of its
 * own). The drawing and the card are the console's, from NpcWebView, so what
 * the DM checks with "View as" is exactly this.
 *
 * Screen-local reads, like the Journal's: no subscription, since a reveal
 * arriving the next time they open the web is soon enough.
 */
import { useEffect, useMemo, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { Nav } from '../components/Nav'
import { Deco } from '../components/Deco'
import { KnownCard, NpcWebView } from '../components/NpcWebView'
import { derive, layout } from '../lib/npcWeb'
import { useKnownNpcs } from '../lib/npcs'
import { useCampaign } from '../lib/campaign'
import type { CharacterRow } from '../lib/database.types'
import styles from './RelationsWeb.module.css'
import web from '../components/NpcWebView.module.css'

const DRAWER_W = 340

export function RelationsWeb() {
  const { character } = useOutletContext<{ character: CharacterRow }>()
  const { quests } = useCampaign()
  const { npcs, links, loading } = useKnownNpcs()

  const graph = useMemo(() => derive(npcs, links, [character], quests), [npcs, links, character, quests])
  const orbit = useMemo(() => layout(graph), [graph])
  const [sel, setSel] = useState<string | null>(null)
  const selected = sel ? graph.nodes.find(n => n.id === sel) ?? null : null
  useEffect(() => { if (sel && !selected) setSel(null) }, [sel, selected])
  useEffect(() => {
    if (!sel) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSel(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sel])

  const meta = (
    <>
      <span className="dim">◇</span>
      <span>Section</span>
      <span className="acc">/ Lore</span>
      <span className="dim">·</span>
      <span>Relations</span>
      <span className="dim">::</span>
      <span className="acc">{graph.nodes.length} known</span>
    </>
  )

  return (
    <>
      <Deco
        left={<><span className="acc">LORE</span> &nbsp;//&nbsp; RELATIONS &nbsp;//&nbsp; SYNC OK</>}
        right={<>Known <span className="acc">{graph.nodes.length}</span> &nbsp;//&nbsp; {character.name.toUpperCase()}</>}
      />
      <Nav variant="dock" meta={meta} />

      <main className={styles.screen}>
        <NpcWebView
          tone="player" web={graph} orbit={orbit} sel={sel} onSelect={setSel}
          drawerOpen={!!selected} drawerW={DRAWER_W}
          empty={
            <div className={web.empty}>
              <span className={web.emptyT}>{loading ? 'Reading the record…' : 'Nobody on your web yet'}</span>
              {!loading && <span>The people in your Lore and everyone who has given the party a quest appear here.</span>}
            </div>
          }
        >
          <div className={web.toolbar}>
            <Link to="/lore" className={styles.back}><span aria-hidden="true">◀</span> Lore</Link>
            <span className={web.toolSep} />
            <span className={styles.title}>Who you know</span>
            {selected && (
              <span className={web.focusTag}>
                {selected.name}
                <button type="button" className={web.tool} onClick={() => setSel(null)}>Esc · everyone</button>
              </span>
            )}
            <span className={web.count}>{graph.nodes.length} known · {orbit.sectors.length} places</span>
          </div>

          {selected && (
            <aside className={web.drawer} style={{ width: DRAWER_W }} aria-label={selected.name}>
              <KnownCard n={selected} web={graph} onSelect={setSel} onClose={() => setSel(null)} />
            </aside>
          )}
        </NpcWebView>
      </main>
    </>
  )
}
