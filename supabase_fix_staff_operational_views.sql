-- Fix empty Staff operational views without granting Staff access to base tables.
-- Run manually in the Supabase SQL Editor as the postgres/database owner.

BEGIN;

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
  lawn_service_day, lawn_biweekly_anchor_date
FROM public.properties
WHERE active IS DISTINCT FROM false
  AND (public.is_active_app_staff() OR public.is_active_app_admin());

ALTER VIEW public.staff_properties OWNER TO postgres;

CREATE OR REPLACE VIEW public.staff_cleaning_tasks
WITH (
  security_barrier = true,
  security_invoker = false
)
AS
SELECT
  id, property_id, service_date, scheduled_date, suggested_date,
  check_in_date, service_type, service_branch, weekly_service_level, status,
  technician, technician_id, technician_name, completed_by_technician_id,
  completed_by_technician_name, notes, guest_ready, off_cycle, completed_at,
  source_type, source_key, manually_modified
FROM public.cleaning_tasks
WHERE public.is_active_app_staff() OR public.is_active_app_admin();

ALTER VIEW public.staff_cleaning_tasks OWNER TO postgres;

REVOKE ALL ON TABLE public.staff_properties FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.staff_cleaning_tasks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.staff_properties TO authenticated;
GRANT SELECT ON TABLE public.staff_cleaning_tasks TO authenticated;

COMMIT;
