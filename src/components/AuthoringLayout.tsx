import { Outlet } from 'react-router-dom'
import { CatalogSearch } from './CatalogSearch'
import { ProseToolbar } from './ProseToolbar'

/** Shared authoring tools load only when a DM route is visited. */
export function AuthoringLayout() {
  return <><Outlet /><CatalogSearch /><ProseToolbar /></>
}
