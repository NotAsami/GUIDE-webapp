import { isRouteErrorResponse, useRouteError } from 'react-router-dom'

/** A route chunk failed to load (usually a stale deploy or a dropped
 *  connection). Lives outside Layout, so it borrows index.html's `.boot` stage
 *  to stay in the world instead of rendering browser-default type on grey. */
export function RouteError() {
  const error = useRouteError()
  return (
    <main className="boot" style={{ gap: 14, padding: 24, textAlign: 'center' }}>
      <h1 style={{ margin: 0, font: '600 20px/1.3 var(--font-display)', letterSpacing: '0.2em', color: 'var(--beige)', textTransform: 'uppercase' }}>
        This screen could not load
      </h1>
      <p style={{ margin: 0, font: '13px/1.6 var(--font-mono)', color: 'var(--muted)' }}>
        {isRouteErrorResponse(error) ? error.statusText : 'Check your connection, then reload to try again.'}
      </p>
      <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
        <button type="button" onClick={() => window.location.reload()} style={BTN}>Reload</button>
        <a href="/" style={{ ...BTN, color: 'var(--beige)', borderColor: 'var(--beige-dim)', textDecoration: 'none' }}>Return to the Codex</a>
      </div>
    </main>
  )
}

const BTN: React.CSSProperties = {
  padding: '9px 20px', background: 'transparent',
  border: '1px solid var(--cyan)', color: 'var(--cyan-hot)',
  font: '11px/1 var(--font-mono)', letterSpacing: '0.16em', textTransform: 'uppercase', cursor: 'pointer',
}
