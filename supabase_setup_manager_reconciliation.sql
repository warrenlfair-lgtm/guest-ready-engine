-- Allow active Managers to reconcile eligible completed tasks without exposing amounts.
-- Run manually in the Supabase SQL Editor as the postgres/database owner.

BEGIN;

CREATE OR REPLACE FUNCTION public.manager_reconciliation_amount(
  target_task_id UUID,
  reconciliation_type TEXT
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  task_row public.cleaning_tasks%ROWTYPE;
  property_row public.properties%ROWTYPE;
  task_date DATE;
  task_day INTEGER;
  standard_day INTEGER;
  coverage_value TEXT;
  is_included BOOLEAN := false;
  is_manual_override BOOLEAN := false;
  has_same_day_check_in BOOLEAN := false;
  has_same_day_check_out BOOLEAN := false;
  effective_amount NUMERIC := 0;
BEGIN
  SELECT * INTO task_row
  FROM public.cleaning_tasks
  WHERE id = target_task_id;
  IF NOT FOUND OR lower(COALESCE(task_row.status, '')) <> 'completed' THEN
    RETURN 0;
  END IF;

  SELECT * INTO property_row
  FROM public.properties
  WHERE id = task_row.property_id;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  task_date := COALESCE(task_row.service_date, task_row.scheduled_date);

  IF reconciliation_type = 'sds' THEN
    IF NOT (task_row.guest_ready IS TRUE OR task_row.service_type = 'Guest Ready')
       OR task_date IS NULL THEN
      RETURN 0;
    END IF;

    SELECT
      EXISTS (
        SELECT 1 FROM public.reservations AS reservation
        WHERE reservation.property_id = task_row.property_id
          AND reservation.check_in::date = task_date
          AND lower(COALESCE(reservation.status, 'active')) <> 'cancelled'
      ),
      EXISTS (
        SELECT 1 FROM public.reservations AS reservation
        WHERE reservation.property_id = task_row.property_id
          AND reservation.check_out::date = task_date
          AND lower(COALESCE(reservation.status, 'active')) <> 'cancelled'
      )
    INTO has_same_day_check_in, has_same_day_check_out;

    IF NOT (has_same_day_check_in AND has_same_day_check_out) THEN
      RETURN 0;
    END IF;

    effective_amount := CASE
      WHEN COALESCE(task_row.same_day_surcharge_amount, 0) > 0
        THEN task_row.same_day_surcharge_amount
      ELSE COALESCE(property_row.same_day_surcharge, 0)
    END;
    RETURN GREATEST(COALESCE(effective_amount, 0), 0);
  END IF;

  IF reconciliation_type <> 'task' THEN
    RETURN 0;
  END IF;

  IF COALESCE(task_row.service_branch, 'pool') = 'lawn' THEN
    effective_amount := CASE
      WHEN COALESCE(task_row.charge, 0) > 0 THEN task_row.charge
      ELSE COALESCE(property_row.lawn_default_charge, 0)
    END;
  ELSIF task_row.service_type = 'Weekly Standard' THEN
    effective_amount := CASE
      WHEN COALESCE(task_row.charge, 0) > 0 THEN task_row.charge
      ELSE COALESCE(property_row.default_cleaning_rate, 0)
    END;
  ELSIF task_row.guest_ready IS TRUE OR task_row.service_type = 'Guest Ready' THEN
    IF task_date IS NULL THEN
      RETURN 0;
    END IF;

    task_day := EXTRACT(DOW FROM task_date)::INTEGER;
    standard_day := CASE lower(COALESCE(property_row.standard_service_day, 'Wednesday'))
      WHEN 'sunday' THEN 0 WHEN 'monday' THEN 1 WHEN 'tuesday' THEN 2
      WHEN 'wednesday' THEN 3 WHEN 'thursday' THEN 4 WHEN 'friday' THEN 5
      WHEN 'saturday' THEN 6 ELSE 3
    END;
    coverage_value := CASE
      WHEN lower(COALESCE(property_row.coverage_rule, '')) IN ('none', 'before', 'after', 'both')
        THEN lower(property_row.coverage_rule)
      WHEN COALESCE(property_row.coverage_days, 1) = 0 THEN 'none'
      ELSE 'both'
    END;
    is_included := task_day = standard_day
      OR (coverage_value IN ('before', 'both') AND task_day = (standard_day + 6) % 7)
      OR (coverage_value IN ('after', 'both') AND task_day = (standard_day + 1) % 7);
    is_manual_override := position('[Manual Override]' IN COALESCE(task_row.notes, '')) > 0
      AND COALESCE(task_row.charge, 0) > 0;

    effective_amount := CASE
      WHEN is_included AND NOT is_manual_override THEN 0
      WHEN COALESCE(task_row.charge, 0) > 0 THEN task_row.charge
      ELSE COALESCE(NULLIF(to_jsonb(property_row)->>'default_off_cycle_charge', '')::NUMERIC, 65)
    END;
  ELSE
    effective_amount := COALESCE(task_row.charge, 0);
  END IF;

  RETURN GREATEST(COALESCE(effective_amount, 0), 0);
END;
$$;

REVOKE ALL ON FUNCTION public.manager_reconciliation_amount(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.manager_reconciliation_eligible(
  target_task_id UUID,
  reconciliation_type TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  task_row public.cleaning_tasks%ROWTYPE;
BEGIN
  IF NOT (public.is_active_app_manager() OR public.is_active_app_admin()) THEN
    RETURN false;
  END IF;

  SELECT * INTO task_row
  FROM public.cleaning_tasks
  WHERE id = target_task_id;
  IF NOT FOUND OR lower(COALESCE(task_row.status, '')) <> 'completed' THEN
    RETURN false;
  END IF;

  IF reconciliation_type = 'task' THEN
    RETURN task_row.invoiced IS DISTINCT FROM true
      AND task_row.invoice_id IS NULL
      AND task_row.invoiced_invoice_id IS NULL
      AND public.manager_reconciliation_amount(target_task_id, 'task') > 0;
  END IF;

  IF reconciliation_type = 'sds' THEN
    RETURN task_row.same_day_surcharge_reconciled IS DISTINCT FROM true
      AND task_row.same_day_surcharge_invoice_id IS NULL
      AND public.manager_reconciliation_amount(target_task_id, 'sds') > 0;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.manager_reconciliation_eligible(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;

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
  public.manager_reconciliation_eligible(id, 'sds') AS manager_sds_reconcile_eligible
FROM public.cleaning_tasks
WHERE public.is_active_app_manager() OR public.is_active_app_admin();
ALTER VIEW public.manager_cleaning_tasks OWNER TO postgres;

REVOKE ALL ON TABLE public.manager_cleaning_tasks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.manager_cleaning_tasks TO authenticated;

CREATE OR REPLACE FUNCTION public.manager_reconcile_task(
  target_task_id UUID,
  reconciliation_type TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  task_row public.cleaning_tasks%ROWTYPE;
  effective_amount NUMERIC;
BEGIN
  IF NOT public.is_active_app_manager() THEN
    RAISE EXCEPTION 'Active manager access required' USING ERRCODE = '42501';
  END IF;
  IF reconciliation_type NOT IN ('task', 'sds') THEN
    RAISE EXCEPTION 'Invalid reconciliation type' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO task_row
  FROM public.cleaning_tasks
  WHERE id = target_task_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found' USING ERRCODE = '22023';
  END IF;

  IF NOT public.manager_reconciliation_eligible(target_task_id, reconciliation_type) THEN
    RAISE EXCEPTION 'Task is not eligible for reconciliation' USING ERRCODE = '22023';
  END IF;

  effective_amount := public.manager_reconciliation_amount(target_task_id, reconciliation_type);

  IF reconciliation_type = 'task' THEN
    UPDATE public.cleaning_tasks
    SET invoiced = true,
        charge = CASE
          WHEN (service_type = 'Weekly Standard' OR COALESCE(service_branch, 'pool') = 'lawn')
               AND COALESCE(charge, 0) <= 0
            THEN effective_amount
          ELSE charge
        END
    WHERE id = target_task_id;
  ELSE
    UPDATE public.cleaning_tasks
    SET same_day_surcharge_reconciled = true,
        same_day_surcharge_reconciled_at = now(),
        same_day_surcharge_amount = CASE
          WHEN COALESCE(same_day_surcharge_amount, 0) <= 0 THEN effective_amount
          ELSE same_day_surcharge_amount
        END
    WHERE id = target_task_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.manager_reconcile_task(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manager_reconcile_task(UUID, TEXT) TO authenticated;

COMMIT;