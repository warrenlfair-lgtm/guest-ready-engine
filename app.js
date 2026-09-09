let properties = [];
let cleaningTasks = [];
let monthCleaningTasks = [];
let reservations = [];
let operationsReminders = [];
let chemicalUsageEntries = [];
let chemicals = [];
let technicians = [];
let invoices = [];
let invoiceItems = [];
let expenses = [];
let appUsers = [];
let propertyContractRevenueHistory = [];
let pipelineJobs = [];
let pipelineApprovals = [];
let propertyContractRevenueHistoryAvailable = true;
let invoicePropertyLabelById = new Map();
let currentInvoiceDraft = null;
let currentInvoiceBatchDrafts = [];

const DEFAULT_COMPANY_PROFILE = {
  company_name: "Guest Ready™",
  tagline: "Powered by Guest Engine™",
  phone_number: "",
  email: "",
  logo_url: "",
  guest_ready_logo_url: "",
  weekend_ready_logo_url: "",
  admin_pin: "1234",
};

const COMPANY_BRANCH_GUEST_READY = "Guest Ready";
const COMPANY_BRANCH_WEEKEND_READY = "Weekend Ready";
const COMPANY_BRANCH_OPTIONS = [COMPANY_BRANCH_GUEST_READY, COMPANY_BRANCH_WEEKEND_READY];
const SERVICE_BRANCH_POOL = "pool";
const SERVICE_BRANCH_LAWN = "lawn";
const SERVICE_BRANCH_MAINTENANCE = "maintenance";
const SERVICE_BRANCH_HOUSEKEEPING = "housekeeping";
const BUSINESS_TIME_ZONE = "America/New_York";
const LAST_AUTO_ICAL_SYNC_STORAGE_KEY = "guestReadyLastAutoIcalSync";
const AUTO_ICAL_SYNC_COOLDOWN_MS = 10 * 60 * 1000;
let activeServiceWorkspace = SERVICE_BRANCH_POOL;
let currentMonthViewYear = new Date().getFullYear();
let currentMonthViewMonth = new Date().getMonth();
let monthBranchFilter = "all";
let draggedMonthTaskId = null;
let pendingMonthTaskMove = null;

let companyProfile = { ...DEFAULT_COMPANY_PROFILE };
let currentSessionUserId = null;
let currentAppRole = null;
let currentAppUserEmail = "";
let dataLoadPromise = null;
let icalSyncPromise = null;
let carryForwardReconciliationPromise = null;
let autoIcalSyncAttemptedUserId = null;
let isPasswordRecoveryFlow = false;

function isAdminUser() {
  return currentAppRole === "admin";
}

function isStaffUser() {
  return currentAppRole === "staff";
}

function isManagerUser() {
  return currentAppRole === "manager";
}

function isOperationalRole() {
  return isStaffUser() || isManagerUser();
}

function requireAdminAccess() {
  if (isAdminUser()) return true;
  alert("Admin access required.");
  return false;
}

function applyRoleBasedInterface() {
  document.querySelectorAll(".admin-only").forEach((element) => {
    element.classList.toggle("hidden", !isAdminUser());
  });
  document.querySelectorAll(".admin-manager-only").forEach((element) => {
    element.classList.toggle("hidden", !(isAdminUser() || isManagerUser()));
  });
  document.querySelectorAll(".staff-only").forEach((element) => {
    element.classList.toggle("hidden", !isStaffUser());
  });
  document.body.classList.toggle("staff-role", isStaffUser());
  document.body.classList.toggle("manager-role", isManagerUser());
  renderMonthAddTaskControl();

  if (isManagerUser() && !["current", "next"].includes(selectedMonthFilter)) {
    selectedMonthFilter = "current";
    if (monthFilterSelect) monthFilterSelect.value = selectedMonthFilter;
  }
  monthFilterSelect?.querySelectorAll('option[value="previous"], option[value="all"]').forEach((option) => {
    option.disabled = isManagerUser();
    option.hidden = isManagerUser();
  });
}

async function loadCurrentAppAccess() {
  const { data, error } = await supabaseClient.rpc("get_current_app_access");
  if (error) throw new Error("Role-based access is not configured. Run supabase_setup_role_based_access.sql.");
  const access = Array.isArray(data) ? data[0] : data;
  const role = String(access?.role || "").toLowerCase();
  if (access?.active !== true || !["admin", "manager", "staff"].includes(role)) return null;
  return { role, email: String(access?.email || "") };
}

function normalizeServiceBranch(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return [SERVICE_BRANCH_POOL, SERVICE_BRANCH_LAWN, SERVICE_BRANCH_MAINTENANCE, SERVICE_BRANCH_HOUSEKEEPING].includes(normalized)
    ? normalized
    : SERVICE_BRANCH_POOL;
}

function getServiceTypeDisplayLabel(value) {
  const serviceType = String(value || "").trim();
  return serviceType === "Lawn Service" ? "Lawn Service" : (serviceType || "Manual");
}

function getServiceBranchLabel(value) {
  const branch = normalizeServiceBranch(value);
  if (branch === SERVICE_BRANCH_LAWN) return "Lawn";
  if (branch === SERVICE_BRANCH_MAINTENANCE) return "Maintenance";
  if (branch === SERVICE_BRANCH_HOUSEKEEPING) return "Housekeeping";
  return "Pool";
}

function getServiceBranchClass(task) {
  return `service-branch-${normalizeServiceBranch(task?.service_branch)}`;
}

function isLawnTask(task) {
  return normalizeServiceBranch(task?.service_branch) === SERVICE_BRANCH_LAWN;
}

function isMaintenanceTask(task) {
  return normalizeServiceBranch(task?.service_branch) === SERVICE_BRANCH_MAINTENANCE;
}

function isHousekeepingTask(task) {
  return normalizeServiceBranch(task?.service_branch) === SERVICE_BRANCH_HOUSEKEEPING;
}

function taskMatchesActiveWorkspace(task) {
  return normalizeServiceBranch(task?.service_branch) === activeServiceWorkspace;
}

function propertySupportsServiceBranch(property, branch = activeServiceWorkspace) {
  if (branch === SERVICE_BRANCH_LAWN) return property?.lawn_service_active === true;
  if (branch === SERVICE_BRANCH_MAINTENANCE) return true;
  if (branch === SERVICE_BRANCH_HOUSEKEEPING) return property?.housekeeping_service_active === true;
  return property?.pool_service_active !== false;
}

function getBusinessDateValue(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function getTaskRescheduleTargetBlockReason(selectedDate) {
  const normalizedDate = normalizeDateKey(selectedDate);
  if (!normalizedDate) return "A valid service date is required.";
  if (normalizedDate < getBusinessDateValue()) return "Tasks cannot be moved into a historical date.";
  return "";
}

function getTaskRescheduleBlockReason(task) {
  if (!(isAdminUser() || isManagerUser())) return "Your role cannot reschedule tasks.";
  if (!task?.id) return "Task not found.";

  const status = String(task.status || "Scheduled").trim().toLowerCase();
  if (!["scheduled", "in progress", "in_progress"].includes(status)) {
    return "Only Scheduled or In Progress tasks can be rescheduled.";
  }
  if (task.completed_at) return "Completed tasks cannot be rescheduled.";
  if (task.invoiced === true || task.invoice_id || task.invoiced_invoice_id) {
    return "Reconciled or invoiced tasks cannot be rescheduled.";
  }
  if (task.same_day_surcharge_reconciled === true || task.same_day_surcharge_invoice_id) {
    return "Reconciled or invoiced tasks cannot be rescheduled.";
  }
  if (isManagerUser() && task.month_reschedule_eligible !== true) {
    return "This task is finalized, reconciled, or otherwise locked.";
  }

  const taskDate = normalizeDateKey(task.service_date || task.scheduled_date);
  if (taskDate && taskDate < getBusinessDateValue()) {
    return "Historical tasks cannot be rescheduled.";
  }
  return "";
}

function canRescheduleTask(task) {
  return getTaskRescheduleBlockReason(task) === "";
}

let editingPropertyId = null;
let selectedCleaningPropertyId = null;
let editingCleaningId = null;
let editingReminderPropertyId = null;
let editingReminderId = null;
let editingChemicalUsageId = null;
let editingChemicalSettingId = null;
let editingTechnicianId = null;
let editingExpenseId = null;
let editingPipelineJobId = null;
let schedulingPipelineJobId = null;
let taskTechnicianSelections = new Map();
let taskWeeklyServiceLevelSelections = new Map();
let cleaningModalInitialState = null;
let deleteCleaningResolver = null;
let isChemicalNameChangeListenerAttached = false;

let selectedPropertyFilter = "";
let selectedPropertyStatusFilter = "active";
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
  SDS: "sds",
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
const EXPENSE_CATEGORIES = [
  "Fuel", "Vehicle", "Equipment", "Supplies", "Insurance", "Software",
  "Advertising", "Disposal / Dump Fees", "Subcontractor", "Office", "Other",
];
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

const authGate = document.getElementById("authGate");
const appShell = document.getElementById("appShell");
const loginForm = document.getElementById("loginForm");
const loginEmail = document.getElementById("loginEmail");
const loginPassword = document.getElementById("loginPassword");
const signInBtn = document.getElementById("signInBtn");
const forgotPasswordBtn = document.getElementById("forgotPasswordBtn");
const authMessage = document.getElementById("authMessage");
const passwordRecoveryForm = document.getElementById("passwordRecoveryForm");
const newPasswordInput = document.getElementById("newPassword");
const confirmNewPasswordInput = document.getElementById("confirmNewPassword");
const updatePasswordBtn = document.getElementById("updatePasswordBtn");
const passwordRecoveryMessage = document.getElementById("passwordRecoveryMessage");
const signOutBtn = document.getElementById("signOutBtn");

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
const propertyGateAccessInstructions = document.getElementById("propertyGateAccessInstructions");
const propertyServiceNotes = document.getElementById("propertyServiceNotes");
const propertyEquipmentServiceInfo = document.getElementById("propertyEquipmentServiceInfo");
const propertyIcal = document.getElementById("propertyIcal");
const staffTaskPropertyDetails = document.getElementById("staffTaskPropertyDetails");
const safetycultureChecklistUrl = document.getElementById("safetycultureChecklistUrl");
const standardDay = document.getElementById("standardDay");
const coverageDays = document.getElementById("coverageDays");
const coverageRule = document.getElementById("coverageRule");
const offCycleCharge = document.getElementById("offCycleCharge");
const propertyWeeklyLaborRate = document.getElementById("propertyWeeklyLaborRate");
const propertyContractRevenueAmount = document.getElementById("propertyContractRevenueAmount");
const propertyContractRateBasis = document.getElementById("propertyContractRateBasis");
const propertyGuestReadyLaborRate = document.getElementById("propertyGuestReadyLaborRate");
const propertyAdditionalLaborRate = document.getElementById("propertyAdditionalLaborRate");
const propertyDefaultCleaningRate = document.getElementById("propertyDefaultCleaningRate");
const propertySameDaySurcharge = document.getElementById("propertySameDaySurcharge");
const propertyTaxable = document.getElementById("propertyTaxable");
const propertyTaxRate = document.getElementById("propertyTaxRate");
const propertyPaymentTerms = document.getElementById("propertyPaymentTerms");
const propertyInvoiceNotes = document.getElementById("propertyInvoiceNotes");
const propertyCompanyBranch = document.getElementById("propertyCompanyBranch");
const propertyStatus = document.getElementById("propertyStatus");
const propertyPoolServiceActive = document.getElementById("propertyPoolServiceActive");
const propertyHousekeepingServiceActive = document.getElementById("propertyHousekeepingServiceActive");
const propertyHousekeepingDefaultCharge = document.getElementById("propertyHousekeepingDefaultCharge");
const propertyHousekeepingLaborAmount = document.getElementById("propertyHousekeepingLaborAmount");
const propertyServiceFrequency = document.getElementById("propertyServiceFrequency");
const propertyBiweeklyAnchorDateRow = document.getElementById("propertyBiweeklyAnchorDateRow");
const propertyBiweeklyAnchorDate = document.getElementById("propertyBiweeklyAnchorDate");
const propertyFrequencyWarning = document.getElementById("propertyFrequencyWarning");
const propertyLawnServiceActive = document.getElementById("propertyLawnServiceActive");
const propertyLawnServiceFrequency = document.getElementById("propertyLawnServiceFrequency");
const propertyLawnServiceDay = document.getElementById("propertyLawnServiceDay");
const propertyLawnBiweeklyAnchorDateRow = document.getElementById("propertyLawnBiweeklyAnchorDateRow");
const propertyLawnBiweeklyAnchorDate = document.getElementById("propertyLawnBiweeklyAnchorDate");
const propertyLawnDefaultCharge = document.getElementById("propertyLawnDefaultCharge");
const propertyLawnLaborAmount = document.getElementById("propertyLawnLaborAmount");

const cleaningDate = document.getElementById("cleaningDate");
const cleaningServiceBranchRow = document.getElementById("cleaningServiceBranchRow");
const cleaningServiceBranch = document.getElementById("cleaningServiceBranch");
const cleaningServiceType = document.getElementById("cleaningServiceType");
const cleaningStatus = document.getElementById("cleaningStatus");
const cleaningTechnician = document.getElementById("cleaningTechnician");
const cleaningCharge = document.getElementById("cleaningCharge");
const cleaningSdsAmount = document.getElementById("cleaningSdsAmount");
const cleaningSdsAmountLabel = document.getElementById("cleaningSdsAmountLabel");
const cleaningLaborAmount = document.getElementById("cleaningLaborAmount");
const cleaningPartsCost = document.getElementById("cleaningPartsCost");
const cleaningWeeklyServiceLevelRow = document.getElementById("cleaningWeeklyServiceLevelRow");
const cleaningWeeklyServiceLevel = document.getElementById("cleaningWeeklyServiceLevel");
const cleaningNotes = document.getElementById("cleaningNotes");
const serviceWorkspaceButtons = Array.from(document.querySelectorAll(".service-workspace-btn"));
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
const carryForwardSummary = document.getElementById("carryForwardSummary");
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
const deleteCleaningModal = document.getElementById("deleteCleaningModal");
const deleteCleaningConfirmInput = document.getElementById("deleteCleaningConfirmInput");
const deleteCleaningCancelBtn = document.getElementById("deleteCleaningCancelBtn");
const deleteCleaningConfirmBtn = document.getElementById("deleteCleaningConfirmBtn");
const deleteCleaningSyncWarning = document.getElementById("deleteCleaningSyncWarning");
const monthMoveTaskModal = document.getElementById("monthMoveTaskModal");
const monthMoveTaskMessage = document.getElementById("monthMoveTaskMessage");
const monthMoveTaskCancelBtn = document.getElementById("monthMoveTaskCancelBtn");
const monthMoveTaskConfirmBtn = document.getElementById("monthMoveTaskConfirmBtn");
const weekTasksContainer = document.getElementById("weekTasks");
const weekTasksCalendarContainer = document.getElementById("weekTasksCalendar");
const weekViewToggleButtons = Array.from(document.querySelectorAll(".week-view-btn"));
const prevMonthBtn = document.getElementById("prevMonthBtn");
const currentMonthBtn = document.getElementById("currentMonthBtn");
const nextMonthBtn = document.getElementById("nextMonthBtn");
const monthCalendarTitle = document.getElementById("monthCalendarTitle");
const monthBranchFilterSelect = document.getElementById("monthBranchFilterSelect");
const monthAddTaskSlot = document.getElementById("monthAddTaskSlot");
const monthTasksCalendarContainer = document.getElementById("monthTasksCalendar");
const cleaningPropertySelect = document.getElementById("cleaningPropertySelect");
const debugTasksBtn = document.getElementById("debugTasksBtn");
const debugTaskCount = document.getElementById("debugTaskCount");
const propertyFilterSelect = document.getElementById("propertyFilterSelect");
const propertyStatusFilterSelect = document.getElementById("propertyStatusFilterSelect");
const monthFilterSelect = document.getElementById("monthFilterSelect");
const weekViewDefaultCheckbox = document.getElementById("weekViewDefault");
const billingReportStartDate = document.getElementById("billingReportStartDate");
const billingReportEndDate = document.getElementById("billingReportEndDate");
const billingReportClientSelect = document.getElementById("billingReportClientSelect");
const billingReportPropertySelect = document.getElementById("billingReportPropertySelect");
const billingReportIncludeNonBillableChemicals = document.getElementById("billingReportIncludeNonBillableChemicals");
const billingReportTaxEnabled = document.getElementById("billingReportTaxEnabled");
const billingCreateInvoiceBtn = document.getElementById("billingCreateInvoiceBtn");
const billingInvoiceHandoffMessage = document.getElementById("billingInvoiceHandoffMessage");
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
const laborReportStartDate = document.getElementById("laborReportStartDate");
const laborReportEndDate = document.getElementById("laborReportEndDate");
const laborReportTechnicianSelect = document.getElementById("laborReportTechnicianSelect");
const laborReportPaymentStatus = document.getElementById("laborReportPaymentStatus");
const laborReportRunBtn = document.getElementById("laborReportRunBtn");
const laborReportPrintBtn = document.getElementById("laborReportPrintBtn");
const laborBackfillBtn = document.getElementById("laborBackfillBtn");
const laborReportContainer = document.getElementById("laborReportContainer");
const servicePnlStartDate = document.getElementById("servicePnlStartDate");
const servicePnlEndDate = document.getElementById("servicePnlEndDate");
const servicePnlPropertySelect = document.getElementById("servicePnlPropertySelect");
const servicePnlModeInputs = Array.from(document.querySelectorAll('input[name="servicePnlMode"]'));
const servicePnlRunBtn = document.getElementById("servicePnlRunBtn");
const servicePnlPrintBtn = document.getElementById("servicePnlPrintBtn");
const servicePnlContainer = document.getElementById("servicePnlContainer");
const addExpenseBtn = document.getElementById("addExpenseBtn");
const expenseLedgerRows = document.getElementById("expenseLedgerRows");
const expenseLedgerSummary = document.getElementById("expenseLedgerSummary");
const expenseStartDate = document.getElementById("expenseStartDate");
const expenseEndDate = document.getElementById("expenseEndDate");
const expenseCategoryFilter = document.getElementById("expenseCategoryFilter");
const expenseBranchFilter = document.getElementById("expenseBranchFilter");
const expensePropertyFilter = document.getElementById("expensePropertyFilter");
const expenseRunFilterBtn = document.getElementById("expenseRunFilterBtn");
const expenseModal = document.getElementById("expenseModal");
const expenseModalTitle = document.getElementById("expenseModalTitle");
const expenseDateInput = document.getElementById("expenseDateInput");
const expenseCategoryInput = document.getElementById("expenseCategoryInput");
const expenseDescriptionInput = document.getElementById("expenseDescriptionInput");
const expenseAmountInput = document.getElementById("expenseAmountInput");
const expenseBranchInput = document.getElementById("expenseBranchInput");
const expensePropertyInput = document.getElementById("expensePropertyInput");
const expenseNotesInput = document.getElementById("expenseNotesInput");
const cancelExpenseBtn = document.getElementById("cancelExpenseBtn");
const saveExpenseBtn = document.getElementById("saveExpenseBtn");
const expenseReportStartDate = document.getElementById("expenseReportStartDate");
const expenseReportEndDate = document.getElementById("expenseReportEndDate");
const expenseReportCategory = document.getElementById("expenseReportCategory");
const expenseReportBranch = document.getElementById("expenseReportBranch");
const expenseReportProperty = document.getElementById("expenseReportProperty");
const expenseReportRunBtn = document.getElementById("expenseReportRunBtn");
const expenseReportPrintBtn = document.getElementById("expenseReportPrintBtn");
const expenseReportContainer = document.getElementById("expenseReportContainer");
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
const guestReadyLogoUrlInput = document.getElementById("guestReadyLogoUrlInput");
const weekendReadyLogoUrlInput = document.getElementById("weekendReadyLogoUrlInput");
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
const technicianNameInput = document.getElementById("technicianNameInput");
const technicianActiveCheckbox = document.getElementById("technicianActiveCheckbox");
const technicianPaidLaborCheckbox = document.getElementById("technicianPaidLaborCheckbox");
const saveTechnicianBtn = document.getElementById("saveTechnicianBtn");
const cancelTechnicianEditBtn = document.getElementById("cancelTechnicianEditBtn");
const technicianSettingsList = document.getElementById("technicianSettingsList");
const technicianSettingsStatus = document.getElementById("technicianSettingsStatus");
const appUsersList = document.getElementById("appUsersList");
const appUsersStatus = document.getElementById("appUsersStatus");
const addPipelineJobBtn = document.getElementById("addPipelineJobBtn");
const pipelineSummary = document.getElementById("pipelineSummary");
const pipelineFilter = document.getElementById("pipelineFilter");
const pipelineJobsList = document.getElementById("pipelineJobsList");
const pipelineJobModal = document.getElementById("pipelineJobModal");
const pipelineJobModalTitle = document.getElementById("pipelineJobModalTitle");
const pipelinePropertyInput = document.getElementById("pipelinePropertyInput");
const pipelineJobTitleInput = document.getElementById("pipelineJobTitleInput");
const pipelineDescriptionInput = document.getElementById("pipelineDescriptionInput");
const pipelineBranchInput = document.getElementById("pipelineBranchInput");
const pipelineRevenueInput = document.getElementById("pipelineRevenueInput");
const pipelinePartsInput = document.getElementById("pipelinePartsInput");
const pipelinePaidLaborInput = document.getElementById("pipelinePaidLaborInput");
const pipelineLaborCostRow = document.getElementById("pipelineLaborCostRow");
const pipelineLaborInput = document.getElementById("pipelineLaborInput");
const pipelineTentativeDateInput = document.getElementById("pipelineTentativeDateInput");
const pipelineStatusInput = document.getElementById("pipelineStatusInput");
const pipelineNotesInput = document.getElementById("pipelineNotesInput");
const pipelineProjectionPreview = document.getElementById("pipelineProjectionPreview");
const closePipelineJobBtn = document.getElementById("closePipelineJobBtn");
const cancelPipelineJobBtn = document.getElementById("cancelPipelineJobBtn");
const savePipelineJobBtn = document.getElementById("savePipelineJobBtn");
const pipelineScheduleModal = document.getElementById("pipelineScheduleModal");
const pipelineScheduleProperty = document.getElementById("pipelineScheduleProperty");
const pipelineScheduleDate = document.getElementById("pipelineScheduleDate");
const pipelineScheduleBranch = document.getElementById("pipelineScheduleBranch");
const pipelineScheduleType = document.getElementById("pipelineScheduleType");
const pipelineScheduleTechnician = document.getElementById("pipelineScheduleTechnician");
const pipelineScheduleNotes = document.getElementById("pipelineScheduleNotes");
const pipelineScheduleCharge = document.getElementById("pipelineScheduleCharge");
const closePipelineScheduleBtn = document.getElementById("closePipelineScheduleBtn");
const cancelPipelineScheduleBtn = document.getElementById("cancelPipelineScheduleBtn");
const confirmPipelineScheduleBtn = document.getElementById("confirmPipelineScheduleBtn");

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
  if (deleteCleaningModal && !deleteCleaningModal.classList.contains("hidden")) {
    event.preventDefault();
    closeDeleteCleaningModal(false);
    return;
  }
  if (cleaningModal?.classList.contains("hidden")) return;
  event.preventDefault();
  closeCleaningModal();
});

if (deleteCleaningModal) {
  deleteCleaningModal.addEventListener("click", (event) => {
    if (event.target === deleteCleaningModal) {
      closeDeleteCleaningModal(false);
    }
  });
}

if (deleteCleaningCancelBtn) {
  deleteCleaningCancelBtn.addEventListener("click", () => closeDeleteCleaningModal(false));
}

if (deleteCleaningConfirmBtn) {
  deleteCleaningConfirmBtn.addEventListener("click", () => closeDeleteCleaningModal(true));
}

if (monthMoveTaskCancelBtn) monthMoveTaskCancelBtn.addEventListener("click", closeMonthMoveTaskModal);
if (monthMoveTaskConfirmBtn) monthMoveTaskConfirmBtn.addEventListener("click", confirmMonthTaskMove);
if (monthMoveTaskModal) {
  monthMoveTaskModal.addEventListener("click", (event) => {
    if (event.target === monthMoveTaskModal) closeMonthMoveTaskModal();
  });
}

if (deleteCleaningConfirmInput) {
  deleteCleaningConfirmInput.addEventListener("input", () => {
    if (!deleteCleaningConfirmBtn) return;
    deleteCleaningConfirmBtn.disabled = deleteCleaningConfirmInput.value !== "DELETE";
  });
}

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

if (cleaningServiceType) {
  cleaningServiceType.addEventListener("change", syncCleaningServiceTypeDependentFields);
}

if (propertyServiceFrequency) {
  propertyServiceFrequency.addEventListener("change", syncPropertyServiceFrequencyDependentFields);
}

if (standardDay) {
  standardDay.addEventListener("change", syncPropertyServiceFrequencyDependentFields);
}

if (propertyBiweeklyAnchorDate) {
  propertyBiweeklyAnchorDate.addEventListener("change", syncPropertyServiceFrequencyDependentFields);
}

if (propertyLawnServiceFrequency) {
  propertyLawnServiceFrequency.addEventListener("change", syncLawnServiceFrequencyDependentFields);
}

serviceWorkspaceButtons.forEach((button) => {
  button.addEventListener("click", () => setActiveServiceWorkspace(button.dataset.serviceWorkspace));
});

cancelReminderBtn.onclick = closeReminderModal;
saveReminderBtn.onclick = saveReminder;
closeAlertDetailBtn.onclick = closeAlertDetail;

const syncAllIcalBtn = document.getElementById("syncAllIcalBtn");
const syncAllStatus = document.getElementById("syncAllStatus");
const calendarSyncIndicator = document.getElementById("calendarSyncIndicator");
if (syncAllIcalBtn) {
  syncAllIcalBtn.addEventListener("click", () => syncAllIcal({ automatic: false }));
}

Array.from(document.querySelectorAll(".quick-btn")).forEach((btn) => {
  btn.addEventListener("click", (e) => setReminderQuickDate(e.target.dataset.option));
});

viewButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    await navigateToView(button.dataset.view);
  });
});

if (addPipelineJobBtn) addPipelineJobBtn.addEventListener("click", () => openPipelineJobModal());
if (pipelineFilter) pipelineFilter.addEventListener("change", renderPipeline);
if (pipelinePaidLaborInput) pipelinePaidLaborInput.addEventListener("change", syncPipelineLaborFields);
[pipelineRevenueInput, pipelinePartsInput, pipelineLaborInput].forEach((input) => {
  input?.addEventListener("input", renderPipelineProjectionPreview);
});
if (closePipelineJobBtn) closePipelineJobBtn.addEventListener("click", closePipelineJobModal);
if (cancelPipelineJobBtn) cancelPipelineJobBtn.addEventListener("click", closePipelineJobModal);
if (savePipelineJobBtn) savePipelineJobBtn.addEventListener("click", savePipelineJob);
if (closePipelineScheduleBtn) closePipelineScheduleBtn.addEventListener("click", closePipelineScheduleModal);
if (cancelPipelineScheduleBtn) cancelPipelineScheduleBtn.addEventListener("click", closePipelineScheduleModal);
if (confirmPipelineScheduleBtn) confirmPipelineScheduleBtn.addEventListener("click", approveAndSchedulePipelineJob);
if (pipelineScheduleBranch) {
  pipelineScheduleBranch.addEventListener("change", () => {
    if (pipelineScheduleBranch.value === SERVICE_BRANCH_LAWN) pipelineScheduleType.value = "Lawn Service";
    if (pipelineScheduleBranch.value !== SERVICE_BRANCH_LAWN && pipelineScheduleType.value === "Lawn Service") pipelineScheduleType.value = "Manual";
  });
}

propertyFilterSelect.addEventListener("change", (e) => {
  selectedPropertyFilter = e.target.value;
  renderProperties();
});

propertyStatusFilterSelect.addEventListener("change", (e) => {
  selectedPropertyStatusFilter = e.target.value;
  selectedPropertyFilter = "";
  renderProperties();
});

monthFilterSelect.addEventListener("change", async (e) => {
  selectedMonthFilter = isManagerUser() && !["current", "next"].includes(e.target.value)
    ? "current"
    : e.target.value;
  if (isAdminUser()) {
    await ensureWeeklyStandardTasksForMonth(selectedMonthFilter);
    await ensureLawnTasksForMonth(selectedMonthFilter);
  }
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

if (prevMonthBtn) {
  prevMonthBtn.addEventListener("click", async () => {
    currentMonthViewMonth--;
    if (currentMonthViewMonth < 0) {
      currentMonthViewMonth = 11;
      currentMonthViewYear--;
    }
    await loadMonthTasks();
  });
}

if (currentMonthBtn) {
  currentMonthBtn.addEventListener("click", async () => {
    const today = new Date();
    currentMonthViewYear = today.getFullYear();
    currentMonthViewMonth = today.getMonth();
    await loadMonthTasks();
  });
}

if (nextMonthBtn) {
  nextMonthBtn.addEventListener("click", async () => {
    currentMonthViewMonth++;
    if (currentMonthViewMonth > 11) {
      currentMonthViewMonth = 0;
      currentMonthViewYear++;
    }
    await loadMonthTasks();
  });
}

if (monthBranchFilterSelect) {
  monthBranchFilterSelect.addEventListener("change", (e) => {
    monthBranchFilter = e.target.value;
    renderMonthView();
  });
}

function renderMonthAddTaskControl() {
  if (!monthAddTaskSlot) return;
  monthAddTaskSlot.replaceChildren();
  if (!(isAdminUser() || isManagerUser())) return;

  const button = document.createElement("button");
  button.type = "button";
  button.id = "monthAddTaskBtn";
  button.className = "primary-btn";
  button.textContent = "+ Add Task";
  button.addEventListener("click", () => openAddCleaningTaskForDate());
  monthAddTaskSlot.appendChild(button);
}

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

if (billingCreateInvoiceBtn) {
  billingCreateInvoiceBtn.addEventListener("click", createInvoiceFromBillingReport);
}

if (billingReportStartDate) {
  billingReportStartDate.addEventListener("change", () => {
    hideBillingInvoiceHandoffMessage();
    syncInvoiceFiltersFromBillingReport();
    renderBillingReport();
    refreshBillingCard();
    clearCurrentInvoiceDraftState();
  });
}

if (billingReportEndDate) {
  billingReportEndDate.addEventListener("change", () => {
    hideBillingInvoiceHandoffMessage();
    syncInvoiceFiltersFromBillingReport();
    renderBillingReport();
    refreshBillingCard();
    clearCurrentInvoiceDraftState();
  });
}

if (billingReportClientSelect) {
  billingReportClientSelect.addEventListener("change", () => {
    hideBillingInvoiceHandoffMessage();
    syncInvoiceFiltersFromBillingReport();
    renderBillingReport();
    refreshBillingCard();
    clearCurrentInvoiceDraftState();
    renderInvoiceHistory();
  });
}

if (billingReportPropertySelect) {
  billingReportPropertySelect.addEventListener("change", () => {
    syncClientSelectToPropertySelection(billingReportClientSelect, billingReportPropertySelect);
    hideBillingInvoiceHandoffMessage();
    syncInvoiceFiltersFromBillingReport();
    renderBillingReport();
    refreshBillingCard();
    clearCurrentInvoiceDraftState();
    renderInvoiceHistory();
  });
}

if (billingReportIncludeNonBillableChemicals) {
  billingReportIncludeNonBillableChemicals.addEventListener("change", () => {
    hideBillingInvoiceHandoffMessage();
    syncInvoiceFiltersFromBillingReport();
    clearCurrentInvoiceDraftState();
  });
}

if (billingReportTaxEnabled) {
  billingReportTaxEnabled.addEventListener("change", () => {
    hideBillingInvoiceHandoffMessage();
    syncInvoiceFiltersFromBillingReport();
    clearCurrentInvoiceDraftState();
  });
}

if (billingStartDate) {
  billingStartDate.addEventListener("change", renderBillingReport);
  billingStartDate.addEventListener("change", refreshBillingCard);
  billingStartDate.addEventListener("change", () => {
    hideBillingInvoiceHandoffMessage();
    syncBillingReportFiltersFromInvoices();
    clearCurrentInvoiceDraftState();
  });
}

if (billingEndDate) {
  billingEndDate.addEventListener("change", renderBillingReport);
  billingEndDate.addEventListener("change", refreshBillingCard);
  billingEndDate.addEventListener("change", () => {
    hideBillingInvoiceHandoffMessage();
    syncBillingReportFiltersFromInvoices();
    clearCurrentInvoiceDraftState();
  });
}

if (billingClientSelect) {
  billingClientSelect.addEventListener("change", () => {
    hideBillingInvoiceHandoffMessage();
    syncBillingReportFiltersFromInvoices();
    renderBillingReport();
    refreshBillingCard();
    clearCurrentInvoiceDraftState();
    renderInvoiceHistory();
  });
}

if (billingPropertySelect) {
  billingPropertySelect.addEventListener("change", renderBillingReport);
  billingPropertySelect.addEventListener("change", refreshBillingCard);
}

if (billingPropertySelect) {
  billingPropertySelect.addEventListener("change", () => {
    syncClientSelectToPropertySelection(billingClientSelect, billingPropertySelect);
    hideBillingInvoiceHandoffMessage();
    syncBillingReportFiltersFromInvoices();
    clearCurrentInvoiceDraftState();
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
    hideBillingInvoiceHandoffMessage();
    syncBillingReportFiltersFromInvoices();
    if (!currentInvoiceDraft && !currentInvoiceBatchDrafts.length) return;
    generateInvoicePreviewFromFilters();
  });
}

if (invoiceTaxEnabled) {
  invoiceTaxEnabled.addEventListener("change", () => {
    hideBillingInvoiceHandoffMessage();
    syncBillingReportFiltersFromInvoices();
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

if (laborReportRunBtn) {
  laborReportRunBtn.addEventListener("click", renderLaborReport);
}

if (laborReportStartDate) {
  laborReportStartDate.addEventListener("change", renderLaborReport);
}

if (laborReportEndDate) {
  laborReportEndDate.addEventListener("change", renderLaborReport);
}

if (laborReportTechnicianSelect) {
  laborReportTechnicianSelect.addEventListener("change", renderLaborReport);
}

if (laborReportPaymentStatus) {
  laborReportPaymentStatus.addEventListener("change", renderLaborReport);
}

if (laborReportPrintBtn) {
  laborReportPrintBtn.addEventListener("click", printLaborReport);
}

if (laborBackfillBtn) {
  laborBackfillBtn.addEventListener("click", runHistoricalLaborBackfill);
}

if (servicePnlRunBtn) {
  servicePnlRunBtn.addEventListener("click", renderServicePnlReport);
}

[servicePnlStartDate, servicePnlEndDate, servicePnlPropertySelect].forEach((control) => {
  if (control) control.addEventListener("change", renderServicePnlReport);
});

if (servicePnlPrintBtn) {
  servicePnlPrintBtn.addEventListener("click", printServicePnlReport);
}
servicePnlModeInputs.forEach((input) => input.addEventListener("change", renderServicePnlReport));

if (addExpenseBtn) addExpenseBtn.addEventListener("click", () => openExpenseModal());
if (cancelExpenseBtn) cancelExpenseBtn.addEventListener("click", closeExpenseModal);
if (saveExpenseBtn) saveExpenseBtn.addEventListener("click", saveExpense);
if (expenseRunFilterBtn) expenseRunFilterBtn.addEventListener("click", renderExpenseLedger);
if (expenseReportRunBtn) expenseReportRunBtn.addEventListener("click", renderExpenseReport);
if (expenseReportPrintBtn) expenseReportPrintBtn.addEventListener("click", () => runPrintForView("print-view-expense-report"));
if (expenseModal) {
  expenseModal.addEventListener("click", (event) => {
    if (event.target === expenseModal) closeExpenseModal();
  });
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

if (saveTechnicianBtn) {
  saveTechnicianBtn.addEventListener("click", saveTechnician);
}

if (cancelTechnicianEditBtn) {
  cancelTechnicianEditBtn.addEventListener("click", resetTechnicianSettingsForm);
}

if (companyLogoUrlInput) {
  companyLogoUrlInput.addEventListener("input", () => {
    renderCompanyLogoPreview(companyLogoUrlInput.value);
  });
}

if (uploadCompanyLogoBtn) {
  uploadCompanyLogoBtn.addEventListener("click", uploadCompanyLogo);
}

if (loginForm) {
  loginForm.addEventListener("submit", handleLoginSubmit);
}

if (forgotPasswordBtn) {
  forgotPasswordBtn.addEventListener("click", handleForgotPasswordClick);
}

if (passwordRecoveryForm) {
  passwordRecoveryForm.addEventListener("submit", handlePasswordRecoverySubmit);
}

if (signOutBtn) {
  signOutBtn.addEventListener("click", handleSignOutClick);
}

initializeWeekViewMode();
initializeBillingReportFilters();
initializeRouteFragmentationFilters();
initializeLaborReportFilters();
initializeServicePnlFilters();
initializeChemicalReportFilters();
initializeMessagesDefaults();
initializeChemicalSettingsForm();
initializeChemicalUsageOptions();
initializeAuthGate();

function setAuthLoading(isLoading) {
  if (!signInBtn) return;
  signInBtn.disabled = isLoading;
  signInBtn.textContent = isLoading ? "Signing In..." : "Sign In";
}

function setAuthMessage(message, type = "error") {
  if (!authMessage) return;
  const normalized = String(message || "").trim();
  if (!normalized) {
    authMessage.textContent = "";
    authMessage.classList.add("hidden");
    authMessage.classList.remove("error", "success");
    return;
  }

  authMessage.textContent = normalized;
  authMessage.classList.remove("hidden", "error", "success");
  authMessage.classList.add(type === "success" ? "success" : "error");
}

function setPasswordRecoveryMessage(message, type = "error") {
  if (!passwordRecoveryMessage) return;
  const normalized = String(message || "").trim();
  passwordRecoveryMessage.textContent = normalized;
  passwordRecoveryMessage.classList.toggle("hidden", !normalized);
  passwordRecoveryMessage.classList.remove("error", "success");
  if (normalized) passwordRecoveryMessage.classList.add(type === "success" ? "success" : "error");
}

function setPasswordRecoveryLoading(isLoading) {
  if (!updatePasswordBtn) return;
  updatePasswordBtn.disabled = isLoading;
  updatePasswordBtn.textContent = isLoading ? "Updating Password..." : "Update Password";
}

function showLoginScreen() {
  isPasswordRecoveryFlow = false;
  if (authGate) authGate.classList.remove("hidden");
  if (appShell) appShell.classList.add("hidden");
  if (signOutBtn) signOutBtn.classList.add("hidden");
  loginForm?.classList.remove("hidden");
  passwordRecoveryForm?.classList.add("hidden");
}

function showPasswordRecoveryScreen() {
  isPasswordRecoveryFlow = true;
  if (authGate) authGate.classList.remove("hidden");
  if (appShell) appShell.classList.add("hidden");
  if (signOutBtn) signOutBtn.classList.add("hidden");
  loginForm?.classList.add("hidden");
  passwordRecoveryForm?.classList.remove("hidden");
  setAuthMessage("");
  setPasswordRecoveryMessage("");
  setPasswordRecoveryLoading(false);
  if (newPasswordInput) newPasswordInput.value = "";
  if (confirmNewPasswordInput) confirmNewPasswordInput.value = "";
  newPasswordInput?.focus();
}

function showAppScreen() {
  if (authGate) authGate.classList.add("hidden");
  if (appShell) appShell.classList.remove("hidden");
  if (signOutBtn) signOutBtn.classList.remove("hidden");
}

async function ensureDataLoadedForUser(userId) {
  if (!userId) return;
  if (currentSessionUserId === userId) return dataLoadPromise || undefined;
  if (dataLoadPromise) return dataLoadPromise;

  currentSessionUserId = userId;
  dataLoadPromise = loadData()
    .catch((error) => {
      currentSessionUserId = null;
      throw error;
    })
    .finally(() => {
      dataLoadPromise = null;
    });

  return dataLoadPromise;
}

async function applySessionState(session) {
  if (!session?.user?.id) {
    currentSessionUserId = null;
    currentAppRole = null;
    currentAppUserEmail = "";
    showLoginScreen();
    return;
  }

  const access = await loadCurrentAppAccess();
  if (!access) {
    currentSessionUserId = null;
    currentAppRole = null;
    currentAppUserEmail = "";
    await supabaseClient.auth.signOut();
    showLoginScreen();
    setAuthMessage("Your account is not assigned an active Guest Ready Engine role. Contact an administrator.", "error");
    return;
  }

  currentAppRole = access.role;
  currentAppUserEmail = access.email;
  applyRoleBasedInterface();
  showAppScreen();
  await ensureDataLoadedForUser(session.user.id);
  void maybeStartAutoIcalSync(session.user.id);
}

async function initializeAuthGate() {
  showLoginScreen();
  setAuthLoading(false);
  setAuthMessage("");

  supabaseClient.auth.onAuthStateChange(handleAuthStateChange);

  const { data, error } = await supabaseClient.auth.getSession();
  if (error) {
    setAuthMessage(error.message || "Could not restore your session.", "error");
    showLoginScreen();
    return;
  }

  if (isPasswordRecoveryFlow) return;

  const queryParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const callbackError = queryParams.get("error_description") || hashParams.get("error_description")
    || queryParams.get("error") || hashParams.get("error");
  if (callbackError) {
    setAuthMessage(`Password reset link is invalid or expired. ${callbackError.replace(/\+/g, " ")}`, "error");
    showLoginScreen();
    return;
  }

  try {
    await applySessionState(data?.session || null);
  } catch (applyError) {
    setAuthMessage(applyError?.message || "Could not load application data.", "error");
    showLoginScreen();
  }
}

function handleAuthStateChange(event, session) {
  if (event === "PASSWORD_RECOVERY") {
    showPasswordRecoveryScreen();
    return;
  }

  if (event === "SIGNED_OUT") {
    currentSessionUserId = null;
    currentAppRole = null;
    currentAppUserEmail = "";
    autoIcalSyncAttemptedUserId = null;
    if (loginPassword) loginPassword.value = "";
    setAuthLoading(false);
    setAuthMessage("");
    showLoginScreen();
    return;
  }

  if (isPasswordRecoveryFlow) return;

  if (session?.user?.id) {
    setAuthLoading(false);
    setAuthMessage("");
    applySessionState(session).catch((error) => {
      setAuthMessage(error?.message || "Could not load application data.", "error");
      showLoginScreen();
    });
  }
}

async function handleLoginSubmit(event) {
  event.preventDefault();

  const email = String(loginEmail?.value || "").trim();
  const password = String(loginPassword?.value || "");

  if (!email || !password) {
    setAuthMessage("Enter both email and password.", "error");
    return;
  }

  setAuthMessage("");
  setAuthLoading(true);

  const { error } = await supabaseClient.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    setAuthLoading(false);
    setAuthMessage(error.message || "Sign in failed.", "error");
    return;
  }
}

async function handleForgotPasswordClick() {
  const email = String(loginEmail?.value || "").trim();
  if (!email) {
    setAuthMessage("Enter your email first, then click Forgot Password.", "error");
    return;
  }

  setAuthMessage("");

  const redirectTo = `${window.location.origin}`;
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo });

  if (error) {
    setAuthMessage(error.message || "Could not send reset email.", "error");
    return;
  }

  setAuthMessage("Password reset email sent. Check your inbox.", "success");
}

async function handleSignOutClick() {
  setAuthMessage("");
  const { error } = await supabaseClient.auth.signOut();
  if (error) {
    setAuthMessage(error.message || "Sign out failed.", "error");
    return;
  }

  currentSessionUserId = null;
  if (loginPassword) loginPassword.value = "";
  showLoginScreen();
}

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

function setActiveServiceWorkspace(branch) {
  activeServiceWorkspace = normalizeServiceBranch(branch);
  selectedPropertyFilter = "";
  serviceWorkspaceButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.serviceWorkspace === activeServiceWorkspace);
  });

  const isLawn = activeServiceWorkspace === SERVICE_BRANCH_LAWN;
  const isMaintenance = activeServiceWorkspace === SERVICE_BRANCH_MAINTENANCE;
  const isHousekeeping = activeServiceWorkspace === SERVICE_BRANCH_HOUSEKEEPING;
  const workspaceLabel = isLawn ? "Lawn" : isMaintenance ? "Maintenance" : isHousekeeping ? "Housekeeping" : "Pool Service";
  const todayHeader = document.querySelector("#todayView .view-header");
  const weekHeader = document.querySelector("#weekView .view-header");
  const propertiesHeader = document.querySelector("#propertiesView .view-header");
  if (todayHeader) todayHeader.innerHTML = `<h2>${workspaceLabel} Today</h2><p>${workspaceLabel} tasks due today for technicians.</p>`;
  if (weekHeader) weekHeader.querySelector("h2").textContent = `${workspaceLabel} Week`;
  if (weekHeader) weekHeader.querySelector("p").textContent = `${workspaceLabel} tasks due in the next 7 days grouped by date.`;
  if (propertiesHeader) propertiesHeader.querySelector("p").textContent = `Manage ${workspaceLabel} properties and tasks.`;

  document.querySelector(".top-actions")?.classList.toggle("hidden", activeServiceWorkspace !== SERVICE_BRANCH_POOL);
  renderTaskViews();
  if (isAdminUser()) renderProperties();
}

function showView(viewName) {
  if (isStaffUser() && !["today", "week", "month"].includes(viewName)) {
    viewName = "today";
  }
  if (isManagerUser() && !["today", "week", "month", "properties"].includes(viewName)) {
    viewName = "today";
  }

  document.querySelectorAll(".view-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `${viewName}View`);
  });

  document.querySelectorAll(".view-btn").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === viewName);
  });

  if (viewName === "month") {
    renderMonthView();
  }

  if (viewName === "billing") {
    renderBillingReport();
  }

  if (viewName === "invoices") {
    renderInvoicePreview();
    renderInvoiceBatchPreview();
    renderInvoiceHistory();
  }

  if (viewName === "pipeline") {
    renderPipeline();
  }

  if (viewName === "routeFragmentation") {
    renderRouteFragmentationAnalytics();
  }

  if (viewName === "laborReport") {
    populateLaborReportTechnicianOptions();
    renderLaborReport();
  }

  if (viewName === "servicePnl") {
    populateServicePnlPropertyOptions();
    renderServicePnlReport();
  }

  if (viewName === "expenses") {
    populateExpenseControls();
    renderExpenseLedger();
  }

  if (viewName === "expenseReport") {
    populateExpenseControls();
    renderExpenseReport();
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
  if (normalizeServiceBranch(task?.service_branch) !== SERVICE_BRANCH_POOL) return "";
  const checklistUrl = getTaskSafetyCultureUrl(task);
  if (checklistUrl) {
    return `<button type="button" class="checklist-link-btn" onclick="openSafetyCultureChecklistForTask('${task.id}')">Open SafetyCulture Checklist</button>`;
  }
  return `<div class="task-checklist-hint">No checklist link assigned.</div>`;
}

function getStaffOperationalTaskMarkup(task) {
  if (!isOperationalRole()) return "";
  const property = getPropertyById(task.property_id);
  return `
    <div class="task-line"><strong>Address:</strong> ${escapeHtml(property?.address || "Not entered")}</div>
    ${property?.gate_access_instructions ? `<div class="task-line"><strong>Access:</strong> ${escapeHtml(property.gate_access_instructions)}</div>` : ""}
    ${property?.service_notes ? `<div class="task-line"><strong>Service Notes:</strong> ${escapeHtml(property.service_notes)}</div>` : ""}
    ${property?.equipment_service_info ? `<div class="task-line"><strong>Equipment:</strong> ${escapeHtml(property.equipment_service_info)}</div>` : ""}
    ${task?.notes ? `<div class="task-line"><strong>Task Notes:</strong> ${escapeHtml(stripManualBillingOverrideTag(task.notes))}</div>` : ""}
  `;
}

function applyTaskModalRole(task) {
  const staffMode = isStaffUser();
  const managerMode = isManagerUser();
  const branchEditorMode = managerMode || (isAdminUser() && Boolean(task));
  document.querySelectorAll("#cleaningModal .admin-task-field").forEach((element) => {
    element.classList.toggle("role-restricted-hidden", staffMode || managerMode);
  });
  document.querySelectorAll("#cleaningModal .staff-readonly-field").forEach((element) => {
    if ("disabled" in element) element.disabled = staffMode || (managerMode && Boolean(task));
  });
  if (cleaningWeeklyServiceLevel) cleaningWeeklyServiceLevel.disabled = staffMode;
  if (cleaningNotes) cleaningNotes.disabled = staffMode;
  if (cleaningTechnician) cleaningTechnician.disabled = staffMode;
  if (cleaningStatus) cleaningStatus.disabled = staffMode || managerMode;
  if (cleaningDate && task) cleaningDate.disabled = staffMode || !canRescheduleTask(task);
  if (cleaningServiceBranchRow) cleaningServiceBranchRow.classList.toggle("hidden", !branchEditorMode);
  if (cleaningServiceBranch) cleaningServiceBranch.disabled = staffMode || (Boolean(task) && !canRescheduleTask(task));
  if (saveCleaningBtn) saveCleaningBtn.classList.toggle("role-restricted-hidden", staffMode);
  cleaningModal?.querySelector(".chemical-usage-section")?.classList.remove("role-restricted-hidden");

  if (staffTaskPropertyDetails) {
    const property = getPropertyById(task?.property_id || selectedCleaningPropertyId);
    const operationalMode = staffMode || managerMode;
    staffTaskPropertyDetails.classList.toggle("hidden", !operationalMode);
    staffTaskPropertyDetails.innerHTML = operationalMode ? `
      <h3>${escapeHtml(property?.property_name || "Property")}</h3>
      <div><strong>Address:</strong> ${escapeHtml(property?.address || "Not entered")}</div>
      ${property?.gate_access_instructions ? `<div><strong>Gate / Access:</strong> ${escapeHtml(property.gate_access_instructions)}</div>` : ""}
      ${property?.service_notes ? `<div><strong>Service Notes:</strong> ${escapeHtml(property.service_notes)}</div>` : ""}
      ${property?.equipment_service_info ? `<div><strong>Equipment / Service:</strong> ${escapeHtml(property.equipment_service_info)}</div>` : ""}
    ` : "";
  }
}

function renderCleaningSafetyCultureAccess() {
  if (!openSafetyCultureChecklistBtn || !cleaningChecklistHint) return;
  const isPool = normalizeServiceBranch(getCurrentCleaningTask()?.service_branch || activeServiceWorkspace) === SERVICE_BRANCH_POOL;
  cleaningModal?.querySelector(".task-checklist-access-row")?.classList.toggle("hidden", !isPool);
  cleaningModal?.querySelector(".chemical-usage-section")?.classList.toggle("hidden", !isPool);
  if (!isPool) return;

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
  return cleaningTasks.find((task) => task.id === editingCleaningId)
    || monthCleaningTasks.find((task) => task.id === editingCleaningId)
    || null;
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
  syncBillingReportFiltersFromInvoices();

  if (billingReconciledOnly) {
    billingReconciledOnly.checked = true;
  }

  if (invoiceIncludeNonBillableChemicals) {
    invoiceIncludeNonBillableChemicals.checked = false;
  }

  if (invoiceTaxEnabled) {
    invoiceTaxEnabled.value = "property";
  }

  syncBillingReportFiltersFromInvoices();
}

function initializeRouteFragmentationFilters() {
  if (!routeFragStartDate || !routeFragEndDate) return;

  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);

  routeFragStartDate.value = formatDateValue(monthStart);
  routeFragEndDate.value = formatDateValue(monthEnd);
}

function initializeLaborReportFilters() {
  if (!laborReportStartDate || !laborReportEndDate) return;

  const today = new Date();
  const day = today.getDay();
  const mondayOffset = (day + 6) % 7;
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - mondayOffset);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);

  laborReportStartDate.value = formatDateValue(weekStart);
  laborReportEndDate.value = formatDateValue(weekEnd);
  if (laborReportPaymentStatus && !laborReportPaymentStatus.value) {
    laborReportPaymentStatus.value = "unpaid";
  }
}

function initializeServicePnlFilters() {
  if (!servicePnlStartDate || !servicePnlEndDate) return;

  const today = new Date();
  servicePnlStartDate.value = formatDateValue(new Date(today.getFullYear(), today.getMonth(), 1));
  servicePnlEndDate.value = formatDateValue(new Date(today.getFullYear(), today.getMonth() + 1, 0));
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
  body.classList.remove("print-view-billing", "print-view-chemical", "print-view-invoice", "print-view-labor", "print-view-service-pnl", "print-view-expense-report");
  body.classList.add(viewClassName);
  window.print();
  setTimeout(() => {
    body.classList.remove("print-view-billing", "print-view-chemical", "print-view-invoice", "print-view-labor", "print-view-service-pnl", "print-view-expense-report");
  }, 250);
}

function printBillingReport() {
  runPrintForView("print-view-billing");
}

function printChemicalUsageReport() {
  runPrintForView("print-view-chemical");
}

function printLaborReport() {
  runPrintForView("print-view-labor");
}

function printServicePnlReport() {
  runPrintForView("print-view-service-pnl");
}

function getExpenseDefaultDateRange() {
  const now = new Date();
  return {
    startDate: formatDateValue(new Date(now.getFullYear(), now.getMonth(), 1)),
    endDate: formatDateValue(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
}

function ensureExpenseDateDefaults(startInput, endInput) {
  const defaults = getExpenseDefaultDateRange();
  if (startInput && !startInput.value) startInput.value = defaults.startDate;
  if (endInput && !endInput.value) endInput.value = defaults.endDate;
}

function populateSelectOptions(select, options, firstLabel, selectedValue = "") {
  if (!select) return;
  select.innerHTML = [`<option value="">${escapeHtml(firstLabel)}</option>`]
    .concat(options.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`))
    .join("");
  select.value = options.some((option) => String(option.value) === String(selectedValue)) ? selectedValue : "";
}

function populateExpenseControls() {
  ensureExpenseDateDefaults(expenseStartDate, expenseEndDate);
  ensureExpenseDateDefaults(expenseReportStartDate, expenseReportEndDate);

  const categoryOptions = EXPENSE_CATEGORIES.map((category) => ({ value: category, label: category }));
  const branchOptions = COMPANY_BRANCH_OPTIONS.map((branch) => ({ value: branch, label: branch }));
  const propertyOptions = properties
    .slice()
    .sort((a, b) => String(a.property_name || "").localeCompare(String(b.property_name || "")))
    .map((property) => ({ value: property.id, label: property.property_name || "Unnamed Property" }));
  const propertyFilterOptions = [{ value: "__general__", label: "General Business Expenses" }, ...propertyOptions];

  const controls = [
    [expenseCategoryFilter, categoryOptions, "All Categories"],
    [expenseReportCategory, categoryOptions, "All Categories"],
    [expenseBranchFilter, branchOptions, "All Branches"],
    [expenseReportBranch, branchOptions, "All Branches"],
    [expensePropertyFilter, propertyFilterOptions, "All Properties"],
    [expenseReportProperty, propertyFilterOptions, "All Properties"],
  ];
  controls.forEach(([select, options, label]) => populateSelectOptions(select, options, label, select?.value || ""));

  if (expenseCategoryInput) {
    expenseCategoryInput.innerHTML = categoryOptions.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join("");
  }
  if (expenseBranchInput) {
    expenseBranchInput.innerHTML = branchOptions.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join("");
  }
  if (expensePropertyInput) {
    populateSelectOptions(expensePropertyInput, propertyOptions, "General Business Expense", expensePropertyInput.value || "");
  }
}

function getExpensePropertyLabel(expense) {
  if (!expense?.property_id) return "General Business Expense";
  return getPropertyName(expense.property_id);
}

function getFilteredExpenses({ startDate = "", endDate = "", category = "", branch = "", propertyId = "" } = {}) {
  return expenses
    .filter((expense) => !startDate || normalizeDateKey(expense.expense_date) >= startDate)
    .filter((expense) => !endDate || normalizeDateKey(expense.expense_date) <= endDate)
    .filter((expense) => !category || expense.category === category)
    .filter((expense) => !branch || normalizeCompanyBranch(expense.company_branch) === branch)
    .filter((expense) => {
      if (!propertyId) return true;
      if (propertyId === "__general__") return !expense.property_id;
      return normalizePropertyId(expense.property_id) === normalizePropertyId(propertyId);
    })
    .slice()
    .sort((a, b) => String(b.expense_date || "").localeCompare(String(a.expense_date || "")));
}

function getExpenseLedgerFilters(reportMode = false) {
  return reportMode
    ? {
        startDate: expenseReportStartDate?.value || "",
        endDate: expenseReportEndDate?.value || "",
        category: expenseReportCategory?.value || "",
        branch: expenseReportBranch?.value || "",
        propertyId: expenseReportProperty?.value || "",
      }
    : {
        startDate: expenseStartDate?.value || "",
        endDate: expenseEndDate?.value || "",
        category: expenseCategoryFilter?.value || "",
        branch: expenseBranchFilter?.value || "",
        propertyId: expensePropertyFilter?.value || "",
      };
}

async function loadExpenses() {
  const { data, error } = await supabaseClient
    .from("expenses")
    .select("*")
    .order("expense_date", { ascending: false });

  if (error) {
    expenses = [];
    if (!String(error.message || "").toLowerCase().includes("expenses")) {
      console.warn("Could not load expenses:", error.message);
    }
    return;
  }
  expenses = data || [];
}

function openExpenseModal(expenseId = null) {
  editingExpenseId = expenseId;
  const expense = expenseId ? expenses.find((item) => String(item.id) === String(expenseId)) : null;
  populateExpenseControls();
  if (expenseModalTitle) expenseModalTitle.textContent = expense ? "Edit Expense" : "Add Expense";
  if (expenseDateInput) expenseDateInput.value = normalizeDateKey(expense?.expense_date) || formatDateValue(new Date());
  if (expenseCategoryInput) expenseCategoryInput.value = expense?.category || EXPENSE_CATEGORIES[0];
  if (expenseDescriptionInput) expenseDescriptionInput.value = expense?.description || "";
  if (expenseAmountInput) expenseAmountInput.value = expense ? Number(expense.amount || 0) : "";
  if (expenseBranchInput) expenseBranchInput.value = normalizeCompanyBranch(expense?.company_branch);
  if (expensePropertyInput) expensePropertyInput.value = expense?.property_id || "";
  if (expenseNotesInput) expenseNotesInput.value = expense?.notes || "";
  expenseModal?.classList.remove("hidden");
}

function closeExpenseModal() {
  editingExpenseId = null;
  expenseModal?.classList.add("hidden");
}

async function saveExpense() {
  if (!requireAdminAccess()) return;
  const amount = Number(expenseAmountInput?.value || 0);
  const expenseDateValue = normalizeDateKey(expenseDateInput?.value);
  const description = String(expenseDescriptionInput?.value || "").trim();
  if (!expenseDateValue || !description || !Number.isFinite(amount) || amount <= 0) {
    alert("Expense date, description, and an amount greater than zero are required.");
    return;
  }

  const selectedPropertyId = expensePropertyInput?.value || null;
  const payload = {
    expense_date: expenseDateValue,
    category: EXPENSE_CATEGORIES.includes(expenseCategoryInput?.value) ? expenseCategoryInput.value : "Other",
    description,
    amount,
    company_branch: normalizeCompanyBranch(expenseBranchInput?.value),
    property_id: selectedPropertyId,
    company_id: null,
    notes: String(expenseNotesInput?.value || "").trim() || null,
  };

  const result = editingExpenseId
    ? await supabaseClient.from("expenses").update(payload).eq("id", editingExpenseId)
    : await supabaseClient.from("expenses").insert([payload]);
  if (result.error) {
    alert("Could not save expense: " + result.error.message + "\nRun the expense migration first if needed.");
    return;
  }

  closeExpenseModal();
  await loadExpenses();
  renderExpenseLedger();
  renderExpenseReport();
  renderServicePnlReport();
}

async function deleteExpense(expenseId) {
  if (!requireAdminAccess()) return;
  const expense = expenses.find((item) => String(item.id) === String(expenseId));
  if (!expense || !window.confirm(`Delete ${expense.description} for ${toMoney(expense.amount)}?`)) return;
  const { error } = await supabaseClient.from("expenses").delete().eq("id", expenseId);
  if (error) {
    alert("Could not delete expense: " + error.message);
    return;
  }
  await loadExpenses();
  renderExpenseLedger();
  renderExpenseReport();
  renderServicePnlReport();
}

function renderExpenseLedger() {
  if (!expenseLedgerRows) return;
  const rows = getFilteredExpenses(getExpenseLedgerFilters(false));
  const total = rows.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  if (expenseLedgerSummary) {
    expenseLedgerSummary.innerHTML = `<span>${rows.length} expense${rows.length === 1 ? "" : "s"}</span><strong>${toMoney(total)}</strong>`;
  }
  expenseLedgerRows.innerHTML = rows.length
    ? rows.map((expense) => `
      <tr>
        <td>${escapeHtml(normalizeDateKey(expense.expense_date) || "")}</td>
        <td>${escapeHtml(expense.category || "Other")}</td>
        <td>${escapeHtml(expense.description || "")}</td>
        <td class="route-frag-money">${toMoney(expense.amount)}</td>
        <td>${escapeHtml(normalizeCompanyBranch(expense.company_branch))}</td>
        <td>${escapeHtml(getExpensePropertyLabel(expense))}</td>
        <td>${escapeHtml(expense.notes || "")}</td>
        <td><button type="button" onclick="openExpenseModal('${expense.id}')">Edit</button> <button type="button" class="delete-btn" onclick="deleteExpense('${expense.id}')">Delete</button></td>
      </tr>`).join("")
    : '<tr><td colspan="8">No operating expenses found for these filters.</td></tr>';
}

function getExpenseCategoryTotals(rows) {
  return rows.reduce((totals, expense) => {
    const category = EXPENSE_CATEGORIES.includes(expense.category) ? expense.category : "Other";
    totals[category] = (totals[category] || 0) + Number(expense.amount || 0);
    return totals;
  }, {});
}

function renderExpenseReport() {
  if (!expenseReportContainer) return;
  const filters = getExpenseLedgerFilters(true);
  const rows = getFilteredExpenses(filters);
  const total = rows.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const categoryTotals = getExpenseCategoryTotals(rows);
  const categoryMarkup = EXPENSE_CATEGORIES
    .filter((category) => Number(categoryTotals[category] || 0) > 0)
    .map((category) => `<tr><td>${escapeHtml(category)}</td><td class="route-frag-money">${toMoney(categoryTotals[category])}</td></tr>`)
    .join("");
  const tableRows = rows.length
    ? rows.map((expense) => `<tr><td>${escapeHtml(normalizeDateKey(expense.expense_date) || "")}</td><td>${escapeHtml(expense.category)}</td><td>${escapeHtml(expense.description)}</td><td>${escapeHtml(normalizeCompanyBranch(expense.company_branch))}</td><td>${escapeHtml(getExpensePropertyLabel(expense))}</td><td>${escapeHtml(expense.notes || "")}</td><td class="route-frag-money">${toMoney(expense.amount)}</td></tr>`).join("")
    : '<tr><td colspan="7">No operating expenses found for these filters.</td></tr>';

  expenseReportContainer.innerHTML = `
    <div class="billing-report-sheet expense-report-sheet">
      ${renderBillingReportHeader()}
      <h2 class="billing-report-title">Expense Ledger Report</h2>
      <div class="billing-report-meta">Date Range: ${escapeHtml(filters.startDate || "All")} to ${escapeHtml(filters.endDate || "All")}</div>
      <div class="expense-report-total">Total Operating Expenses: ${toMoney(total)}</div>
      ${categoryMarkup ? `<table class="route-frag-table expense-category-table"><thead><tr><th>Category</th><th>Total</th></tr></thead><tbody>${categoryMarkup}</tbody></table>` : ""}
      <div class="expense-table-wrap"><table class="expense-table"><thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Branch</th><th>Property</th><th>Notes</th><th>Amount</th></tr></thead><tbody>${tableRows}</tbody></table></div>
      ${renderBillingReportFooter()}
    </div>`;
}

async function runHistoricalLaborBackfill() {
  const candidates = cleaningTasks.filter((task) => {
    if (String(task?.status || "").trim().toLowerCase() !== "completed") return false;
    const serviceType = String(task?.service_type || "").trim();
    const isEligibleType = serviceType === "Weekly Standard" || isTaskGuestReady(task);
    if (!isEligibleType) return false;

    const laborRaw = task?.labor_amount;
    if (laborRaw === null || laborRaw === undefined || String(laborRaw).trim() === "") return true;
    const laborNumber = Number(laborRaw);
    return Number.isFinite(laborNumber) && laborNumber <= 0;
  });

  if (!candidates.length) {
    alert("No completed Weekly Standard or Guest Ready tasks need historical labor backfill.");
    return;
  }

  const confirmed = window.confirm(
    `Backfill labor for ${candidates.length} completed task(s) with labor 0/null?\n\nThis updates only labor_amount and labor_calculated_at for Weekly Standard and Guest Ready tasks.`
  );
  if (!confirmed) return;

  if (laborBackfillBtn) {
    laborBackfillBtn.disabled = true;
    laborBackfillBtn.textContent = "Backfilling...";
  }

  let updatedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const task of candidates) {
    const property = getPropertyById(task.property_id);
    if (!property) {
      skippedCount += 1;
      continue;
    }

    const isWeeklyTask = String(task?.service_type || "").trim() === "Weekly Standard";
    const weeklyServiceLevel = isWeeklyTask
      ? normalizeWeeklyServiceLevel(task?.weekly_service_level)
      : null;

    const calculatedLabor = getLaborAmountForTask({
      ...task,
      weekly_service_level: weeklyServiceLevel,
    }, property);
    if (!Number.isFinite(calculatedLabor)) {
      skippedCount += 1;
      continue;
    }

    const payload = {
      labor_amount: Number(calculatedLabor || 0),
      labor_calculated_at: new Date().toISOString(),
    };
    if (isWeeklyTask) {
      payload.weekly_service_level = weeklyServiceLevel;
    }

    let result = await supabaseClient
      .from("cleaning_tasks")
      .update(payload)
      .eq("id", task.id);

    if (result.error) {
      const message = String(result.error.message || "").toLowerCase();
      if (message.includes("weekly_service_level")) {
        delete payload.weekly_service_level;
        result = await supabaseClient
          .from("cleaning_tasks")
          .update(payload)
          .eq("id", task.id);
      }
    }

    if (result.error) {
      const message = String(result.error.message || "").toLowerCase();
      if (message.includes("labor_calculated_at")) {
        const fallbackPayload = {
          labor_amount: Number(calculatedLabor || 0),
        };
        if (isWeeklyTask && payload.weekly_service_level) {
          fallbackPayload.weekly_service_level = payload.weekly_service_level;
        }
        result = await supabaseClient
          .from("cleaning_tasks")
          .update(fallbackPayload)
          .eq("id", task.id);
      }
    }

    if (result.error) {
      failedCount += 1;
    } else {
      updatedCount += 1;
    }
  }

  if (laborBackfillBtn) {
    laborBackfillBtn.disabled = false;
    laborBackfillBtn.textContent = "Backfill Historical Labor";
  }

  await loadData();
  alert(`Historical labor backfill finished. Updated: ${updatedCount}, Skipped: ${skippedCount}, Failed: ${failedCount}.`);
}

function downloadChemicalUsagePdf() {
  runPrintForView("print-view-chemical");
}

function openAddModal() {
  editingPropertyId = null;
  clearPropertyForm();
  if (activeServiceWorkspace === SERVICE_BRANCH_LAWN) {
    if (propertyPoolServiceActive) propertyPoolServiceActive.value = "no";
    if (propertyLawnServiceActive) propertyLawnServiceActive.value = "yes";
  }
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
  if (propertyGateAccessInstructions) propertyGateAccessInstructions.value = property.gate_access_instructions || "";
  if (propertyServiceNotes) propertyServiceNotes.value = property.service_notes || "";
  if (propertyEquipmentServiceInfo) propertyEquipmentServiceInfo.value = property.equipment_service_info || "";
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
  if (propertyWeeklyLaborRate) propertyWeeklyLaborRate.value = Number(property.weekly_service_labor || 0);
  if (propertyContractRevenueAmount) propertyContractRevenueAmount.value = Number(property.contract_revenue_amount || 0);
  if (propertyContractRateBasis) propertyContractRateBasis.value = normalizeContractRateBasis(property.contract_rate_basis);
  if (propertyGuestReadyLaborRate) propertyGuestReadyLaborRate.value = Number(property.guest_ready_service_labor || 0);
  if (propertyAdditionalLaborRate) propertyAdditionalLaborRate.value = Number(property.additional_cleaning_labor || 0);
  if (propertyDefaultCleaningRate) propertyDefaultCleaningRate.value = Number(property.default_cleaning_rate || 0);
  if (propertySameDaySurcharge) propertySameDaySurcharge.value = Number(property.same_day_surcharge || 0);
  if (propertyTaxable) propertyTaxable.value = property.billing_taxable === false ? "no" : "yes";
  if (propertyTaxRate) propertyTaxRate.value = Number(property.billing_tax_rate || 0);
  if (propertyPaymentTerms) propertyPaymentTerms.value = property.payment_terms || DEFAULT_INVOICE_TERMS;
  if (propertyInvoiceNotes) propertyInvoiceNotes.value = property.invoice_notes || "";
  if (propertyCompanyBranch) propertyCompanyBranch.value = normalizeCompanyBranch(property.company_branch);
  if (propertyStatus) propertyStatus.value = isPropertyActive(property) ? "active" : "inactive";
  if (propertyPoolServiceActive) propertyPoolServiceActive.value = property.pool_service_active === false ? "no" : "yes";
  if (propertyHousekeepingServiceActive) propertyHousekeepingServiceActive.value = property.housekeeping_service_active === true ? "yes" : "no";
  if (propertyHousekeepingDefaultCharge) propertyHousekeepingDefaultCharge.value = Number(property.housekeeping_default_charge || 0);
  if (propertyHousekeepingLaborAmount) propertyHousekeepingLaborAmount.value = Number(property.housekeeping_labor_amount || 0);
  if (propertyServiceFrequency) propertyServiceFrequency.value = getPropertyFrequencyForScheduling(property);
  if (propertyBiweeklyAnchorDate) {
    propertyBiweeklyAnchorDate.value = getBiweeklyAnchorDateForScheduling(property);
  }
  if (propertyLawnServiceActive) propertyLawnServiceActive.value = property.lawn_service_active === true ? "yes" : "no";
  if (propertyLawnServiceFrequency) propertyLawnServiceFrequency.value = normalizeServiceFrequency(property.lawn_service_frequency);
  if (propertyLawnServiceDay) propertyLawnServiceDay.value = property.lawn_service_day || "Wednesday";
  if (propertyLawnBiweeklyAnchorDate) propertyLawnBiweeklyAnchorDate.value = normalizeBiweeklyAnchorDate(property.lawn_biweekly_anchor_date);
  if (propertyLawnDefaultCharge) propertyLawnDefaultCharge.value = Number(property.lawn_default_charge || 0);
  if (propertyLawnLaborAmount) propertyLawnLaborAmount.value = Number(property.lawn_labor_amount || 0);
  syncPropertyServiceFrequencyDependentFields();
  syncLawnServiceFrequencyDependentFields();

  propertyModal.classList.remove("hidden");
}

function closePropertyModal() {
  propertyModal.classList.add("hidden");
}

const SERVICE_FREQUENCY_WEEKLY = "weekly";
const SERVICE_FREQUENCY_BIWEEKLY = "bi_weekly";
const CONTRACT_RATE_BASIS_NONE = "no_contract";
const CONTRACT_RATE_BASIS_MONTHLY = "monthly";
const CONTRACT_RATE_BASIS_WEEKLY = "weekly";

function normalizeContractRateBasis(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === CONTRACT_RATE_BASIS_MONTHLY || normalized === CONTRACT_RATE_BASIS_WEEKLY) {
    return normalized;
  }
  return CONTRACT_RATE_BASIS_NONE;
}

function getContractRateBasisLabel(value) {
  const basis = normalizeContractRateBasis(value);
  if (basis === CONTRACT_RATE_BASIS_MONTHLY) return "Monthly";
  if (basis === CONTRACT_RATE_BASIS_WEEKLY) return "Weekly";
  return "No Contract";
}

function normalizeServiceFrequency(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === SERVICE_FREQUENCY_BIWEEKLY || normalized === "bi-weekly") {
    return SERVICE_FREQUENCY_BIWEEKLY;
  }
  return SERVICE_FREQUENCY_WEEKLY;
}

function getServiceFrequencyLabel(value) {
  return normalizeServiceFrequency(value) === SERVICE_FREQUENCY_BIWEEKLY
    ? "Bi-Weekly"
    : "Weekly";
}

function isPropertyActive(property) {
  return property?.active !== false;
}

function getPropertyStatusLabel(property) {
  return isPropertyActive(property) ? "Active" : "Inactive";
}

function formatIsoDateUtc(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function normalizeBiweeklyAnchorDate(value) {
  const normalized = normalizeDateKey(value);
  return normalized || "";
}

function getPropertyFrequencyForScheduling(property) {
  return normalizeServiceFrequency(property?.service_frequency);
}

function getBiweeklyAnchorDateForScheduling(property) {
  return normalizeBiweeklyAnchorDate(property?.biweekly_anchor_date);
}

function isBiweeklyAnchorAlignedWithStandardDay(anchorDate, standardDayName) {
  const normalizedAnchor = normalizeBiweeklyAnchorDate(anchorDate);
  if (!normalizedAnchor) return true;
  const selectedDay = String(standardDayName || "").trim();
  if (!selectedDay) return true;
  return getDayNameFromDateString(normalizedAnchor) === selectedDay;
}

function syncPropertyServiceFrequencyDependentFields() {
  const frequency = normalizeServiceFrequency(propertyServiceFrequency?.value);
  const isBiweekly = frequency === SERVICE_FREQUENCY_BIWEEKLY;

  if (propertyBiweeklyAnchorDateRow) {
    propertyBiweeklyAnchorDateRow.classList.toggle("hidden", !isBiweekly);
  }

  if (propertyBiweeklyAnchorDate) {
    propertyBiweeklyAnchorDate.required = isBiweekly;
  }

  if (propertyFrequencyWarning) {
    let warning = "";
    const anchorDate = normalizeBiweeklyAnchorDate(propertyBiweeklyAnchorDate?.value);
    if (isBiweekly && anchorDate && !isBiweeklyAnchorAlignedWithStandardDay(anchorDate, standardDay?.value)) {
      warning = "The selected first cleaning date does not match this property's standard service day.";
    }
    propertyFrequencyWarning.textContent = warning;
    propertyFrequencyWarning.classList.toggle("hidden", !warning);
  }
}

function syncLawnServiceFrequencyDependentFields() {
  const isBiweekly = normalizeServiceFrequency(propertyLawnServiceFrequency?.value) === SERVICE_FREQUENCY_BIWEEKLY;
  propertyLawnBiweeklyAnchorDateRow?.classList.toggle("hidden", !isBiweekly);
  if (propertyLawnBiweeklyAnchorDate) propertyLawnBiweeklyAnchorDate.required = isBiweekly;
}

syncPropertyServiceFrequencyDependentFields();
syncLawnServiceFrequencyDependentFields();

function isDateOnBiweeklyCycle(taskDate, anchorDate) {
  const normalizedTaskDate = normalizeDateKey(taskDate);
  const normalizedAnchor = normalizeBiweeklyAnchorDate(anchorDate);
  if (!normalizedTaskDate || !normalizedAnchor) return false;

  const task = parseDateString(normalizedTaskDate);
  const anchor = parseDateString(normalizedAnchor);
  const diffDays = Math.round((task.getTime() - anchor.getTime()) / (1000 * 60 * 60 * 24));
  const mod = ((diffDays % 14) + 14) % 14;
  return mod === 0;
}

function getServiceDatesForMonthByBiweeklyAnchor(anchorDate, monthType) {
  const normalizedAnchor = normalizeBiweeklyAnchorDate(anchorDate);
  if (!normalizedAnchor) return [];

  const now = new Date();
  const monthOffset = getDateOffsetsForMonth(monthType);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthOffset, 1));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthOffset + 1, 0));

  const anchor = parseDateString(normalizedAnchor);
  const cursor = new Date(anchor);
  const dayMs = 1000 * 60 * 60 * 24;

  if (cursor < monthStart) {
    const daysBetween = Math.floor((monthStart.getTime() - cursor.getTime()) / dayMs);
    const intervals = Math.floor(daysBetween / 14);
    cursor.setUTCDate(cursor.getUTCDate() + (intervals * 14));
    while (cursor < monthStart) {
      cursor.setUTCDate(cursor.getUTCDate() + 14);
    }
  }

  const serviceDates = [];
  while (cursor <= monthEnd) {
    serviceDates.push(formatIsoDateUtc(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 14);
  }

  return serviceDates;
}

function getWeeklyGenerationServiceDatesForProperty(property, monthType) {
  const frequency = getPropertyFrequencyForScheduling(property);
  const standardDayName = property?.standard_service_day || "Wednesday";
  if (frequency === SERVICE_FREQUENCY_BIWEEKLY) {
    const anchorDate = getBiweeklyAnchorDateForScheduling(property);
    return getServiceDatesForMonthByBiweeklyAnchor(anchorDate, monthType);
  }
  return getServiceDatesForMonthByDay(standardDayName, monthType);
}

function isTaskDateAlignedWithPropertySchedule(taskDate, propertyLike) {
  const normalizedTaskDate = normalizeDateKey(taskDate);
  if (!normalizedTaskDate) return false;

  const frequency = getPropertyFrequencyForScheduling(propertyLike);
  if (frequency === SERVICE_FREQUENCY_BIWEEKLY) {
    const anchorDate = getBiweeklyAnchorDateForScheduling(propertyLike);
    return isDateOnBiweeklyCycle(normalizedTaskDate, anchorDate);
  }

  const standardDayName = String(propertyLike?.standard_service_day || "Wednesday").trim() || "Wednesday";
  return getDayNameFromDateString(normalizedTaskDate) === standardDayName;
}

function isAutoGeneratedFutureWeeklyTaskCandidate(task, propertyId, fromDate) {
  if (!task || task.property_id !== propertyId) return false;
  if (task.service_type !== "Weekly Standard") return false;
  if (task.completed_at || task.invoiced) return false;
  if (task.manually_modified) return false;

  const status = String(task.status || "").trim().toLowerCase();
  if (status && status !== "scheduled") return false;

  const sourceType = String(task.source_type || "").trim().toLowerCase();
  const sourceKey = String(task.source_key || "").trim().toLowerCase();
  const notes = String(task.notes || "").trim().toLowerCase();
  const isAutoGenerated = sourceType === "weekly_standard"
    && sourceKey.startsWith("wk:")
    && notes.includes("auto-created weekly standard");
  if (!isAutoGenerated) return false;

  const taskDate = normalizeDateKey(task.service_date || task.scheduled_date);
  if (!taskDate || taskDate < fromDate) return false;

  return true;
}

function getFutureAutoWeeklyTasksOutsideSchedule(propertyId, nextSchedule, fromDate) {
  return cleaningTasks.filter((task) => {
    if (!isAutoGeneratedFutureWeeklyTaskCandidate(task, propertyId, fromDate)) {
      return false;
    }

    const taskDate = task.service_date || task.scheduled_date;
    return !isTaskDateAlignedWithPropertySchedule(taskDate, nextSchedule);
  });
}

const WEEKLY_SERVICE_LEVEL_FULL = "full_service";
const WEEKLY_SERVICE_LEVEL_HEALTH = "health_check";

function normalizeWeeklyServiceLevel(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === WEEKLY_SERVICE_LEVEL_HEALTH) return WEEKLY_SERVICE_LEVEL_HEALTH;
  return WEEKLY_SERVICE_LEVEL_FULL;
}

function getWeeklyServiceLevelLabel(level) {
  return normalizeWeeklyServiceLevel(level) === WEEKLY_SERVICE_LEVEL_HEALTH
    ? "Health Check"
    : "Full Service";
}

function getWeeklyServiceLevelForTask(task) {
  if (String(task?.service_type || "").trim() !== "Weekly Standard") return "";

  const selectedLevel = String(taskWeeklyServiceLevelSelections.get(task.id) || "").trim();
  if (selectedLevel) return normalizeWeeklyServiceLevel(selectedLevel);
  return normalizeWeeklyServiceLevel(task?.weekly_service_level);
}

function syncCleaningServiceTypeDependentFields() {
  const isWeeklyTask = String(cleaningServiceType?.value || "").trim() === "Weekly Standard";

  if (cleaningWeeklyServiceLevelRow) {
    cleaningWeeklyServiceLevelRow.classList.toggle("hidden", !isWeeklyTask);
  }

  if (cleaningWeeklyServiceLevel) {
    if (isWeeklyTask) {
      cleaningWeeklyServiceLevel.value = normalizeWeeklyServiceLevel(cleaningWeeklyServiceLevel.value || WEEKLY_SERVICE_LEVEL_FULL);
    } else {
      cleaningWeeklyServiceLevel.value = WEEKLY_SERVICE_LEVEL_FULL;
    }
  }
}

function populateCleaningPropertySelect(selectedPropertyId = null) {
  if (!cleaningPropertySelect) return;
  const activeProps = properties
    .filter((p) => isPropertyActive(p))
    .sort((a, b) => (a.property_name || "").localeCompare(b.property_name || ""));

  cleaningPropertySelect.innerHTML = activeProps
    .map((p) => `<option value="${p.id}">${escapeHtml(p.property_name)}</option>`)
    .join("");

  if (selectedPropertyId && activeProps.some((p) => p.id === selectedPropertyId)) {
    cleaningPropertySelect.value = selectedPropertyId;
  } else if (activeProps.length > 0) {
    cleaningPropertySelect.value = activeProps[0].id;
  }
}

function openCleaningModal(propertyId = null, prefilledDate = null) {
  if (isStaffUser()) return;
  const activeProps = properties.filter((p) => isPropertyActive(p));
  const fallbackPropertyId = activeProps.length > 0 ? activeProps[0].id : (properties.length > 0 ? properties[0].id : null);

  selectedCleaningPropertyId = propertyId || fallbackPropertyId;
  editingCleaningId = null;
  if (cleaningModalTitle) {
    cleaningModalTitle.textContent = "Add Task";
  }

  populateCleaningPropertySelect(selectedCleaningPropertyId);

  cleaningDate.value = prefilledDate || new Date().toISOString().split("T")[0];
  if (cleaningServiceBranch) cleaningServiceBranch.value = activeServiceWorkspace;
  cleaningServiceType.value = activeServiceWorkspace === SERVICE_BRANCH_LAWN
    ? "Lawn Service"
    : activeServiceWorkspace === SERVICE_BRANCH_HOUSEKEEPING
      ? "Housekeeping"
      : "Manual";
  cleaningServiceType.disabled = activeServiceWorkspace !== SERVICE_BRANCH_POOL;
  if (cleaningWeeklyServiceLevel) cleaningWeeklyServiceLevel.value = WEEKLY_SERVICE_LEVEL_FULL;
  cleaningStatus.value = "Scheduled";
  cleaningTechnician.value = "";

  const property = selectedCleaningPropertyId ? properties.find(p => p.id === selectedCleaningPropertyId) : null;
  cleaningCharge.value = activeServiceWorkspace === SERVICE_BRANCH_LAWN && property
    ? Number(property.lawn_default_charge || 0)
    : activeServiceWorkspace === SERVICE_BRANCH_HOUSEKEEPING && property
      ? Number(property.housekeeping_default_charge || 0)
      : 0;
  if (cleaningSdsAmount) {
    if (cleaningSdsAmountLabel) cleaningSdsAmountLabel.classList.add("hidden");
    cleaningSdsAmount.classList.add("hidden");
    cleaningSdsAmount.value = "";
  }
  if (cleaningLaborAmount) {
    cleaningLaborAmount.value = activeServiceWorkspace === SERVICE_BRANCH_HOUSEKEEPING && property
      ? Number(property.housekeeping_labor_amount || 0)
      : "";
  }
  if (cleaningPartsCost) cleaningPartsCost.value = 0;
  cleaningNotes.value = "";
  syncCleaningServiceTypeDependentFields();
  renderCleaningSafetyCultureAccess();
  clearChemicalUsageForm();
  renderChemicalUsageForCurrentTask();
  applyTaskModalRole(null);

  cleaningModal.classList.remove("hidden");
  cleaningModalInitialState = getCleaningModalStateSnapshot();
}

function openManagerManualTaskModal(propertyId) {
  if (!isManagerUser()) return;
  openCleaningModal(propertyId);
  if (cleaningModalTitle) cleaningModalTitle.textContent = "Add Manual Task";
}

function openAddCleaningTaskForDate(dateString = "") {
  if (isStaffUser()) return;
  openCleaningModal(null, dateString || formatDateValue(new Date()));
}

function openEditCleaning(taskId) {
  const task = cleaningTasks.find((t) => t.id === taskId)
    || monthCleaningTasks.find((t) => t.id === taskId);
  if (!task) return;

  editingCleaningId = task.id;
  selectedCleaningPropertyId = task.property_id;
  if (cleaningModalTitle) {
    cleaningModalTitle.textContent = "Edit Task";
  }

  populateCleaningPropertySelect(task.property_id);

  cleaningDate.value = task.service_date || task.scheduled_date || "";
  if (cleaningServiceBranch) cleaningServiceBranch.value = normalizeServiceBranch(task.service_branch);
  cleaningServiceType.value = task.service_type || "Manual";
  cleaningServiceType.disabled = normalizeServiceBranch(task.service_branch) !== SERVICE_BRANCH_POOL;
  if (cleaningWeeklyServiceLevel) {
    cleaningWeeklyServiceLevel.value = normalizeWeeklyServiceLevel(task.weekly_service_level);
  }
  cleaningStatus.value = task.status || "Scheduled";
  cleaningTechnician.value = task.technician || "";
  cleaningCharge.value = task.service_type === "Weekly Standard"
    ? getTaskBillingAmount(task)
    : (task.charge || 0);
  if (cleaningSdsAmount) {
    const isEligibleForSds = isSameDayTurnoverTask(task);
    if (cleaningSdsAmountLabel) cleaningSdsAmountLabel.classList.toggle("hidden", !isEligibleForSds);
    cleaningSdsAmount.classList.toggle("hidden", !isEligibleForSds);
    cleaningSdsAmount.value = isEligibleForSds ? getSdsBillingAmount(task) : "";
  }
  if (cleaningLaborAmount) {
    const hasStoredLabor = task?.labor_amount !== null && task?.labor_amount !== undefined && String(task.labor_amount).trim() !== "";
    cleaningLaborAmount.value = hasStoredLabor ? Number(task.labor_amount || 0) : "";
  }
  if (cleaningPartsCost) cleaningPartsCost.value = Math.max(0, Number(task.parts_cost || 0));
  cleaningNotes.value = stripManualBillingOverrideTag(task.notes || "");
  syncCleaningServiceTypeDependentFields();
  renderCleaningSafetyCultureAccess();
  clearChemicalUsageForm();
  renderChemicalUsageForCurrentTask();
  applyTaskModalRole(task);

  cleaningModal.classList.remove("hidden");
  cleaningModalInitialState = getCleaningModalStateSnapshot();
}

function getCleaningModalStateSnapshot() {
  return {
    propertyId: selectedCleaningPropertyId || "",
    editingTaskId: editingCleaningId || "",
    serviceDate: String(cleaningDate?.value || ""),
    serviceBranch: String(cleaningServiceBranch?.value || ""),
    serviceType: String(cleaningServiceType?.value || ""),
    weeklyServiceLevel: String(cleaningWeeklyServiceLevel?.value || ""),
    status: String(cleaningStatus?.value || ""),
    technician: String(cleaningTechnician?.value || "").trim(),
    charge: String(cleaningCharge?.value || ""),
    laborAmount: String(cleaningLaborAmount?.value || ""),
    partsCost: String(cleaningPartsCost?.value || ""),
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

function isAutoCreatedIcalGuestReadyTask(task) {
  if (!task) return false;
  if (task.service_type !== "Guest Ready") return false;
  if (task.source_type === "reservation_guest_ready") return true;

  const sourceKey = String(task.source_key || "");
  return sourceKey.startsWith("gr:");
}

function closeDeleteCleaningModal(confirmed) {
  if (!deleteCleaningModal) return;

  deleteCleaningModal.classList.add("hidden");
  if (deleteCleaningConfirmInput) {
    deleteCleaningConfirmInput.value = "";
  }
  if (deleteCleaningConfirmBtn) {
    deleteCleaningConfirmBtn.disabled = true;
  }
  if (deleteCleaningSyncWarning) {
    deleteCleaningSyncWarning.classList.add("hidden");
  }

  const resolver = deleteCleaningResolver;
  deleteCleaningResolver = null;
  if (resolver) {
    resolver(Boolean(confirmed));
  }
}

function openDeleteCleaningModal(task) {
  if (!deleteCleaningModal) {
    return Promise.resolve(confirm("Delete this cleaning?"));
  }

  if (deleteCleaningConfirmInput) {
    deleteCleaningConfirmInput.value = "";
  }
  if (deleteCleaningConfirmBtn) {
    deleteCleaningConfirmBtn.disabled = true;
  }

  if (deleteCleaningSyncWarning) {
    const showSyncWarning = isAutoCreatedIcalGuestReadyTask(task);
    deleteCleaningSyncWarning.classList.toggle("hidden", !showSyncWarning);
  }

  deleteCleaningModal.classList.remove("hidden");

  if (deleteCleaningConfirmInput) {
    setTimeout(() => deleteCleaningConfirmInput.focus(), 0);
  }

  return new Promise((resolve) => {
    deleteCleaningResolver = resolve;
  });
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
  await reconcileUnfinishedTaskCarryForward();

  if (isStaffUser()) {
    await loadStaffOperationalData();
    return;
  }
  if (isManagerUser()) {
    await loadManagerOperationalData();
    return;
  }

  await loadCompanyProfile();
  await initializeCompanyLogoUploadSupport();
  await loadProperties();
  await loadPropertyContractRevenueHistory();
  await loadCleaningTasks();
  await loadReservations();
  await loadOperationsReminders();
  await loadChemicals();
  await loadTechnicians();
  await loadAppUsers();
  await loadChemicalUsageEntries();
  await loadInvoices();
  await loadExpenses();
  await loadPipelineJobs();
  await loadPipelineApprovals();
  renderChemicalSettingsSection();
  renderTechnicianSettingsSection();
  initializeChemicalUsageOptions();
  const monthForAutoGeneration = ["current", "next", "previous"].includes(selectedMonthFilter)
    ? selectedMonthFilter
    : "current";
  const generatedWeeklyCount = await ensureWeeklyStandardTasksForMonth(monthForAutoGeneration);
  const generatedLawnCount = await ensureLawnTasksForMonth(monthForAutoGeneration);
  if (generatedWeeklyCount > 0 || generatedLawnCount > 0) {
    await loadCleaningTasks();
  }

  statusMessage.textContent = "";
  renderTaskViews();
  renderProperties();
  renderOperationsRemindersWidget();
  populateLaborReportTechnicianOptions();
  renderLaborReport();
  populateServicePnlPropertyOptions();
  renderServicePnlReport();
  renderBillingReport();
  renderInvoicePreview();
  renderInvoiceBatchPreview();
  renderInvoiceHistory();
  populateExpenseControls();
  renderExpenseLedger();
  renderExpenseReport();
  renderPipeline();
  renderRouteFragmentationAnalytics();
  if (!document.getElementById("chemicalReportWorkspace")?.classList.contains("hidden")) {
    renderChemicalUsageReport();
  }
  renderMessagesPreview();
}

function reconcileUnfinishedTaskCarryForward() {
  if (carryForwardReconciliationPromise) return carryForwardReconciliationPromise;

  carryForwardReconciliationPromise = supabaseClient
    .rpc("reconcile_unfinished_task_carry_forward")
    .then(({ data, error }) => {
      if (error) {
        console.warn("Carry-forward reconciliation unavailable:", error.message);
        return { movedCount: 0, skippedGuestReadyCount: 0, error };
      }

      const result = Array.isArray(data) ? data[0] : data;
      return {
        movedCount: Number(result?.moved_count || 0),
        skippedGuestReadyCount: Number(result?.skipped_guest_ready_count || 0),
        error: null,
      };
    })
    .finally(() => {
      carryForwardReconciliationPromise = null;
    });

  return carryForwardReconciliationPromise;
}

async function loadStaffOperationalData() {
  const [profileResult, propertiesResult, tasksResult, reservationsResult, techniciansResult, chemicalsResult, usageResult] = await Promise.all([
    supabaseClient.from("staff_company_profile").select("*").limit(1).maybeSingle(),
    supabaseClient.from("staff_properties").select("*").order("property_name", { ascending: true }),
    supabaseClient.from("staff_cleaning_tasks").select("*").order("service_date", { ascending: true }),
    supabaseClient.from("staff_reservations").select("*").order("check_in", { ascending: true }),
    supabaseClient.from("staff_technicians").select("*").order("name", { ascending: true }),
    supabaseClient.from("staff_chemicals").select("*").order("name", { ascending: true }),
    supabaseClient.from("staff_chemical_usage").select("*").order("created_at", { ascending: false }),
  ]);

  const failed = [profileResult, propertiesResult, tasksResult, reservationsResult, techniciansResult, chemicalsResult, usageResult]
    .find((result) => result.error);
  if (failed?.error) throw new Error(`Could not load staff workspace: ${failed.error.message}`);

  companyProfile = getNormalizedCompanyProfile(profileResult.data || DEFAULT_COMPANY_PROFILE);
  properties = (propertiesResult.data || []).map((property) => ({ ...property, active: property.active !== false }));
  cleaningTasks = tasksResult.data || [];
  reservations = (reservationsResult.data || []).filter(isReservationActive);
  technicians = techniciansResult.data || [];
  chemicals = chemicalsResult.data || [];
  chemicalUsageEntries = usageResult.data || [];
  operationsReminders = [];
  invoices = [];
  invoiceItems = [];
  expenses = [];
  propertyContractRevenueHistory = [];

  applyCompanyProfileToApp();
  initializeChemicalUsageOptions();
  statusMessage.textContent = "";
  showView("today");
  renderTaskViews();
}

async function loadManagerOperationalData() {
  const [profileResult, propertiesResult, tasksResult, reservationsResult, techniciansResult, remindersResult, chemicalsResult, usageResult] = await Promise.all([
    supabaseClient.from("manager_company_profile").select("*").limit(1).maybeSingle(),
    supabaseClient.from("manager_properties").select("*").order("property_name", { ascending: true }),
    supabaseClient.from("manager_cleaning_tasks").select("*").order("service_date", { ascending: true }),
    supabaseClient.from("manager_reservations").select("*").order("check_in", { ascending: true }),
    supabaseClient.from("manager_technicians").select("*").order("name", { ascending: true }),
    supabaseClient.from("manager_operations_reminders").select("*").order("due_date", { ascending: true }),
    supabaseClient.from("manager_chemicals").select("*").order("name", { ascending: true }),
    supabaseClient.from("manager_chemical_usage").select("*").order("created_at", { ascending: false }),
  ]);

  const failed = [profileResult, propertiesResult, tasksResult, reservationsResult, techniciansResult, remindersResult, chemicalsResult, usageResult]
    .find((result) => result.error);
  if (failed?.error) throw new Error(`Could not load manager workspace: ${failed.error.message}`);

  companyProfile = getNormalizedCompanyProfile(profileResult.data || DEFAULT_COMPANY_PROFILE);
  properties = propertiesResult.data || [];
  cleaningTasks = tasksResult.data || [];
  reservations = (reservationsResult.data || []).filter(isReservationActive);
  technicians = techniciansResult.data || [];
  operationsReminders = remindersResult.data || [];
  chemicals = chemicalsResult.data || [];
  chemicalUsageEntries = usageResult.data || [];
  invoices = [];
  invoiceItems = [];
  expenses = [];
  propertyContractRevenueHistory = [];

  applyCompanyProfileToApp();
  initializeChemicalUsageOptions();
  statusMessage.textContent = "";
  showView("today");
  renderTaskViews();
  renderProperties();
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

  if (isOperationalRole()) {
    if (!selectedChemical?.id) {
      alert("Select an active chemical.");
      return;
    }
    const rolePrefix = isManagerUser() ? "manager" : "staff";
    const { error: operationalSaveError } = await supabaseClient.rpc(`${rolePrefix}_save_chemical_usage`, {
      target_entry_id: editingChemicalUsageId || null,
      target_task_id: task.id,
      selected_chemical_id: selectedChemical.id,
      entered_quantity: quantity,
      entered_unit: unit,
      entered_notes: notes || null,
    });
    if (operationalSaveError) {
      alert("Error saving chemical usage: " + operationalSaveError.message);
      return;
    }
    closeChemicalUsageModal();
    const usageResult = await supabaseClient.from(`${rolePrefix}_chemical_usage`).select("*").order("created_at", { ascending: false });
    if (usageResult.error) {
      alert("Chemical usage saved, but the list could not be refreshed: " + usageResult.error.message);
      return;
    }
    chemicalUsageEntries = usageResult.data || [];
    renderChemicalUsageForCurrentTask();
    return;
  }

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

  if (isOperationalRole()) {
    const rolePrefix = isManagerUser() ? "manager" : "staff";
    const { error: operationalDeleteError } = await supabaseClient.rpc(`${rolePrefix}_delete_chemical_usage`, {
      target_entry_id: entryId,
    });
    if (operationalDeleteError) {
      alert("Error deleting chemical entry: " + operationalDeleteError.message);
      return;
    }
    chemicalUsageEntries = chemicalUsageEntries.filter((entry) => entry.id !== entryId);
    renderChemicalUsageForCurrentTask();
    return;
  }

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
      if (!taskMatchesActiveWorkspace(task)) return false;
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
  return getServiceTypeDisplayLabel(task.service_type);
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
    lines.push(`Hey ${techName}, here is your ${getServiceBranchLabel(activeServiceWorkspace).toLowerCase()} schedule for ${weekLabel}:`);
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

    lines.push(`Please mark each task complete after service and send photos after each ${getServiceBranchLabel(activeServiceWorkspace).toLowerCase()} task.`);

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
    const sourceType = String(task.source_type || "").trim().toLowerCase();
    const sourceKey = String(task.source_key || "").trim().toLowerCase();
    const notes = String(task.notes || "").trim().toLowerCase();
    const hasReservationGuestReadyIdentity = sourceType === "reservation_guest_ready"
      || sourceKey.startsWith("gr:")
      || (Boolean(task.check_in_date) && notes.includes("auto-created from ical sync for check-in"));
    if (!isTaskGuestReady(task) && !hasReservationGuestReadyIdentity) return false;
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
    if (!isPropertyActive(property)) return false;
    if (!propertySupportsServiceBranch(property, SERVICE_BRANCH_POOL)) return false;
    const frequency = getPropertyFrequencyForScheduling(property);
    if (frequency === SERVICE_FREQUENCY_BIWEEKLY) {
      return Boolean(getBiweeklyAnchorDateForScheduling(property));
    }
    return Boolean(property.standard_service_day);
  });

  if (!propertiesForGeneration.length) return 0;

  const weeklyTasksToCreate = [];

  for (const property of propertiesForGeneration) {
    const standardDayName = property.standard_service_day || "Wednesday";
    const frequency = getPropertyFrequencyForScheduling(property);
    const frequencyLabel = getServiceFrequencyLabel(frequency);
    const propertyCoverageRule = getCoverageRuleForProperty(property);
    const serviceDates = getWeeklyGenerationServiceDatesForProperty(property, monthType);

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
        weekly_service_level: WEEKLY_SERVICE_LEVEL_FULL,
        status: "Scheduled",
        off_cycle: false,
        guest_ready: false,
        charge: 0,
        notes: `Auto-created Weekly Standard (${frequencyLabel}) for ${standardDayName} in ${monthType} month view.`,
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

  let { error: insertError } = await supabaseClient
    .from("cleaning_tasks")
    .insert(filteredWeeklyTasks);

  if (insertError) {
    console.warn("Weekly generation insert failed:", insertError.message);
    return 0;
  }

  return filteredWeeklyTasks.length;
}

function getLawnGenerationServiceDatesForProperty(property, monthType) {
  const frequency = normalizeServiceFrequency(property?.lawn_service_frequency);
  if (frequency === SERVICE_FREQUENCY_BIWEEKLY) {
    return getServiceDatesForMonthByBiweeklyAnchor(property?.lawn_biweekly_anchor_date, monthType);
  }
  return getServiceDatesForMonthByDay(property?.lawn_service_day || "Wednesday", monthType);
}

function hasExistingLawnTask(propertyId, serviceDate) {
  const sourceKey = `lawn:${propertyId}:${serviceDate}`;
  return cleaningTasks.some((task) => task.property_id === propertyId
    && isLawnTask(task)
    && (task.source_key === sourceKey || (!task.source_key && task.service_date === serviceDate)));
}

async function ensureLawnTasksForMonth(monthType) {
  if (!["current", "next", "previous"].includes(monthType)) return 0;

  const tasksToCreate = [];
  properties
    .filter((property) => isPropertyActive(property) && propertySupportsServiceBranch(property, SERVICE_BRANCH_LAWN))
    .forEach((property) => {
      const frequency = normalizeServiceFrequency(property.lawn_service_frequency);
      const frequencyLabel = getServiceFrequencyLabel(frequency);
      const serviceDay = property.lawn_service_day || "Wednesday";
      if (frequency === SERVICE_FREQUENCY_BIWEEKLY && !normalizeBiweeklyAnchorDate(property.lawn_biweekly_anchor_date)) return;

      getLawnGenerationServiceDatesForProperty(property, monthType).forEach((serviceDate) => {
        if (hasExistingLawnTask(property.id, serviceDate)) return;
        tasksToCreate.push({
          property_id: property.id,
          service_date: serviceDate,
          scheduled_date: serviceDate,
          suggested_date: serviceDate,
          service_type: "Lawn Service",
          service_branch: SERVICE_BRANCH_LAWN,
          status: "Scheduled",
          off_cycle: false,
          guest_ready: false,
          charge: 0,
          notes: `Auto-created ${frequencyLabel} Lawn Service for ${serviceDay} in ${monthType} month view.`,
          source_type: "lawn_recurring",
          source_key: `lawn:${property.id}:${serviceDate}`,
          manually_modified: false,
        });
      });
    });

  if (!tasksToCreate.length) return 0;

  const sourceKeys = tasksToCreate.map((task) => task.source_key);
  const duplicateCheck = await supabaseClient.from("cleaning_tasks").select("source_key").in("source_key", sourceKeys);
  if (duplicateCheck.error) {
    console.warn("Lawn generation duplicate check failed:", duplicateCheck.error.message);
    return 0;
  }

  const existingKeys = new Set((duplicateCheck.data || []).map((row) => row.source_key));
  const newTasks = tasksToCreate.filter((task) => !existingKeys.has(task.source_key));
  if (!newTasks.length) return 0;

  const { error } = await supabaseClient.from("cleaning_tasks").insert(newTasks);
  if (error) {
    console.warn("Lawn generation insert failed. Run the Lawn Service migration first:", error.message);
    return 0;
  }
  return newTasks.length;
}

function getNormalizedCompanyProfile(raw) {
  return {
    company_name: String(raw?.company_name || DEFAULT_COMPANY_PROFILE.company_name).trim() || DEFAULT_COMPANY_PROFILE.company_name,
    tagline: String(raw?.tagline || DEFAULT_COMPANY_PROFILE.tagline).trim() || DEFAULT_COMPANY_PROFILE.tagline,
    phone_number: String(raw?.phone_number || "").trim(),
    email: String(raw?.email || "").trim(),
    logo_url: String(raw?.logo_url || "").trim(),
    guest_ready_logo_url: String(raw?.guest_ready_logo_url || "").trim(),
    weekend_ready_logo_url: String(raw?.weekend_ready_logo_url || "").trim(),
    admin_pin: String(raw?.admin_pin || DEFAULT_COMPANY_PROFILE.admin_pin).trim() || DEFAULT_COMPANY_PROFILE.admin_pin,
  };
}

function normalizeCompanyBranch(value) {
  const normalized = String(value || "").trim();
  if (COMPANY_BRANCH_OPTIONS.includes(normalized)) {
    return normalized;
  }
  return COMPANY_BRANCH_GUEST_READY;
}

function getPropertyById(propertyId) {
  const normalizedId = normalizePropertyId(propertyId);
  if (!normalizedId) return null;
  return properties.find((property) => normalizePropertyId(property.id) === normalizedId) || null;
}

function getCompanyBrandingForBranch(branchInput) {
  const branch = normalizeCompanyBranch(branchInput);
  const guestLogoUrl = String(companyProfile.guest_ready_logo_url || companyProfile.logo_url || "").trim();
  const weekendLogoUrl = String(companyProfile.weekend_ready_logo_url || companyProfile.logo_url || "").trim();

  return {
    branch,
    companyName: branch === COMPANY_BRANCH_WEEKEND_READY ? COMPANY_BRANCH_WEEKEND_READY : (companyProfile.company_name || DEFAULT_COMPANY_PROFILE.company_name),
    tagline: companyProfile.tagline || DEFAULT_COMPANY_PROFILE.tagline,
    logoUrl: branch === COMPANY_BRANCH_WEEKEND_READY ? weekendLogoUrl : guestLogoUrl,
    phoneNumber: companyProfile.phone_number || "",
    email: companyProfile.email || "",
  };
}

function getInvoiceCompanyBranch(invoice = {}) {
  const property = getPropertyById(invoice.propertyId || invoice.property_id);
  return normalizeCompanyBranch(invoice.companyBranch || property?.company_branch);
}

function getCurrentAdminPin() {
  const configured = String(companyProfile?.admin_pin || "").trim();
  return configured || DEFAULT_COMPANY_PROFILE.admin_pin;
}

function applyCompanyProfileToApp() {
  const guestBranding = getCompanyBrandingForBranch(COMPANY_BRANCH_GUEST_READY);
  if (companyHeaderName) {
    companyHeaderName.textContent = companyProfile.company_name;
  }
  if (companyHeaderTagline) {
    companyHeaderTagline.textContent = companyProfile.tagline;
  }
  applyImageSource(companyHeaderLogo, guestBranding.logoUrl);
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
  if (guestReadyLogoUrlInput) guestReadyLogoUrlInput.value = companyProfile.guest_ready_logo_url || "";
  if (weekendReadyLogoUrlInput) weekendReadyLogoUrlInput.value = companyProfile.weekend_ready_logo_url || "";
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
  const guestBranding = getCompanyBrandingForBranch(COMPANY_BRANCH_GUEST_READY);
  const logoMarkup = guestBranding.logoUrl
    ? `<img src="${guestBranding.logoUrl}" alt="${guestBranding.companyName} logo" class="company-logo messages-branding-logo" onerror="this.style.display='none'">`
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

  const { error } = await upsertCompanyProfileWithLegacyFallback(upsertPayload);

  if (error) {
    console.warn("Could not persist uploaded logo URL:", error.message);
    return false;
  }

  return true;
}

async function upsertCompanyProfileWithLegacyFallback(payload) {
  let upsertPayload = { ...payload };
  let result = await supabaseClient
    .from("company_profile")
    .upsert(upsertPayload, { onConflict: "id" });

  const optionalCompanyProfileColumns = [
    "guest_ready_logo_url",
    "weekend_ready_logo_url",
    "logo_url",
    "phone_number",
    "email",
    "admin_pin",
  ];

  while (result.error) {
    const message = String(result.error.message || "").toLowerCase();
    const missingColumn = optionalCompanyProfileColumns.find((column) => message.includes(column));
    if (!missingColumn || !(missingColumn in upsertPayload)) {
      break;
    }

    delete upsertPayload[missingColumn];
    result = await supabaseClient
      .from("company_profile")
      .upsert(upsertPayload, { onConflict: "id" });
  }

  return result;
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
    guest_ready_logo_url: guestReadyLogoUrlInput?.value,
    weekend_ready_logo_url: weekendReadyLogoUrlInput?.value,
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

  const { error } = await upsertCompanyProfileWithLegacyFallback(upsertPayload);

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

function setTechnicianSettingsStatus(message, isError = false) {
  if (!technicianSettingsStatus) return;
  technicianSettingsStatus.textContent = message || "";
  technicianSettingsStatus.style.color = isError ? "#dc2626" : "#059669";
  if (!message) return;
  setTimeout(() => {
    if (technicianSettingsStatus.textContent === message) {
      technicianSettingsStatus.textContent = "";
    }
  }, 2800);
}

function resetTechnicianSettingsForm() {
  editingTechnicianId = null;
  if (technicianNameInput) technicianNameInput.value = "";
  if (technicianActiveCheckbox) technicianActiveCheckbox.checked = true;
  if (technicianPaidLaborCheckbox) technicianPaidLaborCheckbox.checked = true;
  if (saveTechnicianBtn) saveTechnicianBtn.textContent = "Add Technician";
  if (cancelTechnicianEditBtn) cancelTechnicianEditBtn.classList.add("hidden");
}

function getSortedTechnicians() {
  return technicians
    .slice()
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

function getActiveTechnicians() {
  return getSortedTechnicians().filter((technician) => technician.active !== false);
}

function findTechnicianById(technicianId) {
  const normalizedId = String(technicianId || "").trim();
  if (!normalizedId) return null;
  return technicians.find((technician) => String(technician.id || "").trim() === normalizedId) || null;
}

function isTechnicianPaidLabor(technician) {
  return technician?.paid_labor !== false;
}

function findActiveTechnicianByName(name) {
  const normalized = String(name || "").trim().toLowerCase();
  if (!normalized) return null;
  return getActiveTechnicians().find((technician) => String(technician.name || "").trim().toLowerCase() === normalized) || null;
}

function renderTechnicianSettingsSection() {
  if (!technicianSettingsList) return;

  const rows = getSortedTechnicians();
  if (!rows.length) {
    technicianSettingsList.innerHTML = '<tr><td colspan="5">No technicians configured yet.</td></tr>';
    return;
  }

  technicianSettingsList.innerHTML = rows.map((technician) => {
    const createdDate = technician.created_at
      ? new Date(technician.created_at).toLocaleDateString()
      : "-";

    return `
      <tr>
        <td>${escapeHtml(technician.name || "")}</td>
        <td>${technician.active === false ? "Inactive" : "Active"}</td>
        <td>${technician.paid_labor === false ? "No" : "Yes"}</td>
        <td>${createdDate}</td>
        <td>
          <div class="chemical-settings-row-actions">
            <button type="button" onclick="openEditTechnician('${technician.id}')">Edit</button>
            <button type="button" onclick="toggleTechnicianActive('${technician.id}')">${technician.active === false ? "Activate" : "Deactivate"}</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function openEditTechnician(technicianId) {
  const technician = findTechnicianById(technicianId);
  if (!technician) return;

  editingTechnicianId = technician.id;
  if (technicianNameInput) technicianNameInput.value = technician.name || "";
  if (technicianActiveCheckbox) technicianActiveCheckbox.checked = technician.active !== false;
  if (technicianPaidLaborCheckbox) technicianPaidLaborCheckbox.checked = technician.paid_labor !== false;
  if (saveTechnicianBtn) saveTechnicianBtn.textContent = "Update Technician";
  if (cancelTechnicianEditBtn) cancelTechnicianEditBtn.classList.remove("hidden");
}

async function saveTechnician() {
  if (!technicianNameInput || !technicianActiveCheckbox || !technicianPaidLaborCheckbox) return;

  const name = String(technicianNameInput.value || "").trim();
  const active = Boolean(technicianActiveCheckbox.checked);
  const paidLabor = Boolean(technicianPaidLaborCheckbox.checked);
  if (!name) {
    alert("Technician name is required.");
    return;
  }

  const duplicate = technicians.find((technician) => {
    const sameName = String(technician.name || "").trim().toLowerCase() === name.toLowerCase();
    if (!sameName) return false;
    if (!editingTechnicianId) return true;
    return String(technician.id) !== String(editingTechnicianId);
  });
  if (duplicate) {
    alert("A technician with this name already exists.");
    return;
  }

  const payload = {
    name,
    active,
    paid_labor: paidLabor,
  };

  let response;
  if (editingTechnicianId) {
    response = await supabaseClient
      .from("technicians")
      .update(payload)
      .eq("id", editingTechnicianId);
  } else {
    response = await supabaseClient
      .from("technicians")
      .insert([payload]);
  }

  if (response.error) {
    const missingOptionalColumn = /active|paid_labor/i.test(String(response.error.message || ""));
    if (missingOptionalColumn) {
      const legacyPayload = { name };
      if (editingTechnicianId) {
        response = await supabaseClient
          .from("technicians")
          .update(legacyPayload)
          .eq("id", editingTechnicianId);
      } else {
        response = await supabaseClient
          .from("technicians")
          .insert([legacyPayload]);
      }
    }
  }

  if (response.error) {
    alert("Error saving technician: " + response.error.message);
    return;
  }

  if (editingTechnicianId) {
    const { error: snapshotError } = await supabaseClient
      .from("cleaning_tasks")
      .update({ labor_payable: paidLabor })
      .is("labor_payable", null)
      .or(`completed_by_technician_id.eq.${editingTechnicianId},technician_id.eq.${editingTechnicianId}`);

    const missingSnapshotColumn = /labor_payable/i.test(String(snapshotError?.message || ""));
    if (snapshotError && !missingSnapshotColumn) {
      console.warn("Could not snapshot historical labor classification:", snapshotError.message);
    }
  }

  await loadTechnicians();
  resetTechnicianSettingsForm();
  renderTechnicianSettingsSection();
  renderProperties();
  setTechnicianSettingsStatus("Technician saved.");
}

async function toggleTechnicianActive(technicianId) {
  const technician = findTechnicianById(technicianId);
  if (!technician) return;

  const nextActive = technician.active === false;
  const { error } = await supabaseClient
    .from("technicians")
    .update({ active: nextActive })
    .eq("id", technicianId);

  if (error) {
    alert("Error updating technician status: " + error.message);
    return;
  }

  await loadTechnicians();
  renderTechnicianSettingsSection();
  renderProperties();
  setTechnicianSettingsStatus(nextActive ? "Technician activated." : "Technician deactivated.");
}

async function loadTechnicians() {
  const { data, error } = await supabaseClient
    .from("technicians")
    .select("*")
    .order("name", { ascending: true });

  if (error) {
    const missingTable = String(error.message || "").toLowerCase().includes("technicians");
    if (!missingTable) {
      console.warn("Could not load technicians:", error.message);
    }
    technicians = [];
    taskTechnicianSelections = new Map();
    return;
  }

  technicians = data || [];
  taskTechnicianSelections = new Map(
    Array.from(taskTechnicianSelections.entries()).filter(([taskId, technicianId]) => {
      if (!taskId || !technicianId) return false;
      const technician = findTechnicianById(technicianId);
      return technician?.active !== false;
    })
  );
}

async function loadAppUsers() {
  if (!isAdminUser() || !appUsersList) return;
  const { data, error } = await supabaseClient.rpc("admin_list_app_users");
  if (error) {
    appUsers = [];
    appUsersList.innerHTML = `<tr><td colspan="5">Could not load users: ${escapeHtml(error.message)}</td></tr>`;
    return;
  }
  appUsers = data || [];
  renderAppUsers();
}

function renderAppUsers() {
  if (!appUsersList) return;
  if (!appUsers.length) {
    appUsersList.innerHTML = '<tr><td colspan="5">No Supabase Auth users found.</td></tr>';
    return;
  }

  appUsersList.innerHTML = appUsers.map((user) => {
    const assignedRole = ["admin", "manager", "staff"].includes(user.role) ? user.role : "staff";
    const active = user.active === true;
    const isCurrentUser = String(user.user_id) === String(currentSessionUserId);
    return `
      <tr>
        <td>${escapeHtml(user.email || "")}${isCurrentUser ? " (You)" : ""}</td>
        <td>
          <select id="appUserRole-${user.user_id}" ${isCurrentUser ? "disabled" : ""}>
            <option value="admin" ${assignedRole === "admin" ? "selected" : ""}>Admin</option>
            <option value="manager" ${assignedRole === "manager" ? "selected" : ""}>Manager</option>
            <option value="staff" ${assignedRole === "staff" ? "selected" : ""}>Staff</option>
          </select>
        </td>
        <td><input id="appUserActive-${user.user_id}" type="checkbox" ${active ? "checked" : ""} ${isCurrentUser ? "disabled" : ""}></td>
        <td>${user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString() : "Never"}</td>
        <td><button type="button" onclick="saveAppUserAccess('${user.user_id}')" ${isCurrentUser ? "disabled" : ""}>Save</button></td>
      </tr>
    `;
  }).join("");
}

async function saveAppUserAccess(userId) {
  if (!isAdminUser()) return;
  const roleInput = document.getElementById(`appUserRole-${userId}`);
  const activeInput = document.getElementById(`appUserActive-${userId}`);
  if (!roleInput || !activeInput) return;
  if (appUsersStatus) appUsersStatus.textContent = "Saving...";

  const { error } = await supabaseClient.rpc("admin_set_app_user_role", {
    target_user_id: userId,
    next_role: roleInput.value,
    next_active: activeInput.checked,
  });
  if (error) {
    if (appUsersStatus) appUsersStatus.textContent = "";
    alert("Could not update user access: " + error.message);
    return;
  }

  if (appUsersStatus) appUsersStatus.textContent = "User access saved.";
  await loadAppUsers();
}

window.saveAppUserAccess = saveAppUserAccess;

async function loadProperties() {
  const { data, error } = await supabaseClient
    .from("properties")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    statusMessage.textContent = "Could not load properties: " + error.message;
    return;
  }

  properties = (data || []).map((property) => ({
    ...property,
    active: property.active !== false,
  }));
}

async function loadPropertyContractRevenueHistory() {
  const { data, error } = await supabaseClient
    .from("property_contract_revenue_history")
    .select("*")
    .order("effective_from", { ascending: true });

  if (error) {
    propertyContractRevenueHistory = [];
    propertyContractRevenueHistoryAvailable = false;
    const message = String(error.message || "").toLowerCase();
    if (!message.includes("property_contract_revenue_history")) {
      console.warn("Could not load contract revenue history:", error.message);
    }
    return;
  }

  propertyContractRevenueHistory = data || [];
  propertyContractRevenueHistoryAvailable = true;
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

  // Cancelled/stale iCal reservations must not participate in Same-Day Turnover, scheduling, or route planning.
  reservations = (data || []).filter((reservation) => isReservationActive(reservation));
  console.log("[loadReservations] reservations[] set to", reservations.length, "rows");
}

function isReservationActive(reservation) {
  return String(reservation?.status || "active").toLowerCase() !== "cancelled";
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
  if (!requireAdminAccess()) return;
  const selectedCoverageRule = coverageRule ? coverageRule.value : "both";
  const selectedServiceFrequency = normalizeServiceFrequency(propertyServiceFrequency?.value);
  const selectedBiweeklyAnchorDate = selectedServiceFrequency === SERVICE_FREQUENCY_BIWEEKLY
    ? normalizeBiweeklyAnchorDate(propertyBiweeklyAnchorDate?.value)
    : null;
  const selectedPropertyActive = String(propertyStatus?.value || "active") !== "inactive";
  const selectedPoolServiceActive = String(propertyPoolServiceActive?.value || "yes") === "yes";
  const selectedLawnServiceActive = String(propertyLawnServiceActive?.value || "no") === "yes";
  const selectedHousekeepingServiceActive = String(propertyHousekeepingServiceActive?.value || "no") === "yes";
  const selectedLawnFrequency = normalizeServiceFrequency(propertyLawnServiceFrequency?.value);
  const selectedLawnAnchorDate = selectedLawnFrequency === SERVICE_FREQUENCY_BIWEEKLY
    ? normalizeBiweeklyAnchorDate(propertyLawnBiweeklyAnchorDate?.value)
    : null;
  const taxable = String(propertyTaxable?.value || "yes") === "yes";

  if (selectedServiceFrequency === SERVICE_FREQUENCY_BIWEEKLY && !selectedBiweeklyAnchorDate) {
    alert("First / Next Cleaning Date is required when Service Frequency is Bi-Weekly.");
    return;
  }

  if (selectedLawnServiceActive && selectedLawnFrequency === SERVICE_FREQUENCY_BIWEEKLY && !selectedLawnAnchorDate) {
    alert("Lawn First / Next Service Date is required when Lawn Service Frequency is Bi-Weekly.");
    return;
  }

  const existingProperty = editingPropertyId ? properties.find((property) => property.id === editingPropertyId) : null;
  const deactivatingProperty = Boolean(existingProperty)
    && isPropertyActive(existingProperty)
    && !selectedPropertyActive;
  const todayDate = new Date();
  todayDate.setHours(0, 0, 0, 0);
  const todayKey = formatDateValue(todayDate);
  const nextSchedule = {
    service_frequency: selectedServiceFrequency,
    biweekly_anchor_date: selectedBiweeklyAnchorDate,
    standard_service_day: standardDay.value,
  };

  const existingFrequency = getPropertyFrequencyForScheduling(existingProperty);
  const existingAnchorDate = getBiweeklyAnchorDateForScheduling(existingProperty);
  const existingStandardDay = String(existingProperty?.standard_service_day || "Wednesday").trim() || "Wednesday";
  const scheduleChanged = Boolean(existingProperty)
    && (
      existingFrequency !== selectedServiceFrequency
      || existingAnchorDate !== (selectedBiweeklyAnchorDate || "")
      || existingStandardDay !== (String(standardDay.value || "").trim() || "Wednesday")
    );

  const staleFutureAutoWeeklyTasks = scheduleChanged && !deactivatingProperty
    ? getFutureAutoWeeklyTasksOutsideSchedule(editingPropertyId, nextSchedule, todayKey)
    : [];

  if (staleFutureAutoWeeklyTasks.length > 0) {
    const confirmMessage = `This schedule change will remove ${staleFutureAutoWeeklyTasks.length} future auto-generated Weekly Standard task(s) that no longer match the new frequency.\n\nCompleted tasks, manual tasks, and Guest Ready tasks will not be deleted.\n\nContinue?`;
    if (!window.confirm(confirmMessage)) {
      return;
    }
  }

  const propertyData = {
    property_name: propertyName.value.trim(),
    client_name: String(propertyClientName?.value || "").trim() || null,
    billing_company_name: String(propertyBillingCompanyName?.value || "").trim() || null,
    billing_email: String(propertyBillingEmail?.value || "").trim() || null,
    billing_address: String(propertyBillingAddress?.value || "").trim() || null,
    billing_account_reference: String(propertyAccountReference?.value || "").trim() || null,
    address: propertyAddress.value.trim(),
    gate_access_instructions: String(propertyGateAccessInstructions?.value || "").trim() || null,
    service_notes: String(propertyServiceNotes?.value || "").trim() || null,
    equipment_service_info: String(propertyEquipmentServiceInfo?.value || "").trim() || null,
    ical_url: propertyIcal.value.trim(),
    safetyculture_checklist_url: normalizeSafetyCultureUrl(safetycultureChecklistUrl?.value || "") || null,
    standard_service_day: standardDay.value,
    coverage_days: selectedCoverageRule === "none" ? 0 : 1,
    coverage_rule: selectedCoverageRule,
    default_off_cycle_charge: Number(offCycleCharge.value),
    weekly_service_labor: Math.max(0, Number(propertyWeeklyLaborRate?.value || 0)),
    contract_revenue_amount: Math.max(0, Number(propertyContractRevenueAmount?.value || 0)),
    contract_rate_basis: normalizeContractRateBasis(propertyContractRateBasis?.value),
    guest_ready_service_labor: Math.max(0, Number(propertyGuestReadyLaborRate?.value || 0)),
    additional_cleaning_labor: Math.max(0, Number(propertyAdditionalLaborRate?.value || 0)),
    default_cleaning_rate: Number(propertyDefaultCleaningRate?.value || 0),
    same_day_surcharge: Number(propertySameDaySurcharge?.value || 0),
    billing_taxable: taxable,
    billing_tax_rate: taxable ? Number(propertyTaxRate?.value || 0) : 0,
    payment_terms: String(propertyPaymentTerms?.value || "").trim() || DEFAULT_INVOICE_TERMS,
    invoice_notes: String(propertyInvoiceNotes?.value || "").trim() || null,
    company_branch: normalizeCompanyBranch(propertyCompanyBranch?.value),
    service_frequency: selectedServiceFrequency,
    biweekly_anchor_date: selectedBiweeklyAnchorDate,
    pool_service_active: selectedPoolServiceActive,
    housekeeping_service_active: selectedHousekeepingServiceActive,
    housekeeping_default_charge: Math.max(0, Number(propertyHousekeepingDefaultCharge?.value || 0)),
    housekeeping_labor_amount: Math.max(0, Number(propertyHousekeepingLaborAmount?.value || 0)),
    lawn_service_active: selectedLawnServiceActive,
    lawn_service_frequency: selectedLawnFrequency,
    lawn_service_day: String(propertyLawnServiceDay?.value || "Wednesday"),
    lawn_biweekly_anchor_date: selectedLawnAnchorDate,
    lawn_default_charge: Math.max(0, Number(propertyLawnDefaultCharge?.value || 0)),
    lawn_labor_amount: Math.max(0, Number(propertyLawnLaborAmount?.value || 0)),
    active: selectedPropertyActive
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
    "same_day_surcharge",
    "weekly_service_labor",
    "contract_revenue_amount",
    "contract_rate_basis",
    "guest_ready_service_labor",
    "additional_cleaning_labor",
    "billing_taxable",
    "billing_tax_rate",
    "payment_terms",
    "invoice_notes",
    "company_branch",
    "service_frequency",
    "biweekly_anchor_date",
    "housekeeping_service_active",
    "housekeeping_default_charge",
    "housekeeping_labor_amount",
    "active",
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

  if (staleFutureAutoWeeklyTasks.length > 0) {
    const staleTaskIds = staleFutureAutoWeeklyTasks.map((task) => task.id).filter(Boolean);
    if (staleTaskIds.length > 0) {
      const { error: cleanupError } = await supabaseClient
        .from("cleaning_tasks")
        .delete()
        .in("id", staleTaskIds);

      if (cleanupError) {
        alert("Property saved, but some old auto-generated Weekly Standard tasks could not be removed: " + cleanupError.message);
      }
    }
  }

  clearPropertyForm();
  closePropertyModal();
  await loadData();
}

async function deleteProperty(id) {
  if (!requireAdminAccess()) return;
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

function formatAutoIcalSyncTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function setAutoIcalSyncStatus(state, timestamp = "") {
  if (!calendarSyncIndicator) return;
  if (state === "syncing") {
    calendarSyncIndicator.textContent = "Auto Calendar Sync: Syncing...";
    return;
  }
  if (state === "recent") {
    calendarSyncIndicator.textContent = `Auto Calendar Sync: Recently synced ${formatAutoIcalSyncTimestamp(timestamp)}`;
    calendarSyncIndicator.title = "";
    return;
  }
  if (state === "success") {
    calendarSyncIndicator.textContent = `Auto Calendar Sync: Last synced ${formatAutoIcalSyncTimestamp(timestamp)}`;
    calendarSyncIndicator.title = "";
    return;
  }
  if (state === "failed") {
    calendarSyncIndicator.textContent = "Auto Calendar Sync: Failed - use Sync All iCal to retry";
    calendarSyncIndicator.title = "";
    return;
  }
  calendarSyncIndicator.textContent = "Auto Calendar Sync: Not yet synced";
  calendarSyncIndicator.title = "";
}

async function maybeStartAutoIcalSync(userId) {
  if (!isAdminUser() || !userId || autoIcalSyncAttemptedUserId === userId) return;
  autoIcalSyncAttemptedUserId = userId;

  const lastSuccessfulSync = localStorage.getItem(LAST_AUTO_ICAL_SYNC_STORAGE_KEY) || "";
  const lastSuccessfulSyncTime = new Date(lastSuccessfulSync).getTime();
  const elapsedSinceLastSync = Date.now() - lastSuccessfulSyncTime;
  if (Number.isFinite(lastSuccessfulSyncTime) && elapsedSinceLastSync >= 0 && elapsedSinceLastSync < AUTO_ICAL_SYNC_COOLDOWN_MS) {
    setAutoIcalSyncStatus("recent", lastSuccessfulSync);
    return;
  }

  await syncAllIcal({ automatic: true });
}

function syncAllIcal({ automatic = false } = {}) {
  if (automatic) {
    if (!isAdminUser()) return Promise.resolve({ success: false, unauthorized: true });
  } else if (!requireAdminAccess()) {
    return Promise.resolve({ success: false, unauthorized: true });
  }

  if (icalSyncPromise) return icalSyncPromise;
  icalSyncPromise = runSyncAllIcal({ automatic })
    .catch((error) => {
      console.error("[SyncAll] Unexpected failure:", error);
      setAutoIcalSyncStatus("failed");
      return { success: false, error };
    })
    .finally(() => {
      syncAllIcalBtn.disabled = false;
      icalSyncPromise = null;
    });
  return icalSyncPromise;
}

async function runSyncAllIcal({ automatic }) {
  const allProperties = properties;
  const icalProperties = allProperties.filter((p) => p.ical_url
    && isPropertyActive(p)
    && (
      propertySupportsServiceBranch(p, SERVICE_BRANCH_POOL)
      || propertySupportsServiceBranch(p, SERVICE_BRANCH_HOUSEKEEPING)
    ));

  if (icalProperties.length === 0) {
    syncAllStatus.textContent = "No active properties with an iCal URL configured.";
    if (automatic) setAutoIcalSyncStatus("failed");
    return { success: false, reason: "no-eligible-properties" };
  }

  syncAllIcalBtn.disabled = true;
  setAutoIcalSyncStatus("syncing");
  renderSyncReport(null); // clear previous report
  console.log(`[SyncAll] Starting sync for ${icalProperties.length} active properties. Inactive properties are skipped.`);

  const results = [];

  // Mark skipped properties first
  for (const p of allProperties) {
    if (!p.ical_url) {
      console.log(`[SyncAll] SKIP "${p.property_name}" — no iCal URL`);
      results.push({ propertyName: p.property_name, skipped: true, skippedReason: "No iCal URL" });
      continue;
    }
    if (!isPropertyActive(p)) {
      console.log(`[SyncAll] SKIP "${p.property_name}" — property is inactive`);
      results.push({ propertyName: p.property_name, skipped: true, skippedReason: "Property inactive" });
      continue;
    }
    if (!propertySupportsServiceBranch(p, SERVICE_BRANCH_POOL) && !propertySupportsServiceBranch(p, SERVICE_BRANCH_HOUSEKEEPING)) {
      results.push({ propertyName: p.property_name, skipped: true, skippedReason: "Pool and Housekeeping inactive" });
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
      } else if (
        propertySupportsServiceBranch(property, SERVICE_BRANCH_HOUSEKEEPING)
        && data?.syncVersion !== "housekeeping-pricing-v1"
      ) {
        result.error = "Housekeeping pricing sync is not deployed. Deploy the updated sync-ical Edge Function, then sync again.";
        console.log(`[SyncAll] OUTDATED FUNCTION for "${property.property_name}":`, result.error);
      } else {
        result.success = true;
        result.data = data;
        console.log(`[SyncAll] SUCCESS for "${property.property_name}": parsed=${data?.reservationsParsed ?? "?"} active=${data?.activeReservations ?? "?"} ignored=${data?.oldIgnored ?? "?"} saved=${data?.reservationsCreated ?? 0} weekly=${data?.weeklyTasksCreated ?? 0} guestReady=${data?.guestReadyTasksCreated ?? 0} housekeepingCreated=${data?.housekeepingTasksCreated ?? 0} housekeepingUpdated=${data?.housekeepingTasksUpdated ?? 0}`);
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

  const success = failed === 0;
  if (success) {
    const completedAt = new Date().toISOString();
    localStorage.setItem(LAST_AUTO_ICAL_SYNC_STORAGE_KEY, completedAt);
    setAutoIcalSyncStatus("success", completedAt);
  } else {
    setAutoIcalSyncStatus("failed");
  }

  renderSyncReport(results);
  return { success, results };
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
          <td colspan="10" class="sync-skipped-label">Skipped — ${r.skippedReason || "Not eligible"}</td>
        </tr>`;
    }
    if (!r.success) {
      return `
        <tr class="sync-row-error">
          <td>${r.propertyName}</td>
          <td>✓</td>
          <td colspan="8">—</td>
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
        <td>${d.housekeepingTasksCreated ?? 0}</td>
        <td>${d.housekeepingTasksUpdated ?? 0}</td>
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
            <th>Housekeeping Created</th>
            <th>Housekeeping Updated</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

async function syncPropertyIcal(propertyId) {
  if (!requireAdminAccess()) return;
  console.log("[SynciCal] Sync button clicked, propertyId:", propertyId);

  const property = properties.find((p) => p.id === propertyId);
  if (!property || !property.ical_url) {
    const msg = "No iCal URL configured for this property.";
    console.log("[SynciCal] Aborted:", msg);
    statusMessage.textContent = msg;
    return;
  }

  if (!isPropertyActive(property)) {
    const msg = "This property is inactive. iCal auto-generation is paused until it is reactivated.";
    console.log("[SynciCal] Aborted:", msg);
    statusMessage.textContent = msg;
    return;
  }

  if (
    !propertySupportsServiceBranch(property, SERVICE_BRANCH_POOL)
    && !propertySupportsServiceBranch(property, SERVICE_BRANCH_HOUSEKEEPING)
  ) {
    statusMessage.textContent = "Pool Service and Housekeeping are inactive for this property.";
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

  if (
    propertySupportsServiceBranch(property, SERVICE_BRANCH_HOUSEKEEPING)
    && !Object.prototype.hasOwnProperty.call(data || {}, "housekeepingTasksCreated")
  ) {
    statusMessage.textContent = "Housekeeping sync is not deployed. Deploy the updated sync-ical Edge Function, then sync again.";
    return;
  }

  try {
    await loadData();
  } catch (loadError) {
    console.log("[SynciCal] loadData() threw after sync — suppressing to preserve result message:", loadError);
  }

  const successMsg = `iCal sync complete: ${data?.reservationsCreated ?? 0} reservation(s) saved, ${data?.guestReadyTasksCreated ?? 0} Guest Ready task(s), ${data?.housekeepingTasksCreated ?? 0} Housekeeping task(s) created, ${data?.housekeepingTasksUpdated ?? 0} Housekeeping task(s) updated.`;
  console.log("[SynciCal] Success message:", successMsg);
  statusMessage.textContent = successMsg;
}

async function saveCleaningTask() {
  const returnToMonthView = document.getElementById("monthView")?.classList.contains("active") === true;
  const returnToPropertiesView = document.getElementById("propertiesView")?.classList.contains("active") === true;
  const selectedPropId = cleaningPropertySelect?.value || selectedCleaningPropertyId;
  const property = properties.find((p) => p.id === selectedPropId);
  if (!property) {
    alert("Please select a valid property.");
    return;
  }
  selectedCleaningPropertyId = property.id;

  const currentModalState = getCleaningModalStateSnapshot();
  const changedModalFields = cleaningModalInitialState
    ? Object.keys(currentModalState).filter((key) => currentModalState[key] !== cleaningModalInitialState[key])
    : [];
  if (editingCleaningId && changedModalFields.length === 1 && changedModalFields[0] === "serviceBranch") {
    const existingTask = cleaningTasks.find((task) => task.id === editingCleaningId)
      || monthCleaningTasks.find((task) => task.id === editingCleaningId);
    const branchBlockReason = getTaskRescheduleBlockReason(existingTask);
    if (branchBlockReason) {
      alert(branchBlockReason);
      return;
    }

    const branchResult = await supabaseClient.rpc("manager_update_task_service_branch", {
      target_task_id: editingCleaningId,
      selected_service_branch: normalizeServiceBranch(cleaningServiceBranch?.value),
    });
    if (branchResult.error) {
      alert("Could not change service branch: " + branchResult.error.message);
      return;
    }

    editingCleaningId = null;
    closeCleaningModal({ force: true });
    if (isManagerUser()) {
      await loadManagerOperationalData();
    } else {
      await loadData();
    }
    if (returnToMonthView) {
      showView("month");
      await loadMonthTasks();
    } else if (returnToPropertiesView) {
      showView("properties");
      renderProperties();
    }
    return;
  }

  if (isManagerUser()) {
    if (editingCleaningId) {
      const selectedTechnician = findActiveTechnicianByName(cleaningTechnician.value.trim());
      const existingTask = cleaningTasks.find((task) => task.id === editingCleaningId)
        || monthCleaningTasks.find((task) => task.id === editingCleaningId);
      const existingServiceDate = normalizeDateKey(existingTask?.service_date || existingTask?.scheduled_date);
      const selectedServiceDate = normalizeDateKey(cleaningDate.value);
      const existingServiceBranch = normalizeServiceBranch(existingTask?.service_branch);
      const selectedServiceBranch = normalizeServiceBranch(cleaningServiceBranch?.value);
      const serviceBranchChanged = selectedServiceBranch !== existingServiceBranch;
      const serviceLevel = existingTask?.service_type === "Weekly Standard"
        ? normalizeWeeklyServiceLevel(cleaningWeeklyServiceLevel?.value)
        : null;
      if (serviceBranchChanged) {
        const branchBlockReason = getTaskRescheduleBlockReason(existingTask);
        if (branchBlockReason) {
          alert(branchBlockReason);
          return;
        }
      }
      if (selectedServiceDate && selectedServiceDate !== existingServiceDate) {
        const targetBlockReason = getTaskRescheduleTargetBlockReason(selectedServiceDate);
        if (targetBlockReason) {
          alert(targetBlockReason);
          return;
        }
        const rescheduleResult = await supabaseClient.rpc("manager_reschedule_task", {
          target_task_id: editingCleaningId,
          selected_service_date: selectedServiceDate,
        });
        if (rescheduleResult.error) {
          alert("Could not reschedule task: " + rescheduleResult.error.message);
          return;
        }
      }
      const { error } = await supabaseClient.rpc("manager_update_task_operations", {
        target_task_id: editingCleaningId,
        selected_technician_id: selectedTechnician?.id || null,
        selected_service_level: serviceLevel,
        entered_notes: applyManualBillingOverrideTag(cleaningNotes.value.trim(), hasManualBillingOverride(existingTask)),
      });
      if (error) {
        alert("Could not save operational task details: " + error.message);
        return;
      }
      if (serviceBranchChanged) {
        const branchResult = await supabaseClient.rpc("manager_update_task_service_branch", {
          target_task_id: editingCleaningId,
          selected_service_branch: selectedServiceBranch,
        });
        if (branchResult.error) {
          alert("Could not change service branch: " + branchResult.error.message);
          return;
        }
      }
      closeCleaningModal({ force: true });
      await loadManagerOperationalData();
      if (returnToMonthView) {
        showView("month");
        await loadMonthTasks();
      } else if (returnToPropertiesView) {
        showView("properties");
        renderManagerProperties();
      }
      return;
    } else {
      const selectedTechnician = findActiveTechnicianByName(cleaningTechnician.value.trim());
      const serviceType = cleaningServiceType.value || "Manual";
      const serviceBranch = serviceType === "Lawn Service"
        ? SERVICE_BRANCH_LAWN
        : normalizeServiceBranch(cleaningServiceBranch?.value || activeServiceWorkspace);
      const serviceLevel = serviceType === "Weekly Standard"
        ? normalizeWeeklyServiceLevel(cleaningWeeklyServiceLevel?.value)
        : null;
      const { error } = await supabaseClient.rpc("manager_create_task", {
        selected_property_id: selectedCleaningPropertyId,
        selected_service_date: cleaningDate.value,
        selected_service_type: serviceType,
        selected_service_branch: serviceBranch,
        selected_weekly_service_level: serviceLevel,
        selected_technician_id: selectedTechnician?.id || null,
        entered_notes: cleaningNotes.value.trim() || null,
      });
      if (error) {
        alert("Could not create task: " + error.message);
        return;
      }
      closeCleaningModal({ force: true });
      await loadManagerOperationalData();
      if (returnToMonthView) {
        showView("month");
        await loadMonthTasks();
      } else if (returnToPropertiesView) {
        showView("properties");
        renderManagerProperties();
      }
      return;
    }
  }

  const serviceDate = cleaningDate.value;
  const serviceBranch = normalizeServiceBranch(cleaningServiceBranch?.value || activeServiceWorkspace);
  const serviceType = editingCleaningId
    ? cleaningServiceType.value
    : (serviceBranch === SERVICE_BRANCH_LAWN ? "Lawn Service" : cleaningServiceType.value);
  const weeklyServiceLevel = serviceType === "Weekly Standard"
    ? normalizeWeeklyServiceLevel(cleaningWeeklyServiceLevel?.value)
    : null;
  const taskStatus = cleaningStatus.value || "Scheduled";
  const charge = Number(cleaningCharge.value || 0);
  const manualLaborRaw = String(cleaningLaborAmount?.value || "").trim();
  const hasManualLaborInput = manualLaborRaw !== "";
  const parsedManualLabor = hasManualLaborInput ? Number(manualLaborRaw) : null;
  const manualLaborAmount = hasManualLaborInput ? Math.max(0, parsedManualLabor) : null;
  const parsedPartsCost = Number(cleaningPartsCost?.value || 0);

  if (hasManualLaborInput && !Number.isFinite(parsedManualLabor)) {
    alert("Manual labor amount must be a valid number.");
    return;
  }

  if (!Number.isFinite(parsedPartsCost) || parsedPartsCost < 0) {
    alert("Parts cost must be a valid non-negative number.");
    return;
  }

  if (!serviceDate) {
    alert("Service date is required.");
    return;
  }

  const existingTask = editingCleaningId
    ? cleaningTasks.find((task) => task.id === editingCleaningId)
      || monthCleaningTasks.find((task) => task.id === editingCleaningId)
    : null;
  const existingServiceBranch = existingTask ? normalizeServiceBranch(existingTask.service_branch) : serviceBranch;
  const serviceBranchChanged = Boolean(existingTask && serviceBranch !== existingServiceBranch);
  if (serviceBranchChanged) {
    const branchBlockReason = getTaskRescheduleBlockReason(existingTask);
    if (branchBlockReason) {
      alert(branchBlockReason);
      return;
    }
  }
  if (existingTask && normalizeDateKey(existingTask.service_date || existingTask.scheduled_date) !== serviceDate) {
    const targetBlockReason = getTaskRescheduleTargetBlockReason(serviceDate);
    if (targetBlockReason) {
      alert(targetBlockReason);
      return;
    }
  }
  const existingCharge = Number(existingTask?.charge || 0);
  const wasCompleted = String(existingTask?.status || "") === "Completed";
  const completedAt = taskStatus === "Completed"
    ? existingTask?.completed_at || new Date().toISOString()
    : null;

  if (editingCleaningId && existingTask && isTaskLinkedToFinalizedInvoice(existingTask) && charge !== existingCharge) {
    alert("This task is already on a finalized invoice. The finalized charge cannot be changed.");
    return;
  }

  const existingLaborAmount = Number(existingTask?.labor_amount || 0);
  const requestedLaborAmount = hasManualLaborInput ? Number(manualLaborAmount || 0) : existingLaborAmount;
  if (
    editingCleaningId
    && existingTask
    && isHousekeepingTask(existingTask)
    && isTaskReconciled(existingTask)
    && (charge !== existingCharge || requestedLaborAmount !== existingLaborAmount)
  ) {
    alert("This Housekeeping task is reconciled. Its charge and labor snapshot cannot be changed.");
    return;
  }

  const sdsAmountInput = cleaningSdsAmount && !cleaningSdsAmount.classList.contains("hidden")
    ? Number(cleaningSdsAmount.value || 0)
    : null;
  const existingSdsAmount = Number(existingTask?.same_day_surcharge_amount || 0);
  if (editingCleaningId && existingTask && isSdsLinkedToFinalizedInvoice(existingTask) && sdsAmountInput !== null && sdsAmountInput !== existingSdsAmount) {
    alert("This task's Same-Day Surcharge is already on a finalized invoice. The finalized amount cannot be changed.");
    return;
  }

  // If a task's date is being changed, flag it as manually modified
  // so that future syncs do not overwrite it or recreate it on the original date.
  const isManuallyMoving = editingCleaningId && existingTask?.service_date !== serviceDate;
  const shouldApplyManualBillingOverride = Boolean(editingCleaningId && charge > 0);
  const notesWithOverride = applyManualBillingOverrideTag(cleaningNotes.value.trim(), shouldApplyManualBillingOverride);
  const selectedModalTechnician = findActiveTechnicianByName(cleaningTechnician.value.trim());
  const isMarkingCompleteNow = taskStatus === "Completed" && !wasCompleted;
  const isManualServiceTask = isManualTask({ service_type: serviceType });
  const usesStoredLaborSnapshot = isManualServiceTask || serviceBranch === SERVICE_BRANCH_HOUSEKEEPING;

  const persistedCompletedById = String(existingTask?.completed_by_technician_id || existingTask?.technician_id || "").trim();
  const persistedCompletedByTechnician = findTechnicianById(persistedCompletedById);
  const completedByTechnician = selectedModalTechnician
    || (taskStatus === "Completed" ? persistedCompletedByTechnician : null);
  const hasCompletedTechnician = Boolean(completedByTechnician?.id || completedByTechnician?.name);
  const previousTechnicianId = String(existingTask?.completed_by_technician_id || existingTask?.technician_id || "").trim();
  const previousTechnicianName = String(existingTask?.completed_by_technician_name || existingTask?.technician_name || existingTask?.technician || "").trim();
  const nextTechnicianId = String(completedByTechnician?.id || "").trim();
  const nextTechnicianName = String(completedByTechnician?.name || "").trim();
  const technicianChanged = previousTechnicianId !== nextTechnicianId || previousTechnicianName !== nextTechnicianName;

  if (existingTask && wasCompleted && isLaborTaskMarkedPaid(existingTask)) {
    if (technicianChanged) {
      const warning = "This labor has already been marked paid. Changing the technician will change who this payment is attributed to. Continue?";
      if (!window.confirm(warning)) {
        return;
      }
    }
  }

  const existingLaborRaw = existingTask?.labor_amount;
  const hasExistingLaborSnapshot = existingLaborRaw !== null && existingLaborRaw !== undefined && String(existingLaborRaw).trim() !== "";
  const wasMissingTechnicianAtCompletion = Boolean(existingTask && wasCompleted && !hasTechnicianSnapshot(existingTask));
  const shouldBackfillLaborNow = taskStatus === "Completed" && hasCompletedTechnician && wasMissingTechnicianAtCompletion && !usesStoredLaborSnapshot;
  const hasExistingLaborPayableSnapshot = existingTask?.labor_payable === true || existingTask?.labor_payable === false;
  const laborPayable = taskStatus === "Completed" && hasCompletedTechnician
    ? (isMarkingCompleteNow || shouldBackfillLaborNow || technicianChanged || !hasExistingLaborPayableSnapshot
      ? isTechnicianPaidLabor(completedByTechnician)
      : existingTask.labor_payable)
    : null;

  const laborCalculatedAt = taskStatus === "Completed"
    ? (hasCompletedTechnician
      ? (isMarkingCompleteNow || shouldBackfillLaborNow
        ? new Date().toISOString()
        : (existingTask?.labor_calculated_at || existingTask?.completed_at || new Date().toISOString()))
      : null)
    : null;

  const laborAmount = taskStatus === "Completed"
    ? (hasCompletedTechnician
      ? (usesStoredLaborSnapshot
        ? (hasManualLaborInput
          ? manualLaborAmount
          : (hasExistingLaborSnapshot
            ? Number(existingTask?.labor_amount || 0)
            : null))
        : (wasCompleted && hasExistingLaborSnapshot && !shouldBackfillLaborNow
          ? Number(existingTask?.labor_amount || 0)
          : getLaborAmountForTask(
              {
                service_type: serviceType,
                service_branch: serviceBranch,
                weekly_service_level: weeklyServiceLevel,
                property_id: selectedCleaningPropertyId,
                service_date: serviceDate,
                scheduled_date: serviceDate,
                charge,
                off_cycle: charge > 0 || serviceType === "Off-Cycle",
                guest_ready: serviceType === "Guest Ready",
                notes: notesWithOverride,
              },
              property
            )))
      : null)
    : (hasManualLaborInput ? manualLaborAmount : Number(existingTask?.labor_amount || 0));
  const task = {
    property_id: selectedCleaningPropertyId,
    service_date: serviceDate,
    scheduled_date: serviceDate,
    service_type: serviceType,
    service_branch: existingTask ? existingServiceBranch : serviceBranch,
    weekly_service_level: weeklyServiceLevel,
    technician: completedByTechnician ? completedByTechnician.name : cleaningTechnician.value.trim(),
    technician_id: completedByTechnician?.id || null,
    technician_name: completedByTechnician?.name || null,
    completed_by_technician_id: taskStatus === "Completed" ? (completedByTechnician?.id || null) : null,
    completed_by_technician_name: taskStatus === "Completed" ? (completedByTechnician?.name || null) : null,
    status: taskStatus,
    off_cycle: charge > 0 || serviceType === "Off-Cycle",
    charge: charge,
    labor_amount: laborAmount === null ? null : Number(laborAmount || 0),
    labor_calculated_at: laborCalculatedAt,
    labor_payable: laborPayable,
    parts_cost: parsedPartsCost,
    notes: notesWithOverride,
    guest_ready: serviceType === "Guest Ready",
    completed_at: completedAt,
    ...(isManuallyMoving ? {
      manually_modified: true,
      original_service_date: existingTask.original_service_date || normalizeDateKey(existingTask.service_date || existingTask.scheduled_date),
      overdue_reference_date: serviceDate,
    } : {}),
    // Only persist an explicit manual SDS override; a blank/0 field leaves any existing reconciled snapshot untouched.
    ...(sdsAmountInput !== null && sdsAmountInput > 0 ? { same_day_surcharge_amount: sdsAmountInput } : {})
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

  const optionalCleaningTaskColumns = [
    "technician_id",
    "technician_name",
    "completed_by_technician_id",
    "completed_by_technician_name",
    "weekly_service_level",
    "labor_amount",
    "labor_calculated_at",
    "labor_payable",
    "parts_cost",
  ];

  let legacyTaskPayload = { ...task };
  while (result.error) {
    const message = String(result.error.message || "").toLowerCase();
    const missingColumn = optionalCleaningTaskColumns.find((column) => message.includes(column));
    if (!missingColumn || !(missingColumn in legacyTaskPayload)) {
      break;
    }

    delete legacyTaskPayload[missingColumn];

    if (editingCleaningId) {
      result = await supabaseClient
        .from("cleaning_tasks")
        .update(legacyTaskPayload)
        .eq("id", editingCleaningId);
    } else {
      result = await supabaseClient
        .from("cleaning_tasks")
        .insert([legacyTaskPayload]);
    }
  }

  if (result.error && taskStatus === "Completed" && laborAmount === null) {
    const errorMessage = String(result.error.message || "").toLowerCase();
    const laborNullViolation = errorMessage.includes("labor_amount") && (errorMessage.includes("null") || errorMessage.includes("not-null") || errorMessage.includes("not null"));
    if (laborNullViolation) {
      const fallbackCompletedPayload = {
        ...legacyTaskPayload,
        labor_amount: 0,
        labor_calculated_at: null,
      };

      if (editingCleaningId) {
        result = await supabaseClient
          .from("cleaning_tasks")
          .update(fallbackCompletedPayload)
          .eq("id", editingCleaningId);
      } else {
        result = await supabaseClient
          .from("cleaning_tasks")
          .insert([fallbackCompletedPayload]);
      }
    }
  }

  if (result.error) {
    alert("Error saving cleaning: " + result.error.message);
    return;
  }

  if (serviceBranchChanged) {
    const branchResult = await supabaseClient.rpc("manager_update_task_service_branch", {
      target_task_id: editingCleaningId,
      selected_service_branch: serviceBranch,
    });
    if (branchResult.error) {
      alert("Could not change service branch: " + branchResult.error.message);
      return;
    }
  }

  editingCleaningId = null;
  closeCleaningModal({ force: true });
  await loadData();
  if (returnToMonthView) {
    showView("month");
    await loadMonthTasks();
  }
}

async function deleteCleaningTask(id) {
  if (!requireAdminAccess()) return;
  const task = cleaningTasks.find((item) => item.id === id);
  if (!task) {
    alert("Cleaning task not found.");
    return;
  }

  const confirmed = await openDeleteCleaningModal(task);
  if (!confirmed) return;

  const { data: deletedRows, error } = await supabaseClient
    .from("cleaning_tasks")
    .delete()
    .eq("id", id)
    .select("id");

  if (error) {
    console.error("[DeleteCleaning] Failed to delete task", { taskId: id, supabaseError: error });
    alert(error.message || "Delete failed.");
    return;
  }

  if (!deletedRows || deletedRows.length === 0) {
    const failureMessage = `Delete failed: no matching task row was removed for task ${id}.`;
    console.error("[DeleteCleaning] Delete returned zero rows", { taskId: id, deletedRows });
    alert(failureMessage);
    return;
  }

  const { data: verificationRows, error: verificationError } = await supabaseClient
    .from("cleaning_tasks")
    .select("id")
    .eq("id", id)
    .limit(1);

  if (verificationError) {
    console.error("[DeleteCleaning] Verification query failed", { taskId: id, supabaseError: verificationError });
    alert(verificationError.message || "Delete verification failed.");
    return;
  }

  if (verificationRows && verificationRows.length > 0) {
    const failureMessage = "Delete failed: task still exists after deletion attempt.";
    console.error("[DeleteCleaning] Task still exists after delete", { taskId: id, verificationRows });
    alert(failureMessage);
    return;
  }

  await loadCleaningTasks();
  await loadChemicalUsageEntries();

  renderTaskViews();
  renderProperties();
  renderBillingReport();
  renderInvoicePreview();

  statusMessage.textContent = "Scheduled cleaning deleted successfully.";
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
  if (isStaffUser()) {
    const { error: staffStartError } = await supabaseClient.rpc("staff_start_task", { target_task_id: id });
    if (staffStartError) {
      alert("Error starting task: " + staffStartError.message);
      return;
    }
    await loadStaffOperationalData();
    return;
  }
  if (isManagerUser()) {
    const { error } = await supabaseClient.rpc("manager_start_task", { target_task_id: id });
    if (error) {
      alert("Error starting task: " + error.message);
      return;
    }
    await loadManagerOperationalData();
    return;
  }

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
  const task = cleaningTasks.find((item) => item.id === id);
  if (!task) {
    alert("Task not found.");
    return;
  }

  const selectedTechnician = getSelectedTechnicianForTask(task);

  if (isStaffUser()) {
    const { error: staffCompleteError } = await supabaseClient.rpc("staff_complete_task", {
      target_task_id: id,
      selected_technician_id: selectedTechnician?.id || null,
    });
    if (staffCompleteError) {
      alert("Error completing task: " + staffCompleteError.message);
      return;
    }
    taskTechnicianSelections.delete(id);
    await loadStaffOperationalData();
    return;
  }
  if (isManagerUser()) {
    const serviceLevel = task.service_type === "Weekly Standard"
      ? getWeeklyServiceLevelForTask(task)
      : null;
    const { error: updateError } = await supabaseClient.rpc("manager_update_task_operations", {
      target_task_id: id,
      selected_technician_id: selectedTechnician?.id || null,
      selected_service_level: serviceLevel,
      entered_notes: task.notes || "",
    });
    if (updateError) {
      alert("Error saving task operations before completion: " + updateError.message);
      return;
    }
    const { error } = await supabaseClient.rpc("manager_complete_task", {
      target_task_id: id,
      selected_technician_id: selectedTechnician?.id || null,
    });
    if (error) {
      alert("Error completing task: " + error.message);
      return;
    }
    taskTechnicianSelections.delete(id);
    await loadManagerOperationalData();
    return;
  }

  const property = getPropertyById(task.property_id);
  const weeklyServiceLevel = String(task?.service_type || "") === "Weekly Standard"
    ? getWeeklyServiceLevelForTask(task)
    : null;
  const hasCompletedTechnician = Boolean(selectedTechnician?.id || selectedTechnician?.name);
  const isManualServiceTask = isManualTask(task);
  const existingManualLabor = Number(task?.labor_amount);
  const usesStoredLaborSnapshot = isManualServiceTask || isHousekeepingTask(task);
  const hasExistingManualLabor = task?.labor_amount !== null
    && task?.labor_amount !== undefined
    && String(task.labor_amount).trim() !== ""
    && Number.isFinite(existingManualLabor);
  const laborTaskContext = {
    ...task,
    weekly_service_level: weeklyServiceLevel,
  };
  const laborAmount = hasCompletedTechnician
    ? (usesStoredLaborSnapshot
      ? (hasExistingManualLabor ? existingManualLabor : null)
      : getLaborAmountForTask(laborTaskContext, property))
    : null;
  const completionTimestamp = new Date().toISOString();
  const completionPayload = {
    status: "Completed",
    completed_at: completionTimestamp,
    weekly_service_level: weeklyServiceLevel,
    technician: selectedTechnician?.name || null,
    technician_id: selectedTechnician?.id || null,
    technician_name: selectedTechnician?.name || null,
    completed_by_technician_id: selectedTechnician?.id || null,
    completed_by_technician_name: selectedTechnician?.name || null,
    labor_amount: hasCompletedTechnician ? Number(laborAmount || 0) : null,
    labor_calculated_at: hasCompletedTechnician && laborAmount !== null ? completionTimestamp : null,
    labor_payable: hasCompletedTechnician ? isTechnicianPaidLabor(selectedTechnician) : null,
  };

  let result = await supabaseClient
    .from("cleaning_tasks")
    .update(completionPayload)
    .eq("id", id);

  const optionalCleaningTaskColumns = [
    "technician_id",
    "technician_name",
    "completed_by_technician_id",
    "completed_by_technician_name",
    "weekly_service_level",
    "labor_amount",
    "labor_calculated_at",
    "labor_payable",
  ];

  let legacyPayload = { ...completionPayload };
  while (result.error) {
    const message = String(result.error.message || "").toLowerCase();
    const missingColumn = optionalCleaningTaskColumns.find((column) => message.includes(column));
    if (!missingColumn || !(missingColumn in legacyPayload)) {
      break;
    }

    delete legacyPayload[missingColumn];
    result = await supabaseClient
      .from("cleaning_tasks")
      .update(legacyPayload)
      .eq("id", id);
  }

  if (result.error && !hasCompletedTechnician) {
    const errorMessage = String(result.error.message || "").toLowerCase();
    const laborNullViolation = errorMessage.includes("labor_amount") && (errorMessage.includes("null") || errorMessage.includes("not-null") || errorMessage.includes("not null"));
    if (laborNullViolation) {
      const fallbackCompletionPayload = {
        ...legacyPayload,
        labor_amount: 0,
        labor_calculated_at: null,
      };

      result = await supabaseClient
        .from("cleaning_tasks")
        .update(fallbackCompletionPayload)
        .eq("id", id);
    }
  }

  if (result.error) {
    alert("Error completing cleaning: " + result.error.message);
    return;
  }

  taskTechnicianSelections.delete(id);
  taskWeeklyServiceLevelSelections.delete(id);
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
  if (propertyGateAccessInstructions) propertyGateAccessInstructions.value = "";
  if (propertyServiceNotes) propertyServiceNotes.value = "";
  if (propertyEquipmentServiceInfo) propertyEquipmentServiceInfo.value = "";
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
  if (propertyWeeklyLaborRate) propertyWeeklyLaborRate.value = 0;
  if (propertyContractRevenueAmount) propertyContractRevenueAmount.value = 0;
  if (propertyContractRateBasis) propertyContractRateBasis.value = CONTRACT_RATE_BASIS_NONE;
  if (propertyGuestReadyLaborRate) propertyGuestReadyLaborRate.value = 0;
  if (propertyAdditionalLaborRate) propertyAdditionalLaborRate.value = 0;
  if (propertyDefaultCleaningRate) propertyDefaultCleaningRate.value = 0;
  if (propertySameDaySurcharge) propertySameDaySurcharge.value = 0;
  if (propertyTaxable) propertyTaxable.value = "yes";
  if (propertyTaxRate) propertyTaxRate.value = 0;
  if (propertyPaymentTerms) propertyPaymentTerms.value = DEFAULT_INVOICE_TERMS;
  if (propertyInvoiceNotes) propertyInvoiceNotes.value = "";
  if (propertyCompanyBranch) propertyCompanyBranch.value = COMPANY_BRANCH_GUEST_READY;
  if (propertyStatus) propertyStatus.value = "active";
  if (propertyPoolServiceActive) propertyPoolServiceActive.value = "yes";
  if (propertyHousekeepingServiceActive) propertyHousekeepingServiceActive.value = "no";
  if (propertyHousekeepingDefaultCharge) propertyHousekeepingDefaultCharge.value = 0;
  if (propertyHousekeepingLaborAmount) propertyHousekeepingLaborAmount.value = 0;
  if (propertyServiceFrequency) propertyServiceFrequency.value = SERVICE_FREQUENCY_WEEKLY;
  if (propertyBiweeklyAnchorDate) propertyBiweeklyAnchorDate.value = "";
  if (propertyLawnServiceActive) propertyLawnServiceActive.value = "no";
  if (propertyLawnServiceFrequency) propertyLawnServiceFrequency.value = SERVICE_FREQUENCY_WEEKLY;
  if (propertyLawnServiceDay) propertyLawnServiceDay.value = "Wednesday";
  if (propertyLawnBiweeklyAnchorDate) propertyLawnBiweeklyAnchorDate.value = "";
  if (propertyLawnDefaultCharge) propertyLawnDefaultCharge.value = 0;
  if (propertyLawnLaborAmount) propertyLawnLaborAmount.value = 0;
  syncPropertyServiceFrequencyDependentFields();
  syncLawnServiceFrequencyDependentFields();
}

function toggleInvoiceMarker(taskId) {
  if (isManagerUser()) {
    reconcileManagerTask(taskId, "task");
    return;
  }
  if (!requireAdminAccess()) return;
  const task = cleaningTasks.find(t => t.id === taskId);
  if (!task) return;

  if (isTaskLinkedToFinalizedInvoice(task)) {
    alert("This task is already linked to a finalized invoice and cannot be changed.");
    return;
  }
  
  const newInvoiced = !task.invoiced;
  const updatePayload = { invoiced: newInvoiced };
  const previousCharge = task.charge;

  // Reconciling locks in the effective charge (task charge, or property default fallback) so later rate changes don't alter this task's billed amount.
  if (newInvoiced && (task.service_type === "Weekly Standard" || isLawnTask(task)) && !(Number(task.charge || 0) > 0)) {
    const effectiveCharge = getTaskBillingAmount(task);
    if (effectiveCharge > 0) {
      updatePayload.charge = effectiveCharge;
    }
  }

  // Optimistically update UI
  task.invoiced = newInvoiced;
  if ("charge" in updatePayload) {
    task.charge = updatePayload.charge;
  }
  renderTaskViews();
  refreshBillingCard();
  
  // Update database
  supabaseClient
    .from("cleaning_tasks")
    .update(updatePayload)
    .eq("id", taskId)
    .then(({ error }) => {
      if (error) {
        // Revert on error
        task.invoiced = !newInvoiced;
        task.charge = previousCharge;
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
  const todayString = getBusinessDateValue();

  console.log("[TodayView] Today date string:", todayString);

  const todayTasks = cleaningTasks.filter((task) => {
    if (!taskMatchesActiveWorkspace(task)) return false;
    if (!task.service_date) return false;
    if (shouldSuppressWeeklyStandardTaskDisplay(task)) return false;
    return task.service_date === todayString;
  });

  console.log("[TodayView] Tasks matching today:", todayTasks.length, todayTasks.map(t => ({ id: t.id, service_date: t.service_date, service_type: t.service_type })));

  return todayTasks.sort((a, b) => a.service_date.localeCompare(b.service_date));
}

function isTaskVisibleInOperationalSchedule(task, { matchActiveWorkspace = true } = {}) {
  if (matchActiveWorkspace && !taskMatchesActiveWorkspace(task)) return false;
  if (!task.service_date) return false;
  if (shouldSuppressWeeklyStandardTaskDisplay(task)) return false;

  const status = String(task.status || "").trim().toLowerCase();
  return status !== "cancelled";
}

function getUpcomingCleaningTasks() {
  const today = parseDateString(getBusinessDateValue());
  const endDate = new Date(today);
  endDate.setUTCDate(endDate.getUTCDate() + 7);

  const todayString = formatIsoDateUtc(today);
  const endString = formatIsoDateUtc(endDate);

  console.log("Today's date string:", todayString);
  console.log("Seven-days-out date string:", endString);

  const filteredTasks = cleaningTasks
    .filter((task) => {
      if (!isTaskVisibleInOperationalSchedule(task)) return false;

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
  if (!isTaskGuestReady(task) && !isHousekeepingTask(task)) return null;

  const taskDate = normalizeDateKey(
    isHousekeepingTask(task)
      ? task?.suggested_date || task?.original_service_date || task?.service_date || task?.scheduled_date
      : task?.service_date || task?.scheduled_date || task?.serviceDate || task?.date
  );
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

function getHousekeepingTurnoverContext(task) {
  if (!isHousekeepingTask(task)) return null;

  const checkoutDate = normalizeDateKey(task?.suggested_date || task?.original_service_date || task?.service_date || task?.scheduled_date);
  const taskProperty = getTaskPropertyMatchInfo(task);
  if (!checkoutDate || !taskProperty.propertyId) return null;

  const nextCheckInDate = reservations
    .filter((reservation) => reservationMatchesTaskProperty(reservation, taskProperty))
    .map((reservation) => normalizeDateKey(reservation?.check_in ?? reservation?.checkIn ?? reservation?.startDate))
    .filter((checkInDate) => checkInDate && checkInDate >= checkoutDate)
    .sort()[0] || null;

  return {
    checkoutDate,
    nextCheckInDate,
    sameDayTurnover: nextCheckInDate === checkoutDate,
    urgent: Boolean(nextCheckInDate && nextCheckInDate <= getBusinessDateValue() && String(task?.status || "Scheduled").toLowerCase() !== "completed"),
  };
}

function getHousekeepingOperationalMarkup(task, { compact = false } = {}) {
  const context = getHousekeepingTurnoverContext(task);
  if (!context) return "";
  if (compact) {
    return context.nextCheckInDate
      ? `<div class="task-line"><small>Checkout: ${context.checkoutDate} · Next check-in: ${context.nextCheckInDate}</small></div>`
      : `<div class="task-line"><small>Checkout: ${context.checkoutDate}</small></div>`;
  }
  return `
    <div><strong>Checkout Date:</strong> ${context.checkoutDate}</div>
    ${context.nextCheckInDate ? `<div><strong>Next Check-In:</strong> ${context.nextCheckInDate}</div>` : ""}`;
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
  if (getCarryForwardInfo(task)) return false;

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

function getEffectiveWeeklyStandardCharge(task, property) {
  const rawCharge = Number(task?.charge || 0);
  if (rawCharge > 0) return rawCharge;
  const defaultRate = Number(property?.default_cleaning_rate || 0);
  return defaultRate > 0 ? defaultRate : 0;
}

function getTaskBillingContext(task) {
  if (isHousekeepingTask(task)) {
    const amount = Number(task.charge || 0);
    return {
      billableAmount: amount,
      isBillable: amount > 0,
      billingReasonLabel: amount > 0 ? "Housekeeping Charge" : "No Housekeeping Charge",
    };
  }

  if (isLawnTask(task)) {
    const property = properties.find((item) => item.id === task.property_id);
    const rawCharge = Number(task.charge || 0);
    const defaultCharge = Number(property?.lawn_default_charge || 0);
    const amount = rawCharge > 0 ? rawCharge : defaultCharge;
    return {
      billableAmount: amount,
      isBillable: amount > 0,
      billingReasonLabel: rawCharge > 0 ? "Lawn Charge" : "Default Lawn Charge",
    };
  }

  if (!isTaskGuestReady(task)) {
    if (task.service_type === "Weekly Standard") {
      const property = properties.find((p) => p.id === task.property_id);
      const rawCharge = Number(task.charge || 0);
      const effectiveCharge = getEffectiveWeeklyStandardCharge(task, property);
      const isManualOverride = rawCharge > 0 && hasManualBillingOverride(task);
      const billingReasonLabel = effectiveCharge <= 0
        ? "Included"
        : isManualOverride
          ? "Manual Override"
          : rawCharge > 0
            ? "Manual Charge"
            : "Standard Cleaning Rate";
      return {
        billableAmount: effectiveCharge,
        isBillable: effectiveCharge > 0,
        billingReasonLabel,
      };
    }
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

function getPropertyLaborRules(property) {
  return {
    weeklyServiceLabor: Math.max(0, Number(property?.weekly_service_labor || 0)),
    guestReadyServiceLabor: Math.max(0, Number(property?.guest_ready_service_labor || 0)),
    additionalCleaningLabor: Math.max(0, Number(property?.additional_cleaning_labor || 0)),
    lawnServiceLabor: Math.max(0, Number(property?.lawn_labor_amount || 0)),
    housekeepingLabor: Math.max(0, Number(property?.housekeeping_labor_amount || 0)),
  };
}

function isManualTask(task) {
  return String(task?.service_type || "").trim().toLowerCase() === "manual";
}

function getLaborAmountForTask(task, property) {
  const rules = getPropertyLaborRules(property);
  const serviceType = String(task?.service_type || "").trim();

  if (isLawnTask(task)) {
    return rules.lawnServiceLabor;
  }

  if (isHousekeepingTask(task)) {
    return rules.housekeepingLabor;
  }

  if (serviceType === "Weekly Standard") {
    const weeklyLevel = normalizeWeeklyServiceLevel(task?.weekly_service_level);
    const multiplier = weeklyLevel === WEEKLY_SERVICE_LEVEL_HEALTH ? 0.5 : 1;
    return Number((rules.weeklyServiceLabor * multiplier).toFixed(2));
  }

  if (isTaskGuestReady(task)) {
    return rules.guestReadyServiceLabor;
  }

  if (isManualTask(task)) {
    return null;
  }

  return rules.additionalCleaningLabor;
}

function getSelectedTechnicianForTask(task) {
  if (!task) return null;

  const selectedTechnicianId = String(taskTechnicianSelections.get(task.id) || "").trim();
  if (selectedTechnicianId) {
    const byId = findTechnicianById(selectedTechnicianId);
    if (byId?.active !== false) {
      return byId;
    }
  }

  const completedByTechnicianId = String(task.completed_by_technician_id || "").trim();
  if (completedByTechnicianId) {
    const byCompletedId = findTechnicianById(completedByTechnicianId);
    if (byCompletedId?.active !== false) {
      return byCompletedId;
    }
  }

  const taskTechnicianId = String(task.technician_id || "").trim();
  if (taskTechnicianId) {
    const byTaskId = findTechnicianById(taskTechnicianId);
    if (byTaskId?.active !== false) {
      return byTaskId;
    }
  }

  const fallbackName = String(task.completed_by_technician_name || task.technician_name || task.technician || "").trim();
  return findActiveTechnicianByName(fallbackName);
}

function getTaskCardTechnicianSelection(task) {
  const selected = getSelectedTechnicianForTask(task);
  return String(selected?.id || "").trim();
}

function buildTaskTechnicianOptionsMarkup(selectedTechnicianId = "") {
  const selectedId = String(selectedTechnicianId || "").trim();
  const activeRows = getActiveTechnicians();
  const options = activeRows.map((technician) => {
    const optionId = String(technician.id || "").trim();
    const selectedAttr = optionId && optionId === selectedId ? " selected" : "";
    return `<option value="${escapeHtml(optionId)}"${selectedAttr}>${escapeHtml(technician.name || "")}</option>`;
  });
  options.unshift(`<option value="">Select technician...</option>`);
  return options.join("");
}

function setTaskCardTechnician(taskId, technicianId) {
  const normalizedTaskId = String(taskId || "").trim();
  const normalizedTechnicianId = String(technicianId || "").trim();
  if (!normalizedTaskId) return;

  if (!normalizedTechnicianId) {
    taskTechnicianSelections.delete(normalizedTaskId);
    return;
  }

  const technician = findTechnicianById(normalizedTechnicianId);
  if (!technician || technician.active === false) {
    taskTechnicianSelections.delete(normalizedTaskId);
    return;
  }

  taskTechnicianSelections.set(normalizedTaskId, normalizedTechnicianId);
}

function setTaskCardWeeklyServiceLevel(taskId, serviceLevel) {
  const normalizedTaskId = String(taskId || "").trim();
  if (!normalizedTaskId) return;
  taskWeeklyServiceLevelSelections.set(normalizedTaskId, normalizeWeeklyServiceLevel(serviceLevel));
}

function renderTaskWeeklyServiceLevelSelector(task, options = {}) {
  if (String(task?.service_type || "") !== "Weekly Standard") return "";

  const compact = options.compact === true;
  const isCompleted = String(task?.status || "") === "Completed";
  const selectedLevel = getWeeklyServiceLevelForTask(task);
  if (isStaffUser()) {
    return `<div class="task-line"><small>Service Level: ${getWeeklyServiceLevelLabel(selectedLevel)}</small></div>`;
  }
  const selectClass = compact ? "task-tech-select task-tech-select-compact" : "task-tech-select";

  const selectMarkup = `
    <select class="${selectClass}" onchange="setTaskCardWeeklyServiceLevel('${task.id}', this.value)">
      <option value="${WEEKLY_SERVICE_LEVEL_FULL}" ${selectedLevel === WEEKLY_SERVICE_LEVEL_FULL ? "selected" : ""}>Full Service</option>
      <option value="${WEEKLY_SERVICE_LEVEL_HEALTH}" ${selectedLevel === WEEKLY_SERVICE_LEVEL_HEALTH ? "selected" : ""}>Health Check</option>
    </select>
  `;

  if (!isCompleted) {
    return `
      <div class="task-line task-tech-select-row">
        <small>Service Level:</small>
        ${selectMarkup}
      </div>
    `;
  }

  return `
    <div class="task-line"><small>Service Level: ${getWeeklyServiceLevelLabel(selectedLevel)}</small></div>
    <div class="task-line task-tech-select-row">
      <small>Correct Service Level:</small>
      ${selectMarkup}
      <button type="button" class="task-tech-save-btn" onclick="saveCompletedTaskWeeklyServiceLevel('${task.id}')">Save</button>
    </div>
  `;
}

async function saveCompletedTaskWeeklyServiceLevel(taskId, serviceLevel = "") {
  const normalizedTaskId = String(taskId || "").trim();
  if (!normalizedTaskId) return;

  const task = cleaningTasks.find((item) => String(item?.id || "") === normalizedTaskId);
  if (!task) {
    alert("Task not found.");
    return;
  }

  if (String(task.status || "") !== "Completed") {
    alert("Only completed tasks can be corrected here.");
    return;
  }

  if (String(task.service_type || "") !== "Weekly Standard") {
    alert("Service level corrections only apply to Weekly Standard tasks.");
    return;
  }

  const nextLevel = normalizeWeeklyServiceLevel(serviceLevel || taskWeeklyServiceLevelSelections.get(normalizedTaskId) || task.weekly_service_level);
  const currentLevel = normalizeWeeklyServiceLevel(task.weekly_service_level);
  if (nextLevel === currentLevel) {
    taskWeeklyServiceLevelSelections.delete(normalizedTaskId);
    return;
  }

  if (isManagerUser()) {
    const selectedTechnician = getSelectedTechnicianForTask(task);
    const { error } = await supabaseClient.rpc("manager_update_task_operations", {
      target_task_id: normalizedTaskId,
      selected_technician_id: selectedTechnician?.id || null,
      selected_service_level: nextLevel,
      entered_notes: task.notes || "",
    });
    if (error) {
      alert("Could not save service level: " + error.message);
      return;
    }
    taskWeeklyServiceLevelSelections.delete(normalizedTaskId);
    await loadManagerOperationalData();
    return;
  }

  if (isLaborTaskMarkedPaid(task)) {
    const warning = "This labor has already been marked paid. Changing the service level will change the recorded labor amount. Continue?";
    if (!window.confirm(warning)) {
      return;
    }
  }

  const property = getPropertyById(task.property_id);
  if (!property) {
    alert("Property not found for this task.");
    return;
  }

  const recalculatedLabor = Number(getLaborAmountForTask({ ...task, weekly_service_level: nextLevel }, property) || 0);
  const updatePayload = {
    weekly_service_level: nextLevel,
    labor_amount: recalculatedLabor,
    labor_calculated_at: new Date().toISOString(),
  };

  let result = await supabaseClient
    .from("cleaning_tasks")
    .update(updatePayload)
    .eq("id", normalizedTaskId);

  if (result.error) {
    const message = String(result.error.message || "").toLowerCase();
    if (message.includes("weekly_service_level")) {
      result = await supabaseClient
        .from("cleaning_tasks")
        .update({
          labor_amount: recalculatedLabor,
          labor_calculated_at: updatePayload.labor_calculated_at,
        })
        .eq("id", normalizedTaskId);
    }
  }

  if (result.error) {
    alert(`Could not save weekly service level: ${result.error.message}`);
    return;
  }

  taskWeeklyServiceLevelSelections.delete(normalizedTaskId);
  await loadData();
}

window.saveCompletedTaskWeeklyServiceLevel = saveCompletedTaskWeeklyServiceLevel;

function hasTechnicianSnapshot(task) {
  const completedId = String(task?.completed_by_technician_id || task?.technician_id || "").trim();
  const completedName = String(task?.completed_by_technician_name || task?.technician_name || task?.technician || "").trim();
  return Boolean(completedId || completedName);
}

function isLaborSnapshotMissing(task) {
  if (String(task?.status || "") !== "Completed") return false;
  const hasKnownLabor = task?.labor_amount !== null && task?.labor_amount !== undefined && String(task?.labor_amount).trim() !== "";
  const hasCalculatedAt = Boolean(String(task?.labor_calculated_at || "").trim());
  return !hasKnownLabor || !hasCalculatedAt;
}

function getManualLaborInputValue(rawValue) {
  const raw = String(rawValue ?? "").trim();
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return NaN;
  return Math.max(0, parsed);
}

async function saveCompletedTaskTechnician(taskId, technicianId = "") {
  const normalizedTaskId = String(taskId || "").trim();
  if (!normalizedTaskId) return;

  const task = cleaningTasks.find((item) => String(item?.id || "") === normalizedTaskId);
  if (!task) {
    alert("Task not found.");
    return;
  }

  if (String(task.status || "") !== "Completed") {
    alert("Only completed tasks can be corrected here.");
    return;
  }

  const selectedTechnicianId = String(technicianId || taskTechnicianSelections.get(normalizedTaskId) || "").trim();
  if (!selectedTechnicianId) {
    alert("Select a technician first.");
    return;
  }

  const selectedTechnician = findTechnicianById(selectedTechnicianId);
  if (!selectedTechnician) {
    alert("Selected technician could not be found.");
    return;
  }

  if (isManagerUser()) {
    const { error } = await supabaseClient.rpc("manager_update_task_operations", {
      target_task_id: normalizedTaskId,
      selected_technician_id: selectedTechnician.id,
      selected_service_level: task.service_type === "Weekly Standard"
        ? getWeeklyServiceLevelForTask(task)
        : null,
      entered_notes: task.notes || "",
    });
    if (error) {
      alert("Could not save technician assignment: " + error.message);
      return;
    }
    taskTechnicianSelections.delete(normalizedTaskId);
    await loadManagerOperationalData();
    return;
  }

  const previousTechnicianId = String(task.completed_by_technician_id || task.technician_id || "").trim();
  const previousTechnicianName = String(task.completed_by_technician_name || task.technician_name || task.technician || "").trim();
  const technicianChanged = previousTechnicianId !== selectedTechnicianId || previousTechnicianName !== selectedTechnician.name;

  if (technicianChanged && isLaborTaskMarkedPaid(task)) {
    const warning = "This labor has already been marked paid. Changing the technician will change who this payment is attributed to. Continue?";
    if (!window.confirm(warning)) {
      return;
    }
  }

  const property = getPropertyById(task.property_id);
  const shouldCalculateLaborNow = !isManualTask(task) && !hasTechnicianSnapshot(task) && isLaborSnapshotMissing(task);
  const correctionPayload = {
    technician: selectedTechnician.name,
    technician_id: selectedTechnician.id,
    technician_name: selectedTechnician.name,
    completed_by_technician_id: selectedTechnician.id,
    completed_by_technician_name: selectedTechnician.name,
    labor_payable: isTechnicianPaidLabor(selectedTechnician),
  };

  if (shouldCalculateLaborNow) {
    correctionPayload.labor_amount = Number(getLaborAmountForTask(task, property) || 0);
    correctionPayload.labor_calculated_at = new Date().toISOString();
  }

  let result = await supabaseClient
    .from("cleaning_tasks")
    .update(correctionPayload)
    .eq("id", normalizedTaskId);

  const optionalCleaningTaskColumns = [
    "technician_id",
    "technician_name",
    "completed_by_technician_id",
    "completed_by_technician_name",
    "labor_amount",
    "labor_calculated_at",
    "labor_payable",
  ];

  let fallbackPayload = { ...correctionPayload };
  while (result.error) {
    const message = String(result.error.message || "").toLowerCase();
    const missingColumn = optionalCleaningTaskColumns.find((column) => message.includes(column));
    if (!missingColumn || !(missingColumn in fallbackPayload)) {
      break;
    }

    delete fallbackPayload[missingColumn];
    result = await supabaseClient
      .from("cleaning_tasks")
      .update(fallbackPayload)
      .eq("id", normalizedTaskId);
  }

  if (result.error) {
    alert(`Could not save technician correction: ${result.error.message}`);
    return;
  }

  taskTechnicianSelections.delete(normalizedTaskId);
  await loadData();
}

window.saveCompletedTaskTechnician = saveCompletedTaskTechnician;

async function saveCompletedTaskManualLabor(taskId, laborAmountInput = null) {
  const normalizedTaskId = String(taskId || "").trim();
  if (!normalizedTaskId) return;

  const task = cleaningTasks.find((item) => String(item?.id || "") === normalizedTaskId);
  if (!task) {
    alert("Task not found.");
    return;
  }

  if (String(task.status || "") !== "Completed") {
    alert("Only completed tasks can be updated here.");
    return;
  }

  if (!isManualTask(task)) {
    alert("Manual labor edits are only for Manual tasks.");
    return;
  }

  const inputValue = laborAmountInput !== null
    ? String(laborAmountInput)
    : String(document.getElementById(`manualLaborInput-${normalizedTaskId}`)?.value || "");
  const manualLaborAmount = getManualLaborInputValue(inputValue);
  if (manualLaborAmount === null || Number.isNaN(manualLaborAmount) || manualLaborAmount <= 0) {
    alert("Enter a valid labor amount greater than 0.");
    return;
  }

  const payload = {
    labor_amount: Number(manualLaborAmount),
    labor_calculated_at: new Date().toISOString(),
  };

  const { error } = await supabaseClient
    .from("cleaning_tasks")
    .update(payload)
    .eq("id", normalizedTaskId);

  if (error) {
    alert(`Could not save manual labor amount: ${error.message}`);
    return;
  }

  await loadData();
}

window.saveCompletedTaskManualLabor = saveCompletedTaskManualLabor;

function getTaskTechnicianDisplayName(task) {
  return String(task?.completed_by_technician_name || task?.technician_name || task?.technician || "").trim();
}

function renderTaskTechnicianSelector(task, options = {}) {
  const compact = options.compact === true;
  const status = String(task?.status || "");
  const isCompleted = status === "Completed";
  const technicianName = getTaskTechnicianDisplayName(task);
  if (isStaffUser() && isCompleted) {
    return `<div class="task-line"><small>Assigned Technician: ${escapeHtml(technicianName || "Unassigned")}</small></div>`;
  }
  if (isCompleted) {
    const selectedTechnicianId = String(taskTechnicianSelections.get(task.id) || task.completed_by_technician_id || task.technician_id || "").trim();
    const completedLabel = technicianName
      ? `Completed By: ${escapeHtml(technicianName)}`
      : "Technician Missing";
    return `
      <div class="task-line"><small>${completedLabel}</small></div>
      <div class="task-line task-tech-select-row">
        <small>Assign Technician:</small>
        <select class="task-tech-select${compact ? " task-tech-select-compact" : ""}" onchange="setTaskCardTechnician('${task.id}', this.value)">
          ${buildTaskTechnicianOptionsMarkup(selectedTechnicianId)}
        </select>
        <button type="button" class="task-tech-save-btn" onclick="saveCompletedTaskTechnician('${task.id}')">Save</button>
      </div>
    `;
  }

  const selectedTechnicianId = getTaskCardTechnicianSelection(task);
  const selectClass = compact ? "task-tech-select task-tech-select-compact" : "task-tech-select";
  return `
    <div class="task-line task-tech-select-row">
      <small>Technician:</small>
      <select class="${selectClass}" onchange="setTaskCardTechnician('${task.id}', this.value)">
        ${buildTaskTechnicianOptionsMarkup(selectedTechnicianId)}
      </select>
    </div>
  `;
}

function renderTaskLaborSnapshot(task) {
  if (!isAdminUser()) return "";
  if (String(task?.status || "") !== "Completed") return "";
  const hasTech = hasTechnicianSnapshot(task);
  const hasKnownLabor = task?.labor_amount !== null && task?.labor_amount !== undefined && String(task?.labor_amount).trim() !== "";
  const isManual = isManualTask(task);
  const laborValue = Number(task?.labor_amount);
  const manualLaborMissing = isManual && (!Number.isFinite(laborValue) || laborValue <= 0);

  if (!hasTech) {
    return `<div class="task-line"><small>Labor Pending - Assign Technician</small></div>`;
  }

  if (manualLaborMissing) {
    return `
      <div class="task-line"><small>Labor Amount Missing</small></div>
      <div class="task-line task-tech-select-row">
        <small>Labor Amount:</small>
        <input id="manualLaborInput-${task.id}" class="manual-labor-input" type="number" min="0" step="0.01" placeholder="0.00">
        <button type="button" class="task-tech-save-btn" onclick="saveCompletedTaskManualLabor('${task.id}')">Save Labor</button>
      </div>
    `;
  }

  if (!hasKnownLabor) {
    return `<div class="task-line"><small>Labor Pending</small></div>`;
  }

  return `<div class="task-line"><small>Labor: ${toMoney(Number(task?.labor_amount || 0))}</small></div>`;
}

function renderTaskPartsCost(task) {
  if (!isAdminUser()) return "";
  const partsCost = Number(task?.parts_cost || 0);
  if (!Number.isFinite(partsCost) || partsCost <= 0) return "";
  return `<div class="task-line"><small>Parts Cost: ${toMoney(partsCost)}</small></div>`;
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
    .filter((task) => {
      if (isTaskReconciled(task)) return true;
      if (task.service_type === "Weekly Standard") return false;
      return String(task.status || "").toLowerCase() === "completed";
    })
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
        serviceLabel: getServiceTypeDisplayLabel(task.service_type),
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

// SDS is billed as its own line, independent from the Guest Ready/Weekly charge on the same task.
function getSdsBillingReportRowsForFilters({
  startDate,
  endDate,
  selectedPropertyId = "",
  selectedClientName = "",
  includeInvoiced = true,
} = {}) {
  if (!startDate || !endDate) return [];

  const scopePropertyIds = new Set(resolvePropertyIdsForScope({ selectedPropertyId, selectedClientName }).map((id) => normalizePropertyId(id)));

  return cleaningTasks
    .filter((task) => isSameDayTurnoverTask(task))
    .filter((task) => scopePropertyIds.has(normalizePropertyId(task.property_id)))
    .filter((task) => {
      const taskDate = task.service_date || task.scheduled_date;
      return Boolean(taskDate && taskDate >= startDate && taskDate <= endDate);
    })
    .filter((task) => includeInvoiced ? true : !isSdsLinkedToFinalizedInvoice(task))
    .map((task) => {
      const property = properties.find((item) => normalizePropertyId(item.id) === normalizePropertyId(task.property_id));
      const taskDate = task.service_date || task.scheduled_date || "";
      const amount = getEffectiveSameDaySurcharge(task, property);
      return {
        id: `sds:${task.id}`,
        taskId: task.id,
        property_id: task.property_id,
        propertyName: property?.property_name || getPropertyName(task.property_id),
        clientName: String(property?.client_name || "").trim(),
        service_date: taskDate,
        serviceDate: taskDate,
        service_type: "Same-Day Turnover Surcharge",
        serviceLabel: "Same-Day Turnover Surcharge",
        billableAmount: amount,
        billingReasonLabel: "Same-Day Turnover Surcharge",
        quantity: 1,
        unit: "service",
        rate: amount,
        notes: "",
        invoiced: isSdsReconciled(task),
        invoice_id: task.same_day_surcharge_invoice_id || null,
        invoiced_invoice_id: task.same_day_surcharge_invoice_id || null,
      };
    })
    .filter((row) => Number(row.billableAmount || 0) > 0)
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

function renderBillingReportHeader(branding = null) {
  const profile = branding || getCompanyBrandingForBranch(COMPANY_BRANCH_GUEST_READY);
  const logoMarkup = profile.logoUrl
    ? `<img src="${profile.logoUrl}" alt="${profile.companyName} logo" class="company-logo billing-report-logo" onerror="this.style.display='none'">`
    : "";

  return `
    <div class="billing-report-header-block">
      ${logoMarkup}
      <div>
        <div class="billing-report-brand">${profile.companyName}</div>
        <div class="billing-report-brand-subtitle">${profile.tagline}</div>
      </div>
    </div>
  `;
}

function renderBillingReportFooter(branding = null) {
  const profile = branding || getCompanyBrandingForBranch(COMPANY_BRANCH_GUEST_READY);
  const contactParts = [];
  if (profile.phoneNumber) contactParts.push(profile.phoneNumber);
  if (profile.email) contactParts.push(profile.email);

  if (!contactParts.length) return "";

  return `<div class="billing-report-footer">${contactParts.join(" | ")}</div>`;
}

function populateLaborReportTechnicianOptions() {
  if (!laborReportTechnicianSelect) return;

  const previousValue = laborReportTechnicianSelect.value;
  const options = ['<option value="">All Technicians</option>'];

  getSortedTechnicians().forEach((technician) => {
    const technicianId = String(technician.id || "").trim();
    if (!technicianId) return;
    const labelSuffix = technician.active === false ? " (Inactive)" : "";
    options.push(`<option value="${escapeHtml(technicianId)}">${escapeHtml(technician.name || "Unnamed Technician")}${labelSuffix}</option>`);
  });

  laborReportTechnicianSelect.innerHTML = options.join("");

  const hasPrevious = Array.from(laborReportTechnicianSelect.options).some((option) => option.value === previousValue);
  laborReportTechnicianSelect.value = hasPrevious ? previousValue : "";
}

function getLaborCompletionDateKey(task) {
  const completedDate = normalizeDateKey(task?.completed_at || task?.completedAt || "");
  if (completedDate) return completedDate;
  return normalizeDateKey(task?.service_date || task?.scheduled_date || "");
}

function getLaborTaskTechnicianSnapshot(task) {
  const technicianId = String(task?.completed_by_technician_id || task?.technician_id || "").trim();
  const byId = technicianId ? findTechnicianById(technicianId) : null;
  const rawTechnicianName = String(
    task?.completed_by_technician_name
    || task?.technician_name
    || task?.technician
    || byId?.name
    || ""
  ).trim();
  const technicianName = rawTechnicianName || "Unassigned";

  return {
    technicianId,
    technicianName,
    hasTechnician: Boolean(technicianId || rawTechnicianName),
  };
}

function getLaborServiceCategory(task) {
  const serviceType = String(task?.service_type || "").trim().toLowerCase();
  if (isHousekeepingTask(task)) {
    return "housekeeping";
  }
  if (serviceType === "weekly standard") {
    return "weekly";
  }

  if (isManualTask(task)) {
    return "manual";
  }

  if (isTaskGuestReady(task)) {
    const hasAdditionalIndicators = Boolean(
      task?.off_cycle
      || Number(task?.charge || 0) > 0
      || hasManualBillingOverride(task)
      || serviceType.includes("off-cycle")
      || serviceType.includes("off cycle")
      || serviceType.includes("additional")
      || serviceType.includes("billable")
    );
    return hasAdditionalIndicators ? "additional" : "guestReady";
  }

  return "additional";
}

function getLaborServiceTypeDisplay(task) {
  const serviceType = String(task?.service_type || "Manual").trim() || "Manual";
  if (serviceType !== "Weekly Standard") return serviceType;
  return `Weekly Standard - ${getWeeklyServiceLevelLabel(task?.weekly_service_level)}`;
}

function getLaborServiceCategoryLabel(category) {
  if (category === "weekly") return "Weekly Standard";
  if (category === "guestReady") return "Guest Ready";
  if (category === "housekeeping") return "Housekeeping";
  if (category === "manual") return "Manual";
  return "Additional / Billable";
}

function isLaborTaskMarkedPaid(task) {
  return task?.labor_paid === true || String(task?.labor_paid || "").toLowerCase() === "true";
}

function formatLaborPaidAt(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleString();
}

function getLaborReportRows({ startDate, endDate, selectedTechnicianId = "" } = {}) {
  const selectedId = String(selectedTechnicianId || "").trim();
  const selectedTechnician = selectedId ? findTechnicianById(selectedId) : null;

  return cleaningTasks
    .filter((task) => String(task?.status || "").trim().toLowerCase() === "completed")
    .map((task) => {
      const isManual = isManualTask(task);
      const laborAmount = Number(task?.labor_amount);
      const completionDateKey = getLaborCompletionDateKey(task);
      if (!completionDateKey) return null;
      if (!Number.isFinite(laborAmount)) return null;
      if (isManual && laborAmount <= 0) return null;

      const { technicianId, technicianName, hasTechnician } = getLaborTaskTechnicianSnapshot(task);
      if (!hasTechnician) return null;
      const technicianNameNormalized = technicianName.toLowerCase();
      const selectedTechNameNormalized = String(selectedTechnician?.name || "").trim().toLowerCase();

      if (selectedId) {
        const idMatch = technicianId && technicianId === selectedId;
        const nameMatch = !technicianId && selectedTechNameNormalized && technicianNameNormalized === selectedTechNameNormalized;
        if (!idMatch && !nameMatch) return null;
      }

      if (startDate && completionDateKey < startDate) return null;
      if (endDate && completionDateKey > endDate) return null;

      const propertyName = getPropertyName(task.property_id);
      const serviceType = getLaborServiceTypeDisplay(task);
      const category = getLaborServiceCategory(task);
      const isPaid = isLaborTaskMarkedPaid(task);
      const paidAt = task?.labor_paid_at || null;

      return {
        taskId: String(task?.id || "").trim(),
        task,
        completionDateKey,
        completionDateLabel: formatInvoicePrintDateValue(completionDateKey),
        technicianId,
        technicianName,
        propertyName,
        serviceType,
        category,
        isManual,
        laborAmount,
        isPaid,
        paidAt,
        paidAtLabel: formatLaborPaidAt(paidAt),
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.completionDateKey !== b.completionDateKey) return a.completionDateKey.localeCompare(b.completionDateKey);
      if (a.technicianName !== b.technicianName) return a.technicianName.localeCompare(b.technicianName);
      if (a.propertyName !== b.propertyName) return a.propertyName.localeCompare(b.propertyName);
      return a.serviceType.localeCompare(b.serviceType);
    });
}

function getLaborExceptionRows({ startDate, endDate, selectedTechnicianId = "" } = {}) {
  const selectedId = String(selectedTechnicianId || "").trim();
  const selectedTechnician = selectedId ? findTechnicianById(selectedId) : null;
  const selectedTechNameNormalized = String(selectedTechnician?.name || "").trim().toLowerCase();

  return cleaningTasks
    .filter((task) => String(task?.status || "").trim().toLowerCase() === "completed")
    .map((task) => {
      const completionDateKey = getLaborCompletionDateKey(task);
      if (!completionDateKey) return null;
      if (startDate && completionDateKey < startDate) return null;
      if (endDate && completionDateKey > endDate) return null;

      const snapshot = getLaborTaskTechnicianSnapshot(task);
      const isManual = isManualTask(task);
      const laborRaw = task?.labor_amount;
      const laborNumber = Number(laborRaw);
      const hasKnownLabor = laborRaw !== null && laborRaw !== undefined && String(laborRaw).trim() !== "" && Number.isFinite(laborNumber);
      const manualLaborMissing = isManual && (!Number.isFinite(laborNumber) || laborNumber <= 0);
      const missingTechnician = !snapshot.hasTechnician;

      if (!missingTechnician && !manualLaborMissing) return null;

      if (selectedId) {
        if (missingTechnician) return null;
        const idMatch = snapshot.technicianId && snapshot.technicianId === selectedId;
        const nameMatch = !snapshot.technicianId && selectedTechNameNormalized && snapshot.technicianName.toLowerCase() === selectedTechNameNormalized;
        if (!idMatch && !nameMatch) return null;
      }

      const serviceType = getLaborServiceTypeDisplay(task);

      let reason = "missing_technician";
      let reasonLabel = "Technician Missing";
      if (!missingTechnician && manualLaborMissing) {
        reason = "manual_labor_missing";
        reasonLabel = "Labor Amount Missing";
      }

      return {
        taskId: String(task?.id || "").trim(),
        completionDateKey,
        completionDateLabel: formatInvoicePrintDateValue(completionDateKey),
        propertyName: getPropertyName(task.property_id),
        technicianName: snapshot.technicianName,
        technicianId: snapshot.technicianId,
        serviceType,
        reason,
        reasonLabel,
        laborAmount: hasKnownLabor ? Number(laborRaw || 0) : null,
        laborLabel: hasKnownLabor ? toMoney(Number(laborRaw || 0)) : "Labor Pending",
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.completionDateKey !== b.completionDateKey) return a.completionDateKey.localeCompare(b.completionDateKey);
      if (a.propertyName !== b.propertyName) return a.propertyName.localeCompare(b.propertyName);
      return a.serviceType.localeCompare(b.serviceType);
    });
}

async function setLaborTaskPaymentStatus(taskId, markAsPaid) {
  const normalizedTaskId = String(taskId || "").trim();
  if (!normalizedTaskId) return;

  const task = cleaningTasks.find((item) => String(item?.id || "") === normalizedTaskId);
  if (!task) {
    alert("Labor task not found.");
    return;
  }

  const technicianSnapshot = String(task?.completed_by_technician_name || task?.technician_name || task?.technician || "Unassigned").trim() || "Unassigned";
  const propertyName = getPropertyName(task.property_id);
  const laborAmountLabel = toMoney(Number(task?.labor_amount || 0));

  const confirmationMessage = markAsPaid
    ? `Mark ${laborAmountLabel} labor for ${propertyName} completed by ${technicianSnapshot} as paid?`
    : `Reverse paid status for ${laborAmountLabel} labor for ${propertyName} completed by ${technicianSnapshot}?`;

  const confirmed = window.confirm(confirmationMessage);
  if (!confirmed) return;

  const paymentPayload = {
    labor_paid: Boolean(markAsPaid),
    labor_paid_at: markAsPaid ? new Date().toISOString() : null,
  };

  const { data, error } = await supabaseClient
    .from("cleaning_tasks")
    .update(paymentPayload)
    .eq("id", normalizedTaskId)
    .select("id, labor_paid, labor_paid_at")
    .single();

  if (error) {
    const message = String(error.message || "");
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes("labor_paid") || lowerMessage.includes("labor_paid_at")) {
      alert("Labor payment columns are missing in your database. Run the labor payment migration, then try again.");
      return;
    }
    alert(`Could not update labor payment status: ${message}`);
    return;
  }

  const rowIndex = cleaningTasks.findIndex((item) => String(item?.id || "") === normalizedTaskId);
  if (rowIndex >= 0) {
    cleaningTasks[rowIndex] = {
      ...cleaningTasks[rowIndex],
      labor_paid: data?.labor_paid === true,
      labor_paid_at: data?.labor_paid_at || null,
    };
  }

  renderLaborReport();
}

window.setLaborTaskPaymentStatus = setLaborTaskPaymentStatus;

function groupLaborRowsByTechnician(rows) {
  const groups = new Map();

  rows.forEach((row) => {
    const key = row.technicianId ? `id:${row.technicianId}` : `name:${String(row.technicianName || "").toLowerCase()}`;
    if (!groups.has(key)) {
      groups.set(key, {
        technicianId: row.technicianId,
        technicianName: row.technicianName || "Unassigned",
        servicesCompleted: 0,
        laborDue: 0,
        breakdown: {
          weekly: { count: 0, labor: 0 },
          guestReady: { count: 0, labor: 0 },
          manual: { count: 0, labor: 0 },
          additional: { count: 0, labor: 0 },
        },
      });
    }

    const group = groups.get(key);
    group.servicesCompleted += 1;
    group.laborDue += Number(row.laborAmount || 0);

    const category = row.category || "additional";
    if (!group.breakdown[category]) {
      group.breakdown[category] = { count: 0, labor: 0 };
    }
    group.breakdown[category].count += 1;
    group.breakdown[category].labor += Number(row.laborAmount || 0);
  });

  return Array.from(groups.values()).sort((a, b) => a.technicianName.localeCompare(b.technicianName));
}

function formatLaborReportHeadline(startDate, endDate) {
  if (!startDate || !endDate) return "Labor Report";
  if (startDate !== endDate) return "Labor Report";

  const parsed = parseDateString(startDate);
  const label = parsed.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  return `Labor Report - ${label}`;
}

function renderLaborReport() {
  if (!laborReportContainer) return;
  populateLaborReportTechnicianOptions();

  const startDate = laborReportStartDate?.value || "";
  const endDate = laborReportEndDate?.value || "";
  const selectedTechnicianId = laborReportTechnicianSelect?.value || "";
  const selectedPaymentStatus = laborReportPaymentStatus?.value || "unpaid";
  const selectedTechnician = selectedTechnicianId ? findTechnicianById(selectedTechnicianId) : null;

  if (!startDate || !endDate) {
    laborReportContainer.innerHTML = `<div class="billing-report-sheet"><div class="empty">Select a start and end date to run the labor report.</div></div>`;
    return;
  }

  if (startDate > endDate) {
    laborReportContainer.innerHTML = `<div class="billing-report-sheet"><div class="empty">Start date must be on or before end date.</div></div>`;
    return;
  }

  const allRows = getLaborReportRows({ startDate, endDate, selectedTechnicianId });
  const exceptionRows = getLaborExceptionRows({ startDate, endDate, selectedTechnicianId });
  const rows = allRows.filter((row) => {
    if (selectedPaymentStatus === "paid") return row.isPaid;
    if (selectedPaymentStatus === "unpaid") return !row.isPaid;
    return true;
  });

  const technicianGroups = groupLaborRowsByTechnician(rows);
  const displayedServices = rows.length;
  const totalLabor = allRows.reduce((sum, row) => sum + Number(row.laborAmount || 0), 0);
  const paidLabor = allRows
    .filter((row) => row.isPaid)
    .reduce((sum, row) => sum + Number(row.laborAmount || 0), 0);
  const unpaidLabor = totalLabor - paidLabor;
  const techniciansWorked = new Set(allRows.map((row) => row.technicianId || String(row.technicianName || "").toLowerCase())).size;
  const isSingleDay = startDate === endDate;

  const summaryCards = `
    <div class="labor-summary-grid">
      <div class="labor-summary-card">
        <div class="labor-summary-label">Total Labor</div>
        <div class="labor-summary-value">${toMoney(totalLabor)}</div>
      </div>
      <div class="labor-summary-card">
        <div class="labor-summary-label">Paid Labor</div>
        <div class="labor-summary-value">${toMoney(paidLabor)}</div>
      </div>
      <div class="labor-summary-card">
        <div class="labor-summary-label">Unpaid Labor</div>
        <div class="labor-summary-value">${toMoney(unpaidLabor)}</div>
      </div>
      <div class="labor-summary-card">
        <div class="labor-summary-label">Displayed Services</div>
        <div class="labor-summary-value">${displayedServices}</div>
      </div>
      <div class="labor-summary-card">
        <div class="labor-summary-label">Technicians Worked</div>
        <div class="labor-summary-value">${techniciansWorked}</div>
      </div>
      <div class="labor-summary-card labor-summary-card-warning">
        <div class="labor-summary-label">Labor Exceptions</div>
        <div class="labor-summary-value">${exceptionRows.length}</div>
      </div>
    </div>
  `;

  const selectedTechnicianSummary = selectedTechnician
    ? `
      <div class="labor-selected-tech-card">
        <h3>${escapeHtml(selectedTechnician.name || "Technician")}</h3>
        <div>${allRows.length} Completed Service${allRows.length === 1 ? "" : "s"} (before payment filter)</div>
        <div><strong>${toMoney(totalLabor)} Total Labor</strong></div>
      </div>
    `
    : "";

  const tableRows = rows.length
    ? rows.map((row) => `
        <tr>
          <td>${escapeHtml(row.completionDateLabel)}</td>
          <td>${escapeHtml(row.technicianName)}</td>
          <td>${escapeHtml(row.propertyName)}</td>
          <td>${escapeHtml(row.serviceType)}</td>
          <td class="route-frag-money">${toMoney(row.laborAmount)}</td>
          <td>
            <div class="labor-payment-state ${row.isPaid ? "is-paid" : "is-unpaid"}">${row.isPaid ? "Paid" : "Unpaid"}</div>
            ${row.isPaid && row.paidAtLabel ? `<div class="labor-paid-at">${escapeHtml(row.paidAtLabel)}</div>` : ""}
          </td>
          <td class="labor-action-col">
            ${row.taskId ? `
              <button
                type="button"
                class="labor-payment-action"
                onclick="setLaborTaskPaymentStatus('${escapeHtml(row.taskId)}', ${row.isPaid ? "false" : "true"})"
              >${row.isPaid ? "Reverse Paid" : "Mark Paid"}</button>
            ` : ""}
          </td>
        </tr>
      `).join("")
    : `<tr><td colspan="7">No completed labor tasks found for the selected filters.</td></tr>`;

  const exceptionTableRows = exceptionRows.length
    ? exceptionRows.map((row) => {
      const selectedTechnicianIdForTask = String(taskTechnicianSelections.get(row.taskId) || "").trim();
      const existingLaborValue = row.laborAmount !== null && row.laborAmount !== undefined ? Number(row.laborAmount || 0) : "";
      return `
        <tr>
          <td>${escapeHtml(row.completionDateLabel)}</td>
          <td>${escapeHtml(row.propertyName)}</td>
          <td>${escapeHtml(row.serviceType)}</td>
          <td>${escapeHtml(row.reasonLabel)}</td>
          <td class="route-frag-money">${escapeHtml(row.laborLabel)}</td>
          <td>
            <div class="labor-exception-actions">
              ${row.reason === "missing_technician" ? `
                <select class="task-tech-select" onchange="setTaskCardTechnician('${row.taskId}', this.value)">
                  ${buildTaskTechnicianOptionsMarkup(selectedTechnicianIdForTask)}
                </select>
                <button type="button" class="task-tech-save-btn" onclick="saveCompletedTaskTechnician('${row.taskId}')">Assign Technician</button>
              ` : `
                <input id="manualLaborInput-${row.taskId}" class="manual-labor-input" type="number" min="0" step="0.01" value="${existingLaborValue}">
                <button type="button" class="task-tech-save-btn" onclick="saveCompletedTaskManualLabor('${row.taskId}')">Save Labor</button>
              `}
            </div>
          </td>
        </tr>
      `;
    }).join("")
    : `<tr><td colspan="6">No labor exceptions for the selected date range.</td></tr>`;

  const technicianTotalsSection = technicianGroups.length
    ? `
      <section class="labor-tech-totals-section">
        <h3>Technician Totals</h3>
        <div class="labor-tech-totals-grid">
          ${technicianGroups.map((group) => `
            <article class="labor-tech-total-card">
              <h4>${escapeHtml(group.technicianName)}</h4>
              <div>Services Completed: ${group.servicesCompleted}</div>
              <div>Labor Due: <strong>${toMoney(group.laborDue)}</strong></div>
              <div class="labor-breakdown-list">
                <div class="labor-breakdown-item">
                  <div>${getLaborServiceCategoryLabel("weekly")}</div>
                  <div>${group.breakdown.weekly.count} service${group.breakdown.weekly.count === 1 ? "" : "s"}</div>
                  <div>${toMoney(group.breakdown.weekly.labor)}</div>
                </div>
                <div class="labor-breakdown-item">
                  <div>${getLaborServiceCategoryLabel("guestReady")}</div>
                  <div>${group.breakdown.guestReady.count} service${group.breakdown.guestReady.count === 1 ? "" : "s"}</div>
                  <div>${toMoney(group.breakdown.guestReady.labor)}</div>
                </div>
                <div class="labor-breakdown-item">
                  <div>${getLaborServiceCategoryLabel("manual")}</div>
                  <div>${group.breakdown.manual.count} service${group.breakdown.manual.count === 1 ? "" : "s"}</div>
                  <div>${toMoney(group.breakdown.manual.labor)}</div>
                </div>
                <div class="labor-breakdown-item">
                  <div>${getLaborServiceCategoryLabel("additional")}</div>
                  <div>${group.breakdown.additional.count} service${group.breakdown.additional.count === 1 ? "" : "s"}</div>
                  <div>${toMoney(group.breakdown.additional.labor)}</div>
                </div>
              </div>
            </article>
          `).join("")}
        </div>
        <div class="billing-report-grand-total">Displayed Labor Due${isSingleDay ? " Today" : ""}: ${toMoney(rows.reduce((sum, row) => sum + Number(row.laborAmount || 0), 0))}</div>
      </section>
    `
    : "";

  laborReportContainer.innerHTML = `
    <div class="billing-report-sheet labor-report-sheet">
      ${renderBillingReportHeader()}
      <h2 class="billing-report-title">${escapeHtml(formatLaborReportHeadline(startDate, endDate))}</h2>
      <div class="billing-report-meta">Date Range: ${escapeHtml(startDate)} to ${escapeHtml(endDate)}</div>
      <div class="billing-report-meta">Technician Filter: ${escapeHtml(selectedTechnician?.name || "All Technicians")}</div>
      <div class="billing-report-meta">Payment Filter: ${escapeHtml(selectedPaymentStatus === "all" ? "All" : (selectedPaymentStatus === "paid" ? "Paid" : "Unpaid"))}</div>
      <div class="billing-report-meta">Missing Technician: ${exceptionRows.length}</div>
      ${summaryCards}
      ${selectedTechnicianSummary}

      <section class="billing-report-group labor-exceptions-group">
        <h3>Missing Technician Exceptions</h3>
        <table class="route-frag-table labor-exception-table">
          <thead>
            <tr>
              <th>Completion Date</th>
              <th>Property</th>
              <th>Service Type</th>
              <th>Exception</th>
              <th>Labor</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${exceptionTableRows}
          </tbody>
        </table>
      </section>

      <section class="billing-report-group">
        <h3>Completed Service Detail</h3>
        <table class="route-frag-table labor-report-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Technician</th>
              <th>Property</th>
              <th>Service Type</th>
              <th>Labor</th>
              <th>Paid</th>
              <th class="labor-action-col">Action</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
      </section>

      ${technicianTotalsSection}
      ${renderBillingReportFooter()}
    </div>
  `;
}

function populateServicePnlPropertyOptions() {
  if (!servicePnlPropertySelect) return;

  const previousValue = servicePnlPropertySelect.value;
  const options = ['<option value="">All Properties</option>'];
  properties
    .slice()
    .sort((a, b) => String(a.property_name || "").localeCompare(String(b.property_name || "")))
    .forEach((property) => {
      options.push(`<option value="${escapeHtml(property.id)}">${escapeHtml(property.property_name || "Unnamed Property")}</option>`);
    });

  servicePnlPropertySelect.innerHTML = options.join("");
  servicePnlPropertySelect.value = Array.from(servicePnlPropertySelect.options).some((option) => option.value === previousValue)
    ? previousValue
    : "";
}

function getTaskLaborPayableStatus(task) {
  if (task?.labor_payable === true || task?.labor_payable === 1 || task?.labor_payable === "true") return true;
  if (task?.labor_payable === false || task?.labor_payable === 0 || task?.labor_payable === "false") return false;

  const technicianSnapshot = getLaborTaskTechnicianSnapshot(task);
  if (!technicianSnapshot.hasTechnician) return null;

  const technician = (technicianSnapshot.technicianId ? findTechnicianById(technicianSnapshot.technicianId) : null)
    || technicians.find((item) => String(item.name || "").trim().toLowerCase() === technicianSnapshot.technicianName.toLowerCase());
  if (!technician) return null;
  return isTechnicianPaidLabor(technician);
}

function getChemicalUsageCost(entry) {
  const quantity = Number(entry?.quantity || 0);
  const costPerUnit = Number(getChemicalCatalogItemForEntry(entry)?.cost_per_unit || 0);
  if (!Number.isFinite(quantity) || !Number.isFinite(costPerUnit)) return 0;
  return Math.max(0, quantity) * Math.max(0, costPerUnit);
}

const SERVICE_PNL_UNASSIGNED_PROPERTY_ID = "__unassigned__";

function getContractRateForDate(property, dateKey) {
  const propertyId = normalizePropertyId(property?.id);
  const normalizedDate = normalizeDateKey(dateKey);
  if (!propertyId || !normalizedDate) {
    return { amount: 0, basis: CONTRACT_RATE_BASIS_NONE, serviceDay: "Wednesday" };
  }

  const historicalRate = propertyContractRevenueHistory
    .filter((entry) => normalizePropertyId(entry.property_id) === propertyId)
    .filter((entry) => {
      const effectiveFrom = normalizeDateKey(entry.effective_from);
      const effectiveTo = normalizeDateKey(entry.effective_to);
      return effectiveFrom && effectiveFrom <= normalizedDate && (!effectiveTo || effectiveTo >= normalizedDate);
    })
    .sort((a, b) => String(b.effective_from || "").localeCompare(String(a.effective_from || "")))[0];

  const source = historicalRate || (!propertyContractRevenueHistoryAvailable ? property : null);
  return {
    amount: Math.max(0, Number(source?.contract_revenue_amount || 0)),
    basis: normalizeContractRateBasis(source?.contract_rate_basis),
    serviceDay: String(source?.contract_service_day || property?.standard_service_day || "Wednesday"),
  };
}

function getMonthStartDateKey(dateKey) {
  const date = parseDateString(dateKey);
  return formatIsoDateUtc(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)));
}

function getMonthEndDateKey(dateKey) {
  const date = parseDateString(dateKey);
  return formatIsoDateUtc(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)));
}

function getNextMonthStartDateKey(dateKey) {
  const date = parseDateString(dateKey);
  return formatIsoDateUtc(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)));
}

function formatContractMonthLabel(dateKey) {
  return parseDateString(dateKey).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function getContractRevenueForProperty(property, startDate, endDate) {
  let contractRevenue = 0;
  let monthlyPeriodCount = 0;
  let weeklyPeriodCount = 0;
  const partialMonthlyPeriods = [];

  let monthStart = getMonthStartDateKey(startDate);
  const finalMonthStart = getMonthStartDateKey(endDate);
  while (monthStart <= finalMonthStart) {
    const monthEnd = getMonthEndDateKey(monthStart);
    const rangeIncludesFullMonth = startDate <= monthStart && endDate >= monthEnd;
    const monthStartRate = getContractRateForDate(property, monthStart);
    const monthEndRate = getContractRateForDate(property, monthEnd);
    const hasSameMonthlyRateForFullMonth = monthStartRate.basis === CONTRACT_RATE_BASIS_MONTHLY
      && monthEndRate.basis === CONTRACT_RATE_BASIS_MONTHLY
      && monthStartRate.amount === monthEndRate.amount
      && monthStartRate.amount > 0;
    const hasAnyMonthlyContract = (monthStartRate.basis === CONTRACT_RATE_BASIS_MONTHLY && monthStartRate.amount > 0)
      || (monthEndRate.basis === CONTRACT_RATE_BASIS_MONTHLY && monthEndRate.amount > 0);
    if (hasSameMonthlyRateForFullMonth && rangeIncludesFullMonth) {
        contractRevenue += monthStartRate.amount;
        monthlyPeriodCount += 1;
    } else if (hasAnyMonthlyContract) {
      partialMonthlyPeriods.push(formatContractMonthLabel(monthStart));
    }
    monthStart = getNextMonthStartDateKey(monthStart);
  }

  const cursor = parseDateString(startDate);
  const end = parseDateString(endDate);
  while (cursor <= end) {
    const contractWeekDate = formatIsoDateUtc(cursor);
    const rate = getContractRateForDate(property, contractWeekDate);
    const contractDayNumber = getDayNumberFromName(rate.serviceDay);
    if (rate.basis === CONTRACT_RATE_BASIS_WEEKLY
        && rate.amount > 0
        && cursor.getUTCDay() === contractDayNumber) {
      contractRevenue += rate.amount;
      weeklyPeriodCount += 1;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return {
    contractRevenue,
    monthlyPeriodCount,
    weeklyPeriodCount,
    partialMonthlyPeriods,
  };
}

function getServicePnlInvoiceItemPropertyId(item) {
  const itemSource = String(item?.item_source || item?.source_type || "").trim().toLowerCase();
  const chemicalUsageId = item?.chemical_usage_id
    || (itemSource === INVOICE_ITEM_SOURCES.CHEMICAL ? item?.source_id : null);
  if (chemicalUsageId) {
    const chemicalEntry = chemicalUsageEntries.find((entry) => String(entry.id || "") === String(chemicalUsageId));
    const chemicalPropertyId = normalizePropertyId(chemicalEntry?.property_id);
    if (chemicalPropertyId) return chemicalPropertyId;
  }

  const taskSourceTypes = new Set([
    INVOICE_ITEM_SOURCES.TASK,
    INVOICE_ITEM_SOURCES.SDS,
    "cleaning",
    "weekly_standard",
    "weekly standard",
    "guest_ready",
    "guest ready",
  ]);
  const taskId = item?.task_id || (taskSourceTypes.has(itemSource) ? item?.source_id : null);
  if (taskId) {
    const task = cleaningTasks.find((entry) => String(entry.id || "") === String(taskId));
    const taskPropertyId = normalizePropertyId(task?.property_id);
    if (taskPropertyId) return taskPropertyId;
  }

  return SERVICE_PNL_UNASSIGNED_PROPERTY_ID;
}

function getServicePnlInvoiceRevenueCategory(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "draft") return "draft";
  if (isFinalizedInvoiceStatus(normalized)) return "finalized";
  return "";
}

function getServicePnlRows({ startDate, endDate, selectedPropertyId = "" } = {}) {
  if (!startDate || !endDate) return [];

  const rowsByProperty = new Map();
  const ensureRow = (propertyId) => {
    const normalizedId = normalizePropertyId(propertyId);
    if (!normalizedId) return null;
    if (!rowsByProperty.has(normalizedId)) {
      const isUnassigned = normalizedId === SERVICE_PNL_UNASSIGNED_PROPERTY_ID;
      rowsByProperty.set(normalizedId, {
        propertyId: normalizedId,
        propertyName: isUnassigned ? "Unassigned / No Source Property" : getPropertyName(normalizedId),
        guestEngineRevenue: 0,
        draftRevenue: 0,
        finalizedRevenue: 0,
        contractRevenue: 0,
        contractMonthlyPeriods: 0,
        contractWeeklyPeriods: 0,
        partialMonthlyPeriods: [],
        revenue: 0,
        ownerPerformedServices: 0,
        techPerformedServices: 0,
        actualTechLabor: 0,
        potentialLabor: 0,
        chemicalCost: 0,
        partsCost: 0,
        propertyOperatingExpenses: 0,
      });
    }
    return rowsByProperty.get(normalizedId);
  };
  const propertyMatches = (propertyId) => !selectedPropertyId || normalizePropertyId(propertyId) === normalizePropertyId(selectedPropertyId);

  const eligibleInvoicesById = new Map(
    invoices
      .filter((invoice) => getServicePnlInvoiceRevenueCategory(invoice.status))
      .filter((invoice) => {
        const invoiceDate = normalizeDateKey(invoice.invoice_date || invoice.created_at);
        return invoiceDate && invoiceDate >= startDate && invoiceDate <= endDate;
      })
      .map((invoice) => [String(invoice.id), invoice])
  );

  const countedInvoiceItemIds = new Set();
  invoiceItems.forEach((item) => {
    const invoice = eligibleInvoicesById.get(String(item.invoice_id || ""));
    if (!invoice) return;
    const invoiceItemId = String(item.id || "").trim();
    if (invoiceItemId && countedInvoiceItemIds.has(invoiceItemId)) return;
    if (invoiceItemId) countedInvoiceItemIds.add(invoiceItemId);
    const itemPropertyId = getServicePnlInvoiceItemPropertyId(item);
    if (!propertyMatches(itemPropertyId)) return;
    const row = ensureRow(itemPropertyId);
    if (!row) return;
    const amount = Number(item.amount || 0);
    const category = getServicePnlInvoiceRevenueCategory(invoice.status);
    row.guestEngineRevenue += amount;
    if (category === "draft") {
      row.draftRevenue += amount;
    } else if (category === "finalized") {
      row.finalizedRevenue += amount;
    }
  });

  properties
    .filter((property) => propertyMatches(property.id))
    .forEach((property) => {
      const contract = getContractRevenueForProperty(property, startDate, endDate);
      if (contract.contractRevenue <= 0 && contract.partialMonthlyPeriods.length === 0) return;
      const row = ensureRow(property.id);
      if (!row) return;
      row.contractRevenue += contract.contractRevenue;
      row.contractMonthlyPeriods += contract.monthlyPeriodCount;
      row.contractWeeklyPeriods += contract.weeklyPeriodCount;
      row.partialMonthlyPeriods.push(...contract.partialMonthlyPeriods);
    });

  cleaningTasks
    .filter((task) => String(task?.status || "").trim().toLowerCase() === "completed")
    .filter((task) => propertyMatches(task.property_id))
    .filter((task) => {
      const completionDate = getLaborCompletionDateKey(task);
      return completionDate && completionDate >= startDate && completionDate <= endDate;
    })
    .forEach((task) => {
      const row = ensureRow(task.property_id);
      if (!row) return;
      const laborAmount = Number(task.labor_amount || 0);
      const potentialLabor = Number.isFinite(laborAmount) ? Math.max(0, laborAmount) : 0;
      const payableStatus = getTaskLaborPayableStatus(task);
      const partsCost = Number(task.parts_cost || 0);
      if (Number.isFinite(partsCost)) row.partsCost += Math.max(0, partsCost);
      row.potentialLabor += potentialLabor;
      if (payableStatus === true) {
        row.techPerformedServices += 1;
      } else if (payableStatus === false) {
        row.ownerPerformedServices += 1;
      }
      if (payableStatus === true) {
        row.actualTechLabor += potentialLabor;
      }
    });

  chemicalUsageEntries
    .filter((entry) => propertyMatches(entry.property_id))
    .filter((entry) => {
      const serviceDate = normalizeDateKey(entry.service_date);
      return serviceDate && serviceDate >= startDate && serviceDate <= endDate;
    })
    .forEach((entry) => {
      const row = ensureRow(entry.property_id);
      if (row) row.chemicalCost += getChemicalUsageCost(entry);
    });

  expenses
    .filter((expense) => Boolean(expense.property_id))
    .filter((expense) => propertyMatches(expense.property_id))
    .filter((expense) => {
      const expenseDateKey = normalizeDateKey(expense.expense_date);
      return expenseDateKey && expenseDateKey >= startDate && expenseDateKey <= endDate;
    })
    .forEach((expense) => {
      const row = ensureRow(expense.property_id);
      if (row) row.propertyOperatingExpenses += Math.max(0, Number(expense.amount || 0));
    });

  if (selectedPropertyId) ensureRow(selectedPropertyId);

  return Array.from(rowsByProperty.values())
    .map((row) => {
      const revenue = row.guestEngineRevenue + row.contractRevenue;
      const actualDirectCosts = row.actualTechLabor + row.chemicalCost + row.partsCost;
      const actualProfit = revenue - actualDirectCosts;
      const fullyStaffedProfit = revenue - row.potentialLabor - row.chemicalCost - row.partsCost;
      const propertyNetProfit = actualProfit - row.propertyOperatingExpenses;
      return {
        ...row,
        revenue,
        actualDirectCosts,
        actualProfit,
        propertyNetProfit,
        fullyStaffedProfit,
        actualMargin: revenue !== 0 ? (actualProfit / revenue) * 100 : null,
        fullyStaffedMargin: revenue !== 0 ? (fullyStaffedProfit / revenue) * 100 : null,
      };
    })
    .sort((a, b) => a.propertyName.localeCompare(b.propertyName));
}

function getForecastTaskDate(task) {
  return normalizeDateKey(task?.service_date || task?.scheduled_date || task?.suggested_date);
}

function isForecastTaskEligible(task, startDate, endDate, selectedPropertyId = "") {
  const status = String(task?.status || "Scheduled").trim().toLowerCase();
  if (["cancelled", "canceled", "void", "deleted"].includes(status)) return false;
  const serviceDate = getForecastTaskDate(task);
  if (!serviceDate || serviceDate < startDate || serviceDate > endDate) return false;
  return !selectedPropertyId || normalizePropertyId(task.property_id) === normalizePropertyId(selectedPropertyId);
}

function getForecastTaskLaborAmount(task, property, useCapturedAmount = false) {
  const capturedAmount = Number(task?.labor_amount);
  if (useCapturedAmount && Number.isFinite(capturedAmount)) return Math.max(0, capturedAmount);
  const calculatedAmount = getLaborAmountForTask(task, property);
  const amount = calculatedAmount === null ? Number(task?.labor_amount || 0) : Number(calculatedAmount || 0);
  return Number.isFinite(amount) ? Math.max(0, amount) : 0;
}

function getForecastTaskChemicalCost(task) {
  const taskId = String(task?.id || "").trim();
  if (!taskId) return 0;
  return chemicalUsageEntries
    .filter((entry) => String(entry?.task_id || "").trim() === taskId)
    .reduce((sum, entry) => sum + getChemicalUsageCost(entry), 0);
}

function getForecastAssignedTechnician(task) {
  const selectedId = String(taskTechnicianSelections.get(task?.id) || "").trim();
  const assignedId = selectedId || String(task?.technician_id || "").trim();
  if (assignedId) {
    const byId = findTechnicianById(assignedId);
    if (byId) return byId;
  }
  const assignedName = String(task?.technician_name || task?.technician || "").trim().toLowerCase();
  return assignedName
    ? technicians.find((technician) => String(technician?.name || "").trim().toLowerCase() === assignedName) || null
    : null;
}

function getForecastInvoiceItemSource(item) {
  const itemSource = String(item?.item_source || item?.source_type || item?.item_type || "").trim().toLowerCase();
  if (itemSource === INVOICE_ITEM_SOURCES.SDS || itemSource === "same-day surcharge" || itemSource === "same day surcharge") return INVOICE_ITEM_SOURCES.SDS;
  if (itemSource === INVOICE_ITEM_SOURCES.CHEMICAL) return INVOICE_ITEM_SOURCES.CHEMICAL;
  if (itemSource === INVOICE_ITEM_SOURCES.TASK) return INVOICE_ITEM_SOURCES.TASK;
  if (itemSource === INVOICE_ITEM_SOURCES.MANUAL) return INVOICE_ITEM_SOURCES.MANUAL;
  if (getInvoiceItemChemicalUsageId(item)) return INVOICE_ITEM_SOURCES.CHEMICAL;
  if (getInvoiceItemTaskId(item)) return INVOICE_ITEM_SOURCES.TASK;
  return INVOICE_ITEM_SOURCES.MANUAL;
}

function getForecastInvoiceRevenueData({ startDate, endDate, selectedPropertyId = "" } = {}) {
  const eligibleInvoices = new Map(invoices
    .map((invoice) => ({ invoice, category: getServicePnlInvoiceRevenueCategory(invoice.status) }))
    .filter(({ category }) => Boolean(category))
    .filter(({ invoice }) => {
      const invoiceDate = normalizeDateKey(invoice.invoice_date || invoice.created_at);
      return invoiceDate && invoiceDate >= startDate && invoiceDate <= endDate;
    })
    .map(({ invoice, category }) => [String(invoice.id), { invoice, category }]));
  const representedTaskIds = new Set();
  const representedSdsTaskIds = new Set();
  const byProperty = new Map();
  const auditRows = [];
  const countedItemIds = new Set();
  const countedSourceKeys = new Set();

  invoiceItems
    .map((item) => ({ item, invoiceRecord: eligibleInvoices.get(String(item?.invoice_id || "")) }))
    .filter(({ invoiceRecord }) => Boolean(invoiceRecord))
    .sort((a, b) => Number(b.invoiceRecord.category === "finalized") - Number(a.invoiceRecord.category === "finalized"))
    .forEach(({ item, invoiceRecord }) => {
    const itemId = String(item?.id || "").trim();
    if (itemId && countedItemIds.has(itemId)) return;
    if (itemId) countedItemIds.add(itemId);
    const propertyId = getServicePnlInvoiceItemPropertyId(item);
    if (selectedPropertyId && normalizePropertyId(propertyId) !== normalizePropertyId(selectedPropertyId)) return;
    const source = getForecastInvoiceItemSource(item);
    const taskId = normalizePropertyId(getInvoiceItemTaskId(item));
    const chemicalUsageId = normalizePropertyId(getInvoiceItemChemicalUsageId(item));
    const sourceKey = source === INVOICE_ITEM_SOURCES.SDS && taskId
      ? `sds:${taskId}`
      : source === INVOICE_ITEM_SOURCES.TASK && taskId
        ? `task:${taskId}`
        : source === INVOICE_ITEM_SOURCES.CHEMICAL && chemicalUsageId
          ? `chemical:${chemicalUsageId}`
          : `invoice-item:${itemId || String(item?.invoice_id || "")}:${auditRows.length + 1}`;
    if (countedSourceKeys.has(sourceKey)) return;
    countedSourceKeys.add(sourceKey);
    if (source === INVOICE_ITEM_SOURCES.SDS && taskId) representedSdsTaskIds.add(taskId);
    if (source === INVOICE_ITEM_SOURCES.TASK && taskId) representedTaskIds.add(taskId);
    const amount = Number(item?.amount || 0);
    const propertyKey = normalizePropertyId(propertyId) || SERVICE_PNL_UNASSIGNED_PROPERTY_ID;
    if (!byProperty.has(propertyKey)) byProperty.set(propertyKey, { draftRevenue: 0, finalizedRevenue: 0 });
    byProperty.get(propertyKey)[invoiceRecord.category === "draft" ? "draftRevenue" : "finalizedRevenue"] += amount;
    auditRows.push({
      sourceKey,
      serviceDate: normalizeDateKey(item?.service_date) || normalizeDateKey(invoiceRecord.invoice.invoice_date),
      propertyId: propertyKey,
      propertyName: propertyKey === SERVICE_PNL_UNASSIGNED_PROPERTY_ID ? "Unassigned / No Source Property" : getPropertyName(propertyKey),
      sourceType: source === INVOICE_ITEM_SOURCES.SDS ? "Same-Day Surcharge" : source === INVOICE_ITEM_SOURCES.TASK ? "Task" : source === INVOICE_ITEM_SOURCES.CHEMICAL ? "Chemical Charge" : "Manual Invoice Item",
      description: item?.description || "Invoice item",
      revenueStatus: invoiceRecord.category === "draft" ? "Draft Invoiced" : "Finalized Invoiced",
      draftRevenue: invoiceRecord.category === "draft" ? amount : 0,
      finalizedRevenue: invoiceRecord.category === "finalized" ? amount : 0,
      remainingPotentialRevenue: 0,
      remainingSdsRevenue: 0,
    });
  });

  return { byProperty, representedTaskIds, representedSdsTaskIds, auditRows };
}

function getServicePnlForecastTaskRows({ startDate, endDate, selectedPropertyId = "", representedTaskIds = new Set(), representedSdsTaskIds = new Set() } = {}) {
  return cleaningTasks
    .filter((task) => isForecastTaskEligible(task, startDate, endDate, selectedPropertyId))
    .map((task) => {
      const property = properties.find((item) => normalizePropertyId(item.id) === normalizePropertyId(task.property_id));
      const serviceDate = getForecastTaskDate(task);
      const contractRate = getContractRateForDate(property, serviceDate);
      const hasApplicableContract = contractRate.amount > 0 && contractRate.basis !== CONTRACT_RATE_BASIS_NONE;
      const isContractStandard = task.service_type === "Weekly Standard" && hasApplicableContract;
      const taskId = String(task?.id || "").trim();
      const taskIsInvoiced = representedTaskIds.has(taskId);
      const sdsIsInvoiced = representedSdsTaskIds.has(taskId);
      const potentialTaskRevenue = isContractStandard || taskIsInvoiced ? 0 : Math.max(0, Number(getTaskBillingAmount(task) || 0));
      const potentialSdsRevenue = !sdsIsInvoiced && isSameDayTurnoverTask(task) ? Math.max(0, Number(getSdsBillingAmount(task) || 0)) : 0;
      const status = String(task?.status || "Scheduled").trim().toLowerCase();
      const isKnownTask = status === "completed" || status === "in progress" || status === "in_progress";
      const fullyStaffedLabor = getForecastTaskLaborAmount(task, property, isKnownTask);
      const technician = isKnownTask ? null : getForecastAssignedTechnician(task);
      const knownPayableStatus = isKnownTask ? getTaskLaborPayableStatus(task) : null;
      const isAssigned = isKnownTask ? knownPayableStatus !== null : Boolean(technician);
      const isPaidTechnician = isKnownTask ? knownPayableStatus === true : isAssigned && isTechnicianPaidLabor(technician);
      const knownLabor = isKnownTask && isPaidTechnician ? fullyStaffedLabor : 0;
      const projectedLabor = !isKnownTask && isPaidTechnician ? fullyStaffedLabor : 0;
      const chemicalCost = getForecastTaskChemicalCost(task);
      const partsCost = Math.max(0, Number(task?.parts_cost || 0));
      return {
        taskId,
        propertyId: normalizePropertyId(task?.property_id),
        propertyName: property?.property_name || getPropertyName(task?.property_id),
        serviceDate,
        serviceType: getLaborServiceTypeDisplay(task),
        technicianName: isKnownTask ? getLaborTaskTechnicianSnapshot(task).technicianName : technician?.name || "Unassigned",
        taskRevenueStatus: taskIsInvoiced ? "Invoiced" : potentialTaskRevenue > 0 ? "Potentially Billable" : isContractStandard ? "Covered by Contract" : "No Task Charge",
        sdsRevenueStatus: sdsIsInvoiced ? "Invoiced" : potentialSdsRevenue > 0 ? "Potentially Billable" : "No SDS Charge",
        potentialTaskRevenue,
        potentialSdsRevenue,
        knownLabor,
        projectedLabor,
        fullyStaffedLabor,
        knownChemicalCost: isKnownTask ? chemicalCost : 0,
        futureChemicalCost: isKnownTask ? 0 : chemicalCost,
        knownPartsCost: isKnownTask ? partsCost : 0,
        futurePartsCost: isKnownTask ? 0 : partsCost,
        chemicalCost,
        partsCost,
        projectedContribution: potentialTaskRevenue + potentialSdsRevenue - knownLabor - projectedLabor - chemicalCost - partsCost,
        ownerNoCostServices: isAssigned && !isPaidTechnician ? 1 : 0,
        paidTechServices: isPaidTechnician ? 1 : 0,
        unassignedServices: isAssigned ? 0 : 1,
        isKnownTask,
      };
    })
    .sort((a, b) => a.serviceDate.localeCompare(b.serviceDate) || a.propertyName.localeCompare(b.propertyName));
}

function getServicePnlForecastRows({ startDate, endDate, selectedPropertyId = "" } = {}) {
  const rowsByProperty = new Map();
  const ensureRow = (propertyId) => {
    const normalizedId = normalizePropertyId(propertyId);
    if (!normalizedId) return null;
    if (!rowsByProperty.has(normalizedId)) {
      rowsByProperty.set(normalizedId, {
        propertyId: normalizedId,
        propertyName: normalizedId === SERVICE_PNL_UNASSIGNED_PROPERTY_ID ? "Unassigned / No Source Property" : getPropertyName(normalizedId),
        contractRevenue: 0,
        partialMonthlyPeriods: [],
        draftRevenue: 0,
        finalizedRevenue: 0,
        potentialTaskRevenue: 0,
        potentialSdsRevenue: 0,
        ownerNoCostServices: 0,
        paidTechServices: 0,
        unassignedServices: 0,
        knownLabor: 0,
        projectedLabor: 0,
        fullyStaffedLabor: 0,
        knownChemicalCost: 0,
        futureChemicalCost: 0,
        knownPartsCost: 0,
        futurePartsCost: 0,
        chemicalCost: 0,
        partsCost: 0,
        propertyOperatingExpenses: 0,
      });
    }
    return rowsByProperty.get(normalizedId);
  };

  properties
    .filter((property) => !selectedPropertyId || normalizePropertyId(property.id) === normalizePropertyId(selectedPropertyId))
    .forEach((property) => {
      const contract = getContractRevenueForProperty(property, startDate, endDate);
      if (contract.contractRevenue <= 0 && contract.partialMonthlyPeriods.length === 0) return;
      const row = ensureRow(property.id);
      row.contractRevenue = contract.contractRevenue;
      row.partialMonthlyPeriods.push(...contract.partialMonthlyPeriods);
    });

  const invoiceRevenue = getForecastInvoiceRevenueData({ startDate, endDate, selectedPropertyId });
  invoiceRevenue.byProperty.forEach((invoiceTotals, propertyId) => {
    const row = ensureRow(propertyId);
    row.draftRevenue += invoiceTotals.draftRevenue;
    row.finalizedRevenue += invoiceTotals.finalizedRevenue;
  });

  const taskRows = getServicePnlForecastTaskRows({
    startDate,
    endDate,
    selectedPropertyId,
    representedTaskIds: invoiceRevenue.representedTaskIds,
    representedSdsTaskIds: invoiceRevenue.representedSdsTaskIds,
  });
  taskRows.forEach((taskRow) => {
    const row = ensureRow(taskRow.propertyId);
    if (!row) return;
    row.potentialTaskRevenue += taskRow.potentialTaskRevenue;
    row.potentialSdsRevenue += taskRow.potentialSdsRevenue;
    row.ownerNoCostServices += taskRow.ownerNoCostServices;
    row.paidTechServices += taskRow.paidTechServices;
    row.unassignedServices += taskRow.unassignedServices;
    row.knownLabor += taskRow.knownLabor;
    row.projectedLabor += taskRow.projectedLabor;
    row.fullyStaffedLabor += taskRow.fullyStaffedLabor;
    row.knownChemicalCost += taskRow.knownChemicalCost;
    row.futureChemicalCost += taskRow.futureChemicalCost;
    row.knownPartsCost += taskRow.knownPartsCost;
    row.futurePartsCost += taskRow.futurePartsCost;
    row.chemicalCost += taskRow.chemicalCost;
    row.partsCost += taskRow.partsCost;
  });

  const includedTaskIds = new Set(taskRows.map((row) => row.taskId).filter(Boolean));
  const todayKey = formatDateValue(new Date());
  chemicalUsageEntries
    .filter((entry) => !entry?.task_id || !includedTaskIds.has(String(entry.task_id)))
    .filter((entry) => !selectedPropertyId || normalizePropertyId(entry.property_id) === normalizePropertyId(selectedPropertyId))
    .filter((entry) => {
      const serviceDate = normalizeDateKey(entry.service_date);
      return serviceDate && serviceDate >= startDate && serviceDate <= endDate;
    })
    .forEach((entry) => {
      const row = ensureRow(entry.property_id);
      if (!row) return;
      const cost = getChemicalUsageCost(entry);
      const isFuture = normalizeDateKey(entry.service_date) > todayKey;
      row.chemicalCost += cost;
      if (isFuture) row.futureChemicalCost += cost;
      else row.knownChemicalCost += cost;
    });

  expenses
    .filter((expense) => Boolean(expense.property_id))
    .filter((expense) => !selectedPropertyId || normalizePropertyId(expense.property_id) === normalizePropertyId(selectedPropertyId))
    .filter((expense) => {
      const expenseDate = normalizeDateKey(expense.expense_date);
      return expenseDate && expenseDate >= startDate && expenseDate <= endDate;
    })
    .forEach((expense) => {
      const row = ensureRow(expense.property_id);
      if (row) row.propertyOperatingExpenses += Math.max(0, Number(expense.amount || 0));
    });

  if (selectedPropertyId) ensureRow(selectedPropertyId);

  const rows = Array.from(rowsByProperty.values()).map((row) => {
    const revenue = row.contractRevenue + row.draftRevenue + row.finalizedRevenue + row.potentialTaskRevenue + row.potentialSdsRevenue;
    const knownDirectCosts = row.knownLabor + row.knownChemicalCost + row.knownPartsCost;
    const projectedFutureDirectCosts = row.projectedLabor + row.futureChemicalCost + row.futurePartsCost;
    const expectedDirectCosts = knownDirectCosts + projectedFutureDirectCosts;
    const projectedServiceProfit = revenue - expectedDirectCosts;
    const fullyStaffedProfit = revenue - row.fullyStaffedLabor - row.chemicalCost - row.partsCost;
    return {
      ...row,
      revenue,
      knownDirectCosts,
      projectedFutureDirectCosts,
      expectedDirectCosts,
      projectedServiceProfit,
      fullyStaffedProfit,
      propertyNetOperatingProfit: projectedServiceProfit - row.propertyOperatingExpenses,
      projectedMargin: revenue !== 0 ? (projectedServiceProfit / revenue) * 100 : null,
      fullyStaffedMargin: revenue !== 0 ? (fullyStaffedProfit / revenue) * 100 : null,
    };
  }).sort((a, b) => a.propertyName.localeCompare(b.propertyName));

  const revenueAuditRows = invoiceRevenue.auditRows.slice();
  rows.filter((row) => row.contractRevenue > 0).forEach((row) => revenueAuditRows.push({
    sourceKey: `contract:${row.propertyId}`,
    serviceDate: `${startDate} to ${endDate}`,
    propertyId: row.propertyId,
    propertyName: row.propertyName,
    sourceType: "Contract",
    description: "Effective contract revenue",
    revenueStatus: "Contract Revenue",
    draftRevenue: 0,
    finalizedRevenue: 0,
    remainingPotentialRevenue: 0,
    remainingSdsRevenue: 0,
    contractRevenue: row.contractRevenue,
  }));
  taskRows.forEach((taskRow) => {
    if (!invoiceRevenue.representedTaskIds.has(taskRow.taskId)) {
      revenueAuditRows.push({
        sourceKey: `task:${taskRow.taskId}`,
        serviceDate: taskRow.serviceDate,
        propertyId: taskRow.propertyId,
        propertyName: taskRow.propertyName,
        sourceType: taskRow.serviceType,
        description: "Task charge",
        revenueStatus: taskRow.taskRevenueStatus,
        contractRevenue: 0,
        draftRevenue: 0,
        finalizedRevenue: 0,
        remainingPotentialRevenue: taskRow.potentialTaskRevenue,
        remainingSdsRevenue: 0,
      });
    }
    if (!invoiceRevenue.representedSdsTaskIds.has(taskRow.taskId) && taskRow.potentialSdsRevenue > 0) {
      revenueAuditRows.push({
        sourceKey: `sds:${taskRow.taskId}`,
        serviceDate: taskRow.serviceDate,
        propertyId: taskRow.propertyId,
        propertyName: taskRow.propertyName,
        sourceType: "Same-Day Surcharge",
        description: taskRow.serviceType,
        revenueStatus: taskRow.sdsRevenueStatus,
        contractRevenue: 0,
        draftRevenue: 0,
        finalizedRevenue: 0,
        remainingPotentialRevenue: 0,
        remainingSdsRevenue: taskRow.potentialSdsRevenue,
      });
    }
  });

  return { rows, taskRows, revenueAuditRows };
}

function renderServicePnlForecastReport() {
  if (!servicePnlContainer) return;
  const startDate = servicePnlStartDate?.value || "";
  const endDate = servicePnlEndDate?.value || "";
  if (!startDate || !endDate) {
    servicePnlContainer.innerHTML = '<div class="billing-report-sheet"><div class="empty">Select a start and end date.</div></div>';
    return;
  }
  if (startDate > endDate) {
    servicePnlContainer.innerHTML = '<div class="billing-report-sheet"><div class="empty">Start date must be on or before end date.</div></div>';
    return;
  }

  const selectedPropertyId = servicePnlPropertySelect?.value || "";
  const { rows, taskRows, revenueAuditRows } = getServicePnlForecastRows({ startDate, endDate, selectedPropertyId });
  const operatingExpenseRows = getFilteredExpenses({ startDate, endDate, propertyId: selectedPropertyId })
    .filter((expense) => !selectedPropertyId || Boolean(expense.property_id));
  const todayKey = formatDateValue(new Date());
  const knownOperatingExpenses = operatingExpenseRows
    .filter((expense) => normalizeDateKey(expense.expense_date) <= todayKey)
    .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const futureOperatingExpenses = operatingExpenseRows
    .filter((expense) => normalizeDateKey(expense.expense_date) > todayKey)
    .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const operatingExpenses = knownOperatingExpenses + futureOperatingExpenses;
  const totals = rows.reduce((summary, row) => {
    ["contractRevenue", "draftRevenue", "finalizedRevenue", "potentialTaskRevenue", "potentialSdsRevenue", "revenue", "ownerNoCostServices", "paidTechServices",
      "unassignedServices", "knownLabor", "projectedLabor", "fullyStaffedLabor", "knownChemicalCost", "futureChemicalCost",
      "knownPartsCost", "futurePartsCost", "chemicalCost", "partsCost", "knownDirectCosts", "projectedFutureDirectCosts", "expectedDirectCosts",
      "projectedServiceProfit", "fullyStaffedProfit", "propertyOperatingExpenses"].forEach((key) => {
      summary[key] += Number(row[key] || 0);
    });
    return summary;
  }, {
    contractRevenue: 0, draftRevenue: 0, finalizedRevenue: 0, potentialTaskRevenue: 0, potentialSdsRevenue: 0, revenue: 0,
    ownerNoCostServices: 0, paidTechServices: 0, unassignedServices: 0, knownLabor: 0, projectedLabor: 0,
    fullyStaffedLabor: 0, knownChemicalCost: 0, futureChemicalCost: 0, knownPartsCost: 0, futurePartsCost: 0,
    chemicalCost: 0, partsCost: 0, knownDirectCosts: 0, projectedFutureDirectCosts: 0, expectedDirectCosts: 0,
    projectedServiceProfit: 0, fullyStaffedProfit: 0, propertyOperatingExpenses: 0,
  });
  totals.knownOperatingExpenses = knownOperatingExpenses;
  totals.futureOperatingExpenses = futureOperatingExpenses;
  totals.operatingExpenses = operatingExpenses;
  totals.netOperatingProfit = totals.projectedServiceProfit - operatingExpenses;
  totals.projectedMargin = totals.revenue !== 0 ? (totals.projectedServiceProfit / totals.revenue) * 100 : null;
  totals.operatingMargin = totals.revenue !== 0 ? (totals.netOperatingProfit / totals.revenue) * 100 : null;
  totals.fullyStaffedMargin = totals.revenue !== 0 ? (totals.fullyStaffedProfit / totals.revenue) * 100 : null;

  const partialMonthlyNotices = rows.flatMap((row) => row.partialMonthlyPeriods.map((period) => `${row.propertyName}: ${period}`));
  const propertyTableRows = rows.length ? rows.map((row) => `<tr>
    <td>${escapeHtml(row.propertyName)}</td><td class="route-frag-money">${toMoney(row.contractRevenue)}</td>
    <td class="route-frag-money">${toMoney(row.draftRevenue)}</td><td class="route-frag-money">${toMoney(row.finalizedRevenue)}</td>
    <td class="route-frag-money">${toMoney(row.potentialTaskRevenue)}</td><td class="route-frag-money">${toMoney(row.potentialSdsRevenue)}</td><td class="route-frag-money">${toMoney(row.revenue)}</td>
    <td class="route-frag-money">${toMoney(row.knownLabor)}</td><td class="route-frag-money">${toMoney(row.projectedLabor)}</td><td class="route-frag-money">${toMoney(row.fullyStaffedLabor)}</td>
    <td class="route-frag-money">${toMoney(row.chemicalCost)}</td><td class="route-frag-money">${toMoney(row.partsCost)}</td>
    <td class="route-frag-money">${toMoney(row.projectedServiceProfit)}</td><td class="route-frag-money">${toMoney(row.propertyOperatingExpenses)}</td>
    <td class="route-frag-money">${toMoney(row.propertyNetOperatingProfit)}</td><td class="route-frag-money">${toMoney(row.fullyStaffedProfit)}</td>
    <td class="route-frag-money">${formatServicePnlMargin(row.projectedMargin)}</td><td class="route-frag-money">${formatServicePnlMargin(row.fullyStaffedMargin)}</td>
  </tr>`).join("") : '<tr><td colspan="18">No invoiced revenue, scheduled work, contract revenue, or property expenses found for this forecast period.</td></tr>';
  const revenueSourceRows = revenueAuditRows.length ? revenueAuditRows.map((row) => `<tr>
    <td>${escapeHtml(row.serviceDate)}</td><td>${escapeHtml(row.propertyName)}</td><td>${escapeHtml(row.sourceType)}</td><td>${escapeHtml(row.description)}</td><td>${escapeHtml(row.revenueStatus)}</td>
    <td class="route-frag-money">${toMoney(row.contractRevenue || 0)}</td><td class="route-frag-money">${toMoney(row.draftRevenue)}</td>
    <td class="route-frag-money">${toMoney(row.finalizedRevenue)}</td><td class="route-frag-money">${toMoney(row.remainingPotentialRevenue)}</td>
    <td class="route-frag-money">${toMoney(row.remainingSdsRevenue)}</td>
  </tr>`).join("") : '<tr><td colspan="10">No revenue sources found for this forecast period.</td></tr>';
  const costAuditRows = taskRows.length ? taskRows.map((row) => `<tr>
    <td>${escapeHtml(row.serviceDate)}</td><td>${escapeHtml(row.propertyName)}</td><td>${escapeHtml(row.serviceType)}</td><td>${escapeHtml(row.technicianName)}</td>
    <td>${row.isKnownTask ? "Known / Actual" : "Future Projected"}</td><td class="route-frag-money">${toMoney(row.knownLabor)}</td>
    <td class="route-frag-money">${toMoney(row.projectedLabor)}</td><td class="route-frag-money">${toMoney(row.fullyStaffedLabor)}</td>
    <td class="route-frag-money">${toMoney(row.knownChemicalCost)}</td><td class="route-frag-money">${toMoney(row.futureChemicalCost)}</td>
    <td class="route-frag-money">${toMoney(row.knownPartsCost)}</td><td class="route-frag-money">${toMoney(row.futurePartsCost)}</td>
    <td class="route-frag-money">${toMoney(row.projectedContribution)}</td>
  </tr>`).join("") : '<tr><td colspan="13">No task costs found for this forecast period.</td></tr>';

  servicePnlContainer.innerHTML = `<div class="billing-report-sheet service-pnl-sheet service-pnl-forecast-sheet">
    ${renderBillingReportHeader()}
    <h2 class="billing-report-title">Service P&amp;L Forecast</h2>
    <div class="billing-report-meta">Date Range: ${escapeHtml(startDate)} to ${escapeHtml(endDate)}</div>
    <div class="billing-report-notice">Forecast is read-only and uses current schedules, assignments, known costs, and entered expenses. Chemical forecast includes entered usage only.</div>
    ${partialMonthlyNotices.length ? `<div class="billing-report-notice">Monthly contract revenue excluded for partial calendar period(s): ${escapeHtml(partialMonthlyNotices.join(", "))}. No proration was applied.</div>` : ""}
    ${!propertyContractRevenueHistoryAvailable ? '<div class="billing-report-notice">Contract history is unavailable. Run the contract revenue migration before relying on forecast results.</div>' : ""}
    <div class="service-pnl-summary-grid">
      <article><span>Contract Revenue</span><strong>${toMoney(totals.contractRevenue)}</strong></article>
      <article><span>Draft Revenue</span><strong>${toMoney(totals.draftRevenue)}</strong></article>
      <article><span>Finalized Revenue</span><strong>${toMoney(totals.finalizedRevenue)}</strong></article>
      <article><span>Remaining Potential Task Revenue</span><strong>${toMoney(totals.potentialTaskRevenue)}</strong></article>
      <article><span>Remaining Potential SDS Revenue</span><strong>${toMoney(totals.potentialSdsRevenue)}</strong></article>
      <article class="service-pnl-highlight"><span>Total Expected Revenue</span><strong>${toMoney(totals.revenue)}</strong></article>
      <article><span>Known Direct Costs</span><strong>${toMoney(totals.knownDirectCosts)}</strong></article>
      <article><span>Projected Future Direct Costs</span><strong>${toMoney(totals.projectedFutureDirectCosts)}</strong></article>
      <article><span>Total Expected Direct Costs</span><strong>${toMoney(totals.expectedDirectCosts)}</strong></article>
      <article class="service-pnl-highlight"><span>Expected Service Profit</span><strong>${toMoney(totals.projectedServiceProfit)}</strong></article>
      <article><span>Expected Service Margin</span><strong>${formatServicePnlMargin(totals.projectedMargin)}</strong></article>
      <article><span>Known Operating Expenses</span><strong>${toMoney(totals.knownOperatingExpenses)}</strong></article>
      <article><span>Future Operating Expenses</span><strong>${toMoney(totals.futureOperatingExpenses)}</strong></article>
      <article><span>Total Expected Operating Expenses</span><strong>${toMoney(totals.operatingExpenses)}</strong></article>
      <article class="service-pnl-highlight"><span>Expected Net Operating Profit</span><strong>${toMoney(totals.netOperatingProfit)}</strong></article>
      <article><span>Expected Operating Margin</span><strong>${formatServicePnlMargin(totals.operatingMargin)}</strong></article>
      <article><span>Fully Staffed Labor</span><strong>${toMoney(totals.fullyStaffedLabor)}</strong></article>
      <article class="service-pnl-highlight"><span>Fully Staffed Expected Profit</span><strong>${toMoney(totals.fullyStaffedProfit)}</strong></article>
      <article><span>Fully Staffed Expected Margin</span><strong>${formatServicePnlMargin(totals.fullyStaffedMargin)}</strong></article>
    </div>
    <div class="service-pnl-staffing-summary">
      <h3>Staffing Summary</h3>
      <div class="service-pnl-staffing-grid"><span>Owner / No-Cost Assigned Services <strong>${totals.ownerNoCostServices}</strong></span><span>Paid-Tech Assigned Services <strong>${totals.paidTechServices}</strong></span><span>Unassigned Services <strong>${totals.unassignedServices}</strong></span></div>
    </div>
    <h3>Property Forecast</h3>
    <div class="service-pnl-table-wrap"><table class="route-frag-table service-pnl-table forecast-property-table"><thead><tr>
      <th>Property</th><th>Contract Revenue</th><th>Draft Revenue</th><th>Finalized Revenue</th><th>Remaining Potential Revenue</th><th>Remaining SDS Revenue</th><th>Total Expected Revenue</th>
      <th>Known Labor</th><th>Projected Labor</th><th>Fully Staffed Labor</th><th>Known Chemical Cost</th><th>Known Parts Cost</th>
      <th>Expected Service Profit</th><th>Property Operating Expenses</th><th>Expected Net Profit</th><th>Fully Staffed Profit</th><th>Expected Margin</th><th>Fully Staffed Margin</th>
    </tr></thead><tbody>${propertyTableRows}</tbody></table></div>
    <h3 class="forecast-audit-heading">Revenue Source Audit</h3>
    <div class="service-pnl-table-wrap"><table class="route-frag-table forecast-revenue-audit-table"><thead><tr>
      <th>Date / Period</th><th>Property</th><th>Source Type</th><th>Description</th><th>Classification</th><th>Contract Revenue</th><th>Draft Revenue</th>
      <th>Finalized Revenue</th><th>Remaining Potential Revenue</th><th>Remaining SDS Revenue</th>
    </tr></thead><tbody>${revenueSourceRows}</tbody></table></div>
    <h3 class="forecast-audit-heading">Task Cost and Staffing Audit</h3>
    <div class="service-pnl-table-wrap"><table class="route-frag-table forecast-audit-table"><thead><tr>
      <th>Date</th><th>Property</th><th>Service Type</th><th>Technician</th><th>Cost Classification</th><th>Known Labor</th><th>Projected Labor</th>
      <th>Fully Staffed Labor</th><th>Known Chemical Cost</th><th>Future Chemical Cost</th><th>Known Parts Cost</th><th>Future Parts Cost</th><th>Projected Contribution</th>
    </tr></thead><tbody>${costAuditRows}</tbody></table></div>
    ${renderBillingReportFooter()}
  </div>`;
}

function formatServicePnlMargin(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)}%` : "-";
}

function renderServicePnlReport() {
  if (!servicePnlContainer) return;

  const mode = servicePnlModeInputs.find((input) => input.checked)?.value || "actual";
  if (mode === "forecast") {
    renderServicePnlForecastReport();
    return;
  }

  const startDate = servicePnlStartDate?.value || "";
  const endDate = servicePnlEndDate?.value || "";
  if (!startDate || !endDate) {
    servicePnlContainer.innerHTML = '<div class="billing-report-sheet"><div class="empty">Select a start and end date.</div></div>';
    return;
  }
  if (startDate > endDate) {
    servicePnlContainer.innerHTML = '<div class="billing-report-sheet"><div class="empty">Start date must be on or before end date.</div></div>';
    return;
  }

  const rows = getServicePnlRows({
    startDate,
    endDate,
    selectedPropertyId: servicePnlPropertySelect?.value || "",
  });
  const selectedPropertyId = servicePnlPropertySelect?.value || "";
  const operatingExpenseRows = getFilteredExpenses({
    startDate,
    endDate,
    propertyId: selectedPropertyId,
  }).filter((expense) => !selectedPropertyId || Boolean(expense.property_id));
  const operatingExpenseCategoryTotals = getExpenseCategoryTotals(operatingExpenseRows);
  const generalBusinessExpenses = selectedPropertyId
    ? 0
    : operatingExpenseRows.filter((expense) => !expense.property_id).reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const propertySpecificExpenses = operatingExpenseRows
    .filter((expense) => Boolean(expense.property_id))
    .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const operatingExpenses = generalBusinessExpenses + propertySpecificExpenses;
  const totals = rows.reduce((summary, row) => {
    summary.guestEngineRevenue += row.guestEngineRevenue;
    summary.draftRevenue += row.draftRevenue;
    summary.finalizedRevenue += row.finalizedRevenue;
    summary.contractRevenue += row.contractRevenue;
    summary.revenue += row.revenue;
    summary.actualTechLabor += row.actualTechLabor;
    summary.potentialLabor += row.potentialLabor;
    summary.chemicalCost += row.chemicalCost;
    summary.partsCost += row.partsCost;
    summary.propertyOperatingExpenses += row.propertyOperatingExpenses;
    return summary;
  }, { guestEngineRevenue: 0, draftRevenue: 0, finalizedRevenue: 0, contractRevenue: 0, revenue: 0, actualTechLabor: 0, potentialLabor: 0, chemicalCost: 0, partsCost: 0, propertyOperatingExpenses: 0 });
  totals.actualDirectCosts = totals.actualTechLabor + totals.chemicalCost + totals.partsCost;
  totals.actualProfit = totals.revenue - totals.actualDirectCosts;
  totals.fullyStaffedProfit = totals.revenue - totals.potentialLabor - totals.chemicalCost - totals.partsCost;
  totals.actualMargin = totals.revenue !== 0 ? (totals.actualProfit / totals.revenue) * 100 : null;
  totals.fullyStaffedMargin = totals.revenue !== 0 ? (totals.fullyStaffedProfit / totals.revenue) * 100 : null;
  totals.operatingExpenses = operatingExpenses;
  totals.netOperatingProfit = totals.actualProfit - operatingExpenses;
  totals.operatingMargin = totals.revenue !== 0 ? (totals.netOperatingProfit / totals.revenue) * 100 : null;
  const partialMonthlyNotices = rows.flatMap((row) => row.partialMonthlyPeriods.map((period) => `${row.propertyName}: ${period}`));
  const reportNotices = [];
  if (partialMonthlyNotices.length > 0) {
    reportNotices.push(`Monthly contract revenue excluded for partial calendar period(s): ${partialMonthlyNotices.join(", ")}. No proration was applied.`);
  }
  if (!propertyContractRevenueHistoryAvailable) {
    reportNotices.push("Contract history is unavailable. Run the contract revenue migration before relying on historical P&L results.");
  }

  const tableRows = rows.length
    ? rows.map((row) => `
        <tr>
          <td>${escapeHtml(row.propertyName)}</td>
          <td class="route-frag-money">${toMoney(row.contractRevenue)}</td>
          <td class="route-frag-money">${toMoney(row.draftRevenue)}</td>
          <td class="route-frag-money">${toMoney(row.finalizedRevenue)}</td>
          <td class="route-frag-money">${toMoney(row.guestEngineRevenue)}</td>
          <td class="route-frag-money">${toMoney(row.revenue)}</td>
          <td>${row.ownerPerformedServices}</td>
          <td>${row.techPerformedServices}</td>
          <td class="route-frag-money">${toMoney(row.actualTechLabor)}</td>
          <td class="route-frag-money">${toMoney(row.potentialLabor)}</td>
          <td class="route-frag-money">${toMoney(row.chemicalCost)}</td>
          <td class="route-frag-money">${toMoney(row.partsCost)}</td>
          <td class="route-frag-money">${toMoney(row.actualProfit)}</td>
          <td class="route-frag-money">${toMoney(row.propertyOperatingExpenses)}</td>
          <td class="route-frag-money">${toMoney(row.propertyNetProfit)}</td>
          <td class="route-frag-money">${toMoney(row.fullyStaffedProfit)}</td>
          <td class="route-frag-money">${formatServicePnlMargin(row.actualMargin)}</td>
          <td class="route-frag-money">${formatServicePnlMargin(row.fullyStaffedMargin)}</td>
        </tr>
      `).join("")
    : '<tr><td colspan="18">No revenue, service costs, or property operating expenses found for this period.</td></tr>';
  const operatingCategoryRows = EXPENSE_CATEGORIES
    .filter((category) => Number(operatingExpenseCategoryTotals[category] || 0) > 0)
    .map((category) => `<tr><td>${escapeHtml(category)}</td><td class="route-frag-money">${toMoney(operatingExpenseCategoryTotals[category])}</td></tr>`)
    .join("");

  servicePnlContainer.innerHTML = `
    <div class="billing-report-sheet service-pnl-sheet">
      ${renderBillingReportHeader()}
      <h2 class="billing-report-title">Service P&amp;L</h2>
      <div class="billing-report-meta">Date Range: ${escapeHtml(startDate)} to ${escapeHtml(endDate)}</div>
      ${reportNotices.map((notice) => `<div class="billing-report-notice">${escapeHtml(notice)}</div>`).join("")}
      <div class="service-pnl-summary-grid">
        <article><span>Contract Revenue</span><strong>${toMoney(totals.contractRevenue)}</strong></article>
        <article><span>Draft Revenue</span><strong>${toMoney(totals.draftRevenue)}</strong></article>
        <article><span>Finalized Revenue</span><strong>${toMoney(totals.finalizedRevenue)}</strong></article>
        <article><span>Guest Engine Revenue</span><strong>${toMoney(totals.guestEngineRevenue)}</strong></article>
        <article class="service-pnl-highlight"><span>Total Service Revenue</span><strong>${toMoney(totals.revenue)}</strong></article>
        <article><span>Actual Tech Labor</span><strong>${toMoney(totals.actualTechLabor)}</strong></article>
        <article><span>Chemical Cost</span><strong>${toMoney(totals.chemicalCost)}</strong></article>
        <article><span>Parts Cost</span><strong>${toMoney(totals.partsCost)}</strong></article>
        <article><span>Actual Direct Costs</span><strong>${toMoney(totals.actualDirectCosts)}</strong></article>
        <article class="service-pnl-highlight"><span>Service Profit</span><strong>${toMoney(totals.actualProfit)}</strong></article>
        <article><span>Service Margin</span><strong>${formatServicePnlMargin(totals.actualMargin)}</strong></article>
        <article><span>Operating Expenses</span><strong>${toMoney(totals.operatingExpenses)}</strong></article>
        <article class="service-pnl-highlight"><span>Net Operating Profit</span><strong>${toMoney(totals.netOperatingProfit)}</strong></article>
        <article><span>Operating Margin</span><strong>${formatServicePnlMargin(totals.operatingMargin)}</strong></article>
        <article><span>Potential Fully Staffed Labor</span><strong>${toMoney(totals.potentialLabor)}</strong></article>
        <article class="service-pnl-highlight"><span>Fully Staffed Service Profit</span><strong>${toMoney(totals.fullyStaffedProfit)}</strong></article>
        <article><span>Fully Staffed Margin</span><strong>${formatServicePnlMargin(totals.fullyStaffedMargin)}</strong></article>
      </div>
      <div class="service-pnl-operating-breakdown">
        <h3>Operating Expense Breakdown</h3>
        <div class="service-pnl-expense-split">
          <span>General Business Expenses <strong>${toMoney(generalBusinessExpenses)}</strong></span>
          <span>Property-Specific Expenses <strong>${toMoney(propertySpecificExpenses)}</strong></span>
        </div>
        ${operatingCategoryRows ? `<table class="route-frag-table expense-category-table"><thead><tr><th>Category</th><th>Amount</th></tr></thead><tbody>${operatingCategoryRows}</tbody></table>` : '<div class="empty">No operating expenses in this period.</div>'}
      </div>
      <div class="service-pnl-table-wrap">
        <table class="route-frag-table service-pnl-table">
          <thead>
            <tr>
              <th>Property</th>
              <th>Contract Revenue</th>
              <th>Draft Revenue</th>
              <th>Finalized Revenue</th>
              <th>Guest Engine Revenue</th>
              <th>Total Service Revenue</th>
              <th>Owner-Performed Services</th>
              <th>Tech-Performed Services</th>
              <th>Actual Tech Labor</th>
              <th>Potential Labor</th>
              <th>Chemical Cost</th>
              <th>Parts Cost</th>
              <th>Service Profit</th>
              <th>Property Operating Expenses</th>
              <th>Property Net Profit</th>
              <th>Fully Staffed Profit</th>
              <th>Service Margin</th>
              <th>Fully Staffed Margin</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
      ${renderBillingReportFooter()}
    </div>
  `;
}

function getBillingReportRows() {
  if (!billingReportStartDate || !billingReportEndDate) return [];

  const startDate = billingReportStartDate.value;
  const endDate = billingReportEndDate.value;
  if (!startDate || !endDate) return [];

  const selectedPropertyId = billingReportPropertySelect?.value || "";
  const selectedClientName = billingReportClientSelect?.value || "";
  const reconciledOnly = billingReconciledOnly ? billingReconciledOnly.checked : true;

  const rows = getBillingReportRowsForFilters({
    startDate,
    endDate,
    selectedPropertyId,
    selectedClientName,
    includeInvoiced: true,
  });

  const sdsRows = getSdsBillingReportRowsForFilters({
    startDate,
    endDate,
    selectedPropertyId,
    selectedClientName,
    includeInvoiced: true,
  });

  const combinedRows = [...rows, ...sdsRows];

  return reconciledOnly ? combinedRows.filter((row) => isBillingRowReconciled(row)) : combinedRows;
}

function isBillingRowReconciled(row) {
  return isTaskReconciled(row) || isTaskLinkedToFinalizedInvoice(row);
}

function getActiveBillingFilterState() {
  const hasExplicitRange = Boolean(billingReportStartDate?.value && billingReportEndDate?.value);
  if (hasExplicitRange) {
    return {
      startDate: billingReportStartDate.value,
      endDate: billingReportEndDate.value,
      selectedPropertyId: billingReportPropertySelect?.value || "",
      selectedClientName: billingReportClientSelect?.value || "",
    };
  }

  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return {
    startDate: formatDateValue(monthStart),
    endDate: formatDateValue(monthEnd),
    selectedPropertyId: billingReportPropertySelect?.value || "",
    selectedClientName: billingReportClientSelect?.value || "",
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
    selectedPropertyId: billingReportPropertySelect?.value || "",
    selectedClientName: billingReportClientSelect?.value || "",
  };
}

function clearCurrentInvoiceDraftState() {
  currentInvoiceDraft = null;
  currentInvoiceBatchDrafts = [];
  clearInvoiceEligibilitySummary();
  renderInvoicePreview();
  renderInvoiceBatchPreview();
}

function showBillingInvoiceHandoffMessage(message) {
  if (!billingInvoiceHandoffMessage) return;
  billingInvoiceHandoffMessage.textContent = message;
  billingInvoiceHandoffMessage.classList.remove("hidden");
}

function hideBillingInvoiceHandoffMessage() {
  if (!billingInvoiceHandoffMessage) return;
  billingInvoiceHandoffMessage.textContent = "";
  billingInvoiceHandoffMessage.classList.add("hidden");
}

function setSelectMarkup(selectElement, markup) {
  if (!selectElement || selectElement.innerHTML === markup) return;
  const previousValue = selectElement.value;
  selectElement.innerHTML = markup;
  if (Array.from(selectElement.options).some((option) => option.value === previousValue)) {
    selectElement.value = previousValue;
  }
}

function syncClientSelectToPropertySelection(clientSelect, propertySelect) {
  if (!clientSelect || !propertySelect || !propertySelect.value) return;
  const selectedProperty = properties.find((property) => normalizePropertyId(property.id) === normalizePropertyId(propertySelect.value));
  clientSelect.value = String(selectedProperty?.client_name || "").trim();
}

function getClientNameForPropertyId(propertyId) {
  if (!propertyId) return "";
  const selectedProperty = properties.find((property) => normalizePropertyId(property.id) === normalizePropertyId(propertyId));
  return String(selectedProperty?.client_name || "").trim();
}

function getClientOptionsMarkup() {
  return `<option value="">All Clients</option>${Array.from(new Set(
    properties
      .map((property) => String(property.client_name || "").trim())
      .filter(Boolean)
  ))
    .sort((a, b) => a.localeCompare(b))
    .map((clientName) => `<option value="${clientName}">${clientName}</option>`)
    .join("")}`;
}

function getPropertyOptionsMarkup(selectedClientName = "") {
  const normalizedClientName = String(selectedClientName || "").trim();
  return `<option value="">All Properties</option>${properties
    .filter((property) => !normalizedClientName || String(property.client_name || "").trim() === normalizedClientName)
    .slice()
    .sort((a, b) => (a.property_name || "").localeCompare(b.property_name || ""))
    .map((property) => `<option value="${property.id}">${property.property_name}</option>`)
    .join("")}`;
}

function populateBillingFilterSelects(clientSelect, propertySelect) {
  if (clientSelect) {
    setSelectMarkup(clientSelect, getClientOptionsMarkup());
  }

  if (propertySelect) {
    const propertyMarkup = getPropertyOptionsMarkup(clientSelect?.value || "");
    const previousValue = propertySelect.value;
    setSelectMarkup(propertySelect, propertyMarkup);
    if (previousValue && !Array.from(propertySelect.options).some((option) => option.value === previousValue)) {
      propertySelect.value = "";
    }
  }
}

function syncBillingReportFiltersFromInvoices() {
  if (billingReportStartDate && billingStartDate) {
    billingReportStartDate.value = billingStartDate.value;
  }
  if (billingReportEndDate && billingEndDate) {
    billingReportEndDate.value = billingEndDate.value;
  }
  if (billingReportClientSelect && billingClientSelect) {
    billingReportClientSelect.value = billingClientSelect.value;
  }
  populateBillingFilterSelects(billingReportClientSelect, billingReportPropertySelect);
  if (billingReportPropertySelect && billingPropertySelect) {
    billingReportPropertySelect.value = billingPropertySelect.value;
    if (!Array.from(billingReportPropertySelect.options).some((option) => option.value === billingReportPropertySelect.value)) {
      billingReportPropertySelect.value = "";
    }
  }
  if (billingReportIncludeNonBillableChemicals && invoiceIncludeNonBillableChemicals) {
    billingReportIncludeNonBillableChemicals.checked = invoiceIncludeNonBillableChemicals.checked;
  }
  if (billingReportTaxEnabled && invoiceTaxEnabled) {
    billingReportTaxEnabled.value = invoiceTaxEnabled.value;
  }
}

function syncInvoiceFiltersFromBillingReport() {
  if (billingStartDate && billingReportStartDate) {
    billingStartDate.value = billingReportStartDate.value;
  }
  if (billingEndDate && billingReportEndDate) {
    billingEndDate.value = billingReportEndDate.value;
  }
  if (billingClientSelect && billingReportClientSelect) {
    billingClientSelect.value = billingReportClientSelect.value;
  }
  populateBillingFilterSelects(billingClientSelect, billingPropertySelect);
  if (billingPropertySelect && billingReportPropertySelect) {
    billingPropertySelect.value = billingReportPropertySelect.value;
    if (!Array.from(billingPropertySelect.options).some((option) => option.value === billingPropertySelect.value)) {
      billingPropertySelect.value = "";
    }
  }
  if (invoiceIncludeNonBillableChemicals && billingReportIncludeNonBillableChemicals) {
    invoiceIncludeNonBillableChemicals.checked = billingReportIncludeNonBillableChemicals.checked;
  }
  if (invoiceTaxEnabled && billingReportTaxEnabled) {
    invoiceTaxEnabled.value = billingReportTaxEnabled.value;
  }
}

function getCurrentBillingInvoiceHandoffFilters() {
  const selectedPropertyId = billingReportPropertySelect?.value || "";
  const selectedClientName = billingReportClientSelect?.value || getClientNameForPropertyId(selectedPropertyId);
  return {
    startDate: billingReportStartDate?.value || "",
    endDate: billingReportEndDate?.value || "",
    selectedClientName,
    selectedPropertyId,
    includeNonBillableChemicals: billingReportIncludeNonBillableChemicals?.checked === true,
    taxOverride: billingReportTaxEnabled?.value || "property",
  };
}

function hasInvoiceCandidatesForBillingFilters() {
  const {
    startDate,
    endDate,
    selectedClientName,
    selectedPropertyId,
    includeNonBillableChemicals,
  } = getCurrentBillingInvoiceHandoffFilters();

  const billingRows = getBillingReportRows();
  if (billingRows.length > 0) {
    return true;
  }

  const chemicalItems = getInvoiceChemicalCandidates({
    startDate,
    endDate,
    selectedPropertyId,
    selectedClientName,
    includeNonBillableChemicals,
  });

  return chemicalItems.length > 0;
}

async function createInvoiceFromBillingReport() {
  if (!requireAdminAccess()) return;
  hideBillingInvoiceHandoffMessage();

  syncClientSelectToPropertySelection(billingReportClientSelect, billingReportPropertySelect);

  const { startDate, endDate } = getCurrentBillingInvoiceHandoffFilters();
  if (!startDate || !endDate) {
    showBillingInvoiceHandoffMessage("Select a start and end date before creating an invoice.");
    return;
  }

  if (!hasInvoiceCandidatesForBillingFilters()) {
    showBillingInvoiceHandoffMessage("No billable items found for the selected filters.");
    return;
  }

  syncInvoiceFiltersFromBillingReport();
  clearCurrentInvoiceDraftState();
  renderInvoiceHistory();
  await navigateToView("invoices");
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
  populateBillingFilterSelects(billingReportClientSelect, billingReportPropertySelect);
  populateBillingFilterSelects(billingClientSelect, billingPropertySelect);

  const rows = getBillingReportRows();
  const startDate = billingReportStartDate?.value || "";
  const endDate = billingReportEndDate?.value || "";
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
      const serviceLabel = getServiceTypeDisplayLabel(item.service_type);
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
        <div class="empty">No billable reconciled tasks found for the selected filters.</div>
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
  invoiceItems = [];
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
  invoicePropertyLabelById = new Map();

  const invoiceIds = invoices.map((invoice) => invoice.id).filter(Boolean);
  if (!invoiceIds.length) return;

  const { data: invoiceItemsData, error: invoiceItemsError } = await supabaseClient
    .from("invoice_items")
    .select("*")
    .in("invoice_id", invoiceIds);

  if (invoiceItemsError) {
    console.warn("Could not load invoice item property labels:", invoiceItemsError.message);
    return;
  }

  invoiceItems = invoiceItemsData || [];

  const itemsByInvoiceId = new Map();
  (invoiceItemsData || []).forEach((item) => {
    const key = String(item?.invoice_id || "");
    if (!key) return;
    if (!itemsByInvoiceId.has(key)) {
      itemsByInvoiceId.set(key, []);
    }
    itemsByInvoiceId.get(key).push(item);
  });

  invoices.forEach((invoice) => {
    const key = String(invoice.id || "");
    if (!key) return;
    invoicePropertyLabelById.set(key, buildInvoicePropertyHistoryLabel({
      invoice,
      invoiceItems: itemsByInvoiceId.get(key) || [],
    }));
  });
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
    description: isHousekeepingTask(row)
      ? `${row.propertyName || getPropertyName(row.property_id)} - Housekeeping`
      : isLawnTask(row)
      ? `${row.propertyName || getPropertyName(row.property_id)} - ${normalizeServiceFrequency(getPropertyById(row.property_id)?.lawn_service_frequency) === SERVICE_FREQUENCY_BIWEEKLY ? "Biweekly Lawn Service" : "Lawn Service"}`
      : `${row.propertyName || getPropertyName(row.property_id)} - ${row.serviceLabel || row.service_type || "Cleaning Service"} (${row.billingReasonLabel || "Chargeable"})`,
    serviceDate: row.serviceDate || row.service_date || row.scheduled_date || "",
    quantity: Number(row.quantity || 1),
    unit: row.unit || "service",
    rate: Number(row.rate || row.billableAmount || 0),
    amount: Number(row.billableAmount || 0),
    itemType: "cleaning",
    itemSource: INVOICE_ITEM_SOURCES.TASK,
    serviceBranch: normalizeServiceBranch(row.service_branch),
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

// SDS candidates are reconciled-only (mirrors the Weekly Standard reconcile-gated pattern) and always
// rendered as their own invoice line item — never merged into the Guest Ready/Weekly task line.
function getInvoiceSdsCandidates({ startDate, endDate, selectedPropertyId = "", selectedClientName = "" }) {
  const rows = getSdsBillingReportRowsForFilters({
    startDate,
    endDate,
    selectedPropertyId,
    selectedClientName,
    includeInvoiced: false,
  }).filter((row) => row.invoiced);

  return rows.map((row) => ({
    sourceId: row.taskId,
    taskId: row.taskId,
    chemicalUsageId: null,
    propertyId: row.property_id,
    propertyName: row.propertyName,
    clientName: row.clientName || "",
    description: `${row.propertyName} - Same-Day Turnover Surcharge`,
    serviceDate: row.serviceDate,
    quantity: 1,
    unit: "service",
    rate: Number(row.billableAmount || 0),
    amount: Number(row.billableAmount || 0),
    itemType: "sds",
    itemSource: INVOICE_ITEM_SOURCES.SDS,
    notes: "",
  }));
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

  const sdsItems = getInvoiceSdsCandidates({
    startDate,
    endDate,
    selectedPropertyId,
    selectedClientName,
  }).filter((item) => !propertyIds.length || propertyIds.some((id) => normalizePropertyId(id) === normalizePropertyId(item.propertyId)));

  latestInvoiceCandidates = {
    tasks: taskItems,
    chemicalRows: chemicalItems,
  };

  const items = [...taskItems, ...chemicalItems, ...sdsItems];
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
    companyBranch: normalizeCompanyBranch(property?.company_branch),
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

function normalizeInvoicePropertyLabelName(value) {
  const name = String(value || "").trim();
  if (!name) return "";
  const normalized = name.toLowerCase();
  if (normalized === "unknown property" || normalized === "multiple properties" || normalized === "all properties") {
    return "";
  }
  return name;
}

function getSavedInvoicePropertyName(invoice = {}) {
  const directName = normalizeInvoicePropertyLabelName(invoice.property_name || invoice.propertyName);
  if (directName) return directName;

  const invoicePropertyId = normalizePropertyId(invoice.property_id ?? invoice.propertyId);
  if (!invoicePropertyId) return "";
  const property = properties.find((item) => normalizePropertyId(item.id) === invoicePropertyId);
  return normalizeInvoicePropertyLabelName(property?.property_name);
}

function getSelectedInvoicePropertyName(selectedPropertyId = "", selectedPropertyName = "") {
  const rawSelectedId = String(selectedPropertyId || "").trim();
  if (!rawSelectedId || rawSelectedId.toLowerCase() === "all") return "";

  const directName = normalizeInvoicePropertyLabelName(selectedPropertyName);
  if (directName) return directName;

  const normalizedId = normalizePropertyId(rawSelectedId);
  if (!normalizedId) return "";
  const property = properties.find((item) => normalizePropertyId(item.id) === normalizedId);
  return normalizeInvoicePropertyLabelName(property?.property_name);
}

function getInvoiceItemPropertyName(item) {
  const directName = normalizeInvoicePropertyLabelName(item?.property_name || item?.propertyName || item?.property);
  if (directName) return directName;

  const description = String(item?.description || "").trim();
  if (!description.includes(" - ")) return "";
  const prefix = String(description.split(" - ")[0] || "").trim();
  if (!prefix) return "";

  const knownPropertyNames = new Set(
    properties
      .map((property) => String(property?.property_name || "").trim().toLowerCase())
      .filter(Boolean)
  );
  return knownPropertyNames.has(prefix.toLowerCase()) ? normalizeInvoicePropertyLabelName(prefix) : "";
}

function getInvoicePropertyNames(invoiceItems = []) {
  return [
    ...new Set(
      (invoiceItems || [])
        .map((item) => getInvoiceItemPropertyName(item))
        .filter(Boolean)
    ),
  ];
}

function buildInvoicePropertyHeaderLabel({ invoice = {}, invoiceItems = [] } = {}) {
  const propertyNames = getInvoicePropertyNames(invoiceItems);
  if (propertyNames.length === 1) {
    return `Property: ${propertyNames[0]}`;
  }
  if (propertyNames.length > 1) {
    return `Properties: ${propertyNames.join(", ")}`;
  }

  const savedPropertyName = getSavedInvoicePropertyName(invoice);
  return savedPropertyName ? `Property: ${savedPropertyName}` : "Properties: Multiple Properties";
}

function buildInvoicePropertyHistoryLabel({ invoice = {}, invoiceItems = [] } = {}) {
  return buildInvoicePropertyHeaderLabel({ invoice, invoiceItems });
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

  const selectedPropertyId = String(billingPropertySelect?.value || "").trim();
  const selectedPropertyName = selectedPropertyId && selectedPropertyId.toLowerCase() !== "all"
    ? String(billingPropertySelect?.selectedOptions?.[0]?.textContent || "").trim()
    : "";
  const invoicePropertyHeaderLabel = buildInvoicePropertyHeaderLabel({
    invoice,
    invoiceItems: invoice.items || [],
    selectedPropertyId,
    selectedPropertyName,
  });
  const billingName = invoice.billingCompanyName || invoice.clientName;
  const billingEmail = String(invoice.billingEmail || "").trim();
  const billingAddress = String(invoice.billingAddress || "").trim();
  const accountReference = String(invoice.accountReference || "").trim();
  const notes = String(invoice.notes || "").trim();
  const showTaxLine = invoice.taxable && Number(invoice.taxRate || 0) > 0;
  const invoiceBranch = getInvoiceCompanyBranch(invoice);
  const invoiceBranding = getCompanyBrandingForBranch(invoiceBranch);

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
        ${renderBillingReportHeader(invoiceBranding)}
        <div class="billing-report-meta"><strong>${escapeHtml(invoiceBranding.companyName)}</strong></div>
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
        <div class="billing-report-meta">${escapeHtml(invoicePropertyHeaderLabel)}</div>
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
        <div class="invoice-preview-actions no-print">
          <button type="button" onclick="addInvoiceManualItem()">Add Line Item</button>
          <button type="button" onclick="addInvoiceDiscountItem()">Add Discount</button>
          <button type="button" onclick="addInvoiceCreditItem()">Add Credit</button>
          <button type="button" onclick="addInvoiceSurchargeItem()">Add Surcharge</button>
        </div>
        <div class="billing-report-meta">Payment Instructions: Please remit payment to ${escapeHtml(invoiceBranding.companyName)} by due date.</div>
        ${renderBillingReportFooter(invoiceBranding)}
      </div>

      <div class="invoice-print-view">
        <div class="invoice-print-header">
          <div>
            <div class="invoice-brand-row">
              ${renderBillingReportHeader(invoiceBranding)}
            </div>
            <div class="invoice-print-text"><strong>${escapeHtml(invoiceBranding.companyName)}</strong></div>
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
            <div class="invoice-print-text">${escapeHtml(invoicePropertyHeaderLabel)}</div>
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
        <div class="billing-report-meta">Payment Instructions: Please remit payment to ${escapeHtml(invoiceBranding.companyName)} by due date.</div>
        ${renderBillingReportFooter(invoiceBranding)}
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
    "No reconciled or completed chargeable tasks were found in the selected date range.",
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
  if (!requireAdminAccess()) return false;
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
    service_branch: item.serviceBranch || null,
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
  if (!requireAdminAccess()) return;
  if (!currentInvoiceDraft) return;

  const saved = await saveInvoiceDraft();
  if (!saved) return;
  if (!currentInvoiceDraft?.id) return;

  const cleaningTaskIds = Array.from(new Set(currentInvoiceDraft.items
    .filter((item) => item.taskId && item.itemSource !== INVOICE_ITEM_SOURCES.SDS)
    .map((item) => item.taskId)));
  const sdsTaskIds = Array.from(new Set(currentInvoiceDraft.items
    .filter((item) => item.taskId && item.itemSource === INVOICE_ITEM_SOURCES.SDS)
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

  if (sdsTaskIds.length) {
    const { data: latestSdsTasks, error: latestSdsTaskError } = await supabaseClient
      .from("cleaning_tasks")
      .select("id, same_day_surcharge_reconciled, same_day_surcharge_invoice_id")
      .in("id", sdsTaskIds);

    if (latestSdsTaskError) {
      alert("Could not verify Same-Day Surcharge billing status before finalizing: " + latestSdsTaskError.message);
      return;
    }

    const duplicateSds = (latestSdsTasks || []).find((task) => isSdsLinkedToFinalizedInvoice(task));
    if (duplicateSds) {
      alert("One or more Same-Day Surcharge charges are already invoiced. Finalize canceled to prevent duplicate billing.");
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

  if (sdsTaskIds.length) {
    const { error: sdsUpdateError } = await supabaseClient
      .from("cleaning_tasks")
      .update({
        same_day_surcharge_reconciled: true,
        same_day_surcharge_invoice_id: currentInvoiceDraft.id,
        same_day_surcharge_reconciled_at: new Date().toISOString(),
      })
      .in("id", sdsTaskIds);

    if (sdsUpdateError) {
      alert("Invoice finalized, but linking Same-Day Surcharge charges failed: " + sdsUpdateError.message);
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
  if (!requireAdminAccess()) return;
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

    const { error: sdsReleaseError } = await supabaseClient
      .from("cleaning_tasks")
      .update({
        same_day_surcharge_reconciled: false,
        same_day_surcharge_invoice_id: null,
        same_day_surcharge_reconciled_at: null,
      })
      .eq("same_day_surcharge_invoice_id", invoiceId);

    if (sdsReleaseError) {
      alert("Invoice was voided, but Same-Day Surcharge linkage release failed: " + sdsReleaseError.message);
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
    companyBranch: normalizeCompanyBranch(property?.company_branch),
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
      property_name: item.property_name || "",
      propertyName: item.property_name || item.propertyName || "",
      description: item.description || "",
      serviceDate: item.service_date || "",
      quantity: Number(item.quantity || 0),
      unit: item.unit || "",
      rate: Number(item.rate || 0),
      amount: Number(item.amount || 0),
      itemType: item.item_type || "manual",
      itemSource: item.item_source || (item.task_id ? INVOICE_ITEM_SOURCES.TASK : item.chemical_usage_id ? INVOICE_ITEM_SOURCES.CHEMICAL : INVOICE_ITEM_SOURCES.MANUAL),
      serviceBranch: item.service_branch || null,
      notes: item.notes || "",
    })),
    subtotal: Number(invoice.subtotal || 0),
    tax: Number(invoice.tax || 0),
    total: Number(invoice.total || 0),
  };

  renderInvoicePreview();
}

async function deleteInvoiceDraft(invoiceId) {
  const invoice = invoices.find((row) => row.id === invoiceId);
  if (!invoice) return;

  const status = String(invoice.status || "").toLowerCase();
  if (status !== "draft") {
    alert("Only draft invoices can be deleted.");
    return;
  }

  const invoiceNumber = String(invoice.invoice_number || "(draft)");
  const confirmed = confirm(
    `Delete draft invoice ${invoiceNumber}?\n\nThis will permanently delete the draft and its invoice line items.\nCleaning tasks and chemical records must remain unchanged.`
  );
  if (!confirmed) return;

  const { error: deleteItemsError } = await supabaseClient
    .from("invoice_items")
    .delete()
    .eq("invoice_id", invoiceId);

  if (deleteItemsError) {
    alert("Could not delete draft invoice line items: " + deleteItemsError.message);
    return;
  }

  const { error: deleteInvoiceError } = await supabaseClient
    .from("invoices")
    .delete()
    .eq("id", invoiceId)
    .eq("status", "draft");

  if (deleteInvoiceError) {
    alert("Could not delete draft invoice: " + deleteInvoiceError.message);
    return;
  }

  if (currentInvoiceDraft && String(currentInvoiceDraft.id || "") === String(invoiceId)) {
    currentInvoiceDraft = null;
    renderInvoicePreview();
  }

  await loadInvoices();
  renderInvoiceHistory();
}

function getInvoiceHistoryDeleteMode(invoice) {
  const status = String(invoice?.status || "").toLowerCase();
  if (status === "draft") return "draft";
  if (status === "finalized") return "finalized";
  if ((status === "sent" || status === "paid") && isProtectedAccessUnlocked) return "protected";
  return "blocked";
}

function getInvoiceItemTaskId(item) {
  const itemSource = String(item?.item_source || "").toLowerCase();
  if (item?.task_id) return item.task_id;
  if (itemSource === "task" && item?.source_id) return item.source_id;
  return null;
}

function getInvoiceItemChemicalUsageId(item) {
  const itemSource = String(item?.item_source || "").toLowerCase();
  if (item?.chemical_usage_id) return item.chemical_usage_id;
  if (itemSource === "chemical" && item?.source_id) return item.source_id;
  return null;
}

async function updateInvoiceSourceReleaseRows(tableName, ids, fields) {
  if (!ids.length) return { error: null };

  let payload = { ...fields };
  let lastError = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { error } = await supabaseClient
      .from(tableName)
      .update(payload)
      .in("id", ids);

    if (!error) {
      return { error: null };
    }

    lastError = error;
    const message = String(error.message || "").toLowerCase();
    const missingColumns = Object.keys(payload).filter((column) => message.includes(column.toLowerCase()));
    if (!missingColumns.length) {
      break;
    }

    missingColumns.forEach((column) => {
      delete payload[column];
    });

    if (!Object.keys(payload).length) {
      break;
    }
  }

  return { error: lastError };
}

async function deleteFinalizedOrProtectedInvoice(invoiceId) {
  const invoice = invoices.find((row) => row.id === invoiceId);
  if (!invoice) return;

  const mode = getInvoiceHistoryDeleteMode(invoice);
  if (mode === "blocked") {
    alert("This invoice cannot be deleted unless the app is in admin/test mode.");
    return;
  }

  const invoiceNumber = String(invoice.invoice_number || "(pending)");
  const status = String(invoice.status || "").toLowerCase();
  const confirmationMessage = status === "finalized"
    ? `Delete finalized invoice ${invoiceNumber}?\n\nThis will permanently delete the finalized invoice and its invoice items.\nAny linked cleaning tasks and chemical usage must be released so they can be invoiced again.\n\nType DELETE to confirm.`
    : `Delete ${status} invoice ${invoiceNumber}?\n\nThis will permanently delete the invoice and its invoice items.\nAny linked cleaning tasks and chemical usage must be released so they can be invoiced again.\n\nType DELETE to confirm.`;

  const typedConfirmation = window.prompt(confirmationMessage, "");
  if (String(typedConfirmation || "").trim().toUpperCase() !== "DELETE") {
    return;
  }

  const { data: invoiceItems, error: invoiceItemsError } = await supabaseClient
    .from("invoice_items")
    .select("*")
    .eq("invoice_id", invoiceId);

  if (invoiceItemsError) {
    alert("Could not load invoice line items for deletion: " + invoiceItemsError.message);
    return;
  }

  const taskIds = Array.from(new Set((invoiceItems || []).map(getInvoiceItemTaskId).filter(Boolean)));
  const chemicalUsageIds = Array.from(new Set((invoiceItems || []).map(getInvoiceItemChemicalUsageId).filter(Boolean)));

  if (taskIds.length) {
    const { error: taskReleaseError } = await updateInvoiceSourceReleaseRows("cleaning_tasks", taskIds, {
      invoiced: false,
      invoiced_invoice_id: null,
      invoice_id: null,
      invoiced_at: null,
    });

    if (taskReleaseError) {
      alert("Could not release linked cleaning tasks: " + taskReleaseError.message);
      return;
    }
  }

  if (chemicalUsageIds.length) {
    const { error: chemicalReleaseError } = await updateInvoiceSourceReleaseRows("chemical_usage", chemicalUsageIds, {
      invoiced: false,
      invoiced_invoice_id: null,
      invoice_id: null,
      invoiced_at: null,
    });

    if (chemicalReleaseError) {
      alert("Could not release linked chemical usage: " + chemicalReleaseError.message);
      return;
    }
  }

  const { error: deleteItemsError } = await supabaseClient
    .from("invoice_items")
    .delete()
    .eq("invoice_id", invoiceId);

  if (deleteItemsError) {
    alert("Could not delete invoice line items: " + deleteItemsError.message);
    return;
  }

  const { error: deleteInvoiceError } = await supabaseClient
    .from("invoices")
    .delete()
    .eq("id", invoiceId);

  if (deleteInvoiceError) {
    alert("Could not delete invoice: " + deleteInvoiceError.message);
    return;
  }

  if (currentInvoiceDraft && String(currentInvoiceDraft.id || "") === String(invoiceId)) {
    currentInvoiceDraft = null;
    renderInvoicePreview();
  }

  await loadInvoices();
  await loadCleaningTasks();
  await loadChemicalUsageEntries();
  renderInvoiceHistory();
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
    const propertyName = invoicePropertyLabelById.get(String(invoice.id || "")) || "Multiple Properties";
    const deleteMode = getInvoiceHistoryDeleteMode(invoice);
    const showDeleteButton = deleteMode === "draft" || deleteMode === "finalized" || deleteMode === "protected";
    const deleteHandler = deleteMode === "draft" ? `deleteInvoiceDraft('${invoice.id}')` : `deleteFinalizedOrProtectedInvoice('${invoice.id}')`;
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
        <td class="invoice-history-actions">
          <button type="button" onclick="openInvoiceDraft('${invoice.id}')">Open</button>
          ${showDeleteButton ? `<button type="button" class="delete-btn" onclick="${deleteHandler}">Delete</button>` : ""}
        </td>
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
  const invoiceBranding = getCompanyBrandingForBranch(getInvoiceCompanyBranch(invoice));
  const lines = [
    `${invoiceBranding.companyName} Invoice ${invoice.invoiceNumber || "(pending)"}`,
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

  const reportProperties = properties;
  if (!reportProperties.length) {
    routeFragContainer.innerHTML = `<div class="empty">No properties found.</div>`;
    return;
  }

  const clientLabels = Array.from(new Set(reportProperties.map((property) => getRouteFragmentationGroupLabel(property))))
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
    ? reportProperties.filter((property) => getRouteFragmentationGroupLabel(property) === selectedClient)
    : reportProperties;

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
  if (isManagerUser()) return task.manager_reconcile_eligible === true;
  if (!isAdminUser()) return false;
  if (isTaskReconciled(task)) return false;

  if (isLawnTask(task)) {
    return String(task.status || "").toLowerCase() === "completed"
      && !isTaskLinkedToFinalizedInvoice(task)
      && getTaskBillingAmount(task) > 0;
  }

  if (task.service_type === "Weekly Standard") {
    const status = String(task.status || "").toLowerCase();
    if (status === "cancelled" || status === "void" || status === "deleted") return false;
    if (isTaskLinkedToFinalizedInvoice(task)) return false;
    return getTaskBillingAmount(task) > 0;
  }

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

// Same-Day Surcharge (SDS) is a separate billable line from the Guest Ready/Weekly charge,
// with its own reconcile control and its own reconciliation flags on cleaning_tasks.
function getEffectiveSameDaySurcharge(task, property) {
  const taskAmount = Number(task?.same_day_surcharge_amount || 0);
  if (taskAmount > 0) return taskAmount;
  const propertyAmount = Number(property?.same_day_surcharge || 0);
  return propertyAmount > 0 ? propertyAmount : 0;
}

function getSdsBillingAmount(task) {
  const property = properties.find((p) => p.id === task.property_id);
  return getEffectiveSameDaySurcharge(task, property);
}

function isSdsReconciled(task) {
  return task?.same_day_surcharge_reconciled === true || task?.same_day_surcharge_reconciled === 1 || task?.same_day_surcharge_reconciled === "true";
}

function isSdsLinkedToFinalizedInvoice(task) {
  const linkedInvoiceId = task?.same_day_surcharge_invoice_id || null;
  if (!linkedInvoiceId) return false;
  const status = getInvoiceStatusById(linkedInvoiceId);
  if (!status) return true;
  return isFinalizedInvoiceStatus(status);
}

function shouldShowSdsReconcileForTask(task) {
  if (!task) return false;
  if (isManagerUser()) return task.manager_sds_reconcile_eligible === true;
  if (!isAdminUser()) return false;
  if (!isSameDayTurnoverTask(task)) return false;
  if (isSdsReconciled(task)) return false;
  if (isSdsLinkedToFinalizedInvoice(task)) return false;
  return getSdsBillingAmount(task) > 0;
}

function getSdsBillingLine(task) {
  if (!isAdminUser()) return "";
  if (!isSameDayTurnoverTask(task)) return "";
  const amount = getSdsBillingAmount(task);
  if (amount <= 0) return "";
  const reconciledLabel = isSdsReconciled(task) || isSdsLinkedToFinalizedInvoice(task) ? " (Reconciled)" : "";
  return `<div class="task-line"><small>Same-Day Surcharge: $${amount.toFixed(2)}${reconciledLabel}</small></div>`;
}

function renderSdsReconcileControl(task) {
  if (!shouldShowSdsReconcileForTask(task)) return "";
  const invoiceMarkerClass = task.same_day_surcharge_reconciled ? "invoice-marker-checked" : "invoice-marker-unchecked";
  return `
    <label class="invoice-marker ${invoiceMarkerClass}">
      <input type="checkbox" ${task.same_day_surcharge_reconciled ? "checked" : ""} onchange="toggleSdsInvoiceMarker('${task.id}')" />
      <span>${isManagerUser() ? "Reconcile SDS" : "SDS Reconcile"}</span>
    </label>
  `;
}

function toggleSdsInvoiceMarker(taskId) {
  if (isManagerUser()) {
    reconcileManagerTask(taskId, "sds");
    return;
  }
  if (!requireAdminAccess()) return;
  const task = cleaningTasks.find((t) => t.id === taskId);
  if (!task) return;

  if (isSdsLinkedToFinalizedInvoice(task)) {
    alert("This Same-Day Surcharge is already linked to a finalized invoice and cannot be changed.");
    return;
  }

  const newReconciled = !task.same_day_surcharge_reconciled;
  const updatePayload = { same_day_surcharge_reconciled: newReconciled };
  const previousAmount = task.same_day_surcharge_amount;
  const previousReconciledAt = task.same_day_surcharge_reconciled_at;

  if (newReconciled) {
    updatePayload.same_day_surcharge_reconciled_at = new Date().toISOString();
    // Snapshot the effective SDS amount at reconcile time so a later property rate change never alters this historical charge.
    if (!(Number(task.same_day_surcharge_amount || 0) > 0)) {
      const effectiveAmount = getSdsBillingAmount(task);
      if (effectiveAmount > 0) {
        updatePayload.same_day_surcharge_amount = effectiveAmount;
      }
    }
  } else {
    updatePayload.same_day_surcharge_reconciled_at = null;
  }

  task.same_day_surcharge_reconciled = newReconciled;
  if ("same_day_surcharge_amount" in updatePayload) {
    task.same_day_surcharge_amount = updatePayload.same_day_surcharge_amount;
  }
  task.same_day_surcharge_reconciled_at = updatePayload.same_day_surcharge_reconciled_at;
  renderTaskViews();
  refreshBillingCard();

  supabaseClient
    .from("cleaning_tasks")
    .update(updatePayload)
    .eq("id", taskId)
    .then(({ error }) => {
      if (error) {
        task.same_day_surcharge_reconciled = !newReconciled;
        task.same_day_surcharge_amount = previousAmount;
        task.same_day_surcharge_reconciled_at = previousReconciledAt;
        renderTaskViews();
        refreshBillingCard();
        alert("Error updating SDS reconcile marker: " + error.message);
      } else {
        refreshBillingCard();
      }
    });
}

async function reconcileManagerTask(taskId, reconciliationType) {
  if (!isManagerUser()) return;
  const task = cleaningTasks.find((item) => item.id === taskId);
  if (!task) return;

  const eligibilityField = reconciliationType === "sds"
    ? "manager_sds_reconcile_eligible"
    : "manager_reconcile_eligible";
  if (task[eligibilityField] !== true) return;

  task[eligibilityField] = false;
  renderTaskViews();
  if (document.getElementById("propertiesView")?.classList.contains("hidden") === false) renderManagerProperties();

  const { error } = await supabaseClient.rpc("manager_reconcile_task", {
    target_task_id: taskId,
    reconciliation_type: reconciliationType,
  });
  if (error) {
    task[eligibilityField] = true;
    renderTaskViews();
    if (document.getElementById("propertiesView")?.classList.contains("hidden") === false) renderManagerProperties();
    alert(`Could not reconcile ${reconciliationType === "sds" ? "Same-Day Surcharge" : "task"}: ${error.message}`);
    return;
  }

  if (reconciliationType === "sds") {
    task.same_day_surcharge_reconciled = true;
  } else {
    task.invoiced = true;
  }
}

function getWeeklyReconciliationBillingLine(task, taskBillingAmount) {
  if (!isAdminUser()) return "";
  if (!task || task.service_type !== "Weekly Standard") return "";
  if (Number(taskBillingAmount || 0) <= 0) return "";
  return isTaskReconciled(task) || isTaskLinkedToFinalizedInvoice(task)
    ? `<div class="task-line"><small>Billing: Reconciled</small></div>`
    : `<div class="task-line"><small>Billing: Awaiting Reconciliation</small></div>`;
}

function getCarryForwardInfo(task) {
  const originalDate = normalizeDateKey(task?.original_service_date);
  const currentDate = normalizeDateKey(task?.service_date || task?.scheduled_date);
  const overdueReferenceDate = normalizeDateKey(task?.overdue_reference_date || originalDate);
  const carryForwardCount = Number(task?.carry_forward_count || 0);
  if (!originalDate || !currentDate || !overdueReferenceDate || carryForwardCount < 1) return null;

  const referenceParts = overdueReferenceDate.split("-").map(Number);
  const currentParts = currentDate.split("-").map(Number);
  const overdueDays = Math.round((
    Date.UTC(currentParts[0], currentParts[1] - 1, currentParts[2])
    - Date.UTC(referenceParts[0], referenceParts[1] - 1, referenceParts[2])
  ) / 86400000);
  if (overdueDays < 1) return null;

  return {
    originalDate,
    currentDate,
    overdueReferenceDate,
    overdueDays,
    urgent: overdueDays >= 3,
  };
}

function formatOperationalDateLabel(dateValue) {
  const normalizedDate = normalizeDateKey(dateValue);
  if (!normalizedDate) return "Not set";
  const [year, month, day] = normalizedDate.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

function getCarryForwardBadgeMarkup(task, { compact = false } = {}) {
  const info = getCarryForwardInfo(task);
  if (!info) return "";
  const urgencyClass = info.urgent ? "carry-forward-urgent" : "";
  const overdueLabel = `${info.overdueDays} DAY${info.overdueDays === 1 ? "" : "S"} OVERDUE`;
  if (compact) {
    return `<span class="carry-forward-compact ${urgencyClass}" title="Originally scheduled ${escapeHtml(formatOperationalDateLabel(info.originalDate))}">⚠ ${overdueLabel}</span>`;
  }
  return `
    <div class="carry-forward-badges ${urgencyClass}">
      <span class="task-alert-badge carry-forward-badge">⚠ CARRIED FORWARD</span>
      <span class="task-alert-badge carry-forward-overdue">${overdueLabel}</span>
    </div>`;
}

function getCarryForwardHistoryMarkup(task) {
  const info = getCarryForwardInfo(task);
  if (!info) return "";
  return `
    <div class="carry-forward-history ${info.urgent ? "carry-forward-urgent" : ""}">
      <div><strong>Originally Scheduled:</strong> ${escapeHtml(formatOperationalDateLabel(info.originalDate))}</div>
      <div><strong>Current Service Date:</strong> ${escapeHtml(formatOperationalDateLabel(info.currentDate))}</div>
      <div><strong>${info.overdueDays} Day${info.overdueDays === 1 ? "" : "s"} Overdue</strong></div>
    </div>`;
}

function renderTaskCard(task) {
  const status = task.status || "Scheduled";
  const cardClass = (task.status === "Completed"
    ? "task-card completed"
    : task.status === "In Progress"
      ? "task-card in-progress"
      : "task-card") + ` ${getServiceBranchClass(task)}`;
  const badgeClass = task.status === "Completed"
    ? "badge-green"
    : isTaskGuestReady(task)
      ? "badge-yellow"
      : "badge-blue";
  const alertBadge = getAlertBadgeForTask(task);
  const showReconcile = shouldShowReconcileForTask(task);
  const invoiceMarkerClass = task.invoiced ? "invoice-marker-checked" : "invoice-marker-unchecked";
  const taskBillingAmount = getTaskBillingAmount(task);
  const weeklyReconcileLine = getWeeklyReconciliationBillingLine(task, taskBillingAmount);
  const sdsBillingLine = getSdsBillingLine(task);
  const sdsReconcileControl = renderSdsReconcileControl(task);
  const weeklyServiceLevelMarkup = renderTaskWeeklyServiceLevelSelector(task);
  const technicianMarkup = renderTaskTechnicianSelector(task);
  const laborSnapshotLine = renderTaskLaborSnapshot(task);
  const partsCostLine = renderTaskPartsCost(task);
  const staffOperationalMarkup = getStaffOperationalTaskMarkup(task);
  const carryForwardInfo = getCarryForwardInfo(task);
  const carryForwardBadge = getCarryForwardBadgeMarkup(task);
  const carryForwardHistory = getCarryForwardHistoryMarkup(task);
  const housekeepingOperationalMarkup = getHousekeepingOperationalMarkup(task);

  return `
    <div class="${cardClass} ${carryForwardInfo?.urgent ? "carried-forward-urgent-card" : carryForwardInfo ? "carried-forward-card" : ""}">
      <div class="task-card-header">
        <div class="task-card-title">${getPropertyName(task.property_id)}</div>
        ${showReconcile ? `
        <label class="invoice-marker ${invoiceMarkerClass}">
          <input type="checkbox" ${task.invoiced ? "checked" : ""} onchange="toggleInvoiceMarker('${task.id}')" />
          <span>${isManagerUser() ? "Reconcile" : isLawnTask(task) ? "Reconcile" : "$"}</span>
        </label>
        ` : ""}
        ${sdsReconcileControl}
      </div>
      ${carryForwardBadge}
      ${alertBadge}
      <div class="task-card-details">
        <div><strong>Service Date:</strong> ${task.service_date || task.scheduled_date || "Not set"}</div>
        <div><strong>Task Type:</strong> ${getServiceTypeDisplayLabel(task.service_type)}</div>
        <div><strong>Service Branch:</strong> <span class="service-branch-pill ${getServiceBranchClass(task)}">${getServiceBranchLabel(task.service_branch)}</span></div>
        ${normalizeServiceBranch(task.service_branch) === SERVICE_BRANCH_POOL ? `<div><strong>Guest Ready:</strong> ${isTaskGuestReady(task) ? "Yes" : "No"}</div>` : ""}
        ${isAdminUser() && taskBillingAmount > 0 ? `<div><strong>Charge:</strong> $${taskBillingAmount}</div>` : ""}
        ${weeklyReconcileLine}
        ${sdsBillingLine}
        ${weeklyServiceLevelMarkup}
        ${technicianMarkup}
        ${laborSnapshotLine}
        ${partsCostLine}
        ${staffOperationalMarkup}
        ${housekeepingOperationalMarkup}
        ${task.check_in_date ? `<div><strong>Check-In:</strong> ${task.check_in_date}</div>` : ""}
        ${carryForwardHistory}
        <div><strong>Status:</strong> <span class="status-badge ${badgeClass}">${status}</span></div>
      </div>
      <div class="task-card-actions">
        ${getSafetyCultureTaskActionMarkup(task)}
        <button onclick="openEditCleaning('${task.id}')">${isStaffUser() ? "Details / Chemicals" : "Edit"}</button>
        ${status !== "Completed" && status !== "In Progress" ? `<button onclick="startCleaningTask('${task.id}')">Start</button>` : ""}
        ${status !== "Completed" ? `<button onclick="markCleaningComplete('${task.id}')">Complete</button>` : ""}
        ${isAdminUser() && isLawnTask(task) ? `<button class="delete-btn" onclick="deleteCleaningTask('${task.id}')">Delete</button>` : ""}
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
  const urgentHousekeepingTasks = cleaningTasks.filter((task) => getHousekeepingTurnoverContext(task)?.urgent);

  if (alerts.length === 0 && urgentHousekeepingTasks.length === 0) {
    guestProtectionAlertsContainer.innerHTML = "";
    return;
  }

  guestProtectionAlertsContainer.innerHTML = `
    ${alerts.length ? `
      <div class="guest-protection-summary summary-red">
        🚨 ${alerts.length} Same-Day Turnover Alert${alerts.length !== 1 ? "s" : ""} &mdash; check Week View for details.
      </div>` : ""}
    ${urgentHousekeepingTasks.length ? `
      <div class="guest-protection-summary summary-red">
        URGENT: ${urgentHousekeepingTasks.length} unfinished Housekeeping turnover${urgentHousekeepingTasks.length !== 1 ? "s" : ""} at or past guest check-in.
      </div>` : ""}
  `;
}

function getAlertBadgeForTask(task) {
  const turnover = getSameDayTurnoverForTask(task);
  if (turnover) {
    const pName = String(turnover.propertyName || getPropertyName(task.property_id) || "Unknown Property").replace(/'/g, "\\'");
    return `<span class="task-alert-badge badge-alert-red" style="cursor:pointer"
      onclick="openAlertDetail('${pName}','${turnover.turnoverDate}','${turnover.checkOutDate}','${turnover.checkInDate}')">🚨 Same-Day Turnover</span>`;
  }

  const housekeepingContext = getHousekeepingTurnoverContext(task);
  if (housekeepingContext?.urgent) {
    return `<span class="task-alert-badge badge-alert-red">URGENT: Guest Check-In Reached</span>`;
  }

  return "";
}

function renderOperationsRemindersWidget() {
  if (activeServiceWorkspace === SERVICE_BRANCH_LAWN) {
    operationsRemindersWidget.innerHTML = "";
    return;
  }

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
              ${isAdminUser() ? `<button class="complete-reminder-btn-small" onclick="completeReminder('${reminder.id}')">✓ Complete</button>` : ""}
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;

  operationsRemindersWidget.innerHTML = widgetHTML;
}

function renderTaskViews() {
  if (activeServiceWorkspace === SERVICE_BRANCH_POOL || activeServiceWorkspace === SERVICE_BRANCH_HOUSEKEEPING) {
    renderGuestProtectionAlerts();
  } else {
    guestProtectionAlertsContainer.innerHTML = "";
  }
  if (activeServiceWorkspace === SERVICE_BRANCH_POOL) {
    renderOperationsRemindersWidget();
  } else {
    operationsRemindersWidget.innerHTML = "";
  }

  const todayTasks = getTodayCleaningTasks();
  const carriedForwardTasks = todayTasks.filter((task) => getCarryForwardInfo(task));
  carryForwardSummary.innerHTML = carriedForwardTasks.length
    ? `<div class="carry-forward-summary">⚠ ${carriedForwardTasks.length} CARRIED-FORWARD TASK${carriedForwardTasks.length === 1 ? " REQUIRES" : "S REQUIRE"} ATTENTION</div>`
    : "";
  console.log("[TodayView] Rendering", todayTasks.length, "today tasks");
  todayTasksContainer.innerHTML = todayTasks.length
    ? todayTasks.map(renderTaskCard).join("")
    : `<div class="empty">No ${getServiceBranchLabel(activeServiceWorkspace)} tasks due today.</div>`;

  renderWeekView();
  renderMonthView();
}

function getMonthCalendarDateRange() {
  const firstDayOfMonth = new Date(Date.UTC(currentMonthViewYear, currentMonthViewMonth, 1));
  const startDate = new Date(firstDayOfMonth);
  startDate.setUTCDate(startDate.getUTCDate() - firstDayOfMonth.getUTCDay());
  const endDate = new Date(startDate);
  endDate.setUTCDate(endDate.getUTCDate() + 41);
  return {
    startDate: formatIsoDateUtc(startDate),
    endDate: formatIsoDateUtc(endDate),
  };
}

async function loadMonthTasks() {
  if (!monthTasksCalendarContainer) return;

  const { startDate, endDate } = getMonthCalendarDateRange();
  monthCleaningTasks = cleaningTasks.filter((task) => {
    if (!isTaskVisibleInOperationalSchedule(task, { matchActiveWorkspace: false })) return false;

    const taskDate = normalizeDateKey(task.service_date);
    return taskDate && taskDate >= startDate && taskDate <= endDate;
  });
  renderMonthView();
}

function handleMonthTaskDragStart(event, taskId) {
  const task = monthCleaningTasks.find((item) => item.id === taskId)
    || cleaningTasks.find((item) => item.id === taskId);
  if (!canRescheduleTask(task)) {
    event.preventDefault();
    draggedMonthTaskId = null;
    return;
  }

  draggedMonthTaskId = taskId;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", taskId);
  event.currentTarget.classList.add("month-task-dragging");
}

function handleMonthTaskDragEnd(event) {
  event.currentTarget.classList.remove("month-task-dragging");
  document.querySelectorAll(".month-day-drop-target").forEach((cell) => cell.classList.remove("month-day-drop-target"));
  draggedMonthTaskId = null;
}

function handleMonthDayDragOver(event) {
  if (!draggedMonthTaskId) return;
  if (getTaskRescheduleTargetBlockReason(event.currentTarget.dataset.monthDate)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  event.currentTarget.classList.add("month-day-drop-target");
}

function handleMonthDayDragLeave(event) {
  if (event.currentTarget.contains(event.relatedTarget)) return;
  event.currentTarget.classList.remove("month-day-drop-target");
}

function handleMonthDayDrop(event, newDate) {
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.classList.remove("month-day-drop-target");

  const taskId = event.dataTransfer.getData("text/plain") || draggedMonthTaskId;
  draggedMonthTaskId = null;
  const task = monthCleaningTasks.find((item) => item.id === taskId)
    || cleaningTasks.find((item) => item.id === taskId);
  const blockReason = getTaskRescheduleBlockReason(task);
  if (blockReason) {
    alert(blockReason);
    return;
  }

  const oldDate = normalizeDateKey(task.service_date || task.scheduled_date);
  const normalizedNewDate = normalizeDateKey(newDate);
  if (!oldDate || !normalizedNewDate || oldDate === normalizedNewDate) return;
  const targetBlockReason = getTaskRescheduleTargetBlockReason(normalizedNewDate);
  if (targetBlockReason) {
    alert(targetBlockReason);
    return;
  }

  pendingMonthTaskMove = { taskId, oldDate, newDate: normalizedNewDate };
  const propertyName = getPropertyName(task.property_id);
  const taskType = getServiceTypeDisplayLabel(task.service_type);
  if (monthMoveTaskMessage) {
    monthMoveTaskMessage.textContent = `Move ${propertyName} - ${taskType} from ${oldDate} to ${normalizedNewDate}?`;
  }
  monthMoveTaskModal?.classList.remove("hidden");
}

function closeMonthMoveTaskModal() {
  pendingMonthTaskMove = null;
  monthMoveTaskModal?.classList.add("hidden");
}

async function confirmMonthTaskMove() {
  if (!pendingMonthTaskMove) return;
  const { taskId, newDate } = pendingMonthTaskMove;
  const task = monthCleaningTasks.find((item) => item.id === taskId)
    || cleaningTasks.find((item) => item.id === taskId);
  const blockReason = getTaskRescheduleBlockReason(task);
  if (blockReason) {
    closeMonthMoveTaskModal();
    alert(blockReason);
    return;
  }

  if (monthMoveTaskConfirmBtn) monthMoveTaskConfirmBtn.disabled = true;
  let error = null;
  if (isAdminUser() || isManagerUser()) {
    const result = await supabaseClient.rpc("manager_reschedule_task", {
      target_task_id: taskId,
      selected_service_date: newDate,
    });
    error = result.error;
  } else {
    error = new Error("Your role cannot reschedule tasks.");
  }

  if (monthMoveTaskConfirmBtn) monthMoveTaskConfirmBtn.disabled = false;
  if (error) {
    closeMonthMoveTaskModal();
    renderMonthView();
    const message = `Could not move task: ${error.message || error}`;
    if (statusMessage) statusMessage.textContent = message;
    alert(message);
    return;
  }

  closeMonthMoveTaskModal();
  if (isManagerUser()) {
    await loadManagerOperationalData();
  } else {
    await loadCleaningTasks();
  }
  showView("month");
  await loadMonthTasks();
}

function renderMonthView() {
  if (!monthTasksCalendarContainer) return;

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  if (monthCalendarTitle) {
    monthCalendarTitle.textContent = `${monthNames[currentMonthViewMonth]} ${currentMonthViewYear}`;
  }

  const todayString = getBusinessDateValue();

  const firstDayOfMonth = new Date(Date.UTC(currentMonthViewYear, currentMonthViewMonth, 1));
  const startDayOfWeek = firstDayOfMonth.getUTCDay();
  const gridStartDate = new Date(firstDayOfMonth);
  gridStartDate.setUTCDate(gridStartDate.getUTCDate() - startDayOfWeek);

  const calendarDays = [];
  const cursorDate = new Date(gridStartDate);
  for (let i = 0; i < 42; i++) {
    calendarDays.push(new Date(cursorDate));
    cursorDate.setUTCDate(cursorDate.getUTCDate() + 1);
  }

  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const headerHtml = dayNames.map(name => `<th>${name}</th>`).join("");

  const tasksByDateKey = new Map();
  monthCleaningTasks.forEach((task) => {
    const taskDate = normalizeDateKey(task.service_date);
    if (!taskDate) return;

    if (monthBranchFilter !== "all" && normalizeServiceBranch(task.service_branch) !== monthBranchFilter) return;

    if (!tasksByDateKey.has(taskDate)) {
      tasksByDateKey.set(taskDate, []);
    }
    tasksByDateKey.get(taskDate).push(task);
  });

  const canAddTask = isAdminUser() || isManagerUser();

  const cellsHtml = calendarDays.map((dateObj) => {
    const dateString = formatIsoDateUtc(dateObj);
    const dayNumber = dateObj.getUTCDate();
    const isCurrentMonth = dateObj.getUTCMonth() === currentMonthViewMonth;
    const isToday = dateString === todayString;
    const dayTasks = tasksByDateKey.get(dateString) || [];

    const cellClasses = [
      "month-day-cell",
      isCurrentMonth ? "in-month" : "other-month",
      isToday ? "today-cell" : ""
    ].filter(Boolean).join(" ");

    const taskCardsHtml = dayTasks.map((task) => {
      const propertyName = getPropertyName(task.property_id);
      const branchClass = `month-task-${normalizeServiceBranch(task.service_branch)}`;
      const techName = getTaskTechnicianDisplayName(task) || "Unassigned";
      const status = task.status || "Scheduled";
      const statusClass = status === "Completed" ? "status-completed" : status === "In Progress" ? "status-in-progress" : status === "Cancelled" ? "status-cancelled" : "status-scheduled";

      const sameDayBadge = isSameDayCheckInGuestReadyTask(task)
        ? `<span class="month-task-alert-pill" title="Same-Day Turnover Alert">🚨 Turnover</span>`
        : "";
      const carryForwardInfo = getCarryForwardInfo(task);
      const carryForwardBadge = getCarryForwardBadgeMarkup(task, { compact: true });
      const guestReadyBadge = isTaskGuestReady(task)
        ? `<span class="month-task-gr-pill" title="Guest Ready">GR</span>`
        : "";
      const rescheduleEnabled = canRescheduleTask(task);
      const dragAttributes = rescheduleEnabled
        ? `draggable="true" ondragstart="handleMonthTaskDragStart(event, '${task.id}')" ondragend="handleMonthTaskDragEnd(event)"`
        : "";
      const dragTitle = rescheduleEnabled ? "Drag to another calendar day to reschedule" : getTaskRescheduleBlockReason(task);

      return `
        <div class="month-task-card ${branchClass} ${carryForwardInfo?.urgent ? "carried-forward-urgent-card" : carryForwardInfo ? "carried-forward-card" : ""} ${rescheduleEnabled ? "month-task-draggable" : "month-task-locked"}" ${dragAttributes} title="${escapeHtml(dragTitle)}" onclick="event.stopPropagation(); openEditCleaning('${task.id}')">
          <div class="month-task-property-name">${escapeHtml(propertyName)}</div>
          ${carryForwardBadge}
          <div class="month-task-meta-line">
            <span>${escapeHtml(getServiceTypeDisplayLabel(task.service_type))}</span>
            ${sameDayBadge || guestReadyBadge}
          </div>
          <div class="month-task-meta-line">
            <span>Tech: ${escapeHtml(techName)}</span>
            <span class="month-task-status-pill ${statusClass}">${escapeHtml(status)}</span>
          </div>
        </div>
      `;
    }).join("");

    const addBtnHtml = canAddTask
      ? `<button type="button" class="month-day-add-btn" onclick="event.stopPropagation(); openAddCleaningTaskForDate('${dateString}')" title="Add task for ${dateString}">+ Add</button>`
      : "";

    const cellClickAttr = canAddTask ? `onclick="openAddCleaningTaskForDate('${dateString}')"` : "";

    return `
      <td class="${cellClasses}" data-month-date="${dateString}" ondragover="handleMonthDayDragOver(event)" ondragleave="handleMonthDayDragLeave(event)" ondrop="handleMonthDayDrop(event, '${dateString}')" ${cellClickAttr}>
        <div class="month-day-header-row">
          <span class="month-day-number">${dayNumber}</span>
          <div class="month-day-header-right">
            ${dayTasks.length > 0 ? `<span class="month-day-count-badge">${dayTasks.length} task${dayTasks.length === 1 ? "" : "s"}</span>` : ""}
            ${addBtnHtml}
          </div>
        </div>
        <div class="month-day-tasks-list">
          ${taskCardsHtml}
        </div>
      </td>
    `;
  });

  const rowsHtml = [];
  for (let i = 0; i < cellsHtml.length; i += 7) {
    rowsHtml.push(`<tr>${cellsHtml.slice(i, i + 7).join("")}</tr>`);
  }

  monthTasksCalendarContainer.innerHTML = `
    <table class="month-calendar-table">
      <thead>
        <tr>${headerHtml}</tr>
      </thead>
      <tbody>
        ${rowsHtml.join("")}
      </tbody>
    </table>
  `;
}

function renderWeekView() {
  const weekTasks = getUpcomingCleaningTasks();
  
  if (!weekTasks.length) {
    const taskLabel = `${getServiceBranchLabel(activeServiceWorkspace)} tasks`;
    weekTasksContainer.innerHTML = `<div class="empty">No ${taskLabel} scheduled in the next 7 days.</div>`;
    weekTasksCalendarContainer.innerHTML = `<div class="empty">No ${taskLabel} scheduled in the next 7 days.</div>`;
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
  const taskClass = (
    isCompleted
      ? "task-item completed"
      : task.guest_ready
        ? "task-item guestready"
        : task.off_cycle
          ? "task-item offcycle"
          : "task-item") + ` ${getServiceBranchClass(task)}`;

  const badge =
    isCompleted
      ? `<span class="status-badge badge-green">COMPLETED</span>`
      : task.guest_ready
        ? `<span class="status-badge badge-yellow">GUEST READY</span>`
        : task.off_cycle
          ? `<span class="status-badge badge-purple">${task.service_type === "Weekly Standard" ? "WEEKLY STANDARD" : "OFF CYCLE"}</span>`
          : `<span class="status-badge badge-blue">SCHEDULED</span>`;

  const billingLine = !isAdminUser() ? "" : guestReadyBilling
    ? guestReadyBilling.isManualOverride
      ? `<div class="task-line"><small>Billing: Manual Override (entered charge; rule: ${guestReadyBilling.coverageRuleLabel}; included days: ${guestReadyBilling.includedDaysLabel})</small></div>`
      : guestReadyBilling.isIncluded
        ? `<div class="task-line"><small>Billing: Included (${guestReadyBilling.serviceDay}; rule: ${guestReadyBilling.coverageRuleLabel}; included days: ${guestReadyBilling.includedDaysLabel})</small></div>`
        : `<div class="task-line"><small>Billing: Chargeable (${guestReadyBilling.serviceDay || "Outside route window"}; rule: ${guestReadyBilling.coverageRuleLabel}; included days: ${guestReadyBilling.includedDaysLabel})</small></div>`
    : taskBillingAmount > 0
      ? `<div class="task-line"><small>Billing: ${billingContext.billingReasonLabel || "Manual Charge"}</small></div>`
      : "";
  const weeklyReconcileLine = getWeeklyReconciliationBillingLine(task, taskBillingAmount);
  const sdsBillingLine = getSdsBillingLine(task);
  const sdsReconcileControl = renderSdsReconcileControl(task);

  const sameDayBadge = isSameDayCheckInGuestReadyTask(task)
    ? `<span class="task-alert-badge badge-alert-red">🚨 Same-Day Check-In</span>`
    : "";
  const weeklyServiceLevelMarkup = renderTaskWeeklyServiceLevelSelector(task);
  const technicianMarkup = renderTaskTechnicianSelector(task);
  const laborSnapshotLine = renderTaskLaborSnapshot(task);
  const partsCostLine = renderTaskPartsCost(task);
  const staffOperationalMarkup = getStaffOperationalTaskMarkup(task);
  const carryForwardInfo = getCarryForwardInfo(task);
  const carryForwardBadge = getCarryForwardBadgeMarkup(task);
  const carryForwardHistory = getCarryForwardHistoryMarkup(task);

  return `
    <div class="${taskClass} ${carryForwardInfo?.urgent ? "carried-forward-urgent-card" : carryForwardInfo ? "carried-forward-card" : ""}">
      <div class="task-item-header">
        <div class="task-title">${getPropertyName(task.property_id)} — ${task.service_date || task.scheduled_date || "Not set"}</div>
        ${showReconcile ? `
        <label class="invoice-marker ${invoiceMarkerClass}">
          <input type="checkbox" ${task.invoiced ? "checked" : ""} onchange="toggleInvoiceMarker('${task.id}')" />
          <span>${isManagerUser() ? "Reconcile" : "$ Reconcile"}</span>
        </label>
        ` : ""}
        ${sdsReconcileControl}
      </div>
      ${badge}
      ${carryForwardBadge}
      ${sameDayBadge}
      <div class="task-line"><small>Task Type: ${getServiceTypeDisplayLabel(task.service_type)}</small></div>
      <div class="task-line"><small>Service Branch: <span class="service-branch-pill ${getServiceBranchClass(task)}">${getServiceBranchLabel(task.service_branch)}</span></small></div>
      ${normalizeServiceBranch(task.service_branch) === SERVICE_BRANCH_POOL ? `<div class="task-line"><small>Guest Ready: ${isTaskGuestReady(task) ? "Yes" : "No"}</small></div>` : ""}
      ${isAdminUser() && taskBillingAmount > 0 ? `<div class="task-line">$${taskBillingAmount}</div>` : ""}
      ${billingLine}
      ${weeklyReconcileLine}
      ${sdsBillingLine}
      ${weeklyServiceLevelMarkup}
      ${technicianMarkup}
      ${laborSnapshotLine}
      ${partsCostLine}
      ${staffOperationalMarkup}
      ${getHousekeepingOperationalMarkup(task, { compact: true })}
      ${task.check_in_date ? `<div class="task-line"><small>Prior to check-in: ${task.check_in_date}</small></div>` : ""}
      ${carryForwardHistory}
      <div class="task-line"><small>Status: ${status}</small></div>
      ${!isStaffUser() && task.notes ? `<div class="task-line"><small>Notes: ${stripManualBillingOverrideTag(task.notes)}</small></div>` : ""}
      ${task.completed_at ? `<div class="task-line"><small>Completed: ${new Date(task.completed_at).toLocaleString()}</small></div>` : ""}
      <div class="task-buttons">
        ${getSafetyCultureTaskActionMarkup(task)}
        <button onclick="openEditCleaning('${task.id}')">${isStaffUser() ? "Details / Chemicals" : "Edit"}</button>
        ${!isCompleted && !isInProgress ? `<button onclick="startCleaningTask('${task.id}')">Start</button>` : ""}
        ${!isCompleted ? `<button onclick="markCleaningComplete('${task.id}')">Complete</button>` : ""}
        ${isAdminUser() ? `<button class="delete-btn" onclick="deleteCleaningTask('${task.id}')">Delete</button>` : ""}
      </div>
    </div>
  `;
}

function renderWeekViewCalendar(weekTasks) {
  const today = parseDateString(getBusinessDateValue());
  const todayString = formatIsoDateUtc(today);

  // Create 7-day calendar
  const dayColumns = [];
  for (let i = 0; i < 7; i++) {
    const columnDate = new Date(today);
    columnDate.setUTCDate(columnDate.getUTCDate() + i);
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
        const dateString = formatIsoDateUtc(date);
        const dayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][date.getUTCDay()];
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
                    const statusBadge = task.status === "Completed"
                      ? `<span class="status-badge badge-green">COMPLETED</span>`
                      : `<span class="status-badge badge-blue">${task.status || 'Scheduled'}</span>`;
                    const alertBadge = getAlertBadgeForTask(task);
                    const carryForwardInfo = getCarryForwardInfo(task);
                    const carryForwardBadge = getCarryForwardBadgeMarkup(task);
                    const carryForwardHistory = getCarryForwardHistoryMarkup(task);
                    const showReconcile = shouldShowReconcileForTask(task);
                    const invoiceMarkerClass = task.invoiced ? "invoice-marker-checked" : "invoice-marker-unchecked";
                    const sdsReconcileControl = renderSdsReconcileControl(task);
                    const showBilling = showReconcile || Boolean(sdsReconcileControl);
                    const weeklyServiceLevelMarkup = renderTaskWeeklyServiceLevelSelector(task, { compact: true });
                    const technicianMarkup = renderTaskTechnicianSelector(task, { compact: true });
                    const laborSnapshotLine = renderTaskLaborSnapshot(task);
                    const partsCostLine = renderTaskPartsCost(task);
                    const staffOperationalMarkup = getStaffOperationalTaskMarkup(task);
                    
                    return `
                      <div class="calendar-task-card ${getServiceBranchClass(task)} ${carryForwardInfo?.urgent ? "carried-forward-urgent-card" : carryForwardInfo ? "carried-forward-card" : ""}">
                        <div class="calendar-task-header">
                          <div class="calendar-task-property">${propertyName}</div>
                        </div>
                        <div class="calendar-task-type">${getServiceTypeDisplayLabel(task.service_type)}</div>
                        ${guestReadyBadge}
                        ${carryForwardBadge}
                        ${alertBadge}
                        ${carryForwardHistory}
                        <div class="calendar-task-status">
                          <span>Status:</span>
                          ${statusBadge}
                        </div>
                        ${weeklyServiceLevelMarkup}
                        ${technicianMarkup}
                        ${laborSnapshotLine}
                        ${partsCostLine}
                        ${staffOperationalMarkup}
                        ${showBilling ? `
                        <div class="calendar-task-billing-section">
                          <div class="calendar-task-section-label">Billing:</div>
                          ${showReconcile ? `
                          <label class="invoice-marker ${invoiceMarkerClass}">
                            <input type="checkbox" ${task.invoiced ? "checked" : ""} onchange="toggleInvoiceMarker('${task.id}')" />
                            <span>Reconcile</span>
                          </label>
                          ` : ""}
                          ${sdsReconcileControl}
                        </div>
                        ` : ""}
                        <div class="calendar-task-action-section">
                          <button class="calendar-task-btn edit-btn" onclick="openEditCleaning('${task.id}')">${isStaffUser() ? "Details" : "Edit"}</button>
                          ${task.status !== "Completed" ? `<button class="calendar-task-btn complete-btn" onclick="markCleaningComplete('${task.id}')">Complete</button>` : '<div class="calendar-task-btn-placeholder"></div>'}
                          ${isAdminUser() ? `<button class="calendar-task-btn delete-btn" onclick="deleteCleaningTask('${task.id}')">Delete</button>` : ""}
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
  if (isManagerUser()) {
    renderManagerProperties();
    return;
  }

  const workspaceProperties = properties.filter((property) => propertySupportsServiceBranch(property));
  const statusFilteredProperties = workspaceProperties.filter((property) => {
    if (selectedPropertyStatusFilter === "all") return true;
    return isPropertyActive(property) === (selectedPropertyStatusFilter === "active");
  });
  document.getElementById("propertyCount").textContent = statusFilteredProperties.length;

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
  const newOptions = `<option value="">All Properties</option>${statusFilteredProperties.map((p) => `<option value="${p.id}">${p.property_name}</option>`).join("")}`;
  if (propertyOptions !== newOptions) {
    propertyFilterSelect.innerHTML = newOptions;
    propertyFilterSelect.value = selectedPropertyFilter;
  }

  let filteredProperties = statusFilteredProperties;
  if (selectedPropertyFilter) {
    filteredProperties = statusFilteredProperties.filter((p) => p.id === selectedPropertyFilter);
  }

  if (filteredProperties.length === 0) {
    propertyList.innerHTML = `<div class="empty">No properties yet.</div>`;
    return;
  }

  propertyList.innerHTML = filteredProperties.map((property) => {
    let tasks = cleaningTasks.filter((task) => task.property_id === property.id && taskMatchesActiveWorkspace(task));
    tasks = tasks.filter((task) => !shouldSuppressWeeklyStandardTaskDisplay(task));
    tasks = tasks.filter((task) => taskMatchesDateFilter(task, selectedMonthFilter));
    const serviceFrequency = getPropertyFrequencyForScheduling(property);
    const anchorCleaningDate = getBiweeklyAnchorDateForScheduling(property);
    const propertyIsActive = isPropertyActive(property);
    const propertyStatusLabel = getPropertyStatusLabel(property);

    const hasSameDayGuestReady = tasks.some((task) => isSameDayCheckInGuestReadyTask(task));
    const isCollapsed = collapsedPropertyCards.has(property.id);
    const toggleButtonText = isCollapsed ? "Expand" : "Collapse";
    const activeTab = activeServiceWorkspace === SERVICE_BRANCH_POOL ? getPropertyDetailTab(property.id) : "tasks";

    const taskContent = tasks.length === 0
      ? `<p>No ${getServiceBranchLabel(activeServiceWorkspace)} tasks scheduled.</p>`
      : tasks.map((task) => {
          const taskBillingAmount = getTaskBillingAmount(task);
          const billingContext = getTaskBillingContext(task);
          const guestReadyBilling = billingContext.guestReadyBilling || null;
          const showReconcile = shouldShowReconcileForTask(task);
          const invoiceMarkerClass = task.invoiced ? "invoice-marker-checked" : "invoice-marker-unchecked";
          const taskClass = (
            task.status === "Completed"
              ? "task-item completed"
              : task.guest_ready
                ? "task-item guestready"
                : task.off_cycle
                  ? "task-item offcycle"
                  : "task-item") + ` ${getServiceBranchClass(task)}`;

          const badge =
            task.status === "Completed"
              ? `<span class="status-badge badge-green">COMPLETED</span>`
              : task.guest_ready
                ? `<span class="status-badge badge-yellow">GUEST READY</span>`
                : task.off_cycle
                  ? `<span class="status-badge badge-purple">${task.service_type === "Weekly Standard" ? "WEEKLY STANDARD" : "OFF CYCLE"}</span>`
                  : `<span class="status-badge badge-blue">SCHEDULED</span>`;

          const billingLine = guestReadyBilling
            ? guestReadyBilling.isManualOverride
              ? `<div class="task-line"><small>Billing: Manual Override (entered charge; rule: ${guestReadyBilling.coverageRuleLabel}; included days: ${guestReadyBilling.includedDaysLabel})</small></div>`
              : guestReadyBilling.isIncluded
                ? `<div class="task-line"><small>Billing: Included (${guestReadyBilling.serviceDay}; rule: ${guestReadyBilling.coverageRuleLabel}; included days: ${guestReadyBilling.includedDaysLabel})</small></div>`
                : `<div class="task-line"><small>Billing: Chargeable (${guestReadyBilling.serviceDay || "Outside route window"}; rule: ${guestReadyBilling.coverageRuleLabel}; included days: ${guestReadyBilling.includedDaysLabel})</small></div>`
            : taskBillingAmount > 0
              ? `<div class="task-line"><small>Billing: ${billingContext.billingReasonLabel || "Manual Charge"}</small></div>`
              : "";
          const weeklyReconcileLine = getWeeklyReconciliationBillingLine(task, taskBillingAmount);
          const sdsBillingLine = getSdsBillingLine(task);
          const sdsReconcileControl = renderSdsReconcileControl(task);
          const weeklyServiceLevelMarkup = renderTaskWeeklyServiceLevelSelector(task);
          const technicianMarkup = renderTaskTechnicianSelector(task);
          const laborSnapshotLine = renderTaskLaborSnapshot(task);
          const partsCostLine = renderTaskPartsCost(task);
          const carryForwardInfo = getCarryForwardInfo(task);
          const carryForwardBadge = getCarryForwardBadgeMarkup(task);
          const carryForwardHistory = getCarryForwardHistoryMarkup(task);

          const sameDayBadge = isSameDayCheckInGuestReadyTask(task)
            ? `<span class="task-alert-badge badge-alert-red">🚨 Same-Day Check-In</span>`
            : "";

          return `
            <div class="${taskClass} ${carryForwardInfo?.urgent ? "carried-forward-urgent-card" : carryForwardInfo ? "carried-forward-card" : ""}">
              <div class="task-item-header">
                <div class="task-title">${task.service_date} — ${getServiceTypeDisplayLabel(task.service_type)}</div>
                ${showReconcile ? `
                <label class="invoice-marker ${invoiceMarkerClass}">
                  <input type="checkbox" ${task.invoiced ? "checked" : ""} onchange="toggleInvoiceMarker('${task.id}')" />
                  <span>$ Reconcile</span>
                </label>
                ` : ""}
                ${sdsReconcileControl}
              </div>
              ${badge}
              ${carryForwardBadge}
              ${sameDayBadge}
              ${taskBillingAmount > 0 ? `<div class="task-line">$${taskBillingAmount}</div>` : ""}
              ${billingLine}
              ${weeklyReconcileLine}
              ${sdsBillingLine}
              ${weeklyServiceLevelMarkup}
              ${technicianMarkup}
              ${laborSnapshotLine}
              ${partsCostLine}
              ${getHousekeepingOperationalMarkup(task, { compact: true })}
              ${carryForwardHistory}
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
      <div class="property-card ${propertyIsActive ? "property-card-active" : "property-card-inactive"}">
        <div class="property-card-header">
          <div>
            <h3>${property.property_name}</h3>
            ${hasSameDayGuestReady ? `<span class="task-alert-badge badge-alert-red">🚨 Same-Day Check-In</span>` : ""}
            <span class="property-status-badge ${propertyIsActive ? "status-active" : "status-inactive"}">Status: ${propertyStatusLabel}</span>
          </div>
          <button class="collapse-btn" onclick="togglePropertyCardCollapse('${property.id}')">${toggleButtonText}</button>
        </div>

        <div class="property-meta">
          <div><strong>Status:</strong> ${propertyStatusLabel}</div>
          <div><strong>Company Branch:</strong> ${normalizeCompanyBranch(property.company_branch)}</div>
          <div><strong>Client Name:</strong> ${property.client_name || ""}</div>
          <div><strong>Billing Company:</strong> ${property.billing_company_name || "Not entered"}</div>
          <div><strong>Billing Email:</strong> ${property.billing_email || "Not entered"}</div>
          <div><strong>Account / Reference:</strong> ${property.billing_account_reference || "Not entered"}</div>
          <div><strong>Address:</strong> ${property.address || "Not entered"}</div>
          <div><strong>Housekeeping:</strong> ${property.housekeeping_service_active === true ? "Active" : "Inactive"}</div>
          <div><strong>Housekeeping Default Charge:</strong> $${Number(property.housekeeping_default_charge || 0).toFixed(2)}</div>
          <div><strong>Housekeeping Labor Amount:</strong> $${Number(property.housekeeping_labor_amount || 0).toFixed(2)}</div>
          ${activeServiceWorkspace === SERVICE_BRANCH_LAWN ? `
            <div><strong>Lawn Day:</strong> ${property.lawn_service_day || "Wednesday"}</div>
            <div><strong>Lawn Frequency:</strong> ${getServiceFrequencyLabel(property.lawn_service_frequency)}</div>
            <div><strong>Lawn Default Charge:</strong> $${Number(property.lawn_default_charge || 0).toFixed(2)}</div>
            <div><strong>Lawn Labor Amount:</strong> $${Number(property.lawn_labor_amount || 0).toFixed(2)}</div>
          ` : activeServiceWorkspace === SERVICE_BRANCH_POOL ? `
            <div><strong>SafetyCulture Checklist:</strong> ${property.safetyculture_checklist_url ? "Saved" : "Not entered"}</div>
            <div><strong>Standard Service Day:</strong> ${property.standard_service_day || "Wednesday"}</div>
            <div><strong>Service Frequency:</strong> ${getServiceFrequencyLabel(serviceFrequency)}</div>
            ${serviceFrequency === SERVICE_FREQUENCY_BIWEEKLY
              ? `<div><strong>Next/Anchor Cleaning:</strong> ${anchorCleaningDate ? formatInvoicePrintDateValue(anchorCleaningDate) : "Not set"}</div>`
              : ""}
            <div><strong>Guest Ready Coverage Rule:</strong> ${getCoverageRuleLabel(getCoverageRuleForProperty(property))}</div>
            <div><strong>Billable Guest Ready Charge:</strong> $${Number(property.default_off_cycle_charge ?? 65).toFixed(2)}</div>
            <div><strong>Standard Weekly Service Labor:</strong> $${Number(property.weekly_service_labor || 0).toFixed(2)}</div>
            <div><strong>Contract Revenue:</strong> $${Number(property.contract_revenue_amount || 0).toFixed(2)} ${getContractRateBasisLabel(property.contract_rate_basis)}</div>
            <div><strong>Guest Ready Service Labor:</strong> $${Number(property.guest_ready_service_labor || 0).toFixed(2)}</div>
            <div><strong>Additional / Billable Cleaning Labor:</strong> $${Number(property.additional_cleaning_labor || 0).toFixed(2)}</div>
            <div><strong>Default Cleaning Rate:</strong> $${Number(property.default_cleaning_rate ?? 0).toFixed(2)}</div>
            <div><strong>Same-Day Surcharge:</strong> $${Number(property.same_day_surcharge ?? 0).toFixed(2)}</div>
          ` : ""}
          <div><strong>Taxable:</strong> ${property.billing_taxable === false ? "No" : "Yes"}</div>
          <div><strong>Tax Rate:</strong> ${Number(property.billing_tax_rate || 0).toFixed(2)}%</div>
          <div><strong>Payment Terms:</strong> ${property.payment_terms || DEFAULT_INVOICE_TERMS}</div>
          <div><strong>iCal:</strong> ${property.ical_url ? "Saved" : "Not entered"}</div>
        </div>

        <div class="card-actions">
          <button onclick="openCleaningModal('${property.id}')">+ ${getServiceBranchLabel(activeServiceWorkspace)} Task</button>
          ${activeServiceWorkspace !== SERVICE_BRANCH_HOUSEKEEPING ? `<button onclick="openPipelineJobModal('${property.id}')">+ Add to Pipeline</button>` : ""}
          <button onclick="openEditModal('${property.id}')">Edit</button>
          <button class="delete-btn" onclick="deleteProperty('${property.id}')">Delete</button>
        </div>

        <div class="reminders-section ${activeServiceWorkspace === SERVICE_BRANCH_LAWN ? "hidden" : ""}">
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
            <button type="button" class="property-detail-tab ${activeTab === "tasks" ? "active" : ""}" onclick="setPropertyDetailTab('${property.id}','tasks')">Scheduled ${getServiceBranchLabel(activeServiceWorkspace)}</button>
            ${activeServiceWorkspace === SERVICE_BRANCH_POOL ? `<button type="button" class="property-detail-tab ${activeTab === "history" ? "active" : ""}" onclick="setPropertyDetailTab('${property.id}','history')">Chemical History</button>` : ""}
          </div>
          ${activeTab === "tasks" ? taskContent : renderPropertyChemicalHistory(property)}
        </div>
      </div>
    `;
  }).join("");
}

function getPipelineProjection(job) {
  const revenue = Math.max(0, Number(job?.potential_revenue || 0));
  const parts = Math.max(0, Number(job?.parts_material_cost || 0));
  const labor = job?.paid_labor === true ? Math.max(0, Number(job?.estimated_labor_cost || 0)) : 0;
  const cost = parts + labor;
  const profit = revenue - cost;
  return { revenue, cost, profit, margin: revenue > 0 ? (profit / revenue) * 100 : 0 };
}

function formatPipelineCurrency(value) {
  return Number(value || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

async function loadPipelineJobs() {
  if (!isAdminUser()) {
    pipelineJobs = [];
    return;
  }
  const { data, error } = await supabaseClient
    .from("pipeline_jobs")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Could not load Pipeline: ${error.message}`);
  pipelineJobs = data || [];
}

async function loadPipelineApprovals() {
  if (!isAdminUser()) {
    pipelineApprovals = [];
    return;
  }
  const { data, error } = await supabaseClient
    .from("pipeline_approvals")
    .select("*")
    .order("approval_created_at", { ascending: false });
  if (error) throw new Error(`Could not load customer approvals: ${error.message}`);
  pipelineApprovals = data || [];
}

function getPipelineApprovalsForJob(jobId) {
  return pipelineApprovals.filter((approval) => approval.pipeline_job_id === jobId);
}

function getCurrentPipelineApproval(jobId) {
  return getPipelineApprovalsForJob(jobId).find((approval) => !approval.revoked_at) || null;
}

function getPipelineApprovalStatus(approval) {
  if (!approval) return "No Link";
  if (approval.revoked_at) return "Revoked";
  if (new Date(approval.approval_expires_at).getTime() <= Date.now()) return "Expired";
  if (approval.customer_response) return approval.customer_response;
  return approval.approval_viewed_at ? "Viewed" : "Not Viewed";
}

function formatPipelineTimestamp(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("en-US", {
    month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function getApprovalTokenStorageKey(jobId) {
  return `guestReadyPipelineApprovalToken:${jobId}`;
}

function createPipelineJobSlug(jobTitle) {
  return String(jobTitle || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function buildPublicApprovalUrl(rawToken, jobTitle = "") {
  const url = new URL("proposal.html", window.location.href);
  url.search = "";
  url.hash = "";
  const jobSlug = createPipelineJobSlug(jobTitle);
  if (jobSlug) url.searchParams.set("job", jobSlug);
  url.searchParams.set("token", rawToken);
  return url.toString();
}

async function copyTextToClipboard(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textArea = document.createElement("textarea");
  textArea.value = value;
  textArea.style.position = "fixed";
  textArea.style.opacity = "0";
  document.body.appendChild(textArea);
  textArea.select();
  document.execCommand("copy");
  textArea.remove();
}

async function generatePipelineApprovalLink(jobId) {
  if (!requireAdminAccess()) return;
  const { data: rawToken, error } = await supabaseClient.rpc("admin_generate_pipeline_approval_link", {
    target_pipeline_job_id: jobId,
  });
  if (error) {
    alert("Could not generate approval link: " + error.message);
    return;
  }
  localStorage.setItem(getApprovalTokenStorageKey(jobId), rawToken);
  await Promise.all([loadPipelineJobs(), loadPipelineApprovals()]);
  renderPipeline();
  await copyPipelineApprovalLink(jobId);
}

async function getPipelineApprovalToken(jobId, approval) {
  if (!approval?.id) throw new Error("Active approval link not found.");

  const { data: rawToken, error } = await supabaseClient.rpc("admin_get_pipeline_approval_token", {
    target_approval_id: approval.id,
  });
  if (!error && rawToken) {
    localStorage.setItem(getApprovalTokenStorageKey(jobId), rawToken);
    return rawToken;
  }

  const legacyToken = localStorage.getItem(getApprovalTokenStorageKey(jobId));
  if (legacyToken && error?.message?.includes("legacy approval token")) return legacyToken;
  throw new Error(error?.message || "Approval token is unavailable.");
}

async function copyPipelineApprovalLink(jobId) {
  if (!requireAdminAccess()) return;
  const job = pipelineJobs.find((item) => item.id === jobId);
  const approval = getCurrentPipelineApproval(jobId);
  let rawToken;
  try {
    rawToken = await getPipelineApprovalToken(jobId, approval);
  } catch (error) {
    alert("Could not retrieve approval link: " + error.message);
    return;
  }
  const approvalUrl = buildPublicApprovalUrl(rawToken, approval?.job_title_snapshot || job?.job_title);
  try {
    await copyTextToClipboard(approvalUrl);
    alert("Approval link copied.");
  } catch (error) {
    alert("Could not copy automatically. Approval URL: " + approvalUrl);
  }
}

async function viewPipelineApproval(jobId) {
  if (!requireAdminAccess()) return;
  const approvalWindow = window.open("", "_blank");
  if (!approvalWindow) {
    alert("Allow pop-ups to view the approval in a new tab.");
    return;
  }
  approvalWindow.opener = null;
  const job = pipelineJobs.find((item) => item.id === jobId);
  const approval = getCurrentPipelineApproval(jobId);
  let rawToken;
  try {
    rawToken = await getPipelineApprovalToken(jobId, approval);
  } catch (error) {
    approvalWindow.close();
    alert("Could not retrieve approval link: " + error.message);
    return;
  }
  approvalWindow.location.replace(buildPublicApprovalUrl(rawToken, approval?.job_title_snapshot || job?.job_title));
}

async function revokePipelineApproval(jobId, approvalId) {
  if (!requireAdminAccess() || !confirm("Revoke this approval link? The existing customer URL will stop working.")) return;
  const { error } = await supabaseClient.rpc("admin_revoke_pipeline_approval", {
    target_approval_id: approvalId,
  });
  if (error) {
    alert("Could not revoke approval link: " + error.message);
    return;
  }
  localStorage.removeItem(getApprovalTokenStorageKey(jobId));
  await Promise.all([loadPipelineJobs(), loadPipelineApprovals()]);
  renderPipeline();
}

function renderPipelineApproval(job) {
  const approvals = getPipelineApprovalsForJob(job.id);
  const currentApproval = getCurrentPipelineApproval(job.id);
  const currentStatus = getPipelineApprovalStatus(currentApproval);
  const currentDisplayStatus = currentApproval?.customer_response
    || (currentApproval && currentStatus !== "Expired" ? "Waiting Approval" : currentStatus);
  const canGenerate = !job.scheduled_task_id && (!currentApproval || ["Expired", "Revoked"].includes(currentStatus));
  const generateLinkLabel = approvals.length ? "Generate New Approval Link" : "Generate Approval Link";
  const history = approvals.length
    ? approvals.map((approval) => `<div class="pipeline-approval-history-item">
        <strong>${escapeHtml(getPipelineApprovalStatus(approval))}</strong>
      <span>Snapshot: ${escapeHtml(approval.property_name_snapshot)} - ${escapeHtml(approval.job_title_snapshot)}</span>
      <span>Proposed Price: ${escapeHtml(formatPipelineCurrency(approval.proposed_price_snapshot))}</span>
      ${approval.description_snapshot ? `<span>Description: ${escapeHtml(approval.description_snapshot)}</span>` : ""}
      ${approval.tentative_date_snapshot ? `<span>Tentative Date: ${escapeHtml(approval.tentative_date_snapshot)}</span>` : ""}
        <span>Link Created: ${escapeHtml(formatPipelineTimestamp(approval.approval_created_at))}</span>
        ${approval.approval_viewed_at ? `<span>First Viewed: ${escapeHtml(formatPipelineTimestamp(approval.approval_viewed_at))}</span>` : ""}
        ${approval.customer_response_at ? `<span>${escapeHtml(approval.customer_response)}: ${escapeHtml(formatPipelineTimestamp(approval.customer_response_at))}</span>` : ""}
        ${approval.customer_name ? `<span>Customer: ${escapeHtml(approval.customer_name)}</span>` : ""}
        ${approval.customer_comment ? `<blockquote>${escapeHtml(approval.customer_comment)}</blockquote>` : ""}
        ${approval.revoked_at ? `<span>Revoked: ${escapeHtml(formatPipelineTimestamp(approval.revoked_at))}${approval.revoked_reason ? ` - ${escapeHtml(approval.revoked_reason)}` : ""}</span>` : ""}
      </div>`).join("")
    : '<span>No approval link generated.</span>';

  return `<details class="pipeline-approval-details">
    <summary>Customer Approval: ${escapeHtml(currentDisplayStatus)}</summary>
    <div class="pipeline-approval-controls">
      ${canGenerate ? `<button type="button" onclick="generatePipelineApprovalLink('${job.id}')">${generateLinkLabel}</button>` : ""}
      ${currentApproval && !["Expired", "Revoked"].includes(currentStatus) ? `<button type="button" class="secondary-btn" onclick="copyPipelineApprovalLink('${job.id}')">Copy Approval Link</button>` : ""}
      ${currentApproval && !["Expired", "Revoked"].includes(currentStatus) ? `<button type="button" class="secondary-btn" onclick="viewPipelineApproval('${job.id}')">View Approval</button>` : ""}
      ${currentApproval && !["Expired", "Revoked"].includes(currentStatus) ? `<button type="button" class="delete-btn" onclick="revokePipelineApproval('${job.id}','${currentApproval.id}')">Revoke Approval Link</button>` : ""}
    </div>
    <div class="pipeline-approval-history"><h4>Approval History</h4>${history}</div>
  </details>`;
}

function getPipelinePropertyOptions(selectedId = "") {
  return properties
    .filter((property) => isPropertyActive(property))
    .sort((left, right) => String(left.property_name || "").localeCompare(String(right.property_name || "")))
    .map((property) => `<option value="${property.id}" ${property.id === selectedId ? "selected" : ""}>${escapeHtml(property.property_name || "Property")}</option>`)
    .join("");
}

function syncPipelineLaborFields() {
  const paid = pipelinePaidLaborInput?.value === "yes";
  pipelineLaborCostRow?.classList.toggle("hidden", !paid);
  if (!paid && pipelineLaborInput) pipelineLaborInput.value = "0";
  renderPipelineProjectionPreview();
}

function renderPipelineProjectionPreview() {
  if (!pipelineProjectionPreview) return;
  const projection = getPipelineProjection({
    potential_revenue: pipelineRevenueInput?.value,
    parts_material_cost: pipelinePartsInput?.value,
    paid_labor: pipelinePaidLaborInput?.value === "yes",
    estimated_labor_cost: pipelineLaborInput?.value,
  });
  pipelineProjectionPreview.innerHTML = `<strong>Potential Cost:</strong> ${formatPipelineCurrency(projection.cost)} <span>Potential Profit: ${formatPipelineCurrency(projection.profit)}</span> <span>Potential Margin: ${projection.margin.toFixed(2)}%</span>`;
}

function openPipelineJobModal(propertyId = null, pipelineJobId = null) {
  if (!requireAdminAccess() || !pipelineJobModal) return;
  const job = pipelineJobId ? pipelineJobs.find((item) => item.id === pipelineJobId) : null;
  if (job?.scheduled_task_id) return;
  editingPipelineJobId = job?.id || null;
  if (pipelineJobModalTitle) pipelineJobModalTitle.textContent = job ? "Edit Pipeline Job" : "Add Pipeline Job";
  pipelinePropertyInput.innerHTML = getPipelinePropertyOptions(job?.property_id || propertyId || "");
  pipelineJobTitleInput.value = job?.job_title || "";
  pipelineDescriptionInput.value = job?.description || "";
  pipelineBranchInput.value = normalizeServiceBranch(job?.service_branch || activeServiceWorkspace);
  pipelineRevenueInput.value = Number(job?.potential_revenue || 0);
  pipelinePartsInput.value = Number(job?.parts_material_cost || 0);
  pipelinePaidLaborInput.value = job?.paid_labor === true ? "yes" : "no";
  pipelineLaborInput.value = Number(job?.estimated_labor_cost || 0);
  pipelineTentativeDateInput.value = job?.tentative_date || "";
  pipelineStatusInput.value = job?.status === "Scheduled" ? "Approved" : (job?.status || "Lead");
  pipelineNotesInput.value = job?.notes || "";
  syncPipelineLaborFields();
  pipelineJobModal.classList.remove("hidden");
}

function closePipelineJobModal() {
  pipelineJobModal?.classList.add("hidden");
  editingPipelineJobId = null;
}

async function savePipelineJob() {
  if (!requireAdminAccess()) return;
  const jobTitle = String(pipelineJobTitleInput?.value || "").trim();
  const potentialRevenue = Number(pipelineRevenueInput?.value || 0);
  const partsMaterialCost = Number(pipelinePartsInput?.value || 0);
  const paidLabor = pipelinePaidLaborInput?.value === "yes";
  const estimatedLaborCost = paidLabor ? Number(pipelineLaborInput?.value || 0) : 0;
  if (!pipelinePropertyInput?.value || !jobTitle) {
    alert("Property and Job Title are required.");
    return;
  }
  if (![potentialRevenue, partsMaterialCost, estimatedLaborCost].every((value) => Number.isFinite(value) && value >= 0)) {
    alert("Pipeline amounts must be valid non-negative numbers.");
    return;
  }
  const payload = {
    property_id: pipelinePropertyInput.value,
    job_title: jobTitle,
    description: String(pipelineDescriptionInput?.value || "").trim() || null,
    service_branch: normalizeServiceBranch(pipelineBranchInput?.value),
    potential_revenue: potentialRevenue,
    parts_material_cost: partsMaterialCost,
    paid_labor: paidLabor,
    estimated_labor_cost: estimatedLaborCost,
    tentative_date: pipelineTentativeDateInput?.value || null,
    status: pipelineStatusInput?.value || "Lead",
    notes: String(pipelineNotesInput?.value || "").trim() || null,
  };
  savePipelineJobBtn.disabled = true;
  const result = editingPipelineJobId
    ? await supabaseClient.from("pipeline_jobs").update(payload).eq("id", editingPipelineJobId).is("scheduled_task_id", null)
    : await supabaseClient.from("pipeline_jobs").insert(payload);
  savePipelineJobBtn.disabled = false;
  if (result.error) {
    alert("Could not save Pipeline job: " + result.error.message);
    return;
  }
  closePipelineJobModal();
  await Promise.all([loadPipelineJobs(), loadPipelineApprovals()]);
  renderPipeline();
}

function renderPipeline() {
  if (!isAdminUser() || !pipelineSummary || !pipelineJobsList) return;
  const openJobs = pipelineJobs.filter((job) => !["Scheduled", "Declined"].includes(job.status));
  const totals = openJobs.reduce((summary, job) => {
    const projection = getPipelineProjection(job);
    summary.revenue += projection.revenue;
    summary.cost += projection.cost;
    summary.profit += projection.profit;
    return summary;
  }, { revenue: 0, cost: 0, profit: 0 });
  const margin = totals.revenue > 0 ? (totals.profit / totals.revenue) * 100 : 0;
  pipelineSummary.innerHTML = [
    ["Potential Revenue", formatPipelineCurrency(totals.revenue)],
    ["Potential Costs", formatPipelineCurrency(totals.cost)],
    ["Potential Profit", formatPipelineCurrency(totals.profit)],
    ["Potential Margin", `${margin.toFixed(2)}%`],
    ["Open Pipeline Jobs", String(openJobs.length)],
  ].map(([label, value]) => `<div class="pipeline-summary-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");

  const selectedFilter = pipelineFilter?.value || "open";
  const filteredJobs = pipelineJobs.filter((job) => {
    if (selectedFilter === "open") return !["Scheduled", "Declined"].includes(job.status);
    if ([SERVICE_BRANCH_POOL, SERVICE_BRANCH_LAWN, SERVICE_BRANCH_MAINTENANCE].includes(selectedFilter)) return normalizeServiceBranch(job.service_branch) === selectedFilter;
    return job.status === selectedFilter;
  });
  if (!filteredJobs.length) {
    pipelineJobsList.innerHTML = '<div class="empty">No Pipeline jobs match this filter.</div>';
    return;
  }
  pipelineJobsList.innerHTML = `<div class="pipeline-table-wrap"><table class="pipeline-table"><thead><tr><th>Property</th><th>Job</th><th>Branch</th><th>Potential Revenue</th><th>Potential Cost</th><th>Potential Profit</th><th>Tentative Date</th><th>Status</th><th>Customer Approval</th><th>Actions</th></tr></thead><tbody>${filteredJobs.map((job) => {
    const property = properties.find((item) => item.id === job.property_id);
    const projection = getPipelineProjection(job);
    const isScheduled = Boolean(job.scheduled_task_id) || job.status === "Scheduled";
    const isDeclined = job.status === "Declined";
    return `<tr class="${getServiceBranchClass(job)}"><td data-label="Property">${escapeHtml(property?.property_name || "Unknown Property")}</td><td data-label="Job"><strong>${escapeHtml(job.job_title)}</strong>${job.description ? `<small>${escapeHtml(job.description)}</small>` : ""}</td><td data-label="Branch"><span class="service-branch-pill ${getServiceBranchClass(job)}">${getServiceBranchLabel(job.service_branch)}</span></td><td data-label="Potential Revenue">${formatPipelineCurrency(projection.revenue)}</td><td data-label="Potential Cost">${formatPipelineCurrency(projection.cost)}</td><td data-label="Potential Profit">${formatPipelineCurrency(projection.profit)}</td><td data-label="Tentative Date">${escapeHtml(job.tentative_date || "Not set")}</td><td data-label="Status"><span class="pipeline-status">${escapeHtml(job.status)}</span></td><td data-label="Customer Approval">${renderPipelineApproval(job)}</td><td data-label="Actions"><div class="pipeline-actions">${!isScheduled && !isDeclined ? `<button type="button" onclick="openPipelineScheduleModal('${job.id}')">Approve &amp; Schedule</button><button type="button" class="secondary-btn" onclick="openPipelineJobModal(null,'${job.id}')">Edit</button><button type="button" class="secondary-btn" onclick="declinePipelineJob('${job.id}')">Decline</button>` : ""}${isDeclined ? `<button type="button" onclick="reopenPipelineJob('${job.id}')">Reopen</button>` : ""}${!isScheduled ? `<button type="button" class="delete-btn" onclick="deletePipelineJob('${job.id}')">Delete</button>` : `<small>Task created</small>`}</div></td></tr>`;
  }).join("")}</tbody></table></div>`;
}

async function declinePipelineJob(jobId) {
  if (!requireAdminAccess()) return;
  const currentApproval = getCurrentPipelineApproval(jobId);
  if (currentApproval) {
    const revokeResult = await supabaseClient.rpc("admin_revoke_pipeline_approval", {
      target_approval_id: currentApproval.id,
    });
    if (revokeResult.error) return alert("Could not revoke the customer approval link: " + revokeResult.error.message);
    localStorage.removeItem(getApprovalTokenStorageKey(jobId));
  }
  const { error } = await supabaseClient.from("pipeline_jobs").update({ status: "Declined" }).eq("id", jobId).is("scheduled_task_id", null);
  if (error) return alert("Could not decline Pipeline job: " + error.message);
  await Promise.all([loadPipelineJobs(), loadPipelineApprovals()]);
  renderPipeline();
}

async function reopenPipelineJob(jobId) {
  if (!requireAdminAccess()) return;
  const currentApproval = getCurrentPipelineApproval(jobId);
  if (currentApproval) {
    const revokeResult = await supabaseClient.rpc("admin_revoke_pipeline_approval", {
      target_approval_id: currentApproval.id,
    });
    if (revokeResult.error) return alert("Could not revoke the prior customer approval: " + revokeResult.error.message);
    localStorage.removeItem(getApprovalTokenStorageKey(jobId));
  }
  const { error } = await supabaseClient.from("pipeline_jobs").update({ status: "Lead" }).eq("id", jobId).is("scheduled_task_id", null);
  if (error) return alert("Could not reopen Pipeline job: " + error.message);
  await Promise.all([loadPipelineJobs(), loadPipelineApprovals()]);
  renderPipeline();
}

async function deletePipelineJob(jobId) {
  if (!requireAdminAccess() || !confirm("Permanently delete this accidental or duplicate Pipeline job? Use Decline for a legitimate lost opportunity.")) return;
  const { error } = await supabaseClient.from("pipeline_jobs").delete().eq("id", jobId).is("scheduled_task_id", null);
  if (error) return alert("Could not delete Pipeline job: " + error.message);
  await loadPipelineJobs();
  renderPipeline();
}

function openPipelineScheduleModal(jobId) {
  if (!requireAdminAccess() || !pipelineScheduleModal) return;
  const job = pipelineJobs.find((item) => item.id === jobId);
  if (!job || job.scheduled_task_id || job.status === "Scheduled") return;
  schedulingPipelineJobId = job.id;
  pipelineScheduleProperty.innerHTML = getPipelinePropertyOptions(job.property_id);
  pipelineScheduleDate.value = job.tentative_date || "";
  pipelineScheduleBranch.value = normalizeServiceBranch(job.service_branch);
  pipelineScheduleType.value = pipelineScheduleBranch.value === SERVICE_BRANCH_LAWN ? "Lawn Service" : "Manual";
  pipelineScheduleTechnician.innerHTML = `<option value="">Unassigned</option>${technicians.filter((technician) => technician.active !== false).map((technician) => `<option value="${technician.id}">${escapeHtml(technician.name || "Technician")}</option>`).join("")}`;
  pipelineScheduleNotes.value = job.notes || "";
  const projection = getPipelineProjection(job);
  pipelineScheduleCharge.innerHTML = `<strong>Approved customer charge:</strong> ${formatPipelineCurrency(projection.revenue)} <span>Parts: ${formatPipelineCurrency(job.parts_material_cost)}</span> <span>Estimated paid labor: ${formatPipelineCurrency(job.paid_labor ? job.estimated_labor_cost : 0)}</span>`;
  pipelineScheduleModal.classList.remove("hidden");
}

function closePipelineScheduleModal() {
  pipelineScheduleModal?.classList.add("hidden");
  schedulingPipelineJobId = null;
  if (confirmPipelineScheduleBtn) confirmPipelineScheduleBtn.disabled = false;
}

async function approveAndSchedulePipelineJob() {
  if (!requireAdminAccess() || !schedulingPipelineJobId) return;
  if (!pipelineScheduleProperty?.value || !pipelineScheduleDate?.value) {
    alert("Property and Service Date are required.");
    return;
  }
  confirmPipelineScheduleBtn.disabled = true;
  const { error } = await supabaseClient.rpc("approve_and_schedule_pipeline_job", {
    target_pipeline_job_id: schedulingPipelineJobId,
    selected_property_id: pipelineScheduleProperty.value,
    selected_service_date: pipelineScheduleDate.value,
    selected_service_branch: pipelineScheduleBranch.value,
    selected_service_type: pipelineScheduleType.value,
    selected_technician_id: pipelineScheduleTechnician.value || null,
    entered_operational_notes: String(pipelineScheduleNotes.value || "").trim() || null,
  });
  if (error) {
    confirmPipelineScheduleBtn.disabled = false;
    alert("Could not schedule Pipeline job: " + error.message);
    await loadPipelineJobs();
    renderPipeline();
    return;
  }
  closePipelineScheduleModal();
  await Promise.all([loadPipelineJobs(), loadPipelineApprovals(), loadCleaningTasks()]);
  renderPipeline();
  renderTaskViews();
  renderProperties();
}

async function navigateToView(viewName) {
  if (!viewName) return;

  if (isStaffUser() && !["today", "week", "month"].includes(viewName)) {
    showView("today");
    return;
  }
  if (isManagerUser() && !["today", "week", "month", "properties"].includes(viewName)) {
    showView("today");
    return;
  }

  if (PROTECTED_VIEWS.has(viewName) && !isProtectedAccessUnlocked) {
    const unlocked = await promptForProtectedViewPin();
    if (!unlocked) return;
    isProtectedAccessUnlocked = true;
  }

  showView(viewName);
  if (viewName === "month") {
    await loadMonthTasks();
  }
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

  if (reportKey === "labor") {
    await navigateToView("laborReport");
    return;
  }

  if (reportKey === "servicePnl") {
    await navigateToView("servicePnl");
    return;
  }

  if (reportKey === "expenses") {
    await navigateToView("expenseReport");
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

function renderManagerProperties() {
  const propertiesHeader = document.querySelector("#propertiesView .view-header");
  if (propertiesHeader) {
    propertiesHeader.innerHTML = `<h2>Properties</h2><p>Review ${getServiceBranchLabel(activeServiceWorkspace)} operations for the current or next month.</p>`;
  }
  const workspaceProperties = properties.filter((property) => propertySupportsServiceBranch(property));
  const statusFilteredProperties = workspaceProperties.filter((property) => {
    if (selectedPropertyStatusFilter === "all") return true;
    return isPropertyActive(property) === (selectedPropertyStatusFilter === "active");
  });
  const propertyCount = document.getElementById("propertyCount");
  if (propertyCount) propertyCount.textContent = statusFilteredProperties.length;

  const newOptions = `<option value="">All Properties</option>${statusFilteredProperties
    .map((property) => `<option value="${property.id}">${escapeHtml(property.property_name)}</option>`)
    .join("")}`;
  if (propertyFilterSelect.innerHTML !== newOptions) {
    propertyFilterSelect.innerHTML = newOptions;
    propertyFilterSelect.value = selectedPropertyFilter;
  }

  const filteredProperties = selectedPropertyFilter
    ? statusFilteredProperties.filter((property) => property.id === selectedPropertyFilter)
    : statusFilteredProperties;
  if (!filteredProperties.length) {
    propertyList.innerHTML = '<div class="empty">No properties available.</div>';
    return;
  }

  propertyList.innerHTML = filteredProperties.map((property) => {
    const tasks = cleaningTasks
      .filter((task) => task.property_id === property.id && taskMatchesActiveWorkspace(task))
      .filter((task) => !shouldSuppressWeeklyStandardTaskDisplay(task))
      .filter((task) => taskMatchesDateFilter(task, selectedMonthFilter));
    const reminders = operationsReminders.filter((reminder) =>
      reminder.property_id === property.id && reminder.status === "Open"
    );
    const propertyIsActive = isPropertyActive(property);
    const checklistUrl = normalizeSafetyCultureUrl(property.safetyculture_checklist_url || "");

    const taskMarkup = tasks.length
      ? tasks.map((task) => {
        const carryForwardInfo = getCarryForwardInfo(task);
        return `
          <div class="task-item ${task.status === "Completed" ? "completed" : ""} ${getServiceBranchClass(task)} ${carryForwardInfo?.urgent ? "carried-forward-urgent-card" : carryForwardInfo ? "carried-forward-card" : ""}">
            <div class="task-item-header">
              <div class="task-title">${escapeHtml(task.service_date || task.scheduled_date || "Not set")} - ${escapeHtml(getServiceTypeDisplayLabel(task.service_type))}</div>
              ${shouldShowReconcileForTask(task) ? `
                <label class="invoice-marker invoice-marker-unchecked">
                  <input type="checkbox" onchange="toggleInvoiceMarker('${task.id}')" />
                  <span>Reconcile</span>
                </label>
              ` : ""}
              ${renderSdsReconcileControl(task)}
            </div>
            ${getCarryForwardBadgeMarkup(task)}
            ${getAlertBadgeForTask(task)}
            ${getHousekeepingOperationalMarkup(task, { compact: true })}
            ${getCarryForwardHistoryMarkup(task)}
            <div class="task-line"><small>Status: ${escapeHtml(task.status || "Scheduled")}</small></div>
            ${task.service_type === "Weekly Standard" ? `<div class="task-line"><small>Service Level: ${escapeHtml(getWeeklyServiceLevelLabel(getWeeklyServiceLevelForTask(task)))}</small></div>` : ""}
            <div class="task-line"><small>Technician: ${escapeHtml(getTaskTechnicianDisplayName(task) || "Unassigned")}</small></div>
            ${task.notes ? `<div class="task-line"><small>Notes: ${escapeHtml(stripManualBillingOverrideTag(task.notes))}</small></div>` : ""}
            <div class="task-buttons">
              ${getSafetyCultureTaskActionMarkup(task)}
              <button type="button" onclick="openEditCleaning('${task.id}')">Edit Operations</button>
              ${task.status !== "Completed" && task.status !== "In Progress" ? `<button type="button" onclick="startCleaningTask('${task.id}')">Start</button>` : ""}
              ${task.status !== "Completed" ? `<button type="button" onclick="markCleaningComplete('${task.id}')">Complete</button>` : ""}
            </div>
          </div>
        `;
      }).join("")
      : `<p>No ${getServiceBranchLabel(activeServiceWorkspace)} tasks in the selected month.</p>`;

    const reminderMarkup = reminders.length
      ? reminders.map((reminder) => `
          <div class="reminder-item">
            <div class="reminder-title">${escapeHtml(reminder.title || "Reminder")}</div>
            ${reminder.notes ? `<div class="reminder-notes">${escapeHtml(reminder.notes)}</div>` : ""}
            <div class="reminder-due">Due: ${escapeHtml(reminder.due_date || "Not set")}</div>
          </div>
        `).join("")
      : '<p class="no-reminders">No open reminders.</p>';

    return `
      <div class="property-card ${propertyIsActive ? "property-card-active" : "property-card-inactive"}">
        <div class="property-card-header">
          <h3>${escapeHtml(property.property_name || "Property")}</h3>
          <span class="property-status-badge ${propertyIsActive ? "status-active" : "status-inactive"}">Status: ${escapeHtml(getPropertyStatusLabel(property))}</span>
        </div>
        <div class="property-meta">
          <div><strong>Company Branch:</strong> ${escapeHtml(normalizeCompanyBranch(property.company_branch))}</div>
          <div><strong>Client Name:</strong> ${escapeHtml(property.client_name || "Not entered")}</div>
          <div><strong>Address:</strong> ${escapeHtml(property.address || "Not entered")}</div>
          <div><strong>Access / Gate:</strong> ${escapeHtml(property.gate_access_instructions || "Not entered")}</div>
          <div><strong>Service Notes:</strong> ${escapeHtml(property.service_notes || "Not entered")}</div>
          <div><strong>Equipment / Service:</strong> ${escapeHtml(property.equipment_service_info || "Not entered")}</div>
          <div><strong>Housekeeping:</strong> ${property.housekeeping_service_active === true ? "Active" : "Inactive"}</div>
          ${activeServiceWorkspace === SERVICE_BRANCH_POOL ? `
            <div><strong>SafetyCulture Checklist:</strong> ${checklistUrl ? `<a href="${escapeHtml(checklistUrl)}" target="_blank" rel="noopener noreferrer">Open Checklist</a>` : "Not entered"}</div>
            <div><strong>Standard Service Day:</strong> ${escapeHtml(property.standard_service_day || "Wednesday")}</div>
            <div><strong>Service Frequency:</strong> ${escapeHtml(getServiceFrequencyLabel(property.service_frequency))}</div>
            <div><strong>Guest Ready Coverage Rule:</strong> ${escapeHtml(getCoverageRuleLabel(getCoverageRuleForProperty(property)))}</div>
            <div><strong>iCal:</strong> ${property.ical_url ? "Configured" : "Not configured"}</div>
          ` : activeServiceWorkspace === SERVICE_BRANCH_LAWN ? `
            <div><strong>Lawn Day:</strong> ${escapeHtml(property.lawn_service_day || "Wednesday")}</div>
            <div><strong>Lawn Frequency:</strong> ${escapeHtml(getServiceFrequencyLabel(property.lawn_service_frequency))}</div>
          ` : ""}
        </div>
        <div class="card-actions">
          <button type="button" onclick="openManagerManualTaskModal('${property.id}')">+ Manual Task</button>
        </div>
        <div class="reminders-section">
          <div class="reminders-header"><h4>Operational Reminders</h4></div>
          ${reminderMarkup}
        </div>
        <div class="task-list">
          <h4>Scheduled ${getServiceBranchLabel(activeServiceWorkspace)}</h4>
          ${taskMarkup}
        </div>
      </div>
    `;
  }).join("");
}

async function handlePasswordRecoverySubmit(event) {
  event.preventDefault();

  const newPassword = String(newPasswordInput?.value || "");
  const confirmedPassword = String(confirmNewPasswordInput?.value || "");
  if (!newPassword || !confirmedPassword) {
    setPasswordRecoveryMessage("Enter and confirm your new password.", "error");
    return;
  }
  if (newPassword !== confirmedPassword) {
    setPasswordRecoveryMessage("Passwords do not match.", "error");
    return;
  }
  if (newPassword.length < 6) {
    setPasswordRecoveryMessage("Password must be at least 6 characters.", "error");
    return;
  }

  setPasswordRecoveryMessage("");
  setPasswordRecoveryLoading(true);
  const { error } = await supabaseClient.auth.updateUser({ password: newPassword });
  if (error) {
    setPasswordRecoveryLoading(false);
    const message = /session|expired|token/i.test(String(error.message || ""))
      ? "This password reset link is invalid or expired. Request a new reset email."
      : (error.message || "Could not update password.");
    setPasswordRecoveryMessage(message, "error");
    return;
  }

  setPasswordRecoveryMessage("Password updated successfully.", "success");
  const signOutResult = await supabaseClient.auth.signOut();
  setPasswordRecoveryLoading(false);
  if (signOutResult.error) {
    setPasswordRecoveryMessage("Password updated successfully. Sign out and sign in again with your new password.", "success");
    return;
  }

  showLoginScreen();
  setAuthMessage("Password updated successfully. Sign in with your new password.", "success");
}