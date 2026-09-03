// Researcher settings page — plain JS (copied verbatim into dist/, no build).
// The API key lives ONLY in chrome.storage.local (ff_settings); it must never
// be hardcoded in the bundle or committed to the repo.

const input = document.getElementById("geminiKey");
const shortCalibration = document.getElementById("shortCalibration");
const shortWarning = document.getElementById("shortWarning");
const saveBtn = document.getElementById("save");
const status = document.getElementById("status");

function syncWarning() {
  shortWarning.hidden = !shortCalibration.checked;
}

chrome.storage.local.get("ff_settings", (result) => {
  if (result.ff_settings?.geminiApiKey) {
    input.value = result.ff_settings.geminiApiKey;
  }
  shortCalibration.checked = !!result.ff_settings?.shortCalibration;
  syncWarning();
});

shortCalibration.addEventListener("change", syncWarning);

saveBtn.addEventListener("click", () => {
  const geminiApiKey = input.value.trim();
  const isShort = shortCalibration.checked;
  chrome.storage.local.get("ff_settings", (result) => {
    const settings = { ...(result.ff_settings ?? {}), geminiApiKey, shortCalibration: isShort };
    chrome.storage.local.set({ ff_settings: settings }, () => {
      const parts = [];
      parts.push(geminiApiKey ? "Key saved — recovery generation enabled." : "Key cleared — recovery screen will show its empty state.");
      // Stated on every save, not only when switching it on: leaving this
      // enabled by accident would silently invalidate a participant's
      // calibration, so it should never be possible to forget it is on.
      if (isShort) parts.push("SHORT CALIBRATION IS ON — profiles will be rejected.");
      status.textContent = parts.join(" ");
      status.style.color = isShort ? "#B45309" : "#0F6E56";
      setTimeout(() => { status.textContent = ""; }, 6000);
    });
  });
});
