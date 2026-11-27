-- Run after the role-based access migration.
BEGIN;

CREATE TABLE IF NOT EXISTS public.communication_snippets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 10000),
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.communication_snippets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.communication_snippets FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_communication_snippets()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
BEGIN
  IF public.is_active_app_admin() IS NOT TRUE THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'body', body) ORDER BY lower(name), created_at)
    FROM public.communication_snippets), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_save_communication_snippet(target_id UUID, snippet_name TEXT, snippet_body TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE result_id UUID;
BEGIN
  IF public.is_active_app_admin() IS NOT TRUE THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501'; END IF;
  IF NULLIF(trim(snippet_name), '') IS NULL OR length(trim(snippet_name)) > 120
    OR NULLIF(trim(snippet_body), '') IS NULL OR length(snippet_body) > 10000 THEN
    RAISE EXCEPTION 'Enter a snippet name and text within the allowed length' USING ERRCODE = '22023';
  END IF;
  IF target_id IS NULL THEN
    INSERT INTO public.communication_snippets(name, body, created_by)
    VALUES (trim(snippet_name), snippet_body, auth.uid()) RETURNING id INTO result_id;
  ELSE
    UPDATE public.communication_snippets SET name = trim(snippet_name), body = snippet_body, updated_at = now()
    WHERE id = target_id RETURNING id INTO result_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Snippet not found' USING ERRCODE = '22023'; END IF;
  END IF;
  RETURN result_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_communication_snippet(target_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
BEGIN
  IF public.is_active_app_admin() IS NOT TRUE THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.communication_snippets WHERE id = target_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Snippet not found' USING ERRCODE = '22023'; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_communication_snippets() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_save_communication_snippet(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_delete_communication_snippet(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_communication_snippets() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_communication_snippet(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_communication_snippet(UUID) TO authenticated;
COMMIT;
