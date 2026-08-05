-- Add branch-specific logo URL columns for invoice branding by company branch.

ALTER TABLE company_profile
ADD COLUMN IF NOT EXISTS guest_ready_logo_url TEXT;

ALTER TABLE company_profile
ADD COLUMN IF NOT EXISTS weekend_ready_logo_url TEXT;

-- Backfill Guest Ready logo from legacy logo_url when available.
UPDATE company_profile
SET guest_ready_logo_url = COALESCE(NULLIF(guest_ready_logo_url, ''), logo_url)
WHERE id = 1;
