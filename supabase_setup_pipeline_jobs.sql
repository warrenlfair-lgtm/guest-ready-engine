-- Admin-only potential work pipeline and atomic conversion to normal cleaning tasks.
-- Run manually in the Supabase SQL Editor after role-based access and task cost migrations.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.pipeline_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID,
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE RESTRICT,
  job_title TEXT NOT NULL CHECK (trim(job_title) <> ''),
  description TEXT,
  service_branch TEXT NOT NULL DEFAULT 'pool' CHECK (service_branch IN ('pool', 'lawn')),
  potential_revenue NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (potential_revenue >= 0),
  parts_material_cost NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (parts_material_cost >= 0),
  paid_labor BOOLEAN NOT NULL DEFAULT false,
  estimated_labor_cost NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (estimated_labor_cost >= 0),
  tentative_date DATE,
  status TEXT NOT NULL DEFAULT 'Lead' CHECK (trim(status) <> ''),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  scheduled_task_id UUID REFERENCES public.cleaning_tasks(id) ON DELETE RESTRICT,
  CONSTRAINT pipeline_jobs_labor_cost_check CHECK (paid_labor OR estimated_labor_cost = 0),
  CONSTRAINT pipeline_jobs_scheduled_state_check CHECK (
    scheduled_task_id IS NULL OR status = 'Scheduled'
  )
);

CREATE INDEX IF NOT EXISTS pipeline_jobs_property_id_idx
  ON public.pipeline_jobs(property_id);
CREATE INDEX IF NOT EXISTS pipeline_jobs_status_idx
  ON public.pipeline_jobs(status);
CREATE UNIQUE INDEX IF NOT EXISTS pipeline_jobs_scheduled_task_id_uidx
  ON public.pipeline_jobs(scheduled_task_id)
  WHERE scheduled_task_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.set_pipeline_job_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pipeline_jobs_set_updated_at ON public.pipeline_jobs;
CREATE TRIGGER pipeline_jobs_set_updated_at
BEFORE UPDATE ON public.pipeline_jobs
FOR EACH ROW EXECUTE FUNCTION public.set_pipeline_job_updated_at();

CREATE OR REPLACE FUNCTION public.protect_scheduled_pipeline_job_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.scheduled_task_id IS NOT NULL THEN
    RAISE EXCEPTION 'Scheduled pipeline history cannot be deleted' USING ERRCODE = '23503';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS pipeline_jobs_protect_scheduled_delete ON public.pipeline_jobs;
CREATE TRIGGER pipeline_jobs_protect_scheduled_delete
BEFORE DELETE ON public.pipeline_jobs
FOR EACH ROW EXECUTE FUNCTION public.protect_scheduled_pipeline_job_delete();

ALTER TABLE public.pipeline_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pipeline_jobs_admin_all ON public.pipeline_jobs;
CREATE POLICY pipeline_jobs_admin_all ON public.pipeline_jobs
  FOR ALL TO authenticated
  USING (public.is_active_app_admin())
  WITH CHECK (public.is_active_app_admin());

REVOKE ALL ON TABLE public.pipeline_jobs FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pipeline_jobs TO authenticated;

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

  normalized_branch := CASE
    WHEN lower(trim(COALESCE(selected_service_branch, pipeline_row.service_branch))) = 'lawn' THEN 'lawn'
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
    RAISE EXCEPTION 'Pipeline job has already been scheduled' USING ERRCODE = '23505';
  END IF;

  RETURN new_task_id;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_and_schedule_pipeline_job(UUID, UUID, DATE, TEXT, TEXT, UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_and_schedule_pipeline_job(UUID, UUID, DATE, TEXT, TEXT, UUID, TEXT)
  TO authenticated;

COMMIT;