-- Thin membership index for TiDB-backed native leagues.
-- Ops data (rosters, claims, scores, …) lives in TiDB native_* tables.
-- Writes go through service role / server; clients may only SELECT their own rows.

CREATE TABLE IF NOT EXISTS public.native_league_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  native_league_id text NOT NULL,
  team_id bigint,
  role text NOT NULL DEFAULT 'member'
    CHECK (role IN ('commissioner', 'co_commish', 'member')),
  season_year integer NOT NULL,
  label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, native_league_id)
);

CREATE INDEX IF NOT EXISTS idx_native_league_links_user
  ON public.native_league_links (user_id);

CREATE INDEX IF NOT EXISTS idx_native_league_links_league
  ON public.native_league_links (native_league_id);

GRANT SELECT ON public.native_league_links TO authenticated;
GRANT ALL ON public.native_league_links TO service_role;

ALTER TABLE public.native_league_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own native league links" ON public.native_league_links;
CREATE POLICY "own native league links" ON public.native_league_links
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
