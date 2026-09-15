-- READ ONLY: explain why Ferguson tasks dated 2026-09-13 did or did not carry forward.
-- This script does not call the carry-forward RPC and does not update any row.

-- Confirm which function definition is currently installed in production.
-- Supabase displays the final statement's results, so the row-level audit follows this query.
SELECT pg_get_functiondef(
  'public.reconcile_unfinished_task_carry_forward()'::regprocedure
) AS installed_carry_forward_function;

WITH context AS (
  SELECT
    DATE '2026-09-14' AS expected_business_date,
    DATE '2026-09-08' AS carry_forward_activation_date
),
ferguson_tasks AS (
  SELECT
    task.*,
    property.property_name,
    COALESCE(task.service_date, task.scheduled_date) AS effective_service_date,
    COALESCE(task.original_service_date, task.service_date, task.scheduled_date) AS effective_original_date,
    EXISTS (
      SELECT 1
      FROM public.reservations AS reservation
      CROSS JOIN context
      WHERE reservation.property_id = task.property_id
        AND lower(COALESCE(reservation.status, 'active')) = 'active'
        AND reservation.check_in >= COALESCE(
          task.suggested_date,
          task.original_service_date,
          task.service_date,
          task.scheduled_date
        )
        AND reservation.check_in <= context.expected_business_date
    ) AS housekeeping_guest_arrived
  FROM public.cleaning_tasks AS task
  INNER JOIN public.properties AS property
    ON property.id = task.property_id
  WHERE lower(trim(property.property_name)) = 'ferguson'
    AND COALESCE(task.service_date, task.scheduled_date) = DATE '2026-09-13'
)
SELECT
  task.id AS task_id,
  task.property_name,
  task.service_type,
  task.service_branch,
  task.service_date,
  task.scheduled_date,
  task.original_service_date,
  task.overdue_reference_date,
  task.status,
  task.completed_at,
  task.guest_ready,
  task.source_type,
  task.source_key,
  task.manually_modified,
  task.invoiced,
  task.invoice_id,
  task.invoiced_invoice_id,
  task.same_day_surcharge_reconciled,
  task.same_day_surcharge_invoice_id,
  task.carry_forward_count,
  task.last_carried_forward_at,
  task.housekeeping_guest_arrived,
  CASE
    WHEN task.effective_service_date >= context.expected_business_date
      THEN 'NOT OVERDUE: effective service date is not before 2026-09-14'
    WHEN task.effective_service_date < context.carry_forward_activation_date
      THEN 'EXCLUDED: current scheduled date is before carry-forward activation date 2026-09-08'
    WHEN lower(COALESCE(task.status, 'scheduled')) NOT IN ('scheduled', 'in progress', 'in_progress')
      THEN 'EXCLUDED: status is not Scheduled or In Progress'
    WHEN task.completed_at IS NOT NULL
      THEN 'EXCLUDED: completed_at is populated'
    WHEN task.invoiced IS TRUE OR task.invoice_id IS NOT NULL OR task.invoiced_invoice_id IS NOT NULL
      THEN 'EXCLUDED: reconciled or invoice-linked'
    WHEN task.same_day_surcharge_reconciled IS TRUE OR task.same_day_surcharge_invoice_id IS NOT NULL
      THEN 'EXCLUDED: Same-Day Surcharge is reconciled or invoice-linked'
    WHEN task.guest_ready IS TRUE
      OR lower(COALESCE(task.service_type, '')) = 'guest ready'
      OR lower(COALESCE(task.source_type, '')) = 'reservation_guest_ready'
      THEN 'EXCLUDED BY DESIGN: Guest Ready tasks never carry forward'
    WHEN lower(COALESCE(task.service_branch, 'pool')) = 'housekeeping'
      AND task.housekeeping_guest_arrived
      THEN 'EXCLUDED BY DESIGN: active reservation check-in has arrived for this Housekeeping task'
    ELSE 'ELIGIBLE: this row should move when reconcile_unfinished_task_carry_forward runs'
  END AS carry_forward_result
FROM ferguson_tasks AS task
CROSS JOIN context
ORDER BY task.service_branch, task.service_type, task.id;
