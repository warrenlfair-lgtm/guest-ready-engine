-- Run after supabase_setup_foul_weather_fee.sql.
BEGIN;

ALTER TABLE public.cleaning_tasks
ADD COLUMN IF NOT EXISTS heavy_debris_amount NUMERIC(10,2);

ALTER TABLE public.cleaning_tasks DROP CONSTRAINT IF EXISTS cleaning_tasks_heavy_debris_amount_check;
ALTER TABLE public.cleaning_tasks ADD CONSTRAINT cleaning_tasks_heavy_debris_amount_check
CHECK (heavy_debris_amount IS NULL OR heavy_debris_amount BETWEEN 20 AND 50);

ALTER TABLE public.invoice_items DROP CONSTRAINT IF EXISTS invoice_items_item_source_check;
ALTER TABLE public.invoice_items ADD CONSTRAINT invoice_items_item_source_check
CHECK (item_source IS NULL OR item_source IN ('manual', 'task', 'chemical', 'sds', 'vp2', 'vp2e', 'foul_weather', 'heavy_debris'));

CREATE UNIQUE INDEX IF NOT EXISTS invoice_items_heavy_debris_invoice_task_uidx
ON public.invoice_items (invoice_id, task_id) WHERE item_source = 'heavy_debris';

CREATE OR REPLACE FUNCTION public.protect_task_heavy_debris()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.heavy_debris_amount IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND NEW.heavy_debris_amount IS DISTINCT FROM OLD.heavy_debris_amount) THEN
    IF NOT (public.is_active_app_admin() OR public.is_active_app_manager()) THEN
      RAISE EXCEPTION 'Active admin or manager access required' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'UPDATE' AND public.task_foul_weather_invoice_locked(OLD.id) THEN
      RAISE EXCEPTION 'Heavy debris fee cannot be changed after the task is invoiced';
    END IF;
  END IF;
  IF NEW.heavy_debris_amount IS NOT NULL AND (
    NOT (NEW.guest_ready IS TRUE OR NEW.service_type IS NOT DISTINCT FROM 'Guest Ready')
    OR COALESCE(NEW.service_branch, 'pool') <> 'pool'
    OR lower(COALESCE(NEW.status, '')) <> 'completed'
  ) THEN
    RAISE EXCEPTION 'Heavy debris fee requires a completed Guest Ready pool task';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cleaning_tasks_protect_heavy_debris ON public.cleaning_tasks;
CREATE TRIGGER cleaning_tasks_protect_heavy_debris
BEFORE INSERT OR UPDATE ON public.cleaning_tasks
FOR EACH ROW EXECUTE FUNCTION public.protect_task_heavy_debris();

CREATE OR REPLACE FUNCTION public.get_task_heavy_debris(target_task_id UUID)
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
  RETURN jsonb_build_object('heavy_debris_amount', task_row.heavy_debris_amount,
    'locked', public.task_foul_weather_invoice_locked(task_row.id));
END;
$$;

CREATE OR REPLACE FUNCTION public.set_task_heavy_debris(target_task_id UUID, selected_amount NUMERIC)
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
  IF selected_amount IS NOT NULL AND
     (selected_amount NOT BETWEEN 20 AND 50 OR selected_amount <> round(selected_amount, 2)) THEN
    RAISE EXCEPTION 'Heavy debris fee must be between $20 and $50 with at most two decimal places' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO task_row FROM public.cleaning_tasks WHERE id = target_task_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found' USING ERRCODE = '22023';
  END IF;
  IF NOT (task_row.guest_ready IS TRUE OR task_row.service_type IS NOT DISTINCT FROM 'Guest Ready')
     OR COALESCE(task_row.service_branch, 'pool') <> 'pool'
     OR lower(COALESCE(task_row.status, '')) <> 'completed' THEN
    RAISE EXCEPTION 'Heavy debris fee requires a completed Guest Ready pool task';
  END IF;
  UPDATE public.cleaning_tasks SET heavy_debris_amount = selected_amount WHERE id = target_task_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_task_heavy_debris(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_task_heavy_debris(UUID, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_task_heavy_debris(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_task_heavy_debris(UUID, NUMERIC) TO authenticated;

CREATE OR REPLACE FUNCTION public.validate_heavy_debris_invoice()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status NOT IN ('finalized', 'sent', 'paid')
     OR OLD.status IN ('finalized', 'sent', 'paid') THEN
    RETURN NEW;
  END IF;

  PERFORM task.id FROM public.cleaning_tasks task
  WHERE task.id IN (
    SELECT item.task_id FROM public.invoice_items item
    WHERE item.invoice_id = NEW.id AND item.item_source IN ('task', 'heavy_debris')
      AND item.task_id IS NOT NULL
  )
  ORDER BY task.id FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM public.invoice_items fee
    LEFT JOIN public.cleaning_tasks task ON task.id = fee.task_id
    WHERE fee.invoice_id = NEW.id AND fee.item_source = 'heavy_debris'
      AND (
        task.id IS NULL OR task.heavy_debris_amount IS NULL
        OR NOT (task.guest_ready IS TRUE OR task.service_type IS NOT DISTINCT FROM 'Guest Ready')
        OR COALESCE(task.service_branch, 'pool') <> 'pool'
        OR lower(COALESCE(task.status, '')) <> 'completed'
        OR fee.property_id IS DISTINCT FROM task.property_id
        OR fee.quantity IS DISTINCT FROM 1
        OR fee.rate IS DISTINCT FROM task.heavy_debris_amount
        OR fee.amount IS DISTINCT FROM task.heavy_debris_amount
        OR NOT EXISTS (
          SELECT 1 FROM public.invoice_items base
          WHERE base.invoice_id = NEW.id AND base.task_id = fee.task_id
            AND base.item_source = 'task' AND base.amount > 0
        )
        OR EXISTS (
          SELECT 1 FROM public.invoice_items other
          JOIN public.invoices other_invoice ON other_invoice.id = other.invoice_id
          WHERE other.task_id = fee.task_id AND other.item_source = 'heavy_debris'
            AND other.invoice_id <> NEW.id AND other_invoice.status IN ('finalized', 'sent', 'paid')
        )
      )
  ) THEN
    RAISE EXCEPTION 'Heavy debris fee is invalid or already invoiced. Refresh and regenerate the invoice.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.invoice_items base
    JOIN public.cleaning_tasks task ON task.id = base.task_id
    WHERE base.invoice_id = NEW.id AND base.item_source = 'task'
      AND base.amount > 0 AND task.heavy_debris_amount IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.invoice_items fee
        WHERE fee.invoice_id = NEW.id AND fee.task_id = base.task_id
          AND fee.item_source = 'heavy_debris'
      )
  ) THEN
    RAISE EXCEPTION 'A selected heavy debris fee is missing. Refresh and regenerate the invoice.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM (
      SELECT item.item_source, item.task_id,
        lag(item.item_source) OVER (ORDER BY item.created_at, item.id) AS previous_source,
        lag(item.task_id) OVER (ORDER BY item.created_at, item.id) AS previous_task_id
      FROM public.invoice_items item WHERE item.invoice_id = NEW.id
    ) ordered
    WHERE ordered.item_source = 'heavy_debris'
      AND (ordered.previous_source NOT IN ('task', 'foul_weather')
        OR ordered.previous_source IS NULL
        OR ordered.previous_task_id IS DISTINCT FROM ordered.task_id)
  ) THEN
    RAISE EXCEPTION 'Each heavy debris fee must follow its Guest Ready line or its foul weather fee. Refresh and regenerate the invoice.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invoices_validate_heavy_debris ON public.invoices;
CREATE TRIGGER invoices_validate_heavy_debris
BEFORE UPDATE OF status ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.validate_heavy_debris_invoice();

COMMIT;
