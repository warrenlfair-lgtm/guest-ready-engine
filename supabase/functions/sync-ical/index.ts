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

function createSuccessResponse(
  reservationsCreated = 0,
  tasksCreated = 0,
  extras: {
    reservationsParsed?: number;
    activeReservations?: number;
    oldIgnored?: number;
    weeklyTasksCreated?: number;
    guestReadyTasksCreated?: number;
  } = {}
) {
  return new Response(JSON.stringify({
    success: true,
    reservationsCreated,
    tasksCreated,
    reservationsParsed: extras.reservationsParsed ?? 0,
    activeReservations: extras.activeReservations ?? 0,
    oldIgnored: extras.oldIgnored ?? 0,
    weeklyTasksCreated: extras.weeklyTasksCreated ?? 0,
    guestReadyTasksCreated: extras.guestReadyTasksCreated ?? 0,
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
  const reservations: Array<{ check_in: string; check_out: string | null; summary: string | null }> = [];

  for (const eventText of events) {
    const checkInMatch = eventText.match(/DTSTART(?:;VALUE=DATE)?:(\d{8})(?:T\d{6}Z?)?/i);
    if (!checkInMatch) continue;

    const checkOutMatch = eventText.match(/DTEND(?:;VALUE=DATE)?:(\d{8})(?:T\d{6}Z?)?/i);
    const summaryMatch = eventText.match(/SUMMARY:(.*)/i);

    const check_in = `${checkInMatch[1].slice(0, 4)}-${checkInMatch[1].slice(4, 6)}-${checkInMatch[1].slice(6, 8)}`;
    const check_out = checkOutMatch
      ? `${checkOutMatch[1].slice(0, 4)}-${checkOutMatch[1].slice(4, 6)}-${checkOutMatch[1].slice(6, 8)}`
      : null;
    const summary = summaryMatch ? summaryMatch[1].trim() : null;
    reservations.push({ check_in, check_out, summary });
  }

  return reservations;
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

function getGuestReadyServiceDate(reservation: { check_in: string; check_out: string | null }, activeReservations: Array<{ check_in: string; check_out: string | null }>) {
  const hasSameDayTurnover = activeReservations.some((candidate) => {
    return candidate.check_in && candidate.check_in !== reservation.check_in && candidate.check_out === reservation.check_in;
  });

  return hasSameDayTurnover ? reservation.check_in : addDays(reservation.check_in, -1);
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

function isSafeAutoWeeklyTaskToSuppress(task: { manually_modified: boolean | null; status: string | null; completed_at: string | null; invoiced: boolean | null }) {
  const status = task.status || "Scheduled";
  return !task.manually_modified && status === "Scheduled" && !task.completed_at && !task.invoiced;
}

Deno.serve(async (req) => {
  let reservationsCreated = 0;
  let tasksCreated = 0;
  let reservationsParsed = 0;
  let activeReservationCount = 0;
  let oldIgnored = 0;
  let weeklyTasksCreated = 0;
  let guestReadyTasksCreated = 0;

  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  try {
    if (req.method !== "POST") {
      return createSuccessResponse(reservationsCreated, tasksCreated);
    }

    let body;
    try {
      body = await req.json();
    } catch {
      return createSuccessResponse(reservationsCreated, tasksCreated);
    }

    const propertyId = body?.property_id;
    if (!propertyId) {
      return createSuccessResponse(reservationsCreated, tasksCreated);
    }

    const { data: properties, error: propertyError } = await supabase
      .from("properties")
      .select("*")
      .eq("id", propertyId)
      .limit(1)
      .single();

    if (propertyError || !properties) {
      return createSuccessResponse(reservationsCreated, tasksCreated);
    }

    const property = properties as { id: string; ical_url: string | null; default_off_cycle_charge: number | null; standard_service_day: string | null; coverage_days: number | null; coverage_rule: string | null };
    console.log("STEP 1 property loaded");
    if (!property.ical_url) {
      return createSuccessResponse(reservationsCreated, tasksCreated);
    }

    let icalText: string;
    try {
      const response = await fetch(property.ical_url);
      if (!response.ok) {
        return createSuccessResponse(reservationsCreated, tasksCreated);
      }
      icalText = await response.text();
    } catch {
      return createSuccessResponse(reservationsCreated, tasksCreated);
    }

    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const cutoff = new Date(currentMonthStart);
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffDate = cutoff.toISOString().split("T")[0];

    const { error: cleanupCleaningError } = await supabase
      .from("cleaning_tasks")
      .delete()
      .eq("property_id", propertyId)
      .lt("service_date", cutoffDate);

    if (cleanupCleaningError) {
      console.error("sync-ical fatal error", cleanupCleaningError);
      return createSuccessResponse(reservationsCreated, tasksCreated);
    }

    const { error: cleanupReservationsError } = await supabase
      .from("reservations")
      .delete()
      .eq("property_id", propertyId)
      .lt("check_out", cutoffDate);

    if (cleanupReservationsError) {
      console.error("sync-ical fatal error", cleanupReservationsError);
      return createSuccessResponse(reservationsCreated, tasksCreated);
    }

    const parsedReservations = parseICalReservations(icalText);
    reservationsParsed = parsedReservations.length;

    console.log("cutoffDate", cutoffDate);
    console.log("parsedReservations", parsedReservations.length);

    const activeReservations = parsedReservations.filter((res) => {
      return res.check_out != null && res.check_out >= cutoffDate;
    });
    activeReservationCount = activeReservations.length;
    oldIgnored = reservationsParsed - activeReservationCount;

    console.log("STEP 2 reservations checked");
    console.log("activeReservations", activeReservations.length);
    console.log("ignored old reservations", parsedReservations.length - activeReservations.length);

    if (!activeReservations.length) {
      return createSuccessResponse(reservationsCreated, tasksCreated, { reservationsParsed, activeReservations: activeReservationCount, oldIgnored, weeklyTasksCreated, guestReadyTasksCreated });
    }

    const checkIns = activeReservations.filter((reservation) => reservation.check_in).map((reservation) => reservation.check_in);

    const { data: existingReservations } = checkIns.length
      ? await supabase
          .from("reservations")
          .select("check_in")
          .eq("property_id", propertyId)
          .in("check_in", checkIns)
      : { data: [] };

    const existingReservationKeys = new Set((existingReservations || []).map((r: { check_in: string }) => r.check_in));

    const newReservations = activeReservations
      .filter((reservation) => reservation.check_in)
      .filter((reservation) => !existingReservationKeys.has(reservation.check_in))
      .map((reservation) => ({
        property_id: propertyId,
        guest_name: reservation.summary || null,
        check_in: reservation.check_in,
        check_out: reservation.check_out || null,
        reservation_uid: null,
        imported_at: new Date().toISOString(),
        source: "ical",
      }));

    if (newReservations.length) {
      const { error } = await supabase.from("reservations").insert(newReservations);
      if (error) {
        console.error("sync-ical fatal error", error?.message || error);
        console.error("sync-ical fatal stack", error?.stack || "no stack");
        return createSuccessResponse(reservationsCreated, tasksCreated);
      }
      reservationsCreated = newReservations.length;
      console.log("STEP 3 reservations inserted");
    }

    const standardDay = property.standard_service_day || "Wednesday";
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

    const { data: existingGuestReadyWindowTasks } = windowQueryStart && windowQueryEnd
      ? await supabase
          .from("cleaning_tasks")
          .select("id, service_date, status, check_in_date, service_type")
          .eq("property_id", propertyId)
          .eq("service_type", "Guest Ready")
          .gte("service_date", windowQueryStart)
          .lte("service_date", windowQueryEnd)
      : { data: [] };

    // Lookup 1: by original service_date — catches tasks that predate the source_key column
    const { data: existingByDate } = weeklyServiceDates.length
      ? await supabase
          .from("cleaning_tasks")
          .select("id, service_date, service_type, guest_ready, check_in_date, source_key, manually_modified, status, completed_at, invoiced")
          .eq("property_id", propertyId)
          .eq("service_type", "Weekly Standard")
          .in("service_date", weeklyServiceDates)
      : { data: [] };

    // Lookup 2: by source_key — catches tasks that were manually moved to a different date
    const { data: existingByKey } = weeklySourceKeys.length
      ? await supabase
          .from("cleaning_tasks")
          .select("id, service_date, service_type, guest_ready, check_in_date, source_key, manually_modified, status, completed_at, invoiced")
          .eq("property_id", propertyId)
          .eq("service_type", "Weekly Standard")
          .in("source_key", weeklySourceKeys)
      : { data: [] };

    type WeeklyTaskRecord = { id: string; service_date: string; service_type: string; guest_ready: boolean; check_in_date: string | null; source_key: string | null; manually_modified: boolean | null; status: string | null; completed_at: string | null; invoiced: boolean | null };
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

    // Lookup existing Guest Ready tasks by check_in_date (reservation identity)
    const { data: existingGuestReadyTasks } = checkIns.length
      ? await supabase
          .from("cleaning_tasks")
          .select("id, service_date, check_in_date, service_type, source_key, manually_modified")
          .eq("property_id", propertyId)
          .in("check_in_date", checkIns)
          .eq("service_type", "Guest Ready")
      : { data: [] };

    type GuestReadyTaskRecord = { id: string; service_date: string; check_in_date: string; service_type: string; source_key: string | null; manually_modified: boolean | null };
    const existingGuestReadyMap = new Map<string, GuestReadyTaskRecord>();
    for (const task of (existingGuestReadyTasks || []) as GuestReadyTaskRecord[]) {
      const sk = task.source_key || `gr:${propertyId}:${task.check_in_date}`;
      existingGuestReadyMap.set(sk, task);
    }

    const pendingWeeklyTasks = new Map<string, { check_in_date: string | null; guest_ready: boolean }>();
    const weeklyTaskUpdates: Array<{ id: string; guest_ready: boolean; check_in_date: string | null }> = [];
    const weeklyTaskIdsToSuppress: string[] = [];
    const suppressedWeeklySourceKeys = new Set<string>();
    const guestReadyTasksToCreate: Array<Record<string, any>> = [];

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
    console.log("[SYNC] existingGuestReadyMap size:", existingGuestReadyMap.size);

    for (const reservation of activeReservations) {
      if (!reservation.check_in) continue;

      const service_date = getServiceDateForWeek(reservation.check_in, standardDay);
      const guestReadyServiceDate = getGuestReadyServiceDate(reservation, activeReservations);
      const guestReadyWithinWindow = isDateWithinCoverageRule(service_date, guestReadyServiceDate, coverageRule);
      const isSameDayAsStandard = reservation.check_in === service_date;
      const source_key = `wk:${propertyId}:${service_date}`;
      const weeklyTask = existingWeeklyTaskMap.get(source_key);

      if (guestReadyWithinWindow) {
        suppressedWeeklySourceKeys.add(source_key);
      }

      console.log("[WEEKLY CHECK]", { reservation_check_in: reservation.check_in, source_key, foundExistingTask: !!weeklyTask, weeklyTask_id: weeklyTask?.id });

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
            console.log("[WEEKLY ADD PENDING]", { source_key, service_date, propertyId, is_same_day: isSameDayAsStandard });
            pendingWeeklyTasks.set(service_date, {
              check_in_date: isSameDayAsStandard ? reservation.check_in : null,
              guest_ready: isSameDayAsStandard,
            });
          }
        }
      }

      const guestReadyCharge = getGuestReadyCharge(guestReadyServiceDate, standardDay, coverageRule, property.default_off_cycle_charge);
      const guestReadySourceKey = `gr:${propertyId}:${reservation.check_in}`;
      const existingGuestReady = existingGuestReadyMap.get(guestReadySourceKey);

      console.log("[GUEST READY CHECK]", { reservation_check_in: reservation.check_in, source_key: guestReadySourceKey, foundExistingTask: !!existingGuestReady, existing_id: existingGuestReady?.id, within_window: guestReadyWithinWindow });

      if (existingGuestReady) {
        // Task already exists for this check-in. Never create a duplicate.
        // Don't overwrite manually_modified tasks.
        console.log("[GUEST READY SKIPPING]", { source_key: guestReadySourceKey, propertyId, existing_service_date: existingGuestReady.service_date });
      } else {
        console.log("[GUEST READY ADD PENDING]", { source_key: guestReadySourceKey, propertyId, service_date: guestReadyServiceDate });
        guestReadyTasksToCreate.push({
          property_id: propertyId,
          service_date: guestReadyServiceDate,
          scheduled_date: guestReadyServiceDate,
          suggested_date: guestReadyServiceDate,
          check_in_date: reservation.check_in,
          service_type: "Guest Ready",
          status: "Scheduled",
          off_cycle: guestReadyCharge > 0,
          guest_ready: true,
          charge: guestReadyCharge,
          notes: `Auto-created from iCal sync for check-in ${reservation.check_in}.`,
          source_type: "reservation_guest_ready",
          source_key: guestReadySourceKey,
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
        return createSuccessResponse(reservationsCreated, tasksCreated, { reservationsParsed, activeReservations: activeReservationCount, oldIgnored, weeklyTasksCreated, guestReadyTasksCreated });
      }
      console.log("[WEEKLY SUPPRESS APPLIED]", weeklyTaskIdsToSuppress.length, "weekly tasks removed");
    }

    const weeklyTasksToCreate = Array.from(pendingWeeklyTasks.entries())
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
      charge: 0,
      notes: `Auto-created Weekly Standard for the week covering service date ${service_date}.`,
      source_type: "weekly_standard",
      source_key: `wk:${propertyId}:${service_date}`,
      manually_modified: false,
    }));

    if (weeklyTasksToCreate.length) {
      console.log("[WEEKLY INSERT CHECK] About to insert", weeklyTasksToCreate.length, "weekly tasks");
      
      // Hard duplicate guard: check if any source_key already exists in DB
      const sourceKeysToInsert = weeklyTasksToCreate.map(t => t.source_key);
      const { data: existingDuplicates } = await supabase
        .from("cleaning_tasks")
        .select("id, source_key")
        .eq("property_id", propertyId)
        .in("source_key", sourceKeysToInsert);

      if (existingDuplicates && existingDuplicates.length > 0) {
        console.log("[WEEKLY DUPLICATE GUARD] Found existing tasks, filtering out duplicates:", existingDuplicates.map(d => d.source_key));
        const existingSourceKeys = new Set(existingDuplicates.map(d => d.source_key));
        const filteredWeeklyTasks = weeklyTasksToCreate.filter(t => !existingSourceKeys.has(t.source_key));
        
        if (filteredWeeklyTasks.length === 0) {
          console.log("[WEEKLY DUPLICATE GUARD] All weekly tasks are duplicates, skipping insert");
        } else {
          console.log("[WEEKLY INSERT]", filteredWeeklyTasks.length, "weekly tasks after duplicate filtering");
          const { error } = await supabase.from("cleaning_tasks").insert(filteredWeeklyTasks);
          if (error) {
            console.error("sync-ical fatal error", error?.message || error);
            console.error("sync-ical fatal stack", error?.stack || "no stack");
            return createSuccessResponse(reservationsCreated, tasksCreated, { reservationsParsed, activeReservations: activeReservationCount, oldIgnored, weeklyTasksCreated, guestReadyTasksCreated });
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
          return createSuccessResponse(reservationsCreated, tasksCreated, { reservationsParsed, activeReservations: activeReservationCount, oldIgnored, weeklyTasksCreated, guestReadyTasksCreated });
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
        return createSuccessResponse(reservationsCreated, tasksCreated);
      }
    }

    if (guestReadyTasksToCreate.length) {
      console.log("[GUEST READY INSERT CHECK] About to insert", guestReadyTasksToCreate.length, "guest ready tasks");
      
      // Hard duplicate guard: check if any source_key already exists in DB
      const sourceKeysToInsert = guestReadyTasksToCreate.map(t => t.source_key);
      const { data: existingDuplicates } = await supabase
        .from("cleaning_tasks")
        .select("id, source_key")
        .eq("property_id", propertyId)
        .in("source_key", sourceKeysToInsert);

      if (existingDuplicates && existingDuplicates.length > 0) {
        console.log("[GUEST READY DUPLICATE GUARD] Found existing tasks, filtering out duplicates:", existingDuplicates.map(d => d.source_key));
        const existingSourceKeys = new Set(existingDuplicates.map(d => d.source_key));
        const filteredGuestReadyTasks = guestReadyTasksToCreate.filter(t => !existingSourceKeys.has(t.source_key));
        
        if (filteredGuestReadyTasks.length === 0) {
          console.log("[GUEST READY DUPLICATE GUARD] All guest ready tasks are duplicates, skipping insert");
        } else {
          console.log("[GUEST READY INSERT]", filteredGuestReadyTasks.length, "guest ready tasks after duplicate filtering");
          const { error } = await supabase.from("cleaning_tasks").insert(filteredGuestReadyTasks);
          if (error) {
            console.error("sync-ical fatal error", error?.message || error);
            console.error("sync-ical fatal stack", error?.stack || "no stack");
            return createSuccessResponse(reservationsCreated, tasksCreated, { reservationsParsed, activeReservations: activeReservationCount, oldIgnored, weeklyTasksCreated, guestReadyTasksCreated });
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
          return createSuccessResponse(reservationsCreated, tasksCreated, { reservationsParsed, activeReservations: activeReservationCount, oldIgnored, weeklyTasksCreated, guestReadyTasksCreated });
        }
        guestReadyTasksCreated += guestReadyTasksToCreate.length;
        tasksCreated += guestReadyTasksToCreate.length;
        console.log("STEP 5 guest ready tasks created");
      }
    }

    console.log("STEP 6 returning success");
    return createSuccessResponse(reservationsCreated, tasksCreated, { reservationsParsed, activeReservations: activeReservationCount, oldIgnored, weeklyTasksCreated, guestReadyTasksCreated });
  } catch (error) {
    console.error("sync-ical fatal error", error?.message || error);
    console.error("sync-ical fatal stack", error?.stack || "no stack");
    return createSuccessResponse(reservationsCreated, tasksCreated, { reservationsParsed, activeReservations: activeReservationCount, oldIgnored, weeklyTasksCreated, guestReadyTasksCreated });
  }
});