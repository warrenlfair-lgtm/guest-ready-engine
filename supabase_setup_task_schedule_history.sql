-- Add immutable original scheduling dates and append-only task move history.
-- Run manually in the Supabase SQL Editor as the postgres/database owner.

BEGIN;

UPDATE public.cleaning_tasks
SET original_service_date = COALESCE(service_date, scheduled_date)
WHERE original_service_date IS NULL
  AND COALESCE(service_date, scheduled_date) IS NOT NULL;

COMMENT ON COLUMN public.cleaning_tasks.original_service_date IS
  'Immutable date on which the task was first scheduled; later moves are recorded in task_schedule_history.';

CREATE TABLE IF NOT EXISTS public.task_schedule_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL,
  property_id UUID NOT NULL,
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  move_type TEXT NOT NULL,
  changed_by UUID,
  changed_by_label TEXT NOT NULL DEFAULT 'System',
  changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT task_schedule_history_dates_differ CHECK (from_date <> to_date),
  CONSTRAINT task_schedule_history_move_type_check CHECK (
    move_type IN ('manual_edit', 'calendar_drag', 'carry_forward', 'ical_update', 'system_reschedule')
  )
);

CREATE INDEX IF NOT EXISTS idx_task_schedule_history_task_changed
ON public.task_schedule_history(task_id, changed_at, id);

CREATE INDEX IF NOT EXISTS idx_task_schedule_history_property_changed
ON public.task_schedule_history(property_id, changed_at);

COMMENT ON TABLE public.task_schedule_history IS
  'Append-only audit trail for every cleaning task service-date change.';

ALTER TABLE public.task_schedule_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS task_schedule_history_admin_manager_select
  ON public.task_schedule_history;
CREATE POLICY task_schedule_history_admin_manager_select
ON public.task_schedule_history
FOR SELECT
TO authenticated
USING (public.is_active_app_admin() OR public.is_active_app_manager());

REVOKE ALL ON TABLE public.task_schedule_history FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.task_schedule_history TO authenticated;

CREATE OR REPLACE FUNCTION public.preserve_task_original_service_date()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.original_service_date := COALESCE(
      NEW.original_service_date,
      NEW.service_date,
      NEW.scheduled_date
    );
  ELSE
    NEW.original_service_date := COALESCE(
      OLD.original_service_date,
      OLD.service_date,
      OLD.scheduled_date,
      NEW.service_date,
      NEW.scheduled_date
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS preserve_task_original_service_date
  ON public.cleaning_tasks;
CREATE TRIGGER preserve_task_original_service_date
BEFORE INSERT OR UPDATE OF original_service_date, service_date, scheduled_date
ON public.cleaning_tasks
FOR EACH ROW
EXECUTE FUNCTION public.preserve_task_original_service_date();

CREATE OR REPLACE FUNCTION public.record_task_schedule_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  previous_date DATE := COALESCE(OLD.service_date, OLD.scheduled_date);
  next_date DATE := COALESCE(NEW.service_date, NEW.scheduled_date);
  requested_move_type TEXT := NULLIF(
    current_setting('guest_engine.task_schedule_move_type', true),
    ''
  );
  resolved_move_type TEXT;
  actor_id UUID := auth.uid();
  actor_label TEXT := COALESCE(NULLIF(auth.jwt() ->> 'email', ''), 'System');
BEGIN
  IF previous_date IS NOT DISTINCT FROM next_date THEN
    RETURN NEW;
  END IF;

  resolved_move_type := CASE
    WHEN COALESCE(NEW.carry_forward_count, 0) > COALESCE(OLD.carry_forward_count, 0)
      THEN 'carry_forward'
    WHEN requested_move_type IN ('manual_edit', 'calendar_drag', 'system_reschedule')
      THEN requested_move_type
    WHEN OLD.manually_modified IS DISTINCT FROM true
      AND NEW.manually_modified IS DISTINCT FROM true
      AND (
        lower(COALESCE(OLD.source_type, NEW.source_type, '')) IN (
          'reservation_guest_ready',
          'reservation_housekeeping'
        )
        OR COALESCE(OLD.source_key, NEW.source_key, '') LIKE 'gr:%'
        OR COALESCE(OLD.source_key, NEW.source_key, '') LIKE 'hk:%'
      )
      THEN 'ical_update'
    ELSE 'system_reschedule'
  END;

  IF resolved_move_type IN ('carry_forward', 'ical_update', 'system_reschedule') THEN
    actor_id := NULL;
    actor_label := 'System';
  END IF;

  INSERT INTO public.task_schedule_history (
    task_id,
    property_id,
    from_date,
    to_date,
    move_type,
    changed_by,
    changed_by_label
  ) VALUES (
    NEW.id,
    NEW.property_id,
    previous_date,
    next_date,
    resolved_move_type,
    actor_id,
    actor_label
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS record_task_schedule_history
  ON public.cleaning_tasks;
CREATE TRIGGER record_task_schedule_history
AFTER UPDATE OF service_date, scheduled_date
ON public.cleaning_tasks
FOR EACH ROW
EXECUTE FUNCTION public.record_task_schedule_history();

DROP FUNCTION IF EXISTS public.manager_reschedule_task(UUID, DATE);
DROP FUNCTION IF EXISTS public.manager_reschedule_task(UUID, DATE, TEXT);
CREATE FUNCTION public.manager_reschedule_task(
  target_task_id UUID,
  selected_service_date DATE,
  selected_move_type TEXT DEFAULT 'manual_edit'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  task_row public.cleaning_tasks%ROWTYPE;
  business_date DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::DATE;
  normalized_move_type TEXT := lower(trim(COALESCE(selected_move_type, 'manual_edit')));
BEGIN
  IF NOT (public.is_active_app_manager() OR public.is_active_app_admin()) THEN
    RAISE EXCEPTION 'Active manager or admin access required' USING ERRCODE = '42501';
  END IF;
  IF normalized_move_type NOT IN ('manual_edit', 'calendar_drag') THEN
    RAISE EXCEPTION 'Invalid manual move type' USING ERRCODE = '22023';
  END IF;
  IF selected_service_date IS NULL OR selected_service_date < business_date THEN
    RAISE EXCEPTION 'A current or future service date is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO task_row
  FROM public.cleaning_tasks
  WHERE id = target_task_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found' USING ERRCODE = '22023';
  END IF;

  IF lower(COALESCE(task_row.status, 'scheduled')) NOT IN ('scheduled', 'in progress', 'in_progress')
     OR task_row.completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Completed or inactive tasks cannot be rescheduled' USING ERRCODE = '22023';
  END IF;
  IF task_row.invoiced IS TRUE
     OR task_row.invoice_id IS NOT NULL
     OR task_row.invoiced_invoice_id IS NOT NULL
     OR task_row.same_day_surcharge_reconciled IS TRUE
     OR task_row.same_day_surcharge_invoice_id IS NOT NULL THEN
    RAISE EXCEPTION 'Reconciled or invoiced tasks cannot be rescheduled' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(task_row.service_date, task_row.scheduled_date) < business_date THEN
    RAISE EXCEPTION 'Historical tasks cannot be rescheduled' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(task_row.service_date, task_row.scheduled_date) IS NOT DISTINCT FROM selected_service_date THEN
    RETURN;
  END IF;

  PERFORM set_config('guest_engine.task_schedule_move_type', normalized_move_type, true);

  UPDATE public.cleaning_tasks
  SET service_date = selected_service_date,
      scheduled_date = selected_service_date,
      overdue_reference_date = selected_service_date,
      manually_modified = true
  WHERE id = target_task_id;
END;
$$;

REVOKE ALL ON FUNCTION public.manager_reschedule_task(UUID, DATE, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manager_reschedule_task(UUID, DATE, TEXT)
  TO authenticated;

COMMIT;
