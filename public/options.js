// Researcher settings page — plain JS (copied verbatim into dist/, no build).
// The API key lives ONLY in chrome.storage.local (ff_settings); it must never
// be hardcoded in the bundle or committed to the repo.

const input = document.getElementById("geminiKey");
const shortCalibration = document.getElementById("shortCalibration");
const shortWarning = document.getElementById("shortWarning");
const shortDistractions = document.getElementById("shortDistractions");
const shortDistractionsWarning = document.getElementById("shortDistractionsWarning");
const saveBtn = document.getElementById("save");
const status = document.getElementById("status");

function syncWarnings() {
  shortWarning.hidden = !shortCalibration.checked;
  shortDistractionsWarning.hidden = !shortDistractions.checked;
}

chrome.storage.local.get("ff_settings", (result) => {
  if (result.ff_settings?.geminiApiKey) {
    input.value = result.ff_settings.geminiApiKey;
  }
  shortCalibration.checked = !!result.ff_settings?.shortCalibration;
  shortDistractions.checked = !!result.ff_settings?.shortDistractions;
  syncWarnings();
});

shortCalibration.addEventListener("change", syncWarnings);
shortDistractions.addEventListener("change", syncWarnings);

saveBtn.addEventListener("click", () => {
  const geminiApiKey = input.value.trim();
  const isShortCalibration = shortCalibration.checked;
  const isShortDistractions = shortDistractions.checked;
  chrome.storage.local.get("ff_settings", (result) => {
    const settings = {
      ...(result.ff_settings ?? {}),
      geminiApiKey,
      shortCalibration: isShortCalibration,
      shortDistractions: isShortDistractions,
    };
    chrome.storage.local.set({ ff_settings: settings }, () => {
      const parts = [];
      parts.push(geminiApiKey ? "Key saved — recovery generation enabled." : "Key cleared — recovery screen will show its empty state.");
      // Stated on every save, not only when switching one on: leaving either
      // enabled by accident turns a participant's session into test data, so
      // it should never be possible to forget it is on.
      if (isShortCalibration) parts.push("SHORT CALIBRATION IS ON — profiles will be rejected.");
      if (isShortDistractions) parts.push("SHORT DISTRACTION SCHEDULE IS ON — sessions are test runs.");
      status.textContent = parts.join(" ");
      status.style.color = isShortCalibration || isShortDistractions ? "#B45309" : "#0F6E56";
      setTimeout(() => { status.textContent = ""; }, 6000);
    });
  });
});
