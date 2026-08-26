-- One-time guarded correction for five Guest Ready monthly contract histories.
-- Manual run only. This script updates only property_contract_revenue_history.
-- It preserves the existing history row IDs and effective-date boundaries.

BEGIN;

LOCK TABLE properties IN SHARE MODE;
LOCK TABLE property_contract_revenue_history IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE contract_correction_targets ON COMMIT DROP AS
SELECT
  p.id AS property_id,
  p.property_name
FROM properties p
WHERE lower(trim(p.property_name)) IN (
    'bransby',
    'crossbow',
    'debbie',
    'fallowfield',
    'ferguson'
  )
  AND lower(trim(COALESCE(p.company_branch, ''))) = 'guest ready';

DO $$
DECLARE
  target_count INTEGER;
  invalid_current_count INTEGER;
  invalid_history_count INTEGER;
BEGIN
  SELECT count(*) INTO target_count
  FROM contract_correction_targets;

  IF target_count <> 5 THEN
    RAISE EXCEPTION
      'Contract correction aborted: expected exactly 5 Guest Ready target properties, found %.',
      target_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM contract_correction_targets
    GROUP BY lower(trim(property_name))
    HAVING count(*) <> 1
  ) THEN
    RAISE EXCEPTION
      'Contract correction aborted: one or more target property names are duplicated.';
  END IF;

  SELECT count(*) INTO invalid_current_count
  FROM contract_correction_targets target
  JOIN properties p ON p.id = target.property_id
  WHERE p.contract_revenue_amount IS DISTINCT FROM 300::NUMERIC
     OR p.contract_rate_basis IS DISTINCT FROM 'monthly';

  IF invalid_current_count <> 0 THEN
    RAISE EXCEPTION
      'Contract correction aborted: all 5 target properties must currently be configured as $300 monthly.';
  END IF;

  SELECT count(*) INTO invalid_history_count
  FROM contract_correction_targets target
  WHERE (
      SELECT count(*)
      FROM property_contract_revenue_history h
      WHERE h.property_id = target.property_id
        AND h.effective_from = DATE '2026-01-01'
        AND h.effective_to = DATE '2026-07-31'
        AND h.contract_rate_basis = 'monthly'
        AND h.contract_revenue_amount IN (260::NUMERIC, 300::NUMERIC)
    ) <> 1
    OR (
      SELECT count(*)
      FROM property_contract_revenue_history h
      WHERE h.property_id = target.property_id
        AND h.effective_from = DATE '2026-08-01'
        AND h.effective_to = DATE '2026-08-31'
        AND h.contract_rate_basis = 'monthly'
        AND h.contract_revenue_amount IN (260::NUMERIC, 300::NUMERIC)
    ) <> 1
    OR (
      SELECT count(*)
      FROM property_contract_revenue_history h
      WHERE h.property_id = target.property_id
        AND h.effective_from = DATE '2026-09-01'
        AND h.effective_to IS NULL
        AND h.contract_rate_basis = 'monthly'
        AND h.contract_revenue_amount = 300::NUMERIC
    ) <> 1
    OR EXISTS (
      SELECT 1
      FROM property_contract_revenue_history h
      WHERE h.property_id = target.property_id
        AND h.effective_from <= DATE '2026-08-31'
        AND (h.effective_to IS NULL OR h.effective_to >= DATE '2026-01-01')
        AND NOT (
          (h.effective_from = DATE '2026-01-01' AND h.effective_to = DATE '2026-07-31')
          OR
          (h.effective_from = DATE '2026-08-01' AND h.effective_to = DATE '2026-08-31')
        )
    );

  IF invalid_history_count <> 0 THEN
    RAISE EXCEPTION
      'Contract correction aborted: one or more target properties do not have the expected guarded Jan-Jul, August, and September-forward history rows.';
  END IF;
END;
$$;

-- Preview the only rows this transaction is allowed to change.
SELECT
  target.property_name AS property,
  h.contract_revenue_amount AS current_contract_amount,
  h.contract_rate_basis AS current_basis,
  h.effective_from,
  h.effective_to
FROM contract_correction_targets target
JOIN property_contract_revenue_history h
  ON h.property_id = target.property_id
WHERE h.effective_from IN (DATE '2026-01-01', DATE '2026-08-01')
ORDER BY target.property_name, h.effective_from;

UPDATE property_contract_revenue_history h
SET
  contract_revenue_amount = 300,
  contract_rate_basis = 'monthly'
FROM contract_correction_targets target
WHERE h.property_id = target.property_id
  AND (
    (h.effective_from = DATE '2026-01-01' AND h.effective_to = DATE '2026-07-31')
    OR
    (h.effective_from = DATE '2026-08-01' AND h.effective_to = DATE '2026-08-31')
  );

DO $$
DECLARE
  corrected_row_count INTEGER;
BEGIN
  SELECT count(*) INTO corrected_row_count
  FROM contract_correction_targets target
  JOIN property_contract_revenue_history h
    ON h.property_id = target.property_id
  WHERE h.contract_revenue_amount = 300
    AND h.contract_rate_basis = 'monthly'
    AND (
      (h.effective_from = DATE '2026-01-01' AND h.effective_to = DATE '2026-07-31')
      OR
      (h.effective_from = DATE '2026-08-01' AND h.effective_to = DATE '2026-08-31')
    );

  IF corrected_row_count <> 10 THEN
    RAISE EXCEPTION
      'Contract correction aborted: expected 10 corrected history rows, found %.',
      corrected_row_count;
  END IF;
END;
$$;

-- Verification 1: terms effective at the requested historical start date.
SELECT
  target.property_name AS property,
  h.contract_revenue_amount AS contract_amount,
  h.contract_rate_basis AS basis,
  h.effective_from AS effective_date
FROM contract_correction_targets target
JOIN property_contract_revenue_history h
  ON h.property_id = target.property_id
WHERE h.effective_from = DATE '2026-01-01'
  AND h.effective_to = DATE '2026-07-31'
ORDER BY target.property_name;

-- Verification 2: August terms used by the Service P&L and expected full-month total.
SELECT
  target.property_name AS property,
  h.contract_revenue_amount AS contract_amount,
  h.contract_rate_basis AS basis,
  h.effective_from AS effective_date
FROM contract_correction_targets target
JOIN property_contract_revenue_history h
  ON h.property_id = target.property_id
WHERE h.effective_from = DATE '2026-08-01'
  AND h.effective_to = DATE '2026-08-31'
ORDER BY target.property_name;

SELECT
  SUM(h.contract_revenue_amount) AS expected_full_month_contract_revenue
FROM contract_correction_targets target
JOIN property_contract_revenue_history h
  ON h.property_id = target.property_id
WHERE h.effective_from = DATE '2026-08-01'
  AND h.effective_to = DATE '2026-08-31'
  AND h.contract_rate_basis = 'monthly';

COMMIT;
