import { createBrowserRouter } from 'react-router-dom'
import { RouteError } from './components/RouteError'

/** Literal dynamic imports give each screen its own production chunk. Player
 * sessions never need to download the authoring console or its editor tools. */
export const router = createBrowserRouter([
  {
    errorElement: <RouteError />,
    children: [
      { path: '/login', lazy: async () => ({ Component: (await import('./screens/Login')).Login }) },
      { path: '/auth/callback', lazy: async () => ({ Component: (await import('./screens/AuthCallback')).AuthCallback }) },
      {
        path: '/dm',
        lazy: async () => ({ Component: (await import('./components/AuthoringLayout')).AuthoringLayout }),
        children: [
          { index: true, lazy: async () => ({ Component: (await import('./screens/OperatorConsole')).OperatorConsole }) },
          { path: 'shards', lazy: async () => ({ Component: (await import('./screens/ShardLattice')).ShardLattice }) },
          { path: 'features', lazy: async () => ({ Component: (await import('./screens/FeatureEditor')).default }) },
        ],
      },
      {
        path: '/',
        lazy: async () => ({ Component: (await import('./components/Layout')).Layout }),
        children: [
          { index: true, lazy: async () => ({ Component: (await import('./screens/Codex')).Codex }) },
          { path: 'story/:storyId', lazy: async () => ({ Component: (await import('./screens/Story')).Story }) },
          { path: 'story/:storyId/:threadId', lazy: async () => ({ Component: (await import('./screens/Story')).Story }) },
          { path: 'equipment', lazy: async () => ({ Component: (await import('./screens/Equipment')).Equipment }) },
          { path: 'inventory', lazy: async () => ({ Component: (await import('./screens/Inventory')).Inventory }) },
          { path: 'stat-panel', lazy: async () => ({ Component: (await import('./screens/Stats')).Stats }) },
          { path: 'features', lazy: async () => ({ Component: (await import('./screens/Features')).Features }) },
          { path: 'character', lazy: async () => ({ Component: (await import('./screens/Character')).Character }) },
          { path: 'shard', lazy: async () => ({ Component: (await import('./screens/Shard')).Shard }) },
          { path: 'lore', lazy: async () => ({ Component: (await import('./screens/Lore')).Lore }) },
          /* The Relations section drawn as a web — a place you navigate to, like
             a story card, because a graph needs the room. */
          { path: 'lore/relations', lazy: async () => ({ Component: (await import('./screens/RelationsWeb')).RelationsWeb }) },
          { path: 'journal', lazy: async () => ({ Component: (await import('./screens/Journal')).Journal }) },
          { path: 'spellbook', lazy: async () => ({ Component: (await import('./screens/Spellbook')).Spellbook }) },
          { path: '*', lazy: async () => ({ Component: (await import('./screens/NotFound')).NotFound }) },
        ],
      },
    ],
  },
])
