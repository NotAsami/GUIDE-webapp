export type SaveStatus = 'saved' | 'pending' | 'saving' | 'failed'
export interface SaveSnapshot { status: SaveStatus; error: string | null }
interface Job { key: string; version: string; write: () => Promise<void> }

/** Captures the destination AND value. Switching records cannot redirect an
 * in-flight save; newer edits replace only the pending job for the same key. */
export class SaveQueue {
  private pending = new Map<string, Job>()
  private running: Promise<void> | null = null
  private saved = new Map<string, string>()
  private states = new Map<string, SaveSnapshot>()
  onChange: (() => void) | undefined

  state(key: string): SaveSnapshot { return this.states.get(key) ?? { status: 'saved', error: null } }
  baseline(key: string, version: string) { if (!this.saved.has(key)) this.saved.set(key, version) }
  enqueue(job: Job) {
    if (this.pending.get(job.key)?.version === job.version) return
    if (!this.pending.has(job.key) && this.saved.get(job.key) === job.version) return
    this.pending.set(job.key, job)
    this.set(job.key, this.state(job.key).status === 'saving' ? 'saving' : 'pending')
  }
  cancel(key: string) {
    if (this.pending.delete(key) && this.state(key).status !== 'saving') this.set(key, 'saved')
  }
  private set(key: string, status: SaveStatus, error: string | null = null) {
    this.states.set(key, { status, error }); this.onChange?.()
  }
  flush(): Promise<void> {
    if (this.running) return this.running
    this.running = this.drain().finally(() => { this.running = null })
    return this.running
  }
  private async drain(): Promise<void> {
    for (const [key, job] of this.pending) {
      this.set(key, 'saving')
      try {
        await job.write()
        this.saved.set(key, job.version)
        if (this.pending.get(key) === job) {
          this.pending.delete(key)
          this.set(key, 'saved')
        } else if (this.pending.has(key)) {
          // Drain the newer value too, after the preceding write has committed.
          this.set(key, 'pending')
          return this.drain()
        } else this.set(key, 'saved')
      } catch (error) {
        this.set(key, 'failed', error instanceof Error ? error.message : 'Save failed. Please retry.')
        // Keep the job dirty; only an explicit retry or another edit runs it.
        continue
      }
    }
  }
}
