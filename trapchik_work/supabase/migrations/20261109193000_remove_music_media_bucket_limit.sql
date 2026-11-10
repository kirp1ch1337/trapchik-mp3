-- Remove the per-bucket 100 MiB ceiling for published music media uploads.
-- The project's global Supabase Storage limit still applies.
update storage.buckets
set file_size_limit = null
where id = 'music-media';
