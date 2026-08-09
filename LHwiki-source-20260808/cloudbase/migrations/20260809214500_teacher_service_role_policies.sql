CREATE POLICY teacher_submissions_service_role_all
  ON public.teacher_submissions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY teacher_additions_service_role_all
  ON public.teacher_additions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
