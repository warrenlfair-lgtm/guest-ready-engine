-- Invoice persistence compatibility migration
-- Purpose: ensure required tables/columns exist for Save Draft + draft loading

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Core invoices table (minimum + app-compatible columns)
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number TEXT UNIQUE,
  client_id UUID,
  property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  client_name TEXT,
  billing_email TEXT,
  billing_address TEXT,
  status TEXT DEFAULT 'draft',
  invoice_date DATE,
  due_date DATE,
  service_period_start DATE,
  service_period_end DATE,
  period_start DATE,
  period_end DATE,
  subtotal NUMERIC DEFAULT 0,
  tax_amount NUMERIC DEFAULT 0,
  tax NUMERIC DEFAULT 0,
  total NUMERIC DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS client_id UUID,
  ADD COLUMN IF NOT EXISTS client_name TEXT,
  ADD COLUMN IF NOT EXISTS billing_email TEXT,
  ADD COLUMN IF NOT EXISTS billing_address TEXT,
  ADD COLUMN IF NOT EXISTS service_period_start DATE,
  ADD COLUMN IF NOT EXISTS service_period_end DATE,
  ADD COLUMN IF NOT EXISTS period_start DATE,
  ADD COLUMN IF NOT EXISTS period_end DATE,
  ADD COLUMN IF NOT EXISTS tax_amount NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_invoices_property_id ON invoices(property_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_created_at ON invoices(created_at);

-- Keep status values constrained to expected workflow states
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invoices_status_check'
  ) THEN
    ALTER TABLE invoices
    ADD CONSTRAINT invoices_status_check
    CHECK (status IN ('draft', 'finalized', 'sent', 'paid', 'void'));
  END IF;
END $$;

-- Line items table (minimum + app-compatible columns)
CREATE TABLE IF NOT EXISTS invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
  source_type TEXT,
  source_id UUID,
  task_id UUID NULL REFERENCES cleaning_tasks(id) ON DELETE SET NULL,
  chemical_usage_id UUID NULL REFERENCES chemical_usage(id) ON DELETE SET NULL,
  description TEXT,
  service_date DATE,
  quantity NUMERIC DEFAULT 0,
  unit TEXT,
  rate NUMERIC DEFAULT 0,
  amount NUMERIC DEFAULT 0,
  notes TEXT,
  item_source TEXT,
  item_type TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE invoice_items
  ADD COLUMN IF NOT EXISTS source_type TEXT,
  ADD COLUMN IF NOT EXISTS source_id UUID,
  ADD COLUMN IF NOT EXISTS task_id UUID,
  ADD COLUMN IF NOT EXISTS chemical_usage_id UUID,
  ADD COLUMN IF NOT EXISTS item_source TEXT,
  ADD COLUMN IF NOT EXISTS item_type TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- Add foreign keys only when missing and tables exist
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'cleaning_tasks')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_items_task_id_fkey') THEN
    ALTER TABLE invoice_items
    ADD CONSTRAINT invoice_items_task_id_fkey
    FOREIGN KEY (task_id) REFERENCES cleaning_tasks(id) ON DELETE SET NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'chemical_usage')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_items_chemical_usage_id_fkey') THEN
    ALTER TABLE invoice_items
    ADD CONSTRAINT invoice_items_chemical_usage_id_fkey
    FOREIGN KEY (chemical_usage_id) REFERENCES chemical_usage(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_source_type ON invoice_items(source_type);
CREATE INDEX IF NOT EXISTS idx_invoice_items_source_id ON invoice_items(source_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_task_id ON invoice_items(task_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_chemical_usage_id ON invoice_items(chemical_usage_id);

-- Optional invoice-related tables (created only if your workflow needs them)
CREATE TABLE IF NOT EXISTS invoice_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
  payment_date DATE,
  amount NUMERIC DEFAULT 0,
  method TEXT,
  reference TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoice_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
  previous_status TEXT,
  new_status TEXT,
  changed_at TIMESTAMPTZ DEFAULT now(),
  changed_by TEXT,
  note TEXT
);

CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice_id ON invoice_payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_history_invoice_id ON invoice_history(invoice_id);

-- Helpful verification queries
-- SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('invoices','invoice_items','invoice_payments','invoice_history') ORDER BY table_name;
-- SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'invoices' ORDER BY ordinal_position;
-- SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'invoice_items' ORDER BY ordinal_position;
