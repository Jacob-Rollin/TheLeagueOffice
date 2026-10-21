-- Article comments (signed-in only) + multi-question article polls.
-- Browser → Supabase with RLS; no TiDB / Fluid on the happy path.

-- ---------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.article_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author_name text NOT NULL,
  body text NOT NULL CHECK (char_length(btrim(body)) >= 1 AND char_length(body) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_article_comments_article_created
  ON public.article_comments (article_id, created_at ASC);

ALTER TABLE public.article_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read article comments" ON public.article_comments;
CREATE POLICY "Anyone can read article comments"
  ON public.article_comments FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Signed-in users insert own comments" ON public.article_comments;
CREATE POLICY "Signed-in users insert own comments"
  ON public.article_comments FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own comments" ON public.article_comments;
CREATE POLICY "Users delete own comments"
  ON public.article_comments FOR DELETE TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

GRANT SELECT ON public.article_comments TO anon;
GRANT SELECT, INSERT, DELETE ON public.article_comments TO authenticated;
GRANT ALL ON public.article_comments TO service_role;

-- ---------------------------------------------------------------------------
-- Polls (embeddable in article HTML via .lo-poll[data-poll-id])
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.article_polls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid REFERENCES public.articles(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  require_auth boolean NOT NULL DEFAULT true,
  native_league_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_article_polls_article
  ON public.article_polls (article_id);

CREATE TABLE IF NOT EXISTS public.article_poll_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id uuid NOT NULL REFERENCES public.article_polls(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  prompt text NOT NULL CHECK (char_length(btrim(prompt)) >= 1 AND char_length(prompt) <= 500)
);

CREATE INDEX IF NOT EXISTS idx_article_poll_questions_poll
  ON public.article_poll_questions (poll_id, sort_order);

CREATE TABLE IF NOT EXISTS public.article_poll_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES public.article_poll_questions(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  label text NOT NULL CHECK (char_length(btrim(label)) >= 1 AND char_length(label) <= 200)
);

CREATE INDEX IF NOT EXISTS idx_article_poll_options_question
  ON public.article_poll_options (question_id, sort_order);

CREATE TABLE IF NOT EXISTS public.article_poll_votes (
  question_id uuid NOT NULL REFERENCES public.article_poll_questions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  option_id uuid NOT NULL REFERENCES public.article_poll_options(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (question_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_article_poll_votes_option
  ON public.article_poll_votes (option_id);

ALTER TABLE public.article_polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.article_poll_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.article_poll_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.article_poll_votes ENABLE ROW LEVEL SECURITY;

-- Public read of poll structure (results gated in app; vote rows only own + aggregates via client counts)
DROP POLICY IF EXISTS "Anyone can read article polls" ON public.article_polls;
CREATE POLICY "Anyone can read article polls"
  ON public.article_polls FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Admins manage article polls" ON public.article_polls;
CREATE POLICY "Admins manage article polls"
  ON public.article_polls FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Anyone can read poll questions" ON public.article_poll_questions;
CREATE POLICY "Anyone can read poll questions"
  ON public.article_poll_questions FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Admins manage poll questions" ON public.article_poll_questions;
CREATE POLICY "Admins manage poll questions"
  ON public.article_poll_questions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Anyone can read poll options" ON public.article_poll_options;
CREATE POLICY "Anyone can read poll options"
  ON public.article_poll_options FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Admins manage poll options" ON public.article_poll_options;
CREATE POLICY "Admins manage poll options"
  ON public.article_poll_options FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Votes: anyone can read (for tallies); only signed-in members can write under rules
DROP POLICY IF EXISTS "Anyone can read poll votes" ON public.article_poll_votes;
CREATE POLICY "Anyone can read poll votes"
  ON public.article_poll_votes FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Signed-in users cast poll votes" ON public.article_poll_votes;
CREATE POLICY "Signed-in users cast poll votes"
  ON public.article_poll_votes FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.article_poll_questions q
      JOIN public.article_polls p ON p.id = q.poll_id
      JOIN public.article_poll_options o ON o.id = option_id AND o.question_id = q.id
      WHERE q.id = question_id
        AND p.status = 'open'
        AND (
          p.native_league_id IS NULL
          OR EXISTS (
            SELECT 1 FROM public.native_league_links l
            WHERE l.user_id = auth.uid()
              AND l.native_league_id = p.native_league_id
          )
        )
    )
  );

DROP POLICY IF EXISTS "Users update own poll votes" ON public.article_poll_votes;
CREATE POLICY "Users update own poll votes"
  ON public.article_poll_votes FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.article_poll_questions q
      JOIN public.article_polls p ON p.id = q.poll_id
      JOIN public.article_poll_options o ON o.id = option_id AND o.question_id = q.id
      WHERE q.id = question_id
        AND p.status = 'open'
        AND (
          p.native_league_id IS NULL
          OR EXISTS (
            SELECT 1 FROM public.native_league_links l
            WHERE l.user_id = auth.uid()
              AND l.native_league_id = p.native_league_id
          )
        )
    )
  );

GRANT SELECT ON public.article_polls TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.article_polls TO authenticated;
GRANT SELECT ON public.article_poll_questions TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.article_poll_questions TO authenticated;
GRANT SELECT ON public.article_poll_options TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.article_poll_options TO authenticated;
GRANT SELECT ON public.article_poll_votes TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.article_poll_votes TO authenticated;
GRANT ALL ON public.article_polls TO service_role;
GRANT ALL ON public.article_poll_questions TO service_role;
GRANT ALL ON public.article_poll_options TO service_role;
GRANT ALL ON public.article_poll_votes TO service_role;
