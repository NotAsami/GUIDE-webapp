/**
 * The pre-roll offer — everything you could still turn on, before the dice.
 *
 * WHY IT EXISTS. Arming and holding a stance are PRE-roll decisions, and the
 * roll panel is by definition after the roll. §16 put a dashed chip on the
 * weapon card for the armable half, which is better than nothing and still made
 * the player guess: a name, no text, and no word on whether pressing it spends
 * a use or sets something they hold. The stance half had no surface at all —
 * `armableFor` matched armed mods only, so the only way to attack recklessly
 * was the Features screen, a toggle, and a walk back to the weapon.
 *
 * The engine has a harder version of the same rule: an ask-gated `adv`/`dis`/
 * `crit` is an authoring ERROR (graph.ts), because a flag cannot be decided
 * after the dice land. Every such decision needs somewhere legitimate to be
 * answered, and this is it.
 *
 * TWO KINDS, NEVER BLENDED. An `arm` mints a pending contribution and is spent
 * when it lands; a `stance` flips a variable the player HOLDS. "Armed for your
 * next attack" and "held until your next turn" are different promises, so they
 * are different colours and say so in words.
 *
 * It is a step, not a gate: rolling with nothing selected is one press, and the
 * whole sheet is skipped when there is nothing to offer.
 */
import { useState } from 'react'
import { createPortal } from 'react-dom'
import type { Feature } from '../lib/database.types'
import type { ExprScope } from '../lib/expr'
import { usesOf } from '../lib/featureView'
import { Prose } from '../lib/markdown'
import styles from './PrimeSheet.module.css'
import { Icon } from './Icon'

export type Offer = { feature: Feature; source: string; kind: 'arm' | 'stance' }

/** COLLAPSED: the one-liner. A feature's full rules text runs to a paragraph or
 *  three, and a list of those is a wall nobody reads before a swing. */
const blurb = (f: Feature) => f.light_description || ''

/** EXPANDED: the whole rule, because committing a use is when you actually want
 *  it. Falls back to the summary when there is no deeper text, so opening a
 *  feature never lands on an empty panel with a button under it. */
const detail = (f: Feature) => f.deep_description || f.light_description || ''

/** `scope` because a use count can be a formula — printing `f.uses.max` raw put
 *  `[0,2,2,3,…][level]` in front of the player on every feature that scales. */
const usesLabel = (f: Feature, scope: ExprScope) => {
  const u = usesOf(f, scope)
  return u ? `${u.current} / ${u.max} uses` : (f.usage || 'At will')
}

export function PrimeSheet({ title, subtitle, icon, offers, scope, onUse, onRoll, onCancel }: {
  /** What is about to be rolled — the weapon, the spell, the check. */
  title: string
  subtitle?: string
  icon?: string
  offers: Offer[]
  /** The character's variable scope, so a formula use count resolves to a number
   *  before it is printed. */
  scope: ExprScope
  /** Confirming an offer IS pressing Use on the feature — same spend, same
   *  writes. One definition of an activation, so a use spent here spends exactly
   *  what it spends on the Features screen. */
  onUse: (f: Feature) => void
  onRoll: () => void
  onCancel: () => void
}) {
  return createPortal(
    <div className={styles.overlay} onClick={onCancel} role="dialog" aria-modal="true" aria-label={`Before you roll — ${title}`}>
      <div className={styles.card} onClick={e => e.stopPropagation()}>
        <span className={styles.frame} aria-hidden="true" />
        <div className={styles.inner}>
          <div className={styles.band}>
            <i className="fa-solid fa-diamond" />
            Before you roll
            <span className={styles.n}>Nothing spent yet</span>
          </div>

          <div className={styles.subj}>
            <span className={styles.glyph}><Icon name={icon ?? 'fa-dice-d20'} /></span>
            <div>
              <div className={styles.name}>{title}</div>
              {subtitle && <div className={styles.flavor}>{subtitle}</div>}
            </div>
          </div>

          <div className={styles.head}>
            <i className="fa-solid fa-diamond" />
            Your call
            <span className={styles.sep} />
            <span>{offers.length}</span>
          </div>

          {offers.length === 0
            ? <div className={styles.none}>Nothing left to turn on</div>
            : (
              <div className={styles.list}>
                {offers.map(o => <OfferRow key={o.source} offer={o} scope={scope} onUse={onUse} />)}
              </div>
            )}

          <div className={styles.foot}>
            <div className={styles.sum}>
              <i className="fa-solid fa-circle-info" />
              <span>{offers.length
                ? 'Open one to read it in full and commit — nothing is spent until you do'
                : 'Everything that applies is already on'}</span>
            </div>
            <div className={styles.actions}>
              <button type="button" className={styles.cancel} onClick={onCancel}>Cancel</button>
              <button type="button" className={styles.roll} onClick={onRoll}>
                <span className={styles.bFrame} />
                <span className={styles.bIn}><i className="fa-solid fa-dice-d20" />Roll</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** One offer, in two states.
 *
 *  CLOSED it is the summary — a list of full rules text is a wall nobody reads
 *  before a swing. OPEN it is the whole rule with a Confirm under it, because
 *  the moment you are about to spend a use is exactly when you want to read what
 *  you are buying. The commit lives HERE rather than in a second dialog on top:
 *  a confirm that only restates the press is a press. */
function OfferRow({ offer, scope, onUse }: { offer: Offer; scope: ExprScope; onUse: (f: Feature) => void }) {
  const [open, setOpen] = useState(false)
  const f = offer.feature
  const text = open ? detail(f) : blurb(f)
  return (
    <div className={`${styles.offer} ${open ? styles.oOpen : ''}`}>
      <button
        type="button" className={styles.oTop} onClick={() => setOpen(v => !v)}
        aria-expanded={open}
      >
        <div className={styles.oHead}>
          <span className={styles.oName}>{f.name}</span>
          {offer.kind === 'stance'
            ? <span className={`${styles.tag} ${styles.stance}`}><i className="fa-solid fa-angles-up" />Stance</span>
            : <span className={`${styles.tag} ${styles.arm}`}><i className="fa-solid fa-bolt" />Arms</span>}
          <span className={styles.oCost}>{usesLabel(f, scope)}</span>
          <span className={styles.oFold}><i className="fa-solid fa-chevron-down" /></span>
        </div>
        {text && <Prose text={text} className={styles.what} />}
        <div className={styles.life}>
          <i className="fa-solid fa-diamond" />
          {offer.kind === 'stance' ? 'Held until something clears it' : 'Armed for this roll'}
        </div>
      </button>

      {open && (
        <div className={styles.oCommit}>
          <button type="button" className={styles.use} onClick={() => onUse(f)}>
            <span className={styles.bFrame} />
            <span className={styles.bIn}><i className="fa-solid fa-bolt" />Use {f.name}</span>
          </button>
        </div>
      )}
    </div>
  )
}
