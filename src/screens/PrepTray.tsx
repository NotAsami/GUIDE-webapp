/**
 * Tonight's staged cards, along the bottom of every other console screen.
 *
 * The board is where a night is planned; the tray is for playing it. Mid-session
 * the DM is on the party dashboard or someone's sheet, and walking back to the
 * board to press one button is the kind of friction that ends with the board
 * not being used at all. Same cards, same fire (lib/fireCard.ts), no navigation.
 */
import { useMemo, useState, type ReactNode } from 'react'
import type { CharacterRow, PlanCardKind, PlanCardRow } from '../lib/database.types'
import type { DmCampaignState, DmShopsState } from '../lib/dm'
import type { DmHandoutsState } from '../lib/handouts'
import type { DmNpcsState } from '../lib/npcs'
import type { DmPlansState } from '../lib/plans'
import { fireCard } from '../lib/fireCard'
import { fireLabel, split } from '../lib/prep'
import { Icon } from '../components/Icon'
import styles from './OperatorPrepBoard.module.css'
import con from './OperatorConsole.module.css'

const cx = (...xs: (string | false | undefined | null)[]) => xs.filter(Boolean).join(' ')

const KIND_ICON: Record<PlanCardKind, string> = {
  shop: 'fa-store', loot: 'fa-box-open', handout: 'fa-file-lines', npc: 'fa-user', quest: 'fa-diamond', note: 'fa-note-sticky',
}
/** Enough to reach for; the rest are one click away on the board itself. */
const SHOWN = 5

export function PrepTray({ lib, campaign, shopLib, handoutLib, npcLib, party, onRollLoot, onOpenBoard, log }: {
  lib: DmPlansState
  campaign: DmCampaignState
  shopLib: DmShopsState
  handoutLib: DmHandoutsState
  npcLib: DmNpcsState
  party: CharacterRow[]
  onRollLoot: (tableId: string) => Promise<boolean>
  onOpenBoard: () => void
  log: (node: ReactNode, kind?: 'cyan' | 'danger') => void
}) {
  const plan = lib.plans.find(p => !p.session_id) ?? null
  const cards = useMemo(() => lib.cards.filter(c => c.plan_id === plan?.id), [lib.cards, plan])
  const { staged, played } = useMemo(() => split(cards), [cards])
  const [shut, setShut] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  if (!plan || !cards.length) return null

  async function fire(c: PlanCardRow) {
    setBusy(c.id)
    const what = await fireCard(c, { party, shopLib, handoutLib, npcLib, campaign, rollLoot: onRollLoot, plans: lib })
    setBusy(null)
    if (what) log(<>{c.title || 'A card'} <span className={con.obj}>{what}</span></>, 'cyan')
  }

  if (shut) {
    return (
      <button type="button" className={styles.trayTab} onClick={() => setShut(false)}>
        Tonight · {staged.length} staged
      </button>
    )
  }

  return (
    <div className={styles.tray} aria-label="Tonight's staged cards">
      <button type="button" className={styles.trayName} onClick={onOpenBoard} title="Open the prep board">
        {plan.title || 'Tonight'}
      </button>
      <span className={styles.trayRule} />
      <div className={styles.trayCards}>
        {staged.slice(0, SHOWN).map(c => {
          const q = campaign.quests.find(x => x.id === c.ref)
          return (
            <span key={c.id} className={styles.trayCard}>
              <Icon name={KIND_ICON[c.kind]} className={styles[c.kind]} />
              <span className={styles.trayTitle}>{c.title || 'Untitled'}</span>
              <button type="button" className={styles.trayFire} onClick={() => void fire(c)} disabled={busy === c.id}>
                {busy === c.id ? '…' : fireLabel(c.kind, { questVisible: !!q?.visible })}
              </button>
            </span>
          )
        })}
        {staged.length > SHOWN && (
          <button type="button" className={styles.trayMore} onClick={onOpenBoard}>+{staged.length - SHOWN} more</button>
        )}
        {staged.length === 0 && <span className={styles.trayDone}>Everything staged has been played.</span>}
      </div>
      <span className={styles.trayCount}>
        <span className={cx(styles.acc)}>{staged.length}</span> staged <span className={styles.dot}>·</span>
        <span className={styles.good}>{played.length}</span> played
      </span>
      <button type="button" className={styles.trayShut} onClick={() => setShut(true)} aria-label="Hide the tray">
        <i className="fa-solid fa-chevron-down" aria-hidden="true" />
      </button>
    </div>
  )
}
