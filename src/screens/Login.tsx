import { FormEvent, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import styles from './Login.module.css'

/** Seconds the resend button stays shut after a link goes out. Supabase
 *  rate-limits the OTP endpoint anyway; this makes the wait visible instead of
 *  spending it on a request that comes back refused. */
const RESEND_COOLDOWN = 30

export function Login() {
  const { session, signInWithEmail, loading } = useAuth()
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (!loading && session) nav('/', { replace: true })
  }, [loading, session, nav])

  useEffect(() => {
    if (cooldown <= 0) return
    const id = setInterval(() => setCooldown(s => Math.max(0, s - 1)), 1000)
    return () => clearInterval(id)
  }, [cooldown])

  async function send() {
    setBusy(true)
    setError(null)
    const { error: err } = await signInWithEmail(email.trim())
    setBusy(false)
    if (err) setError(err.message)
    else { setSent(true); setCooldown(RESEND_COOLDOWN) }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    await send()
  }

  return (
    <>
      <div className="stage" />
      <div className="scanlines" />
      <div className="vignette" />

      <div className={styles.sigil} aria-hidden="true">
        <svg width="760" height="760" viewBox="0 0 640 640" fill="none">
          <circle cx="320" cy="320" r="280" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2 10" />
          <circle cx="320" cy="320" r="248" stroke="currentColor" strokeWidth="0.8" />
          <circle cx="320" cy="320" r="196" stroke="currentColor" strokeWidth="0.8" strokeDasharray="26 14" />
          <circle cx="320" cy="320" r="132" stroke="currentColor" strokeWidth="1.2" strokeDasharray="60 24" />
          <path d="M320 188 L434 254 L434 386 L320 452 L206 386 L206 254 Z" stroke="currentColor" strokeWidth="1.4" />
          <path d="M320 236 L392 278 L392 362 L320 404 L248 362 L248 278 Z" stroke="currentColor" strokeWidth="0.8" />
          <path d="M320 292 L348 320 L320 348 L292 320 Z" fill="currentColor" />
          <path d="M40 320 L180 320 M460 320 L600 320" stroke="currentColor" strokeWidth="0.8" strokeDasharray="4 8" />
        </svg>
      </div>

      <span className={`${styles.corner} ${styles.tl}`} />
      <span className={`${styles.corner} ${styles.tr}`} />
      <span className={`${styles.corner} ${styles.bl}`} />
      <span className={`${styles.corner} ${styles.br}`} />

      <div className={`${styles.telemetry} ${styles.telTop}`} aria-hidden="true">
        <span><b>G.U.I.D.E.</b> &nbsp;//&nbsp; v 2.4.7 &nbsp;//&nbsp; Castella Mainframe</span>
        <span>Auth gate &nbsp;//&nbsp; <i>{sent ? 'link sent' : 'link closed'}</i></span>
      </div>

      <div className={styles.wrap}>
        <form onSubmit={onSubmit} className={`${styles.card} ${sent ? styles.dispatched : ''}`}>
          {!sent && (
            <>
              <div className={styles.kicker}>
                <span />
                Neural authentication
                <span />
              </div>
              <h1 className={styles.brand}>G.U.I.D.E.</h1>
              <div className={styles.brandSub}>CODEX</div>
              <div className={styles.divider} aria-hidden="true"><i /><span /><i /></div>
            </>
          )}

          {/* RESOLVING. `loading` means supabase is still answering whether this
              browser already has a session — and if it does, the effect above
              navigates away. Painting the live form through that window offers
              a field that is about to be yanked, so the frame stands and only
              the parts that could change wait. */}
          {loading ? (
            <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column' }}>
              <span className="sk" style={{ display: 'block', width: 118, height: 9 }} />
              <span className="sk" style={{ display: 'block', width: '100%', height: 48, marginTop: 14, border: '1px solid rgba(138, 122, 74, 0.4)' }} />
              <span className="sk" style={{ display: 'block', width: '82%', height: 11, marginTop: 14 }} />
              <span className="sk" style={{ display: 'block', width: '100%', height: 48, marginTop: 22, border: '1px solid rgba(13, 110, 140, 0.45)' }} />
            </div>
          ) : sent ? (
            <div className={styles.sent}>
              <div className={styles.hex} aria-hidden="true"><span>✓</span></div>
              <div className={styles.sentTitle}>Link dispatched</div>
              <div className={styles.chip}>{email}</div>
              <p className={styles.sentBody}>
                Open it in <b>this browser</b> — the link binds the session to the window it is
                opened in, and it works once.
              </p>
              {error && (
                <div className={styles.err} role="alert" style={{ width: '100%' }}>
                  <div className={styles.errTitle}>Resend refused</div>
                  <p className={styles.errRaw}>{error}</p>
                </div>
              )}
              {/* THE TWO WAYS BACK OUT. Before this, `sent` was the end of the
                  road: a mistyped address meant reloading the page. */}
              <div className={styles.sentFoot}>
                <button
                  type="button" className={styles.linkBtn}
                  disabled={busy || cooldown > 0}
                  onClick={() => { void send() }}
                >
                  {cooldown > 0 ? `Send again in ${cooldown}s` : busy ? 'Sending…' : 'Send again'}
                </button>
                <button
                  type="button" className={styles.linkBtn}
                  onClick={() => { setSent(false); setError(null); setCooldown(0) }}
                >
                  Use another address
                </button>
              </div>
            </div>
          ) : (
            <>
              <label htmlFor="login-email" className={`${styles.label} ${error ? styles.bad : ''}`}>
                Registered address
              </label>
              <input
                id="login-email"
                className={`${styles.input} ${error ? styles.bad : ''}`}
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoFocus
                disabled={busy}
                placeholder="you@example.com"
              />
              {error ? (
                <div className={styles.err} role="alert">
                  <div className={styles.errTitle}>Transmission refused</div>
                  <p className={styles.errBody}>The relay would not take that address.</p>
                  <p className={styles.errRaw}>{error}</p>
                </div>
              ) : (
                <p className={styles.help}>
                  No password. A one-time link arrives by mail and opens the codex on the spot.
                </p>
              )}
              <button type="submit" className={styles.submit} disabled={busy || !email}>
                {busy ? (
                  <>Transmitting<span className={styles.dots} aria-hidden="true"><i /><i /><i /></span></>
                ) : 'Transmit link'}
              </button>
              <div className={styles.foot}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <rect x="4" y="10" width="16" height="11" rx="1" />
                  <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                </svg>
                Open the link in this browser
              </div>
            </>
          )}
        </form>
      </div>

      <div className={`${styles.telemetry} ${styles.telBottom}`} aria-hidden="true">
        <span>{sent ? 'Awaiting link' : 'No session bound'} &nbsp;//&nbsp; awaiting credential</span>
        <span>Single use &nbsp;//&nbsp; same browser</span>
      </div>
    </>
  )
}
