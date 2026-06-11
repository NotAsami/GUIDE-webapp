import { createBrowserRouter, Navigate } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Codex } from './screens/Codex'
import { Login } from './screens/Login'
import { AuthCallback } from './screens/AuthCallback'
import { Stub } from './screens/Stub'

export const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  { path: '/auth/callback', element: <AuthCallback /> },
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Codex /> },
      { path: 'equipment', element: <Stub title="Equipment" section="equipped"
          blurb="Reads the 7 gear slots from `equipped`; resolves item detail from the bundled item catalog. Visual port pending." /> },
      { path: 'inventory', element: <Stub title="Inventory" section="inventory"
          blurb="Carried items with grid position (`col`,`row`) and footprint. Equipped vs carried — one flag decides which; never both." /> },
      { path: 'stat-panel', element: <Stub title="Stat Panel" section="sheet"
          blurb="AC, initiative, speed, proficiency, HP, hit dice, ability scores, saves, skills, senses. HP steppers live in the topbar today; the Stat Panel will own them in the full port." /> },
      { path: 'character', element: <Stub title="Character" section="sheet"
          blurb="Ability scores + skill/save proficiencies → d20 rolls. Rolling is ephemeral (a log), not persisted state." /> },
      { path: 'shard', element: <Stub title="Shard Interface" section="shards"
          blurb="3 shard slots: G.U.I.D.E. (locked), Vigor (active), empty. Opens the Shard Tree modal — already a data-driven template." /> },
      { path: 'lore', element: <Stub title="Lore" section="lore"
          blurb="Backstory prose, personality (TIBF), relations. Read-only for players; DM-authored." /> },
      { path: 'journal', element: <Stub title="Journal" section="progress"
          blurb="Quests and sessions. Mutates objective done-flags; content is DM-authored." /> },
      { path: 'spellbook', element: <Stub title="Spellbook" section="spellbook"
          blurb="Caster profile + known/prepared spells + slot state. Empty-state path when spellcasting:false." /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])
