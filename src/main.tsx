import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { AuthProvider } from './lib/auth'
import { RollLogProvider } from './lib/rolls'
import { router } from './routes'
import './styles/global.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <RollLogProvider>
        <RouterProvider router={router} />
      </RollLogProvider>
    </AuthProvider>
  </StrictMode>,
)
