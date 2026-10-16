-- VP² Phase 2: generate idempotent weekly and reservation-checkout reviews.
-- Run manually after supabase_setup_vp2_core.sql and before deploying sync-ical.
BEGIN;

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS vp2_start_date DATE;

UPDATE public.properties
SET vp2_start_date = (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::DATE
WHERE vp2_start_date IS NULL;

ALTER TABLE public.properties
  ALTER COLUMN vp2_start_date SET DEFAULT ((CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::DATE),
  ALTER COLUMN vp2_start_date SET NOT NULL;

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
      OR NEW.vp2_additional_review_price IS DISTINCT FROM 15.00
      OR NEW.vp2_start_date IS DISTINCT FROM ((CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::DATE) THEN
      RAISE EXCEPTION 'Admin access required to configure VP² properties' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.vp2_enabled IS DISTINCT FROM OLD.vp2_enabled
    OR NEW.vp2_service_day IS DISTINCT FROM OLD.vp2_service_day
    OR NEW.vp2_week_start_day IS DISTINCT FROM OLD.vp2_week_start_day
    OR NEW.vp2_first_review_price IS DISTINCT FROM OLD.vp2_first_review_price
    OR NEW.vp2_additional_review_price IS DISTINCT FROM OLD.vp2_additional_review_price
    OR NEW.vp2_start_date IS DISTINCT FROM OLD.vp2_start_date THEN
    RAISE EXCEPTION 'Admin access required to configure VP² properties' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

CREATE INDEX IF NOT EXISTS reservations_vp2_checkout_lookup_idx
  ON public.reservations(property_id, check_out)
  WHERE source = 'ical';

CREATE OR REPLACE FUNCTION public.admin_sync_vp2_reviews(target_property_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  property_row public.properties%ROWTYPE;
  reservation_row RECORD;
  business_today DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::DATE;
  week_start_iso INTEGER;
  service_day_iso INTEGER;
  current_week_start DATE;
  start_week_start DATE;
  week_date DATE;
  schedule_through_date DATE;
  latest_checkout_date DATE;
  checkout_week_start DATE;
  checkout_identity_key TEXT;
  baseline_service_date DATE;
  service_week_cancelled BOOLEAN;
  checkout_review_exists BOOLEAN;
  weekly_review_exists BOOLEAN;
  affected_count INTEGER;
  checkout_reviews_created INTEGER := 0;
  weekly_reviews_created INTEGER := 0;
  weekly_reviews_superseded INTEGER := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT public.is_active_app_admin() THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  FOR property_row IN
    SELECT property.*
    FROM public.properties property
    WHERE property.vp2_enabled = true
      AND property.active IS DISTINCT FROM false
      AND (target_property_id IS NULL OR property.id = target_property_id)
    ORDER BY property.id
    FOR UPDATE
  LOOP
    week_start_iso := CASE COALESCE(property_row.vp2_week_start_day, 'Monday')
      WHEN 'Monday' THEN 1 WHEN 'Tuesday' THEN 2 WHEN 'Wednesday' THEN 3
      WHEN 'Thursday' THEN 4 WHEN 'Friday' THEN 5 WHEN 'Saturday' THEN 6
      ELSE 7
    END;
    service_day_iso := CASE COALESCE(property_row.vp2_service_day, 'Wednesday')
      WHEN 'Monday' THEN 1 WHEN 'Tuesday' THEN 2 WHEN 'Wednesday' THEN 3
      WHEN 'Thursday' THEN 4 WHEN 'Friday' THEN 5 WHEN 'Saturday' THEN 6
      ELSE 7
    END;

    current_week_start := business_today - (
      (EXTRACT(ISODOW FROM business_today)::INTEGER - week_start_iso + 7) % 7
    );
    start_week_start := property_row.vp2_start_date - (
      (EXTRACT(ISODOW FROM property_row.vp2_start_date)::INTEGER - week_start_iso + 7) % 7
    );

    SELECT max(reservation.check_out)
    INTO latest_checkout_date
    FROM public.reservations reservation
    WHERE reservation.property_id = property_row.id
      AND reservation.source = 'ical'
      AND COALESCE(reservation.status, 'active') <> 'cancelled'
      AND reservation.check_out >= GREATEST(business_today, property_row.vp2_start_date);

    -- Keep at least four weeks of weekly reviews queued, extending through the latest known checkout.
    schedule_through_date := GREATEST(
      business_today + 28,
      COALESCE(latest_checkout_date, business_today + 28),
      property_row.vp2_start_date + 28
    );

    UPDATE public.vp2_reviews review
    SET status = 'cancelled',
        attention_reason = 'Before VP² service start date.',
        updated_at = now()
    WHERE review.property_id = property_row.id
      AND review.scheduled_date < property_row.vp2_start_date
      AND (
        review.status = 'scheduled'
        OR (review.status = 'needs_attention' AND review.attention_reason = 'Checkout review is overdue.')
      );

    UPDATE public.vp2_reviews review
    SET status = 'cancelled',
        attention_reason = 'Reservation was cancelled or removed from iCal.',
        updated_at = now()
    WHERE review.property_id = property_row.id
      AND review.review_kind = 'checkout'
      AND (
        review.status = 'scheduled'
        OR (review.status = 'needs_attention' AND review.attention_reason = 'Checkout review is overdue.')
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.reservations reservation
        WHERE reservation.id = review.reservation_id
          AND reservation.property_id = property_row.id
          AND reservation.source = 'ical'
          AND COALESCE(reservation.status, 'active') <> 'cancelled'
          AND reservation.check_out >= property_row.vp2_start_date
      );

    FOR reservation_row IN
      SELECT reservation.id, reservation.check_in, reservation.check_out, reservation.reservation_uid
      FROM public.reservations reservation
      WHERE reservation.property_id = property_row.id
        AND reservation.source = 'ical'
        AND COALESCE(reservation.status, 'active') <> 'cancelled'
        AND reservation.check_out >= property_row.vp2_start_date
      ORDER BY reservation.check_out, reservation.id
    LOOP
      checkout_identity_key := CASE
        WHEN NULLIF(trim(reservation_row.reservation_uid), '') IS NOT NULL
          THEN 'uid:' || trim(reservation_row.reservation_uid)
        ELSE 'date:' || reservation_row.check_in::TEXT || '|' || reservation_row.check_out::TEXT
      END;
      checkout_week_start := reservation_row.check_out - (
        (EXTRACT(ISODOW FROM reservation_row.check_out)::INTEGER - week_start_iso + 7) % 7
      );

      SELECT EXISTS (
        SELECT 1
        FROM public.vp2_reviews review
        WHERE review.property_id = property_row.id
          AND review.review_kind = 'checkout'
          AND review.reservation_identity_key = checkout_identity_key
      ) INTO checkout_review_exists;

      INSERT INTO public.vp2_reviews (
        property_id,
        review_kind,
        service_week_start_date,
        scheduled_date,
        reservation_id,
        reservation_identity_key,
        status,
        attention_reason
      ) VALUES (
        property_row.id,
        'checkout',
        checkout_week_start,
        reservation_row.check_out,
        reservation_row.id,
        checkout_identity_key,
        CASE WHEN reservation_row.check_out < business_today THEN 'needs_attention' ELSE 'scheduled' END,
        CASE WHEN reservation_row.check_out < business_today THEN 'Checkout review is overdue.' ELSE NULL END
      )
      ON CONFLICT (property_id, reservation_identity_key) WHERE review_kind = 'checkout'
      DO UPDATE SET
        reservation_id = EXCLUDED.reservation_id,
        service_week_start_date = CASE
          WHEN vp2_reviews.status IN ('scheduled', 'cancelled')
            OR (vp2_reviews.status = 'needs_attention' AND vp2_reviews.attention_reason = 'Checkout review is overdue.')
            THEN EXCLUDED.service_week_start_date
          ELSE vp2_reviews.service_week_start_date
        END,
        scheduled_date = CASE
          WHEN vp2_reviews.status IN ('scheduled', 'cancelled')
            OR (vp2_reviews.status = 'needs_attention' AND vp2_reviews.attention_reason = 'Checkout review is overdue.')
            THEN EXCLUDED.scheduled_date
          ELSE vp2_reviews.scheduled_date
        END,
        status = CASE
          WHEN vp2_reviews.status IN ('scheduled', 'cancelled')
            OR (vp2_reviews.status = 'needs_attention' AND vp2_reviews.attention_reason = 'Checkout review is overdue.')
            THEN CASE WHEN EXCLUDED.scheduled_date < business_today THEN 'needs_attention' ELSE 'scheduled' END
          ELSE vp2_reviews.status
        END,
        attention_reason = CASE
          WHEN vp2_reviews.status IN ('scheduled', 'cancelled')
            OR (vp2_reviews.status = 'needs_attention' AND vp2_reviews.attention_reason = 'Checkout review is overdue.')
            THEN CASE WHEN EXCLUDED.scheduled_date < business_today THEN 'Checkout review is overdue.' ELSE NULL END
          ELSE vp2_reviews.attention_reason
        END,
        updated_at = CASE
          WHEN vp2_reviews.status IN ('scheduled', 'cancelled')
            OR (vp2_reviews.status = 'needs_attention' AND vp2_reviews.attention_reason = 'Checkout review is overdue.')
            THEN now()
          ELSE vp2_reviews.updated_at
        END;

      IF NOT checkout_review_exists THEN
        checkout_reviews_created := checkout_reviews_created + 1;
      END IF;
    END LOOP;

    UPDATE public.vp2_reviews weekly_review
    SET status = 'cancelled',
        attention_reason = 'Replaced by checkout review for this service week.',
        updated_at = now()
    WHERE weekly_review.property_id = property_row.id
      AND weekly_review.review_kind = 'weekly'
      AND weekly_review.status = 'scheduled'
      AND EXISTS (
        SELECT 1
        FROM public.vp2_reviews checkout_review
        WHERE checkout_review.property_id = property_row.id
          AND checkout_review.review_kind = 'checkout'
          AND checkout_review.service_week_start_date = weekly_review.service_week_start_date
          AND checkout_review.status <> 'cancelled'
      );
    GET DIAGNOSTICS affected_count = ROW_COUNT;
    weekly_reviews_superseded := weekly_reviews_superseded + affected_count;

    week_date := GREATEST(current_week_start, start_week_start);
    WHILE week_date <= schedule_through_date LOOP
      SELECT EXISTS (
        SELECT 1
        FROM public.vp2_reviews review
        WHERE review.property_id = property_row.id
          AND review.service_week_start_date = week_date
          AND review.status = 'cancelled'
          AND review.attention_reason = 'Cancelled by Admin.'
      ) INTO service_week_cancelled;

      IF service_week_cancelled THEN
        week_date := week_date + 7;
        CONTINUE;
      END IF;

      SELECT EXISTS (
        SELECT 1
        FROM public.vp2_reviews review
        WHERE review.property_id = property_row.id
          AND review.review_kind = 'checkout'
          AND review.service_week_start_date = week_date
          AND review.status <> 'cancelled'
      ) INTO checkout_review_exists;

      IF checkout_review_exists THEN
        UPDATE public.vp2_reviews weekly_review
        SET status = 'cancelled',
            attention_reason = 'Replaced by checkout review for this service week.',
            updated_at = now()
        WHERE weekly_review.property_id = property_row.id
          AND weekly_review.review_kind = 'weekly'
          AND weekly_review.service_week_start_date = week_date
          AND weekly_review.status = 'scheduled';
        GET DIAGNOSTICS affected_count = ROW_COUNT;
        weekly_reviews_superseded := weekly_reviews_superseded + affected_count;
      ELSE
        baseline_service_date := GREATEST(
          week_date + ((service_day_iso - week_start_iso + 7) % 7),
          property_row.vp2_start_date
        );

        SELECT EXISTS (
          SELECT 1
          FROM public.vp2_reviews review
          WHERE review.property_id = property_row.id
            AND review.review_kind = 'weekly'
            AND review.service_week_start_date = week_date
        ) INTO weekly_review_exists;

        INSERT INTO public.vp2_reviews (
          property_id,
          review_kind,
          service_week_start_date,
          scheduled_date,
          status,
          attention_reason
        ) VALUES (
          property_row.id,
          'weekly',
          week_date,
          baseline_service_date,
          'scheduled',
          NULL
        )
        ON CONFLICT (property_id, service_week_start_date) WHERE review_kind = 'weekly'
        DO UPDATE SET
          scheduled_date = CASE
            WHEN vp2_reviews.status = 'scheduled'
              OR (vp2_reviews.status = 'cancelled'
                AND vp2_reviews.attention_reason IN (
                  'Replaced by checkout review for this service week.',
                  'Before VP² service start date.'
                ))
              THEN EXCLUDED.scheduled_date
            ELSE vp2_reviews.scheduled_date
          END,
          status = CASE
            WHEN vp2_reviews.status = 'cancelled'
              AND vp2_reviews.attention_reason IN (
                'Replaced by checkout review for this service week.',
                'Before VP² service start date.'
              )
              THEN 'scheduled'
            ELSE vp2_reviews.status
          END,
          attention_reason = CASE
            WHEN vp2_reviews.status = 'cancelled'
              AND vp2_reviews.attention_reason IN (
                'Replaced by checkout review for this service week.',
                'Before VP² service start date.'
              )
              THEN NULL
            ELSE vp2_reviews.attention_reason
          END,
          updated_at = CASE
            WHEN vp2_reviews.status = 'scheduled'
              OR (vp2_reviews.status = 'cancelled'
                AND vp2_reviews.attention_reason IN (
                  'Replaced by checkout review for this service week.',
                  'Before VP² service start date.'
                ))
              THEN now()
            ELSE vp2_reviews.updated_at
          END;

        IF NOT weekly_review_exists THEN
          weekly_reviews_created := weekly_reviews_created + 1;
        END IF;
      END IF;

      week_date := week_date + 7;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'checkout_reviews_created', checkout_reviews_created,
    'weekly_reviews_created', weekly_reviews_created,
    'weekly_reviews_superseded', weekly_reviews_superseded
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_sync_vp2_reviews(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_sync_vp2_reviews(UUID) TO authenticated, service_role;

COMMIT;