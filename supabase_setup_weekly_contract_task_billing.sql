-- Move weekly contract billing into the existing task reconciliation workflow.
-- Run manually before deploying the matching app and sync-ical changes.

BEGIN;

ALTER TABLE public.properties
ADD COLUMN IF NOT EXISTS weekly_contract_cleaning_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS weekly_contract_billing_effective_date DATE;

ALTER TABLE public.properties
DROP CONSTRAINT IF EXISTS properties_weekly_contract_cleaning_amount_check;

ALTER TABLE public.properties
DROP CONSTRAINT IF EXISTS properties_weekly_contract_effective_date_check;

ALTER TABLE public.properties
ADD CONSTRAINT properties_weekly_contract_cleaning_amount_check
CHECK (weekly_contract_cleaning_amount >= 0);

ALTER TABLE public.properties
ADD CONSTRAINT properties_weekly_contract_effective_date_check
CHECK (
  weekly_contract_billing_effective_date IS NULL
  OR (
    weekly_contract_cleaning_amount > 0
    AND EXTRACT(DAY FROM weekly_contract_billing_effective_date) = 1
  )
);

CREATE OR REPLACE FUNCTION public.protect_weekly_contract_effective_date()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.weekly_contract_billing_effective_date IS NOT NULL
     AND NEW.weekly_contract_billing_effective_date IS DISTINCT FROM OLD.weekly_contract_billing_effective_date THEN
    RAISE EXCEPTION 'Weekly contract task billing effective date cannot be changed after activation.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS properties_protect_weekly_contract_effective_date ON public.properties;
CREATE TRIGGER properties_protect_weekly_contract_effective_date
BEFORE UPDATE OF weekly_contract_billing_effective_date
ON public.properties
FOR EACH ROW
EXECUTE FUNCTION public.protect_weekly_contract_effective_date();

ALTER TABLE public.cleaning_tasks
ADD COLUMN IF NOT EXISTS weekly_contract_obligation_key TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.cleaning_tasks task
    JOIN public.properties property ON property.id = task.property_id
    WHERE task.service_type = 'Weekly Standard'
      AND task.source_key LIKE 'wk:%'
      AND task.source_key IS NOT NULL
      AND property.weekly_contract_cleaning_amount > 0
      AND property.weekly_contract_billing_effective_date IS NOT NULL
      AND COALESCE(task.original_service_date, task.suggested_date, task.service_date, task.scheduled_date)
        >= property.weekly_contract_billing_effective_date
      AND lower(COALESCE(task.status, 'scheduled')) IN ('scheduled', 'in progress', 'in_progress')
      AND task.completed_at IS NULL
      AND task.invoiced IS DISTINCT FROM true
      AND task.invoice_id IS NULL
      AND task.invoiced_invoice_id IS NULL
    GROUP BY task.source_key
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Weekly contract migration aborted: duplicate future Weekly Standard source keys require review.';
  END IF;
END $$;

-- Future open Weekly Standard tasks are safe to adopt. Historical, completed,
-- reconciled, and invoice-linked tasks are intentionally untouched.
UPDATE public.cleaning_tasks task
SET charge = property.weekly_contract_cleaning_amount,
    weekly_contract_obligation_key = task.source_key
FROM public.properties property
WHERE property.id = task.property_id
  AND task.service_type = 'Weekly Standard'
  AND task.source_key LIKE 'wk:%'
  AND COALESCE(task.charge, 0) <= 0
  AND task.weekly_contract_obligation_key IS NULL
  AND property.weekly_contract_cleaning_amount > 0
  AND property.weekly_contract_billing_effective_date IS NOT NULL
  AND COALESCE(task.original_service_date, task.suggested_date, task.service_date, task.scheduled_date)
    >= property.weekly_contract_billing_effective_date
  AND lower(COALESCE(task.status, 'scheduled')) IN ('scheduled', 'in progress', 'in_progress')
  AND task.completed_at IS NULL
  AND task.invoiced IS DISTINCT FROM true
  AND task.invoice_id IS NULL
  AND task.invoiced_invoice_id IS NULL;

-- Adopt legacy flex-window Guest Ready tasks that already fulfilled a weekly
-- obligation but were created before contract ownership was recorded.
WITH guest_ready_candidates AS (
  SELECT
    task.id,
    property.weekly_contract_cleaning_amount AS contract_amount,
    'wk:' || task.property_id::TEXT || ':' || weekly_service_date::TEXT AS obligation_key,
    ROW_NUMBER() OVER (
      PARTITION BY task.property_id, weekly_service_date
      ORDER BY COALESCE(task.completed_at, task.created_at) NULLS LAST, task.id
    ) AS obligation_rank
  FROM public.cleaning_tasks task
  JOIN public.properties property ON property.id = task.property_id
  CROSS JOIN LATERAL (
    SELECT COALESCE(task.original_service_date, task.suggested_date, task.service_date, task.scheduled_date)::DATE AS task_date
  ) dates
  CROSS JOIN LATERAL (
    SELECT CASE lower(COALESCE(property.standard_service_day, 'Wednesday'))
      WHEN 'sunday' THEN 0 WHEN 'monday' THEN 1 WHEN 'tuesday' THEN 2
      WHEN 'wednesday' THEN 3 WHEN 'thursday' THEN 4 WHEN 'friday' THEN 5
      WHEN 'saturday' THEN 6 ELSE 3
    END AS standard_day
  ) schedule
  CROSS JOIN LATERAL (
    SELECT dates.task_date - EXTRACT(DOW FROM dates.task_date)::INTEGER + schedule.standard_day AS weekly_service_date
  ) weekly
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN lower(COALESCE(property.coverage_rule, '')) IN ('none', 'before', 'after', 'both')
        THEN lower(property.coverage_rule)
      WHEN COALESCE(property.coverage_days, 1) = 0 THEN 'none'
      ELSE 'both'
    END AS coverage_rule
  ) coverage
  WHERE (task.guest_ready IS TRUE OR task.service_type = 'Guest Ready')
    AND dates.task_date IS NOT NULL
    AND task.weekly_contract_obligation_key IS NULL
    AND COALESCE(task.charge, 0) <= 0
    AND property.weekly_contract_cleaning_amount > 0
    AND property.weekly_contract_billing_effective_date IS NOT NULL
    AND weekly.weekly_service_date >= property.weekly_contract_billing_effective_date
    AND lower(COALESCE(task.status, 'scheduled')) NOT IN ('cancelled', 'canceled', 'void', 'deleted')
    AND task.invoiced IS DISTINCT FROM true
    AND task.invoice_id IS NULL
    AND task.invoiced_invoice_id IS NULL
    AND (
      dates.task_date = weekly.weekly_service_date
      OR (coverage.coverage_rule IN ('before', 'both') AND dates.task_date = weekly.weekly_service_date - 1)
      OR (coverage.coverage_rule IN ('after', 'both') AND dates.task_date = weekly.weekly_service_date + 1)
    )
    AND (
      lower(COALESCE(property.service_frequency, 'weekly')) NOT IN ('bi_weekly', 'bi-weekly')
      OR (
        property.biweekly_anchor_date IS NOT NULL
        AND MOD(weekly.weekly_service_date - property.biweekly_anchor_date, 14) = 0
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.cleaning_tasks owner
      WHERE owner.weekly_contract_obligation_key =
        'wk:' || task.property_id::TEXT || ':' || weekly.weekly_service_date::TEXT
    )
)
UPDATE public.cleaning_tasks task
SET charge = candidate.contract_amount,
    weekly_contract_obligation_key = candidate.obligation_key
FROM guest_ready_candidates candidate
WHERE task.id = candidate.id
  AND candidate.obligation_rank = 1;

UPDATE public.cleaning_tasks
SET weekly_contract_obligation_key = NULL
WHERE lower(COALESCE(status, '')) IN ('cancelled', 'canceled', 'void', 'deleted')
  AND invoiced IS DISTINCT FROM true
  AND invoice_id IS NULL
  AND invoiced_invoice_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cleaning_tasks_weekly_contract_obligation_unique
ON public.cleaning_tasks(weekly_contract_obligation_key)
WHERE weekly_contract_obligation_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.snapshot_open_weekly_contract_tasks()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.weekly_contract_cleaning_amount <= 0
     OR NEW.weekly_contract_billing_effective_date IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.cleaning_tasks task
  SET charge = NEW.weekly_contract_cleaning_amount,
      weekly_contract_obligation_key = task.source_key
  WHERE task.property_id = NEW.id
    AND task.service_type = 'Weekly Standard'
    AND task.source_key LIKE 'wk:%'
    AND COALESCE(task.charge, 0) <= 0
    AND task.weekly_contract_obligation_key IS NULL
    AND COALESCE(task.original_service_date, task.suggested_date, task.service_date, task.scheduled_date)
      >= NEW.weekly_contract_billing_effective_date
    AND lower(COALESCE(task.status, 'scheduled')) IN ('scheduled', 'in progress', 'in_progress')
    AND task.completed_at IS NULL
    AND task.invoiced IS DISTINCT FROM true
    AND task.invoice_id IS NULL
    AND task.invoiced_invoice_id IS NULL;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS properties_snapshot_open_weekly_contract_tasks ON public.properties;
CREATE TRIGGER properties_snapshot_open_weekly_contract_tasks
AFTER INSERT OR UPDATE OF weekly_contract_cleaning_amount, weekly_contract_billing_effective_date
ON public.properties
FOR EACH ROW
EXECUTE FUNCTION public.snapshot_open_weekly_contract_tasks();

CREATE OR REPLACE FUNCTION public.manager_create_task(
  selected_property_id UUID,
  selected_service_date DATE,
  selected_service_type TEXT,
  selected_service_branch TEXT DEFAULT 'pool',
  selected_weekly_service_level TEXT DEFAULT NULL,
  selected_technician_id UUID DEFAULT NULL,
  entered_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  property_row public.properties%ROWTYPE;
  technician_row public.technicians%ROWTYPE;
  new_task_id UUID := gen_random_uuid();
  normalized_branch TEXT;
  normalized_level TEXT;
  weekly_obligation_date DATE;
  weekly_obligation_key TEXT;
  weekly_contract_amount NUMERIC := 0;
  standard_day_number INTEGER;
BEGIN
  IF NOT (public.is_active_app_manager() OR public.is_active_app_admin()) THEN
    RAISE EXCEPTION 'Active manager access required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO property_row FROM public.properties WHERE id = selected_property_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Property not found' USING ERRCODE = '22023'; END IF;

  IF selected_technician_id IS NOT NULL THEN
    SELECT * INTO technician_row
    FROM public.technicians
    WHERE id = selected_technician_id AND active IS DISTINCT FROM false;
    IF NOT FOUND THEN RAISE EXCEPTION 'Active technician not found' USING ERRCODE = '22023'; END IF;
  END IF;

  normalized_branch := CASE
    WHEN lower(trim(COALESCE(selected_service_branch, ''))) = 'maintenance' THEN 'maintenance'
    WHEN lower(trim(COALESCE(selected_service_branch, ''))) = 'lawn' OR selected_service_type = 'Lawn Service' THEN 'lawn'
    ELSE 'pool'
  END;
  normalized_level := CASE
    WHEN selected_service_type = 'Weekly Standard' THEN
      CASE WHEN lower(trim(COALESCE(selected_weekly_service_level, ''))) = 'health_check' THEN 'health_check' ELSE 'full_service' END
    ELSE NULL
  END;

  IF selected_service_type = 'Weekly Standard' THEN
    standard_day_number := CASE lower(COALESCE(property_row.standard_service_day, 'Wednesday'))
      WHEN 'sunday' THEN 0 WHEN 'monday' THEN 1 WHEN 'tuesday' THEN 2
      WHEN 'wednesday' THEN 3 WHEN 'thursday' THEN 4 WHEN 'friday' THEN 5
      WHEN 'saturday' THEN 6 ELSE 3
    END;
    weekly_obligation_date := selected_service_date
      - EXTRACT(DOW FROM selected_service_date)::INTEGER
      + standard_day_number;
    weekly_obligation_key := 'wk:' || selected_property_id::TEXT || ':' || weekly_obligation_date::TEXT;
    IF property_row.weekly_contract_billing_effective_date IS NOT NULL
       AND weekly_obligation_date >= property_row.weekly_contract_billing_effective_date THEN
      weekly_contract_amount := GREATEST(0, COALESCE(property_row.weekly_contract_cleaning_amount, 0));
    END IF;
  END IF;

  INSERT INTO public.cleaning_tasks (
    id, property_id, service_date, scheduled_date, suggested_date,
    service_type, service_branch, weekly_service_level,
    technician, technician_id, technician_name, status,
    guest_ready, off_cycle, charge, source_type, source_key,
    weekly_contract_obligation_key, notes, manually_modified
  ) VALUES (
    new_task_id, selected_property_id, selected_service_date, selected_service_date, selected_service_date,
    selected_service_type, normalized_branch, normalized_level,
    CASE WHEN selected_technician_id IS NULL THEN NULL ELSE technician_row.name END,
    selected_technician_id,
    CASE WHEN selected_technician_id IS NULL THEN NULL ELSE technician_row.name END,
    'Scheduled', selected_service_type = 'Guest Ready', selected_service_type = 'Off-Cycle',
    weekly_contract_amount,
    CASE WHEN selected_service_type = 'Weekly Standard' THEN 'weekly_standard' ELSE NULL END,
    weekly_obligation_key,
    CASE WHEN weekly_contract_amount > 0 THEN weekly_obligation_key ELSE NULL END,
    NULLIF(trim(COALESCE(entered_notes, '')), ''), true
  );

  RETURN new_task_id;
END;
$$;

REVOKE ALL ON FUNCTION public.manager_create_task(UUID, DATE, TEXT, TEXT, TEXT, UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manager_create_task(UUID, DATE, TEXT, TEXT, TEXT, UUID, TEXT)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.manager_reconciliation_amount(
  target_task_id UUID,
  reconciliation_type TEXT
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  task_row public.cleaning_tasks%ROWTYPE;
  property_row public.properties%ROWTYPE;
  task_date DATE;
  task_day INTEGER;
  standard_day INTEGER;
  coverage_value TEXT;
  is_included BOOLEAN := false;
  is_manual_override BOOLEAN := false;
  has_same_day_check_in BOOLEAN := false;
  has_same_day_check_out BOOLEAN := false;
  effective_amount NUMERIC := 0;
BEGIN
  SELECT * INTO task_row FROM public.cleaning_tasks WHERE id = target_task_id;
  IF NOT FOUND OR lower(COALESCE(task_row.status, '')) <> 'completed' THEN RETURN 0; END IF;

  SELECT * INTO property_row FROM public.properties WHERE id = task_row.property_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  task_date := COALESCE(task_row.service_date, task_row.scheduled_date);

  IF reconciliation_type = 'sds' THEN
    IF NOT (task_row.guest_ready IS TRUE OR task_row.service_type = 'Guest Ready') OR task_date IS NULL THEN
      RETURN 0;
    END IF;

    SELECT
      EXISTS (
        SELECT 1 FROM public.reservations reservation
        WHERE reservation.property_id = task_row.property_id
          AND reservation.check_in::date = task_date
          AND lower(COALESCE(reservation.status, 'active')) <> 'cancelled'
      ),
      EXISTS (
        SELECT 1 FROM public.reservations reservation
        WHERE reservation.property_id = task_row.property_id
          AND reservation.check_out::date = task_date
          AND lower(COALESCE(reservation.status, 'active')) <> 'cancelled'
      )
    INTO has_same_day_check_in, has_same_day_check_out;

    IF NOT (has_same_day_check_in AND has_same_day_check_out) THEN RETURN 0; END IF;

    effective_amount := CASE
      WHEN COALESCE(task_row.same_day_surcharge_amount, 0) > 0 THEN task_row.same_day_surcharge_amount
      ELSE COALESCE(property_row.same_day_surcharge, 0)
    END;
    RETURN GREATEST(COALESCE(effective_amount, 0), 0);
  END IF;

  IF reconciliation_type <> 'task' THEN RETURN 0; END IF;

  IF COALESCE(task_row.service_branch, 'pool') = 'lawn' THEN
    effective_amount := CASE
      WHEN COALESCE(task_row.charge, 0) > 0 THEN task_row.charge
      ELSE COALESCE(property_row.lawn_default_charge, 0)
    END;
  ELSIF task_row.weekly_contract_obligation_key IS NOT NULL
     OR task_row.service_type = 'Weekly Standard' THEN
    effective_amount := COALESCE(task_row.charge, 0);
  ELSIF task_row.guest_ready IS TRUE OR task_row.service_type = 'Guest Ready' THEN
    IF task_date IS NULL THEN RETURN 0; END IF;

    task_day := EXTRACT(DOW FROM task_date)::INTEGER;
    standard_day := CASE lower(COALESCE(property_row.standard_service_day, 'Wednesday'))
      WHEN 'sunday' THEN 0 WHEN 'monday' THEN 1 WHEN 'tuesday' THEN 2
      WHEN 'wednesday' THEN 3 WHEN 'thursday' THEN 4 WHEN 'friday' THEN 5
      WHEN 'saturday' THEN 6 ELSE 3
    END;
    coverage_value := CASE
      WHEN lower(COALESCE(property_row.coverage_rule, '')) IN ('none', 'before', 'after', 'both')
        THEN lower(property_row.coverage_rule)
      WHEN COALESCE(property_row.coverage_days, 1) = 0 THEN 'none'
      ELSE 'both'
    END;
    is_included := task_day = standard_day
      OR (coverage_value IN ('before', 'both') AND task_day = (standard_day + 6) % 7)
      OR (coverage_value IN ('after', 'both') AND task_day = (standard_day + 1) % 7);
    is_manual_override := position('[Manual Override]' IN COALESCE(task_row.notes, '')) > 0
      AND COALESCE(task_row.charge, 0) > 0;

    effective_amount := CASE
      WHEN is_included AND NOT is_manual_override THEN 0
      WHEN COALESCE(task_row.charge, 0) > 0 THEN task_row.charge
      ELSE COALESCE(NULLIF(to_jsonb(property_row)->>'default_off_cycle_charge', '')::NUMERIC, 65)
    END;
  ELSE
    effective_amount := COALESCE(task_row.charge, 0);
  END IF;

  RETURN GREATEST(COALESCE(effective_amount, 0), 0);
END;
$$;

REVOKE ALL ON FUNCTION public.manager_reconciliation_amount(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.manager_reconcile_task(
  target_task_id UUID,
  reconciliation_type TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  task_row public.cleaning_tasks%ROWTYPE;
  effective_amount NUMERIC;
BEGIN
  IF NOT public.is_active_app_manager() THEN
    RAISE EXCEPTION 'Active manager access required' USING ERRCODE = '42501';
  END IF;
  IF reconciliation_type NOT IN ('task', 'sds') THEN
    RAISE EXCEPTION 'Invalid reconciliation type' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO task_row
  FROM public.cleaning_tasks
  WHERE id = target_task_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Task not found' USING ERRCODE = '22023'; END IF;

  IF NOT public.manager_reconciliation_eligible(target_task_id, reconciliation_type) THEN
    RAISE EXCEPTION 'Task is not eligible for reconciliation' USING ERRCODE = '22023';
  END IF;

  effective_amount := public.manager_reconciliation_amount(target_task_id, reconciliation_type);

  IF reconciliation_type = 'task' THEN
    UPDATE public.cleaning_tasks
    SET invoiced = true,
        charge = CASE
          WHEN COALESCE(service_branch, 'pool') = 'lawn' AND COALESCE(charge, 0) <= 0
            THEN effective_amount
          ELSE charge
        END
    WHERE id = target_task_id;
  ELSE
    UPDATE public.cleaning_tasks
    SET same_day_surcharge_reconciled = true,
        same_day_surcharge_reconciled_at = now(),
        same_day_surcharge_amount = CASE
          WHEN COALESCE(same_day_surcharge_amount, 0) <= 0 THEN effective_amount
          ELSE same_day_surcharge_amount
        END
    WHERE id = target_task_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.manager_reconcile_task(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manager_reconcile_task(UUID, TEXT) TO authenticated;

COMMIT;