// Researcher settings page — plain JS (copied verbatim into dist/, no build).
// The API key lives ONLY in chrome.storage.local (ff_settings); it must never
// be hardcoded in the bundle or committed to the repo.

const input = document.getElementById("geminiKey");
const saveBtn = document.getElementById("save");
const status = document.getElementById("status");

chrome.storage.local.get("ff_settings", (result) => {
  if (result.ff_settings?.geminiApiKey) {
    input.value = result.ff_settings.geminiApiKey;
  }
});

saveBtn.addEventListener("click", () => {
  const geminiApiKey = input.value.trim();
  chrome.storage.local.get("ff_settings", (result) => {
    const settings = { ...(result.ff_settings ?? {}), geminiApiKey };
    chrome.storage.local.set({ ff_settings: settings }, () => {
      status.textContent = geminiApiKey ? "Saved. Recovery generation is enabled." : "Key cleared. Recovery screen will show placeholder content.";
      setTimeout(() => { status.textContent = ""; }, 4000);
    });
  });
});
