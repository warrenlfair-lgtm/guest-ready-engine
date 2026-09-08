-- PREVIEW ONLY: identify carry-forward transaction cohorts, then inspect only the earliest cohort.
-- The RPC uses transaction-level CURRENT_TIMESTAMP, so every row moved in one run shares an exact timestamp.
-- This file is read-only and performs no task or metadata changes.

-- Result 1: verify which timestamp cohort contains the original production run.
SELECT
  task.last_carried_forward_at,
  COUNT(*) AS cohort_record_count,
  MIN(task.original_service_date) AS earliest_original_service_date,
  MAX(task.original_service_date) AS latest_original_service_date
FROM public.cleaning_tasks AS task
WHERE task.original_service_date < DATE '2026-09-08'
  AND COALESCE(task.carry_forward_count, 0) > 0
  AND task.last_carried_forward_at IS NOT NULL
GROUP BY task.last_carried_forward_at
ORDER BY task.last_carried_forward_at;

-- Result 2: explain how the earliest cohort divides into operational groups.
WITH earliest_carry_forward_cohort AS (
  SELECT MIN(task.last_carried_forward_at) AS carried_at
  FROM public.cleaning_tasks AS task
  WHERE task.original_service_date < DATE '2026-09-08'
    AND COALESCE(task.carry_forward_count, 0) > 0
    AND task.last_carried_forward_at IS NOT NULL
)
SELECT
  task.original_service_date,
  task.carry_forward_count,
  task.service_branch,
  task.service_type,
  task.source_type,
  task.manually_modified,
  COUNT(*) AS grouped_record_count
FROM public.cleaning_tasks AS task
INNER JOIN earliest_carry_forward_cohort AS cohort
  ON cohort.carried_at = task.last_carried_forward_at
WHERE task.original_service_date < DATE '2026-09-08'
  AND COALESCE(task.carry_forward_count, 0) > 0
GROUP BY
  task.original_service_date,
  task.carry_forward_count,
  task.service_branch,
  task.service_type,
  task.source_type,
  task.manually_modified
ORDER BY
  task.original_service_date,
  task.carry_forward_count,
  task.service_branch,
  task.service_type,
  task.source_type;

-- Result 3: inspect all rows in that cohort. Use the grouping above to identify the three-row distinction.
WITH earliest_carry_forward_cohort AS (
  SELECT MIN(task.last_carried_forward_at) AS carried_at
  FROM public.cleaning_tasks AS task
  WHERE task.original_service_date < DATE '2026-09-08'
    AND COALESCE(task.carry_forward_count, 0) > 0
    AND task.last_carried_forward_at IS NOT NULL
)
SELECT
  COUNT(*) OVER () AS selected_cohort_record_count,
  task.id AS task_id,
  property.property_name,
  task.property_id,
  task.service_date AS current_service_date,
  task.scheduled_date AS current_scheduled_date,
  task.original_service_date,
  task.status,
  task.completed_at,
  task.invoiced,
  task.invoice_id,
  task.invoiced_invoice_id,
  task.same_day_surcharge_reconciled,
  task.same_day_surcharge_invoice_id,
  task.carry_forward_count,
  task.last_carried_forward_at,
  task.service_type,
  task.service_branch,
  task.source_type,
  task.source_key,
  task.manually_modified
FROM public.cleaning_tasks AS task
LEFT JOIN public.properties AS property
  ON property.id = task.property_id
INNER JOIN earliest_carry_forward_cohort AS cohort
  ON cohort.carried_at = task.last_carried_forward_at
WHERE task.original_service_date < DATE '2026-09-08'
  AND COALESCE(task.carry_forward_count, 0) > 0
  AND task.last_carried_forward_at IS NOT NULL
ORDER BY
  task.original_service_date,
  property.property_name,
  task.id;