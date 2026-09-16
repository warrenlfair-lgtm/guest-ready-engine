-- Add persisted manual route ordering for Today View.
-- Run manually in the Supabase SQL Editor as the postgres/database owner.
-- This does not change task dates, status, branch, technician, billing, or reconciliation.

BEGIN;

ALTER TABLE public.cleaning_tasks
  ADD COLUMN IF NOT EXISTS route_order INTEGER;

ALTER TABLE public.cleaning_tasks
  DROP CONSTRAINT IF EXISTS cleaning_tasks_route_order_check;
ALTER TABLE public.cleaning_tasks
  ADD CONSTRAINT cleaning_tasks_route_order_check
  CHECK (route_order IS NULL OR route_order > 0);

COMMENT ON COLUMN public.cleaning_tasks.route_order IS
  'Manual stop position within the task current service-date and assigned-technician route. Cleared when either scope changes.';

CREATE INDEX IF NOT EXISTS cleaning_tasks_today_route_lookup_idx
  ON public.cleaning_tasks (
    (COALESCE(service_date, scheduled_date)),
    technician_id,
    route_order
  );

CREATE OR REPLACE FUNCTION public.reset_task_route_order_on_scope_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  old_technician_key TEXT := COALESCE(
    OLD.technician_id::TEXT,
    NULLIF(lower(trim(COALESCE(OLD.technician_name, OLD.technician, ''))), ''),
    '__unassigned__'
  );
  new_technician_key TEXT := COALESCE(
    NEW.technician_id::TEXT,
    NULLIF(lower(trim(COALESCE(NEW.technician_name, NEW.technician, ''))), ''),
    '__unassigned__'
  );
BEGIN
  IF COALESCE(NEW.service_date, NEW.scheduled_date)
       IS DISTINCT FROM COALESCE(OLD.service_date, OLD.scheduled_date)
     OR new_technician_key IS DISTINCT FROM old_technician_key THEN
    NEW.route_order := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cleaning_tasks_reset_route_order_scope ON public.cleaning_tasks;
CREATE TRIGGER cleaning_tasks_reset_route_order_scope
BEFORE UPDATE OF service_date, scheduled_date, technician_id, technician_name, technician
ON public.cleaning_tasks
FOR EACH ROW
EXECUTE FUNCTION public.reset_task_route_order_on_scope_change();

CREATE OR REPLACE VIEW public.staff_cleaning_tasks
WITH (
  security_barrier = true,
  security_invoker = false
)
AS
SELECT
  id, property_id, service_date, scheduled_date, suggested_date,
  check_in_date, service_type, service_branch, weekly_service_level, status,
  technician, technician_id, technician_name, completed_by_technician_id,
  completed_by_technician_name, notes, guest_ready, off_cycle, completed_at,
  source_type, source_key, manually_modified,
  original_service_date, carry_forward_count, last_carried_forward_at,
  overdue_reference_date, route_order
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
  original_service_date, carry_forward_count, last_carried_forward_at,
  overdue_reference_date, route_order
FROM public.cleaning_tasks
WHERE public.is_active_app_manager() OR public.is_active_app_admin();
ALTER VIEW public.manager_cleaning_tasks OWNER TO postgres;

REVOKE ALL ON TABLE public.manager_cleaning_tasks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.manager_cleaning_tasks TO authenticated;

CREATE OR REPLACE FUNCTION public.save_today_route_order(ordered_task_ids UUID[])
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  business_date DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::DATE;
  route_technician_key TEXT;
  submitted_count INTEGER;
  distinct_count INTEGER;
  matching_count INTEGER;
  updated_count INTEGER;
BEGIN
  IF NOT (
    public.is_active_app_admin()
    OR public.is_active_app_manager()
    OR public.is_active_app_staff()
  ) THEN
    RAISE EXCEPTION 'Active Guest Engine role required' USING ERRCODE = '42501';
  END IF;

  submitted_count := COALESCE(array_length(ordered_task_ids, 1), 0);
  IF submitted_count = 0 OR array_position(ordered_task_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'At least one valid route task is required' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(DISTINCT task_id)::INTEGER
  INTO distinct_count
  FROM unnest(ordered_task_ids) AS submitted(task_id);
  IF distinct_count <> submitted_count THEN
    RAISE EXCEPTION 'A route cannot contain duplicate tasks' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('guest_ready_today_route_order'));

  SELECT COALESCE(
    task.technician_id::TEXT,
    NULLIF(lower(trim(COALESCE(task.technician_name, task.technician, ''))), ''),
    '__unassigned__'
  )
  INTO route_technician_key
  FROM public.cleaning_tasks AS task
  WHERE task.id = ordered_task_ids[1]
    AND COALESCE(task.service_date, task.scheduled_date) = business_date
    AND lower(COALESCE(task.status, 'scheduled')) NOT IN ('cancelled', 'canceled', 'void', 'deleted');

  IF route_technician_key IS NULL THEN
    RAISE EXCEPTION 'The route must contain current operational tasks' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO matching_count
  FROM public.cleaning_tasks AS task
  WHERE task.id = ANY(ordered_task_ids)
    AND COALESCE(task.service_date, task.scheduled_date) = business_date
    AND lower(COALESCE(task.status, 'scheduled')) NOT IN ('cancelled', 'canceled', 'void', 'deleted')
    AND COALESCE(
      task.technician_id::TEXT,
      NULLIF(lower(trim(COALESCE(task.technician_name, task.technician, ''))), ''),
      '__unassigned__'
    ) = route_technician_key;

  IF matching_count <> submitted_count THEN
    RAISE EXCEPTION 'All route tasks must belong to the same technician and business date' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.cleaning_tasks AS task
  WHERE COALESCE(task.service_date, task.scheduled_date) = business_date
    AND COALESCE(
      task.technician_id::TEXT,
      NULLIF(lower(trim(COALESCE(task.technician_name, task.technician, ''))), ''),
      '__unassigned__'
    ) = route_technician_key
  FOR UPDATE;

  UPDATE public.cleaning_tasks AS task
  SET route_order = NULL
  WHERE COALESCE(task.service_date, task.scheduled_date) = business_date
    AND COALESCE(
      task.technician_id::TEXT,
      NULLIF(lower(trim(COALESCE(task.technician_name, task.technician, ''))), ''),
      '__unassigned__'
    ) = route_technician_key
    AND NOT (task.id = ANY(ordered_task_ids))
    AND task.route_order IS NOT NULL;

  WITH submitted AS (
    SELECT task_id, stop_number::INTEGER
    FROM unnest(ordered_task_ids) WITH ORDINALITY AS ordered(task_id, stop_number)
  )
  UPDATE public.cleaning_tasks AS task
  SET route_order = submitted.stop_number
  FROM submitted
  WHERE task.id = submitted.task_id;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> submitted_count THEN
    RAISE EXCEPTION 'Route changed while it was being saved; reload and try again' USING ERRCODE = '40001';
  END IF;

  RETURN updated_count;
END;
$$;

REVOKE ALL ON FUNCTION public.save_today_route_order(UUID[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_today_route_order(UUID[])
  TO authenticated;

COMMIT;
