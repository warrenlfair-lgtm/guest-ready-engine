-- Run after supabase_setup_google_voice_helper.sql.
BEGIN;

CREATE TABLE IF NOT EXISTS public.communication_manual_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  first_name TEXT CHECK (first_name IS NULL OR length(trim(first_name)) BETWEEN 1 AND 100),
  phone TEXT NOT NULL CHECK (length(phone) BETWEEN 1 AND 40),
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.communication_manual_contacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.communication_manual_contacts FROM PUBLIC, anon, authenticated;

ALTER TABLE public.communication_manual_messages
  ADD COLUMN IF NOT EXISTS manual_contact_id UUID REFERENCES public.communication_manual_contacts(id);

CREATE OR REPLACE FUNCTION public.admin_manual_contacts_data()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
BEGIN
  IF public.is_active_app_admin() IS NOT TRUE THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'contacts', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'first_name', first_name, 'phone', phone) ORDER BY lower(name), created_at)
      FROM public.communication_manual_contacts), '[]'::jsonb),
    'greetings', COALESCE((SELECT jsonb_agg(jsonb_build_object('link_id', l.id, 'title', g.title, 'created_at', g.created_at) ORDER BY g.created_at DESC)
      FROM public.communication_greetings g JOIN public.communication_links l ON l.greeting_id = g.id
      WHERE NOT g.personalized AND g.archived_at IS NULL AND g.deactivated_at IS NULL AND l.first_name IS NULL), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_save_manual_contact(target_id UUID, contact_name TEXT, contact_first_name TEXT, phone_number TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE result_id UUID; normalized TEXT := trim(phone_number);
BEGIN
  IF public.is_active_app_admin() IS NOT TRUE THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501'; END IF;
  IF NULLIF(trim(contact_name), '') IS NULL OR length(trim(contact_name)) > 200
    OR length(COALESCE(trim(contact_first_name), '')) > 100
    OR normalized IS NULL OR length(normalized) > 40 OR normalized !~ '^[+0-9(). -]+$'
    OR length(regexp_replace(normalized, '[^0-9]', '', 'g')) NOT BETWEEN 10 AND 15 THEN
    RAISE EXCEPTION 'Enter a name and a valid phone number with 10 to 15 digits' USING ERRCODE = '22023';
  END IF;
  IF target_id IS NULL THEN
    INSERT INTO public.communication_manual_contacts(name, first_name, phone, created_by)
    VALUES (trim(contact_name), NULLIF(trim(contact_first_name), ''), normalized, auth.uid()) RETURNING id INTO result_id;
  ELSE
    UPDATE public.communication_manual_contacts SET name = trim(contact_name), first_name = NULLIF(trim(contact_first_name), ''),
      phone = normalized, updated_at = now() WHERE id = target_id RETURNING id INTO result_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Manual contact not found' USING ERRCODE = '22023'; END IF;
  END IF;
  RETURN result_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_manual_greeting_token(target_contact UUID, target_link UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
BEGIN
  IF public.is_active_app_admin() IS NOT TRUE THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.communication_manual_contacts WHERE id = target_contact)
    OR NOT EXISTS (SELECT 1 FROM public.communication_links l JOIN public.communication_greetings g ON g.id = l.greeting_id
      WHERE l.id = target_link AND l.first_name IS NULL AND NOT g.personalized
        AND g.archived_at IS NULL AND g.deactivated_at IS NULL) THEN
    RAISE EXCEPTION 'Generic greeting unavailable for this contact' USING ERRCODE = '22023';
  END IF;
  RETURN public.admin_get_communication_token(target_link);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_record_manual_contact_message(target_contact UUID, message_type TEXT,
  message_body TEXT, target_greeting_link UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE contact public.communication_manual_contacts%ROWTYPE;
BEGIN
  IF public.is_active_app_admin() IS NOT TRUE THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO contact FROM public.communication_manual_contacts WHERE id = target_contact;
  IF NOT FOUND OR message_type IS NULL OR message_type NOT IN ('custom', 'service', 'greeting')
    OR NULLIF(trim(message_body), '') IS NULL OR length(trim(message_body)) > 10200
    OR (message_type = 'greeting' AND (target_greeting_link IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.communication_links l JOIN public.communication_greetings g ON g.id = l.greeting_id
      WHERE l.id = target_greeting_link AND l.first_name IS NULL AND NOT g.personalized)))
    OR (message_type IN ('custom', 'service') AND target_greeting_link IS NOT NULL) THEN
    RAISE EXCEPTION 'Invalid manual contact or message selection' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.communication_manual_messages(source_client_name, recipient_name, message_type, message_body,
    greeting_link_id, recorded_by, manual_contact_id)
  VALUES (contact.name, contact.name, message_type, trim(message_body), target_greeting_link, auth.uid(), contact.id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_manual_contacts_data() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_save_manual_contact(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_manual_greeting_token(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_record_manual_contact_message(UUID, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_manual_contacts_data() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_manual_contact(UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_manual_greeting_token(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_record_manual_contact_message(UUID, TEXT, TEXT, UUID) TO authenticated;
COMMIT;
