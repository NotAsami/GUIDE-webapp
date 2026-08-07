import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useOutletContext } from 'react-router-dom'
import type { CharacterRow, CharacterSection, EquippedGear, EquippedItem, Feature, FeatureCategory, ShardTree } from '../lib/database.types'
import { ITEM_SLOTS } from '../lib/equip'
import { Nav } from '../components/Nav'
import { Deco } from '../components/Deco'
import { rollHeal } from '../lib/dice'
import { useRollLog, type RollLine } from '../lib/rolls'
import { effectiveSheet } from '../lib/effects'
import { shardFeatures } from '../lib/shards'
import { Prose } from '../lib/markdown'
import styles from './Features.module.css'

interface RouteContext {
  character: CharacterRow
  updateSection: <K extends CharacterSection>(section: K, next: CharacterRow[K]) => Promise<void>
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

/** A feature can be "used" when it rolls something or tracks limited uses. */
function isUsable(f: Feature): boolean {
  return !!f.roll || !!f.uses
}

/** Features granted by EQUIPPED items (worn gear slots + wielded weapons + the
 *  bound shard) — the derived Gear Features group. Copies live ON the item and
 *  travel with it, so this is read-only derivation: unequip and they vanish.
 *  `uses` counters are stripped — use-tracking writes to `sheet.features`,
 *  where these don't live (the `usage` text still tells the story). */
function gearFeatures(character: CharacterRow): Feature[] {
  const eq = (character.equipped ?? {}) as EquippedGear
  const slots: (EquippedItem | null | undefined)[] = [
    ...ITEM_SLOTS.map(k => eq[k]),
    ...(eq.weapons ?? []), eq.guideShard,
  ]
  return slots
    .filter((i): i is EquippedItem => !!i)
    .flatMap(item => (item.features ?? []).map((f, idx) => ({
      ...f,
      // Namespace the id per item instance so two copies of the same item
      // can't collide as React keys; never written back anywhere.
      id: `gear-${item.id ?? item.name}-${f.id ?? idx}`,
      uses: undefined,
      kind: f.kind ?? 'equipment',
      source: f.source ?? item.name,
    })))
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
  const { character, updateSection, shardTrees = {} } = useOutletContext<RouteContext>()
  const nav = useNavigate()
  const { addRoll } = useRollLog()
  const features = character.sheet?.features ?? []
  const [selected, setSelected] = useState<Feature | null>(null)
  const [busy, setBusy] = useState(false)

  // Close the detail panel on Escape.
  useEffect(() => {
    if (!selected) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelected(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected])

  /** Spend/roll a feature: roll its expression (if any), decrement its use
   *  counter (if any) in one write, then toast the result. */
  async function useFeature(f: Feature) {
    if (busy) return
    if (f.uses && f.uses.current <= 0) return
    setBusy(true)

    const sheet = character.sheet ?? {}
    let nextSheet = sheet
    const lines: RollLine[] = []

    if (f.roll) {
      const { total, breakdown } = rollHeal(f.roll)
      if (f.rollTone === 'heal') {
        // Heal-tagged rolls raise real HP, like a potion — clamped to the
        // EFFECTIVE max, but the persisted `max` stays the authored base.
        const hp = sheet.hp ?? { current: 0, max: 0 }
        const baseMax = hp.max ?? 0
        const healMax = effectiveSheet(character, shardTrees).hp?.max ?? baseMax
        const cur = hp.current ?? 0
        const next = Math.min(healMax, cur + total)
        nextSheet = { ...nextSheet, hp: { ...hp, current: next, max: baseMax } }
        lines.push({ label: f.rollLabel ?? 'Healed', total: `+${next - cur}`, breakdown: `${breakdown} · HP ${cur} → ${next}`, tone: 'heal' })
      } else {
        // Other rolls are show-only — the player applies the effect (like an attack).
        lines.push({ label: f.rollLabel ?? 'Result', total: `${total}`, breakdown, tone: f.rollTone })
      }
    }

    let remaining = f.uses?.current ?? null
    if (f.uses) {
      remaining = f.uses.current - 1
      nextSheet = { ...nextSheet, features: features.map(x =>
        x.id === f.id ? { ...x, uses: { ...f.uses!, current: remaining! } } : x) }
    }

    if (nextSheet !== sheet) await updateSection('sheet', nextSheet)
    setBusy(false)

    const subtitle = f.uses ? `${remaining} / ${f.uses.max} uses left` : (f.usage ?? 'Feature')
    addRoll({ kind: 'custom', title: f.name, subtitle, icon: f.icon, lines })
  }

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

        {byGroup.length === 0 ? (
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
                        onOpen={() => setSelected(f)}
                        onUse={() => useFeature(f)}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </section>
          ))
        )}
      </div>

      {selected && createPortal(
        <FeatureDetail
          feature={selected} busy={busy}
          onClose={() => setSelected(null)}
          onUse={() => { const f = selected; setSelected(null); useFeature(f) }}
        />,
        document.body,
      )}
    </>
  )
}

function FeatureCard({ feature, busy, onOpen, onUse }: {
  feature: Feature; busy: boolean; onOpen: () => void; onUse: () => void
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

function FeatureDetail({ feature, busy, onClose, onUse }: {
  feature: Feature; busy: boolean; onClose: () => void; onUse: () => void
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
