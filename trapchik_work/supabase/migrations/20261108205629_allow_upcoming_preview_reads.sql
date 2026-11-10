-- Active signed-in listeners may stream only preview files attached to
-- published upcoming releases. Full track files remain covered by existing rules.
drop policy if exists "Active users read upcoming release preview audio" on storage.objects;
create policy "Active users read upcoming release preview audio"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'music-media'
  and (select public.is_active_user())
  and exists (
    select 1
    from public.upcoming_release_tracks as preview
    join public.upcoming_releases as release
      on release.id = preview.upcoming_release_id
    where release.status = 'published'
      and preview.preview_audio_key = storage.objects.name
  )
);
