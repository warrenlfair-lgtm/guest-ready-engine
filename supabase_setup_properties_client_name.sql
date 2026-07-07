-- Add optional client_name for property grouping and reporting.
-- Existing rows remain compatible with NULL values.

ALTER TABLE properties
ADD COLUMN IF NOT EXISTS client_name TEXT;
