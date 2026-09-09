-- Optional Housekeeping pricing snapshot backfill.
-- Run supabase_setup_housekeeping_pricing.sql first.
--
-- This file is preview-only by default. Review every returned row before
-- uncommenting the UPDATE. It intentionally excludes completed, reconciled,
-- invoiced, manually modified, and manually created Housekeeping tasks.

WITH eligible_tasks AS (
  SELECT
    task.id,
    task.property_id,
    property.property_name,
    task.service_date,
    task.status,
    task.source_type,
    task.source_key,
    task.charge AS existing_charge,
    task.labor_amount AS existing_labor_amount,
    property.housekeeping_default_charge AS proposed_charge,
    property.housekeeping_labor_amount AS proposed_labor_amount
  FROM public.cleaning_tasks task
  JOIN public.properties property ON property.id = task.property_id
  WHERE lower(COALESCE(task.service_branch, '')) = 'housekeeping'
    AND task.source_type = 'reservation_housekeeping'
    AND task.manually_modified IS DISTINCT FROM true
    AND lower(COALESCE(task.status, 'scheduled')) IN ('scheduled', 'in progress', 'in_progress')
    AND task.completed_at IS NULL
    AND task.invoiced IS DISTINCT FROM true
    AND task.invoice_id IS NULL
    AND task.invoiced_invoice_id IS NULL
    AND task.same_day_surcharge_reconciled IS DISTINCT FROM true
    AND task.same_day_surcharge_invoice_id IS NULL
    AND (
      (COALESCE(task.charge, 0) <= 0 AND property.housekeeping_default_charge > 0)
      OR (COALESCE(task.labor_amount, 0) <= 0 AND property.housekeeping_labor_amount > 0)
    )
)
SELECT *
FROM eligible_tasks
ORDER BY service_date, property_name, id;

-- After reviewing the preview above, uncomment and run only this transaction.
-- Existing positive charge and labor snapshots remain unchanged.
--
-- BEGIN;
--
-- WITH eligible_tasks AS (
--   SELECT task.id, property.housekeeping_default_charge, property.housekeeping_labor_amount
--   FROM public.cleaning_tasks task
--   JOIN public.properties property ON property.id = task.property_id
--   WHERE lower(COALESCE(task.service_branch, '')) = 'housekeeping'
--     AND task.source_type = 'reservation_housekeeping'
--     AND task.manually_modified IS DISTINCT FROM true
--     AND lower(COALESCE(task.status, 'scheduled')) IN ('scheduled', 'in progress', 'in_progress')
--     AND task.completed_at IS NULL
--     AND task.invoiced IS DISTINCT FROM true
--     AND task.invoice_id IS NULL
--     AND task.invoiced_invoice_id IS NULL
--     AND task.same_day_surcharge_reconciled IS DISTINCT FROM true
--     AND task.same_day_surcharge_invoice_id IS NULL
--     AND (
--       (COALESCE(task.charge, 0) <= 0 AND property.housekeeping_default_charge > 0)
--       OR (COALESCE(task.labor_amount, 0) <= 0 AND property.housekeeping_labor_amount > 0)
--     )
-- )
-- UPDATE public.cleaning_tasks task
-- SET charge = CASE
--       WHEN COALESCE(task.charge, 0) <= 0 AND eligible.housekeeping_default_charge > 0
--         THEN eligible.housekeeping_default_charge
--       ELSE task.charge
--     END,
--     labor_amount = CASE
--       WHEN COALESCE(task.labor_amount, 0) <= 0 AND eligible.housekeeping_labor_amount > 0
--         THEN eligible.housekeeping_labor_amount
--       ELSE task.labor_amount
--     END
-- FROM eligible_tasks eligible
-- WHERE task.id = eligible.id
-- RETURNING task.id, task.property_id, task.service_date, task.charge, task.labor_amount;
--
-- COMMIT;
