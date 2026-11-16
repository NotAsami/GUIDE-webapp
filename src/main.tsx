import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { AuthProvider } from './lib/auth'
import { RollLogProvider } from './lib/rolls'
import { router } from './routes'
import './styles/global.css'
import { BootMark } from './components/BootMark'
import { initEngine } from './lib/engine'

/** The router's first-chunk wait. Same figure and same `.boot` stage as the
 *  index.html shell it replaces, so the wait never changes shape mid-load. */
const BootFallback = () => <div className="boot"><BootMark>Establishing link</BootMark></div>

const root = createRoot(document.getElementById('root')!)

/* The rules engine runs INSIDE render, so its module has to be loaded before
   anything mounts. The index.html `.boot` shell is what shows meanwhile — the
   same figure the router shows next, so the wait never changes shape. Without
   the engine no screen can compute a number, so a failed load is the whole
   page: say so, and offer the one thing that helps. */
initEngine().then(() => root.render(
  <StrictMode>
    <AuthProvider>
      <RollLogProvider>
        <RouterProvider router={router} fallbackElement={<BootFallback />} />
      </RollLogProvider>
    </AuthProvider>
  </StrictMode>,
), e => {
  console.error('[engine] failed to load', e)
  root.render(
    <main className="boot" style={{ gap: 14, padding: 24, textAlign: 'center' }}>
      <p style={{ margin: 0, font: '13px/1.6 var(--font-mono)', color: 'var(--muted)' }}>
        The Codex could not load. Check your connection, then reload to try again.
      </p>
      <button type="button" onClick={() => window.location.reload()}>Reload</button>
    </main>,
  )
})
