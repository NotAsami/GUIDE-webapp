import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { AuthProvider } from './lib/auth'
import { RollLogProvider } from './lib/rolls'
import { router } from './routes'
import './styles/global.css'
import { BootMark } from './components/BootMark'

/** The router's first-chunk wait. Same figure and same `.boot` stage as the
 *  index.html shell it replaces, so the wait never changes shape mid-load. */
const BootFallback = () => <div className="boot"><BootMark>Establishing link</BootMark></div>

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <RollLogProvider>
        <RouterProvider router={router} fallbackElement={<BootFallback />} />
      </RollLogProvider>
    </AuthProvider>
  </StrictMode>,
)
