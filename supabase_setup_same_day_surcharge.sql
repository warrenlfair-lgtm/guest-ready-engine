-- Adds Same-Day Surcharge (SDS) billing support. Run manually in the
-- Supabase SQL Editor. Safe to re-run (all statements are idempotent).

-- Property-level default SDS rate. Existing properties default to 0 (non-billable).
ALTER TABLE properties
ADD COLUMN IF NOT EXISTS same_day_surcharge NUMERIC DEFAULT 0;

-- Task-level SDS fields, tracked completely separately from the existing
-- invoiced/invoice_id/invoiced_invoice_id fields used for Guest Ready/Weekly billing.
-- same_day_surcharge_amount doubles as the manual override AND the reconcile-time snapshot,
-- mirroring how cleaning_tasks.charge already works for Weekly Standard.
ALTER TABLE cleaning_tasks
ADD COLUMN IF NOT EXISTS same_day_surcharge_amount NUMERIC,
ADD COLUMN IF NOT EXISTS same_day_surcharge_reconciled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS same_day_surcharge_reconciled_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS same_day_surcharge_invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cleaning_tasks_sds_reconciled ON cleaning_tasks(same_day_surcharge_reconciled);
CREATE INDEX IF NOT EXISTS idx_cleaning_tasks_sds_invoice_id ON cleaning_tasks(same_day_surcharge_invoice_id);

-- Allow a new 'sds' invoice_items.item_source so the surcharge can appear as its
-- own invoice line item, separate from the existing 'task' (Guest Ready/Weekly) line.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoice_items_item_source_check'
  ) THEN
    ALTER TABLE invoice_items DROP CONSTRAINT invoice_items_item_source_check;
  END IF;

  ALTER TABLE invoice_items
  ADD CONSTRAINT invoice_items_item_source_check
  CHECK (item_source IS NULL OR item_source IN ('manual', 'task', 'chemical', 'sds'));
END $$;
