// FrictionFlow — memory card matching distraction task (DISTRACTION_SPEC.md).
//
// Kept in its own file, not inline in memory.html: Chrome extension pages run
// under a Content Security Policy of script-src 'self', which blocks inline
// <script> blocks outright. An inline version loads, draws nothing, and logs a
// CSP error — which is exactly how this was first found.

(() => {
  // ── Configuration ─────────────────────────────────────────────────────────
  const params = new URLSearchParams(location.search);
  const SET = (params.get("set") || "A").toUpperCase() === "B" ? "B" : "A";
  const EPISODE = ["1", "2", "3"].includes(params.get("episode")) ? params.get("episode") : "1";
  const EXPOSURE_SECONDS = Math.max(1, Number(params.get("seconds")) || 180);
  const DEBUG = params.get("debug") === "1";

  // Fixed for everyone. A mismatched pair stays visible this long before
  // flipping back — long enough to register both cards, short enough to keep
  // the pace up.
  const FLIP_BACK_MS = 800;
  const NEXT_BOARD_MS = 700;

  // Board sizes, growing as each board is cleared, so a fast player and a slow
  // one both spend the exposure near the edge of their own ability. Past the
  // last size, boards keep that size with fresh layouts.
  const BOARD_SIZES = [
    { cols: 4, rows: 3 },  // 6 pairs
    { cols: 4, rows: 4 },  // 8 pairs
    { cols: 5, rows: 4 },  // 10 pairs
  ];

  // ── Symbols ───────────────────────────────────────────────────────────────
  // Drawn shapes, not emoji: emoji render differently on Windows, macOS and
  // Android, so the same card would be a different picture on a different
  // laptop. And no letters or numbers, so nothing verbal can leak into the
  // essay. Every symbol differs in SHAPE, so colour is never the only cue.
  const SYMBOLS = [
    { name: "circle",   color: "#D55E00", svg: '<circle cx="50" cy="50" r="32"/>' },
    { name: "square",   color: "#0072B2", svg: '<rect x="20" y="20" width="60" height="60" rx="6"/>' },
    { name: "triangle", color: "#009E73", svg: '<polygon points="50,14 88,82 12,82"/>' },
    { name: "diamond",  color: "#CC79A7", svg: '<polygon points="50,10 88,50 50,90 12,50"/>' },
    { name: "star",     color: "#E69F00", svg: '<polygon points="50,8 61,38 92,38 67,57 77,88 50,69 23,88 33,57 8,38 39,38"/>' },
    { name: "hexagon",  color: "#3A8FD1", svg: '<polygon points="50,10 85,30 85,70 50,90 15,70 15,30"/>' },
    { name: "plus",     color: "#7B3F99", svg: '<path d="M39 14h22v25h25v22H61v25H39V61H14V39h25z"/>' },
    { name: "ring",     color: "#1E2233", svg: '<circle cx="50" cy="50" r="28" fill="none" stroke="currentColor" stroke-width="14"/>' },
    { name: "pentagon", color: "#A87900", svg: '<polygon points="50,10 90,40 75,88 25,88 10,40"/>' },
    { name: "chevron",  color: "#B83227", svg: '<path d="M12 32 L50 66 L88 32 L88 54 L50 88 L12 54 Z"/>' },
  ];

  // ── Deterministic layouts ─────────────────────────────────────────────────
  // Layouts are shuffled with a SEEDED generator, never Math.random(). The seed
  // is derived from set + episode + board, so the same board is laid out
  // identically on every machine, every time. Pure integer maths — no
  // floating-point differences between browsers.
  function hashSeed(str) {
    // FNV-1a, 32-bit
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function layoutFor(boardIndex) {
    const size = BOARD_SIZES[Math.min(boardIndex, BOARD_SIZES.length - 1)];
    const pairs = (size.cols * size.rows) / 2;
    const seedLabel = `${SET}-${EPISODE}-${boardIndex}`;
    const rand = mulberry32(hashSeed(seedLabel));
    // Which symbols appear on this board is also seeded, so larger boards are
    // not simply the smaller ones plus extras.
    const pool = SYMBOLS.map((_, i) => i);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const deck = pool.slice(0, pairs).flatMap((s) => [s, s]);
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return { size, seedLabel, deck };
  }

  // ── Log ───────────────────────────────────────────────────────────────────
  // Everything the study needs: exposure, engagement, and overrun. A
  // participant with zero flips was not actually distracted, and the analysis
  // needs to be able to see that.
  const startedAt = Date.now();
  const log = {
    task: "memory-match",
    set: SET,
    episode: EPISODE,
    exposureSeconds: EXPOSURE_SECONDS,
    startedAt: new Date(startedAt).toISOString(),
    timesUpAt: null,
    events: [],
    totals: { flips: 0, matches: 0, mismatches: 0, boardsCleared: 0, flipsAfterTimesUp: 0 },
  };
  window.memoryGameLog = log;

  // Inside the extension, every event is persisted so the export can report
  // engagement and overrun. Keyed by episode so a session's three distractions
  // never overwrite each other. Only this page writes the key, and only one
  // game tab is ever open, so the read-modify-write cannot race.
  const canPersist = typeof chrome !== "undefined" && !!chrome.storage?.local;
  function persist() {
    if (!canPersist) return;
    try {
      chrome.storage.local.get("ff_game_logs", (result) => {
        const all = { ...(result?.ff_game_logs ?? {}) };
        all[EPISODE] = log;
        chrome.storage.local.set({ ff_game_logs: all });
      });
    } catch (e) {
      // The extension was reloaded under this tab; the game still plays.
    }
  }

  function record(type, detail = {}) {
    log.events.push({ tMs: Date.now() - startedAt, type, board: boardIndex + 1, ...detail });
    renderDebug();
    persist();
  }

  // ── Game state ────────────────────────────────────────────────────────────
  const boardEl = document.getElementById("board");
  const boardNoEl = document.getElementById("boardNo");
  const pairsEl = document.getElementById("pairs");
  const timesUpEl = document.getElementById("timesUp");
  const debugEl = document.getElementById("debug");

  let boardIndex = 0;
  let deck = [];
  let cardEls = [];
  let matched = [];
  let first = null;
  let locked = false;
  let timesUp = false;

  function loadBoard(index) {
    boardIndex = index;
    const layout = layoutFor(index);
    deck = layout.deck;
    matched = deck.map(() => false);
    first = null;
    locked = false;

    boardEl.innerHTML = "";
    boardEl.style.gridTemplateColumns = `repeat(${layout.size.cols}, 1fr)`;
    // Keep cards a comfortable size whatever the board dimensions.
    boardEl.style.maxWidth = `${layout.size.cols * 118}px`;

    cardEls = deck.map((symbolIndex, i) => {
      const s = SYMBOLS[symbolIndex];
      const btn = document.createElement("button");
      btn.className = "card";
      btn.type = "button";
      btn.setAttribute("aria-label", "Hidden card");
      btn.innerHTML =
        `<span class="inner">` +
          `<span class="face back"></span>` +
          `<span class="face front"><svg viewBox="0 0 100 100" fill="${s.color}" style="color:${s.color}">${s.svg}</svg></span>` +
        `</span>`;
      btn.addEventListener("click", () => flip(i));
      boardEl.appendChild(btn);
      return btn;
    });

    boardNoEl.textContent = String(index + 1);
    record("board_start", { seed: layout.seedLabel, cards: deck.length });
  }

  function flip(i) {
    if (locked || matched[i] || i === first) return;
    const card = cardEls[i];
    card.classList.add("up");
    card.setAttribute("aria-label", SYMBOLS[deck[i]].name);

    log.totals.flips++;
    if (timesUp) log.totals.flipsAfterTimesUp++;
    record("flip", { card: i, symbol: SYMBOLS[deck[i]].name });

    if (first === null) { first = i; return; }

    const a = first;
    first = null;
    if (deck[a] === deck[i]) {
      matched[a] = matched[i] = true;
      cardEls[a].classList.add("matched");
      cardEls[i].classList.add("matched");
      log.totals.matches++;
      pairsEl.textContent = String(log.totals.matches);
      record("match", { cards: [a, i], symbol: SYMBOLS[deck[i]].name });

      if (matched.every(Boolean)) {
        log.totals.boardsCleared++;
        record("board_cleared");
        // A new board starts straight away. No natural stopping point is the
        // mechanism behind "slipping off".
        locked = true;
        setTimeout(() => loadBoard(boardIndex + 1), NEXT_BOARD_MS);
      }
    } else {
      log.totals.mismatches++;
      record("mismatch", { cards: [a, i] });
      locked = true;
      setTimeout(() => {
        cardEls[a].classList.remove("up");
        cardEls[i].classList.remove("up");
        cardEls[a].setAttribute("aria-label", "Hidden card");
        cardEls[i].setAttribute("aria-label", "Hidden card");
        locked = false;
      }, FLIP_BACK_MS);
    }
  }

  // No countdown is shown: a visible clock invites clock-watching, which is the
  // opposite of getting absorbed.
  setTimeout(() => {
    timesUp = true;
    log.timesUpAt = new Date().toISOString();
    timesUpEl.hidden = false;
    record("times_up");
  }, EXPOSURE_SECONDS * 1000);

  // ── Researcher view ───────────────────────────────────────────────────────
  function renderDebug() {
    if (!DEBUG) return;
    debugEl.hidden = false;
    const t = log.totals;
    const recent = log.events.slice(-10).map((e) =>
      `${(e.tMs / 1000).toFixed(1).padStart(6)}s  board ${e.board}  ${e.type}${e.symbol ? "  " + e.symbol : ""}${e.seed ? "  seed " + e.seed : ""}`
    ).join("\n");
    debugEl.textContent =
      `set ${log.set} · episode ${log.episode} · exposure ${log.exposureSeconds}s · ${timesUp ? "TIME'S UP" : "running"}\n` +
      `flips ${t.flips} · matches ${t.matches} · mismatches ${t.mismatches} · boards cleared ${t.boardsCleared} · flips after time's up ${t.flipsAfterTimesUp}\n\n` +
      recent;
  }

  loadBoard(0);
})();
