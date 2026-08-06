import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import type { CharacterRow, Relation } from '../lib/database.types'
import { Nav } from '../components/Nav'
import { Deco } from '../components/Deco'
import { Prose, renderInline } from '../lib/markdown'
import styles from './Lore.module.css'

interface RouteContext {
  character: CharacterRow
}

const VITALS: { k: string; v: (c: CharacterRow) => string | undefined }[] = [
  { k: 'Race', v: c => c.identity?.race ?? undefined },
  { k: 'Class', v: c => c.identity?.class ?? undefined },
  { k: 'Archetype', v: c => c.identity?.archetype ?? undefined },
  { k: 'Background', v: c => c.identity?.background ?? undefined },
  { k: 'Alignment', v: c => c.lore?.identity?.alignment },
  { k: 'Age', v: c => c.lore?.identity?.age },
  { k: 'Height', v: c => c.lore?.identity?.height },
  { k: 'Deity', v: c => c.lore?.identity?.deity },
  { k: 'Homeland', v: c => c.lore?.identity?.homeland },
]

const NATURE: { key: 'trait' | 'ideal' | 'bond' | 'flaw'; label: string }[] = [
  { key: 'trait', label: 'Personality Trait' },
  { key: 'ideal', label: 'Ideal' },
  { key: 'bond', label: 'Bond' },
  { key: 'flaw', label: 'Flaw' },
]

/** Lore screen — read-only for players, authored DM-side in the Operator
 *  Console's Lore tab. Renders entirely from `character.identity` +
 *  `character.lore`; every section has an honest empty state for a
 *  freshly-seeded character (`lore = {}`). */
export function Lore() {
  const { character } = useOutletContext<RouteContext>()
  const identity = character.identity ?? {}
  const lore = character.lore ?? {}

  const idLine = [identity.race, identity.class].filter(Boolean).join(' ')
  const archLine = [identity.archetype].filter(Boolean).join('')

  const meta = (
    <>
      <span className="dim">◇</span>
      <span>Section</span>
      <span className="acc">/ Lore</span>
      <span className="dim">·</span>
      <span>Bio-Record</span>
      <span className="dim">·</span>
      <span className="stamp">REC_0x4F1A</span>
      <span className="dim">::</span>
      <span className="acc">Online</span>
    </>
  )

  return (
    <>
      <Deco
        left={<><span className="acc">LORE</span> &nbsp;//&nbsp; BIO_RECORD &nbsp;//&nbsp; SYNC OK</>}
        right={<>Record <span className="acc">{character.name.toUpperCase()}</span> &nbsp;//&nbsp; DM-Authored</>}
      />
      <Nav variant="dock" meta={meta} />

      <main className={styles.lore}>
        <section className={styles.col} aria-label="Dossier">
          <div className={styles.colHeader}>
            <span className={styles.chNum}>01</span>
            <span className={styles.chTitle}>Dossier</span>
            <span className={styles.chMeta}><span className="acc">Bio</span> · Locked</span>
          </div>
          <div className={styles.region}>
            <div className={styles.rFrame} /><div className={styles.rGap} /><div className={styles.rLine} />
            <div className={styles.rInner}>
              <span className={`${styles.rCorner} ${styles.tl}`} />
              <span className={`${styles.rCorner} ${styles.br}`} />
              <div className={styles.dossierPad}>
                <BioPortrait character={character} />

                <div className={styles.nameplate}>
                  <div className={styles.npName}>{character.name}</div>
                  {(idLine || archLine) && (
                    <div className={styles.npSub}>
                      {idLine}
                      {idLine && archLine && <span className={styles.sep}> · </span>}
                      {archLine}
                    </div>
                  )}
                </div>

                <div className={styles.vitalsRule} />
                <div className={styles.vitalsLabel}>
                  <span className="acc">◇</span> Identity <span className="acc">::</span> Vitals
                </div>
                <div className={`${styles.vitals} ${styles.scrollY}`}>
                  {VITALS.map(({ k, v }) => {
                    const value = v(character)
                    return (
                      <div className={styles.vital} key={k}>
                        <span className={styles.vK}>{k}</span>
                        <span className={value ? styles.vV : `${styles.vV} ${styles.muted}`}>{value ?? '—'}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.col} aria-label="Character record">
          <div className={styles.colHeader}>
            <span className={styles.chNum}>02</span>
            <span className={styles.chTitle}>Record</span>
            <span className={styles.chMeta}>Backstory <span className="dim">·</span> Nature <span className="dim">·</span> Relations</span>
          </div>
          <div className={styles.region}>
            <div className={styles.rFrame} /><div className={styles.rGap} /><div className={styles.rLine} />
            <div className={styles.rInner}>
              <span className={`${styles.rCorner} ${styles.tl}`} />
              <span className={`${styles.rCorner} ${styles.br}`} />
              <div className={`${styles.readPad} ${styles.scrollY}`}>
                <div className={styles.readInner}>

                  <section className={styles.dossierSec} aria-label="Backstory">
                    <div className={styles.secLabel}><span className={styles.num}>02</span> Backstory</div>
                    {lore.backstory ? (
                      <Prose text={lore.backstory} className={styles.prose} />
                    ) : (
                      <p className={styles.stateSub}>// No record on file</p>
                    )}
                    {lore.memoryFidelity && (
                      <div className={styles.memNote} aria-hidden="true">
                        <div className={styles.mnRow}><span className={styles.k}>Memory Fidelity:</span> <span className={styles.v}>{lore.memoryFidelity}</span></div>
                      </div>
                    )}
                  </section>

                  <section className={styles.dossierSec} aria-label="Nature">
                    <div className={styles.secLabel}><span className={styles.num}>03</span> Nature</div>
                    {NATURE.some(n => lore.personality?.[n.key]) ? (
                      <div className={styles.natureGrid}>
                        {NATURE.map(({ key, label }) => (
                          <div className={styles.natCard} key={key}>
                            <div className={styles.ncFrame} />
                            <div className={styles.ncInner}>
                              <div className={styles.ncKey}><i className="fa-solid fa-circle-dot" /> {label}</div>
                              <div className={styles.ncVal}>
                                {lore.personality?.[key] ? renderInline(lore.personality[key]!) : '—'}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className={styles.stateSub}>// No record on file</p>
                    )}
                  </section>

                  <section className={styles.dossierSec} aria-label="Relations">
                    <div className={styles.secLabel}><span className={styles.num}>04</span> Relations</div>
                    {lore.relations && lore.relations.length > 0 ? (
                      <div className={styles.relations}>
                        {lore.relations.map((r, i) => <RelationRow key={i} r={r} />)}
                      </div>
                    ) : (
                      <p className={styles.stateSub}>// No relations on file</p>
                    )}
                  </section>

                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </>
  )
}

function BioPortrait({ character }: { character: CharacterRow }) {
  const id = character.identity ?? {}
  const [imgFailed, setImgFailed] = useState(false)
  useEffect(() => { setImgFailed(false) }, [id.portrait])
  const showImage = !!id.portrait && !imgFailed

  return (
    <div className={styles.bioPortrait} tabIndex={0} aria-label={`Bio-portrait of ${character.name}`}>
      <div className={styles.bpLine} />
      <div className={styles.bpInner}>
        <span className={`${styles.bpCorner} ${styles.tl}`} />
        <span className={`${styles.bpCorner} ${styles.tr}`} />
        <span className={`${styles.bpCorner} ${styles.bl}`} />
        <span className={`${styles.bpCorner} ${styles.br}`} />
        <span className={styles.bpGrid} />
        <div className={styles.bpArt}>
          {showImage ? (
            <img
              className={styles.bpImg}
              src={id.portrait ?? undefined}
              alt={character.name}
              onError={() => setImgFailed(true)}
            />
          ) : (
            <i className={`${styles.bpFigure} fa-solid ${id.icon ?? 'fa-user'}`} />
          )}
        </div>
        <span className={styles.bpTag}>
          <span className={styles.lockDot} />
          <span className={styles.lk}>Bio-Scan: Locked</span>
        </span>
      </div>
    </div>
  )
}

function RelationRow({ r }: { r: Relation }) {
  const guide = r.type === 'System · Bonded'
  const att = r.attitude ?? 'undefined'
  const attLabel = att === 'friendly' ? 'Friendly' : att === 'neutral' ? 'Neutral' : att === 'wary' ? 'Wary' : att === 'hostile' ? 'Hostile' : '—'
  return (
    <div className={`${styles.relRow} ${guide ? styles.guide : ''}`}>
      <div className={styles.relHead}>
        <span className={styles.relName}>{r.name}</span>
        <span className={styles.relTag}>{r.type}</span>
      </div>
      <div className={styles.attitude} data-att={att}>
        <span className={styles.attBars}>
          <span className={styles.attSeg} /><span className={styles.attSeg} /><span className={styles.attSeg} />
        </span>
        <span className={styles.attLabel}>{attLabel}</span>
      </div>
      <div className={styles.relDesc}>{renderInline(r.desc)}</div>
    </div>
  )
}
