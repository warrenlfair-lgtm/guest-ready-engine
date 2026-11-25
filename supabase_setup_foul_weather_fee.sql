-- Run after the invoice, role-based access, SDS, and VP²E billing migrations.
-- Adds a task-level foul weather flag and protects its invoice line.
BEGIN;

ALTER TABLE public.cleaning_tasks
ADD COLUMN IF NOT EXISTS foul_weather BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.invoice_items
DROP CONSTRAINT IF EXISTS invoice_items_item_source_check;
ALTER TABLE public.invoice_items
ADD CONSTRAINT invoice_items_item_source_check
CHECK (item_source IS NULL OR item_source IN ('manual', 'task', 'chemical', 'sds', 'vp2', 'vp2e', 'foul_weather', 'heavy_debris'));

CREATE UNIQUE INDEX IF NOT EXISTS invoice_items_foul_weather_invoice_task_uidx
ON public.invoice_items (invoice_id, task_id)
WHERE item_source = 'foul_weather';

CREATE OR REPLACE FUNCTION public.task_foul_weather_invoice_locked(target_task_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.invoice_items item
    JOIN public.invoices invoice ON invoice.id = item.invoice_id
    WHERE item.task_id = target_task_id
      AND item.item_source IN ('task', 'foul_weather')
      AND invoice.status IN ('finalized', 'sent', 'paid')
  ) OR EXISTS (
    SELECT 1
    FROM public.cleaning_tasks task
    JOIN public.invoices invoice ON invoice.id IN (task.invoice_id, task.invoiced_invoice_id)
    WHERE task.id = target_task_id
      AND invoice.status IN ('finalized', 'sent', 'paid')
  );
$$;
REVOKE ALL ON FUNCTION public.task_foul_weather_invoice_locked(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.protect_task_foul_weather()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.foul_weather IS DISTINCT FROM OLD.foul_weather THEN
    IF NOT (public.is_active_app_admin() OR public.is_active_app_manager()) THEN
      RAISE EXCEPTION 'Active admin or manager access required' USING ERRCODE = '42501';
    END IF;
    IF public.task_foul_weather_invoice_locked(OLD.id) THEN
      RAISE EXCEPTION 'Foul weather cannot be changed after the task is invoiced';
    END IF;
  END IF;

  IF NEW.foul_weather IS TRUE AND (
    NOT (NEW.guest_ready IS TRUE OR NEW.service_type IS NOT DISTINCT FROM 'Guest Ready')
    OR COALESCE(NEW.service_branch, 'pool') <> 'pool'
    OR lower(COALESCE(NEW.status, '')) <> 'completed'
  ) THEN
    RAISE EXCEPTION 'Foul weather requires a completed Guest Ready pool task';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cleaning_tasks_protect_foul_weather ON public.cleaning_tasks;
CREATE TRIGGER cleaning_tasks_protect_foul_weather
BEFORE UPDATE ON public.cleaning_tasks
FOR EACH ROW EXECUTE FUNCTION public.protect_task_foul_weather();

CREATE OR REPLACE FUNCTION public.get_task_foul_weather(target_task_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  task_row public.cleaning_tasks%ROWTYPE;
BEGIN
  IF NOT (public.is_active_app_admin() OR public.is_active_app_manager()) THEN
    RAISE EXCEPTION 'Active admin or manager access required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO task_row FROM public.cleaning_tasks WHERE id = target_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object(
    'foul_weather', task_row.foul_weather,
    'locked', public.task_foul_weather_invoice_locked(task_row.id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_task_foul_weather(target_task_id UUID, selected_foul_weather BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  task_row public.cleaning_tasks%ROWTYPE;
BEGIN
  IF NOT (public.is_active_app_admin() OR public.is_active_app_manager()) THEN
    RAISE EXCEPTION 'Active admin or manager access required' USING ERRCODE = '42501';
  END IF;
  IF selected_foul_weather IS NULL THEN
    RAISE EXCEPTION 'Foul weather selection is required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO task_row FROM public.cleaning_tasks WHERE id = target_task_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found' USING ERRCODE = '22023';
  END IF;
  IF NOT (task_row.guest_ready IS TRUE OR task_row.service_type IS NOT DISTINCT FROM 'Guest Ready')
     OR COALESCE(task_row.service_branch, 'pool') <> 'pool'
     OR lower(COALESCE(task_row.status, '')) <> 'completed' THEN
    RAISE EXCEPTION 'Foul weather requires a completed Guest Ready pool task';
  END IF;
  UPDATE public.cleaning_tasks
  SET foul_weather = selected_foul_weather
  WHERE id = target_task_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_task_foul_weather(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_task_foul_weather(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_task_foul_weather(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_task_foul_weather(UUID, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.validate_foul_weather_invoice()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status NOT IN ('finalized', 'sent', 'paid')
     OR OLD.status IN ('finalized', 'sent', 'paid') THEN
    RETURN NEW;
  END IF;

  PERFORM task.id
  FROM public.cleaning_tasks task
  WHERE task.id IN (
    SELECT item.task_id FROM public.invoice_items item
    WHERE item.invoice_id = NEW.id AND item.item_source IN ('task', 'foul_weather')
      AND item.task_id IS NOT NULL
  )
  ORDER BY task.id
  FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM public.invoice_items fee
    LEFT JOIN public.cleaning_tasks task ON task.id = fee.task_id
    WHERE fee.invoice_id = NEW.id AND fee.item_source = 'foul_weather'
      AND (
        task.id IS NULL OR task.foul_weather IS DISTINCT FROM TRUE
        OR NOT (task.guest_ready IS TRUE OR task.service_type IS NOT DISTINCT FROM 'Guest Ready')
        OR COALESCE(task.service_branch, 'pool') <> 'pool'
        OR lower(COALESCE(task.status, '')) <> 'completed'
        OR fee.property_id IS DISTINCT FROM task.property_id
        OR fee.quantity IS DISTINCT FROM 1 OR fee.rate IS DISTINCT FROM 20
        OR fee.amount IS DISTINCT FROM 20
        OR NOT EXISTS (
          SELECT 1 FROM public.invoice_items base
          WHERE base.invoice_id = NEW.id AND base.task_id = fee.task_id
            AND base.item_source = 'task' AND base.amount > 0
        )
        OR EXISTS (
          SELECT 1 FROM public.invoice_items other
          JOIN public.invoices other_invoice ON other_invoice.id = other.invoice_id
          WHERE other.task_id = fee.task_id AND other.item_source = 'foul_weather'
            AND other.invoice_id <> NEW.id AND other_invoice.status IN ('finalized', 'sent', 'paid')
        )
      )
  ) THEN
    RAISE EXCEPTION 'Foul weather fee is invalid or already invoiced. Refresh and regenerate the invoice.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.invoice_items base
    JOIN public.cleaning_tasks task ON task.id = base.task_id
    WHERE base.invoice_id = NEW.id AND base.item_source = 'task'
      AND base.amount > 0 AND task.foul_weather IS TRUE
      AND NOT EXISTS (
        SELECT 1 FROM public.invoice_items fee
        WHERE fee.invoice_id = NEW.id AND fee.task_id = base.task_id
          AND fee.item_source = 'foul_weather'
      )
  ) THEN
    RAISE EXCEPTION 'A checked foul weather fee is missing. Refresh and regenerate the invoice.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM (
      SELECT item.item_source, item.task_id,
        lag(item.item_source) OVER (ORDER BY item.created_at, item.id) AS previous_source,
        lag(item.task_id) OVER (ORDER BY item.created_at, item.id) AS previous_task_id
      FROM public.invoice_items item
      WHERE item.invoice_id = NEW.id
    ) ordered
    WHERE ordered.item_source = 'foul_weather'
      AND (ordered.previous_source IS DISTINCT FROM 'task'
        OR ordered.previous_task_id IS DISTINCT FROM ordered.task_id)
  ) THEN
    RAISE EXCEPTION 'Each foul weather fee must follow its Guest Ready line. Refresh and regenerate the invoice.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invoices_validate_foul_weather ON public.invoices;
CREATE TRIGGER invoices_validate_foul_weather
BEFORE UPDATE OF status ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.validate_foul_weather_invoice();

COMMIT;
