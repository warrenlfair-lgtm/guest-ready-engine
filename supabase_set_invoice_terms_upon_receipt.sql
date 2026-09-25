-- Set Upon Receipt as the default invoice terms for every property account.
-- Existing finalized, sent, paid, and void invoices retain their historical terms.

BEGIN;

ALTER TABLE public.properties
ADD COLUMN IF NOT EXISTS payment_terms TEXT;

ALTER TABLE public.properties
ALTER COLUMN payment_terms SET DEFAULT 'Upon Receipt';

ALTER TABLE public.properties
DROP CONSTRAINT IF EXISTS properties_payment_terms_check;

ALTER TABLE public.invoices
ADD COLUMN IF NOT EXISTS payment_terms TEXT;

ALTER TABLE public.invoices
ALTER COLUMN payment_terms SET DEFAULT 'Upon Receipt';

UPDATE public.properties
SET payment_terms = 'Upon Receipt'
WHERE payment_terms IS DISTINCT FROM 'Upon Receipt';

ALTER TABLE public.properties
ADD CONSTRAINT properties_payment_terms_check
CHECK (payment_terms IN ('Upon Receipt', 'Custom Date'));

UPDATE public.invoices
SET payment_terms = 'Upon Receipt',
    due_date = invoice_date
WHERE status = 'draft'
  AND (
    payment_terms IS NULL
    OR BTRIM(payment_terms) = ''
    OR LOWER(BTRIM(payment_terms)) = 'net 15'
  );

COMMIT;
