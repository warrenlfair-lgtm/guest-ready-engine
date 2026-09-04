-- Allow Managers to reschedule existing operational tasks without exposing direct table writes.
-- Run manually in the Supabase SQL Editor as the postgres/database owner.

BEGIN;

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
    AND COALESCE(service_date, scheduled_date) >= CURRENT_DATE
  ) AS month_reschedule_eligible
FROM public.cleaning_tasks
WHERE public.is_active_app_manager() OR public.is_active_app_admin();
ALTER VIEW public.manager_cleaning_tasks OWNER TO postgres;

REVOKE ALL ON TABLE public.manager_cleaning_tasks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.manager_cleaning_tasks TO authenticated;

CREATE OR REPLACE FUNCTION public.manager_reschedule_task(
  target_task_id UUID,
  selected_service_date DATE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  task_row public.cleaning_tasks%ROWTYPE;
BEGIN
  IF NOT (public.is_active_app_manager() OR public.is_active_app_admin()) THEN
    RAISE EXCEPTION 'Active manager or admin access required' USING ERRCODE = '42501';
  END IF;
  IF selected_service_date IS NULL OR selected_service_date < CURRENT_DATE THEN
    RAISE EXCEPTION 'A current or future service date is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO task_row
  FROM public.cleaning_tasks
  WHERE id = target_task_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found' USING ERRCODE = '22023';
  END IF;

  IF lower(COALESCE(task_row.status, 'scheduled')) NOT IN ('scheduled', 'in progress', 'in_progress')
     OR task_row.completed_at IS NOT NULL
     OR task_row.invoiced IS TRUE
     OR task_row.invoice_id IS NOT NULL
     OR task_row.invoiced_invoice_id IS NOT NULL
    OR task_row.same_day_surcharge_reconciled IS TRUE
    OR task_row.same_day_surcharge_invoice_id IS NOT NULL
     OR COALESCE(task_row.service_date, task_row.scheduled_date) < CURRENT_DATE THEN
    RAISE EXCEPTION 'Completed, historical, reconciled, or invoiced tasks cannot be rescheduled' USING ERRCODE = '22023';
  END IF;

  UPDATE public.cleaning_tasks
  SET service_date = selected_service_date,
      scheduled_date = selected_service_date,
      manually_modified = true
  WHERE id = target_task_id;
END;
$$;

REVOKE ALL ON FUNCTION public.manager_reschedule_task(UUID, DATE)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manager_reschedule_task(UUID, DATE)
  TO authenticated;

COMMIT;
