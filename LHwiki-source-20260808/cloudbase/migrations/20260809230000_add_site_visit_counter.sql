CREATE TABLE public.site_stats (
  key text PRIMARY KEY,
  total bigint NOT NULL DEFAULT 0 CHECK (total >= 0),
  tracking_started_at timestamptz NOT NULL
);

CREATE TABLE public.site_visit_events (
  visit_id varchar(96) PRIMARY KEY,
  created_at timestamptz NOT NULL
);

CREATE OR REPLACE FUNCTION public.increment_site_visit_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.site_stats (key, total, tracking_started_at)
  VALUES ('all', 1, '2026-08-10T00:00:00+08:00')
  ON CONFLICT (key) DO UPDATE
  SET total = site_stats.total + 1;
  RETURN NEW;
END;
$$;

CREATE TRIGGER site_visit_events_increment_total
AFTER INSERT ON public.site_visit_events
FOR EACH ROW EXECUTE FUNCTION public.increment_site_visit_count();

INSERT INTO public.site_stats (key, total, tracking_started_at)
VALUES ('all', 0, '2026-08-10T00:00:00+08:00')
ON CONFLICT (key) DO NOTHING;

REVOKE ALL ON public.site_stats, public.site_visit_events FROM anon, authenticated;
GRANT ALL ON public.site_stats, public.site_visit_events TO service_role;
ALTER TABLE public.site_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_visit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY site_stats_service_role_all ON public.site_stats FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY site_visit_events_service_role_all ON public.site_visit_events FOR ALL TO service_role USING (true) WITH CHECK (true);
