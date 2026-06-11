import { Outlet, useNavigate } from 'react-router-dom'
import { useCharacter } from '../lib/character'
import { useAuth } from '../lib/auth'
import { Topbar } from './Topbar'
import { Bottombar } from './Bottombar'
import styles from './Layout.module.css'
import { useEffect, useState } from 'react'

export function Layout() {
  const { session, loading: authLoading } = useAuth()
  const { character, loading, error, updateSection } = useCharacter()
  const nav = useNavigate()

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

      {/* corner brackets + vertical side labels framing the content area */}
      <div className={styles.decoLayer} aria-hidden="true">
        <div className={`${styles.corner} ${styles.tl}`} />
        <div className={`${styles.corner} ${styles.tr}`} />
        <div className={`${styles.corner} ${styles.bl}`} />
        <div className={`${styles.corner} ${styles.br}`} />
        <div className={`${styles.sideLabel} ${styles.left}`}>
          <span className="acc">G.U.I.D.E.</span> &nbsp;//&nbsp; v 2.4.7 &nbsp;//&nbsp; Castella Mainframe
        </div>
        <div className={`${styles.sideLabel} ${styles.right}`}>
          Session 04F1A &nbsp;//&nbsp; <span className="acc">Brettany Theater</span> &nbsp;//&nbsp; DM Online
        </div>
      </div>

      <div className={styles.shell}>
        <Topbar character={character} updateSection={updateSection} />
        <main className={styles.main}>
          <Outlet context={{ character, updateSection }} />
        </main>
        <Bottombar />
      </div>
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
