-- Allow Managers to record operational chemical usage without exposing financial fields.
-- Run manually in the Supabase SQL Editor as the postgres/database owner.

BEGIN;

CREATE OR REPLACE VIEW public.manager_chemicals
WITH (security_barrier = true, security_invoker = false)
AS
SELECT id, name, default_unit, active
FROM public.chemicals
WHERE active IS DISTINCT FROM false
  AND (public.is_active_app_manager() OR public.is_active_app_admin());
ALTER VIEW public.manager_chemicals OWNER TO postgres;

CREATE OR REPLACE VIEW public.manager_chemical_usage
WITH (security_barrier = true, security_invoker = false)
AS
SELECT
  id, task_id, property_id, property_name, service_date,
  chemical_id, chemical_name, quantity, unit, notes, created_by, created_at
FROM public.chemical_usage
WHERE public.is_active_app_manager() OR public.is_active_app_admin();
ALTER VIEW public.manager_chemical_usage OWNER TO postgres;

REVOKE ALL ON TABLE public.manager_chemicals FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.manager_chemical_usage FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.manager_chemicals TO authenticated;
GRANT SELECT ON TABLE public.manager_chemical_usage TO authenticated;

CREATE OR REPLACE FUNCTION public.staff_save_chemical_usage(
  target_entry_id UUID,
  target_task_id UUID,
  selected_chemical_id UUID,
  entered_quantity NUMERIC,
  entered_unit TEXT,
  entered_notes TEXT DEFAULT NULL
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

  SELECT * INTO task_row
  FROM public.cleaning_tasks
  WHERE id = target_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(task_row.service_branch, 'pool') <> 'pool' THEN
    RAISE EXCEPTION 'Chemical usage is only available for pool tasks' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO property_row
  FROM public.properties
  WHERE id = task_row.property_id;

  SELECT * INTO chemical_row
  FROM public.chemicals
  WHERE id = selected_chemical_id
    AND active IS DISTINCT FROM false;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active chemical not found' USING ERRCODE = '22023';
  END IF;

  IF target_entry_id IS NULL THEN
    INSERT INTO public.chemical_usage (
      task_id, property_id, property_name, service_date, chemical_id,
      chemical_name, quantity, unit, notes, created_by
    ) VALUES (
      task_row.id, task_row.property_id, property_row.property_name,
      COALESCE(task_row.service_date, task_row.scheduled_date), chemical_row.id,
      chemical_row.name, entered_quantity, trim(entered_unit),
      NULLIF(trim(COALESCE(entered_notes, '')), ''),
      COALESCE(auth.jwt() ->> 'email', 'Staff')
    )
    RETURNING id INTO saved_id;
  ELSE
    UPDATE public.chemical_usage
    SET chemical_id = chemical_row.id,
        chemical_name = chemical_row.name,
        quantity = entered_quantity,
        unit = trim(entered_unit),
        notes = NULLIF(trim(COALESCE(entered_notes, '')), '')
    WHERE id = target_entry_id
      AND task_id = target_task_id
    RETURNING id INTO saved_id;
    IF saved_id IS NULL THEN
      RAISE EXCEPTION 'Chemical usage entry not found' USING ERRCODE = '22023';
    END IF;
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
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pool chemical usage entry not found' USING ERRCODE = '22023';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.manager_save_chemical_usage(
  target_entry_id UUID,
  target_task_id UUID,
  selected_chemical_id UUID,
  entered_quantity NUMERIC,
  entered_unit TEXT,
  entered_notes TEXT DEFAULT NULL
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
  IF NOT public.is_active_app_manager() THEN
    RAISE EXCEPTION 'Active manager access required' USING ERRCODE = '42501';
  END IF;
  IF entered_quantity IS NULL OR entered_quantity <= 0 OR trim(COALESCE(entered_unit, '')) = '' THEN
    RAISE EXCEPTION 'Quantity and unit are required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO task_row
  FROM public.cleaning_tasks
  WHERE id = target_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(task_row.service_branch, 'pool') <> 'pool' THEN
    RAISE EXCEPTION 'Chemical usage is only available for pool tasks' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO property_row
  FROM public.properties
  WHERE id = task_row.property_id;

  SELECT * INTO chemical_row
  FROM public.chemicals
  WHERE id = selected_chemical_id
    AND active IS DISTINCT FROM false;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active chemical not found' USING ERRCODE = '22023';
  END IF;

  IF target_entry_id IS NULL THEN
    INSERT INTO public.chemical_usage (
      task_id, property_id, property_name, service_date, chemical_id,
      chemical_name, quantity, unit, notes, created_by
    ) VALUES (
      task_row.id, task_row.property_id, property_row.property_name,
      COALESCE(task_row.service_date, task_row.scheduled_date), chemical_row.id,
      chemical_row.name, entered_quantity, trim(entered_unit),
      NULLIF(trim(COALESCE(entered_notes, '')), ''),
      COALESCE(auth.jwt() ->> 'email', 'Manager')
    )
    RETURNING id INTO saved_id;
  ELSE
    UPDATE public.chemical_usage
    SET chemical_id = chemical_row.id,
        chemical_name = chemical_row.name,
        quantity = entered_quantity,
        unit = trim(entered_unit),
        notes = NULLIF(trim(COALESCE(entered_notes, '')), '')
    WHERE id = target_entry_id
      AND task_id = target_task_id
    RETURNING id INTO saved_id;
    IF saved_id IS NULL THEN
      RAISE EXCEPTION 'Chemical usage entry not found' USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN saved_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.manager_delete_chemical_usage(target_entry_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_active_app_manager() THEN
    RAISE EXCEPTION 'Active manager access required' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.chemical_usage AS usage
  USING public.cleaning_tasks AS task
  WHERE usage.id = target_entry_id
    AND task.id = usage.task_id
    AND COALESCE(task.service_branch, 'pool') = 'pool';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pool chemical usage entry not found' USING ERRCODE = '22023';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.manager_save_chemical_usage(UUID, UUID, UUID, NUMERIC, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.manager_delete_chemical_usage(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.staff_save_chemical_usage(UUID, UUID, UUID, NUMERIC, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.staff_delete_chemical_usage(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manager_save_chemical_usage(UUID, UUID, UUID, NUMERIC, TEXT, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.manager_delete_chemical_usage(UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_save_chemical_usage(UUID, UUID, UUID, NUMERIC, TEXT, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_delete_chemical_usage(UUID)
  TO authenticated;

COMMIT;
