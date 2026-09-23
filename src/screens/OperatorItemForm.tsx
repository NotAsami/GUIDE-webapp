import { useState } from 'react'
import { AutoSaveStatus } from '../components/AutoSaveStatus'
import { GraphEffects, TagsBlock, VarsBlock, revealAudit } from '../components/GraphEffects'
import { Icon } from '../components/Icon'
import { IconPicker } from '../components/IconPicker'
import { ProsePreview } from '../components/ProsePreview'
import { readAutoSaveDraft, useAutoSave } from '../lib/autopublish'
import type { CatalogEffectRow, CatalogFeatureRow, CatalogItemData, CatalogItemRow, EffectDef, EffectDuration, EffectRef, Feature, GraphEffect, ItemCategory, ItemRarity, ItemSlot, VarDef, WeaponAbility } from '../lib/database.types'
import { isRingSlot } from '../lib/equip'
import { auditNode } from '../lib/graph'
import { renderInline } from '../lib/markdown'
import { compileEffects } from '../lib/modEditor'
import { proseField } from '../lib/textareaHooks'
import { useCatalogNodes } from '../lib/useCatalogNodes'
import { MASTERIES, masteryOf } from '../lib/weapons'
import { featureOrigin } from './operatorCatalogFields'
import styles from './OperatorConsole.module.css'

import { Btn } from './OperatorBtn'
import { CAT_DEF, CAT_ORDER, EFFECT_KINDS, EF_COUNTED, EF_DURATIONS, EF_TICKING, RAR_DEF, RAR_ORDER, SLOT_LABEL, SLOT_OPTIONS, WEAPON_ABILITIES, clipTx, effectParts, isSlotted } from './operatorCatalogFields'
const cx = (...xs: (string | false | undefined)[]) => xs.filter(Boolean).join(' ')
export function CatalogForm({ item, featureLib, effectLib, onSubmit, onDelete, onCreated }: {
  item: CatalogItemRow | null
  featureLib: CatalogFeatureRow[]
  effectLib: CatalogEffectRow[]
  onSubmit: (data: CatalogItemData, id: string | null) => Promise<string>
  onCreated: (id: string) => void
  onDelete?: () => void
}) {
  const draftKey = `item:${item?.id ?? 'new'}`
  const [d] = useState(() => readAutoSaveDraft<CatalogItemData>(draftKey) ?? item?.data)
  const [name, setName] = useState(d?.name ?? '')
  // Roll contributions, beside `effectRefs` and deliberately not the same thing:
  // effects are the passive numeric layer, a graph is per-roll and conditional.
  const [graph, setGraph] = useState<GraphEffect[]>(d?.graph ?? [])
  const [vars, setVars] = useState<VarDef[]>(d?.vars ?? [])
  const [tags, setTags] = useState<string[]>(d?.tags ?? [])
  const [gfxOpen, setGfxOpen] = useState(false)
  const { nodes, namesByGid, tagUse, catalogTypes, featureList, ready } = useCatalogNodes()
  const gAudit = ready ? auditNode({ graph, vars }, nodes, catalogTypes) : []
  const gErrs = gAudit.filter(a => a.sev === 'err')
  const [category, setCategory] = useState<ItemCategory>(d?.category ?? 'misc')
  const [rarity, setRarity] = useState<ItemRarity>(d?.rarity ?? 'common')
  const [w, setW] = useState(d?.w ?? 1)
  const [h, setH] = useState(d?.h ?? 1)
  const [weight, setWeight] = useState(String(d?.weight ?? ''))
  const [value, setValue] = useState(d?.value != null ? String(d.value) : '')
  const [valueUnit, setValueUnit] = useState<'gp' | 'sp' | 'cp'>(d?.valueUnit ?? 'gp')
  // Container authoring. `isContainer` is its own toggle rather than being
  // inferred from the category: a backpack and a crowbar are both tools, and
  // only one of them holds things.
  const [isContainer, setIsContainer] = useState(!!d?.container)
  const [ctrKind, setCtrKind] = useState<string>(d?.container?.kind ?? 'backpack')
  const [ctrMode, setCtrMode] = useState<'page' | 'inline'>(d?.container?.mode ?? 'page')
  const [ctrWeightless, setCtrWeightless] = useState(!!d?.container?.weightless)
  const [ctrCats, setCtrCats] = useState<ItemCategory[]>(d?.container?.allowedCategories ?? [])
  const [ctrCap, setCtrCap] = useState(d?.container?.capacity != null ? String(d.container.capacity) : '')
  const [icon, setIcon] = useState(d?.icon ?? 'fa-box')
  const [slot, setSlot] = useState<ItemSlot>((d?.slot as ItemSlot) ?? 'ring1')
  const [attune, setAttune] = useState(!!d?.attune)
  /* ARMOUR, which had no controls at all until AC became derived. The three
     fields sat on 110 imported rows readable by nothing and writable only by
     editing JSON — this project's most repeated bug — and the moment
     `armorClass` started reading them, a DM authoring a breastplate needed to be
     able to say "14 + Dex, max 2". */
  const [baseAc, setBaseAc] = useState(d?.baseAc !== undefined ? String(d.baseAc) : '')
  const [acAddDex, setAcAddDex] = useState(!!d?.acAddDex)
  const [acDexCap, setAcDexCap] = useState(d?.acDexCap !== undefined ? String(d.acDexCap) : '')
  const [isShield, setIsShield] = useState(!!d?.isShield)
  const [flavor, setFlavor] = useState(d?.flavor ?? '')
  const [ability, setAbility] = useState<WeaponAbility>((d?.ability as WeaponAbility) ?? 'str')
  const [damageDice, setDamageDice] = useState(d?.damageDice ?? '')
  const [ranged, setRanged] = useState(!!d?.ranged)
  const [twoHanded, setTwoHanded] = useState(!!d?.twoHanded)
  /* The mastery, as a field rather than free text — the third flag in the family
     `ranged` and `twoHanded` started. Seeded through `masteryOf` so opening an
     imported weapon shows the Cleave it has always carried in `properties`,
     instead of an empty select beside a weapon that plainly has one. */
  const [mastery, setMastery] = useState(d ? (masteryOf(d)?.name ?? '') : '')
  const [dmgType, setDmgType] = useState(d?.type ?? '')
  const [heal, setHeal] = useState(d?.heal != null ? String(d.heal) : '')
  const [duration, setDuration] = useState(d?.duration ?? '')
  const [effectRefs, setEffectRefs] = useState<EffectRef[]>(d?.effectRefs ?? [])
  const [fxOpen, setFxOpen] = useState(false)
  const [fxQuery, setFxQuery] = useState('')
  const [feats, setFeats] = useState<Feature[]>(d?.features ?? [])
  const [rows, setRows] = useState<[string, string][]>(d?.rows ?? [])
  const [rowLab, setRowLab] = useState('')
  const [rowVal, setRowVal] = useState('')

  const rd = RAR_DEF[rarity]
  const def = CAT_DEF[category]

  // Effects Granted picker pool — every library effect not already referenced,
  // filtered over name + tags, capped at 5 (mirrors the shop stock picker).
  const fxQ = fxQuery.trim().toLowerCase()
  const fxPool = effectLib
    .filter(e => !effectRefs.some(r => r.effectId === e.id))
    .filter(e => !fxQ || (e.data.name + ' ' + (e.data.tags ?? []).join(' ')).toLowerCase().includes(fxQ))
  const fxShown = fxPool.slice(0, 5)

  function build(): CatalogItemData {
    const weightNum = parseFloat(weight)
    const valueNum = parseInt(value, 10)
    const data: CatalogItemData = {
      name: name.trim(), category, rarity, icon, w, h,
      ...(Number.isFinite(weightNum) ? { weight: weightNum } : {}),
      ...(Number.isFinite(valueNum) ? { value: valueNum, valueUnit } : {}),
      ...(isSlotted(category) ? { slot } : {}),
      ...(isContainer ? {
        container: {
          kind: ctrKind.trim() || 'backpack',
          mode: ctrMode,
          weightless: ctrWeightless,
          ...(ctrCats.length ? { allowedCategories: ctrCats } : {}),
          ...(Number.isFinite(parseInt(ctrCap, 10)) ? { capacity: parseInt(ctrCap, 10) } : {}),
        },
      } : {}),
      ...(attune ? { attune: name.trim() } : {}),
      ...(Number.isFinite(parseInt(baseAc, 10))
        ? {
          baseAc: parseInt(baseAc, 10),
          ...(isShield ? { isShield: true } : {}),
          // A shield adds; it never carries Dex of its own, so the two Dex
          // fields are body armour's alone.
          ...(!isShield && acAddDex ? { acAddDex: true } : {}),
          ...(!isShield && acAddDex && Number.isFinite(parseInt(acDexCap, 10)) ? { acDexCap: parseInt(acDexCap, 10) } : {}),
        }
        : {}),
      ...(flavor.trim() ? { flavor: flavor.trim() } : {}),
      ...(category === 'weapon'
        ? {
          ability, ...(ranged ? { ranged: true } : {}), ...(twoHanded ? { twoHanded: true } : {}),
          ...(mastery ? { mastery } : {}),
          ...(damageDice.trim() ? { damageDice: damageDice.trim() } : {}),
          ...(dmgType.trim() ? { type: dmgType.trim() } : {}),
        }
        : {}),
      ...(category === 'consumable'
        ? { ...(heal.trim() ? { heal: heal.trim() } : {}), ...(duration.trim() ? { duration: duration.trim() } : {}) }
        : {}),
    }
    // effectRefs is the authored source; `effects` is a COMPILED CACHE recomputed
    // here on every save so the equip/grant engine keeps reading plain
    // ItemEffects with no changes (see EffectRef's doc comment).
    const referenced = effectRefs.map(r => effectLib.find(e => e.id === r.effectId)?.data).filter(Boolean) as EffectDef[]
    const referencedMods = referenced.flatMap(e => e.mods ?? [])
    const effects = compileEffects(referencedMods, referenced)
    if (effects) data.effects = effects
    if (effectRefs.length) data.effectRefs = effectRefs
    if (feats.length) data.features = feats
    if (rows.length) data.rows = rows
    // Hand-enumerated, like everything above it — which is exactly why these two
    // were dropped on every save until now.
    if (graph.length) data.graph = graph
    if (vars.length) data.vars = vars
    if (tags.length) data.tags = tags
    return data
  }
  /* Typing saves. No button: the guard the Save button carried is now the
     `ready` condition, so an incomplete form simply holds the write. */
  const autosave = useAutoSave({
    value: build(), ready: ready && !!name.trim() && gErrs.length === 0, id: item?.id ?? null, draftKey,
    save: (v: CatalogItemData, id: string | null) => onSubmit(v, id), onCreated,
  })
  const autoBusy = autosave.busy

  function addRow() {
    const l = rowLab.trim()
    if (!l) return
    setRows(r => [...r, [l, rowVal.trim()]])
    setRowLab(''); setRowVal('')
  }

  return (
    <>
      <div className={styles.catFormHead}>
        <span className={styles.cfhT}>{item ? 'Edit Item' : 'New Item'}</span>
        <span className={styles.cfhId}>{item ? item.id : 'unsaved template'}</span>
      </div>

      {/* live preview tile */}
      <div className={styles.catPrev} style={{ ['--rar' as string]: rd.token }}>
        <span className={styles.pvCell}>
          <Icon name={icon} />
          <span className={styles.pvCorner}><i className={`fa-solid ${def.corner}`} /></span>
        </span>
        <span className={styles.pvTx}>
          <span className={styles.pvName}>{name || 'Untitled Item'}</span>
          <span className={styles.pvMeta}>
            <span>{def.label}</span><span className={styles.rar} style={{ color: rd.token }}>{rd.label}</span>
            <span>{w}×{h} cells</span>
            {isSlotted(category) && <span>{slot}</span>}
            {attune && <span>attunement</span>}
          </span>
        </span>
      </div>

      <span className={styles.fieldLab}>Name</span>
      <input className={styles.sessIn} value={name} onChange={e => setName(e.target.value)} placeholder="Name the item…" />

      <div className={styles.catGrid2}>
        <div>
          <span className={styles.fieldLab}>Category</span>
          <select className={styles.selIn} value={category} onChange={e => setCategory(e.target.value as ItemCategory)}>
            {CAT_ORDER.map(c => <option key={c} value={c}>{CAT_DEF[c].label}</option>)}
          </select>
        </div>
        <div>
          <span className={styles.fieldLab}>Rarity</span>
          <select className={styles.selIn} value={rarity} onChange={e => setRarity(e.target.value as ItemRarity)}>
            {RAR_ORDER.map(r => <option key={r} value={r}>{RAR_DEF[r].label}</option>)}
          </select>
        </div>
      </div>

      <div className={cx(styles.catGrid3, styles.catGridDims)}>
        <div>
          <span className={styles.fieldLab}>Footprint</span>
          <div className={styles.catDim}>
            <input className={styles.sessIn} type="number" min={1} value={w} onChange={e => setW(Math.max(1, parseInt(e.target.value || '1', 10) || 1))} />
            <span className={styles.x}>×</span>
            <input className={styles.sessIn} type="number" min={1} value={h} onChange={e => setH(Math.max(1, parseInt(e.target.value || '1', 10) || 1))} />
            <span className={styles.unit}>cells</span>
          </div>
        </div>
        <div><span className={styles.fieldLab}>Weight</span><input className={styles.sessIn} type="number" min={0} step="0.1" value={weight} onChange={e => setWeight(e.target.value)} placeholder="lb" /></div>
        <div>
          <span className={styles.fieldLab}>Value</span>
          <div className={styles.catDim}>
            <input className={styles.sessIn} type="number" min={0} value={value} onChange={e => setValue(e.target.value)} placeholder="0" />
            <select className={styles.selIn} value={valueUnit} onChange={e => setValueUnit(e.target.value as 'gp' | 'sp' | 'cp')}>
              <option value="gp">gp</option>
              <option value="sp">sp</option>
              <option value="cp">cp</option>
            </select>
          </div>
        </div>
      </div>

      <span className={styles.fieldLab}>Icon</span>
      <IconPicker value={icon} onPick={setIcon} />

      {category === 'weapon' && (
        <div className={styles.catGrid3}>
          {/* FIRST in the weapon block, because it is the question that changes
              the answers below it — everything ranged hangs off this one flag:
              the empty-quiver refusal, the ammunition spend, and the `ranged` sub
              that makes `roll:attack.ranged` match. */}
          <div className={styles.catSpan3}>
            <label className={styles.catCheck}>
              <input type="checkbox" checked={ranged}
                onChange={e => {
                  setRanged(e.target.checked)
                  // A convenience, not a lock: bows are DEX weapons, so offer it
                  // when the ability is still the untouched default.
                  if (e.target.checked && ability === 'str') setAbility('dex')
                }} />
              <span>Ranged <span className={styles.dimLab}>— fires ammunition, spends a shaft per attack</span></span>
            </label>
          </div>
          {/* The other flag that changes what a hand can hold. Free-text
              "Two-Handed" in `properties` is what the SRD import wrote and what
              isTwoHanded still falls back to; this is the half the form can
              actually author. */}
          <div className={styles.catSpan3}>
            <label className={styles.catCheck}>
              <input type="checkbox" checked={twoHanded}
                onChange={e => setTwoHanded(e.target.checked)} />
              <span>Two-Handed <span className={styles.dimLab}>— claims the main hand and locks the off hand; no dual-wielding it</span></span>
            </label>
          </div>
          <div>
            <span className={styles.fieldLab}>Mastery</span>
            <select className={styles.selIn} value={mastery} onChange={e => setMastery(e.target.value)}>
              <option value="">— none —</option>
              {MASTERIES.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
            </select>
          </div>
          <div>
            <span className={styles.fieldLab}>Attack Ability</span>
            <select className={styles.selIn} value={ability} onChange={e => setAbility(e.target.value as WeaponAbility)}>
              {WEAPON_ABILITIES.map(a => <option key={a} value={a}>{a === 'finesse' ? 'Finesse' : a.toUpperCase()}</option>)}
            </select>
          </div>
          <div><span className={styles.fieldLab}>Damage Dice</span><input className={styles.sessIn} value={damageDice} onChange={e => setDamageDice(e.target.value)} placeholder="e.g. 1d8" /></div>
          <div><span className={styles.fieldLab}>Damage Type</span><input className={styles.sessIn} value={dmgType} onChange={e => setDmgType(e.target.value)} placeholder="e.g. Slashing" /></div>
        </div>
      )}

      {category === 'consumable' && (
        <div className={styles.catGrid2}>
          <div><span className={styles.fieldLab}>Heal (on use)</span><input className={styles.sessIn} value={heal} onChange={e => setHeal(e.target.value)} placeholder="e.g. 2d4 + 2" /></div>
          <div><span className={styles.fieldLab}>Duration</span><input className={styles.sessIn} value={duration} onChange={e => setDuration(e.target.value)} placeholder="e.g. 1 hour" /></div>
        </div>
      )}

      <div
        className={cx(styles.catTog, isContainer && styles.on)}
        onClick={() => setIsContainer(v => !v)}
        role="switch" aria-checked={isContainer}
      >
        <span className={styles.tgSw} />
        <span className={styles.tgLab}>
          <span className={styles.t}>This Item Is A Container</span>
          <span className={styles.s}>Holds other items — gets a tab or a carry row</span>
        </span>
      </div>

      {isContainer && (
        <div className={styles.catCtr}>
          <div className={styles.catGrid2}>
            <div>
              <span className={styles.fieldLab}>Kind</span>
              {/* Kind is what enforces the caps — one backpack, one bag of
                  holding, one sack, one quiver. Free text so a bolt case or a
                  scroll case can be authored without a code change; a NEW `page`
                  kind, though, would become a fifth Inventory tab. */}
              <input
                className={styles.sessIn} value={ctrKind}
                onChange={e => setCtrKind(e.target.value)}
                list="container-kinds" placeholder="backpack"
              />
              <datalist id="container-kinds">
                {['backpack', 'bagOfHolding', 'sack', 'quiver', 'boltCase', 'scrollCase']
                  .map(k => <option key={k} value={k} />)}
              </datalist>
            </div>
            <div>
              <span className={styles.fieldLab}>Display Mode</span>
              <select className={styles.selIn} value={ctrMode} onChange={e => setCtrMode(e.target.value as 'page' | 'inline')}>
                <option value="page">Page — owns an Inventory tab</option>
                <option value="inline">Inline — expands in the carry panel</option>
              </select>
            </div>
          </div>

          <div className={styles.catGrid2}>
            <div>
              <span className={styles.fieldLab}>Capacity</span>
              <input
                className={styles.numIn} type="number" min={0} value={ctrCap}
                onChange={e => setCtrCap(e.target.value)} placeholder="unlimited"
              />
            </div>
            <div
              className={cx(styles.catTog, styles.ctrTog, ctrWeightless && styles.on)}
              onClick={() => setCtrWeightless(v => !v)}
              role="switch" aria-checked={ctrWeightless}
            >
              <span className={styles.tgSw} />
              <span className={styles.tgLab}>
                <span className={styles.t}>Weightless</span>
                <span className={styles.s}>Contents excluded from Burden (the bag itself still weighs)</span>
              </span>
            </div>
          </div>

          <span className={styles.fieldLab}>Accepts (empty = anything)</span>
          <div className={styles.catCtrCats}>
            {CAT_ORDER.map(c => (
              <button
                key={c} type="button"
                className={cx(styles.qTag, ctrCats.includes(c) && styles.sel)}
                onClick={() => setCtrCats(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c])}
              >
                {CAT_DEF[c].label}
              </button>
            ))}
          </div>
          <div className={styles.catCtrNote}>
            An ammunition-only container auto-collects what it accepts: picked-up
            arrows route themselves into a quiver before anything else.
          </div>
        </div>
      )}

      {isSlotted(category) && (
        <>
          <span className={styles.fieldLab}>Equip Slot</span>
          <select
            className={cx(styles.selIn, styles.slotSel)}
            value={isRingSlot(slot) ? 'ring1' : slot}
            onChange={e => setSlot(e.target.value as ItemSlot)}
          >
            {SLOT_OPTIONS.map(s => <option key={s} value={s}>{SLOT_LABEL[s]}</option>)}
          </select>
        </>
      )}

      {category === 'armor' && (
        <>
          <div className={styles.qGrid2}>
            <div>
              <span className={styles.fieldLab}>{isShield ? 'AC bonus' : 'Base AC'}</span>
              <input className={styles.in} type="number" value={baseAc}
                placeholder={isShield ? '2' : '14'}
                onChange={e => setBaseAc(e.target.value)} />
            </div>
            {!isShield && acAddDex && (
              <div>
                <span className={styles.fieldLab}>Dex cap</span>
                <input className={styles.in} type="number" value={acDexCap}
                  placeholder="blank = no cap" onChange={e => setAcDexCap(e.target.value)} />
              </div>
            )}
          </div>
          {/* A SHIELD IS NOT ARMOUR, though it shares the slot: its number is a
              BONUS where armour's REPLACES, and it must not switch off an
              unarmored rule the printed text says you keep while holding one. */}
          <div className={cx(styles.catTog, isShield && styles.on)} onClick={() => setIsShield(v => !v)} role="switch" aria-checked={isShield}>
            <span className={styles.tgSw} />
            <span className={styles.tgLab}><span className={styles.t}>Shield</span><span className={styles.s}>Adds to Armour Class instead of replacing it, and leaves an unarmored rule standing</span></span>
          </div>
          {!isShield && (
            <div className={cx(styles.catTog, acAddDex && styles.on)} onClick={() => setAcAddDex(v => !v)} role="switch" aria-checked={acAddDex}>
              <span className={styles.tgSw} />
              <span className={styles.tgLab}><span className={styles.t}>Adds Dexterity</span><span className={styles.s}>Light armour: no cap. Medium: cap 2. Heavy: off.</span></span>
            </div>
          )}
        </>
      )}

      <div className={cx(styles.catTog, attune && styles.on)} onClick={() => setAttune(a => !a)} role="switch" aria-checked={attune}>
        <span className={styles.tgSw} />
        <span className={styles.tgLab}><span className={styles.t}>Attunement Required</span><span className={styles.s}>Binds to one bearer on a short rest</span></span>
      </div>

      <div className={styles.qLabRow}>
        <span className={styles.fieldLab}>Description</span>
        <span className={cx(styles.qFacing, styles.player)}><i className="fa-solid fa-eye" /> Player-facing</span>
        <ProsePreview text={flavor} register="voice" />
      </div>
      <textarea className={styles.catProse} value={flavor} onChange={e => setFlavor(e.target.value)}
        {...proseField(setFlavor)}
        placeholder="The prose the player reads when they examine this item…" />

      {/* effects granted — reference picker into the effect library. Each
          reference carries its own duration; the item's own `effects` field is
          recompiled from the referenced mods on save (build(), above) so the
          equip/grant engine keeps reading plain ItemEffects unchanged. */}
      <div className={cx(styles.catFx, styles.fold, fxOpen && styles.open)}>
        <div className={styles.fxfHead} onClick={() => setFxOpen(o => !o)} role="button" tabIndex={0} aria-expanded={fxOpen}>
          <span className={styles.car}><i className="fa-solid fa-caret-right" /></span>
          <i className="fa-solid fa-flask-vial" style={{ color: 'var(--amber-hot)', fontSize: 11 }} />
          <span className={styles.t}>Effects Granted</span>
          <span className={styles.s}>
            {effectRefs.length
              ? `${effectRefs.length} referenced · ${clipTx(effectRefs.map(r => effectLib.find(e => e.id === r.effectId)?.data.name).filter(Boolean).join(', '), 42)}`
              : 'none · references the effect library'}
          </span>
        </div>
        {fxOpen && (
          <>
            <div className={styles.efRefs}>
              {effectRefs.length ? effectRefs.map((r, i) => {
                const eff = effectLib.find(e => e.id === r.effectId)
                if (!eff) return null
                const K = EFFECT_KINDS[eff.data.kind]
                const parts = effectParts(eff.data)
                const counted = EF_COUNTED.includes(r.dur)
                const ticks = EF_TICKING.includes(r.dur)
                const patchRef = (p: Partial<EffectRef>) => setEffectRefs(list => list.map((x, j) => (j === i ? { ...x, ...p } : x)))
                return (
                  <div key={i} className={styles.efRefRow} style={{ ['--k' as string]: K.color }}>
                    <div className={styles.efRefTop}>
                      <span className={styles.ic}><Icon name={eff.data.icon} /></span>
                      <span className={styles.nm}>{eff.data.name}</span>
                      <span className={styles.efBadge} style={{ ['--k' as string]: K.color }}>{K.label}</span>
                      <span className={styles.x} onClick={() => setEffectRefs(list => list.filter((_, j) => j !== i))}><i className="fa-solid fa-xmark" /></span>
                    </div>
                    {parts.length ? (
                      <div className={styles.efRefSum}>{parts.map((p, pi) => <span key={pi}>{p}</span>)}</div>
                    ) : (
                      <div className={cx(styles.efRefSum, styles.prose)}>{renderInline(clipTx(eff.data.desc, 180))}</div>
                    )}
                    <div className={styles.efRefDur}>
                      <span className={styles.dl}>Duration</span>
                      {counted && (
                        <input className={cx(styles.sessIn, styles.num)} type="number" min={1} value={r.amount ?? 1}
                          onChange={e => patchRef({ amount: Math.max(1, parseInt(e.target.value, 10) || 1) })} />
                      )}
                      <select className={styles.selIn} value={r.dur} onChange={e => {
                        const dur = e.target.value as EffectDuration
                        const needsAmount = EF_COUNTED.includes(dur) && !r.amount
                        patchRef({ dur, ...(needsAmount ? { amount: dur === 'Rounds' ? 3 : 10 } : {}) })
                      }}>
                        {EF_DURATIONS.map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                      <span className={cx(styles.tick, ticks && styles.on)}>{ticks ? 'ticks down' : 'cleared by hand'}</span>
                    </div>
                  </div>
                )
              }) : <div className={styles.catFxNone}>No effects referenced — search the library below. Each line carries its own duration, because duration belongs to whoever applies it.</div>}
            </div>
            <div className={styles.efPick}>
              <div className={styles.searchWrap}>
                <i className="fa-solid fa-magnifying-glass" />
                <input className={styles.searchIn} value={fxQuery} onChange={e => setFxQuery(e.target.value)} placeholder="Search effects by name or tag…" />
              </div>
              <div className={styles.skPicklist}>
                {!fxPool.length ? (
                  <div className={styles.catFxNone}>{fxQ ? `No effect matches "${fxQuery.trim()}".` : 'Every effect in the library is already referenced.'}</div>
                ) : (
                  <>
                    {fxShown.map(e => {
                      const K = EFFECT_KINDS[e.data.kind]
                      const parts = effectParts(e.data)
                      return (
                        <button key={e.id} className={styles.skPi} style={{ ['--rar' as string]: K.color }} onClick={() => {
                          setEffectRefs(list => [...list, category === 'consumable'
                            ? { effectId: e.id, dur: 'Minutes', amount: 10 }
                            : { effectId: e.id, dur: 'Permanent while equipped', amount: 1 }])
                          setFxQuery('')
                        }}>
                          <span className={styles.piIc}><Icon name={e.data.icon} /></span>
                          <span className={styles.piT}>{e.data.name}</span>
                          <span className={styles.piM}>{parts.length ? parts.join(' · ') : 'prose only'}</span>
                          <span className={styles.piV}>{K.label}</span>
                        </button>
                      )
                    })}
                    {fxPool.length > fxShown.length && <div className={styles.catFxNone}>{fxPool.length - fxShown.length} more — keep typing to narrow.</div>}
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* features granted — embedded snapshots from the feature library, surfaced
          to the player as Gear Features while the item is equipped */}
      {category !== 'misc' && (
        <div className={styles.catFx}>
          <div className={styles.catFxHead}><i className="fa-solid fa-star" /><span className={styles.t}>Features Granted</span><span className={styles.s}>while equipped · snapshots from the library</span></div>
          <div className={styles.featChips}>
            {feats.length ? feats.map((f, i) => (
              <span key={i} className={styles.qTag}>
                <Icon name={f.icon ?? 'fa-star'} /> {f.name}
                <span className={styles.qTx2} onClick={() => setFeats(list => list.filter((_, j) => j !== i))}><i className="fa-solid fa-xmark" /></span>
              </span>
            )) : <div className={styles.catFxNone}>No features — attach perks authored in the Features tab (e.g. a cloak's stealth boon).</div>}
          </div>
          {featureLib.filter(f => !feats.some(x => x.feature_id === f.id)).length > 0 && (
            <div className={styles.featAdd}>
              <select className={styles.selIn} value="" onChange={e => {
                const row = featureLib.find(f => f.id === e.target.value)
                if (row) setFeats(list => [...list, { ...row.data, id: `gf-${row.id}`, feature_id: row.id }])
              }}>
                <option value="" disabled>Attach a feature…</option>
                {featureLib.filter(f => !feats.some(x => x.feature_id === f.id)).map(f => (
                  <option key={f.id} value={f.id}>{f.data?.name ?? 'Untitled'} · {featureOrigin(f.data)}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* display detail rows */}
      <span className={styles.fieldLab}>Detail Rows</span>
      <div className={styles.qObjList}>
        {rows.length ? rows.map((r, i) => (
          <div key={i} className={styles.detailRow}>
            <span className={styles.drLab}>{r[0]}</span>
            <span className={styles.drVal}>{r[1]}</span>
            <span className={styles.qOx} onClick={() => setRows(list => list.filter((_, j) => j !== i))}><i className="fa-solid fa-xmark" /></span>
          </div>
        )) : <div className={styles.fxNone} style={{ padding: '4px 2px' }}>No detail rows — add label/value pairs shown on the item card (e.g. Range · 80/320).</div>}
      </div>
      <div className={styles.detailAdd}>
        <input className={styles.sessIn} value={rowLab} onChange={e => setRowLab(e.target.value)} placeholder="Label" />
        <input className={styles.sessIn} value={rowVal} onChange={e => setRowVal(e.target.value)} onKeyDown={e => e.key === 'Enter' && addRow()} placeholder="Value" />
        <Btn tone="ghost" sm icon="fa-plus" label="Add" onClick={addRow} />
      </div>

      {/* TAGS LIVE OUTSIDE THE RULES FOLD. They were inside it, which made them
          invisible until you expanded a collapsed section about something else —
          and tagging is not a rules-authoring job. An item's tags are what
          `tag:` selectors match, AND what Equipment passes into every attack it
          rolls with this weapon, so plenty of items want tags and no rules. */}
      <div className={styles.catSecLab}><span className={styles.fieldLab}>Targeting tags</span></div>
      <TagsBlock tags={tags} tagUse={tagUse} onChange={setTags} />

      {/* ROLL CONTRIBUTIONS — the same block the feature editor and the spell
          form author. Beside Effects Granted and deliberately distinct from it:
          `effects` is the passive numeric layer compiled from the effect
          library, this is per-roll and conditional (database.types.ts:513).
          Applies while the item is EQUIPPED. */}
      <div className={cx(styles.catFx, styles.fold, gfxOpen && styles.open)}>
        <div className={styles.fxfHead} onClick={() => setGfxOpen(o => !o)} role="button" tabIndex={0} aria-expanded={gfxOpen}>
          <span className={styles.car}><i className="fa-solid fa-caret-right" /></span>
          <i className="fa-solid fa-diagram-project" style={{ color: 'var(--cyan-hot)', fontSize: 11 }} />
          <span className={styles.t}>Rules</span>
          <span className={styles.s}>
            {graph.length
              ? `${graph.length} effect${graph.length === 1 ? '' : 's'}${gErrs.length ? ` · ${gErrs.length} error${gErrs.length === 1 ? '' : 's'}` : ''}`
              : 'none · what this item adds to a roll while equipped'}
          </span>
        </div>
        {gfxOpen && (
          <div className={styles.gfxBody}>
            <GraphEffects graph={graph} vars={vars} nodes={nodes} namesByGid={namesByGid} onChange={setGraph} onVarsChange={setVars} />
            <VarsBlock vars={vars} onChange={setVars} features={featureList} />
          </div>
        )}
      </div>

      {/* Clickable, like the Feature/Class/Race audit panels: opens the Rules
          fold and jumps to the node or variable that is wrong, rather than
          naming it and leaving you to find it. */}
      {gErrs.map((a, i) => (
        <button key={i} type="button" className={styles.skWarn}
          onClick={() => { setGfxOpen(true); revealAudit(a.id) }}>
          <i className="fa-solid fa-triangle-exclamation" /> <b>{a.t}</b> — {a.s}
        </button>
      ))}

      <div className={styles.qActions}>
        {/* Replaces the Save button. These tables have no draft column, so an
            invalid form holds the write rather than parking it — the last good
            version stays live, which is the same promise the draft-backed forms
            make by a different route. */}
        <span className={styles.autoState}>
          <AutoSaveStatus state={autosave} savedLabel="Saved automatically" blocked={!name.trim() || gErrs.length ? 'Not saved — needs a name, and no graph errors' : undefined} />
        </span>
        {onDelete && <Btn tone="danger" lg icon="fa-trash" label="Delete" onClick={onDelete} disabled={autoBusy} />}
      </div>
    </>
  )
}

