-- Reporting-only outside-contract revenue settings and effective-dated history.
-- These fields are intentionally separate from cleaning_tasks.charge and all invoice fields.

ALTER TABLE properties
ADD COLUMN IF NOT EXISTS contract_revenue_amount NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE properties
ADD COLUMN IF NOT EXISTS contract_rate_basis TEXT NOT NULL DEFAULT 'no_contract';

ALTER TABLE properties
DROP CONSTRAINT IF EXISTS properties_contract_rate_basis_check;

ALTER TABLE properties
ADD CONSTRAINT properties_contract_rate_basis_check
CHECK (contract_rate_basis IN ('no_contract', 'monthly', 'weekly'));

CREATE TABLE IF NOT EXISTS property_contract_revenue_history (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
	contract_revenue_amount NUMERIC NOT NULL DEFAULT 0 CHECK (contract_revenue_amount >= 0),
	contract_rate_basis TEXT NOT NULL CHECK (contract_rate_basis IN ('no_contract', 'monthly', 'weekly')),
	contract_service_day TEXT NOT NULL DEFAULT 'Wednesday',
	effective_from DATE NOT NULL,
	effective_to DATE,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	CONSTRAINT property_contract_revenue_history_dates_check
		CHECK (effective_to IS NULL OR effective_to >= effective_from),
	CONSTRAINT property_contract_revenue_history_property_start_key
		UNIQUE (property_id, effective_from)
);

	ALTER TABLE property_contract_revenue_history
	ADD COLUMN IF NOT EXISTS contract_service_day TEXT NOT NULL DEFAULT 'Wednesday';

CREATE INDEX IF NOT EXISTS idx_property_contract_revenue_history_lookup
ON property_contract_revenue_history (property_id, effective_from, effective_to);

CREATE OR REPLACE FUNCTION get_next_property_contract_week_start(
	from_date DATE,
	service_day TEXT
)
RETURNS DATE
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
	target_day INTEGER;
	days_ahead INTEGER;
BEGIN
	target_day := CASE lower(trim(COALESCE(service_day, 'Wednesday')))
		WHEN 'sunday' THEN 0
		WHEN 'monday' THEN 1
		WHEN 'tuesday' THEN 2
		WHEN 'wednesday' THEN 3
		WHEN 'thursday' THEN 4
		WHEN 'friday' THEN 5
		WHEN 'saturday' THEN 6
		ELSE 3
	END;
	days_ahead := (target_day - EXTRACT(DOW FROM from_date)::INTEGER + 7) % 7;
	IF days_ahead = 0 THEN
		days_ahead := 7;
	END IF;
	RETURN from_date + days_ahead;
END;
$$;

CREATE OR REPLACE FUNCTION snapshot_property_contract_revenue_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
	history_start DATE;
	previous_basis TEXT;
BEGIN
	IF TG_OP = 'UPDATE' THEN
		IF NEW.contract_revenue_amount IS NOT DISTINCT FROM OLD.contract_revenue_amount
			 AND NEW.contract_rate_basis IS NOT DISTINCT FROM OLD.contract_rate_basis
			 AND NEW.standard_service_day IS NOT DISTINCT FROM OLD.standard_service_day THEN
			RETURN NEW;
		END IF;
	END IF;

	IF TG_OP = 'INSERT' THEN
		history_start := date_trunc('month', CURRENT_DATE)::DATE;
	ELSE
		previous_basis := COALESCE(OLD.contract_rate_basis, 'no_contract');
		IF previous_basis = 'no_contract' THEN
			history_start := date_trunc('month', CURRENT_DATE)::DATE;
		ELSIF previous_basis = 'monthly' THEN
			history_start := (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month')::DATE;
		ELSE
			history_start := get_next_property_contract_week_start(CURRENT_DATE, OLD.standard_service_day);
		END IF;
	END IF;

	DELETE FROM property_contract_revenue_history
	WHERE property_id = NEW.id
		AND effective_from >= history_start;

	UPDATE property_contract_revenue_history
	SET effective_to = history_start - 1
	WHERE property_id = NEW.id
		AND effective_from < history_start
		AND (effective_to IS NULL OR effective_to >= history_start);

	INSERT INTO property_contract_revenue_history (
		property_id,
		contract_revenue_amount,
		contract_rate_basis,
		contract_service_day,
		effective_from,
		effective_to
	) VALUES (
		NEW.id,
		GREATEST(0, COALESCE(NEW.contract_revenue_amount, 0)),
		COALESCE(NEW.contract_rate_basis, 'no_contract'),
		COALESCE(NEW.standard_service_day, 'Wednesday'),
		history_start,
		NULL
	)
	ON CONFLICT (property_id, effective_from) DO UPDATE SET
		contract_revenue_amount = EXCLUDED.contract_revenue_amount,
		contract_rate_basis = EXCLUDED.contract_rate_basis,
		contract_service_day = EXCLUDED.contract_service_day,
		effective_to = NULL;

	RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS properties_snapshot_contract_revenue_change ON properties;

CREATE TRIGGER properties_snapshot_contract_revenue_change
AFTER INSERT OR UPDATE OF contract_revenue_amount, contract_rate_basis, standard_service_day
ON properties
FOR EACH ROW
EXECUTE FUNCTION snapshot_property_contract_revenue_change();

INSERT INTO property_contract_revenue_history (
	property_id,
	contract_revenue_amount,
	contract_rate_basis,
	contract_service_day,
	effective_from,
	effective_to
)
SELECT
	id,
	GREATEST(0, COALESCE(contract_revenue_amount, 0)),
	COALESCE(contract_rate_basis, 'no_contract'),
	COALESCE(standard_service_day, 'Wednesday'),
	date_trunc('month', CURRENT_DATE)::DATE,
	NULL
FROM properties
ON CONFLICT (property_id, effective_from) DO NOTHING;
