-- Create the operations_reminders table for Guest Ready™
-- This table stores operational reminders separate from service tasks

CREATE TABLE IF NOT EXISTS operations_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  title VARCHAR(100) NOT NULL,
  notes TEXT,
  due_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'Completed')),
  created_at TIMESTAMP DEFAULT now(),
  completed_at TIMESTAMP,
  
  CONSTRAINT reminder_property_fk FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
);

-- Create index on property_id and status for efficient queries
CREATE INDEX IF NOT EXISTS idx_operations_reminders_property_status ON operations_reminders(property_id, status);

-- Create index on due_date for sorting
CREATE INDEX IF NOT EXISTS idx_operations_reminders_due_date ON operations_reminders(due_date);

-- Enable RLS (Row Level Security)
ALTER TABLE operations_reminders ENABLE ROW LEVEL SECURITY;

-- Create a basic policy that allows all authenticated users to access all reminders
-- Adjust this based on your actual security requirements
CREATE POLICY "Allow all operations on operations_reminders" ON operations_reminders
  FOR ALL
  USING (true)
  WITH CHECK (true);
