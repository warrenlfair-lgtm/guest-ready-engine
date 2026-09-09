-- Add property-specific Housekeeping pricing and snapshot it onto new Housekeeping tasks.
-- Run manually in the Supabase SQL Editor as the postgres/database owner.
-- Apply after the Manager role/create-task and Housekeeping branch migrations because
-- this migration installs the final Housekeeping-aware Manager RPC definitions.

BEGIN;

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS housekeeping_default_charge NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS housekeeping_labor_amount NUMERIC(10,2) NOT NULL DEFAULT 0;

ALTER TABLE public.properties
  DROP CONSTRAINT IF EXISTS properties_housekeeping_default_charge_check;
ALTER TABLE public.properties
  ADD CONSTRAINT properties_housekeeping_default_charge_check
  CHECK (housekeeping_default_charge >= 0);

ALTER TABLE public.properties
  DROP CONSTRAINT IF EXISTS properties_housekeeping_labor_amount_check;
ALTER TABLE public.properties
  ADD CONSTRAINT properties_housekeeping_labor_amount_check
  CHECK (housekeeping_labor_amount >= 0);

COMMENT ON COLUMN public.properties.housekeeping_default_charge IS
  'Default customer charge snapshotted onto each newly created Housekeeping task.';
COMMENT ON COLUMN public.properties.housekeeping_labor_amount IS
  'Default labor cost snapshotted onto each newly created Housekeeping task.';

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
    status, guest_ready, off_cycle, charge, labor_amount, notes, manually_modified
  ) VALUES (
    new_task_id, selected_property_id, selected_service_date, selected_service_date, selected_service_date,
    selected_service_type, normalized_branch, normalized_level,
    CASE WHEN selected_technician_id IS NULL THEN NULL ELSE technician_row.name END,
    selected_technician_id,
    CASE WHEN selected_technician_id IS NULL THEN NULL ELSE technician_row.name END,
    'Scheduled', selected_service_type = 'Guest Ready', selected_service_type = 'Off-Cycle',
    CASE WHEN normalized_branch = 'housekeeping' THEN property_row.housekeeping_default_charge ELSE 0 END,
    CASE WHEN normalized_branch = 'housekeeping' THEN property_row.housekeeping_labor_amount ELSE NULL END,
    NULLIF(trim(COALESCE(entered_notes, '')), ''), true
  );

  RETURN new_task_id;
END;
$$;

REVOKE ALL ON FUNCTION public.manager_create_task(UUID, DATE, TEXT, TEXT, TEXT, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manager_create_task(UUID, DATE, TEXT, TEXT, TEXT, UUID, TEXT)
  TO authenticated;

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
      WHEN COALESCE(task_row.service_branch, 'pool') = 'housekeeping' THEN task_row.labor_amount
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
      WHEN COALESCE(task_row.service_branch, 'pool') = 'housekeeping' THEN task_row.labor_amount
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

REVOKE ALL ON FUNCTION public.manager_update_task_operations(UUID, UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.manager_complete_task(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manager_update_task_operations(UUID, UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.manager_complete_task(UUID, UUID) TO authenticated;

COMMIT;
