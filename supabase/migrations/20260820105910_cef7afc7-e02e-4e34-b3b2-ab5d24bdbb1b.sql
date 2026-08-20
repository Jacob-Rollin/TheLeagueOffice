-- Roles infrastructure
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin','moderator','user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own roles" ON public.user_roles;
CREATE POLICY "Users can view their own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- Hall of Fame tables
CREATE TABLE public.hof_championships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year integer NOT NULL,
  fantasy_team_name text NOT NULL,
  manager_name text NOT NULL,
  wins_losses text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.hof_player_week_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year integer NOT NULL,
  player_name text NOT NULL,
  week text,
  points numeric,
  fantasy_team_name text,
  manager_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.hof_team_week_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year integer NOT NULL,
  week text,
  points numeric,
  fantasy_team_name text,
  manager_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.hof_team_season_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year integer NOT NULL,
  points numeric,
  fantasy_team_name text,
  manager_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.hof_championships, public.hof_player_week_records, public.hof_team_week_records, public.hof_team_season_records TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hof_championships, public.hof_player_week_records, public.hof_team_week_records, public.hof_team_season_records TO authenticated;
GRANT ALL ON public.hof_championships, public.hof_player_week_records, public.hof_team_week_records, public.hof_team_season_records TO service_role;

ALTER TABLE public.hof_championships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hof_player_week_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hof_team_week_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hof_team_season_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read championships" ON public.hof_championships FOR SELECT USING (true);
CREATE POLICY "Admins manage championships" ON public.hof_championships FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY "Public can read player week records" ON public.hof_player_week_records FOR SELECT USING (true);
CREATE POLICY "Admins manage player week records" ON public.hof_player_week_records FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY "Public can read team week records" ON public.hof_team_week_records FOR SELECT USING (true);
CREATE POLICY "Admins manage team week records" ON public.hof_team_week_records FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY "Public can read team season records" ON public.hof_team_season_records FOR SELECT USING (true);
CREATE POLICY "Admins manage team season records" ON public.hof_team_season_records FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));