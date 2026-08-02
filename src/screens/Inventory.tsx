import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import type {
  CharacterRow, CharacterSection, ContainerKind, EquippedItem, InventoryItem,
  ItemCategory, Json, WeaponData,
} from '../lib/database.types'
import { Nav } from '../components/Nav'
import { Deco } from '../components/Deco'
import { useItemTooltip } from '../components/ItemTooltip'
import { burden, fmtWeight, itemWeight } from '../lib/burden'
import { consumeEffect } from '../lib/consume'
import {
  TAB_KIND_ORDER, equipTargetPatch, freshItemId, getGear, getInventory,
  resolveEquipTarget,
} from '../lib/equip'
import {
  GRID_CELLS, GRID_COLS, GRID_ROWS, PERSON, emptyCells, freeCellFor,
  packPerson, place, type Placed,
} from '../lib/placement'
import { CAT_CORNER, CAT_LABEL, CAT_ORDER, rarityLabel } from '../lib/items'
import { useRollLog } from '../lib/rolls'
import { ItemPopup } from './InventoryPopup'
import styles from './Inventory.module.css'

interface RouteContext {
  character: CharacterRow
  updateSection: <K extends CharacterSection>(section: K, next: CharacterRow[K]) => Promise<void>
  updateSections: (patch: Partial<Pick<CharacterRow, CharacterSection>>) => Promise<void>
}

/** Fallback chrome for a tab whose container isn't equipped — a locked tab still
 *  has to say what it's a slot FOR. */
const KIND_CHROME: Record<string, { label: string; icon: string }> = {
  sack: { label: 'Sack', icon: 'fa-sack-xmark' },
  backpack: { label: 'Backpack', icon: 'fa-bag-shopping' },
  bagOfHolding: { label: 'Bag of Holding', icon: 'fa-database' },
}

type SortKey = 'name' | 'weight' | 'value' | 'category'

interface Tab {
  /** Container id, or PERSON. `null` when the slot is empty (locked tab). */
  id: string | null
  kind: ContainerKind | null
  label: string
  icon: string
  container: EquippedItem | null
}

function fpClass(w: number, h: number): string {
  if (h >= 3 && w === 1) return styles.fpV
  const area = w * h
  if (area >= 4) return styles.fpL
  if (area >= 2) return styles.fpM
  return styles.fpS
}

/**
 * Inventory — the carried manifest.
 *
 * The grid stopped being "your inventory" in the refactor: ON PERSON is a fixed
 * 5x4 loadout of what the character can physically reach, and bulk lives in
 * containers, which are unlimited filterable lists. Weight is the only capacity
 * system and it never blocks a pickup, so there is no slot count to run out of.
 *
 * The tab bar is one tab per SLOT, not per owned item — a kind with nothing
 * equipped renders locked rather than vanishing, so the bar is the same four
 * buttons in the same places forever. Everything that changes lives inside the
 * framed region; the surrounding chrome never moves when you switch tabs.
 */
export function Inventory() {
  const { character, updateSection, updateSections } = useOutletContext<RouteContext>()
  const nav = useNavigate()
  const { addRoll } = useRollLog()
  const { tooltip, bind, hide: hideTooltip } = useItemTooltip()

  const inventory = getInventory(character)
  const gear = getGear(character)
  const load = burden(character)
  const coins = character.sheet.coins ?? { gold: 0 }

  /** Fixed four: ON PERSON plus one tab per page-container KIND. */
  const tabs = useMemo<Tab[]>(() => [
    { id: PERSON, kind: null, label: 'On Person', icon: 'fa-hand-fist', container: null },
    ...TAB_KIND_ORDER.map(kind => {
      const c = gear.containers?.[kind] ?? null
      const chrome = KIND_CHROME[kind] ?? { label: String(kind), icon: 'fa-box' }
      return {
        id: c?.id ?? null,
        kind,
        label: c?.name ?? chrome.label,
        icon: c?.icon ?? chrome.icon,
        container: c,
      }
    }),
  ], [gear])

  const [activeId, setActiveId] = useState<string>(PERSON)
  const [filter, setFilter] = useState<ItemCategory | 'all'>('all')
  const [sortBy, setSortBy] = useState<SortKey>('name')
  const [popupId, setPopupId] = useState<string | null>(null)
  const [denyKind, setDenyKind] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // A container unequipped from the Equipment screen must not strand us on a tab
  // that no longer exists — fall back to ON PERSON.
  const active = tabs.find(t => t.id != null && t.id === activeId) ?? tabs[0]
  useEffect(() => {
    if (active.id !== activeId) setActiveId(PERSON)
  }, [active.id, activeId])

  const contents = useMemo(
    () => inventory.filter(i => i.containerId === active.id),
    [inventory, active.id],
  )
  const placed = useMemo(() => packPerson(inventory), [inventory])
  const popupItem = popupId ? inventory.find(i => i.id === popupId) ?? null : null

  // Drag state (ON PERSON only). `moved` distinguishes a drag from a click.
  const gridRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const movedRef = useRef(false)

  // One-time repair: two bag items sharing an id makes every id-keyed operation
  // treat them as one tile — moving one moves both, dropping one drops both.
  const healedRef = useRef(false)
  useEffect(() => {
    if (healedRef.current) return
    const seen = new Set<string>()
    let changed = false
    const next = inventory.map(i => {
      if (!i.id || seen.has(i.id)) { changed = true; return { ...i, id: freshItemId() } }
      seen.add(i.id)
      return i
    })
    if (changed) {
      healedRef.current = true
      void updateSection('inventory', next as unknown as Json[])
    }
  }, [inventory, updateSection])

  // Escape closes the popup.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPopupId(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function selectTab(t: Tab) {
    if (t.id == null) {
      // Locked: a visible slot to fill, not a hidden feature. Say so and shake.
      setDenyKind(t.kind)
      window.setTimeout(() => setDenyKind(null), 340)
      return
    }
    if (t.id === activeId) return
    setActiveId(t.id)
    setFilter('all')
  }

  /* ---------- ON PERSON drag-to-rearrange ---------- */

  function cellFromPointer(clientX: number, clientY: number): { col: number; row: number } {
    const rect = gridRef.current!.getBoundingClientRect()
    return {
      col: Math.floor((clientX - rect.left) / (rect.width / GRID_COLS)) + 1,
      row: Math.floor((clientY - rect.top) / (rect.height / GRID_ROWS)) + 1,
    }
  }

  function canPlace(col: number, row: number, w: number, h: number, selfId?: string): boolean {
    if (col < 1 || row < 1 || col + w - 1 > GRID_COLS || row + h - 1 > GRID_ROWS) return false
    for (const p of placed) {
      if (p.item.id === selfId) continue
      if (col < p.col + p.w && col + w > p.col && row < p.row + p.h && row + h > p.row) return false
    }
    return true
  }

  function onTileDown(e: React.PointerEvent, p: Placed) {
    if (busy) return
    e.preventDefault()
    const { col, row } = cellFromPointer(e.clientX, e.clientY)
    movedRef.current = false
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    setDrag({
      id: p.item.id ?? '', w: p.w, h: p.h,
      grabCol: col - p.col, grabRow: row - p.row,
      x: e.clientX, y: e.clientY,
      target: { col: p.col, row: p.row }, valid: true,
    })
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag) return
    if (Math.abs(e.clientX - drag.x) > 4 || Math.abs(e.clientY - drag.y) > 4) movedRef.current = true
    const { col, row } = cellFromPointer(e.clientX, e.clientY)
    const targetCol = Math.max(1, Math.min(GRID_COLS - drag.w + 1, col - drag.grabCol))
    const targetRow = Math.max(1, Math.min(GRID_ROWS - drag.h + 1, row - drag.grabRow))
    setDrag({
      ...drag, x: e.clientX, y: e.clientY,
      target: { col: targetCol, row: targetRow },
      valid: canPlace(targetCol, targetRow, drag.w, drag.h, drag.id),
    })
  }

  async function onPointerUp() {
    if (!drag) return
    const d = drag
    setDrag(null)
    if (!movedRef.current) {
      // A click, not a drag → open the popup. One gesture, app-wide.
      hideTooltip()
      setPopupId(d.id)
      return
    }
    if (d.target && d.valid) {
      // Pin EVERY on-person item's current position, not just the dragged one:
      // auto-packed items would otherwise re-pack around the new cell on the next
      // render, making untouched tiles jump. `d.valid` already excludes overlap.
      const next = inventory.map(i => {
        if (i.id === d.id) return { ...i, col: d.target!.col, row: d.target!.row }
        if (i.containerId !== PERSON) return i
        const pl = placed.find(p => p.item.id === i.id)
        return pl ? { ...i, col: pl.col, row: pl.row } : i
      })
      await updateSection('inventory', next as unknown as Json[])
    }
  }

  /* ---------- item actions (the popup drives all of these) ---------- */

  async function equip(item: InventoryItem) {
    if (busy) return
    const target = resolveEquipTarget(item, gear)
    if (target.kind === 'none') return
    const p = equipTargetPatch(item, target, gear, inventory)
    if (!p) return
    setBusy(true); setPopupId(null)
    await updateSections(p)
    setBusy(false)
  }

  async function use(item: InventoryItem) {
    if (busy) return
    const outcome = consumeEffect(item, character)
    if (outcome.wasted) {
      addRoll({ kind: 'custom', title: item.name, subtitle: outcome.subtitle, icon: item.icon ?? 'fa-flask', lines: outcome.lines })
      return
    }
    setBusy(true); setPopupId(null)
    const patch: Partial<Pick<CharacterRow, CharacterSection>> = {}
    if (outcome.sheet) patch.sheet = outcome.sheet
    if (outcome.resources) patch.resources = outcome.resources
    const nextQty = (item.qty ?? 1) - 1
    patch.inventory = (nextQty > 0
      ? inventory.map(i => (i.id === item.id ? { ...i, qty: nextQty } : i))
      : inventory.filter(i => i.id !== item.id)) as unknown as Json[]
    await updateSections(patch)
    setBusy(false)
    addRoll({ kind: 'custom', title: item.name, subtitle: outcome.subtitle, icon: item.icon ?? 'fa-flask', lines: outcome.lines })
  }

  /** Move an item between ON PERSON and a container. Both directions are the same
   *  write, which is why no dragging across a tab switch is ever needed. */
  async function moveTo(item: InventoryItem, destId: string) {
    if (busy) return
    const dest = destId === PERSON
      ? (() => {
          const cell = freeCellFor(inventory.filter(i => i.id !== item.id), item)
          return cell ? { containerId: PERSON, ...cell } : null
        })()
      : { containerId: destId }
    if (!dest) return           // no reachable space — the popup blocks this itself
    setBusy(true); setPopupId(null)
    await updateSection(
      'inventory',
      inventory.map(i => (i.id === item.id ? place(i, dest) : i)) as unknown as Json[],
    )
    setBusy(false)
  }

  async function drop(item: InventoryItem) {
    if (busy) return
    setBusy(true); setPopupId(null)
    await updateSection('inventory', inventory.filter(i => i.id !== item.id) as unknown as Json[])
    setBusy(false)
  }

  /* ---------- derived readouts ---------- */

  const usedCells = placed.reduce((n, p) => n + p.w * p.h, 0)
  const overBurdened = load.ratio > 1
  const fillPct = Math.min(100, load.ratio * 100)
  // SRD thresholds: encumbered at 5xSTR, heavy at 10xSTR, max at 15xSTR — so the
  // ticks sit at 1/3 and 2/3 of the bar.
  const encAt = Math.round((load.max / 3) * 10) / 10
  const heavyAt = Math.round((load.max * 2 / 3) * 10) / 10

  const weightless = !!active.container?.container?.weightless
  const viewWeight = contents.reduce((n, i) => n + itemWeight(i), 0)

  const meta = (
    <>
      <span className="dim">◇</span>
      <span>Section</span>
      <span className="acc">/ Equipment</span>
      <span className="dim">·</span>
      <span>Cargo Manifest</span>
      <span className="dim">·</span>
      <span>Load <span className="acc">:: {load.current} / {load.max}</span> lb</span>
    </>
  )

  return (
    <>
      <Deco
        left={<><span className="acc">EQUIPMENT</span> &nbsp;//&nbsp; CARGO_MANIFEST &nbsp;//&nbsp; PACK OK</>}
        right={<>Castella-08 &nbsp;//&nbsp; <span className="acc">{overBurdened ? 'OVER CAPACITY' : 'STORAGE: OPEN'}</span> &nbsp;//&nbsp; Loadout 02</>}
      />
      <Nav variant="dock" meta={meta} />

      <main className={styles.inv}>
        {/* ===================== LEFT — CARRIED ===================== */}
        <section className={`${styles.col} ${styles.left}`} aria-label="Carried items">
          <div className={styles.colHeader}>
            <span className={styles.chNum}>01</span>
            <span className={styles.chTitle}>Carried</span>
            <span className={styles.chMeta}>
              {active.id === PERSON
                ? <><span className="acc">Within Reach</span></>
                : <>{weightless ? <span className="acc">Off-Device</span> : <span className="acc">Stowed</span>}</>}
            </span>
          </div>

          <div className={styles.region}>
            <div className={styles.rFrame} />
            <div className={styles.rGap} />
            <div className={styles.rLine} />
            <div className={styles.rInner}>
              <span className={`${styles.rCorner} ${styles.tl}`} />
              <span className={`${styles.rCorner} ${styles.br}`} />

              <div className={styles.cargoPad}>
                {/* --- container switcher: fixed four, one per slot --- */}
                <div className={styles.seg} role="tablist" aria-label="Container">
                  {tabs.map(t => {
                    const locked = t.id == null
                    const count = locked ? 0 : inventory.filter(i => i.containerId === t.id).length
                    return (
                      <button
                        key={t.kind ?? PERSON}
                        type="button"
                        role="tab"
                        aria-selected={t.id === active.id}
                        aria-disabled={locked}
                        className={[
                          styles.segBtn,
                          t.id === active.id ? styles.on : '',
                          locked ? styles.locked : '',
                          denyKind && denyKind === t.kind ? styles.deny : '',
                        ].filter(Boolean).join(' ')}
                        title={locked ? 'No container equipped in this slot — equip one from the Equipment screen' : undefined}
                        onClick={() => selectTab(t)}
                      >
                        <span className={styles.sgFrame} />
                        <span className={styles.sgInner}>
                          <i className={`fa-solid ${t.icon}`} aria-hidden="true" />
                          {t.label}
                          <span className={styles.sgN}>
                            {locked ? <i className="fa-solid fa-lock" aria-hidden="true" /> : count}
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </div>

                {/* --- header line: what this view is and what it holds --- */}
                <div className={styles.ctrLine}>
                  <span className={styles.nm}>{active.label}</span>
                  <span className={styles.sep}>·</span>
                  <span className={styles.v}>{contents.length}</span> Items
                  <span className={styles.sep}>·</span>
                  <span className={styles.v}>{weightless ? 'Weightless' : `${fmtWeight(viewWeight)} lb`}</span>
                  {weightless && (
                    <span className={styles.sys}><span className={styles.tick} />Off-Device</span>
                  )}
                </div>

                {/* --- utility bar: reach readout (grid) / chips + sort (list) --- */}
                <div className={styles.utilBar}>
                  {active.id === PERSON ? (
                    <>
                      <span className={styles.reachRead}>
                        <span className={styles.k}>Reach</span> Belt
                        <span className={styles.k}>·</span> Pockets
                        <span className={styles.k}>·</span> Quick-Access
                      </span>
                      <span className={`${styles.reachRead} ${styles.free}`}>
                        <span className={styles.k}>Cells</span>
                        <span className={styles.acc}>{usedCells} / {GRID_CELLS}</span>
                      </span>
                    </>
                  ) : (
                    <ListUtilBar
                      items={contents} filter={filter} sortBy={sortBy}
                      onFilter={setFilter} onSort={setSortBy}
                    />
                  )}
                </div>

                {/* --- the pane itself --- */}
                {active.id === PERSON ? (
                  <div className={styles.gridWrap}>
                    <div
                      ref={gridRef}
                      className={styles.opGrid}
                      onPointerMove={onPointerMove}
                      onPointerUp={() => void onPointerUp()}
                      onPointerCancel={() => setDrag(null)}
                    >
                      {emptyCells(placed).map(c => (
                        <div
                          key={`e${c.row}-${c.col}`}
                          className={styles.cellEmpty}
                          style={{ gridColumn: c.col, gridRow: c.row }}
                        />
                      ))}
                      {placed.map(p => (
                        <ItemTile
                          key={p.item.id ?? `${p.col},${p.row}`}
                          p={p}
                          dragging={drag?.id === p.item.id && movedRef.current}
                          bind={bind}
                          onPointerDown={e => onTileDown(e, p)}
                          onActivate={() => { hideTooltip(); setPopupId(p.item.id ?? null) }}
                        />
                      ))}
                      {drag?.target && movedRef.current && (
                        <div
                          className={`${styles.preview}${drag.valid ? '' : ' ' + styles.bad}`}
                          style={{
                            gridColumn: `${drag.target.col} / span ${drag.w}`,
                            gridRow: `${drag.target.row} / span ${drag.h}`,
                          }}
                          aria-hidden="true"
                        />
                      )}
                    </div>
                  </div>
                ) : (
                  <ContainerList
                    items={contents} filter={filter} sortBy={sortBy} weightless={weightless}
                    bind={bind}
                    onPick={id => { hideTooltip(); setPopupId(id) }}
                  />
                )}
              </div>
            </div>
          </div>
        </section>

        {/* ===================== RIGHT — LOAD / COIN ===================== */}
        <section className={`${styles.col} ${styles.right}`} aria-label="Load and coin">
          <div className={styles.colHeader}>
            <span className={styles.chNum}>02</span>
            <span className={styles.chTitle}>Load / Coin</span>
            <span className={styles.chMeta} onClick={() => nav('/equipment')} style={{ cursor: 'pointer' }}>Equipment ↩</span>
          </div>
          <div className={`${styles.region} ${styles.load}`}>
            <div className={styles.rFrame} />
            <div className={styles.rGap} />
            <div className={styles.rLine} />
            <div className={styles.rInner}>
              <span className={`${styles.rCorner} ${styles.tl}`} />
              <span className={`${styles.rCorner} ${styles.br}`} />
              <div className={styles.loadBody}>
                <div className={styles.burden}>
                  <div className={styles.subHead}>Burden Manifest</div>
                  <div className={`${styles.burdenReadout}${overBurdened ? ' ' + styles.over : ''}`}>
                    <span className="cur">{load.current}</span>
                    <span className="slash">/</span>
                    <span className="max">{load.max}</span>
                    <span className="unit">lb</span>
                  </div>
                  <div className={`${styles.burdenBar}${overBurdened ? ' ' + styles.over : ''}`}>
                    <div className="fill" style={{ width: `${fillPct}%` }} />
                    <div className="tick" style={{ left: '33.33%' }} />
                    <div className="tick" style={{ left: '66.66%' }} />
                  </div>
                  <div className={styles.burdenTicks}>
                    <span style={{ left: '33.33%' }}>Enc · {encAt}</span>
                    <span style={{ left: '66.66%' }}>Heavy · {heavyAt}</span>
                  </div>
                  <div className={styles.slotRow}>
                    <span className="acc">{inventory.length}</span><span>Items Carried</span>
                    <span className="sep">·</span>
                    <span className="acc">{usedCells}</span><span>/ {GRID_CELLS} Reachable</span>
                  </div>
                  {/* Weight is the ONLY capacity system now: these tiers slow the
                      character, they never block a pickup. */}
                  <div className={styles.encNote}>
                    {load.current > heavyAt
                      ? <span className={styles.warn}>// Heavily encumbered — speed −20 ft, disadv. on STR/DEX/CON checks</span>
                      : load.current > encAt
                        ? <span className={styles.warn}>// Encumbered — speed −10 ft</span>
                        : <span>// Unencumbered</span>}
                  </div>
                </div>

                <div className={styles.ldDivider} />

                <div className={styles.coin}>
                  <div className={styles.subHead}>Coin Purse</div>
                  <div className={styles.coinRow}>
                    <div className={`${styles.coinBadge} ${styles.gp}`}><span className="ci">GP</span><span className="cval">{coins.gold.toLocaleString()}</span><span className="clab">Gold</span></div>
                    <div className={`${styles.coinBadge} ${styles.sp}`}><span className="ci">SP</span><span className="cval">{(coins.silver ?? 0).toLocaleString()}</span><span className="clab">Silver</span></div>
                    <div className={`${styles.coinBadge} ${styles.cp}`}><span className="ci">CP</span><span className="cval">{(coins.copper ?? 0).toLocaleString()}</span><span className="clab">Copper</span></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {tooltip}

      {popupItem && (
        <ItemPopup
          item={popupItem}
          gear={gear}
          inventory={inventory}
          target={resolveEquipTarget(popupItem, gear)}
          busy={busy}
          onEquip={() => void equip(popupItem)}
          onUse={() => void use(popupItem)}
          onMove={destId => void moveTo(popupItem, destId)}
          onDrop={() => void drop(popupItem)}
          onOpenContainer={id => { setPopupId(null); setActiveId(id); setFilter('all') }}
          onClose={() => setPopupId(null)}
        />
      )}
    </>
  )
}

interface DragState {
  id: string; w: number; h: number
  grabCol: number; grabRow: number
  x: number; y: number
  target: { col: number; row: number } | null
  valid: boolean
}

/** Facts-only hover card for a tile or row. Never prose, never buttons. */
export function itemTooltipData(item: (InventoryItem | EquippedItem) & Partial<WeaponData>) {
  const cat = item.category ?? 'misc'
  // Category and rarity already ride in the sub line — repeating category as a
  // row just makes the card taller for no information.
  const rows: [string, string][] = [
    ['Weight', item.weight != null ? `${fmtWeight(itemWeight(item))} lb` : '—'],
  ]
  const keyStat = item.damage ?? item.damageDice ?? item.rows?.[0]?.[1]
  if (keyStat) rows.push([item.category === 'weapon' ? 'Damage' : 'Detail', String(keyStat)])
  if (item.qty && item.qty > 1) rows.push(['Quantity', `×${item.qty}`])
  return {
    name: item.name,
    sub: `${rarityLabel(item.rarity ?? 'common')} · ${CAT_LABEL[cat]}`,
    rows,
    rarity: item.rarity ?? 'common',
  }
}

function ItemTile({ p, dragging, bind, onPointerDown, onActivate }: {
  p: Placed; dragging: boolean
  bind: ReturnType<typeof useItemTooltip>['bind']
  onPointerDown: (e: React.PointerEvent) => void
  onActivate: () => void
}) {
  const { item } = p
  const cat = item.category ?? 'misc'
  return (
    <button
      type="button"
      className={`${styles.cellItem} ${fpClass(p.w, p.h)}${dragging ? ' ' + styles.dragging : ''}${item.locked ? ' ' + styles.lockedItem : ''}`}
      data-rarity={item.rarity ?? 'common'}
      data-cat={cat}
      style={{ gridColumn: `${p.col} / span ${p.w}`, gridRow: `${p.row} / span ${p.h}` }}
      onPointerDown={onPointerDown}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate() } }}
      aria-label={`${item.name}${item.qty && item.qty > 1 ? ` ×${item.qty}` : ''}`}
      {...bind(itemTooltipData(item))}
    >
      <i className={`fa-solid ${CAT_CORNER[cat]} ${styles.catCorner}`} aria-hidden="true" />
      <i className={`fa-solid ${item.icon ?? 'fa-cube'} ${styles.glyph}`} style={item.flip ? { transform: 'scaleX(-1)' } : undefined} aria-hidden="true" />
      {item.locked && <i className={`fa-solid fa-lock ${styles.lockPip}`} aria-hidden="true" />}
      {item.qty && item.qty > 1 && <span className={styles.stack}>×{item.qty}</span>}
    </button>
  )
}

/** Category chips + sort. The main navigation tool once a container holds 100+
 *  items, which is exactly the case the grid could never handle. */
function ListUtilBar({ items, filter, sortBy, onFilter, onSort }: {
  items: InventoryItem[]
  filter: ItemCategory | 'all'
  sortBy: SortKey
  onFilter: (f: ItemCategory | 'all') => void
  onSort: (s: SortKey) => void
}) {
  const counts = new Map<ItemCategory, number>()
  for (const i of items) {
    const c = i.category ?? 'misc'
    counts.set(c, (counts.get(c) ?? 0) + 1)
  }
  const chip = (key: ItemCategory | 'all', label: string, n: number) => (
    <button
      key={key} type="button"
      className={`${styles.chip}${filter === key ? ' ' + styles.on : ''}`}
      onClick={() => onFilter(key)}
    >
      {label}<span className={styles.n}>{n}</span>
    </button>
  )
  return (
    <>
      {chip('all', 'All', items.length)}
      {CAT_ORDER.filter(c => counts.has(c)).map(c => chip(c, CAT_LABEL[c], counts.get(c)!))}
      <span className={styles.sortWrap}>
        <span className={styles.lab}>Sort</span>
        <select
          className={styles.sortSel} value={sortBy}
          onChange={e => onSort(e.target.value as SortKey)}
          aria-label="Sort items"
        >
          <option value="name">Name</option>
          <option value="weight">Weight</option>
          <option value="value">Value</option>
          <option value="category">Category</option>
        </select>
      </span>
    </>
  )
}

/** A container view: an unlimited, sortable, filterable list. No geometry — sort
 *  order is a view preference, never stored state. */
function ContainerList({ items, filter, sortBy, weightless, bind, onPick }: {
  items: InventoryItem[]
  filter: ItemCategory | 'all'
  sortBy: SortKey
  weightless: boolean
  bind: ReturnType<typeof useItemTooltip>['bind']
  onPick: (id: string) => void
}) {
  const rows = useMemo(() => {
    const list = filter === 'all' ? items.slice() : items.filter(i => (i.category ?? 'misc') === filter)
    return list.sort((a, b) => {
      if (sortBy === 'weight') return itemWeight(b) - itemWeight(a) || a.name.localeCompare(b.name)
      if (sortBy === 'value') return (b.value ?? 0) * (b.qty ?? 1) - (a.value ?? 0) * (a.qty ?? 1) || a.name.localeCompare(b.name)
      if (sortBy === 'category') {
        return CAT_ORDER.indexOf(a.category ?? 'misc') - CAT_ORDER.indexOf(b.category ?? 'misc')
          || a.name.localeCompare(b.name)
      }
      return a.name.localeCompare(b.name)
    })
  }, [items, filter, sortBy])

  if (rows.length === 0) {
    return (
      <div className={styles.listNone}>
        <div className={styles.p}>Nothing Here</div>
        <div className={styles.h}>
          {items.length > 0 ? '// No items of that category in this container' : '// Empty — stow something from ON PERSON'}
        </div>
      </div>
    )
  }

  return (
    <div className={styles.clist}>
      {rows.map(it => {
        const cat = it.category ?? 'misc'
        return (
          <button
            key={it.id}
            type="button"
            className={`${styles.crow}${it.locked ? ' ' + styles.lockedItem : ''}`}
            data-rar={it.rarity ?? 'common'}
            onClick={() => onPick(it.id!)}
            {...bind(itemTooltipData(it))}
          >
            <span className={styles.ri}><i className={`fa-solid ${it.icon ?? 'fa-cube'}`} aria-hidden="true" /></span>
            <span className={styles.rn}>
              {it.locked && <i className={`fa-solid fa-lock ${styles.rowLock}`} aria-hidden="true" />}
              {it.name}
            </span>
            <span className={`${styles.rq}${it.qty && it.qty > 1 ? '' : ' ' + styles.none}`}>×{it.qty ?? 1}</span>
            <span className={styles.rw}>{weightless ? '—' : `${fmtWeight(itemWeight(it))} lb`}</span>
            <span className={styles.rc}>{CAT_LABEL[cat]}</span>
          </button>
        )
      })}
    </div>
  )
}
