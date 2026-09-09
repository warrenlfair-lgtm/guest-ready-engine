-- Read-only preview of unfinished Housekeeping tasks that have no pricing snapshot.
-- This script does not update any task.
-- Run supabase_setup_housekeeping_pricing.sql first.

SELECT
  task.id,
  task.property_id,
  property.property_name,
  task.service_date,
  task.status,
  task.source_type,
  task.source_key,
  task.manually_modified,
  task.charge AS existing_charge,
  task.labor_amount AS existing_labor_amount,
  property.housekeeping_default_charge AS proposed_charge,
  property.housekeeping_labor_amount AS proposed_labor_amount
FROM public.cleaning_tasks AS task
JOIN public.properties AS property ON property.id = task.property_id
WHERE lower(COALESCE(task.service_branch, '')) = 'housekeeping'
  AND lower(COALESCE(task.status, 'scheduled')) IN ('scheduled', 'in progress', 'in_progress')
  AND task.completed_at IS NULL
  AND task.invoiced IS DISTINCT FROM true
  AND task.invoice_id IS NULL
  AND task.invoiced_invoice_id IS NULL
  AND task.same_day_surcharge_reconciled IS DISTINCT FROM true
  AND task.same_day_surcharge_invoice_id IS NULL
  AND (
    COALESCE(task.charge, 0) = 0
    OR COALESCE(task.labor_amount, 0) = 0
  )
  AND (
    property.housekeeping_default_charge > 0
    OR property.housekeeping_labor_amount > 0
  )
ORDER BY task.service_date, property.property_name, task.id;
