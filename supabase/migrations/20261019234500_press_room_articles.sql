-- League Press Room articles: one immutable piece per league/week/kind.
-- Shared across all members of the same native or synced platform league.
-- Writes go through service-role server functions (LLM keys stay server-side).

CREATE TABLE IF NOT EXISTS public.press_room_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_key text NOT NULL,
  week integer NOT NULL CHECK (week >= 1 AND week <= 22),
  kind text NOT NULL CHECK (kind IN ('recap', 'preview', 'waiver')),
  title text NOT NULL,
  paragraphs jsonb NOT NULL,
  fact_hash text NOT NULL,
  model text NOT NULL DEFAULT 'template',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (league_key, week, kind)
);

CREATE INDEX IF NOT EXISTS idx_press_room_articles_league_week
  ON public.press_room_articles (league_key, week);

ALTER TABLE public.press_room_articles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read press room articles"
  ON public.press_room_articles;
CREATE POLICY "Authenticated users can read press room articles"
  ON public.press_room_articles
  FOR SELECT
  TO authenticated
  USING (true);

REVOKE ALL ON TABLE public.press_room_articles FROM anon;
GRANT SELECT ON TABLE public.press_room_articles TO authenticated;
GRANT ALL ON TABLE public.press_room_articles TO service_role;
