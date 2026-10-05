-- Secure public customer invoice links. Run manually as postgres before using Share Invoice.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

CREATE TABLE IF NOT EXISTS public.invoice_customer_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  token_hash BYTEA NOT NULL UNIQUE,
  token_secret_id UUID,
  customer_snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_viewed_at TIMESTAMPTZ,
  view_count BIGINT NOT NULL DEFAULT 0 CHECK (view_count >= 0),
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS invoice_customer_links_one_active_uidx
  ON public.invoice_customer_links(invoice_id)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS invoice_customer_links_invoice_created_idx
  ON public.invoice_customer_links(invoice_id, created_at DESC);

ALTER TABLE public.invoice_customer_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoice_customer_links_admin_select ON public.invoice_customer_links;
CREATE POLICY invoice_customer_links_admin_select
  ON public.invoice_customer_links FOR SELECT TO authenticated
  USING (public.is_active_app_admin());
REVOKE ALL ON TABLE public.invoice_customer_links FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.invoice_customer_links TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_generate_customer_invoice_link(target_invoice_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
  invoice_row public.invoices%ROWTYPE;
  link_row public.invoice_customer_links%ROWTYPE;
  raw_token TEXT;
  secret_id UUID;
  branch_name TEXT;
  brand_name TEXT;
  brand_tagline TEXT;
  brand_logo TEXT;
  brand_phone TEXT;
  brand_email TEXT;
  customer_snapshot JSONB;
BEGIN
  IF NOT public.is_active_app_admin() THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO invoice_row
  FROM public.invoices
  WHERE id = target_invoice_id
  FOR UPDATE;
  IF NOT FOUND OR COALESCE(invoice_row.status, '') NOT IN ('finalized', 'sent', 'paid') THEN
    RAISE EXCEPTION 'Only finalized, sent, or paid invoices can be shared' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO link_row
  FROM public.invoice_customer_links
  WHERE invoice_id = target_invoice_id AND revoked_at IS NULL
  FOR UPDATE;
  IF FOUND AND link_row.token_secret_id IS NOT NULL THEN
    SELECT decrypted_secret INTO raw_token
    FROM vault.decrypted_secrets
    WHERE id = link_row.token_secret_id;
    IF raw_token IS NOT NULL
        AND extensions.digest(lower(raw_token), 'sha256') = link_row.token_hash THEN
      RETURN raw_token;
    END IF;
    DELETE FROM vault.secrets WHERE id = link_row.token_secret_id;
    UPDATE public.invoice_customer_links
    SET revoked_at = now(), revoked_reason = 'Token recovery unavailable', token_secret_id = NULL
    WHERE id = link_row.id;
  ELSIF FOUND THEN
    UPDATE public.invoice_customer_links
    SET revoked_at = now(), revoked_reason = 'Token recovery unavailable'
    WHERE id = link_row.id;
  END IF;

  SELECT COALESCE(NULLIF(property.company_branch, ''), 'Guest Ready')
  INTO branch_name
  FROM public.properties property
  WHERE property.id = invoice_row.property_id;
  branch_name := COALESCE(branch_name, 'Guest Ready');

  SELECT
    CASE WHEN branch_name = 'Weekend Ready' THEN 'Weekend Ready' ELSE COALESCE(profile.company_name, 'Fair Ventures') END,
    COALESCE(profile.tagline, ''),
    CASE WHEN branch_name = 'Weekend Ready'
      THEN COALESCE(profile.weekend_ready_logo_url, profile.logo_url)
      ELSE COALESCE(profile.guest_ready_logo_url, profile.logo_url)
    END,
    COALESCE(profile.phone_number, ''),
    COALESCE(profile.email, '')
  INTO brand_name, brand_tagline, brand_logo, brand_phone, brand_email
  FROM public.company_profile profile
  WHERE profile.id = 1;

  SELECT jsonb_build_object(
    'invoiceNumber', invoice_row.invoice_number,
    'invoiceDate', invoice_row.invoice_date,
    'dueDate', invoice_row.due_date,
    'periodStart', invoice_row.period_start,
    'periodEnd', invoice_row.period_end,
    'paymentTerms', invoice_row.payment_terms,
    'clientName', invoice_row.client_name,
    'billingCompanyName', invoice_row.billing_company_name,
    'billingAddress', invoice_row.billing_address,
    'billingAccountReference', invoice_row.billing_account_reference,
    'properties', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('name', property.property_name, 'address', property.address) ORDER BY property.property_name)
      FROM public.properties property
      WHERE property.id IN (
        SELECT invoice_row.property_id
        UNION
        SELECT item.property_id
        FROM public.invoice_items item
        WHERE item.invoice_id = invoice_row.id AND item.property_id IS NOT NULL
      )
    ), '[]'::jsonb),
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'description', item.description,
        'serviceDate', item.service_date,
        'quantity', item.quantity,
        'unit', item.unit,
        'rate', item.rate,
        'amount', item.amount
      ) ORDER BY item.created_at, item.id)
      FROM public.invoice_items item
      WHERE item.invoice_id = invoice_row.id
    ), '[]'::jsonb),
    'subtotal', invoice_row.subtotal,
    'tax', invoice_row.tax,
    'total', invoice_row.total,
    'notes', invoice_row.notes,
    'branding', jsonb_build_object(
      'companyName', COALESCE(brand_name, 'Fair Ventures'),
      'tagline', COALESCE(brand_tagline, ''),
      'logoUrl', brand_logo,
      'phone', COALESCE(brand_phone, ''),
      'email', COALESCE(brand_email, '')
    )
  ) INTO customer_snapshot;

  raw_token := encode(extensions.gen_random_bytes(16), 'hex');
  secret_id := vault.create_secret(raw_token, NULL, 'Customer invoice link token');
  INSERT INTO public.invoice_customer_links(invoice_id, token_hash, token_secret_id, customer_snapshot)
  VALUES (invoice_row.id, extensions.digest(raw_token, 'sha256'), secret_id, customer_snapshot);
  RETURN raw_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_customer_invoice_token(target_invoice_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
  link_row public.invoice_customer_links%ROWTYPE;
  raw_token TEXT;
BEGIN
  IF NOT public.is_active_app_admin() THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;
  SELECT link.* INTO link_row
  FROM public.invoice_customer_links link
  JOIN public.invoices invoice ON invoice.id = link.invoice_id
  WHERE link.invoice_id = target_invoice_id
    AND link.revoked_at IS NULL
    AND invoice.status IN ('finalized', 'sent', 'paid')
  FOR UPDATE OF link;
  IF NOT FOUND OR link_row.token_secret_id IS NULL THEN
    RAISE EXCEPTION 'Active customer invoice link not found' USING ERRCODE = '22023';
  END IF;
  SELECT decrypted_secret INTO raw_token FROM vault.decrypted_secrets WHERE id = link_row.token_secret_id;
  IF raw_token IS NULL OR extensions.digest(lower(raw_token), 'sha256') <> link_row.token_hash THEN
    RAISE EXCEPTION 'Customer invoice token is unavailable' USING ERRCODE = '22023';
  END IF;
  RETURN raw_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_revoke_customer_invoice_link(target_invoice_id UUID)
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
  USING public.invoice_customer_links link
  WHERE link.invoice_id = target_invoice_id
    AND link.revoked_at IS NULL
    AND secret.id = link.token_secret_id;
  UPDATE public.invoice_customer_links
  SET revoked_at = COALESCE(revoked_at, now()),
      revoked_reason = COALESCE(revoked_reason, 'Revoked by Admin'),
      token_secret_id = NULL
  WHERE invoice_id = target_invoice_id AND revoked_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_public_customer_invoice(invoice_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  token_digest BYTEA;
  result JSONB;
BEGIN
  IF invoice_token IS NULL OR length(invoice_token) NOT IN (32, 64) OR invoice_token !~ '^[0-9a-fA-F]+$' THEN
    RETURN NULL;
  END IF;
  token_digest := extensions.digest(lower(invoice_token), 'sha256');

  UPDATE public.invoice_customer_links link
  SET last_viewed_at = now(), view_count = link.view_count + 1
  FROM public.invoices invoice
  WHERE link.token_hash = token_digest
    AND link.invoice_id = invoice.id
    AND link.revoked_at IS NULL
    AND invoice.status IN ('finalized', 'sent', 'paid')
  RETURNING link.customer_snapshot || jsonb_build_object('status', invoice.status) INTO result;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_customer_invoice_link_on_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  target_invoice_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'invoices' THEN
    IF TG_OP = 'DELETE' THEN
      target_invoice_id := OLD.id;
    ELSE
      target_invoice_id := NEW.id;
    END IF;
    IF TG_OP = 'UPDATE' AND NOT (
      NEW.invoice_number IS DISTINCT FROM OLD.invoice_number OR
      NEW.property_id IS DISTINCT FROM OLD.property_id OR
      NEW.client_name IS DISTINCT FROM OLD.client_name OR
      NEW.billing_company_name IS DISTINCT FROM OLD.billing_company_name OR
      NEW.billing_address IS DISTINCT FROM OLD.billing_address OR
      NEW.billing_account_reference IS DISTINCT FROM OLD.billing_account_reference OR
      NEW.period_start IS DISTINCT FROM OLD.period_start OR
      NEW.period_end IS DISTINCT FROM OLD.period_end OR
      NEW.invoice_date IS DISTINCT FROM OLD.invoice_date OR
      NEW.due_date IS DISTINCT FROM OLD.due_date OR
      NEW.payment_terms IS DISTINCT FROM OLD.payment_terms OR
      NEW.subtotal IS DISTINCT FROM OLD.subtotal OR
      NEW.tax IS DISTINCT FROM OLD.tax OR
      NEW.total IS DISTINCT FROM OLD.total OR
      NEW.notes IS DISTINCT FROM OLD.notes OR
      NEW.taxable IS DISTINCT FROM OLD.taxable OR
      NEW.tax_rate IS DISTINCT FROM OLD.tax_rate OR
      (COALESCE(NEW.status, '') IN ('draft', 'void') AND NEW.status IS DISTINCT FROM OLD.status)
    ) THEN
      RETURN NEW;
    END IF;
  ELSE
    IF TG_OP = 'DELETE' THEN
      target_invoice_id := OLD.invoice_id;
    ELSE
      target_invoice_id := NEW.invoice_id;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.invoice_id IS DISTINCT FROM NEW.invoice_id THEN
      DELETE FROM vault.secrets secret
      USING public.invoice_customer_links link
      WHERE link.invoice_id = OLD.invoice_id
        AND link.revoked_at IS NULL
        AND secret.id = link.token_secret_id;
      UPDATE public.invoice_customer_links
      SET revoked_at = now(), revoked_reason = 'Invoice line item moved after link creation', token_secret_id = NULL
      WHERE invoice_id = OLD.invoice_id AND revoked_at IS NULL;
    END IF;
  END IF;

  DELETE FROM vault.secrets secret
  USING public.invoice_customer_links link
  WHERE link.invoice_id = target_invoice_id
    AND link.revoked_at IS NULL
    AND secret.id = link.token_secret_id;
  UPDATE public.invoice_customer_links
  SET revoked_at = now(), revoked_reason = 'Invoice changed after link creation', token_secret_id = NULL
  WHERE invoice_id = target_invoice_id AND revoked_at IS NULL;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invoice_customer_link_invalidate_header ON public.invoices;
CREATE TRIGGER invoice_customer_link_invalidate_header
AFTER UPDATE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.revoke_customer_invoice_link_on_change();
DROP TRIGGER IF EXISTS invoice_customer_link_invalidate_items ON public.invoice_items;
CREATE TRIGGER invoice_customer_link_invalidate_items
AFTER INSERT OR UPDATE OR DELETE ON public.invoice_items
FOR EACH ROW EXECUTE FUNCTION public.revoke_customer_invoice_link_on_change();
DROP TRIGGER IF EXISTS invoice_customer_link_cleanup_delete ON public.invoices;
CREATE TRIGGER invoice_customer_link_cleanup_delete
BEFORE DELETE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.revoke_customer_invoice_link_on_change();

REVOKE ALL ON FUNCTION public.admin_generate_customer_invoice_link(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_get_customer_invoice_token(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_revoke_customer_invoice_link(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_generate_customer_invoice_link(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_customer_invoice_token(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_revoke_customer_invoice_link(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.get_public_customer_invoice(TEXT) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_customer_invoice(TEXT) TO anon;
REVOKE ALL ON FUNCTION public.revoke_customer_invoice_link_on_change() FROM PUBLIC, anon, authenticated;

COMMIT;
