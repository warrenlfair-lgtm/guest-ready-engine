-- Allow manual VP² project tasks in the operational task and invoice workflows.
-- Run manually in the Supabase SQL Editor as the postgres/database owner.
-- Run after the other service-branch setup scripts.

BEGIN;

ALTER TABLE public.cleaning_tasks
  DROP CONSTRAINT IF EXISTS cleaning_tasks_service_branch_check;
ALTER TABLE public.cleaning_tasks
  ADD CONSTRAINT cleaning_tasks_service_branch_check
  CHECK (service_branch IN ('pool', 'lawn', 'maintenance', 'housekeeping', 'vp2'));

ALTER TABLE public.invoice_items
  DROP CONSTRAINT IF EXISTS invoice_items_service_branch_check;
ALTER TABLE public.invoice_items
  ADD CONSTRAINT invoice_items_service_branch_check
  CHECK (service_branch IS NULL OR service_branch IN ('pool', 'lawn', 'maintenance', 'housekeeping', 'vp2', 'other'));

CREATE OR REPLACE FUNCTION public.manager_update_task_service_branch(
  target_task_id UUID,
  selected_service_branch TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  task_row public.cleaning_tasks%ROWTYPE;
  normalized_branch TEXT := lower(trim(COALESCE(selected_service_branch, '')));
  business_date DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::DATE;
BEGIN
  IF NOT (public.is_active_app_manager() OR public.is_active_app_admin()) THEN
    RAISE EXCEPTION 'Active manager or admin access required' USING ERRCODE = '42501';
  END IF;
  IF normalized_branch NOT IN ('pool', 'lawn', 'maintenance', 'housekeeping', 'vp2') THEN
    RAISE EXCEPTION 'Invalid service branch' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO task_row
  FROM public.cleaning_tasks
  WHERE id = target_task_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found' USING ERRCODE = '22023';
  END IF;

  IF lower(COALESCE(task_row.status, 'scheduled')) NOT IN ('scheduled', 'in progress', 'in_progress')
     OR task_row.completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Completed or inactive tasks cannot change service branch' USING ERRCODE = '22023';
  END IF;
  IF task_row.invoiced IS TRUE
     OR task_row.invoice_id IS NOT NULL
     OR task_row.invoiced_invoice_id IS NOT NULL
     OR task_row.same_day_surcharge_reconciled IS TRUE
     OR task_row.same_day_surcharge_invoice_id IS NOT NULL THEN
    RAISE EXCEPTION 'Reconciled or invoiced tasks cannot change service branch' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(task_row.service_date, task_row.scheduled_date) < business_date THEN
    RAISE EXCEPTION 'Historical tasks cannot change service branch' USING ERRCODE = '22023';
  END IF;

  UPDATE public.cleaning_tasks
  SET service_branch = normalized_branch
  WHERE id = target_task_id;
END;
$$;

REVOKE ALL ON FUNCTION public.manager_update_task_service_branch(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manager_update_task_service_branch(UUID, TEXT)
  TO authenticated;

COMMIT;
