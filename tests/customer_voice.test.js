// Run with JavaScriptCore: jsc tests/customer_voice.test.js
function assert(value, message) { if (!value) throw new Error(message); }
const html = readFile("customer-communications.html");
assert(/<a\b[^>]*href="sms:"[^>]*>Open Messages app<\/a>/.test(html), "Messages button should open the device SMS handler without a recipient or message");
const elements = {};
function element(id) {
  if (!elements[id]) elements[id] = {
    value: "", innerHTML: "", textContent: "", hidden: false, disabled: false, open: false, handlers: {},
    selectionStart: 0, selectionEnd: 0, maxLength: 10000,
    addEventListener(type, handler) { this.handlers[type] = handler; },
    replaceChildren() { this.innerHTML = ""; this.textContent = ""; },
    focus() { this.focused = true; },
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
  };
  return elements[id];
}
const calls = [];
let snippetState = [];
let errorMessage = "";
let deferredLoad = null;
let history = [{ recipient_name: "Alex", message_type: "custom", recorded_at: "today", message_body: "Previous message" }];
async function rpc(name, args) {
  calls.push({ name, args });
  if (name === "admin_list_communication_snippets") {
    if (deferredLoad) return deferredLoad;
    return errorMessage ? { error: { message: errorMessage } } : { data: snippetState.slice() };
  }
  if (name === "admin_save_communication_snippet") {
    if (errorMessage) return { error: { message: errorMessage } };
    const id = args.target_id || "s1";
    snippetState = snippetState.filter((snippet) => snippet.id !== id);
    snippetState.push({ id, name: args.snippet_name, body: args.snippet_body });
    return { data: id };
  }
  if (name === "admin_delete_communication_snippet") {
    if (errorMessage) return { error: { message: errorMessage } };
    snippetState = snippetState.filter((snippet) => snippet.id !== args.target_id);
    return {};
  }
  if (name === "admin_voice_helper_data") return errorMessage ? { error: { message: errorMessage } } : { data: { history } };
  throw new Error(`Unexpected RPC: ${name}`);
}
const listeners = {};
const fakeWindow = { addEventListener(type, handler) { (listeners[type] ||= []).push(handler); } };
let copied = "";
const fakeNavigator = { clipboard: { async writeText(text) { copied = text; } } };
new Function("document", "window", "navigator", "supabaseClient", "escapeText", "confirm",
  readFile("customer-voice.js"))({ getElementById: element }, fakeWindow, fakeNavigator, { rpc }, String, () => true);
async function click(id) { return element(id).handlers.click({ target: element(id) }); }
async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
function setDraft(value, start, end = start) {
  const draft = element("voice-message");
  draft.value = value;
  draft.selectionStart = start;
  draft.selectionEnd = end;
  draft.handlers.input();
}
async function main() {
  listeners["communications-loaded"].forEach((fn) => fn());
  await flush();
  await click("voice-copy");
  assert(element("voice-status").textContent.includes("Enter a message"), "Empty message must not be copied");
  await click("snippet-save");
  assert(element("voice-status").textContent.includes("name and text"), "Empty snippet should produce a useful error");
  element("snippet-name").value = "Welcome";
  element("snippet-body").value = "Hi {first_name}\nEnjoy!";
  errorMessage = "Database unavailable";
  await click("snippet-save");
  assert(element("voice-status").textContent.includes(errorMessage) && element("snippet-body").value.includes("Enjoy!"), "Save errors should retain snippet text");
  errorMessage = "";
  await click("snippet-save");
  assert(snippetState[0].name === "Welcome" && element("snippet-select").value === "s1", "New snippet should save and be selected");
  await click("snippet-edit");
  element("snippet-name").value = "Greeting";
  element("snippet-body").value = "Hello {first_name}\n";
  await click("snippet-save");
  assert(snippetState.length === 1 && snippetState[0].name === "Greeting", "Edit should update the selected snippet");
  const draft = element("voice-message");
  setDraft("world", 0);
  await click("snippet-insert");
  assert(draft.value === "Hello {first_name}\nworld" && draft.selectionStart === 19 && draft.focused, "Insert at start preserves draft and restores caret");
  assert(!element("snippet-first-name-field").hidden, "Placeholder should reveal the first-name field");
  setDraft("begin end", 6);
  await click("snippet-insert");
  assert(draft.value === "begin Hello {first_name}\nend", "Insert in middle preserves surrounding text");
  setDraft("draft", 5);
  await click("snippet-insert");
  assert(draft.value === "draftHello {first_name}\n", "Insert at end preserves existing text");
  setDraft("before replace after", 7, 14);
  await click("snippet-insert");
  assert(draft.value === "before Hello {first_name}\n after", "Only selected text should be replaced");
  await click("voice-copy");
  assert(!copied && element("voice-status").textContent.includes("first name"), "Missing first name must not copy an unfilled placeholder");
  element("snippet-first-name").value = "Alex";
  element("snippet-first-name").handlers.input();
  await click("voice-copy");
  assert(copied === "before Hello Alex\n after", "Copy must personalize and preserve surrounding text");
  assert(!calls.some((call) => call.name.includes("record")), "Copying must never record a send");
  setDraft("Hello {first_name}, {first_name}!\nhttps://example.test/g", 56);
  await click("voice-copy");
  assert(copied === "Hello Alex, Alex!\nhttps://example.test/g", "All placeholders and manually pasted links should be copied correctly");
  setDraft("x".repeat(10000), 5000);
  await click("snippet-insert");
  assert(draft.value.length === 10000 && element("voice-status").textContent.includes("10,000"), "Oversized insertion must not truncate draft");
  setDraft("Hi {first_name}", 15);
  fakeNavigator.clipboard.writeText = async () => { throw new Error("Permission denied"); };
  await click("voice-copy");
  assert(!element("voice-copy-fallback").hidden && element("voice-copy-text").textContent === "Hi Alex" && element("voice-status").textContent.includes("Permission denied"), "Clipboard failure displays exact personalized text");
  element("snippet-first-name").value = "Taylor";
  element("snippet-first-name").handlers.input();
  assert(element("voice-copy-fallback").hidden && !element("voice-copy-text").textContent, "Changing first name clears stale fallback");
  fakeNavigator.clipboard = undefined;
  await click("voice-copy");
  assert(element("voice-copy-text").textContent === "Hi Taylor" && element("voice-status").textContent.includes("unavailable"), "Missing clipboard access must provide fallback");
  fakeNavigator.clipboard = { async writeText(text) { copied = text; } };
  await click("voice-copy");
  assert(copied === "Hi Taylor" && element("voice-copy-fallback").hidden && !element("voice-copy-text").textContent, "Successful retry should clear the fallback");
  let resolveCopy;
  fakeNavigator.clipboard = { writeText() { return new Promise((resolve) => { resolveCopy = resolve; }); } };
  const pending = click("voice-copy");
  assert(element("voice-copy").disabled, "Pending copy disables duplicate attempts");
  setDraft("Updated", 7);
  resolveCopy();
  await pending;
  assert(element("voice-status").textContent.includes("changed while copying") && !element("voice-copy").disabled, "Changing draft while copying must require another copy");
  errorMessage = "Delete failed";
  await click("snippet-delete");
  assert(element("voice-status").textContent.includes(errorMessage) && snippetState.length === 1, "Delete error must be shown");
  errorMessage = "";
  await click("snippet-delete");
  assert(snippetState.length === 0 && draft.value === "Updated", "Delete should not change the draft");
  element("voice-history-section").open = true;
  await element("voice-history-section").handlers.toggle();
  assert(element("voice-history").innerHTML.includes("Previous message"), "Previous manual history remains accessible");
  errorMessage = "History unavailable";
  await element("voice-history-section").handlers.toggle();
  assert(element("voice-history").textContent.includes(errorMessage), "History errors should be visible");
  errorMessage = "";
  let resolveLoad;
  deferredLoad = new Promise((resolve) => { resolveLoad = resolve; });
  listeners["communications-loaded"].forEach((fn) => fn());
  listeners["communications-cleared"].forEach((fn) => fn());
  resolveLoad({ data: [{ id: "late", name: "Sensitive", body: "Secret" }] });
  await flush();
  assert(!element("snippet-select").innerHTML.includes("Sensitive") && !element("snippet-name").value && !draft.value && !element("snippet-first-name").value && !element("voice-history").innerHTML, "Sign-out clears private data and ignores late responses");
  print("PASS: saved snippets, message copying, personalization, and previous history");
}
main().catch((error) => { print(`FAIL: ${error.message}`); quit(1); });
