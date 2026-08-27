-- Additive Lawn Service workspace support.
-- Run once in the Supabase SQL Editor before using Lawn Service in the app.

BEGIN;

ALTER TABLE properties
ADD COLUMN IF NOT EXISTS pool_service_active BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS lawn_service_active BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS lawn_service_frequency TEXT NOT NULL DEFAULT 'weekly',
ADD COLUMN IF NOT EXISTS lawn_service_day TEXT NOT NULL DEFAULT 'Wednesday',
ADD COLUMN IF NOT EXISTS lawn_biweekly_anchor_date DATE,
ADD COLUMN IF NOT EXISTS lawn_default_charge NUMERIC(10,2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS lawn_labor_amount NUMERIC(10,2) NOT NULL DEFAULT 0;

ALTER TABLE cleaning_tasks
ADD COLUMN IF NOT EXISTS service_branch TEXT NOT NULL DEFAULT 'pool';

ALTER TABLE invoice_items
ADD COLUMN IF NOT EXISTS service_branch TEXT;

UPDATE cleaning_tasks
SET service_branch = 'pool'
WHERE service_branch IS NULL OR trim(service_branch) = '';

ALTER TABLE properties
DROP CONSTRAINT IF EXISTS properties_lawn_service_frequency_check;
ALTER TABLE properties
ADD CONSTRAINT properties_lawn_service_frequency_check
CHECK (lawn_service_frequency IN ('weekly', 'bi_weekly'));

ALTER TABLE properties
DROP CONSTRAINT IF EXISTS properties_lawn_service_day_check;
ALTER TABLE properties
ADD CONSTRAINT properties_lawn_service_day_check
CHECK (lawn_service_day IN ('Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'));

ALTER TABLE properties
DROP CONSTRAINT IF EXISTS properties_lawn_default_charge_check;
ALTER TABLE properties
ADD CONSTRAINT properties_lawn_default_charge_check
CHECK (lawn_default_charge >= 0);

ALTER TABLE properties
DROP CONSTRAINT IF EXISTS properties_lawn_labor_amount_check;
ALTER TABLE properties
ADD CONSTRAINT properties_lawn_labor_amount_check
CHECK (lawn_labor_amount >= 0);

ALTER TABLE cleaning_tasks
DROP CONSTRAINT IF EXISTS cleaning_tasks_service_branch_check;
ALTER TABLE cleaning_tasks
ADD CONSTRAINT cleaning_tasks_service_branch_check
CHECK (service_branch IN ('pool', 'lawn'));

ALTER TABLE invoice_items
DROP CONSTRAINT IF EXISTS invoice_items_service_branch_check;
ALTER TABLE invoice_items
ADD CONSTRAINT invoice_items_service_branch_check
CHECK (service_branch IS NULL OR service_branch IN ('pool', 'lawn'));

CREATE INDEX IF NOT EXISTS idx_cleaning_tasks_service_branch_date
ON cleaning_tasks(service_branch, service_date);

CREATE INDEX IF NOT EXISTS idx_invoice_items_service_branch
ON invoice_items(service_branch);

COMMIT;
