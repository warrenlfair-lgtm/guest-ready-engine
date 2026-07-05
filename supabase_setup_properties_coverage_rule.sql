-- Add directional Guest Ready coverage rule to properties
-- Run this before deploying app/sync code changes.

ALTER TABLE properties
ADD COLUMN IF NOT EXISTS coverage_rule TEXT;

-- Backfill existing properties:
-- Required by request: if coverage_days = 1, default to 'both'.
-- Also map 0 to 'none', and any value > 1 to 'both' for safe compatibility.
UPDATE properties
SET coverage_rule = CASE
  WHEN coverage_rule IN ('none', 'before', 'after', 'both') THEN coverage_rule
  WHEN COALESCE(coverage_days, 1) = 0 THEN 'none'
  WHEN COALESCE(coverage_days, 1) = 1 THEN 'both'
  ELSE 'both'
END;

-- Enforce valid values going forward
ALTER TABLE properties
DROP CONSTRAINT IF EXISTS properties_coverage_rule_check;

ALTER TABLE properties
ADD CONSTRAINT properties_coverage_rule_check
CHECK (coverage_rule IN ('none', 'before', 'after', 'both'));

-- Ensure non-null default for new properties
ALTER TABLE properties
ALTER COLUMN coverage_rule SET DEFAULT 'both';

UPDATE properties
SET coverage_rule = 'both'
WHERE coverage_rule IS NULL;

ALTER TABLE properties
ALTER COLUMN coverage_rule SET NOT NULL;
