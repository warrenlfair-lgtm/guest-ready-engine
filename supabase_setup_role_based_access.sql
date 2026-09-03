-- Real Admin / Staff authorization for Guest Ready Engine.
-- Run manually in the Supabase SQL Editor after the existing setup migrations.
-- This migration never exposes the service-role key to the browser.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.app_user_roles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'staff')),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS gate_access_instructions TEXT,
  ADD COLUMN IF NOT EXISTS service_notes TEXT,
  ADD COLUMN IF NOT EXISTS equipment_service_info TEXT;

-- Preserve an existing owner/admin assignment if Phase 2A company ownership was already run.
DO $$
BEGIN
  IF to_regclass('public.company_users') IS NOT NULL THEN
    INSERT INTO public.app_user_roles (user_id, role, active)
    SELECT DISTINCT cu.user_id, 'admin', true
    FROM public.company_users cu
    WHERE cu.role IN ('owner', 'admin')
      AND cu.user_id IS NOT NULL
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
END $$;

-- Explicit bootstrap for the known existing owner account. Change/add another email here
-- before running if the production admin uses a different Supabase Auth email.
INSERT INTO public.app_user_roles (user_id, role, active)
SELECT id, 'admin', true
FROM auth.users
WHERE lower(email) = lower('warren.l.fair@gmail.com')
ON CONFLICT (user_id) DO UPDATE
SET role = 'admin', active = true, updated_at = now();

CREATE OR REPLACE FUNCTION public.is_active_app_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_user_roles r
    WHERE r.user_id = auth.uid() AND r.role = 'admin' AND r.active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_active_app_staff()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_user_roles r
    WHERE r.user_id = auth.uid() AND r.role = 'staff' AND r.active = true
  );
$$;

REVOKE ALL ON FUNCTION public.is_active_app_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_active_app_staff() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_app_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_app_staff() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_current_app_access()
RETURNS TABLE (user_id UUID, email TEXT, role TEXT, active BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT u.id, u.email::TEXT, r.role, COALESCE(r.active, false)
  FROM auth.users u
  LEFT JOIN public.app_user_roles r ON r.user_id = u.id
  WHERE u.id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.get_current_app_access() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_current_app_access() TO authenticated;

ALTER TABLE public.app_user_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_user_roles_admin_all ON public.app_user_roles;
CREATE POLICY app_user_roles_admin_all ON public.app_user_roles
  FOR ALL TO authenticated
  USING (public.is_active_app_admin())
  WITH CHECK (public.is_active_app_admin());

-- Admin management RPCs avoid granting browser clients direct access to auth.users.
CREATE OR REPLACE FUNCTION public.admin_list_app_users()
RETURNS TABLE (user_id UUID, email TEXT, role TEXT, active BOOLEAN, created_at TIMESTAMPTZ, last_sign_in_at TIMESTAMPTZ)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.is_active_app_admin() THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT u.id, u.email::TEXT, r.role, COALESCE(r.active, false), u.created_at, u.last_sign_in_at
  FROM auth.users u
  LEFT JOIN public.app_user_roles r ON r.user_id = u.id
  ORDER BY lower(u.email);
END;
$$;

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
  IF next_role NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Role must be admin or staff' USING ERRCODE = '22023';
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

REVOKE ALL ON FUNCTION public.admin_list_app_users() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_app_user_role(UUID, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_app_users() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_app_user_role(UUID, TEXT, BOOLEAN) TO authenticated;

-- Replace permissive policies on business tables with admin-only base-table access.
DO $$
DECLARE
  table_name TEXT;
  policy_row RECORD;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'properties', 'cleaning_tasks', 'reservations', 'operations_reminders',
    'chemicals', 'chemical_usage', 'technicians', 'company_profile',
    'invoices', 'invoice_items', 'expenses', 'property_contract_revenue_history'
  ]
  LOOP
    IF to_regclass('public.' || table_name) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', table_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated', table_name);
    FOR policy_row IN
      SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = table_name
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_row.policyname, table_name);
    END LOOP;
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_active_app_admin()) WITH CHECK (public.is_active_app_admin())',
      table_name || '_admin_all', table_name
    );
  END LOOP;
END $$;

-- Staff-safe read models. These views intentionally omit every financial column.
CREATE OR REPLACE VIEW public.staff_properties
WITH (security_barrier = true)
AS
SELECT
  id, property_name, address, safetyculture_checklist_url,
  gate_access_instructions, service_notes, equipment_service_info,
  standard_service_day, service_frequency, biweekly_anchor_date,
  active, pool_service_active, lawn_service_active, lawn_service_frequency,
  lawn_service_day, lawn_biweekly_anchor_date
FROM public.properties
WHERE active IS DISTINCT FROM false
  AND (public.is_active_app_staff() OR public.is_active_app_admin());

CREATE OR REPLACE VIEW public.staff_cleaning_tasks
WITH (security_barrier = true)
AS
SELECT
  id, property_id, service_date, scheduled_date, suggested_date,
  check_in_date, service_type, service_branch, weekly_service_level, status,
  technician, technician_id, technician_name, completed_by_technician_id,
  completed_by_technician_name, notes, guest_ready, off_cycle, completed_at,
  source_type, source_key, manually_modified
FROM public.cleaning_tasks
WHERE public.is_active_app_staff() OR public.is_active_app_admin();

CREATE OR REPLACE VIEW public.staff_reservations
WITH (security_barrier = true)
AS
SELECT id, property_id, check_in, check_out, status
FROM public.reservations
WHERE public.is_active_app_staff() OR public.is_active_app_admin();

CREATE OR REPLACE VIEW public.staff_technicians
WITH (security_barrier = true)
AS
SELECT id, name, active
FROM public.technicians
WHERE active IS DISTINCT FROM false
  AND (public.is_active_app_staff() OR public.is_active_app_admin());

CREATE OR REPLACE VIEW public.staff_chemicals
WITH (security_barrier = true)
AS
SELECT id, name, default_unit, active
FROM public.chemicals
WHERE active IS DISTINCT FROM false
  AND (public.is_active_app_staff() OR public.is_active_app_admin());

CREATE OR REPLACE VIEW public.staff_chemical_usage
WITH (security_barrier = true)
AS
SELECT id, task_id, property_id, property_name, service_date,
       chemical_id, chemical_name, quantity, unit, notes, created_by, created_at
FROM public.chemical_usage
WHERE public.is_active_app_staff() OR public.is_active_app_admin();

CREATE OR REPLACE VIEW public.staff_company_profile
WITH (security_barrier = true)
AS
SELECT id, company_name, tagline, phone_number, email, logo_url,
       guest_ready_logo_url, weekend_ready_logo_url
FROM public.company_profile
WHERE public.is_active_app_staff() OR public.is_active_app_admin();

REVOKE ALL ON public.staff_properties, public.staff_cleaning_tasks,
  public.staff_reservations, public.staff_technicians, public.staff_chemicals,
  public.staff_chemical_usage, public.staff_company_profile FROM PUBLIC, anon;
GRANT SELECT ON public.staff_properties, public.staff_cleaning_tasks,
  public.staff_reservations, public.staff_technicians, public.staff_chemicals,
  public.staff_chemical_usage, public.staff_company_profile TO authenticated;

-- Narrow staff task mutations. Labor snapshots are calculated server-side without
-- returning rates or amounts to staff.
CREATE OR REPLACE FUNCTION public.staff_start_task(target_task_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_active_app_staff() THEN
    RAISE EXCEPTION 'Active staff access required' USING ERRCODE = '42501';
  END IF;
  UPDATE public.cleaning_tasks
  SET status = 'In Progress'
  WHERE id = target_task_id AND lower(COALESCE(status, 'scheduled')) NOT IN ('completed', 'cancelled', 'void', 'deleted');
  IF NOT FOUND THEN RAISE EXCEPTION 'Task is not available to start' USING ERRCODE = '22023'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_complete_task(target_task_id UUID, selected_technician_id UUID DEFAULT NULL)
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
  IF NOT public.is_active_app_staff() THEN
    RAISE EXCEPTION 'Active staff access required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO task_row FROM public.cleaning_tasks WHERE id = target_task_id FOR UPDATE;
  IF NOT FOUND OR lower(COALESCE(task_row.status, '')) IN ('cancelled', 'void', 'deleted') THEN
    RAISE EXCEPTION 'Task is not available to complete' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO property_row FROM public.properties WHERE id = task_row.property_id;

  IF selected_technician_id IS NOT NULL THEN
    SELECT * INTO technician_row FROM public.technicians
    WHERE id = selected_technician_id AND active IS DISTINCT FROM false;
    IF NOT FOUND THEN RAISE EXCEPTION 'Active technician not found' USING ERRCODE = '22023'; END IF;

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

CREATE OR REPLACE FUNCTION public.staff_save_chemical_usage(
  target_entry_id UUID, target_task_id UUID, selected_chemical_id UUID,
  entered_quantity NUMERIC, entered_unit TEXT, entered_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  task_row public.cleaning_tasks%ROWTYPE;
  property_row public.properties%ROWTYPE;
  chemical_row public.chemicals%ROWTYPE;
  saved_id UUID;
BEGIN
  IF NOT public.is_active_app_staff() THEN
    RAISE EXCEPTION 'Active staff access required' USING ERRCODE = '42501';
  END IF;
  IF entered_quantity IS NULL OR entered_quantity <= 0 OR trim(COALESCE(entered_unit, '')) = '' THEN
    RAISE EXCEPTION 'Quantity and unit are required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO task_row FROM public.cleaning_tasks WHERE id = target_task_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Task not found' USING ERRCODE = '22023'; END IF;
  IF COALESCE(task_row.service_branch, 'pool') <> 'pool' THEN
    RAISE EXCEPTION 'Chemical usage is only available for pool tasks' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO property_row FROM public.properties WHERE id = task_row.property_id;
  SELECT * INTO chemical_row FROM public.chemicals
  WHERE id = selected_chemical_id AND active IS DISTINCT FROM false;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active chemical not found' USING ERRCODE = '22023'; END IF;

  IF target_entry_id IS NULL THEN
    INSERT INTO public.chemical_usage (
      task_id, property_id, property_name, service_date, chemical_id,
      chemical_name, quantity, unit, notes, created_by
    ) VALUES (
      task_row.id, task_row.property_id, property_row.property_name,
      COALESCE(task_row.service_date, task_row.scheduled_date), chemical_row.id,
      chemical_row.name, entered_quantity, trim(entered_unit), NULLIF(trim(COALESCE(entered_notes, '')), ''),
      COALESCE(auth.jwt() ->> 'email', 'Staff')
    ) RETURNING id INTO saved_id;
  ELSE
    UPDATE public.chemical_usage
    SET chemical_id = chemical_row.id, chemical_name = chemical_row.name,
        quantity = entered_quantity, unit = trim(entered_unit),
        notes = NULLIF(trim(COALESCE(entered_notes, '')), '')
    WHERE id = target_entry_id AND task_id = target_task_id
    RETURNING id INTO saved_id;
    IF saved_id IS NULL THEN RAISE EXCEPTION 'Chemical usage entry not found' USING ERRCODE = '22023'; END IF;
  END IF;
  RETURN saved_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_delete_chemical_usage(target_entry_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_active_app_staff() THEN
    RAISE EXCEPTION 'Active staff access required' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.chemical_usage AS usage
  USING public.cleaning_tasks AS task
  WHERE usage.id = target_entry_id
    AND task.id = usage.task_id
    AND COALESCE(task.service_branch, 'pool') = 'pool';
  IF NOT FOUND THEN RAISE EXCEPTION 'Pool chemical usage entry not found' USING ERRCODE = '22023'; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.staff_start_task(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.staff_complete_task(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.staff_save_chemical_usage(UUID, UUID, UUID, NUMERIC, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.staff_delete_chemical_usage(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_start_task(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_complete_task(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_save_chemical_usage(UUID, UUID, UUID, NUMERIC, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_delete_chemical_usage(UUID) TO authenticated;

-- Keep public logo reads for rendering, but require an active admin for storage changes.
DROP POLICY IF EXISTS "Allow logo uploads" ON storage.objects;
DROP POLICY IF EXISTS "Allow logo updates" ON storage.objects;
DROP POLICY IF EXISTS "Allow logo deletes" ON storage.objects;
DROP POLICY IF EXISTS company_logos_admin_insert ON storage.objects;
DROP POLICY IF EXISTS company_logos_admin_update ON storage.objects;
DROP POLICY IF EXISTS company_logos_admin_delete ON storage.objects;
CREATE POLICY company_logos_admin_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'company-logos' AND public.is_active_app_admin());
CREATE POLICY company_logos_admin_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'company-logos' AND public.is_active_app_admin())
  WITH CHECK (bucket_id = 'company-logos' AND public.is_active_app_admin());
CREATE POLICY company_logos_admin_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'company-logos' AND public.is_active_app_admin());

COMMIT;

-- Verification: this should return your existing account as active admin.
SELECT u.email, r.role, r.active
FROM auth.users u
LEFT JOIN public.app_user_roles r ON r.user_id = u.id
ORDER BY lower(u.email);
