-- Add service frequency controls for Weekly Standard task generation.
-- Existing properties default to Weekly to preserve current scheduling.

ALTER TABLE properties
ADD COLUMN IF NOT EXISTS service_frequency TEXT;

ALTER TABLE properties
ADD COLUMN IF NOT EXISTS biweekly_anchor_date DATE;

UPDATE properties
SET service_frequency = 'weekly'
WHERE service_frequency IS NULL
   OR trim(service_frequency) = '';

ALTER TABLE properties
DROP CONSTRAINT IF EXISTS properties_service_frequency_check;

ALTER TABLE properties
ADD CONSTRAINT properties_service_frequency_check
CHECK (service_frequency IN ('weekly', 'bi_weekly'));

ALTER TABLE properties
ALTER COLUMN service_frequency SET DEFAULT 'weekly';

ALTER TABLE properties
ALTER COLUMN service_frequency SET NOT NULL;
