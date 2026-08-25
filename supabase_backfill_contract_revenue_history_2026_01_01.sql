-- One-time guarded backfill for reporting-only contract revenue history.
-- Manual run only. This script touches only property_contract_revenue_history.

BEGIN;

LOCK TABLE properties IN SHARE MODE;
LOCK TABLE property_contract_revenue_history IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE contract_backfill_eligible ON COMMIT DROP AS
SELECT
  p.id AS property_id,
  p.property_name,
  GREATEST(0, p.contract_revenue_amount) AS contract_revenue_amount,
  p.contract_rate_basis,
  COALESCE(NULLIF(trim(p.standard_service_day), ''), 'Wednesday') AS contract_service_day
FROM properties p
WHERE p.contract_revenue_amount > 0
  AND p.contract_rate_basis IN ('monthly', 'weekly');

CREATE TEMP TABLE contract_backfill_conflicts ON COMMIT DROP AS
SELECT
  e.property_id,
  e.property_name,
  h.id AS history_id,
  h.contract_revenue_amount AS existing_amount,
  h.contract_rate_basis AS existing_basis,
  h.contract_service_day AS existing_service_day,
  h.effective_from,
  h.effective_to,
  CASE
    WHEN h.effective_from < DATE '2026-01-01'
         AND (h.effective_to IS NULL OR h.effective_to >= DATE '2026-01-01')
      THEN 'Existing history overlaps the requested 2026-01-01 start date'
    WHEN h.effective_from = DATE '2026-01-01'
         AND (
           h.contract_revenue_amount IS DISTINCT FROM e.contract_revenue_amount
           OR h.contract_rate_basis IS DISTINCT FROM e.contract_rate_basis
           OR h.contract_service_day IS DISTINCT FROM e.contract_service_day
         )
      THEN 'Existing 2026-01-01 row conflicts with current property terms'
    WHEN h.effective_from > DATE '2026-01-01'
         AND (
           h.contract_revenue_amount IS DISTINCT FROM e.contract_revenue_amount
           OR h.contract_rate_basis IS DISTINCT FROM e.contract_rate_basis
           OR h.contract_service_day IS DISTINCT FROM e.contract_service_day
         )
      THEN 'Later history has different terms; historical coverage requires review'
  END AS conflict_reason
FROM contract_backfill_eligible e
JOIN property_contract_revenue_history h
  ON h.property_id = e.property_id
WHERE (
    h.effective_from < DATE '2026-01-01'
    AND (h.effective_to IS NULL OR h.effective_to >= DATE '2026-01-01')
  )
  OR (
    h.effective_from = DATE '2026-01-01'
    AND (
      h.contract_revenue_amount IS DISTINCT FROM e.contract_revenue_amount
      OR h.contract_rate_basis IS DISTINCT FROM e.contract_rate_basis
      OR h.contract_service_day IS DISTINCT FROM e.contract_service_day
    )
  )
  OR (
    h.effective_from > DATE '2026-01-01'
    AND (
      h.contract_revenue_amount IS DISTINCT FROM e.contract_revenue_amount
      OR h.contract_rate_basis IS DISTINCT FROM e.contract_rate_basis
      OR h.contract_service_day IS DISTINCT FROM e.contract_service_day
    )
  );

CREATE TEMP TABLE contract_backfill_proposed ON COMMIT DROP AS
SELECT
  e.property_id,
  e.property_name,
  e.contract_revenue_amount,
  e.contract_rate_basis,
  e.contract_service_day,
  DATE '2026-01-01' AS effective_from,
  (
    SELECT MIN(h.effective_from) - 1
    FROM property_contract_revenue_history h
    WHERE h.property_id = e.property_id
      AND h.effective_from > DATE '2026-01-01'
  ) AS effective_to
FROM contract_backfill_eligible e
WHERE NOT EXISTS (
  SELECT 1
  FROM property_contract_revenue_history h
  WHERE h.property_id = e.property_id
    AND h.effective_from = DATE '2026-01-01'
    AND h.contract_revenue_amount IS NOT DISTINCT FROM e.contract_revenue_amount
    AND h.contract_rate_basis IS NOT DISTINCT FROM e.contract_rate_basis
    AND h.contract_service_day IS NOT DISTINCT FROM e.contract_service_day
);

-- Preview 1: properties eligible under the current property configuration.
SELECT
  property_name,
  contract_revenue_amount,
  contract_rate_basis,
  contract_service_day
FROM contract_backfill_eligible
ORDER BY property_name;

-- Preview 2: conflicts. The transaction aborts below when this returns rows.
SELECT
  property_name,
  history_id,
  existing_amount,
  existing_basis,
  existing_service_day,
  effective_from,
  effective_to,
  conflict_reason
FROM contract_backfill_conflicts
ORDER BY property_name, effective_from;

-- Preview 3: exact rows proposed for insertion.
SELECT
  property_name,
  contract_revenue_amount,
  contract_rate_basis,
  contract_service_day,
  effective_from,
  effective_to
FROM contract_backfill_proposed
ORDER BY property_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM contract_backfill_conflicts) THEN
    RAISE EXCEPTION
      'Contract history backfill aborted: conflicting history exists. Review the conflict preview; no rows were inserted.';
  END IF;
END;
$$;

INSERT INTO property_contract_revenue_history (
  property_id,
  contract_revenue_amount,
  contract_rate_basis,
  contract_service_day,
  effective_from,
  effective_to
)
SELECT
  property_id,
  contract_revenue_amount,
  contract_rate_basis,
  contract_service_day,
  effective_from,
  effective_to
FROM contract_backfill_proposed
ON CONFLICT (property_id, effective_from) DO NOTHING;

-- Final verification. Each eligible property should have a 2026-01-01 row.
SELECT
  e.property_name,
  h.id AS history_id,
  h.contract_revenue_amount,
  h.contract_rate_basis,
  h.contract_service_day,
  h.effective_from,
  h.effective_to
FROM contract_backfill_eligible e
JOIN property_contract_revenue_history h
  ON h.property_id = e.property_id
WHERE h.effective_from = DATE '2026-01-01'
ORDER BY e.property_name;

COMMIT;
