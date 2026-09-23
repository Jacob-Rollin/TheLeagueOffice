-- Admin checks must read profiles.role. public.user_roles was dropped;
-- has_role still pointed at it and broke article / HOF / invite RLS writes.

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = _user_id
      AND role IS NOT NULL
      AND role = (_role::text)
  );
$$;

REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

DROP TABLE IF EXISTS public.user_roles;

-- Invite code generator (admin panel) insert/select/delete.
ALTER TABLE public.invite_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage invite codes" ON public.invite_codes;
DROP POLICY IF EXISTS "Admins can manage invite codes" ON public.invite_codes;
DROP POLICY IF EXISTS "Admins full access invite_codes" ON public.invite_codes;
DROP POLICY IF EXISTS "Allow admin full write access" ON public.invite_codes;

CREATE POLICY "Admins manage invite codes" ON public.invite_codes
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.invite_codes TO authenticated;
GRANT ALL ON public.invite_codes TO service_role;
