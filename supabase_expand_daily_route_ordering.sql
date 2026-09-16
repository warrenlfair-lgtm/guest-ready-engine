-- Expand persisted route ordering from Today-only to date-based Daily Routes.
-- Run manually in the Supabase SQL Editor as the postgres/database owner.
-- This function updates only cleaning_tasks.route_order.

BEGIN;

CREATE OR REPLACE FUNCTION public.save_daily_route_order(
  selected_service_date DATE,
  ordered_task_ids UUID[]
)
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

  IF selected_service_date IS NULL OR selected_service_date < business_date THEN
    RAISE EXCEPTION 'A current or future route date is required' USING ERRCODE = '22023';
  END IF;

  IF public.is_active_app_staff() AND NOT (
    public.is_active_app_admin() OR public.is_active_app_manager()
  ) AND selected_service_date <> business_date THEN
    RAISE EXCEPTION 'Staff may organize only the current business date route' USING ERRCODE = '42501';
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

  SELECT COALESCE(
    task.technician_id::TEXT,
    NULLIF(lower(trim(COALESCE(task.technician_name, task.technician, ''))), ''),
    '__unassigned__'
  )
  INTO route_technician_key
  FROM public.cleaning_tasks AS task
  WHERE task.id = ordered_task_ids[1]
    AND COALESCE(task.service_date, task.scheduled_date) = selected_service_date
    AND lower(COALESCE(task.status, 'scheduled')) NOT IN ('cancelled', 'canceled', 'void', 'deleted');

  IF route_technician_key IS NULL THEN
    RAISE EXCEPTION 'The route must contain operational tasks on the selected date' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext('guest_engine_daily_route_order'),
    hashtext(selected_service_date::TEXT || ':' || route_technician_key)
  );

  SELECT COUNT(*)::INTEGER
  INTO matching_count
  FROM public.cleaning_tasks AS task
  WHERE task.id = ANY(ordered_task_ids)
    AND COALESCE(task.service_date, task.scheduled_date) = selected_service_date
    AND lower(COALESCE(task.status, 'scheduled')) NOT IN ('cancelled', 'canceled', 'void', 'deleted')
    AND COALESCE(
      task.technician_id::TEXT,
      NULLIF(lower(trim(COALESCE(task.technician_name, task.technician, ''))), ''),
      '__unassigned__'
    ) = route_technician_key;

  IF matching_count <> submitted_count THEN
    RAISE EXCEPTION 'All route tasks must belong to the same technician and selected service date' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.cleaning_tasks AS task
  WHERE COALESCE(task.service_date, task.scheduled_date) = selected_service_date
    AND COALESCE(
      task.technician_id::TEXT,
      NULLIF(lower(trim(COALESCE(task.technician_name, task.technician, ''))), ''),
      '__unassigned__'
    ) = route_technician_key
  FOR UPDATE;

  UPDATE public.cleaning_tasks AS task
  SET route_order = NULL
  WHERE COALESCE(task.service_date, task.scheduled_date) = selected_service_date
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

REVOKE ALL ON FUNCTION public.save_daily_route_order(DATE, UUID[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_daily_route_order(DATE, UUID[])
  TO authenticated;

DROP FUNCTION IF EXISTS public.save_today_route_order(UUID[]);

COMMIT;
