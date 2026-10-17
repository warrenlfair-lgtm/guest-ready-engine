-- VP² technician action plans and token-scoped public completion links.
-- Run manually after supabase_setup_vp2_billing.sql.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

ALTER TABLE public.vp2_work_orders
  ADD COLUMN IF NOT EXISTS completion_checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS technician_notes TEXT;

CREATE TABLE IF NOT EXISTS public.vp2_action_plan_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_plan_id UUID NOT NULL REFERENCES public.vp2_action_plans(id) ON DELETE CASCADE,
  token_hash BYTEA NOT NULL UNIQUE,
  token_secret_id UUID,
  plan_snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  last_viewed_at TIMESTAMPTZ,
  view_count BIGINT NOT NULL DEFAULT 0 CHECK (view_count >= 0),
  completed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS vp2_action_plan_links_one_active_uidx
  ON public.vp2_action_plan_links(action_plan_id)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS vp2_action_plan_links_created_idx
  ON public.vp2_action_plan_links(action_plan_id, created_at DESC);

ALTER TABLE public.vp2_action_plan_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vp2_action_plan_links_admin_select ON public.vp2_action_plan_links;
CREATE POLICY vp2_action_plan_links_admin_select ON public.vp2_action_plan_links
  FOR SELECT TO authenticated USING (public.is_active_app_admin());
REVOKE ALL ON TABLE public.vp2_action_plan_links FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.vp2_action_plan_links TO authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'vp2-technician-photos',
  'vp2-technician-photos',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE OR REPLACE FUNCTION public.vp2_technician_photo_folder_access(folder_hash TEXT, for_upload BOOLEAN DEFAULT false)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  stored_photo_count INTEGER;
BEGIN
  IF folder_hash IS NULL OR folder_hash !~ '^[0-9a-fA-F]{64}$' THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.vp2_action_plan_links link
    JOIN public.vp2_action_plans plan ON plan.id = link.action_plan_id
    JOIN public.vp2_reviews review ON review.id = plan.review_id
    JOIN public.vp2_work_orders work_order ON work_order.review_id = plan.review_id
    WHERE link.token_hash = decode(lower(folder_hash), 'hex')
      AND link.revoked_at IS NULL
      AND link.expires_at > now()
      AND review.status <> 'cancelled'
      AND plan.status IN ('sent', 'completed')
      AND (NOT for_upload OR (plan.status = 'sent' AND work_order.status <> 'completed'))
  ) THEN
    RETURN false;
  END IF;

  IF for_upload THEN
    SELECT count(*)::INTEGER INTO stored_photo_count
    FROM storage.objects object
    WHERE object.bucket_id = 'vp2-technician-photos'
      AND object.name LIKE lower(folder_hash) || '/%';
    IF stored_photo_count >= 10 THEN
      RETURN false;
    END IF;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.vp2_technician_photo_folder_access(TEXT, BOOLEAN) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.vp2_technician_photo_folder_access(TEXT, BOOLEAN) TO anon;

DROP POLICY IF EXISTS vp2_technician_photo_upload ON storage.objects;
CREATE POLICY vp2_technician_photo_upload ON storage.objects
  FOR INSERT TO anon
  WITH CHECK (
    bucket_id = 'vp2-technician-photos'
    AND public.vp2_technician_photo_folder_access(split_part(name, '/', 1), true)
  );

DROP POLICY IF EXISTS vp2_technician_photo_read ON storage.objects;
CREATE POLICY vp2_technician_photo_read ON storage.objects
  FOR SELECT TO anon
  USING (
    bucket_id = 'vp2-technician-photos'
    AND public.vp2_technician_photo_folder_access(split_part(name, '/', 1), false)
  );

CREATE OR REPLACE FUNCTION public.revoke_vp2_action_plan_link_on_review_cancel()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM NEW.status THEN
    DELETE FROM vault.secrets secret
    USING public.vp2_action_plans plan, public.vp2_action_plan_links link
    WHERE plan.review_id = NEW.id
      AND link.action_plan_id = plan.id
      AND link.revoked_at IS NULL
      AND secret.id = link.token_secret_id;

    UPDATE public.vp2_action_plan_links link
    SET revoked_at = now(),
        revoked_reason = 'VP² review cancelled',
        token_secret_id = NULL
    FROM public.vp2_action_plans plan
    WHERE plan.review_id = NEW.id
      AND link.action_plan_id = plan.id
      AND link.revoked_at IS NULL;

    UPDATE public.vp2_action_plans
    SET status = 'rejected', updated_at = now()
    WHERE review_id = NEW.id AND status = 'sent';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vp2_action_plan_revoke_on_review_cancel ON public.vp2_reviews;
CREATE TRIGGER vp2_action_plan_revoke_on_review_cancel
AFTER UPDATE OF status ON public.vp2_reviews
FOR EACH ROW EXECUTE FUNCTION public.revoke_vp2_action_plan_link_on_review_cancel();
REVOKE ALL ON FUNCTION public.revoke_vp2_action_plan_link_on_review_cancel() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.vp2_standard_service_tasks()
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT jsonb_build_array(
    'Brush pool walls, steps, and floor',
    'Skim surface and remove debris',
    'Check filter pressure and record PSI',
    'Inspect and empty skimmer basket',
    'Inspect and empty pump basket as needed',
    'Check pool water level and adjust if necessary',
    'Verify pump operation and water circulation',
    'Inspect pool returns and skimmer suction',
    'Check for visible leaks or equipment issues',
    'Independently test free chlorine and pH',
    'Verify chemical treatment instructions and complete approved adjustments',
    'Check overall water clarity and visible pool condition',
    'Secure equipment area and leave pool area clean'
  );
$$;
REVOKE ALL ON FUNCTION public.vp2_standard_service_tasks() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_vp2_action_plan(target_review_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSONB;
BEGIN
  IF NOT public.is_active_app_admin() THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'id', plan.id,
    'review_id', plan.review_id,
    'property_id', plan.property_id,
    'status', plan.status,
    'summary', plan.summary,
    'plan_data', plan.plan_data,
    'created_at', plan.created_at,
    'review_status', (
      SELECT review.status
      FROM public.vp2_reviews review
      WHERE review.id = plan.review_id
    ),
    'work_order_id', work_order.id,
    'work_order_status', work_order.status,
    'completion_checklist', COALESCE(work_order.completion_checklist, '[]'::jsonb),
    'technician_notes', work_order.technician_notes,
    'technician_photos', COALESCE(work_order.photographs, '[]'::jsonb),
    'work_order_completed_at', work_order.completed_at,
    'technician_plan_snapshot', (
      SELECT link.plan_snapshot
      FROM public.vp2_action_plan_links link
      WHERE link.action_plan_id = plan.id
      ORDER BY link.created_at DESC
      LIMIT 1
    ),
    'active_link', EXISTS (
      SELECT 1 FROM public.vp2_action_plan_links link
      WHERE link.action_plan_id = plan.id
        AND link.revoked_at IS NULL
        AND link.expires_at > now()
    )
  ) INTO result
  FROM public.vp2_action_plans plan
  LEFT JOIN public.vp2_work_orders work_order ON work_order.review_id = plan.review_id
  WHERE plan.review_id = target_review_id
  ORDER BY plan.created_at DESC
  LIMIT 1;

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_vp2_action_plans()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  plans JSONB;
BEGIN
  IF NOT public.is_active_app_admin() THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', plan.id,
    'review_id', plan.review_id,
    'property_name', property.property_name,
    'scheduled_date', review.scheduled_date,
    'status', plan.status,
    'summary', plan.summary,
    'updated_at', plan.updated_at,
    'active_link', EXISTS (
      SELECT 1
      FROM public.vp2_action_plan_links link
      WHERE link.action_plan_id = plan.id
        AND link.revoked_at IS NULL
        AND link.expires_at > now()
    )
  ) ORDER BY plan.updated_at DESC), '[]'::jsonb)
  INTO plans
  FROM public.vp2_action_plans plan
  JOIN public.properties property ON property.id = plan.property_id
  JOIN public.vp2_reviews review ON review.id = plan.review_id
  WHERE property.vp2_enabled = true
    AND plan.status IN ('draft', 'sent', 'completed');

  RETURN plans;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_save_vp2_action_plan(
  target_review_id UUID,
  entered_readings JSONB DEFAULT '{}'::jsonb,
  entered_analysis TEXT DEFAULT NULL,
  entered_actions JSONB DEFAULT '[]'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, vault
AS $$
DECLARE
  review_row public.vp2_reviews%ROWTYPE;
  property_label TEXT;
  plan_row public.vp2_action_plans%ROWTYPE;
  existing_link RECORD;
  normalized_readings JSONB := COALESCE(entered_readings, '{}'::jsonb);
  normalized_actions JSONB := COALESCE(entered_actions, '[]'::jsonb);
  standard_actions JSONB := public.vp2_standard_service_tasks();
  saved_plan_data JSONB;
BEGIN
  IF NOT public.is_active_app_admin() THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(normalized_readings) <> 'object' OR jsonb_typeof(normalized_actions) <> 'array' THEN
    RAISE EXCEPTION 'Invalid action plan form data' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(jsonb_agg(incoming.action ORDER BY incoming.ordinality), '[]'::jsonb)
  INTO normalized_actions
  FROM jsonb_array_elements(normalized_actions) WITH ORDINALITY AS incoming(action, ordinality)
  WHERE NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(standard_actions) AS standard_task(action_text)
    WHERE lower(trim(standard_task.action_text #>> '{}')) = lower(trim(COALESCE(
      incoming.action->>'instructions',
      incoming.action->>'title',
      incoming.action #>> '{}',
      ''
    )))
  );

  SELECT review.* INTO review_row
  FROM public.vp2_reviews review
  WHERE review.id = target_review_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VP² review no longer exists. Refresh the dashboard and select an active review.' USING ERRCODE = '22023';
  END IF;
  IF review_row.status = 'cancelled' THEN
    RAISE EXCEPTION 'VP² review was cancelled and cannot be edited.' USING ERRCODE = '22023';
  END IF;
  IF review_row.status = 'completed' THEN
    RAISE EXCEPTION 'VP² review is already completed. Its action plan is read-only.' USING ERRCODE = '22023';
  END IF;

  SELECT property.property_name INTO property_label
  FROM public.properties property
  WHERE property.id = review_row.property_id AND property.vp2_enabled = true;
  IF property_label IS NULL THEN
    RAISE EXCEPTION 'VP² property is not available' USING ERRCODE = '22023';
  END IF;

  saved_plan_data := jsonb_build_object(
    'readings', normalized_readings,
    'analysis', COALESCE(entered_analysis, ''),
    'actions', normalized_actions
  );

  SELECT plan.* INTO plan_row
  FROM public.vp2_action_plans plan
  WHERE plan.review_id = target_review_id
    AND plan.status IN ('draft', 'sent')
  ORDER BY plan.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF plan_row.plan_data IS DISTINCT FROM saved_plan_data THEN
      FOR existing_link IN
        SELECT link.id, link.token_secret_id
        FROM public.vp2_action_plan_links link
        WHERE link.action_plan_id = plan_row.id AND link.revoked_at IS NULL
        FOR UPDATE
      LOOP
        IF existing_link.token_secret_id IS NOT NULL THEN
          DELETE FROM vault.secrets WHERE id = existing_link.token_secret_id;
        END IF;
        UPDATE public.vp2_action_plan_links
        SET revoked_at = now(), revoked_reason = 'Action plan edited by Admin', token_secret_id = NULL
        WHERE id = existing_link.id;
      END LOOP;

      UPDATE public.vp2_action_plans
      SET status = 'draft',
          summary = COALESCE(NULLIF(trim(entered_analysis), ''), 'VP² Technician Action Plan'),
          plan_data = saved_plan_data,
          sent_at = NULL,
          updated_at = now()
      WHERE id = plan_row.id;
    END IF;
  ELSE
    INSERT INTO public.vp2_action_plans (
      property_id, review_id, status, summary, plan_data, created_by
    ) VALUES (
      review_row.property_id,
      target_review_id,
      'draft',
      COALESCE(NULLIF(trim(entered_analysis), ''), 'VP² Technician Action Plan'),
      saved_plan_data,
      auth.uid()
    )
    RETURNING * INTO plan_row;
  END IF;

    INSERT INTO public.vp2_work_orders AS existing_work_order (review_id, property_id, action_plan_id, technician_id, status)
    VALUES (target_review_id, review_row.property_id, plan_row.id, review_row.assigned_technician_id, 'assigned')
  ON CONFLICT (review_id) DO UPDATE
  SET action_plan_id = EXCLUDED.action_plan_id,
        technician_id = COALESCE(EXCLUDED.technician_id, existing_work_order.technician_id),
      status = CASE
          WHEN existing_work_order.status IN ('completed', 'in_progress', 'confirmed')
            THEN existing_work_order.status
        ELSE 'assigned'
      END,
      updated_at = now();

  RETURN plan_row.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_generate_vp2_technician_link(target_action_plan_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
  plan_row public.vp2_action_plans%ROWTYPE;
  review_row public.vp2_reviews%ROWTYPE;
  property_row public.properties%ROWTYPE;
  work_order_id UUID;
  link_row public.vp2_action_plan_links%ROWTYPE;
  raw_token TEXT;
  secret_id UUID;
  link_snapshot JSONB;
BEGIN
  IF NOT public.is_active_app_admin() THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  SELECT plan.* INTO plan_row
  FROM public.vp2_action_plans plan
  WHERE plan.id = target_action_plan_id
  FOR UPDATE;
  IF NOT FOUND OR plan_row.status NOT IN ('draft', 'sent') THEN
    RAISE EXCEPTION 'VP² action plan is not available to share' USING ERRCODE = '22023';
  END IF;

  SELECT review.* INTO review_row
  FROM public.vp2_reviews review
  WHERE review.id = plan_row.review_id AND review.status NOT IN ('cancelled', 'completed');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VP² review is not available to share' USING ERRCODE = '22023';
  END IF;
  SELECT property.* INTO property_row
  FROM public.properties property
  WHERE property.id = plan_row.property_id AND property.vp2_enabled = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VP² property is not available to share' USING ERRCODE = '22023';
  END IF;

  SELECT work_order.id INTO work_order_id
  FROM public.vp2_work_orders work_order
  WHERE work_order.review_id = plan_row.review_id;
  IF work_order_id IS NULL THEN
    RAISE EXCEPTION 'VP² work order is unavailable' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO link_row
  FROM public.vp2_action_plan_links link
  WHERE link.action_plan_id = plan_row.id
    AND link.revoked_at IS NULL
    AND link.expires_at > now()
  FOR UPDATE;
  IF FOUND AND link_row.token_secret_id IS NOT NULL THEN
    SELECT decrypted_secret INTO raw_token
    FROM vault.decrypted_secrets WHERE id = link_row.token_secret_id;
    IF raw_token IS NOT NULL
      AND extensions.digest(lower(raw_token), 'sha256') = link_row.token_hash THEN
      RETURN raw_token;
    END IF;
    DELETE FROM vault.secrets WHERE id = link_row.token_secret_id;
    UPDATE public.vp2_action_plan_links
    SET revoked_at = now(), revoked_reason = 'Token recovery unavailable', token_secret_id = NULL
    WHERE id = link_row.id;
  ELSIF FOUND THEN
    UPDATE public.vp2_action_plan_links
    SET revoked_at = now(), revoked_reason = 'Token recovery unavailable'
    WHERE id = link_row.id;
  END IF;

  DELETE FROM vault.secrets secret
  USING public.vp2_action_plan_links link
  WHERE link.action_plan_id = plan_row.id
    AND link.revoked_at IS NULL
    AND secret.id = link.token_secret_id;
  UPDATE public.vp2_action_plan_links
  SET revoked_at = now(), revoked_reason = COALESCE(revoked_reason, 'Link expired'), token_secret_id = NULL
  WHERE action_plan_id = plan_row.id AND revoked_at IS NULL;

  link_snapshot := jsonb_build_object(
    'propertyName', property_row.property_name,
    'reviewDate', review_row.scheduled_date,
    'reviewKind', review_row.review_kind,
    'brandName', 'Virtual Pool Pro',
    'brandTagline', 'Remote Pool Care. Real Results.',
    'brandAffiliation', 'A Guest Ready Services Company',
    'logoUrl', '/assets/vp2-logo.png',
    'standardTasks', public.vp2_standard_service_tasks(),
    'readings', COALESCE(plan_row.plan_data->'readings', '{}'::jsonb),
    'analysis', COALESCE(plan_row.plan_data->'analysis', '""'::jsonb),
    'actions', COALESCE(plan_row.plan_data->'actions', '[]'::jsonb)
  );
  raw_token := encode(extensions.gen_random_bytes(32), 'hex');
  secret_id := vault.create_secret(raw_token, NULL, 'VP² technician action plan token');
  INSERT INTO public.vp2_action_plan_links(action_plan_id, token_hash, token_secret_id, plan_snapshot)
  VALUES (plan_row.id, extensions.digest(raw_token, 'sha256'), secret_id, link_snapshot);

  UPDATE public.vp2_action_plans
  SET status = 'sent', sent_at = now(), updated_at = now()
  WHERE id = plan_row.id;
  UPDATE public.vp2_work_orders
  SET action_plan_id = plan_row.id,
      status = CASE
        WHEN status IN ('completed', 'in_progress', 'confirmed') THEN status
        ELSE 'assigned'
      END,
      updated_at = now()
  WHERE id = work_order_id AND status <> 'completed';

  RETURN raw_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_vp2_technician_token(target_action_plan_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
  link_row public.vp2_action_plan_links%ROWTYPE;
  raw_token TEXT;
BEGIN
  IF NOT public.is_active_app_admin() THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;
  SELECT link.* INTO link_row
  FROM public.vp2_action_plan_links link
  WHERE link.action_plan_id = target_action_plan_id
    AND link.revoked_at IS NULL
    AND link.expires_at > now()
  FOR UPDATE;
  IF NOT FOUND OR link_row.token_secret_id IS NULL THEN
    RAISE EXCEPTION 'Active VP² technician link not found' USING ERRCODE = '22023';
  END IF;
  SELECT decrypted_secret INTO raw_token FROM vault.decrypted_secrets WHERE id = link_row.token_secret_id;
  IF raw_token IS NULL OR extensions.digest(lower(raw_token), 'sha256') <> link_row.token_hash THEN
    RAISE EXCEPTION 'VP² technician token is unavailable' USING ERRCODE = '22023';
  END IF;
  RETURN raw_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_revoke_vp2_technician_link(target_action_plan_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
BEGIN
  IF NOT public.is_active_app_admin() THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;
  DELETE FROM vault.secrets secret
  USING public.vp2_action_plan_links link
  WHERE link.action_plan_id = target_action_plan_id
    AND link.revoked_at IS NULL
    AND secret.id = link.token_secret_id;
  UPDATE public.vp2_action_plan_links
  SET revoked_at = COALESCE(revoked_at, now()),
      revoked_reason = COALESCE(revoked_reason, 'Revoked by Admin'),
      token_secret_id = NULL
  WHERE action_plan_id = target_action_plan_id AND revoked_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_public_vp2_action_plan(technician_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  token_digest BYTEA;
  link_row public.vp2_action_plan_links%ROWTYPE;
  plan_row public.vp2_action_plans%ROWTYPE;
  work_order_row public.vp2_work_orders%ROWTYPE;
BEGIN
  IF technician_token IS NULL OR length(technician_token) <> 64 OR technician_token !~ '^[0-9a-fA-F]+$' THEN
    RETURN NULL;
  END IF;
  token_digest := extensions.digest(lower(technician_token), 'sha256');

  SELECT link.* INTO link_row
  FROM public.vp2_action_plan_links link
  WHERE link.token_hash = token_digest
    AND link.revoked_at IS NULL
    AND link.expires_at > now()
  FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT plan.* INTO plan_row
  FROM public.vp2_action_plans plan
  JOIN public.vp2_reviews review ON review.id = plan.review_id AND review.status <> 'cancelled'
  WHERE plan.id = link_row.action_plan_id AND plan.status IN ('sent', 'completed');
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT work_order.* INTO work_order_row
  FROM public.vp2_work_orders work_order
  WHERE work_order.review_id = plan_row.review_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  UPDATE public.vp2_action_plan_links
  SET last_viewed_at = now(), view_count = view_count + 1
  WHERE id = link_row.id;

  RETURN link_row.plan_snapshot || jsonb_build_object(
    'completionStatus', work_order_row.status,
    'completionChecklist', work_order_row.completion_checklist,
    'photographs', work_order_row.photographs,
    'technicianNotes', work_order_row.technician_notes,
    'completedAt', work_order_row.completed_at
  );
END;
$$;

DROP FUNCTION IF EXISTS public.submit_public_vp2_work_order_completion(TEXT, JSONB, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.submit_public_vp2_work_order_completion(
  technician_token TEXT,
  completed_actions JSONB,
  technician_notes TEXT,
  uploaded_photos JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  token_digest BYTEA;
  link_row public.vp2_action_plan_links%ROWTYPE;
  plan_row public.vp2_action_plans%ROWTYPE;
  review_row public.vp2_reviews%ROWTYPE;
  work_order_row public.vp2_work_orders%ROWTYPE;
  expected_checkbox_count INTEGER;
  custom_action_count INTEGER;
BEGIN
  IF technician_token IS NULL OR length(technician_token) <> 64 OR technician_token !~ '^[0-9a-fA-F]+$'
    OR COALESCE(jsonb_typeof(completed_actions), '') <> 'array'
    OR COALESCE(jsonb_typeof(uploaded_photos), '') <> 'array'
    OR length(COALESCE(technician_notes, '')) > 10000 THEN
    RAISE EXCEPTION 'Invalid completion submission' USING ERRCODE = '22023';
  END IF;
  token_digest := extensions.digest(lower(technician_token), 'sha256');

  SELECT link.* INTO link_row
  FROM public.vp2_action_plan_links link
  WHERE link.token_hash = token_digest
    AND link.revoked_at IS NULL
    AND link.expires_at > now()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VP² technician link is invalid or expired' USING ERRCODE = '22023';
  END IF;
  SELECT count(*)::INTEGER INTO custom_action_count
  FROM jsonb_array_elements(COALESCE(link_row.plan_snapshot->'actions', '[]'::jsonb)) AS action(value)
  WHERE NULLIF(trim(COALESCE(
      action.value->>'instructions',
      action.value->>'chemical',
      action.value->>'title',
      action.value #>> '{}',
      ''
    )), '') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(link_row.plan_snapshot->'standardTasks', public.vp2_standard_service_tasks())) AS standard_task(value)
      WHERE lower(trim(standard_task.value #>> '{}')) = lower(trim(COALESCE(
        action.value->>'instructions',
        action.value->>'chemical',
        action.value->>'title',
        action.value #>> '{}',
        ''
      )))
    );
  expected_checkbox_count := jsonb_array_length(COALESCE(link_row.plan_snapshot->'standardTasks', public.vp2_standard_service_tasks()))
    + COALESCE(custom_action_count, 0);

  IF jsonb_array_length(completed_actions) <> expected_checkbox_count
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(completed_actions) AS entry(value)
      WHERE jsonb_typeof(entry.value) <> 'boolean'
    ) THEN
    RAISE EXCEPTION 'Completion checklist does not match this VP² action plan' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(uploaded_photos) > 10
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(uploaded_photos) AS photo(value)
      WHERE COALESCE(photo.value->>'path', '') !~ (
        '^' || encode(link_row.token_hash, 'hex') || '/[0-9a-fA-F-]{36}\.(jpg|png|webp)$'
      )
      OR NOT EXISTS (
        SELECT 1 FROM storage.objects object
        WHERE object.bucket_id = 'vp2-technician-photos'
          AND object.name = photo.value->>'path'
      )
    ) THEN
    RAISE EXCEPTION 'Photo list is invalid or contains files outside this action plan' USING ERRCODE = '22023';
  END IF;

  SELECT plan.* INTO plan_row
  FROM public.vp2_action_plans plan
  WHERE plan.id = link_row.action_plan_id AND plan.status = 'sent'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VP² action plan is already completed or unavailable' USING ERRCODE = '22023';
  END IF;

  SELECT review.* INTO review_row
  FROM public.vp2_reviews review
  WHERE review.id = plan_row.review_id AND review.status <> 'cancelled'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VP² review is unavailable' USING ERRCODE = '22023';
  END IF;

  SELECT work_order.* INTO work_order_row
  FROM public.vp2_work_orders work_order
  WHERE work_order.review_id = plan_row.review_id
  FOR UPDATE;
  IF NOT FOUND OR work_order_row.status = 'completed' THEN
    RAISE EXCEPTION 'VP² work order is already completed or unavailable' USING ERRCODE = '22023';
  END IF;

  UPDATE public.vp2_work_orders
  SET status = 'completed',
      technician_confirmed_at = COALESCE(technician_confirmed_at, now()),
      completion_checklist = completed_actions,
      technician_notes = NULLIF(trim(COALESCE(technician_notes, '')), ''),
      photographs = uploaded_photos,
      completed_at = now(),
      updated_at = now()
  WHERE id = work_order_row.id;

  UPDATE public.vp2_action_plans
  SET status = 'completed', updated_at = now()
  WHERE id = plan_row.id;
  UPDATE public.vp2_reviews
  SET status = 'completed', completed_at = COALESCE(completed_at, now()), updated_at = now()
  WHERE id = review_row.id;
  UPDATE public.vp2_action_plan_links
  SET completed_at = now()
  WHERE id = link_row.id;

  RETURN jsonb_build_object('status', 'completed', 'completed_at', now());
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_vp2_action_plan(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_vp2_action_plans() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_save_vp2_action_plan(UUID, JSONB, TEXT, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_generate_vp2_technician_link(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_get_vp2_technician_token(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_revoke_vp2_technician_link(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_vp2_action_plan(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_vp2_action_plans() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_vp2_action_plan(UUID, JSONB, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_generate_vp2_technician_link(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_vp2_technician_token(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_revoke_vp2_technician_link(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.get_public_vp2_action_plan(TEXT) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.submit_public_vp2_work_order_completion(TEXT, JSONB, TEXT, JSONB) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_vp2_action_plan(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.submit_public_vp2_work_order_completion(TEXT, JSONB, TEXT, JSONB) TO anon;

COMMIT;