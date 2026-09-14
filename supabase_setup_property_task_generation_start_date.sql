-- Bound automatic operational task generation to each property's scheduling start date.
-- Run manually in the Supabase SQL Editor as the postgres/database owner.
-- This migration does not update or delete any cleaning_tasks or reservations.

BEGIN;

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS task_generation_start_date DATE;

-- Existing properties keep their original creation-day boundary. The historical
-- task rows themselves remain untouched, including any rows before this date.
UPDATE public.properties
SET task_generation_start_date = COALESCE(
  task_generation_start_date,
  (created_at AT TIME ZONE 'America/New_York')::DATE
)
WHERE task_generation_start_date IS NULL;

-- Defensive fallback for legacy rows without created_at: preserve unrestricted
-- historical behavior instead of assigning today's date.
UPDATE public.properties
SET task_generation_start_date = DATE '1900-01-01'
WHERE task_generation_start_date IS NULL;

ALTER TABLE public.properties
  ALTER COLUMN task_generation_start_date
    SET DEFAULT ((CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::DATE),
  ALTER COLUMN task_generation_start_date SET NOT NULL;

COMMENT ON COLUMN public.properties.task_generation_start_date IS
  'Inclusive lower bound for automatic operational task service dates; manual historical tasks remain allowed.';

CREATE OR REPLACE FUNCTION public.enforce_property_auto_task_generation_start_date()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  property_start_date DATE;
  candidate_service_date DATE := COALESCE(NEW.service_date, NEW.scheduled_date);
BEGIN
  IF NEW.manually_modified IS TRUE
     OR lower(COALESCE(NEW.source_type, '')) NOT IN (
    'weekly_standard',
    'lawn_recurring',
    'reservation_guest_ready',
    'reservation_housekeeping'
  ) THEN
    RETURN NEW;
  END IF;

  SELECT property.task_generation_start_date
  INTO property_start_date
  FROM public.properties AS property
  WHERE property.id = NEW.property_id;

  IF property_start_date IS NOT NULL
     AND (candidate_service_date IS NULL OR candidate_service_date < property_start_date) THEN
    RAISE EXCEPTION
      'Automatic task service date % is before property task generation start date %',
      candidate_service_date,
      property_start_date
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_property_auto_task_generation_start_date
  ON public.cleaning_tasks;
CREATE TRIGGER enforce_property_auto_task_generation_start_date
BEFORE INSERT OR UPDATE OF property_id, service_date, scheduled_date
ON public.cleaning_tasks
FOR EACH ROW
EXECUTE FUNCTION public.enforce_property_auto_task_generation_start_date();

COMMIT;

-- PREVIEW ONLY: Wilman tasks already dated before its effective date.
-- Review these rows before deciding whether any cleanup is appropriate.
SELECT
  task.id AS task_id,
  property.property_name AS property,
  task.service_date,
  task.service_type,
  task.service_branch AS branch,
  task.status,
  task.source_type,
  task.source_key
FROM public.cleaning_tasks AS task
INNER JOIN public.properties AS property
  ON property.id = task.property_id
WHERE lower(trim(property.property_name)) = 'wilman'
  AND task.service_date < property.task_generation_start_date
ORDER BY task.service_date, task.service_type, task.id;
