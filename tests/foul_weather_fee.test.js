// Run with JavaScriptCore: jsc tests/foul_weather_fee.test.js
const source = readFile("app.js");
const start = source.indexOf("function getInvoiceCandidateTasks(");
const end = source.indexOf("function getVp2eInvoiceItemForPropertyWeek(", start);
if (start < 0 || end < 0) throw new Error("Invoice candidate functions not found");

const INVOICE_ITEM_SOURCES = { TASK: "task", FOUL_WEATHER: "foul_weather", HEAVY_DEBRIS: "heavy_debris" };
const SERVICE_BRANCH_POOL = "pool";
let billingRows = [];
let lastFilters;
function getBillingReportRowsForFilters(filters) {
  lastFilters = filters;
  return billingRows.filter((row) => row.billableAmount > 0);
}
function isTaskGuestReady(task) { return task.guest_ready === true || task.service_type === "Guest Ready"; }
function normalizeServiceBranch(branch) { return branch || "pool"; }
function isWeeklyContractObligationTask() { return false; }
function isHousekeepingTask(task) { return task.service_branch === "housekeeping"; }
function isLawnTask(task) { return task.service_branch === "lawn"; }
function getPropertyName() { return "Test property"; }
function getPropertyById() { return {}; }
function normalizeServiceFrequency(value) { return value || "weekly"; }
function stripManualBillingOverrideTag(value) { return value; }
const SERVICE_FREQUENCY_BIWEEKLY = "bi_weekly";

const functions = new Function(
  "getBillingReportRowsForFilters", "isTaskGuestReady", "normalizeServiceBranch",
  "isWeeklyContractObligationTask", "isHousekeepingTask", "isLawnTask",
  "getPropertyName", "getPropertyById", "normalizeServiceFrequency", "SERVICE_FREQUENCY_BIWEEKLY",
  "stripManualBillingOverrideTag", "INVOICE_ITEM_SOURCES", "SERVICE_BRANCH_POOL",
  `${source.slice(start, end)}\nreturn { getInvoiceCandidateTasks, isFoulWeatherChargeableTask, addFoulWeatherInvoiceItems, isHeavyDebrisChargeableTask, addHeavyDebrisInvoiceItems };`
)(
  getBillingReportRowsForFilters, isTaskGuestReady, normalizeServiceBranch,
  isWeeklyContractObligationTask, isHousekeepingTask, isLawnTask,
  getPropertyName, getPropertyById, normalizeServiceFrequency, SERVICE_FREQUENCY_BIWEEKLY,
  stripManualBillingOverrideTag, INVOICE_ITEM_SOURCES, SERVICE_BRANCH_POOL
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const guest = {
  id: "guest-1", property_id: "property-1", propertyName: "Beach House",
  service_type: "Guest Ready", service_branch: "pool", status: "Completed",
  serviceDate: "2026-11-25", billableAmount: 75, rate: 75, quantity: 1,
  foul_weather: true,
};
billingRows = [
  guest,
  { ...guest, id: "guest-2", propertyName: "Lake House", billableAmount: 50, rate: 50, foul_weather: false },
  { ...guest, id: "included", billableAmount: 0 },
  { ...guest, id: "weekly", service_type: "Weekly Standard" },
  { ...guest, id: "lawn", service_branch: "lawn" },
  { ...guest, id: "scheduled", status: "Scheduled" },
];

const taskItems = functions.getInvoiceCandidateTasks({ startDate: "2026-11-01", endDate: "2026-11-30" });
assert(lastFilters.includeInvoiced === false, "Already invoiced tasks must be excluded");
const invoiceItems = functions.addFoulWeatherInvoiceItems(taskItems);
assert(invoiceItems[0].taskId === "guest-1" && invoiceItems[0].amount === 75, "Guest Ready charge must remain unchanged");
assert(invoiceItems[1].itemSource === "foul_weather", "Fee must immediately follow Guest Ready charge");
assert(invoiceItems[1].taskId === "guest-1" && invoiceItems[1].propertyId === "property-1", "Fee must retain task and property");
assert(invoiceItems[1].description === "Beach House - Foul Weather Fee", "Fee must identify property and charge");
assert(invoiceItems[1].rate === 20 && invoiceItems[1].amount === 20, "Fee must be $20");
assert(invoiceItems.filter((item) => item.itemSource === "foul_weather").length === 1, "Only checked, completed, billable Guest Ready pool tasks get a fee");
assert(invoiceItems.reduce((sum, item) => sum + item.amount, 0) === taskItems.reduce((sum, item) => sum + item.amount, 0) + 20, "Fee must increase total by $20");
assert(functions.addFoulWeatherInvoiceItems(taskItems).length === invoiceItems.length, "Regeneration must not append duplicate fees");
assert(!functions.isFoulWeatherChargeableTask({ ...guest, billableAmount: 0 }), "Included visits must not be charged");
assert(!functions.isFoulWeatherChargeableTask({ ...guest, service_type: "Off-Cycle" }), "Off-cycle tasks must not be charged");

for (const amount of [20, 32.75, 50]) {
  const task = { ...guest, heavy_debris_amount: amount };
  assert(functions.isHeavyDebrisChargeableTask(task), `Valid heavy debris amount ${amount} must qualify`);
  billingRows = [task];
  const items = functions.addFoulWeatherInvoiceItems(functions.addHeavyDebrisInvoiceItems(functions.getInvoiceCandidateTasks({})));
  assert(items.length === 3 && items[0].amount === 75, "Combined fees must not change the Guest Ready charge");
  assert(items[1].itemSource === "foul_weather" && items[2].itemSource === "heavy_debris", "Both fees must follow their Guest Ready charge in order");
  assert(items[2].amount === amount && items[2].rate === amount && items[2].taskId === task.id && items[2].propertyId === task.property_id, "Heavy debris line must retain fee, task and property");
  assert(items[2].description === "Beach House - Heavy Debris Fee", "Heavy debris line must identify property and charge");
  assert(items.reduce((sum, item) => sum + item.amount, 0) === 95 + amount, "Both fees must be included in invoice total");
  assert(functions.addFoulWeatherInvoiceItems(functions.addHeavyDebrisInvoiceItems(functions.getInvoiceCandidateTasks({}))).length === 3, "Regenerating must not duplicate fees");
}
for (const task of [
  { ...guest, heavy_debris_amount: null },
  { ...guest, heavy_debris_amount: 19.99 },
  { ...guest, heavy_debris_amount: 50.01 },
  { ...guest, heavy_debris_amount: 20, billableAmount: 0 },
  { ...guest, heavy_debris_amount: 20, service_type: "Weekly Standard" },
  { ...guest, heavy_debris_amount: 20, service_branch: "lawn" },
  { ...guest, heavy_debris_amount: 20, status: "Scheduled" },
]) assert(!functions.isHeavyDebrisChargeableTask(task), "Unselected, invalid or ineligible tasks must not incur HDF");
billingRows = [{ ...guest, foul_weather: false, heavy_debris_amount: 20 }];
const heavyOnlyItems = functions.addFoulWeatherInvoiceItems(functions.addHeavyDebrisInvoiceItems(functions.getInvoiceCandidateTasks({})));
assert(heavyOnlyItems.length === 2 && heavyOnlyItems[1].itemSource === "heavy_debris", "HDF alone must immediately follow the base task");

const reportStart = source.indexOf("function getBillingReportRows() {");
const reportEnd = source.indexOf("function isBillingRowReconciled(", reportStart);
assert(reportStart >= 0 && reportEnd >= 0, "Billing report function not found");
const reportRows = new Function(
  "billingReportStartDate", "billingReportEndDate", "billingReportPropertySelect", "billingReportClientSelect",
  "billingReconciledOnly", "getBillingReportRowsForFilters", "getSdsBillingReportRowsForFilters",
  "getVp2eBillingRowsForFilters", "isFoulWeatherChargeableTask", "isHeavyDebrisChargeableTask", "isTaskReconciled",
  `${source.slice(reportStart, reportEnd)}\nreturn getBillingReportRows();`
)(
  { value: "2026-11-01" }, { value: "2026-11-30" }, null, null, { checked: false },
  () => [{ ...guest, heavy_debris_amount: 32.75 }], () => [], () => [],
  functions.isFoulWeatherChargeableTask, functions.isHeavyDebrisChargeableTask, () => true
);
assert(reportRows.length === 3 && reportRows.reduce((sum, item) => sum + item.billableAmount, 0) === 127.75, "Billing report must include both fees in property revenue");

const saveStart = source.indexOf("async function saveInvoiceDraft(");
const saveEnd = source.indexOf("async function finalizeInvoiceDraft(", saveStart);
assert(saveStart >= 0 && saveEnd >= 0, "Invoice save function not found");
let alerted = "";
const saveFinalizedInvoice = new Function(
  "requireAdminAccess", "currentInvoiceDraft", "alert",
  `${source.slice(saveStart, saveEnd)}\nreturn saveInvoiceDraft;`
)(() => true, { status: "finalized" }, (message) => { alerted = message; });
let savedItems;
const client = {
  from(table) {
    if (table === "invoices") {
      return { insert() { return { select() { return { single: async () => ({ data: { id: "invoice-1", invoice_number: "GR-1" }, error: null }) }; } }; } };
    }
    if (table === "invoice_items") {
      return { insert: async (items) => { savedItems = items; return { error: null }; } };
    }
    throw new Error(`Unexpected table ${table}`);
  },
};
const draft = { status: "draft", propertyId: "property-1", items: invoiceItems, subtotal: 0, tax: 0, total: 0 };
const saveDraft = new Function(
  "requireAdminAccess", "currentInvoiceDraft", "alert", "supabaseClient",
  "recalculateInvoiceDraftTotals", "buildInvoiceNumber", "DEFAULT_INVOICE_TERMS",
  "INVOICE_ITEM_SOURCES", "loadInvoices", "renderInvoiceHistory", "renderInvoicePreview",
  `${source.slice(saveStart, saveEnd)}\nreturn saveInvoiceDraft;`
)(
  () => true, draft, (message) => { throw new Error(message); }, client,
  () => {}, () => "GR-1", "Upon Receipt", INVOICE_ITEM_SOURCES,
  async () => {}, () => {}, () => {}
);
saveFinalizedInvoice().then(async (result) => {
  assert(result === false && alerted.includes("Only draft"), "Finalized invoices must not be saved as drafts");
  assert(await saveDraft({ silent: true }) === true, "Invoice draft must save");
  assert(savedItems[0].task_id === "guest-1" && savedItems[1].item_source === "foul_weather", "Persisted fee must follow its task");
  assert(savedItems[0].created_at < savedItems[1].created_at && savedItems[1].created_at < savedItems[2].created_at, "Persisted lines must retain display order");
  draft.id = null;
  draft.items = heavyOnlyItems;
  assert(await saveDraft({ silent: true }) === true, "HDF-only invoice draft must save");
  assert(savedItems[1].item_source === "heavy_debris" && savedItems[0].created_at < savedItems[1].created_at, "HDF-only persisted lines must retain display order");
  draft.id = null;
  billingRows = [{ ...guest, heavy_debris_amount: 32.75 }];
  draft.items = functions.addFoulWeatherInvoiceItems(functions.addHeavyDebrisInvoiceItems(functions.getInvoiceCandidateTasks({})));
  assert(await saveDraft({ silent: true }) === true, "Combined-fee invoice draft must save");
  assert(savedItems.map((item) => item.item_source).join(",") === "task,foul_weather,heavy_debris", "Persisted combined fees must follow the base in order");
  assert(savedItems[0].created_at < savedItems[1].created_at && savedItems[1].created_at < savedItems[2].created_at, "Combined persisted fees must keep their order");
  const publicInvoiceSql = readFile("supabase_setup_customer_invoice_links.sql");
  assert(publicInvoiceSql.includes("ORDER BY item.created_at, item.id"), "Public invoice must use persisted line order");
  print("PASS: fee eligibility, preview and persisted line order, public invoice order, totals, regeneration, and finalized invoice save guard");
}).catch((error) => { print(`FAIL: ${error.message}`); quit(1); });
