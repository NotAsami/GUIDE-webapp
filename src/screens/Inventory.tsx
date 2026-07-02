import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import type {
  CharacterRow, CharacterSection, InventoryItem, ItemCategory, ItemRarity, Json,
} from '../lib/database.types'
import { Nav } from '../components/Nav'
import { Deco } from '../components/Deco'
import { burden } from '../lib/burden'
import { consumeEffect } from '../lib/consume'
import {
  equipTargetPatch, getGear, getInventory, resolveEquipTarget, type EquipTarget,
} from '../lib/equip'
import { useRollLog } from '../lib/rolls'
import styles from './Inventory.module.css'

interface RouteContext {
  character: CharacterRow
  updateSection: <K extends CharacterSection>(section: K, next: CharacterRow[K]) => Promise<void>
  updateSections: (patch: Partial<Pick<CharacterRow, CharacterSection>>) => Promise<void>
}

/** The cargo grid is a fixed 10x8 spatial inventory (Diablo / Resident Evil
 *  tradition): items occupy rectangular footprints. The grid fills its framed
 *  region (landscape, so 10 wide x 8 tall keeps cells close to square). */
const COLS = 10
const ROWS = 8

interface Placed { item: InventoryItem; col: number; row: number; w: number; h: number }

function footprint(item: InventoryItem): { w: number; h: number } {
  return {
    w: Math.min(COLS, Math.max(1, item.w ?? 1)),
    h: Math.min(ROWS, Math.max(1, item.h ?? 1)),
  }
}

/** Pack items into the 10x8 grid: honor each item's stored (col,row) when it fits
 *  and doesn't collide; auto-place the rest into the first free rectangle
 *  (row-major). Deterministic, so the layout is stable across renders. */
function packItems(items: InventoryItem[]): Placed[] {
  const occ = new Set<string>()
  const key = (r: number, c: number) => `${r},${c}`
  const fits = (col: number, row: number, w: number, h: number): boolean => {
    if (col < 0 || row < 0 || col + w > COLS || row + h > ROWS) return false
    for (let r = row; r < row + h; r++)
      for (let c = col; c < col + w; c++)
        if (occ.has(key(r, c))) return false
    return true
  }
  const claim = (col: number, row: number, w: number, h: number) => {
    for (let r = row; r < row + h; r++)
      for (let c = col; c < col + w; c++) occ.add(key(r, c))
  }

  const placed: Placed[] = []
  const pending: { item: InventoryItem; w: number; h: number }[] = []

  for (const item of items) {
    const { w, h } = footprint(item)
    if (item.col != null && item.row != null && fits(item.col, item.row, w, h)) {
      claim(item.col, item.row, w, h)
      placed.push({ item, col: item.col, row: item.row, w, h })
    } else {
      pending.push({ item, w, h })
    }
  }
  for (const { item, w, h } of pending) {
    let done = false
    for (let row = 0; row <= ROWS - h && !done; row++) {
      for (let col = 0; col <= COLS - w; col++) {
        if (fits(col, row, w, h)) {
          claim(col, row, w, h)
          placed.push({ item, col, row, w, h })
          done = true
          break
        }
      }
    }
    if (!done) placed.push({ item, col: 0, row: 0, w, h }) // overflow (grid full) — rare
  }
  return placed
}

/** Map our item category onto a corner glyph (mirrors the handoff CAT table). */
const CAT_CORNER: Record<ItemCategory, string> = {
  weapon: 'fa-khanda',
  gear: 'fa-shield-halved',
  consumable: 'fa-flask-vial',
  misc: 'fa-circle-dot',
}
const CAT_LABEL: Record<ItemCategory, string> = {
  weapon: 'Weapon', gear: 'Gear', consumable: 'Consumable', misc: 'Misc',
}

function fpClass(w: number, h: number): string {
  if (h >= 3 && w === 1) return styles.fpV
  const area = w * h
  if (area >= 4) return styles.fpL
  if (area >= 2) return styles.fpM
  return styles.fpS
}

function rarityLabel(r: ItemRarity): string {
  return r.charAt(0).toUpperCase() + r.slice(1)
}

/** Inventory — the carried-but-not-equipped manifest, ported to the handoff's
 *  two-region layout: a left Cargo Grid (10x8 spatial footprints) and a right
 *  column of Item Detail (hover to preview, click to pin) + Load/Coin (burden
 *  bar + coin purse, from data). Equipping moves the item into `equipped` via the
 *  SAME shared helpers Equipment uses — one owner of the move. Drag-to-rearrange
 *  is an enhancement over the static mockup. */
export function Inventory() {
  const { character, updateSection, updateSections } = useOutletContext<RouteContext>()
  const nav = useNavigate()
  const { addRoll } = useRollLog()
  const inventory = getInventory(character)
  const gear = getGear(character)
  const load = burden(character)
  const coins = character.sheet.coins ?? { gold: 0 }

  const placed = useMemo(() => packItems(inventory), [inventory])
  const [pinned, setPinned] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const shownId = pinned ?? hovered
  const shown = shownId ? inventory.find(i => i.id === shownId) ?? null : null

  // Drag state. `moved` distinguishes a drag (reposition) from a click (pin).
  const gridRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const movedRef = useRef(false)

  // Unpin / clear hover on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setPinned(null); setHovered(null) } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function cellFromPointer(clientX: number, clientY: number): { col: number; row: number } {
    const rect = gridRef.current!.getBoundingClientRect()
    const cellW = rect.width / COLS
    const cellH = rect.height / ROWS
    return {
      col: Math.floor((clientX - rect.left) / cellW),
      row: Math.floor((clientY - rect.top) / cellH),
    }
  }

  function canPlace(col: number, row: number, w: number, h: number, selfId?: string): boolean {
    if (col < 0 || row < 0 || col + w > COLS || row + h > ROWS) return false
    for (const p of placed) {
      if (p.item.id === selfId) continue
      const overlap = col < p.col + p.w && col + w > p.col && row < p.row + p.h && row + h > p.row
      if (overlap) return false
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
    const targetCol = Math.max(0, Math.min(COLS - drag.w, col - drag.grabCol))
    const targetRow = Math.max(0, Math.min(ROWS - drag.h, row - drag.grabRow))
    const valid = canPlace(targetCol, targetRow, drag.w, drag.h, drag.id)
    setDrag({ ...drag, x: e.clientX, y: e.clientY, target: { col: targetCol, row: targetRow }, valid })
  }

  async function onPointerUp() {
    if (!drag) return
    const d = drag
    setDrag(null)
    if (!movedRef.current) {
      // A click, not a drag → toggle the pin on this tile.
      setPinned(prev => (prev === d.id ? null : d.id))
      return
    }
    if (d.target && d.valid) {
      // Pin EVERY item's current position, not just the dragged one. Seed items
      // start position-less and get auto-packed; persisting only the dragged item
      // would leave the rest to re-pack around its new cell on next render, making
      // untouched tiles jump. `d.valid` already excludes overlap, so freezing the
      // others stays collision-free.
      const next = inventory.map(i => {
        if (i.id === d.id) return { ...i, col: d.target!.col, row: d.target!.row }
        const pl = placed.find(p => p.item.id === i.id)
        return pl ? { ...i, col: pl.col, row: pl.row } : i
      })
      await updateSection('inventory', next as unknown as Json[])
    }
  }

  /** Equip a carried item in one tap: the shared resolver picks the slot/hand, the
   *  shared patch builder moves it into `equipped` (atomic). */
  async function equip(item: InventoryItem) {
    if (busy) return
    const target = resolveEquipTarget(item, gear)
    if (target.kind === 'none') return
    const p = equipTargetPatch(item, target, gear, inventory)
    if (!p) return
    setBusy(true)
    setPinned(null); setHovered(null)
    await updateSections(p)
    setBusy(false)
  }

  /** Use a carried consumable: shared consume math (HP + status), then spend one
   *  from the bag. */
  async function use(item: InventoryItem) {
    if (busy) return
    const outcome = consumeEffect(item, character)
    if (outcome.wasted) {
      addRoll({ kind: 'custom', title: item.name, subtitle: outcome.subtitle, icon: item.icon ?? 'fa-flask', lines: outcome.lines })
      return
    }
    setBusy(true)
    const patch: Partial<Pick<CharacterRow, CharacterSection>> = {}
    if (outcome.sheet) patch.sheet = outcome.sheet
    if (outcome.resources) patch.resources = outcome.resources
    const nextQty = (item.qty ?? 1) - 1
    const nextInv = nextQty > 0
      ? inventory.map(i => i.id === item.id ? { ...i, qty: nextQty } : i)
      : inventory.filter(i => i.id !== item.id)
    patch.inventory = nextInv as unknown as Json[]
    if (nextQty <= 0) { setPinned(null); setHovered(null) }
    await updateSections(patch)
    setBusy(false)
    addRoll({ kind: 'custom', title: item.name, subtitle: outcome.subtitle, icon: item.icon ?? 'fa-flask', lines: outcome.lines })
  }

  /** Drop a carried item out of the bag entirely (atomic). */
  async function drop(item: InventoryItem) {
    if (busy) return
    setBusy(true)
    setPinned(null); setHovered(null)
    await updateSection('inventory', inventory.filter(i => i.id !== item.id) as unknown as Json[])
    setBusy(false)
  }

  const overBurdened = load.ratio > 1
  const fillPct = Math.min(100, load.ratio * 100)
  const totalSlots = COLS * ROWS
  const usedCells = placed.reduce((n, p) => n + p.w * p.h, 0)
  const freeCells = totalSlots - usedCells
  // SRD load thresholds: encumbered at 5xSTR, heavily encumbered at 10xSTR, max at
  // 15xSTR — so the ticks sit at 1/3 and 2/3 of the bar, labels derived from max.
  const encAt = Math.round((load.max / 3) * 10) / 10
  const heavyAt = Math.round((load.max * 2 / 3) * 10) / 10
  const totalGp = Math.round((coins.gold + (coins.silver ?? 0) / 10 + (coins.copper ?? 0) / 100) * 10) / 10

  const meta = (
    <>
      <span className="dim">◇</span>
      <span>Section</span>
      <span className="acc">/ Equipment</span>
      <span className="dim">·</span>
      <span>Cargo Manifest</span>
      <span className="dim">·</span>
      <span>Storage <span className="acc">:: {usedCells} / {totalSlots}</span> Slots</span>
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
        {/* ===================== LEFT — CARGO GRID ===================== */}
        <section className={`${styles.col} ${styles.left}`} aria-label="Cargo grid">
          <div className={styles.colHeader}>
            <span className={styles.chNum}>01</span>
            <span className={styles.chTitle}>Cargo Grid</span>
            <span className={styles.chMeta}>
              {inventory.length} Items <span className="dim">·</span> <span className="acc">{usedCells} / {totalSlots}</span>
            </span>
          </div>
          <div className={styles.region}>
            <div className={styles.rFrame} />
            <div className={styles.rGap} />
            <div className={styles.rLine} />
            <div className={styles.rInner}>
              <span className={`${styles.rCorner} ${styles.tl}`} />
              <span className={`${styles.rCorner} ${styles.br}`} />
              {inventory.length === 0 ? (
                <div className={styles.empty}>
                  <i className="fa-solid fa-box-open" aria-hidden="true" />
                  <p>Your bag is empty.</p>
                  <p className={styles.emptySub}>Items the DM grants you appear here to carry, equip and use.</p>
                </div>
              ) : (
                <div className={styles.cargoPad}>
                  <div
                    ref={gridRef}
                    className={styles.cargoGrid}
                    onPointerMove={onPointerMove}
                    onPointerUp={() => void onPointerUp()}
                    onPointerCancel={() => setDrag(null)}
                  >
                    {/* empty cells — the lattice backdrop */}
                    {emptyCells(placed).map(({ col, row }) => (
                      <div
                        key={`e${row}-${col}`}
                        className={styles.cellEmpty}
                        style={{ gridColumn: col + 1, gridRow: row + 1 }}
                      />
                    ))}

                    {/* item tiles */}
                    {placed.map(p => (
                      <ItemTile
                        key={p.item.id ?? `${p.col},${p.row}`}
                        p={p}
                        dragging={drag?.id === p.item.id && movedRef.current}
                        selected={pinned === p.item.id}
                        onPointerDown={e => onTileDown(e, p)}
                        onEnter={() => { if (!drag && !pinned) setHovered(p.item.id ?? null) }}
                        onLeave={() => { if (!drag && !pinned) setHovered(null) }}
                        onActivate={() => setPinned(prev => (prev === p.item.id ? null : p.item.id ?? null))}
                      />
                    ))}

                    {/* drag placement preview */}
                    {drag?.target && movedRef.current && (
                      <div
                        className={`${styles.preview}${drag.valid ? '' : ' ' + styles.bad}`}
                        style={{
                          gridColumn: `${drag.target.col + 1} / span ${drag.w}`,
                          gridRow: `${drag.target.row + 1} / span ${drag.h}`,
                        }}
                        aria-hidden="true"
                      />
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ===================== RIGHT — DETAIL + LOAD ===================== */}
        <section className={`${styles.col} ${styles.right}`} aria-label="Item detail and load">
          <div className={styles.colHeader}>
            <span className={styles.chNum}>02</span>
            <span className={styles.chTitle}>Item Detail</span>
            <span className={styles.chMeta}>
              {shown
                ? <><span className="acc">{CAT_LABEL[shown.category ?? 'misc']}</span> · {rarityLabel(shown.rarity ?? 'common')}</>
                : 'No Selection'}
            </span>
          </div>
          <div className={`${styles.region} ${styles.detail}`}>
            <div className={styles.rFrame} />
            <div className={styles.rGap} />
            <div className={styles.rLine} />
            <div className={styles.rInner}>
              <span className={`${styles.rCorner} ${styles.tl}`} />
              <span className={`${styles.rCorner} ${styles.br}`} />
              <div className={styles.detailBody}>
                {shown ? (
                  <ItemDetail
                    item={shown} target={resolveEquipTarget(shown, gear)} busy={busy}
                    actionable={pinned != null}
                    onEquip={() => void equip(shown)}
                    onUse={() => void use(shown)}
                    onDrop={() => void drop(shown)}
                  />
                ) : (
                  <div className={styles.detailEmpty}>
                    <div className="prompt">Select Item</div>
                    <div className="cur">█</div>
                    <div className="hint">// Hover or click any cell</div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className={`${styles.colHeader} ${styles.tight}`}>
            <span className={styles.chNum}>03</span>
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
                {/* burden */}
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
                    <span className="acc">{inventory.length}</span><span>Items</span>
                    <span className="sep">·</span>
                    <span>{totalSlots}</span><span>Slots</span>
                    <span className="sep">·</span>
                    <span className="acc">{freeCells}</span><span>Free</span>
                  </div>
                </div>

                <div className={styles.ldDivider} />

                {/* coin purse */}
                <div className={styles.coin}>
                  <div className={styles.subHead}>Coin Purse</div>
                  <div className={styles.coinRow}>
                    <div className={`${styles.coinBadge} ${styles.gp}`}><span className="ci">GP</span><span className="cval">{coins.gold.toLocaleString()}</span><span className="clab">Gold</span></div>
                    <div className={`${styles.coinBadge} ${styles.sp}`}><span className="ci">SP</span><span className="cval">{(coins.silver ?? 0).toLocaleString()}</span><span className="clab">Silver</span></div>
                    <div className={`${styles.coinBadge} ${styles.cp}`}><span className="ci">CP</span><span className="cval">{(coins.copper ?? 0).toLocaleString()}</span><span className="clab">Copper</span></div>
                  </div>
                  <div className={styles.coinTotal}>
                    <span className="approx">≈</span>
                    <span className="v">{totalGp.toLocaleString()} gp</span>
                    <span>Total Coin Carried</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
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

/** Cells not covered by any placed item — rendered as the lattice backdrop. */
function emptyCells(placed: Placed[]): { col: number; row: number }[] {
  const occ = new Set<string>()
  for (const p of placed)
    for (let r = p.row; r < p.row + p.h; r++)
      for (let c = p.col; c < p.col + p.w; c++) occ.add(`${r},${c}`)
  const out: { col: number; row: number }[] = []
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (!occ.has(`${r},${c}`)) out.push({ col: c, row: r })
  return out
}

function ItemTile({ p, dragging, selected, onPointerDown, onEnter, onLeave, onActivate }: {
  p: Placed; dragging: boolean; selected: boolean
  onPointerDown: (e: React.PointerEvent) => void
  onEnter: () => void; onLeave: () => void; onActivate: () => void
}) {
  const { item } = p
  const rarity = item.rarity ?? 'common'
  const cat = item.category ?? 'misc'
  return (
    <button
      type="button"
      className={`${styles.cellItem} ${fpClass(p.w, p.h)}${dragging ? ' ' + styles.dragging : ''}${selected ? ' ' + styles.selected : ''}`}
      data-rarity={rarity}
      data-cat={cat}
      style={{ gridColumn: `${p.col + 1} / span ${p.w}`, gridRow: `${p.row + 1} / span ${p.h}` }}
      onPointerDown={onPointerDown}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate() } }}
      aria-label={`${item.name}${item.qty && item.qty > 1 ? ` ×${item.qty}` : ''}`}
    >
      <i className={`fa-solid ${CAT_CORNER[cat]} ${styles.catCorner}`} aria-hidden="true" />
      <i className={`fa-solid ${item.icon ?? 'fa-cube'} ${styles.glyph}`} style={item.flip ? { transform: 'scaleX(-1)' } : undefined} aria-hidden="true" />
      {item.qty && item.qty > 1 && <span className={styles.stack}>×{item.qty}</span>}
    </button>
  )
}

/** Per-equip-target label for the Equip button. */
function equipLabel(target: EquipTarget): string {
  switch (target.kind) {
    case 'gear':   return 'Equip'
    case 'weapon': return target.hand === 'main' ? 'Equip · Main' : 'Equip · Off'
    case 'quick':  return 'Stow · Quick'
    case 'none':   return target.reason
  }
}

function ItemDetail({ item, target, busy, actionable, onEquip, onUse, onDrop }: {
  item: InventoryItem; target: EquipTarget; busy: boolean; actionable: boolean
  onEquip: () => void; onUse: () => void; onDrop: () => void
}) {
  const [confirmDrop, setConfirmDrop] = useState(false)
  // Reset the drop confirmation whenever the shown item changes.
  useEffect(() => { setConfirmDrop(false) }, [item.id])

  const rarity = item.rarity ?? 'common'
  const cat = item.category ?? 'misc'
  const canUse = item.category === 'consumable' && (item.heal !== undefined || !!item.effects)
  const canEquip = target.kind !== 'none'
  const weightTotal = item.weight !== undefined ? item.weight * (item.qty ?? 1) : undefined

  return (
    <div className={styles.detailActive}>
      <div className={styles.daScroll}>
        <div className={styles.daName} data-rarity={rarity}>{item.name}</div>
        <div className={styles.daTags}>
          <span className={styles.daTag}>{CAT_LABEL[cat]}</span>
          <span className={styles.daTag}>{rarityLabel(rarity)}</span>
          {item.qty && item.qty > 1 && <span className={styles.daTag}>Qty ×{item.qty}</span>}
          {item.type && <span className={styles.daTag}>{item.type}</span>}
        </div>

        <div className={styles.daStats}>
          <span className="k">Weight:</span>
          <span className="v">{item.weight !== undefined ? `${item.weight} lb${item.qty && item.qty > 1 ? ` ea (${weightTotal})` : ''}` : '—'}</span>
          {item.attune && <><span className="sep">·</span><span className="k">Attune:</span><span className="v">Yes</span></>}
        </div>

        {item.rows && item.rows.length > 0 && (
          <div className={styles.daRows}>
            {item.rows.map(([k, v], i) => (
              <div key={i} className="row"><span className="rk">{k}</span><span className="rv">{v}</span></div>
            ))}
          </div>
        )}

        {item.flavor && <div className={styles.daDesc}>{item.flavor}</div>}
      </div>

      {!actionable ? (
        <div className={styles.daPinHint}>// Click the tile to pin · then Equip / Use / Drop</div>
      ) : (
      <div className={styles.daActions}>
        {canEquip && (
          <button type="button" className={`${styles.actBtn} ${styles.primary}`} onClick={onEquip} disabled={busy}>
            <span className={styles.abFrame} />
            <span className={styles.abInner}><i className="fa-solid fa-circle-up" />{equipLabel(target)}</span>
          </button>
        )}
        {canUse && (
          <button type="button" className={`${styles.actBtn}${canEquip ? '' : ' ' + styles.primary}`} onClick={onUse} disabled={busy}>
            <span className={styles.abFrame} />
            <span className={styles.abInner}><i className="fa-solid fa-hand-holding-droplet" />Use</span>
          </button>
        )}
        {confirmDrop ? (
          <button type="button" className={`${styles.actBtn} ${styles.drop} ${styles.confirm}${canEquip || canUse ? '' : ' ' + styles.primary}`} onClick={onDrop} disabled={busy}>
            <span className={styles.abFrame} />
            <span className={styles.abInner}><i className="fa-solid fa-trash-can" />Confirm Drop?</span>
          </button>
        ) : (
          <button type="button" className={`${styles.actBtn} ${styles.drop}${canEquip || canUse ? '' : ' ' + styles.primary}`} onClick={() => setConfirmDrop(true)} disabled={busy}>
            <span className={styles.abFrame} />
            <span className={styles.abInner}><i className="fa-solid fa-trash-can" />Drop</span>
          </button>
        )}
      </div>
      )}
    </div>
  )
}
