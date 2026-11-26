// Lazy Notes — the side panel built into our readers (PDF, slides, Word).
// The same sidepanel.html, in an iframe on the right (?embedded=1), so the
// keyboard stays in one page: no clicking between the document and Chrome's
// own side panel.
//
// • "Notes" button in the toolbar opens/closes it (remembered per reader).
// • Drag the divider to resize (280px … half the window); double-click resets.
// • Ctrl/⌘+. : open it and jump into the note box; pressed again in the
//   panel (or Esc in an empty note box) comes back to the document.
// • If Chrome's own side panel is open, this one steps aside (it would be a
//   second copy); the button can still force it open.

(() => {
  const KEY = `ln-embed-${location.pathname.replace(/\W+/g, "")}`;
  const DEFAULT_W = 360, MIN_W = 280;
  let state = { open: true, width: DEFAULT_W };
  try { Object.assign(state, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (_) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) {} };

  let chromePanelOpen = false;
  let forced = false;          // opened by hand while Chrome's panel is open

  // ── Build ──
  const aside = document.createElement("aside");
  aside.id = "ln-embed";
  aside.setAttribute("aria-label", "Lazy Notes");
  const divider = document.createElement("div");
  divider.className = "ln-embed-divider";
  divider.title = "Drag to resize · double-click to reset";
  const frame = document.createElement("iframe");
  frame.src = chrome.runtime.getURL("sidepanel.html?embedded=1");
  frame.title = "Lazy Notes";
  frame.setAttribute("allow", "clipboard-read; clipboard-write");
  aside.append(divider, frame);
  document.body.appendChild(aside);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "tb-btn ln-embed-btn";
  btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="1.5" y="2" width="13" height="12" rx="2"/><path d="M10 2v12"/></svg><span>Notes</span>`;
  const right = document.querySelector("#toolbar .tb-right");
  right?.prepend(btn);

  const isMac = /Mac/.test(navigator.platform);
  const key = isMac ? "⌘." : "Ctrl+.";

  // ── Show / hide ──
  function shown() { return state.open && (!chromePanelOpen || forced); }
  function apply({ refit = true } = {}) {
    const on = shown();
    const maxW = Math.max(MIN_W, Math.floor(window.innerWidth / 2));
    state.width = Math.min(Math.max(state.width || DEFAULT_W, MIN_W), maxW);
    document.documentElement.style.setProperty("--ln-embed-w", `${state.width}px`);
    document.body.classList.toggle("ln-embed-open", on);
    aside.hidden = !on;
    btn.setAttribute("aria-pressed", String(on));
    btn.classList.toggle("on", on);
    btn.title = (chromePanelOpen && !forced
      ? "Chrome's side panel is open, so the built-in one is hidden. Click to show it here too."
      : on ? "Hide notes" : "Show notes") + ` (${key}: jump to the note box and back · Ctrl+/ show/hide)`;
    // The PDF reader refits on resize; the others reflow by themselves.
    if (refit) window.dispatchEvent(new Event("resize"));
  }

  function togglePanel() {
    if (chromePanelOpen && !forced) { forced = true; state.open = true; }
    else { state.open = !shown(); if (!state.open) forced = false; }
    save();
    apply();
    if (!shown()) { frame.blur(); window.focus(); }
  }
  btn.addEventListener("click", togglePanel);
  // Ctrl/⌘+/ shows or hides the panel (also from inside it).
  addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key === "/") { e.preventDefault(); togglePanel(); }
  }, true);
  addEventListener("message", (e) => {
    if (e.origin === location.origin && e.source === frame.contentWindow && e.data?.type === "ln-toggle-panel") togglePanel();
  });

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
    };
    divider.addEventListener("pointermove", move);
    divider.addEventListener("pointerup", up);
  });
  divider.addEventListener("dblclick", () => { state.width = DEFAULT_W; save(); apply(); });

  // ── Keyboard across the boundary ──
  function focusPanel() {
    if (!shown()) { state.open = true; if (chromePanelOpen) forced = true; save(); apply(); }
    frame.focus();
    frame.contentWindow?.postMessage({ type: "ln-focus-composer" }, location.origin);
  }
  function focusDocument() {
    frame.blur();
    window.focus();
    const sel = getSelection();
    // Keep the PDF caret/selection; otherwise just give the page focus.
    if (!sel || !sel.rangeCount) document.querySelector("#viewer")?.focus?.();
  }
  addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key === ".") {
      e.preventDefault();
      focusPanel();
    }
  }, true);
  addEventListener("message", (e) => {
    if (e.origin !== location.origin || e.source !== frame.contentWindow) return;
    if (e.data?.type === "ln-panel-done") focusDocument();
  });

  // ── Chrome's own side panel open? Step aside. ──
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
      if (state.width > maxW && maxW >= MIN_W) { state.width = maxW; apply({ refit: false }); }
    }, 200);
  });

  // A toolbar too narrow for one row puts its middle controls on a second
  // row (see embedded-panel.css), so nothing overlaps.
  const toolbar = document.getElementById("toolbar");
  if (toolbar && window.ResizeObserver) {
    const center = toolbar.querySelector(".tb-center");
    const need = () => [...toolbar.children].reduce((w, c) => w + c.scrollWidth, 0) + 48;
    new ResizeObserver(() => {
      const narrow = toolbar.clientWidth < need();
      if (narrow !== document.body.classList.contains("ln-tb-narrow")) {
        document.body.classList.toggle("ln-tb-narrow", narrow);
        document.documentElement.style.setProperty("--toolbar-h", `${toolbar.offsetHeight}px`);
      }
    }).observe(toolbar);
    void center;
  }

  apply({ refit: false });
})();
