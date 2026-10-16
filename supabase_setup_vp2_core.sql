-- VP² Phase 1 foundation: property enrollment, dashboard data, and role-checked reads.
-- Run manually in the Supabase SQL Editor after role-based access and technician setup.
-- This file does not schedule reviews or create invoice items.
BEGIN;

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS vp2_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS vp2_service_day TEXT NOT NULL DEFAULT 'Wednesday'
    CHECK (vp2_service_day IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')),
  ADD COLUMN IF NOT EXISTS vp2_week_start_day TEXT NOT NULL DEFAULT 'Monday'
    CHECK (vp2_week_start_day IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')),
  ADD COLUMN IF NOT EXISTS vp2_first_review_price NUMERIC(12,2) NOT NULL DEFAULT 25.00
    CHECK (vp2_first_review_price >= 0),
  ADD COLUMN IF NOT EXISTS vp2_additional_review_price NUMERIC(12,2) NOT NULL DEFAULT 15.00
    CHECK (vp2_additional_review_price >= 0);

CREATE INDEX IF NOT EXISTS properties_vp2_enabled_idx
  ON public.properties(id) WHERE vp2_enabled = true;

CREATE TABLE IF NOT EXISTS public.vp2_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE RESTRICT,
  review_kind TEXT NOT NULL CHECK (review_kind IN ('weekly', 'checkout')),
  service_week_start_date DATE NOT NULL,
  scheduled_date DATE NOT NULL,
  reservation_id UUID REFERENCES public.reservations(id) ON DELETE SET NULL,
  reservation_identity_key TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'needs_attention', 'in_progress', 'completed', 'cancelled')),
  attention_reason TEXT,
  assigned_technician_id UUID REFERENCES public.technicians(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT vp2_reviews_reservation_identity_check CHECK (
    (review_kind = 'weekly' AND reservation_identity_key IS NULL)
    OR (review_kind = 'checkout' AND reservation_identity_key IS NOT NULL AND trim(reservation_identity_key) <> '')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS vp2_reviews_one_weekly_per_property_uidx
  ON public.vp2_reviews(property_id, service_week_start_date)
  WHERE review_kind = 'weekly';
CREATE UNIQUE INDEX IF NOT EXISTS vp2_reviews_one_checkout_identity_uidx
  ON public.vp2_reviews(property_id, reservation_identity_key)
  WHERE review_kind = 'checkout';
CREATE INDEX IF NOT EXISTS vp2_reviews_schedule_idx
  ON public.vp2_reviews(scheduled_date, status);
CREATE INDEX IF NOT EXISTS vp2_reviews_property_idx
  ON public.vp2_reviews(property_id, scheduled_date DESC);

CREATE TABLE IF NOT EXISTS public.vp2_chemistry_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE RESTRICT,
  review_id UUID REFERENCES public.vp2_reviews(id) ON DELETE SET NULL,
  free_chlorine NUMERIC(8,3),
  ph NUMERIC(6,3),
  total_alkalinity NUMERIC(8,2),
  water_temperature NUMERIC(6,2),
  water_temperature_unit TEXT NOT NULL DEFAULT 'F' CHECK (water_temperature_unit IN ('F', 'C')),
  measured_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('device_reading', 'manual_entry', 'technician_verified')),
  source_provider TEXT,
  device_connection_status TEXT,
  entered_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vp2_chemistry_readings_property_measured_idx
  ON public.vp2_chemistry_readings(property_id, measured_at DESC);
CREATE INDEX IF NOT EXISTS vp2_chemistry_readings_review_idx
  ON public.vp2_chemistry_readings(review_id) WHERE review_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.vp2_action_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE RESTRICT,
  review_id UUID NOT NULL REFERENCES public.vp2_reviews(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'awaiting_approval', 'approved', 'sent', 'completed', 'rejected')),
  summary TEXT,
  plan_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vp2_action_plans_approval_idx
  ON public.vp2_action_plans(status, created_at DESC);
CREATE INDEX IF NOT EXISTS vp2_action_plans_property_idx
  ON public.vp2_action_plans(property_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.vp2_work_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id UUID NOT NULL UNIQUE REFERENCES public.vp2_reviews(id) ON DELETE RESTRICT,
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE RESTRICT,
  action_plan_id UUID REFERENCES public.vp2_action_plans(id) ON DELETE SET NULL,
  technician_id UUID REFERENCES public.technicians(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'assigned'
    CHECK (status IN ('assigned', 'confirmed', 'in_progress', 'completed', 'cancelled')),
  due_date DATE,
  technician_confirmed_at TIMESTAMPTZ,
  water_test_results JSONB NOT NULL DEFAULT '{}'::jsonb,
  chemical_additions JSONB NOT NULL DEFAULT '[]'::jsonb,
  work_performed TEXT,
  notes TEXT,
  photographs JSONB NOT NULL DEFAULT '[]'::jsonb,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vp2_work_orders_technician_status_idx
  ON public.vp2_work_orders(technician_id, status);
CREATE INDEX IF NOT EXISTS vp2_work_orders_property_idx
  ON public.vp2_work_orders(property_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.vp2_review_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id UUID NOT NULL UNIQUE REFERENCES public.vp2_reviews(id) ON DELETE RESTRICT,
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE RESTRICT,
  service_week_start_date DATE NOT NULL,
  service_date DATE NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'invoiced', 'void')),
  invoice_item_id UUID,
  invoiced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vp2_review_charges_property_date_idx
  ON public.vp2_review_charges(property_id, service_date DESC);
CREATE INDEX IF NOT EXISTS vp2_review_charges_pending_idx
  ON public.vp2_review_charges(service_date, status) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.vp2_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID REFERENCES public.properties(id) ON DELETE CASCADE,
  review_id UUID REFERENCES public.vp2_reviews(id) ON DELETE CASCADE,
  action_plan_id UUID REFERENCES public.vp2_action_plans(id) ON DELETE CASCADE,
  work_order_id UUID REFERENCES public.vp2_work_orders(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'new_checkout_review', 'chemistry_out_of_range', 'reading_missing',
    'action_plan_awaiting_approval', 'technician_assignment', 'review_overdue',
    'work_order_completed'
  )),
  title TEXT NOT NULL,
  message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vp2_notifications_unread_idx
  ON public.vp2_notifications(created_at DESC) WHERE read_at IS NULL;

ALTER TABLE public.vp2_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vp2_chemistry_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vp2_action_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vp2_work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vp2_review_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vp2_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vp2_reviews_admin_select ON public.vp2_reviews;
CREATE POLICY vp2_reviews_admin_select ON public.vp2_reviews
  FOR SELECT TO authenticated USING (public.is_active_app_admin());
DROP POLICY IF EXISTS vp2_chemistry_readings_admin_select ON public.vp2_chemistry_readings;
CREATE POLICY vp2_chemistry_readings_admin_select ON public.vp2_chemistry_readings
  FOR SELECT TO authenticated USING (public.is_active_app_admin());
DROP POLICY IF EXISTS vp2_action_plans_admin_select ON public.vp2_action_plans;
CREATE POLICY vp2_action_plans_admin_select ON public.vp2_action_plans
  FOR SELECT TO authenticated USING (public.is_active_app_admin());
DROP POLICY IF EXISTS vp2_work_orders_admin_select ON public.vp2_work_orders;
CREATE POLICY vp2_work_orders_admin_select ON public.vp2_work_orders
  FOR SELECT TO authenticated USING (public.is_active_app_admin());
DROP POLICY IF EXISTS vp2_review_charges_admin_select ON public.vp2_review_charges;
CREATE POLICY vp2_review_charges_admin_select ON public.vp2_review_charges
  FOR SELECT TO authenticated USING (public.is_active_app_admin());
DROP POLICY IF EXISTS vp2_notifications_admin_select ON public.vp2_notifications;
CREATE POLICY vp2_notifications_admin_select ON public.vp2_notifications
  FOR SELECT TO authenticated USING (public.is_active_app_admin());

REVOKE ALL ON TABLE public.vp2_reviews FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.vp2_chemistry_readings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.vp2_action_plans FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.vp2_work_orders FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.vp2_review_charges FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.vp2_notifications FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_vp2_property_settings()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF public.is_active_app_admin() OR auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.vp2_enabled IS DISTINCT FROM false
      OR NEW.vp2_service_day IS DISTINCT FROM 'Wednesday'
      OR NEW.vp2_week_start_day IS DISTINCT FROM 'Monday'
      OR NEW.vp2_first_review_price IS DISTINCT FROM 25.00
      OR NEW.vp2_additional_review_price IS DISTINCT FROM 15.00 THEN
      RAISE EXCEPTION 'Admin access required to configure VP² properties' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.vp2_enabled IS DISTINCT FROM OLD.vp2_enabled
    OR NEW.vp2_service_day IS DISTINCT FROM OLD.vp2_service_day
    OR NEW.vp2_week_start_day IS DISTINCT FROM OLD.vp2_week_start_day
    OR NEW.vp2_first_review_price IS DISTINCT FROM OLD.vp2_first_review_price
    OR NEW.vp2_additional_review_price IS DISTINCT FROM OLD.vp2_additional_review_price THEN
    RAISE EXCEPTION 'Admin access required to configure VP² properties' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS properties_guard_vp2_settings ON public.properties;
CREATE TRIGGER properties_guard_vp2_settings
BEFORE INSERT OR UPDATE ON public.properties
FOR EACH ROW EXECUTE FUNCTION public.guard_vp2_property_settings();
REVOKE ALL ON FUNCTION public.guard_vp2_property_settings() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_vp2_dashboard()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_active_app_admin() THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'enrolledProperties', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', property.id,
        'property_name', property.property_name,
        'address', property.address,
        'vp2_service_day', property.vp2_service_day,
        'vp2_week_start_day', property.vp2_week_start_day,
        'vp2_first_review_price', property.vp2_first_review_price,
        'vp2_additional_review_price', property.vp2_additional_review_price
      ) ORDER BY property.property_name)
      FROM public.properties property
      WHERE property.vp2_enabled = true AND property.active IS DISTINCT FROM false
    ), '[]'::jsonb),
    'latestReadings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'property_id', latest.property_id,
        'property_name', latest.property_name,
        'free_chlorine', latest.free_chlorine,
        'ph', latest.ph,
        'total_alkalinity', latest.total_alkalinity,
        'water_temperature', latest.water_temperature,
        'water_temperature_unit', latest.water_temperature_unit,
        'measured_at', latest.measured_at,
        'source', latest.source,
        'device_connection_status', latest.device_connection_status
      ) ORDER BY latest.measured_at DESC)
      FROM (
        SELECT DISTINCT ON (reading.property_id)
          reading.property_id, property.property_name, reading.free_chlorine,
          reading.ph, reading.total_alkalinity, reading.water_temperature,
          reading.water_temperature_unit, reading.measured_at, reading.source,
          reading.device_connection_status
        FROM public.vp2_chemistry_readings reading
        JOIN public.properties property ON property.id = reading.property_id
        WHERE property.vp2_enabled = true AND property.active IS DISTINCT FROM false
        ORDER BY reading.property_id, reading.measured_at DESC, reading.created_at DESC
      ) latest
    ), '[]'::jsonb),
    'upcomingReviews', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', review.id,
        'property_name', property.property_name,
        'review_kind', review.review_kind,
        'scheduled_date', review.scheduled_date,
        'status', review.status,
        'attention_reason', review.attention_reason,
        'technician_name', technician.name
      ) ORDER BY review.scheduled_date, property.property_name)
      FROM public.vp2_reviews review
      JOIN public.properties property ON property.id = review.property_id
      LEFT JOIN public.technicians technician ON technician.id = review.assigned_technician_id
      WHERE property.vp2_enabled = true
        AND review.scheduled_date >= CURRENT_DATE
        AND review.status IN ('scheduled', 'needs_attention', 'in_progress')
    ), '[]'::jsonb),
    'attentionReviews', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', review.id,
        'property_name', property.property_name,
        'review_kind', review.review_kind,
        'scheduled_date', review.scheduled_date,
        'status', review.status,
        'attention_reason', review.attention_reason
      ) ORDER BY review.scheduled_date, property.property_name)
      FROM public.vp2_reviews review
      JOIN public.properties property ON property.id = review.property_id
      WHERE property.vp2_enabled = true
        AND review.status NOT IN ('completed', 'cancelled')
        AND (
          review.status = 'needs_attention'
          OR review.attention_reason IS NOT NULL
          OR review.scheduled_date < CURRENT_DATE
        )
    ), '[]'::jsonb),
    'awaitingPlans', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', plan.id,
        'property_name', property.property_name,
        'summary', plan.summary,
        'created_at', plan.created_at
      ) ORDER BY plan.created_at)
      FROM public.vp2_action_plans plan
      JOIN public.properties property ON property.id = plan.property_id
      WHERE property.vp2_enabled = true AND plan.status = 'awaiting_approval'
    ), '[]'::jsonb),
    'openWorkOrders', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', work_order.id,
        'property_name', property.property_name,
        'technician_name', technician.name,
        'status', work_order.status,
        'due_date', work_order.due_date
      ) ORDER BY work_order.due_date NULLS LAST, property.property_name)
      FROM public.vp2_work_orders work_order
      JOIN public.properties property ON property.id = work_order.property_id
      LEFT JOIN public.technicians technician ON technician.id = work_order.technician_id
      WHERE property.vp2_enabled = true
        AND work_order.status IN ('assigned', 'confirmed', 'in_progress')
    ), '[]'::jsonb),
    'completedReviews', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', recent.id,
        'property_name', recent.property_name,
        'review_kind', recent.review_kind,
        'scheduled_date', recent.scheduled_date,
        'completed_at', recent.completed_at
      ) ORDER BY recent.completed_at DESC)
      FROM (
        SELECT review.id, property.property_name, review.review_kind,
          review.scheduled_date, review.completed_at
        FROM public.vp2_reviews review
        JOIN public.properties property ON property.id = review.property_id
        WHERE property.vp2_enabled = true AND review.status = 'completed'
        ORDER BY review.completed_at DESC NULLS LAST
        LIMIT 20
      ) recent
    ), '[]'::jsonb),
    'completedThisMonthCount', (
      SELECT count(*)
      FROM public.vp2_reviews review
      JOIN public.properties property ON property.id = review.property_id
      WHERE property.vp2_enabled = true
        AND review.status = 'completed'
        AND review.completed_at >= date_trunc('month', CURRENT_DATE)::timestamptz
        AND review.completed_at < (date_trunc('month', CURRENT_DATE) + interval '1 month')::timestamptz
    ),
    'currentMonthRevenue', COALESCE((
      SELECT sum(charge.amount)
      FROM public.vp2_review_charges charge
      JOIN public.properties property ON property.id = charge.property_id
      WHERE property.vp2_enabled = true
        AND charge.status <> 'void'
        AND charge.service_date >= date_trunc('month', CURRENT_DATE)::date
        AND charge.service_date < (date_trunc('month', CURRENT_DATE) + interval '1 month')::date
    ), 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_vp2_dashboard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_vp2_dashboard() TO authenticated;

COMMIT;