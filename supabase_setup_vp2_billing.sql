-- VP² Phase 3: tiered charges, reconciliation, and existing invoice integration.
-- Run manually after supabase_setup_vp2_scheduling.sql, supabase_setup_invoices.sql,
-- and supabase_setup_manual_invoices.sql.
BEGIN;

ALTER TABLE public.vp2_review_charges
  ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ;

ALTER TABLE public.vp2_review_charges
  DROP CONSTRAINT IF EXISTS vp2_review_charges_status_check;
ALTER TABLE public.vp2_review_charges
  ADD CONSTRAINT vp2_review_charges_status_check
  CHECK (status IN ('pending', 'reconciled', 'invoiced', 'void'));

ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS vp2_review_charge_id UUID
  REFERENCES public.vp2_review_charges(id) ON DELETE SET NULL;

ALTER TABLE public.invoice_items
  DROP CONSTRAINT IF EXISTS invoice_items_item_source_check;
ALTER TABLE public.invoice_items
  ADD CONSTRAINT invoice_items_item_source_check
  CHECK (item_source IS NULL OR item_source IN ('manual', 'task', 'chemical', 'sds', 'vp2'));

CREATE INDEX IF NOT EXISTS vp2_review_charges_reconciled_date_idx
  ON public.vp2_review_charges(status, service_date)
  WHERE status = 'reconciled';
CREATE UNIQUE INDEX IF NOT EXISTS invoice_items_vp2_review_charge_uidx
  ON public.invoice_items(vp2_review_charge_id)
  WHERE vp2_review_charge_id IS NOT NULL;

GRANT SELECT ON TABLE public.vp2_review_charges TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_sync_vp2_review_charges(target_property_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  property_row public.properties%ROWTYPE;
  created_count INTEGER := 0;
  voided_count INTEGER := 0;
  affected_count INTEGER;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT public.is_active_app_admin() THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  FOR property_row IN
    SELECT property.*
    FROM public.properties property
    WHERE property.vp2_enabled = true
      AND property.active IS DISTINCT FROM false
      AND (target_property_id IS NULL OR property.id = target_property_id)
    ORDER BY property.id
    FOR UPDATE
  LOOP
    WITH ranked_reviews AS (
      SELECT
        review.id AS review_id,
        review.property_id,
        review.service_week_start_date,
        review.scheduled_date,
        review.status AS review_status,
        ROW_NUMBER() OVER (
          PARTITION BY review.property_id, review.service_week_start_date
          ORDER BY review.scheduled_date, review.created_at, review.id
        ) AS review_number
      FROM public.vp2_reviews review
      WHERE review.property_id = property_row.id
        AND review.status <> 'cancelled'
    ), charge_values AS (
      SELECT
        ranked.review_id,
        ranked.property_id,
        ranked.service_week_start_date,
        ranked.scheduled_date,
        ranked.review_status,
        CASE WHEN ranked.review_number = 1
          THEN property_row.vp2_first_review_price
          ELSE property_row.vp2_additional_review_price
        END AS amount
      FROM ranked_reviews ranked
    )
    INSERT INTO public.vp2_review_charges AS existing_charge (
      review_id,
      property_id,
      service_week_start_date,
      service_date,
      amount,
      status
    )
    SELECT
      priced.review_id,
      priced.property_id,
      priced.service_week_start_date,
      priced.scheduled_date,
      priced.amount,
      'pending'
    FROM charge_values priced
    ON CONFLICT (review_id) DO UPDATE SET
      service_week_start_date = EXCLUDED.service_week_start_date,
      service_date = EXCLUDED.service_date,
      amount = EXCLUDED.amount,
      status = CASE WHEN existing_charge.status = 'void' THEN 'pending' ELSE existing_charge.status END,
      updated_at = now()
    WHERE existing_charge.status IN ('pending', 'void')
      AND EXISTS (
        SELECT 1
        FROM public.vp2_reviews review
        WHERE review.id = EXCLUDED.review_id
          AND review.status <> 'completed'
      );
    GET DIAGNOSTICS affected_count = ROW_COUNT;
    created_count := created_count + affected_count;

    UPDATE public.vp2_review_charges charge
    SET status = 'void', updated_at = now()
    FROM public.vp2_reviews review
    WHERE review.id = charge.review_id
      AND review.property_id = property_row.id
      AND review.status = 'cancelled'
      AND charge.status = 'pending';
    GET DIAGNOSTICS affected_count = ROW_COUNT;
    voided_count := voided_count + affected_count;
  END LOOP;

  RETURN jsonb_build_object(
    'charges_created_or_refreshed', created_count,
    'pending_charges_voided', voided_count
  );
END;
$$;

DROP FUNCTION IF EXISTS public.admin_complete_and_reconcile_vp2_review(UUID);

CREATE OR REPLACE FUNCTION public.admin_complete_and_reconcile_vp2_review(
  target_review_id UUID,
  expected_charge_amount NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  review_row public.vp2_reviews%ROWTYPE;
  charge_row public.vp2_review_charges%ROWTYPE;
BEGIN
  IF NOT public.is_active_app_admin() THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  SELECT review.* INTO review_row
  FROM public.vp2_reviews review
  WHERE review.id = target_review_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VP² review not found' USING ERRCODE = '22023';
  END IF;

  PERFORM public.admin_sync_vp2_review_charges(review_row.property_id);

  SELECT review.* INTO review_row
  FROM public.vp2_reviews review
  WHERE review.id = target_review_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VP² review not found' USING ERRCODE = '22023';
  END IF;
  IF review_row.status = 'cancelled' THEN
    RAISE EXCEPTION 'Cancelled VP² reviews cannot be reconciled' USING ERRCODE = '22023';
  END IF;

  SELECT charge.* INTO charge_row
  FROM public.vp2_review_charges charge
  WHERE charge.review_id = target_review_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VP² review charge is unavailable' USING ERRCODE = '22023';
  END IF;
  IF charge_row.status = 'invoiced' THEN
    RAISE EXCEPTION 'VP² review is already invoiced' USING ERRCODE = '22023';
  END IF;
  IF charge_row.status = 'void' THEN
    RAISE EXCEPTION 'VP² review charge is void' USING ERRCODE = '22023';
  END IF;
  IF charge_row.amount IS DISTINCT FROM expected_charge_amount THEN
    RAISE EXCEPTION 'VP² charge changed since it was displayed. Refresh the dashboard and confirm the updated amount.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.vp2_reviews
  SET status = 'completed',
      completed_at = COALESCE(completed_at, now()),
      attention_reason = NULL,
      updated_at = now()
  WHERE id = target_review_id;

  UPDATE public.vp2_review_charges
  SET status = 'reconciled',
      reconciled_at = COALESCE(reconciled_at, now()),
      updated_at = now()
  WHERE id = charge_row.id;

  RETURN jsonb_build_object(
    'review_id', target_review_id,
    'charge_id', charge_row.id,
    'amount', charge_row.amount,
    'status', 'reconciled'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_link_vp2_invoice_charges(target_invoice_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  invoice_status TEXT;
  item_count INTEGER;
  linked_count INTEGER;
BEGIN
  IF NOT public.is_active_app_admin() THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  SELECT lower(invoice.status) INTO invoice_status
  FROM public.invoices invoice
  WHERE invoice.id = target_invoice_id
  FOR UPDATE;
  IF NOT FOUND OR invoice_status <> 'draft' THEN
    RAISE EXCEPTION 'Invoice must be a draft before VP² charges can be finalized' USING ERRCODE = '22023';
  END IF;

  SELECT count(DISTINCT item.vp2_review_charge_id)::INTEGER
  INTO item_count
  FROM public.invoice_items item
  WHERE item.invoice_id = target_invoice_id
    AND item.item_source = 'vp2'
    AND item.vp2_review_charge_id IS NOT NULL;

  IF EXISTS (
    SELECT 1
    FROM public.invoice_items item
    LEFT JOIN public.vp2_review_charges charge ON charge.id = item.vp2_review_charge_id
    WHERE item.invoice_id = target_invoice_id
      AND item.item_source = 'vp2'
      AND (
        charge.id IS NULL
        OR charge.status <> 'reconciled'
        OR item.amount IS DISTINCT FROM charge.amount
        OR item.property_id IS DISTINCT FROM charge.property_id
        OR item.service_date IS DISTINCT FROM charge.service_date
      )
  ) THEN
    RAISE EXCEPTION 'One or more VP² invoice items are no longer eligible or do not match their charge' USING ERRCODE = '23505';
  END IF;

  UPDATE public.vp2_review_charges charge
  SET status = 'invoiced',
      invoice_item_id = item.id,
      invoiced_at = now(),
      updated_at = now()
  FROM public.invoice_items item
  WHERE item.invoice_id = target_invoice_id
    AND item.item_source = 'vp2'
    AND item.vp2_review_charge_id = charge.id
    AND charge.status = 'reconciled';
  GET DIAGNOSTICS linked_count = ROW_COUNT;

  IF linked_count <> item_count THEN
    RAISE EXCEPTION 'Not all VP² charges could be linked to invoice items' USING ERRCODE = '23505';
  END IF;

  UPDATE public.invoices
  SET status = 'finalized'
  WHERE id = target_invoice_id AND status = 'draft';

  RETURN linked_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_release_vp2_invoice_charges(target_invoice_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  released_count INTEGER;
BEGIN
  IF NOT public.is_active_app_admin() THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.vp2_review_charges charge
  SET status = 'reconciled',
      invoice_item_id = NULL,
      invoiced_at = NULL,
      updated_at = now()
  FROM public.invoice_items item
  WHERE item.invoice_id = target_invoice_id
    AND item.item_source = 'vp2'
    AND item.vp2_review_charge_id = charge.id
    AND charge.invoice_item_id = item.id
    AND charge.status = 'invoiced';
  GET DIAGNOSTICS released_count = ROW_COUNT;
  RETURN released_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_cancel_vp2_review(target_review_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  target_property_id UUID;
  review_row public.vp2_reviews%ROWTYPE;
  charge_row public.vp2_review_charges%ROWTYPE;
  affected_invoice_ids UUID[];
  affected_invoice_id UUID;
  invoice_taxable BOOLEAN;
  invoice_tax_rate NUMERIC;
  next_subtotal NUMERIC;
  next_tax NUMERIC;
BEGIN
  IF NOT public.is_active_app_admin() THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  SELECT review.property_id INTO target_property_id
  FROM public.vp2_reviews review
  WHERE review.id = target_review_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VP² review not found' USING ERRCODE = '22023';
  END IF;

  PERFORM public.admin_sync_vp2_review_charges(target_property_id);

  SELECT review.* INTO review_row
  FROM public.vp2_reviews review
  WHERE review.id = target_review_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VP² review not found' USING ERRCODE = '22023';
  END IF;
  IF review_row.status NOT IN ('scheduled', 'needs_attention', 'in_progress') THEN
    RAISE EXCEPTION 'Only scheduled, overdue, or in-progress VP² reviews can be cancelled' USING ERRCODE = '22023';
  END IF;

  SELECT charge.* INTO charge_row
  FROM public.vp2_review_charges charge
  WHERE charge.review_id = target_review_id
  FOR UPDATE;
  IF NOT FOUND OR charge_row.status <> 'pending' THEN
    RAISE EXCEPTION 'Only unbilled VP² review charges can be cancelled' USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(DISTINCT item.invoice_id)
  INTO affected_invoice_ids
  FROM public.invoice_items item
  JOIN public.invoices invoice ON invoice.id = item.invoice_id
  WHERE item.vp2_review_charge_id = charge_row.id
    AND invoice.status = 'draft';

  DELETE FROM public.invoice_items item
  USING public.invoices invoice
  WHERE item.invoice_id = invoice.id
    AND item.vp2_review_charge_id = charge_row.id
    AND invoice.status = 'draft';

  FOREACH affected_invoice_id IN ARRAY COALESCE(affected_invoice_ids, ARRAY[]::UUID[]) LOOP
    SELECT COALESCE(invoice.taxable, true), COALESCE(invoice.tax_rate, 0)
    INTO invoice_taxable, invoice_tax_rate
    FROM public.invoices invoice
    WHERE invoice.id = affected_invoice_id;

    SELECT COALESCE(sum(item.amount), 0)
    INTO next_subtotal
    FROM public.invoice_items item
    WHERE item.invoice_id = affected_invoice_id;

    next_tax := CASE
      WHEN invoice_taxable AND invoice_tax_rate > 0
        THEN round(next_subtotal * invoice_tax_rate / 100, 2)
      ELSE 0
    END;

    UPDATE public.invoices
    SET subtotal = next_subtotal,
        tax = next_tax,
        total = next_subtotal + next_tax
    WHERE id = affected_invoice_id AND status = 'draft';
  END LOOP;

  UPDATE public.vp2_reviews
  SET status = 'cancelled',
      attention_reason = 'Cancelled by Admin.',
      updated_at = now()
  WHERE id = target_review_id;

  UPDATE public.vp2_review_charges
  SET status = 'void',
      reconciled_at = NULL,
      updated_at = now()
  WHERE id = charge_row.id;

  RETURN jsonb_build_object(
    'review_id', target_review_id,
    'charge_id', charge_row.id,
    'status', 'cancelled'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_sync_vp2_review_charges(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_complete_and_reconcile_vp2_review(UUID, NUMERIC) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_link_vp2_invoice_charges(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_release_vp2_invoice_charges(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_cancel_vp2_review(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_sync_vp2_review_charges(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_complete_and_reconcile_vp2_review(UUID, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_link_vp2_invoice_charges(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_release_vp2_invoice_charges(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cancel_vp2_review(UUID) TO authenticated;

COMMIT;