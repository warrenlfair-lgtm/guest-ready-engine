-- Allow labor snapshot to remain pending when a task is completed without technician assignment.

ALTER TABLE cleaning_tasks
ALTER COLUMN labor_amount DROP NOT NULL;
