const VP2_TECH_SUPABASE_URL = "https://tmfyjzqghxntprexonrg.supabase.co";
const VP2_TECH_SUPABASE_KEY = "sb_publishable_wYrEHjC8nWZgnjhT36fcDw_lp8hWH6c";
const vp2TechClient = window.supabase.createClient(VP2_TECH_SUPABASE_URL, VP2_TECH_SUPABASE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    storageKey: "guest-ready-public-vp2-action-plan",
  },
});

const vp2TechPathMatch = window.location.pathname.match(/^\/vp2-work-order\/([0-9a-f]{64})$/i);
const vp2TechToken = vp2TechPathMatch?.[1] || new URLSearchParams(window.location.search).get("token") || "";
const vp2TechLoading = document.getElementById("vp2TechLoading");
const vp2TechUnavailable = document.getElementById("vp2TechUnavailable");
const vp2TechContent = document.getElementById("vp2TechContent");
const vp2TechForm = document.getElementById("vp2TechCompletionForm");
const vp2TechError = document.getElementById("vp2TechError");
const vp2TechCompleteBtn = document.getElementById("vp2TechCompleteBtn");
let currentVp2TechToken = "";
let currentVp2TechPlan = null;
let vp2TechStandardCheckboxes = [];
let vp2TechAdditionalCheckboxes = [];
let vp2TechPhotos = [];
const VP2_TECH_PHOTO_BUCKET = "vp2-technician-photos";
const VP2_TECH_MAX_PHOTOS = 10;
const VP2_TECH_MAX_PHOTO_SIZE = 5 * 1024 * 1024;
const VP2_STANDARD_TASKS_FALLBACK = [
  "Brush pool walls, steps, and floor",
  "Skim surface and remove debris",
  "Check filter pressure and record PSI",
  "Inspect and empty skimmer basket",
  "Inspect and empty pump basket as needed",
  "Check pool water level and adjust if necessary",
  "Verify pump operation and water circulation",
  "Inspect pool returns and skimmer suction",
  "Check for visible leaks or equipment issues",
  "Independently test free chlorine and pH",
  "Verify chemical treatment instructions and complete approved adjustments",
  "Check overall water clarity and visible pool condition",
  "Secure equipment area and leave pool area clean",
];

function showVp2TechPanel(panel) {
  [vp2TechLoading, vp2TechUnavailable, vp2TechContent].forEach((element) => {
    element.classList.toggle("hidden", element !== panel);
  });
}

function formatVp2TechDate(value) {
  if (!value) return "Not specified";
  const parts = String(value).slice(0, 10).split("-").map(Number);
  if (parts.length !== 3 || parts.some((part) => !part)) return "Not specified";
  return new Date(parts[0], parts[1] - 1, parts[2]).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatVp2TechCompletionTime(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : `Completed ${date.toLocaleString()}`;
}

function appendReading(list, label, value) {
  const row = document.createElement("div");
  row.className = "vp2-tech-reading";
  const name = document.createElement("dt");
  name.textContent = label;
  const reading = document.createElement("dd");
  reading.textContent = value == null || value === "" ? "Not entered" : String(value);
  row.append(name, reading);
  list.appendChild(row);
}

function renderVp2TechPlan(plan) {
  currentVp2TechPlan = plan;
  document.title = `VP² Action Plan | ${plan.propertyName || "Technician"}`;
  document.getElementById("vp2TechLogo").src = plan.logoUrl || "/assets/vp2-logo.png";
  document.getElementById("vp2TechAffiliation").textContent = plan.brandAffiliation || "A Guest Ready Services Company";
  document.getElementById("vp2TechProperty").textContent = plan.propertyName || "Pool Property";
  document.getElementById("vp2TechDate").textContent = formatVp2TechDate(plan.reviewDate);

  const readings = plan.readings || {};
  const readingList = document.getElementById("vp2TechReadings");
  readingList.replaceChildren();
  appendReading(readingList, "Free chlorine", readings.free_chlorine);
  appendReading(readingList, "pH", readings.ph);
  appendReading(readingList, "Total alkalinity", readings.total_alkalinity);
  document.getElementById("vp2TechAnalysis").textContent = plan.analysis || "No analysis provided.";

  const actionsContainer = document.getElementById("vp2TechActions");
  const checklist = document.getElementById("vp2TechChecklist");
  actionsContainer.replaceChildren();
  checklist.replaceChildren();
  const legend = document.createElement("legend");
  legend.textContent = "Standard pool service tasks";
  checklist.appendChild(legend);
  const standardTasks = Array.isArray(plan.standardTasks) ? plan.standardTasks : VP2_STANDARD_TASKS_FALLBACK;
  const standardTaskKeys = new Set(standardTasks.map((task) => String(typeof task === "string" ? task : task.title || task.label || "").trim().toLowerCase()));
  vp2TechStandardCheckboxes = [];
  vp2TechAdditionalCheckboxes = [];
  standardTasks.forEach((task, index) => {
    const taskText = typeof task === "string" ? task : task.title || task.label || `Service task ${index + 1}`;
    const label = document.createElement("label");
    label.className = "vp2-tech-check-item";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = Boolean(plan.completionChecklist?.[index]);
    checkbox.disabled = plan.completionStatus === "completed";
    const text = document.createElement("span");
    text.textContent = taskText;
    label.append(checkbox, text);
    checklist.appendChild(label);
    vp2TechStandardCheckboxes.push(checkbox);
  });

  const actions = Array.isArray(plan.actions) ? plan.actions : [];
  const additionalActions = actions.filter((action) => {
    const actionText = typeof action === "string"
      ? action
      : action.instructions || action.chemical || action.title || "";
    return Boolean(String(actionText).trim()) && !standardTaskKeys.has(String(actionText).trim().toLowerCase());
  });
  additionalActions.forEach((action, index) => {
    const actionText = typeof action === "string"
      ? action
      : action.instructions || action.chemical || action.title || "";
    if (!String(actionText).trim()) return;
    const article = document.createElement("article");
    article.className = "vp2-tech-action vp2-tech-recommendation";
    const title = document.createElement("h3");
    title.textContent = action.title || action.chemical || `Additional recommendation ${index + 1}`;
    article.appendChild(title);
    if (typeof action === "object" && (action.amount || action.unit)) {
      const amount = document.createElement("p");
      amount.className = "vp2-tech-action-amount";
      amount.textContent = [action.amount, action.unit].filter(Boolean).join(" ");
      article.appendChild(amount);
    }
    const instructions = document.createElement("p");
    instructions.textContent = actionText;
    article.appendChild(instructions);
    const completionLabel = document.createElement("label");
    completionLabel.className = "vp2-tech-check-item vp2-tech-recommendation-check";
    const completionCheckbox = document.createElement("input");
    completionCheckbox.type = "checkbox";
    completionCheckbox.checked = Boolean(plan.completionChecklist?.[standardTasks.length + index]);
    completionCheckbox.disabled = plan.completionStatus === "completed";
    const completionText = document.createElement("span");
    completionText.textContent = "This recommended task is complete";
    completionLabel.append(completionCheckbox, completionText);
    article.appendChild(completionLabel);
    vp2TechAdditionalCheckboxes.push(completionCheckbox);
    actionsContainer.appendChild(article);
  });

  if (additionalActions.length === 0) {
    const noActions = document.createElement("p");
    noActions.textContent = "No additional recommended actions.";
    actionsContainer.appendChild(noActions);
  }

  document.getElementById("vp2TechNotes").value = plan.technicianNotes || "";
  vp2TechPhotos = Array.isArray(plan.photographs) ? plan.photographs : [];
  void renderVp2TechPhotos(vp2TechPhotos);
  const completed = plan.completionStatus === "completed";
  vp2TechForm.classList.toggle("hidden", completed);
  const completedSection = document.getElementById("vp2TechCompleted");
  completedSection.classList.toggle("hidden", !completed);
  document.getElementById("vp2TechCompletedAt").textContent = formatVp2TechCompletionTime(plan.completedAt);
  const completedChecklist = document.getElementById("vp2TechCompletedChecklist");
  completedChecklist.replaceChildren();
  if (completed) {
    const heading = document.createElement("h3");
    heading.textContent = "Standard service tasks";
    completedChecklist.appendChild(heading);
    standardTasks.forEach((task, index) => {
      const label = document.createElement("p");
      label.className = "vp2-tech-completed-task";
      label.textContent = `${plan.completionChecklist?.[index] ? "Checked" : "Not checked"} · ${typeof task === "string" ? task : task.title || task.label || `Service task ${index + 1}`}`;
      completedChecklist.appendChild(label);
    });
    if (additionalActions.length) {
      const additionalHeading = document.createElement("h3");
      additionalHeading.textContent = "Additional recommended actions";
      completedChecklist.appendChild(additionalHeading);
      additionalActions.forEach((action, index) => {
        const actionText = typeof action === "string"
          ? action
          : action.instructions || action.chemical || action.title || `Additional action ${index + 1}`;
        const item = document.createElement("p");
        item.className = "vp2-tech-completed-task";
        item.textContent = `${plan.completionChecklist?.[standardTasks.length + index] ? "Checked" : "Not checked"} · ${actionText}`;
        completedChecklist.appendChild(item);
      });
    }
  }
  document.getElementById("vp2TechSavedNotes").textContent = plan.technicianNotes || "";
  showVp2TechPanel(vp2TechContent);
}

async function loadVp2TechPlan() {
  if (!/^[0-9a-f]{64}$/i.test(vp2TechToken)) {
    showVp2TechPanel(vp2TechUnavailable);
    return;
  }
  currentVp2TechToken = vp2TechToken;
  const { data, error } = await vp2TechClient.rpc("get_public_vp2_action_plan", {
    technician_token: currentVp2TechToken,
  });
  if (error || !data) {
    showVp2TechPanel(vp2TechUnavailable);
    return;
  }
  renderVp2TechPlan(data);
}

async function getVp2TechPhotoFolder() {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(currentVp2TechToken.toLowerCase()));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function renderVp2TechPhotos(photos) {
  const container = document.getElementById("vp2TechPhotoList");
  if (!container) return;
  container.replaceChildren();
  document.getElementById("vp2TechSavedPhotosSection")?.classList.toggle("hidden", !photos.length);
  for (const photo of photos) {
    const path = typeof photo === "string" ? photo : photo?.path;
    if (!path) continue;
    const { data, error } = await vp2TechClient.storage
      .from(VP2_TECH_PHOTO_BUCKET)
      .createSignedUrl(path, 3600);
    if (error || !data?.signedUrl) continue;
    const figure = document.createElement("figure");
    figure.className = "vp2-tech-photo";
    const image = document.createElement("img");
    image.src = data.signedUrl;
    image.alt = typeof photo === "object" ? photo.name || "Technician work photo" : "Technician work photo";
    const caption = document.createElement("figcaption");
    caption.textContent = typeof photo === "object" ? photo.name || "Work photo" : "Work photo";
    figure.append(image, caption);
    container.appendChild(figure);
  }
}

async function uploadVp2TechPhotos(fileList) {
  const files = Array.from(fileList || []);
  const status = document.getElementById("vp2TechPhotoStatus");
  if (!files.length) return;
  if (vp2TechPhotos.length + files.length > VP2_TECH_MAX_PHOTOS) {
    status.textContent = `You can attach up to ${VP2_TECH_MAX_PHOTOS} photos.`;
    return;
  }
  const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
  for (const file of files) {
    if (!allowedTypes.has(file.type) || file.size > VP2_TECH_MAX_PHOTO_SIZE) {
      status.textContent = "Use JPG, PNG, or WebP images up to 5 MB each.";
      return;
    }
  }

  status.textContent = "Uploading photos...";
  const folder = await getVp2TechPhotoFolder();
  const extensionByType = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
  for (const file of files) {
    const path = `${folder}/${crypto.randomUUID()}.${extensionByType[file.type]}`;
    const { error } = await vp2TechClient.storage
      .from(VP2_TECH_PHOTO_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false, cacheControl: "3600" });
    if (error) {
      status.textContent = "A photo could not be uploaded. Please try again.";
      return;
    }
    vp2TechPhotos.push({ path, name: file.name, type: file.type, size: file.size });
  }
  document.getElementById("vp2TechPhotos").value = "";
  await renderVp2TechPhotos(vp2TechPhotos);
  status.textContent = `${vp2TechPhotos.length} photo${vp2TechPhotos.length === 1 ? "" : "s"} attached.`;
}

document.getElementById("vp2TechPhotos").addEventListener("change", (event) => {
  uploadVp2TechPhotos(event.target.files);
});

vp2TechForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentVp2TechToken || !currentVp2TechPlan || currentVp2TechPlan.completionStatus === "completed") return;

  vp2TechCompleteBtn.disabled = true;
  vp2TechError.classList.add("hidden");
  const { data, error } = await vp2TechClient.rpc("submit_public_vp2_work_order_completion", {
    technician_token: currentVp2TechToken,
    completed_actions: [
      ...vp2TechStandardCheckboxes.map((checkbox) => checkbox.checked),
      ...vp2TechAdditionalCheckboxes.map((checkbox) => checkbox.checked),
    ],
    technician_notes: document.getElementById("vp2TechNotes").value.trim() || null,
    uploaded_photos: vp2TechPhotos,
  });
  if (error || !data) {
    vp2TechError.textContent = "We could not record completion. Check your connection and try again.";
    vp2TechError.classList.remove("hidden");
    vp2TechCompleteBtn.disabled = false;
    return;
  }
  renderVp2TechPlan({
    ...currentVp2TechPlan,
    completionStatus: "completed",
    completionChecklist: [
      ...vp2TechStandardCheckboxes.map((checkbox) => checkbox.checked),
      ...vp2TechAdditionalCheckboxes.map((checkbox) => checkbox.checked),
    ],
    technicianNotes: document.getElementById("vp2TechNotes").value.trim(),
    photographs: vp2TechPhotos,
    completedAt: data.completed_at,
  });
});

loadVp2TechPlan();