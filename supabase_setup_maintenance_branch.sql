-- Add Maintenance as a third service branch without rewriting existing task or Pipeline history.
-- Run manually in the Supabase SQL Editor as the postgres/database owner.

BEGIN;

ALTER TABLE public.cleaning_tasks
DROP CONSTRAINT IF EXISTS cleaning_tasks_service_branch_check;
ALTER TABLE public.cleaning_tasks
ADD CONSTRAINT cleaning_tasks_service_branch_check
CHECK (service_branch IN ('pool', 'lawn', 'maintenance'));

ALTER TABLE public.invoice_items
DROP CONSTRAINT IF EXISTS invoice_items_service_branch_check;
ALTER TABLE public.invoice_items
ADD CONSTRAINT invoice_items_service_branch_check
CHECK (service_branch IS NULL OR service_branch IN ('pool', 'lawn', 'maintenance'));

ALTER TABLE public.pipeline_jobs
DROP CONSTRAINT IF EXISTS pipeline_jobs_service_branch_check;
ALTER TABLE public.pipeline_jobs
ADD CONSTRAINT pipeline_jobs_service_branch_check
CHECK (service_branch IN ('pool', 'lawn', 'maintenance'));

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
  normalized_type TEXT;
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

  normalized_branch := CASE lower(trim(COALESCE(selected_service_branch, 'pool')))
    WHEN 'lawn' THEN 'lawn'
    WHEN 'maintenance' THEN 'maintenance'
    ELSE 'pool'
  END;
  normalized_type := CASE
    WHEN normalized_branch = 'lawn' THEN 'Lawn Service'
    WHEN normalized_branch = 'maintenance'
      AND trim(COALESCE(selected_service_type, '')) IN ('Manual', 'Off-Cycle')
      THEN trim(selected_service_type)
    WHEN normalized_branch = 'maintenance' THEN 'Manual'
    WHEN trim(COALESCE(selected_service_type, '')) <> '' THEN trim(selected_service_type)
    ELSE 'Manual'
  END;
  normalized_level := CASE
    WHEN normalized_type = 'Weekly Standard' THEN
      CASE WHEN lower(trim(COALESCE(selected_weekly_service_level, ''))) = 'health_check' THEN 'health_check' ELSE 'full_service' END
    ELSE NULL
  END;

  INSERT INTO public.cleaning_tasks (
    id, property_id, service_date, scheduled_date, suggested_date,
    service_type, service_branch, weekly_service_level,
    technician, technician_id, technician_name, status,
    guest_ready, off_cycle, charge, notes, manually_modified
  ) VALUES (
    new_task_id, selected_property_id, selected_service_date, selected_service_date, selected_service_date,
    normalized_type, normalized_branch, normalized_level,
    CASE WHEN selected_technician_id IS NULL THEN NULL ELSE technician_row.name END,
    selected_technician_id,
    CASE WHEN selected_technician_id IS NULL THEN NULL ELSE technician_row.name END,
    'Scheduled', false, normalized_type = 'Off-Cycle', 0,
    NULLIF(trim(COALESCE(entered_notes, '')), ''), true
  );

  RETURN new_task_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_and_schedule_pipeline_job(
  target_pipeline_job_id UUID,
  selected_property_id UUID,
  selected_service_date DATE,
  selected_service_branch TEXT,
  selected_service_type TEXT DEFAULT 'Manual',
  selected_technician_id UUID DEFAULT NULL,
  entered_operational_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pipeline_row public.pipeline_jobs%ROWTYPE;
  technician_row public.technicians%ROWTYPE;
  new_task_id UUID := gen_random_uuid();
  normalized_branch TEXT;
  normalized_service_type TEXT;
  task_notes TEXT;
BEGIN
  IF NOT public.is_active_app_admin() THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;
  IF selected_service_date IS NULL THEN
    RAISE EXCEPTION 'Service date is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO pipeline_row
  FROM public.pipeline_jobs
  WHERE id = target_pipeline_job_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pipeline job not found' USING ERRCODE = '22023';
  END IF;
  IF pipeline_row.scheduled_task_id IS NOT NULL OR pipeline_row.status = 'Scheduled' THEN
    RAISE EXCEPTION 'Pipeline job has already been scheduled' USING ERRCODE = '23505';
  END IF;
  IF pipeline_row.status = 'Declined' THEN
    RAISE EXCEPTION 'Reopen the declined pipeline job before scheduling' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.properties WHERE id = selected_property_id) THEN
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

  normalized_branch := CASE lower(trim(COALESCE(selected_service_branch, pipeline_row.service_branch)))
    WHEN 'lawn' THEN 'lawn'
    WHEN 'maintenance' THEN 'maintenance'
    ELSE 'pool'
  END;
  normalized_service_type := CASE
    WHEN normalized_branch = 'lawn' THEN 'Lawn Service'
    WHEN trim(COALESCE(selected_service_type, '')) IN ('Manual', 'Off-Cycle')
      THEN trim(selected_service_type)
    ELSE 'Manual'
  END;
  task_notes := concat_ws(E'\n',
    'Pipeline: ' || pipeline_row.job_title,
    NULLIF(trim(COALESCE(pipeline_row.description, '')), ''),
    NULLIF(trim(COALESCE(entered_operational_notes, '')), '')
  );

  INSERT INTO public.cleaning_tasks (
    id, property_id, service_date, scheduled_date, suggested_date,
    service_type, service_branch, technician, technician_id, technician_name,
    status, guest_ready, off_cycle, charge, labor_amount, parts_cost,
    notes, manually_modified
  ) VALUES (
    new_task_id, selected_property_id, selected_service_date, selected_service_date, selected_service_date,
    normalized_service_type, normalized_branch,
    CASE WHEN selected_technician_id IS NULL THEN NULL ELSE technician_row.name END,
    selected_technician_id,
    CASE WHEN selected_technician_id IS NULL THEN NULL ELSE technician_row.name END,
    'Scheduled', false, pipeline_row.potential_revenue > 0,
    pipeline_row.potential_revenue,
    CASE WHEN pipeline_row.paid_labor THEN pipeline_row.estimated_labor_cost ELSE 0 END,
    pipeline_row.parts_material_cost,
    task_notes, true
  );

  UPDATE public.pipeline_jobs
  SET property_id = selected_property_id,
      service_branch = normalized_branch,
      tentative_date = selected_service_date,
      status = 'Scheduled',
      scheduled_task_id = new_task_id
  WHERE id = target_pipeline_job_id
    AND scheduled_task_id IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pipeline job was scheduled by another request' USING ERRCODE = '23505';
  END IF;

  RETURN new_task_id;
END;
$$;

REVOKE ALL ON FUNCTION public.manager_create_task(UUID, DATE, TEXT, TEXT, TEXT, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.approve_and_schedule_pipeline_job(UUID, UUID, DATE, TEXT, TEXT, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manager_create_task(UUID, DATE, TEXT, TEXT, TEXT, UUID, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_and_schedule_pipeline_job(UUID, UUID, DATE, TEXT, TEXT, UUID, TEXT)
  TO authenticated;

COMMIT;
