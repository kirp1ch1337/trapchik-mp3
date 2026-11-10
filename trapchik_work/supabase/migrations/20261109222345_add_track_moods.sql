ALTER TABLE public.tracks
  ADD COLUMN IF NOT EXISTS moods text[] NOT NULL DEFAULT '{}'::text[];

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tracks_moods_allowed_check'
      AND conrelid = 'public.tracks'::regclass
  ) THEN
    ALTER TABLE public.tracks
      ADD CONSTRAINT tracks_moods_allowed_check
      CHECK (moods <@ ARRAY['calm', 'joyful', 'aggressive', 'sad']::text[]);
  END IF;
END;
$$;
