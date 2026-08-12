-- Add property active/inactive status control.
-- Existing properties default to active to preserve current behavior.

ALTER TABLE properties
ADD COLUMN IF NOT EXISTS active BOOLEAN;

UPDATE properties
SET active = true
WHERE active IS NULL;

ALTER TABLE properties
ALTER COLUMN active SET DEFAULT true;

ALTER TABLE properties
ALTER COLUMN active SET NOT NULL;
