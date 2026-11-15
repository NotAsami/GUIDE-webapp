import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { AuthProvider } from './lib/auth'
import { RollLogProvider } from './lib/rolls'
import { router } from './routes'
import './styles/global.css'
import { BootMark } from './components/BootMark'
import { bootEngine } from './lib/engine'

/** The router's first-chunk wait. Same figure and same `.boot` stage as the
 *  index.html shell it replaces, so the wait never changes shape mid-load. */
const BootFallback = () => <div className="boot"><BootMark>Establishing link</BootMark></div>

/* The rules engine runs INSIDE render, so if this device is set to the Rust
   engine its module has to be loaded before anything mounts. The index.html
   `.boot` shell is what shows meanwhile — the same figure the router shows
   next, so the wait never changes shape. On the default setting this resolves
   at once and nothing is fetched. It never rejects: see bootEngine. */
void bootEngine().then(() => createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <RollLogProvider>
        <RouterProvider router={router} fallbackElement={<BootFallback />} />
      </RollLogProvider>
    </AuthProvider>
  </StrictMode>,
))
