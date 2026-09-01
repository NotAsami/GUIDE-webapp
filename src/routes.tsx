import { createBrowserRouter, Navigate } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Codex } from './screens/Codex'
import { Login } from './screens/Login'
import { AuthCallback } from './screens/AuthCallback'
import { Character } from './screens/Character'
import { Stats } from './screens/Stats'
import { Equipment } from './screens/Equipment'
import { Features } from './screens/Features'
import { Inventory } from './screens/Inventory'
import { Journal } from './screens/Journal'
import { Lore } from './screens/Lore'
import { Spellbook } from './screens/Spellbook'
import { Shard } from './screens/Shard'
import { ShardLattice } from './screens/ShardLattice'
import FeatureEditor from './screens/FeatureEditor'
import { OperatorConsole } from './screens/OperatorConsole'
import { CatalogSearch } from './components/CatalogSearch'
import { ProseToolbar } from './components/ProseToolbar'

export const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  { path: '/auth/callback', element: <AuthCallback /> },
  // DM-only Operator Console (Phase 2). Standalone full-screen surface with its
  // own amber chrome — NOT a child of the player Layout. The screen self-gates on
  // dm_users membership and redirects non-DM users back to '/'.
  /* CatalogSearch rides alongside each authoring surface rather than inside it:
     it is a Ctrl/Cmd+K overlay that must be reachable from the console, the
     shard lattice AND the feature editor, and mounting it here keeps all three
     screens unaware of it. Not on the player routes — it reads the DM catalogs,
     which RLS returns empty for anyone else.

     ProseToolbar rides along for the same reason and by the same argument: it
     follows focus into any `data-prose` field and offers the icon-insert
     button beside it, so the three authoring screens need no toolbar markup of
     their own. Player screens have no prose field to author. */
  { path: '/dm', element: <><OperatorConsole /><CatalogSearch /><ProseToolbar /></> },
  { path: '/dm/shards', element: <><ShardLattice /><CatalogSearch /><ProseToolbar /></> },
  { path: '/dm/features', element: <><FeatureEditor /><CatalogSearch /><ProseToolbar /></> },
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
      { path: 'spellbook', element: <Spellbook /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])
