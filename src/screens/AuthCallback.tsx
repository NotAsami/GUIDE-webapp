import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'

/** Magic-link redirect target. Supabase's `detectSessionInUrl: true` parses the
 *  token from the URL hash inside `createClient(...)`; we just wait for the
 *  session to land, then bounce to `/`. */
export function AuthCallback() {
  const { session, loading } = useAuth()
  const nav = useNavigate()

  useEffect(() => {
    if (loading) return
    nav(session ? '/' : '/login', { replace: true })
  }, [session, loading, nav])

  return (
    <>
      <div className="stage" />
      <div className="scanlines" />
      <div className="vignette" />
      <div style={{
        position: 'fixed', inset: 0, display: 'grid', placeItems: 'center',
        fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.22em',
        color: 'var(--cyan)', textTransform: 'uppercase',
      }}>
        Linking neural session…
      </div>
    </>
  )
}
