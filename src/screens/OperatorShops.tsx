/**
 * Shopkeepers — the Catalog tab's shop-authoring surface (shop feature, part
 * 1; docs/notes.md §SHOP FEATURE). Same contract as the Items/Features tabs:
 * SAVE commits a template, it does not push anything to a player. The live
 * action lives on the index row — "Use ▸" fires the shop for one PC or the
 * whole party through `useDmShops().openShop`, reusing the same
 * open-shop/close-shop lifecycle the player's ShopTakeover reads via
 * `useOpenShop` (lib/shops.ts).
 *
 * Stock lines snapshot an item_catalog template's `data` at add-time — the
 * player client never reads item_catalog (DM-only RLS, 0004), so the
 * snapshot is the only way the takeover's stock grid can render without it.
 * Quest-tier items are excluded from the picker AND re-checked server-side
 * by shop_buy (notes.md: "they can't sell relics").
 */
import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CatalogItemData, CatalogItemRow, ItemCategory, ItemRarity, Shop, ShopCatalogRow, ShopStockLine, ShopStockMode } from '../lib/database.types'
import { proseField } from '../lib/textareaHooks'
import { formatPrice, type PriceUnit } from '../lib/coins'
import type { DmShopsState } from '../lib/dm'
import { ALL_PARTY } from '../lib/voice'
import { CAT_LABEL, CAT_ORDER, RARITY_ORDER, rarityLabel } from '../lib/items'
import { parseCatalogQuery, matchesCatalogQuery } from '../lib/catalogSearch'
import { ProsePreview } from '../components/ProsePreview'
import styles from './OperatorConsole.module.css'
import pop from './InventoryPopup.module.css'
import { IconPicker } from '../components/IconPicker'
import { Icon } from '../components/Icon'

const cx = (...xs: (string | false | undefined)[]) => xs.filter(Boolean).join(' ')

/** Rarity → border-read colour, matching the mock's RAR_DEF (which itself
 *  says "matches Inventory") — same small per-file map SystemToasts.tsx uses
 *  rather than a shared export, since nothing else needs it. */
const RAR_COLOR: Record<ItemRarity, string> = {
  common: 'var(--rar-common)', uncommon: 'var(--rar-uncommon)', rare: 'var(--rar-rare)',
  'very-rare': 'var(--rar-vrare)', legendary: 'var(--rar-legend)', artifact: 'var(--rar-artifact)',
}
const RAR_ORDER = RARITY_ORDER
/** The item picker's own category chips exclude 'quest' — same as the mock
 *  (RAR_ORDER.filter(r => r !== 'quest') / CAT_ORDER.filter(c => c !== 'quest')) —
 *  since quest-tier is blocked from shop stock entirely, not just filtered. */
const PICK_CATS = CAT_ORDER.filter(c => c !== 'quest')

/** Same button chrome as OperatorConsole's `Btn` (styles.btn/.bf/.bi) — not
 *  imported from there to avoid a screen<->screen circular import (see
 *  lib/items.ts's header note on why that's worth avoiding on purpose). */
function Btn({ tone, lg, icon, label, onClick, disabled }: {
  tone: 'amber' | 'cyan' | 'danger'; lg?: boolean; icon: string; label: string
  onClick?: () => void; disabled?: boolean
}) {
  return (
    <button className={cx(styles.btn, styles[tone], lg && styles.lg)} onClick={onClick} disabled={disabled}>
      <span className={styles.bf} />
      <span className={styles.bi}><Icon name={icon} /> {label}</span>
    </button>
  )
}

const UNITS: PriceUnit[] = ['gp', 'sp', 'cp']

export function OperatorShops({ shopLib, itemCatalog, members }: {
  shopLib: DmShopsState
  itemCatalog: CatalogItemRow[]
  members: { id: string; name: string }[]
}) {
  const { shops, loading, error, saveShop, createShop, deleteShop, openShop, closeShop } = shopLib
  const [selId, setSelId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [openPopupId, setOpenPopupId] = useState<string | null>(null)

  const activeId = creating ? null : (selId ?? shops[0]?.id ?? null)
  const selected = shops.find(s => s.id === activeId) ?? null
  const popupShop = shops.find(s => s.id === openPopupId) ?? null

  async function handleSubmit(data: Shop) {
    if (selected) {
      await saveShop(selected.id, data)
    } else {
      const created = await createShop(data)
      if (created) { setCreating(false); setSelId(created.id) }
    }
  }
  async function handleDelete() {
    if (!selected) return
    await deleteShop(selected.id)
    setSelId(null)
  }

  if (error) {
    return (
      <div className={styles.soonPanel}>
        <i className="fa-solid fa-triangle-exclamation" /><span className={styles.big}>Link Error</span><span>{error}</span>
        <span style={{ marginTop: 6 }}>
          If this says the relation doesn't exist, paste <code>supabase/migrations/0009_shop_catalog.sql</code> into the Supabase SQL editor and run it.
        </span>
      </div>
    )
  }

  return (
    <div className={styles.catLayout}>
      <div className={styles.catIndex}>
        <div className={styles.catNew}>
          <Btn tone="cyan" icon="fa-plus" label="New Shopkeeper" onClick={() => { setCreating(true); setSelId(null) }} />
        </div>
        <div className={styles.catRows}>
          {shops.map(s => (
            <div key={s.id} className={cx(styles.skRow, s.id === activeId && !creating && styles.sel)}>
              <button className={styles.skMain} onClick={() => { setCreating(false); setSelId(s.id) }}>
                <span className={styles.crIc}><Icon name={s.data?.icon ?? 'fa-shop'} /></span>
                <span className={styles.crTx}>
                  <span className={styles.crT}>{s.data?.name ?? 'Untitled'}</span>
                  {/* Whether a shop is LIVE is the one thing worth scanning this
                      list for, so it goes on its own line as a state you can
                      read at a glance — not appended to the name, and not
                      behind the location, which is flavour. */}
                  <span className={styles.crS}>
                    <span className={cx(styles.skState, s.is_open ? styles.isOpen : styles.isShut)}>
                      <span className={styles.skDot} />{s.is_open ? 'Open' : 'Closed'}
                    </span>
                    <span className={styles.op}> · </span>
                    {s.data?.stock?.length ?? 0} items
                  </span>
                </span>
              </button>
              {s.is_open ? (
                <button className={cx(styles.skUse, styles.skClose)} onClick={() => void closeShop(s.id)} title="Close this shop — players lose the takeover next time they load">
                  Close
                </button>
              ) : (
                <button className={styles.skUse} onClick={() => setOpenPopupId(s.id)} title="Open this shop for a player">
                  Use <span aria-hidden="true">▸</span>
                </button>
              )}
            </div>
          ))}
        </div>
        {shops.length === 0 && <div className={styles.catEmpty}>{loading ? '· loading ·' : '— no shopkeepers yet —'}</div>}
      </div>

      <div className={styles.catForm}>
        <ShopForm key={activeId ?? 'new'} shop={selected} itemCatalog={itemCatalog} onSubmit={handleSubmit} onDelete={selected ? handleDelete : undefined} />
      </div>

      {popupShop && (
        <OpenShopPopup
          shop={popupShop}
          members={members}
          onFire={characterId => { void openShop(popupShop.id, characterId); setOpenPopupId(null) }}
          onCloseShop={() => { void closeShop(popupShop.id); setOpenPopupId(null) }}
          onClose={() => setOpenPopupId(null)}
        />
      )}
    </div>
  )
}

function ShopForm({ shop, itemCatalog, onSubmit, onDelete }: {
  shop: ShopCatalogRow | null
  itemCatalog: CatalogItemRow[]
  onSubmit: (data: Shop) => Promise<void>
  onDelete?: () => void
}) {
  const d = shop?.data
  const [name, setName] = useState(d?.name ?? '')
  const [icon, setIcon] = useState(d?.icon ?? 'fa-shop')
  const [location, setLocation] = useState(d?.location ?? '')
  const [keeper, setKeeper] = useState(d?.keeper ?? '')
  const [hours, setHours] = useState(d?.hours ?? '')
  const [desc, setDesc] = useState(d?.desc ?? '')
  const [stock, setStock] = useState<ShopStockLine[]>(d?.stock ?? [])
  const [query, setQuery] = useState('')
  const [pickRar, setPickRar] = useState<ItemRarity | 'all'>('all')
  const [pickCat, setPickCat] = useState<ItemCategory | 'all'>('all')
  const [busy, setBusy] = useState(false)

  function updateLine(i: number, patch: Partial<ShopStockLine>) {
    setStock(prev => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  }
  function removeLine(i: number) {
    setStock(prev => prev.filter((_, idx) => idx !== i))
  }
  function addLine(it: CatalogItemRow) {
    setStock(prev => [...prev, {
      item_id: it.id, price: it.data?.value ?? 0, unit: it.data?.valueUnit ?? 'gp',
      mode: 'unlimited' as ShopStockMode, qty: 1, item: it.data,
    }])
  }

  async function submit() {
    setBusy(true)
    await onSubmit({
      name: name.trim(), icon, location: location.trim(),
      keeper: keeper.trim() || undefined, hours: hours.trim() || undefined,
      desc: desc.trim(), stock,
    })
    setBusy(false)
  }

  const inStock = new Set(stock.map(l => l.item_id))
  /* The same grammar the loot pools and every catalog index use, so
     `tag:potion !rare` narrows here too. It replaced a bespoke substring match
     over name+category+rarity, which could not express a tag OR an exclusion —
     the two things stocking a shop by description actually needs. */
  const parsed = parseCatalogQuery(query)
  const pickable = itemCatalog.filter(it => {
    if (pickRar !== 'all' && (it.data?.rarity ?? 'common') !== pickRar) return false
    if (pickCat !== 'all' && (it.data?.category ?? 'misc') !== pickCat) return false
    return matchesCatalogQuery(it.data ?? {}, parsed)
  })

  /* What "Stock All" would actually add, and why the rest are left out.
     Three exclusions, each for a different reason:
       already   — shop_buy (0009) finds a line by item_id, so two lines for one
                   item would collide. The manual picker already blocks this.
       quest     — never for sale, same rule the picker enforces per-click.
       unpriced  — `value` absent means priceless/unlisted, NOT free. Adding one
                   item at 0gp by hand is a choice; sweeping twenty in at 0gp is
                   an accident, so bulk-add refuses and says how many it skipped. */
  const bulk = useMemo(() => {
    const add: CatalogItemRow[] = []
    let skippedQuest = 0, skippedUnpriced = 0, skippedAlready = 0
    for (const it of pickable) {
      if (inStock.has(it.id)) { skippedAlready++; continue }
      if (it.data?.category === 'quest') { skippedQuest++; continue }
      if (!it.data?.value) { skippedUnpriced++; continue }
      add.push(it)
    }
    return { add, skippedQuest, skippedUnpriced, skippedAlready }
  }, [pickable, stock])

  function stockAll() {
    setStock(prev => [...prev, ...bulk.add.map(it => ({
      item_id: it.id, price: it.data?.value ?? 0, unit: it.data?.valueUnit ?? 'gp',
      mode: 'unlimited' as ShopStockMode, qty: 1, item: it.data as CatalogItemData,
    }))])
  }

  return (
    <>
      <div className={styles.catFormHead}>
        <span className={styles.cfhT}>{shop ? 'Edit Shopkeeper' : 'New Shopkeeper'}</span>
        <span className={styles.cfhId}>{shop ? shop.id : 'unsaved template'}</span>
      </div>

      <div className={styles.catPrev} style={{ ['--rar' as string]: 'var(--amber)' }}>
        <span className={styles.pvCell}>
          <Icon name={icon} />
        </span>
        <span className={styles.pvTx}>
          <span className={styles.pvName}>{name || 'Untitled Shopkeeper'}</span>
          <span className={styles.pvMeta}>
            <span>{stock.length} item{stock.length === 1 ? '' : 's'}</span>
            <span>{stock.every(l => l.mode === 'unlimited') ? 'all unlimited' : `${stock.filter(l => l.mode === 'limited').length} limited`}</span>
            {location && <span>{location}</span>}
          </span>
        </span>
      </div>

      <span className={styles.fieldLab}>Name</span>
      <input className={styles.sessIn} value={name} onChange={e => setName(e.target.value)} placeholder="Name the shopkeeper…" />

      <span className={styles.fieldLab}>Icon</span>
      <IconPicker value={icon} onPick={setIcon} />

      <span className={styles.fieldLab}>Location</span>
      <input className={styles.sessIn} value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. Brettany Market Row" />

      <div className={styles.catGrid2}>
        <div>
          <span className={styles.fieldLab}>Keeper</span>
          <input className={styles.sessIn} value={keeper} onChange={e => setKeeper(e.target.value)} placeholder="e.g. Old Maren" />
        </div>
        <div>
          <span className={styles.fieldLab}>Hours</span>
          <input className={styles.sessIn} value={hours} onChange={e => setHours(e.target.value)} placeholder="e.g. Dawn to dusk" />
        </div>
      </div>

      <div className={styles.qLabRow}>
        <span className={styles.fieldLab}>Player-Facing Prose</span>
        <span className={cx(styles.qFacing, styles.player)}><i className="fa-solid fa-eye" /> Shown when the shop opens</span>
        <ProsePreview text={desc} label="Preview" />
      </div>
      <textarea className={styles.catProse} value={desc} onChange={e => setDesc(e.target.value)}
        {...proseField(setDesc)}
        placeholder="The prose the player reads when the shop opens…" />

      <span className={styles.fieldLab}>Stock</span>
      <div className={styles.skStockRows}>
        {stock.length === 0 ? (
          <div className={styles.stockEmpty}>No stock yet — pull items from the catalog below. Each line carries its own price and stock mode.</div>
        ) : stock.map((line, i) => {
          const rar = line.item.rarity ?? 'common'
          const catalogValue = line.item.value
          const catalogUnit = line.item.valueUnit ?? 'gp'
          const overridden = catalogValue != null && (catalogValue !== line.price || catalogUnit !== (line.unit ?? 'gp'))
          return (
            <div key={line.item_id} className={styles.skStockRow} style={{ ['--rar' as string]: RAR_COLOR[rar] }}>
              <span className={styles.ssIc}><Icon name={line.item.icon ?? 'fa-box'} /></span>
              <span className={styles.ssTx}>
                <span className={styles.ssT}>{line.item.name}</span>
                <span className={styles.ssS}>
                  {CAT_LABEL[line.item.category ?? 'misc']} · <span className={styles.rar}>{rarityLabel(rar)}</span> · catalog {formatPrice(catalogValue ?? 0, catalogUnit)}
                  {overridden ? ' · overridden' : ''}
                </span>
              </span>
              <span className={cx(styles.skGold, overridden && styles.over)}>
                <input
                  className={styles.sessIn} type="number" min={0} value={line.price}
                  onChange={e => updateLine(i, { price: Math.max(0, parseInt(e.target.value || '0', 10) || 0) })}
                  aria-label={`${line.item.name} price`}
                />
                <select
                  className={styles.selIn} value={line.unit ?? 'gp'}
                  onChange={e => updateLine(i, { unit: e.target.value as PriceUnit })}
                  aria-label={`${line.item.name} price unit`}
                >
                  {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </span>
              <span className={styles.skMode}>
                <span className={cx(styles.sm, line.mode === 'unlimited' && styles.on)} onClick={() => updateLine(i, { mode: 'unlimited' })}>Unlimited</span>
                <span className={cx(styles.sm, line.mode === 'limited' && styles.on)} onClick={() => updateLine(i, { mode: 'limited', qty: line.qty || 1 })}>Limited</span>
              </span>
              {line.mode === 'limited' && (
                <span className={styles.skQty}>
                  <span className={styles.ql}>Qty</span>
                  <input
                    className={styles.sessIn} type="number" min={1} value={line.qty}
                    onChange={e => updateLine(i, { qty: Math.max(1, parseInt(e.target.value || '1', 10) || 1) })}
                    aria-label={`${line.item.name} quantity`}
                  />
                </span>
              )}
              <span className={styles.ssX} onClick={() => removeLine(i)} title="Remove from stock" role="button" aria-label={`Remove ${line.item.name} from stock`}>
                <i className="fa-solid fa-xmark" />
              </span>
            </div>
          )
        })}
      </div>

      <div className={styles.skPick}>
        <div className={styles.catFxHead}>
          <i className="fa-solid fa-box-open" /><span className={styles.t}>Add From Catalog</span><span className={styles.s}>price defaults to catalog value</span>
        </div>
        <div className={styles.searchWrap}>
          <i className="fa-solid fa-magnifying-glass" />
          <input className={styles.searchIn} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search the item catalog…" />
        </div>
        <div className={styles.skFilters}>
          <div>
            <div className={styles.fl}>Rarity</div>
            <div className={styles.acRow}>
              <span className={cx(styles.acChip, pickRar === 'all' && styles.on)} onClick={() => setPickRar('all')}>All</span>
              {RAR_ORDER.map(r => (
                <span key={r} className={cx(styles.acChip, pickRar === r && styles.on)} onClick={() => setPickRar(r)}>{rarityLabel(r)}</span>
              ))}
            </div>
          </div>
          <div>
            <div className={styles.fl}>Category</div>
            <div className={styles.acRow}>
              <span className={cx(styles.acChip, pickCat === 'all' && styles.on)} onClick={() => setPickCat('all')}>All</span>
              {PICK_CATS.map(c => (
                <span key={c} className={cx(styles.acChip, pickCat === c && styles.on)} onClick={() => setPickCat(c)}>{CAT_LABEL[c]}</span>
              ))}
            </div>
          </div>
        </div>
        {/* Stocking by description rather than by clicking twenty times. It adds
            REAL lines rather than storing the query: a stored query would have
            to re-resolve on open, which silently restocks a shop the party just
            cleared out — see docs/GUIDE_Codex_Deferred.md. Once added, each line
            is ordinary stock the DM can reprice or delete. */}
        <div className={styles.bulkRow}>
          <button type="button" className={styles.bulkBtn}
            disabled={!bulk.add.length}
            onClick={stockAll}
            title={bulk.add.length ? `Add ${bulk.add.length} item(s) to stock` : 'Nothing here to add'}>
            <i className="fa-solid fa-layer-group" />
            {bulk.add.length ? `Stock all ${bulk.add.length}` : 'Nothing to stock'}
          </button>
          <span className={styles.bulkNote}>
            {(bulk.skippedAlready || bulk.skippedQuest || bulk.skippedUnpriced) ? (
              <>skipping{' '}
                {[
                  bulk.skippedAlready && `${bulk.skippedAlready} already stocked`,
                  bulk.skippedQuest && `${bulk.skippedQuest} quest`,
                  bulk.skippedUnpriced && `${bulk.skippedUnpriced} with no value`,
                ].filter(Boolean).join(' · ')}
              </>
            ) : <>prices come from each item&rsquo;s catalog value</>}
          </span>
        </div>

        <div className={styles.skPicklist}>
          {itemCatalog.length === 0 ? (
            <div className={styles.stockEmpty}>Catalog is empty — author items in the Items tab.</div>
          ) : pickable.length === 0 ? (
            <div className={styles.stockEmpty}>No catalog items match this filter.</div>
          ) : pickable.map(it => {
            const blocked = it.data?.category === 'quest'
            const already = inStock.has(it.id)
            const rar = it.data?.rarity ?? 'common'
            return (
              <button
                key={it.id} className={cx(styles.skPi, blocked && styles.blocked, already && styles.in)}
                style={{ ['--rar' as string]: blocked ? 'var(--danger)' : RAR_COLOR[rar] }}
                disabled={blocked || already}
                onClick={() => addLine(it)}
              >
                <span className={styles.piIc}><Icon name={it.data?.icon ?? 'fa-box'} /></span>
                <span className={styles.piT}>{it.data?.name ?? 'Untitled'}</span>
                <span className={styles.piM}>{blocked ? 'Quest · excluded' : already ? 'In stock' : rarityLabel(rar)}</span>
                {!blocked && <span className={styles.piV}>{formatPrice(it.data?.value ?? 0, it.data?.valueUnit)}</span>}
              </button>
            )
          })}
        </div>
        <div className={styles.skWarn}>
          <i className="fa-solid fa-triangle-exclamation" /> Quest-tier items are excluded from shop stock — plot items stay under direct DM grant.
        </div>
      </div>

      <div className={cx(styles.qActions, styles.skActions)} style={{ marginTop: 14 }}>
        <Btn tone="amber" lg icon="fa-floppy-disk" label={busy ? 'Saving…' : shop ? 'Save Shopkeeper' : 'Create Shopkeeper'} onClick={() => void submit()} disabled={busy || !name.trim()} />
        {onDelete && <Btn tone="danger" lg icon="fa-trash" label="Delete" onClick={onDelete} disabled={busy} />}
      </div>
    </>
  )
}

function OpenShopPopup({ shop, members, onFire, onCloseShop, onClose }: {
  shop: ShopCatalogRow
  members: { id: string; name: string }[]
  onFire: (characterId: string | null) => void
  onCloseShop: () => void
  onClose: () => void
}) {
  const [target, setTarget] = useState<string>(ALL_PARTY)

  return createPortal(
    <div className={pop.imodal} role="dialog" aria-modal="true" aria-label={`Open ${shop.data?.name ?? 'shop'}`}>
      <div className={pop.imScrim} onClick={onClose} aria-hidden="true" />
      <div className={pop.imPanel}>
        <span className={pop.pnGap} />
        <span className={pop.pnLine} />
        <div className={pop.imInner}>
          <span className={`${pop.imCorner} ${pop.tl}`} />
          <span className={`${pop.imCorner} ${pop.br}`} />
          <header className={pop.imHead}>
            <span className={pop.imCrystal}><Icon name={shop.data?.icon ?? 'fa-shop'} /></span>
            <div className={pop.imTitles}>
              <span className={pop.imName}>{shop.data?.name ?? 'Shopkeeper'}</span>
              <span className={pop.imTags}>
                <span className={pop.imTag}>{shop.data?.stock?.length ?? 0} items</span>
                {shop.is_open && <span className={`${pop.imTag} ${pop.acc}`}>Live</span>}
              </span>
            </div>
            <button type="button" className={pop.imClose} onClick={onClose} aria-label="Close">
              <i className="fa-solid fa-xmark" />
            </button>
          </header>

          <div className={pop.imBody}>
            <span className={styles.fieldLab}>Fire For</span>
            <select className={styles.selIn} value={target} onChange={e => setTarget(e.target.value)}>
              <option value={ALL_PARTY}>All Party</option>
              {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <p className={pop.imDesc}>Fires the shop live — the template is unchanged. Re-firing resumes stock exactly where it was left.</p>
          </div>

          <div className={pop.imActions}>
            <button type="button" className={pop.ia} onClick={() => onFire(target === ALL_PARTY ? null : target)}>
              <span className={pop.af} />
              <span className={pop.ai}><i className="fa-solid fa-shop" />Open Shop</span>
            </button>
            {shop.is_open && (
              <button type="button" className={`${pop.ia} ${pop.drop}`} onClick={onCloseShop}>
                <span className={pop.af} />
                <span className={pop.ai}><i className="fa-solid fa-door-closed" />Close Shop</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
