-- Remove only current/future scheduled auto-generated tasks when a property service branch is disabled.
-- Run manually in the Supabase SQL Editor as the postgres/database owner.

BEGIN;

CREATE OR REPLACE FUNCTION public.cleanup_deactivated_property_branch_tasks(
  selected_property_id UUID,
  selected_service_branch TEXT
)
RETURNS TABLE (removed_count INTEGER, preserved_in_progress_count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized_branch TEXT := lower(trim(COALESCE(selected_service_branch, '')));
  business_date DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::DATE;
  property_row public.properties%ROWTYPE;
BEGIN
  IF NOT public.is_active_app_admin() THEN
    RAISE EXCEPTION 'Active Admin access required' USING ERRCODE = '42501';
  END IF;

  IF normalized_branch NOT IN ('pool', 'lawn', 'housekeeping') THEN
    RAISE EXCEPTION 'Invalid cleanup service branch' USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO property_row
  FROM public.properties
  WHERE id = selected_property_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Property not found' USING ERRCODE = '22023';
  END IF;

  IF (normalized_branch = 'pool' AND property_row.pool_service_active IS DISTINCT FROM false)
     OR (normalized_branch = 'lawn' AND property_row.lawn_service_active IS DISTINCT FROM false)
     OR (normalized_branch = 'housekeeping' AND property_row.housekeeping_service_active IS DISTINCT FROM false) THEN
    RAISE EXCEPTION 'The selected property branch is still active' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext('property_branch_cleanup:' || selected_property_id::TEXT || ':' || normalized_branch)
  );

  SELECT COUNT(*)::INTEGER
  INTO preserved_in_progress_count
  FROM public.cleaning_tasks AS task
  WHERE task.property_id = selected_property_id
    AND lower(COALESCE(task.service_branch, 'pool')) = normalized_branch
    AND COALESCE(task.service_date, task.scheduled_date) >= business_date
    AND lower(COALESCE(task.status, 'scheduled')) IN ('in progress', 'in_progress')
    AND task.manually_modified IS DISTINCT FROM true
    AND (
      (normalized_branch = 'pool' AND (
        (lower(COALESCE(task.source_type, '')) = 'weekly_standard' AND task.source_key LIKE 'wk:%')
        OR (lower(COALESCE(task.source_type, '')) = 'reservation_guest_ready' AND task.source_key LIKE 'gr:%')
      ))
      OR (normalized_branch = 'lawn'
        AND lower(COALESCE(task.source_type, '')) = 'lawn_recurring'
        AND task.source_key LIKE 'lawn:%')
      OR (normalized_branch = 'housekeeping'
        AND lower(COALESCE(task.source_type, '')) = 'reservation_housekeeping'
        AND task.source_key LIKE 'hk:%')
    );

  WITH deleted AS (
    DELETE FROM public.cleaning_tasks AS task
    WHERE task.property_id = selected_property_id
      AND lower(COALESCE(task.service_branch, 'pool')) = normalized_branch
      AND COALESCE(task.service_date, task.scheduled_date) >= business_date
      AND lower(COALESCE(task.status, 'scheduled')) = 'scheduled'
      AND task.completed_at IS NULL
      AND task.manually_modified IS DISTINCT FROM true
      AND task.invoiced IS DISTINCT FROM true
      AND task.invoice_id IS NULL
      AND task.invoiced_invoice_id IS NULL
      AND task.same_day_surcharge_reconciled IS DISTINCT FROM true
      AND task.same_day_surcharge_invoice_id IS NULL
      AND (
        (normalized_branch = 'pool' AND (
          (lower(COALESCE(task.source_type, '')) = 'weekly_standard' AND task.source_key LIKE 'wk:%')
          OR (lower(COALESCE(task.source_type, '')) = 'reservation_guest_ready' AND task.source_key LIKE 'gr:%')
        ))
        OR (normalized_branch = 'lawn'
          AND lower(COALESCE(task.source_type, '')) = 'lawn_recurring'
          AND task.source_key LIKE 'lawn:%')
        OR (normalized_branch = 'housekeeping'
          AND lower(COALESCE(task.source_type, '')) = 'reservation_housekeeping'
          AND task.source_key LIKE 'hk:%')
      )
    RETURNING task.id
  )
  SELECT COUNT(*)::INTEGER
  INTO removed_count
  FROM deleted;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_deactivated_property_branch_tasks(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_deactivated_property_branch_tasks(UUID, TEXT)
  TO authenticated;

COMMIT;
