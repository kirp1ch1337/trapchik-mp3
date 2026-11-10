-- Published media should be readable by active listeners while writes stay admin-only.
create policy "Active users read published music media"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'music-media'
  and (select public.is_active_user())
  and (
    exists (
      select 1
      from public.tracks as t
      where t.status = 'published'
        and storage.objects.name in (
          t.original_audio_key,
          t.stream_audio_key,
          t.video_key,
          t.artwork_key
        )
    )
    or exists (
      select 1
      from public.albums as a
      where a.status = 'published'
        and a.artwork_key = storage.objects.name
    )
  )
);
