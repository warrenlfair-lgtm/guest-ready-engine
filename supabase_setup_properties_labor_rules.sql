-- Add property-level labor rule amounts for Phase 1 technician labor tracking.
-- Existing rows default to 0.00 so current behavior remains unchanged.

ALTER TABLE properties
ADD COLUMN IF NOT EXISTS weekly_service_labor NUMERIC(10,2) NOT NULL DEFAULT 0;

ALTER TABLE properties
ADD COLUMN IF NOT EXISTS guest_ready_service_labor NUMERIC(10,2) NOT NULL DEFAULT 0;

ALTER TABLE properties
ADD COLUMN IF NOT EXISTS additional_cleaning_labor NUMERIC(10,2) NOT NULL DEFAULT 0;

UPDATE properties
SET weekly_service_labor = COALESCE(weekly_service_labor, 0),
    guest_ready_service_labor = COALESCE(guest_ready_service_labor, 0),
    additional_cleaning_labor = COALESCE(additional_cleaning_labor, 0);
