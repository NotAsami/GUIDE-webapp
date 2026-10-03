import { useEffect, useRef, useState, type ImgHTMLAttributes } from 'react'
import { imagePath } from '../lib/imageFiles'
import { signImage } from '../lib/imageStorage'

/** Legacy URLs pass through; private references are signed under the viewer's RLS. */
export function ManagedImage({ src, onError, ...props }: Omit<ImgHTMLAttributes<HTMLImageElement>, 'onError'> & { onError?: () => void }) {
  const [resolved, setResolved] = useState<{ source: string; url: string } | null>(null)
  const [failedSource, setFailedSource] = useState<string | undefined>()
  const errorHandler = useRef(onError)
  errorHandler.current = onError
  const path = src ? imagePath(src) : null
  useEffect(() => {
    if (!src || path === null) return
    let active = true
    const refresh = async () => {
      try {
        const url = await signImage(path)
        if (active) { setResolved({ source: src, url }); setFailedSource(undefined) }
      } catch {
        if (active) { setResolved(null); errorHandler.current?.() }
      }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 240_000)
    // Background tabs can sleep past expiry.
    const wake = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', wake)
    return () => { active = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', wake) }
  }, [src, path])
  const url = path === null ? src : resolved && resolved.source === src ? resolved.url : undefined
  return url && failedSource !== src ? <img {...props} src={url} onError={() => { setFailedSource(src); onError?.() }} /> : null
}
