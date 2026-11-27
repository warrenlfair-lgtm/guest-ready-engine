-- Run after customer communications, test links, and customer invoice links migrations.
BEGIN;

CREATE TABLE IF NOT EXISTS public.communication_phone_contacts (
  source_client_name TEXT PRIMARY KEY CHECK (length(trim(source_client_name)) BETWEEN 1 AND 200),
  phone TEXT NOT NULL CHECK (length(phone) BETWEEN 1 AND 40),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID NOT NULL REFERENCES auth.users(id)
);

CREATE TABLE IF NOT EXISTS public.communication_manual_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_client_name TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  message_type TEXT NOT NULL CHECK (message_type IN ('custom', 'service', 'greeting', 'invoice')),
  message_body TEXT NOT NULL CHECK (length(trim(message_body)) BETWEEN 1 AND 10200),
  greeting_link_id UUID REFERENCES public.communication_links(id),
  invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  recorded_by UUID NOT NULL REFERENCES auth.users(id),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS communication_manual_messages_client_idx
  ON public.communication_manual_messages(source_client_name, recorded_at DESC);

ALTER TABLE public.communication_phone_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_manual_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.communication_phone_contacts, public.communication_manual_messages FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_voice_helper_data()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
BEGIN
  IF public.is_active_app_admin() IS NOT TRUE THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'contacts', COALESCE((SELECT jsonb_agg(jsonb_build_object('source_name', source_client_name, 'phone', phone))
      FROM public.communication_phone_contacts), '[]'::jsonb),
    'history', COALESCE((SELECT jsonb_agg(jsonb_build_object('source_name', source_client_name, 'recipient_name', recipient_name,
      'message_type', message_type, 'message_body', message_body, 'recorded_at', recorded_at) ORDER BY recorded_at DESC)
      FROM public.communication_manual_messages), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_save_communication_phone(source_name TEXT, phone_number TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE normalized TEXT := trim(phone_number);
BEGIN
  IF public.is_active_app_admin() IS NOT TRUE THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.properties WHERE active IS DISTINCT FROM false AND trim(client_name) = source_name) THEN
    RAISE EXCEPTION 'Active client group not found' USING ERRCODE = '22023';
  END IF;
  IF normalized IS NULL OR normalized = '' THEN
    DELETE FROM public.communication_phone_contacts WHERE source_client_name = source_name;
  ELSE
    IF length(normalized) > 40 OR normalized !~ '^[+0-9(). -]+$'
      OR length(regexp_replace(normalized, '[^0-9]', '', 'g')) NOT BETWEEN 10 AND 15 THEN
      RAISE EXCEPTION 'Enter a valid phone number with 10 to 15 digits' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.communication_phone_contacts(source_client_name, phone, updated_by)
    VALUES (source_name, normalized, auth.uid())
    ON CONFLICT (source_client_name) DO UPDATE SET phone = EXCLUDED.phone, updated_by = EXCLUDED.updated_by, updated_at = now();
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_voice_recipient_links(source_name TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
BEGIN
  IF public.is_active_app_admin() IS NOT TRUE THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.properties WHERE active IS DISTINCT FROM false AND trim(client_name) = source_name) THEN
    RAISE EXCEPTION 'Active client group not found' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object(
    'greetings', COALESCE((SELECT jsonb_agg(jsonb_build_object('link_id', r.link_id, 'title', g.title, 'recipient_name', r.recipient_name, 'first_name', r.first_name, 'created_at', g.created_at) ORDER BY g.created_at DESC)
      FROM public.communication_recipients r JOIN public.communication_greetings g ON g.id = r.greeting_id
      WHERE r.source_client_name = source_name AND g.archived_at IS NULL AND g.deactivated_at IS NULL), '[]'::jsonb),
    'invoices', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', i.id, 'number', i.invoice_number, 'client_name', i.client_name,
      'property', p.property_name, 'status', i.status, 'date', i.invoice_date) ORDER BY i.created_at DESC)
      FROM public.invoices i LEFT JOIN public.properties p ON p.id = i.property_id
      WHERE i.status IN ('finalized', 'sent', 'paid')
        AND COALESCE(NULLIF(trim(i.client_name), ''), NULLIF(trim(p.client_name), '')) = source_name), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_voice_link_token(source_name TEXT, link_type TEXT, target_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
BEGIN
  IF public.is_active_app_admin() IS NOT TRUE THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.properties WHERE active IS DISTINCT FROM false AND trim(client_name) = source_name) THEN
    RAISE EXCEPTION 'Active client group not found' USING ERRCODE = '22023';
  END IF;
  IF link_type = 'greeting' AND EXISTS (
    SELECT 1 FROM public.communication_recipients r JOIN public.communication_greetings g ON g.id = r.greeting_id
    WHERE r.source_client_name = source_name AND r.link_id = target_id AND g.archived_at IS NULL AND g.deactivated_at IS NULL
  ) THEN
    RETURN public.admin_get_communication_token(target_id);
  ELSIF link_type = 'invoice' AND EXISTS (
    SELECT 1 FROM public.invoices i LEFT JOIN public.properties p ON p.id = i.property_id
    WHERE i.id = target_id AND i.status IN ('finalized', 'sent', 'paid')
      AND COALESCE(NULLIF(trim(i.client_name), ''), NULLIF(trim(p.client_name), '')) = source_name
  ) THEN
    RETURN public.admin_generate_customer_invoice_link(target_id);
  END IF;
  RAISE EXCEPTION 'Link unavailable for this client; refresh and review the recipient' USING ERRCODE = '22023';
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_record_voice_message(source_name TEXT, recipient_name TEXT, message_type TEXT,
  message_body TEXT, target_greeting_link UUID, target_invoice UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
BEGIN
  IF public.is_active_app_admin() IS NOT TRUE THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501'; END IF;
  IF NULLIF(trim(recipient_name), '') IS NULL OR length(trim(recipient_name)) > 200
    OR NULLIF(trim(message_body), '') IS NULL OR length(trim(message_body)) > 10200
    OR message_type IS NULL OR message_type NOT IN ('custom', 'service', 'greeting', 'invoice')
    OR NOT EXISTS (SELECT 1 FROM public.properties WHERE active IS DISTINCT FROM false AND trim(client_name) = source_name)
    OR (message_type = 'greeting' AND (target_greeting_link IS NULL OR target_invoice IS NOT NULL OR NOT EXISTS (
      SELECT 1 FROM public.communication_recipients r WHERE r.source_client_name = source_name AND r.link_id = target_greeting_link)))
    OR (message_type = 'invoice' AND (target_invoice IS NULL OR target_greeting_link IS NOT NULL OR NOT EXISTS (
      SELECT 1 FROM public.invoices i LEFT JOIN public.properties p ON p.id = i.property_id
      WHERE i.id = target_invoice AND COALESCE(NULLIF(trim(i.client_name), ''), NULLIF(trim(p.client_name), '')) = source_name)))
    OR (message_type IN ('custom', 'service') AND (target_greeting_link IS NOT NULL OR target_invoice IS NOT NULL)) THEN
    RAISE EXCEPTION 'Invalid recipient or message selection' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.communication_manual_messages(source_client_name, recipient_name, message_type, message_body, greeting_link_id, invoice_id, recorded_by)
  VALUES (source_name, trim(recipient_name), message_type, trim(message_body), target_greeting_link, target_invoice, auth.uid());
END;
$$;

REVOKE ALL ON FUNCTION public.admin_voice_helper_data() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_save_communication_phone(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_voice_recipient_links(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_voice_link_token(TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_record_voice_message(TEXT, TEXT, TEXT, TEXT, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_voice_helper_data() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_communication_phone(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_voice_recipient_links(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_voice_link_token(TEXT, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_record_voice_message(TEXT, TEXT, TEXT, TEXT, UUID, UUID) TO authenticated;
COMMIT;
