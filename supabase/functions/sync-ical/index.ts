import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.");
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  global: {
    fetch: globalThis.fetch,
  },
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYNC_VERSION = "ical-source-reconciliation-v1";

function createErrorResponse(message: string, status: number) {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function isAuthorizedSyncCaller(req: Request) {
  const authorization = req.headers.get("Authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  if (token === supabaseKey) return true;

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user?.id) return false;

  const { data: roleRow, error: roleError } = await supabase
    .from("app_user_roles")
    .select("role, active")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  return !roleError && roleRow?.role === "admin" && roleRow?.active === true;
}

function createSuccessResponse(
  reservationsCreated = 0,
  tasksCreated = 0,
  extras: {
    reservationsParsed?: number;
    activeReservations?: number;
    oldIgnored?: number;
    reservationsUpdated?: number;
    reservationsRemoved?: number;
    weeklyTasksCreated?: number;
    guestReadyTasksCreated?: number;
    housekeepingTasksCreated?: number;
    housekeepingTasksUpdated?: number;
    staleTasksCancelled?: number;
    tasksRequiringReview?: number;
    protectedTasksPreserved?: number;
  } = {}
) {
  return new Response(JSON.stringify({
    success: true,
    syncVersion: SYNC_VERSION,
    reservationsCreated,
    tasksCreated,
    reservationsParsed: extras.reservationsParsed ?? 0,
    activeReservations: extras.activeReservations ?? 0,
    oldIgnored: extras.oldIgnored ?? 0,
    reservationsUpdated: extras.reservationsUpdated ?? 0,
    reservationsRemoved: extras.reservationsRemoved ?? 0,
    weeklyTasksCreated: extras.weeklyTasksCreated ?? 0,
    guestReadyTasksCreated: extras.guestReadyTasksCreated ?? 0,
    housekeepingTasksCreated: extras.housekeepingTasksCreated ?? 0,
    housekeepingTasksUpdated: extras.housekeepingTasksUpdated ?? 0,
    staleTasksCancelled: extras.staleTasksCancelled ?? 0,
    tasksRequiringReview: extras.tasksRequiringReview ?? 0,
    protectedTasksPreserved: extras.protectedTasksPreserved ?? 0,
  }), {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function parseICalReservations(icalText: string) {
  const unfolded = icalText.replace(/\r?\n[ \t]/g, "");
  const events = unfolded.split(/BEGIN:VEVENT/i).slice(1);
  const reservations: Array<{ check_in: string; check_out: string | null; summary: string | null; uid: string | null; cancelled: boolean }> = [];

  for (const eventText of events) {
    const checkInMatch = eventText.match(/DTSTART(?:;VALUE=DATE)?:(\d{8})(?:T\d{6}Z?)?/i);
    if (!checkInMatch) continue;

    const checkOutMatch = eventText.match(/DTEND(?:;VALUE=DATE)?:(\d{8})(?:T\d{6}Z?)?/i);
    const summaryMatch = eventText.match(/SUMMARY:(.*)/i);
    const uidMatch = eventText.match(/UID:(.*)/i);
    const statusMatch = eventText.match(/STATUS:(.*)/i);

    const check_in = `${checkInMatch[1].slice(0, 4)}-${checkInMatch[1].slice(4, 6)}-${checkInMatch[1].slice(6, 8)}`;
    const check_out = checkOutMatch
      ? `${checkOutMatch[1].slice(0, 4)}-${checkOutMatch[1].slice(4, 6)}-${checkOutMatch[1].slice(6, 8)}`
      : null;
    const summary = summaryMatch ? summaryMatch[1].trim() : null;
    const uid = uidMatch ? uidMatch[1].trim() || null : null;
    const cancelled = statusMatch ? /cancelled/i.test(statusMatch[1]) : false;
    reservations.push({ check_in, check_out, summary, uid, cancelled });
  }

  return reservations;
}

function parseTrustedICalReservations(icalText: string) {
  if (!/BEGIN:VCALENDAR/i.test(icalText) || !/END:VCALENDAR/i.test(icalText)) {
    throw new Error("The iCal response is not a complete VCALENDAR document.");
  }

  const eventCount = (icalText.match(/BEGIN:VEVENT/gi) || []).length;
  const reservations = parseICalReservations(icalText);
  if (reservations.length !== eventCount) {
    throw new Error(`The iCal response contained ${eventCount} event(s), but only ${reservations.length} could be parsed.`);
  }

  return reservations;
}

// Prefers the iCal UID as a stable identity; falls back to the check-in/check-out
// date pair for legacy rows imported before reservation_uid was captured.
function getReservationIdentityKey(reservation: { reservation_uid?: string | null; uid?: string | null; check_in: string; check_out: string | null }) {
  const uid = reservation.reservation_uid || reservation.uid || null;
  if (uid) return `uid:${uid}`;
  return `date:${reservation.check_in}|${reservation.check_out || ""}`;
}

function getHousekeepingSourceKey(
  propertyId: string,
  reservation: { reservation_uid?: string | null; uid?: string | null; check_in: string }
) {
  const uid = reservation.reservation_uid || reservation.uid || null;
  return uid
    ? `hk:${propertyId}:uid:${uid}`
    : `hk:${propertyId}:checkin:${reservation.check_in}`;
}

function getGuestReadySourceKey(
  propertyId: string,
  reservation: { reservation_uid?: string | null; uid?: string | null; check_in: string }
) {
  const uid = reservation.reservation_uid || reservation.uid || null;
  return uid
    ? `gr:${propertyId}:uid:${uid}`
    : `gr:${propertyId}:checkin:${reservation.check_in}`;
}

function parseDateString(dateString: string) {
  const [year, month, day] = dateString.split("-").map((part) => Number(part));
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(dateString: string, daysToAdd: number) {
  const date = parseDateString(dateString);
  date.setUTCDate(date.getUTCDate() + daysToAdd);
  return formatDate(date);
}

const SERVICE_FREQUENCY_WEEKLY = "weekly";
const SERVICE_FREQUENCY_BIWEEKLY = "bi_weekly";

function normalizeServiceFrequency(value: string | null | undefined) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === SERVICE_FREQUENCY_BIWEEKLY || normalized === "bi-weekly") {
    return SERVICE_FREQUENCY_BIWEEKLY;
  }
  return SERVICE_FREQUENCY_WEEKLY;
}

function normalizeDateKey(value: string | null | undefined) {
  const normalized = String(value || "").trim();
  const match = normalized.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

function isAutoTaskDateOnOrAfterPropertyStart(serviceDate: string, propertyStartDate: string) {
  const normalizedServiceDate = normalizeDateKey(serviceDate);
  const normalizedPropertyStartDate = normalizeDateKey(propertyStartDate);
  return Boolean(normalizedServiceDate) && (!normalizedPropertyStartDate || normalizedServiceDate >= normalizedPropertyStartDate);
}

function isDateOnBiweeklyCycle(serviceDate: string, anchorDate: string) {
  const normalizedServiceDate = normalizeDateKey(serviceDate);
  const normalizedAnchorDate = normalizeDateKey(anchorDate);
  if (!normalizedServiceDate || !normalizedAnchorDate) return false;

  const service = parseDateString(normalizedServiceDate);
  const anchor = parseDateString(normalizedAnchorDate);
  const diffDays = Math.round((service.getTime() - anchor.getTime()) / (1000 * 60 * 60 * 24));
  const mod = ((diffDays % 14) + 14) % 14;
  return mod === 0;
}

function getDayNumber(dayName: string) {
  const days: Record<string, number> = {
    Sunday: 0,
    Monday: 1,
    Tuesday: 2,
    Wednesday: 3,
    Thursday: 4,
    Friday: 5,
    Saturday: 6,
  };
  return days[dayName];
}

function getDayName(dateString: string) {
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const date = parseDateString(dateString);
  return dayNames[date.getUTCDay()];
}

function getServiceDateForWeek(checkInDateString: string, standardDay: string) {
  const checkInDate = parseDateString(checkInDateString);
  const standardDayNumber = getDayNumber(standardDay);
  if (standardDayNumber === undefined) {
    return checkInDateString;
  }

  const checkInDayNumber = checkInDate.getUTCDay();
  const startOfWeek = new Date(checkInDate);
  startOfWeek.setUTCDate(checkInDate.getUTCDate() - checkInDayNumber);

  const serviceDate = new Date(startOfWeek);
  serviceDate.setUTCDate(startOfWeek.getUTCDate() + standardDayNumber);
  return formatDate(serviceDate);
}

function normalizeCoverageRule(coverageRule: string | null | undefined, coverageDays: number | null | undefined) {
  const normalizedRule = String(coverageRule || "").toLowerCase();
  if (["none", "before", "after", "both"].includes(normalizedRule)) {
    return normalizedRule;
  }

  const numeric = Number(coverageDays);
  if (numeric === 0) return "none";
  if (numeric === 1) return "both";
  if (numeric > 1) return "both";
  return "both";
}

function getCoverageOffsetsForRule(coverageRule: string) {
  if (coverageRule === "none") return [0];
  if (coverageRule === "before") return [-1, 0];
  if (coverageRule === "after") return [0, 1];
  return [-1, 0, 1];
}

function getGuestReadyServiceDate(reservation: { check_in: string; check_out: string | null }) {
  return reservation.check_in;
}

function isDateWithinCoverageRule(serviceDate: string, candidateDate: string, coverageRule: string) {
  const service = parseDateString(serviceDate);
  const candidate = parseDateString(candidateDate);
  const dayDiff = Math.round((candidate.getTime() - service.getTime()) / (1000 * 60 * 60 * 24));
  return getCoverageOffsetsForRule(coverageRule).includes(dayDiff);
}

function isGuestReadyIncludedDay(serviceDate: string, standardDay: string, coverageRule: string) {
  const weeklyServiceDate = getServiceDateForWeek(serviceDate, standardDay);
  if (!weeklyServiceDate) {
    return false;
  }

  return isDateWithinCoverageRule(weeklyServiceDate, serviceDate, coverageRule);
}

function getGuestReadyCharge(serviceDate: string, standardDay: string, coverageRule: string, defaultOffCycleCharge: number | null) {
  if (isGuestReadyIncludedDay(serviceDate, standardDay, coverageRule)) {
    return 0;
  }
  return Number(defaultOffCycleCharge ?? 65);
}

function getWeeklyContractTaskAmount(
  weeklyServiceDate: string,
  configuredAmount: number | null,
  effectiveDate: string | null
) {
  const normalizedEffectiveDate = normalizeDateKey(effectiveDate);
  const normalizedServiceDate = normalizeDateKey(weeklyServiceDate);
  if (!normalizedEffectiveDate || !normalizedServiceDate || normalizedServiceDate < normalizedEffectiveDate) return 0;
  return Math.max(0, Number(configuredAmount || 0));
}

function isSafeAutoWeeklyTaskToSuppress(task: { manually_modified: boolean | null; status: string | null; completed_at: string | null; invoiced: boolean | null }) {
  const status = task.status || "Scheduled";
  return !task.manually_modified && status === "Scheduled" && !task.completed_at && !task.invoiced;
}

Deno.serve(async (req: Request) => {
  let reservationsCreated = 0;
  let tasksCreated = 0;
  let reservationsParsed = 0;
  let activeReservationCount = 0;
  let oldIgnored = 0;
  let reservationsUpdated = 0;
  let reservationsRemoved = 0;
  let weeklyTasksCreated = 0;
  let guestReadyTasksCreated = 0;
  let housekeepingTasksCreated = 0;
  let housekeepingTasksUpdated = 0;
  let staleTasksCancelled = 0;
  let tasksRequiringReview = 0;
  let protectedTasksPreserved = 0;
  const getSyncExtras = () => ({
    reservationsParsed,
    activeReservations: activeReservationCount,
    oldIgnored,
    reservationsUpdated,
    reservationsRemoved,
    weeklyTasksCreated,
    guestReadyTasksCreated,
    housekeepingTasksCreated,
    housekeepingTasksUpdated,
    staleTasksCancelled,
    tasksRequiringReview,
    protectedTasksPreserved,
  });

  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  try {
    if (req.method !== "POST") {
      return createErrorResponse("Method not allowed.", 405);
    }

    if (!(await isAuthorizedSyncCaller(req))) {
      return createErrorResponse("Admin access required.", 403);
    }

    let body;
    try {
      body = await req.json();
    } catch {
      return createErrorResponse("Request body must be valid JSON.", 400);
    }

    const propertyId = body?.property_id;
    if (!propertyId) {
      return createErrorResponse("property_id is required.", 400);
    }

    const { data: properties, error: propertyError } = await supabase
      .from("properties")
      .select("*")
      .eq("id", propertyId)
      .limit(1)
      .single();

    if (propertyError || !properties) {
      return createErrorResponse(`Could not load property: ${propertyError?.message || "not found"}`, propertyError ? 500 : 404);
    }

    const property = properties as {
      id: string;
      ical_url: string | null;
      active: boolean | null;
      pool_service_active: boolean | null;
      housekeeping_service_active: boolean | null;
      housekeeping_default_charge: number | null;
      housekeeping_labor_amount: number | null;
      default_off_cycle_charge: number | null;
      weekly_contract_cleaning_amount: number | null;
      weekly_contract_billing_effective_date: string | null;
      standard_service_day: string | null;
      coverage_days: number | null;
      coverage_rule: string | null;
      service_frequency: string | null;
      biweekly_anchor_date: string | null;
      task_generation_start_date: string;
    };
    const propertyStartDate = normalizeDateKey(property.task_generation_start_date);
    const poolServiceActive = property.pool_service_active !== false;
    const housekeepingServiceActive = property.housekeeping_service_active === true;
    if (property.active === false || (!poolServiceActive && !housekeepingServiceActive)) {
      return createSuccessResponse(reservationsCreated, tasksCreated, { reservationsParsed, activeReservations: activeReservationCount, oldIgnored, weeklyTasksCreated, guestReadyTasksCreated, housekeepingTasksCreated, housekeepingTasksUpdated });
    }
    console.log("STEP 1 property loaded");
    if (!property.ical_url) {
      return createErrorResponse("Property does not have an iCal URL.", 422);
    }

    let icalText: string;
    try {
      const response = await fetch(property.ical_url);
      if (!response.ok) {
        return createErrorResponse(`iCal fetch failed with HTTP ${response.status}.`, 502);
      }
      icalText = await response.text();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return createErrorResponse(`iCal fetch failed: ${message}`, 502);
    }

    let parsedReservations;
    try {
      parsedReservations = parseTrustedICalReservations(icalText);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return createErrorResponse(`iCal validation failed: ${message}`, 422);
    }

    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const cutoff = new Date(currentMonthStart);
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffDate = cutoff.toISOString().split("T")[0];

    reservationsParsed = parsedReservations.length;

    console.log("cutoffDate", cutoffDate);
    console.log("parsedReservations", parsedReservations.length);

    // An explicit STATUS:CANCELLED event must never be treated as active, even if Hostaway still lists it.
    const nonCancelledParsed = parsedReservations.filter((reservation) => !reservation.cancelled);

    const activeReservations = nonCancelledParsed.filter((res) => {
      return res.check_out != null && res.check_out >= cutoffDate;
    });
    activeReservationCount = activeReservations.length;
    oldIgnored = reservationsParsed - activeReservationCount;

    console.log("STEP 2 reservations checked");
    console.log("activeReservations", activeReservations.length);
    console.log("ignored old reservations", parsedReservations.length - activeReservations.length);

    // Reconcile previously imported iCal reservations for THIS property against what the current feed contains.
    // Anything future/current that's no longer present is marked cancelled rather than deleted, so any historical
    // cleaning tasks, invoices, chemical usage, or labor tied to it are left completely untouched.
    const presentKeys = new Set(nonCancelledParsed.map((reservation) => getReservationIdentityKey(reservation)));

    const { data: existingIcalReservations, error: existingIcalError } = await supabase
      .from("reservations")
      .select("id, guest_name, check_in, check_out, reservation_uid, status")
      .eq("property_id", propertyId)
      .eq("source", "ical")
      .gte("check_out", cutoffDate);

    if (existingIcalError) {
      console.error("sync-ical fatal error", existingIcalError?.message || existingIcalError);
      return createErrorResponse(`Could not load existing reservations: ${existingIcalError.message}`, 500);
    }

    const existingIcalRows = (existingIcalReservations || []) as Array<{ id: string; guest_name: string | null; check_in: string; check_out: string | null; reservation_uid: string | null; status: string | null }>;
    // Legacy rows created before this column existed have status = NULL; treat that as "active" rather than excluding them.
    const isRowAlreadyCancelled = (row: { status: string | null }) => String(row.status || "active").toLowerCase() === "cancelled";

    const removedReservationRows = existingIcalRows
      .filter((row) => !presentKeys.has(getReservationIdentityKey(row)));
    const removedReservationIds = removedReservationRows.map((row) => row.id);
    const staleReservationIds = removedReservationRows
      .filter((row) => !isRowAlreadyCancelled(row))
      .map((row) => row.id);

    if (removedReservationIds.length) {
      const removedAt = new Date().toISOString();
      if (staleReservationIds.length) {
        const { error: cancelError } = await supabase
          .from("reservations")
          .update({ status: "cancelled", cancelled_at: removedAt })
          .in("id", staleReservationIds);

        if (cancelError) {
          console.error("sync-ical fatal error", cancelError?.message || cancelError);
          return createErrorResponse(`Could not mark removed reservations: ${cancelError.message}`, 500);
        }
        reservationsRemoved += staleReservationIds.length;
        console.log("[RESERVATION CANCEL APPLIED]", staleReservationIds.length, "stale reservation(s) marked cancelled");
      }

      const { data: linkedTasks, error: linkedTaskError } = await supabase
        .from("cleaning_tasks")
        .select("id, source_type, manually_modified, status, completed_at, invoiced, invoice_id, invoiced_invoice_id, same_day_surcharge_reconciled, same_day_surcharge_invoice_id")
        .eq("property_id", propertyId)
        .in("source_reservation_id", removedReservationIds)
        .in("source_type", ["reservation_guest_ready", "reservation_housekeeping"]);

      if (linkedTaskError) {
        return createErrorResponse(`Could not inspect tasks for removed reservations: ${linkedTaskError.message}`, 500);
      }

      const safeTaskIds: string[] = [];
      const reviewTaskIds: string[] = [];
      for (const task of linkedTasks || []) {
        const status = String(task.status || "Scheduled").trim().toLowerCase();
        const financiallyLocked = task.invoiced === true
          || Boolean(task.invoice_id)
          || Boolean(task.invoiced_invoice_id)
          || task.same_day_surcharge_reconciled === true
          || Boolean(task.same_day_surcharge_invoice_id);
        const completed = status === "completed" || Boolean(task.completed_at);
        if (completed || financiallyLocked || ["cancelled", "canceled", "void", "deleted"].includes(status)) {
          protectedTasksPreserved += 1;
        } else if (task.manually_modified === true || ["in progress", "in_progress"].includes(status)) {
          reviewTaskIds.push(task.id);
        } else if (status === "scheduled") {
          safeTaskIds.push(task.id);
        } else {
          protectedTasksPreserved += 1;
        }
      }

      if (safeTaskIds.length) {
        const { error: staleTaskError } = await supabase
          .from("cleaning_tasks")
          .update({
            status: "Cancelled",
            weekly_contract_obligation_key: null,
            source_removed_at: removedAt,
            source_review_required_at: null,
            source_review_reason: null,
          })
          .in("id", safeTaskIds);
        if (staleTaskError) {
          return createErrorResponse(`Could not cancel stale generated tasks: ${staleTaskError.message}`, 500);
        }
        staleTasksCancelled += safeTaskIds.length;
      }

      if (reviewTaskIds.length) {
        const { error: reviewTaskError } = await supabase
          .from("cleaning_tasks")
          .update({
            source_removed_at: removedAt,
            source_review_required_at: removedAt,
            source_review_reason: "RESERVATION REMOVED - Review Task",
          })
          .in("id", reviewTaskIds);
        if (reviewTaskError) {
          return createErrorResponse(`Could not flag generated tasks for review: ${reviewTaskError.message}`, 500);
        }
        tasksRequiringReview += reviewTaskIds.length;
      }
    }

    const existingReservationMap = new Map(existingIcalRows.map((row) => [getReservationIdentityKey(row), row]));
    for (const reservation of activeReservations) {
      const existingReservation = existingReservationMap.get(getReservationIdentityKey(reservation));
      if (!existingReservation) continue;
      const guestName = reservation.summary || null;
      const reservationChanged = existingReservation.check_in !== reservation.check_in
        || existingReservation.check_out !== reservation.check_out
        || existingReservation.guest_name !== guestName
        || isRowAlreadyCancelled(existingReservation);

      const { error: reservationUpdateError } = await supabase
        .from("reservations")
        .update({
          guest_name: guestName,
          check_in: reservation.check_in,
          check_out: reservation.check_out,
          status: "active",
          cancelled_at: null,
          imported_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
        })
        .eq("id", existingReservation.id);
      if (reservationUpdateError) {
        console.error("sync-ical fatal error", reservationUpdateError?.message || reservationUpdateError);
        return createErrorResponse(`Could not update reservation: ${reservationUpdateError.message}`, 500);
      }
      if (reservationChanged) reservationsUpdated += 1;
    }

    if (!activeReservations.length) {
      return createSuccessResponse(reservationsCreated, tasksCreated, getSyncExtras());
    }

    const checkIns = activeReservations.filter((reservation) => reservation.check_in).map((reservation) => reservation.check_in);

    const staleIdSet = new Set(staleReservationIds);
    const existingActiveKeys = new Set(
      existingIcalRows
        .filter((row) => !staleIdSet.has(row.id))
        .map((row) => getReservationIdentityKey(row))
    );

    const newReservations = activeReservations
      .filter((reservation) => reservation.check_in)
      .filter((reservation) => !existingActiveKeys.has(getReservationIdentityKey(reservation)))
      .map((reservation) => ({
        property_id: propertyId,
        guest_name: reservation.summary || null,
        check_in: reservation.check_in,
        check_out: reservation.check_out || null,
        reservation_uid: reservation.uid || null,
        status: "active",
        imported_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
        source: "ical",
      }));

    if (newReservations.length) {
      const { error } = await supabase.from("reservations").insert(newReservations);
      if (error) {
        console.error("sync-ical fatal error", error?.message || error);
        console.error("sync-ical fatal stack", error?.stack || "no stack");
        return createErrorResponse(`Could not insert reservations: ${error.message}`, 500);
      }
      reservationsCreated = newReservations.length;
      console.log("STEP 3 reservations inserted");
    }

    const { data: currentReservationRows, error: currentReservationError } = await supabase
      .from("reservations")
      .select("id, check_in, check_out, reservation_uid, status")
      .eq("property_id", propertyId)
      .eq("source", "ical")
      .neq("status", "cancelled")
      .gte("check_out", cutoffDate);
    if (currentReservationError) {
      return createErrorResponse(`Could not load current reservation identities: ${currentReservationError.message}`, 500);
    }
    type CurrentReservationRow = {
      id: string;
      check_in: string;
      check_out: string | null;
      reservation_uid: string | null;
      status: string | null;
    };
    const currentReservationMap = new Map<string, CurrentReservationRow>(
      ((currentReservationRows || []) as CurrentReservationRow[])
        .map((reservation) => [getReservationIdentityKey(reservation), reservation])
    );

    if (housekeepingServiceActive) {
      const housekeepingDefaultCharge = Math.max(0, Number(property.housekeeping_default_charge || 0));
      const housekeepingLaborAmount = Math.max(0, Number(property.housekeeping_labor_amount || 0));
      const housekeepingSourceKeys = activeReservations
        .filter((reservation) => reservation.check_out)
        .map((reservation) => getHousekeepingSourceKey(propertyId, reservation));
      const { data: existingHousekeepingTasks, error: housekeepingLookupError } = housekeepingSourceKeys.length
        ? await supabase
            .from("cleaning_tasks")
            .select("id, source_key, source_reservation_id, service_date, manually_modified, status, completed_at, invoiced, invoice_id, invoiced_invoice_id, same_day_surcharge_reconciled, same_day_surcharge_invoice_id, source_removed_at, source_review_required_at")
            .eq("property_id", propertyId)
            .eq("source_type", "reservation_housekeeping")
        : { data: [], error: null };

      if (housekeepingLookupError) {
        console.error("sync-ical fatal error", housekeepingLookupError?.message || housekeepingLookupError);
        return createErrorResponse(`Could not load Housekeeping tasks: ${housekeepingLookupError.message}`, 500);
      }

      type HousekeepingTaskRecord = {
        id: string;
        source_key: string;
        source_reservation_id: string | null;
        service_date: string;
        manually_modified: boolean | null;
        status: string | null;
        completed_at: string | null;
        invoiced: boolean | null;
        invoice_id: string | null;
        invoiced_invoice_id: string | null;
        same_day_surcharge_reconciled: boolean | null;
        same_day_surcharge_invoice_id: string | null;
        source_removed_at: string | null;
        source_review_required_at: string | null;
      };
      const housekeepingTaskBySourceKey = new Map(
        ((existingHousekeepingTasks || []) as HousekeepingTaskRecord[]).map((task) => [task.source_key, task])
      );
      const housekeepingTaskByReservationId = new Map(
        ((existingHousekeepingTasks || []) as HousekeepingTaskRecord[])
          .filter((task) => task.source_reservation_id)
          .map((task) => [task.source_reservation_id as string, task])
      );
      const housekeepingTasksToCreate: Array<Record<string, unknown>> = [];
      const pendingHousekeepingSourceKeys = new Set<string>();

      for (const reservation of activeReservations) {
        if (!reservation.check_out) continue;
        if (!isAutoTaskDateOnOrAfterPropertyStart(reservation.check_out, propertyStartDate)) continue;
        const reservationRow = currentReservationMap.get(getReservationIdentityKey(reservation));
        if (!reservationRow) {
          return createErrorResponse("Could not resolve a current reservation before generating Housekeeping tasks.", 500);
        }
        const sourceKey = getHousekeepingSourceKey(propertyId, reservation);
        if (pendingHousekeepingSourceKeys.has(sourceKey)) continue;
        const existingTask = housekeepingTaskByReservationId.get(reservationRow.id)
          || housekeepingTaskBySourceKey.get(sourceKey);
        if (existingTask) {
          const status = String(existingTask.status || "Scheduled").toLowerCase();
          const editableStatus = ["scheduled", "in progress", "in_progress"].includes(status);
          const financiallyLocked = existingTask.invoiced === true
            || Boolean(existingTask.invoice_id)
            || Boolean(existingTask.invoiced_invoice_id)
            || existingTask.same_day_surcharge_reconciled === true
            || Boolean(existingTask.same_day_surcharge_invoice_id);
          const restorableCancellation = status === "cancelled"
            && Boolean(existingTask.source_removed_at)
            && existingTask.manually_modified !== true
            && !existingTask.completed_at
            && !financiallyLocked;
          const locked = !editableStatus
            || existingTask.manually_modified
            || Boolean(existingTask.completed_at)
            || financiallyLocked;
          if (restorableCancellation || (!locked && (
            existingTask.service_date !== reservation.check_out
            || existingTask.source_reservation_id !== reservationRow.id
            || existingTask.source_key !== sourceKey
            || Boolean(existingTask.source_removed_at)
            || Boolean(existingTask.source_review_required_at)
          ))) {
            const { error: housekeepingUpdateError } = await supabase
              .from("cleaning_tasks")
              .update({
                ...(restorableCancellation ? { status: "Scheduled" } : {}),
                service_date: reservation.check_out,
                scheduled_date: reservation.check_out,
                suggested_date: reservation.check_out,
                notes: `Auto-created from iCal sync for checkout ${reservation.check_out}.`,
                source_key: sourceKey,
                source_reservation_id: reservationRow.id,
                source_removed_at: null,
                source_review_required_at: null,
                source_review_reason: null,
              })
              .eq("id", existingTask.id);
            if (housekeepingUpdateError) {
              console.error("sync-ical fatal error", housekeepingUpdateError?.message || housekeepingUpdateError);
              return createErrorResponse(`Could not update Housekeeping task: ${housekeepingUpdateError.message}`, 500);
            }
            housekeepingTasksUpdated += 1;
          } else if (existingTask.source_removed_at || existingTask.source_review_required_at) {
            const { error: housekeepingReviewClearError } = await supabase
              .from("cleaning_tasks")
              .update({
                source_removed_at: null,
                source_review_required_at: null,
                source_review_reason: null,
              })
              .eq("id", existingTask.id);
            if (housekeepingReviewClearError) {
              return createErrorResponse(`Could not clear Housekeeping review state: ${housekeepingReviewClearError.message}`, 500);
            }
          }
          continue;
        }

        housekeepingTasksToCreate.push({
          property_id: propertyId,
          service_date: reservation.check_out,
          scheduled_date: reservation.check_out,
          suggested_date: reservation.check_out,
          service_type: "Housekeeping",
          service_branch: "housekeeping",
          status: "Scheduled",
          off_cycle: false,
          guest_ready: false,
          charge: housekeepingDefaultCharge,
          labor_amount: housekeepingLaborAmount,
          notes: `Auto-created from iCal sync for checkout ${reservation.check_out}.`,
          source_type: "reservation_housekeeping",
          source_key: sourceKey,
          source_reservation_id: reservationRow.id,
          manually_modified: false,
        });
        pendingHousekeepingSourceKeys.add(sourceKey);
      }

      if (housekeepingTasksToCreate.length) {
        console.log("[HOUSEKEEPING PRICING SNAPSHOT]", {
          propertyId,
          charge: housekeepingDefaultCharge,
          laborAmount: housekeepingLaborAmount,
          taskCount: housekeepingTasksToCreate.length,
        });
        const { error: housekeepingInsertError } = await supabase
          .from("cleaning_tasks")
          .insert(housekeepingTasksToCreate);
        if (housekeepingInsertError) {
          console.error("sync-ical fatal error", housekeepingInsertError?.message || housekeepingInsertError);
          return createErrorResponse(`Could not insert Housekeeping tasks: ${housekeepingInsertError.message}`, 500);
        }
        housekeepingTasksCreated += housekeepingTasksToCreate.length;
        tasksCreated += housekeepingTasksToCreate.length;
      }
    }

    if (!poolServiceActive) {
      return createSuccessResponse(reservationsCreated, tasksCreated, { reservationsParsed, activeReservations: activeReservationCount, oldIgnored, weeklyTasksCreated, guestReadyTasksCreated, housekeepingTasksCreated, housekeepingTasksUpdated });
    }

    const standardDay = property.standard_service_day || "Wednesday";
    const serviceFrequency = normalizeServiceFrequency(property.service_frequency);
    const biweeklyAnchorDate = normalizeDateKey(property.biweekly_anchor_date);
    const useBiweekly = serviceFrequency === SERVICE_FREQUENCY_BIWEEKLY && !!biweeklyAnchorDate;
    const coverageRule = normalizeCoverageRule(property.coverage_rule, property.coverage_days);
    const coverageOffsets = getCoverageOffsetsForRule(coverageRule);
    const minOffset = Math.min(...coverageOffsets);
    const maxOffset = Math.max(...coverageOffsets);

    // Build source_key -> service_date mapping for all weekly tasks this sync run needs.
    // source_key is a stable identity for "the weekly task for property X in the week containing check-in Y".
    // It never changes even if the task is manually moved to a different date.
    const weeklySourceKeyToDate = new Map<string, string>();
    for (const reservation of activeReservations) {
      if (!reservation.check_in) continue;
      const service_date = getServiceDateForWeek(reservation.check_in, standardDay);
      if (!isAutoTaskDateOnOrAfterPropertyStart(service_date, propertyStartDate)) {
        continue;
      }
      if (useBiweekly && !isDateOnBiweeklyCycle(service_date, biweeklyAnchorDate)) {
        continue;
      }
      const source_key = `wk:${propertyId}:${service_date}`;
      weeklySourceKeyToDate.set(source_key, service_date);
    }

    const weeklyServiceDates = Array.from(new Set(weeklySourceKeyToDate.values()));
    const weeklySourceKeys = Array.from(weeklySourceKeyToDate.keys());

    const earliestWeeklyDate = weeklyServiceDates.length
      ? weeklyServiceDates.slice().sort()[0]
      : null;
    const latestWeeklyDate = weeklyServiceDates.length
      ? weeklyServiceDates.slice().sort().at(-1) || null
      : null;

    const windowQueryStart = earliestWeeklyDate ? addDays(earliestWeeklyDate, minOffset) : null;
    const windowQueryEnd = latestWeeklyDate ? addDays(latestWeeklyDate, maxOffset) : null;

    const { data: existingGuestReadyWindowTasks, error: guestReadyWindowError } = windowQueryStart && windowQueryEnd
      ? await supabase
          .from("cleaning_tasks")
          .select("id, service_date, status, check_in_date, service_type")
          .eq("property_id", propertyId)
          .eq("service_type", "Guest Ready")
          .gte("service_date", windowQueryStart)
          .lte("service_date", windowQueryEnd)
      : { data: [], error: null };
    if (guestReadyWindowError) {
      return createErrorResponse(`Could not load Guest Ready coverage tasks: ${guestReadyWindowError.message}`, 500);
    }

    // Lookup 1: by original service_date — catches tasks that predate the source_key column
    const { data: existingByDate, error: weeklyByDateError } = weeklyServiceDates.length
      ? await supabase
          .from("cleaning_tasks")
          .select("id, service_date, service_type, guest_ready, check_in_date, source_key, weekly_contract_obligation_key, charge, manually_modified, status, completed_at, invoiced")
          .eq("property_id", propertyId)
          .eq("service_type", "Weekly Standard")
          .in("service_date", weeklyServiceDates)
      : { data: [], error: null };
    if (weeklyByDateError) {
      return createErrorResponse(`Could not load Weekly Standard tasks by date: ${weeklyByDateError.message}`, 500);
    }

    // Lookup 2: by source_key — catches tasks that were manually moved to a different date
    const { data: existingByKey, error: weeklyByKeyError } = weeklySourceKeys.length
      ? await supabase
          .from("cleaning_tasks")
          .select("id, service_date, service_type, guest_ready, check_in_date, source_key, weekly_contract_obligation_key, charge, manually_modified, status, completed_at, invoiced")
          .eq("property_id", propertyId)
          .eq("service_type", "Weekly Standard")
          .in("source_key", weeklySourceKeys)
      : { data: [], error: null };
    if (weeklyByKeyError) {
      return createErrorResponse(`Could not load Weekly Standard tasks by source: ${weeklyByKeyError.message}`, 500);
    }

    type WeeklyTaskRecord = { id: string; service_date: string; service_type: string; guest_ready: boolean; check_in_date: string | null; source_key: string | null; weekly_contract_obligation_key: string | null; charge: number | null; manually_modified: boolean | null; status: string | null; completed_at: string | null; invoiced: boolean | null };
    const existingWeeklyTaskMap = new Map<string, WeeklyTaskRecord>();
    // Add by-date results first — derive source_key from the original scheduled date
    for (const task of (existingByDate || []) as WeeklyTaskRecord[]) {
      const sk = task.source_key || `wk:${propertyId}:${task.service_date}`;
      existingWeeklyTaskMap.set(sk, task);
    }
    // Override with by-key results — these are authoritative even when service_date differs
    for (const task of (existingByKey || []) as WeeklyTaskRecord[]) {
      if (task.source_key) existingWeeklyTaskMap.set(task.source_key, task);
    }

    // Stable reservation links are authoritative across upstream date changes.
    const { data: existingGuestReadyTasks, error: guestReadyLookupError } = checkIns.length
      ? await supabase
          .from("cleaning_tasks")
        .select("id, service_date, scheduled_date, suggested_date, check_in_date, service_type, source_key, source_reservation_id, weekly_contract_obligation_key, charge, off_cycle, manually_modified, status, completed_at, invoiced, invoice_id, invoiced_invoice_id, same_day_surcharge_reconciled, same_day_surcharge_invoice_id, source_removed_at, source_review_required_at")
          .eq("property_id", propertyId)
        .eq("source_type", "reservation_guest_ready")
      : { data: [], error: null };
    if (guestReadyLookupError) {
      return createErrorResponse(`Could not load Guest Ready tasks: ${guestReadyLookupError.message}`, 500);
    }

    type GuestReadyTaskRecord = {
      id: string;
      service_date: string;
      scheduled_date: string | null;
      suggested_date: string | null;
      check_in_date: string;
      service_type: string;
      source_key: string | null;
      source_reservation_id: string | null;
      weekly_contract_obligation_key: string | null;
      charge: number | null;
      off_cycle: boolean | null;
      manually_modified: boolean | null;
      status: string | null;
      completed_at: string | null;
      invoiced: boolean | null;
      invoice_id: string | null;
      invoiced_invoice_id: string | null;
      same_day_surcharge_reconciled: boolean | null;
      same_day_surcharge_invoice_id: string | null;
      source_removed_at: string | null;
      source_review_required_at: string | null;
    };
    const releasableCancelledContractTasks = ((existingGuestReadyTasks || []) as GuestReadyTaskRecord[])
      .filter((task) => ["cancelled", "canceled", "void", "deleted"].includes(String(task.status || "").toLowerCase()))
      .filter((task) => task.weekly_contract_obligation_key)
      .filter((task) => task.invoiced !== true && !task.invoice_id && !task.invoiced_invoice_id);
    if (releasableCancelledContractTasks.length) {
      const releasableIds = releasableCancelledContractTasks.map((task) => task.id);
      const { error: releaseError } = await supabase
        .from("cleaning_tasks")
        .update({ weekly_contract_obligation_key: null })
        .in("id", releasableIds);
      if (releaseError) {
        return createErrorResponse(`Could not release cancelled weekly contract obligations: ${releaseError.message}`, 500);
      }
      releasableCancelledContractTasks.forEach((task) => {
        task.weekly_contract_obligation_key = null;
      });
    }
    const existingGuestReadyBySourceKey = new Map<string, GuestReadyTaskRecord>();
    const existingGuestReadyByReservationId = new Map<string, GuestReadyTaskRecord>();
    for (const task of (existingGuestReadyTasks || []) as GuestReadyTaskRecord[]) {
      const sk = task.source_key || `gr:${propertyId}:${task.check_in_date}`;
      existingGuestReadyBySourceKey.set(sk, task);
      if (task.source_reservation_id) existingGuestReadyByReservationId.set(task.source_reservation_id, task);
    }

    const pendingWeeklyTasks = new Map<string, { check_in_date: string | null; guest_ready: boolean }>();
    const weeklyTaskUpdates: Array<{ id: string; guest_ready: boolean; check_in_date: string | null }> = [];
    const weeklyTaskIdsToSuppress: string[] = [];
    const suppressedWeeklySourceKeys = new Set<string>();
    const guestReadyTasksToCreate: Array<Record<string, any>> = [];
    const guestReadyContractUpdates: Array<{ id: string; charge: number; off_cycle: boolean; weekly_contract_obligation_key: string | null }> = [];
    const weeklyContractOwnerByKey = new Map<string, string>(
      ((existingGuestReadyTasks || []) as GuestReadyTaskRecord[])
        .filter((task) => task.weekly_contract_obligation_key)
        .map((task) => [task.weekly_contract_obligation_key as string, task.id])
    );

    for (const weeklyServiceDate of weeklyServiceDates) {
      const hasGuestReadyInsideWindow = (existingGuestReadyWindowTasks || []).some((task: { service_date: string; status: string | null }) => {
        const status = String(task.status || "").toLowerCase();
        if (status === "cancelled") return false;
        if (!task.service_date) return false;
        return isDateWithinCoverageRule(weeklyServiceDate, task.service_date, coverageRule);
      });

      if (hasGuestReadyInsideWindow) {
        suppressedWeeklySourceKeys.add(`wk:${propertyId}:${weeklyServiceDate}`);
      }
    }

    console.log("[SYNC] Starting task creation logic");
    console.log("[SYNC] existingWeeklyTaskMap size:", existingWeeklyTaskMap.size);
    console.log("[SYNC] existingGuestReadyMap size:", existingGuestReadyBySourceKey.size);

    const sortedActiveReservations = [...activeReservations].sort((a, b) => String(a.check_in || "").localeCompare(String(b.check_in || "")));

    for (let index = 0; index < sortedActiveReservations.length; index += 1) {
      const reservation = sortedActiveReservations[index];
      if (!reservation.check_in) continue;

      const previousReservation = index > 0 ? sortedActiveReservations[index - 1] : null;
      const sameDayTurnover = previousReservation?.check_out === reservation.check_in;

      const service_date = getServiceDateForWeek(reservation.check_in, standardDay);
      const guestReadyServiceDate = reservation.check_in;
      const guestReadyWithinWindow = isDateWithinCoverageRule(service_date, guestReadyServiceDate, coverageRule);
      const isSameDayAsStandard = reservation.check_in === service_date;
      const source_key = `wk:${propertyId}:${service_date}`;
      const weeklyTask = existingWeeklyTaskMap.get(source_key);
      const shouldUseWeeklyForReservation = isAutoTaskDateOnOrAfterPropertyStart(service_date, propertyStartDate)
        && (!useBiweekly || isDateOnBiweeklyCycle(service_date, biweeklyAnchorDate));

      if (shouldUseWeeklyForReservation && guestReadyWithinWindow) {
        suppressedWeeklySourceKeys.add(source_key);
      }

      if (shouldUseWeeklyForReservation) {
        console.log("[WEEKLY CHECK]", { reservation_check_in: reservation.check_in, source_key, foundExistingTask: !!weeklyTask, weeklyTask_id: weeklyTask?.id, biweekly: useBiweekly });

        if (weeklyTask) {
          if (guestReadyWithinWindow) {
            if (isSafeAutoWeeklyTaskToSuppress(weeklyTask) && !weeklyTaskIdsToSuppress.includes(weeklyTask.id)) {
              console.log("[WEEKLY SUPPRESS QUEUED]", { weekly_task_id: weeklyTask.id, source_key, reservation_check_in: reservation.check_in });
              weeklyTaskIdsToSuppress.push(weeklyTask.id);
            }
          } else {
            // Task already exists for this week — never create a duplicate.
            // Only update guest_ready if the task has NOT been manually modified.
            if (!weeklyTask.manually_modified && isSameDayAsStandard && (!weeklyTask.guest_ready || weeklyTask.check_in_date !== reservation.check_in)) {
              weeklyTaskUpdates.push({
                id: weeklyTask.id,
                guest_ready: true,
                check_in_date: reservation.check_in,
              });
              weeklyTask.guest_ready = true;
              weeklyTask.check_in_date = reservation.check_in;
            }
          }
        } else {
          if (guestReadyWithinWindow) {
            pendingWeeklyTasks.delete(service_date);
            console.log("[WEEKLY SUPPRESS PENDING]", { source_key, service_date, reservation_check_in: reservation.check_in });
          } else {
            const pending = pendingWeeklyTasks.get(service_date);
            if (pending) {
              if (isSameDayAsStandard) {
                pending.guest_ready = true;
                pending.check_in_date = reservation.check_in;
              }
            } else {
              console.log("[WEEKLY ADD PENDING]", { source_key, service_date, propertyId, is_same_day: isSameDayAsStandard, biweekly: useBiweekly });
              pendingWeeklyTasks.set(service_date, {
                check_in_date: isSameDayAsStandard ? reservation.check_in : null,
                guest_ready: isSameDayAsStandard,
              });
            }
          }
        }
      }

      if (!isAutoTaskDateOnOrAfterPropertyStart(guestReadyServiceDate, propertyStartDate)) {
        continue;
      }

      const reservationRow = currentReservationMap.get(getReservationIdentityKey(reservation));
      if (!reservationRow) {
        return createErrorResponse("Could not resolve a current reservation before generating Guest Ready tasks.", 500);
      }
      const guestReadySourceKey = getGuestReadySourceKey(propertyId, reservation);
      const legacyGuestReadySourceKey = `gr:${propertyId}:${reservation.check_in}`;
      const existingGuestReady = existingGuestReadyByReservationId.get(reservationRow.id)
        || existingGuestReadyBySourceKey.get(guestReadySourceKey)
        || existingGuestReadyBySourceKey.get(legacyGuestReadySourceKey);
      const weeklyContractAmount = getWeeklyContractTaskAmount(
        service_date,
        property.weekly_contract_cleaning_amount,
        property.weekly_contract_billing_effective_date
      );
      const existingContractOwnerId = weeklyContractOwnerByKey.get(source_key);
      const weeklyTaskBlocksTransfer = Boolean(weeklyTask && !isSafeAutoWeeklyTaskToSuppress(weeklyTask));
      const existingGuestReadyOwnsContract = existingGuestReady?.weekly_contract_obligation_key === source_key;
      const claimsWeeklyContract = shouldUseWeeklyForReservation
        && guestReadyWithinWindow
        && weeklyContractAmount > 0
        && !weeklyTaskBlocksTransfer
        && (!existingContractOwnerId || existingContractOwnerId === existingGuestReady?.id);
      if (claimsWeeklyContract) {
        weeklyContractOwnerByKey.set(source_key, existingGuestReady?.id || `pending:${guestReadySourceKey}`);
      }
      const defaultGuestReadyCharge = getGuestReadyCharge(guestReadyServiceDate, standardDay, coverageRule, property.default_off_cycle_charge);
      const guestReadyCharge = claimsWeeklyContract
        ? (existingGuestReadyOwnsContract && Number(existingGuestReady?.charge || 0) > 0
          ? Number(existingGuestReady?.charge || 0)
          : weeklyContractAmount)
        : defaultGuestReadyCharge;
      const weeklyContractObligationKey = claimsWeeklyContract ? source_key : null;

      console.log("[GUEST READY CHECK]", { reservation_check_in: reservation.check_in, source_key: guestReadySourceKey, foundExistingTask: !!existingGuestReady, existing_id: existingGuestReady?.id, within_window: guestReadyWithinWindow });

      if (existingGuestReady) {
        const existingStatus = String(existingGuestReady.status || "").toLowerCase();
        const financiallyLocked = existingGuestReady.invoiced === true
          || Boolean(existingGuestReady.invoice_id)
          || Boolean(existingGuestReady.invoiced_invoice_id)
          || existingGuestReady.same_day_surcharge_reconciled === true
          || Boolean(existingGuestReady.same_day_surcharge_invoice_id);
        const restorableCancellation = existingStatus === "cancelled"
          && Boolean(existingGuestReady.source_removed_at)
          && existingGuestReady.manually_modified !== true
          && !existingGuestReady.completed_at
          && !financiallyLocked;
        const canMoveExistingTask = !existingGuestReady.manually_modified
          && ["scheduled", "in progress", "in_progress"].includes(existingStatus)
          && !existingGuestReady.completed_at
          && !financiallyLocked;
        if ((restorableCancellation || canMoveExistingTask) && (
          Number(existingGuestReady.charge || 0) !== guestReadyCharge
          || existingGuestReady.off_cycle !== (defaultGuestReadyCharge > 0 && !claimsWeeklyContract)
          || existingGuestReady.weekly_contract_obligation_key !== weeklyContractObligationKey
        )) {
          guestReadyContractUpdates.push({
            id: existingGuestReady.id,
            charge: guestReadyCharge,
            off_cycle: defaultGuestReadyCharge > 0 && !claimsWeeklyContract,
            weekly_contract_obligation_key: weeklyContractObligationKey,
          });
        }

        if (restorableCancellation || (canMoveExistingTask && (
          existingGuestReady.service_date !== guestReadyServiceDate
          || existingGuestReady.check_in_date !== reservation.check_in
          || existingGuestReady.source_reservation_id !== reservationRow.id
          || existingGuestReady.source_key !== guestReadySourceKey
          || Boolean(existingGuestReady.source_removed_at)
          || Boolean(existingGuestReady.source_review_required_at)
        ))) {
          const { error: updateError } = await supabase
            .from("cleaning_tasks")
            .update({
              ...(restorableCancellation ? { status: "Scheduled" } : {}),
              service_date: guestReadyServiceDate,
              scheduled_date: guestReadyServiceDate,
              suggested_date: guestReadyServiceDate,
              check_in_date: reservation.check_in,
              source_key: guestReadySourceKey,
              source_reservation_id: reservationRow.id,
              source_removed_at: null,
              source_review_required_at: null,
              source_review_reason: null,
            })
            .eq("id", existingGuestReady.id);

          if (updateError) {
            console.error("sync-ical fatal error", updateError?.message || updateError);
            console.error("sync-ical fatal stack", updateError?.stack || "no stack");
            return createErrorResponse(`Could not update Guest Ready task: ${updateError.message}`, 500);
          }

          console.log("[GUEST READY UPDATED]", {
            source_key: guestReadySourceKey,
            propertyId,
            existing_id: existingGuestReady.id,
            previous_service_date: existingGuestReady.service_date,
            updated_service_date: guestReadyServiceDate,
            same_day_turnover: sameDayTurnover,
          });
        } else if (existingGuestReady.source_removed_at || existingGuestReady.source_review_required_at) {
          const { error: reviewClearError } = await supabase
            .from("cleaning_tasks")
            .update({
              source_removed_at: null,
              source_review_required_at: null,
              source_review_reason: null,
            })
            .eq("id", existingGuestReady.id);
          if (reviewClearError) {
            return createErrorResponse(`Could not clear Guest Ready review state: ${reviewClearError.message}`, 500);
          }
        } else {
          // Task already exists for this check-in. Never create a duplicate.
          // Don't overwrite manually modified or completed tasks.
          console.log("[GUEST READY SKIPPING]", { source_key: guestReadySourceKey, propertyId, existing_service_date: existingGuestReady.service_date });
        }
      } else {
        console.log("[GUEST READY ADD PENDING]", { source_key: guestReadySourceKey, propertyId, service_date: guestReadyServiceDate, same_day_turnover: sameDayTurnover });
        guestReadyTasksToCreate.push({
          property_id: propertyId,
          service_date: guestReadyServiceDate,
          scheduled_date: guestReadyServiceDate,
          suggested_date: guestReadyServiceDate,
          check_in_date: reservation.check_in,
          service_type: "Guest Ready",
          status: "Scheduled",
          off_cycle: defaultGuestReadyCharge > 0 && !claimsWeeklyContract,
          guest_ready: true,
          charge: guestReadyCharge,
          notes: `Auto-created from iCal sync for check-in ${reservation.check_in}.`,
          source_type: "reservation_guest_ready",
          source_key: guestReadySourceKey,
          source_reservation_id: reservationRow.id,
          weekly_contract_obligation_key: weeklyContractObligationKey,
          manually_modified: false,
        });
      }
    }

    if (weeklyTaskIdsToSuppress.length) {
      const { error } = await supabase
        .from("cleaning_tasks")
        .delete()
        .eq("property_id", propertyId)
        .in("id", weeklyTaskIdsToSuppress);
      if (error) {
        console.error("sync-ical fatal error", error?.message || error);
        console.error("sync-ical fatal stack", error?.stack || "no stack");
        return createErrorResponse(`Could not suppress overlapping Weekly Standard tasks: ${error.message}`, 500);
      }
      console.log("[WEEKLY SUPPRESS APPLIED]", weeklyTaskIdsToSuppress.length, "weekly tasks removed");
    }

    for (const update of guestReadyContractUpdates) {
      const { error } = await supabase
        .from("cleaning_tasks")
        .update({
          charge: update.charge,
          off_cycle: update.off_cycle,
          weekly_contract_obligation_key: update.weekly_contract_obligation_key,
        })
        .eq("id", update.id);
      if (error) {
        return createErrorResponse(`Could not snapshot Guest Ready contract billing: ${error.message}`, 500);
      }
    }

    const weeklyTasksToCreate = Array.from(pendingWeeklyTasks.entries())
      .filter(([service_date]) => isAutoTaskDateOnOrAfterPropertyStart(service_date, propertyStartDate))
      .filter(([service_date]) => !suppressedWeeklySourceKeys.has(`wk:${propertyId}:${service_date}`))
      .map(([service_date, payload]) => ({
      property_id: propertyId,
      service_date,
      scheduled_date: service_date,
      suggested_date: service_date,
      check_in_date: payload.check_in_date,
      service_type: "Weekly Standard",
      status: "Scheduled",
      off_cycle: false,
      guest_ready: payload.guest_ready,
      charge: getWeeklyContractTaskAmount(
        service_date,
        property.weekly_contract_cleaning_amount,
        property.weekly_contract_billing_effective_date
      ),
      notes: `Auto-created Weekly Standard for the week covering service date ${service_date}.`,
      source_type: "weekly_standard",
      source_key: `wk:${propertyId}:${service_date}`,
      weekly_contract_obligation_key: getWeeklyContractTaskAmount(
        service_date,
        property.weekly_contract_cleaning_amount,
        property.weekly_contract_billing_effective_date
      ) > 0 ? `wk:${propertyId}:${service_date}` : null,
      manually_modified: false,
    }));

    if (weeklyTasksToCreate.length) {
      console.log("[WEEKLY INSERT CHECK] About to insert", weeklyTasksToCreate.length, "weekly tasks");
      
      // Hard duplicate guard: check if any source_key already exists in DB
      const sourceKeysToInsert = weeklyTasksToCreate.map(t => t.source_key);
      const { data: existingDuplicates, error: duplicateLookupError } = await supabase
        .from("cleaning_tasks")
        .select("id, source_key")
        .eq("property_id", propertyId)
        .in("source_key", sourceKeysToInsert);
      if (duplicateLookupError) {
        return createErrorResponse(`Could not verify Weekly Standard task uniqueness: ${duplicateLookupError.message}`, 500);
      }

      if (existingDuplicates && existingDuplicates.length > 0) {
        console.log("[WEEKLY DUPLICATE GUARD] Found existing tasks, filtering out duplicates:", existingDuplicates.map((d: { source_key: string }) => d.source_key));
        const existingSourceKeys = new Set(existingDuplicates.map((d: { source_key: string }) => d.source_key));
        const filteredWeeklyTasks = weeklyTasksToCreate.filter(t => !existingSourceKeys.has(t.source_key));
        
        if (filteredWeeklyTasks.length === 0) {
          console.log("[WEEKLY DUPLICATE GUARD] All weekly tasks are duplicates, skipping insert");
        } else {
          console.log("[WEEKLY INSERT]", filteredWeeklyTasks.length, "weekly tasks after duplicate filtering");
          const { error } = await supabase.from("cleaning_tasks").insert(filteredWeeklyTasks);
          if (error) {
            console.error("sync-ical fatal error", error?.message || error);
            console.error("sync-ical fatal stack", error?.stack || "no stack");
            return createErrorResponse(`Could not insert Weekly Standard tasks: ${error.message}`, 500);
          }
          weeklyTasksCreated += filteredWeeklyTasks.length;
          tasksCreated += filteredWeeklyTasks.length;
          console.log("STEP 4 weekly tasks created");
        }
      } else {
        console.log("[WEEKLY INSERT]", weeklyTasksToCreate.length, "weekly tasks");
        const { error } = await supabase.from("cleaning_tasks").insert(weeklyTasksToCreate);
        if (error) {
          console.error("sync-ical fatal error", error?.message || error);
          console.error("sync-ical fatal stack", error?.stack || "no stack");
          return createErrorResponse(`Could not insert Weekly Standard tasks: ${error.message}`, 500);
        }
        weeklyTasksCreated += weeklyTasksToCreate.length;
        tasksCreated += weeklyTasksToCreate.length;
        console.log("STEP 4 weekly tasks created");
      }
    }

    const suppressedWeeklyTaskIdSet = new Set(weeklyTaskIdsToSuppress);
    const filteredWeeklyTaskUpdates = weeklyTaskUpdates.filter((update) => !suppressedWeeklyTaskIdSet.has(update.id));

    for (const update of filteredWeeklyTaskUpdates) {
      const { error } = await supabase
        .from("cleaning_tasks")
        .update({ guest_ready: update.guest_ready, check_in_date: update.check_in_date })
        .eq("id", update.id);
      if (error) {
        console.error("sync-ical fatal error", error?.message || error);
        console.error("sync-ical fatal stack", error?.stack || "no stack");
        return createErrorResponse(`Could not update Weekly Standard task: ${error.message}`, 500);
      }
    }

    if (guestReadyTasksToCreate.length) {
      console.log("[GUEST READY INSERT CHECK] About to insert", guestReadyTasksToCreate.length, "guest ready tasks");
      
      // Hard duplicate guard: check if any source_key already exists in DB
      const sourceKeysToInsert = guestReadyTasksToCreate.map(t => t.source_key);
      const { data: existingDuplicates, error: duplicateLookupError } = await supabase
        .from("cleaning_tasks")
        .select("id, source_key")
        .eq("property_id", propertyId)
        .in("source_key", sourceKeysToInsert);
      if (duplicateLookupError) {
        return createErrorResponse(`Could not verify Guest Ready task uniqueness: ${duplicateLookupError.message}`, 500);
      }

      if (existingDuplicates && existingDuplicates.length > 0) {
        console.log("[GUEST READY DUPLICATE GUARD] Found existing tasks, filtering out duplicates:", existingDuplicates.map((d: { source_key: string }) => d.source_key));
        const existingSourceKeys = new Set(existingDuplicates.map((d: { source_key: string }) => d.source_key));
        const filteredGuestReadyTasks = guestReadyTasksToCreate.filter(t => !existingSourceKeys.has(t.source_key));
        
        if (filteredGuestReadyTasks.length === 0) {
          console.log("[GUEST READY DUPLICATE GUARD] All guest ready tasks are duplicates, skipping insert");
        } else {
          console.log("[GUEST READY INSERT]", filteredGuestReadyTasks.length, "guest ready tasks after duplicate filtering");
          const { error } = await supabase.from("cleaning_tasks").insert(filteredGuestReadyTasks);
          if (error) {
            console.error("sync-ical fatal error", error?.message || error);
            console.error("sync-ical fatal stack", error?.stack || "no stack");
            return createErrorResponse(`Could not insert Guest Ready tasks: ${error.message}`, 500);
          }
          guestReadyTasksCreated += filteredGuestReadyTasks.length;
          tasksCreated += filteredGuestReadyTasks.length;
          console.log("STEP 5 guest ready tasks created");
        }
      } else {
        console.log("[GUEST READY INSERT]", guestReadyTasksToCreate.length, "guest ready tasks");
        const { error } = await supabase.from("cleaning_tasks").insert(guestReadyTasksToCreate);
        if (error) {
          console.error("sync-ical fatal error", error?.message || error);
          console.error("sync-ical fatal stack", error?.stack || "no stack");
          return createErrorResponse(`Could not insert Guest Ready tasks: ${error.message}`, 500);
        }
        guestReadyTasksCreated += guestReadyTasksToCreate.length;
        tasksCreated += guestReadyTasksToCreate.length;
        console.log("STEP 5 guest ready tasks created");
      }
    }

    console.log("STEP 6 returning success");
    return createSuccessResponse(reservationsCreated, tasksCreated, getSyncExtras());
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack || "no stack" : "no stack";
    console.error("sync-ical fatal error", errorMessage);
    console.error("sync-ical fatal stack", errorStack);
    return createErrorResponse(`iCal sync failed: ${errorMessage}`, 500);
  }
});