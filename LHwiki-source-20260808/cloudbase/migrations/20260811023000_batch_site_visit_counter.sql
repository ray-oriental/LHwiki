ALTER TABLE public.site_visit_events
ADD COLUMN IF NOT EXISTS visit_count integer NOT NULL DEFAULT 1
CHECK (visit_count BETWEEN 1 AND 20);

CREATE OR REPLACE FUNCTION public.increment_site_visit_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.site_stats (key, total, tracking_started_at)
  VALUES ('all', NEW.visit_count, '2026-08-10T00:00:00+08:00')
  ON CONFLICT (key) DO UPDATE
  SET total = site_stats.total + NEW.visit_count;
  RETURN NEW;
END;
$$;
