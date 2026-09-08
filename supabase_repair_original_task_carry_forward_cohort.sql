-- ONE-TIME PRODUCTION REPAIR: restore only the confirmed 32 Pool Weekly Standard rows.
-- Run supabase_preview_task_carry_forward_pre_activation_restore.sql first.
-- The same timestamp also contains three Maintenance Manual rows; those are explicitly excluded and remain untouched.
-- This transaction aborts without changing rows unless the exact scoped cohort contains 32 records.

BEGIN;

DO $$
DECLARE
  activation_date CONSTANT DATE := DATE '2026-09-08';
  expected_record_count CONSTANT INTEGER := 32;
  target_carried_at TIMESTAMPTZ;
  target_record_count INTEGER;
  restored_record_count INTEGER;
BEGIN
  SELECT MIN(task.last_carried_forward_at)
  INTO target_carried_at
  FROM public.cleaning_tasks AS task
  WHERE task.original_service_date < activation_date
    AND COALESCE(task.carry_forward_count, 0) > 0
    AND task.last_carried_forward_at IS NOT NULL;

  IF target_carried_at IS NULL THEN
    RAISE EXCEPTION 'Repair aborted: no pre-activation carry-forward cohort found';
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO target_record_count
  FROM public.cleaning_tasks AS task
  WHERE task.original_service_date < activation_date
    AND COALESCE(task.carry_forward_count, 0) > 0
    AND task.last_carried_forward_at = target_carried_at
    AND lower(COALESCE(task.service_branch, 'pool')) = 'pool'
    AND lower(COALESCE(task.service_type, '')) = 'weekly standard'
    AND lower(COALESCE(task.source_type, '')) = 'weekly_standard';

  IF target_record_count <> expected_record_count THEN
    RAISE EXCEPTION
      'Repair aborted: earliest cohort at % contains % records, expected exactly %',
      target_carried_at,
      target_record_count,
      expected_record_count;
  END IF;

  UPDATE public.cleaning_tasks AS task
  SET service_date = task.original_service_date,
      scheduled_date = task.original_service_date,
      original_service_date = NULL,
      carry_forward_count = 0,
      last_carried_forward_at = NULL,
      manually_modified = false
  WHERE task.original_service_date < activation_date
    AND COALESCE(task.carry_forward_count, 0) > 0
    AND task.last_carried_forward_at = target_carried_at
    AND lower(COALESCE(task.service_branch, 'pool')) = 'pool'
    AND lower(COALESCE(task.service_type, '')) = 'weekly standard'
    AND lower(COALESCE(task.source_type, '')) = 'weekly_standard';

  GET DIAGNOSTICS restored_record_count = ROW_COUNT;
  IF restored_record_count <> expected_record_count THEN
    RAISE EXCEPTION
      'Repair aborted: restored % records, expected exactly %',
      restored_record_count,
      expected_record_count;
  END IF;

  RAISE NOTICE 'Restored % tasks from carry-forward cohort %', restored_record_count, target_carried_at;
END;
$$;

COMMIT;

-- Verification: the three excluded Maintenance Manual rows should remain; the repaired Weekly rows should be gone.
SELECT
  task.id AS task_id,
  task.service_branch,
  task.service_type,
  task.source_type,
  task.service_date,
  task.scheduled_date,
  task.original_service_date,
  task.carry_forward_count,
  task.last_carried_forward_at
FROM public.cleaning_tasks AS task
WHERE task.original_service_date < DATE '2026-09-08'
  AND COALESCE(task.carry_forward_count, 0) > 0
ORDER BY task.original_service_date, task.id;