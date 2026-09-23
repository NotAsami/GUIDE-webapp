import type { AutoPublishState } from '../lib/autopublish'

export function AutoSaveStatus({ state, savedLabel = 'Saved', blocked }: {
  state: AutoPublishState; savedLabel?: string; blocked?: string
}) {
  return <span role="status" aria-live="polite">
    {state.error ? <>{state.error} <button type="button" onClick={state.retry}>Retry save</button></>
      : state.busy ? '● Saving…'
        : blocked ? `● ${blocked}`
          : state.status === 'pending' ? '● Unsaved changes…' : `● ${savedLabel}`}
  </span>
}
