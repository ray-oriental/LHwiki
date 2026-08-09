CREATE TABLE public.teacher_submissions (
  id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(student_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 30),
  subject text NOT NULL CHECK (char_length(btrim(subject)) BETWEEN 1 AND 30),
  motto text NOT NULL DEFAULT '' CHECK (char_length(motto) <= 240),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  review_note text NOT NULL DEFAULT '',
  reviewer_id text REFERENCES public.users(student_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  reviewed_at timestamptz
);

CREATE UNIQUE INDEX teacher_submissions_pending_name_idx
  ON public.teacher_submissions (lower(btrim(name)))
  WHERE status = 'pending';

CREATE INDEX teacher_submissions_status_created_idx
  ON public.teacher_submissions (status, created_at ASC);

CREATE INDEX teacher_submissions_student_created_idx
  ON public.teacher_submissions (student_id, created_at DESC);

CREATE TABLE public.teacher_additions (
  id text PRIMARY KEY,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 30),
  subject text NOT NULL CHECK (char_length(btrim(subject)) BETWEEN 1 AND 30),
  motto text NOT NULL DEFAULT '' CHECK (char_length(motto) <= 240),
  submitted_by text NOT NULL REFERENCES public.users(student_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  source_submission_id text NOT NULL UNIQUE REFERENCES public.teacher_submissions(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  approved_by text NOT NULL REFERENCES public.users(student_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  approved_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX teacher_additions_name_idx
  ON public.teacher_additions (lower(btrim(name)));

REVOKE ALL ON public.teacher_submissions, public.teacher_additions FROM anon, authenticated;
GRANT ALL ON public.teacher_submissions, public.teacher_additions TO service_role;
ALTER TABLE public.teacher_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_additions ENABLE ROW LEVEL SECURITY;
