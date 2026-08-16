import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useOutletContext } from 'react-router-dom'
import type { CharacterRow, CharacterSection, Feature, FeatureCategory, ShardPerk, ShardTree } from '../lib/database.types'
import { Nav } from '../components/Nav'
import { Deco } from '../components/Deco'
import { gearFeatures } from '../lib/effects'
import { shardFeatures, shardPerks } from '../lib/shards'
import { Prose } from '../lib/markdown'
import { gid } from '../lib/graph'
import { useGraph } from '../lib/useGraph'
import { playerVars, setVars } from '../lib/graphState'
import { useActivation } from '../components/ActivationSheet'
import styles from './Features.module.css'

interface RouteContext {
  character: CharacterRow
  updateSection: <K extends CharacterSection>(section: K, next: CharacterRow[K]) => Promise<void>
  /** Needed when a use writes `sheet` AND `resources` — one round trip, not two
   *  that could land apart. Provided by Layout; this screen used to ignore it. */
  updateSections: (patch: Partial<Pick<CharacterRow, CharacterSection>>) => Promise<void>
  shardTrees?: Record<string, ShardTree>
}

/** Display order + labels for the dossier sections. Empty groups are skipped. */
const GROUPS: { key: FeatureCategory; label: string; icon: string }[] = [
  { key: 'class',      label: 'Class Features', icon: 'fa-shield-halved' },
  { key: 'feat',       label: 'Feats',          icon: 'fa-star' },
  { key: 'racial',     label: 'Racial Traits',  icon: 'fa-dna' },
  { key: 'background', label: 'Background',      icon: 'fa-scroll' },
  { key: 'sense',      label: 'Senses',         icon: 'fa-eye' },
  { key: 'other',      label: 'Other',          icon: 'fa-asterisk' },
]

const COLS = 3

/** A feature can be "used" when it rolls something, tracks limited uses, or has
 *  activation outcomes to run — where a `once` contribution counts, because
 *  arming it IS the press (§16). Without this a feature whose only effect is
 *  "arm your next attack" would have no button to arm it with. */
function isUsable(f: Feature): boolean {
  return !!f.roll || !!f.uses
    || (f.graph ?? []).some(e => e.op === 'setVar' || e.op === 'addVar' || e.once)
}

/** The short text shown on the card (scales the card). Falls back to the legacy
 *  summary/description fields so pre-migration data still renders. */
function cardText(f: Feature): string {
  return f.light_description ?? f.summary ?? f.description ?? ''
}

/** Features — a dossier of the character's class features, feats, racial traits
 *  and senses, rendered from `sheet.features`. Each category is a horizontal
 *  masonry: cards flow into 3 columns and scale to their short light_description
 *  (no vertical row alignment). Clicking a card opens a detail panel with the
 *  full light + deep description, the action/stats, and a Use button. Usable
 *  features (a roll and/or a limited-use counter) get a Use button on the card
 *  too: it rolls, decrements the counter, and surfaces the result as a
 *  single-roll toast (the player applies the effect, as with an attack). */
export function Features() {
  const { character, updateSection, updateSections, shardTrees = {} } = useOutletContext<RouteContext>()
  const nav = useNavigate()
  const features = character.sheet?.features ?? []
  const [selected, setSelected] = useState<Feature | null>(null)
  const graph = useGraph(character, shardTrees)
  // Every stored, player-writable variable on the active set, with its value.
  const vars = playerVars(character, shardTrees)

  // Close the detail panel on Escape.
  useEffect(() => {
    if (!selected) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelected(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected])

  /** Armed modifiers this feature put in the queue and nobody has spent yet.
   *  Matched by SOURCE, not by roll: the card's job is "you armed this and it is
   *  still pending", which is a fact about the feature, not about a roll. */
  const armedOf = (f: Feature) => {
    const src = gid('feature', f)
    return graph.armed.filter(m => m.source === src).length
  }

  /** Variables this feature declares that the player may write directly. */
  const varsOf = (f: Feature) =>
    vars.filter(v => (f.vars ?? []).some(d => d.name === v.def.name))

  /** Flip or set one variable. Its own write — a toggle is not part of a use. */
  async function writeVar(name: string, value: number | boolean) {
    await updateSection('resources', setVars(character, { [name]: value }) as CharacterRow['resources'])
  }

  // Using a feature lives in components/ActivationSheet: the weapon card presses
  // it too now, and two copies of "roll, spend a use, apply outcomes, write once"
  // would eventually be a feature spent on one screen and not the other.
  const { start: onUse, sheet: activationSheet, busy } = useActivation({
    character, graph, shardTrees, updateSection, updateSections,
  })

  // Bucket features by category, preserving GROUPS order. Anything missing or
  // with an unrecognized category string falls into 'other' so a DM typo never
  // makes a feature silently disappear.
  const known = new Set(GROUPS.map(g => g.key))
  const groupKey = (f: Feature): FeatureCategory =>
    f.category && known.has(f.category) ? f.category : 'other'
  const byGroup: { key: string; label: string; icon: string; items: Feature[] }[] = GROUPS.map(g => ({
    ...g,
    items: features.filter(f => groupKey(f) === g.key),
  })).filter(g => g.items.length > 0)

  // Derived from equipped items — its own section, after the intrinsic groups
  // (handoff: "the player Gear Features group derives from equipped items").
  const fromGear = gearFeatures(character)
  if (fromGear.length) byGroup.push({ key: 'gear', label: 'Gear Features', icon: 'fa-gem', items: fromGear })

  // Derived from slotted shards (base grant + every attuned node) — unslot the
  // shard or DM-reset the tree and these vanish, same read-only rule as gear.
  const fromShards = shardFeatures(character, shardTrees)
  if (fromShards.length) byGroup.push({ key: 'shard', label: 'Shard Features', icon: 'fa-diamond', items: fromShards })

  // Cosmetic flavor bullets ("Darkvision", …) — name + description, deliberately
  // NOT Feature snapshots (lib/shards.ts shardPerks), so they get their own
  // section below the real dossier instead of joining a masonry group.
  const perks = shardPerks(character, shardTrees)

  const meta = (
    <>
      <span className="dim">◇</span>
      <span>Section</span>
      <span className="acc">/ Features</span>
      <span className="dim">·</span>
      <span>Abilities &amp; Traits</span>
      <span className="dim">·</span>
      <span className="stamp">FEATURE_DOSSIER</span>
      <span className="dim">::</span>
      <span className="acc">Online</span>
    </>
  )

  return (
    <>
      <Deco
        left={<><span className="acc">EQUIPMENT</span> &nbsp;//&nbsp; FEATURE_DOSSIER &nbsp;//&nbsp; SYNC OK</>}
        right={<>Castella-08 &nbsp;//&nbsp; <span className="acc">TRAITS: BOUND</span> &nbsp;//&nbsp; Loadout 02</>}
      />
      <Nav variant="dock" meta={meta} />

      <div className={styles.dash}>
        <header className={styles.dashHead}>
          <span className={styles.dhNum}>10</span>
          <span className={styles.dhTitle}>Features</span>
          <span className={styles.dhMeta}>
            <span><span className="dim">Catalogued</span> {features.length + fromGear.length + fromShards.length}</span>
            <span className="dim">·</span>
            <span><span className="dim">Source</span> <span className="acc">DM-Authored</span></span>
            <span className={styles.cursor}>▌</span>
          </span>
          <button type="button" className={styles.closeScreen} onClick={() => nav('/equipment')}>
            <i className="fa-solid fa-xmark" aria-hidden="true" /> Close
          </button>
        </header>

        {byGroup.length === 0 && perks.length === 0 ? (
          <div className={styles.empty}>
            <i className="fa-solid fa-folder-open" aria-hidden="true" />
            <p>No features catalogued yet.</p>
            <p className={styles.emptySub}>
              The DM authors class features, feats and traits into <code>sheet.features</code>.
            </p>
          </div>
        ) : (
          byGroup.map(group => (
            <section key={group.key} className={styles.group}>
              <div className={styles.groupHead}>
                <span className={styles.ghIcon}><i className={`fa-solid ${group.icon}`} /></span>
                <span className={styles.ghLabel}>{group.label}</span>
                <span className={styles.ghCount}>{group.items.length}</span>
                <span className={styles.ghRule} />
              </div>
              <div className={styles.masonry}>
                {/* Round-robin into fixed columns so the layout stays stable. */}
                {Array.from({ length: COLS }, (_, c) => (
                  <div key={c} className={styles.mCol}>
                    {group.items.filter((_, i) => i % COLS === c).map(f => (
                      <FeatureCard
                        key={f.id} feature={f} busy={busy}
                        on={varsOf(f).some(v => v.def.type === 'bool' && v.value === true)}
                        armed={armedOf(f)}
                        onOpen={() => setSelected(f)}
                        onUse={() => onUse(f)}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </section>
          ))
        )}

        {perks.length > 0 && (
          <section className={styles.group}>
            <div className={styles.groupHead}>
              <span className={styles.ghIcon}><i className="fa-solid fa-wand-magic-sparkles" /></span>
              <span className={styles.ghLabel}>Passive Perks</span>
              <span className={styles.ghCount}>{perks.length}</span>
              <span className={styles.ghRule} />
            </div>
            <div className={styles.masonry}>
              {Array.from({ length: COLS }, (_, c) => (
                <div key={c} className={styles.mCol}>
                  {perks.filter((_, i) => i % COLS === c).map((p, i) => <PerkCard key={`${p.name}-${i}`} perk={p} />)}
                </div>
              ))}
            </div>
            <p className={styles.perkNote}>Flavor from slotted shards — cosmetic, not mechanical Features.</p>
          </section>
        )}
      </div>

      {selected && createPortal(
        <FeatureDetail
          feature={selected} busy={busy} vars={varsOf(selected)}
          onClose={() => setSelected(null)}
          onWriteVar={writeVar}
          onUse={() => { const f = selected; setSelected(null); onUse(f) }}
        />,
        document.body,
      )}

      {activationSheet}
    </>
  )
}

function FeatureCard({ feature, busy, on, armed, onOpen, onUse }: {
  feature: Feature; busy: boolean; on: boolean; armed: number
  onOpen: () => void; onUse: () => void
}) {
  const tag = feature.usage ?? (feature.level ? `Lv ${feature.level}` : null)
  const exhausted = !!feature.uses && feature.uses.current <= 0
  const text = cardText(feature)

  return (
    <div className={styles.card} data-kind={feature.kind ?? 'none'}>
      {/* clickable body opens the detail panel */}
      <button type="button" className={styles.cOpen} onClick={onOpen}>
        {/* header: kind-tinted backdrop square holding the icon + name */}
        <span className={styles.cHead}>
          <span className={styles.cIcon}><i className={`fa-solid ${feature.icon ?? 'fa-bolt'}`} /></span>
          <span className={styles.cName}>{feature.name}</span>
          {/* §16's visibility rule, the other half: a bonus waiting in the armed
              queue that the card does not mention is one the player rolls
              without and never learns about. */}
          {armed > 0 && (
            <span className={styles.cArmed} title="Armed — applies to your next matching roll">
              <i className="fa-solid fa-bolt" />{armed > 1 ? ` ${armed}` : ''}
            </span>
          )}
          {/* A feature being ON is a bool variable. Showing it on the closed card
              is the same argument §16 makes for the armed chip: state the player
              cannot see is worse than no state, because they act without it. */}
          {on && <span className={styles.cOn} title="Active">ON</span>}
        </span>
        {text && <Prose text={text} className={styles.cDesc} />}
      </button>

      <div className={styles.cFoot}>
        {feature.source && <span className={styles.cSource}>{feature.source}</span>}
        {feature.uses
          ? <span className={styles.cUses}>{feature.uses.current}/{feature.uses.max}</span>
          : tag && <span className={styles.cTag}>{tag}</span>}
        {isUsable(feature) && (
          <button type="button" className={styles.useBtn} onClick={onUse} disabled={busy || exhausted}>
            {exhausted ? 'Spent' : 'Use'}
          </button>
        )}
      </div>
    </div>
  )
}

/** Cosmetic perk card — the FeatureCard shell (header bar + description) with
 *  no footer/Use button, since a perk has no roll or uses to trigger. */
function PerkCard({ perk }: { perk: ShardPerk }) {
  return (
    <div className={styles.card}>
      <div className={styles.pcBody}>
        <span className={styles.cHead}>
          <span className={styles.cIcon}><i className={`fa-solid ${perk.icon ?? 'fa-wand-magic-sparkles'}`} /></span>
          <span className={styles.cName}>{perk.name}</span>
        </span>
        {perk.description && <Prose text={perk.description} className={styles.cDesc} />}
      </div>
    </div>
  )
}

type VarRow = { def: { name: string; label?: string; type?: 'num' | 'bool' }; value: number | boolean }

function FeatureDetail({ feature, busy, vars, onClose, onWriteVar, onUse }: {
  feature: Feature; busy: boolean; vars: VarRow[]
  onClose: () => void
  onWriteVar: (name: string, value: number | boolean) => void | Promise<void>
  onUse: () => void
}) {
  const light = cardText(feature)
  const exhausted = !!feature.uses && feature.uses.current <= 0
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.panel} onClick={e => e.stopPropagation()} role="dialog" aria-label={feature.name}>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close">✕</button>
        <div className={styles.pHead} data-kind={feature.kind ?? 'none'}>
          <span className={styles.pIcon}><i className={`fa-solid ${feature.icon ?? 'fa-bolt'}`} /></span>
          <div className={styles.pTitles}>
            <div className={styles.pName}>{feature.name}</div>
            <div className={styles.pSub}>
              {[feature.source, feature.usage].filter(Boolean).join(' · ') || 'Feature'}
              {feature.uses && ` · ${feature.uses.current}/${feature.uses.max} left`}
            </div>
          </div>
        </div>

        {feature.rows && feature.rows.length > 0 && (
          <div className={styles.pRows}>
            {feature.rows.map(([k, v], i) => (
              <div key={i} className={styles.pRow}>
                <span className={styles.prK}>{k}</span>
                <span className={styles.prV}>{v}</span>
              </div>
            ))}
          </div>
        )}

        <div className={styles.pBody}>
          {light && <Prose text={light} className={styles.pLight} />}
          {feature.deep_description && <Prose text={feature.deep_description} className={styles.pDeep} />}
          {!light && !feature.deep_description && <p className={styles.pEmpty}>No description provided.</p>}
        </div>

        {vars.length > 0 && (
          <div className={styles.pState}>
            <div className={styles.psHead}>State</div>
            {vars.map(v => (
              <VarControl key={v.def.name} row={v} disabled={busy} onWrite={onWriteVar} />
            ))}
          </div>
        )}

        {isUsable(feature) && (
          <div className={styles.pFoot}>
            <button type="button" className={styles.pUse} onClick={onUse} disabled={busy || exhausted}>
              {exhausted ? 'No Uses Left' : feature.roll ? 'Use & Roll' : 'Use'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/** One player-writable variable. A bool is a toggle; a number is a stepper.
 *
 *  The stepper keeps its own value and writes on SETTLE, because updateSection
 *  is optimistic but not debounced — holding `+` would otherwise fire one
 *  `UPDATE … RETURNING *` per click. */
function VarControl({ row, disabled, onWrite }: {
  row: VarRow; disabled: boolean
  onWrite: (name: string, value: number | boolean) => void | Promise<void>
}) {
  const name = row.def.label ?? row.def.name
  const [local, setLocal] = useState<number | null>(null)
  const timer = useRef<number | undefined>(undefined)

  // A write from elsewhere (a rest, an activation, the DM) must win over a local
  // draft that is no longer being edited.
  useEffect(() => () => window.clearTimeout(timer.current), [])

  if (row.def.type === 'bool') {
    const on = row.value === true
    return (
      <button
        type="button" className={`${styles.psRow} ${on ? styles.psOn : ''}`}
        disabled={disabled} aria-pressed={on}
        onClick={() => void onWrite(row.def.name, !on)}
      >
        <i className={`fa-${on ? 'solid fa-toggle-on' : 'regular fa-circle'}`} />
        <span className={styles.psName}>{name}</span>
        <span className={styles.psVal}>{on ? 'on' : 'off'}</span>
      </button>
    )
  }

  const shown = local ?? (typeof row.value === 'number' ? row.value : 0)
  const bump = (by: number) => {
    const next = shown + by
    setLocal(next)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => { setLocal(null); void onWrite(row.def.name, next) }, 450)
  }
  return (
    <div className={styles.psRow}>
      <i className="fa-solid fa-hashtag" />
      <span className={styles.psName}>{name}</span>
      <button type="button" className={styles.psStep} disabled={disabled} onClick={() => bump(-1)} aria-label={`Decrease ${name}`}>−</button>
      <span className={styles.psVal}>{shown}</span>
      <button type="button" className={styles.psStep} disabled={disabled} onClick={() => bump(1)} aria-label={`Increase ${name}`}>+</button>
    </div>
  )
}

