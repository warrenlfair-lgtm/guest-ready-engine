-- Additive support for standalone manual invoices in the existing invoice system.
-- Run manually in the Supabase SQL Editor before creating manual invoices.

BEGIN;

ALTER TABLE public.invoices
ADD COLUMN IF NOT EXISTS billing_company_name TEXT,
ADD COLUMN IF NOT EXISTS billing_account_reference TEXT,
ADD COLUMN IF NOT EXISTS payment_terms TEXT NOT NULL DEFAULT 'Net 15',
ADD COLUMN IF NOT EXISTS taxable BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(10,4) NOT NULL DEFAULT 0;

ALTER TABLE public.invoice_items
ADD COLUMN IF NOT EXISTS property_id UUID REFERENCES public.properties(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS service_branch TEXT,
ADD COLUMN IF NOT EXISTS labor_cost NUMERIC(10,2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS material_cost NUMERIC(10,2) NOT NULL DEFAULT 0;

UPDATE public.invoice_items item
SET property_id = invoice.property_id
FROM public.invoices invoice
WHERE item.invoice_id = invoice.id
  AND item.property_id IS NULL;

ALTER TABLE public.invoice_items
DROP CONSTRAINT IF EXISTS invoice_items_service_branch_check;
ALTER TABLE public.invoice_items
ADD CONSTRAINT invoice_items_service_branch_check
CHECK (service_branch IS NULL OR service_branch IN ('pool', 'lawn', 'maintenance', 'housekeeping', 'other'));

ALTER TABLE public.invoice_items
DROP CONSTRAINT IF EXISTS invoice_items_labor_cost_check;
ALTER TABLE public.invoice_items
ADD CONSTRAINT invoice_items_labor_cost_check
CHECK (labor_cost >= 0);

ALTER TABLE public.invoice_items
DROP CONSTRAINT IF EXISTS invoice_items_material_cost_check;
ALTER TABLE public.invoice_items
ADD CONSTRAINT invoice_items_material_cost_check
CHECK (material_cost >= 0);

CREATE INDEX IF NOT EXISTS idx_invoice_items_property_id
ON public.invoice_items(property_id);

COMMIT;