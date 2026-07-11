-- Invoice generation schema for cleaning and chemical billing

-- Property/client billing profile fields
ALTER TABLE properties
ADD COLUMN IF NOT EXISTS billing_company_name TEXT,
ADD COLUMN IF NOT EXISTS billing_email TEXT,
ADD COLUMN IF NOT EXISTS billing_address TEXT,
ADD COLUMN IF NOT EXISTS billing_account_reference TEXT,
ADD COLUMN IF NOT EXISTS default_cleaning_rate NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS billing_taxable BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS billing_tax_rate NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS payment_terms TEXT DEFAULT 'Net 15',
ADD COLUMN IF NOT EXISTS invoice_notes TEXT;

-- Invoice header table
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number TEXT UNIQUE NOT NULL,
  property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  client_name TEXT,
  billing_email TEXT,
  billing_address TEXT,
  period_start DATE,
  period_end DATE,
  invoice_date DATE,
  due_date DATE,
  subtotal NUMERIC DEFAULT 0,
  tax NUMERIC DEFAULT 0,
  total NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'draft',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoices_property_id ON invoices(property_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_period ON invoices(period_start, period_end);

-- Invoice line items table
CREATE TABLE IF NOT EXISTS invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
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
ADD COLUMN IF NOT EXISTS notes TEXT,
ADD COLUMN IF NOT EXISTS item_source TEXT;

CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_task_id ON invoice_items(task_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_chemical_usage_id ON invoice_items(chemical_usage_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_item_source ON invoice_items(item_source);

-- Link source records to finalized invoices to prevent duplicate billing
ALTER TABLE cleaning_tasks
ADD COLUMN IF NOT EXISTS invoiced_invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS invoiced_at TIMESTAMPTZ;

ALTER TABLE chemical_usage
ADD COLUMN IF NOT EXISTS invoiced BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS invoiced_invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS invoiced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_cleaning_tasks_invoiced_invoice_id ON cleaning_tasks(invoiced_invoice_id);
CREATE INDEX IF NOT EXISTS idx_cleaning_tasks_invoice_id ON cleaning_tasks(invoice_id);
CREATE INDEX IF NOT EXISTS idx_chemical_usage_invoiced ON chemical_usage(invoiced);
CREATE INDEX IF NOT EXISTS idx_chemical_usage_invoiced_invoice_id ON chemical_usage(invoiced_invoice_id);
CREATE INDEX IF NOT EXISTS idx_chemical_usage_invoice_id ON chemical_usage(invoice_id);

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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invoice_items_item_source_check'
  ) THEN
    ALTER TABLE invoice_items
    ADD CONSTRAINT invoice_items_item_source_check
    CHECK (item_source IS NULL OR item_source IN ('manual', 'task', 'chemical'));
  END IF;
END $$;
