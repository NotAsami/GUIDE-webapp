import { createBrowserRouter, Navigate } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Codex } from './screens/Codex'
import { Login } from './screens/Login'
import { AuthCallback } from './screens/AuthCallback'
import { Stub } from './screens/Stub'
import { Stats } from './screens/Stats'
import { Equipment } from './screens/Equipment'
import { Features } from './screens/Features'
import { Inventory } from './screens/Inventory'
import { Journal } from './screens/Journal'
import { Lore } from './screens/Lore'
import { OperatorConsole } from './screens/OperatorConsole'

export const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  { path: '/auth/callback', element: <AuthCallback /> },
  // DM-only Operator Console (Phase 2). Standalone full-screen surface with its
  // own amber chrome — NOT a child of the player Layout. The screen self-gates on
  // dm_users membership and redirects non-DM users back to '/'.
  { path: '/dm', element: <OperatorConsole /> },
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Codex /> },
      { path: 'equipment', element: <Equipment /> },
      { path: 'inventory', element: <Inventory /> },
      { path: 'stat-panel', element: <Stats /> },
      { path: 'features', element: <Features /> },
      { path: 'character', element: <Stub title="Character" section="sheet"
          blurb="Ability scores + skill/save proficiencies → d20 rolls. Rolling is ephemeral (a log), not persisted state." /> },
      { path: 'shard', element: <Stub title="Shard Interface" section="shards"
          blurb="3 shard slots: G.U.I.D.E. (locked), Vigor (active), empty. Opens the Shard Tree modal — already a data-driven template." /> },
      { path: 'lore', element: <Lore /> },
      { path: 'journal', element: <Journal /> },
      { path: 'spellbook', element: <Stub title="Spellbook" section="spellbook"
          blurb="Caster profile + known/prepared spells + slot state. Empty-state path when spellcasting:false." /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])
