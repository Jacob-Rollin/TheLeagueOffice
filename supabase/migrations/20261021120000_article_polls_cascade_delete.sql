-- When an article is deleted, remove its polls (questions/options/votes cascade from poll).
-- Comments already use ON DELETE CASCADE from the prior migration.

ALTER TABLE public.article_polls
  DROP CONSTRAINT IF EXISTS article_polls_article_id_fkey;

ALTER TABLE public.article_polls
  ADD CONSTRAINT article_polls_article_id_fkey
  FOREIGN KEY (article_id)
  REFERENCES public.articles(id)
  ON DELETE CASCADE;
