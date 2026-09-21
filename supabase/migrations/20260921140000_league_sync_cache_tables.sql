-- Synced-platform cache tables for live ESPN / Sleeper re-ingest.
-- These store authentic host-league activity + weekly boxscore points so
-- dashboards never linger on stale mock placeholders.

CREATE TABLE IF NOT EXISTS public.league_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id text NOT NULL,
  connection_id uuid NULL,
  platform text NOT NULL DEFAULT 'espn',
  event_id text NULL,
  event_at timestamptz NULL,
  kind text NULL,
  team_name text NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS league_transactions_league_id_idx
  ON public.league_transactions (league_id);
CREATE INDEX IF NOT EXISTS league_transactions_connection_id_idx
  ON public.league_transactions (connection_id);

CREATE TABLE IF NOT EXISTS public.weekly_matchups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id text NOT NULL,
  connection_id uuid NULL,
  platform text NOT NULL DEFAULT 'espn',
  week integer NOT NULL,
  roster_id integer NOT NULL,
  matchup_id integer NULL,
  points numeric NOT NULL DEFAULT 0,
  projected_points numeric NOT NULL DEFAULT 0,
  team_name text NULL,
  owner_name text NULL,
  starters text[] NOT NULL DEFAULT '{}',
  player_points jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (league_id, week, roster_id)
);

CREATE INDEX IF NOT EXISTS weekly_matchups_league_week_idx
  ON public.weekly_matchups (league_id, week);

ALTER TABLE public.league_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_matchups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own league_transactions" ON public.league_transactions;
CREATE POLICY "Users read own league_transactions"
  ON public.league_transactions FOR SELECT TO authenticated
  USING (
    connection_id IS NULL
    OR connection_id IN (
      SELECT id FROM public.synced_leagues WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users read own weekly_matchups" ON public.weekly_matchups;
CREATE POLICY "Users read own weekly_matchups"
  ON public.weekly_matchups FOR SELECT TO authenticated
  USING (
    connection_id IS NULL
    OR connection_id IN (
      SELECT id FROM public.synced_leagues WHERE user_id = auth.uid()
    )
  );

GRANT SELECT ON public.league_transactions TO authenticated;
GRANT SELECT ON public.weekly_matchups TO authenticated;
GRANT ALL ON public.league_transactions TO service_role;
GRANT ALL ON public.weekly_matchups TO service_role;
