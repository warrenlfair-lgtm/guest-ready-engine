-- Run after the role-based access and property client-name migrations.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

CREATE TABLE IF NOT EXISTS public.communication_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  message TEXT NOT NULL CHECK (length(trim(message)) BETWEEN 1 AND 10000),
  banner_url TEXT CHECK (banner_url IS NULL OR (length(banner_url) <= 2000 AND banner_url ~* '^https://[^[:space:]]+$')),
  signature TEXT NOT NULL CHECK (length(trim(signature)) BETWEEN 1 AND 1000),
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.communication_greetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  message TEXT NOT NULL CHECK (length(trim(message)) BETWEEN 1 AND 10000),
  banner_url TEXT CHECK (banner_url IS NULL OR (length(banner_url) <= 2000 AND banner_url ~* '^https://[^[:space:]]+$')),
  signature TEXT NOT NULL CHECK (length(trim(signature)) BETWEEN 1 AND 1000),
  personalized BOOLEAN NOT NULL,
  archived_at TIMESTAMPTZ,
  deactivated_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.communication_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  greeting_id UUID NOT NULL REFERENCES public.communication_greetings(id),
  recipient_name TEXT,
  first_name TEXT,
  token_hash BYTEA NOT NULL UNIQUE,
  token_secret_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS communication_links_greeting_idx ON public.communication_links(greeting_id);

CREATE TABLE IF NOT EXISTS public.communication_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  greeting_id UUID NOT NULL REFERENCES public.communication_greetings(id),
  link_id UUID NOT NULL REFERENCES public.communication_links(id),
  source_client_name TEXT NOT NULL,
  recipient_name TEXT NOT NULL CHECK (length(trim(recipient_name)) BETWEEN 1 AND 200),
  first_name TEXT,
  UNIQUE (greeting_id, recipient_name)
);

CREATE TABLE IF NOT EXISTS public.communication_sends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  greeting_id UUID NOT NULL REFERENCES public.communication_greetings(id),
  link_id UUID NOT NULL REFERENCES public.communication_links(id),
  recipient_name TEXT NOT NULL CHECK (length(trim(recipient_name)) BETWEEN 1 AND 200),
  recorded_by UUID NOT NULL REFERENCES auth.users(id),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS communication_sends_greeting_idx ON public.communication_sends(greeting_id, recorded_at DESC);

ALTER TABLE public.communication_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_greetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_sends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.communication_templates, public.communication_greetings,
  public.communication_links, public.communication_recipients, public.communication_sends FROM PUBLIC, anon, authenticated;

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
      'created_at', g.created_at, 'archived_at', g.archived_at, 'deactivated_at', g.deactivated_at,
      'links', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.link_id, 'recipient_name', r.recipient_name, 'first_name', r.first_name) ORDER BY r.recipient_name)
        FROM public.communication_recipients r WHERE r.greeting_id = g.id), '[]'::jsonb),
      'sends', COALESCE((SELECT jsonb_agg(jsonb_build_object('recipient_name', s.recipient_name, 'recorded_at', s.recorded_at) ORDER BY s.recorded_at DESC)
        FROM public.communication_sends s WHERE s.greeting_id = g.id), '[]'::jsonb))
      ORDER BY g.created_at DESC) FROM public.communication_greetings g), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_save_communication_template(template_id UUID, template_name TEXT,
  greeting_title TEXT, greeting_message TEXT, greeting_banner_url TEXT, greeting_signature TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE result_id UUID;
BEGIN
  IF public.is_active_app_admin() IS NOT TRUE THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501'; END IF;
  IF template_id IS NULL THEN
    INSERT INTO public.communication_templates(name, title, message, banner_url, signature, created_by)
    VALUES (trim(template_name), trim(greeting_title), trim(greeting_message), NULLIF(trim(greeting_banner_url), ''), trim(greeting_signature), auth.uid())
    RETURNING id INTO result_id;
  ELSE
    UPDATE public.communication_templates SET name = trim(template_name), title = trim(greeting_title),
      message = trim(greeting_message), banner_url = NULLIF(trim(greeting_banner_url), ''),
      signature = trim(greeting_signature), updated_at = now()
    WHERE id = template_id RETURNING id INTO result_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Template not found' USING ERRCODE = '22023'; END IF;
  END IF;
  RETURN result_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_publish_communication(greeting_title TEXT, greeting_message TEXT,
  greeting_banner_url TEXT, greeting_signature TEXT, personalize BOOLEAN, recipients JSONB)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, extensions, vault
AS $$
DECLARE greeting_id UUID; link_id UUID; recipient JSONB; raw_token TEXT; secret_id UUID; recipient_count INTEGER;
BEGIN
  IF public.is_active_app_admin() IS NOT TRUE THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501'; END IF;
  IF personalize IS NULL OR jsonb_typeof(recipients) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Recipients and personalization selection are required' USING ERRCODE = '22023';
  END IF;
  recipient_count := jsonb_array_length(recipients);
  IF recipient_count < 1 OR recipient_count > 1000 THEN RAISE EXCEPTION 'Select between 1 and 1000 recipients' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(recipients) r
    WHERE jsonb_typeof(r) IS DISTINCT FROM 'object'
      OR jsonb_typeof(r->'source_name') IS DISTINCT FROM 'string'
      OR jsonb_typeof(r->'name') IS DISTINCT FROM 'string'
      OR (r ? 'first_name' AND jsonb_typeof(r->'first_name') NOT IN ('string', 'null'))
      OR NULLIF(trim(r->>'name'), '') IS NULL
      OR NOT EXISTS (SELECT 1 FROM public.properties p WHERE p.active IS DISTINCT FROM false
        AND trim(p.client_name) = r->>'source_name')
      OR length(trim(r->>'name')) > 200 OR length(COALESCE(trim(r->>'first_name'), '')) > 100
      OR (personalize AND NULLIF(trim(r->>'first_name'), '') IS NULL))
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(recipients) r GROUP BY lower(trim(r->>'name')) HAVING count(*) > 1)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(recipients) r GROUP BY r->>'source_name' HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Select distinct active client groups and recipient names; personalized recipients require a first name' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.communication_greetings(title, message, banner_url, signature, personalized, created_by)
  VALUES (trim(greeting_title), trim(greeting_message), NULLIF(trim(greeting_banner_url), ''), trim(greeting_signature), personalize, auth.uid())
  RETURNING id INTO greeting_id;
  FOR recipient IN SELECT value FROM jsonb_array_elements(recipients) LOOP
    IF personalize OR link_id IS NULL THEN
      raw_token := encode(extensions.gen_random_bytes(32), 'hex');
      secret_id := vault.create_secret(raw_token, NULL, 'Customer greeting link');
      INSERT INTO public.communication_links(greeting_id, recipient_name, first_name, token_hash, token_secret_id)
      VALUES (greeting_id, CASE WHEN personalize THEN trim(recipient->>'name') END,
        CASE WHEN personalize THEN trim(recipient->>'first_name') END,
        extensions.digest(raw_token, 'sha256'), secret_id)
      RETURNING id INTO link_id;
    END IF;
    INSERT INTO public.communication_recipients(greeting_id, link_id, source_client_name, recipient_name, first_name)
    VALUES (greeting_id, link_id, recipient->>'source_name', trim(recipient->>'name'),
      CASE WHEN personalize THEN trim(recipient->>'first_name') END);
  END LOOP;
  RETURN greeting_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_communication_token(target_link_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, extensions, vault
AS $$
DECLARE item public.communication_links%ROWTYPE; raw_token TEXT;
BEGIN
  IF public.is_active_app_admin() IS NOT TRUE THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501'; END IF;
  SELECT l.* INTO item FROM public.communication_links l JOIN public.communication_greetings g ON g.id = l.greeting_id
    WHERE l.id = target_link_id AND g.archived_at IS NULL AND g.deactivated_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Greeting link is unavailable' USING ERRCODE = '22023'; END IF;
  SELECT decrypted_secret INTO raw_token FROM vault.decrypted_secrets WHERE id = item.token_secret_id;
  IF raw_token IS NULL OR extensions.digest(raw_token, 'sha256') <> item.token_hash THEN
    RAISE EXCEPTION 'Greeting token is unavailable' USING ERRCODE = '22023';
  END IF;
  RETURN raw_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_communication_status(target_id UUID, action TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
BEGIN
  IF public.is_active_app_admin() IS NOT TRUE THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501'; END IF;
  IF action IS NULL OR action NOT IN ('archive', 'deactivate') THEN RAISE EXCEPTION 'Invalid action' USING ERRCODE = '22023'; END IF;
  UPDATE public.communication_greetings SET
    archived_at = CASE WHEN action = 'archive' THEN COALESCE(archived_at, now()) ELSE archived_at END,
    deactivated_at = CASE WHEN action = 'deactivate' THEN COALESCE(deactivated_at, now()) ELSE deactivated_at END
  WHERE id = target_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Greeting not found' USING ERRCODE = '22023'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_record_communication_send(target_link_id UUID, target_recipient_name TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
BEGIN
  IF public.is_active_app_admin() IS NOT TRUE THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.communication_sends(greeting_id, link_id, recipient_name, recorded_by)
  SELECT r.greeting_id, r.link_id, r.recipient_name, auth.uid()
  FROM public.communication_recipients r JOIN public.communication_greetings g ON g.id = r.greeting_id
  WHERE r.link_id = target_link_id AND r.recipient_name = target_recipient_name
    AND g.deactivated_at IS NULL AND g.archived_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Greeting link is unavailable' USING ERRCODE = '22023'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_public_communication(greeting_token TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE result JSONB;
BEGIN
  IF greeting_token IS NULL OR greeting_token !~ '^[0-9a-fA-F]{64}$' THEN RETURN NULL; END IF;
  SELECT jsonb_build_object('title', g.title, 'message', g.message, 'banner_url', g.banner_url,
    'signature', g.signature, 'first_name', l.first_name)
  INTO result FROM public.communication_links l JOIN public.communication_greetings g ON g.id = l.greeting_id
  WHERE l.token_hash = extensions.digest(lower(greeting_token), 'sha256')
    AND g.archived_at IS NULL AND g.deactivated_at IS NULL;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_communications_data() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_save_communication_template(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_publish_communication(TEXT, TEXT, TEXT, TEXT, BOOLEAN, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_get_communication_token(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_set_communication_status(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_record_communication_send(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_public_communication(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_communications_data() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_communication_template(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_publish_communication(TEXT, TEXT, TEXT, TEXT, BOOLEAN, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_communication_token(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_communication_status(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_record_communication_send(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_communication(TEXT) TO anon, authenticated;
COMMIT;
