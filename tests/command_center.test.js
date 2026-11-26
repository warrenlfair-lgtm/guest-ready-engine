// Run with JavaScriptCore: jsc tests/command_center.test.js
const core = new Function(`${readFile("command-center-core.js")}; return { ccDate, ccAddDays, ccWeekStart, ccModel, ccOverdueService };`)();
function assert(value, message) { if (!value) throw new Error(message); }
assert(core.ccDate(new Date("2026-03-08T04:59:59Z")) === "2026-03-07", "Business date must use Eastern time before midnight");
assert(core.ccDate(new Date("2026-03-08T05:00:00Z")) === "2026-03-08", "Business date must roll at Eastern midnight");
assert(core.ccDate(new Date("2026-11-01T04:00:00Z")) === "2026-11-01", "Fall DST midnight must use Eastern time");
assert(core.ccAddDays("2026-12-31", 1) === "2027-01-01", "Date arithmetic must cross year boundaries");
assert(core.ccWeekStart("2026-11-29") === "2026-11-23", "Sunday must belong to the preceding Monday week");
assert(core.ccWeekStart("2026-11-30") === "2026-11-30", "Monday must start a new week");
assert(core.ccWeekStart("2027-01-01") === "2026-12-28", "Week start must cross year boundaries");
const data = {
  business_date: "2026-11-26",
  services: [
    { id: "s1", date: "2026-11-26", status: "Scheduled" },
    { id: "s2", date: "2026-11-26", status: "Completed", overdue_reference_date: "2026-11-25" },
    { id: "s3", date: "2026-11-26", status: "In Progress", original_service_date: "2026-11-25", overdue_reference_date: "2026-11-25", carry_forward_count: 1 },
    { id: "s4", date: "2026-11-25", status: "Scheduled" },
    { id: "s5", date: "2026-11-27", status: "Scheduled" },
    { id: "s6", date: "2026-11-26", status: "Scheduled", original_service_date: "2026-11-25", overdue_reference_date: "2026-11-25", carry_forward_count: 0 },
    { id: "s7", date: "2026-11-26", status: "Scheduled", overdue_reference_date: "2026-11-25" },
    { id: "s8", date: "2026-11-26", status: "Scheduled", original_service_date: "2026-11-25", overdue_reference_date: "2026-11-25", carry_forward_count: 1, completed_at: "2026-11-26T14:00:00Z" },
    { id: "s9", date: "2026-11-27", status: "Scheduled", original_service_date: "2026-11-25", carry_forward_count: 1 },
  ],
  reviews: [
    { id: "r1", property: "A", date: "2026-11-25", status: "scheduled" },
    { id: "r2", property: "A", date: "2026-11-26", status: "in_progress" },
    { id: "r3", property: "A", date: "2026-11-26", status: "completed" },
    { id: "r4", property: "B", date: "2026-11-22", status: "needs_attention" },
    { id: "r5", property: "A", date: "2026-12-01", status: "scheduled" },
  ],
  arrivals: [{ id: "a1", date: "2026-11-26" }, { id: "a2", date: "2026-11-27" }],
  tasks: [
    { id: "t1", title: "Future", date: "2026-12-20", priority: "Normal" },
    { id: "t2", title: "Past", date: "2026-11-25", priority: "Normal" },
    { id: "t3", title: "Urgent", date: null, priority: "Urgent", pinned: true },
    { id: "t4", title: "Unpinned", date: null, priority: "Normal" },
  ],
  notes: [],
};
const model = core.ccModel(data);
assert(model.todayServices[0].id === "s3", "Overdue services must be first");
assert(model.counters.map((entry) => entry[1]).join(",") === "6,1,5,1,1,3", "Summary counters must include carried-forward services, outstanding reports and special tasks");
assert(model.overdueCounts.services === 1 && model.overdueCounts.reviews === 1 && model.overdueCounts.tasks === 1, "Overdue breakdown must distinguish each source");
assert(model.reviews.map((item) => item.id).join(",") === "r1,r2,r5", "Completed and prior-week reviews must be excluded without merging properties or losing upcoming reviews");
const monday = core.ccModel({ ...data, business_date: "2026-11-30", reviews: [
  { id: "sunday", date: "2026-11-29", status: "scheduled" },
  { id: "monday", date: "2026-11-30", status: "scheduled" },
  { id: "next-week", date: "2026-12-06", status: "scheduled" },
] });
assert(monday.overdueCounts.reviews === 0 && monday.reviews.map((item) => item.id).join(",") === "monday,next-week", "New week must exclude the prior Sunday but retain the seven-day outlook");
assert(model.special.map((item) => item.id).join(",") === "t2,t3,t1", "Special tasks must prioritize overdue and urgent");
assert(model.hiddenSpecial === 1, "Unpinned tasks without dates must be counted");
assert(model.days.length === 7 && model.days[0].reviews === 2 && model.days[1].arrivals === 1, "Outlook must include completed scheduled reports and arrivals");
assert(model.tomorrowServices.length === 2 && model.counters[3][1] === 1 && model.days[0].arrivals === 1, "Tomorrow's services and today's arrival counts must remain available");
assert(!core.ccOverdueService(data.services[1], data.business_date), "Completed services cannot be overdue");
assert(!core.ccOverdueService(data.services[3], data.business_date), "Historical tasks outside today's route cannot be counted");
assert(!core.ccOverdueService(data.services[5], data.business_date), "A manually rescheduled task is not an automatic carry-forward");
assert(!core.ccOverdueService(data.services[6], data.business_date), "An overdue reference alone is not a carry-forward");
assert(!core.ccOverdueService(data.services[7], data.business_date), "A completed timestamp prevents an overdue service");
assert(!core.ccOverdueService(data.services[8], data.business_date), "Tomorrow's carry-forward is not overdue on today's route");
print("PASS: Command Center dates, counters, service priority, VP2 reviews and outlook");
