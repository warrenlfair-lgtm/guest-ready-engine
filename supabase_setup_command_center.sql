-- Run manually after the role, VP2, reservation and task migrations.
-- Provision a display account separately as described in README.md.
BEGIN;

CREATE TABLE IF NOT EXISTS public.command_center_display_accounts (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.command_center_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 100),
  description TEXT,
  property_id UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  technician_id UUID REFERENCES public.technicians(id) ON DELETE SET NULL,
  due_date DATE,
  priority TEXT NOT NULL DEFAULT 'Normal' CHECK (priority IN ('Low', 'Normal', 'High', 'Urgent')),
  status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'In Progress', 'Completed')),
  pinned BOOLEAN NOT NULL DEFAULT false,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  CHECK ((status = 'Completed') = (completed_at IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS public.command_center_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 100),
  content TEXT NOT NULL CHECK (length(trim(content)) > 0),
  property_id UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  pinned BOOLEAN NOT NULL DEFAULT false,
  expires_on DATE,
  archived BOOLEAN NOT NULL DEFAULT false,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS command_center_tasks_outstanding_idx
  ON public.command_center_tasks (due_date, priority) WHERE status <> 'Completed';
CREATE INDEX IF NOT EXISTS command_center_notes_pinned_idx
  ON public.command_center_notes (expires_on) WHERE pinned AND NOT archived;

ALTER TABLE public.command_center_display_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.command_center_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.command_center_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.command_center_display_accounts, public.command_center_tasks,
  public.command_center_notes FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.command_center_can_manage()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth
AS $$
  SELECT public.is_active_app_admin() OR public.is_active_app_manager();
$$;
REVOKE ALL ON FUNCTION public.command_center_can_manage() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.command_center_manage_data()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.command_center_can_manage() THEN
    RAISE EXCEPTION 'Active admin or manager access required' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'properties', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', property_name) ORDER BY property_name)
      FROM public.properties), '[]'::jsonb),
    'technicians', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name) ORDER BY name)
      FROM public.technicians), '[]'::jsonb),
    'tasks', COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC) FROM public.command_center_tasks t), '[]'::jsonb),
    'notes', COALESCE((SELECT jsonb_agg(to_jsonb(n) ORDER BY n.created_at DESC) FROM public.command_center_notes n), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.command_center_save_task(
  target_id UUID, task_title TEXT, task_description TEXT, task_property_id UUID,
  task_technician_id UUID, task_due_date DATE, task_priority TEXT, task_status TEXT, task_pinned BOOLEAN
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE result_id UUID;
BEGIN
  IF NOT public.command_center_can_manage() THEN
    RAISE EXCEPTION 'Active admin or manager access required' USING ERRCODE = '42501';
  END IF;
  IF task_title IS NULL OR length(trim(task_title)) NOT BETWEEN 1 AND 100
     OR task_priority NOT IN ('Low', 'Normal', 'High', 'Urgent')
     OR task_status NOT IN ('Open', 'In Progress', 'Completed')
     OR task_pinned IS NULL THEN
    RAISE EXCEPTION 'Invalid special task fields' USING ERRCODE = '22023';
  END IF;
  IF target_id IS NULL THEN
    INSERT INTO public.command_center_tasks
      (title, description, property_id, technician_id, due_date, priority, status, pinned, created_by, completed_at)
    VALUES (trim(task_title), NULLIF(trim(task_description), ''), task_property_id, task_technician_id,
      task_due_date, task_priority, task_status, task_pinned, auth.uid(),
      CASE WHEN task_status = 'Completed' THEN now() END)
    RETURNING id INTO result_id;
  ELSE
    UPDATE public.command_center_tasks SET title = trim(task_title), description = NULLIF(trim(task_description), ''),
      property_id = task_property_id, technician_id = task_technician_id, due_date = task_due_date,
      priority = task_priority, status = task_status, pinned = task_pinned,
      completed_at = CASE WHEN task_status = 'Completed' THEN COALESCE(completed_at, now()) ELSE NULL END
    WHERE id = target_id RETURNING id INTO result_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Special task not found' USING ERRCODE = '22023'; END IF;
  END IF;
  RETURN result_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.command_center_save_note(
  target_id UUID, note_title TEXT, note_content TEXT, note_property_id UUID,
  note_pinned BOOLEAN, note_expires_on DATE, note_archived BOOLEAN
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE result_id UUID;
BEGIN
  IF NOT public.command_center_can_manage() THEN
    RAISE EXCEPTION 'Active admin or manager access required' USING ERRCODE = '42501';
  END IF;
  IF note_title IS NULL OR length(trim(note_title)) NOT BETWEEN 1 AND 100
     OR note_content IS NULL OR length(trim(note_content)) = 0
     OR note_pinned IS NULL OR note_archived IS NULL THEN
    RAISE EXCEPTION 'Invalid note fields' USING ERRCODE = '22023';
  END IF;
  IF target_id IS NULL THEN
    INSERT INTO public.command_center_notes (title, content, property_id, pinned, expires_on, archived, created_by)
    VALUES (trim(note_title), trim(note_content), note_property_id, note_pinned, note_expires_on, note_archived, auth.uid())
    RETURNING id INTO result_id;
  ELSE
    UPDATE public.command_center_notes SET title = trim(note_title), content = trim(note_content),
      property_id = note_property_id, pinned = note_pinned, expires_on = note_expires_on, archived = note_archived
    WHERE id = target_id RETURNING id INTO result_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Note not found' USING ERRCODE = '22023'; END IF;
  END IF;
  RETURN result_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.command_center_snapshot()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE today DATE := (now() AT TIME ZONE 'America/New_York')::date;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.is_active_app_admin()
    OR EXISTS (SELECT 1 FROM public.command_center_display_accounts WHERE user_id = auth.uid() AND active)
  ) THEN
    RAISE EXCEPTION 'Command Center access required' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'business_date', today,
    'snapshot_version', 3,
    'services', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', t.id, 'property', p.property_name, 'date', COALESCE(t.service_date, t.scheduled_date),
        'type', t.service_type, 'branch', t.service_branch, 'status', t.status,
        'guest_ready', t.guest_ready, 'off_cycle', t.off_cycle,
        'technician', COALESCE(NULLIF(t.technician_name, ''), NULLIF(t.technician, ''), tech.name),
        'overdue_reference_date', t.overdue_reference_date,
        'original_service_date', t.original_service_date,
        'carry_forward_count', t.carry_forward_count,
        'completed_at', t.completed_at
      ) ORDER BY COALESCE(t.service_date, t.scheduled_date), p.property_name, t.id)
      FROM public.cleaning_tasks t JOIN public.properties p ON p.id = t.property_id
      LEFT JOIN public.technicians tech ON tech.id = t.technician_id
      WHERE lower(COALESCE(t.status, 'scheduled')) NOT IN ('cancelled', 'canceled')
        AND t.service_date BETWEEN today AND today + 6
        AND (p.active IS DISTINCT FROM false OR lower(COALESCE(t.status, '')) = 'completed' OR t.completed_at IS NOT NULL)
    ), '[]'::jsonb),
    'reviews', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', r.id, 'property', p.property_name,
        'date', r.scheduled_date, 'kind', r.review_kind, 'status', r.status)
        ORDER BY r.scheduled_date, p.property_name, r.id)
      FROM public.vp2_reviews r JOIN public.properties p ON p.id = r.property_id
      WHERE p.vp2_enabled AND p.active IS DISTINCT FROM false AND r.status <> 'cancelled'
        AND r.scheduled_date BETWEEN today - (EXTRACT(ISODOW FROM today)::integer - 1) AND today + 6
        AND (r.scheduled_date >= today OR r.status <> 'completed')
    ), '[]'::jsonb),
    'arrivals', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', r.id, 'property', p.property_name, 'date', r.check_in)
        ORDER BY r.check_in, p.property_name, r.id)
      FROM public.reservations r JOIN public.properties p ON p.id = r.property_id
      WHERE COALESCE(lower(r.status), 'active') <> 'cancelled'
        AND COALESCE(r.guest_name, '') !~* '\m(blocked?|on hold|hold|not available|unavailable|closed)\M'
        AND r.check_in::date BETWEEN today AND today + 6
    ), '[]'::jsonb),
    'tasks', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'description', t.description,
        'property', p.property_name, 'technician', tech.name, 'date', t.due_date,
        'priority', t.priority, 'status', t.status, 'pinned', t.pinned)
        ORDER BY t.due_date NULLS LAST, t.created_at)
      FROM public.command_center_tasks t
      LEFT JOIN public.properties p ON p.id = t.property_id
      LEFT JOIN public.technicians tech ON tech.id = t.technician_id
      WHERE t.status <> 'Completed'
    ), '[]'::jsonb),
    'notes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', n.id, 'title', n.title, 'content', n.content, 'property', p.property_name)
        ORDER BY n.created_at DESC)
      FROM public.command_center_notes n LEFT JOIN public.properties p ON p.id = n.property_id
      WHERE n.pinned AND NOT n.archived AND (n.expires_on IS NULL OR n.expires_on >= today)
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.command_center_manage_data() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.command_center_save_task(UUID, TEXT, TEXT, UUID, UUID, DATE, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.command_center_save_note(UUID, TEXT, TEXT, UUID, BOOLEAN, DATE, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.command_center_snapshot() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.command_center_manage_data() TO authenticated;
GRANT EXECUTE ON FUNCTION public.command_center_save_task(UUID, TEXT, TEXT, UUID, UUID, DATE, TEXT, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.command_center_save_note(UUID, TEXT, TEXT, UUID, BOOLEAN, DATE, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.command_center_snapshot() TO authenticated;
COMMIT;
