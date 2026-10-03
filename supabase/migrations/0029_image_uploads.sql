-- Private images for character portraits, NPCs, and handouts.
-- Apply after 0028. Existing external/public image URLs continue to work.
-- Stored reference: storage:guide-images/<object name>; signed URLs expire in 5 minutes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('guide-images', 'guide-images', false, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Fresh immutable names only: replacing an image creates a new object, so old
-- references and unsaved edits cannot silently overwrite someone else's image.
drop policy if exists guide_images_upload on storage.objects;
create policy guide_images_upload on storage.objects for insert to authenticated
with check (
  bucket_id = 'guide-images'
  and split_part(storage.objects.name, '/', 1) in ('characters', 'npcs', 'handouts')
  and exists (select 1 from public.dm_users where user_id = auth.uid())
);

drop policy if exists guide_images_read on storage.objects;
create policy guide_images_read on storage.objects for select to authenticated
using (
  bucket_id = 'guide-images' and (
    exists (select 1 from public.dm_users where user_id = auth.uid())
    or (
      split_part(storage.objects.name, '/', 1) = 'characters'
      and exists (
        select 1 from public.characters c where c.owner = auth.uid()
        and c.id::text = split_part(storage.objects.name, '/', 2)
        and c.identity->>'portrait' = 'storage:guide-images/' || storage.objects.name
      )
    )
    -- These subqueries use the same RLS as the records themselves. A player
    -- cannot authorize a secret NPC/handout image by editing their portrait:
    -- the character branch above only accepts that character's own namespace.
    or (split_part(storage.objects.name, '/', 1) = 'npcs' and exists (
      select 1 from public.npcs n where n.portrait = 'storage:guide-images/' || storage.objects.name
      and exists (select 1 from public.characters c where c.owner = auth.uid() and c.id = any(n.known_to))
    ))
    or (split_part(storage.objects.name, '/', 1) = 'handouts' and exists (
      select 1 from public.handouts h where h.image_url = 'storage:guide-images/' || storage.objects.name
      and exists (select 1 from public.characters c where c.owner = auth.uid() and c.id = any(h.recipients))
    ))
  )
);
-- No client UPDATE/DELETE policy. Removing/replacing a reference leaves the
-- object intact; clean up unreferenced objects separately after a grace period.
