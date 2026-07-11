-- Create a singleton company_profile table for app branding/settings

CREATE TABLE IF NOT EXISTS company_profile (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  company_name TEXT NOT NULL,
  tagline TEXT NOT NULL,
  phone_number TEXT,
  email TEXT,
  logo_url TEXT,
  admin_pin TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE company_profile
ADD COLUMN IF NOT EXISTS admin_pin TEXT;

ALTER TABLE company_profile
ADD COLUMN IF NOT EXISTS venmo_username TEXT;

ALTER TABLE company_profile
ADD COLUMN IF NOT EXISTS venmo_qr_url TEXT;

ALTER TABLE company_profile
ADD COLUMN IF NOT EXISTS zelle_email TEXT;

ALTER TABLE company_profile
ADD COLUMN IF NOT EXISTS ach_instructions TEXT;

ALTER TABLE company_profile
ADD COLUMN IF NOT EXISTS payment_instructions TEXT;

-- Ensure one default row exists
INSERT INTO company_profile (id, company_name, tagline, admin_pin)
VALUES (1, 'Guest Ready™', 'Powered by Guest Engine™', '1234')
ON CONFLICT (id) DO NOTHING;

UPDATE company_profile
SET admin_pin = COALESCE(NULLIF(admin_pin, ''), '1234')
WHERE id = 1;

-- Enable Row Level Security
ALTER TABLE company_profile ENABLE ROW LEVEL SECURITY;

-- Basic policy matching the app's current open access pattern
DROP POLICY IF EXISTS "Allow all operations on company_profile" ON company_profile;
CREATE POLICY "Allow all operations on company_profile" ON company_profile
  FOR ALL
  USING (true)
  WITH CHECK (true);
