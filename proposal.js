const PROPOSAL_SUPABASE_URL = "https://tmfyjzqghxntprexonrg.supabase.co";
const PROPOSAL_SUPABASE_KEY = "sb_publishable_wYrEHjC8nWZgnjhT36fcDw_lp8hWH6c";
const proposalClient = window.supabase.createClient(PROPOSAL_SUPABASE_URL, PROPOSAL_SUPABASE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    storageKey: "guest-ready-public-proposal",
  },
});

const approvalToken = new URLSearchParams(window.location.search).get("token") || "";
const loadingPanel = document.getElementById("proposalLoading");
const invalidPanel = document.getElementById("proposalInvalid");
const contentPanel = document.getElementById("proposalContent");
const approvedPanel = document.getElementById("proposalApproved");
const declinedPanel = document.getElementById("proposalDeclined");
const proposalError = document.getElementById("proposalError");
const approveButton = document.getElementById("approveProposalBtn");
const declineButton = document.getElementById("declineProposalBtn");
let currentProposal = null;

function showOnly(panel) {
  [loadingPanel, invalidPanel, contentPanel, approvedPanel, declinedPanel].forEach((item) => {
    item.classList.toggle("hidden", item !== panel);
  });
}

function formatProposalPrice(value) {
  return Number(value || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatProposalDate(value) {
  if (!value) return "";
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function renderConfirmation(panel, proposal) {
  panel.querySelector("[data-confirmation-property]").textContent = proposal.property_name || "";
  panel.querySelector("[data-confirmation-job]").textContent = proposal.job_title || "Work Proposal";
  panel.querySelector("[data-confirmation-price]").textContent = formatProposalPrice(proposal.proposed_price);

  const descriptionRow = panel.querySelector("[data-confirmation-description-row]");
  const description = proposal.customer_description || "";
  descriptionRow.classList.toggle("hidden", !description);
  panel.querySelector("[data-confirmation-description]").textContent = description;

  const dateRow = panel.querySelector("[data-confirmation-date-row]");
  dateRow.classList.toggle("hidden", !proposal.tentative_service_date);
  panel.querySelector("[data-confirmation-date]").textContent = formatProposalDate(proposal.tentative_service_date);
}

function renderProposal(proposal) {
  currentProposal = proposal;
  document.title = `Guest Ready - ${proposal.job_title || "Work Proposal"}`;
  document.getElementById("proposalProperty").textContent = proposal.property_name || "";
  document.getElementById("proposalJobTitle").textContent = proposal.job_title || "Work Proposal";
  document.getElementById("proposalDescription").textContent = proposal.customer_description || "Proposal details provided by Fair Ventures.";
  document.getElementById("proposalPrice").textContent = formatProposalPrice(proposal.proposed_price);
  const dateRow = document.getElementById("proposalDateRow");
  dateRow.classList.toggle("hidden", !proposal.tentative_service_date);
  document.getElementById("proposalDate").textContent = formatProposalDate(proposal.tentative_service_date);
  renderConfirmation(approvedPanel, proposal);
  renderConfirmation(declinedPanel, proposal);
  if (proposal.response_status === "Approved") {
    showOnly(approvedPanel);
  } else if (proposal.response_status === "Declined") {
    showOnly(declinedPanel);
  } else {
    showOnly(contentPanel);
  }
}

async function loadProposal() {
  if (!/^[0-9a-f]{64}$/i.test(approvalToken)) {
    showOnly(invalidPanel);
    return;
  }
  const { data, error } = await proposalClient.rpc("get_public_pipeline_proposal", {
    approval_token: approvalToken,
  });
  const proposal = Array.isArray(data) ? data[0] : data;
  if (error || !proposal) {
    showOnly(invalidPanel);
    return;
  }
  renderProposal(proposal);
}

async function submitResponse(response) {
  if (!currentProposal) return;
  const price = formatProposalPrice(currentProposal.proposed_price);
  const message = response === "Approved"
    ? `Approve this work for ${price}?`
    : "Decline this proposal?";
  if (!window.confirm(message)) return;

  approveButton.disabled = true;
  declineButton.disabled = true;
  proposalError.classList.add("hidden");
  const { data, error } = await proposalClient.rpc("submit_public_pipeline_response", {
    approval_token: approvalToken,
    submitted_response: response,
    submitted_customer_name: document.getElementById("customerName").value.trim() || null,
    submitted_customer_comment: document.getElementById("customerComment").value.trim() || null,
  });
  if (error) {
    proposalError.textContent = error.message?.includes("no longer valid")
      ? "This approval link is no longer valid."
      : "We could not record your response. Please try again.";
    proposalError.classList.remove("hidden");
    approveButton.disabled = false;
    declineButton.disabled = false;
    return;
  }
  renderConfirmation(data === "Approved" ? approvedPanel : declinedPanel, currentProposal);
  showOnly(data === "Approved" ? approvedPanel : declinedPanel);
}

approveButton.addEventListener("click", () => submitResponse("Approved"));
declineButton.addEventListener("click", () => submitResponse("Declined"));
loadProposal();