CREATE TABLE public.contributors (
  student_id text PRIMARY KEY REFERENCES public.users(student_id) ON UPDATE CASCADE ON DELETE CASCADE,
  display_name text NOT NULL CHECK (char_length(trim(display_name)) BETWEEN 1 AND 40),
  first_named_at timestamptz NOT NULL,
  approved_at timestamptz
);

CREATE INDEX contributors_approved_idx
  ON public.contributors (approved_at)
  WHERE approved_at IS NOT NULL;

REVOKE ALL ON public.contributors FROM anon, authenticated;
GRANT ALL ON public.contributors TO service_role;
ALTER TABLE public.contributors ENABLE ROW LEVEL SECURITY;
