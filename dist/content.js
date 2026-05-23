const LOGGING_ENABLED = false;

let lastKeyTime = Date.now();
let lastActivityTime = Date.now();

console.log("FrictionFlow behavioral logging active");

document.addEventListener("keydown", (e) => {
  const now = Date.now();
  const pause = now - lastKeyTime;

  console.log("FrictionFlow Log:", {
    type: "keystroke",
    key: e.key,
    pause
  });

  lastKeyTime = now;
  lastActivityTime = now;
});

window.addEventListener("scroll", () => {
  console.log("FrictionFlow Log:", {
    type: "scroll"
  });

  lastActivityTime = Date.now();
});

document.addEventListener("visibilitychange", () => {
  console.log("FrictionFlow Log:", {
    type: document.hidden ? "tab_switch" : "tab_return"
  });
});

setInterval(() => {
  const idle = Date.now() - lastActivityTime;

  if (idle > 10000) {
    console.log("FrictionFlow Log:", {
      type: "idle",
      duration: idle
    });
  }
}, 5000);