-- Add the Manager role with operational-only database access.
-- Run manually in the Supabase SQL Editor as the postgres/database owner.

BEGIN;

DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT con.conname
    FROM pg_constraint AS con
    WHERE con.conrelid = 'public.app_user_roles'::regclass
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE public.app_user_roles DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE public.app_user_roles
  ADD CONSTRAINT app_user_roles_role_check
  CHECK (role IN ('admin', 'manager', 'staff'));

CREATE OR REPLACE FUNCTION public.is_active_app_manager()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.app_user_roles AS role_row
    WHERE role_row.user_id = auth.uid()
      AND role_row.role = 'manager'
      AND role_row.active = true
  );
$$;

REVOKE ALL ON FUNCTION public.is_active_app_manager() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_app_manager() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_app_user_role(target_user_id UUID, next_role TEXT, next_active BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.is_active_app_admin() THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;
  IF next_role NOT IN ('admin', 'manager', 'staff') THEN
    RAISE EXCEPTION 'Role must be admin, manager, or staff' USING ERRCODE = '22023';
  END IF;
  IF target_user_id = auth.uid() AND (next_role <> 'admin' OR next_active IS NOT TRUE) THEN
    RAISE EXCEPTION 'Admins cannot remove or deactivate their own admin access' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = target_user_id) THEN
    RAISE EXCEPTION 'Auth user not found' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.app_user_roles (user_id, role, active)
  VALUES (target_user_id, next_role, COALESCE(next_active, false))
  ON CONFLICT (user_id) DO UPDATE
  SET role = EXCLUDED.role, active = EXCLUDED.active, updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_app_user_role(UUID, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_app_user_role(UUID, TEXT, BOOLEAN) TO authenticated;

CREATE OR REPLACE VIEW public.manager_properties
WITH (security_barrier = true, security_invoker = false)
AS
SELECT
  id, property_name, active, company_branch, client_name, address,
  safetyculture_checklist_url, standard_service_day, service_frequency,
  biweekly_anchor_date, coverage_rule, coverage_days, ical_url,
  pool_service_active, lawn_service_active, lawn_service_day,
  lawn_service_frequency, lawn_biweekly_anchor_date,
  gate_access_instructions, service_notes, equipment_service_info
FROM public.properties
WHERE public.is_active_app_manager() OR public.is_active_app_admin();
ALTER VIEW public.manager_properties OWNER TO postgres;

CREATE OR REPLACE VIEW public.manager_cleaning_tasks
WITH (security_barrier = true, security_invoker = false)
AS
SELECT
  id, property_id, service_date, scheduled_date, suggested_date,
  check_in_date, service_type, service_branch, weekly_service_level, status,
  technician, technician_id, technician_name, completed_by_technician_id,
  completed_by_technician_name, notes, guest_ready, off_cycle, completed_at,
  source_type, source_key, manually_modified,
  (
    lower(COALESCE(status, 'scheduled')) IN ('scheduled', 'in progress', 'in_progress')
    AND completed_at IS NULL
    AND invoiced IS DISTINCT FROM true
    AND invoice_id IS NULL
    AND invoiced_invoice_id IS NULL
    AND same_day_surcharge_reconciled IS DISTINCT FROM true
    AND same_day_surcharge_invoice_id IS NULL
    AND COALESCE(service_date, scheduled_date) >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::DATE
  ) AS month_reschedule_eligible
FROM public.cleaning_tasks
WHERE public.is_active_app_manager() OR public.is_active_app_admin();
ALTER VIEW public.manager_cleaning_tasks OWNER TO postgres;

CREATE OR REPLACE VIEW public.manager_reservations
WITH (security_barrier = true, security_invoker = false)
AS
SELECT id, property_id, check_in, check_out, status
FROM public.reservations
WHERE public.is_active_app_manager() OR public.is_active_app_admin();
ALTER VIEW public.manager_reservations OWNER TO postgres;

CREATE OR REPLACE VIEW public.manager_technicians
WITH (security_barrier = true, security_invoker = false)
AS
SELECT id, name, active
FROM public.technicians
WHERE active IS DISTINCT FROM false
  AND (public.is_active_app_manager() OR public.is_active_app_admin());
ALTER VIEW public.manager_technicians OWNER TO postgres;

CREATE OR REPLACE VIEW public.manager_operations_reminders
WITH (security_barrier = true, security_invoker = false)
AS
SELECT id, property_id, title, notes, due_date, status, created_at
FROM public.operations_reminders
WHERE public.is_active_app_manager() OR public.is_active_app_admin();
ALTER VIEW public.manager_operations_reminders OWNER TO postgres;

CREATE OR REPLACE VIEW public.manager_company_profile
WITH (security_barrier = true, security_invoker = false)
AS
SELECT id, company_name, tagline, phone_number, email, logo_url,
       guest_ready_logo_url, weekend_ready_logo_url
FROM public.company_profile
WHERE public.is_active_app_manager() OR public.is_active_app_admin();
ALTER VIEW public.manager_company_profile OWNER TO postgres;

REVOKE ALL ON TABLE public.manager_properties, public.manager_cleaning_tasks,
  public.manager_reservations, public.manager_technicians,
  public.manager_operations_reminders, public.manager_company_profile
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.manager_properties, public.manager_cleaning_tasks,
  public.manager_reservations, public.manager_technicians,
  public.manager_operations_reminders, public.manager_company_profile
  TO authenticated;

CREATE OR REPLACE FUNCTION public.manager_start_task(target_task_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_active_app_manager() THEN
    RAISE EXCEPTION 'Active manager access required' USING ERRCODE = '42501';
  END IF;
  UPDATE public.cleaning_tasks
  SET status = 'In Progress'
  WHERE id = target_task_id
    AND lower(COALESCE(status, 'scheduled')) NOT IN ('completed', 'cancelled', 'void', 'deleted');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task is not available to start' USING ERRCODE = '22023';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.manager_update_task_operations(
  target_task_id UUID,
  selected_technician_id UUID,
  selected_service_level TEXT,
  entered_notes TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  task_row public.cleaning_tasks%ROWTYPE;
  property_row public.properties%ROWTYPE;
  technician_row public.technicians%ROWTYPE;
  labor_value NUMERIC;
BEGIN
  IF NOT public.is_active_app_manager() THEN
    RAISE EXCEPTION 'Active manager access required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO task_row
  FROM public.cleaning_tasks
  WHERE id = target_task_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found' USING ERRCODE = '22023';
  END IF;

  IF selected_technician_id IS NOT NULL THEN
    SELECT * INTO technician_row
    FROM public.technicians
    WHERE id = selected_technician_id AND active IS DISTINCT FROM false;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Active technician not found' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF task_row.service_type = 'Weekly Standard'
     AND selected_service_level NOT IN ('full_service', 'health_check') THEN
    RAISE EXCEPTION 'Invalid service level' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO property_row FROM public.properties WHERE id = task_row.property_id;
  IF task_row.status = 'Completed' AND selected_technician_id IS NOT NULL THEN
    labor_value := CASE
      WHEN COALESCE(task_row.service_branch, 'pool') = 'lawn' THEN COALESCE(property_row.lawn_labor_amount, 0)
      WHEN task_row.service_type = 'Weekly Standard' THEN COALESCE(property_row.weekly_service_labor, 0)
        * CASE WHEN selected_service_level = 'health_check' THEN 0.5 ELSE 1 END
      WHEN task_row.guest_ready IS TRUE OR task_row.service_type = 'Guest Ready' THEN COALESCE(property_row.guest_ready_service_labor, 0)
      WHEN lower(COALESCE(task_row.service_type, '')) = 'manual' THEN task_row.labor_amount
      ELSE COALESCE(property_row.additional_cleaning_labor, 0)
    END;
  END IF;

  UPDATE public.cleaning_tasks
  SET technician = CASE WHEN selected_technician_id IS NULL THEN NULL ELSE technician_row.name END,
      technician_id = selected_technician_id,
      technician_name = CASE WHEN selected_technician_id IS NULL THEN NULL ELSE technician_row.name END,
      weekly_service_level = CASE
        WHEN task_row.service_type = 'Weekly Standard' THEN selected_service_level
        ELSE weekly_service_level
      END,
      notes = NULLIF(trim(COALESCE(entered_notes, '')), ''),
      completed_by_technician_id = CASE
        WHEN task_row.status = 'Completed' THEN selected_technician_id
        ELSE completed_by_technician_id
      END,
      completed_by_technician_name = CASE
        WHEN task_row.status = 'Completed' AND selected_technician_id IS NOT NULL THEN technician_row.name
        WHEN task_row.status = 'Completed' THEN NULL
        ELSE completed_by_technician_name
      END,
      labor_amount = CASE
        WHEN task_row.status = 'Completed' AND selected_technician_id IS NOT NULL THEN labor_value
        ELSE labor_amount
      END,
      labor_calculated_at = CASE
        WHEN task_row.status = 'Completed' AND selected_technician_id IS NOT NULL THEN now()
        ELSE labor_calculated_at
      END,
      labor_payable = CASE
        WHEN task_row.status = 'Completed' AND selected_technician_id IS NOT NULL THEN technician_row.paid_labor IS DISTINCT FROM false
        ELSE labor_payable
      END
  WHERE id = target_task_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.manager_complete_task(target_task_id UUID, selected_technician_id UUID DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  task_row public.cleaning_tasks%ROWTYPE;
  property_row public.properties%ROWTYPE;
  technician_row public.technicians%ROWTYPE;
  labor_value NUMERIC;
  completed_time TIMESTAMPTZ := now();
BEGIN
  IF NOT public.is_active_app_manager() THEN
    RAISE EXCEPTION 'Active manager access required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO task_row FROM public.cleaning_tasks WHERE id = target_task_id FOR UPDATE;
  IF NOT FOUND OR lower(COALESCE(task_row.status, '')) IN ('cancelled', 'void', 'deleted') THEN
    RAISE EXCEPTION 'Task is not available to complete' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO property_row FROM public.properties WHERE id = task_row.property_id;

  IF selected_technician_id IS NOT NULL THEN
    SELECT * INTO technician_row FROM public.technicians
    WHERE id = selected_technician_id AND active IS DISTINCT FROM false;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Active technician not found' USING ERRCODE = '22023';
    END IF;

    labor_value := CASE
      WHEN COALESCE(task_row.service_branch, 'pool') = 'lawn' THEN COALESCE(property_row.lawn_labor_amount, 0)
      WHEN task_row.service_type = 'Weekly Standard' THEN COALESCE(property_row.weekly_service_labor, 0)
        * CASE WHEN task_row.weekly_service_level = 'health_check' THEN 0.5 ELSE 1 END
      WHEN task_row.guest_ready IS TRUE OR task_row.service_type = 'Guest Ready' THEN COALESCE(property_row.guest_ready_service_labor, 0)
      WHEN lower(COALESCE(task_row.service_type, '')) = 'manual' THEN task_row.labor_amount
      ELSE COALESCE(property_row.additional_cleaning_labor, 0)
    END;
  END IF;

  UPDATE public.cleaning_tasks
  SET status = 'Completed',
      completed_at = COALESCE(completed_at, completed_time),
      technician = CASE WHEN selected_technician_id IS NULL THEN technician ELSE technician_row.name END,
      technician_id = COALESCE(selected_technician_id, technician_id),
      technician_name = CASE WHEN selected_technician_id IS NULL THEN technician_name ELSE technician_row.name END,
      completed_by_technician_id = COALESCE(selected_technician_id, completed_by_technician_id),
      completed_by_technician_name = CASE WHEN selected_technician_id IS NULL THEN completed_by_technician_name ELSE technician_row.name END,
      labor_amount = CASE WHEN selected_technician_id IS NULL THEN labor_amount ELSE labor_value END,
      labor_calculated_at = CASE WHEN selected_technician_id IS NULL THEN labor_calculated_at ELSE completed_time END,
      labor_payable = CASE WHEN selected_technician_id IS NULL THEN labor_payable ELSE technician_row.paid_labor IS DISTINCT FROM false END
  WHERE id = target_task_id;
END;
$$;

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
  business_date DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::DATE;
BEGIN
  IF NOT (public.is_active_app_manager() OR public.is_active_app_admin()) THEN
    RAISE EXCEPTION 'Active manager or admin access required' USING ERRCODE = '42501';
  END IF;
  IF selected_service_date IS NULL OR selected_service_date < business_date THEN
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
     OR task_row.completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Completed or inactive tasks cannot be rescheduled' USING ERRCODE = '22023';
  END IF;
  IF task_row.invoiced IS TRUE
     OR task_row.invoice_id IS NOT NULL
     OR task_row.invoiced_invoice_id IS NOT NULL
     OR task_row.same_day_surcharge_reconciled IS TRUE
     OR task_row.same_day_surcharge_invoice_id IS NOT NULL THEN
    RAISE EXCEPTION 'Reconciled or invoiced tasks cannot be rescheduled' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(task_row.service_date, task_row.scheduled_date) < business_date THEN
    RAISE EXCEPTION 'Historical tasks cannot be rescheduled' USING ERRCODE = '22023';
  END IF;

  UPDATE public.cleaning_tasks
  SET service_date = selected_service_date,
      scheduled_date = selected_service_date,
      manually_modified = true
  WHERE id = target_task_id;
END;
$$;

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
  IF normalized_branch NOT IN ('pool', 'lawn', 'maintenance') THEN
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

REVOKE ALL ON FUNCTION public.manager_start_task(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.manager_update_task_operations(UUID, UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.manager_complete_task(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.manager_reschedule_task(UUID, DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.manager_update_task_service_branch(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manager_start_task(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.manager_update_task_operations(UUID, UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.manager_complete_task(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.manager_reschedule_task(UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.manager_update_task_service_branch(UUID, TEXT) TO authenticated;

COMMIT;
