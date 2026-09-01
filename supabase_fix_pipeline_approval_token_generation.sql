-- Fix pgcrypto resolution for approval functions already installed in Supabase.
-- Supabase installs pgcrypto functions in the extensions schema.

BEGIN;

ALTER FUNCTION public.admin_generate_pipeline_approval_link(UUID)
  SET search_path = public, extensions;

ALTER FUNCTION public.get_public_pipeline_proposal(TEXT)
  SET search_path = public, extensions;

ALTER FUNCTION public.submit_public_pipeline_response(TEXT, TEXT, TEXT, TEXT)
  SET search_path = public, extensions;

COMMIT;