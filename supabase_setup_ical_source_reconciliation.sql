-- Link iCal-generated tasks to stable reservation records and retain removal/review history.
-- Run manually in the Supabase SQL Editor before deploying the updated sync-ical function.

BEGIN;

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

ALTER TABLE public.cleaning_tasks
  ADD COLUMN IF NOT EXISTS source_reservation_id UUID,
  ADD COLUMN IF NOT EXISTS source_removed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source_review_required_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source_review_reason TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cleaning_tasks_source_reservation_id_fkey'
      AND conrelid = 'public.cleaning_tasks'::regclass
  ) THEN
    ALTER TABLE public.cleaning_tasks
      ADD CONSTRAINT cleaning_tasks_source_reservation_id_fkey
      FOREIGN KEY (source_reservation_id)
      REFERENCES public.reservations(id)
      ON DELETE SET NULL;
  END IF;
END $$;

UPDATE public.reservations
SET last_seen_at = COALESCE(last_seen_at, imported_at)
WHERE source = 'ical'
  AND last_seen_at IS NULL;

-- Backfill only unambiguous legacy Guest Ready/Housekeeping tasks. Notes are used
-- solely for legacy rows that have neither source_type nor source_key.
WITH candidate_links AS (
  SELECT
    task.id AS task_id,
    reservation.id AS reservation_id,
    COUNT(*) OVER (PARTITION BY task.id) AS match_count,
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
  JOIN public.reservations AS reservation
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
  WHERE task.source_reservation_id IS NULL
), unique_links AS (
  SELECT task_id, reservation_id, inferred_source_type
  FROM candidate_links
  WHERE match_count = 1
)
UPDATE public.cleaning_tasks AS task
SET source_reservation_id = unique_links.reservation_id,
    source_type = COALESCE(task.source_type, unique_links.inferred_source_type)
FROM unique_links
WHERE task.id = unique_links.task_id;

-- Date-only legacy rows cannot be assigned safely after an upstream date change.
-- Keep them active and surface them for explicit review rather than guessing.
UPDATE public.cleaning_tasks AS task
SET source_review_required_at = COALESCE(task.source_review_required_at, CURRENT_TIMESTAMP),
    source_review_reason = COALESCE(
      task.source_review_reason,
      'LEGACY ICAL TASK COULD NOT BE LINKED - Review Task'
    )
WHERE task.source_reservation_id IS NULL
  AND (
    task.source_type IN ('reservation_guest_ready', 'reservation_housekeeping')
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
  );

CREATE INDEX IF NOT EXISTS idx_reservations_property_source_uid
  ON public.reservations(property_id, source, reservation_uid);
CREATE INDEX IF NOT EXISTS idx_cleaning_tasks_source_reservation_id
  ON public.cleaning_tasks(source_reservation_id);
CREATE INDEX IF NOT EXISTS idx_cleaning_tasks_source_review_required_at
  ON public.cleaning_tasks(source_review_required_at)
  WHERE source_review_required_at IS NOT NULL;

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
  source_type, source_key, manually_modified,
  original_service_date, carry_forward_count, last_carried_forward_at,
  overdue_reference_date, route_order,
  source_removed_at, source_review_required_at, source_review_reason
FROM public.cleaning_tasks
WHERE public.is_active_app_staff() OR public.is_active_app_admin();
ALTER VIEW public.staff_cleaning_tasks OWNER TO postgres;

REVOKE ALL ON TABLE public.staff_cleaning_tasks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.staff_cleaning_tasks TO authenticated;

CREATE OR REPLACE VIEW public.manager_cleaning_tasks
WITH (security_barrier = true, security_invoker = false)
AS
SELECT
  id, property_id, service_date, scheduled_date, suggested_date,
  check_in_date, service_type, service_branch, weekly_service_level, status,
  technician, technician_id, technician_name, completed_by_technician_id,
  completed_by_technician_name, notes, guest_ready, off_cycle, completed_at,
  source_type, source_key, manually_modified,
  public.manager_reconciliation_eligible(id, 'task') AS manager_reconcile_eligible,
  public.manager_reconciliation_eligible(id, 'sds') AS manager_sds_reconcile_eligible,
  (
    lower(COALESCE(status, 'scheduled')) IN ('scheduled', 'in progress', 'in_progress')
    AND completed_at IS NULL
    AND invoiced IS DISTINCT FROM true
    AND invoice_id IS NULL
    AND invoiced_invoice_id IS NULL
    AND same_day_surcharge_reconciled IS DISTINCT FROM true
    AND same_day_surcharge_invoice_id IS NULL
    AND COALESCE(service_date, scheduled_date) >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::DATE
  ) AS month_reschedule_eligible,
  original_service_date, carry_forward_count, last_carried_forward_at,
  overdue_reference_date, route_order,
  source_removed_at, source_review_required_at, source_review_reason
FROM public.cleaning_tasks
WHERE public.is_active_app_manager() OR public.is_active_app_admin();
ALTER VIEW public.manager_cleaning_tasks OWNER TO postgres;

REVOKE ALL ON TABLE public.manager_cleaning_tasks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.manager_cleaning_tasks TO authenticated;

COMMIT;
