const INVOICE_SUPABASE_URL = "https://tmfyjzqghxntprexonrg.supabase.co";
const INVOICE_SUPABASE_KEY = "sb_publishable_wYrEHjC8nWZgnjhT36fcDw_lp8hWH6c";
const invoiceClient = window.supabase.createClient(INVOICE_SUPABASE_URL, INVOICE_SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "guest-ready-public-invoice" },
});

const invoiceParams = new URLSearchParams(window.location.search);
const invoiceToken = invoiceParams.get("t") || invoiceParams.get("token") || "";
const loadingPanel = document.getElementById("invoiceLoading");
const unavailablePanel = document.getElementById("invoiceUnavailable");
const invoiceContent = document.getElementById("invoiceContent");

function setInvoiceText(id, value) {
  document.getElementById(id).textContent = value == null ? "" : String(value);
}

function showInvoicePanel(panel) {
  [loadingPanel, unavailablePanel, invoiceContent].forEach((element) => element.classList.toggle("hidden", element !== panel));
}

function formatInvoiceMoney(value) {
  return Number(value || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatInvoiceDate(value) {
  if (!value) return "Not specified";
  const parts = String(value).slice(0, 10).split("-").map(Number);
  if (parts.length !== 3 || parts.some((part) => !part)) return "Not specified";
  return new Date(parts[0], parts[1] - 1, parts[2]).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function setOptionalText(id, value) {
  const element = document.getElementById(id);
  const text = String(value || "").trim();
  element.textContent = text;
  element.classList.toggle("hidden", !text);
}

function renderInvoice(invoice) {
  const branding = invoice.branding || {};
  const status = String(invoice.status || "finalized").toLowerCase();
  document.title = `Invoice ${invoice.invoiceNumber || ""} | ${branding.companyName || "Fair Ventures"}`;
  setInvoiceText("invoiceBrandName", branding.companyName || "Fair Ventures");
  setOptionalText("invoiceTagline", branding.tagline);
  const logo = document.getElementById("invoiceLogo");
  if (branding.logoUrl) {
    logo.src = branding.logoUrl;
    logo.alt = `${branding.companyName || "Company"} logo`;
    logo.classList.remove("hidden");
  }
  const statusBadge = document.getElementById("invoiceStatus");
  statusBadge.textContent = status === "paid" ? "Paid" : status === "sent" ? "Sent" : "Invoice";
  statusBadge.classList.toggle("paid", status === "paid");
  setInvoiceText("invoiceNumber", invoice.invoiceNumber || "Invoice");
  setInvoiceText("invoiceDate", formatInvoiceDate(invoice.invoiceDate));
  setInvoiceText("invoiceDueDate", formatInvoiceDate(invoice.dueDate));
  setInvoiceText("invoicePeriod", invoice.periodStart || invoice.periodEnd
    ? `${formatInvoiceDate(invoice.periodStart)} – ${formatInvoiceDate(invoice.periodEnd)}`
    : "Not specified");
  setInvoiceText("invoicePaymentTerms", invoice.paymentTerms || "Upon Receipt");
  setInvoiceText("invoiceClient", invoice.clientName || invoice.billingCompanyName || "Customer");
  setOptionalText("invoiceBillingCompany", invoice.billingCompanyName && invoice.billingCompanyName !== invoice.clientName ? invoice.billingCompanyName : "");
  setOptionalText("invoiceBillingReference", invoice.billingAccountReference ? `Account / Reference: ${invoice.billingAccountReference}` : "");
  setOptionalText("invoiceBillingAddress", invoice.billingAddress);

  const propertyList = document.getElementById("invoicePropertyList");
  propertyList.replaceChildren();
  (invoice.properties || []).forEach((property) => {
    const entry = document.createElement("div");
    entry.className = "property-entry";
    const name = document.createElement("strong");
    name.textContent = property.name || "Property";
    entry.appendChild(name);
    if (property.address) {
      const address = document.createElement("span");
      address.textContent = property.address;
      entry.appendChild(address);
    }
    propertyList.appendChild(entry);
  });
  document.getElementById("invoiceProperties").classList.toggle("hidden", !propertyList.childElementCount);

  const itemsBody = document.getElementById("invoiceItems");
  itemsBody.replaceChildren();
  (invoice.items || []).forEach((item) => {
    const row = document.createElement("tr");
    const cells = [
      item.description || "Service",
      formatInvoiceDate(item.serviceDate),
      `${Number(item.quantity || 0)}${item.unit ? ` ${item.unit}` : ""}`,
      formatInvoiceMoney(item.rate),
      formatInvoiceMoney(item.amount),
    ];
    cells.forEach((value, index) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      cell.dataset.label = ["Description", "Service date", "Qty", "Rate", "Amount"][index];
      if (index === 4) cell.className = "money";
      row.appendChild(cell);
    });
    itemsBody.appendChild(row);
  });

  setInvoiceText("invoiceSubtotal", formatInvoiceMoney(invoice.subtotal));
  setInvoiceText("invoiceTax", formatInvoiceMoney(invoice.tax));
  document.getElementById("invoiceTaxRow").classList.toggle("hidden", Number(invoice.tax || 0) <= 0);
  setInvoiceText("invoiceTotal", formatInvoiceMoney(invoice.total));
  setInvoiceText("invoiceBalance", formatInvoiceMoney(status === "paid" ? 0 : invoice.total));
  setOptionalText("invoiceNotes", invoice.notes);
  document.getElementById("invoiceNotesSection").classList.toggle("hidden", !String(invoice.notes || "").trim());

  const contact = [branding.phone, branding.email].filter(Boolean).join(" · ");
  setInvoiceText("invoiceContact", contact);
  showInvoicePanel(invoiceContent);
}

async function loadCustomerInvoice() {
  if (!/^(?:[0-9a-f]{32}|[0-9a-f]{64})$/i.test(invoiceToken)) {
    showInvoicePanel(unavailablePanel);
    return;
  }
  const { data, error } = await invoiceClient.rpc("get_public_customer_invoice", { invoice_token: invoiceToken });
  if (error || !data) {
    showInvoicePanel(unavailablePanel);
    return;
  }
  renderInvoice(data);
}

loadCustomerInvoice();
