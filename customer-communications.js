const $ = (id) => document.getElementById(id);
const workspace = $("workspace");
let communicationsData = null;
let currentUser = null;
let loadVersion = 0;
let previewSnapshot = null;
let selectedTemplateId = null;
let publishing = false;

function showStatus(text) { $("status").textContent = text; }
function clearWorkspace() {
  loadVersion++;
  currentUser = null;
  communicationsData = null;
  previewSnapshot = null;
  selectedTemplateId = null;
  workspace.hidden = true;
  $("login").hidden = false;
  $("email").value = "";
  $("password").value = "";
  for (const id of ["recipients", "history"]) $(id).replaceChildren();
  for (const id of ["template-name", "title", "message", "banner", "signature", "test-first-name"]) $(id).value = "";
  $("test-link").checked = false;
  $("test-name-field").hidden = true;
  $("test-link-help").hidden = true;
  $("customer-selection").hidden = false;
  $("preview-section").hidden = true;
  $("publish").disabled = true;
  $("publish").textContent = "Publish greeting";
}

function validateData(data) {
  return data && ["customers", "templates", "greetings"].every((key) => Array.isArray(data[key]));
}

function renderCustomers(data) {
  $("customer-warning").textContent = `${data.unnamed_properties || 0} active properties have no client/owner name and are not included. Identical names are grouped together; check whether they represent different customers. Similar spellings are listed separately.`;
  $("recipients").innerHTML = data.customers.map((customer) => `<div class="recipient" data-source="${escapeText(customer.name)}">
    <label class="inline"><input type="checkbox" class="selected"> Select</label>
    <label>Customer name (${customer.property_count} active ${customer.property_count === 1 ? "property" : "properties"}) <input class="recipient-name" maxlength="200" value="${escapeText(customer.name)}"></label>
    <label>First name (optional unless personalized) <input class="first-name" maxlength="100" placeholder="Enter first name"></label>
  </div>`).join("") || "<p>No active customers with a client/owner name were found.</p>";
  $("select-all").checked = false;
}

function renderHistory(data) {
  $("history").innerHTML = data.greetings.map((greeting) => {
    const disabled = Boolean(greeting.archived_at || greeting.deactivated_at);
    const state = greeting.archived_at ? "Archived" : greeting.deactivated_at ? "Deactivated" : "Active";
    return `<article class="history-item"><h3>${escapeText(greeting.title)}</h3>
      <p>${escapeText(state)} · ${greeting.is_test ? "Test link" : greeting.personalized ? "Personalized" : "Generic shared link"} · Published ${escapeText(greeting.created_at)}</p>
      ${greeting.archived_at ? "" : `<button type="button" data-action="archive" data-id="${escapeText(greeting.id)}">Archive</button>`}
      ${disabled ? "" : `<button type="button" data-action="deactivate" data-id="${escapeText(greeting.id)}">Deactivate link</button>`}
      ${greeting.links.map((link, index) => `<div class="link-row"><strong>${escapeText(link.recipient_name)}</strong>
        ${disabled ? "" : `<button type="button" data-action="copy" data-id="${escapeText(greeting.id)}" data-index="${index}">Copy text message</button><button type="button" data-action="open" data-id="${escapeText(greeting.id)}" data-index="${index}">Open greeting / save image</button>${greeting.is_test ? "" : `<button type="button" data-action="record" data-id="${escapeText(greeting.id)}" data-index="${index}">Record manual send</button>`}`}
      </div>`).join("")}
      ${greeting.is_test ? "<p>Test link: no customer sends recorded.</p>" : `<p>Manual sends recorded: ${greeting.sends.length}</p>`}
      ${greeting.sends.map((send) => `<p>${escapeText(send.recipient_name)} · ${escapeText(send.recorded_at)} · Manually recorded, delivery unconfirmed</p>`).join("")}
    </article>`;
  }).join("") || "<p>No published greetings.</p>";
}

async function loadData(includeCustomers = false) {
  const version = ++loadVersion;
  const { data, error } = await supabaseClient.rpc("admin_communications_data");
  if (version !== loadVersion) return false;
  if (error || !validateData(data)) {
    workspace.hidden = true;
    showStatus(error ? `Unable to load communications: ${error.message}` : "Invalid communications data received.");
    return false;
  }
  communicationsData = data;
  const previous = selectedTemplateId || "";
  $("template").innerHTML = '<option value="">New greeting</option>' + data.templates.map((t) => `<option value="${escapeText(t.id)}">${escapeText(t.name)}</option>`).join("");
  $("template").value = previous;
  if (includeCustomers) renderCustomers(data);
  renderHistory(data);
  $("login").hidden = true;
  workspace.hidden = false;
  showStatus("");
  return true;
}

function recipients() {
  return [...document.querySelectorAll(".recipient")].filter((row) => row.querySelector(".selected").checked).map((row) => ({
    source_name: row.dataset.source,
    name: row.querySelector(".recipient-name").value.trim(),
    first_name: row.querySelector(".first-name").value.trim(),
  }));
}

function inputData() {
  return {
    greeting_title: $("title").value.trim(), greeting_message: $("message").value.trim(),
    greeting_banner_url: $("banner").value.trim() || null, greeting_signature: $("signature").value.trim(),
    personalize: $("personalize").checked, recipients: recipients(),
    test_link: $("test-link").checked, test_first_name: $("test-first-name").value.trim(),
  };
}

function invalidatePreview() {
  previewSnapshot = null;
  $("publish").disabled = true;
  $("preview-section").hidden = true;
}

$("workspace").addEventListener("input", invalidatePreview);
$("workspace").addEventListener("change", invalidatePreview);
$("test-link").addEventListener("change", () => {
  const isTest = $("test-link").checked;
  $("customer-selection").hidden = isTest;
  $("test-name-field").hidden = !isTest;
  $("test-link-help").hidden = !isTest;
  $("publish").textContent = isTest ? "Create test link" : "Publish greeting";
});
$("select-all").addEventListener("change", (event) => {
  document.querySelectorAll(".recipient .selected").forEach((checkbox) => { checkbox.checked = event.target.checked; });
});
$("recipients").addEventListener("change", () => {
  const all = [...document.querySelectorAll(".recipient .selected")];
  $("select-all").checked = all.length > 0 && all.every((item) => item.checked);
});
$("template").addEventListener("change", () => {
  selectedTemplateId = $("template").value || null;
  const template = communicationsData?.templates.find((item) => item.id === selectedTemplateId);
  for (const [id, key] of [["template-name", "name"], ["title", "title"], ["message", "message"], ["banner", "banner_url"], ["signature", "signature"]]) $(id).value = template?.[key] || "";
  invalidatePreview();
});

async function saveTemplate(asNew) {
  const data = inputData();
  try { validateGreeting(data, false); } catch (error) { showStatus(error.message); return; }
  if (!$("template-name").value.trim()) { showStatus("Enter a template name."); return; }
  const { data: id, error } = await supabaseClient.rpc("admin_save_communication_template", {
    template_id: asNew ? null : selectedTemplateId,
    template_name: $("template-name").value.trim(), greeting_title: data.greeting_title,
    greeting_message: data.greeting_message, greeting_banner_url: data.greeting_banner_url, greeting_signature: data.greeting_signature,
  });
  if (error) { showStatus(`Unable to save template: ${error.message}`); return; }
  selectedTemplateId = id;
  if (await loadData()) showStatus("Template saved.");
}
$("save-template").addEventListener("click", () => void saveTemplate(false));
$("save-new-template").addEventListener("click", () => void saveTemplate(true));

$("preview").addEventListener("click", () => {
  const data = inputData();
  try { validateCommunicationPreview(data); } catch (error) { showStatus(error.message); return; }
  $("preview-title").textContent = data.greeting_title;
  const firstName = data.test_link ? data.test_first_name : data.personalize ? data.recipients[0].first_name : "";
  $("preview-name").textContent = firstName ? `Dear ${firstName},` : "";
  $("preview-message").textContent = data.greeting_message;
  $("preview-signature").textContent = data.greeting_signature;
  const banner = $("preview-banner");
  banner.hidden = !data.greeting_banner_url;
  if (data.greeting_banner_url) banner.src = data.greeting_banner_url;
  else banner.removeAttribute("src");
  previewSnapshot = JSON.stringify(data);
  $("preview-section").hidden = false;
  $("publish").disabled = publishing;
  showStatus(data.test_link ? "Test greeting preview ready." : data.personalize ? `Preview shows the first of ${data.recipients.length} personalized greetings.` : "Preview ready.");
});

$("publish").addEventListener("click", async () => {
  if (publishing) return;
  const data = inputData();
  if (!previewSnapshot || JSON.stringify(data) !== previewSnapshot) { invalidatePreview(); showStatus("Preview the current greeting before publishing."); return; }
  publishing = true;
  $("publish").disabled = true;
  try {
    const { test_link, test_first_name, ...greeting } = data;
    const { error } = test_link
      ? await supabaseClient.rpc("admin_publish_communication_test", {
        greeting_title: greeting.greeting_title, greeting_message: greeting.greeting_message,
        greeting_banner_url: greeting.greeting_banner_url, greeting_signature: greeting.greeting_signature,
        test_first_name: test_first_name || null,
      })
      : await supabaseClient.rpc("admin_publish_communication", greeting);
    if (error) throw new Error(error.message);
    invalidatePreview();
    if (await loadData()) showStatus(test_link ? "Test link created. Copy it from communication history below; nothing was sent automatically." : "Greeting published. Copy a text message for each customer below; nothing was sent automatically.");
  } catch (error) {
    showStatus(`Unable to publish greeting: ${error.message}`);
  } finally {
    publishing = false;
    $("publish").disabled = !previewSnapshot;
  }
});

$("history").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const greeting = communicationsData?.greetings.find((item) => item.id === button.dataset.id);
  if (!greeting) return;
  const action = button.dataset.action;
  const link = greeting.links[Number(button.dataset.index)];
  let greetingWindow = null;
  button.disabled = true;
  try {
    if (action === "archive" || action === "deactivate") {
      if (!confirm(`${action === "archive" ? "Archive" : "Deactivate"} this greeting? Its links will stop working.`)) return;
      const { error } = await supabaseClient.rpc("admin_set_communication_status", { target_id: greeting.id, action });
      if (error) throw new Error(error.message);
      if (await loadData()) showStatus(`Greeting ${action === "archive" ? "archived" : "deactivated"}.`);
    } else if (action === "record" && link) {
      if (!confirm(`Record a manual send to ${link.recipient_name}? This does not confirm delivery.`)) return;
      const { error } = await supabaseClient.rpc("admin_record_communication_send", { target_link_id: link.id, target_recipient_name: link.recipient_name });
      if (error) throw new Error(error.message);
      if (await loadData()) showStatus("Manual send recorded; delivery is not confirmed.");
    } else if ((action === "copy" || action === "open") && link) {
      if (action === "open") {
        greetingWindow = window.open("", "_blank");
        if (!greetingWindow) throw new Error("Your browser blocked the new tab. Allow pop-ups and try again.");
        greetingWindow.opener = null;
      }
      const { data: token, error } = await supabaseClient.rpc("admin_get_communication_token", { target_link_id: link.id });
      if (error) throw new Error(error.message);
      if (!/^[0-9a-f]{64}$/i.test(token || "")) throw new Error("The server returned an invalid greeting link.");
      const url = new URL("greeting.html", location.href);
      url.hash = `t=${token}`;
      if (action === "open") {
        greetingWindow.location.replace(url.href);
        greetingWindow = null;
        showStatus(`Opened the greeting for ${link.recipient_name}. Use Save Greeting Image on that page.`);
      } else {
        await navigator.clipboard.writeText(`A greeting from Guest Ready: ${url.href}`);
        showStatus(`Text copied for ${link.recipient_name}. Sending and delivery are not recorded automatically.`);
      }
    }
  } catch (error) {
    if (greetingWindow) greetingWindow.close();
    showStatus(`Unable to ${action}: ${error.message}`);
  }
  finally { button.disabled = false; }
});

$("login").addEventListener("submit", async (event) => {
  event.preventDefault();
  const { error } = await supabaseClient.auth.signInWithPassword({ email: $("email").value.trim(), password: $("password").value });
  if (error) showStatus(error.message);
});
supabaseClient.auth.onAuthStateChange((_event, session) => {
  if (!session) { clearWorkspace(); return; }
  if (currentUser !== session.user.id) {
    clearWorkspace();
    currentUser = session.user.id;
    setTimeout(() => void loadData(true), 0);
  }
});
supabaseClient.auth.getSession().then(({ data, error }) => {
  if (error) { showStatus(error.message); return; }
  if (data.session && !currentUser) { currentUser = data.session.user.id; void loadData(true); }
});
