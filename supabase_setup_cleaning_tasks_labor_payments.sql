-- Add labor payment tracking fields to cleaning_tasks for individual task payouts.

ALTER TABLE cleaning_tasks
ADD COLUMN IF NOT EXISTS labor_paid BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE cleaning_tasks
ADD COLUMN IF NOT EXISTS labor_paid_at TIMESTAMPTZ;

-- Backfill any null booleans to false for consistency.
UPDATE cleaning_tasks
SET labor_paid = COALESCE(labor_paid, FALSE);
