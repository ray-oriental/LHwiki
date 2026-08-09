CREATE TABLE IF NOT EXISTS public.drafts (
  id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(student_id) ON DELETE CASCADE,
  draft_key text NOT NULL,
  target_type text NOT NULL CHECK (target_type IN ('new', 'submission', 'article')),
  target_id text,
  section_slug text NOT NULL DEFAULT '',
  title text NOT NULL DEFAULT '',
  summary text NOT NULL DEFAULT '',
  body_json text NOT NULL DEFAULT '[]',
  content_type text NOT NULL DEFAULT '',
  subject text NOT NULL DEFAULT '',
  author_label text NOT NULL DEFAULT '',
  anonymous integer NOT NULL DEFAULT 0 CHECK (anonymous IN (0, 1)),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, draft_key),
  CHECK (
    (target_type = 'new' AND target_id IS NULL)
    OR (target_type IN ('submission', 'article') AND target_id IS NOT NULL AND length(target_id) > 0)
  )
);

CREATE INDEX IF NOT EXISTS drafts_student_updated_idx
  ON public.drafts (student_id, updated_at DESC);

ALTER TABLE public.drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drafts FORCE ROW LEVEL SECURITY;

-- Drafts are intentionally not exposed to browser-side app.rdb(). The HTTP
-- function authenticates the custom LHwiki session and uses service_role.
-- Keep the table deny-by-default for anonymous/authenticated database roles.
REVOKE ALL ON TABLE public.drafts FROM anon, authenticated;
GRANT ALL ON TABLE public.drafts TO service_role;

COMMENT ON TABLE public.drafts IS 'Private autosaved writing drafts, accessed only through lhwiki-api service_role.';
COMMENT ON COLUMN public.drafts.revision IS 'Optimistic concurrency version incremented by every successful save.';

-- Rollback (manual, destructive): DROP TABLE public.drafts;
