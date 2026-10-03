-- Stores the iCal "Number of Guests" value on each reservation.
-- Run in the Supabase SQL Editor BEFORE deploying the updated sync-ical Edge Function.

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS guest_count INTEGER;

CREATE OR REPLACE VIEW public.manager_reservations
WITH (security_barrier = true, security_invoker = false)
AS
SELECT id, property_id, check_in, check_out, status, guest_count
FROM public.reservations
WHERE public.is_active_app_manager() OR public.is_active_app_admin();
ALTER VIEW public.manager_reservations OWNER TO postgres;
