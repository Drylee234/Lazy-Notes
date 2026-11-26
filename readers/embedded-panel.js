// Lazy Notes — the Notes panel built into our readers (PDF, slides, Word).
// The same sidepanel.html, in an iframe (?embedded=1), so the keyboard stays
// in one page: no clicking between the document and Chrome's own side panel.
//
// Two ways to show it (Settings › More options › Notes panel, lnPanelMode):
//   "tab"    (default) — hidden behind a slim "Notes" tab on the right edge;
//            clicking the tab (or Ctrl+/) slides it out over the page, and
//            clicking back in the document slides it away. The page keeps
//            its full width. Ctrl+. opens the pop-up note box (quick-note.js).
//   "docked" — always beside the document, which makes room for it.
//            Ctrl+. jumps into its note box and back.
//
// Both: "Notes" button in the toolbar opens/closes it; drag its left edge to
// resize (double-click resets); ⧉ pops it out into a window of its own
// (lnPanelWindow in storage.session remembers it, so every reader reuses the
// same window). A floating ✎ above the tab opens the pop-up note box
// (lnQuickFloat). If Chrome's own side panel is open, the docked one steps
// aside (it would be a second copy); the button can still force it open.

(() => {
  const KEY = `ln-embed-${location.pathname.replace(/\W+/g, "")}`;
  const DEFAULT_W = 360, MIN_W = 280;
  let state = { open: true, width: DEFAULT_W };
  try { Object.assign(state, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (_) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) {} };

  let mode = "tab";            // lnPanelMode
  let slidOut = false;         // tab mode: panel showing over the page
  let floatBtnOn = true;       // lnQuickFloat
  let chromePanelOpen = false;
  let forced = false;          // docked: opened by hand while Chrome's panel is open

  // ── Build ──
  const aside = document.createElement("aside");
  aside.id = "ln-embed";
  aside.setAttribute("aria-label", "Lazy Notes");
  const divider = document.createElement("div");
  divider.className = "ln-embed-divider";
  divider.title = "Drag to resize · double-click to reset";
  const bar = document.createElement("div");
  bar.className = "ln-embed-bar";
  bar.innerHTML = `
    <button type="button" class="ln-bar-btn ln-bar-mode"></button>
    <button type="button" class="ln-bar-btn ln-bar-pop" title="Pop out into its own window">⧉ Pop out</button>
    <button type="button" class="ln-bar-btn ln-bar-close" title="Hide (Ctrl+/)" aria-label="Hide">✕</button>`;
  const frame = document.createElement("iframe");
  frame.src = chrome.runtime.getURL("sidepanel.html?embedded=1");
  frame.title = "Lazy Notes";
  frame.setAttribute("allow", "clipboard-read; clipboard-write");
  aside.append(divider, bar, frame);
  document.body.appendChild(aside);

  // The slim tab on the right edge, and the floating ✎ above it.
  const edge = document.createElement("div");
  edge.className = "ln-edge";
  edge.innerHTML = `
    <button type="button" class="ln-edge-pen" title="Quick note (Ctrl+.)" aria-label="Quick note">✎</button>
    <button type="button" class="ln-edge-tab" title="Notes (Ctrl+/)"><span>Notes</span></button>`;
  document.body.appendChild(edge);
  const penBtn = edge.querySelector(".ln-edge-pen"), tabBtn = edge.querySelector(".ln-edge-tab");

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "tb-btn ln-embed-btn";
  btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="1.5" y="2" width="13" height="12" rx="2"/><path d="M10 2v12"/></svg><span>Notes</span>`;
  document.querySelector("#toolbar .tb-right")?.prepend(btn);

  const isMac = /Mac/.test(navigator.platform);
  const key = isMac ? "⌘." : "Ctrl+.";

  // ── Show / hide ──
  function shown() {
    return mode === "tab" ? slidOut : state.open && (!chromePanelOpen || forced);
  }
  function apply({ refit = true } = {}) {
    const on = shown();
    const maxW = Math.max(MIN_W, Math.floor(window.innerWidth / 2));
    state.width = Math.min(Math.max(state.width || DEFAULT_W, MIN_W), maxW);
    document.documentElement.style.setProperty("--ln-embed-w", `${state.width}px`);
    // Room for the page's own scrollbar, so the tab never covers it.
    document.documentElement.style.setProperty("--ln-sb-w", `${Math.max(0, window.innerWidth - document.documentElement.clientWidth)}px`);
    const wasDocked = document.body.classList.contains("ln-embed-open");
    document.body.classList.toggle("ln-embed-open", mode === "docked" && on);
    document.body.classList.toggle("ln-embed-float", mode === "tab");
    aside.hidden = !on;
    edge.hidden = mode !== "tab" || on;
    penBtn.hidden = !floatBtnOn;
    btn.setAttribute("aria-pressed", String(on));
    btn.classList.toggle("on", on);
    btn.title = (mode === "docked" && chromePanelOpen && !forced
      ? "Chrome's side panel is open, so the built-in one is hidden. Click to show it here too."
      : on ? "Hide notes" : "Show notes") + " (Ctrl+/)" + (mode === "docked" ? ` · ${key}: jump to the note box and back` : ` · ${key}: quick note`);
    const modeBtn = bar.querySelector(".ln-bar-mode");
    modeBtn.textContent = mode === "tab" ? "📌 Dock" : "⇥ Edge tab";
    modeBtn.title = mode === "tab" ? "Keep it beside the document" : "Hide it behind a tab on the edge";
    // The PDF reader refits on resize; the others reflow by themselves.
    if (refit && wasDocked !== document.body.classList.contains("ln-embed-open")) window.dispatchEvent(new Event("resize"));
  }

  function togglePanel() {
    if (mode === "tab") slidOut = !slidOut;
    else if (chromePanelOpen && !forced) { forced = true; state.open = true; }
    else { state.open = !shown(); if (!state.open) forced = false; }
    save();
    apply();
    if (!shown()) { frame.blur(); window.focus(); }
  }
  btn.addEventListener("click", togglePanel);
  tabBtn.addEventListener("click", togglePanel);
  penBtn.addEventListener("click", () => globalThis.LazyNotesQuick?.open({ mode: "note" }));
  bar.querySelector(".ln-bar-close").addEventListener("click", () => { if (shown()) togglePanel(); });
  bar.querySelector(".ln-bar-mode").addEventListener("click", () => {
    const next = mode === "tab" ? "docked" : "tab";
    state.open = true;
    slidOut = false;
    chrome.storage.local.set({ lnPanelMode: next });   // the listener below applies it
  });
  bar.querySelector(".ln-bar-pop").addEventListener("click", popOut);

  // Ctrl/⌘+/ shows or hides the panel (also from inside it).
  addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key === "/") { e.preventDefault(); togglePanel(); }
  }, true);
  addEventListener("message", (e) => {
    if (e.origin === location.origin && e.source === frame.contentWindow && e.data?.type === "ln-toggle-panel") togglePanel();
  });

  // Tab mode: clicking back in the document slides the panel away.
  document.addEventListener("mousedown", (e) => {
    if (mode !== "tab" || !slidOut) return;
    if (aside.contains(e.target) || edge.contains(e.target) || btn.contains(e.target)) return;
    if (e.target.closest?.(".lnq-box, .lazy-notes-popup")) return;
    slidOut = false;
    apply();
  }, true);

  // ── Pop out into a window of its own ──
  async function popOut() {
    const W = Math.max(MIN_W, state.width || DEFAULT_W);
    try {
      const { lnPanelWindow } = await chrome.storage.session.get("lnPanelWindow");
      if (lnPanelWindow) {
        const win = await chrome.windows.get(lnPanelWindow).catch(() => null);
        if (win) { await chrome.windows.update(lnPanelWindow, { focused: true }); hideAfterPop(); return; }
      }
      // On the right of this Chrome window, as tall as it; if Chrome won't
      // put it there (off screen), wherever Chrome likes.
      const url = chrome.runtime.getURL("sidepanel.html?window=1");
      const cur = await chrome.windows.getCurrent().catch(() => null);
      let win = null;
      if (cur?.width) {
        win = await chrome.windows.create({
          url, type: "popup", width: W, height: cur.height,
          left: cur.left + Math.max(0, cur.width - W), top: cur.top
        }).catch(() => null);
      }
      if (!win) win = await chrome.windows.create({ url, type: "popup", width: W, height: Math.min(screen.availHeight, 900) });
      await chrome.storage.session.set({ lnPanelWindow: win.id });
      hideAfterPop();
    } catch (err) {
      console.warn("Lazy Notes: couldn't open the notes window", err);
    }
  }
  function hideAfterPop() {
    if (mode === "tab") slidOut = false; else state.open = false;
    save();
    apply();
  }

  // ── Resize ──
  divider.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    divider.setPointerCapture(e.pointerId);
    document.body.classList.add("ln-embed-resizing");
    const move = (ev) => {
      state.width = Math.min(Math.max(window.innerWidth - ev.clientX, MIN_W), Math.floor(window.innerWidth / 2));
      document.documentElement.style.setProperty("--ln-embed-w", `${state.width}px`);
    };
    const up = () => {
      divider.removeEventListener("pointermove", move);
      divider.removeEventListener("pointerup", up);
      document.body.classList.remove("ln-embed-resizing");
      save();
      apply();
      if (mode === "docked") window.dispatchEvent(new Event("resize"));
    };
    divider.addEventListener("pointermove", move);
    divider.addEventListener("pointerup", up);
  });
  divider.addEventListener("dblclick", () => {
    state.width = DEFAULT_W; save(); apply();
    if (mode === "docked") window.dispatchEvent(new Event("resize"));
  });

  // ── Keyboard across the boundary (docked mode: Ctrl+.) ──
  function focusPanel() {
    if (!shown()) { state.open = true; if (chromePanelOpen) forced = true; save(); apply(); }
    frame.focus();
    frame.contentWindow?.postMessage({ type: "ln-focus-composer" }, location.origin);
  }
  function focusDocument() {
    frame.blur();
    window.focus();
    if (mode === "tab" && slidOut) { slidOut = false; apply(); }
    const sel = getSelection();
    // Keep the PDF caret/selection; otherwise just give the page focus.
    if (!sel || !sel.rangeCount) document.querySelector("#viewer")?.focus?.();
  }
  addEventListener("keydown", (e) => {
    if (mode !== "docked") return;   // tab mode: quick-note.js opens the pop-up note box
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key === ".") {
      e.preventDefault();
      focusPanel();
    }
  }, true);
  addEventListener("message", (e) => {
    if (e.origin !== location.origin || e.source !== frame.contentWindow) return;
    if (e.data?.type === "ln-panel-done") focusDocument();
  });

  // ── Chrome's own side panel open? The docked one steps aside. ──
  async function checkChromePanel() {
    if (!chrome.runtime.getContexts) return;
    try {
      const ctx = await chrome.runtime.getContexts({ contextTypes: ["SIDE_PANEL"] });
      const open = ctx.length > 0;
      if (open !== chromePanelOpen) {
        chromePanelOpen = open;
        if (!open) forced = false;
        apply();
      }
    } catch (_) {}
  }
  checkChromePanel();
  setInterval(checkChromePanel, 4000);
  addEventListener("focus", checkChromePanel);

  let resizeT = null;
  addEventListener("resize", () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => {
      const maxW = Math.floor(window.innerWidth / 2);
      if (state.width > maxW && maxW >= MIN_W) state.width = maxW;
      apply({ refit: false });
    }, 200);
  });

  // A toolbar too narrow for one row puts its middle controls on a second
  // row (see embedded-panel.css), so nothing overlaps.
  const toolbar = document.getElementById("toolbar");
  if (toolbar && window.ResizeObserver) {
    const need = () => [...toolbar.children].reduce((w, c) => w + c.scrollWidth, 0) + 48;
    new ResizeObserver(() => {
      const narrow = toolbar.clientWidth < need();
      if (narrow !== document.body.classList.contains("ln-tb-narrow")) {
        document.body.classList.toggle("ln-tb-narrow", narrow);
        document.documentElement.style.setProperty("--toolbar-h", `${toolbar.offsetHeight}px`);
      }
    }).observe(toolbar);
  }

  // ── Settings ──
  chrome.storage.local.get(["lnPanelMode", "lnQuickFloat"], (r) => {
    mode = r.lnPanelMode === "docked" ? "docked" : "tab";
    floatBtnOn = r.lnQuickFloat !== false;
    apply();
  });
  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== "local") return;
    if ("lnPanelMode" in c) { mode = c.lnPanelMode.newValue === "docked" ? "docked" : "tab"; slidOut = false; apply(); }
    if ("lnQuickFloat" in c) { floatBtnOn = c.lnQuickFloat.newValue !== false; apply({ refit: false }); }
  });

  apply({ refit: false });
})();
