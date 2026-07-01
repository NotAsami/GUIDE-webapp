import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

interface AuthState {
  session: Session | null
  loading: boolean
  signInWithEmail: (email: string) => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    // supabase-js re-emits an auth event (usually SIGNED_IN) every time the tab
    // regains focus, carrying the SAME session. Updating state unconditionally
    // would hand every `session`-keyed hook a new object identity, refire their
    // effects, and flip `loading` true → the whole app unmounts to <Boot> and
    // remounts, discarding any in-progress form draft. Skip no-op updates: only
    // adopt `next` when the token or user actually changed (real refresh / login
    // / logout), so a plain tab refocus is inert.
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(prev =>
        prev?.access_token === next?.access_token && prev?.user?.id === next?.user?.id
          ? prev
          : next,
      )
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const value: AuthState = {
    session,
    loading,
    async signInWithEmail(email) {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      })
      return { error }
    },
    async signOut() {
      await supabase.auth.signOut()
    },
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
