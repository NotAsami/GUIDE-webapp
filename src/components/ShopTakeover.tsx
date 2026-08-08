/**
 * The player-facing shop — a full-screen takeover that appears the instant
 * the DM fires a shop open (lib/shops.ts useOpenShop), buy-only, one item at
 * a time (docs/notes.md §SHOP FEATURE; ported from
 * "guide-hud/project/G.U.I.D.E. Shop.html").
 *
 * BUY is never an instant client-side assumption — the click goes PENDING
 * while `shop_buy` (migration 0009) does the real check, and only the reply
 * moves it to success or "Ledger Refused". On success the coin change already
 * landed server-side; this component just places the returned item snapshot
 * into inventory via the same routing chain every other pickup uses
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
import { toCopper, type Coins } from '../lib/coins'
import { buyItem, type ShopBuyResult } from '../lib/shops'
import pop from '../screens/InventoryPopup.module.css'
import styles from './ShopTakeover.module.css'

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

interface Props {
  character: CharacterRow | null
  updateSection: <K extends CharacterSection>(section: K, next: CharacterRow[K]) => Promise<void>
  /** Open/dismiss state lives in Layout now — the Bottombar's "Reopen Shop"
   *  button needs to see it too, so it can't be local to this component. */
  shop: ShopCatalogRow | null
  dismissed: boolean
  onDismiss: () => void
}

export function ShopTakeover({ character, updateSection, shop, dismissed, onDismiss }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
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

  if (!character || !shop || dismissed) return null

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

  const selectedLine = data.stock.find(l => l.item_id === selectedId) ?? null

  return createPortal(
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={data.name}>
      <div className={styles.scrim} onClick={onDismiss} aria-hidden="true" />
      <div className={styles.panel}>
        <header className={styles.head}>
          <span className={styles.portrait}><i className={`fa-solid ${data.icon || 'fa-shop'}`} /></span>
          <div className={styles.titles}>
            <span className={styles.eyebrow}>Shopkeeper</span>
            <h1 className={styles.name}>{data.name}</h1>
            {data.location && <span className={styles.loc}>{data.location}</span>}
          </div>
          <button type="button" className={styles.leave} onClick={onDismiss}>
            <i className="fa-solid fa-xmark" /> Leave Shop
          </button>
        </header>

        {data.desc && <p className={styles.desc}>{data.desc}</p>}

        <Purse coins={coins} />

        <div className={styles.stockBar}>
          <span className={styles.sh}>Stock</span>
          <span className={styles.n}>
            <span className={styles.acc}>{data.stock.filter(l => !(l.mode === 'limited' && l.qty <= 0)).length}</span> lines available <span className={styles.acc}>·</span> priced in gold
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
              const shortCp = line.price * 100 - toCopper(coins)
              const poor = !out && shortCp > 0
              const state = out ? 'Sold Out'
                : poor ? `Short ${Math.ceil(shortCp / 100)} gp`
                : line.mode === 'limited' ? (line.qty === 1 ? 'Last One' : `×${line.qty}`)
                : ''
              return (
                <button
                  key={line.item_id}
                  className={cx(styles.sc, out && styles.sold, poor && styles.poor)}
                  disabled={out}
                  aria-label={`${line.item.name}, ${line.price} gold${out ? ', sold out' : poor ? ', cannot afford' : ''}`}
                  onClick={() => setSelectedId(line.item_id)}
                >
                  <span className={cx(styles.scBody, CAT_CLASS[cat], RAR_CLASS[rar])}>
                    <span className={styles.scArt}>
                      <span className={styles.catCorner}><i className={`fa-solid ${CAT_CORNER[cat]}`} /></span>
                      <span className={styles.rarCorner}>{rarityLabel(rar)}</span>
                      <span className={styles.glyph}><i className={`fa-solid ${line.item.icon ?? 'fa-box'}`} /></span>
                    </span>
                    <span className={styles.scFoot}>
                      <span className={styles.nm}>{line.item.name}</span>
                      <span className={styles.pr}>
                        <span className={styles.coin}>GP</span>
                        <span className={styles.v}>{line.price.toLocaleString()}</span>
                        <span className={styles.u}>gp</span>
                        <span className={styles.st}>{state}</span>
                      </span>
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {selectedLine && (
        <ShopItemPopup
          line={selectedLine} shopId={shop.id} coins={coins}
          onClose={() => setSelectedId(null)}
          onBought={async res => { await place1(res); }}
        />
      )}
    </div>,
    document.body,
  )
}

function Purse({ coins }: { coins: Coins | undefined }) {
  return (
    <div className={styles.purse}>
      <div className={cx(styles.coinBadge, styles.gp)}><span className={styles.ci}>GP</span><span className={styles.cval}>{(coins?.gold ?? 0).toLocaleString()}</span></div>
      <div className={cx(styles.coinBadge, styles.sp)}><span className={styles.ci}>SP</span><span className={styles.cval}>{(coins?.silver ?? 0).toLocaleString()}</span></div>
      <div className={cx(styles.coinBadge, styles.cp)}><span className={styles.ci}>CP</span><span className={styles.cval}>{(coins?.copper ?? 0).toLocaleString()}</span></div>
    </div>
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
  const shortCp = Math.max(0, line.price * 100 - toCopper(coins))

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
    ['Price', `${line.price} gp`],
    ['On Hand', line.mode === 'limited' ? `${line.qty}` : 'Unlimited'],
    [it.category === 'weapon' ? 'Damage' : it.category === 'armor' ? 'Armor' : 'Key Stat', it.damage ?? it.damageDice ?? it.rows?.[0]?.[1] ?? '—'],
    ['Weight', it.weight != null ? `${it.weight} lb` : '—'],
    shortCp > 0 ? ['Shortfall', `${Math.ceil(shortCp / 100)} gp`] : ['After Purchase', `${Math.max(0, (coins?.gold ?? 0) * 100 + (coins?.silver ?? 0) * 10 + (coins?.copper ?? 0) - line.price * 100) / 100} gp equiv.`],
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
            <span className={pop.imCrystal}><i className={`fa-solid ${it.icon ?? 'fa-cube'}`} /></span>
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
            {it.flavor && <div className={pop.imDesc}>{it.flavor}</div>}
            {state === 'deny' && <div className={pop.imWarn}>// {reason}{shortCp > 0 && reason === 'Ledger Refused' ? ` — short ${Math.ceil(shortCp / 100)} gp` : ''}</div>}
          </div>

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
                {state === 'pending' ? 'Confirming…' : state === 'ok' ? 'Acquired' : state === 'deny' ? reason : `Buy · ${line.price} gp`}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
