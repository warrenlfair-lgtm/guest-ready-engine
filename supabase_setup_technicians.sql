-- Create technicians table for labor tracking and assignment.

CREATE TABLE IF NOT EXISTS technicians (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_technicians_name_unique
  ON technicians ((lower(name)));

ALTER TABLE technicians ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all operations on technicians" ON technicians;
CREATE POLICY "Allow all operations on technicians" ON technicians
  FOR ALL
  USING (true)
  WITH CHECK (true);
