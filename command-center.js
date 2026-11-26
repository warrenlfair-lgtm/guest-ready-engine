const auth = document.getElementById("auth");
const dashboard = document.getElementById("dashboard");
const loginError = document.getElementById("login-error");
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const STALE_AFTER_MS = REFRESH_INTERVAL_MS + 30 * 1000;
let snapshot = null;
let lastSync = null;
let refreshInFlight = false;
let sessionUserId = null;
let generation = 0;
let lastRolloverAttempt = 0;
const escapeText = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function showAuth(message = "") {
  generation++;
  sessionUserId = null;
  snapshot = null;
  lastSync = null;
  document.getElementById("last-sync").textContent = "Last successful update: Not yet synced";
  dashboard.hidden = true;
  auth.hidden = false;
  for (const id of ["counters", "today-services", "tomorrow-services", "reviews", "special-tasks", "outlook"]) {
    document.getElementById(id).replaceChildren();
  }
  document.getElementById("password").value = "";
  loginError.textContent = message;
}

function displayList(id, entries, markup, extra = 0) {
  const list = document.getElementById(id);
  list.replaceChildren();
  if (!entries.length && !extra) {
    list.innerHTML = '<div class="empty">None</div>';
    return;
  }
  const overflow = document.createElement("div");
  overflow.className = "overflow";
  list.append(overflow);
  let visible = 0;
  for (const entry of entries) {
    const row = document.createElement("div");
    row.innerHTML = markup(entry);
    list.insertBefore(row, overflow);
    const remaining = entries.length - visible - 1 + extra;
    overflow.hidden = remaining === 0;
    overflow.textContent = id === "reviews" ? `${remaining} reports not shown` : `+ ${remaining} more items`;
    if (list.scrollHeight > list.clientHeight) {
      row.remove();
      break;
    }
    visible++;
  }
  const hidden = entries.length - visible + extra;
  overflow.hidden = hidden === 0;
  overflow.textContent = hidden ? (id === "reviews" ? `${hidden} reports not shown` : `+ ${hidden} more items`) : "";
}

function sizeReviewsPanel(reviews, markup) {
  const panel = document.querySelector(".reviews-panel");
  const column = panel.parentElement;
  const probe = panel.cloneNode(true);
  const list = probe.querySelector(".list");
  list.replaceChildren();
  for (const review of reviews) {
    const row = document.createElement("div");
    row.innerHTML = markup(review);
    list.append(row);
  }
  if (!reviews.length) list.innerHTML = '<div class="empty">None</div>';
  Object.assign(probe.style, {
    position: "fixed", visibility: "hidden", width: `${panel.getBoundingClientRect().width}px`,
    height: "auto", maxHeight: "none", flex: "none", left: "-10000px", top: "0",
  });
  list.style.flex = "none";
  document.body.append(probe);
  const desired = Math.ceil(probe.getBoundingClientRect().height);
  probe.remove();
  const gap = parseFloat(getComputedStyle(column).rowGap) || 0;
  const specialMinimum = Math.min(120, column.clientHeight * 0.25);
  panel.style.height = `${Math.max(0, Math.min(desired, column.clientHeight - specialMinimum - gap))}px`;
}

function render() {
  if (!snapshot) return;
  const model = ccModel(snapshot);
  document.getElementById("counters").innerHTML = model.counters.map(([label, count]) =>
    `<div class="counter"><strong>${count}</strong>${escapeText(label)}${label === "Overdue" ? `<span class="counter-detail">Services ${model.overdueCounts.services} · VP² ${model.overdueCounts.reviews} · Tasks ${model.overdueCounts.tasks}</span>` : ""}</div>`).join("");
  const service = (item) => {
    const status = ccCompleted(item) ? "completed" : ccOverdueService(item, model.today) ? "overdue" : "";
    const detail = [item.type || "Manual", item.guest_ready && item.type !== "Guest Ready" ? "Guest Ready" : "", item.off_cycle ? "Off-cycle" : "", item.technician, item.status || "Scheduled"].filter(Boolean).join(" · ");
    return `<div class="entry ${status}"><strong>${escapeText(item.property)}</strong><span class="detail">${escapeText(detail)}</span></div>`;
  };
  displayList("today-services", model.todayServices, service);
  displayList("tomorrow-services", model.tomorrowServices, service);
  const review = (item) => `<div class="entry ${item.date < model.today ? "overdue" : item.date > model.today ? "upcoming" : ""}"><strong>${escapeText(item.property)}</strong><span class="detail">${escapeText(item.date)} · ${escapeText(item.kind)} · ${escapeText(item.status)}</span></div>`;
  sizeReviewsPanel(model.reviews, review);
  displayList("reviews", model.reviews, review);
  displayList("special-tasks", model.special, (item) => `<div class="entry ${item.date && item.date < model.today ? "overdue" : item.date && item.date > model.today ? "upcoming" : ""}"><strong>${escapeText(item.title)}</strong><span class="detail">${escapeText([item.priority, item.property, item.technician, item.date, item.status].filter(Boolean).join(" · "))}</span>${item.description ? `<div>${escapeText(item.description)}</div>` : ""}</div>`, model.hiddenSpecial);
  document.getElementById("outlook").innerHTML = model.days.map((day) => {
    const label = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${day.date}T00:00:00Z`));
    return `<div class="day ${day.date === model.today ? "current" : ""}"><strong>${escapeText(label)}</strong><span${day.services > 0 ? ' class="has-services"' : ""}>Services ${day.services}</span><span>Arrivals ${day.arrivals}</span><span>VP² ${day.reviews}</span></div>`;
  }).join("");
}

function updateClock() {
  const now = new Date();
  document.getElementById("date").textContent = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", dateStyle: "full" }).format(now);
  document.getElementById("clock").textContent = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeStyle: "medium" }).format(now);
  if (lastSync && now - lastSync > STALE_AFTER_MS) {
    document.getElementById("connection").textContent = "Stale — awaiting synchronization";
    document.getElementById("connection").classList.add("stale");
  }
  if (snapshot && snapshot.business_date !== ccDate(now)) {
    document.getElementById("connection").textContent = "Stale — waiting for today's data";
    document.getElementById("connection").classList.add("stale");
    if (Date.now() - lastRolloverAttempt >= 60000) {
      lastRolloverAttempt = Date.now();
      void refresh();
    }
  }
}

async function refresh() {
  if (refreshInFlight || !sessionUserId) return;
  refreshInFlight = true;
  const requestGeneration = generation;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const { data, error, status } = await supabaseClient.rpc("command_center_snapshot").abortSignal(controller.signal);
    if (requestGeneration !== generation) return;
    if (error) {
      if (error.code === "42501" || error.code === "PGRST301" || status === 401 || status === 403) {
        showAuth("Your display session is not authorized. Sign in again.");
      } else {
        document.getElementById("connection").textContent = `Stale — connection error: ${error.message}`;
        document.getElementById("connection").classList.add("stale");
        if (!snapshot) loginError.textContent = `Could not load dashboard: ${error.message}`;
      }
      return;
    }
    if (data && data.snapshot_version !== 3) {
      throw new Error("Command Center database update required; run the updated Command Center migration");
    }
    if (!data || !data.business_date || !["services", "reviews", "arrivals", "tasks", "notes"].every((key) => Array.isArray(data[key]))) {
      throw new Error("Invalid dashboard data");
    }
    snapshot = data;
    lastSync = new Date();
    auth.hidden = true;
    dashboard.hidden = false;
    document.getElementById("connection").textContent = "Connected";
    document.getElementById("connection").classList.remove("stale");
    document.getElementById("last-sync").textContent = `Last successful update: ${new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", dateStyle: "short", timeStyle: "medium" }).format(lastSync)} ET`;
    render();
  } catch (error) {
    if (requestGeneration !== generation) return;
    document.getElementById("connection").textContent = `Stale — ${error.message}`;
    document.getElementById("connection").classList.add("stale");
    if (!snapshot) loginError.textContent = `Could not load dashboard: ${error.message}`;
  } finally {
    clearTimeout(timeout);
    refreshInFlight = false;
  }
}

document.getElementById("login").addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.textContent = "";
  const { error } = await supabaseClient.auth.signInWithPassword({
    email: document.getElementById("email").value.trim(),
    password: document.getElementById("password").value,
  });
  if (error) loginError.textContent = error.message;
});
supabaseClient.auth.onAuthStateChange((event, session) => {
  if (!session) { showAuth(event === "SIGNED_OUT" ? "Session ended. Please sign in." : ""); return; }
  if (sessionUserId !== session.user.id) {
    generation++;
    sessionUserId = session.user.id;
    snapshot = null;
    dashboard.hidden = true;
    auth.hidden = false;
    setTimeout(refresh, 0);
  }
});
supabaseClient.auth.getSession().then(({ data, error }) => {
  if (error) { showAuth(error.message); return; }
  if (data.session && !sessionUserId) {
    sessionUserId = data.session.user.id;
    void refresh();
  }
});
window.addEventListener("online", () => void refresh());
window.addEventListener("resize", () => render());
setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
setInterval(updateClock, 1000);
updateClock();
