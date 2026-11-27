(() => {
  const el = (id) => document.getElementById(id);
  let snippets = [];
  let snippetEditing = null;
  let sessionVersion = 0;
  let snippetLoadVersion = 0;
  let historyLoadVersion = 0;
  let messageVersion = 0;
  let messageCursor = 0;
  let messageSelectionEnd = 0;

  function status(text) { el("voice-status").textContent = text; }
  function messageChanged() {
    messageVersion++;
    el("snippet-first-name-field").hidden = !el("voice-message").value.includes("{first_name}");
    el("voice-copy-fallback").hidden = true;
    el("voice-copy-text").textContent = "";
    status("");
  }
  function clear() {
    sessionVersion++;
    snippetLoadVersion++;
    historyLoadVersion++;
    snippets = [];
    snippetEditing = null;
    messageCursor = 0;
    messageSelectionEnd = 0;
    for (const id of ["voice-message", "snippet-name", "snippet-body", "snippet-first-name"]) el(id).value = "";
    el("snippet-select").innerHTML = '<option value="">Select a snippet</option>';
    el("snippet-select").value = "";
    el("snippet-save").textContent = "Save snippet";
    el("voice-history").replaceChildren();
    el("voice-history-section").open = false;
    messageChanged();
    status("");
  }
  window.addEventListener("communications-cleared", clear);
  window.addEventListener("communications-loaded", () => { void loadSnippets(); });

  async function loadSnippets(selected = el("snippet-select").value) {
    const request = sessionVersion;
    const load = ++snippetLoadVersion;
    try {
      const { data, error } = await supabaseClient.rpc("admin_list_communication_snippets");
      if (request !== sessionVersion || load !== snippetLoadVersion) return false;
      if (error || !Array.isArray(data)) throw new Error(error?.message || "Invalid response");
      snippets = data;
      el("snippet-select").innerHTML = '<option value="">Select a snippet</option>' + snippets.map((snippet) =>
        `<option value="${escapeText(snippet.id)}">${escapeText(snippet.name)}</option>`).join("");
      el("snippet-select").value = selected;
      return true;
    } catch (error) {
      if (request === sessionVersion && load === snippetLoadVersion) status(`Unable to load snippets: ${error.message}. Check the snippets migration and connection.`);
      return false;
    }
  }
  function resetSnippetForm() {
    snippetEditing = null;
    el("snippet-name").value = "";
    el("snippet-body").value = "";
    el("snippet-save").textContent = "Save snippet";
  }
  function selectedSnippet() { return snippets.find((snippet) => snippet.id === el("snippet-select").value); }
  el("snippet-new").addEventListener("click", resetSnippetForm);
  el("snippet-edit").addEventListener("click", () => {
    const snippet = selectedSnippet();
    if (!snippet) { status("Select a snippet first."); return; }
    snippetEditing = snippet.id;
    el("snippet-name").value = snippet.name;
    el("snippet-body").value = snippet.body;
    el("snippet-save").textContent = "Update snippet";
  });
  el("snippet-save").addEventListener("click", async () => {
    const name = el("snippet-name").value.trim();
    const body = el("snippet-body").value;
    if (!name || !body.trim()) { status("Enter a snippet name and text."); return; }
    const button = el("snippet-save");
    const request = sessionVersion;
    button.disabled = true;
    try {
      const { data: id, error } = await supabaseClient.rpc("admin_save_communication_snippet", {
        target_id: snippetEditing, snippet_name: name, snippet_body: body,
      });
      if (error || !id) throw new Error(error?.message || "No snippet ID returned");
      if (request !== sessionVersion) return;
      resetSnippetForm();
      if (await loadSnippets(id)) status("Snippet saved.");
    } catch (error) { if (request === sessionVersion) status(`Unable to save snippet: ${error.message}`); }
    finally { button.disabled = false; }
  });
  el("snippet-delete").addEventListener("click", async () => {
    const snippet = selectedSnippet();
    if (!snippet) { status("Select a snippet first."); return; }
    if (!confirm(`Delete snippet "${snippet.name}"? Existing messages will not change.`)) return;
    const request = sessionVersion;
    const button = el("snippet-delete");
    button.disabled = true;
    try {
      const { error } = await supabaseClient.rpc("admin_delete_communication_snippet", { target_id: snippet.id });
      if (error) throw new Error(error.message);
      if (request !== sessionVersion) return;
      if (snippetEditing === snippet.id) resetSnippetForm();
      if (await loadSnippets("")) status("Snippet deleted.");
    } catch (error) { if (request === sessionVersion) status(`Unable to delete snippet: ${error.message}`); }
    finally { button.disabled = false; }
  });
  function rememberMessageSelection() {
    messageCursor = el("voice-message").selectionStart;
    messageSelectionEnd = el("voice-message").selectionEnd;
  }
  for (const event of ["select", "click", "keyup"]) el("voice-message").addEventListener(event, rememberMessageSelection);
  el("voice-message").addEventListener("input", () => { rememberMessageSelection(); messageChanged(); });
  el("snippet-first-name").addEventListener("input", messageChanged);
  el("snippet-insert").addEventListener("click", () => {
    const snippet = selectedSnippet();
    if (!snippet) { status("Select a snippet first."); return; }
    const message = el("voice-message");
    const position = Math.min(messageCursor, message.value.length);
    const end = Math.min(Math.max(messageSelectionEnd, position), message.value.length);
    if (message.value.length - (end - position) + snippet.body.length > message.maxLength) {
      status("The message would exceed the 10,000 character limit; shorten it first.");
      return;
    }
    message.value = message.value.slice(0, position) + snippet.body + message.value.slice(end);
    messageCursor = position + snippet.body.length;
    messageSelectionEnd = messageCursor;
    message.focus();
    message.setSelectionRange(messageCursor, messageCursor);
    messageChanged();
    status("Snippet inserted. Review your message before copying.");
  });
  el("voice-copy").addEventListener("click", async () => {
    const draft = el("voice-message").value;
    const firstName = el("snippet-first-name").value.trim();
    if (!draft.trim()) { status("Enter a message first."); return; }
    if (draft.includes("{first_name}") && !firstName) { status("Enter a first name before copying this message."); return; }
    const message = draft.replaceAll("{first_name}", firstName);
    const request = sessionVersion;
    const version = messageVersion;
    const button = el("voice-copy");
    button.disabled = true;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable in this browser");
      await navigator.clipboard.writeText(message);
      if (request === sessionVersion) {
        if (version === messageVersion) {
          el("voice-copy-fallback").hidden = true;
          el("voice-copy-text").textContent = "";
          status("Message copied — paste it into your messaging app.");
        } else status("The message changed while copying. Copy it again before pasting.");
      }
    } catch (error) {
      if (request === sessionVersion && version === messageVersion) {
        el("voice-copy-text").textContent = message;
        el("voice-copy-fallback").hidden = false;
        status(`Unable to copy message: ${error.message}. Select and copy the message below manually.`);
      }
    } finally { button.disabled = false; }
  });
  el("voice-history-section").addEventListener("toggle", async () => {
    if (!el("voice-history-section").open) return;
    const request = sessionVersion;
    const load = ++historyLoadVersion;
    el("voice-history").textContent = "Loading previous manual messages...";
    try {
      const { data, error } = await supabaseClient.rpc("admin_voice_helper_data");
      if (request !== sessionVersion || load !== historyLoadVersion) return;
      if (error || !data || !Array.isArray(data.history)) throw new Error(error?.message || "Invalid response");
      el("voice-history").innerHTML = data.history.map((entry) =>
        `<div class="history-item"><p>${escapeText(entry.recipient_name)} · ${escapeText(entry.message_type)} · ${escapeText(entry.recorded_at)} · Manually recorded, delivery unconfirmed</p><p class="multiline">${escapeText(entry.message_body)}</p></div>`
      ).join("") || "<p>No manual messages recorded.</p>";
    } catch (error) {
      if (request === sessionVersion && load === historyLoadVersion) el("voice-history").textContent = `Unable to load previous manual messages: ${error.message}. Close and reopen to retry.`;
    }
  });
})();
