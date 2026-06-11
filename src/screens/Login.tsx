import { FormEvent, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'

export function Login() {
  const { session, signInWithEmail, loading } = useAuth()
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!loading && session) nav('/', { replace: true })
  }, [loading, session, nav])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error: err } = await signInWithEmail(email.trim())
    setBusy(false)
    if (err) setError(err.message)
    else setSent(true)
  }

  return (
    <>
      <div className="stage" />
      <div className="scanlines" />
      <div className="vignette" />
      <div style={{
        position: 'fixed', inset: 0, display: 'grid', placeItems: 'center',
        zIndex: 100, padding: 24,
      }}>
        <form onSubmit={onSubmit} style={{
          width: 380, padding: 28,
          border: '1px solid var(--beige)',
          background: 'rgba(10, 10, 10, 0.85)',
          boxShadow: '0 0 24px rgba(0, 0, 0, 0.5)',
        }}>
          <div style={{
            fontFamily: 'var(--font-display)', fontSize: 18, letterSpacing: '0.4em',
            color: 'var(--text)', textTransform: 'uppercase', textAlign: 'center',
          }}>
            G.U.I.D.E. Codex
          </div>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.3em',
            color: 'var(--muted)', textTransform: 'uppercase', textAlign: 'center',
            marginTop: 6, marginBottom: 28,
          }}>
            Neural authentication / magic link
          </div>

          {sent ? (
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.18em',
              color: 'var(--cyan)', textTransform: 'uppercase', textAlign: 'center', lineHeight: 1.6,
            }}>
              <p>Link dispatched.</p>
              <p style={{ color: 'var(--muted)', textTransform: 'none', letterSpacing: '0.02em', marginTop: 12 }}>
                Check your inbox at <b>{email}</b> and click the magic link to authenticate.
                The same browser must complete the link.
              </p>
            </div>
          ) : (
            <>
              <label style={{
                display: 'block', fontFamily: 'var(--font-mono)', fontSize: 9,
                letterSpacing: '0.3em', color: 'var(--cyan)', textTransform: 'uppercase',
                marginBottom: 6,
              }}>
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                disabled={busy}
                placeholder="ros@castella-08"
                style={{
                  width: '100%', padding: '10px 12px',
                  background: 'rgba(0, 0, 0, 0.5)',
                  border: '1px solid var(--beige-dim)',
                  fontFamily: 'var(--font-mono)', fontSize: 13,
                  color: 'var(--beige)', letterSpacing: '0.04em',
                  outline: 'none',
                }}
              />
              {error && (
                <div style={{
                  marginTop: 12, fontFamily: 'var(--font-mono)', fontSize: 10,
                  color: 'var(--danger)', letterSpacing: '0.18em', textTransform: 'uppercase',
                }}>
                  {error}
                </div>
              )}
              <button
                type="submit"
                disabled={busy || !email}
                style={{
                  marginTop: 18, width: '100%', padding: '12px 0',
                  background: 'rgba(0, 166, 214, 0.08)',
                  border: '1px solid var(--cyan-dim)',
                  color: 'var(--cyan-hot)',
                  fontFamily: 'var(--font-display)', fontSize: 13, letterSpacing: '0.3em',
                  textTransform: 'uppercase',
                  opacity: busy || !email ? 0.4 : 1,
                }}
              >
                {busy ? 'Sending…' : 'Send Magic Link'}
              </button>
            </>
          )}
        </form>
      </div>
    </>
  )
}
