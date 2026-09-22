import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { BootMark } from '../components/BootMark'

/** Magic-link redirect target. Supabase's `detectSessionInUrl: true` parses the
 *  token from the URL hash inside `createClient(...)`; we just wait for the
 *  session to land, then bounce to `/`.
 *
 *  The wait wears the same mark as the pre-bundle shell in index.html, so
 *  clicking the link out of a mail client shows one continuous boot rather than
 *  a white page, then a line of text, then the codex. */
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
        zIndex: 100, padding: 24,
      }}>
        <BootMark>Binding session</BootMark>
      </div>
    </>
  )
}
