-- Allow active Managers to create operational tasks without setting financial fields.
-- Run manually in the Supabase SQL Editor as the postgres/database owner if Manager task creation is enabled.

BEGIN;

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
    WHEN lower(trim(COALESCE(selected_service_branch, ''))) = 'lawn' OR selected_service_type = 'Lawn Service' THEN 'lawn'
    ELSE 'pool'
  END;

  normalized_level := CASE
    WHEN selected_service_type = 'Weekly Standard' THEN
      CASE WHEN lower(trim(COALESCE(selected_weekly_service_level, ''))) = 'health_check' THEN 'health_check' ELSE 'full_service' END
    ELSE NULL
  END;

  INSERT INTO public.cleaning_tasks (
    id,
    property_id,
    service_date,
    scheduled_date,
    suggested_date,
    service_type,
    service_branch,
    weekly_service_level,
    technician,
    technician_id,
    technician_name,
    status,
    guest_ready,
    off_cycle,
    charge,
    notes,
    manually_modified
  ) VALUES (
    new_task_id,
    selected_property_id,
    selected_service_date,
    selected_service_date,
    selected_service_date,
    selected_service_type,
    normalized_branch,
    normalized_level,
    CASE WHEN selected_technician_id IS NULL THEN NULL ELSE technician_row.name END,
    selected_technician_id,
    CASE WHEN selected_technician_id IS NULL THEN NULL ELSE technician_row.name END,
    'Scheduled',
    selected_service_type = 'Guest Ready',
    selected_service_type = 'Off-Cycle',
    0,
    NULLIF(trim(COALESCE(entered_notes, '')), ''),
    true
  );

  RETURN new_task_id;
END;
$$;

REVOKE ALL ON FUNCTION public.manager_create_task(UUID, DATE, TEXT, TEXT, TEXT, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manager_create_task(UUID, DATE, TEXT, TEXT, TEXT, UUID, TEXT) TO authenticated;

COMMIT;
