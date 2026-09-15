-- Production-safe function-only fix for repeatedly carried tasks with older original dates.
-- The activation boundary applies to the task's current scheduled date, while
-- original_service_date remains immutable history and the overdue baseline.
-- This script does not update cleaning_tasks directly. After running it, refresh
-- Guest Engine to invoke the normal carry-forward reconciliation.

BEGIN;

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
    AND COALESCE(task.service_date, task.scheduled_date) >= activation_date
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
      AND COALESCE(task.service_date, task.scheduled_date) >= activation_date
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
      AND (
        lower(COALESCE(task.service_branch, 'pool')) <> 'housekeeping'
        OR NOT EXISTS (
          SELECT 1
          FROM public.reservations reservation
          WHERE reservation.property_id = task.property_id
            AND lower(COALESCE(reservation.status, 'active')) = 'active'
            AND reservation.check_in >= COALESCE(
              task.suggested_date,
              task.original_service_date,
              task.service_date,
              task.scheduled_date
            )
            AND reservation.check_in <= business_date
        )
      )
    FOR UPDATE
  ), moved AS (
    UPDATE public.cleaning_tasks task
    SET original_service_date = COALESCE(task.original_service_date, eligible.previous_service_date),
        overdue_reference_date = COALESCE(
          task.overdue_reference_date,
          task.original_service_date,
          eligible.previous_service_date
        ),
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
