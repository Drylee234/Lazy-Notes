// Lazy Notes — the Notes panel built into our readers (PDF, slides, Word).
// The same sidepanel.html, in an iframe (?embedded=1), so the keyboard stays
// in one page: no clicking between the document and Chrome's own side panel.
//
// Three ways to show it (Settings › More options › Notes panel, lnPanelMode):
//   "float"  (default) — a box over the page you drag by its title bar,
//            resize from its corner, fold to just the title bar (− / +);
//            it remembers where it was. Ctrl+. jumps into its note box, so
//            what you type is right where you're reading.
//   "tab"    — hidden behind a slim "Notes" tab on the right edge;
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

  let mode = "float";          // lnPanelMode: "float" | "tab" | "docked"
  const modeOf = (v) => (v === "docked" || v === "tab" ? v : "float");
  let slidOut = false;         // tab mode: panel showing over the page
  let floatBtnOn = true;       // lnQuickFloat
  let chromePanelOpen = false;
  let forced = false;          // docked: opened by hand while Chrome's panel is open

  // ── Build ──
  const aside = document.createElement("aside");
  aside.id = "ln-embed";
  aside.setAttribute("aria-label", chrome.runtime.getManifest().name);
  const divider = document.createElement("div");
  divider.className = "ln-embed-divider";
  divider.title = "Drag to resize · double-click to reset";
  const bar = document.createElement("div");
  bar.className = "ln-embed-bar";
  bar.innerHTML = `
    <span class="ln-bar-title" title="Drag to move"></span>
    <button type="button" class="ln-bar-btn ln-bar-help" title="How to use (shortcuts)" aria-label="How to use">?</button>
    <button type="button" class="ln-bar-btn ln-bar-fold" title="Fold to this bar" aria-label="Fold">−</button>
    <button type="button" class="ln-bar-btn ln-bar-mode" data-to=""></button>
    <button type="button" class="ln-bar-btn ln-bar-mode2" data-to=""></button>
    <button type="button" class="ln-bar-btn ln-bar-pop" title="Pop out into its own window">⧉</button>
    <button type="button" class="ln-bar-btn ln-bar-close" title="Hide (Ctrl+/)" aria-label="Hide">✕</button>`;
  const frame = document.createElement("iframe");
  frame.src = chrome.runtime.getURL("sidepanel.html?embedded=1");
  frame.title = chrome.runtime.getManifest().name;
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
  // All notes, one click from the reader (no panel needed).
  const allBtn = document.createElement("a");
  allBtn.className = "tb-btn ln-allnotes-btn";
  allBtn.href = chrome.runtime.getURL("courses.html");
  allBtn.target = "_blank";
  allBtn.rel = "noopener";
  allBtn.title = "Browse, search and edit all your notes (opens in a new tab)";
  allBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M3 3.5h10M3 8h10M3 12.5h6"/></svg><span>All notes</span>`;
  allBtn.style.cssText = "text-decoration:none;display:inline-flex;align-items:center;gap:6px;";
  btn.before(allBtn);
  // The status pill ("Saving to …") used to open Chrome's side panel; it now
  // shows ours (unless Chrome's panel is kept in readers on purpose).
  // "Highlighter off" with a topic picked: the click switches it on (that's
  // what you meant); with no topic, it shows the panel to pick one.
  chrome.storage.local.get("lnReaderNativePanel", (r) => {
    const native = r?.lnReaderNativePanel === true;
    document.getElementById("hl-status")?.addEventListener("click", async (e) => {
      const { highlighterActive, activeCourse, activeTopic } = await chrome.storage.local.get(["highlighterActive", "activeCourse", "activeTopic"]);
      if (!highlighterActive && activeCourse && activeTopic) {
        chrome.runtime.sendMessage({ type: "TOGGLE_HIGHLIGHTER_REQUEST" }).catch(() => {});
        return;
      }
      if (!native && !shown()) togglePanel();
    }, true);
    if (!native) document.getElementById("hl-status")?.addEventListener("click", (e) => e.stopImmediatePropagation(), true);
  });

  const isMac = /Mac/.test(navigator.platform);
  const key = isMac ? "⌘." : "Ctrl+.";

  // ── Show / hide ──
  function shown() {
    if (mode === "float") return state.floatOpen !== false;
    return mode === "tab" ? slidOut : state.open && (!chromePanelOpen || forced);
  }
  // Floating box: where it is, how big, folded or not (kept in state).
  function placeFloat() {
    const W = innerWidth, H = innerHeight;
    const w = Math.min(Math.max(state.fw || 340, MIN_W), W - 16);
    const h = Math.min(Math.max(state.fh || Math.round(H * 0.62), 160), H - 16);
    const x = Math.min(Math.max(state.fx ?? W - w - 24, 8), W - 80);
    const y = Math.min(Math.max(state.fy ?? 64, 8), H - 40);
    Object.assign(aside.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: state.folded ? "" : `${h}px` });
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
    document.body.classList.toggle("ln-embed-floating", mode === "float");
    aside.classList.toggle("ln-floating", mode === "float");
    aside.classList.toggle("ln-folded", mode === "float" && !!state.folded);
    if (mode === "float") placeFloat();
    else Object.assign(aside.style, { left: "", top: "", width: "", height: "" });
    const fold = bar.querySelector(".ln-bar-fold");
    fold.hidden = mode !== "float";
    fold.textContent = state.folded ? "+" : "−";
    fold.title = state.folded ? "Open it again" : "Fold to this bar";
    aside.hidden = !on;
    edge.hidden = mode === "docked" || on;
    penBtn.hidden = !floatBtnOn;
    btn.setAttribute("aria-pressed", String(on));
    btn.classList.toggle("on", on);
    btn.title = (mode === "docked" && chromePanelOpen && !forced
      ? "Chrome's side panel is open, so the built-in one is hidden. Click to show it here too."
      : on ? "Hide notes" : "Show notes") + " (Ctrl+/)" + (mode !== "tab" ? ` · ${key}: jump to the note box and back` : ` · ${key}: quick note`);
    // The two other ways to show it.
    const LABEL = { float: ["🗗 Float", "A box you can drag anywhere"], tab: ["⇥ Edge tab", "Hide it behind a tab on the edge"],
                    docked: ["📌 Dock", "Keep it beside the document"] };
    const others = ["float", "tab", "docked"].filter((m) => m !== mode);
    [bar.querySelector(".ln-bar-mode"), bar.querySelector(".ln-bar-mode2")].forEach((b, i) => {
      b.dataset.to = others[i];
      b.textContent = LABEL[others[i]][0];
      b.title = LABEL[others[i]][1];
    });
    // The PDF reader refits on resize; the others reflow by themselves.
    if (refit && wasDocked !== document.body.classList.contains("ln-embed-open")) window.dispatchEvent(new Event("resize"));
  }

  function togglePanel() {
    if (mode === "float") state.floatOpen = !shown();
    else if (mode === "tab") slidOut = !slidOut;
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
  bar.querySelectorAll(".ln-bar-mode, .ln-bar-mode2").forEach((b) => b.addEventListener("click", () => {
    state.open = true;
    state.floatOpen = true;
    slidOut = b.dataset.to === "tab";
    save();
    chrome.storage.local.set({ lnPanelMode: b.dataset.to });   // the listener below applies it
  }));
  bar.querySelector(".ln-bar-fold").addEventListener("click", () => { state.folded = !state.folded; save(); apply({ refit: false }); });

  // Floating: drag by the title bar (not its buttons); kept on screen.
  bar.addEventListener("pointerdown", (e) => {
    if (mode !== "float" || e.button !== 0 || e.target.closest("button")) return;
    e.preventDefault();
    bar.setPointerCapture(e.pointerId);
    const r = aside.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    document.body.classList.add("ln-embed-resizing", "ln-embed-moving");
    const move = (ev) => {
      state.fx = Math.min(Math.max(ev.clientX - dx, 8 - r.width + 80), innerWidth - 80);
      state.fy = Math.min(Math.max(ev.clientY - dy, 0), innerHeight - 32);
      aside.style.left = `${state.fx}px`;
      aside.style.top = `${state.fy}px`;
    };
    const up = () => {
      bar.removeEventListener("pointermove", move);
      bar.removeEventListener("pointerup", up);
      document.body.classList.remove("ln-embed-resizing", "ln-embed-moving");
      save();
    };
    bar.addEventListener("pointermove", move);
    bar.addEventListener("pointerup", up);
  });
  // Resize from any edge or corner (thin handles around the box; they sit
  // above the page inside it, so nothing is covered by the iframe).
  ["n", "s", "e", "w", "ne", "nw", "se", "sw"].forEach((d) => {
    const h = document.createElement("div");
    h.className = `ln-rz ln-rz-${d}`;
    aside.appendChild(h);
    h.addEventListener("pointerdown", (e) => {
      if (mode !== "float" || e.button !== 0 || state.folded) return;
      e.preventDefault();
      h.setPointerCapture(e.pointerId);
      const r = aside.getBoundingClientRect();
      const sx = e.clientX, sy = e.clientY;
      document.body.classList.add("ln-embed-resizing", "ln-embed-moving");
      document.body.style.cursor = getComputedStyle(h).cursor;
      const move = (ev) => {
        let l = r.left, t = r.top, w = r.width, ht = r.height;
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (d.includes("e")) w = Math.min(Math.max(r.width + dx, MIN_W), innerWidth - r.left - 4);
        if (d.includes("s")) ht = Math.min(Math.max(r.height + dy, 160), innerHeight - r.top - 4);
        if (d.includes("w")) { w = Math.min(Math.max(r.width - dx, MIN_W), r.right - 4); l = r.right - w; }
        if (d.includes("n")) { ht = Math.min(Math.max(r.height - dy, 160), r.bottom - 4); t = r.bottom - ht; }
        Object.assign(aside.style, { left: `${l}px`, top: `${t}px`, width: `${w}px`, height: `${ht}px` });
        state.fx = Math.round(l); state.fy = Math.round(t); state.fw = Math.round(w); state.fh = Math.round(ht);
      };
      const up = () => {
        h.removeEventListener("pointermove", move);
        h.removeEventListener("pointerup", up);
        h.removeEventListener("pointercancel", up);
        document.body.classList.remove("ln-embed-resizing", "ln-embed-moving");
        document.body.style.cursor = "";
        save();
      };
      h.addEventListener("pointermove", move);
      h.addEventListener("pointerup", up);
      h.addEventListener("pointercancel", up);
    });
  });
  bar.addEventListener("dblclick", (e) => { if (mode === "float" && !e.target.closest("button")) bar.querySelector(".ln-bar-fold").click(); });
  // Resized from its corner (CSS resize): remember the size.
  if (window.ResizeObserver) {
    let rt = 0;
    new ResizeObserver(() => {
      if (mode !== "float" || state.folded || aside.hidden) return;
      cancelAnimationFrame(rt);
      rt = requestAnimationFrame(() => {
        const r = aside.getBoundingClientRect();
        if (r.width && r.height) { state.fw = Math.round(r.width); state.fh = Math.round(r.height); save(); }
      });
    }).observe(aside);
  }
  // "?" — every shortcut, over the page (Esc or a click outside closes it).
  function showHowto() {
    if (document.getElementById("ln-howto")) return;
    const w = document.createElement("div");
    w.id = "ln-howto";
    w.innerHTML = `<div class="ln-howto-card" role="dialog" aria-label="How to use"><button type="button" class="ln-howto-x" aria-label="Close">✕</button><h2>How to use ${chrome.runtime.getManifest().name}</h2>${window.lnHowtoHtml?.() || ""}<p><a href="${chrome.runtime.getURL("howto.html")}" target="_blank" rel="noopener">Open as a page</a></p></div>`;
    const close = () => { w.remove(); removeEventListener("keydown", onKey, true); };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    addEventListener("keydown", onKey, true);
    w.addEventListener("mousedown", (e) => { if (e.target === w) close(); });
    w.querySelector(".ln-howto-x").addEventListener("click", close);
    document.body.appendChild(w);
  }
  bar.querySelector(".ln-bar-help").addEventListener("click", showHowto);
  addEventListener("keydown", (e) => {
    if (e.key === "?" && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && !e.target.isContentEditable && !e.ctrlKey && !e.metaKey) showHowto();
  });
  const viewSwitch = lnViewSwitch(bar.querySelector(".ln-bar-title"),
    (view) => frame.contentWindow?.postMessage({ type: "ln-set-view", view }, location.origin));
  bar.querySelector(".ln-bar-pop").addEventListener("click", popOut);

  // Ctrl/⌘+/ shows or hides the panel (also from inside it).
  addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key === "/") { e.preventDefault(); togglePanel(); }
  }, true);
  addEventListener("message", (e) => {
    if (e.origin !== location.origin || e.source !== frame.contentWindow) return;
    if (e.data?.type === "ln-toggle-panel") togglePanel();
    if (e.data?.type === "ln-view") viewSwitch.update(e.data);   // the title names the view (Study / AI / Home)
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
    const W = Math.round(Math.max(MIN_W, state.width || DEFAULT_W));   // Chrome wants whole numbers
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
          url, type: "popup", width: W, height: Math.round(cur.height),
          left: Math.round(cur.left + Math.max(0, cur.width - W)), top: Math.round(cur.top)
        }).catch(() => null);
      }
      if (!win) win = await chrome.windows.create({ url, type: "popup", width: W, height: Math.round(Math.min(screen.availHeight, 900)) });
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
    if (mode === "float") { state.floatOpen = true; state.folded = false; save(); apply({ refit: false }); }
    else if (!shown()) { state.open = true; if (chromePanelOpen) forced = true; save(); apply(); }
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
  // lnQuickWhenFolded (off unless switched on): while the floating panel is
  // folded or hidden, Ctrl+. opens the pop-up note box instead.
  let quickWhenFolded = false;
  chrome.storage.local.get("lnQuickWhenFolded", (r) => { quickWhenFolded = r?.lnQuickWhenFolded === true; });
  chrome.storage.onChanged.addListener((c, a) => { if (a === "local" && "lnQuickWhenFolded" in c) quickWhenFolded = c.lnQuickWhenFolded.newValue === true; });
  globalThis.LazyNotesPanelIdle = () => quickWhenFolded && mode === "float" && (state.folded || state.floatOpen === false);
  addEventListener("keydown", (e) => {
    if (mode === "tab") return;   // tab mode: quick-note.js opens the pop-up note box
    if (globalThis.LazyNotesPanelIdle()) return;   // folded/hidden + setting: quick-note.js does it
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
      if (open) chrome.storage.local.get("lnReaderNativePanel", (r) => { if (r?.lnReaderNativePanel !== true) ready(); });   // shut it for this tab
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
      apply({ refit: false });   // (also keeps the floating box on screen)
    }, 200);
  });

  // A toolbar too narrow for one row puts its middle controls on a second
  // row (see embedded-panel.css), so nothing overlaps.
  const toolbar = document.getElementById("toolbar");
  if (toolbar && window.ResizeObserver) {
    const need = () => [...toolbar.children].reduce((w, c) => w + c.scrollWidth, 0) + 48;
    // Changed on the next frame, not inside the callback: changing the
    // toolbar's layout while it's being observed makes Chrome log
    // "ResizeObserver loop completed with undelivered notifications".
    let raf = 0;
    new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const narrow = toolbar.clientWidth < need();
        if (narrow !== document.body.classList.contains("ln-tb-narrow")) {
          document.body.classList.toggle("ln-tb-narrow", narrow);
          document.documentElement.style.setProperty("--toolbar-h", `${toolbar.offsetHeight}px`);
        }
      });
    }).observe(toolbar);
  }

  // Hover to open (lnPanelHover): resting on the edge tab shows the panel,
  // resting on a folded floating bar unfolds it; moving away puts it back
  // (unless you've clicked into it to type).
  let hoverOn = true, hoverAuto = null, hoverT = 0, openMs = 300, closeMs = 700;   // lnPanelHoverMs / lnPanelHoverCloseMs
  const rest = (fn, ms) => { clearTimeout(hoverT); hoverT = setTimeout(fn, ms); };
  tabBtn.addEventListener("pointerenter", () => {
    if (!hoverOn || shown()) return;
    rest(() => { if (shown()) return; hoverAuto = "show"; togglePanel(); }, openMs);
  });
  const awayCheck = () => rest(() => {
    if (!hoverAuto || aside.matches(":hover") || tabBtn.matches(":hover") || document.activeElement === frame || document.body.classList.contains("ln-embed-moving")) return;
    if (hoverAuto === "fold") { state.folded = true; apply({ refit: false }); }
    else if (shown()) togglePanel();
    hoverAuto = null;
  }, closeMs);
  tabBtn.addEventListener("pointerleave", () => { if (hoverAuto) awayCheck(); else clearTimeout(hoverT); });
  aside.addEventListener("pointerenter", () => {
    clearTimeout(hoverT);
    if (hoverOn && mode === "float" && state.folded) rest(() => { hoverAuto = "fold"; state.folded = false; apply({ refit: false }); }, openMs);
  });
  aside.addEventListener("pointerleave", () => { if (hoverAuto) awayCheck(); else clearTimeout(hoverT); });
  // Any deliberate use (a click into it, the buttons) keeps it open.
  aside.addEventListener("pointerdown", () => { hoverAuto = null; }, true);
  const num = (v, d) => (Number.isFinite(Number(v)) && v !== undefined && v !== null ? Number(v) : d);
  chrome.storage.local.get(["lnPanelHover", "lnPanelHoverMs", "lnPanelHoverCloseMs"], (r) => {
    hoverOn = r?.lnPanelHover !== false; openMs = num(r?.lnPanelHoverMs, 300); closeMs = num(r?.lnPanelHoverCloseMs, 700);
  });
  chrome.storage.onChanged.addListener((c, a) => {
    if (a !== "local") return;
    if ("lnPanelHover" in c) hoverOn = c.lnPanelHover.newValue !== false;
    if ("lnPanelHoverMs" in c) openMs = num(c.lnPanelHoverMs.newValue, 300);
    if ("lnPanelHoverCloseMs" in c) closeMs = num(c.lnPanelHoverCloseMs.newValue, 700);
  });

  // Tell the background a reader is open: it switches Chrome's own side panel off here.
  const ready = () => chrome.runtime.sendMessage({ type: "READER_READY" }, () => void chrome.runtime.lastError);
  ready();
  addEventListener("focus", ready);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) ready(); });

  // The toolbar button (background) toggles this panel in readers.
  chrome.runtime.onMessage.addListener((m) => { if (m?.type === "LN_TOGGLE_PANEL") togglePanel(); });

  // Readers open full screen (once per tab; F11 leaves it). lnReaderFullscreen = false: off.
  chrome.storage.local.get("lnReaderFullscreen", (r) => {
    if (r?.lnReaderFullscreen === false) return;
    try { if (sessionStorage.getItem("ln-fs-done")) return; sessionStorage.setItem("ln-fs-done", "1"); } catch (_) {}
    chrome.runtime.sendMessage({ type: "READER_FULLSCREEN" }, () => void chrome.runtime.lastError);
  });

  // ── Settings ──
  chrome.storage.local.get(["lnPanelMode", "lnQuickFloat", "lnPanelFade"], (r) => {
    aside.classList.toggle("ln-fade", r.lnPanelFade !== false);
    mode = modeOf(r.lnPanelMode);
    floatBtnOn = r.lnQuickFloat !== false;
    apply();
  });
  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== "local") return;
    if ("lnPanelMode" in c) { const next = modeOf(c.lnPanelMode.newValue); if (next !== "tab") slidOut = false; mode = next; apply(); }
    if ("lnPanelFade" in c) aside.classList.toggle("ln-fade", c.lnPanelFade.newValue !== false);
    if ("lnQuickFloat" in c) { floatBtnOn = c.lnQuickFloat.newValue !== false; apply({ refit: false }); }
  });

  apply({ refit: false });
})();
