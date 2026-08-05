-- Add company_branch to properties so branding can be selected per client/property.
-- Existing rows default to Guest Ready to preserve current invoice behavior.

ALTER TABLE properties
ADD COLUMN IF NOT EXISTS company_branch TEXT;

UPDATE properties
SET company_branch = 'Guest Ready'
WHERE company_branch IS NULL
   OR company_branch = '';

ALTER TABLE properties
DROP CONSTRAINT IF EXISTS properties_company_branch_check;

ALTER TABLE properties
ADD CONSTRAINT properties_company_branch_check
CHECK (company_branch IN ('Guest Ready', 'Weekend Ready'));

ALTER TABLE properties
ALTER COLUMN company_branch SET DEFAULT 'Guest Ready';

ALTER TABLE properties
ALTER COLUMN company_branch SET NOT NULL;
