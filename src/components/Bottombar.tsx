import { useEffect, useState } from 'react'
import styles from './Layout.module.css'

/** Telemetry strip ported from Codex.html lines 1203–1224. All values are
 *  cosmetic for now (no character data feeds them in Phase 0); the save
 *  counter ticks once per second to match the mockup's "live" feel. */
export function Bottombar() {
  const [tick, setTick] = useState(14)

  useEffect(() => {
    const id = setInterval(() => setTick(t => (t + 1) % 60), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <footer className={styles.bottombar} role="contentinfo">
      <div className={styles.bbLine}>
        <span className={styles.bbDot} />
        <span className="lab">Neural Link:</span><span className="val">Stable</span>
        <span className="sep">|</span>
        <span className="lab">Shard Integrity:</span><span className="val">98.2%</span>
        <span className="sep">|</span>
        <span className="lab">Last Sync:</span><span className="val">0.07 ms</span>
        <span className="sep">|</span>
        <span className="lab">Castella-08:</span><span className="dim">Clear · Wind NNW 4kt</span>
        <span className="sep">|</span>
        <span className="lab">Tide:</span><span className="dim">Low @ 03:47</span>

        <div className={styles.bbRight}>
          <span className="lab">Codex</span><span className="val">v 2.4.7</span>
          <span className="sep">|</span>
          <span className={styles.bbDot} /><span className="val">DM Online</span>
          <span className="sep">|</span>
          <span className="lab">Save · 00:{tick.toString().padStart(2, '0')}</span>
        </div>
      </div>
    </footer>
  )
}
