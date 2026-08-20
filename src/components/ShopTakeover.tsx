/**
 * The player-facing shop — a full-screen takeover that appears the instant
 * the DM fires a shop open (lib/shops.ts useOpenShop), buy-only, one item at
 * a time (docs/notes.md §SHOP FEATURE; ported pixel-for-pixel from
 * "guide-hud/project/G.U.I.D.E. Shop.html" — docs/notes.md: "Replicate the
 * design of the shop exactly like in the design").
 *
 * BUY is never an instant client-side assumption — the click goes PENDING
 * while `shop_buy` (migration 0009/0012) does the real check, and only the
 * reply moves it to success or "Ledger Refused". On success the coin change
 * already landed server-side; this component just places the returned item
 * snapshot into inventory via the same routing chain every other pickup uses
 * (lib/placement.ts) and lets character.ts's own realtime refetch reconcile
 * the purse.
 *
 * Mounted once in Layout next to SystemToasts — no route, no nav entry. It
 * exists only while the DM has a shop open, and "Leave Shop" is a purely
 * local dismissal (players have no write policy on shop_catalog); re-firing
 * from the console brings it back.
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CharacterRow, CharacterSection, InventoryItem, ShopCatalogRow, ShopStockLine } from '../lib/database.types'
import { getGear, getInventory } from '../lib/equip'
import { PERSON, isStackable, placeNew, routeItem } from '../lib/placement'
import { CAT_CORNER, CAT_LABEL, rarityLabel } from '../lib/items'
import { summarizeEffects } from '../lib/effects'
import { formatPrice, priceCp, toCopper, type Coins } from '../lib/coins'
import { buyItem, type ShopBuyResult } from '../lib/shops'
import pop from '../screens/InventoryPopup.module.css'
import styles from './ShopTakeover.module.css'
import { Icon } from './Icon'
import { renderInline } from '../lib/markdown'

const cx = (...xs: (string | false | undefined)[]) => xs.filter(Boolean).join(' ')

/** category tint / rarity border classes — ported verbatim from the mock's
 *  `.cat-*`/`.rar-*` (see ShopTakeover.module.css's STOCK section header). */
const CAT_CLASS: Record<string, string> = {
  weapon: styles.catWeapon, ammo: styles.catAmmo, armor: styles.catArmor, consumable: styles.catConsumable,
  quest: styles.catQuest, tool: styles.catTool, misc: styles.catMisc,
}
const RAR_CLASS: Record<string, string> = {
  common: styles.rarCommon, uncommon: styles.rarUncommon, rare: styles.rarRare, legendary: styles.rarLegendary,
}

const DENY_LABEL: Record<string, string> = {
  sold_out: 'Sold Out',
  insufficient: 'Ledger Refused',
  closed: 'Shop Closed',
  gone: 'No Longer Stocked',
  blocked: 'Not For Sale',
  no_character: 'Ledger Refused',
}

/** "ring1" -> "Ring 1", "helmet" -> "Helmet". Only 8 values (ItemSlot) — not
 *  worth a shared label map (OperatorConsole.tsx and Equipment.tsx each keep
 *  their own local one too, for the same reason: a per-screen map beats a
 *  cross-screen import here). */
function slotLabel(s: string): string {
  return s.replace(/(\d)$/, ' $1').replace(/^./, c => c.toUpperCase())
}

interface Props {
  character: CharacterRow | null
  updateSection: <K extends CharacterSection>(section: K, next: CharacterRow[K]) => Promise<void>
  /** Open/dismiss state lives in Layout now — the Bottombar's "Reopen Shop"
   *  button needs to see it too, so it can't be local to this component. */
  shop: ShopCatalogRow | null
  dismissed: boolean
  onDismiss: () => void
}

type Toast = { name: string; cost: string } | null

export function ShopTakeover({ character, updateSection, shop, dismissed, onDismiss }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [boughtId, setBoughtId] = useState<string | null>(null)
  const [toast, setToast] = useState<Toast>(null)
  // Tracks whether the LAST render saw a visible shop, so the effect below can
  // tell "a fresh opening arrived" apart from "the same opening changed" (a
  // stock purchase updates the row without closing and re-firing it) — only
  // resets the item-popup selection here; Layout owns the same trick for
  // `dismissed` itself.
  const wasVisibleRef = useRef(false)

  useEffect(() => {
    if (shop && !wasVisibleRef.current) setSelectedId(null)
    wasVisibleRef.current = !!shop
  }, [shop])

  const visible = !!(character && shop && !dismissed)

  // Leave anytime — ESC closes the item popup first if one's open, otherwise
  // the whole takeover (mirrors Equipment.tsx's layered-modal Escape pattern).
  useEffect(() => {
    if (!visible) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (selectedId) setSelectedId(null)
      else onDismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, selectedId, onDismiss])

  if (!visible || !character || !shop) return null

  const data = shop.data
  const gear = getGear(character)
  const inventory = getInventory(character)
  const coins = character.sheet?.coins

  async function place1(res: Extract<ShopBuyResult, { ok: true }>) {
    const inst = `inst-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`
    const fresh = {
      ...res.item, id: inst, item_id: res.item_id, containerId: PERSON,
      ...(isStackable(res.item.category) ? { qty: 1 } : {}),
    } as InventoryItem
    const next = placeNew(inventory, fresh, routeItem(fresh, gear, inventory))
    await updateSection('inventory', next as unknown as CharacterRow['inventory'])
  }

  function celebrate(line: ShopStockLine) {
    setBoughtId(line.item_id)
    window.setTimeout(() => setBoughtId(null), 900)
    setToast({ name: line.item.name, cost: `− ${formatPrice(line.price, line.unit)}` })
    window.setTimeout(() => setToast(null), 2600)
  }

  const selectedLine = data.stock.find(l => l.item_id === selectedId) ?? null
  const live = data.stock.filter(l => !(l.mode === 'limited' && l.qty <= 0))
  const affordable = live.filter(l => toCopper(coins) >= priceCp(l.price, l.unit)).length

  return createPortal(
    <>
      <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={data.name}>
        <div className={styles.scrim} onClick={onDismiss} aria-hidden="true" />
        <div className={styles.panel}>
          <span className={styles.pnGap} />
          <span className={styles.pnLine} />
          <div className={styles.pnInner}>
            <span className={cx(styles.pnCorner, styles.tl)} />
            <span className={cx(styles.pnCorner, styles.br)} />

            {/* ============ STOREFRONT — authored by the DM ============ */}
            <header className={styles.sfHead}>
              <span className={styles.portrait}><Icon name={data.icon || 'fa-shop'} /></span>
              <div className={styles.titles}>
                <span className={styles.eyebrow}><span className={styles.tick} />Merchant Channel Open</span>
                <h1 className={styles.name}>{data.name}</h1>
                <div className={styles.chips}>
                  {data.location && <span className={cx(styles.chip, styles.acc)}><i className="fa-solid fa-location-dot" />{data.location}</span>}
                  {data.keeper && <span className={styles.chip}><i className="fa-solid fa-user" />{data.keeper}</span>}
                  {data.hours && <span className={styles.chip}><i className="fa-solid fa-hourglass-half" />{data.hours}</span>}
                </div>
              </div>
              <button type="button" className={styles.leave} onClick={onDismiss} aria-label="Leave the shop">
                <span className={styles.leaveFrame} />
                <span className={styles.leaveInner}><i className="fa-solid fa-arrow-left-long" /> Leave Shop</span>
              </button>
              {data.desc && <p className={styles.desc}>{renderInline(data.desc)}</p>}
            </header>

            {/* ============ PURSE — mirrors Inventory's COIN PURSE ============ */}
            <div className={styles.purse}>
              <div className={styles.purseLead}>
                <div className={styles.subHead}>Coin Purse</div>
                <div className={styles.goldReadout}>
                  <span className={styles.cur}>{(coins?.gold ?? 0).toLocaleString()}</span>
                  <span className={styles.unit}>gp on hand</span>
                </div>
              </div>
              <div className={styles.coinRow}>
                <div className={cx(styles.coinBadge, styles.gp)}><span className={styles.ci}>GP</span><span className={styles.cval}>{(coins?.gold ?? 0).toLocaleString()}</span><span className={styles.clab}>Gold</span></div>
                <div className={cx(styles.coinBadge, styles.sp)}><span className={styles.ci}>SP</span><span className={styles.cval}>{(coins?.silver ?? 0).toLocaleString()}</span><span className={styles.clab}>Silv</span></div>
                <div className={cx(styles.coinBadge, styles.cp)}><span className={styles.ci}>CP</span><span className={styles.cval}>{(coins?.copper ?? 0).toLocaleString()}</span><span className={styles.clab}>Copp</span></div>
              </div>
              {/* lib/coins.ts has always converted at 1gp = 10sp = 100cp; the
                  screen just never said so, which made a price in silver
                  guesswork against a purse displayed in gold. */}
              <div className={styles.rateNote}>
                <i className="fa-solid fa-right-left" />
                <span><b>1</b> gp = <b>10</b> sp</span>
                <span className={styles.rSep}>·</span>
                <span><b>1</b> sp = <b>10</b> cp</span>
              </div>
              <div className={styles.purseNote}>
                <span><span className={styles.k}>Ledger</span> · <span className={styles.acc}>Live — server confirms every purchase</span></span>
                <span><span className={styles.k}>Affordable</span> · <span className={styles.acc}>{affordable} of {live.length} in stock</span></span>
              </div>
            </div>

            {/* ============ STOCK ============ */}
            <section className={styles.stock} aria-label="Stock">
              <div className={styles.stockBar}>
                <span className={styles.sh}>Stock</span>
                <span className={styles.n}>
                  <span className={styles.acc}>{live.length}</span> lines available
                </span>
                <span className={styles.legend}>
                  <span><span className={styles.sw} />Affordable</span>
                  <span><span className={cx(styles.sw, styles.dim)} />Out of reach</span>
                </span>
              </div>
              <div className={styles.stockScroll}>
                <div className={styles.stockGrid}>
                  {data.stock.length === 0 && <div className={styles.stockEmpty}>Nothing on the shelf.</div>}
                  {data.stock.map(line => {
                    const rar = line.item.rarity ?? 'common'
                    const cat = line.item.category ?? 'misc'
                    const out = line.mode === 'limited' && line.qty <= 0
                    const shortCp = priceCp(line.price, line.unit) - toCopper(coins)
                    const poor = !out && shortCp > 0
                    const state = out ? 'Sold Out'
                      : poor ? `Short ${Math.ceil(shortCp / 100)} gp`
                      : line.mode === 'limited' ? (line.qty === 1 ? 'Last One' : `×${line.qty}`)
                      : ''
                    return (
                      <button
                        key={line.item_id}
                        className={cx(styles.sc, out && styles.sold, poor && styles.poor, boughtId === line.item_id && styles.bought)}
                        disabled={out}
                        aria-label={`${line.item.name}, ${formatPrice(line.price, line.unit)}${out ? ', sold out' : poor ? ', cannot afford' : ''}`}
                        onClick={() => setSelectedId(line.item_id)}
                      >
                        <span className={cx(styles.scBody, CAT_CLASS[cat], RAR_CLASS[rar])}>
                          <span className={styles.scArt}>
                            <span className={styles.catCorner}><i className={`fa-solid ${CAT_CORNER[cat]}`} /></span>
                            <span className={styles.rarCorner}>{rarityLabel(rar)}</span>
                            <span className={styles.glyph}><Icon name={line.item.icon ?? 'fa-box'} /></span>
                          </span>
                          <span className={styles.scFoot}>
                            <span className={styles.nm}>{line.item.name}</span>
                            <span className={styles.pr}>
                              <span className={cx(styles.coin, styles[line.unit ?? 'gp'])}>{(line.unit ?? 'gp').toUpperCase()}</span>
                              <span className={styles.v}>{line.price.toLocaleString()}</span>
                              <span className={styles.u}>{line.unit ?? 'gp'}</span>
                              <span className={styles.st}>{state}</span>
                            </span>
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </section>

            <footer className={styles.pnFoot}>
              <span className={styles.footDot} /><span className={styles.footLab}>Channel:</span><span className={styles.footAcc}>Merchant · DM-gated</span>
              <span className={styles.footSep}>|</span>
              <div className={styles.footRight}>
                <span className={styles.footLab}>Leave anytime</span><span className={styles.kbd}>ESC</span>
              </div>
            </footer>
          </div>
        </div>
      </div>

      {selectedLine && (
        <ShopItemPopup
          line={selectedLine} shopId={shop.id} coins={coins}
          onClose={() => setSelectedId(null)}
          onBought={async res => { await place1(res); celebrate(selectedLine) }}
        />
      )}

      <div className={cx(styles.toast, !!toast && styles.show)} role="status" aria-live="polite">
        <span className={styles.toastFrame} />
        <span className={styles.toastInner}>
          <i className="fa-solid fa-circle-check" />
          {toast && <>Purchased <span className={styles.nm}>{toast.name}</span> <span className={styles.cost}>{toast.cost}</span></>}
        </span>
      </div>
    </>,
    document.body,
  )
}

type BuyState = 'idle' | 'pending' | 'ok' | 'deny'

function ShopItemPopup({ line, shopId, coins, onClose, onBought }: {
  line: ShopStockLine
  shopId: string
  coins: Coins | undefined
  onClose: () => void
  onBought: (res: Extract<ShopBuyResult, { ok: true }>) => Promise<void>
}) {
  const [state, setState] = useState<BuyState>('idle')
  const [reason, setReason] = useState('')
  const it = line.item
  const soldOut = line.mode === 'limited' && line.qty <= 0
  const shortCp = Math.max(0, priceCp(line.price, line.unit) - toCopper(coins))
  const effectRows = it.effects ? summarizeEffects(it.effects).split(', ') : []

  async function buy() {
    setState('pending')
    const res = await buyItem(shopId, line.item_id)
    if (!res.ok) {
      setState('deny')
      setReason(DENY_LABEL[res.reason] ?? 'Ledger Refused')
      window.setTimeout(() => setState('idle'), 2400)
      return
    }
    setState('ok')
    await onBought(res)
    window.setTimeout(onClose, 1000)
  }

  const facts: [string, string][] = [
    ['Price', formatPrice(line.price, line.unit)],
    ['On Hand', line.mode === 'limited' ? `${line.qty}` : 'Unlimited'],
    [it.category === 'weapon' ? 'Damage' : it.category === 'armor' ? 'Armor' : 'Key Stat', it.damage ?? it.damageDice ?? it.rows?.[0]?.[1] ?? '—'],
    ['Weight', it.weight != null ? `${it.weight} lb` : '—'],
    ...(it.slot ? [['Slot', slotLabel(it.slot)] as [string, string]] : []),
    shortCp > 0 ? ['Shortfall', `${Math.ceil(shortCp / 100)} gp`] : ['After Purchase', `${Math.max(0, toCopper(coins) - priceCp(line.price, line.unit)) / 100} gp equiv.`],
  ]

  return createPortal(
    // Both this popup and the shop takeover are separately portaled straight
    // to document.body, so DOM order doesn't decide stacking — z-index does.
    // pop.imodal (InventoryPopup's shared modal chrome) is z-index:300, but
    // ShopTakeover's own .overlay is 400, so without this override the buy
    // confirmation renders BEHIND the shop screen it's supposed to sit on.
    <div className={pop.imodal} style={{ zIndex: 410 }} role="dialog" aria-modal="true" aria-label={it.name}>
      <div className={pop.imScrim} onClick={state === 'pending' ? undefined : onClose} aria-hidden="true" />
      <div className={pop.imPanel} data-rar={it.rarity ?? 'common'}>
        <span className={pop.pnGap} />
        <span className={pop.pnLine} />
        <div className={pop.imInner}>
          <span className={`${pop.imCorner} ${pop.tl}`} />
          <span className={`${pop.imCorner} ${pop.br}`} />

          <header className={pop.imHead}>
            <span className={pop.imCrystal}><Icon name={it.icon ?? 'fa-cube'} /></span>
            <div className={pop.imTitles}>
              <span className={pop.imName}>{it.name}</span>
              <span className={pop.imTags}>
                <span className={pop.imTag}>{CAT_LABEL[it.category ?? 'misc']}</span>
                <span className={`${pop.imTag}${(it.rarity ?? 'common') !== 'common' ? ' ' + pop.acc : ''}`}>{rarityLabel(it.rarity ?? 'common')}</span>
              </span>
            </div>
            <button type="button" className={pop.imClose} onClick={onClose} aria-label="Close" disabled={state === 'pending'}>
              <i className="fa-solid fa-xmark" />
            </button>
          </header>

          <div className={pop.imBody}>
            <div className={pop.imFacts}>
              {facts.map(([k, v]) => (
                <div key={k} className={pop.f}><span className={pop.k}>{k}</span><span className={pop.v}>{v}</span></div>
              ))}
            </div>
            {it.flavor && <div className={pop.imDesc}>{renderInline(it.flavor)}</div>}
            {effectRows.length > 0 && (
              <div className={pop.imSec}>
                <div className={pop.imSecH}>Granted Effects</div>
                <div className={pop.imFx}>
                  {effectRows.map((row, i) => (
                    <div key={i} className={pop.row}><span>{row}</span></div>
                  ))}
                </div>
              </div>
            )}
            {state === 'deny' && <div className={pop.imWarn}>// {reason}{shortCp > 0 && reason === 'Ledger Refused' ? ` — short ${Math.ceil(shortCp / 100)} gp` : ''}</div>}
          </div>

          <div className={pop.imNote}><span className={pop.acc}>Ledger</span> confirms server-side — the button holds until it replies.</div>

          <div className={pop.imActions}>
            <button
              type="button"
              className={cx(pop.ia, state === 'deny' && pop.drop)}
              onClick={() => void buy()}
              disabled={soldOut || state === 'pending' || state === 'ok'}
            >
              <span className={pop.af} />
              <span className={pop.ai}>
                <i className={`fa-solid ${state === 'pending' ? 'fa-spinner fa-spin' : state === 'ok' ? 'fa-check' : state === 'deny' ? 'fa-ban' : 'fa-coins'}`} />
                {state === 'pending' ? 'Confirming…' : state === 'ok' ? 'Acquired' : state === 'deny' ? reason : `Buy · ${formatPrice(line.price, line.unit)}`}
              </span>
            </button>
            <button type="button" className={`${pop.ia} ${pop.ghost}`} onClick={onClose} disabled={state === 'pending'}>
              <span className={pop.af} />
              <span className={pop.ai}><i className="fa-solid fa-arrow-left-long" />Back To Stock</span>
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
