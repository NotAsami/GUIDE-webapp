import { supabase } from './supabase'
import { IMAGE_BUCKET, IMAGE_PREFIX, type ImageScope } from './imageFiles'

export async function uploadImage(blob: Blob, scope: ImageScope, characterId?: string): Promise<string> {
  if (scope === 'characters' && !characterId) throw new Error('Choose a character before uploading a portrait.')
  // Distinct namespaces prevent a player granting themselves an unrevealed
  // NPC/handout image by copying its reference into their editable portrait.
  const folder = scope === 'characters' ? `${scope}/${characterId}` : scope
  const extension = blob.type === 'image/png' ? 'png' : 'webp'
  const path = `${folder}/${crypto.randomUUID()}.${extension}`
  const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(path, blob, {
    contentType: blob.type, cacheControl: '300', upsert: false,
  })
  if (error) throw new Error('Upload failed. Check your connection and that image uploads are enabled, then retry.')
  return IMAGE_PREFIX + path
}

export async function signImage(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(IMAGE_BUCKET).createSignedUrl(path, 300)
  if (error || !data?.signedUrl) throw new Error('Image unavailable.')
  return data.signedUrl
}
