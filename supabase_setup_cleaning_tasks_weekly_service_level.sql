-- Add weekly service level tracking for Weekly Standard tasks.

ALTER TABLE cleaning_tasks
ADD COLUMN IF NOT EXISTS weekly_service_level TEXT;

-- Historical/default safeguard: treat Weekly Standard tasks as Full Service when unset.
UPDATE cleaning_tasks
SET weekly_service_level = 'full_service'
WHERE service_type = 'Weekly Standard'
  AND (weekly_service_level IS NULL OR trim(weekly_service_level) = '');
