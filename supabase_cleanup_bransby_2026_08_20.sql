-- One-time correction and cleanup for Bransby on 2026-08-20.
-- Review the validation predicates and run this file manually in Supabase SQL Editor.
-- The transaction first renames the existing Brandsby property in place, preserving
-- its id, then aborts unless it finds exactly the two known task rows.

BEGIN;

CREATE TEMP TABLE bransby_property_target ON COMMIT DROP AS
SELECT id
FROM properties
WHERE lower(trim(property_name)) = 'brandsby';

DO $$
DECLARE
  brandsby_count INTEGER;
  bransby_count INTEGER;
BEGIN
  SELECT count(*) INTO brandsby_count
  FROM bransby_property_target;

  SELECT count(*) INTO bransby_count
  FROM properties
  WHERE lower(trim(property_name)) = 'bransby';

  IF brandsby_count <> 1 THEN
    RAISE EXCEPTION 'Rename aborted: expected exactly one Brandsby property; found %', brandsby_count;
  END IF;

  IF bransby_count <> 0 THEN
    RAISE EXCEPTION 'Rename aborted: a separate Bransby property already exists';
  END IF;
END $$;

UPDATE properties p
SET property_name = 'Bransby'
FROM bransby_property_target target
WHERE p.id = target.id
  AND lower(trim(p.property_name)) = 'brandsby';

CREATE TEMP TABLE bransby_2026_08_20_cleanup_targets ON COMMIT DROP AS
SELECT
  ct.id,
  CASE
    WHEN ct.notes = 'Auto-created from iCal sync for check-in 2026-08-20.'
      AND ct.created_at::date = DATE '2026-07-15'
      THEN 'legacy_ical'
    WHEN ct.notes = 'Auto-created Weekly Standard (Weekly) for Thursday in current month view.'
      AND ct.created_at::date = DATE '2026-08-17'
      THEN 'weekly_duplicate'
  END AS cleanup_role
FROM cleaning_tasks ct
JOIN bransby_property_target property_target ON property_target.id = ct.property_id
JOIN properties p ON p.id = property_target.id
WHERE p.property_name = 'Bransby'
  AND ct.service_date = DATE '2026-08-20'
  AND ct.scheduled_date = DATE '2026-08-20'
  AND ct.service_type = 'Weekly Standard';

DO $$
DECLARE
  legacy_count INTEGER;
  duplicate_count INTEGER;
  unsafe_duplicate_count INTEGER;
BEGIN
  SELECT count(*) INTO legacy_count
  FROM bransby_2026_08_20_cleanup_targets
  WHERE cleanup_role = 'legacy_ical';

  SELECT count(*) INTO duplicate_count
  FROM bransby_2026_08_20_cleanup_targets
  WHERE cleanup_role = 'weekly_duplicate';

  IF legacy_count <> 1 OR duplicate_count <> 1 THEN
    RAISE EXCEPTION
      'Cleanup aborted: expected one legacy iCal row and one weekly duplicate; found legacy=%, duplicate=%',
      legacy_count,
      duplicate_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM cleaning_tasks ct
    JOIN bransby_2026_08_20_cleanup_targets target ON target.id = ct.id
    WHERE target.cleanup_role = 'legacy_ical'
      AND (
        ct.check_in_date IS DISTINCT FROM DATE '2026-08-20'
        OR ct.guest_ready IS DISTINCT FROM FALSE
        OR ct.charge IS DISTINCT FROM 0
        OR ct.off_cycle IS DISTINCT FROM FALSE
      )
  ) THEN
    RAISE EXCEPTION 'Cleanup aborted: the legacy iCal row no longer matches the audited state';
  END IF;

  SELECT count(*) INTO unsafe_duplicate_count
  FROM cleaning_tasks ct
  JOIN bransby_2026_08_20_cleanup_targets target ON target.id = ct.id
  WHERE target.cleanup_role = 'weekly_duplicate'
    AND (
      lower(coalesce(ct.status, '')) <> 'scheduled'
      OR ct.completed_at IS NOT NULL
      OR coalesce(ct.invoiced, FALSE)
      OR coalesce(ct.manually_modified, FALSE)
      OR ct.source_type IS DISTINCT FROM 'weekly_standard'
      OR ct.source_key IS DISTINCT FROM 'wk:' || ct.property_id::text || ':2026-08-20'
      OR ct.check_in_date IS NOT NULL
      OR ct.invoiced_invoice_id IS NOT NULL
      OR ct.invoice_id IS NOT NULL
      OR ct.invoiced_at IS NOT NULL
      OR ct.technician_id IS NOT NULL
      OR nullif(trim(coalesce(ct.technician_name, '')), '') IS NOT NULL
      OR ct.completed_by_technician_id IS NOT NULL
      OR nullif(trim(coalesce(ct.completed_by_technician_name, '')), '') IS NOT NULL
      OR coalesce(ct.labor_amount, 0) <> 0
      OR ct.labor_calculated_at IS NOT NULL
      OR coalesce(ct.labor_paid, FALSE)
      OR ct.labor_paid_at IS NOT NULL
    );

  IF unsafe_duplicate_count <> 0 THEN
    RAISE EXCEPTION 'Cleanup aborted: the Weekly Standard duplicate has operational or historical data';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM invoice_items ii
    JOIN bransby_2026_08_20_cleanup_targets target ON target.id = ii.task_id
    WHERE target.cleanup_role = 'weekly_duplicate'
  ) THEN
    RAISE EXCEPTION 'Cleanup aborted: the Weekly Standard duplicate is referenced by an invoice item';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM chemical_usage cu
    JOIN bransby_2026_08_20_cleanup_targets target ON target.id = cu.task_id
    WHERE target.cleanup_role = 'weekly_duplicate'
  ) THEN
    RAISE EXCEPTION 'Cleanup aborted: the Weekly Standard duplicate has chemical usage';
  END IF;
END $$;

UPDATE cleaning_tasks ct
SET
  service_type = 'Guest Ready',
  guest_ready = TRUE,
  weekly_service_level = NULL,
  source_type = 'reservation_guest_ready',
  source_key = 'gr:' || ct.property_id::text || ':2026-08-20'
FROM bransby_2026_08_20_cleanup_targets target
WHERE target.id = ct.id
  AND target.cleanup_role = 'legacy_ical';

DELETE FROM cleaning_tasks ct
USING bransby_2026_08_20_cleanup_targets target
WHERE target.id = ct.id
  AND target.cleanup_role = 'weekly_duplicate';

DO $$
DECLARE
  final_count INTEGER;
BEGIN
  SELECT count(*) INTO final_count
  FROM cleaning_tasks ct
  JOIN bransby_property_target property_target ON property_target.id = ct.property_id
  JOIN properties p ON p.id = property_target.id
  WHERE p.property_name = 'Bransby'
    AND ct.service_date = DATE '2026-08-20';

  IF final_count <> 1 OR NOT EXISTS (
    SELECT 1
    FROM cleaning_tasks ct
    JOIN bransby_2026_08_20_cleanup_targets target ON target.id = ct.id
    WHERE target.cleanup_role = 'legacy_ical'
      AND ct.service_type = 'Guest Ready'
      AND ct.guest_ready = TRUE
      AND ct.service_date = DATE '2026-08-20'
      AND ct.scheduled_date = DATE '2026-08-20'
      AND ct.check_in_date = DATE '2026-08-20'
      AND ct.charge = 0
      AND ct.off_cycle = FALSE
      AND ct.source_type = 'reservation_guest_ready'
      AND ct.source_key = 'gr:' || ct.property_id::text || ':2026-08-20'
  ) THEN
    RAISE EXCEPTION 'Cleanup aborted: final Bransby 2026-08-20 state is not exactly one included Guest Ready task';
  END IF;
END $$;

SELECT
  ct.id,
  p.property_name,
  ct.service_date,
  ct.scheduled_date,
  ct.check_in_date,
  ct.service_type,
  ct.guest_ready,
  ct.charge,
  ct.off_cycle,
  ct.source_type,
  ct.source_key,
  ct.created_at
FROM cleaning_tasks ct
JOIN bransby_property_target property_target ON property_target.id = ct.property_id
JOIN properties p ON p.id = property_target.id
WHERE p.property_name = 'Bransby'
  AND ct.service_date = DATE '2026-08-20';

COMMIT;