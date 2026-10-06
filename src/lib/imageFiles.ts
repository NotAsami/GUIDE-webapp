/** Stable references, never expiring signed URLs, are persisted in records. */
export const IMAGE_BUCKET = 'guide-images'
export const IMAGE_PREFIX = `storage:${IMAGE_BUCKET}/`
export const MAX_SOURCE_BYTES = 20 * 1024 * 1024
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024
export type ImageScope = 'characters' | 'npcs' | 'handouts'
export type Crop = { x: number; y: number; zoom: number }
export const DEFAULT_CROP: Crop = { x: 50, y: 50, zoom: 1 }

export function imagePath(value: string): string | null {
  return value.startsWith(IMAGE_PREFIX) ? value.slice(IMAGE_PREFIX.length) : null
}

export function validateImage(file: Pick<File, 'size' | 'type'>): string | null {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return 'Choose a JPG, PNG, or WebP image.'
  if (!file.size) return 'This file is empty. Choose another image.'
  if (file.size > MAX_SOURCE_BYTES) return 'Choose an image smaller than 20 MB.'
  return null
}

/** Source rectangle shared by the live preview and the exported canvas. */
export function cropRect(width: number, height: number, aspect: number | undefined, crop: Crop) {
  if (!(width > 0 && height > 0) || !Number.isFinite(width + height) || (aspect !== undefined && !(aspect > 0 && Number.isFinite(aspect)))) {
    throw new Error('Invalid image dimensions.')
  }
  if (!aspect) return { x: 0, y: 0, width, height }
  const zoom = Math.max(1, Math.min(3, Number.isFinite(crop.zoom) ? crop.zoom : 1))
  const w = Math.min(width, height * aspect) / zoom
  const h = w / aspect
  const clamp = (v: number) => Math.max(0, Math.min(100, Number.isFinite(v) ? v : 50)) / 100
  return { x: (width - w) * clamp(crop.x), y: (height - h) * clamp(crop.y), width: w, height: h }
}

export function outputSize(width: number, height: number, maxEdge: number) {
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export async function prepareImage(file: File): Promise<ImageBitmap> {
  const invalid = validateImage(file)
  if (invalid) throw new Error(invalid)
  let bitmap: ImageBitmap
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }) }
  catch { throw new Error('This image could not be opened. Try exporting it as a JPG or PNG.') }
  if (bitmap.width * bitmap.height > 40_000_000) {
    bitmap.close()
    throw new Error('This image is too large. Resize it to fewer than 40 megapixels.')
  }
  return bitmap
}

export function drawImage(canvas: HTMLCanvasElement, bitmap: ImageBitmap, aspect: number | undefined, crop: Crop, maxEdge: number) {
  const rect = cropRect(bitmap.width, bitmap.height, aspect, crop)
  const size = outputSize(rect.width, rect.height, maxEdge)
  canvas.width = size.width
  canvas.height = size.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Your browser could not prepare the image.')
  ctx.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height, 0, 0, size.width, size.height)
}

export async function encodeImage(bitmap: ImageBitmap, aspect: number | undefined, crop: Crop): Promise<Blob> {
  const canvas = document.createElement('canvas')
  drawImage(canvas, bitmap, aspect, crop, aspect ? 1600 : 4096)
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', 0.9))
  if (!blob || blob.size > MAX_UPLOAD_BYTES) throw new Error('The prepared image is too large. Try a smaller image.')
  return blob
}
