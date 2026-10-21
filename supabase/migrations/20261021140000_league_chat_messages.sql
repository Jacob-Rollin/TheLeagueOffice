-- Native league chat (Supabase A). Not wired into nav/routes yet.
-- Browser → Supabase with RLS via native_league_links; no TiDB / Fluid / Realtime.

CREATE TABLE IF NOT EXISTS public.league_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  native_league_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author_name text NOT NULL,
  body text NOT NULL CHECK (char_length(btrim(body)) >= 1 AND char_length(body) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_league_chat_messages_league_created
  ON public.league_chat_messages (native_league_id, created_at DESC);

ALTER TABLE public.league_chat_messages ENABLE ROW LEVEL SECURITY;

-- Membership helper (bypasses link RLS so EXISTS is reliable for every member).
CREATE OR REPLACE FUNCTION public.is_native_league_member(target_league_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.native_league_links
    WHERE user_id = auth.uid()
      AND native_league_id = target_league_id
  );
$$;

REVOKE ALL ON FUNCTION public.is_native_league_member(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_native_league_member(text) TO authenticated;

DROP POLICY IF EXISTS "Members read league chat" ON public.league_chat_messages;
CREATE POLICY "Members read league chat"
  ON public.league_chat_messages FOR SELECT TO authenticated
  USING (public.is_native_league_member(native_league_id));

DROP POLICY IF EXISTS "Members post league chat" ON public.league_chat_messages;
CREATE POLICY "Members post league chat"
  ON public.league_chat_messages FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND public.is_native_league_member(native_league_id)
  );

DROP POLICY IF EXISTS "Members delete own league chat" ON public.league_chat_messages;
CREATE POLICY "Members delete own league chat"
  ON public.league_chat_messages FOR DELETE TO authenticated
  USING (
    auth.uid() = user_id
    OR public.has_role(auth.uid(), 'admin')
  );

REVOKE ALL ON TABLE public.league_chat_messages FROM anon;
GRANT SELECT, INSERT, DELETE ON public.league_chat_messages TO authenticated;
GRANT ALL ON public.league_chat_messages TO service_role;
