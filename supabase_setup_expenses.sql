-- Business operating expense ledger for management reporting.
-- Expenses are internal costs and are not connected to invoices or service charges.

CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NULL,
  expense_date DATE NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC NOT NULL CHECK (amount > 0),
  company_branch TEXT NOT NULL DEFAULT 'Guest Ready',
  property_id UUID NULL REFERENCES properties(id) ON DELETE SET NULL,
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expenses_expense_date
ON expenses (expense_date);

CREATE INDEX IF NOT EXISTS idx_expenses_property_id
ON expenses (property_id);

CREATE INDEX IF NOT EXISTS idx_expenses_company_id
ON expenses (company_id);

CREATE OR REPLACE FUNCTION set_expenses_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS expenses_set_updated_at ON expenses;

CREATE TRIGGER expenses_set_updated_at
BEFORE UPDATE ON expenses
FOR EACH ROW
EXECUTE FUNCTION set_expenses_updated_at();