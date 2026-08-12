ALTER TABLE public.review_events
  DROP CONSTRAINT IF EXISTS review_events_action_check;

ALTER TABLE public.review_events
  ADD CONSTRAINT review_events_action_check
  CHECK (action IN ('approve', 'request_changes', 'reject', 'admin_edit'));
