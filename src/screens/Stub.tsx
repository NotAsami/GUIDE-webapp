import { useOutletContext } from 'react-router-dom'
import type { CharacterRow, CharacterSection } from '../lib/database.types'
import { Nav } from '../components/Nav'

interface RouteContext {
  character: CharacterRow
}

interface Props {
  title: string
  section: CharacterSection
  blurb?: string
}

/** Placeholder for screens not yet wired in Phase 0. Dumps the raw JSONB
 *  section it owns — useful debug surface for the rest of the build. */
export function Stub({ title, section, blurb }: Props) {
  const { character } = useOutletContext<RouteContext>()
  const data = character[section]

  return (
    <div style={{ padding: '40px 24px', maxWidth: 980, margin: '0 auto' }}>
      <div style={{
        fontFamily: 'var(--font-display)', fontSize: 20, letterSpacing: '0.4em',
        textTransform: 'uppercase', color: 'var(--text)', textAlign: 'center',
      }}>
        {title}
      </div>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.3em',
        color: 'var(--cyan)', textTransform: 'uppercase', textAlign: 'center',
        marginTop: 8,
      }}>
        Phase 0 stub — character.{section}
      </div>
      {blurb && (
        <p style={{
          marginTop: 16, fontFamily: 'var(--font-prose)', fontSize: 14,
          color: 'var(--muted)', textAlign: 'center', maxWidth: 640, marginInline: 'auto',
        }}>
          {blurb}
        </p>
      )}
      <pre style={{
        marginTop: 28, padding: 16,
        border: '1px solid var(--beige-dim)', background: 'rgba(0, 0, 0, 0.5)',
        fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--beige)',
        overflow: 'auto', maxHeight: '50vh',
      }}>
        {JSON.stringify(data, null, 2)}
      </pre>
      <div style={{ marginTop: 36 }}><Nav /></div>
    </div>
  )
}
