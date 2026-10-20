-- Featured player for article hero overlay (stock bg URL + player chip).
ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS featured_player_id text,
  ADD COLUMN IF NOT EXISTS featured_player_name text,
  ADD COLUMN IF NOT EXISTS featured_player_pos text,
  ADD COLUMN IF NOT EXISTS featured_player_team text;

COMMENT ON COLUMN public.articles.featured_player_id IS
  'Optional Sleeper player id shown overlapping the header stock image.';
