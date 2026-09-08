-- Move eligible unfinished tasks originating on or after 2026-09-08 while preserving audit history.
-- Run manually in the Supabase SQL Editor as the postgres/database owner.

BEGIN;

ALTER TABLE public.cleaning_tasks
  ADD COLUMN IF NOT EXISTS original_service_date DATE,
  ADD COLUMN IF NOT EXISTS carry_forward_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_carried_forward_at TIMESTAMPTZ;

ALTER TABLE public.cleaning_tasks
  DROP CONSTRAINT IF EXISTS cleaning_tasks_carry_forward_count_check;
ALTER TABLE public.cleaning_tasks
  ADD CONSTRAINT cleaning_tasks_carry_forward_count_check
  CHECK (carry_forward_count >= 0);

COMMENT ON COLUMN public.cleaning_tasks.original_service_date IS
  'Canonical service date before the task was first automatically carried forward; never overwritten.';
COMMENT ON COLUMN public.cleaning_tasks.carry_forward_count IS
  'Number of automatic carry-forward operations applied to this existing task row.';
COMMENT ON COLUMN public.cleaning_tasks.last_carried_forward_at IS
  'Timestamp of the most recent automatic carry-forward operation.';

CREATE OR REPLACE VIEW public.staff_cleaning_tasks
WITH (security_barrier = true)
AS
SELECT
  id, property_id, service_date, scheduled_date, suggested_date,
  check_in_date, service_type, service_branch, weekly_service_level, status,
  technician, technician_id, technician_name, completed_by_technician_id,
  completed_by_technician_name, notes, guest_ready, off_cycle, completed_at,
  source_type, source_key, manually_modified,
  original_service_date, carry_forward_count, last_carried_forward_at
FROM public.cleaning_tasks
WHERE public.is_active_app_staff() OR public.is_active_app_admin();
ALTER VIEW public.staff_cleaning_tasks OWNER TO postgres;

REVOKE ALL ON TABLE public.staff_cleaning_tasks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.staff_cleaning_tasks TO authenticated;

CREATE OR REPLACE VIEW public.manager_cleaning_tasks
WITH (security_barrier = true, security_invoker = false)
AS
SELECT
  id, property_id, service_date, scheduled_date, suggested_date,
  check_in_date, service_type, service_branch, weekly_service_level, status,
  technician, technician_id, technician_name, completed_by_technician_id,
  completed_by_technician_name, notes, guest_ready, off_cycle, completed_at,
  source_type, source_key, manually_modified,
  public.manager_reconciliation_eligible(id, 'task') AS manager_reconcile_eligible,
  public.manager_reconciliation_eligible(id, 'sds') AS manager_sds_reconcile_eligible,
  (
    lower(COALESCE(status, 'scheduled')) IN ('scheduled', 'in progress', 'in_progress')
    AND completed_at IS NULL
    AND invoiced IS DISTINCT FROM true
    AND invoice_id IS NULL
    AND invoiced_invoice_id IS NULL
    AND same_day_surcharge_reconciled IS DISTINCT FROM true
    AND same_day_surcharge_invoice_id IS NULL
    AND COALESCE(service_date, scheduled_date) >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::DATE
  ) AS month_reschedule_eligible,
  original_service_date, carry_forward_count, last_carried_forward_at
FROM public.cleaning_tasks
WHERE public.is_active_app_manager() OR public.is_active_app_admin();
ALTER VIEW public.manager_cleaning_tasks OWNER TO postgres;

REVOKE ALL ON TABLE public.manager_cleaning_tasks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.manager_cleaning_tasks TO authenticated;

CREATE OR REPLACE FUNCTION public.reconcile_unfinished_task_carry_forward()
RETURNS TABLE (moved_count INTEGER, skipped_guest_ready_count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  business_date DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::DATE;
  activation_date CONSTANT DATE := DATE '2026-09-08';
BEGIN
  IF NOT (
    public.is_active_app_admin()
    OR public.is_active_app_manager()
    OR public.is_active_app_staff()
  ) THEN
    RAISE EXCEPTION 'Active Guest Engine role required' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('guest_ready_unfinished_task_carry_forward'));

  SELECT COUNT(*)::INTEGER
  INTO skipped_guest_ready_count
  FROM public.cleaning_tasks task
  WHERE COALESCE(task.service_date, task.scheduled_date) < business_date
    AND COALESCE(task.original_service_date, task.service_date, task.scheduled_date) >= activation_date
    AND lower(COALESCE(task.status, 'scheduled')) IN ('scheduled', 'in progress', 'in_progress')
    AND task.completed_at IS NULL
    AND task.invoiced IS DISTINCT FROM true
    AND task.invoice_id IS NULL
    AND task.invoiced_invoice_id IS NULL
    AND task.same_day_surcharge_reconciled IS DISTINCT FROM true
    AND task.same_day_surcharge_invoice_id IS NULL
    AND (
      task.guest_ready IS TRUE
      OR lower(COALESCE(task.service_type, '')) = 'guest ready'
      OR lower(COALESCE(task.source_type, '')) = 'reservation_guest_ready'
    );

  WITH eligible AS (
    SELECT
      task.id,
      COALESCE(task.service_date, task.scheduled_date) AS previous_service_date
    FROM public.cleaning_tasks task
    WHERE COALESCE(task.service_date, task.scheduled_date) < business_date
      AND COALESCE(task.original_service_date, task.service_date, task.scheduled_date) >= activation_date
      AND lower(COALESCE(task.status, 'scheduled')) IN ('scheduled', 'in progress', 'in_progress')
      AND task.completed_at IS NULL
      AND task.invoiced IS DISTINCT FROM true
      AND task.invoice_id IS NULL
      AND task.invoiced_invoice_id IS NULL
      AND task.same_day_surcharge_reconciled IS DISTINCT FROM true
      AND task.same_day_surcharge_invoice_id IS NULL
      AND NOT (
        task.guest_ready IS TRUE
        OR lower(COALESCE(task.service_type, '')) = 'guest ready'
        OR lower(COALESCE(task.source_type, '')) = 'reservation_guest_ready'
      )
    FOR UPDATE
  ), moved AS (
    UPDATE public.cleaning_tasks task
    SET original_service_date = COALESCE(task.original_service_date, eligible.previous_service_date),
        service_date = business_date,
        scheduled_date = business_date,
        carry_forward_count = COALESCE(task.carry_forward_count, 0) + 1,
        last_carried_forward_at = CURRENT_TIMESTAMP,
        manually_modified = true
    FROM eligible
    WHERE task.id = eligible.id
    RETURNING task.id
  )
  SELECT COUNT(*)::INTEGER INTO moved_count FROM moved;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_unfinished_task_carry_forward()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_unfinished_task_carry_forward()
  TO authenticated;

COMMIT;