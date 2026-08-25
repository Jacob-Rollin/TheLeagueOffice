CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
begin
  insert into public.profiles (id, email, full_name, role, is_verified)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    'user',
    false
  );
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.is_league_member(_league_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.league_members WHERE league_id = _league_id AND user_id = _user_id)
$$;

GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
CREATE POLICY "Users can view their own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

GRANT SELECT ON public.leagues TO authenticated;
GRANT ALL ON public.leagues TO service_role;
CREATE POLICY "Members can view their leagues" ON public.leagues FOR SELECT TO authenticated USING (public.is_league_member(id, auth.uid()));

GRANT SELECT ON public.league_members TO authenticated;
GRANT ALL ON public.league_members TO service_role;
CREATE POLICY "Members can view co-members" ON public.league_members FOR SELECT TO authenticated USING (public.is_league_member(league_id, auth.uid()));

GRANT SELECT ON public.league_schedules TO authenticated;
GRANT ALL ON public.league_schedules TO service_role;
CREATE POLICY "Members can view schedules" ON public.league_schedules FOR SELECT TO authenticated USING (public.is_league_member(league_id, auth.uid()));

GRANT SELECT ON public.league_scoring_settings TO authenticated;
GRANT ALL ON public.league_scoring_settings TO service_role;
CREATE POLICY "Members can view scoring settings" ON public.league_scoring_settings FOR SELECT TO authenticated USING (public.is_league_member(league_id, auth.uid()));

GRANT SELECT ON public.league_historical_archive TO authenticated;
GRANT ALL ON public.league_historical_archive TO service_role;
CREATE POLICY "Members can view archive" ON public.league_historical_archive FOR SELECT TO authenticated USING (public.is_league_member(league_id, auth.uid()));

GRANT SELECT ON public.transactions TO authenticated;
GRANT ALL ON public.transactions TO service_role;
CREATE POLICY "Members can view transactions" ON public.transactions FOR SELECT TO authenticated USING (public.is_league_member(league_id, auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rosters TO authenticated;
GRANT ALL ON public.rosters TO service_role;
CREATE POLICY "Members can view rosters" ON public.rosters FOR SELECT TO authenticated USING (public.is_league_member(league_id, auth.uid()));
CREATE POLICY "Users manage their own roster" ON public.rosters FOR ALL TO authenticated USING (auth.uid() = user_id AND public.is_league_member(league_id, auth.uid())) WITH CHECK (auth.uid() = user_id AND public.is_league_member(league_id, auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lineups TO authenticated;
GRANT ALL ON public.lineups TO service_role;
CREATE POLICY "Members can view lineups" ON public.lineups FOR SELECT TO authenticated USING (public.is_league_member(league_id, auth.uid()));
CREATE POLICY "Users manage their own lineups" ON public.lineups FOR ALL TO authenticated USING (auth.uid() = user_id AND public.is_league_member(league_id, auth.uid())) WITH CHECK (auth.uid() = user_id AND public.is_league_member(league_id, auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.waiver_claims TO authenticated;
GRANT ALL ON public.waiver_claims TO service_role;
CREATE POLICY "Users view their own waiver claims" ON public.waiver_claims FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users manage their own waiver claims" ON public.waiver_claims FOR ALL TO authenticated USING (auth.uid() = user_id AND public.is_league_member(league_id, auth.uid())) WITH CHECK (auth.uid() = user_id AND public.is_league_member(league_id, auth.uid()));

GRANT ALL ON public.invite_codes TO service_role;