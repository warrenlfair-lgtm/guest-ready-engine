-- Internal task-level parts/material cost for Service P&L reporting.
-- This value is intentionally separate from task charges and all invoice fields.

ALTER TABLE cleaning_tasks
ADD COLUMN IF NOT EXISTS parts_cost NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE cleaning_tasks
DROP CONSTRAINT IF EXISTS cleaning_tasks_parts_cost_nonnegative;

ALTER TABLE cleaning_tasks
ADD CONSTRAINT cleaning_tasks_parts_cost_nonnegative
CHECK (parts_cost >= 0);
