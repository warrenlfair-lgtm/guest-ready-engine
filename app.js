let properties = [];
let cleaningTasks = [];
let reservations = [];
let operationsReminders = [];
let chemicalUsageEntries = [];
let chemicals = [];
let invoices = [];
let currentInvoiceDraft = null;
let currentInvoiceBatchDrafts = [];

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
let editingChemicalSettingId = null;
let cleaningModalInitialState = null;
let isChemicalNameChangeListenerAttached = false;

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
let latestInvoiceCandidates = {
  tasks: [],
  chemicalRows: [],
};
let weekViewMode = localStorage.getItem("guestReadyDefaultWeekView") || "calendar";
const PROTECTED_VIEWS = new Set(["reports"]);
let isProtectedAccessUnlocked = false;
let pinModalResolver = null;
const MANUAL_BILLING_OVERRIDE_TAG = "[Manual Override]";
const INVOICE_STATUSES = ["draft", "finalized", "sent", "paid", "void"];
const DEFAULT_INVOICE_TERMS = "Net 15";
const INVOICE_ITEM_SOURCES = {
  MANUAL: "manual",
  TASK: "task",
  CHEMICAL: "chemical",
};
const INVOICE_QUICK_ADD_TEMPLATES = {
  filter_cleaning: { description: "Filter Cleaning", unit: "service", rate: 95, itemType: "manual" },
  cartridge_cleaning: { description: "Cartridge Cleaning", unit: "service", rate: 125, itemType: "manual" },
  green_to_clean: { description: "Green-to-Clean Treatment", unit: "treatment", rate: 325, itemType: "manual" },
  pump_repair: { description: "Pump Repair", unit: "repair", rate: 225, itemType: "manual" },
  equipment_repair: { description: "Equipment Repair", unit: "repair", rate: 245, itemType: "manual" },
  emergency_service: { description: "Emergency Service", unit: "service", rate: 175, itemType: "surcharge" },
  salt_addition: { description: "Salt Addition", unit: "bags", rate: 40, itemType: "manual" },
  travel_charge: { description: "Travel Charge", unit: "trip", rate: 45, itemType: "surcharge" },
  discount: { description: "Discount", unit: "discount", rate: -25, itemType: "discount" },
  credit: { description: "Credit", unit: "credit", rate: -25, itemType: "credit" },
};
const CHEMICAL_UNIT_OPTIONS = ["gallons", "pounds", "ounces", "tablets", "bags", "quarts"];
const DEFAULT_CHEMICAL_CATALOG = [
  { name: "Liquid Chlorine", default_unit: "gallons", cost_per_unit: 0, billable_rate_per_unit: 0, is_billable: true },
  { name: "Chlorine Tablets", default_unit: "tablets", cost_per_unit: 0, billable_rate_per_unit: 0, is_billable: true },
  { name: "pH Up", default_unit: "pounds", cost_per_unit: 0, billable_rate_per_unit: 0, is_billable: true },
  { name: "pH Down", default_unit: "pounds", cost_per_unit: 0, billable_rate_per_unit: 0, is_billable: true },
  { name: "Alkalinity Up", default_unit: "pounds", cost_per_unit: 0, billable_rate_per_unit: 0, is_billable: true },
  { name: "Alkalinity Down", default_unit: "pounds", cost_per_unit: 0, billable_rate_per_unit: 0, is_billable: true },
  { name: "Stabilizer / CYA", default_unit: "pounds", cost_per_unit: 0, billable_rate_per_unit: 0, is_billable: true },
  { name: "Calcium Hardness Increaser", default_unit: "pounds", cost_per_unit: 0, billable_rate_per_unit: 0, is_billable: true },
  { name: "Algaecide", default_unit: "quarts", cost_per_unit: 0, billable_rate_per_unit: 0, is_billable: true },
  { name: "Clarifier", default_unit: "quarts", cost_per_unit: 0, billable_rate_per_unit: 0, is_billable: true },
  { name: "Phosphate Remover", default_unit: "quarts", cost_per_unit: 0, billable_rate_per_unit: 0, is_billable: true },
  { name: "Salt", default_unit: "bags", cost_per_unit: 0, billable_rate_per_unit: 0, is_billable: true },
  { name: "Other", default_unit: "", cost_per_unit: 0, billable_rate_per_unit: 0, is_billable: true },
];

const addPropertyBtn = document.getElementById("addPropertyBtn");
const propertyModal = document.getElementById("propertyModal");
const cancelBtn = document.getElementById("cancelBtn");
const savePropertyBtn = document.getElementById("savePropertyBtn");
const propertyList = document.getElementById("propertyList");
const statusMessage = document.getElementById("statusMessage");

const cleaningModal = document.getElementById("cleaningModal");
const cancelCleaningBtn = document.getElementById("cancelCleaningBtn");
const saveCleaningBtn = document.getElementById("saveCleaningBtn");
const closeCleaningXBtn = document.getElementById("closeCleaningXBtn");
const cleaningModalTitle = document.getElementById("cleaningModalTitle");

const propertyName = document.getElementById("propertyName");
const propertyClientName = document.getElementById("propertyClientName");
const propertyBillingCompanyName = document.getElementById("propertyBillingCompanyName");
const propertyBillingEmail = document.getElementById("propertyBillingEmail");
const propertyBillingAddress = document.getElementById("propertyBillingAddress");
const propertyAccountReference = document.getElementById("propertyAccountReference");
const propertyAddress = document.getElementById("propertyAddress");
const propertyIcal = document.getElementById("propertyIcal");
const safetycultureChecklistUrl = document.getElementById("safetycultureChecklistUrl");
const standardDay = document.getElementById("standardDay");
const coverageDays = document.getElementById("coverageDays");
const coverageRule = document.getElementById("coverageRule");
const offCycleCharge = document.getElementById("offCycleCharge");
const propertyDefaultCleaningRate = document.getElementById("propertyDefaultCleaningRate");
const propertyTaxable = document.getElementById("propertyTaxable");
const propertyTaxRate = document.getElementById("propertyTaxRate");
const propertyPaymentTerms = document.getElementById("propertyPaymentTerms");
const propertyInvoiceNotes = document.getElementById("propertyInvoiceNotes");

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
const openSafetyCultureChecklistBtn = document.getElementById("openSafetyCultureChecklistBtn");
const cleaningChecklistHint = document.getElementById("cleaningChecklistHint");
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
const billingClientSelect = document.getElementById("billingClientSelect");
const billingPropertySelect = document.getElementById("billingPropertySelect");
const billingReconciledOnly = document.getElementById("billingReconciledOnly");
const billingRunBtn = document.getElementById("billingRunBtn");
const billingPrintBtn = document.getElementById("billingPrintBtn");
const billingReportContainer = document.getElementById("billingReportContainer");
const invoiceIncludeNonBillableChemicals = document.getElementById("invoiceIncludeNonBillableChemicals");
const invoiceTaxEnabled = document.getElementById("invoiceTaxEnabled");
const generateInvoiceBtn = document.getElementById("generateInvoiceBtn");
const invoiceEligibilitySummary = document.getElementById("invoiceEligibilitySummary");
const invoicePreviewContainer = document.getElementById("invoicePreviewContainer");
const invoiceBatchPreviewContainer = document.getElementById("invoiceBatchPreviewContainer");
const invoiceHistoryContainer = document.getElementById("invoiceHistoryContainer");
const invoiceStatusFilter = document.getElementById("invoiceStatusFilter");
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
const chemicalSettingNameInput = document.getElementById("chemicalSettingNameInput");
const chemicalSettingDefaultUnitSelect = document.getElementById("chemicalSettingDefaultUnitSelect");
const chemicalSettingActiveCheckbox = document.getElementById("chemicalSettingActiveCheckbox");
const chemicalSettingCostInput = document.getElementById("chemicalSettingCostInput");
const chemicalSettingBillableRateInput = document.getElementById("chemicalSettingBillableRateInput");
const chemicalSettingBillableCheckbox = document.getElementById("chemicalSettingBillableCheckbox");
const saveChemicalSettingBtn = document.getElementById("saveChemicalSettingBtn");
const cancelChemicalSettingEditBtn = document.getElementById("cancelChemicalSettingEditBtn");
const chemicalSettingsList = document.getElementById("chemicalSettingsList");
const chemicalSettingsStatus = document.getElementById("chemicalSettingsStatus");

const COMPANY_LOGO_BUCKET = "company-logos";

addPropertyBtn.onclick = openAddModal;
cancelBtn.onclick = closePropertyModal;
savePropertyBtn.onclick = saveProperty;

cancelCleaningBtn.onclick = closeCleaningModal;
saveCleaningBtn.onclick = saveCleaningTask;

if (closeCleaningXBtn) {
  closeCleaningXBtn.addEventListener("click", closeCleaningModal);
}

if (cleaningModal) {
  cleaningModal.addEventListener("click", (event) => {
    if (event.target === cleaningModal) {
      closeCleaningModal();
    }
  });
}

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (cleaningModal?.classList.contains("hidden")) return;
  event.preventDefault();
  closeCleaningModal();
});

if (addChemicalBtn) {
  addChemicalBtn.addEventListener("click", () => openChemicalUsageModal());
}

if (cancelChemicalBtn) {
  cancelChemicalBtn.addEventListener("click", closeChemicalUsageModal);
}

if (saveChemicalBtn) {
  saveChemicalBtn.addEventListener("click", saveChemicalUsageEntry);
}

if (openSafetyCultureChecklistBtn) {
  openSafetyCultureChecklistBtn.addEventListener("click", openSafetyCultureChecklistForCurrentCleaning);
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
  billingRunBtn.addEventListener("click", () => {
    renderBillingReport();
    refreshBillingCard();
  });
}

if (billingPrintBtn) {
  billingPrintBtn.addEventListener("click", printBillingReport);
}

if (billingStartDate) {
  billingStartDate.addEventListener("change", renderBillingReport);
  billingStartDate.addEventListener("change", refreshBillingCard);
  billingStartDate.addEventListener("change", () => {
    currentInvoiceDraft = null;
    currentInvoiceBatchDrafts = [];
    clearInvoiceEligibilitySummary();
    renderInvoicePreview();
    renderInvoiceBatchPreview();
  });
}

if (billingEndDate) {
  billingEndDate.addEventListener("change", renderBillingReport);
  billingEndDate.addEventListener("change", refreshBillingCard);
  billingEndDate.addEventListener("change", () => {
    currentInvoiceDraft = null;
    currentInvoiceBatchDrafts = [];
    clearInvoiceEligibilitySummary();
    renderInvoicePreview();
    renderInvoiceBatchPreview();
  });
}

if (billingClientSelect) {
  billingClientSelect.addEventListener("change", () => {
    if (billingClientSelect.value && billingPropertySelect) {
      billingPropertySelect.value = "";
    }
    renderBillingReport();
    refreshBillingCard();
    currentInvoiceDraft = null;
    currentInvoiceBatchDrafts = [];
    clearInvoiceEligibilitySummary();
    renderInvoicePreview();
    renderInvoiceBatchPreview();
    renderInvoiceHistory();
  });
}

if (billingPropertySelect) {
  billingPropertySelect.addEventListener("change", renderBillingReport);
  billingPropertySelect.addEventListener("change", refreshBillingCard);
}

if (billingPropertySelect) {
  billingPropertySelect.addEventListener("change", () => {
    if (billingPropertySelect.value && billingClientSelect) {
      billingClientSelect.value = "";
    }
    currentInvoiceDraft = null;
    currentInvoiceBatchDrafts = [];
    clearInvoiceEligibilitySummary();
    renderInvoicePreview();
    renderInvoiceBatchPreview();
    renderInvoiceHistory();
  });
}

if (billingReconciledOnly) {
  billingReconciledOnly.addEventListener("change", renderBillingReport);
  billingReconciledOnly.addEventListener("change", refreshBillingCard);
}

if (generateInvoiceBtn) {
  generateInvoiceBtn.addEventListener("click", generateInvoicePreviewFromFilters);
}

if (invoiceStatusFilter) {
  invoiceStatusFilter.addEventListener("change", renderInvoiceHistory);
}

if (invoiceIncludeNonBillableChemicals) {
  invoiceIncludeNonBillableChemicals.addEventListener("change", () => {
    if (!currentInvoiceDraft && !currentInvoiceBatchDrafts.length) return;
    generateInvoicePreviewFromFilters();
  });
}

if (invoiceTaxEnabled) {
  invoiceTaxEnabled.addEventListener("change", () => {
    if (!currentInvoiceDraft && !currentInvoiceBatchDrafts.length) return;
    generateInvoicePreviewFromFilters();
  });
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

if (saveChemicalSettingBtn) {
  saveChemicalSettingBtn.addEventListener("click", saveChemicalSetting);
}

if (cancelChemicalSettingEditBtn) {
  cancelChemicalSettingEditBtn.addEventListener("click", resetChemicalSettingsForm);
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
initializeChemicalSettingsForm();
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
    renderInvoicePreview();
    renderInvoiceBatchPreview();
    renderInvoiceHistory();
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

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toMoney(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function getChemicalsFallbackList() {
  return DEFAULT_CHEMICAL_CATALOG.map((item, index) => ({
    id: `default-${index + 1}`,
    company_id: null,
    name: item.name,
    default_unit: item.default_unit || null,
    active: true,
    cost_per_unit: Number(item.cost_per_unit || 0),
    billable_rate_per_unit: Number(item.billable_rate_per_unit || 0),
    is_billable: item.is_billable !== false,
  }));
}

function getActiveChemicals() {
  return chemicals.filter((chemical) => chemical.active !== false);
}

function getChemicalByName(name) {
  const normalized = String(name || "").trim().toLowerCase();
  if (!normalized) return null;
  return chemicals.find((chemical) => String(chemical.name || "").trim().toLowerCase() === normalized) || null;
}

function getChemicalById(chemicalId) {
  const normalized = String(chemicalId || "").trim();
  if (!normalized) return null;
  return chemicals.find((chemical) => String(chemical.id || "") === normalized) || null;
}

function getChemicalCatalogItemForEntry(entry) {
  const byId = getChemicalById(entry?.chemical_id);
  if (byId) return byId;
  return getChemicalByName(entry?.chemical_name);
}

function getChemicalNamesFromUsageEntries() {
  return Array.from(new Set(
    chemicalUsageEntries
      .map((entry) => String(entry.chemical_name || "").trim())
      .filter(Boolean)
  )).sort((a, b) => a.localeCompare(b));
}

function getChemicalChargeContext(entry) {
  const quantity = Number(entry?.quantity || 0);
  const catalogItem = getChemicalCatalogItemForEntry(entry);
  const isBillable = catalogItem ? catalogItem.is_billable !== false : false;
  const rate = isBillable ? Number(catalogItem?.billable_rate_per_unit || 0) : 0;
  const charge = quantity > 0 && rate > 0 ? quantity * rate : 0;
  return {
    isBillable,
    rate: Number.isFinite(rate) ? rate : 0,
    charge: Number.isFinite(charge) ? charge : 0,
  };
}

function normalizeSafetyCultureUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function getPropertySafetyCultureUrl(propertyId) {
  const property = properties.find((item) => item.id === propertyId);
  return normalizeSafetyCultureUrl(property?.safetyculture_checklist_url || "");
}

function getTaskSafetyCultureUrl(task) {
  if (!task) return "";
  return getPropertySafetyCultureUrl(task.property_id);
}

function openSafetyCultureChecklist(url) {
  const normalizedUrl = normalizeSafetyCultureUrl(url);
  if (!normalizedUrl) {
    alert("No checklist link assigned.");
    return;
  }

  const win = window.open(normalizedUrl, "_blank", "noopener,noreferrer");
  if (!win) {
    alert("Could not open checklist link. Please allow popups for this site.");
  }
}

function openSafetyCultureChecklistForTask(taskId) {
  const task = cleaningTasks.find((item) => item.id === taskId);
  if (!task) return;
  openSafetyCultureChecklist(getTaskSafetyCultureUrl(task));
}

function openSafetyCultureChecklistForCurrentCleaning() {
  const url = getPropertySafetyCultureUrl(selectedCleaningPropertyId);
  openSafetyCultureChecklist(url);
}

function getSafetyCultureTaskActionMarkup(task) {
  const checklistUrl = getTaskSafetyCultureUrl(task);
  if (checklistUrl) {
    return `<button type="button" class="checklist-link-btn" onclick="openSafetyCultureChecklistForTask('${task.id}')">Open SafetyCulture Checklist</button>`;
  }
  return `<div class="task-checklist-hint">No checklist link assigned.</div>`;
}

function renderCleaningSafetyCultureAccess() {
  if (!openSafetyCultureChecklistBtn || !cleaningChecklistHint) return;
  const url = getPropertySafetyCultureUrl(selectedCleaningPropertyId);
  if (url) {
    openSafetyCultureChecklistBtn.classList.remove("hidden");
    cleaningChecklistHint.classList.add("hidden");
  } else {
    openSafetyCultureChecklistBtn.classList.add("hidden");
    cleaningChecklistHint.classList.remove("hidden");
  }
}

function buildChemicalUsageNameOptions(selectedName = "") {
  const names = getActiveChemicals().map((chemical) => chemical.name);
  const chosen = String(selectedName || "").trim();
  if (chosen && !names.includes(chosen)) {
    names.push(chosen);
  }
  return names.sort((a, b) => a.localeCompare(b));
}

function buildChemicalUnitOptionsMarkup(selectedUnit = "") {
  const selected = String(selectedUnit || "").trim();
  const units = ["", ...CHEMICAL_UNIT_OPTIONS];
  if (selected && !units.includes(selected)) {
    units.push(selected);
  }

  return units.map((unit) => {
    const label = unit || "No default";
    const selectedAttr = unit === selected ? " selected" : "";
    return `<option value="${unit}"${selectedAttr}>${label}</option>`;
  }).join("");
}

function renderChemicalNameOptions(selectedName = "") {
  if (!chemicalNameSelect) return;
  const options = buildChemicalUsageNameOptions(selectedName);

  if (!options.length) {
    chemicalNameSelect.innerHTML = "<option value=\"\">No active chemicals configured</option>";
    chemicalNameSelect.value = "";
    return;
  }

  chemicalNameSelect.innerHTML = options
    .map((name) => `<option value="${name}">${name}</option>`)
    .join("");

  if (selectedName && options.includes(selectedName)) {
    chemicalNameSelect.value = selectedName;
  } else {
    chemicalNameSelect.value = options[0];
  }
}

function renderChemicalUnitOptions(selectedUnit = "") {
  if (!chemicalUnitSelect) return;
  chemicalUnitSelect.innerHTML = buildChemicalUnitOptionsMarkup(selectedUnit);
  chemicalUnitSelect.value = String(selectedUnit || "").trim();
}

function applyChemicalDefaultUnitForSelection(options = {}) {
  if (!chemicalNameSelect || !chemicalUnitSelect) return;
  const force = options.force === true;
  const selectedChemical = getChemicalByName(chemicalNameSelect.value);
  const defaultUnit = String(selectedChemical?.default_unit || "").trim();

  if (!defaultUnit) return;
  if (!force && String(chemicalUnitSelect.value || "").trim()) return;
  chemicalUnitSelect.value = defaultUnit;
}

function initializeChemicalUsageOptions() {
  renderChemicalNameOptions();
  renderChemicalUnitOptions();

  if (chemicalNameSelect && !isChemicalNameChangeListenerAttached) {
    chemicalNameSelect.addEventListener("change", () => {
      applyChemicalDefaultUnitForSelection({ force: true });
    });
    isChemicalNameChangeListenerAttached = true;
  }
}

function initializeChemicalSettingsForm() {
  if (!chemicalSettingDefaultUnitSelect) return;
  chemicalSettingDefaultUnitSelect.innerHTML = buildChemicalUnitOptionsMarkup("");
  resetChemicalSettingsForm();
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
  renderChemicalNameOptions();
  renderChemicalUnitOptions();
  if (chemicalQuantityInput) {
    chemicalQuantityInput.value = "";
  }
  if (chemicalNotesInput) {
    chemicalNotesInput.value = "";
  }
  applyChemicalDefaultUnitForSelection({ force: true });
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
    renderChemicalNameOptions(existingEntry.chemical_name || "");
    if (chemicalQuantityInput) {
      chemicalQuantityInput.value = existingEntry.quantity ?? "";
    }
    renderChemicalUnitOptions(existingEntry.unit || "");
    if (chemicalNotesInput) {
      chemicalNotesInput.value = existingEntry.notes || "";
    }
  } else {
    renderChemicalNameOptions();
    renderChemicalUnitOptions();
    applyChemicalDefaultUnitForSelection({ force: true });
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

  if (invoiceIncludeNonBillableChemicals) {
    invoiceIncludeNonBillableChemicals.checked = false;
  }

  if (invoiceTaxEnabled) {
    invoiceTaxEnabled.value = "property";
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
  body.classList.remove("print-view-billing", "print-view-chemical", "print-view-invoice");
  body.classList.add(viewClassName);
  window.print();
  setTimeout(() => {
    body.classList.remove("print-view-billing", "print-view-chemical", "print-view-invoice");
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
  if (propertyBillingCompanyName) propertyBillingCompanyName.value = property.billing_company_name || "";
  if (propertyBillingEmail) propertyBillingEmail.value = property.billing_email || "";
  if (propertyBillingAddress) propertyBillingAddress.value = property.billing_address || "";
  if (propertyAccountReference) propertyAccountReference.value = property.billing_account_reference || "";
  propertyAddress.value = property.address || "";
  propertyIcal.value = property.ical_url || "";
  if (safetycultureChecklistUrl) {
    safetycultureChecklistUrl.value = property.safetyculture_checklist_url || "";
  }
  standardDay.value = property.standard_service_day || "Wednesday";
  coverageDays.value = property.coverage_days ?? 1;
  if (coverageRule) {
    coverageRule.value = getCoverageRuleForProperty(property);
  }
  offCycleCharge.value = property.default_off_cycle_charge || 65;
  if (propertyDefaultCleaningRate) propertyDefaultCleaningRate.value = Number(property.default_cleaning_rate || 0);
  if (propertyTaxable) propertyTaxable.value = property.billing_taxable === false ? "no" : "yes";
  if (propertyTaxRate) propertyTaxRate.value = Number(property.billing_tax_rate || 0);
  if (propertyPaymentTerms) propertyPaymentTerms.value = property.payment_terms || DEFAULT_INVOICE_TERMS;
  if (propertyInvoiceNotes) propertyInvoiceNotes.value = property.invoice_notes || "";

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
  if (cleaningModalTitle) {
    cleaningModalTitle.textContent = "Add Task";
  }

  cleaningDate.value = new Date().toISOString().split("T")[0];
  cleaningServiceType.value = "Manual";
  cleaningStatus.value = "Scheduled";
  cleaningTechnician.value = "";
  cleaningCharge.value = 0;
  cleaningNotes.value = "";
  renderCleaningSafetyCultureAccess();
  clearChemicalUsageForm();
  renderChemicalUsageForCurrentTask();

  cleaningModal.classList.remove("hidden");
  cleaningModalInitialState = getCleaningModalStateSnapshot();
}

function openEditCleaning(taskId) {
  const task = cleaningTasks.find((t) => t.id === taskId);
  if (!task) return;

  editingCleaningId = task.id;
  selectedCleaningPropertyId = task.property_id;
  if (cleaningModalTitle) {
    cleaningModalTitle.textContent = "Edit Task";
  }

  cleaningDate.value = task.scheduled_date || task.service_date || "";
  cleaningServiceType.value = task.service_type || "Manual";
  cleaningStatus.value = task.status || "Scheduled";
  cleaningTechnician.value = task.technician || "";
  cleaningCharge.value = task.charge || 0;
  cleaningNotes.value = stripManualBillingOverrideTag(task.notes || "");
  renderCleaningSafetyCultureAccess();
  clearChemicalUsageForm();
  renderChemicalUsageForCurrentTask();

  cleaningModal.classList.remove("hidden");
  cleaningModalInitialState = getCleaningModalStateSnapshot();
}

function getCleaningModalStateSnapshot() {
  return {
    propertyId: selectedCleaningPropertyId || "",
    editingTaskId: editingCleaningId || "",
    serviceDate: String(cleaningDate?.value || ""),
    serviceType: String(cleaningServiceType?.value || ""),
    status: String(cleaningStatus?.value || ""),
    technician: String(cleaningTechnician?.value || "").trim(),
    charge: String(cleaningCharge?.value || ""),
    notes: String(cleaningNotes?.value || "").trim(),
  };
}

function hasUnsavedCleaningModalChanges() {
  if (!cleaningModalInitialState) return false;
  const currentState = getCleaningModalStateSnapshot();
  return JSON.stringify(currentState) !== JSON.stringify(cleaningModalInitialState);
}

function closeCleaningModal(options = {}) {
  const forceClose = options?.force === true;

  if (!forceClose && hasUnsavedCleaningModalChanges()) {
    const confirmed = confirm("You have unsaved task changes. Close without saving?");
    if (!confirmed) return;
  }

  cleaningModal.classList.add("hidden");
  closeChemicalUsageModal();
  editingCleaningId = null;
  selectedCleaningPropertyId = null;
  cleaningModalInitialState = null;
  renderCleaningSafetyCultureAccess();
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
  await loadChemicals();
  await loadChemicalUsageEntries();
  await loadInvoices();
  renderChemicalSettingsSection();
  initializeChemicalUsageOptions();
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
  renderInvoicePreview();
  renderInvoiceBatchPreview();
  renderInvoiceHistory();
  renderRouteFragmentationAnalytics();
  if (!document.getElementById("chemicalReportWorkspace")?.classList.contains("hidden")) {
    renderChemicalUsageReport();
  }
  renderMessagesPreview();
}

async function ensureDefaultChemicalsSeeded() {
  const payload = DEFAULT_CHEMICAL_CATALOG.map((item) => ({
    company_id: null,
    name: item.name,
    default_unit: item.default_unit || null,
    active: true,
    cost_per_unit: Number(item.cost_per_unit || 0),
    billable_rate_per_unit: Number(item.billable_rate_per_unit || 0),
    is_billable: item.is_billable !== false,
  }));

  const { error } = await supabaseClient
    .from("chemicals")
    .insert(payload);

  if (error) {
    const message = String(error.message || "").toLowerCase();
    const duplicate = message.includes("duplicate") || message.includes("unique");
    if (!duplicate) {
      console.warn("Could not seed default chemicals:", error.message);
    }
  }
}

async function loadChemicals() {
  const { data, error } = await supabaseClient
    .from("chemicals")
    .select("*")
    .order("name", { ascending: true });

  if (error) {
    console.warn("Could not load chemicals from Supabase. Using fallback list:", error.message);
    chemicals = getChemicalsFallbackList();
    return;
  }

  const rows = data || [];
  if (!rows.length) {
    await ensureDefaultChemicalsSeeded();
    const retry = await supabaseClient
      .from("chemicals")
      .select("*")
      .order("name", { ascending: true });

    if (retry.error) {
      console.warn("Could not reload seeded chemicals. Using fallback list:", retry.error.message);
      chemicals = getChemicalsFallbackList();
      return;
    }

    chemicals = retry.data || [];
    return;
  }

  chemicals = rows;
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
  const selectedChemical = getChemicalByName(chemicalName);

  const payload = {
    task_id: task.id,
    property_id: task.property_id,
    property_name: propertyName,
    service_date: serviceDate,
    chemical_id: selectedChemical?.id || null,
    chemical_name: chemicalName,
    quantity,
    unit,
    notes: notes || null,
    created_by: String(task.technician || cleaningTechnician?.value || "Tech").trim() || "Tech",
  };

  const savePayloadWithoutChemicalId = (() => {
    const { chemical_id, ...legacyPayload } = payload;
    return legacyPayload;
  })();

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

  const chemicalIdMissing = String(response?.error?.message || "").toLowerCase().includes("chemical_id");
  if (response.error && chemicalIdMissing) {
    if (editingChemicalUsageId) {
      response = await supabaseClient
        .from("chemical_usage")
        .update(savePayloadWithoutChemicalId)
        .eq("id", editingChemicalUsageId);
    } else {
      response = await supabaseClient
        .from("chemical_usage")
        .insert([savePayloadWithoutChemicalId]);
    }
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

function setChemicalSettingsStatus(message, isError = false) {
  if (!chemicalSettingsStatus) return;
  chemicalSettingsStatus.textContent = message || "";
  chemicalSettingsStatus.style.color = isError ? "#dc2626" : "#059669";
  if (!message) return;
  setTimeout(() => {
    if (chemicalSettingsStatus.textContent === message) {
      chemicalSettingsStatus.textContent = "";
    }
  }, 2800);
}

function resetChemicalSettingsForm() {
  editingChemicalSettingId = null;
  if (chemicalSettingNameInput) chemicalSettingNameInput.value = "";
  if (chemicalSettingDefaultUnitSelect) chemicalSettingDefaultUnitSelect.value = "";
  if (chemicalSettingActiveCheckbox) chemicalSettingActiveCheckbox.checked = true;
  if (chemicalSettingCostInput) chemicalSettingCostInput.value = "0";
  if (chemicalSettingBillableRateInput) chemicalSettingBillableRateInput.value = "0";
  if (chemicalSettingBillableCheckbox) chemicalSettingBillableCheckbox.checked = true;
  if (saveChemicalSettingBtn) saveChemicalSettingBtn.textContent = "Add Chemical";
  if (cancelChemicalSettingEditBtn) cancelChemicalSettingEditBtn.classList.add("hidden");
}

function getChemicalUsageCountForRecord(chemical) {
  const targetId = String(chemical?.id || "").trim();
  const targetName = String(chemical?.name || "").trim().toLowerCase();
  return chemicalUsageEntries.filter((entry) => {
    const matchesId = targetId && String(entry.chemical_id || "").trim() === targetId;
    const matchesName = targetName && String(entry.chemical_name || "").trim().toLowerCase() === targetName;
    return matchesId || matchesName;
  }).length;
}

function renderChemicalSettingsSection() {
  if (!chemicalSettingsList) return;

  const rows = chemicals
    .slice()
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));

  if (!rows.length) {
    chemicalSettingsList.innerHTML = "<tr><td colspan=\"8\">No chemicals configured yet.</td></tr>";
    return;
  }

  chemicalSettingsList.innerHTML = rows.map((chemical) => {
    const usageCount = getChemicalUsageCountForRecord(chemical);
    const canDelete = usageCount === 0;
    const escapedName = escapeHtml(chemical.name || "");
    const escapedUnit = escapeHtml(chemical.default_unit || "");
    const costPerUnit = Number(chemical.cost_per_unit || 0);
    const billableRate = Number(chemical.billable_rate_per_unit || 0);
    const isBillable = chemical.is_billable !== false;

    return `
      <tr>
        <td>${escapedName}</td>
        <td>${escapedUnit || "-"}</td>
        <td>${chemical.active === false ? "Inactive" : "Active"}</td>
        <td>${toMoney(costPerUnit)}</td>
        <td>${toMoney(isBillable ? billableRate : 0)}</td>
        <td>${isBillable ? "Yes" : "No"}</td>
        <td>${usageCount}</td>
        <td>
          <div class="chemical-settings-row-actions">
            <button type="button" onclick="openEditChemicalSetting('${chemical.id}')">Edit</button>
            <button type="button" onclick="toggleChemicalActive('${chemical.id}')">${chemical.active === false ? "Activate" : "Deactivate"}</button>
            <button type="button" class="delete-btn" onclick="deleteChemicalSetting('${chemical.id}')" ${canDelete ? "" : "disabled"}>Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function openEditChemicalSetting(chemicalId) {
  const chemical = chemicals.find((item) => item.id === chemicalId);
  if (!chemical) return;

  editingChemicalSettingId = chemicalId;
  if (chemicalSettingNameInput) chemicalSettingNameInput.value = chemical.name || "";
  if (chemicalSettingDefaultUnitSelect) {
    const normalizedUnit = String(chemical.default_unit || "").trim();
    chemicalSettingDefaultUnitSelect.value = CHEMICAL_UNIT_OPTIONS.includes(normalizedUnit) ? normalizedUnit : "";
  }
  if (chemicalSettingActiveCheckbox) chemicalSettingActiveCheckbox.checked = chemical.active !== false;
  if (chemicalSettingCostInput) chemicalSettingCostInput.value = String(Number(chemical.cost_per_unit || 0));
  if (chemicalSettingBillableRateInput) chemicalSettingBillableRateInput.value = String(Number(chemical.billable_rate_per_unit || 0));
  if (chemicalSettingBillableCheckbox) chemicalSettingBillableCheckbox.checked = chemical.is_billable !== false;
  if (saveChemicalSettingBtn) saveChemicalSettingBtn.textContent = "Update Chemical";
  if (cancelChemicalSettingEditBtn) cancelChemicalSettingEditBtn.classList.remove("hidden");
}

async function saveChemicalSetting() {
  if (!chemicalSettingNameInput || !chemicalSettingDefaultUnitSelect || !chemicalSettingActiveCheckbox || !chemicalSettingCostInput || !chemicalSettingBillableRateInput || !chemicalSettingBillableCheckbox) {
    return;
  }

  const name = String(chemicalSettingNameInput.value || "").trim();
  const defaultUnit = String(chemicalSettingDefaultUnitSelect.value || "").trim() || null;
  const active = Boolean(chemicalSettingActiveCheckbox.checked);
  const costPerUnit = Math.max(0, Number(chemicalSettingCostInput.value || 0));
  const billableRatePerUnit = Math.max(0, Number(chemicalSettingBillableRateInput.value || 0));
  const isBillable = Boolean(chemicalSettingBillableCheckbox.checked);

  if (!name) {
    alert("Chemical name is required.");
    return;
  }

  if (!Number.isFinite(costPerUnit) || !Number.isFinite(billableRatePerUnit)) {
    alert("Enter valid numeric amounts for cost and billable rate.");
    return;
  }

  const duplicate = chemicals.find((chemical) => {
    const sameName = String(chemical.name || "").trim().toLowerCase() === name.toLowerCase();
    if (!sameName) return false;
    if (!editingChemicalSettingId) return true;
    return chemical.id !== editingChemicalSettingId;
  });
  if (duplicate) {
    alert("A chemical with this name already exists.");
    return;
  }

  const payload = {
    company_id: null,
    name,
    default_unit: defaultUnit,
    active,
    cost_per_unit: costPerUnit,
    billable_rate_per_unit: billableRatePerUnit,
    is_billable: isBillable,
  };

  let response;
  if (editingChemicalSettingId) {
    response = await supabaseClient
      .from("chemicals")
      .update(payload)
      .eq("id", editingChemicalSettingId);
  } else {
    response = await supabaseClient
      .from("chemicals")
      .insert([payload]);
  }

  if (response.error) {
    const missingPricingColumns = /(cost_per_unit|billable_rate_per_unit|is_billable)/i.test(String(response.error.message || ""));
    if (missingPricingColumns) {
      const legacyPayload = {
        company_id: null,
        name,
        default_unit: defaultUnit,
        active,
      };

      if (editingChemicalSettingId) {
        response = await supabaseClient
          .from("chemicals")
          .update(legacyPayload)
          .eq("id", editingChemicalSettingId);
      } else {
        response = await supabaseClient
          .from("chemicals")
          .insert([legacyPayload]);
      }
    }
  }

  if (response.error) {
    alert("Error saving chemical: " + response.error.message);
    return;
  }

  await loadChemicals();
  resetChemicalSettingsForm();
  renderChemicalSettingsSection();
  initializeChemicalUsageOptions();
  renderChemicalUsageReport();
  renderProperties();
  setChemicalSettingsStatus("Chemical settings saved.");
}

async function toggleChemicalActive(chemicalId) {
  const chemical = chemicals.find((item) => item.id === chemicalId);
  if (!chemical) return;

  const nextActive = chemical.active === false;
  const { error } = await supabaseClient
    .from("chemicals")
    .update({ active: nextActive })
    .eq("id", chemicalId);

  if (error) {
    alert("Error updating chemical status: " + error.message);
    return;
  }

  await loadChemicals();
  renderChemicalSettingsSection();
  initializeChemicalUsageOptions();
  setChemicalSettingsStatus(nextActive ? "Chemical activated." : "Chemical deactivated.");
}

async function deleteChemicalSetting(chemicalId) {
  const chemical = chemicals.find((item) => item.id === chemicalId);
  if (!chemical) return;

  let { count, error: countError } = await supabaseClient
    .from("chemical_usage")
    .select("id", { count: "exact", head: true })
    .or(`chemical_id.eq.${chemicalId},chemical_name.eq.${chemical.name}`);

  const chemicalIdMissing = String(countError?.message || "").toLowerCase().includes("chemical_id");
  if (countError && chemicalIdMissing) {
    const fallback = await supabaseClient
      .from("chemical_usage")
      .select("id", { count: "exact", head: true })
      .eq("chemical_name", chemical.name);
    count = fallback.count;
    countError = fallback.error;
  }

  if (countError) {
    alert("Could not verify chemical usage before delete: " + countError.message);
    return;
  }

  if (Number(count || 0) > 0) {
    alert("This chemical has usage history and cannot be deleted. Set it inactive instead.");
    return;
  }

  if (!confirm(`Delete chemical \"${chemical.name}\"?`)) return;

  const { error } = await supabaseClient
    .from("chemicals")
    .delete()
    .eq("id", chemicalId);

  if (error) {
    alert("Error deleting chemical: " + error.message);
    return;
  }

  await loadChemicals();
  renderChemicalSettingsSection();
  initializeChemicalUsageOptions();
  setChemicalSettingsStatus("Chemical deleted.");
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
  const taxable = String(propertyTaxable?.value || "yes") === "yes";
  const propertyData = {
    property_name: propertyName.value.trim(),
    client_name: String(propertyClientName?.value || "").trim() || null,
    billing_company_name: String(propertyBillingCompanyName?.value || "").trim() || null,
    billing_email: String(propertyBillingEmail?.value || "").trim() || null,
    billing_address: String(propertyBillingAddress?.value || "").trim() || null,
    billing_account_reference: String(propertyAccountReference?.value || "").trim() || null,
    address: propertyAddress.value.trim(),
    ical_url: propertyIcal.value.trim(),
    safetyculture_checklist_url: normalizeSafetyCultureUrl(safetycultureChecklistUrl?.value || "") || null,
    standard_service_day: standardDay.value,
    coverage_days: selectedCoverageRule === "none" ? 0 : 1,
    coverage_rule: selectedCoverageRule,
    default_off_cycle_charge: Number(offCycleCharge.value),
    default_cleaning_rate: Number(propertyDefaultCleaningRate?.value || 0),
    billing_taxable: taxable,
    billing_tax_rate: taxable ? Number(propertyTaxRate?.value || 0) : 0,
    payment_terms: String(propertyPaymentTerms?.value || "").trim() || DEFAULT_INVOICE_TERMS,
    invoice_notes: String(propertyInvoiceNotes?.value || "").trim() || null,
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

  const optionalPropertyColumns = [
    "safetyculture_checklist_url",
    "billing_company_name",
    "billing_email",
    "billing_address",
    "billing_account_reference",
    "default_cleaning_rate",
    "billing_taxable",
    "billing_tax_rate",
    "payment_terms",
    "invoice_notes",
  ];

  let legacyPropertyData = { ...propertyData };
  while (result.error) {
    const message = String(result.error.message || "").toLowerCase();
    const missingColumn = optionalPropertyColumns.find((column) => message.includes(column));
    if (!missingColumn || !(missingColumn in legacyPropertyData)) {
      break;
    }

    delete legacyPropertyData[missingColumn];

    if (editingPropertyId) {
      result = await supabaseClient
        .from("properties")
        .update(legacyPropertyData)
        .eq("id", editingPropertyId);
    } else {
      result = await supabaseClient
        .from("properties")
        .insert([legacyPropertyData]);
    }
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
  closeCleaningModal({ force: true });
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
  if (propertyBillingCompanyName) propertyBillingCompanyName.value = "";
  if (propertyBillingEmail) propertyBillingEmail.value = "";
  if (propertyBillingAddress) propertyBillingAddress.value = "";
  if (propertyAccountReference) propertyAccountReference.value = "";
  propertyAddress.value = "";
  propertyIcal.value = "";
  if (safetycultureChecklistUrl) {
    safetycultureChecklistUrl.value = "";
  }
  standardDay.value = "Wednesday";
  coverageDays.value = 1;
  if (coverageRule) {
    coverageRule.value = "both";
  }
  offCycleCharge.value = 65;
  if (propertyDefaultCleaningRate) propertyDefaultCleaningRate.value = 0;
  if (propertyTaxable) propertyTaxable.value = "yes";
  if (propertyTaxRate) propertyTaxRate.value = 0;
  if (propertyPaymentTerms) propertyPaymentTerms.value = DEFAULT_INVOICE_TERMS;
  if (propertyInvoiceNotes) propertyInvoiceNotes.value = "";
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
    .update({
      invoiced: newInvoiced,
    })
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
  const { startDate, endDate, selectedPropertyId, selectedClientName } = getCurrentMonthBillingSummaryFilterState();
  const eligibleTasks = getBillingSummaryEligibleTasks({
    startDate,
    endDate,
    selectedPropertyId,
    selectedClientName,
  });
  const billingReportRows = getBillingReportRows();

  logBillingSummaryEligibleTasks(eligibleTasks);
  logBillingSummaryDebugRows(billingReportRows, "included in billing summary billed/invoiced totals");

  const totalBillableAmount = Number(eligibleTasks.reduce((sum, task) => sum + Number(task.billableAmount || 0), 0).toFixed(2));
  const invoicedAmount = Number(billingReportRows.reduce((sum, row) => sum + Number(row.billableAmount || row.amount || 0), 0).toFixed(2));
  const totalBillableTaskCount = eligibleTasks.length;
  const invoicedTaskCount = billingReportRows.length;

  console.log({
    displayedBillingRows: billingReportRows,
    billedTaskCount: billingReportRows.length,
    billedAmount: billingReportRows.reduce((sum, row) => sum + Number(row.billableAmount || row.amount || 0), 0),
    availableTaskCount: totalBillableTaskCount,
    availableBillableAmount: totalBillableAmount,
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

function resolvePropertyIdsForScope({ selectedPropertyId = "", selectedClientName = "" } = {}) {
  if (selectedPropertyId) {
    return properties
      .filter((property) => normalizePropertyId(property.id) === normalizePropertyId(selectedPropertyId))
      .map((property) => property.id);
  }

  if (selectedClientName) {
    return properties
      .filter((property) => String(property.client_name || "").trim() === selectedClientName)
      .map((property) => property.id);
  }

  return properties.map((property) => property.id);
}

function getBillingReportRowsForFilters({
  startDate,
  endDate,
  selectedPropertyId = "",
  selectedClientName = "",
  includeInvoiced = true,
} = {}) {
  if (!startDate || !endDate) return [];

  const scopePropertyIds = new Set(resolvePropertyIdsForScope({ selectedPropertyId, selectedClientName }).map((id) => normalizePropertyId(id)));

  return cleaningTasks
    .filter((task) => isTaskReconciled(task) || String(task.status || "").toLowerCase() === "completed")
    .filter((task) => {
      const taskDate = task.service_date || task.scheduled_date;
      return Boolean(taskDate && taskDate >= startDate && taskDate <= endDate);
    })
    .filter((task) => scopePropertyIds.has(normalizePropertyId(task.property_id)))
    .filter((task) => includeInvoiced ? true : !isTaskAlreadyInvoiced(task))
    .map((task) => {
      const billingContext = getTaskBillingContext(task);
      const property = properties.find((item) => normalizePropertyId(item.id) === normalizePropertyId(task.property_id));
      const taskDate = task.service_date || task.scheduled_date || "";
      const quantity = 1;
      const amount = Number(billingContext.billableAmount || 0);
      const rate = quantity > 0 ? Number((amount / quantity).toFixed(2)) : amount;
      return {
        ...task,
        serviceDate: taskDate,
        propertyName: property?.property_name || getPropertyName(task.property_id),
        clientName: String(property?.client_name || "").trim(),
        serviceLabel: task.service_type || "Manual",
        billableAmount: amount,
        billingReasonLabel: billingContext.billingReasonLabel,
        quantity,
        unit: "service",
        rate,
      };
    })
    .filter((task) => Number(task.billableAmount || 0) > 0)
    .sort((a, b) => {
      const propertyCompare = String(a.propertyName || "").localeCompare(String(b.propertyName || ""));
      if (propertyCompare !== 0) return propertyCompare;
      return String(a.serviceDate || "").localeCompare(String(b.serviceDate || ""));
    });
}

function getChemicalReportRowsForFilters({
  startDate,
  endDate,
  selectedPropertyId = "",
  selectedClientName = "",
  selectedChemical = "",
  includeInvoiced = true,
} = {}) {
  if (!startDate || !endDate) return [];

  const scopePropertyIds = new Set(resolvePropertyIdsForScope({ selectedPropertyId, selectedClientName }).map((id) => normalizePropertyId(id)));

  return chemicalUsageEntries
    .filter((entry) => {
      const dateValue = String(entry.service_date || "");
      return Boolean(dateValue && dateValue >= startDate && dateValue <= endDate);
    })
    .filter((entry) => scopePropertyIds.has(normalizePropertyId(entry.property_id)))
    .filter((entry) => !selectedChemical || String(entry.chemical_name || "") === selectedChemical)
    .filter((entry) => includeInvoiced ? true : !isChemicalUsageAlreadyInvoiced(entry))
    .map((entry) => {
      const property = properties.find((item) => normalizePropertyId(item.id) === normalizePropertyId(entry.property_id));
      return {
        ...entry,
        property_name: entry.property_name || property?.property_name || getPropertyName(entry.property_id),
        client_name: String(property?.client_name || "").trim(),
      };
    })
    .sort((a, b) => {
      const propertyCompare = String(a.property_name || "").localeCompare(String(b.property_name || ""));
      if (propertyCompare !== 0) return propertyCompare;
      return String(a.service_date || "").localeCompare(String(b.service_date || ""));
    });
}

function getChemicalReportRows() {
  if (!chemicalReportStartDate || !chemicalReportEndDate) return [];

  const startDate = chemicalReportStartDate.value;
  const endDate = chemicalReportEndDate.value;
  if (!startDate || !endDate) return [];

  const selectedPropertyId = chemicalReportPropertySelect?.value || "";
  const selectedChemical = chemicalReportTypeSelect?.value || "";

  return getChemicalReportRowsForFilters({
    startDate,
    endDate,
    selectedPropertyId,
    selectedChemical,
    includeInvoiced: true,
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

  const chemicalFilterNames = getChemicalNamesFromUsageEntries();
  const chemicalTypeOptions = `<option value="">All Chemicals</option>${chemicalFilterNames
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

  const detailRows = rows.map((entry) => {
    const pricing = getChemicalChargeContext(entry);
    return `
    <tr>
      <td>${entry.property_name || "Unknown Property"}</td>
      <td>${entry.service_date || "-"}</td>
      <td>${entry.chemical_name || "-"}</td>
      <td>${Number(entry.quantity || 0).toFixed(2).replace(/\.00$/, "")}</td>
      <td>${entry.unit || "-"}</td>
      <td>${toMoney(pricing.rate)}</td>
      <td>${toMoney(pricing.charge)}</td>
      <td>${entry.notes || ""}</td>
    </tr>
  `;
  }).join("");

  const totalsByProperty = new Map();
  const overallTotals = new Map();
  const totalChargesByProperty = new Map();
  const totalChargesByChemical = new Map();
  let overallChargeTotal = 0;

  for (const entry of rows) {
    const pricing = getChemicalChargeContext(entry);
    const propertyName = entry.property_name || "Unknown Property";
    const propertyKey = `${propertyName}|${entry.chemical_name || "Unknown"}|${entry.unit || "unit"}`;
    const overallKey = `${entry.chemical_name || "Unknown"}`;

    totalsByProperty.set(propertyKey, {
      propertyName,
      chemicalName: entry.chemical_name || "Unknown",
      unit: entry.unit || "unit",
      total: (totalsByProperty.get(propertyKey)?.total || 0) + Number(entry.quantity || 0),
    });

    overallTotals.set(`${entry.chemical_name || "Unknown"}|${entry.unit || "unit"}`, {
      chemicalName: entry.chemical_name || "Unknown",
      unit: entry.unit || "unit",
      total: (overallTotals.get(`${entry.chemical_name || "Unknown"}|${entry.unit || "unit"}`)?.total || 0) + Number(entry.quantity || 0),
    });

    totalChargesByProperty.set(
      propertyName,
      (totalChargesByProperty.get(propertyName) || 0) + pricing.charge
    );

    totalChargesByChemical.set(
      overallKey,
      (totalChargesByChemical.get(overallKey) || 0) + pricing.charge
    );

    overallChargeTotal += pricing.charge;
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

  const chargeTotalsByPropertyMarkup = Array.from(totalChargesByProperty.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([propertyName, total]) => `<li>${propertyName}: ${toMoney(total)}</li>`)
    .join("");

  const chargeTotalsByChemicalMarkup = Array.from(totalChargesByChemical.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([chemicalName, total]) => `<li>${chemicalName}: ${toMoney(total)}</li>`)
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
              <th>Billable Rate</th>
              <th>Chemical Charge</th>
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

      <section class="billing-report-group">
        <h3>Total Chemical Charges By Property</h3>
        <ul class="chemical-total-list">
          ${chargeTotalsByPropertyMarkup}
        </ul>
      </section>

      <section class="billing-report-group">
        <h3>Total Chemical Charges By Chemical</h3>
        <ul class="chemical-total-list">
          ${chargeTotalsByChemicalMarkup}
        </ul>
      </section>

      <div class="billing-report-grand-total">Overall Chemical Charges: ${toMoney(overallChargeTotal)}</div>

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
    const pricing = getChemicalChargeContext(row);
    return `${row.service_date} | ${row.property_name || "Unknown Property"} | ${row.chemical_name} ${Number(row.quantity || 0).toFixed(2).replace(/\.00$/, "")} ${row.unit} | Rate ${toMoney(pricing.rate)} | Charge ${toMoney(pricing.charge)}`;
  });

  const overallChargeTotal = rows.reduce((sum, row) => sum + getChemicalChargeContext(row).charge, 0);

  const text = [
    `${companyProfile.company_name} - Chemical Usage Report`,
    `Date Range: ${latestChemicalReportState.startDate} to ${latestChemicalReportState.endDate}`,
    `Property: ${selectedPropertyName}`,
    `Chemical: ${latestChemicalReportState.selectedChemical || "All Chemicals"}`,
    `Overall Chemical Charges: ${toMoney(overallChargeTotal)}`,
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
  const selectedClientName = billingClientSelect?.value || "";
  const reconciledOnly = billingReconciledOnly ? billingReconciledOnly.checked : true;

  const rows = getBillingReportRowsForFilters({
    startDate,
    endDate,
    selectedPropertyId,
    selectedClientName,
    includeInvoiced: true,
  });

  return reconciledOnly ? rows.filter((row) => isBillingRowReconciled(row)) : rows;
}

function isBillingRowReconciled(row) {
  return isTaskReconciled(row) || isTaskLinkedToFinalizedInvoice(row);
}

function getActiveBillingFilterState() {
  const hasExplicitRange = Boolean(billingStartDate?.value && billingEndDate?.value);
  if (hasExplicitRange) {
    return {
      startDate: billingStartDate.value,
      endDate: billingEndDate.value,
      selectedPropertyId: billingPropertySelect?.value || "",
      selectedClientName: billingClientSelect?.value || "",
    };
  }

  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return {
    startDate: formatDateValue(monthStart),
    endDate: formatDateValue(monthEnd),
    selectedPropertyId: billingPropertySelect?.value || "",
    selectedClientName: billingClientSelect?.value || "",
  };
}

function logBillingSummaryDebugRows(rows, reason) {
  rows.forEach((row) => {
    console.log("[Billing Summary Debug][Included]", {
      id: row.id,
      property: row.propertyName || getPropertyName(row.property_id),
      serviceDate: row.serviceDate || row.service_date || row.scheduled_date || "",
      amount: Number(row.billableAmount || 0),
      billingReason: row.billingReasonLabel || "Chargeable",
      sourceType: "task",
      whyIncluded: reason,
    });
  });
}

function getCurrentMonthBillingSummaryFilterState() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    startDate: formatDateValue(monthStart),
    endDate: formatDateValue(monthEnd),
    selectedPropertyId: billingPropertySelect?.value || "",
    selectedClientName: billingClientSelect?.value || "",
  };
}

function getBillingSummaryEligibleTasks({ startDate, endDate, selectedPropertyId = "", selectedClientName = "" } = {}) {
  const scopedPropertyIds = new Set(resolvePropertyIdsForScope({ selectedPropertyId, selectedClientName }).map((id) => normalizePropertyId(id)));

  return cleaningTasks
    .filter((task) => scopedPropertyIds.has(normalizePropertyId(task.property_id)))
    .filter((task) => {
      const status = String(task.status || "").toLowerCase();
      return status !== "cancelled" && status !== "void" && status !== "deleted";
    })
    .map((task) => {
      const serviceDate = task.service_date || task.scheduled_date || "";
      const billingContext = getTaskBillingContext(task);
      const amount = Number(billingContext.billableAmount || 0);
      const isInRange = Boolean(serviceDate && serviceDate >= startDate && serviceDate <= endDate);
      const isEligibleChargeable = amount > 0;
      return {
        ...task,
        serviceDate,
        propertyName: getPropertyName(task.property_id),
        billingReasonLabel: billingContext.billingReasonLabel,
        billableAmount: amount,
        isEligibleChargeable,
        isInRange,
      };
    })
    .filter((task) => task.isInRange)
    .filter((task) => task.isEligibleChargeable);
}

function logBillingSummaryEligibleTasks(tasks) {
  tasks.forEach((task) => {
    console.log("[Billing Summary Debug][Eligible Task]", {
      id: task.id,
      property: task.propertyName || getPropertyName(task.property_id),
      serviceDate: task.serviceDate || task.service_date || task.scheduled_date || "",
      amount: Number(task.billableAmount || 0),
      billingReason: task.billingReasonLabel || "Chargeable",
      billedState: isBillingRowReconciled(task) ? "billed" : "unbilled",
    });
  });
}

function renderBillingReport() {
  if (!billingReportContainer) return;

  const clientOptions = `<option value="">All Clients</option>${Array.from(new Set(
    properties
      .map((property) => String(property.client_name || "").trim())
      .filter(Boolean)
  ))
    .sort((a, b) => a.localeCompare(b))
    .map((clientName) => `<option value="${clientName}">${clientName}</option>`)
    .join("")}`;

  if (billingClientSelect && billingClientSelect.innerHTML !== clientOptions) {
    const previousClient = billingClientSelect.value;
    billingClientSelect.innerHTML = clientOptions;
    billingClientSelect.value = previousClient;
  }

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

async function loadInvoices() {
  const { data, error } = await supabaseClient
    .from("invoices")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    const missingTable = String(error.message || "").toLowerCase().includes("invoices");
    if (!missingTable) {
      console.warn("Could not load invoices:", error.message);
    }
    invoices = [];
    return;
  }

  invoices = data || [];
}

function isTaskAlreadyInvoiced(task) {
  return isTaskLinkedToFinalizedInvoice(task);
}

function isChemicalUsageAlreadyInvoiced(entry) {
  const invoiced = entry?.invoiced === true || entry?.invoiced === 1 || entry?.invoiced === "true";
  if (isChemicalUsageLinkedToFinalizedInvoice(entry)) return true;
  return invoiced && (Boolean(entry?.invoiced_invoice_id) || Boolean(entry?.invoice_id));
}

function isFinalizedInvoiceStatus(status) {
  const normalized = String(status || "").toLowerCase();
  return normalized === "finalized" || normalized === "sent" || normalized === "paid";
}

function getInvoiceStatusById(invoiceId) {
  if (!invoiceId) return "";
  const invoice = invoices.find((row) => String(row.id || "") === String(invoiceId));
  return String(invoice?.status || "").toLowerCase();
}

function isTaskLinkedToFinalizedInvoice(task) {
  const linkedInvoiceId = task?.invoice_id || task?.invoiced_invoice_id || null;
  if (!linkedInvoiceId) return false;
  const status = getInvoiceStatusById(linkedInvoiceId);
  if (!status) {
    // If invoice status is unavailable, default to protected behavior to avoid duplicate billing.
    return true;
  }
  return isFinalizedInvoiceStatus(status);
}

function isChemicalUsageLinkedToFinalizedInvoice(entry) {
  const linkedInvoiceId = entry?.invoice_id || entry?.invoiced_invoice_id || null;
  if (!linkedInvoiceId) return false;
  const status = getInvoiceStatusById(linkedInvoiceId);
  if (!status) {
    return true;
  }
  return isFinalizedInvoiceStatus(status);
}

function getInvoiceTaskDiagnostics({ startDate, endDate, selectedPropertyId = "", selectedClientName = "" }) {
  const scopedPropertyIds = new Set(resolvePropertyIdsForScope({ selectedPropertyId, selectedClientName }).map((id) => normalizePropertyId(id)));
  const scopedTasks = cleaningTasks.filter((task) => scopedPropertyIds.has(normalizePropertyId(task.property_id)));

  const diagnostics = {
    totalTasksFound: scopedTasks.length,
    completedTasks: 0,
    chargeableTasks: 0,
    alreadyInvoicedTasks: 0,
    eligibleTasks: 0,
    excluded: {
      outsideDateRange: 0,
      notCompleted: 0,
      includedNoCharge: 0,
      alreadyInvoiced: 0,
      missingProperty: 0,
      missingRate: 0,
      invalidTaskStatus: 0,
    },
  };

  const perTask = scopedTasks.map((task) => {
    const taskId = task.id;
    const statusRaw = String(task.status || "");
    const status = statusRaw.toLowerCase();
    const serviceDate = task.service_date || task.scheduled_date || "";
    const hasDateInRange = Boolean(serviceDate && serviceDate >= startDate && serviceDate <= endDate);
    const billingContext = getTaskBillingContext(task);
    const billableAmount = Number(billingContext.billableAmount || 0);
    const isCompleted = status === "completed";
    const hasProperty = Boolean(task.property_id);
    const alreadyInvoiced = isTaskLinkedToFinalizedInvoice(task);

    if (isCompleted) diagnostics.completedTasks += 1;
    if (billingContext.isBillable) diagnostics.chargeableTasks += 1;
    if (alreadyInvoiced) diagnostics.alreadyInvoicedTasks += 1;

    let included = true;
    let exclusionReason = "";

    if (!hasProperty) {
      included = false;
      exclusionReason = "missing property";
      diagnostics.excluded.missingProperty += 1;
    } else if (!hasDateInRange) {
      included = false;
      exclusionReason = "outside date range";
      diagnostics.excluded.outsideDateRange += 1;
    } else if (!isCompleted) {
      included = false;
      exclusionReason = statusRaw ? "not completed" : "invalid task status";
      diagnostics.excluded.notCompleted += 1;
      if (!statusRaw) diagnostics.excluded.invalidTaskStatus += 1;
    } else if (!billingContext.isBillable || billableAmount <= 0) {
      included = false;
      exclusionReason = "included/no charge";
      diagnostics.excluded.includedNoCharge += 1;
      if (billingContext.isBillable && billableAmount <= 0) {
        diagnostics.excluded.missingRate += 1;
        exclusionReason = "missing rate";
      }
    } else if (alreadyInvoiced) {
      included = false;
      exclusionReason = "already invoiced";
      diagnostics.excluded.alreadyInvoiced += 1;
    }

    if (included) diagnostics.eligibleTasks += 1;

    return {
      taskId,
      status: statusRaw,
      serviceDate,
      billingContext,
      billableAmount,
      included,
      exclusionReason,
    };
  });

  return {
    diagnostics,
    perTask,
    scopedTaskIds: scopedTasks.map((task) => task.id),
  };
}

function logInvoiceTaskDebugInfo({ startDate, endDate, selectedPropertyId, selectedClientName, diagnostics, perTask, scopedTaskIds, generatedCleaningItems }) {
  console.log("[Invoice Debug][Cleaning] Total tasks returned from database:", cleaningTasks.length);
  console.log("[Invoice Debug][Cleaning] Scoped task IDs:", scopedTaskIds);
  console.log("[Invoice Debug][Cleaning] Scope:", {
    selectedPropertyId,
    selectedClientName,
    startDate,
    endDate,
  });

  perTask.forEach((row) => {
    console.log("[Invoice Debug][Cleaning][Task]", {
      taskId: row.taskId,
      status: row.status,
      serviceDate: row.serviceDate,
      billingResult: row.billingContext,
      amount: row.billableAmount,
      included: row.included,
      exclusionReason: row.exclusionReason || null,
    });
  });

  console.log("[Invoice Debug][Cleaning] Summary:", {
    tasksFound: diagnostics.totalTasksFound,
    completedTasks: diagnostics.completedTasks,
    chargeableTasks: diagnostics.chargeableTasks,
    alreadyInvoicedTasks: diagnostics.alreadyInvoicedTasks,
    eligibleCleaningItems: diagnostics.eligibleTasks,
    createdCleaningInvoiceItems: generatedCleaningItems,
    exclusions: diagnostics.excluded,
  });
}

function logClientCleaningAggregation({ taskItems, propertyIds = [], clientName = "" }) {
  const propertyMap = new Map();
  const allowedPropertyIds = new Set((propertyIds || []).map((id) => normalizePropertyId(id)));
  let runningCleaningItemCount = 0;

  taskItems.forEach((item) => {
    const propertyKey = normalizePropertyId(item.propertyId);
    if (allowedPropertyIds.size && !allowedPropertyIds.has(propertyKey)) return;

    if (!propertyMap.has(propertyKey)) {
      propertyMap.set(propertyKey, {
        propertyName: item.propertyName || getPropertyName(item.propertyId),
        chargeableTasksFound: 0,
        cleaningInvoiceItemsCreated: 0,
      });
    }

    const group = propertyMap.get(propertyKey);
    group.chargeableTasksFound += 1;
    group.cleaningInvoiceItemsCreated += 1;
    runningCleaningItemCount += 1;

    console.log("[Invoice Debug][Cleaning][Aggregation]", {
      clientName,
      propertyName: group.propertyName,
      chargeableTasksFoundPerProperty: group.chargeableTasksFound,
      cleaningInvoiceItemsCreatedPerProperty: group.cleaningInvoiceItemsCreated,
      runningCleaningItemCount,
    });
  });

  console.log("[Invoice Debug][Cleaning][Aggregation][Final]", {
    clientName,
    propertiesProcessed: Array.from(propertyMap.values()).map((row) => ({
      propertyName: row.propertyName,
      chargeableTasksFound: row.chargeableTasksFound,
      cleaningInvoiceItemsCreated: row.cleaningInvoiceItemsCreated,
    })),
    finalCleaningItemCount: runningCleaningItemCount,
  });
}

function getInvoiceCandidateTasks({ startDate, endDate, selectedPropertyId = "", selectedClientName = "", enableDebugLog = false }) {
  const billingRows = getBillingReportRowsForFilters({
    startDate,
    endDate,
    selectedPropertyId,
    selectedClientName,
    includeInvoiced: false,
  });

  const items = billingRows.map((row) => ({
    sourceId: row.id,
    taskId: row.id,
    chemicalUsageId: null,
    propertyId: row.property_id,
    propertyName: row.propertyName || getPropertyName(row.property_id),
    clientName: row.clientName || "",
    description: `${row.propertyName || getPropertyName(row.property_id)} - ${row.serviceLabel || row.service_type || "Cleaning Service"} (${row.billingReasonLabel || "Chargeable"})`,
    serviceDate: row.serviceDate || row.service_date || row.scheduled_date || "",
    quantity: Number(row.quantity || 1),
    unit: row.unit || "service",
    rate: Number(row.rate || row.billableAmount || 0),
    amount: Number(row.billableAmount || 0),
    itemType: "cleaning",
    itemSource: INVOICE_ITEM_SOURCES.TASK,
    notes: stripManualBillingOverrideTag(row.notes || ""),
  }));

  if (enableDebugLog) {
    const taskDebug = getInvoiceTaskDiagnostics({ startDate, endDate, selectedPropertyId, selectedClientName });
    logInvoiceTaskDebugInfo({
      startDate,
      endDate,
      selectedPropertyId,
      selectedClientName,
      diagnostics: taskDebug.diagnostics,
      perTask: taskDebug.perTask,
      scopedTaskIds: taskDebug.scopedTaskIds,
      generatedCleaningItems: items.length,
    });
  }

  return items;
}

function getInvoiceChemicalCandidates({ startDate, endDate, selectedPropertyId = "", selectedClientName = "", includeNonBillableChemicals = false }) {
  const rows = getChemicalReportRowsForFilters({
    startDate,
    endDate,
    selectedPropertyId,
    selectedClientName,
    includeInvoiced: false,
  });

  return rows
    .map((entry) => {
      const pricing = getChemicalChargeContext(entry);
      const includeRow = pricing.isBillable || includeNonBillableChemicals;
      if (!includeRow) return null;

      const quantity = Number(entry.quantity || 0);
      const rate = pricing.isBillable ? Number(pricing.rate || 0) : 0;
      const amount = Number((quantity * rate).toFixed(2));
      return {
        sourceId: entry.id,
        taskId: entry.task_id || null,
        chemicalUsageId: entry.id,
        propertyId: entry.property_id,
        propertyName: entry.property_name || getPropertyName(entry.property_id),
        clientName: entry.client_name || "",
        description: `${entry.property_name || getPropertyName(entry.property_id)} - ${entry.chemical_name || "Chemical"}`,
        serviceDate: entry.service_date || "",
        quantity,
        unit: entry.unit || "unit",
        rate,
        amount,
        itemType: "chemical",
        itemSource: INVOICE_ITEM_SOURCES.CHEMICAL,
        notes: entry.notes || "",
      };
    })
    .filter(Boolean);
}

function getInvoiceTermsDays(terms) {
  const value = String(terms || "").trim().toLowerCase();
  const match = value.match(/(\d+)/);
  if (match) return Number(match[1]);
  return 15;
}

function formatInvoiceDate(date) {
  return formatDateValue(date || new Date());
}

function buildDraftInvoiceModel({ property, clientName = "", propertyIds = [], startDate, endDate, includeNonBillableChemicals = false, taxOverride = "property", enableDebugLog = false }) {
  const invoiceDate = formatInvoiceDate(new Date());
  const selectedPropertyId = !clientName && propertyIds.length <= 1
    ? (property?.id || (propertyIds.length === 1 ? propertyIds[0] : ""))
    : "";
  const selectedClientName = clientName || "";
  const taskDebug = getInvoiceTaskDiagnostics({ startDate, endDate, selectedPropertyId, selectedClientName });
  const taskItems = getInvoiceCandidateTasks({ startDate, endDate, selectedPropertyId, selectedClientName, enableDebugLog })
    .filter((item) => !propertyIds.length || propertyIds.some((id) => normalizePropertyId(id) === normalizePropertyId(item.propertyId)));

  if (enableDebugLog && (clientName || propertyIds.length > 1)) {
    logClientCleaningAggregation({
      taskItems,
      propertyIds,
      clientName: clientName || "Multi-property draft",
    });
  }

  const chemicalItems = getInvoiceChemicalCandidates({
    startDate,
    endDate,
    selectedPropertyId,
    selectedClientName,
    includeNonBillableChemicals,
  }).filter((item) => !propertyIds.length || propertyIds.some((id) => normalizePropertyId(id) === normalizePropertyId(item.propertyId)));

  latestInvoiceCandidates = {
    tasks: taskItems,
    chemicalRows: chemicalItems,
  };

  const items = [...taskItems, ...chemicalItems];
  const subtotal = Number(items.reduce((sum, item) => sum + Number(item.amount || 0), 0).toFixed(2));
  const propertyTaxable = property?.billing_taxable !== false;
  const taxable = taxOverride === "yes" ? true : taxOverride === "no" ? false : propertyTaxable;
  const taxRate = Number(property?.billing_tax_rate || 0);
  const tax = taxable && taxRate > 0 ? Number((subtotal * (taxRate / 100)).toFixed(2)) : 0;
  const total = Number((subtotal + tax).toFixed(2));

  const paymentTerms = String(property?.payment_terms || DEFAULT_INVOICE_TERMS).trim() || DEFAULT_INVOICE_TERMS;
  const dueDate = (() => {
    const date = parseDateString(invoiceDate);
    date.setUTCDate(date.getUTCDate() + getInvoiceTermsDays(paymentTerms));
    return formatDateValue(date);
  })();

  return {
    id: null,
    invoiceNumber: "(pending)",
    propertyId: property?.id || "",
    propertyName: property?.property_name || (propertyIds.length === 1 ? (properties.find((p) => normalizePropertyId(p.id) === normalizePropertyId(propertyIds[0]))?.property_name || "") : "Multiple Properties"),
    clientName: clientName || String(property?.client_name || "").trim() || String(property?.billing_company_name || "").trim() || property?.property_name || "Client",
    billingCompanyName: String(property?.billing_company_name || "").trim(),
    billingEmail: String(property?.billing_email || "").trim(),
    billingAddress: String(property?.billing_address || "").trim(),
    accountReference: String(property?.billing_account_reference || "").trim(),
    periodStart: startDate,
    periodEnd: endDate,
    invoiceDate,
    dueDate,
    status: "draft",
    notes: String(property?.invoice_notes || "").trim(),
    paymentTerms,
    taxable,
    taxRate,
    includeNonBillableChemicals,
    items,
    subtotal,
    tax,
    total,
    cleaningDiagnostics: taskDebug.diagnostics,
  };
}

function recalculateInvoiceDraftTotals() {
  if (!currentInvoiceDraft) return;
  currentInvoiceDraft.items = (currentInvoiceDraft.items || []).map((item) => {
    const quantity = Number(item.quantity || 0);
    const rate = Number(item.rate || 0);
    return {
      ...item,
      quantity,
      rate,
      amount: Number((quantity * rate).toFixed(2)),
    };
  });

  currentInvoiceDraft.subtotal = Number(currentInvoiceDraft.items.reduce((sum, item) => sum + Number(item.amount || 0), 0).toFixed(2));
  currentInvoiceDraft.tax = currentInvoiceDraft.taxable && Number(currentInvoiceDraft.taxRate || 0) > 0
    ? Number((currentInvoiceDraft.subtotal * (Number(currentInvoiceDraft.taxRate || 0) / 100)).toFixed(2))
    : 0;
  currentInvoiceDraft.total = Number((currentInvoiceDraft.subtotal + currentInvoiceDraft.tax).toFixed(2));
}

function formatInvoicePrintDateValue(value) {
  const normalized = normalizeDateKey(value);
  if (!normalized) return String(value || "");

  const parsed = parseDateString(normalized);
  if (Number.isNaN(parsed.getTime())) return normalized;

  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  const year = parsed.getUTCFullYear();
  return `${month}/${day}/${year}`;
}

function formatInvoicePrintPeriod(startDate, endDate) {
  if (startDate && endDate) {
    return `${formatInvoicePrintDateValue(startDate)} – ${formatInvoicePrintDateValue(endDate)}`;
  }
  return formatInvoicePrintDateValue(startDate || endDate || "");
}

function renderInvoicePreview() {
  if (!invoicePreviewContainer) return;

  if (!currentInvoiceDraft) {
    invoicePreviewContainer.classList.add("hidden");
    invoicePreviewContainer.innerHTML = "";
    return;
  }

  invoicePreviewContainer.classList.remove("hidden");
  recalculateInvoiceDraftTotals();
  const invoice = currentInvoiceDraft;

  const itemRows = invoice.items.length
    ? invoice.items.map((item, index) => `
      <tr>
        <td><input type="text" value="${escapeHtml(item.description || "")}" onchange="updateInvoiceItemField(${index}, 'description', this.value)"></td>
        <td><input type="date" value="${item.serviceDate || ""}" onchange="updateInvoiceItemField(${index}, 'serviceDate', this.value)"></td>
        <td><input type="number" step="0.01" value="${Number(item.quantity || 0)}" onchange="updateInvoiceItemField(${index}, 'quantity', this.value)"></td>
        <td><input type="text" value="${escapeHtml(item.unit || "")}" onchange="updateInvoiceItemField(${index}, 'unit', this.value)"></td>
        <td><input type="number" step="0.01" value="${Number(item.rate || 0)}" onchange="updateInvoiceItemField(${index}, 'rate', this.value)"></td>
        <td><input type="text" value="${escapeHtml(item.notes || "")}" onchange="updateInvoiceItemField(${index}, 'notes', this.value)"></td>
        <td class="billing-report-amount">${toMoney(item.amount)}</td>
        <td><button type="button" class="delete-btn" onclick="removeInvoiceItem(${index})">Remove</button></td>
      </tr>
    `).join("")
    : `<tr><td colspan="8">No line items in this invoice.</td></tr>`;

  const printItemRows = invoice.items.length
    ? invoice.items.map((item) => `
      <tr>
        <td>${escapeHtml(item.description || "")}</td>
        <td>${escapeHtml(formatInvoicePrintDateValue(item.serviceDate || ""))}</td>
        <td>${escapeHtml(String(Number(item.quantity || 0)))}</td>
        <td>${escapeHtml(item.unit || "")}</td>
        <td class="billing-report-amount">${toMoney(item.rate || 0)}</td>
        <td>${escapeHtml(item.notes || "")}</td>
        <td class="billing-report-amount">${toMoney(item.amount)}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="7">No line items in this invoice.</td></tr>`;

  const propertyName = invoice.propertyName || getPropertyName(invoice.propertyId);
  const billingName = invoice.billingCompanyName || invoice.clientName;
  const billingEmail = String(invoice.billingEmail || "").trim();
  const billingAddress = String(invoice.billingAddress || "").trim();
  const accountReference = String(invoice.accountReference || "").trim();
  const notes = String(invoice.notes || "").trim();
  const showTaxLine = invoice.taxable && Number(invoice.taxRate || 0) > 0;

  invoicePreviewContainer.innerHTML = `
    <div class="invoice-preview-actions no-print">
      <button type="button" onclick="addInvoiceManualItem()">Add Line Item</button>
      <button type="button" onclick="addInvoiceDiscountItem()">Add Discount</button>
      <button type="button" onclick="addInvoiceCreditItem()">Add Credit</button>
      <button type="button" onclick="addInvoiceSurchargeItem()">Add Surcharge</button>
      <select id="invoiceQuickAddSelect" onchange="addInvoiceQuickItem(this.value)">
        <option value="">Quick Add...</option>
        <option value="filter_cleaning">Filter Cleaning</option>
        <option value="cartridge_cleaning">Cartridge Cleaning</option>
        <option value="green_to_clean">Green-to-Clean Treatment</option>
        <option value="pump_repair">Pump Repair</option>
        <option value="equipment_repair">Equipment Repair</option>
        <option value="emergency_service">Emergency Service</option>
        <option value="salt_addition">Salt Addition</option>
        <option value="travel_charge">Travel Charge</option>
        <option value="discount">Discount</option>
        <option value="credit">Credit</option>
      </select>
      <button type="button" onclick="saveInvoiceDraft()">Save Draft</button>
      <button type="button" class="checklist-link-btn" onclick="finalizeInvoiceDraft()">Finalize Invoice</button>
      <button type="button" id="invoicePrintBtn" class="print-btn" onclick="printInvoicePreview()">Print</button>
      <button type="button" class="print-btn" onclick="downloadInvoicePdf()">Download PDF</button>
      <button type="button" onclick="shareInvoicePreview()">Email/Share</button>
      <button type="button" onclick="exportInvoiceCsv()">Export CSV</button>
    </div>

    <div class="invoice-document billing-report-sheet invoice-report-sheet">
      <div class="invoice-edit-view">
        ${renderBillingReportHeader()}
        <div class="billing-report-meta"><strong>Fair Ventures LLC</strong></div>
        <div class="billing-report-meta"><strong>Client:</strong> <input type="text" value="${escapeHtml(invoice.clientName || "")}" onchange="updateInvoiceDraftField('clientName', this.value)"></div>
        <div class="billing-report-meta"><strong>Billing Company:</strong> <input type="text" value="${escapeHtml(billingName || "")}" onchange="updateInvoiceDraftField('billingCompanyName', this.value)"></div>
        <div class="billing-report-meta"><strong>Billing Email:</strong> <input type="email" value="${escapeHtml(invoice.billingEmail || "")}" onchange="updateInvoiceDraftField('billingEmail', this.value)"></div>
        <div class="billing-report-meta"><strong>Billing Address:</strong> <input type="text" value="${escapeHtml(invoice.billingAddress || "")}" onchange="updateInvoiceDraftField('billingAddress', this.value)"></div>
        <div class="billing-report-meta"><strong>Account/Ref:</strong> <input type="text" value="${escapeHtml(invoice.accountReference || "")}" onchange="updateInvoiceDraftField('accountReference', this.value)"></div>
        <div class="billing-report-meta"><strong>Invoice #:</strong> ${escapeHtml(invoice.invoiceNumber || "(pending)")}</div>
        <div class="billing-report-meta"><strong>Invoice Date:</strong> ${invoice.invoiceDate}</div>
        <div class="billing-report-meta"><strong>Due Date:</strong> <input type="date" value="${invoice.dueDate || ""}" onchange="updateInvoiceDraftField('dueDate', this.value)"> (${escapeHtml(invoice.paymentTerms || DEFAULT_INVOICE_TERMS)})</div>
        <div class="billing-report-meta"><strong>Service Period:</strong> ${invoice.periodStart} to ${invoice.periodEnd}</div>
        <div class="billing-report-meta"><strong>Status:</strong> ${escapeHtml(String(invoice.status || "draft").toUpperCase())}</div>
        <div class="billing-report-meta"><strong>Property:</strong> ${escapeHtml(propertyName || "")}</div>
        <h2 class="billing-report-title invoice-document-title">Invoice Preview</h2>
        <div class="billing-report-meta"><strong>Taxable:</strong> <input type="checkbox" ${invoice.taxable ? "checked" : ""} onchange="updateInvoiceDraftField('taxable', this.checked)"></div>
        <div class="billing-report-meta"><strong>Tax Rate (%):</strong> <input type="number" min="0" step="0.01" value="${Number(invoice.taxRate || 0)}" onchange="updateInvoiceDraftField('taxRate', this.value)"></div>
        <div class="billing-report-meta"><strong>Notes:</strong> <textarea rows="3" onchange="updateInvoiceDraftField('notes', this.value)">${escapeHtml(invoice.notes || "")}</textarea></div>

        <section class="billing-report-group">
          <h3>Itemized Charges</h3>
          <table class="billing-report-table invoice-edit-table">
            <thead>
              <tr>
                <th>Description</th>
                <th>Service Date</th>
                <th>Qty</th>
                <th>Unit</th>
                <th>Rate</th>
                <th>Notes</th>
                <th>Amount</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${itemRows}
            </tbody>
          </table>
        </section>

        <div class="billing-report-subtotal">Subtotal: ${toMoney(invoice.subtotal)}</div>
        <div class="billing-report-subtotal">Tax (${Number(invoice.taxRate || 0).toFixed(2)}%): ${toMoney(invoice.tax)}</div>
        <div class="billing-report-grand-total">Total Due: ${toMoney(invoice.total)}</div>
        <div class="billing-report-meta">Payment Instructions: Please remit payment to Fair Ventures LLC by due date.</div>
        ${renderBillingReportFooter()}
      </div>

      <div class="invoice-print-view">
        <div class="invoice-print-header">
          <div>
            <div class="invoice-brand-row">
              ${renderBillingReportHeader()}
            </div>
            <div class="invoice-print-text"><strong>Fair Ventures LLC</strong></div>
            <div class="invoice-bill-to">
              <div class="invoice-bill-to-title">BILL TO</div>
              <div class="invoice-print-text">${escapeHtml(invoice.clientName || "")}</div>
              <div class="invoice-print-text">Billing Company: ${escapeHtml(billingName || "")}</div>
              ${billingEmail ? `<div class="invoice-print-text">Billing Email: ${escapeHtml(billingEmail)}</div>` : ""}
              ${billingAddress ? `<div class="invoice-print-text">Billing Address: ${escapeHtml(billingAddress)}</div>` : ""}
              ${accountReference ? `<div class="invoice-print-text">Account/Ref: ${escapeHtml(accountReference)}</div>` : ""}
            </div>
          </div>
          <div class="invoice-meta">
            <div class="invoice-title">INVOICE</div>
            <div class="invoice-print-text">Invoice #: ${escapeHtml(invoice.invoiceNumber || "Pending")}</div>
            <div class="invoice-print-text">Invoice Date: ${escapeHtml(formatInvoicePrintDateValue(invoice.invoiceDate || ""))}</div>
            <div class="invoice-print-text">Due Date: ${escapeHtml(formatInvoicePrintDateValue(invoice.dueDate || ""))}</div>
            <div class="invoice-print-text">Terms: ${escapeHtml(invoice.paymentTerms || DEFAULT_INVOICE_TERMS)}</div>
            <div class="invoice-print-text">Service Period: ${escapeHtml(formatInvoicePrintPeriod(invoice.periodStart || "", invoice.periodEnd || ""))}</div>
            <div class="invoice-print-text">Status: ${escapeHtml(String(invoice.status || "draft").toUpperCase())}</div>
            <div class="invoice-print-text">Property: ${escapeHtml(propertyName || "")}</div>
          </div>
        </div>

        <section class="billing-report-group invoice-items-section">
          <h3>Itemized Charges</h3>
          <table class="billing-report-table invoice-print-table">
            <thead>
              <tr>
                <th>Description</th>
                <th>Service Date</th>
                <th>Qty</th>
                <th>Unit</th>
                <th>Rate</th>
                <th>Notes</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              ${printItemRows}
            </tbody>
          </table>
        </section>

        <div class="billing-report-subtotal">Subtotal: ${toMoney(invoice.subtotal)}</div>
        ${showTaxLine ? `<div class="billing-report-subtotal">Tax (${Number(invoice.taxRate || 0).toFixed(2)}%): ${toMoney(invoice.tax)}</div>` : ""}
        <div class="billing-report-grand-total">Total Due: ${toMoney(invoice.total)}</div>
        ${notes ? `<div class="billing-report-meta"><strong>Notes:</strong> ${escapeHtml(notes)}</div>` : ""}
        <div class="billing-report-meta">Payment Instructions: Please remit payment to Fair Ventures LLC by due date.</div>
        ${renderBillingReportFooter()}
      </div>
    </div>
  `;
}

function renderInvoiceEligibilitySummary(groups = [], meta = {}) {
  if (!invoiceEligibilitySummary) return;
  if (!groups.length) {
    const messages = meta.emptyReasons?.length
      ? `<ul class="invoice-eligibility-reasons">${meta.emptyReasons.map((reason) => `<li>${reason}</li>`).join("")}</ul>`
      : "";
    invoiceEligibilitySummary.classList.remove("hidden");
    invoiceEligibilitySummary.innerHTML = `
      <div class="billing-report-sheet">
        <h3>Invoice Eligibility Summary</h3>
        <div class="empty">No eligible charges found for the selected scope and date range.</div>
        ${messages}
      </div>
    `;
    return;
  }

  const diagnosticsByLabel = meta.cleaningDiagnosticsByLabel || {};
  const markup = groups.map((group) => {
    const cleaningTotal = group.taskItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const chemicalTotal = group.chemicalItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const total = cleaningTotal + chemicalTotal;
    const diagnostics = diagnosticsByLabel[group.label] || null;
    const noCleaningMessage = cleaningTotal <= 0
      ? `<div class="invoice-no-cleaning-message"><strong>No eligible cleaning charges were found.</strong></div>`
      : "";
    const diagLine = diagnostics
      ? `<div class="invoice-no-cleaning-diagnostics">Tasks found: ${diagnostics.totalTasksFound} | Completed tasks: ${diagnostics.completedTasks} | Chargeable tasks: ${diagnostics.chargeableTasks} | Already invoiced tasks: ${diagnostics.alreadyInvoicedTasks}</div>`
      : "";
    return `
      <div class="invoice-eligibility-card">
        <div><strong>${escapeHtml(group.label)}</strong></div>
        <div>- ${group.taskItems.length} cleaning charges: ${toMoney(cleaningTotal)}</div>
        <div>- ${group.chemicalItems.length} chemical charges: ${toMoney(chemicalTotal)}</div>
        <div><strong>Total eligible charges: ${toMoney(total)}</strong></div>
        ${noCleaningMessage}
        ${diagLine}
      </div>
    `;
  }).join("");

  invoiceEligibilitySummary.classList.remove("hidden");
  invoiceEligibilitySummary.innerHTML = `
    <div class="billing-report-sheet">
      <h3>Invoice Eligibility Summary</h3>
      ${markup}
    </div>
  `;
}

function clearInvoiceEligibilitySummary() {
  if (!invoiceEligibilitySummary) return;
  invoiceEligibilitySummary.classList.add("hidden");
  invoiceEligibilitySummary.innerHTML = "";
}

function renderInvoiceBatchPreview() {
  if (!invoiceBatchPreviewContainer) return;
  if (!currentInvoiceBatchDrafts.length) {
    invoiceBatchPreviewContainer.classList.add("hidden");
    invoiceBatchPreviewContainer.innerHTML = "";
    return;
  }

  invoiceBatchPreviewContainer.classList.remove("hidden");
  const rows = currentInvoiceBatchDrafts.map((draft, index) => `
    <tr>
      <td><input type="checkbox" checked onchange="toggleBatchInvoiceSelection(${index}, this.checked)"></td>
      <td>${escapeHtml(draft.clientName || draft.propertyName || "Unassigned")}</td>
      <td>${escapeHtml(draft.propertyName || "Multiple Properties")}</td>
      <td>${draft.items.length}</td>
      <td class="billing-report-amount">${toMoney(draft.total)}</td>
      <td><button type="button" onclick="openBatchInvoiceDraft(${index})">Preview</button></td>
    </tr>
  `).join("");

  invoiceBatchPreviewContainer.innerHTML = `
    <div class="billing-report-sheet">
      <h2 class="billing-report-title">Batch Invoice Preview</h2>
      <div class="billing-report-meta">All Properties selection generated separate drafts by client/property.</div>
      <table class="billing-report-table">
        <thead>
          <tr>
            <th>Select</th>
            <th>Client Group</th>
            <th>Property Scope</th>
            <th>Line Items</th>
            <th>Total</th>
            <th>Preview</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="invoice-preview-actions">
        <button type="button" onclick="saveSelectedBatchInvoiceDrafts()">Create Selected Draft Invoices</button>
      </div>
    </div>
  `;
}

function toggleBatchInvoiceSelection(index, selected) {
  const draft = currentInvoiceBatchDrafts[index];
  if (!draft) return;
  draft.selected = selected === true;
}

function openBatchInvoiceDraft(index) {
  const draft = currentInvoiceBatchDrafts[index];
  if (!draft) return;
  currentInvoiceDraft = { ...draft, items: draft.items.map((item) => ({ ...item })) };
  renderInvoicePreview();
}

async function saveSelectedBatchInvoiceDrafts() {
  const selectedDrafts = currentInvoiceBatchDrafts.filter((draft) => draft.selected !== false);
  if (!selectedDrafts.length) {
    alert("Select at least one batch invoice draft to create.");
    return;
  }

  for (const draft of selectedDrafts) {
    currentInvoiceDraft = { ...draft, items: draft.items.map((item) => ({ ...item })) };
    const saved = await saveInvoiceDraft({ silent: true });
    if (!saved) {
      alert("Stopped batch creation because one draft failed to save.");
      return;
    }
  }

  await loadData();
  alert(`Created ${selectedDrafts.length} draft invoice(s).`);
}

function generateInvoicePreviewFromFilters() {
  const startDate = billingStartDate?.value || "";
  const endDate = billingEndDate?.value || "";
  const selectedPropertyId = billingPropertySelect?.value || "";
  const selectedClientName = billingClientSelect?.value || "";

  if (!startDate || !endDate) {
    alert("Select a start and end date before generating an invoice.");
    return;
  }

  const taxOverride = invoiceTaxEnabled?.value || "property";
  const includeNonBillable = invoiceIncludeNonBillableChemicals?.checked === true;
  const emptyReasons = [
    "No completed chargeable tasks were found in the selected date range.",
    "All eligible tasks may already be invoiced.",
    "Included/no-charge services are excluded.",
    "Chemical entries may be non-billable or have a $0 rate.",
  ];

  currentInvoiceDraft = null;
  currentInvoiceBatchDrafts = [];

  if (selectedPropertyId) {
    const property = properties.find((item) => normalizePropertyId(item.id) === normalizePropertyId(selectedPropertyId));
    if (!property) {
      alert("Property not found.");
      return;
    }

    const draft = buildDraftInvoiceModel({
      property,
      propertyIds: [property.id],
      startDate,
      endDate,
      includeNonBillableChemicals: includeNonBillable,
      taxOverride,
      enableDebugLog: true,
    });

    const taskItems = draft.items.filter((item) => item.itemSource === INVOICE_ITEM_SOURCES.TASK);
    const chemicalItems = draft.items.filter((item) => item.itemSource === INVOICE_ITEM_SOURCES.CHEMICAL);
    renderInvoiceEligibilitySummary([{ label: property.property_name, taskItems, chemicalItems }], {
      emptyReasons,
      cleaningDiagnosticsByLabel: {
        [property.property_name]: draft.cleaningDiagnostics,
      },
    });
    if (!draft.items.length) {
      renderInvoicePreview();
      renderInvoiceBatchPreview();
      return;
    }

    currentInvoiceDraft = draft;
    renderInvoicePreview();
    renderInvoiceBatchPreview();
    return;
  }

  if (selectedClientName) {
    const clientProperties = properties.filter((property) => String(property.client_name || "").trim() === selectedClientName);
    const primaryProperty = clientProperties[0] || null;
    const draft = buildDraftInvoiceModel({
      property: primaryProperty,
      clientName: selectedClientName,
      propertyIds: clientProperties.map((property) => property.id),
      startDate,
      endDate,
      includeNonBillableChemicals: includeNonBillable,
      taxOverride,
      enableDebugLog: true,
    });

    const taskItems = draft.items.filter((item) => item.itemSource === INVOICE_ITEM_SOURCES.TASK);
    const chemicalItems = draft.items.filter((item) => item.itemSource === INVOICE_ITEM_SOURCES.CHEMICAL);
    renderInvoiceEligibilitySummary([{ label: selectedClientName, taskItems, chemicalItems }], {
      emptyReasons,
      cleaningDiagnosticsByLabel: {
        [selectedClientName]: draft.cleaningDiagnostics,
      },
    });
    if (!draft.items.length) {
      renderInvoicePreview();
      renderInvoiceBatchPreview();
      return;
    }

    currentInvoiceDraft = draft;
    renderInvoicePreview();
    renderInvoiceBatchPreview();
    return;
  }

  const grouped = new Map();
  for (const property of properties) {
    const clientLabel = String(property.client_name || "").trim();
    const key = clientLabel ? `client:${clientLabel}` : `property:${property.id}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        key,
        clientName: clientLabel,
        properties: [],
      });
    }
    grouped.get(key).properties.push(property);
  }

  const eligibilityGroups = [];
  const diagnosticsByLabel = {};
  const batchDrafts = [];
  for (const group of grouped.values()) {
    const primaryProperty = group.properties[0] || null;
    const label = group.clientName || primaryProperty?.property_name || "Unassigned";
    const draft = buildDraftInvoiceModel({
      property: primaryProperty,
      clientName: group.clientName,
      propertyIds: group.properties.map((property) => property.id),
      startDate,
      endDate,
      includeNonBillableChemicals: includeNonBillable,
      taxOverride,
      enableDebugLog: true,
    });

    const taskItems = draft.items.filter((item) => item.itemSource === INVOICE_ITEM_SOURCES.TASK);
    const chemicalItems = draft.items.filter((item) => item.itemSource === INVOICE_ITEM_SOURCES.CHEMICAL);
    if (taskItems.length || chemicalItems.length) {
      eligibilityGroups.push({ label, taskItems, chemicalItems });
      diagnosticsByLabel[label] = draft.cleaningDiagnostics;
      batchDrafts.push({
        ...draft,
        selected: true,
      });
    }
  }

  currentInvoiceBatchDrafts = batchDrafts;
  renderInvoiceEligibilitySummary(eligibilityGroups, {
    emptyReasons,
    cleaningDiagnosticsByLabel: diagnosticsByLabel,
  });
  renderInvoicePreview();
  renderInvoiceBatchPreview();
}

function updateInvoiceItemField(index, field, rawValue) {
  if (!currentInvoiceDraft) return;
  const item = currentInvoiceDraft.items[index];
  if (!item) return;

  const numericFields = new Set(["quantity", "rate"]);
  item[field] = numericFields.has(field) ? Number(rawValue || 0) : rawValue;
  recalculateInvoiceDraftTotals();
  renderInvoicePreview();
}

function removeInvoiceItem(index) {
  if (!currentInvoiceDraft) return;
  currentInvoiceDraft.items = currentInvoiceDraft.items.filter((_, idx) => idx !== index);
  recalculateInvoiceDraftTotals();
  renderInvoicePreview();
}

function addInvoiceManualItem() {
  if (!currentInvoiceDraft) return;
  currentInvoiceDraft.items.push({
    sourceId: null,
    taskId: null,
    chemicalUsageId: null,
    description: "Manual line item",
    serviceDate: currentInvoiceDraft.periodEnd || "",
    quantity: 1,
    unit: "each",
    rate: 0,
    amount: 0,
    itemType: "manual",
    itemSource: INVOICE_ITEM_SOURCES.MANUAL,
    notes: "",
  });
  renderInvoicePreview();
}

function addInvoiceCreditItem() {
  if (!currentInvoiceDraft) return;
  currentInvoiceDraft.items.push({
    sourceId: null,
    taskId: null,
    chemicalUsageId: null,
    description: "Credit / Adjustment",
    serviceDate: currentInvoiceDraft.periodEnd || "",
    quantity: 1,
    unit: "credit",
    rate: -25,
    amount: -25,
    itemType: "credit",
    itemSource: INVOICE_ITEM_SOURCES.MANUAL,
    notes: "",
  });
  renderInvoicePreview();
}

function addInvoiceDiscountItem() {
  if (!currentInvoiceDraft) return;
  currentInvoiceDraft.items.push({
    sourceId: null,
    taskId: null,
    chemicalUsageId: null,
    description: "Discount",
    serviceDate: currentInvoiceDraft.periodEnd || "",
    quantity: 1,
    unit: "discount",
    rate: -25,
    amount: -25,
    itemType: "discount",
    itemSource: INVOICE_ITEM_SOURCES.MANUAL,
    notes: "",
  });
  renderInvoicePreview();
}

function addInvoiceSurchargeItem() {
  if (!currentInvoiceDraft) return;
  currentInvoiceDraft.items.push({
    sourceId: null,
    taskId: null,
    chemicalUsageId: null,
    description: "Surcharge",
    serviceDate: currentInvoiceDraft.periodEnd || "",
    quantity: 1,
    unit: "surcharge",
    rate: 25,
    amount: 25,
    itemType: "surcharge",
    itemSource: INVOICE_ITEM_SOURCES.MANUAL,
    notes: "",
  });
  renderInvoicePreview();
}

function addInvoiceQuickItem(templateKey) {
  if (!currentInvoiceDraft || !templateKey) return;
  const template = INVOICE_QUICK_ADD_TEMPLATES[templateKey];
  if (!template) return;

  currentInvoiceDraft.items.push({
    sourceId: null,
    taskId: null,
    chemicalUsageId: null,
    description: template.description,
    serviceDate: currentInvoiceDraft.periodEnd || "",
    quantity: 1,
    unit: template.unit,
    rate: Number(template.rate || 0),
    amount: Number(template.rate || 0),
    itemType: template.itemType || "manual",
    itemSource: INVOICE_ITEM_SOURCES.MANUAL,
    notes: "",
  });

  const quickAddSelect = document.getElementById("invoiceQuickAddSelect");
  if (quickAddSelect) quickAddSelect.value = "";
  renderInvoicePreview();
}

function buildInvoiceNumber() {
  const year = new Date().getFullYear();
  const prefix = `GR-${year}-`;
  const maxSequence = invoices
    .map((invoice) => String(invoice.invoice_number || ""))
    .filter((value) => value.startsWith(prefix))
    .map((value) => Number(value.split("-").pop() || 0))
    .reduce((max, current) => Math.max(max, current), 0);

  const next = String(maxSequence + 1).padStart(4, "0");
  return `${prefix}${next}`;
}

async function saveInvoiceDraft(options = {}) {
  const silent = options?.silent === true;
  if (!currentInvoiceDraft) return;
  if (!currentInvoiceDraft.propertyId) {
    if (!silent) alert("Select a property before saving an invoice draft.");
    return false;
  }

  recalculateInvoiceDraftTotals();

  const invoicePayload = {
    invoice_number: currentInvoiceDraft.id ? currentInvoiceDraft.invoiceNumber : buildInvoiceNumber(),
    property_id: currentInvoiceDraft.propertyId,
    client_name: currentInvoiceDraft.clientName || null,
    billing_email: currentInvoiceDraft.billingEmail || null,
    billing_address: currentInvoiceDraft.billingAddress || null,
    period_start: currentInvoiceDraft.periodStart,
    period_end: currentInvoiceDraft.periodEnd,
    invoice_date: currentInvoiceDraft.invoiceDate,
    due_date: currentInvoiceDraft.dueDate,
    subtotal: currentInvoiceDraft.subtotal,
    tax: currentInvoiceDraft.tax,
    total: currentInvoiceDraft.total,
    status: "draft",
    notes: currentInvoiceDraft.notes || null,
  };

  let invoiceId = currentInvoiceDraft.id;
  if (invoiceId) {
    const { error } = await supabaseClient
      .from("invoices")
      .update(invoicePayload)
      .eq("id", invoiceId);

    if (error) {
      if (!silent) alert("Error updating invoice draft: " + error.message);
      return false;
    }

    await supabaseClient.from("invoice_items").delete().eq("invoice_id", invoiceId);
  } else {
    const { data, error } = await supabaseClient
      .from("invoices")
      .insert([invoicePayload])
      .select("id, invoice_number")
      .single();

    if (error) {
      if (!silent) alert("Error saving invoice draft: " + error.message + "\nRun invoice migration first if needed.");
      return false;
    }

    invoiceId = data.id;
    currentInvoiceDraft.id = data.id;
    currentInvoiceDraft.invoiceNumber = data.invoice_number;
  }

  const itemsPayload = currentInvoiceDraft.items.map((item) => ({
    invoice_id: invoiceId,
    task_id: item.taskId || null,
    chemical_usage_id: item.chemicalUsageId || null,
    description: item.description || null,
    service_date: item.serviceDate || null,
    quantity: Number(item.quantity || 0),
    unit: item.unit || null,
    rate: Number(item.rate || 0),
    amount: Number(item.amount || 0),
    item_type: item.itemType || "manual",
    item_source: item.itemSource || (item.taskId ? INVOICE_ITEM_SOURCES.TASK : item.chemicalUsageId ? INVOICE_ITEM_SOURCES.CHEMICAL : INVOICE_ITEM_SOURCES.MANUAL),
    notes: item.notes || null,
  }));

  if (itemsPayload.length) {
    const { error: itemError } = await supabaseClient
      .from("invoice_items")
      .insert(itemsPayload);

    if (itemError) {
      if (!silent) alert("Invoice draft saved, but line items failed: " + itemError.message);
      return false;
    }
  }

  if (!silent) {
    alert("Invoice draft saved.");
  }
  await loadInvoices();
  renderInvoiceHistory();
  renderInvoicePreview();
  return true;
}

async function finalizeInvoiceDraft() {
  if (!currentInvoiceDraft) return;

  const saved = await saveInvoiceDraft();
  if (!saved) return;
  if (!currentInvoiceDraft?.id) return;

  const cleaningTaskIds = Array.from(new Set(currentInvoiceDraft.items
    .filter((item) => item.taskId)
    .map((item) => item.taskId)));
  const chemicalUsageIds = Array.from(new Set(currentInvoiceDraft.items
    .filter((item) => item.chemicalUsageId)
    .map((item) => item.chemicalUsageId)));

  if (cleaningTaskIds.length) {
    const { data: latestTasks, error: latestTaskError } = await supabaseClient
      .from("cleaning_tasks")
      .select("id, invoiced, invoiced_invoice_id, invoice_id, invoiced_at")
      .in("id", cleaningTaskIds);

    if (latestTaskError) {
      alert("Could not verify task billing status before finalizing: " + latestTaskError.message);
      return;
    }

    const duplicateTask = (latestTasks || []).find((task) => isTaskAlreadyInvoiced(task));
    if (duplicateTask) {
      alert("One or more selected cleaning tasks are already invoiced. Finalize canceled to prevent duplicate billing.");
      return;
    }
  }

  if (chemicalUsageIds.length) {
    const { data: latestChemicalRows, error: latestChemicalError } = await supabaseClient
      .from("chemical_usage")
      .select("id, invoiced, invoiced_invoice_id, invoice_id, invoiced_at")
      .in("id", chemicalUsageIds);

    if (latestChemicalError) {
      alert("Could not verify chemical billing status before finalizing: " + latestChemicalError.message);
      return;
    }

    const duplicateChemical = (latestChemicalRows || []).find((entry) => isChemicalUsageAlreadyInvoiced(entry));
    if (duplicateChemical) {
      alert("One or more chemical entries are already invoiced. Finalize canceled to prevent duplicate billing.");
      return;
    }
  }

  const { error: invoiceStatusError } = await supabaseClient
    .from("invoices")
    .update({ status: "finalized" })
    .eq("id", currentInvoiceDraft.id);

  if (invoiceStatusError) {
    alert("Could not finalize invoice: " + invoiceStatusError.message);
    return;
  }

  if (cleaningTaskIds.length) {
    const invoicedAt = new Date().toISOString();
    const { error: taskUpdateError } = await supabaseClient
      .from("cleaning_tasks")
      .update({
        invoiced: true,
        invoiced_invoice_id: currentInvoiceDraft.id,
        invoice_id: currentInvoiceDraft.id,
        invoiced_at: invoicedAt,
      })
      .in("id", cleaningTaskIds);

    if (taskUpdateError) {
      alert("Invoice finalized, but linking tasks failed: " + taskUpdateError.message);
      return;
    }
  }

  if (chemicalUsageIds.length) {
    const invoicedAt = new Date().toISOString();
    const { error: chemicalUpdateError } = await supabaseClient
      .from("chemical_usage")
      .update({
        invoiced: true,
        invoiced_invoice_id: currentInvoiceDraft.id,
        invoice_id: currentInvoiceDraft.id,
        invoiced_at: invoicedAt,
      })
      .in("id", chemicalUsageIds);

    if (chemicalUpdateError) {
      alert("Invoice finalized, but linking chemical usage failed: " + chemicalUpdateError.message);
      return;
    }
  }

  currentInvoiceDraft.status = "finalized";
  alert("Invoice finalized and linked billing records were marked as invoiced.");
  await loadData();
}

async function updateInvoiceStatus(invoiceId, status) {
  const normalizedStatus = String(status || "").toLowerCase();
  if (!INVOICE_STATUSES.includes(normalizedStatus)) {
    alert("Invalid invoice status.");
    return;
  }

  const existing = invoices.find((invoice) => invoice.id === invoiceId);

  const { error } = await supabaseClient
    .from("invoices")
    .update({ status: normalizedStatus })
    .eq("id", invoiceId);

  if (error) {
    alert("Could not update invoice status: " + error.message);
    return;
  }

  if (normalizedStatus === "void" && existing && String(existing.status || "").toLowerCase() !== "void") {
    const { error: taskReleaseError } = await supabaseClient
      .from("cleaning_tasks")
      .update({
        invoiced: false,
        invoiced_invoice_id: null,
        invoice_id: null,
        invoiced_at: null,
      })
      .or(`invoice_id.eq.${invoiceId},invoiced_invoice_id.eq.${invoiceId}`);

    if (taskReleaseError) {
      alert("Invoice was voided, but task linkage release failed: " + taskReleaseError.message);
      return;
    }

    const { error: chemicalReleaseError } = await supabaseClient
      .from("chemical_usage")
      .update({
        invoiced: false,
        invoiced_invoice_id: null,
        invoice_id: null,
        invoiced_at: null,
      })
      .or(`invoice_id.eq.${invoiceId},invoiced_invoice_id.eq.${invoiceId}`);

    if (chemicalReleaseError) {
      alert("Invoice was voided, but chemical linkage release failed: " + chemicalReleaseError.message);
      return;
    }
  }

  await loadInvoices();
  await loadCleaningTasks();
  await loadChemicalUsageEntries();
  renderInvoiceHistory();
}

async function openInvoiceDraft(invoiceId) {
  const invoice = invoices.find((row) => row.id === invoiceId);
  if (!invoice) return;

  const { data: items, error } = await supabaseClient
    .from("invoice_items")
    .select("*")
    .eq("invoice_id", invoiceId)
    .order("created_at", { ascending: true });

  if (error) {
    alert("Could not load invoice items: " + error.message);
    return;
  }

  const property = properties.find((item) => normalizePropertyId(item.id) === normalizePropertyId(invoice.property_id));
  currentInvoiceDraft = {
    id: invoice.id,
    invoiceNumber: invoice.invoice_number,
    propertyId: invoice.property_id,
    propertyName: property?.property_name || "",
    clientName: invoice.client_name || "",
    billingCompanyName: property?.billing_company_name || "",
    billingEmail: invoice.billing_email || property?.billing_email || "",
    billingAddress: invoice.billing_address || property?.billing_address || "",
    accountReference: property?.billing_account_reference || "",
    periodStart: invoice.period_start || "",
    periodEnd: invoice.period_end || "",
    invoiceDate: invoice.invoice_date || "",
    dueDate: invoice.due_date || "",
    status: invoice.status || "draft",
    notes: invoice.notes || "",
    paymentTerms: property?.payment_terms || DEFAULT_INVOICE_TERMS,
    taxable: (property?.billing_taxable !== false),
    taxRate: Number(property?.billing_tax_rate || 0),
    includeNonBillableChemicals: false,
    items: (items || []).map((item) => ({
      sourceId: item.chemical_usage_id || item.task_id || null,
      taskId: item.task_id || null,
      chemicalUsageId: item.chemical_usage_id || null,
      description: item.description || "",
      serviceDate: item.service_date || "",
      quantity: Number(item.quantity || 0),
      unit: item.unit || "",
      rate: Number(item.rate || 0),
      amount: Number(item.amount || 0),
      itemType: item.item_type || "manual",
      itemSource: item.item_source || (item.task_id ? INVOICE_ITEM_SOURCES.TASK : item.chemical_usage_id ? INVOICE_ITEM_SOURCES.CHEMICAL : INVOICE_ITEM_SOURCES.MANUAL),
      notes: item.notes || "",
    })),
    subtotal: Number(invoice.subtotal || 0),
    tax: Number(invoice.tax || 0),
    total: Number(invoice.total || 0),
  };

  renderInvoicePreview();
}

function renderInvoiceHistory() {
  if (!invoiceHistoryContainer) return;

  const selectedPropertyId = billingPropertySelect?.value || "";
  const selectedStatus = String(invoiceStatusFilter?.value || "").trim().toLowerCase();

  const rows = invoices
    .filter((invoice) => !selectedPropertyId || normalizePropertyId(invoice.property_id) === normalizePropertyId(selectedPropertyId))
    .filter((invoice) => !selectedStatus || String(invoice.status || "").toLowerCase() === selectedStatus)
    .sort((a, b) => String(b.invoice_date || "").localeCompare(String(a.invoice_date || "")));

  if (!rows.length) {
    invoiceHistoryContainer.innerHTML = `
      <div class="billing-report-sheet">
        <h2 class="billing-report-title">Invoice History</h2>
        <div class="empty">No invoices found for the selected filters.</div>
      </div>
    `;
    return;
  }

  const tableRows = rows.map((invoice) => {
    const propertyName = getPropertyName(invoice.property_id);
    return `
      <tr>
        <td>${escapeHtml(invoice.invoice_number || "")}</td>
        <td>${escapeHtml(propertyName)}</td>
        <td>${escapeHtml(invoice.client_name || "")}</td>
        <td>${invoice.invoice_date || ""}</td>
        <td>${invoice.due_date || ""}</td>
        <td class="billing-report-amount">${toMoney(invoice.total || 0)}</td>
        <td>
          <select onchange="updateInvoiceStatus('${invoice.id}', this.value)">
            ${INVOICE_STATUSES.map((status) => `<option value="${status}" ${String(invoice.status || "draft").toLowerCase() === status ? "selected" : ""}>${status}</option>`).join("")}
          </select>
        </td>
        <td><button type="button" onclick="openInvoiceDraft('${invoice.id}')">Open</button></td>
      </tr>
    `;
  }).join("");

  invoiceHistoryContainer.innerHTML = `
    <div class="billing-report-sheet">
      <h2 class="billing-report-title">Invoice History</h2>
      <table class="billing-report-table">
        <thead>
          <tr>
            <th>Invoice #</th>
            <th>Property</th>
            <th>Client</th>
            <th>Invoice Date</th>
            <th>Due Date</th>
            <th>Total</th>
            <th>Status</th>
            <th>Open</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
    </div>
  `;
}

function printInvoicePreview() {
  runPrintForView("print-view-invoice");
}

function downloadInvoicePdf() {
  runPrintForView("print-view-invoice");
}

async function shareInvoicePreview() {
  if (!currentInvoiceDraft) {
    alert("Generate or open an invoice before sharing.");
    return;
  }

  const invoice = currentInvoiceDraft;
  const lines = [
    `${companyProfile.company_name} Invoice ${invoice.invoiceNumber || "(pending)"}`,
    `Client: ${invoice.clientName || ""}`,
    `Period: ${invoice.periodStart} to ${invoice.periodEnd}`,
    `Total Due: ${toMoney(invoice.total)}`,
    `Due Date: ${invoice.dueDate}`,
  ];

  const body = lines.join("\n");

  if (navigator.share) {
    try {
      await navigator.share({
        title: `Invoice ${invoice.invoiceNumber || ""}`,
        text: body,
      });
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
    }
  }

  const subject = encodeURIComponent(`Invoice ${invoice.invoiceNumber || ""} - ${invoice.clientName || "Client"}`);
  const mailBody = encodeURIComponent(body);
  window.open(`mailto:${encodeURIComponent(invoice.billingEmail || "")}?subject=${subject}&body=${mailBody}`, "_blank");
}

function exportInvoiceCsv() {
  if (!currentInvoiceDraft) {
    alert("Generate or open an invoice before exporting CSV.");
    return;
  }

  const invoice = currentInvoiceDraft;
  const header = ["invoice_number", "property", "client", "service_date", "item_source", "item_type", "description", "quantity", "unit", "rate", "amount", "notes"];
  const rows = invoice.items.map((item) => [
    invoice.invoiceNumber || "",
    invoice.propertyName || getPropertyName(invoice.propertyId),
    invoice.clientName || "",
    item.serviceDate || "",
    item.itemSource || "",
    item.itemType || "",
    item.description || "",
    Number(item.quantity || 0),
    item.unit || "",
    Number(item.rate || 0).toFixed(2),
    Number(item.amount || 0).toFixed(2),
    item.notes || "",
  ]);

  rows.push([invoice.invoiceNumber || "", "", "", "", "", "Subtotal", "", "", "", Number(invoice.subtotal || 0).toFixed(2)]);
  rows.push([invoice.invoiceNumber || "", "", "", "", "", "Tax", "", "", "", Number(invoice.tax || 0).toFixed(2)]);
  rows.push([invoice.invoiceNumber || "", "", "", "", "", "Total", "", "", "", Number(invoice.total || 0).toFixed(2)]);

  const csv = [header, ...rows]
    .map((line) => line.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${invoice.invoiceNumber || "invoice"}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
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
        ${getSafetyCultureTaskActionMarkup(task)}
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
        ${grouped[date].map(renderWeekViewListTaskCard).join("")}
      </div>
    `)
    .join("");
}

function renderWeekViewListTaskCard(task) {
  const taskBillingAmount = getTaskBillingAmount(task);
  const billingContext = getTaskBillingContext(task);
  const guestReadyBilling = billingContext.guestReadyBilling || null;
  const showReconcile = shouldShowReconcileForTask(task);
  const invoiceMarkerClass = task.invoiced ? "invoice-marker-checked" : "invoice-marker-unchecked";
  const status = String(task.status || "Scheduled");
  const isCompleted = status === "Completed";
  const isInProgress = status === "In Progress";
  const taskClass =
    isCompleted
      ? "task-item completed"
      : task.guest_ready
        ? "task-item guestready"
        : task.off_cycle
          ? "task-item offcycle"
          : "task-item";

  const badge =
    isCompleted
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
        <div class="task-title">${getPropertyName(task.property_id)} — ${task.service_date || task.scheduled_date || "Not set"}</div>
        ${showReconcile ? `
        <label class="invoice-marker ${invoiceMarkerClass}">
          <input type="checkbox" ${task.invoiced ? "checked" : ""} onchange="toggleInvoiceMarker('${task.id}')" />
          <span>$ Reconcile</span>
        </label>
        ` : ""}
      </div>
      ${badge}
      ${sameDayBadge}
      <div class="task-line"><small>Task Type: ${task.service_type || "Manual"}</small></div>
      <div class="task-line"><small>Guest Ready: ${isTaskGuestReady(task) ? "Yes" : "No"}</small></div>
      ${taskBillingAmount > 0 ? `<div class="task-line">$${taskBillingAmount}</div>` : ""}
      ${billingLine}
      ${task.check_in_date ? `<div class="task-line"><small>Prior to check-in: ${task.check_in_date}</small></div>` : ""}
      <div class="task-line"><small>Status: ${status}</small></div>
      ${task.notes ? `<div class="task-line"><small>Notes: ${stripManualBillingOverrideTag(task.notes)}</small></div>` : ""}
      ${task.completed_at ? `<div class="task-line"><small>Completed: ${new Date(task.completed_at).toLocaleString()}</small></div>` : ""}
      <div class="task-buttons">
        ${getSafetyCultureTaskActionMarkup(task)}
        <button onclick="openEditCleaning('${task.id}')">Edit</button>
        ${!isCompleted && !isInProgress ? `<button onclick="startCleaningTask('${task.id}')">Start</button>` : ""}
        ${!isCompleted ? `<button onclick="markCleaningComplete('${task.id}')">Complete</button>` : ""}
        <button class="delete-btn" onclick="deleteCleaningTask('${task.id}')">Delete</button>
      </div>
    </div>
  `;
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

  const chemicalOptions = `<option value="">All Chemicals</option>${getChemicalNamesFromUsageEntries()
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
                ${getSafetyCultureTaskActionMarkup(task)}
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
          <div><strong>Billing Company:</strong> ${property.billing_company_name || "Not entered"}</div>
          <div><strong>Billing Email:</strong> ${property.billing_email || "Not entered"}</div>
          <div><strong>Account / Reference:</strong> ${property.billing_account_reference || "Not entered"}</div>
          <div><strong>Address:</strong> ${property.address || "Not entered"}</div>
          <div><strong>SafetyCulture Checklist:</strong> ${property.safetyculture_checklist_url ? "Saved" : "Not entered"}</div>
          <div><strong>Standard Service Day:</strong> ${property.standard_service_day || "Wednesday"}</div>
          <div><strong>Guest Ready Coverage Rule:</strong> ${getCoverageRuleLabel(getCoverageRuleForProperty(property))}</div>
          <div><strong>Billable Guest Ready Charge:</strong> $${Number(property.default_off_cycle_charge ?? 65).toFixed(2)}</div>
          <div><strong>Default Cleaning Rate:</strong> $${Number(property.default_cleaning_rate ?? 0).toFixed(2)}</div>
          <div><strong>Taxable:</strong> ${property.billing_taxable === false ? "No" : "Yes"}</div>
          <div><strong>Tax Rate:</strong> ${Number(property.billing_tax_rate || 0).toFixed(2)}%</div>
          <div><strong>Payment Terms:</strong> ${property.payment_terms || DEFAULT_INVOICE_TERMS}</div>
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

function updateInvoiceDraftField(field, rawValue) {
  if (!currentInvoiceDraft) return;

  if (field === "taxRate") {
    currentInvoiceDraft.taxRate = Number(rawValue || 0);
  } else if (field === "taxable") {
    currentInvoiceDraft.taxable = Boolean(rawValue);
  } else {
    currentInvoiceDraft[field] = rawValue;
  }

  recalculateInvoiceDraftTotals();
  renderInvoicePreview();
}