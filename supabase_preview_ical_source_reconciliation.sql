-- Read-only preview for the iCal source reconciliation migration.
-- This does not update or delete any data.

WITH candidate_links AS (
  SELECT
    task.id AS task_id,
    task.property_id,
    property.property_name,
    task.service_type,
    task.service_date,
    task.status AS task_status,
    task.manually_modified,
    task.completed_at,
    task.invoiced,
    task.invoice_id,
    task.invoiced_invoice_id,
    task.same_day_surcharge_reconciled,
    task.same_day_surcharge_invoice_id,
    reservation.id AS reservation_id,
    reservation.check_in,
    reservation.check_out,
    reservation.status AS reservation_status,
    reservation.cancelled_at,
    COUNT(reservation.id) OVER (PARTITION BY task.id) AS match_count,
    CASE
      WHEN task.source_type = 'reservation_housekeeping'
        OR (
          task.source_type IS NULL
          AND task.source_key IS NULL
          AND task.service_type = 'Housekeeping'
          AND (
            task.notes LIKE 'Auto-created from iCal sync for checkout %.'
            OR task.notes LIKE 'Auto-created%Housekeeping%'
          )
        )
        THEN 'reservation_housekeeping'
      ELSE 'reservation_guest_ready'
    END AS inferred_source_type
  FROM public.cleaning_tasks AS task
  JOIN public.properties AS property ON property.id = task.property_id
  LEFT JOIN public.reservations AS reservation
    ON reservation.property_id = task.property_id
   AND reservation.source = 'ical'
   AND (
     (
       reservation.reservation_uid IS NOT NULL
       AND (
         (
           task.source_type = 'reservation_guest_ready'
           AND task.source_key = 'gr:' || task.property_id::text || ':uid:' || reservation.reservation_uid
         )
         OR (
           task.source_type = 'reservation_housekeeping'
           AND task.source_key = 'hk:' || task.property_id::text || ':uid:' || reservation.reservation_uid
         )
       )
     )
     OR
     (
       (
         task.source_type = 'reservation_guest_ready'
         OR (
           task.source_type IS NULL
           AND task.source_key IS NULL
           AND task.service_type = 'Guest Ready'
           AND task.notes LIKE 'Auto-created Guest Ready task from iCal reservation.%'
         )
       )
       AND reservation.check_in::date = task.check_in_date
     )
     OR
     (
       (
         task.source_type = 'reservation_housekeeping'
         OR (
           task.source_type IS NULL
           AND task.source_key IS NULL
           AND task.service_type = 'Housekeeping'
           AND (
             task.notes LIKE 'Auto-created from iCal sync for checkout %.'
             OR task.notes LIKE 'Auto-created%Housekeeping%'
           )
         )
       )
       AND reservation.check_out::date = COALESCE(task.suggested_date, task.original_service_date, task.service_date, task.scheduled_date)
     )
   )
  WHERE task.source_type IN ('reservation_guest_ready', 'reservation_housekeeping')
    OR (
      task.source_type IS NULL
      AND task.source_key IS NULL
      AND (
        (
          task.service_type = 'Guest Ready'
          AND task.notes LIKE 'Auto-created Guest Ready task from iCal reservation.%'
        )
        OR (
          task.service_type = 'Housekeeping'
          AND (
            task.notes LIKE 'Auto-created from iCal sync for checkout %.'
            OR task.notes LIKE 'Auto-created%Housekeeping%'
          )
        )
      )
    )
)
SELECT
  property_name,
  task_id,
  reservation_id,
  inferred_source_type,
  service_type,
  service_date,
  check_in,
  check_out,
  task_status,
  reservation_status,
  cancelled_at,
  match_count,
  CASE
    WHEN match_count = 0 THEN 'SKIP - NO SAFE MATCH / REVIEW'
    WHEN match_count <> 1 THEN 'SKIP - AMBIGUOUS MATCH / REVIEW'
    WHEN lower(COALESCE(reservation_status, 'active')) <> 'cancelled' THEN 'LINK ONLY - RESERVATION ACTIVE'
    WHEN lower(COALESCE(task_status, 'scheduled')) IN ('completed', 'cancelled', 'canceled', 'void', 'deleted')
      OR completed_at IS NOT NULL
      OR invoiced IS TRUE
      OR invoice_id IS NOT NULL
      OR invoiced_invoice_id IS NOT NULL
      OR same_day_surcharge_reconciled IS TRUE
      OR same_day_surcharge_invoice_id IS NOT NULL
      THEN 'LINK ONLY - PROTECTED TASK'
    WHEN manually_modified IS TRUE
      OR lower(COALESCE(task_status, 'scheduled')) IN ('in progress', 'in_progress')
      THEN 'LINK THEN REVIEW IF SYNCED'
    WHEN lower(COALESCE(task_status, 'scheduled')) = 'scheduled'
      THEN 'LINK THEN CANCEL IF SYNCED'
    ELSE 'LINK ONLY - UNRECOGNIZED STATE'
  END AS proposed_outcome
FROM candidate_links
ORDER BY
  CASE WHEN match_count <> 1 THEN 0 ELSE 1 END,
  property_name,
  service_date,
  task_id,
  reservation_id;
