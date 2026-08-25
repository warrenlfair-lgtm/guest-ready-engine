-- Distinguishes payable technician labor from owner/non-paid labor while preserving
-- the calculated labor amount as the potential fully staffed cost.

ALTER TABLE technicians
ADD COLUMN IF NOT EXISTS paid_labor BOOLEAN NOT NULL DEFAULT TRUE;

-- Nullable by design for historical tasks. The report falls back to the current
-- technician setting when no completion-time snapshot is available.
ALTER TABLE cleaning_tasks
ADD COLUMN IF NOT EXISTS labor_payable BOOLEAN;
