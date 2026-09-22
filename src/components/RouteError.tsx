import { isRouteErrorResponse, useRouteError } from 'react-router-dom'

export function RouteError() {
  const error = useRouteError()
  return <main style={{ padding: 32, color: 'var(--beige)' }}>
    <h1>This screen could not load</h1>
    <p>{isRouteErrorResponse(error) ? error.statusText : 'Check your connection, then reload to try again.'}</p>
    <button type="button" onClick={() => window.location.reload()}>Reload</button>
    {' '}<a href="/">Return to the Codex</a>
  </main>
}
