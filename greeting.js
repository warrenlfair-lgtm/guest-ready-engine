const greetingClient = window.supabase.createClient("https://tmfyjzqghxntprexonrg.supabase.co", "sb_publishable_wYrEHjC8nWZgnjhT36fcDw_lp8hWH6c", {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "guest-ready-public-greeting" },
});
let requestVersion = 0;
let currentGreeting = null;
let imageUrl = null;
const saveButton = document.getElementById("save-image");
const imageDownload = document.getElementById("image-download");
function clearSavedImage() {
  if (imageUrl) URL.revokeObjectURL(imageUrl);
  imageUrl = null;
  imageDownload.hidden = true;
  imageDownload.removeAttribute("href");
  document.getElementById("save-help").hidden = true;
  document.getElementById("save-status").textContent = "";
}
async function loadGreeting() {
  const version = ++requestVersion;
  currentGreeting = null;
  clearSavedImage();
  document.getElementById("save-controls").hidden = true;
  const token = new URLSearchParams(location.hash.slice(1)).get("t") || "";
  const status = document.getElementById("status");
  document.getElementById("greeting").hidden = true;
  status.hidden = false;
  status.textContent = "Loading greeting…";
  document.title = "A Greeting from Guest Ready";
  if (!/^[0-9a-f]{64}$/i.test(token)) { status.textContent = "This greeting link is invalid or unavailable."; return; }
  let response;
  try {
    response = await greetingClient.rpc("get_public_communication", { greeting_token: token });
  } catch (error) {
    if (version === requestVersion) status.textContent = "Unable to load the greeting. Please try again later.";
    return;
  }
  if (version !== requestVersion) return;
  const { data, error } = response;
  if (error) { status.textContent = "Unable to load the greeting. Please try again later."; return; }
  if (!data) { status.textContent = "This greeting link is invalid or unavailable."; return; }
  document.getElementById("title").textContent = data.title;
  document.getElementById("salutation").textContent = data.first_name ? `Dear ${data.first_name},` : "";
  document.getElementById("message").textContent = data.message;
  document.getElementById("signature").textContent = data.signature;
  const banner = document.getElementById("banner");
  banner.hidden = !data.banner_url;
  if (data.banner_url) {
    banner.src = data.banner_url;
  } else banner.removeAttribute("src");
  document.title = data.title;
  currentGreeting = data;
  status.hidden = true;
  document.getElementById("greeting").hidden = false;
  document.getElementById("save-controls").hidden = false;
}
saveButton.addEventListener("click", async () => {
  if (!currentGreeting) return;
  const version = requestVersion;
  const data = currentGreeting;
  clearSavedImage();
  saveButton.disabled = true;
  document.getElementById("save-status").textContent = "Creating your greeting image…";
  try {
    const blob = await createGreetingImage(data);
    if (version !== requestVersion) return;
    imageUrl = URL.createObjectURL(blob);
    imageDownload.href = imageUrl;
    imageDownload.hidden = false;
    document.getElementById("save-help").hidden = false;
    document.getElementById("save-status").textContent = "Your greeting image is ready.";
    imageDownload.click();
  } catch (error) {
    if (version === requestVersion) document.getElementById("save-status").textContent = `Unable to save greeting image: ${error.message}`;
  } finally {
    saveButton.disabled = false;
  }
});
loadGreeting();
window.addEventListener("hashchange", loadGreeting);
