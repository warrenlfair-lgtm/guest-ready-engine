-- Adds status tracking to reservations so cancelled/stale iCal reservations
-- can be marked inactive instead of lingering forever. Run manually in the
-- Supabase SQL Editor. Safe to re-run (all statements are idempotent).

ALTER TABLE reservations
ADD COLUMN IF NOT EXISTS reservation_uid TEXT,
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active',
ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

-- Backfill any existing rows (including legacy reservation_uid = NULL rows)
-- so status is never NULL going forward.
UPDATE reservations
SET status = 'active'
WHERE status IS NULL;

CREATE INDEX IF NOT EXISTS idx_reservations_property_status ON reservations(property_id, status);
CREATE INDEX IF NOT EXISTS idx_reservations_uid ON reservations(reservation_uid);
