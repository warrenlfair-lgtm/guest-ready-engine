const login = document.getElementById("login");
const manager = document.getElementById("manager");
const message = document.getElementById("message");
const taskForm = document.getElementById("task-form");
const noteForm = document.getElementById("note-form");
let taskId = null;
let noteId = null;
let managerData = null;
let activeUser = null;
let loadGeneration = 0;
const escapeText = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const field = (form, name) => form.elements.namedItem(name);

function resetForm(form) {
  form.reset();
  if (form === taskForm) taskId = null;
  else noteId = null;
}

function options(select, rows) {
  const previous = select.value;
  select.innerHTML = '<option value="">None</option>' + rows.map((row) => `<option value="${escapeText(row.id)}">${escapeText(row.name)}</option>`).join("");
  select.value = previous;
}

async function loadManager() {
  const requested = ++loadGeneration;
  const { data, error } = await supabaseClient.rpc("command_center_manage_data");
  if (requested !== loadGeneration) return;
  if (error) {
    manager.hidden = true;
    message.textContent = `Unable to load management: ${error.message}`;
    return false;
  }
  if (!data || !["properties", "technicians", "tasks", "notes"].every((key) => Array.isArray(data[key]))) {
    manager.hidden = true;
    message.textContent = "Invalid management data received.";
    return false;
  }
  managerData = data;
  options(field(taskForm, "property"), data.properties);
  options(field(noteForm, "property"), data.properties);
  options(field(taskForm, "technician"), data.technicians);
  document.getElementById("tasks").innerHTML = data.tasks.map((item) =>
    `<div class="record"><strong>${escapeText(item.title)}</strong><small>${escapeText(item.status)} · ${escapeText(item.priority)} · ${escapeText(item.due_date || "No due date")} · Created ${escapeText(item.created_at)} by ${escapeText(item.created_by)}${item.completed_at ? ` · Completed ${escapeText(item.completed_at)}` : ""}</small><button type="button" data-edit-task="${escapeText(item.id)}">Edit</button></div>`).join("") || "No tasks.";
  document.getElementById("notes").innerHTML = data.notes.map((item) =>
    `<div class="record"><strong>${escapeText(item.title)}</strong><small>${item.archived ? "Archived" : item.pinned ? "Pinned" : "Unpinned"} · Created ${escapeText(item.created_at)} by ${escapeText(item.created_by)}</small><button type="button" data-edit-note="${escapeText(item.id)}">Edit</button></div>`).join("") || "No notes.";
  login.hidden = true;
  manager.hidden = false;
  message.textContent = "";
  return true;
}

login.addEventListener("submit", async (event) => {
  event.preventDefault();
  const { error } = await supabaseClient.auth.signInWithPassword({ email: document.getElementById("email").value.trim(), password: document.getElementById("password").value });
  if (error) message.textContent = error.message;
});
supabaseClient.auth.onAuthStateChange((_event, session) => {
  if (!session) {
    loadGeneration++;
    activeUser = null;
    managerData = null;
    manager.hidden = true;
    document.getElementById("tasks").replaceChildren();
    document.getElementById("notes").replaceChildren();
    resetForm(taskForm);
    resetForm(noteForm);
    login.hidden = false;
    document.getElementById("password").value = "";
    return;
  }
  if (activeUser !== session.user.id) {
    activeUser = session.user.id;
    manager.hidden = true;
    setTimeout(loadManager, 0);
  }
});
supabaseClient.auth.getSession().then(({ data, error }) => {
  if (error) { message.textContent = error.message; return; }
  if (data.session && !activeUser) { activeUser = data.session.user.id; void loadManager(); }
});
document.getElementById("new-task").addEventListener("click", () => resetForm(taskForm));
document.getElementById("new-note").addEventListener("click", () => resetForm(noteForm));
document.getElementById("tasks").addEventListener("click", (event) => {
  const item = managerData?.tasks.find((task) => task.id === event.target.dataset.editTask);
  if (!item) return;
  taskId = item.id;
  for (const [name, value] of Object.entries({ title: item.title, description: item.description, property: item.property_id, technician: item.technician_id, date: item.due_date, priority: item.priority, status: item.status })) field(taskForm, name).value = value || "";
  field(taskForm, "pinned").checked = item.pinned;
  taskForm.scrollIntoView({ behavior: "smooth" });
});
document.getElementById("notes").addEventListener("click", (event) => {
  const item = managerData?.notes.find((note) => note.id === event.target.dataset.editNote);
  if (!item) return;
  noteId = item.id;
  for (const [name, value] of Object.entries({ title: item.title, content: item.content, property: item.property_id, date: item.expires_on })) field(noteForm, name).value = value || "";
  field(noteForm, "pinned").checked = item.pinned;
  field(noteForm, "archived").checked = item.archived;
  noteForm.scrollIntoView({ behavior: "smooth" });
});
taskForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = taskForm.querySelector('button[type="submit"]');
  button.disabled = true;
  const { error } = await supabaseClient.rpc("command_center_save_task", {
    target_id: taskId, task_title: field(taskForm, "title").value.trim(),
    task_description: field(taskForm, "description").value.trim(), task_property_id: field(taskForm, "property").value || null,
    task_technician_id: field(taskForm, "technician").value || null, task_due_date: field(taskForm, "date").value || null,
    task_priority: field(taskForm, "priority").value, task_status: field(taskForm, "status").value, task_pinned: field(taskForm, "pinned").checked,
  });
  button.disabled = false;
  if (error) { message.textContent = `Unable to save task: ${error.message}`; return; }
  resetForm(taskForm);
  if (await loadManager()) message.textContent = "Task saved.";
});
noteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = noteForm.querySelector('button[type="submit"]');
  button.disabled = true;
  const { error } = await supabaseClient.rpc("command_center_save_note", {
    target_id: noteId, note_title: field(noteForm, "title").value.trim(), note_content: field(noteForm, "content").value.trim(),
    note_property_id: field(noteForm, "property").value || null, note_pinned: field(noteForm, "pinned").checked,
    note_expires_on: field(noteForm, "date").value || null, note_archived: field(noteForm, "archived").checked,
  });
  button.disabled = false;
  if (error) { message.textContent = `Unable to save note: ${error.message}`; return; }
  resetForm(noteForm);
  if (await loadManager()) message.textContent = "Note saved.";
});
