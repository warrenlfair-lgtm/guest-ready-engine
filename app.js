let properties = [];
let cleaningTasks = [];
let reservations = [];
let operationsReminders = [];
let chemicalUsageEntries = [];

const DEFAULT_COMPANY_PROFILE = {
  company_name: "Guest Ready™",
  tagline: "Powered by Guest Engine™",
  phone_number: "",
  email: "",
  logo_url: "",
  admin_pin: "1234",
};

let companyProfile = { ...DEFAULT_COMPANY_PROFILE };

let editingPropertyId = null;
let selectedCleaningPropertyId = null;
let editingCleaningId = null;
let editingReminderPropertyId = null;
let editingReminderId = null;
let editingChemicalUsageId = null;

let selectedPropertyFilter = "";
let selectedMonthFilter = "current";
let collapsedPropertyCards = new Set();
let propertyDetailTabState = new Map();
let propertyChemicalFilterState = new Map();
let latestChemicalReportState = {
  startDate: "",
  endDate: "",
  selectedPropertyId: "",
  selectedChemical: "",
  rows: [],
};
let weekViewMode = localStorage.getItem("guestReadyDefaultWeekView") || "calendar";
const PROTECTED_VIEWS = new Set(["reports"]);
let isProtectedAccessUnlocked = false;
let pinModalResolver = null;
const MANUAL_BILLING_OVERRIDE_TAG = "[Manual Override]";
const CHEMICAL_NAME_OPTIONS = [
  "Liquid Chlorine",
  "Chlorine Tablets",
  "pH Up",
  "pH Down",
  "Alkalinity Up",
  "Alkalinity Down",
  "Stabilizer / CYA",
  "Calcium Hardness Increaser",
  "Algaecide",
  "Clarifier",
  "Phosphate Remover",
  "Salt",
  "Other",
];
const CHEMICAL_UNIT_OPTIONS = ["gallons", "pounds", "ounces", "tablets", "bags", "quarts"];

const addPropertyBtn = document.getElementById("addPropertyBtn");
const propertyModal = document.getElementById("propertyModal");
const cancelBtn = document.getElementById("cancelBtn");
const savePropertyBtn = document.getElementById("savePropertyBtn");
const propertyList = document.getElementById("propertyList");
const statusMessage = document.getElementById("statusMessage");

const cleaningModal = document.getElementById("cleaningModal");
const cancelCleaningBtn = document.getElementById("cancelCleaningBtn");
const saveCleaningBtn = document.getElementById("saveCleaningBtn");

const propertyName = document.getElementById("propertyName");
const propertyClientName = document.getElementById("propertyClientName");
const propertyAddress = document.getElementById("propertyAddress");
const propertyIcal = document.getElementById("propertyIcal");
const standardDay = document.getElementById("standardDay");
const coverageDays = document.getElementById("coverageDays");
const coverageRule = document.getElementById("coverageRule");
const offCycleCharge = document.getElementById("offCycleCharge");

const cleaningDate = document.getElementById("cleaningDate");
const cleaningServiceType = document.getElementById("cleaningServiceType");
const cleaningStatus = document.getElementById("cleaningStatus");
const cleaningTechnician = document.getElementById("cleaningTechnician");
const cleaningCharge = document.getElementById("cleaningCharge");
const cleaningNotes = document.getElementById("cleaningNotes");
const addChemicalBtn = document.getElementById("addChemicalBtn");
const chemicalUsageTaskHint = document.getElementById("chemicalUsageTaskHint");
const chemicalUsageList = document.getElementById("chemicalUsageList");
const chemicalUsageModal = document.getElementById("chemicalUsageModal");
const chemicalNameSelect = document.getElementById("chemicalNameSelect");
const chemicalQuantityInput = document.getElementById("chemicalQuantityInput");
const chemicalUnitSelect = document.getElementById("chemicalUnitSelect");
const chemicalNotesInput = document.getElementById("chemicalNotesInput");
const cancelChemicalBtn = document.getElementById("cancelChemicalBtn");
const saveChemicalBtn = document.getElementById("saveChemicalBtn");
const viewButtons = Array.from(document.querySelectorAll(".view-btn"));
const todayTasksContainer = document.getElementById("todayTasks");
const guestProtectionAlertsContainer = document.getElementById("guestProtectionAlerts");
const operationsRemindersWidget = document.getElementById("operationsRemindersWidget");
const reminderModal = document.getElementById("reminderModal");
const reminderTitle = document.getElementById("reminderTitle");
const reminderNotes = document.getElementById("reminderNotes");
const reminderDueDate = document.getElementById("reminderDueDate");
const cancelReminderBtn = document.getElementById("cancelReminderBtn");
const saveReminderBtn = document.getElementById("saveReminderBtn");
const alertDetailModal = document.getElementById("alertDetailModal");
const alertDetailBody = document.getElementById("alertDetailBody");
const closeAlertDetailBtn = document.getElementById("closeAlertDetailBtn");
const pinModal = document.getElementById("pinModal");
const pinInput = document.getElementById("pinInput");
const pinError = document.getElementById("pinError");
const pinUnlockBtn = document.getElementById("pinUnlockBtn");
const pinCancelBtn = document.getElementById("pinCancelBtn");
const weekTasksContainer = document.getElementById("weekTasks");
const weekTasksCalendarContainer = document.getElementById("weekTasksCalendar");
const weekViewToggleButtons = Array.from(document.querySelectorAll(".week-view-btn"));
const debugTasksBtn = document.getElementById("debugTasksBtn");
const debugTaskCount = document.getElementById("debugTaskCount");
const propertyFilterSelect = document.getElementById("propertyFilterSelect");
const monthFilterSelect = document.getElementById("monthFilterSelect");
const weekViewDefaultCheckbox = document.getElementById("weekViewDefault");
const billingStartDate = document.getElementById("billingStartDate");
const billingEndDate = document.getElementById("billingEndDate");
const billingPropertySelect = document.getElementById("billingPropertySelect");
const billingReconciledOnly = document.getElementById("billingReconciledOnly");
const billingRunBtn = document.getElementById("billingRunBtn");
const billingPrintBtn = document.getElementById("billingPrintBtn");
const billingReportContainer = document.getElementById("billingReportContainer");
const routeFragStartDate = document.getElementById("routeFragStartDate");
const routeFragEndDate = document.getElementById("routeFragEndDate");
const routeFragClientSelect = document.getElementById("routeFragClientSelect");
const routeFragRunBtn = document.getElementById("routeFragRunBtn");
const routeFragContainer = document.getElementById("routeFragContainer");
const chemicalReportStartDate = document.getElementById("chemicalReportStartDate");
const chemicalReportEndDate = document.getElementById("chemicalReportEndDate");
const chemicalReportPropertySelect = document.getElementById("chemicalReportPropertySelect");
const chemicalReportTypeSelect = document.getElementById("chemicalReportTypeSelect");
const chemicalReportContainer = document.getElementById("chemicalReportContainer");
const chemicalReportPrintBtn = document.getElementById("chemicalReportPrintBtn");
const chemicalReportPdfBtn = document.getElementById("chemicalReportPdfBtn");
const chemicalReportShareBtn = document.getElementById("chemicalReportShareBtn");
const messageWeekDate = document.getElementById("messageWeekDate");
const messageUnassignedName = document.getElementById("messageUnassignedName");
const messagesByTech = document.getElementById("messagesByTech");
const messagesBranding = document.getElementById("messagesBranding");
const companyHeaderLogo = document.getElementById("companyHeaderLogo");
const companyHeaderName = document.getElementById("companyHeaderName");
const companyHeaderTagline = document.getElementById("companyHeaderTagline");
const companyNameInput = document.getElementById("companyNameInput");
const companyTaglineInput = document.getElementById("companyTaglineInput");
const companyPhoneInput = document.getElementById("companyPhoneInput");
const companyEmailInput = document.getElementById("companyEmailInput");
const companyLogoUrlInput = document.getElementById("companyLogoUrlInput");
const companyLogoFileInput = document.getElementById("companyLogoFileInput");
const uploadCompanyLogoBtn = document.getElementById("uploadCompanyLogoBtn");
const companyLogoPreview = document.getElementById("companyLogoPreview");
const companyLogoPreviewEmpty = document.getElementById("companyLogoPreviewEmpty");
const adminPinInput = document.getElementById("adminPinInput");
const confirmAdminPinInput = document.getElementById("confirmAdminPinInput");
const saveCompanyProfileBtn = document.getElementById("saveCompanyProfileBtn");
const settingsStatus = document.getElementById("settingsStatus");
const companyLogoUploadFeature = document.getElementById("companyLogoUploadFeature");

const COMPANY_LOGO_BUCKET = "company-logos";

addPropertyBtn.onclick = openAddModal;
cancelBtn.onclick = closePropertyModal;
savePropertyBtn.onclick = saveProperty;

cancelCleaningBtn.onclick = closeCleaningModal;
saveCleaningBtn.onclick = saveCleaningTask;

if (addChemicalBtn) {
  addChemicalBtn.addEventListener("click", () => openChemicalUsageModal());
}

if (cancelChemicalBtn) {
  cancelChemicalBtn.addEventListener("click", closeChemicalUsageModal);
}

if (saveChemicalBtn) {
  saveChemicalBtn.addEventListener("click", saveChemicalUsageEntry);
}

if (cleaningStatus) {
  cleaningStatus.addEventListener("change", renderChemicalUsageForCurrentTask);
}

cancelReminderBtn.onclick = closeReminderModal;
saveReminderBtn.onclick = saveReminder;
closeAlertDetailBtn.onclick = closeAlertDetail;

const syncAllIcalBtn = document.getElementById("syncAllIcalBtn");
const syncAllStatus = document.getElementById("syncAllStatus");
if (syncAllIcalBtn) {
  syncAllIcalBtn.addEventListener("click", syncAllIcal);
}

Array.from(document.querySelectorAll(".quick-btn")).forEach((btn) => {
  btn.addEventListener("click", (e) => setReminderQuickDate(e.target.dataset.option));
});

viewButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    await navigateToView(button.dataset.view);
  });
});

propertyFilterSelect.addEventListener("change", (e) => {
  selectedPropertyFilter = e.target.value;
  renderProperties();
});

monthFilterSelect.addEventListener("change", async (e) => {
  selectedMonthFilter = e.target.value;
  await ensureWeeklyStandardTasksForMonth(selectedMonthFilter);
  renderProperties();
  renderTaskViews();
});

weekViewToggleButtons.forEach((button) => {
  button.addEventListener("click", () => {
    weekViewMode = button.dataset.mode;
    if (weekViewDefaultCheckbox.checked) {
      localStorage.setItem("guestReadyDefaultWeekView", weekViewMode);
    }
    weekViewToggleButtons.forEach(b => b.classList.remove("active"));
    button.classList.add("active");
    renderWeekView();
  });
});

if (debugTasksBtn) {
  debugTasksBtn.addEventListener("click", debugCleaningTasks);
}

if (billingRunBtn) {
  billingRunBtn.addEventListener("click", renderBillingReport);
}

if (billingPrintBtn) {
  billingPrintBtn.addEventListener("click", printBillingReport);
}

if (billingStartDate) {
  billingStartDate.addEventListener("change", renderBillingReport);
}

if (billingEndDate) {
  billingEndDate.addEventListener("change", renderBillingReport);
}

if (billingPropertySelect) {
  billingPropertySelect.addEventListener("change", renderBillingReport);
}

if (billingReconciledOnly) {
  billingReconciledOnly.addEventListener("change", renderBillingReport);
}

if (routeFragRunBtn) {
  routeFragRunBtn.addEventListener("click", renderRouteFragmentationAnalytics);
}

if (routeFragStartDate) {
  routeFragStartDate.addEventListener("change", renderRouteFragmentationAnalytics);
}

if (routeFragEndDate) {
  routeFragEndDate.addEventListener("change", renderRouteFragmentationAnalytics);
}

if (routeFragClientSelect) {
  routeFragClientSelect.addEventListener("change", renderRouteFragmentationAnalytics);
}

if (chemicalReportStartDate) {
  chemicalReportStartDate.addEventListener("change", renderChemicalUsageReport);
}

if (chemicalReportEndDate) {
  chemicalReportEndDate.addEventListener("change", renderChemicalUsageReport);
}

if (chemicalReportPropertySelect) {
  chemicalReportPropertySelect.addEventListener("change", renderChemicalUsageReport);
}

if (chemicalReportTypeSelect) {
  chemicalReportTypeSelect.addEventListener("change", renderChemicalUsageReport);
}

if (chemicalReportPrintBtn) {
  chemicalReportPrintBtn.addEventListener("click", printChemicalUsageReport);
}

if (chemicalReportPdfBtn) {
  chemicalReportPdfBtn.addEventListener("click", downloadChemicalUsagePdf);
}

if (chemicalReportShareBtn) {
  chemicalReportShareBtn.addEventListener("click", shareChemicalUsageReport);
}

if (messageWeekDate) {
  messageWeekDate.addEventListener("change", renderMessagesPreview);
}

if (messageUnassignedName) {
  messageUnassignedName.addEventListener("input", renderMessagesPreview);
}

if (saveCompanyProfileBtn) {
  saveCompanyProfileBtn.addEventListener("click", saveCompanyProfile);
}

if (companyLogoUrlInput) {
  companyLogoUrlInput.addEventListener("input", () => {
    renderCompanyLogoPreview(companyLogoUrlInput.value);
  });
}

if (uploadCompanyLogoBtn) {
  uploadCompanyLogoBtn.addEventListener("click", uploadCompanyLogo);
}

initializeWeekViewMode();
initializeBillingReportFilters();
initializeRouteFragmentationFilters();
initializeChemicalReportFilters();
initializeMessagesDefaults();
initializeChemicalUsageOptions();
loadData();

function initializeWeekViewMode() {
  const savedMode = localStorage.getItem("guestReadyDefaultWeekView") || "calendar";
  weekViewMode = savedMode;
  weekViewToggleButtons.forEach(button => {
    if (button.dataset.mode === weekViewMode) {
      button.classList.add("active");
    } else {
      button.classList.remove("active");
    }
  });
}

function showView(viewName) {
  document.querySelectorAll(".view-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `${viewName}View`);
  });

  document.querySelectorAll(".view-btn").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === viewName);
  });

  if (viewName === "billing") {
    renderBillingReport();
  }

  if (viewName === "routeFragmentation") {
    renderRouteFragmentationAnalytics();
  }

  if (viewName === "reports") {
    showChemicalReportWorkspace(false);
  }

  if (viewName === "messages") {
    renderMessagesPreview();
  }
}

function initializeMessagesDefaults() {
  if (!messageWeekDate) return;
  if (!messageWeekDate.value) {
    messageWeekDate.value = formatDateValue(new Date());
  }
}

function initializeChemicalUsageOptions() {
  if (chemicalNameSelect) {
    chemicalNameSelect.innerHTML = CHEMICAL_NAME_OPTIONS
      .map((name) => `<option value="${name}">${name}</option>`)
      .join("");
  }

  if (chemicalUnitSelect) {
    chemicalUnitSelect.innerHTML = CHEMICAL_UNIT_OPTIONS
      .map((unit) => `<option value="${unit}">${unit}</option>`)
      .join("");
  }
}

function getCurrentCleaningTask() {
  if (!editingCleaningId) return null;
  return cleaningTasks.find((task) => task.id === editingCleaningId) || null;
}

function canEditChemicalEntries() {
  return Boolean(editingCleaningId);
}

function clearChemicalUsageForm() {
  editingChemicalUsageId = null;
  if (chemicalNameSelect) {
    chemicalNameSelect.value = CHEMICAL_NAME_OPTIONS[0];
  }
  if (chemicalQuantityInput) {
    chemicalQuantityInput.value = "";
  }
  if (chemicalUnitSelect) {
    chemicalUnitSelect.value = CHEMICAL_UNIT_OPTIONS[0];
  }
  if (chemicalNotesInput) {
    chemicalNotesInput.value = "";
  }
}

function closeChemicalUsageModal() {
  if (chemicalUsageModal) {
    chemicalUsageModal.classList.add("hidden");
  }
  clearChemicalUsageForm();
}

function openChemicalUsageModal(entryId = null) {
  if (!editingCleaningId) {
    renderChemicalUsageForCurrentTask();
    return;
  }

  clearChemicalUsageForm();

  if (entryId) {
    const existingEntry = chemicalUsageEntries.find((entry) => entry.id === entryId && entry.task_id === editingCleaningId);
    if (!existingEntry) return;

    editingChemicalUsageId = existingEntry.id;
    if (chemicalNameSelect) {
      chemicalNameSelect.value = existingEntry.chemical_name || CHEMICAL_NAME_OPTIONS[0];
    }
    if (chemicalQuantityInput) {
      chemicalQuantityInput.value = existingEntry.quantity ?? "";
    }
    if (chemicalUnitSelect) {
      chemicalUnitSelect.value = existingEntry.unit || CHEMICAL_UNIT_OPTIONS[0];
    }
    if (chemicalNotesInput) {
      chemicalNotesInput.value = existingEntry.notes || "";
    }
  }

  if (chemicalUsageModal) {
    chemicalUsageModal.classList.remove("hidden");
  }
}

function renderChemicalUsageForCurrentTask() {
  if (!chemicalUsageList || !chemicalUsageTaskHint || !addChemicalBtn) return;

  if (!editingCleaningId) {
    addChemicalBtn.disabled = true;
    chemicalUsageTaskHint.classList.remove("hidden");
    chemicalUsageTaskHint.textContent = "Save this cleaning first, then add chemical usage entries.";
    chemicalUsageList.innerHTML = "<div class=\"chemical-usage-empty\">No chemical usage entries yet.</div>";
    return;
  }

  const editable = canEditChemicalEntries();
  addChemicalBtn.disabled = !editable;
  chemicalUsageTaskHint.classList.remove("hidden");
  chemicalUsageTaskHint.textContent = editable
    ? "Chemical usage is linked to this task and saved instantly."
    : "Save this cleaning first, then add chemical usage entries.";

  const rows = chemicalUsageEntries
    .filter((entry) => entry.task_id === editingCleaningId)
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));

  if (!rows.length) {
    chemicalUsageList.innerHTML = "<div class=\"chemical-usage-empty\">No chemical usage entries yet.</div>";
    return;
  }

  chemicalUsageList.innerHTML = rows.map((entry) => {
    const quantityLabel = Number(entry.quantity || 0).toFixed(2).replace(/\.00$/, "");
    const createdLabel = entry.created_at ? new Date(entry.created_at).toLocaleString() : "";
    return `
      <div class="chemical-usage-item">
        <div class="chemical-usage-item-head">
          <strong>${entry.chemical_name}</strong>
          <span>${quantityLabel} ${entry.unit || ""}</span>
        </div>
        ${entry.notes ? `<div class="chemical-usage-item-notes">${entry.notes}</div>` : ""}
        ${createdLabel ? `<div class="chemical-usage-item-meta">Added: ${createdLabel}</div>` : ""}
        ${editable ? `
          <div class="chemical-usage-item-actions">
            <button type="button" onclick="openChemicalUsageModal('${entry.id}')">Edit</button>
            <button type="button" class="delete-btn" onclick="deleteChemicalUsageEntry('${entry.id}')">Delete</button>
          </div>
        ` : ""}
      </div>
    `;
  }).join("");
}

function initializeBillingReportFilters() {
  if (!billingStartDate || !billingEndDate) return;

  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);

  billingStartDate.value = formatDateValue(monthStart);
  billingEndDate.value = formatDateValue(monthEnd);

  if (billingReconciledOnly) {
    billingReconciledOnly.checked = true;
  }
}

function initializeRouteFragmentationFilters() {
  if (!routeFragStartDate || !routeFragEndDate) return;

  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);

  routeFragStartDate.value = formatDateValue(monthStart);
  routeFragEndDate.value = formatDateValue(monthEnd);
}

function initializeChemicalReportFilters() {
  if (!chemicalReportStartDate || !chemicalReportEndDate) return;

  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);

  chemicalReportStartDate.value = formatDateValue(monthStart);
  chemicalReportEndDate.value = formatDateValue(monthEnd);
}

function runPrintForView(viewClassName) {
  const body = document.body;
  body.classList.remove("print-view-billing", "print-view-chemical");
  body.classList.add(viewClassName);
  window.print();
  setTimeout(() => {
    body.classList.remove("print-view-billing", "print-view-chemical");
  }, 250);
}

function printBillingReport() {
  runPrintForView("print-view-billing");
}

function printChemicalUsageReport() {
  runPrintForView("print-view-chemical");
}

function downloadChemicalUsagePdf() {
  runPrintForView("print-view-chemical");
}

function openAddModal() {
  editingPropertyId = null;
  clearPropertyForm();
  propertyModal.classList.remove("hidden");
}

function openEditModal(id) {
  const property = properties.find(p => p.id === id);
  if (!property) return;

  editingPropertyId = id;

  propertyName.value = property.property_name || "";
  propertyClientName.value = property.client_name || "";
  propertyAddress.value = property.address || "";
  propertyIcal.value = property.ical_url || "";
  standardDay.value = property.standard_service_day || "Wednesday";
  coverageDays.value = property.coverage_days ?? 1;
  if (coverageRule) {
    coverageRule.value = getCoverageRuleForProperty(property);
  }
  offCycleCharge.value = property.default_off_cycle_charge || 65;

  propertyModal.classList.remove("hidden");
}

function closePropertyModal() {
  propertyModal.classList.add("hidden");
}

function openCleaningModal(propertyId) {
  const property = properties.find(p => p.id === propertyId);
  if (!property) return;

  selectedCleaningPropertyId = propertyId;
  editingCleaningId = null;

  cleaningDate.value = new Date().toISOString().split("T")[0];
  cleaningServiceType.value = "Manual";
  cleaningStatus.value = "Scheduled";
  cleaningTechnician.value = "";
  cleaningCharge.value = 0;
  cleaningNotes.value = "";
  clearChemicalUsageForm();
  renderChemicalUsageForCurrentTask();

  cleaningModal.classList.remove("hidden");
}

function openEditCleaning(taskId) {
  const task = cleaningTasks.find((t) => t.id === taskId);
  if (!task) return;

  editingCleaningId = task.id;
  selectedCleaningPropertyId = task.property_id;

  cleaningDate.value = task.scheduled_date || task.service_date || "";
  cleaningServiceType.value = task.service_type || "Manual";
  cleaningStatus.value = task.status || "Scheduled";
  cleaningTechnician.value = task.technician || "";
  cleaningCharge.value = task.charge || 0;
  cleaningNotes.value = stripManualBillingOverrideTag(task.notes || "");
  clearChemicalUsageForm();
  renderChemicalUsageForCurrentTask();

  cleaningModal.classList.remove("hidden");
}

function closeCleaningModal() {
  cleaningModal.classList.add("hidden");
  closeChemicalUsageModal();
  editingCleaningId = null;
  renderChemicalUsageForCurrentTask();
}

function openAlertDetail(propertyName, turnoverDate, checkOutDate, checkInDate) {
  alertDetailBody.innerHTML = `
    <table class="alert-detail-table">
      <tr><th>Property</th><td>${propertyName}</td></tr>
      <tr><th>Alert Type</th><td>Same-Day Turnover</td></tr>
      <tr><th>Turnover Date</th><td>${turnoverDate}</td></tr>
      <tr><th>Check-Out</th><td>${checkOutDate}</td></tr>
      <tr><th>Check-In</th><td>${checkInDate}</td></tr>
      <tr><th>Reason</th><td>A guest checks out and another guest checks in on the same day.</td></tr>
      <tr><th>Recommended Action</th><td class="alert-detail-action">Guest Ready service must be completed on the turnover day.</td></tr>
    </table>
  `;
  alertDetailModal.classList.remove("hidden");
}

function closeAlertDetail() {
  alertDetailModal.classList.add("hidden");
  alertDetailBody.innerHTML = "";
}

function openReminderModal(propertyId) {
  editingReminderPropertyId = propertyId;
  editingReminderId = null;
  reminderTitle.value = "";
  reminderNotes.value = "";
  reminderDueDate.value = "";
  reminderModal.classList.remove("hidden");
}

function openEditReminder(reminderId) {
  const reminder = operationsReminders.find(r => r.id === reminderId);
  if (!reminder) return;

  editingReminderPropertyId = reminder.property_id;
  editingReminderId = reminderId;
  reminderTitle.value = reminder.title || "";
  reminderNotes.value = reminder.notes || "";
  reminderDueDate.value = reminder.due_date || "";
  reminderModal.classList.remove("hidden");
}

function closeReminderModal() {
  reminderModal.classList.add("hidden");
  editingReminderPropertyId = null;
  editingReminderId = null;
}

function setReminderQuickDate(option) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let dueDate = new Date(today);
  if (option === "7days") {
    dueDate.setDate(dueDate.getDate() + 7);
  } else if (option === "30days") {
    dueDate.setDate(dueDate.getDate() + 30);
  } else if (option === "next-visit") {
    // Next visit = next task scheduled for the property
    const propertyTasks = cleaningTasks.filter(t => t.property_id === editingReminderPropertyId && t.status !== "Cancelled");
    if (propertyTasks.length > 0) {
      const sortedTasks = propertyTasks.sort((a, b) => {
        return parseDateString(a.service_date).getTime() - parseDateString(b.service_date).getTime();
      });
      const nextTask = sortedTasks.find(t => parseDateString(t.service_date) >= today);
      if (nextTask) {
        dueDate = parseDateString(nextTask.service_date);
      }
    }
  }

  reminderDueDate.value = formatDateValue(dueDate);
}

async function saveReminder() {
  if (!editingReminderPropertyId) return;
  if (!reminderTitle.value.trim()) {
    alert("Please enter a reminder title.");
    return;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const reminderData = {
    title: reminderTitle.value.trim(),
    notes: reminderNotes.value.trim() || null,
    due_date: reminderDueDate.value || formatDateValue(today),
  };

  let error;
  if (editingReminderId) {
    // Update existing reminder
    const result = await supabaseClient
      .from("operations_reminders")
      .update(reminderData)
      .eq("id", editingReminderId);
    error = result.error;
  } else {
    // Insert new reminder
    const reminder = {
      ...reminderData,
      property_id: editingReminderPropertyId,
      status: "Open",
      created_at: new Date().toISOString(),
      completed_at: null,
    };
    const result = await supabaseClient
      .from("operations_reminders")
      .insert([reminder]);
    error = result.error;
  }

  if (error) {
    alert("Error saving reminder: " + error.message);
    return;
  }

  closeReminderModal();
  await loadOperationsReminders();
  renderProperties();
  renderOperationsRemindersWidget();
}

async function completeReminder(reminderId) {
  const { error } = await supabaseClient
    .from("operations_reminders")
    .update({ status: "Completed", completed_at: new Date().toISOString() })
    .eq("id", reminderId);

  if (error) {
    alert("Error completing reminder: " + error.message);
    return;
  }

  await loadOperationsReminders();
  renderProperties();
  renderOperationsRemindersWidget();
}

async function deleteReminder(reminderId) {
  if (!confirm("Delete this reminder?")) return;

  const { error } = await supabaseClient
    .from("operations_reminders")
    .delete()
    .eq("id", reminderId);

  if (error) {
    alert("Error deleting reminder: " + error.message);
    return;
  }

  await loadOperationsReminders();
  renderProperties();
  renderOperationsRemindersWidget();
}

async function loadData() {
  statusMessage.textContent = "Loading...";

  await loadCompanyProfile();
  await initializeCompanyLogoUploadSupport();
  await loadProperties();
  await loadCleaningTasks();
  await loadReservations();
  await loadOperationsReminders();
  await loadChemicalUsageEntries();
  const monthForAutoGeneration = ["current", "next", "previous"].includes(selectedMonthFilter)
    ? selectedMonthFilter
    : "current";
  const generatedWeeklyCount = await ensureWeeklyStandardTasksForMonth(monthForAutoGeneration);
  if (generatedWeeklyCount > 0) {
    await loadCleaningTasks();
  }

  statusMessage.textContent = "";
  renderTaskViews();
  renderProperties();
  renderOperationsRemindersWidget();
  renderBillingReport();
  renderRouteFragmentationAnalytics();
  if (!document.getElementById("chemicalReportWorkspace")?.classList.contains("hidden")) {
    renderChemicalUsageReport();
  }
  renderMessagesPreview();
}

function getMondayStartForDate(dateString) {
  const selected = parseDateString(dateString);
  const day = selected.getUTCDay();
  const mondayOffset = (day + 6) % 7;
  const monday = new Date(selected);
  monday.setUTCDate(selected.getUTCDate() - mondayOffset);
  return monday;
}

async function loadChemicalUsageEntries() {
  const { data, error } = await supabaseClient
    .from("chemical_usage")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("Could not load chemical usage entries:", error.message);
    chemicalUsageEntries = [];
    return;
  }

  chemicalUsageEntries = data || [];
}

async function saveChemicalUsageEntry() {
  if (!editingCleaningId) {
    alert("Save this cleaning first, then add chemical usage.");
    return;
  }

  if (!canEditChemicalEntries()) {
    alert("Save this cleaning first, then add chemical usage.");
    return;
  }

  const chemicalName = String(chemicalNameSelect?.value || "").trim();
  const quantity = Number(chemicalQuantityInput?.value);
  const unit = String(chemicalUnitSelect?.value || "").trim();
  const notes = String(chemicalNotesInput?.value || "").trim();

  if (!chemicalName) {
    alert("Please select a chemical name.");
    return;
  }

  if (!Number.isFinite(quantity) || quantity <= 0) {
    alert("Please enter a valid quantity greater than zero.");
    return;
  }

  if (!unit) {
    alert("Please select a unit.");
    return;
  }

  const task = getCurrentCleaningTask();
  if (!task) {
    alert("Task not found. Close and reopen the cleaning to continue.");
    return;
  }

  const property = properties.find((item) => item.id === task.property_id);
  const propertyName = property?.property_name || task.property_name || "Unknown Property";
  const serviceDate = cleaningDate?.value || task.service_date || task.scheduled_date;

  const payload = {
    task_id: task.id,
    property_id: task.property_id,
    property_name: propertyName,
    service_date: serviceDate,
    chemical_name: chemicalName,
    quantity,
    unit,
    notes: notes || null,
    created_by: String(task.technician || cleaningTechnician?.value || "Tech").trim() || "Tech",
  };

  let response;
  if (editingChemicalUsageId) {
    response = await supabaseClient
      .from("chemical_usage")
      .update(payload)
      .eq("id", editingChemicalUsageId);
  } else {
    response = await supabaseClient
      .from("chemical_usage")
      .insert([payload]);
  }

  if (response.error) {
    alert("Error saving chemical usage: " + response.error.message);
    return;
  }

  closeChemicalUsageModal();
  await loadChemicalUsageEntries();
  renderChemicalUsageForCurrentTask();
}

async function deleteChemicalUsageEntry(entryId) {
  if (!canEditChemicalEntries()) return;
  if (!confirm("Delete this chemical entry?")) return;

  const { error } = await supabaseClient
    .from("chemical_usage")
    .delete()
    .eq("id", entryId);

  if (error) {
    alert("Error deleting chemical entry: " + error.message);
    return;
  }

  await loadChemicalUsageEntries();
  renderChemicalUsageForCurrentTask();
}

function getWeekRangeForMessage() {
  const selectedDate = messageWeekDate?.value || formatDateValue(new Date());
  const weekStartDate = getMondayStartForDate(selectedDate);
  const weekEndDate = new Date(weekStartDate);
  weekEndDate.setUTCDate(weekStartDate.getUTCDate() + 6);
  const weekStart = weekStartDate.toISOString().slice(0, 10);
  const weekEnd = weekEndDate.toISOString().slice(0, 10);
  return { weekStart, weekEnd, weekStartDate, weekEndDate };
}

function formatMessageWeekRange(weekStartDate, weekEndDate) {
  const startMonth = weekStartDate.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
  const endMonth = weekEndDate.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
  const startDay = weekStartDate.toLocaleDateString("en-US", { day: "numeric", timeZone: "UTC" });
  const endDay = weekEndDate.toLocaleDateString("en-US", { day: "numeric", timeZone: "UTC" });

  if (startMonth === endMonth) {
    return `${startMonth} ${startDay}-${endDay}`;
  }

  return `${startMonth} ${startDay}-${endMonth} ${endDay}`;
}

function getMessageTasksForWeek(weekStart, weekEnd) {
  return cleaningTasks
    .filter((task) => {
      const taskDate = task.service_date || task.scheduled_date;
      if (!taskDate) return false;
      if (shouldSuppressWeeklyStandardTaskDisplay(task)) return false;

      const status = String(task.status || "").trim().toLowerCase();
      if (status !== "scheduled" && status !== "pending") return false;

      return taskDate >= weekStart && taskDate <= weekEnd;
    })
    .sort((a, b) => {
      const aDate = a.service_date || a.scheduled_date || "";
      const bDate = b.service_date || b.scheduled_date || "";
      if (aDate !== bDate) return aDate.localeCompare(bDate);
      const aTech = String(a.technician || "").trim().toLowerCase();
      const bTech = String(b.technician || "").trim().toLowerCase();
      if (aTech !== bTech) return aTech.localeCompare(bTech);
      return getPropertyName(a.property_id).localeCompare(getPropertyName(b.property_id));
    });
}

function getMessageTaskType(task) {
  if (isTaskGuestReady(task)) {
    return "Guest Ready Cleaning";
  }
  if (task.service_type === "Weekly Standard") {
    return "Weekly Standard";
  }
  return task.service_type || "Manual";
}

function renderMessagesPreview() {
  if (!messagesByTech) return;

  const { weekStart, weekEnd, weekStartDate, weekEndDate } = getWeekRangeForMessage();
  const weekLabel = formatMessageWeekRange(weekStartDate, weekEndDate);
  const tasks = getMessageTasksForWeek(weekStart, weekEnd);

  if (!tasks.length) {
    messagesByTech.innerHTML = `<div class="empty">No Scheduled or Pending tasks found for the selected week.</div>`;
    return;
  }

  const unassignedLabel = String(messageUnassignedName?.value || "").trim() || "Unassigned";
  const tasksByTech = tasks.reduce((acc, task) => {
    const tech = String(task.technician || "").trim() || unassignedLabel;
    if (!acc[tech]) acc[tech] = [];
    acc[tech].push(task);
    return acc;
  }, {});

  const orderedTechs = Object.keys(tasksByTech).sort((a, b) => {
    if (a === unassignedLabel) return 1;
    if (b === unassignedLabel) return -1;
    return a.localeCompare(b);
  });

  const techCardsHtml = orderedTechs.map((techName, index) => {
    const lines = [];
    lines.push(`Hey ${techName}, here is your pool schedule for ${weekLabel}:`);
    lines.push("");

    const groupedByDate = tasksByTech[techName].reduce((acc, task) => {
      const taskDate = task.service_date || task.scheduled_date;
      if (!acc[taskDate]) acc[taskDate] = [];
      acc[taskDate].push(task);
      return acc;
    }, {});

    Object.keys(groupedByDate)
      .sort((a, b) => a.localeCompare(b))
      .forEach((taskDate) => {
        const dayName = getDayNameFromDateString(taskDate) || "Day";
        lines.push(`${dayName}:`);

        groupedByDate[taskDate].forEach((task) => {
          const property = properties.find((p) => p.id === task.property_id);
          const propertyName = property?.property_name || "Unknown Property";
          const typeLabel = getMessageTaskType(task);
          lines.push(`- ${taskDate} - ${propertyName} - ${typeLabel}`);

          if (property?.address) {
            lines.push(`  Address: ${property.address}`);
          }

          if (isSameDayCheckInGuestReadyTask(task)) {
            lines.push("  Same-Day Check-In");
          }

          if (task.notes) {
            lines.push(`  Notes: ${stripManualBillingOverrideTag(task.notes)}`);
          }
        });

        lines.push("");
      });

    lines.push("Please mark each task complete after service and send photos after each pool.");

    const previewId = `messagePreviewTech${index}`;
    const copyStatusId = `messageCopyStatus${index}`;
    const messageText = lines.join("\n");

    return `
      <div class="messages-tech-card">
        <div class="messages-tech-header">
          <h3>${techName}</h3>
          <button type="button" onclick="copyTechMessage('${previewId}', '${copyStatusId}')">Copy Message</button>
        </div>
        <textarea id="${previewId}" rows="14" readonly>${messageText}</textarea>
        <div id="${copyStatusId}" class="settings-status"></div>
      </div>
    `;
  }).join("");

  messagesByTech.innerHTML = techCardsHtml;
}

async function copyTechMessage(previewId, statusId) {
  const previewElement = document.getElementById(previewId);
  const statusElement = document.getElementById(statusId);
  if (!previewElement) return;

  const textToCopy = previewElement.value || "";
  if (!textToCopy.trim()) return;

  try {
    await navigator.clipboard.writeText(textToCopy);
    if (statusElement) {
      statusElement.textContent = "Copied.";
      setTimeout(() => {
        statusElement.textContent = "";
      }, 2000);
    }
  } catch (error) {
    if (statusElement) {
      statusElement.textContent = "Copy failed.";
      setTimeout(() => {
        statusElement.textContent = "";
      }, 2500);
    }
  }
}

function getDateOffsetsForMonth(monthType) {
  if (monthType === "next") return 1;
  if (monthType === "previous") return -1;
  return 0;
}

function getServiceDatesForMonthByDay(standardDayName, monthType) {
  const standardDayNumber = getDayNumberFromName(standardDayName || "Wednesday");
  if (standardDayNumber === undefined) return [];

  const now = new Date();
  const monthOffset = getDateOffsetsForMonth(monthType);
  const monthStart = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + monthOffset + 1, 0);

  const cursor = new Date(monthStart);
  const daysUntilFirst = (standardDayNumber - cursor.getDay() + 7) % 7;
  cursor.setDate(cursor.getDate() + daysUntilFirst);

  const serviceDates = [];
  while (cursor <= monthEnd) {
    serviceDates.push(formatDateValue(cursor));
    cursor.setDate(cursor.getDate() + 7);
  }

  return serviceDates;
}

function hasGuestReadyInsideCoverageWindow(propertyId, weeklyServiceDate, coverageRuleValue) {
  return cleaningTasks.some((task) => {
    if (task.property_id !== propertyId) return false;
    if (!isTaskGuestReady(task)) return false;
    if (String(task.status || "").toLowerCase() === "cancelled") return false;
    const guestReadyDate = task.service_date || task.scheduled_date;
    if (!guestReadyDate) return false;
    return isDateWithinCoverageRule(weeklyServiceDate, guestReadyDate, coverageRuleValue);
  });
}

function hasExistingWeeklyTask(propertyId, weeklyServiceDate) {
  const sourceKey = `wk:${propertyId}:${weeklyServiceDate}`;
  return cleaningTasks.some((task) => {
    if (task.property_id !== propertyId) return false;
    if (task.service_type !== "Weekly Standard") return false;
    if (task.source_key && task.source_key === sourceKey) return true;
    return !task.source_key && task.service_date === weeklyServiceDate;
  });
}

async function ensureWeeklyStandardTasksForMonth(monthType) {
  if (!["current", "next", "previous"].includes(monthType)) return 0;

  const propertiesForGeneration = properties.filter((property) => {
    return property.active !== false && Boolean(property.standard_service_day);
  });

  if (!propertiesForGeneration.length) return 0;

  const weeklyTasksToCreate = [];

  for (const property of propertiesForGeneration) {
    const standardDayName = property.standard_service_day || "Wednesday";
    const propertyCoverageRule = getCoverageRuleForProperty(property);
    const serviceDates = getServiceDatesForMonthByDay(standardDayName, monthType);

    for (const serviceDate of serviceDates) {
      if (hasExistingWeeklyTask(property.id, serviceDate)) {
        continue;
      }

      if (hasGuestReadyInsideCoverageWindow(property.id, serviceDate, propertyCoverageRule)) {
        continue;
      }

      weeklyTasksToCreate.push({
        property_id: property.id,
        service_date: serviceDate,
        scheduled_date: serviceDate,
        suggested_date: serviceDate,
        check_in_date: null,
        service_type: "Weekly Standard",
        status: "Scheduled",
        off_cycle: false,
        guest_ready: false,
        charge: 0,
        notes: `Auto-created Weekly Standard for ${standardDayName} in ${monthType} month view.`,
        source_type: "weekly_standard",
        source_key: `wk:${property.id}:${serviceDate}`,
        manually_modified: false,
      });
    }
  }

  if (!weeklyTasksToCreate.length) return 0;

  const sourceKeys = weeklyTasksToCreate.map((task) => task.source_key);
  const { data: existingDuplicates, error: duplicateCheckError } = await supabaseClient
    .from("cleaning_tasks")
    .select("source_key")
    .in("source_key", sourceKeys);

  if (duplicateCheckError) {
    console.warn("Weekly generation duplicate check failed:", duplicateCheckError.message);
    return 0;
  }

  const existingSourceKeys = new Set((existingDuplicates || []).map((row) => row.source_key));
  const filteredWeeklyTasks = weeklyTasksToCreate.filter((task) => !existingSourceKeys.has(task.source_key));

  if (!filteredWeeklyTasks.length) return 0;

  const { error: insertError } = await supabaseClient
    .from("cleaning_tasks")
    .insert(filteredWeeklyTasks);

  if (insertError) {
    console.warn("Weekly generation insert failed:", insertError.message);
    return 0;
  }

  return filteredWeeklyTasks.length;
}

function getNormalizedCompanyProfile(raw) {
  return {
    company_name: String(raw?.company_name || DEFAULT_COMPANY_PROFILE.company_name).trim() || DEFAULT_COMPANY_PROFILE.company_name,
    tagline: String(raw?.tagline || DEFAULT_COMPANY_PROFILE.tagline).trim() || DEFAULT_COMPANY_PROFILE.tagline,
    phone_number: String(raw?.phone_number || "").trim(),
    email: String(raw?.email || "").trim(),
    logo_url: String(raw?.logo_url || "").trim(),
    admin_pin: String(raw?.admin_pin || DEFAULT_COMPANY_PROFILE.admin_pin).trim() || DEFAULT_COMPANY_PROFILE.admin_pin,
  };
}

function getCurrentAdminPin() {
  const configured = String(companyProfile?.admin_pin || "").trim();
  return configured || DEFAULT_COMPANY_PROFILE.admin_pin;
}

function applyCompanyProfileToApp() {
  if (companyHeaderName) {
    companyHeaderName.textContent = companyProfile.company_name;
  }
  if (companyHeaderTagline) {
    companyHeaderTagline.textContent = companyProfile.tagline;
  }
  applyImageSource(companyHeaderLogo, companyProfile.logo_url);
  renderMessagesBranding();
  document.title = companyProfile.company_name || "Guest Ready™";
}

function renderCompanyProfileSettings() {
  if (!companyNameInput) return;
  companyNameInput.value = companyProfile.company_name || "";
  companyTaglineInput.value = companyProfile.tagline || "";
  companyPhoneInput.value = companyProfile.phone_number || "";
  companyEmailInput.value = companyProfile.email || "";
  companyLogoUrlInput.value = companyProfile.logo_url || "";
  renderCompanyLogoPreview(companyProfile.logo_url);
  if (adminPinInput) adminPinInput.value = "";
  if (confirmAdminPinInput) confirmAdminPinInput.value = "";
}

function applyImageSource(imageElement, sourceUrl) {
  if (!imageElement) return;
  const normalizedUrl = String(sourceUrl || "").trim();
  if (!normalizedUrl) {
    imageElement.removeAttribute("src");
    imageElement.classList.add("hidden");
    return;
  }

  imageElement.src = normalizedUrl;
  imageElement.classList.remove("hidden");
  imageElement.onerror = () => {
    imageElement.classList.add("hidden");
  };
}

function renderCompanyLogoPreview(sourceUrl) {
  if (!companyLogoPreview) return;
  const normalizedUrl = String(sourceUrl || "").trim();
  if (!normalizedUrl) {
    companyLogoPreview.removeAttribute("src");
    companyLogoPreview.classList.add("hidden");
    if (companyLogoPreviewEmpty) {
      companyLogoPreviewEmpty.classList.remove("hidden");
    }
    return;
  }

  companyLogoPreview.src = normalizedUrl;
  companyLogoPreview.classList.remove("hidden");
  companyLogoPreview.onload = () => {
    if (companyLogoPreviewEmpty) {
      companyLogoPreviewEmpty.classList.add("hidden");
    }
  };
  companyLogoPreview.onerror = () => {
    companyLogoPreview.classList.add("hidden");
    if (companyLogoPreviewEmpty) {
      companyLogoPreviewEmpty.classList.remove("hidden");
    }
  };

  if (!companyLogoPreviewEmpty) return;
  companyLogoPreviewEmpty.classList.add("hidden");
}

function renderMessagesBranding() {
  if (!messagesBranding) return;
  const logoMarkup = companyProfile.logo_url
    ? `<img src="${companyProfile.logo_url}" alt="${companyProfile.company_name} logo" class="company-logo messages-branding-logo" onerror="this.style.display='none'">`
    : "";

  messagesBranding.innerHTML = `
    ${logoMarkup}
    <div>
      <div class="messages-branding-name">${companyProfile.company_name}</div>
      <div class="messages-branding-tagline">${companyProfile.tagline}</div>
    </div>
  `;
  messagesBranding.classList.remove("hidden");
}

async function uploadCompanyLogo() {
  if (companyLogoUploadFeature?.classList.contains("hidden")) {
    alert("Logo upload is unavailable. Use Logo URL instead.");
    return;
  }

  const file = companyLogoFileInput?.files?.[0];
  if (!file) {
    alert("Choose an image file first.");
    return;
  }

  if (settingsStatus) {
    settingsStatus.textContent = "Uploading logo...";
  }

  const fileExtension = (file.name.split(".").pop() || "png").toLowerCase();
  const safeExtension = fileExtension.replace(/[^a-z0-9]/g, "") || "png";
  const storageReady = await ensureCompanyLogoBucketReady();
  if (!storageReady) {
    if (companyLogoUploadFeature) {
      companyLogoUploadFeature.classList.add("hidden");
    }
    if (settingsStatus) {
      settingsStatus.textContent = "Upload unavailable. Use Logo URL instead.";
    }
    return;
  }

  const uploadPath = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${safeExtension}`;
  const { error: uploadError } = await supabaseClient.storage
    .from(COMPANY_LOGO_BUCKET)
    .upload(uploadPath, file, { upsert: true, cacheControl: "3600" });

  if (uploadError) {
    if (settingsStatus) {
      settingsStatus.textContent = "Upload unavailable. Use Logo URL instead.";
    }
    console.warn("Logo upload failed:", uploadError.message);
    return;
  }

  const { data: publicUrlData } = supabaseClient.storage
    .from(COMPANY_LOGO_BUCKET)
    .getPublicUrl(uploadPath);

  const uploadedUrl = publicUrlData?.publicUrl || "";
  if (!uploadedUrl) {
    if (settingsStatus) {
      settingsStatus.textContent = "Upload unavailable. Use Logo URL instead.";
    }
    console.warn("Logo upload failed: could not derive public URL.");
    return;
  }

  const saved = await persistCompanyLogoUrl(uploadedUrl);
  if (!saved) {
    if (settingsStatus) {
      settingsStatus.textContent = "Logo uploaded, but profile save failed.";
    }
    return;
  }

  if (companyLogoUrlInput) {
    companyLogoUrlInput.value = uploadedUrl;
  }
  companyProfile = getNormalizedCompanyProfile({
    ...companyProfile,
    logo_url: uploadedUrl,
  });
  applyCompanyProfileToApp();
  renderCompanyProfileSettings();
  renderBillingReport();

  if (settingsStatus) {
    settingsStatus.textContent = "Logo uploaded and saved.";
    setTimeout(() => {
      settingsStatus.textContent = "";
    }, 2500);
  }
}

async function persistCompanyLogoUrl(logoUrl) {
  const payload = getNormalizedCompanyProfile({
    ...companyProfile,
    logo_url: logoUrl,
  });

  const upsertPayload = {
    id: 1,
    ...payload,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabaseClient
    .from("company_profile")
    .upsert(upsertPayload, { onConflict: "id" });

  if (error) {
    console.warn("Could not persist uploaded logo URL:", error.message);
    return false;
  }

  return true;
}

async function initializeCompanyLogoUploadSupport() {
  if (!companyLogoUploadFeature) return;
  const storageReady = await ensureCompanyLogoBucketReady();
  companyLogoUploadFeature.classList.toggle("hidden", !storageReady);
  if (!storageReady && companyLogoFileInput) {
    companyLogoFileInput.value = "";
  }
}

async function ensureCompanyLogoBucketReady() {
  const { error: listError } = await supabaseClient.storage
    .from(COMPANY_LOGO_BUCKET)
    .list("", { limit: 1 });

  if (!listError) {
    return true;
  }

  const listMessage = String(listError.message || "").toLowerCase();
  const bucketMissing = listMessage.includes("not found")
    || listMessage.includes("does not exist")
    || listMessage.includes("bucket");

  if (!bucketMissing) {
    console.warn("Company logo storage is unavailable:", listError.message);
    return false;
  }

  const { error: createError } = await supabaseClient.storage.createBucket(COMPANY_LOGO_BUCKET, {
    public: true,
    fileSizeLimit: "5MB",
    allowedMimeTypes: ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"],
  });

  if (createError) {
    const createMessage = String(createError.message || "").toLowerCase();
    const alreadyExists = createMessage.includes("already exists") || createMessage.includes("duplicate");
    if (alreadyExists) {
      return true;
    }
    console.warn("Could not create company-logos bucket:", createError.message);
    return false;
  }

  return true;
}

async function loadCompanyProfile() {
  const { data, error } = await supabaseClient
    .from("company_profile")
    .select("*")
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("Could not load company profile. Falling back to defaults:", error.message);
    companyProfile = { ...DEFAULT_COMPANY_PROFILE };
  } else {
    companyProfile = getNormalizedCompanyProfile(data || DEFAULT_COMPANY_PROFILE);
  }

  applyCompanyProfileToApp();
  renderCompanyProfileSettings();
}

async function saveCompanyProfile() {
  if (!companyNameInput || !companyTaglineInput) return;

  const newPin = String(adminPinInput?.value || "").trim();
  const confirmPin = String(confirmAdminPinInput?.value || "").trim();
  const isPinUpdateRequested = Boolean(newPin || confirmPin);

  if (isPinUpdateRequested && newPin !== confirmPin) {
    alert("Admin PIN and Confirm Admin PIN must match.");
    return;
  }

  const payload = getNormalizedCompanyProfile({
    company_name: companyNameInput.value,
    tagline: companyTaglineInput.value,
    phone_number: companyPhoneInput?.value,
    email: companyEmailInput?.value,
    logo_url: companyLogoUrlInput?.value,
    admin_pin: isPinUpdateRequested ? newPin : getCurrentAdminPin(),
  });

  if (!payload.company_name) {
    alert("Company name is required.");
    return;
  }

  if (settingsStatus) {
    settingsStatus.textContent = "Saving...";
  }

  const upsertPayload = {
    id: 1,
    ...payload,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabaseClient
    .from("company_profile")
    .upsert(upsertPayload, { onConflict: "id" });

  if (error) {
    if (settingsStatus) {
      settingsStatus.textContent = "";
    }
    alert("Error saving company profile: " + error.message);
    return;
  }

  companyProfile = payload;
  applyCompanyProfileToApp();
  renderBillingReport();

  if (settingsStatus) {
    settingsStatus.textContent = "Saved.";
    setTimeout(() => {
      settingsStatus.textContent = "";
    }, 2500);
  }
}

async function loadProperties() {
  const { data, error } = await supabaseClient
    .from("properties")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    statusMessage.textContent = "Could not load properties: " + error.message;
    return;
  }

  properties = data || [];
}

async function loadCleaningTasks() {
  const { data, error } = await supabaseClient
    .from("cleaning_tasks")
    .select("*")
    .order("service_date", { ascending: true });

  if (error) {
    statusMessage.textContent = "Could not load cleanings: " + error.message;
    return;
  }

  cleaningTasks = data || [];
  console.log("All tasks returned from Supabase:", cleaningTasks);
}

async function debugCleaningTasks() {
  const { data, error } = await supabaseClient
    .from("cleaning_tasks")
    .select("*")
    .order("service_date", { ascending: true });

  console.log("ALL CLEANING TASKS:", data);
  console.log("ERROR:", error);

  if (debugTaskCount) {
    debugTaskCount.textContent = `Total tasks found: ${Array.isArray(data) ? data.length : 0}`;
  }

  if (weekTasksContainer) {
    weekTasksContainer.innerHTML = Array.isArray(data) && data.length
      ? `<div class="empty">Raw task count loaded. Check console for full payload.</div>`
      : `<div class="empty">No raw cleaning tasks returned.</div>`;
  }
}

async function loadReservations() {
  console.log("Querying reservations table...");
  console.log("[loadReservations] Table: reservations | Filters: none | Order: check_in ASC");

  const { data, error } = await supabaseClient
    .from("reservations")
    .select("*")
    .order("check_in", { ascending: true });

  console.log("Returned rows:", data?.length);
  console.log("Query result:", data);

  if (error) {
    console.error("[loadReservations] ERROR:", error.message, "| code:", error.code, "| hint:", error.hint);
    reservations = [];
    return;
  }

  reservations = data || [];
  console.log("[loadReservations] reservations[] set to", reservations.length, "rows");
}

async function loadOperationsReminders() {
  const { data, error } = await supabaseClient
    .from("operations_reminders")
    .select("*")
    .order("due_date", { ascending: true });

  if (error) {
    operationsReminders = [];
    return;
  }

  operationsReminders = data || [];
}

async function saveProperty() {
  const selectedCoverageRule = coverageRule ? coverageRule.value : "both";
  const propertyData = {
    property_name: propertyName.value.trim(),
    client_name: String(propertyClientName?.value || "").trim() || null,
    address: propertyAddress.value.trim(),
    ical_url: propertyIcal.value.trim(),
    standard_service_day: standardDay.value,
    coverage_days: selectedCoverageRule === "none" ? 0 : 1,
    coverage_rule: selectedCoverageRule,
    default_off_cycle_charge: Number(offCycleCharge.value),
    active: true
  };

  if (!propertyData.property_name) {
    alert("Property name is required.");
    return;
  }

  let result;

  if (editingPropertyId) {
    result = await supabaseClient
      .from("properties")
      .update(propertyData)
      .eq("id", editingPropertyId);
  } else {
    result = await supabaseClient
      .from("properties")
      .insert([propertyData]);
  }

  if (result.error) {
    alert("Error saving property: " + result.error.message);
    return;
  }

  clearPropertyForm();
  closePropertyModal();
  loadData();
}

async function deleteProperty(id) {
  const property = properties.find(p => p.id === id);
  if (!property) return;

  const confirmed = confirm(`Delete ${property.property_name}?`);
  if (!confirmed) return;

  const { error } = await supabaseClient
    .from("properties")
    .delete()
    .eq("id", id);

  if (error) {
    alert("Error deleting property: " + error.message);
    return;
  }

  loadData();
}

async function syncAllIcal() {
  const allProperties = properties;
  const icalProperties = allProperties.filter(p => p.ical_url);

  if (icalProperties.length === 0) {
    syncAllStatus.textContent = "No properties with an iCal URL configured.";
    return;
  }

  syncAllIcalBtn.disabled = true;
  renderSyncReport(null); // clear previous report
  console.log(`[SyncAll] Starting sync for ${icalProperties.length} properties (${allProperties.length - icalProperties.length} skipped — no iCal URL)`);

  const results = [];

  // Mark skipped properties first
  for (const p of allProperties) {
    if (!p.ical_url) {
      console.log(`[SyncAll] SKIP "${p.property_name}" — no iCal URL`);
      results.push({ propertyName: p.property_name, skipped: true });
    }
  }

  for (let i = 0; i < icalProperties.length; i++) {
    const property = icalProperties[i];
    syncAllStatus.textContent = `Syncing ${i + 1} of ${icalProperties.length}: ${property.property_name}...`;
    console.log(`[SyncAll] (${i + 1}/${icalProperties.length}) Starting sync — "${property.property_name}" id:${property.id} ical_url:${property.ical_url}`);

    const result = { propertyName: property.property_name, skipped: false, started: true, success: false, error: null, data: null };

    try {
      const { data, error } = await supabaseClient.functions.invoke("sync-ical", {
        method: "POST",
        body: JSON.stringify({ property_id: property.id })
      });

      console.log(`[SyncAll] Edge Function response for "${property.property_name}":`, data, error);

      if (error) {
        result.error = error.message || String(error);
        console.log(`[SyncAll] ERROR for "${property.property_name}":`, result.error);
      } else {
        result.success = true;
        result.data = data;
        console.log(`[SyncAll] SUCCESS for "${property.property_name}": parsed=${data?.reservationsParsed ?? "?"} active=${data?.activeReservations ?? "?"} ignored=${data?.oldIgnored ?? "?"} saved=${data?.reservationsCreated ?? 0} weekly=${data?.weeklyTasksCreated ?? 0} guestReady=${data?.guestReadyTasksCreated ?? 0}`);
      }
    } catch (invokeError) {
      result.error = invokeError?.message || String(invokeError);
      console.log(`[SyncAll] EXCEPTION for "${property.property_name}":`, invokeError);
    }

    results.push(result);
  }

  console.log("[SyncAll] All properties processed. Refreshing data...");
  try {
    await loadData();
  } catch (loadError) {
    console.log("[SyncAll] loadData() threw after sync:", loadError);
  }

  const succeeded = results.filter(r => r.success).length;
  const failed = results.filter(r => r.started && !r.success).length;
  syncAllStatus.textContent = `Sync complete — ${succeeded} succeeded, ${failed} failed, ${results.filter(r => r.skipped).length} skipped. See report below.`;
  console.log("[SyncAll] Done.", syncAllStatus.textContent);

  renderSyncReport(results);
  syncAllIcalBtn.disabled = false;
}

function renderSyncReport(results) {
  const container = document.getElementById("syncReport");
  if (!container) return;

  if (!results) {
    container.innerHTML = "";
    return;
  }

  const rows = results.map(r => {
    if (r.skipped) {
      return `
        <tr class="sync-row-skipped">
          <td>${r.propertyName}</td>
          <td colspan="8" class="sync-skipped-label">Skipped — no iCal URL</td>
        </tr>`;
    }
    if (!r.success) {
      return `
        <tr class="sync-row-error">
          <td>${r.propertyName}</td>
          <td>✓</td>
          <td colspan="6">—</td>
          <td class="sync-error-msg">${r.error || "Unknown error"}</td>
        </tr>`;
    }
    const d = r.data || {};
    return `
      <tr class="sync-row-success">
        <td>${r.propertyName}</td>
        <td>✓</td>
        <td>${d.reservationsParsed ?? "—"}</td>
        <td>${d.activeReservations ?? "—"}</td>
        <td>${d.oldIgnored ?? "—"}</td>
        <td>${d.reservationsCreated ?? 0}</td>
        <td>${d.weeklyTasksCreated ?? 0}</td>
        <td>${d.guestReadyTasksCreated ?? 0}</td>
        <td class="sync-ok-label">OK</td>
      </tr>`;
  }).join("");

  container.innerHTML = `
    <div class="sync-report">
      <div class="sync-report-header">
        <strong>Sync Report</strong>
        <button class="sync-report-close" onclick="document.getElementById('syncReport').innerHTML=''">✕ Close</button>
      </div>
      <table class="sync-report-table">
        <thead>
          <tr>
            <th>Property</th>
            <th>Started</th>
            <th>Parsed</th>
            <th>Active</th>
            <th>Ignored</th>
            <th>Saved</th>
            <th>Weekly Tasks</th>
            <th>Guest Ready Tasks</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

async function syncPropertyIcal(propertyId) {
  console.log("[SynciCal] Sync button clicked, propertyId:", propertyId);

  const property = properties.find((p) => p.id === propertyId);
  if (!property || !property.ical_url) {
    const msg = "No iCal URL configured for this property.";
    console.log("[SynciCal] Aborted:", msg);
    statusMessage.textContent = msg;
    return;
  }

  console.log("[SynciCal] Syncing property:", property.property_name, "ical_url:", property.ical_url);
  statusMessage.textContent = `Syncing iCal for ${property.property_name}...`;

  let data;
  let error;
  try {
    ({ data, error } = await supabaseClient.functions.invoke("sync-ical", {
      method: "POST",
      body: JSON.stringify({ property_id: propertyId })
    }));
    console.log("[SynciCal] Edge Function response — data:", data, "error:", error);
  } catch (invokeError) {
    const msg = "iCal sync request failed: " + (invokeError?.message || invokeError);
    console.log("[SynciCal] Invoke threw exception:", invokeError);
    statusMessage.textContent = msg;
    return;
  }

  if (error) {
    const msg = "iCal sync failed: " + (error.message || error);
    console.log("[SynciCal] Edge Function returned error:", error);
    statusMessage.textContent = msg;
    return;
  }

  try {
    await loadData();
  } catch (loadError) {
    console.log("[SynciCal] loadData() threw after sync — suppressing to preserve result message:", loadError);
  }

  const successMsg = `iCal sync complete: ${data?.reservationsCreated ?? 0} reservation(s) saved, ${data?.tasksCreated ?? 0} Guest Ready task(s) created.`;
  console.log("[SynciCal] Success message:", successMsg);
  statusMessage.textContent = successMsg;
}

async function saveCleaningTask() {
  const property = properties.find((p) => p.id === selectedCleaningPropertyId);
  if (!property) return;

  const serviceDate = cleaningDate.value;
  const serviceType = cleaningServiceType.value;
  const taskStatus = cleaningStatus.value || "Scheduled";
  const charge = Number(cleaningCharge.value || 0);

  if (!serviceDate) {
    alert("Service date is required.");
    return;
  }

  const existingTask = editingCleaningId ? cleaningTasks.find((task) => task.id === editingCleaningId) : null;
  const completedAt = taskStatus === "Completed"
    ? existingTask?.completed_at || new Date().toISOString()
    : null;

  // If a task's date is being changed, flag it as manually modified
  // so that future syncs do not overwrite it or recreate it on the original date.
  const isManuallyMoving = editingCleaningId && existingTask?.service_date !== serviceDate;
  const shouldApplyManualBillingOverride = Boolean(editingCleaningId && charge > 0);
  const notesWithOverride = applyManualBillingOverrideTag(cleaningNotes.value.trim(), shouldApplyManualBillingOverride);

  const task = {
    property_id: selectedCleaningPropertyId,
    service_date: serviceDate,
    scheduled_date: serviceDate,
    service_type: serviceType,
    technician: cleaningTechnician.value.trim(),
    status: taskStatus,
    off_cycle: charge > 0 || serviceType === "Off-Cycle",
    charge: charge,
    notes: notesWithOverride,
    guest_ready: serviceType === "Guest Ready",
    completed_at: completedAt,
    ...(isManuallyMoving ? { manually_modified: true } : {})
  };

  let result;

  if (editingCleaningId) {
    result = await supabaseClient
      .from("cleaning_tasks")
      .update(task)
      .eq("id", editingCleaningId);
  } else {
    result = await supabaseClient
      .from("cleaning_tasks")
      .insert([task]);
  }

  if (result.error) {
    alert("Error saving cleaning: " + result.error.message);
    return;
  }

  editingCleaningId = null;
  closeCleaningModal();
  await loadData();
}

async function deleteCleaningTask(id) {
  const confirmed = confirm("Delete this cleaning?");
  if (!confirmed) return;

  const { error } = await supabaseClient
    .from("cleaning_tasks")
    .delete()
    .eq("id", id);

  if (error) {
    alert("Error deleting cleaning: " + error.message);
    return;
  }

  loadData();
}

async function backfillSourceKeys() {
  console.log("[Backfill] Starting source_key migration...");
  
  // Fetch all tasks without source_key
  const { data: tasksToUpdate, error: fetchError } = await supabaseClient
    .from("cleaning_tasks")
    .select("id, property_id, service_date, service_type, check_in_date")
    .is("source_key", null);

  if (fetchError || !tasksToUpdate?.length) {
    console.log("[Backfill] No tasks to backfill or error:", fetchError);
    return;
  }

  console.log(`[Backfill] Found ${tasksToUpdate.length} tasks without source_key`);

  const updates = tasksToUpdate.map(task => {
    let source_key = null;
    let source_type = null;

    if (task.service_type === "Guest Ready" && task.check_in_date) {
      source_key = `gr:${task.property_id}:${task.check_in_date}`;
      source_type = "reservation_guest_ready";
    } else if (task.service_type === "Weekly Standard") {
      source_key = `wk:${task.property_id}:${task.service_date}`;
      source_type = "weekly_standard";
    }

    return { id: task.id, source_key, source_type };
  });

  for (const update of updates) {
    if (!update.source_key) continue;
    const { error: updateError } = await supabaseClient
      .from("cleaning_tasks")
      .update({ source_key: update.source_key, source_type: update.source_type })
      .eq("id", update.id);
    if (updateError) {
      console.error(`[Backfill] Error updating task ${update.id}:`, updateError);
    }
  }

  console.log("[Backfill] Backfill complete. Run loadData() to refresh the view.");
}

async function startCleaningTask(id) {
  const { error } = await supabaseClient
    .from("cleaning_tasks")
    .update({
      status: "In Progress"
    })
    .eq("id", id);

  if (error) {
    alert("Error starting cleaning: " + error.message);
    return;
  }

  loadData();
}

async function markCleaningComplete(id) {
  const { error } = await supabaseClient
    .from("cleaning_tasks")
    .update({
      status: "Completed",
      completed_at: new Date().toISOString()
    })
    .eq("id", id);

  if (error) {
    alert("Error completing cleaning: " + error.message);
    return;
  }

  loadData();
}

function clearPropertyForm() {
  propertyName.value = "";
  if (propertyClientName) {
    propertyClientName.value = "";
  }
  propertyAddress.value = "";
  propertyIcal.value = "";
  standardDay.value = "Wednesday";
  coverageDays.value = 1;
  if (coverageRule) {
    coverageRule.value = "both";
  }
  offCycleCharge.value = 65;
}

function toggleInvoiceMarker(taskId) {
  const task = cleaningTasks.find(t => t.id === taskId);
  if (!task) return;
  
  const newInvoiced = !task.invoiced;
  
  // Optimistically update UI
  task.invoiced = newInvoiced;
  renderTaskViews();
  refreshBillingCard();
  
  // Update database
  supabaseClient
    .from("cleaning_tasks")
    .update({ invoiced: newInvoiced })
    .eq("id", taskId)
    .then(({ error }) => {
      if (error) {
        // Revert on error
        task.invoiced = !newInvoiced;
        renderTaskViews();
        refreshBillingCard();
        alert("Error updating invoice marker: " + error.message);
      } else {
        // Refresh billing card after successful update
        refreshBillingCard();
      }
    });
}

function refreshBillingCard() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  
  const monthStart = new Date(currentYear, currentMonth, 1);
  const monthEnd = new Date(currentYear, currentMonth + 1, 0);
  const monthStartString = formatDateValue(monthStart);
  const monthEndString = formatDateValue(monthEnd);
  
  let totalBillableAmount = 0;
  let invoicedAmount = 0;
  let totalBillableTaskCount = 0;
  let invoicedTaskCount = 0;
  
  cleaningTasks.forEach(task => {
    const taskDate = task.service_date;
    const isCurrentMonth = taskDate >= monthStartString && taskDate <= monthEndString;
    const taskBillingAmount = getTaskBillingAmount(task);
    const hasCharge = taskBillingAmount > 0;
    
    if (isCurrentMonth && hasCharge) {
      totalBillableAmount += taskBillingAmount;
      totalBillableTaskCount += 1;
      
      if (task.invoiced) {
        invoicedAmount += taskBillingAmount;
        invoicedTaskCount += 1;
      }
    }
  });
  
  const invoicedAmountEl = document.getElementById("invoicedAmount");
  const totalBillableAmountEl = document.getElementById("totalBillableAmount");
  const invoicedTaskCountEl = document.getElementById("invoicedTaskCount");
  const totalTaskCountEl = document.getElementById("totalTaskCount");
  const billingProgressLabelEl = document.getElementById("billingProgressLabel");
  const billingProgressFillEl = document.getElementById("billingProgressFill");

  const progressPercent = totalBillableAmount > 0
    ? Math.min(100, Math.round((invoicedAmount / totalBillableAmount) * 100))
    : 0;

  if (invoicedAmountEl) invoicedAmountEl.textContent = invoicedAmount;
  if (totalBillableAmountEl) totalBillableAmountEl.textContent = totalBillableAmount;
  if (invoicedTaskCountEl) invoicedTaskCountEl.textContent = invoicedTaskCount;
  if (totalTaskCountEl) totalTaskCountEl.textContent = totalBillableTaskCount;
  if (billingProgressLabelEl) billingProgressLabelEl.textContent = `${progressPercent}%`;
  if (billingProgressFillEl) billingProgressFillEl.style.width = `${progressPercent}%`;
}

function getPropertyName(propertyId) {
  const property = properties.find((property) => property.id === propertyId);
  return property ? property.property_name : "Unknown Property";
}

function parseDateString(dateString) {
  const [year, month, day] = dateString.split("-").map((part) => Number(part));
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDateValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeServiceDateValue(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return value.toISOString();
  }

  const stringValue = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(stringValue)) {
    return stringValue;
  }

  const parsedDate = new Date(stringValue);
  if (!Number.isNaN(parsedDate.getTime())) {
    return parsedDate.toISOString();
  }

  return null;
}

function getMonthRange(monthType) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  let startDate, endDate;

  if (monthType === "current") {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  } else if (monthType === "next") {
    startDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    endDate = new Date(now.getFullYear(), now.getMonth() + 2, 0);
  } else if (monthType === "previous") {
    startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    endDate = new Date(now.getFullYear(), now.getMonth(), 0);
  } else {
    return null;
  }

  return {
    start: formatDateValue(startDate),
    end: formatDateValue(endDate)
  };
}

function taskMatchesDateFilter(task, monthType) {
  if (monthType === "all") return true;

  const range = getMonthRange(monthType);
  if (!range) return true;

  const taskDate = task.service_date || task.scheduled_date;
  if (!taskDate) return false;

  const taskDateStr = formatDateValue(parseDateString(taskDate));
  return taskDateStr >= range.start && taskDateStr <= range.end;
}

function togglePropertyCardCollapse(propertyId) {
  if (collapsedPropertyCards.has(propertyId)) {
    collapsedPropertyCards.delete(propertyId);
  } else {
    collapsedPropertyCards.add(propertyId);
  }
  renderProperties();
}

function getTodayCleaningTasks() {
  const today = new Date();
  const todayString = formatDateValue(today);

  console.log("[TodayView] Today date string:", todayString);

  const todayTasks = cleaningTasks.filter((task) => {
    if (!task.service_date) return false;
    if (shouldSuppressWeeklyStandardTaskDisplay(task)) return false;
    return task.service_date === todayString;
  });

  console.log("[TodayView] Tasks matching today:", todayTasks.length, todayTasks.map(t => ({ id: t.id, service_date: t.service_date, service_type: t.service_type })));

  return todayTasks.sort((a, b) => a.service_date.localeCompare(b.service_date));
}

function getUpcomingCleaningTasks() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() + 7);

  const todayString = formatDateValue(today);
  const endString = formatDateValue(endDate);

  console.log("Today's date string:", todayString);
  console.log("Seven-days-out date string:", endString);

  const filteredTasks = cleaningTasks
    .filter((task) => {
      if (!task.service_date) return false;
      if (shouldSuppressWeeklyStandardTaskDisplay(task)) return false;

      const status = String(task.status || "").trim().toLowerCase();
      if (status === "cancelled") return false;

      const taskDate = normalizeServiceDateValue(task.service_date);
      if (!taskDate) return false;

      if (taskDate.length === 10 && todayString.length === 10 && endString.length === 10) {
        return taskDate >= todayString && taskDate <= endString;
      }

      return taskDate >= today.toISOString() && taskDate <= endDate.toISOString();
    })
    .sort((a, b) => normalizeServiceDateValue(a.service_date).localeCompare(normalizeServiceDateValue(b.service_date)));

  console.log("Filtered week tasks:", filteredTasks);
  return filteredTasks;
}

function isTaskGuestReady(task) {
  return Boolean(task.guest_ready || task.service_type === "Guest Ready");
}

function getDayNameFromDateString(dateString) {
  if (!dateString) return null;
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return dayNames[parseDateString(dateString).getUTCDay()];
}

function getDayNumberFromName(dayName) {
  const days = {
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

function getCoverageRuleForProperty(property) {
  const rawRule = String(property?.coverage_rule || "").toLowerCase();
  if (["none", "before", "after", "both"].includes(rawRule)) {
    return rawRule;
  }

  const rawCoverage = Number(property?.coverage_days);
  if (rawCoverage === 0) return "none";
  if (rawCoverage === 1) return "both";
  if (rawCoverage > 1) return "both";
  return "both";
}

function getCoverageOffsetsForRule(rule) {
  if (rule === "none") return [0];
  if (rule === "before") return [-1, 0];
  if (rule === "after") return [0, 1];
  return [-1, 0, 1];
}

function getCoverageRuleLabel(rule) {
  if (rule === "none") return "No Flex (service day only)";
  if (rule === "before") return "Service day -1 day only";
  if (rule === "after") return "Service day +1 day only";
  return "Service day +/- 1 day";
}

function getServiceDateForWeek(checkInDateString, standardDay) {
  const checkInDate = parseDateString(checkInDateString);
  const standardDayNumber = getDayNumberFromName(standardDay);
  if (standardDayNumber === undefined) {
    return checkInDateString;
  }

  const checkInDayNumber = checkInDate.getUTCDay();
  const startOfWeek = new Date(checkInDate);
  startOfWeek.setUTCDate(checkInDate.getUTCDate() - checkInDayNumber);

  const serviceDate = new Date(startOfWeek);
  serviceDate.setUTCDate(startOfWeek.getUTCDate() + standardDayNumber);
  return formatDateValue(serviceDate);
}

function getIncludedDaysForCoverageRule(standardDay, coverageRuleValue = "both") {
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const standardDayNumber = getDayNumberFromName(standardDay);
  if (standardDayNumber === undefined) {
    return new Set(["Wednesday"]);
  }

  const includedDays = new Set();
  for (const offset of getCoverageOffsetsForRule(coverageRuleValue)) {
    includedDays.add(dayNames[(standardDayNumber + offset + 7) % 7]);
  }

  return includedDays;
}

function formatIncludedDaysLabel(includedDaysSet) {
  const orderedDayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return orderedDayNames.filter((day) => includedDaysSet.has(day)).join("/");
}

function normalizeDateKey(value) {
  if (!value) return null;

  if (value instanceof Date) {
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  const stringValue = String(value).trim();
  const isoDateMatch = stringValue.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoDateMatch) return isoDateMatch[1];

  const parsed = new Date(stringValue);
  if (Number.isNaN(parsed.getTime())) return null;

  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizePropertyId(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function normalizePropertyName(value) {
  return String(value || "").trim().toLowerCase();
}

function getTaskPropertyMatchInfo(task) {
  const taskPropertyId = normalizePropertyId(task?.property_id ?? task?.propertyId);
  const propertyById = taskPropertyId
    ? properties.find((property) => normalizePropertyId(property.id) === taskPropertyId)
    : null;
  const propertyNameFromProperty = normalizePropertyName(propertyById?.property_name);
  const taskPropertyName = normalizePropertyName(task?.property_name || task?.propertyName);

  return {
    propertyId: taskPropertyId,
    propertyNameFromProperty,
    taskPropertyName,
    displayName: propertyById?.property_name || task?.property_name || task?.propertyName || "Unknown Property",
  };
}

function reservationMatchesTaskProperty(reservation, taskProperty) {
  const reservationPropertyId = normalizePropertyId(reservation?.property_id ?? reservation?.propertyId);
  if (taskProperty.propertyId && reservationPropertyId && taskProperty.propertyId === reservationPropertyId) return true;

  const reservationProperty = reservationPropertyId
    ? properties.find((property) => normalizePropertyId(property.id) === reservationPropertyId)
    : null;
  const reservationPropertyName = normalizePropertyName(
    reservation?.property_name || reservation?.propertyName || reservationProperty?.property_name
  );

  if (taskProperty.propertyNameFromProperty && reservationPropertyName && taskProperty.propertyNameFromProperty === reservationPropertyName) {
    return true;
  }

  if (taskProperty.taskPropertyName && reservationPropertyName && taskProperty.taskPropertyName === reservationPropertyName) {
    return true;
  }

  return false;
}

function getSameDayTurnoverForTask(task) {
  if (!isTaskGuestReady(task)) return null;

  const taskDate = normalizeDateKey(task?.service_date || task?.scheduled_date || task?.serviceDate || task?.date);
  const taskProperty = getTaskPropertyMatchInfo(task);
  const hasPropertyMatchKey = Boolean(taskProperty.propertyId || taskProperty.propertyNameFromProperty || taskProperty.taskPropertyName);

  if (!taskDate || !hasPropertyMatchKey) {
    console.log("SAME DAY DEBUG", {
      taskPropertyName: taskProperty.displayName,
      taskPropertyId: taskProperty.propertyId || null,
      taskServiceDateNormalized: taskDate,
      reservationsForSameProperty: [],
      hasCheckIn: false,
      hasCheckOut: false,
      sameDayTurnover: false,
    });
    return null;
  }

  const reservationsForSameProperty = reservations.filter((reservation) => reservationMatchesTaskProperty(reservation, taskProperty));

  let hasCheckIn = false;
  let hasCheckOut = false;
  let checkInDate = null;
  let checkOutDate = null;
  const reservationDebugRows = [];

  for (const reservation of reservationsForSameProperty) {
    const reservationPropertyId = normalizePropertyId(reservation?.property_id ?? reservation?.propertyId) || null;
    const reservationCheckIn = normalizeDateKey(reservation?.check_in ?? reservation?.checkIn ?? reservation?.startDate);
    const reservationCheckOut = normalizeDateKey(reservation?.check_out ?? reservation?.checkOut ?? reservation?.endDate);

    reservationDebugRows.push({
      reservationId: reservation?.id || null,
      reservationPropertyId,
      reservationPropertyName: reservation?.property_name || reservation?.propertyName || null,
      reservationCheckInNormalized: reservationCheckIn,
      reservationCheckOutNormalized: reservationCheckOut,
    });

    if (reservationCheckIn === taskDate) {
      hasCheckIn = true;
      checkInDate = reservationCheckIn;
    }

    if (reservationCheckOut === taskDate) {
      hasCheckOut = true;
      checkOutDate = reservationCheckOut;
    }
  }

  const sameDayTurnover = hasCheckIn && hasCheckOut;

  console.log("SAME DAY DEBUG", {
    taskPropertyName: taskProperty.displayName,
    taskPropertyId: taskProperty.propertyId || null,
    taskServiceDateNormalized: taskDate,
    reservationsForSameProperty: reservationDebugRows,
    hasCheckIn,
    hasCheckOut,
    sameDayTurnover,
  });

  if (sameDayTurnover) {
    return {
      turnoverDate: taskDate,
      checkOutDate,
      checkInDate,
      propertyName: taskProperty.displayName,
    };
  }

  return null;
}

function isSameDayTurnoverTask(task) {
  return Boolean(getSameDayTurnoverForTask(task));
}

function findSameDayTurnover(propertyId, serviceDate) {
  return getSameDayTurnoverForTask({
    guest_ready: true,
    property_id: propertyId,
    service_date: serviceDate,
  });
}

function isSameDayCheckInGuestReadyTask(task) {
  return isSameDayTurnoverTask(task);
}

function isAutoWeeklyTask(task) {
  const status = String(task.status || "Scheduled");
  return task.service_type === "Weekly Standard"
    && !task.manually_modified
    && status === "Scheduled"
    && !task.completed_at
    && !task.invoiced;
}

function isDateWithinCoverageRule(serviceDate, candidateDate, coverageRuleValue) {
  if (!serviceDate || !candidateDate) return false;
  const service = parseDateString(serviceDate);
  const candidate = parseDateString(candidateDate);
  const dayDiff = Math.round((candidate.getTime() - service.getTime()) / (1000 * 60 * 60 * 24));
  return getCoverageOffsetsForRule(coverageRuleValue).includes(dayDiff);
}

function shouldSuppressWeeklyStandardTaskDisplay(task) {
  if (!task || task.service_type !== "Weekly Standard") return false;

  const property = properties.find((p) => p.id === task.property_id);
  if (!property) return false;

  const propertyCoverageRule = getCoverageRuleForProperty(property);
  const weeklyServiceDate = task.service_date || task.scheduled_date;
  if (!weeklyServiceDate) return false;

  return cleaningTasks.some((otherTask) => {
    if (otherTask.id === task.id) return false;
    if (otherTask.property_id !== task.property_id) return false;
    if (!isTaskGuestReady(otherTask)) return false;

    const otherStatus = String(otherTask.status || "").toLowerCase();
    if (otherStatus === "cancelled") return false;

    const otherDate = otherTask.service_date || otherTask.scheduled_date;
    return isDateWithinCoverageRule(weeklyServiceDate, otherDate, propertyCoverageRule);
  });
}

function getGuestReadyBillingDetails(task) {
  const serviceDate = task.service_date || task.scheduled_date;
  const serviceDay = getDayNameFromDateString(serviceDate);
  const property = properties.find((p) => p.id === task.property_id);
  const standardDay = property?.standard_service_day || "Wednesday";
  const propertyCoverageRule = getCoverageRuleForProperty(property);
  const includedDays = getIncludedDaysForCoverageRule(standardDay, propertyCoverageRule);
  const isIncluded = Boolean(serviceDay && includedDays.has(serviceDay));
  const rawCharge = Number(task.charge || 0);
  const defaultCharge = Number(property?.default_off_cycle_charge ?? 65);

  if (isIncluded && hasManualBillingOverride(task) && rawCharge > 0) {
    return {
      isIncluded: false,
      isChargeable: true,
      isManualOverride: true,
      effectiveCharge: rawCharge,
      serviceDay,
      standardDay,
      coverageRule: propertyCoverageRule,
      coverageRuleLabel: getCoverageRuleLabel(propertyCoverageRule),
      includedDaysLabel: formatIncludedDaysLabel(includedDays),
      billingReasonLabel: "Manual Override",
    };
  }

  if (isIncluded) {
    return {
      isIncluded: true,
      isChargeable: false,
      isManualOverride: false,
      effectiveCharge: 0,
      serviceDay,
      standardDay,
      coverageRule: propertyCoverageRule,
      coverageRuleLabel: getCoverageRuleLabel(propertyCoverageRule),
      includedDaysLabel: formatIncludedDaysLabel(includedDays),
      billingReasonLabel: "Included",
    };
  }

  return {
    isIncluded: false,
    isChargeable: true,
    isManualOverride: false,
    effectiveCharge: rawCharge > 0 ? rawCharge : defaultCharge,
    serviceDay,
    standardDay,
    coverageRule: propertyCoverageRule,
    coverageRuleLabel: getCoverageRuleLabel(propertyCoverageRule),
    includedDaysLabel: formatIncludedDaysLabel(includedDays),
    billingReasonLabel: "Chargeable",
  };
}

function getTaskBillingContext(task) {
  if (!isTaskGuestReady(task)) {
    const amount = Number(task.charge || 0);
    return {
      billableAmount: amount,
      isBillable: amount > 0,
      billingReasonLabel: amount > 0 ? "Manual Charge" : "Included",
    };
  }

  const guestReadyBilling = getGuestReadyBillingDetails(task);
  const amount = guestReadyBilling.isChargeable ? Number(guestReadyBilling.effectiveCharge || 0) : 0;
  return {
    billableAmount: amount,
    isBillable: amount > 0,
    billingReasonLabel: guestReadyBilling.billingReasonLabel,
    guestReadyBilling,
  };
}

function getTaskBillingAmount(task) {
  return getTaskBillingContext(task).billableAmount;
}

function hasManualBillingOverride(task) {
  return String(task?.notes || "").includes(MANUAL_BILLING_OVERRIDE_TAG);
}

function stripManualBillingOverrideTag(notes) {
  return String(notes || "").replace(MANUAL_BILLING_OVERRIDE_TAG, "").trim();
}

function applyManualBillingOverrideTag(notes, shouldApply) {
  const cleanNotes = stripManualBillingOverrideTag(notes);
  if (!shouldApply) return cleanNotes;
  return cleanNotes ? `${MANUAL_BILLING_OVERRIDE_TAG} ${cleanNotes}` : MANUAL_BILLING_OVERRIDE_TAG;
}

function getChemicalReportRows() {
  if (!chemicalReportStartDate || !chemicalReportEndDate) return [];

  const startDate = chemicalReportStartDate.value;
  const endDate = chemicalReportEndDate.value;
  if (!startDate || !endDate) return [];

  const selectedPropertyId = chemicalReportPropertySelect?.value || "";
  const selectedChemical = chemicalReportTypeSelect?.value || "";

  return chemicalUsageEntries
    .filter((entry) => {
      const dateValue = String(entry.service_date || "");
      return Boolean(dateValue && dateValue >= startDate && dateValue <= endDate);
    })
    .filter((entry) => !selectedPropertyId || normalizePropertyId(entry.property_id) === normalizePropertyId(selectedPropertyId))
    .filter((entry) => !selectedChemical || String(entry.chemical_name || "") === selectedChemical)
    .sort((a, b) => {
      const propertyCompare = String(a.property_name || "").localeCompare(String(b.property_name || ""));
      if (propertyCompare !== 0) return propertyCompare;
      return String(a.service_date || "").localeCompare(String(b.service_date || ""));
    });
}

function renderChemicalUsageReport() {
  if (!chemicalReportContainer) return;

  const propertyOptions = `<option value="">All Properties</option>${properties
    .slice()
    .sort((a, b) => String(a.property_name || "").localeCompare(String(b.property_name || "")))
    .map((property) => `<option value="${property.id}">${property.property_name}</option>`)
    .join("")}`;

  if (chemicalReportPropertySelect && chemicalReportPropertySelect.innerHTML !== propertyOptions) {
    const previousValue = chemicalReportPropertySelect.value;
    chemicalReportPropertySelect.innerHTML = propertyOptions;
    chemicalReportPropertySelect.value = previousValue;
  }

  const chemicalTypeOptions = `<option value="">All Chemicals</option>${CHEMICAL_NAME_OPTIONS
    .map((name) => `<option value="${name}">${name}</option>`)
    .join("")}`;

  if (chemicalReportTypeSelect && chemicalReportTypeSelect.innerHTML !== chemicalTypeOptions) {
    const previousValue = chemicalReportTypeSelect.value;
    chemicalReportTypeSelect.innerHTML = chemicalTypeOptions;
    chemicalReportTypeSelect.value = previousValue;
  }

  const startDate = chemicalReportStartDate?.value || "";
  const endDate = chemicalReportEndDate?.value || "";
  if (!startDate || !endDate) {
    chemicalReportContainer.innerHTML = `<div class="empty">Select a start and end date to run the chemical usage report.</div>`;
    return;
  }

  const selectedPropertyId = chemicalReportPropertySelect?.value || "";
  const selectedChemical = chemicalReportTypeSelect?.value || "";
  const selectedPropertyName = selectedPropertyId
    ? (properties.find((property) => normalizePropertyId(property.id) === normalizePropertyId(selectedPropertyId))?.property_name || "Unknown Property")
    : "All Properties";
  const generatedDate = new Date().toLocaleDateString();

  const rows = getChemicalReportRows();
  latestChemicalReportState = {
    startDate,
    endDate,
    selectedPropertyId,
    selectedChemical,
    rows,
  };

  if (!rows.length) {
    chemicalReportContainer.innerHTML = `
      <div class="billing-report-sheet chemical-report-sheet">
        ${renderBillingReportHeader()}
        <h2 class="billing-report-title">Chemical Usage Report</h2>
        <div class="billing-report-meta">Date Range: ${startDate} to ${endDate}</div>
        <div class="billing-report-meta">Property: ${selectedPropertyName}</div>
        <div class="billing-report-meta">Chemical: ${selectedChemical || "All Chemicals"}</div>
        <div class="billing-report-meta">Generated: ${generatedDate}</div>
        <div class="empty">No chemical usage entries found for the selected filters.</div>
        ${renderBillingReportFooter()}
      </div>
    `;
    return;
  }

  const detailRows = rows.map((entry) => `
    <tr>
      <td>${entry.property_name || "Unknown Property"}</td>
      <td>${entry.service_date || "-"}</td>
      <td>${entry.chemical_name || "-"}</td>
      <td>${Number(entry.quantity || 0).toFixed(2).replace(/\.00$/, "")}</td>
      <td>${entry.unit || "-"}</td>
      <td>${entry.notes || ""}</td>
    </tr>
  `).join("");

  const totalsByProperty = new Map();
  const overallTotals = new Map();

  for (const entry of rows) {
    const propertyName = entry.property_name || "Unknown Property";
    const propertyKey = `${propertyName}|${entry.chemical_name || "Unknown"}|${entry.unit || "unit"}`;
    const overallKey = `${entry.chemical_name || "Unknown"}|${entry.unit || "unit"}`;

    totalsByProperty.set(propertyKey, {
      propertyName,
      chemicalName: entry.chemical_name || "Unknown",
      unit: entry.unit || "unit",
      total: (totalsByProperty.get(propertyKey)?.total || 0) + Number(entry.quantity || 0),
    });

    overallTotals.set(overallKey, {
      chemicalName: entry.chemical_name || "Unknown",
      unit: entry.unit || "unit",
      total: (overallTotals.get(overallKey)?.total || 0) + Number(entry.quantity || 0),
    });
  }

  const groupedByPropertyName = new Map();
  for (const totalRow of totalsByProperty.values()) {
    if (!groupedByPropertyName.has(totalRow.propertyName)) {
      groupedByPropertyName.set(totalRow.propertyName, []);
    }
    groupedByPropertyName.get(totalRow.propertyName).push(totalRow);
  }

  const totalsByPropertyMarkup = Array.from(groupedByPropertyName.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([propertyName, totals]) => `
      <section class="billing-report-group">
        <h3>${propertyName}</h3>
        <ul class="chemical-total-list">
          ${totals
            .sort((a, b) => a.chemicalName.localeCompare(b.chemicalName))
            .map((item) => `<li>${item.chemicalName}: ${item.total.toFixed(2).replace(/\.00$/, "")} ${item.unit}</li>`)
            .join("")}
        </ul>
      </section>
    `).join("");

  const overallTotalsMarkup = Array.from(overallTotals.values())
    .sort((a, b) => a.chemicalName.localeCompare(b.chemicalName))
    .map((item) => `<li>${item.chemicalName}: ${item.total.toFixed(2).replace(/\.00$/, "")} ${item.unit}</li>`)
    .join("");

  chemicalReportContainer.innerHTML = `
    <div class="billing-report-sheet chemical-report-sheet">
      ${renderBillingReportHeader()}
      <h2 class="billing-report-title">Chemical Usage Report</h2>
      <div class="billing-report-meta">Date Range: ${startDate} to ${endDate}</div>
      <div class="billing-report-meta">Property: ${selectedPropertyName}</div>
      <div class="billing-report-meta">Chemical: ${selectedChemical || "All Chemicals"}</div>
      <div class="billing-report-meta">Generated: ${generatedDate}</div>

      <section class="billing-report-group">
        <h3>Usage Details</h3>
        <table class="billing-report-table">
          <thead>
            <tr>
              <th>Property Name</th>
              <th>Service Date</th>
              <th>Chemical</th>
              <th>Quantity</th>
              <th>Unit</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            ${detailRows}
          </tbody>
        </table>
      </section>

      <section class="billing-report-group">
        <h3>Totals By Property</h3>
        ${totalsByPropertyMarkup}
      </section>

      <section class="billing-report-group">
        <h3>Overall Totals By Chemical</h3>
        <ul class="chemical-total-list">
          ${overallTotalsMarkup}
        </ul>
      </section>

      ${renderBillingReportFooter()}
    </div>
  `;
}

async function shareChemicalUsageReport() {
  const rows = latestChemicalReportState.rows || [];
  if (!rows.length) {
    alert("Run the chemical usage report first to share it.");
    return;
  }

  const selectedPropertyName = latestChemicalReportState.selectedPropertyId
    ? (properties.find((property) => normalizePropertyId(property.id) === normalizePropertyId(latestChemicalReportState.selectedPropertyId))?.property_name || "Unknown Property")
    : "All Properties";

  const previewLines = rows.slice(0, 8).map((row) => {
    return `${row.service_date} | ${row.property_name || "Unknown Property"} | ${row.chemical_name} ${Number(row.quantity || 0).toFixed(2).replace(/\.00$/, "")} ${row.unit}`;
  });

  const text = [
    `${companyProfile.company_name} - Chemical Usage Report`,
    `Date Range: ${latestChemicalReportState.startDate} to ${latestChemicalReportState.endDate}`,
    `Property: ${selectedPropertyName}`,
    `Chemical: ${latestChemicalReportState.selectedChemical || "All Chemicals"}`,
    "",
    ...previewLines,
    rows.length > previewLines.length ? `...and ${rows.length - previewLines.length} more entries.` : "",
  ].filter(Boolean).join("\n");

  if (navigator.share) {
    try {
      await navigator.share({
        title: "Chemical Usage Report",
        text,
      });
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
    }
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    alert("Report summary copied to clipboard.");
    return;
  }

  alert("Share is not available on this device/browser.");
}

function renderBillingReportHeader() {
  const logoMarkup = companyProfile.logo_url
    ? `<img src="${companyProfile.logo_url}" alt="${companyProfile.company_name} logo" class="company-logo billing-report-logo" onerror="this.style.display='none'">`
    : "";

  return `
    <div class="billing-report-header-block">
      ${logoMarkup}
      <div>
        <div class="billing-report-brand">${companyProfile.company_name}</div>
        <div class="billing-report-brand-subtitle">${companyProfile.tagline}</div>
      </div>
    </div>
  `;
}

function renderBillingReportFooter() {
  const contactParts = [];
  if (companyProfile.phone_number) contactParts.push(companyProfile.phone_number);
  if (companyProfile.email) contactParts.push(companyProfile.email);

  if (!contactParts.length) return "";

  return `<div class="billing-report-footer">${contactParts.join(" | ")}</div>`;
}

function getBillingReportRows() {
  if (!billingStartDate || !billingEndDate) return [];

  const startDate = billingStartDate.value;
  const endDate = billingEndDate.value;
  if (!startDate || !endDate) return [];

  const selectedPropertyId = billingPropertySelect?.value || "";

  return cleaningTasks
    .filter((task) => String(task.status || "").toLowerCase() === "completed")
    .filter((task) => {
      const taskDate = task.service_date || task.scheduled_date;
      return Boolean(taskDate && taskDate >= startDate && taskDate <= endDate);
    })
    .filter((task) => !selectedPropertyId || task.property_id === selectedPropertyId)
    .filter((task) => isTaskReconciled(task))
    .map((task) => {
      const billingContext = getTaskBillingContext(task);
      return {
        ...task,
        billableAmount: billingContext.billableAmount,
        billingReasonLabel: billingContext.billingReasonLabel,
      };
    })
    .filter((task) => task.billableAmount > 0)
    .sort((a, b) => {
      const aName = getPropertyName(a.property_id);
      const bName = getPropertyName(b.property_id);
      if (aName !== bName) return aName.localeCompare(bName);
      const aDate = a.service_date || a.scheduled_date || "";
      const bDate = b.service_date || b.scheduled_date || "";
      return aDate.localeCompare(bDate);
    });
}

function renderBillingReport() {
  if (!billingReportContainer) return;

  const propertyOptions = `<option value="">All Properties</option>${properties
    .slice()
    .sort((a, b) => (a.property_name || "").localeCompare(b.property_name || ""))
    .map((p) => `<option value="${p.id}">${p.property_name}</option>`)
    .join("")}`;

  if (billingPropertySelect && billingPropertySelect.innerHTML !== propertyOptions) {
    const previousValue = billingPropertySelect.value;
    billingPropertySelect.innerHTML = propertyOptions;
    billingPropertySelect.value = previousValue;
  }

  const rows = getBillingReportRows();
  const startDate = billingStartDate?.value || "";
  const endDate = billingEndDate?.value || "";
  const generatedDate = new Date().toLocaleDateString();

  if (!startDate || !endDate) {
    billingReportContainer.innerHTML = `<div class="empty">Select a start and end date to run the billing report.</div>`;
    return;
  }

  const grouped = new Map();
  for (const row of rows) {
    const propertyName = getPropertyName(row.property_id);
    if (!grouped.has(propertyName)) {
      grouped.set(propertyName, []);
    }
    grouped.get(propertyName).push(row);
  }

  let grandTotal = 0;
  const groupMarkup = Array.from(grouped.entries()).map(([propertyName, items]) => {
    const subtotal = items.reduce((sum, item) => sum + Number(item.billableAmount || 0), 0);
    grandTotal += subtotal;

    const rowsHtml = items.map((item) => {
      const dateLabel = item.service_date || item.scheduled_date || "-";
      const serviceLabel = item.service_type || "Manual";
      const reasonLabel = item.billingReasonLabel || "Chargeable";
      return `
        <tr>
          <td>${dateLabel}</td>
          <td>${serviceLabel}</td>
          <td>${reasonLabel}</td>
          <td class="billing-report-amount">$${Number(item.billableAmount).toFixed(2)}</td>
        </tr>
      `;
    }).join("");

    return `
      <section class="billing-report-group">
        <h3>${propertyName}</h3>
        <table class="billing-report-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Service</th>
              <th>Billing Reason</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
        <div class="billing-report-subtotal">Property Subtotal: $${subtotal.toFixed(2)}</div>
      </section>
    `;
  }).join("");

  if (!rows.length) {
    billingReportContainer.innerHTML = `
      <div class="billing-report-sheet">
        ${renderBillingReportHeader()}
        <h2 class="billing-report-title">Cleaning Billing Report</h2>
        <div class="billing-report-meta">Billing Period: ${startDate} to ${endDate}</div>
        <div class="billing-report-meta">Generated: ${generatedDate}</div>
        <div class="empty">No billable completed tasks found for the selected filters.</div>
        ${renderBillingReportFooter()}
      </div>
    `;
    return;
  }

  billingReportContainer.innerHTML = `
    <div class="billing-report-sheet">
      ${renderBillingReportHeader()}
      <h2 class="billing-report-title">Cleaning Billing Report</h2>
      <div class="billing-report-meta">Billing Period: ${startDate} to ${endDate}</div>
      <div class="billing-report-meta">Generated: ${generatedDate}</div>
      ${groupMarkup}
      <div class="billing-report-grand-total">Grand Total: $${grandTotal.toFixed(2)}</div>
      ${renderBillingReportFooter()}
    </div>
  `;
}

function getDateStringsInRange(startDate, endDate) {
  const dates = [];
  const cursor = parseDateString(startDate);
  const end = parseDateString(endDate);

  while (cursor <= end) {
    dates.push(formatDateValue(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

function getRouteFragmentationGroupLabel(property) {
  const clientName = String(property?.client_name || "").trim();
  return clientName || "Unassigned Client";
}

function isIncludedFlexServiceTask(task, property) {
  if (!task || !property) return false;
  if (!isTaskGuestReady(task)) return false;
  if (Number(task.charge || 0) !== 0) return false;

  const taskDate = task.service_date || task.scheduled_date;
  if (!taskDate) return false;

  const standardDay = property.standard_service_day || "Wednesday";
  const scheduledWeeklyServiceDate = getServiceDateForWeek(taskDate, standardDay);
  if (!scheduledWeeklyServiceDate || taskDate === scheduledWeeklyServiceDate) return false;

  const coverageRule = getCoverageRuleForProperty(property);
  return isDateWithinCoverageRule(scheduledWeeklyServiceDate, taskDate, coverageRule);
}

function isRouteBillableEvent(task) {
  if (isTaskReconciled(task)) return true;
  const billingContext = getTaskBillingContext(task);
  if (billingContext.guestReadyBilling) {
    return billingContext.guestReadyBilling.isChargeable === true;
  }
  return Number(billingContext.billableAmount || 0) > 0;
}

function renderRouteFragmentationAnalytics() {
  if (!routeFragContainer) return;

  const startDate = routeFragStartDate?.value || "";
  const endDate = routeFragEndDate?.value || "";
  if (!startDate || !endDate) {
    routeFragContainer.innerHTML = `<div class="empty">Select a start and end date to run route fragmentation analytics.</div>`;
    return;
  }

  const activeProperties = properties.filter((property) => property.active !== false);
  if (!activeProperties.length) {
    routeFragContainer.innerHTML = `<div class="empty">No active properties found.</div>`;
    return;
  }

  const clientLabels = Array.from(new Set(activeProperties.map((property) => getRouteFragmentationGroupLabel(property))))
    .sort((a, b) => a.localeCompare(b));

  if (routeFragClientSelect) {
    const previousValue = routeFragClientSelect.value;
    const options = `<option value="">All Clients</option>${clientLabels.map((label) => `<option value="${label}">${label}</option>`).join("")}`;
    if (routeFragClientSelect.innerHTML !== options) {
      routeFragClientSelect.innerHTML = options;
    }
    routeFragClientSelect.value = clientLabels.includes(previousValue) ? previousValue : "";
  }

  const selectedClient = routeFragClientSelect?.value || "";
  const filteredProperties = selectedClient
    ? activeProperties.filter((property) => getRouteFragmentationGroupLabel(property) === selectedClient)
    : activeProperties;

  if (!filteredProperties.length) {
    routeFragContainer.innerHTML = `<div class="empty">No properties found for the selected client.</div>`;
    return;
  }

  const propertyMap = new Map(filteredProperties.map((property) => [property.id, property]));
  const groupMap = new Map();
  for (const property of filteredProperties) {
    const groupLabel = getRouteFragmentationGroupLabel(property);
    if (!groupMap.has(groupLabel)) {
      groupMap.set(groupLabel, {
        clientName: groupLabel,
        properties: [],
        propertyIds: new Set(),
        scheduledDayNames: new Set(),
      });
    }

    const group = groupMap.get(groupLabel);
    group.properties.push(property);
    group.propertyIds.add(property.id);
    if (property.standard_service_day) {
      group.scheduledDayNames.add(property.standard_service_day);
    }
  }

  const taskInRange = cleaningTasks.filter((task) => {
    if (!task?.property_id) return false;
    if (!propertyMap.has(task.property_id)) return false;
    const status = String(task.status || "").toLowerCase();
    if (status === "cancelled") return false;
    const taskDate = task.service_date || task.scheduled_date;
    return Boolean(taskDate && taskDate >= startDate && taskDate <= endDate);
  });

  const allDateStrings = getDateStringsInRange(startDate, endDate);
  const dayNameByDate = new Map(allDateStrings.map((dateValue) => [dateValue, getDayNameFromDateString(dateValue)]));

  const rows = Array.from(groupMap.values()).map((group) => {
    const groupTaskList = taskInRange.filter((task) => group.propertyIds.has(task.property_id));
    const scheduledDayNumbers = new Set(Array.from(group.scheduledDayNames)
      .map((dayName) => getDayNumberFromName(dayName))
      .filter((dayNumber) => dayNumber !== undefined));

    const scheduledRouteDates = new Set(allDateStrings.filter((dateValue) => {
      const dayName = dayNameByDate.get(dateValue);
      const dayNumber = getDayNumberFromName(dayName);
      return dayNumber !== undefined && scheduledDayNumbers.has(dayNumber);
    }));

    const actualRouteDates = new Set(groupTaskList
      .map((task) => task.service_date || task.scheduled_date)
      .filter(Boolean));

    const additionalRouteDates = new Set(Array.from(actualRouteDates).filter((dateValue) => !scheduledRouteDates.has(dateValue)));
    const billableByDate = new Map();
    const includedFlexByDate = new Map();
    const propertiesByDate = new Map();
    const recoveredRevenueByDate = new Map();

    let billableEvents = 0;
    let includedFlexServices = 0;
    let recoveredRevenue = 0;

    for (const task of groupTaskList) {
      const serviceDate = task.service_date || task.scheduled_date;
      const propertyName = getPropertyName(task.property_id);
      const property = propertyMap.get(task.property_id);

      if (!propertiesByDate.has(serviceDate)) propertiesByDate.set(serviceDate, new Set());
      propertiesByDate.get(serviceDate).add(propertyName);

      if (isIncludedFlexServiceTask(task, property)) {
        includedFlexServices += 1;
        includedFlexByDate.set(serviceDate, (includedFlexByDate.get(serviceDate) || 0) + 1);
      }

      if (!isRouteBillableEvent(task)) continue;

      const amount = Number(getTaskBillingAmount(task) || 0);
      billableEvents += 1;
      recoveredRevenue += amount;
      billableByDate.set(serviceDate, (billableByDate.get(serviceDate) || 0) + 1);
      recoveredRevenueByDate.set(serviceDate, (recoveredRevenueByDate.get(serviceDate) || 0) + amount);
    }

    const recoveredAdditionalRouteDays = Array.from(additionalRouteDates).filter((dateValue) => (billableByDate.get(dateValue) || 0) > 0).length;
    const scheduledRouteDays = scheduledRouteDates.size;
    const actualRouteDays = actualRouteDates.size;
    const additionalRouteDays = Math.max(0, actualRouteDays - scheduledRouteDays);
    const unrecoveredRouteDays = Math.max(0, additionalRouteDays - recoveredAdditionalRouteDays);

    const weekKeys = new Set(groupTaskList
      .map((task) => task.service_date || task.scheduled_date)
      .filter(Boolean)
      .map((dateValue) => formatDateValue(getMondayStartForDate(dateValue))));
    const weeksAnalyzed = weekKeys.size;
    const potentialStandardServices = group.propertyIds.size * weeksAnalyzed;
    const flexRatePercent = potentialStandardServices > 0
      ? (includedFlexServices / potentialStandardServices) * 100
      : 0;

    const weeklyMap = new Map();
    for (const serviceDate of Array.from(actualRouteDates).sort((a, b) => a.localeCompare(b))) {
      const weekOf = formatDateValue(getMondayStartForDate(serviceDate));
      if (!weeklyMap.has(weekOf)) {
        weeklyMap.set(weekOf, {
          weekOf,
          scheduledDayLabel: Array.from(group.scheduledDayNames).sort((a, b) => a.localeCompare(b)).join("/") || "Not set",
          dates: [],
        });
      }

      weeklyMap.get(weekOf).dates.push({
        date: serviceDate,
        propertyList: Array.from(propertiesByDate.get(serviceDate) || []).sort((a, b) => a.localeCompare(b)),
        billableTasks: billableByDate.get(serviceDate) || 0,
        includedFlexServices: includedFlexByDate.get(serviceDate) || 0,
        recoveredRevenue: Number(recoveredRevenueByDate.get(serviceDate) || 0),
      });
    }

    return {
      clientName: group.clientName,
      propertiesCount: group.propertyIds.size,
      scheduledRouteDays,
      actualRouteDays,
      additionalRouteDays,
      billableEvents,
      includedFlexServices,
      potentialStandardServices,
      flexRatePercent,
      recoveredRevenue,
      unrecoveredRouteDays,
      weeklyDetails: Array.from(weeklyMap.values()).sort((a, b) => a.weekOf.localeCompare(b.weekOf)),
    };
  }).sort((a, b) => a.clientName.localeCompare(b.clientName));

  if (!rows.length) {
    routeFragContainer.innerHTML = `<div class="empty">No route fragmentation data available for the selected range.</div>`;
    return;
  }

  const summaryRows = rows.map((row) => `
    <tr>
      <td>${row.clientName}</td>
      <td>${row.propertiesCount}</td>
      <td>${row.scheduledRouteDays}</td>
      <td>${row.actualRouteDays}</td>
      <td>${row.additionalRouteDays}</td>
      <td>${row.billableEvents}</td>
      <td>${row.includedFlexServices}</td>
      <td>${row.potentialStandardServices}</td>
      <td>${row.flexRatePercent.toFixed(1)}%</td>
      <td class="route-frag-money">$${row.recoveredRevenue.toFixed(2)}</td>
      <td>${row.unrecoveredRouteDays}</td>
    </tr>
  `).join("");

  const weeklySections = rows.map((row) => {
    const weeklyRows = row.weeklyDetails.length
      ? row.weeklyDetails.map((week) => {
          const actualDates = week.dates.map((dateInfo) => dateInfo.date).join(", ");
          const propertiesServiced = week.dates
            .map((dateInfo) => `${dateInfo.date}: ${dateInfo.propertyList.join(", ") || "None"}`)
            .join("<br>");
          const billableTasks = week.dates
            .map((dateInfo) => `${dateInfo.date}: ${dateInfo.billableTasks}`)
            .join("<br>");
          const includedFlexServices = week.dates
            .map((dateInfo) => `${dateInfo.date}: ${dateInfo.includedFlexServices}`)
            .join("<br>");
          const recoveredRevenue = week.dates
            .map((dateInfo) => `${dateInfo.date}: $${dateInfo.recoveredRevenue.toFixed(2)}`)
            .join("<br>");

          return `
            <tr>
              <td>${week.weekOf}</td>
              <td>${week.scheduledDayLabel}</td>
              <td>${actualDates || "None"}</td>
              <td>${propertiesServiced || "None"}</td>
              <td>${billableTasks || "0"}</td>
              <td>${includedFlexServices || "0"}</td>
              <td class="route-frag-money">${recoveredRevenue || "$0.00"}</td>
            </tr>
          `;
        }).join("")
      : `<tr><td colspan="7">No service activity in selected range.</td></tr>`;

    return `
      <section class="route-frag-weekly-group">
        <h3>${row.clientName}</h3>
        <table class="route-frag-table route-frag-weekly-table">
          <thead>
            <tr>
              <th>Week Of</th>
              <th>Scheduled Service Day</th>
              <th>Actual Service Dates</th>
              <th>Properties Serviced Each Date</th>
              <th>Billable Tasks on That Date</th>
              <th>Included Flex Services</th>
              <th>Recovered Revenue</th>
            </tr>
          </thead>
          <tbody>
            ${weeklyRows}
          </tbody>
        </table>
      </section>
    `;
  }).join("");

  routeFragContainer.innerHTML = `
    <div class="route-frag-summary-card">
      <div class="route-frag-meta">Date Range: ${startDate} to ${endDate}</div>
      <table class="route-frag-table">
        <thead>
          <tr>
            <th>Client Name</th>
            <th>Property Count</th>
            <th>Scheduled Route Days</th>
            <th>Actual Route Days</th>
            <th>Additional Route Days</th>
            <th>Billable Events</th>
            <th>Included Flex Services</th>
            <th>Potential Standard Services</th>
            <th>Flex Rate</th>
            <th>Recovered Revenue</th>
            <th>Unrecovered Route Days</th>
          </tr>
        </thead>
        <tbody>
          ${summaryRows}
        </tbody>
      </table>
      <div class="route-frag-meta">Included Flex Services: Guest Ready services provided at no additional charge by flexing service within the coverage window.</div>
      <div class="route-frag-meta">Potential Standard Services: The number of standard weekly service opportunities based on property count and weeks analyzed.</div>
      <div class="route-frag-meta">Flex Rate: Percentage of standard service opportunities that required schedule flexibility to accommodate guest arrivals.</div>
    </div>
    <div class="route-frag-weekly-wrap">
      ${weeklySections}
    </div>
  `;
}

function shouldShowReconcileForTask(task) {
  if (!task) return false;
  if (task.service_type === "Weekly Standard") return false;
  if (isTaskReconciled(task)) return false;

  if (isTaskGuestReady(task)) {
    const guestReadyBilling = getGuestReadyBillingDetails(task);
    if (guestReadyBilling.isChargeable) return true;
    return hasManualBillingOverride(task) && Number(task.charge || 0) > 0;
  }

  return Number(task.charge || 0) > 0;
}

function isTaskReconciled(task) {
  return task.invoiced === true || task.invoiced === 1 || task.invoiced === "true";
}

function renderTaskCard(task) {
  const status = task.status || "Scheduled";
  const cardClass = task.status === "Completed"
    ? "task-card completed"
    : task.status === "In Progress"
      ? "task-card in-progress"
      : "task-card";
  const badgeClass = task.status === "Completed"
    ? "badge-green"
    : isTaskGuestReady(task)
      ? "badge-yellow"
      : "badge-blue";
  const alertBadge = getAlertBadgeForTask(task);
  const showReconcile = shouldShowReconcileForTask(task);
  const invoiceMarkerClass = task.invoiced ? "invoice-marker-checked" : "invoice-marker-unchecked";

  return `
    <div class="${cardClass}">
      <div class="task-card-header">
        <div class="task-card-title">${getPropertyName(task.property_id)}</div>
        ${showReconcile ? `
        <label class="invoice-marker ${invoiceMarkerClass}">
          <input type="checkbox" ${task.invoiced ? "checked" : ""} onchange="toggleInvoiceMarker('${task.id}')" />
          <span>$</span>
        </label>
        ` : ""}
      </div>
      ${alertBadge}
      <div class="task-card-details">
        <div><strong>Service Date:</strong> ${task.service_date || task.scheduled_date || "Not set"}</div>
        <div><strong>Task Type:</strong> ${task.service_type || "Manual"}</div>
        <div><strong>Guest Ready:</strong> ${isTaskGuestReady(task) ? "Yes" : "No"}</div>
        ${task.check_in_date ? `<div><strong>Check-In:</strong> ${task.check_in_date}</div>` : ""}
        <div><strong>Status:</strong> <span class="status-badge ${badgeClass}">${status}</span></div>
      </div>
      <div class="task-card-actions">
        <button onclick="openEditCleaning('${task.id}')">Edit</button>
        ${status !== "Completed" && status !== "In Progress" ? `<button onclick="startCleaningTask('${task.id}')">Start</button>` : ""}
        ${status !== "Completed" ? `<button onclick="markCleaningComplete('${task.id}')">Complete</button>` : ""}
      </div>
    </div>
  `;
}

function getGuestProtectionAlerts() {
  const alerts = [];
  const grouped = new Map();

  for (const reservation of reservations) {
    const reservationPropertyId = normalizePropertyId(reservation?.property_id ?? reservation?.propertyId);
    const reservationPropertyName = normalizePropertyName(reservation?.property_name || reservation?.propertyName);
    const propertyKey = reservationPropertyId ? `id:${reservationPropertyId}` : reservationPropertyName ? `name:${reservationPropertyName}` : "";
    if (!propertyKey) continue;

    if (!grouped.has(propertyKey)) {
      const propertyById = reservationPropertyId
        ? properties.find((property) => String(property.id) === reservationPropertyId)
        : null;

      grouped.set(propertyKey, {
        propertyName: propertyById?.property_name || reservation?.property_name || reservation?.propertyName || "Unknown Property",
        checkIns: new Set(),
        checkOuts: new Set(),
      });
    }

    const group = grouped.get(propertyKey);
    const checkInDate = normalizeDateKey(reservation?.check_in ?? reservation?.checkIn ?? reservation?.startDate);
    const checkOutDate = normalizeDateKey(reservation?.check_out ?? reservation?.checkOut ?? reservation?.endDate);
    if (checkInDate) group.checkIns.add(checkInDate);
    if (checkOutDate) group.checkOuts.add(checkOutDate);
  }

  for (const group of grouped.values()) {
    for (const checkInDate of group.checkIns) {
      if (!group.checkOuts.has(checkInDate)) continue;
      alerts.push({
        type: "turnover",
        status: "red",
        propertyName: group.propertyName,
        turnoverDate: checkInDate,
        checkOutDate: checkInDate,
        checkInDate,
      });
    }
  }

  return alerts;
}

function renderGuestProtectionAlerts() {
  const alerts = getGuestProtectionAlerts();

  if (alerts.length === 0) {
    guestProtectionAlertsContainer.innerHTML = "";
    return;
  }

  guestProtectionAlertsContainer.innerHTML = `
    <div class="guest-protection-summary summary-red">
      🚨 ${alerts.length} Same-Day Turnover Alert${alerts.length !== 1 ? "s" : ""} &mdash; check Week View for details.
    </div>
  `;
}

function getAlertBadgeForTask(task) {
  const turnover = getSameDayTurnoverForTask(task);
  if (turnover) {
    const pName = String(turnover.propertyName || getPropertyName(task.property_id) || "Unknown Property").replace(/'/g, "\\'");
    return `<span class="task-alert-badge badge-alert-red" style="cursor:pointer"
      onclick="openAlertDetail('${pName}','${turnover.turnoverDate}','${turnover.checkOutDate}','${turnover.checkInDate}')">🚨 Same-Day Turnover</span>`;
  }

  return "";
}

function renderOperationsRemindersWidget() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const openReminders = operationsReminders.filter(r => r.status === "Open");
  
  if (openReminders.length === 0) {
    operationsRemindersWidget.innerHTML = "";
    return;
  }

  // Categorize reminders
  const overdue = openReminders.filter(r => {
    const dueDate = parseDateString(r.due_date);
    return dueDate < today;
  });

  const dueSoon = openReminders.filter(r => {
    const dueDate = parseDateString(r.due_date);
    const daysUntilDue = (dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
    return daysUntilDue >= 0 && daysUntilDue <= 3;
  });

  const remindersToShow = [...overdue, ...dueSoon];

  if (remindersToShow.length === 0) {
    operationsRemindersWidget.innerHTML = "";
    return;
  }

  const widgetHTML = `
    <div class="operations-reminders-widget">
      <div class="widget-header">
        ${overdue.length > 0 ? `<div class="widget-alert">⚠️ ${overdue.length} Overdue Reminder${overdue.length !== 1 ? "s" : ""}</div>` : ""}
        ${dueSoon.length > 0 ? `<div class="widget-alert-secondary">📋 ${dueSoon.length} Due Soon</div>` : ""}
      </div>
      <div class="widget-reminders">
        ${remindersToShow.map(reminder => {
          const property = properties.find(p => p.id === reminder.property_id);
          const dueDate = parseDateString(reminder.due_date);
          const isOverdue = dueDate < today;
          const reminderClass = isOverdue ? "widget-reminder overdue" : "widget-reminder due-soon";
          
          return `
            <div class="${reminderClass}">
              <div class="widget-reminder-property">${property?.property_name || "Unknown"}</div>
              <div class="widget-reminder-title">${reminder.title}</div>
              <div class="widget-reminder-date">Due: ${reminder.due_date}${isOverdue ? " (OVERDUE)" : ""}</div>
              ${reminder.notes ? `<div class="widget-reminder-notes">${reminder.notes}</div>` : ""}
              <button class="complete-reminder-btn-small" onclick="completeReminder('${reminder.id}')">✓ Complete</button>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;

  operationsRemindersWidget.innerHTML = widgetHTML;
}

function renderTaskViews() {
  renderGuestProtectionAlerts();

  const todayTasks = getTodayCleaningTasks();
  console.log("[TodayView] Rendering", todayTasks.length, "today tasks");
  todayTasksContainer.innerHTML = todayTasks.length
    ? todayTasks.map(renderTaskCard).join("")
    : `<div class="empty">No cleaning tasks due today.</div>`;

  renderWeekView();
}

function renderWeekView() {
  const weekTasks = getUpcomingCleaningTasks();
  
  if (!weekTasks.length) {
    weekTasksContainer.innerHTML = `<div class="empty">No cleaning tasks scheduled in the next 7 days.</div>`;
    weekTasksCalendarContainer.innerHTML = `<div class="empty">No cleaning tasks scheduled in the next 7 days.</div>`;
    weekTasksContainer.classList.remove("hidden");
    weekTasksCalendarContainer.classList.add("hidden");
    return;
  }

  if (weekViewMode === "calendar") {
    weekTasksContainer.classList.add("hidden");
    weekTasksCalendarContainer.classList.remove("hidden");
    renderWeekViewCalendar(weekTasks);
  } else {
    weekTasksContainer.classList.remove("hidden");
    weekTasksCalendarContainer.classList.add("hidden");
    renderWeekViewList(weekTasks);
  }
}

function renderWeekViewList(weekTasks) {
  const grouped = weekTasks.reduce((acc, task) => {
    const date = task.service_date;
    acc[date] = acc[date] || [];
    acc[date].push(task);
    return acc;
  }, {});

  weekTasksContainer.innerHTML = Object.keys(grouped)
    .sort((a, b) => parseDateString(a).getTime() - parseDateString(b).getTime())
    .map((date) => `
      <div class="week-group">
        <h3>${date}</h3>
        ${grouped[date].map(renderTaskCard).join("")}
      </div>
    `)
    .join("");
}

function renderWeekViewCalendar(weekTasks) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayString = formatDateValue(today);

  // Create 7-day calendar
  const dayColumns = [];
  for (let i = 0; i < 7; i++) {
    const columnDate = new Date(today);
    columnDate.setDate(columnDate.getDate() + i);
    dayColumns.push(columnDate);
  }

  // Group tasks by date
  const tasksByDate = {};
  weekTasks.forEach(task => {
    if (!tasksByDate[task.service_date]) {
      tasksByDate[task.service_date] = [];
    }
    tasksByDate[task.service_date].push(task);
  });

  // Build calendar HTML
  const calendarHTML = `
    <div class="week-calendar">
      ${dayColumns.map(date => {
        const dateString = formatDateValue(date);
        const dayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][date.getDay()];
        const dayTasks = tasksByDate[dateString] || [];
        const isToday = dateString === todayString;
        
        return `
          <div class="calendar-day-column ${isToday ? 'today' : ''}">
            <div class="calendar-day-header">
              <div class="calendar-day-name">${dayName}</div>
              <div class="calendar-day-date">${dateString}</div>
              <div class="calendar-task-count">${dayTasks.length} task${dayTasks.length !== 1 ? 's' : ''}</div>
            </div>
            <div class="calendar-day-tasks">
              ${dayTasks.length === 0
                ? `<p class="no-tasks">No tasks</p>`
                : dayTasks.map(task => {
                    const propertyName = properties.find(p => p.id === task.property_id)?.property_name || 'Unknown';
                    const guestReadyBadge = task.guest_ready ? `<span class="status-badge badge-yellow">GUEST READY</span>` : '';
                    const completedBadge = task.status === "Completed" ? `<span class="status-badge badge-green">COMPLETED</span>` : '';
                    const badgesToShow = guestReadyBadge || completedBadge || `<span class="status-badge badge-blue">${task.status || 'Scheduled'}</span>`;
                    const alertBadge = getAlertBadgeForTask(task);
                    const showReconcile = shouldShowReconcileForTask(task);
                    const invoiceMarkerClass = task.invoiced ? "invoice-marker-checked" : "invoice-marker-unchecked";
                    
                    return `
                      <div class="calendar-task-card">
                        <div class="calendar-task-header">
                          <div class="calendar-task-property">${propertyName}</div>
                          ${showReconcile ? `
                          <label class="invoice-marker ${invoiceMarkerClass}">
                            <input type="checkbox" ${task.invoiced ? "checked" : ""} onchange="toggleInvoiceMarker('${task.id}')" />
                            <span>$</span>
                          </label>
                          ` : ""}
                        </div>
                        <div class="calendar-task-type">${task.service_type}</div>
                        ${badgesToShow}
                        ${alertBadge}
                        <div class="calendar-task-status">${task.status || 'Scheduled'}</div>
                        <div class="calendar-task-edit-section">
                          <button class="calendar-task-btn edit-btn" onclick="openEditCleaning('${task.id}')">Edit</button>
                        </div>
                        <div class="calendar-task-action-section">
                          ${task.status !== "Completed" ? `<button class="calendar-task-btn complete-btn" onclick="markCleaningComplete('${task.id}')">Complete</button>` : '<div class="calendar-task-btn-placeholder"></div>'}
                          <button class="calendar-task-btn delete-btn" onclick="if (confirm('Delete this task?')) { deleteCleaningTask('${task.id}'); }">Delete</button>
                        </div>
                      </div>
                    `;
                  }).join('')
              }
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  weekTasksCalendarContainer.innerHTML = calendarHTML;
}

function getPropertyDetailTab(propertyId) {
  return propertyDetailTabState.get(propertyId) || "tasks";
}

function setPropertyDetailTab(propertyId, tabName) {
  propertyDetailTabState.set(propertyId, tabName === "history" ? "history" : "tasks");
  renderProperties();
}

function getPropertyChemicalFilters(propertyId) {
  if (!propertyChemicalFilterState.has(propertyId)) {
    propertyChemicalFilterState.set(propertyId, {
      startDate: "",
      endDate: "",
      chemicalName: "",
    });
  }
  return propertyChemicalFilterState.get(propertyId);
}

function updatePropertyChemicalFilter(propertyId, key, value) {
  const current = getPropertyChemicalFilters(propertyId);
  current[key] = value || "";
  propertyChemicalFilterState.set(propertyId, current);
  renderProperties();
}

function renderPropertyChemicalHistory(property) {
  const filters = getPropertyChemicalFilters(property.id);
  const rows = chemicalUsageEntries
    .filter((entry) => normalizePropertyId(entry.property_id) === normalizePropertyId(property.id))
    .filter((entry) => !filters.startDate || String(entry.service_date || "") >= filters.startDate)
    .filter((entry) => !filters.endDate || String(entry.service_date || "") <= filters.endDate)
    .filter((entry) => !filters.chemicalName || String(entry.chemical_name || "") === filters.chemicalName)
    .sort((a, b) => String(b.service_date || "").localeCompare(String(a.service_date || "")));

  const chemicalOptions = `<option value="">All Chemicals</option>${CHEMICAL_NAME_OPTIONS
    .map((name) => `<option value="${name}" ${filters.chemicalName === name ? "selected" : ""}>${name}</option>`)
    .join("")}`;

  const tableRows = rows.length
    ? rows.map((entry) => `
        <tr>
          <td>${entry.service_date || "-"}</td>
          <td>${entry.chemical_name || "-"}</td>
          <td>${Number(entry.quantity || 0).toFixed(2).replace(/\.00$/, "")}</td>
          <td>${entry.unit || "-"}</td>
          <td>${entry.notes || ""}</td>
        </tr>
      `).join("")
    : `<tr><td colspan="5">No chemical usage found for this property and filter selection.</td></tr>`;

  return `
    <div class="property-chemical-history">
      <div class="property-chemical-filters">
        <div class="filter-group">
          <label>Start:</label>
          <input type="date" value="${filters.startDate}" onchange="updatePropertyChemicalFilter('${property.id}','startDate',this.value)">
        </div>
        <div class="filter-group">
          <label>End:</label>
          <input type="date" value="${filters.endDate}" onchange="updatePropertyChemicalFilter('${property.id}','endDate',this.value)">
        </div>
        <div class="filter-group">
          <label>Chemical:</label>
          <select onchange="updatePropertyChemicalFilter('${property.id}','chemicalName',this.value)">
            ${chemicalOptions}
          </select>
        </div>
      </div>
      <table class="route-frag-table property-chemical-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Chemical</th>
            <th>Qty</th>
            <th>Unit</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
    </div>
  `;
}

function renderProperties() {
  document.getElementById("propertyCount").textContent = properties.length;

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const monthLabel = `${monthNames[currentMonth]} ${currentYear}`;
  const currentMonthLabelEl = document.getElementById("currentMonthLabel");
  if (currentMonthLabelEl) {
    currentMonthLabelEl.textContent = monthLabel;
  }

  refreshBillingCard();

  const propertyOptions = propertyFilterSelect.innerHTML;
  const newOptions = `<option value="">All Properties</option>${properties.map((p) => `<option value="${p.id}">${p.property_name}</option>`).join("")}`;
  if (propertyOptions !== newOptions) {
    propertyFilterSelect.innerHTML = newOptions;
    propertyFilterSelect.value = selectedPropertyFilter;
  }

  let filteredProperties = properties;
  if (selectedPropertyFilter) {
    filteredProperties = properties.filter((p) => p.id === selectedPropertyFilter);
  }

  if (filteredProperties.length === 0) {
    propertyList.innerHTML = `<div class="empty">No properties yet.</div>`;
    return;
  }

  propertyList.innerHTML = filteredProperties.map((property) => {
    let tasks = cleaningTasks.filter((task) => task.property_id === property.id);
    tasks = tasks.filter((task) => !shouldSuppressWeeklyStandardTaskDisplay(task));
    tasks = tasks.filter((task) => taskMatchesDateFilter(task, selectedMonthFilter));

    const hasSameDayGuestReady = tasks.some((task) => isSameDayCheckInGuestReadyTask(task));
    const isCollapsed = collapsedPropertyCards.has(property.id);
    const toggleButtonText = isCollapsed ? "Expand" : "Collapse";
    const activeTab = getPropertyDetailTab(property.id);

    const taskContent = tasks.length === 0
      ? `<p>No cleanings scheduled.</p>`
      : tasks.map((task) => {
          const taskBillingAmount = getTaskBillingAmount(task);
          const billingContext = getTaskBillingContext(task);
          const guestReadyBilling = billingContext.guestReadyBilling || null;
          const showReconcile = shouldShowReconcileForTask(task);
          const invoiceMarkerClass = task.invoiced ? "invoice-marker-checked" : "invoice-marker-unchecked";
          const taskClass =
            task.status === "Completed"
              ? "task-item completed"
              : task.guest_ready
                ? "task-item guestready"
                : task.off_cycle
                  ? "task-item offcycle"
                  : "task-item";

          const badge =
            task.status === "Completed"
              ? `<span class="status-badge badge-green">COMPLETED</span>`
              : task.guest_ready
                ? `<span class="status-badge badge-yellow">GUEST READY</span>`
                : task.off_cycle
                  ? `<span class="status-badge badge-purple">OFF CYCLE</span>`
                  : `<span class="status-badge badge-blue">SCHEDULED</span>`;

          const billingLine = guestReadyBilling
            ? guestReadyBilling.isManualOverride
              ? `<div class="task-line"><small>Billing: Manual Override (entered charge; rule: ${guestReadyBilling.coverageRuleLabel}; included days: ${guestReadyBilling.includedDaysLabel})</small></div>`
              : guestReadyBilling.isIncluded
                ? `<div class="task-line"><small>Billing: Included (${guestReadyBilling.serviceDay}; rule: ${guestReadyBilling.coverageRuleLabel}; included days: ${guestReadyBilling.includedDaysLabel})</small></div>`
                : `<div class="task-line"><small>Billing: Chargeable (${guestReadyBilling.serviceDay || "Outside route window"}; rule: ${guestReadyBilling.coverageRuleLabel}; included days: ${guestReadyBilling.includedDaysLabel})</small></div>`
            : taskBillingAmount > 0
              ? `<div class="task-line"><small>Billing: Manual Charge</small></div>`
              : "";

          const sameDayBadge = isSameDayCheckInGuestReadyTask(task)
            ? `<span class="task-alert-badge badge-alert-red">🚨 Same-Day Check-In</span>`
            : "";

          return `
            <div class="${taskClass}">
              <div class="task-item-header">
                <div class="task-title">${task.service_date} — ${task.service_type}</div>
                ${showReconcile ? `
                <label class="invoice-marker ${invoiceMarkerClass}">
                  <input type="checkbox" ${task.invoiced ? "checked" : ""} onchange="toggleInvoiceMarker('${task.id}')" />
                  <span>$ Reconcile</span>
                </label>
                ` : ""}
              </div>
              ${badge}
              ${sameDayBadge}
              ${taskBillingAmount > 0 ? `<div class="task-line">$${taskBillingAmount}</div>` : ""}
              ${billingLine}
              <div class="task-line"><small>Status: ${task.status}</small></div>
              ${task.completed_at ? `<div class="task-line"><small>Completed: ${new Date(task.completed_at).toLocaleString()}</small></div>` : ""}
              ${task.check_in_date ? `<div class="task-line"><small>Prior to check-in: ${task.check_in_date}</small></div>` : ""}
              ${task.notes ? `<div class="task-line"><small>Notes: ${stripManualBillingOverrideTag(task.notes)}</small></div>` : ""}
              <div class="task-buttons">
                <button onclick="openEditCleaning('${task.id}')">Edit</button>
                ${task.status !== "Completed" ? `<button onclick="markCleaningComplete('${task.id}')">Complete</button>` : ""}
                <button class="delete-btn" onclick="deleteCleaningTask('${task.id}')">Delete</button>
              </div>
            </div>
          `;
        }).join("");

    return `
      <div class="property-card">
        <div class="property-card-header">
          <div>
            <h3>${property.property_name}</h3>
            ${hasSameDayGuestReady ? `<span class="task-alert-badge badge-alert-red">🚨 Same-Day Check-In</span>` : ""}
          </div>
          <button class="collapse-btn" onclick="togglePropertyCardCollapse('${property.id}')">${toggleButtonText}</button>
        </div>

        <div class="property-meta">
          <div><strong>Client Name:</strong> ${property.client_name || ""}</div>
          <div><strong>Address:</strong> ${property.address || "Not entered"}</div>
          <div><strong>Standard Service Day:</strong> ${property.standard_service_day || "Wednesday"}</div>
          <div><strong>Guest Ready Coverage Rule:</strong> ${getCoverageRuleLabel(getCoverageRuleForProperty(property))}</div>
          <div><strong>Billable Guest Ready Charge:</strong> $${Number(property.default_off_cycle_charge ?? 65).toFixed(2)}</div>
          <div><strong>iCal:</strong> ${property.ical_url ? "Saved" : "Not entered"}</div>
        </div>

        <div class="card-actions">
          <button onclick="openCleaningModal('${property.id}')">+ Cleaning</button>
          <button onclick="openEditModal('${property.id}')">Edit</button>
          <button class="delete-btn" onclick="deleteProperty('${property.id}')">Delete</button>
        </div>

        <div class="reminders-section">
          <div class="reminders-header">
            <h4>Operations Reminders</h4>
            <button class="add-reminder-btn" onclick="openReminderModal('${property.id}')">+ Reminder</button>
          </div>
          ${(() => {
            const propertyReminders = operationsReminders.filter((r) => r.property_id === property.id && r.status === "Open");
            if (propertyReminders.length === 0) {
              return `<p class="no-reminders">No open reminders.</p>`;
            }
            return propertyReminders.map((reminder) => {
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              const dueDate = parseDateString(reminder.due_date);
              const isOverdue = dueDate < today;
              const daysUntilDue = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
              const reminderClass = isOverdue ? "reminder-item overdue" : daysUntilDue <= 3 ? "reminder-item urgent" : "reminder-item";

              return `
                <div class="${reminderClass}">
                  <div class="reminder-title">${reminder.title}</div>
                  ${reminder.notes ? `<div class="reminder-notes">${reminder.notes}</div>` : ""}
                  <div class="reminder-due">Due: ${reminder.due_date}${isOverdue ? " (OVERDUE)" : daysUntilDue === 0 ? " (TODAY)" : ""}</div>
                  <div class="reminder-buttons">
                    <button onclick="openEditReminder('${reminder.id}')">Edit</button>
                    <button class="complete-reminder-btn" onclick="completeReminder('${reminder.id}')">✓ Complete</button>
                    <button class="delete-btn" onclick="deleteReminder('${reminder.id}')">Delete</button>
                  </div>
                </div>
              `;
            }).join("");
          })()}
        </div>

        <div class="task-list ${isCollapsed ? "collapsed" : ""}">
          <div class="property-detail-tabs">
            <button type="button" class="property-detail-tab ${activeTab === "tasks" ? "active" : ""}" onclick="setPropertyDetailTab('${property.id}','tasks')">Scheduled Cleanings</button>
            <button type="button" class="property-detail-tab ${activeTab === "history" ? "active" : ""}" onclick="setPropertyDetailTab('${property.id}','history')">Chemical History</button>
          </div>
          ${activeTab === "tasks" ? taskContent : renderPropertyChemicalHistory(property)}
        </div>
      </div>
    `;
  }).join("");
}

async function navigateToView(viewName) {
  if (!viewName) return;

  if (PROTECTED_VIEWS.has(viewName) && !isProtectedAccessUnlocked) {
    const unlocked = await promptForProtectedViewPin();
    if (!unlocked) return;
    isProtectedAccessUnlocked = true;
  }

  showView(viewName);
}

function openPinModal() {
  if (!pinModal) return;
  pinModal.classList.remove("hidden");
  if (pinInput) {
    pinInput.value = "";
    pinInput.focus();
  }
  if (pinError) {
    pinError.classList.add("hidden");
  }
}

function closePinModal() {
  if (!pinModal) return;
  pinModal.classList.add("hidden");
}

function promptForProtectedViewPin() {
  if (!pinModal || !pinInput || !pinUnlockBtn || !pinCancelBtn) {
    return Promise.resolve(true);
  }

  openPinModal();

  return new Promise((resolve) => {
    pinModalResolver = resolve;

    const cleanup = () => {
      pinUnlockBtn.removeEventListener("click", handleUnlock);
      pinCancelBtn.removeEventListener("click", handleCancel);
      pinInput.removeEventListener("keydown", handleKeydown);
      pinModal.removeEventListener("click", handleOverlayClick);
      pinModalResolver = null;
    };

    const finish = (allowed) => {
      cleanup();
      closePinModal();
      resolve(allowed);
    };

    const handleUnlock = () => {
      const enteredPin = String(pinInput.value || "").trim();
      if (enteredPin === getCurrentAdminPin()) {
        finish(true);
        return;
      }

      if (pinError) {
        pinError.classList.remove("hidden");
      }
      pinInput.select();
    };

    const handleCancel = () => {
      finish(false);
    };

    const handleKeydown = (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        handleUnlock();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        handleCancel();
      }
    };

    const handleOverlayClick = (event) => {
      if (event.target === pinModal) {
        handleCancel();
      }
    };

    pinUnlockBtn.addEventListener("click", handleUnlock);
    pinCancelBtn.addEventListener("click", handleCancel);
    pinInput.addEventListener("keydown", handleKeydown);
    pinModal.addEventListener("click", handleOverlayClick);
  });
}

function showChemicalReportWorkspace(showWorkspace) {
  const workspace = document.getElementById("chemicalReportWorkspace");
  const dashboard = document.getElementById("reportsDashboardCards");
  if (!workspace || !dashboard) return;

  workspace.classList.toggle("hidden", !showWorkspace);
  dashboard.classList.toggle("hidden", Boolean(showWorkspace));

  if (showWorkspace) {
    renderChemicalUsageReport();
  }
}

async function openReportFromDashboard(reportKey) {
  if (reportKey === "billing") {
    await navigateToView("billing");
    return;
  }

  if (reportKey === "routeFragmentation") {
    await navigateToView("routeFragmentation");
    return;
  }

  if (reportKey === "chemical") {
    showChemicalReportWorkspace(true);
  }
}