import { useEffect, useId, useRef, useState } from 'react'
import { DEFAULT_CROP, drawImage, encodeImage, imagePath, prepareImage, type Crop, type ImageScope } from '../lib/imageFiles'
import { uploadImage } from '../lib/imageStorage'
import { ManagedImage } from './ManagedImage'
import styles from './ImageUpload.module.css'

export function ImageUpload({ value, onChange, onPendingChange, scope, characterId, aspect, disabled = false }: {
  value: string
  onChange: (value: string) => void
  onPendingChange: (pending: boolean) => void
  scope: ImageScope
  characterId?: string
  aspect?: number
  disabled?: boolean
}) {
  const id = useId()
  const canvas = useRef<HTMLCanvasElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const generation = useRef(0)
  const bitmapRef = useRef<ImageBitmap | null>(null)
  const pendingCallback = useRef(onPendingChange)
  pendingCallback.current = onPendingChange
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null)
  const [crop, setCrop] = useState<Crop>(DEFAULT_CROP)
  const [working, setWorking] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [url, setUrl] = useState(imagePath(value) === null ? value : '')
  useEffect(() => { setUrl(imagePath(value) === null ? value : '') }, [value])
  const locked = disabled || working

  useEffect(() => () => { generation.current++; bitmapRef.current?.close(); pendingCallback.current(false) }, [])
  useEffect(() => {
    if (canvas.current && bitmap) {
      try { drawImage(canvas.current, bitmap, aspect, crop, 720) }
      catch (err) { setError(err instanceof Error ? err.message : 'Preview unavailable.') }
    }
  }, [bitmap, crop, aspect])

  function discard() {
    generation.current++
    bitmapRef.current?.close()
    bitmapRef.current = null
    setBitmap(null)
    setWorking(false)
    onPendingChange(false)
    setError('')
  }
  async function choose(file?: File) {
    if (!file || locked) return
    const ticket = ++generation.current
    setWorking(true); onPendingChange(true); setError(''); setNotice('')
    try {
      const next = await prepareImage(file)
      if (ticket !== generation.current) { next.close(); return }
      bitmapRef.current?.close(); bitmapRef.current = next
      setBitmap(next); setCrop(DEFAULT_CROP)
    } catch (err) {
      if (ticket === generation.current) {
        setError(err instanceof Error ? err.message : 'Could not open image.')
        onPendingChange(!!bitmapRef.current)
      }
    } finally { if (ticket === generation.current) setWorking(false) }
  }
  async function upload() {
    if (!bitmap || locked) return
    const ticket = generation.current
    setWorking(true); setError('')
    try {
      const blob = await encodeImage(bitmap, aspect, crop)
      if (ticket !== generation.current) return
      const reference = await uploadImage(blob, scope, characterId)
      if (ticket !== generation.current) return
      onChange(reference)
      discard()
      setNotice('Image ready. Save the record to use it.')
    } catch (err) {
      if (ticket === generation.current) setError(err instanceof Error ? err.message : 'Upload failed. Try again.')
    } finally { if (ticket === generation.current) setWorking(false) }
  }
  function applyUrl() {
    try {
      const parsed = new URL(url.trim())
      if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error()
      onChange(parsed.href); setUrl(''); setError(''); setNotice('Link ready. Save the record to use it.')
    } catch { setError('Enter a complete https:// or http:// image URL.') }
  }

  return <div className={styles.field}>
    <div className={`${styles.drop} ${dragging ? styles.dragging : ''}`}
      onDragOver={e => { e.preventDefault(); if (!locked) setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); void choose(e.dataTransfer.files[0]) }}>
      {bitmap ? <canvas ref={canvas} className={styles.preview} aria-label={aspect ? 'Portrait crop preview' : 'Image preview'} role="img" />
        : value ? <ManagedImage key={value} src={value} alt="Current image" className={styles.preview} onError={() => setError('Image preview unavailable. You can replace it below.')} />
        : <span className={styles.empty}><i className="fa-regular fa-image" aria-hidden="true" />{aspect ? 'Frame a portrait' : 'Add an image'}</span>}
      <button type="button" className={styles.button} disabled={locked} onClick={() => fileInput.current?.click()}>{working ? 'Preparing image…' : bitmap || value ? 'Choose another image' : 'Choose image'}</button>
      <span className={styles.hint}>or drop a file · JPG, PNG, WebP · up to 20 MB</span>
      <input ref={fileInput} id={id} className={styles.file} type="file" accept="image/jpeg,image/png,image/webp" tabIndex={-1} aria-label="Choose image file" disabled={locked}
        onChange={e => { void choose(e.target.files?.[0]); e.target.value = '' }} />
    </div>
    {bitmap && <>
      {aspect && <div className={styles.controls}>
        {([{ key: 'zoom', label: 'Zoom', min: 1, max: 3, step: 0.01 }, { key: 'x', label: 'Horizontal position', min: 0, max: 100, step: 1 }, { key: 'y', label: 'Vertical position', min: 0, max: 100, step: 1 }] as const).map(control =>
          <label key={control.key}>{control.label}<input type="range" min={control.min} max={control.max} step={control.step} value={crop[control.key]} disabled={locked} onChange={e => setCrop({ ...crop, [control.key]: +e.target.value })} /></label>)}
      </div>}
      <div className={styles.actions}>
        <button type="button" className={`${styles.button} ${styles.primary}`} disabled={locked} onClick={() => void upload()}>{working ? 'Uploading…' : aspect ? 'Upload portrait' : 'Upload image'}</button>
        <button type="button" className={styles.button} disabled={disabled} onClick={discard}>Cancel</button>
      </div>
    </>}
    {!bitmap && !working && <div className={styles.actions}>
      {value && <button type="button" className={styles.button} disabled={disabled} onClick={() => { onChange(''); setError(''); setNotice('Image removed. Save the record to keep this change.') }}>Remove image</button>}
      <details className={styles.link}><summary>Use an image URL</summary>
        <label htmlFor={`${id}-url`}>Image URL</label>
        <input id={`${id}-url`} type="url" value={url} disabled={disabled} placeholder="https://…" onChange={e => setUrl(e.target.value)} />
        <button type="button" className={styles.button} disabled={disabled || !url.trim()} onClick={applyUrl}>Use URL</button>
      </details>
    </div>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    <p className={styles.hint} role="status">{working ? 'Keep this editor open while the image uploads.' : bitmap ? 'Check the preview, then upload or cancel before saving.' : notice}</p>
  </div>
}
