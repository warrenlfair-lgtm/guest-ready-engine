-- Add property-level VP² Enhanced Monitoring settings and weekly invoice billing.
-- Run manually in the Supabase SQL Editor after the existing invoice, SDS, and
-- VP² invoice migrations. Safe to re-run.

BEGIN;

ALTER TABLE public.properties
ADD COLUMN IF NOT EXISTS vp2e_enabled BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS vp2e_weekly_fee NUMERIC(10,2) NOT NULL DEFAULT 15.00;

ALTER TABLE public.properties
DROP CONSTRAINT IF EXISTS properties_vp2e_weekly_fee_check;
ALTER TABLE public.properties
ADD CONSTRAINT properties_vp2e_weekly_fee_check
CHECK (vp2e_weekly_fee >= 0);

ALTER TABLE public.invoice_items
ADD COLUMN IF NOT EXISTS property_id UUID REFERENCES public.properties(id) ON DELETE SET NULL;

ALTER TABLE public.invoice_items
DROP CONSTRAINT IF EXISTS invoice_items_item_source_check;
ALTER TABLE public.invoice_items
ADD CONSTRAINT invoice_items_item_source_check
CHECK (item_source IS NULL OR item_source IN ('manual', 'task', 'chemical', 'sds', 'vp2', 'vp2e'));

CREATE UNIQUE INDEX IF NOT EXISTS invoice_items_vp2e_property_week_uidx
ON public.invoice_items(property_id, service_date)
WHERE item_source = 'vp2e'
  AND property_id IS NOT NULL
  AND service_date IS NOT NULL;

COMMIT;
