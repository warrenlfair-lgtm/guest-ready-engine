-- Add technician and labor snapshot fields to cleaning_tasks for completion-time tracking.

ALTER TABLE cleaning_tasks
ADD COLUMN IF NOT EXISTS technician_id UUID REFERENCES technicians(id) ON DELETE SET NULL;

ALTER TABLE cleaning_tasks
ADD COLUMN IF NOT EXISTS technician_name TEXT;

ALTER TABLE cleaning_tasks
ADD COLUMN IF NOT EXISTS completed_by_technician_id UUID REFERENCES technicians(id) ON DELETE SET NULL;

ALTER TABLE cleaning_tasks
ADD COLUMN IF NOT EXISTS completed_by_technician_name TEXT;

ALTER TABLE cleaning_tasks
ADD COLUMN IF NOT EXISTS labor_amount NUMERIC(10,2) NOT NULL DEFAULT 0;

ALTER TABLE cleaning_tasks
ADD COLUMN IF NOT EXISTS labor_calculated_at TIMESTAMPTZ;

-- Backfill completed_by fields from legacy technician columns when available.
UPDATE cleaning_tasks
SET completed_by_technician_id = COALESCE(completed_by_technician_id, technician_id),
		completed_by_technician_name = COALESCE(NULLIF(completed_by_technician_name, ''), technician_name, technician)
WHERE completed_by_technician_id IS NULL
	 OR completed_by_technician_name IS NULL
	 OR completed_by_technician_name = '';

UPDATE cleaning_tasks
SET labor_amount = COALESCE(labor_amount, 0);

UPDATE cleaning_tasks
SET labor_calculated_at = COALESCE(labor_calculated_at, completed_at)
WHERE labor_calculated_at IS NULL
	AND completed_at IS NOT NULL;
