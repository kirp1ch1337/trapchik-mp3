ALTER TABLE public.tracks
  DROP CONSTRAINT IF EXISTS tracks_moods_allowed_check;

CREATE TABLE IF NOT EXISTS public.music_moods (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 80),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  color text NOT NULL CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS music_moods_name_lower_uidx
  ON public.music_moods (lower(name));

CREATE TABLE IF NOT EXISTS public.music_artists (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 80),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS music_artists_name_lower_uidx
  ON public.music_artists (lower(name));

ALTER TABLE public.music_moods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.music_artists ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'music_moods'
      AND policyname = 'Music moods are readable by everyone'
  ) THEN
    CREATE POLICY "Music moods are readable by everyone"
      ON public.music_moods FOR SELECT TO anon, authenticated USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'music_moods'
      AND policyname = 'Admins manage music moods'
  ) THEN
    CREATE POLICY "Admins manage music moods" ON public.music_moods
      FOR ALL TO authenticated
      USING ((SELECT public.is_admin()))
      WITH CHECK ((SELECT public.is_admin()));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'music_artists'
      AND policyname = 'Music artists are readable by everyone'
  ) THEN
    CREATE POLICY "Music artists are readable by everyone"
      ON public.music_artists FOR SELECT TO anon, authenticated USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'music_artists'
      AND policyname = 'Admins manage music artists'
  ) THEN
    CREATE POLICY "Admins manage music artists" ON public.music_artists
      FOR ALL TO authenticated
      USING ((SELECT public.is_admin()))
      WITH CHECK ((SELECT public.is_admin()));
  END IF;
END;
$$;

GRANT SELECT ON public.music_moods, public.music_artists TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.music_moods, public.music_artists TO authenticated;

INSERT INTO public.music_moods (id, name, color) VALUES
  ('calm', 'Спокойное', '#9ba2ad'),
  ('joyful', 'Радостное', '#f2c94c'),
  ('aggressive', 'Агрессивное', '#ff5555'),
  ('sad', 'Грустное', '#5da2ff')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, color = EXCLUDED.color;

INSERT INTO public.music_artists (id, name) VALUES
  ('young-brick', 'Молодой кирпич'),
  ('vlio666', 'Vlio666'),
  ('kr1mz00n', 'Kr1mz00n'),
  ('emerald', 'Emerald'),
  ('suno', 'Suno')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
