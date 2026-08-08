CREATE TABLE public.sections (
  slug text PRIMARY KEY,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  icon text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0
);

CREATE TABLE public.users (
  student_id text PRIMARY KEY,
  role text NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'reviewer', 'admin')),
  role_locked integer NOT NULL DEFAULT 0 CHECK (role_locked IN (0, 1)),
  created_at timestamptz NOT NULL,
  last_login_at timestamptz NOT NULL
);

CREATE TABLE public.submissions (
  id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(student_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  section_slug text NOT NULL REFERENCES public.sections(slug) ON UPDATE CASCADE ON DELETE RESTRICT,
  title text NOT NULL,
  summary text NOT NULL,
  body_json text NOT NULL,
  content_type text NOT NULL,
  subject text NOT NULL DEFAULT '',
  author_label text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'changes_requested', 'approved', 'rejected')),
  review_note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE public.articles (
  slug text PRIMARY KEY,
  section_slug text NOT NULL REFERENCES public.sections(slug) ON UPDATE CASCADE ON DELETE RESTRICT,
  title text NOT NULL,
  summary text NOT NULL,
  body_json text NOT NULL,
  content_type text NOT NULL,
  subject text NOT NULL DEFAULT '',
  author_label text NOT NULL,
  source_submission_id text REFERENCES public.submissions(id) ON UPDATE CASCADE ON DELETE SET NULL,
  published_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE public.review_events (
  id text PRIMARY KEY,
  submission_id text NOT NULL REFERENCES public.submissions(id) ON UPDATE CASCADE ON DELETE CASCADE,
  reviewer_id text NOT NULL REFERENCES public.users(student_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('approve', 'request_changes', 'reject')),
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL
);

CREATE INDEX submissions_student_created_idx ON public.submissions (student_id, created_at DESC);
CREATE INDEX submissions_status_created_idx ON public.submissions (status, created_at ASC);
CREATE INDEX articles_section_published_idx ON public.articles (section_slug, published_at DESC);
CREATE INDEX review_events_submission_idx ON public.review_events (submission_id, created_at ASC);

REVOKE ALL ON public.sections, public.users, public.submissions, public.articles, public.review_events FROM anon, authenticated;
GRANT ALL ON public.sections, public.users, public.submissions, public.articles, public.review_events TO service_role;
