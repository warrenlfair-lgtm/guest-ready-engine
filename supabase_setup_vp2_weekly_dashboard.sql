-- VP² dashboard weekly view with browsable completed-review history.
-- Run manually after supabase_setup_vp2_action_plans.sql.
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_get_vp2_dashboard_for_week(
  target_week_start_date DATE,
  target_week_end_date DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.is_active_app_admin() THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;
  IF target_week_start_date IS NULL
    OR target_week_end_date IS NULL
    OR target_week_end_date < target_week_start_date
    OR target_week_end_date > target_week_start_date + 6 THEN
    RAISE EXCEPTION 'A valid one-week date range is required' USING ERRCODE = '22023';
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
        AND property.active IS DISTINCT FROM false
        AND review.scheduled_date BETWEEN target_week_start_date AND target_week_end_date
        AND review.scheduled_date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::DATE
        AND review.status IN ('scheduled', 'in_progress')
        AND review.attention_reason IS NULL
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
        AND property.active IS DISTINCT FROM false
        AND review.scheduled_date BETWEEN target_week_start_date AND target_week_end_date
        AND review.status NOT IN ('completed', 'cancelled')
        AND (
          review.status = 'needs_attention'
          OR review.attention_reason IS NOT NULL
          OR review.scheduled_date < (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::DATE
        )
    ), '[]'::jsonb),
    'actionPlans', '[]'::jsonb,
    'openWorkOrders', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', item.id,
        'property_name', item.property_name,
        'technician_name', item.technician_name,
        'status', item.status,
        'due_date', item.due_date
      ) ORDER BY item.due_date, item.property_name)
      FROM (
        SELECT DISTINCT ON (
          work_order.property_id,
          COALESCE(work_order.due_date, review.scheduled_date)
        )
          work_order.id,
          property.property_name,
          technician.name AS technician_name,
          work_order.status,
          COALESCE(work_order.due_date, review.scheduled_date) AS due_date
        FROM public.vp2_work_orders work_order
        JOIN public.vp2_reviews review ON review.id = work_order.review_id
        JOIN public.properties property ON property.id = work_order.property_id
        LEFT JOIN public.technicians technician ON technician.id = work_order.technician_id
        WHERE property.vp2_enabled = true
          AND property.active IS DISTINCT FROM false
          AND review.scheduled_date BETWEEN target_week_start_date AND target_week_end_date
          AND review.status IS DISTINCT FROM 'cancelled'
          AND work_order.status IN ('assigned', 'confirmed', 'in_progress')
        ORDER BY
          work_order.property_id,
          COALESCE(work_order.due_date, review.scheduled_date),
          CASE work_order.status
            WHEN 'in_progress' THEN 1
            WHEN 'confirmed' THEN 2
            ELSE 3
          END,
          work_order.updated_at DESC,
          work_order.created_at DESC
      ) item
    ), '[]'::jsonb),
    'completedReviews', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', review.id,
        'property_name', property.property_name,
        'review_kind', review.review_kind,
        'scheduled_date', review.scheduled_date,
        'completed_at', review.completed_at
      ) ORDER BY review.completed_at DESC NULLS LAST, property.property_name)
      FROM public.vp2_reviews review
      JOIN public.properties property ON property.id = review.property_id
      WHERE property.vp2_enabled = true
        AND review.status = 'completed'
        AND review.completed_at IS NOT NULL
        AND (review.completed_at AT TIME ZONE 'America/New_York')::DATE BETWEEN target_week_start_date AND target_week_end_date
    ), '[]'::jsonb),
    'completedThisWeekCount', (
      SELECT count(*)
      FROM public.vp2_reviews review
      JOIN public.properties property ON property.id = review.property_id
      WHERE property.vp2_enabled = true
        AND review.status = 'completed'
        AND review.completed_at IS NOT NULL
        AND (review.completed_at AT TIME ZONE 'America/New_York')::DATE BETWEEN target_week_start_date AND target_week_end_date
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

CREATE OR REPLACE FUNCTION public.admin_list_vp2_action_plans_for_week(
  target_week_start_date DATE,
  target_week_end_date DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  plans JSONB;
BEGIN
  IF NOT public.is_active_app_admin() THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;
  IF target_week_start_date IS NULL
    OR target_week_end_date IS NULL
    OR target_week_end_date < target_week_start_date
    OR target_week_end_date > target_week_start_date + 6 THEN
    RAISE EXCEPTION 'A valid one-week date range is required' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', plan.id,
    'review_id', plan.review_id,
    'property_name', property.property_name,
    'scheduled_date', review.scheduled_date,
    'status', plan.status,
    'summary', plan.summary,
    'updated_at', plan.updated_at,
    'active_link', EXISTS (
      SELECT 1
      FROM public.vp2_action_plan_links link
      WHERE link.action_plan_id = plan.id
        AND link.revoked_at IS NULL
        AND link.expires_at > now()
    )
  ) ORDER BY review.scheduled_date DESC, plan.updated_at DESC), '[]'::jsonb)
  INTO plans
  FROM public.vp2_action_plans plan
  JOIN public.properties property ON property.id = plan.property_id
  JOIN public.vp2_reviews review ON review.id = plan.review_id
  WHERE property.vp2_enabled = true
    AND property.active IS DISTINCT FROM false
    AND review.scheduled_date BETWEEN target_week_start_date AND target_week_end_date
    AND review.status NOT IN ('completed', 'cancelled')
    AND plan.status IN ('draft', 'sent');

  RETURN plans;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_vp2_dashboard_for_week(DATE, DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_vp2_action_plans_for_week(DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_vp2_dashboard_for_week(DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_vp2_action_plans_for_week(DATE, DATE) TO authenticated;

COMMIT;
