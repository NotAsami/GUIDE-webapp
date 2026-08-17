import { Outlet, useNavigate } from 'react-router-dom'
import { useCharacter } from '../lib/character'
import { useAuth } from '../lib/auth'
import { useShardCatalog } from '../lib/shardCatalog'
import { useOpenShop } from '../lib/shops'
import { Topbar } from './Topbar'
import { Bottombar } from './Bottombar'
import { RollToast } from './RollToast'
import { SystemToasts } from './SystemToasts'
import { ShopTakeover } from './ShopTakeover'
import { RollContextPanel } from './RollContextPanel'
import { usePresenceAnnounce } from '../lib/presence'
import { consumeArmed } from '../lib/graphState'
import type { CharacterRow } from '../lib/database.types'
import styles from './Layout.module.css'
import { useEffect, useRef, useState } from 'react'

/** Whether the roll panel is open, for the length of the session. */
const PANEL_OPEN = 'guide.rollPanel.open'

export function Layout() {
  const { session, loading: authLoading, signOut } = useAuth()
  const { character, loading, error, updateSection, updateSections } = useCharacter()
  const { catalog: shardTrees } = useShardCatalog()
  const nav = useNavigate()

  // Announce this character on the party-presence channel while the app is
  // open — lights the Link LED on the DM's Operator Console.
  usePresenceAnnounce(character?.id)

  // Shop open/dismiss state lives HERE, not inside ShopTakeover, so the
  // Bottombar's "Reopen Shop" button can see it too. "Leave Shop" is a local
  // dismissal only (players can't close a shop server-side) — a fresh
  // opening (tracked via wasVisibleRef, same "was it visible last render"
  // trick ShopTakeover used to own) always clears a stale dismissal.
  const { shop } = useOpenShop(character?.id)
  const [shopDismissed, setShopDismissed] = useState(false)
  const wasShopVisibleRef = useRef(false)
  useEffect(() => {
    if (shop && !wasShopVisibleRef.current) setShopDismissed(false)
    wasShopVisibleRef.current = !!shop
  }, [shop])

  /* THE PANEL IS STICKY, and ONLY THE PLAYER OPENS IT. It survives navigation
     for free (Layout outlives the routes) and a reload via sessionStorage —
     "within a session" is the ask, so sessionStorage rather than localStorage.

     It does NOT auto-open on a roll. A panel that appears on its own is an
     interruption in the middle of the thing you were doing, and the toast plus
     the counted badge already say a roll landed and where to read it. */
  const [rollPanelOpen, setRollPanelOpen] = useState(() => sessionStorage.getItem(PANEL_OPEN) === '1')

  function setPanel(open: boolean) {
    setRollPanelOpen(open)
    sessionStorage.setItem(PANEL_OPEN, open ? '1' : '0')
  }

  async function handleSignOut() {
    await signOut()
    nav('/login', { replace: true })
  }

  useEffect(() => {
    if (!authLoading && !session) nav('/login', { replace: true })
  }, [authLoading, session, nav])

  if (authLoading || loading) {
    return (
      <>
        <div className="stage" />
        <div className="scanlines" />
        <div className="vignette" />
        <CenterMessage>Loading…</CenterMessage>
      </>
    )
  }

  if (error) {
    return (
      <>
        <div className="stage" />
        <div className="scanlines" />
        <div className="vignette" />
        <CenterMessage>
          <p style={{ color: 'var(--danger)' }}>{error}</p>
          <p style={{ color: 'var(--muted)', fontSize: 11 }}>
            If this is an RLS error, confirm you've been seeded a character row owned by this auth user id.
          </p>
          <SignOutButton onClick={handleSignOut} />
        </CenterMessage>
      </>
    )
  }

  if (!character) {
    return (
      <>
        <div className="stage" />
        <div className="scanlines" />
        <div className="vignette" />
        <CenterMessage>
          <p>No character is bound to this account yet.</p>
          <p style={{ color: 'var(--muted)', fontSize: 12, maxWidth: 540, marginTop: 12 }}>
            Run <code>supabase/seed.sql</code> in the SQL editor with your auth user id substituted into the
            <code> :owner_id </code> placeholder. See <code>docs/GUIDE_Codex_Build_Handoff.md</code> §5 for the canon values.
          </p>
          {session?.user?.email && (
            <p style={{ color: 'var(--beige-dim)', fontSize: 10, letterSpacing: '0.12em', marginTop: 16 }}>
              Signed in as {session.user.email}
            </p>
          )}
          <SignOutButton onClick={handleSignOut} />
        </CenterMessage>
      </>
    )
  }

  return (
    <>
      <div className="stage" />
      <div className="scanlines" />
      <div className="vignette" />
      <Sweep />

      {/* ticker fragments hugging the top divider (cosmetic HUD telemetry) */}
      <div className={`${styles.ticker} ${styles.above}`} aria-hidden="true">
        <span>TASK_MANAGER_SD11S</span><span className="gap" />
        <span className="dim">// AURUM_LEDGER_OK</span><span className="gap" />
        <span>PROTOCOL: 6920-A44</span><span className="gap" />
        <span className="dim">0001 0110 1001 0011 1100</span>
      </div>
      <div className={`${styles.ticker} ${styles.below}`} aria-hidden="true">
        <span>FRAME 04 // SECTOR 12</span><span className="gap" />
        <span className="dim">PARTY.OK</span><span className="gap" />
        <span>SOULBOND 0x4F1A</span><span className="gap" />
        <span className="dim">CHANNEL 1F-Δ</span>
      </div>

      {/* Side-rails + corner frame are now per-screen (Codex owns the frame);
          each screen renders its own <Deco> so the rail text is screen-specific. */}

      <div className={styles.shell}>
        <Topbar character={character} updateSections={updateSections} shardTrees={shardTrees} />
        <main className={styles.main}>
          <Outlet context={{ character, updateSection, updateSections, shardTrees }} />
        </main>
        <Bottombar
          shopOpen={!!shop} shopDismissed={shopDismissed} onReopenShop={() => setShopDismissed(false)}
          rollPanelOpen={rollPanelOpen} onToggleRollPanel={() => setPanel(!rollPanelOpen)}
        />
      </div>

      <RollToast onOpen={() => setPanel(true)} />
      {/* Operator pushes (grants / effects / notices) arrive here via the
          G.U.I.D.E. voice channel — top-right, clear of RollToast. */}
      <SystemToasts characterId={character.id} />
      {/* Shop feature part 1: appears the instant the DM fires a shop open
          (shop_catalog RLS scopes it to this character or the whole party) —
          no route, no nav entry, exists only while a shop is live. */}
      <ShopTakeover character={character} updateSection={updateSection} shop={shop} dismissed={shopDismissed} onDismiss={() => setShopDismissed(true)} />
      {/* The character rides along so the panel's catalog sheet can resolve a
          roll's subject: every catalog table is DM-only, so the player's copy of
          the facts is the snapshot on their own row. */}
      {rollPanelOpen && (
        <RollContextPanel
          character={character} shardTrees={shardTrees}
          onConsumeArmed={id => void updateSection('resources', consumeArmed(character, id) as CharacterRow['resources'])}
          onClose={() => setPanel(false)}
        />
      )}
    </>
  )
}

/** Cyan scan line that sweeps top→bottom every 7–11s. Remounting via `key`
 *  restarts the CSS animation cleanly (mirrors the mockup's reflow trick). */
function Sweep() {
  const [runKey, setRunKey] = useState(0)

  useEffect(() => {
    let timer: number
    const schedule = (delay: number) => {
      timer = window.setTimeout(() => {
        setRunKey(k => k + 1)
        schedule(7000 + Math.random() * 4000)
      }, delay)
    }
    schedule(2500) // first sweep a touch sooner so it's noticed
    return () => window.clearTimeout(timer)
  }, [])

  return <div key={runKey} className={runKey === 0 ? 'sweep' : 'sweep run'} aria-hidden="true" />
}

function SignOutButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        marginTop: 24, padding: '10px 28px',
        background: 'rgba(185, 58, 58, 0.08)',
        border: '1px solid var(--danger)',
        color: 'var(--danger-hot)',
        fontFamily: 'var(--font-display)', fontSize: 12, letterSpacing: '0.3em',
        textTransform: 'uppercase', cursor: 'pointer',
      }}
    >
      Sign Out
    </button>
  )
}

function CenterMessage({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, display: 'grid', placeItems: 'center',
      fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.22em',
      color: 'var(--cyan)', textTransform: 'uppercase', textAlign: 'center',
      zIndex: 100, padding: 24,
    }}>
      <div>{children}</div>
    </div>
  )
}
