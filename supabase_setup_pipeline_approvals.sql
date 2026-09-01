-- Secure customer approval links for Pipeline proposals.
-- Run after supabase_setup_pipeline_jobs.sql.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.pipeline_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_job_id UUID NOT NULL REFERENCES public.pipeline_jobs(id) ON DELETE CASCADE,
  token_hash BYTEA NOT NULL UNIQUE,
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
BEGIN
  IF NOT public.is_active_app_admin() THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO pipeline_row
  FROM public.pipeline_jobs
  WHERE id = target_pipeline_job_id
  FOR UPDATE;
  IF NOT FOUND OR pipeline_row.scheduled_task_id IS NOT NULL THEN
    RAISE EXCEPTION 'Pipeline proposal is not available' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.pipeline_approvals
    WHERE pipeline_job_id = target_pipeline_job_id
      AND revoked_at IS NULL
      AND customer_response IS NULL
      AND approval_expires_at > now()
  ) THEN
    RAISE EXCEPTION 'Revoke the current approval link before generating another' USING ERRCODE = '23505';
  END IF;

  SELECT property_name INTO property_label
  FROM public.properties
  WHERE id = pipeline_row.property_id;
  IF property_label IS NULL THEN
    RAISE EXCEPTION 'Pipeline proposal is not available' USING ERRCODE = '22023';
  END IF;

  UPDATE public.pipeline_approvals
  SET revoked_at = now(),
      revoked_reason = 'Superseded by a new approval request'
  WHERE pipeline_job_id = target_pipeline_job_id
    AND revoked_at IS NULL;

  raw_token := encode(extensions.gen_random_bytes(32), 'hex');
  INSERT INTO public.pipeline_approvals (
    pipeline_job_id, token_hash, property_name_snapshot, job_title_snapshot,
    description_snapshot, proposed_price_snapshot, tentative_date_snapshot
  ) VALUES (
    pipeline_row.id, extensions.digest(raw_token, 'sha256'), property_label, pipeline_row.job_title,
    pipeline_row.description, pipeline_row.potential_revenue, pipeline_row.tentative_date
  );

  UPDATE public.pipeline_jobs
  SET status = 'Waiting Approval'
  WHERE id = pipeline_row.id;

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
BEGIN
  IF NOT public.is_active_app_admin() THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  SELECT pipeline_job_id INTO target_pipeline_job_id
  FROM public.pipeline_approvals
  WHERE id = target_approval_id;

  UPDATE public.pipeline_approvals
  SET revoked_at = COALESCE(revoked_at, now()),
      revoked_reason = COALESCE(revoked_reason, 'Revoked by Admin')
  WHERE id = target_approval_id
    AND revoked_at IS NULL;

  UPDATE public.pipeline_jobs
  SET status = 'Waiting Approval'
  WHERE id = target_pipeline_job_id
    AND scheduled_task_id IS NULL;
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
    UPDATE public.pipeline_approvals
    SET revoked_at = now(),
        revoked_reason = 'Material customer-facing proposal terms changed'
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
GRANT EXECUTE ON FUNCTION public.admin_generate_pipeline_approval_link(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_revoke_pipeline_approval(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.get_public_pipeline_proposal(TEXT) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.submit_public_pipeline_response(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_pipeline_proposal(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.submit_public_pipeline_response(TEXT, TEXT, TEXT, TEXT) TO anon;

COMMIT;