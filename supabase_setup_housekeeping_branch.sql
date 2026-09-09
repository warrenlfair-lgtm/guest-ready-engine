-- Add the Housekeeping operational branch and checkout-sensitive carry-forward protection.
-- Run manually in the Supabase SQL Editor as the postgres/database owner.

BEGIN;

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS housekeeping_service_active BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.cleaning_tasks
  ADD COLUMN IF NOT EXISTS overdue_reference_date DATE;

ALTER TABLE public.cleaning_tasks
  DROP CONSTRAINT IF EXISTS cleaning_tasks_service_branch_check;
ALTER TABLE public.cleaning_tasks
  ADD CONSTRAINT cleaning_tasks_service_branch_check
  CHECK (service_branch IN ('pool', 'lawn', 'maintenance', 'housekeeping'));

ALTER TABLE public.invoice_items
  DROP CONSTRAINT IF EXISTS invoice_items_service_branch_check;
ALTER TABLE public.invoice_items
  ADD CONSTRAINT invoice_items_service_branch_check
  CHECK (service_branch IS NULL OR service_branch IN ('pool', 'lawn', 'maintenance', 'housekeeping'));

COMMENT ON COLUMN public.properties.housekeeping_service_active IS
  'Enables iCal checkout-date Housekeeping task generation for this property.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_cleaning_tasks_housekeeping_source
ON public.cleaning_tasks(property_id, source_type, source_key)
WHERE source_type = 'reservation_housekeeping' AND source_key IS NOT NULL;

CREATE OR REPLACE VIEW public.staff_properties
WITH (
  security_barrier = true,
  security_invoker = false
)
AS
SELECT
  id, property_name, address, safetyculture_checklist_url,
  gate_access_instructions, service_notes, equipment_service_info,
  standard_service_day, service_frequency, biweekly_anchor_date,
  active, pool_service_active, lawn_service_active, lawn_service_frequency,
  lawn_service_day, lawn_biweekly_anchor_date,
  housekeeping_service_active
FROM public.properties
WHERE active IS DISTINCT FROM false
  AND (public.is_active_app_staff() OR public.is_active_app_admin());
ALTER VIEW public.staff_properties OWNER TO postgres;

REVOKE ALL ON TABLE public.staff_properties FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.staff_properties TO authenticated;

CREATE OR REPLACE VIEW public.manager_properties
WITH (security_barrier = true, security_invoker = false)
AS
SELECT
  id, property_name, active, company_branch, client_name, address,
  safetyculture_checklist_url, standard_service_day, service_frequency,
  biweekly_anchor_date, coverage_rule, coverage_days, ical_url,
  pool_service_active, lawn_service_active, lawn_service_day,
  lawn_service_frequency, lawn_biweekly_anchor_date,
  gate_access_instructions, service_notes, equipment_service_info,
  housekeeping_service_active
FROM public.properties
WHERE public.is_active_app_manager() OR public.is_active_app_admin();
ALTER VIEW public.manager_properties OWNER TO postgres;

REVOKE ALL ON TABLE public.manager_properties FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.manager_properties TO authenticated;

CREATE OR REPLACE FUNCTION public.manager_create_task(
  selected_property_id UUID,
  selected_service_date DATE,
  selected_service_type TEXT,
  selected_service_branch TEXT DEFAULT 'pool',
  selected_weekly_service_level TEXT DEFAULT NULL,
  selected_technician_id UUID DEFAULT NULL,
  entered_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  property_row public.properties%ROWTYPE;
  technician_row public.technicians%ROWTYPE;
  new_task_id UUID := gen_random_uuid();
  normalized_branch TEXT;
  normalized_level TEXT;
BEGIN
  IF NOT (public.is_active_app_manager() OR public.is_active_app_admin()) THEN
    RAISE EXCEPTION 'Active manager access required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO property_row
  FROM public.properties
  WHERE id = selected_property_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Property not found' USING ERRCODE = '22023';
  END IF;

  IF selected_technician_id IS NOT NULL THEN
    SELECT * INTO technician_row
    FROM public.technicians
    WHERE id = selected_technician_id AND active IS DISTINCT FROM false;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Active technician not found' USING ERRCODE = '22023';
    END IF;
  END IF;

  normalized_branch := CASE
    WHEN lower(trim(COALESCE(selected_service_branch, ''))) = 'maintenance' THEN 'maintenance'
    WHEN lower(trim(COALESCE(selected_service_branch, ''))) = 'housekeeping' OR selected_service_type = 'Housekeeping' THEN 'housekeeping'
    WHEN lower(trim(COALESCE(selected_service_branch, ''))) = 'lawn' OR selected_service_type = 'Lawn Service' THEN 'lawn'
    ELSE 'pool'
  END;

  normalized_level := CASE
    WHEN selected_service_type = 'Weekly Standard' THEN
      CASE WHEN lower(trim(COALESCE(selected_weekly_service_level, ''))) = 'health_check' THEN 'health_check' ELSE 'full_service' END
    ELSE NULL
  END;

  INSERT INTO public.cleaning_tasks (
    id, property_id, service_date, scheduled_date, suggested_date,
    service_type, service_branch, weekly_service_level,
    technician, technician_id, technician_name,
    status, guest_ready, off_cycle, charge, notes, manually_modified
  ) VALUES (
    new_task_id, selected_property_id, selected_service_date, selected_service_date, selected_service_date,
    selected_service_type, normalized_branch, normalized_level,
    CASE WHEN selected_technician_id IS NULL THEN NULL ELSE technician_row.name END,
    selected_technician_id,
    CASE WHEN selected_technician_id IS NULL THEN NULL ELSE technician_row.name END,
    'Scheduled', selected_service_type = 'Guest Ready', selected_service_type = 'Off-Cycle',
    0, NULLIF(trim(COALESCE(entered_notes, '')), ''), true
  );

  RETURN new_task_id;
END;
$$;

REVOKE ALL ON FUNCTION public.manager_create_task(UUID, DATE, TEXT, TEXT, TEXT, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manager_create_task(UUID, DATE, TEXT, TEXT, TEXT, UUID, TEXT)
  TO authenticated;

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
  IF normalized_branch NOT IN ('pool', 'lawn', 'maintenance', 'housekeeping') THEN
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
