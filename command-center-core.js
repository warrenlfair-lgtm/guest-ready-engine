function ccDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (name) => parts.find((item) => item.type === name).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function ccAddDays(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function ccCompleted(item) {
  return String(item.status || "").toLowerCase() === "completed";
}

function ccWeekStart(date) {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return ccAddDays(date, -((weekday + 6) % 7));
}

function ccOverdueService(item, today) {
  const referenceDate = item.overdue_reference_date || item.original_service_date;
  return item.date === today && !ccCompleted(item) && !item.completed_at
    && Boolean(item.original_service_date && referenceDate && Number(item.carry_forward_count) >= 1
      && referenceDate < item.date);
}

function ccModel(data) {
  const today = data.business_date;
  const tomorrow = ccAddDays(today, 1);
  const services = data.services;
  const todayServices = services.filter((item) => item.date === today).sort((a, b) =>
    Number(ccOverdueService(b, today)) - Number(ccOverdueService(a, today)));
  const weekStart = ccWeekStart(today);
  const reviews = data.reviews.filter((item) => !ccCompleted(item) && item.date >= weekStart && item.date <= ccAddDays(today, 6));
  const overdueCounts = {
    services: services.filter((item) => ccOverdueService(item, today)).length,
    reviews: reviews.filter((item) => item.date < today).length,
    tasks: data.tasks.filter((item) => item.date && item.date < today).length,
  };
  const special = data.tasks.filter((item) => item.pinned || item.date);
  special.sort((a, b) => {
    const rank = (item) => item.date && item.date < today ? 0 : item.priority === "Urgent" ? 1 : item.date === today ? 2 : item.pinned ? 3 : 4;
    return rank(a) - rank(b) || String(a.date || "9999").localeCompare(String(b.date || "9999")) || a.title.localeCompare(b.title);
  });
  return {
    today, tomorrow, todayServices,
    tomorrowServices: services.filter((item) => item.date === tomorrow),
    reviews,
    special, hiddenSpecial: data.tasks.length - special.length, notes: data.notes, overdueCounts,
    counters: [
      ["Scheduled", todayServices.length],
      ["Completed", todayServices.filter(ccCompleted).length],
      ["Remaining", todayServices.filter((item) => !ccCompleted(item)).length],
      ["Guest check-ins", data.arrivals.filter((item) => item.date.slice(0, 10) === today).length],
      ["VP² due today", reviews.filter((item) => item.date === today).length],
      ["Overdue", overdueCounts.services + overdueCounts.reviews + overdueCounts.tasks],
    ],
    days: Array.from({ length: 7 }, (_, index) => {
      const date = ccAddDays(today, index);
      return { date, services: services.filter((item) => item.date === date).length,
        arrivals: data.arrivals.filter((item) => item.date.slice(0, 10) === date).length,
        reviews: data.reviews.filter((item) => item.date === date).length };
    }),
  };
}
