import { useMemo } from 'react'
import { useOutletContext } from 'react-router-dom'
import type { CharacterRow, ProgressStory } from '../lib/database.types'
import { Nav } from '../components/Nav'
import styles from './Codex.module.css'

interface RouteContext {
  character: CharacterRow
}

const FALLBACK_STORIES: ProgressStory[] = []

/** Home / Codex screen.
 *
 *  This is the Phase 0 wired-end-to-end screen: the three story cards render
 *  entirely from `character.progress.stories[]`. Nothing in this file
 *  hardcodes a percentage or chapter name. Edit the row in Supabase → reload →
 *  cards reflect the new values. That's the contract. */
export function Codex() {
  const { character } = useOutletContext<RouteContext>()
  const stories = character.progress?.stories ?? FALLBACK_STORIES

  return (
    <>
      <Glyph />
      <section className={styles.storyRow} aria-label="Story progress">
        {stories.length === 0 && (
          <div style={{
            color: 'var(--muted)', fontFamily: 'var(--font-mono)',
            fontSize: 11, letterSpacing: '0.22em', textTransform: 'uppercase',
            textAlign: 'center', padding: '40px 0',
          }}>
            No story progress entries yet. Seed `progress.stories` in the character row.
          </div>
        )}
        {stories.map(story => (
          <StoryCard key={story.id} story={story} />
        ))}
      </section>
      <Nav />
    </>
  )
}

/** Rotating G.U.I.D.E. sigil behind the story cards. Ported verbatim from
 *  the Codex mockup's background glyph; purely decorative. */
function Glyph() {
  const ticks = useMemo(() => {
    const cx = 320, cy = 320
    return Array.from({ length: 60 }, (_, i) => {
      const angle = (i * 6) * Math.PI / 180
      const major = i % 5 === 0
      const r1 = 280
      const r2 = major ? 264 : 272
      return {
        x1: cx + Math.cos(angle) * r1, y1: cy + Math.sin(angle) * r1,
        x2: cx + Math.cos(angle) * r2, y2: cy + Math.sin(angle) * r2,
        opacity: major ? 0.85 : 0.4,
        width: major ? 1.4 : 0.8,
      }
    })
  }, [])

  return (
    <div className={styles.glyphWrap} aria-hidden="true">
      <svg className={styles.glyph} viewBox="0 0 640 640" fill="none" stroke="currentColor" strokeWidth="1.2">
        <g className={styles.rotateSlow}>
          <circle cx="320" cy="320" r="300" strokeOpacity="0.6" />
          <circle cx="320" cy="320" r="292" strokeOpacity="0.3" />
          <g strokeOpacity="0.7" />
          <g>
            {ticks.map((t, i) => (
              <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2}
                strokeOpacity={t.opacity} strokeWidth={t.width} />
            ))}
          </g>
          <polygon points="320,80 528,200 528,440 320,560 112,440 112,200" strokeOpacity="0.5" />
          <polygon points="320,108 504,214 504,426 320,532 136,426 136,214" strokeOpacity="0.25" />
        </g>

        <g className={styles.rotateRev}>
          <g strokeOpacity="0.6">
            <line x1="320" y1="40" x2="320" y2="600" />
            <line x1="40" y1="320" x2="600" y2="320" />
            <line x1="120" y1="120" x2="520" y2="520" />
            <line x1="520" y1="120" x2="120" y2="520" />
          </g>
          <circle cx="320" cy="320" r="220" strokeOpacity="0.6" strokeDasharray="3 6" />
          <polygon points="320,140 447,193 500,320 447,447 320,500 193,447 140,320 193,193" strokeOpacity="0.55" />
          <polygon points="320,210 430,320 320,430 210,320" strokeOpacity="0.7" />
        </g>

        <g>
          <g stroke="currentColor" strokeOpacity="0.8">
            <g transform="translate(320 92)">
              <polygon points="0,-10 10,0 0,10 -10,0" />
              <line x1="0" y1="-18" x2="0" y2="-26" />
            </g>
            <g transform="translate(548 320)">
              <polygon points="0,-10 10,0 0,10 -10,0" />
              <line x1="18" y1="0" x2="26" y2="0" />
            </g>
            <g transform="translate(320 548)">
              <polygon points="0,-10 10,0 0,10 -10,0" />
              <line x1="0" y1="18" x2="0" y2="26" />
            </g>
            <g transform="translate(92 320)">
              <polygon points="0,-10 10,0 0,10 -10,0" />
              <line x1="-18" y1="0" x2="-26" y2="0" />
            </g>
          </g>

          <g>
            <circle cx="320" cy="320" r="84" strokeOpacity="0.55" />
            <circle cx="320" cy="320" r="60" strokeOpacity="0.4" strokeDasharray="2 4" />
            <polygon points="320,250 380,355 260,355" strokeOpacity="0.8" />
            <polygon points="320,390 260,285 380,285" strokeOpacity="0.8" />
            <g className={styles.pulse}>
              <circle cx="320" cy="320" r="14" fill="rgba(0,166,214,0.45)" stroke="#00a6d6" strokeOpacity="0.9" strokeWidth="0.8" />
              <circle cx="320" cy="320" r="4" fill="#00a6d6" />
            </g>
          </g>
        </g>

        <g fill="currentColor" stroke="none" fontFamily="JetBrains Mono, monospace" fontSize="9" opacity="0.55" letterSpacing="2">
          <text x="320" y="32" textAnchor="middle">0x4F1A · 22:08:47</text>
          <text x="608" y="324" textAnchor="end">SECTOR.12</text>
          <text x="320" y="616" textAnchor="middle">NODE → CASTELLA-08</text>
          <text x="32" y="324" textAnchor="start">CH. 1F-Δ</text>
        </g>
      </svg>
    </div>
  )
}

function StoryCard({ story }: { story: ProgressStory }) {
  return (
    <div className={styles.cardWrap}>
      <button className={styles.card} type="button">
        <span className={styles.frame} />
        <span className={styles.inner}>
          {story.telemetry && <span className={styles.telemetry}>{story.telemetry}</span>}
          <Emblem kind={story.emblem} />
          <span className={styles.title}>
            <span>{story.title}</span>
            <span className="dot">●</span>
          </span>
        </span>
      </button>
      <div className={styles.pct}>
        {story.percent}<span className={styles.pctSign}>%</span>
        <div className={styles.pctLabel}>{story.label}</div>
      </div>
      {(story.chapter || story.tooltip) && (
        <div className={styles.tooltip}>
          <strong>{story.label}</strong>
          {story.tooltip ?? (story.chapter ? `Current chapter: ${story.chapter}` : '')}
        </div>
      )}
    </div>
  )
}

function Emblem({ kind }: { kind: ProgressStory['emblem'] }) {
  switch (kind) {
    case 'character':
      return (
        <svg className={styles.emblem} viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="1.6">
          <polygon points="50,8 92,82 8,82" />
          <polygon points="50,24 80,76 20,76" />
          <line x1="50" y1="40" x2="50" y2="76" />
          <circle cx="50" cy="56" r="6" strokeWidth="1.4" />
          <line x1="20" y1="92" x2="80" y2="92" strokeDasharray="2 3" opacity="0.6" />
        </svg>
      )
    case 'main':
      return (
        <svg className={styles.emblem} viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="1.6">
          <polyline points="14,72 50,40 86,72" />
          <polyline points="14,58 50,26 86,58" />
          <polyline points="14,86 50,54 86,86" opacity="0.5" />
          <circle cx="50" cy="32" r="3" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'region':
      return (
        <svg className={styles.emblem} viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="50" cy="50" r="34" />
          <circle cx="50" cy="50" r="22" strokeDasharray="2 3" />
          <line x1="50" y1="6" x2="50" y2="94" />
          <line x1="6" y1="50" x2="94" y2="50" />
          <polygon points="50,38 60,50 50,62 40,50" fill="currentColor" stroke="none" opacity="0.85" />
        </svg>
      )
  }
}
