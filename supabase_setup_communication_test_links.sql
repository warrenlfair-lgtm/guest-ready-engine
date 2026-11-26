-- Run after supabase_setup_customer_communications.sql.
BEGIN;

ALTER TABLE public.communication_greetings
  ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.admin_publish_communication_test(
  greeting_title TEXT, greeting_message TEXT, greeting_banner_url TEXT,
  greeting_signature TEXT, test_first_name TEXT
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth, extensions, vault
AS $$
DECLARE
  new_greeting_id UUID;
  raw_token TEXT;
  secret_id UUID;
  first_name TEXT := NULLIF(trim(test_first_name), '');
BEGIN
  IF public.is_active_app_admin() IS NOT TRUE THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;
  IF length(COALESCE(first_name, '')) > 100 THEN
    RAISE EXCEPTION 'Test first name must be at most 100 characters' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.communication_greetings(title, message, banner_url, signature, personalized, is_test, created_by)
  VALUES (trim(greeting_title), trim(greeting_message), NULLIF(trim(greeting_banner_url), ''),
    trim(greeting_signature), first_name IS NOT NULL, true, auth.uid())
  RETURNING id INTO new_greeting_id;

  raw_token := encode(extensions.gen_random_bytes(32), 'hex');
  secret_id := vault.create_secret(raw_token, NULL, 'Customer greeting test link');
  INSERT INTO public.communication_links(greeting_id, recipient_name, first_name, token_hash, token_secret_id)
  VALUES (new_greeting_id, NULL, first_name, extensions.digest(raw_token, 'sha256'), secret_id);

  RETURN new_greeting_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_communications_data()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
BEGIN
  IF public.is_active_app_admin() IS NOT TRUE THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'customers', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', name, 'property_count', property_count) ORDER BY lower(name), name)
      FROM (SELECT trim(client_name) AS name, count(*) AS property_count
        FROM public.properties WHERE active IS DISTINCT FROM false AND NULLIF(trim(client_name), '') IS NOT NULL
        GROUP BY trim(client_name)) customers), '[]'::jsonb),
    'unnamed_properties', (SELECT count(*) FROM public.properties WHERE active IS DISTINCT FROM false AND NULLIF(trim(client_name), '') IS NULL),
    'templates', COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.updated_at DESC) FROM public.communication_templates t), '[]'::jsonb),
    'greetings', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', g.id, 'title', g.title, 'personalized', g.personalized,
      'is_test', g.is_test, 'created_at', g.created_at, 'archived_at', g.archived_at, 'deactivated_at', g.deactivated_at,
      'links', CASE WHEN g.is_test THEN COALESCE((SELECT jsonb_agg(jsonb_build_object('id', l.id, 'recipient_name', 'Test link', 'first_name', l.first_name) ORDER BY l.created_at)
        FROM public.communication_links l WHERE l.greeting_id = g.id), '[]'::jsonb)
        ELSE COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.link_id, 'recipient_name', r.recipient_name, 'first_name', r.first_name) ORDER BY r.recipient_name)
        FROM public.communication_recipients r WHERE r.greeting_id = g.id), '[]'::jsonb) END,
      'sends', COALESCE((SELECT jsonb_agg(jsonb_build_object('recipient_name', s.recipient_name, 'recorded_at', s.recorded_at) ORDER BY s.recorded_at DESC)
        FROM public.communication_sends s WHERE s.greeting_id = g.id), '[]'::jsonb))
      ORDER BY g.created_at DESC) FROM public.communication_greetings g), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_publish_communication_test(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_publish_communication_test(TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_communications_data() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_communications_data() TO authenticated;
COMMIT;
