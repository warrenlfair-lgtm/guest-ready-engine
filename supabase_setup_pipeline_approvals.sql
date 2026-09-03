-- Secure customer approval links for Pipeline proposals.
-- Run after supabase_setup_pipeline_jobs.sql.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

CREATE TABLE IF NOT EXISTS public.pipeline_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_job_id UUID NOT NULL REFERENCES public.pipeline_jobs(id) ON DELETE CASCADE,
  token_hash BYTEA NOT NULL UNIQUE,
  token_secret_id UUID,
  property_name_snapshot TEXT NOT NULL,
  job_title_snapshot TEXT NOT NULL,
  description_snapshot TEXT,
  proposed_price_snapshot NUMERIC(12,2) NOT NULL CHECK (proposed_price_snapshot >= 0),
  tentative_date_snapshot DATE,
  approval_created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approval_expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  approval_viewed_at TIMESTAMPTZ,
  customer_response TEXT CHECK (customer_response IN ('Approved', 'Declined')),
  customer_response_at TIMESTAMPTZ,
  customer_name TEXT,
  customer_comment TEXT,
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT,
  CONSTRAINT pipeline_approvals_response_state_check CHECK (
    (customer_response IS NULL AND customer_response_at IS NULL)
    OR (customer_response IS NOT NULL AND customer_response_at IS NOT NULL)
  )
);

ALTER TABLE public.pipeline_approvals
  ADD COLUMN IF NOT EXISTS token_secret_id UUID;

CREATE INDEX IF NOT EXISTS pipeline_approvals_job_created_idx
  ON public.pipeline_approvals(pipeline_job_id, approval_created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS pipeline_approvals_one_active_link_uidx
  ON public.pipeline_approvals(pipeline_job_id)
  WHERE revoked_at IS NULL AND customer_response IS NULL;

ALTER TABLE public.pipeline_approvals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pipeline_approvals_admin_select ON public.pipeline_approvals;
CREATE POLICY pipeline_approvals_admin_select ON public.pipeline_approvals
  FOR SELECT TO authenticated
  USING (public.is_active_app_admin());

REVOKE ALL ON TABLE public.pipeline_approvals FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.pipeline_approvals TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_generate_pipeline_approval_link(target_pipeline_job_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pipeline_row public.pipeline_jobs%ROWTYPE;
  property_label TEXT;
  raw_token TEXT;
  new_token_secret_id UUID;
BEGIN
  IF NOT public.is_active_app_admin() THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  SELECT pipeline_job.* INTO pipeline_row
  FROM public.pipeline_jobs AS pipeline_job
  WHERE pipeline_job.id = target_pipeline_job_id
  FOR UPDATE;
  IF NOT FOUND OR pipeline_row.scheduled_task_id IS NOT NULL THEN
    RAISE EXCEPTION 'Pipeline proposal is not available' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.pipeline_approvals AS approval
    WHERE approval.pipeline_job_id = target_pipeline_job_id
      AND approval.revoked_at IS NULL
      AND approval.customer_response IS NULL
      AND approval.approval_expires_at > now()
  ) THEN
    RAISE EXCEPTION 'Revoke the current approval link before generating another' USING ERRCODE = '23505';
  END IF;

  SELECT property.property_name INTO property_label
  FROM public.properties AS property
  WHERE property.id = pipeline_row.property_id;
  IF property_label IS NULL THEN
    RAISE EXCEPTION 'Pipeline proposal is not available' USING ERRCODE = '22023';
  END IF;

  DELETE FROM vault.secrets AS secret
  WHERE secret.id IN (
    SELECT approval.token_secret_id FROM public.pipeline_approvals AS approval
    WHERE approval.pipeline_job_id = target_pipeline_job_id
      AND approval.revoked_at IS NULL
      AND approval.token_secret_id IS NOT NULL
  );
  UPDATE public.pipeline_approvals AS approval
  SET revoked_at = now(),
      revoked_reason = 'Superseded by a new approval request',
      token_secret_id = NULL
  WHERE approval.pipeline_job_id = target_pipeline_job_id
    AND approval.revoked_at IS NULL;

  raw_token := encode(extensions.gen_random_bytes(32), 'hex');
  new_token_secret_id := vault.create_secret(
    raw_token,
    NULL,
    'Pipeline customer approval token for approval resend'
  );
  INSERT INTO public.pipeline_approvals (
    pipeline_job_id, token_hash, token_secret_id, property_name_snapshot, job_title_snapshot,
    description_snapshot, proposed_price_snapshot, tentative_date_snapshot
  ) VALUES (
    pipeline_row.id, extensions.digest(raw_token, 'sha256'), new_token_secret_id, property_label, pipeline_row.job_title,
    pipeline_row.description, pipeline_row.potential_revenue, pipeline_row.tentative_date
  );

  UPDATE public.pipeline_jobs AS pipeline_job
  SET status = 'Waiting Approval'
  WHERE pipeline_job.id = pipeline_row.id;

  RETURN raw_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_revoke_pipeline_approval(target_approval_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_pipeline_job_id UUID;
  target_token_secret_id UUID;
BEGIN
  IF NOT public.is_active_app_admin() THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  SELECT pipeline_job_id, token_secret_id
  INTO target_pipeline_job_id, target_token_secret_id
  FROM public.pipeline_approvals
  WHERE id = target_approval_id;

  DELETE FROM vault.secrets
  WHERE id = target_token_secret_id;

  UPDATE public.pipeline_approvals
  SET revoked_at = COALESCE(revoked_at, now()),
      revoked_reason = COALESCE(revoked_reason, 'Revoked by Admin'),
      token_secret_id = NULL
  WHERE id = target_approval_id
    AND revoked_at IS NULL;

  UPDATE public.pipeline_jobs
  SET status = 'Waiting Approval'
  WHERE id = target_pipeline_job_id
    AND scheduled_task_id IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_pipeline_approval_token(target_approval_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
  approval_row public.pipeline_approvals%ROWTYPE;
  raw_token TEXT;
BEGIN
  IF NOT public.is_active_app_admin() THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO approval_row
  FROM public.pipeline_approvals
  WHERE id = target_approval_id
    AND revoked_at IS NULL
    AND approval_expires_at > now();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active approval link not found' USING ERRCODE = '22023';
  END IF;
  IF approval_row.token_secret_id IS NULL THEN
    RAISE EXCEPTION 'This legacy approval token cannot be recovered; revoke it and generate a new link' USING ERRCODE = '22023';
  END IF;

  SELECT decrypted_secret INTO raw_token
  FROM vault.decrypted_secrets
  WHERE id = approval_row.token_secret_id;
  IF raw_token IS NULL
      OR extensions.digest(lower(raw_token), 'sha256') <> approval_row.token_hash THEN
    RAISE EXCEPTION 'Approval token is unavailable' USING ERRCODE = '22023';
  END IF;

  RETURN raw_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_public_pipeline_proposal(approval_token TEXT)
RETURNS TABLE (
  property_name TEXT,
  job_title TEXT,
  customer_description TEXT,
  proposed_price NUMERIC,
  tentative_service_date DATE,
  response_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  token_digest BYTEA;
BEGIN
  IF approval_token IS NULL OR length(approval_token) <> 64 OR approval_token !~ '^[0-9a-fA-F]{64}$' THEN
    RETURN;
  END IF;
  token_digest := extensions.digest(lower(approval_token), 'sha256');

  UPDATE public.pipeline_approvals
  SET approval_viewed_at = COALESCE(approval_viewed_at, now())
  WHERE token_hash = token_digest
    AND revoked_at IS NULL
    AND approval_expires_at > now();

  RETURN QUERY
  SELECT
    approval.property_name_snapshot,
    approval.job_title_snapshot,
    approval.description_snapshot,
    approval.proposed_price_snapshot,
    approval.tentative_date_snapshot,
    approval.customer_response
  FROM public.pipeline_approvals approval
  WHERE approval.token_hash = token_digest
    AND approval.revoked_at IS NULL
    AND approval.approval_expires_at > now();
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_public_pipeline_response(
  approval_token TEXT,
  submitted_response TEXT,
  submitted_customer_name TEXT DEFAULT NULL,
  submitted_customer_comment TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  approval_row public.pipeline_approvals%ROWTYPE;
  token_digest BYTEA;
  normalized_response TEXT;
BEGIN
  IF approval_token IS NULL OR length(approval_token) <> 64 OR approval_token !~ '^[0-9a-fA-F]{64}$' THEN
    RAISE EXCEPTION 'This approval link is no longer valid' USING ERRCODE = '22023';
  END IF;
  normalized_response := initcap(lower(trim(COALESCE(submitted_response, ''))));
  IF normalized_response NOT IN ('Approved', 'Declined') THEN
    RAISE EXCEPTION 'Invalid response' USING ERRCODE = '22023';
  END IF;
  IF length(COALESCE(submitted_customer_name, '')) > 200
      OR length(COALESCE(submitted_customer_comment, '')) > 2000 THEN
    RAISE EXCEPTION 'Customer response is too long' USING ERRCODE = '22023';
  END IF;

  token_digest := extensions.digest(lower(approval_token), 'sha256');
  SELECT * INTO approval_row
  FROM public.pipeline_approvals
  WHERE token_hash = token_digest
    AND revoked_at IS NULL
    AND approval_expires_at > now()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This approval link is no longer valid' USING ERRCODE = '22023';
  END IF;
  IF approval_row.customer_response IS NOT NULL THEN
    RETURN approval_row.customer_response;
  END IF;

  UPDATE public.pipeline_approvals
  SET approval_viewed_at = COALESCE(approval_viewed_at, now()),
      customer_response = normalized_response,
      customer_response_at = now(),
      customer_name = NULLIF(trim(COALESCE(submitted_customer_name, '')), ''),
      customer_comment = NULLIF(trim(COALESCE(submitted_customer_comment, '')), '')
  WHERE id = approval_row.id;

  UPDATE public.pipeline_jobs
  SET status = normalized_response
  WHERE id = approval_row.pipeline_job_id
    AND scheduled_task_id IS NULL;

  RETURN normalized_response;
END;
$$;

CREATE OR REPLACE FUNCTION public.invalidate_pipeline_approval_on_material_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.scheduled_task_id IS NULL
      AND NEW.scheduled_task_id IS NULL
      AND (
        OLD.property_id IS DISTINCT FROM NEW.property_id
        OR OLD.job_title IS DISTINCT FROM NEW.job_title
        OR OLD.description IS DISTINCT FROM NEW.description
        OR OLD.potential_revenue IS DISTINCT FROM NEW.potential_revenue
        OR OLD.tentative_date IS DISTINCT FROM NEW.tentative_date
      )
      AND EXISTS (
        SELECT 1 FROM public.pipeline_approvals
        WHERE pipeline_job_id = OLD.id
          AND revoked_at IS NULL
      ) THEN
    DELETE FROM vault.secrets
    WHERE id IN (
      SELECT token_secret_id FROM public.pipeline_approvals
      WHERE pipeline_job_id = OLD.id
        AND revoked_at IS NULL
        AND token_secret_id IS NOT NULL
    );
    UPDATE public.pipeline_approvals
    SET revoked_at = now(),
        revoked_reason = 'Material customer-facing proposal terms changed',
        token_secret_id = NULL
    WHERE pipeline_job_id = OLD.id
      AND revoked_at IS NULL;
    NEW.status := 'Waiting Approval';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pipeline_jobs_invalidate_customer_approval ON public.pipeline_jobs;
CREATE TRIGGER pipeline_jobs_invalidate_customer_approval
BEFORE UPDATE ON public.pipeline_jobs
FOR EACH ROW EXECUTE FUNCTION public.invalidate_pipeline_approval_on_material_change();

REVOKE ALL ON FUNCTION public.admin_generate_pipeline_approval_link(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_revoke_pipeline_approval(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_get_pipeline_approval_token(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_generate_pipeline_approval_link(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_revoke_pipeline_approval(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_pipeline_approval_token(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.get_public_pipeline_proposal(TEXT) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.submit_public_pipeline_response(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_pipeline_proposal(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.submit_public_pipeline_response(TEXT, TEXT, TEXT, TEXT) TO anon;

COMMIT;