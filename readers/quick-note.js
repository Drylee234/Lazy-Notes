// Lazy Notes — the pop-up note box in the readers (PDF, slides, Word).
// A small box that opens where you're reading, takes a note, and goes away:
// no panel needed.
//
// Opens with (each can be switched off in Settings › More options):
//   • Ctrl/⌘+.            when the Notes panel is an edge tab (lnPanelMode "tab")
//   • double-click blank space                         (lnQuickDblClick)
//   • ✎ Note / ❝ Quote in the save pop-up              (lnQuickSelButtons, content.js)
//   • right-click → "Quick note here"                  (lnQuickMenu, bg_context_menus.js)
//   • the floating ✎ button above the Notes tab        (lnQuickFloat, embedded-panel.js)
//
// Two modes:
//   note  — your own words (selected text, if any, is put in to edit);
//           saved as "My note" (typed note) or as any highlight type.
//   quote — the selected text is kept as it is (a highlight with its link
//           back to the page) and what you type becomes its annotation.
//
// Keys: Enter saves, Shift+Enter new line, Tab → type chips (←/→ or the
// number saves as that type, Enter saves), Shift+Tab back, Esc closes.

(() => {
  if (globalThis.LazyNotesQuick) return;

  const TYPES = [
    { cat: "my note",    mark: "✎",   name: "My note",    key: "9" },
    { cat: "header",     mark: "H",   name: "Header",     key: "1" },
    { cat: "sub topic",  mark: "H2",  name: "Sub topic",  key: "2" },
    { cat: "definition", mark: "Def", name: "Definition", key: "3" },
    { cat: "formula",    mark: "ƒx",  name: "Formula",    key: "4" },
    { cat: "list point", mark: "•",   name: "List point", key: "5" },
    { cat: "note",       mark: "!",   name: "Important",  key: "6" },
    { cat: "summary",    mark: "Σ",   name: "Summary",    key: "7" },
    { cat: "generic",    mark: "¶",   name: "Plain",      key: "0" }
  ];
  const UNDO_MS = 6000;

  // Settings (all on unless switched off).
  const SETTING_KEYS = ["lnQuickDblClick", "lnQuickSelButtons", "lnQuickMenu", "lnQuickFloat", "lnPanelMode"];
  const settings = {};
  const on = (k) => settings[k] !== false;
  chrome.storage.local.get(SETTING_KEYS, (r) => Object.assign(settings, r));
  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== "local") return;
    SETTING_KEYS.forEach((k) => { if (k in c) settings[k] = c[k].newValue; });
  });

  // Where the mouse is (the box opens there when nothing else says where).
  let mouse = null;
  addEventListener("mousemove", (e) => { mouse = { x: e.clientX, y: e.clientY }; }, { passive: true });
  let menuPoint = null;
  addEventListener("contextmenu", (e) => { menuPoint = { x: e.clientX, y: e.clientY }; }, true);

  // ── Build ──
  const box = document.createElement("div");
  box.className = "lnq-box";
  box.hidden = true;
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", "Quick note");
  box.innerHTML = `
    <div class="lnq-head"><span class="lnq-title"></span><button type="button" class="lnq-x" title="Close (Esc)" aria-label="Close">✕</button></div>
    <blockquote class="lnq-quote" hidden></blockquote>
    <textarea class="lnq-input" rows="2" spellcheck="true"></textarea>
    <div class="lnq-chips" role="radiogroup" aria-label="Save as"></div>
    <div class="lnq-foot"><span class="lnq-hint"></span><button type="button" class="lnq-save">Save</button></div>
    <div class="lnq-err" hidden></div>`;
  document.body.appendChild(box);
  const $ = (s) => box.querySelector(s);
  const titleEl = $(".lnq-title"), quoteEl = $(".lnq-quote"), input = $(".lnq-input");
  const chipsEl = $(".lnq-chips"), errEl = $(".lnq-err"), saveBtn = $(".lnq-save");

  const chips = {};
  TYPES.forEach((t) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "lnq-chip";
    b.setAttribute("role", "radio");
    b.title = `${t.name} (${t.key})`;
    b.innerHTML = `<span class="lnq-mark"></span><span class="lnq-key"></span>`;
    b.firstChild.textContent = t.mark;
    b.lastChild.textContent = t.key;
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", () => { pick(t.cat); save(); });
    chips[t.cat] = b;
    chipsEl.appendChild(b);
  });

  let state = null;   // { mode, base, quote, cat, course, topic }

  function pick(cat) {
    if (!state) return;
    state.cat = cat;
    Object.entries(chips).forEach(([c, b]) => {
      b.setAttribute("aria-checked", String(c === cat));
      b.tabIndex = c === cat ? 0 : -1;
    });
    const t = TYPES.find((x) => x.cat === cat);
    $(".lnq-hint").textContent = `${t.name} · Enter saves · Tab: type`;
  }

  function grow() {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
    input.style.overflowY = input.scrollHeight > 180 ? "auto" : "hidden";
  }
  input.addEventListener("input", () => { grow(); place(); });

  // Next to the point (below-right), or under/over the selection, always
  // fully on screen and never over the selected words.
  let anchor = null;
  function place() {
    if (box.hidden || !anchor) return;
    const W = box.offsetWidth, H = box.offsetHeight, m = 10;
    let x, y;
    if (anchor.rect) {
      const r = anchor.rect;
      x = Math.min(Math.max(m, r.left), innerWidth - W - m);
      y = r.bottom + 8 + H <= innerHeight - m ? r.bottom + 8 : Math.max(m, r.top - 8 - H);
    } else {
      x = anchor.x + 12; y = anchor.y + 12;
      if (x + W > innerWidth - m) x = Math.max(m, anchor.x - W - 12);
      if (y + H > innerHeight - m) y = Math.max(m, innerHeight - H - m);
    }
    box.style.left = `${Math.round(x)}px`;
    box.style.top = `${Math.round(y)}px`;
  }
  addEventListener("resize", place);

  let returnFocus = null;
  async function open({ mode = "note", text = "", base = null, rect = null, x, y, category } = {}) {
    const { activeCourse, activeTopic } = await chrome.storage.local.get(["activeCourse", "activeTopic"]);
    const quote = mode === "quote" ? String(text).trim() : "";
    state = { mode: quote ? "quote" : "note", base, quote, cat: null, course: activeCourse, topic: activeTopic };
    returnFocus = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;

    titleEl.textContent = (quote ? "❝ Quote + note" : "✎ New note") + (activeTopic ? ` · ${activeCourse} › ${activeTopic}` : "");
    quoteEl.hidden = !quote;
    quoteEl.textContent = quote;
    input.value = quote ? "" : String(text || "").trim();
    input.placeholder = quote ? "Your note about it (optional)…" : "Type a note…";
    chips["my note"].hidden = !!quote;           // a quote is a highlight
    pick(quote ? (category && chips[category] && category !== "my note" ? category : "generic") : "my note");

    const noTopic = !activeCourse || !activeTopic;
    errEl.hidden = !noTopic;
    errEl.textContent = noTopic ? "Pick a course and topic in the Notes panel first." : "";
    saveBtn.disabled = noTopic;

    anchor = rect ? { rect } : { x: x ?? mouse?.x ?? innerWidth / 2 - 160, y: y ?? mouse?.y ?? innerHeight / 3 };
    box.hidden = false;
    grow();
    place();
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

  function close() {
    if (box.hidden) return;
    box.hidden = true;
    state = null;
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    else window.focus();
    returnFocus = null;
  }
  $(".lnq-x").addEventListener("click", close);
  saveBtn.addEventListener("click", () => save());

  function send(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (reply) => resolve(chrome.runtime.lastError ? null : reply));
      } catch (_) { resolve(null); }
    });
  }

  async function save() {
    if (!state) return;
    const typed = input.value.replace(/\s+$/, "").replace(/^\s*\n/, "");
    const { mode, quote, cat, course, topic, base } = state;
    if (!course || !topic) return;
    if (mode === "note" && !typed.trim()) { input.focus(); return; }
    const id = crypto.randomUUID();
    let undo;
    if (mode === "note" && cat === "my note") {
      const reply = await send({ type: "SAVE_TYPED_NOTE", id, courseName: course, topicName: topic, text: typed });
      if (reply && reply.ok === false) { errEl.hidden = false; errEl.textContent = `Couldn't save: ${reply.reason || "unknown error"}`; return; }
      undo = { type: "DELETE_TYPED_NOTE", id, courseName: course, topicName: topic };
    } else {
      chrome.runtime.sendMessage({   // no reply for highlights
        type: "NEW_HIGHLIGHT", id,
        text: mode === "quote" ? quote : typed,
        context: base?.context ?? null,
        category: cat, course, topic,
        annotation: mode === "quote" ? typed : "",
        sourceUrl: base?.sourceUrl ?? null,
        sourceTitle: base?.sourceTitle ?? null,
        anchor: mode === "quote" ? base?.anchor ?? null : null
      });
      undo = { type: "DELETE_HIGHLIGHT", id, courseName: course, topicName: topic };
    }
    const name = TYPES.find((t) => t.cat === cat)?.name || "note";
    close();
    getSelection()?.removeAllRanges();
    toast(`Saved as ${name} to ${topic}`, undo);
  }

  // ── Undo toast ──
  let toastEl = null, toastTimer = null;
  function toast(text, undoMsg) {
    toastEl?.remove();
    clearTimeout(toastTimer);
    const t = document.createElement("div");
    t.className = "lnq-toast";
    t.innerHTML = `<span></span><button type="button">Undo</button>`;
    t.firstChild.textContent = text;
    t.lastChild.addEventListener("click", () => {
      chrome.runtime.sendMessage(undoMsg, () => void chrome.runtime.lastError);
      t.firstChild.textContent = "Removed";
      t.lastChild.remove();
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => t.remove(), 1500);
    });
    document.body.appendChild(t);
    toastEl = t;
    toastTimer = setTimeout(() => t.remove(), UNDO_MS);
  }

  // ── Keys inside the box ──
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); save(); }
    else if (e.key === "Tab" && !e.shiftKey) { e.preventDefault(); chips[state.cat]?.focus(); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
    e.stopPropagation();   // not page turns / reader shortcuts
  });
  chipsEl.addEventListener("keydown", (e) => {
    e.stopPropagation();
    const shown = TYPES.filter((t) => !chips[t.cat].hidden);
    const byKey = shown.find((t) => t.key === e.key);
    if (byKey) { e.preventDefault(); pick(byKey.cat); save(); return; }
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const i = shown.findIndex((t) => t.cat === state.cat);
      const next = shown[(i + (e.key === "ArrowRight" ? 1 : -1) + shown.length) % shown.length];
      pick(next.cat);
      chips[next.cat].focus();
    } else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); save(); }
    else if (e.key === "Tab" && e.shiftKey) { e.preventDefault(); input.focus(); }
    else if (e.key === "Tab") { e.preventDefault(); saveBtn.focus(); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
  });
  box.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    e.stopPropagation();
  });

  // Clicking elsewhere closes it (kept if anything was typed: closing then
  // would lose it — Esc or ✕ still close).
  document.addEventListener("mousedown", (e) => {
    if (box.hidden || box.contains(e.target)) return;
    if (!input.value.trim()) close();
  }, true);

  // ── Ways to open it ──
  const isTyping = (t) => t?.closest?.("input, textarea, select, [contenteditable=''], [contenteditable=true]");
  const outsideDoc = (t) => t?.closest?.("#toolbar, .lazy-notes-popup, .lnq-box, #ln-embed, .ln-edge, #outline, #start-screen, .lnq-toast");

  // Ctrl/⌘+. (edge-tab mode; in docked mode it jumps into the panel instead,
  // see embedded-panel.js). With text selected, it opens as a quote.
  addEventListener("keydown", (e) => {
    if (!((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key === ".")) return;
    if ((settings.lnPanelMode || "tab") !== "tab") return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!box.hidden) { close(); return; }
    if (globalThis.LazyNotesPopupHandOff?.("quote")) return;
    open({ mode: "note" });
  }, true);

  // Double-click on blank space (a double-click on words still selects one).
  // "Blank" = not on a letter: Chrome would otherwise select the nearest
  // word of a line even when you double-click the margin beside it.
  function onLetter(x, y) {
    const r = document.caretRangeFromPoint?.(x, y);
    const n = r?.startContainer;
    if (!n || n.nodeType !== 3 || !n.nodeValue.trim()) return false;
    const c = document.createRange();
    for (const off of [r.startOffset - 1, r.startOffset]) {
      if (off < 0 || off >= n.nodeValue.length) continue;
      c.setStart(n, off); c.setEnd(n, off + 1);
      for (const b of c.getClientRects()) {
        if (x >= b.left - 3 && x <= b.right + 3 && y >= b.top - 2 && y <= b.bottom + 2) return true;
      }
    }
    return false;
  }
  let blankDouble = false;
  document.addEventListener("mousedown", (e) => {
    blankDouble = false;
    if (e.detail !== 2 || e.button !== 0 || !on("lnQuickDblClick")) return;
    if (isTyping(e.target) || outsideDoc(e.target) || !box.hidden) return;
    if (document.body.classList.contains("snipping") || onLetter(e.clientX, e.clientY)) return;
    blankDouble = true;
    e.preventDefault();   // no word selected
  }, true);
  document.addEventListener("dblclick", (e) => {
    if (!blankDouble) return;
    blankDouble = false;
    getSelection()?.removeAllRanges();
    open({ mode: "note", x: e.clientX, y: e.clientY });
  });

  // Right-click → "Quick note here" (the menu item is made by the background).
  let myTabId = null;
  chrome.tabs?.getCurrent?.((t) => { myTabId = t?.id ?? null; });
  chrome.runtime.onMessage.addListener((msg) => {   // not async: never answers
    if (msg?.type !== "LN_QUICK_NOTE_MENU" || msg.tabId !== myTabId || !on("lnQuickMenu")) return;
    if (globalThis.LazyNotesPopupHandOff?.("quote")) return;
    open({ mode: "note", x: menuPoint?.x, y: menuPoint?.y });
  });

  globalThis.LazyNotesQuick = { open, close, enabled: (k) => on(k), isOpen: () => !box.hidden };
})();
