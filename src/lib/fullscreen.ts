import { useCallback, useEffect, useState } from 'react'

/** Native Fullscreen API — no PWA/manifest install needed. Toggles the whole
 *  document (not a single element), so all of the app's fixed-position chrome
 *  stays in view together. */
export function useFullscreen(): { isFullscreen: boolean; toggle: () => void } {
  const [isFullscreen, setIsFullscreen] = useState(() => !!document.fullscreenElement)

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggle = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.documentElement.requestFullscreen()
  }, [])

  return { isFullscreen, toggle }
}
