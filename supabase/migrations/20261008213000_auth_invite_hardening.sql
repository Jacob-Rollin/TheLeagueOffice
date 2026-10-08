-- Auth / invite / admin hardening (no product UX change).
-- 1) Lock profiles.role against self-escalation
-- 2) Enable profiles RLS + admin list policy
-- 3) synced_leagues owner RLS (espn_s2 / swid)
-- 4) articles: public read of published rows; enable RLS
-- 5) Invite verify (non-destructive) + consume-after-signup

-- ---------------------------------------------------------------------------
-- profiles: RLS + role protection
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update profiles" ON public.profiles;

CREATE POLICY "Users can view their own profile"
  ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Admins can view all profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Role / verification changes only via service_role (server fns).
CREATE OR REPLACE FUNCTION public.protect_profile_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.role IS DISTINCT FROM OLD.role
       OR NEW.is_verified IS DISTINCT FROM OLD.is_verified THEN
      IF auth.role() = 'service_role' THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'Changing profile role or verification is not allowed';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_privileged_columns ON public.profiles;
CREATE TRIGGER trg_protect_profile_privileged_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_privileged_columns();

REVOKE ALL ON TABLE public.profiles FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

-- ---------------------------------------------------------------------------
-- synced_leagues: owner-only (credentials)
-- ---------------------------------------------------------------------------
ALTER TABLE public.synced_leagues ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own synced leagues" ON public.synced_leagues;
CREATE POLICY "Users manage own synced leagues"
  ON public.synced_leagues FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

REVOKE ALL ON TABLE public.synced_leagues FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.synced_leagues TO authenticated;
GRANT ALL ON public.synced_leagues TO service_role;

-- ---------------------------------------------------------------------------
-- articles: enable RLS + public published reads
-- ---------------------------------------------------------------------------
ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read published articles" ON public.articles;
CREATE POLICY "Public can read published articles"
  ON public.articles FOR SELECT TO anon, authenticated
  USING (published = true);

-- ---------------------------------------------------------------------------
-- invite codes: verify without burn; consume after successful signup
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_invite_code(target_code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF target_code IS NULL OR btrim(target_code) = '' THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1
    FROM public.invite_codes
    WHERE upper(btrim(code)) = upper(btrim(target_code))
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_invite_code(target_code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count int;
BEGIN
  IF target_code IS NULL OR btrim(target_code) = '' THEN
    RETURN false;
  END IF;

  DELETE FROM public.invite_codes
  WHERE upper(btrim(code)) = upper(btrim(target_code));

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count > 0;
END;
$$;

-- Legacy name: verify only (no delete) so anon callers cannot burn codes.
CREATE OR REPLACE FUNCTION public.verify_and_consume_invite_code(target_code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.verify_invite_code(target_code);
END;
$$;

REVOKE ALL ON FUNCTION public.verify_invite_code(text) FROM public;
REVOKE ALL ON FUNCTION public.consume_invite_code(text) FROM public;
REVOKE ALL ON FUNCTION public.verify_and_consume_invite_code(text) FROM public;

GRANT EXECUTE ON FUNCTION public.verify_invite_code(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consume_invite_code(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.verify_and_consume_invite_code(text) TO anon, authenticated, service_role;

REVOKE ALL ON TABLE public.invite_codes FROM anon;
