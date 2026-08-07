import { createBrowserRouter, Navigate } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Codex } from './screens/Codex'
import { Login } from './screens/Login'
import { AuthCallback } from './screens/AuthCallback'
import { Stub } from './screens/Stub'
import { Character } from './screens/Character'
import { Stats } from './screens/Stats'
import { Equipment } from './screens/Equipment'
import { Features } from './screens/Features'
import { Inventory } from './screens/Inventory'
import { Journal } from './screens/Journal'
import { Lore } from './screens/Lore'
import { Shard } from './screens/Shard'
import { ShardLattice } from './screens/ShardLattice'
import { OperatorConsole } from './screens/OperatorConsole'

export const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  { path: '/auth/callback', element: <AuthCallback /> },
  // DM-only Operator Console (Phase 2). Standalone full-screen surface with its
  // own amber chrome — NOT a child of the player Layout. The screen self-gates on
  // dm_users membership and redirects non-DM users back to '/'.
  { path: '/dm', element: <OperatorConsole /> },
  { path: '/dm/shards', element: <ShardLattice /> },
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Codex /> },
      { path: 'equipment', element: <Equipment /> },
      { path: 'inventory', element: <Inventory /> },
      { path: 'stat-panel', element: <Stats /> },
      { path: 'features', element: <Features /> },
      { path: 'character', element: <Character /> },
      { path: 'shard', element: <Shard /> },
      { path: 'lore', element: <Lore /> },
      { path: 'journal', element: <Journal /> },
      { path: 'spellbook', element: <Stub title="Spellbook" section="spellbook"
          blurb="Caster profile + known/prepared spells + slot state. Empty-state path when spellcasting:false." /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])
