// Lazy Notes — the Study tab as a written page you can type in.
//
// sidepanel.js draws the course/topic pickers and calls StudyPage.render()
// with the open topic, or StudyPage.clear() when there is none. This file
// owns the rest of the tab:
//   - the page: topic title, counts, then highlights and typed notes in the
//     order they were taken
//   - the composer docked at the bottom (Enter saves, Shift+Enter = new line)
//   - editing and deleting typed notes
//   - drag and drop: text dropped on the page is saved like a highlight taken
//     on a website; text dropped where you're typing becomes a quote; a
//     highlight dragged from the page into your typing asks: quote or move?
//
// Typed notes are saved by the background (SAVE_TYPED_NOTE /
// DELETE_TYPED_NOTE); dropped highlights go through NEW_HIGHLIGHT, like
// ones saved from the in-page popup. Plain script, loaded before
// sidepanel.js; needs utils.js and notes-render.js.

const StudyPage = (() => {
  // Drag data of a highlight dragged from this page.
  const HIGHLIGHT_TYPE = "application/x-lazy-notes-highlight";

  // Same choices, and the same "keep the context" rule, as the in-page popup.
  const TYPES = PICK_TYPES;
  const CONTEXT_TYPES = ["definition", "formula", "summary"];

  // content.js notes where dragged text came from ("lastDrag"); older than
  // this, it can't be the drag that just landed.
  const LAST_DRAG_MAX_AGE = 10 * 60 * 1000;

  const $ = (id) => document.getElementById(id);

  const scroller     = $("body");   // the panel's scrolling area
  const studyView    = $("study-view");
  const pageHead     = $("page-head");
  const pageTitle    = $("page-title");
  const pageSubtitle = $("page-subtitle");
  const noteList     = $("note-list");
  const emptyStudy   = $("empty-study");

  const composer       = $("composer");
  // The note box shows formatting as you type (rich-box.js); it still
  // reads and writes plain text, so everything else is unchanged.
  const composerInput  = (() => {
    const old = $("composer-input");
    const box = createRichBox({ placeholder: old.placeholder });
    box.id = old.id;
    box.setAttribute("aria-label", old.getAttribute("aria-label"));
    old.replaceWith(box);
    const bar = createFormatBar(box);
    bar.id = "composer-bar";
    box.closest("form").prepend(bar);

    // What you're writing: your own note (formatted), or one of the
    // highlight types (Definition, Formula, …), saved like a highlight.
    const type = document.createElement("select");
    type.id = "composer-type";
    type.title = "Save as";
    type.setAttribute("aria-label", "Save as");
    type.add(new Option("Note", ""));
    PICK_TYPES
      .forEach((t) => type.add(new Option(CATEGORY_LABELS[t] || t, t)));
    type.addEventListener("mousedown", (e) => e.stopPropagation());
    bar.appendChild(type);
    return box;
  })();
  const composerType = $("composer-type");
  // Tab order: picker → notes → note box → (once there's text) Save as.
  // The bar's buttons and the send button are mouse/shortcut only.
  document.querySelectorAll("#composer-bar .fb-btn, #composer-save").forEach((b) => { b.tabIndex = -1; });
  const syncTypeTab = () => { composerType.tabIndex = composerInput.value.trim() ? 0 : -1; };
  composerInput.addEventListener("input", syncTypeTab);
  composerInput.addEventListener("focus", syncTypeTab);
  syncTypeTab();
  // Numbers pick the type here too (same keys as the save pop-up): 1 Header,
  // 2 Sub topic, 3 Definition, 4 Formula, 5 List point, 6 Important,
  // 7 Summary, 8 List head, T Table, 9 or 0 Note (0 = Plain when "Plain in
  // note boxes" is on). Enter then saves.
  const TYPE_KEYS = { "1": "header", "2": "sub topic", "3": "definition", "4": "formula",
                      "5": "list point", "6": "note", "7": "summary", "8": "list head", "t": "table", "T": "table", "0": "generic", "9": "" };
  // Like the save pop-up: Tab here shows the types as numbered chips; a
  // number saves as that type at once, ←/→ move, Enter saves, Shift+Tab or
  // Esc goes back to writing. Clicking a chip saves too.
  // "Note" (your own words, formatted) is the note box's plain choice;
  // Plain (a highlight-style line) is offered here only when Settings ›
  // More options › "Plain in note boxes" is on (lnPlainInBoxes).
  let plainInBoxes = false;
  const CHIP_ORDER = ["", "header", "sub topic", "definition", "formula", "list point", "note", "summary", "list head", "table", "generic"];
  const chipOrder = () => CHIP_ORDER.filter((t) => t !== "generic" || plainInBoxes);
  const CHIP_LOOK = { "": ["✎", "9", "Note"], "header": ["H", "1"], "sub topic": ["H2", "2"], "definition": ["Def", "3"],
    "formula": ["ƒx", "4"], "list point": ["•", "5"], "note": ["!", "6"], "summary": ["Σ", "7"], "list head": ["≡", "8"], "table": ["▦", "T"], "generic": ["¶", "0"] };
  const chipRow = document.createElement("div");
  chipRow.id = "composer-chips";
  chipRow.setAttribute("role", "radiogroup");
  chipRow.setAttribute("aria-label", "Save as");
  chipRow.hidden = true;
  const chipFor = {};
  CHIP_ORDER.forEach((t) => {
    const [mark, key, name] = CHIP_LOOK[t];
    const b = document.createElement("button");
    b.type = "button";
    b.className = "type-chip";
    b.tabIndex = -1;
    b.setAttribute("role", "radio");
    b.title = `${name || CATEGORY_LABELS[t] || t} (${key})`;
    b.innerHTML = `<span></span><span class="type-chip-key"></span>`;
    b.firstChild.textContent = mark;
    b.lastChild.textContent = key;
    b.addEventListener("mousedown", (e) => e.preventDefault());   // keep focus on the picker
    b.addEventListener("click", () => saveAsType(t));
    chipFor[t] = b;
    chipRow.appendChild(b);
  });
  const chipCaption = document.createElement("div");
  chipCaption.className = "chip-caption composer-chip-caption";
  chipRow.appendChild(chipCaption);
  composer.prepend(chipRow);
  function showPlain(on) {
    plainInBoxes = on === true;
    chipFor.generic.hidden = !plainInBoxes;
    const opt = [...composerType.options].find((o) => o.value === "generic");
    if (opt) opt.hidden = !plainInBoxes;
    if (!plainInBoxes && composerType.value === "generic") composerType.value = "";
    chipFor[""].lastChild.textContent = plainInBoxes ? "9" : "9·0";
  }
  chrome.storage.local.get("lnPlainInBoxes", (r) => showPlain(r?.lnPlainInBoxes));
  chrome.storage.onChanged.addListener((c, area) => { if (area === "local" && c.lnPlainInBoxes) showPlain(c.lnPlainInBoxes.newValue); });
  const markChip = () => {
    const v = composerType.value;
    Object.entries(chipFor).forEach(([t, b]) => b.setAttribute("aria-checked", String(t === v)));
    chipCaption.textContent = `${CHIP_LOOK[v]?.[2] || CATEGORY_LABELS[v] || v} · number saves as it · Enter saves · Shift+Tab back`;
  };
  async function saveAsType(t) {
    composerType.value = t;
    markChip();
    await submitComposer();
    composerInput.focus();
  }
  composerType.addEventListener("focus", () => { markChip(); chipRow.hidden = false; });
  composerType.addEventListener("blur", () => { chipRow.hidden = true; });
  composerType.addEventListener("change", markChip);
  composerType.addEventListener("keydown", async (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key in TYPE_KEYS) {
      e.preventDefault();
      await saveAsType(e.key === "0" && !plainInBoxes ? "" : TYPE_KEYS[e.key]);
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft" || e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const order = chipOrder();
      const i = order.indexOf(composerType.value);
      const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
      composerType.value = order[(i + step + order.length) % order.length];
      markChip();
    } else if (e.key === "Enter") {
      e.preventDefault();
      await submitComposer();
      composerInput.focus();
    } else if ((e.key === "Tab" && e.shiftKey) || e.key === "Escape") {
      e.preventDefault();
      composerInput.focus();
    }
  });
  const composerSave   = $("composer-save");
  const composerError  = $("composer-error");

  const card           = $("drop-card");
  const cardTopic      = $("drop-card-topic");
  const cardText       = $("drop-card-text");
  const cardSource     = $("drop-card-source");
  const cardTypes      = $("drop-card-types");
  const cardAnnotation = $("drop-card-annotation");

  const choice         = $("drop-choice");
  const choiceText     = $("drop-choice-text");

  let target        = null;    // { courseName, topicName } on the page, or null
  let requestRender = () => {};
  let editing       = null;    // { id, el, input, hint, where } while a typed note is open
  let hlEditing     = null;    // { id } while a highlight's editor is open
  let renderSkipped = false;   // a redraw waited for an edit to close
  let scrollToId    = null;    // just saved: bring it into view on the next draw
  let shown         = [];      // the notes as drawn, in order: [{ kind, id, order, indent, ... }]
  let focusAfterDraw = null;   // keep focus on a note moved/indented with the keyboard

  // ---------------------------------------------------------------------------
  // Page
  // ---------------------------------------------------------------------------

  function init({ onRequestRender }) {
    requestRender = onRequestRender;
    setComposerEnabled(false);
  }

  function entriesOf(dict, kind) {
    return Object.entries(dict || {}).map(([id, fields]) => ({ id, kind, ...fields }));
  }

  function counts(topic) {
    return {
      highlights: Object.keys(topic?.highlights || {}).length,
      notes:      Object.keys(topic?.notes || {}).length
    };
  }

  function plural(n, word) {
    return `${n} ${word}${n === 1 ? "" : "s"}`;
  }

  let drawnIds = null;
  function render({ courseName, topicName, topic }) {
    const sameTopic = target?.courseName === courseName && target?.topicName === topicName;
    if (editing && !sameTopic) closeEditor({ redraw: false });
    if (hlEditing && !sameTopic) closeHighlightEditor({ redraw: false });
    if (boxEditing && !sameTopic) stopBoxEdit();

    // Notes that appeared since the last draw of this topic (saved from a
    // page/reader): the list scrolls down to the newest.
    const idsNow = new Set([...Object.keys(topic?.highlights || {}), ...Object.keys(topic?.notes || {})]);
    const addedIds = sameTopic && drawnIds ? [...idsNow].filter((i) => !drawnIds.has(i)) : [];

    target = { courseName, topicName };
    setComposerEnabled(true);

    // Don't wipe a note that's being edited; draw again when it closes.
    if (editing || hlEditing) {
      renderSkipped = true;
      return;
    }

    drawnIds = idsNow;
    const { highlights, notes } = counts(topic);
    pageTitle.textContent = topicName;
    pageSubtitle.textContent =
      `${courseName} · ${plural(highlights, "highlight")} · ${plural(notes, "note")}`;
    pageHead.hidden = false;

    const entries = sortHighlights(
      [...entriesOf(topic.highlights, "highlight"), ...entriesOf(topic.notes, "typed")],
      "chronological"
    );

    // Keep keyboard focus on the same note across a redraw (a move or indent
    // can redraw more than once).
    const hadFocus = noteList.contains(document.activeElement) ? document.activeElement.closest(".note")?.dataset.id : null;
    noteList.innerHTML = "";
    shown = entries;
    entries.forEach((entry) => {
      const el = entry.kind === "typed" ? typedNoteEl(entry) : highlightEl(entry);
      arrangeable(el, entry);
      noteList.appendChild(el);
    });
    LnFold.apply(noteList, entries);   // ▾ / ▸ on headers, sub topics, list heads
    rovingAfterRender();
    const refocus = focusAfterDraw || hadFocus;
    if (refocus) {
      // The focused note may be gone (deleted from the keyboard): go to the
      // one that took its place.
      const target = noteList.querySelector(`.note[data-id="${CSS.escape(refocus)}"]`)
        || (activeNoteId && noteList.querySelector(`.note[data-id="${CSS.escape(activeNoteId)}"]`));
      target?.focus({ preventScroll: true });
    }
    if (focusAfterDraw && noteList.querySelector(`.note[data-id="${CSS.escape(focusAfterDraw)}"]`)) {
      noteList.querySelector(`.note[data-id="${CSS.escape(focusAfterDraw)}"]`).scrollIntoView({ block: "nearest" });
    }
    clearTimeout(render.focusTimer);
    render.focusTimer = setTimeout(() => { focusAfterDraw = null; }, 800);

    emptyStudy.textContent = "Nothing here yet. Type a note below, or drag text here from a page.";
    emptyStudy.style.display = entries.length ? "none" : "block";

    if (addedIds.length && !scrollToId) {
      const newest = [...noteList.querySelectorAll(".note[data-id]")].reverse().find((n) => addedIds.includes(n.dataset.id));
      newest?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    if (scrollToId) {
      noteList.querySelector(`[data-id="${CSS.escape(scrollToId)}"]`)
        ?.scrollIntoView({ block: "nearest" });
      scrollToId = null;
    }
  }

  // No topic open (no course picked, or a course without topics).
  function clear() {
    closeEditor({ redraw: false });
    closeHighlightEditor({ redraw: false });
    closeCard();
    closeChoice();
    target = null;
    pageHead.hidden = true;
    noteList.innerHTML = "";
    setComposerEnabled(false);
  }

  function highlightEl(note) {
    const el = renderNote(note, { compact: true, page: true });
    el.draggable = true;
    el.classList.toggle("note--moving", movingIds.has(note.id));

    const where = { ...target };
    el.addEventListener("dragstart", (e) => {
      if (e.target.closest?.(".note-tools")) { e.preventDefault(); return; }   // the ⋮⋮ handle reorders instead
      e.dataTransfer.setData(HIGHLIGHT_TYPE, JSON.stringify({ id: note.id, text: note.text, ...where }));
      e.dataTransfer.setData("text/plain", note.text);
      e.dataTransfer.effectAllowed = "copyMove";
      el.classList.add("dragging");
    });
    el.addEventListener("dragend", () => el.classList.remove("dragging"));

    // Click to edit (only the text shows at first), × to delete.
    el.appendChild(deleteButton(note, where, "highlight"));
    el.title = "Click to edit";
    const edit = () => openHighlightEditor(el, note, where);
    // One click edits; a double-click quotes it into the note box instead
    // (so the single click waits a moment to see if a second one comes).
    let clickTimer = null;
    el.addEventListener("click", (e) => {
      if (e.target.closest("button, a, .note-tools")) return;
      if (e.shiftKey) { e.preventDefault(); getSelection()?.removeAllRanges(); togglePick(note.id); return; }
      if (e.detail > 1) return;
      clearTimeout(clickTimer);
      clickTimer = setTimeout(edit, 230);
    });
    el.addEventListener("dblclick", (e) => {
      if (e.target.closest("button, a, .note-tools")) return;
      clearTimeout(clickTimer);
      getSelection()?.removeAllRanges();
      const box = editing?.input || composerInput;
      if (box.disabled) return;
      box.insertQuoteAt(null, note.text);
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target === el) {
        e.preventDefault();
        edit();
      }
    });
    return el;
  }

  function typedNoteEl(note) {
    const el = renderTypedNote(note);
    const where = { ...target };
    el.appendChild(deleteButton(note, where));
    el.title = "Click to edit";

    const edit = () => openEditor(el, note, where);
    el.addEventListener("click", (e) => {
      if (e.target.closest("button, a, textarea, .rich-box, .format-bar, .note-tools")) return;
      if (e.shiftKey && !editing) { e.preventDefault(); getSelection()?.removeAllRanges(); togglePick(note.id); return; }
      edit();
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target === el) {
        e.preventDefault();
        edit();
      }
    });
    return el;
  }

  // ---------------------------------------------------------------------------
  // Arranging: drag ⋮⋮ to reorder, ⇤ ⇥ (or Tab / Shift+Tab) to indent,
  // Alt+↑ / Alt+↓ to move. Stored as "order" / "indent" on each note
  // (bg_arrange.js); untouched notes keep their time order (noteOrder).
  // ---------------------------------------------------------------------------

  const NEST_PX = 18;
  const kindOf = (n) => (n.kind === "typed" ? "typed" : "highlight");

  function arrangeable(el, note) {
    const nest = Math.max(0, Math.min(3, note.indent || 0));
    if (nest) {
      el.dataset.nest = String(nest);
      el.style.setProperty("--nest-px", `${nest * NEST_PX}px`);
    }
    const tools = document.createElement("span");
    tools.className = "note-tools";
    const handle = document.createElement("span");
    handle.className = "note-handle";
    handle.textContent = "⋮⋮";
    handle.title = "Drag to move (or Alt+↑ / Alt+↓)";
    handle.setAttribute("aria-hidden", "true");
    const btn = (label, title, delta) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "note-indent";
      b.textContent = label;
      b.title = title;
      b.setAttribute("aria-label", title);
      b.addEventListener("click", (e) => { e.stopPropagation(); indentBy(note, delta); });
      return b;
    };
    tools.append(handle, btn("⇤", "Outdent (Shift+Tab)", -1), btn("⇥", "Indent (Tab)", 1));
    el.prepend(tools);
    handle.addEventListener("mousedown", (e) => e.preventDefault());   // no native drag / text selection
    handle.addEventListener("pointerdown", (e) => startReorder(e, el, note));
  }

  function send2(items, done) {
    if (!target) return;
    chrome.runtime.sendMessage({ type: "SET_ARRANGEMENT", ...target, items }, (reply) => {
      if (chrome.runtime.lastError || !reply?.ok) showError(`Couldn't arrange: ${reply?.reason || chrome.runtime.lastError?.message || "unknown error"}`);
      else done?.();
    });
  }

  // Indent by ±1 (0-3), with the notes under it (a list head takes its
  // points, a note takes what's nested under it), and every picked note
  // (Shift+↑/↓ or Shift+click) together. alone: just that note (Alt+Shift+
  // arrow, or Settings › Old ways › lnIndentAlone). Undo puts it all back.
  let indentAlone = false;
  chrome.storage.local.get("lnIndentAlone", (r) => { indentAlone = r?.lnIndentAlone === true; });
  chrome.storage.onChanged.addListener((c, a) => { if (a === "local" && "lnIndentAlone" in c) indentAlone = c.lnIndentAlone.newValue === true; });
  const habit = (name) => { try { chrome.runtime.sendMessage({ type: "HABIT", name }); } catch (_) {} };
  function indentBy(note, delta, { alone = false } = {}) {
    const many = picked.has(String(note.id)) && picked.size > 1;
    const lead = many ? shown.filter((n) => picked.has(String(n.id))) : [note];
    const plan = indentPlan(shown, lead, delta, alone || indentAlone);
    if (!plan.items.length) {
      if (plan.stuck && delta > 0) showError("Can't indent further: notes go 3 levels deep at most.");
      return;
    }
    focusAfterDraw = note.id;
    const extra = plan.items.length - lead.length;
    const what = (delta > 0 ? "Indented" : "Outdented") + (many ? ` ${lead.length} notes` : "") + (extra > 0 ? ` (+${extra} under ${many ? "them" : "it"})` : "");
    send2(plan.items, () => arrangeToast(what, plan.undo));
  }

  // Picked notes (Shift+↑/↓, Shift+click): indent / outdent them together.
  const picked = new Set();
  function drawPicked() {
    noteList.querySelectorAll(".note[data-id]").forEach((n) => n.classList.toggle("picked", picked.has(n.dataset.id)));
  }
  function clearPicked() { if (!picked.size) return; picked.clear(); drawPicked(); }
  function togglePick(id) {
    id = String(id);
    if (picked.has(id)) picked.delete(id); else picked.add(id);
    drawPicked();
  }

  // Put `note` at index `to` of the list without it. Order = between its new
  // neighbours; if they're too close to split, the whole topic is renumbered
  // (in the same single write). Undo restores every order changed.
  function moveTo(note, to) {
    const rest = shown.filter((n) => n !== note);
    to = Math.max(0, Math.min(rest.length, to));
    const was = shown.indexOf(note);
    if (to === was) return;
    const prev = rest[to - 1], next = rest[to];
    const o = (n) => noteOrder(n);
    let items;
    let order = prev && next ? (o(prev) + o(next)) / 2 : prev ? o(prev) + 1000 : o(next) - 1000;
    const before = shown.map((n) => ({ kind: kindOf(n), id: n.id, order: o(n) }));
    if (prev && next && (o(next) - o(prev) < 0.01 || order === o(prev) || order === o(next))) {
      const list = [...rest.slice(0, to), note, ...rest.slice(to)];
      const base = o(list[0]);
      items = list.map((n, i) => ({ kind: kindOf(n), id: n.id, order: base + i * 1000 }));
    } else {
      items = [{ kind: kindOf(note), id: note.id, order }];
    }
    const undo = before.filter((b) => items.some((i) => i.id === b.id && i.kind === b.kind));
    focusAfterDraw = note.id;
    send2(items, () => arrangeToast("Moved", undo));
  }

  // ── Dragging by the handle: an insertion line follows the mouse; the
  //    panel scrolls near its edges; Esc or dropping in place cancels. ──
  let drag = null;
  function startReorder(e, el, note) {
    if (e.button !== 0 || editing || hlEditing) return;
    e.preventDefault();
    if (LnFold.isFolded(note.id)) LnFold.set(noteList, shown, note.id, false);   // nothing moves unseen
    const line = document.createElement("div");
    line.className = "reorder-line";
    noteList.appendChild(line);
    drag = { el, note, line, index: shown.indexOf(note), y: e.clientY, raf: null };
    el.classList.add("reordering");
    document.body.classList.add("is-reordering");
    e.target.setPointerCapture?.(e.pointerId);
    const move = (ev) => { drag.y = ev.clientY; placeLine(); };
    const up = () => finish(true);
    const key = (ev) => { if (ev.key === "Escape") { ev.preventDefault(); finish(false); } };
    const finish = (commit) => {
      if (!drag) return;
      cancelAnimationFrame(drag.raf);
      const to = drag.index;
      el.classList.remove("reordering");
      document.body.classList.remove("is-reordering");
      line.remove();
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("keydown", key, true);
      drag = null;
      if (commit && to != null) moveTo(note, to);
    };
    document.addEventListener("pointermove", move, true);
    document.addEventListener("pointerup", up, true);
    document.addEventListener("keydown", key, true);
    const tick = () => {                       // auto-scroll near the edges
      if (!drag) return;
      const r = scroller.getBoundingClientRect();
      const edge = 48;
      const dy = drag.y < r.top + edge ? -Math.ceil((r.top + edge - drag.y) / 4)
               : drag.y > r.bottom - edge ? Math.ceil((drag.y - (r.bottom - edge)) / 4) : 0;
      if (dy) { scroller.scrollTop += dy; placeLine(); }
      drag.raf = requestAnimationFrame(tick);
    };
    drag.raf = requestAnimationFrame(tick);
    placeLine();
  }

  // Index among the other notes where the dragged one would land, and the
  // line drawn there (between two notes).
  function placeLine() {
    if (!drag) return;
    const others = [...noteList.querySelectorAll(":scope > .note")].filter((n) => n !== drag.el);
    let to = others.length;
    for (let i = 0; i < others.length; i++) {
      const r = others[i].getBoundingClientRect();
      if (drag.y < r.top + r.height / 2) { to = i; break; }
    }
    drag.index = to;
    const listTop = noteList.getBoundingClientRect().top;
    const ref = others[to];
    const y = ref ? ref.getBoundingClientRect().top - 2
                  : (others.at(-1)?.getBoundingClientRect().bottom ?? listTop) + 1;
    drag.line.style.top = `${y - listTop + noteList.scrollTop}px`;
    const same = shown.indexOf(drag.note) === to;   // dropping here changes nothing
    drag.line.classList.toggle("same", same);
  }

  // Keyboard on the notes (one Tab stop for the whole list; Tab moves on to
  // the note box): ↑/↓ go between notes, Home/End to the ends, Enter or
  // Space edits, Delete asks then deletes (press again), Alt+↑/↓ moves a
  // note, Alt+→/← indents / outdents it.
  let activeNoteId = null;
  function noteEls() { return [...noteList.querySelectorAll(":scope > .note, :scope .note[data-id]")].filter((n, i, a) => a.indexOf(n) === i && !n.classList.contains("note--folded-away")); }
  function setActiveNote(el, { focus = true } = {}) {
    if (!el) return;
    noteEls().forEach((n) => { n.tabIndex = n === el ? 0 : -1; });
    activeNoteId = el.dataset.id;
    if (focus) { el.focus(); el.scrollIntoView({ block: "nearest" }); }
  }
  // After every redraw: keep a single Tab stop, on the last active note.
  function rovingAfterRender() {
    const els = noteEls();
    if (!els.length) return;
    const keep = els.find((n) => n.dataset.id === activeNoteId) || els[0];
    els.forEach((n) => { n.tabIndex = n === keep ? 0 : -1; });
    // The small buttons and links inside notes have keys of their own
    // (Delete, Alt+arrows, Enter), so Tab skips them.
    noteList.querySelectorAll(".note button, .note a").forEach((b) => { b.tabIndex = -1; });
    markBoxEdit();
    // Picked notes stay picked across a redraw (an indent redraws the list).
    [...picked].forEach((id) => { if (!els.some((n) => n.dataset.id === id)) picked.delete(id); });
    drawPicked();
  }
  // The ⋮⋮ ⇤ ⇥ card shows only while the mouse is in a note's left margin
  // (where it sits), so it never covers the words you're reading.
  let toolsNear = null;
  noteList.addEventListener("mousemove", (e) => {
    const el = e.target.closest?.(".note[data-id]");
    const near = el && !document.body.classList.contains("is-reordering") &&
      (e.clientX - el.getBoundingClientRect().left < (document.documentElement.classList.contains("ln-tools-small") ? 34 : 42) || e.target.closest(".note-tools")) ? el : null;
    if (near === toolsNear) return;
    toolsNear?.classList.remove("tools-near");
    near?.classList.add("tools-near");
    toolsNear = near;
  });
  noteList.addEventListener("mouseleave", () => { toolsNear?.classList.remove("tools-near"); toolsNear = null; });
  // Settings › "Arrange buttons": Big (default) or Small (lnToolsSize).
  const setToolsSize = (v) => document.documentElement.classList.toggle("ln-tools-small", v === "small");
  chrome.storage.local.get("lnToolsSize", (r) => setToolsSize(r?.lnToolsSize));
  chrome.storage.onChanged.addListener((c, area) => { if (area === "local" && c.lnToolsSize) setToolsSize(c.lnToolsSize.newValue); });

  // Hovering a note lights up the guides of everything nested under it.
  let guided = [];
  const clearGuides = () => { guided.forEach((n) => n.classList.remove("guide-on")); guided = []; };
  noteList.addEventListener("mouseover", (e) => {
    const el = e.target.closest?.(".note[data-id]");
    clearGuides();
    if (!el) return;
    const mine = new Set([el.dataset.id]);
    // Notes come in order, so owned notes follow their owner.
    noteList.querySelectorAll(".note[data-parent]").forEach((n) => {
      if (mine.has(n.dataset.parent)) { mine.add(n.dataset.id); if (n.dataset.nest) { n.classList.add("guide-on"); guided.push(n); } }
    });
  });
  noteList.addEventListener("mouseleave", clearGuides);

  noteList.addEventListener("focusin", (e) => {
    const el = e.target.closest?.(".note[data-id]");
    if (el && e.target === el) setActiveNote(el, { focus: false });
  });

  // Ctrl/⌘+↑ from the note box: to the last note (then Enter edits it, ↑/↓
  // walk the notes). Ctrl/⌘+↓ on a note: back to the note box.
  composerInput.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key === "ArrowUp") {
      const els = noteEls();
      if (!els.length) return;
      e.preventDefault();
      e.stopPropagation();
      habit("key-ctrl-up");
      const last = shown[shown.length - 1];
      if (!editInList && !boxEditing && !composerInput.value.trim() && last?.kind === "typed" && !editing && !hlEditing) {
        startBoxEdit(last);
        return;
      }
      stopBoxEdit();
      setActiveNote(els[els.length - 1]);
    }
  }, true);
  noteList.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key === "ArrowDown" && e.target.classList?.contains("note") && !editing && !hlEditing) {
      e.preventDefault();
      composerInput.focus();
    }
  });
  noteList.addEventListener("keydown", (e) => {
    const el = e.target;
    if (!el.classList?.contains("note") || editing || hlEditing) return;
    const note = shown.find((n) => String(n.id) === el.dataset.id);
    const els = noteEls();
    const i = els.indexOf(el);
    if (!e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight") && el.classList.contains("note--head")) {
      // ← folds what's under a header / sub topic / list head, → shows it.
      e.preventDefault();
      focusAfterDraw = el.dataset.id;
      LnFold.set(noteList, shown, el.dataset.id, e.key === "ArrowLeft");
      el.focus();
    } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      if (!note) return;
      e.preventDefault();
      // Moving a folded head: unfold it first, so nothing moves unseen.
      if (LnFold.isFolded(note.id)) LnFold.set(noteList, shown, note.id, false);
      moveTo(note, shown.indexOf(note) + (e.key === "ArrowUp" ? -1 : 1));
    } else if (e.altKey && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
      if (!note) return;
      e.preventDefault();
      habit("key-alt-indent");
      indentBy(note, e.key === "ArrowRight" ? 1 : -1, { alone: e.shiftKey });
    } else if (!e.altKey && !e.ctrlKey && !e.metaKey && e.shiftKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      // Shift+↑/↓: pick this note and the next, to indent them together.
      e.preventDefault();
      const to = els[Math.max(0, Math.min(els.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
      if (!picked.size) habit("pick-notes");
      picked.add(el.dataset.id);
      if (to) { if (picked.has(to.dataset.id) && to !== el) picked.delete(el.dataset.id); else picked.add(to.dataset.id); }
      drawPicked();
      setActiveNote(to);
    } else if (!e.altKey && !e.ctrlKey && !e.metaKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      clearPicked();
      setActiveNote(els[Math.max(0, Math.min(els.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]);
    } else if (e.key === "Escape" && picked.size) {
      e.preventDefault();
      clearPicked();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setActiveNote(e.key === "Home" ? els[0] : els[els.length - 1]);
    } else if (e.key === " ") {
      e.preventDefault();
      el.click();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      const next = els[i + 1] || els[i - 1];
      if (next) activeNoteId = next.dataset.id;
      el.querySelector(".typed-delete")?.click();   // first press: "Delete?", second: deletes
    }
  });

  // "Moved · Undo" for a few seconds; Undo puts the old values back.
  let toastTimer = null;
  function arrangeToast(what, undoItems) {
    let t = document.getElementById("arrange-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "arrange-toast";
      t.setAttribute("role", "status");
      document.getElementById("study-dock").prepend(t);
    }
    t.replaceChildren(document.createTextNode(what));
    const u = document.createElement("button");
    u.type = "button";
    u.textContent = "Undo";
    u.addEventListener("click", () => { t.hidden = true; habit("undo-arrange"); send2(undoItems); });
    t.append(" · ", u);
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 5000);
  }

  // "×", then "Delete?" for 4s, so a stray click can't lose a note. kind is
  // "typed" (your own writing) or "highlight".
  function deleteButton(note, where, kind = "typed") {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "typed-delete";
    btn.textContent = "×";
    btn.title = "Delete this note";
    btn.setAttribute("aria-label", "Delete this note");

    let timer = null;
    const disarm = () => {
      clearTimeout(timer);
      btn.classList.remove("armed");
      btn.textContent = "×";
    };

    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!btn.classList.contains("armed")) {
        btn.classList.add("armed");
        btn.textContent = "Delete?";
        timer = setTimeout(disarm, 4000);
        return;
      }
      disarm();
      btn.disabled = true;
      const typed = kind === "typed";
      const reply = await send({ type: typed ? "DELETE_TYPED_NOTE" : "DELETE_HIGHLIGHT", id: note.id, ...where });
      const stillThere = typed ? await typedNoteText(where, note.id) !== null : await highlightExists(where, note.id);
      if (!reply?.ok && stillThere) {
        btn.disabled = false;
        showError(`Couldn't delete: ${reply?.reason || "unknown error"}`);
      }
      // On success the storage listener redraws the page.
    });
    btn.addEventListener("blur", disarm);
    return btn;
  }

  // ---------------------------------------------------------------------------
  // Saving typed notes
  // ---------------------------------------------------------------------------

  function send(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (reply) => {
          resolve(chrome.runtime.lastError ? { ok: false, reason: chrome.runtime.lastError.message } : reply);
        });
      } catch (err) {
        resolve({ ok: false, reason: String(err) });
      }
    });
  }

  async function highlightExists({ courseName, topicName }, id) {
    const { lazynotes } = await chrome.storage.local.get("lazynotes");
    return !!lazynotes?.courses?.[courseName]?.topics?.[topicName]?.highlights?.[id];
  }

  async function typedNoteText({ courseName, topicName }, id) {
    const { lazynotes } = await chrome.storage.local.get("lazynotes");
    return lazynotes?.courses?.[courseName]?.topics?.[topicName]?.notes?.[id]?.text ?? null;
  }

  // Storage is the judge of success: another extension page answering the
  // message first could hand back an empty reply even though it saved.
  async function saveTypedNote({ id, courseName, topicName, text }) {
    const reply = await send({ type: "SAVE_TYPED_NOTE", id, courseName, topicName, text });
    if (reply?.ok) return true;
    if (await typedNoteText({ courseName, topicName }, id) === text.replace(/\s+$/, "")) return true;
    showError(`Couldn't save your note: ${reply?.reason || "unknown error"}`);
    return false;
  }

  function showError(text) {
    composerError.textContent = text;
    composerError.hidden = false;
    clearTimeout(showError.timer);
    showError.timer = setTimeout(() => { composerError.hidden = true; }, 6000);
  }

  // ---------------------------------------------------------------------------
  // Composer
  // ---------------------------------------------------------------------------

  function setComposerEnabled(on) {
    composerInput.disabled = !on;
    composerSave.disabled = !on;
    composerInput.placeholder = on ? "Type a note…" : "Pick a topic to take notes";
  }

  function autoGrow(input) {
    if (input.isRich) return;   // grows by itself (CSS caps its height)
    const MAX = 168;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, MAX)}px`;
    input.style.overflowY = input.scrollHeight > MAX ? "auto" : "hidden";
  }

  // Enter saves, Shift+Enter is a new line (and not while an IME is composing).
  function isSaveKey(e) {
    return e.key === "Enter" && !e.shiftKey && !e.isComposing;
  }

  // ── Editing your latest typed note back in the note box ──
  // Ctrl+↑ in an empty note box, when the last note is one you typed: its
  // words come back into the box, Enter saves the change, Esc stops. (You're
  // usually still writing that thought.) Old way: Ctrl+↑ goes to the list
  // (Settings › Old ways › lnEditLastInList).
  let boxEditing = null;   // { id, where }
  let editInList = false;
  chrome.storage.local.get("lnEditLastInList", (r) => { editInList = r?.lnEditLastInList === true; });
  chrome.storage.onChanged.addListener((c, a) => { if (a === "local" && "lnEditLastInList" in c) editInList = c.lnEditLastInList.newValue === true; });
  function startBoxEdit(note) {
    boxEditing = { id: note.id, where: { ...target } };
    composerInput.value = note.text;
    autoGrow(composerInput);
    composerInput.focus();
    composerInput.caretToEnd?.();
    let tag = document.getElementById("composer-editing");
    if (!tag) {
      tag = document.createElement("div");
      tag.id = "composer-editing";
      composer.prepend(tag);
    }
    tag.textContent = "Editing your last note · Enter saves · Esc stops";
    tag.hidden = false;
    composer.classList.add("box-editing");
    markBoxEdit();
  }
  function stopBoxEdit({ clear = true } = {}) {
    if (!boxEditing) return;
    boxEditing = null;
    if (clear) { composerInput.value = ""; autoGrow(composerInput); }
    const tag = document.getElementById("composer-editing");
    if (tag) tag.hidden = true;
    composer.classList.remove("box-editing");
    markBoxEdit();
  }
  function markBoxEdit() {
    noteList.querySelectorAll(".note.in-box").forEach((n) => n.classList.remove("in-box"));
    if (boxEditing) noteList.querySelector(`.note[data-id="${CSS.escape(String(boxEditing.id))}"]`)?.classList.add("in-box");
  }

  async function submitComposer() {
    const text = composerInput.value.trim();
    if (boxEditing) {
      const { id, where } = boxEditing;
      if (text && await saveTypedNote({ id, ...where, text })) { scrollToId = id; stopBoxEdit(); }
      else if (!text) stopBoxEdit();   // emptied: nothing changes (× deletes a note)
      return;
    }
    if (!text || !target) return;

    // Saved as a highlight type: plain words, like a highlight without a link.
    if (composerType.value) {
      const id = crypto.randomUUID();
      // Each paragraph of the box is one line (Shift+Enter); an empty
      // paragraph between them stays as one blank line.
      const words = composerInput.innerText.replace(/\n\n(\n*)/g, (_, more) => (more ? "\n\n" : "\n")).trim();
      chrome.runtime.sendMessage({   // no reply for highlights, same as a drop
        type: "NEW_HIGHLIGHT", id, text: words, context: null, category: composerType.value,
        course: target.courseName, topic: target.topicName, annotation: "",
        sourceUrl: null, sourceTitle: null, anchor: null
      });
      dropPendingMoves(composerInput);
      composerInput.value = "";
      scrollToId = id;
      return;
    }

    const id = crypto.randomUUID();
    if (!await saveTypedNote({ id, ...target, text })) return;

    await finishMoves(composerInput, text);
    composerInput.value = "";
    autoGrow(composerInput);
    scrollToId = id;
  }

  // Tab after typing goes to "Save as" (arrow keys or a letter pick the
  // type), Enter there saves; Shift+Tab goes back. In a list, Tab indents.
  composerInput.addEventListener("keydown", (e) => {
    const at = getSelection().anchorNode;
    const atEl = at?.nodeType === Node.ELEMENT_NODE ? at : at?.parentElement;
    if (e.key === "Tab" && !e.shiftKey && composerInput.value.trim()) {
      e.preventDefault();
      composerType.focus();
      return;
    }
    if (isSaveKey(e)) {
      e.preventDefault();
      submitComposer();
    }
    if (e.key === "Escape" && boxEditing) {
      e.preventDefault();
      stopBoxEdit();
    }
  });
  composerInput.addEventListener("input", () => {
    autoGrow(composerInput);
    prunePendingMoves(composerInput);
  });
  composer.addEventListener("submit", (e) => {
    e.preventDefault();
    submitComposer();
  });

  // ---------------------------------------------------------------------------
  // Editing a typed note in place
  // ---------------------------------------------------------------------------

  function openEditor(el, note, where) {
    if (editing) return;

    const input = createRichBox();
    input.classList.add("typed-editor");
    input.value = note.text;
    input.setAttribute("aria-label", "Edit note");
    const bar = createFormatBar(input);
    // "Save as": keep it your note, or turn it into a highlight type.
    const asType = composerType.cloneNode(true);
    asType.removeAttribute("id");
    asType.className = "edit-as-type";
    asType.value = "";
    asType.addEventListener("mousedown", (e) => e.stopPropagation());
    bar.appendChild(asType);

    const hint = document.createElement("div");
    hint.className = "typed-editor-hint";
    hint.textContent = "Enter saves · Shift+Enter new line · Esc cancels";

    el.querySelector(".note-text").replaceWith(input);
    input.before(bar);
    input.after(hint);
    el.classList.add("editing");
    el.removeAttribute("title");
    editing = { id: note.id, el, input, hint, where };

    autoGrow(input);
    input.focus();
    input.caretToEnd();

    input.addEventListener("input", () => {
      autoGrow(input);
      prunePendingMoves(input);
    });
    // Click anywhere else (not the dock's drop cards): same as Enter.
    const outside = (e) => {
      if (editing?.input !== input) { document.removeEventListener("pointerdown", outside, true); return; }
      if (el.contains(e.target) || e.target.closest?.("#study-dock, .hs-list, .ln-spell-bar")) return;
      document.removeEventListener("pointerdown", outside, true);
      commit();
    };
    setTimeout(() => document.addEventListener("pointerdown", outside, true), 0);
    const stopLeave = onLeaveWindow(() => {
      stopLeave();
      if (editing?.input !== input) return;
      document.removeEventListener("pointerdown", outside, true);
      commit();
    });

    input.addEventListener("keydown", async (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeEditor();
        return;
      }
      if (!isSaveKey(e)) return;
      e.preventDefault();
      commit();
    });

    async function commit() {
      if (asType.value) {
        const words = input.innerText.replace(/\n{3,}/g, "\n\n").trim();
        if (!words) return;
        chrome.runtime.sendMessage({
          type: "NEW_HIGHLIGHT", id: crypto.randomUUID(), text: words, context: null, category: asType.value,
          course: where.courseName, topic: where.topicName, annotation: "", sourceUrl: null, sourceTitle: null, anchor: null
        });
        await send({ type: "DELETE_TYPED_NOTE", id: note.id, ...where });
        closeEditor();
        return;
      }
      const text = input.value.trim();
      // Emptying a note doesn't delete it (that's the × button): keep it.
      if (!text || text === note.text) {
        closeEditor();
        return;
      }
      if (!await saveTypedNote({ id: note.id, ...where, text })) return;
      await finishMoves(input, text);
      closeEditor();
    }
    wireTextDrop(input);
  }

  // ---------------------------------------------------------------------------
  // Editing a highlight in place (the shared editor, note-editor.js)
  // ---------------------------------------------------------------------------

  function openHighlightEditor(el, note, where) {
    if (editing || hlEditing) return;

    const form = noteEditor(note, {
      onSave: async (fields) => {
        if (!await saveHighlightEdit(note.id, where.courseName, where.topicName, fields)) {
          showError("Couldn't save: that highlight was deleted.");
        }
        closeHighlightEditor();
      },
      onCancel: () => closeHighlightEditor(),
      // 📖 Define: the definition becomes its own note in this topic.
      onAiNote: async ({ text, category }) => {
        const reply = await send({ type: "AI_SAVE_NOTE", text, category, ...where });
        return !!reply?.ok;
      },
      // Type "My note": becomes one of your typed notes (annotation kept
      // as a line under it), the highlight goes.
      onConvert: async (fields) => {
        const text = fields.annotation ? `${fields.text}\n${fields.annotation}` : fields.text;
        if (await saveTypedNote({ id: crypto.randomUUID(), ...where, text })) {
          await send({ type: "DELETE_HIGHLIGHT", id: note.id, ...where });
        }
        closeHighlightEditor();
      },
      onDelete: async () => {
        const reply = await send({ type: "DELETE_HIGHLIGHT", id: note.id, ...where });
        if (!reply?.ok && await highlightExists(where, note.id)) {
          showError(`Couldn't delete: ${reply?.reason || "unknown error"}`);
          return false;
        }
        closeHighlightEditor();
        return true;
      }
    });

    hlEditing = { id: note.id };
    // Compact: edit right where the words are (indent, bullet and all).
    const words = form.inPlace && el.querySelector(":scope > .note-text");
    if (words) {
      // Start exactly where the words started (after a bullet, a marker…).
      const dx = words.getBoundingClientRect().left - el.getBoundingClientRect().left - parseFloat(getComputedStyle(el).paddingLeft);
      if (dx > 0) form.style.marginLeft = `${dx}px`;
    }
    if (words) { words.replaceWith(form); el.classList.add("editing-inplace"); el.draggable = false; el.removeAttribute("title"); }
    else el.replaceWith(form);
    form.focusText();
  }

  function closeHighlightEditor({ redraw = true } = {}) {
    if (!hlEditing) return;
    hlEditing = null;
    renderSkipped = false;
    if (redraw) requestRender();
  }

  // redraw: false when the caller draws next anyway (another topic, or none).
  function closeEditor({ redraw = true } = {}) {
    if (!editing) return;
    const { input } = editing;
    if (pendingChoice?.input === input) closeChoice();
    dropPendingMoves(input);   // never saved: the highlights stay
    editing = null;
    renderSkipped = false;
    if (redraw) requestRender();
  }

  // ---------------------------------------------------------------------------
  // Dropping text where you type: it becomes a quote
  // ---------------------------------------------------------------------------

  const hasText = (dt) => [...(dt?.types || [])].includes("text/plain");
  const isHighlightDrag = (dt) => [...(dt?.types || [])].includes(HIGHLIGHT_TYPE);

  function wireTextDrop(input) {
    input.addEventListener("dragover", (e) => {
      if (!hasText(e.dataTransfer) || input.disabled) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      input.classList.add("drop-target");
    });
    input.addEventListener("dragleave", () => input.classList.remove("drop-target"));
    input.addEventListener("drop", (e) => {
      input.classList.remove("drop-target");
      const dt = e.dataTransfer;
      if (!hasText(dt) || input.disabled) return;
      e.preventDefault();
      e.stopPropagation();   // not also a drop on the page

      // Setting "Dragged text goes in as normal text": no quote, no question.
      if (dropPlain) {
        let txt = dt.getData("text/plain");
        try { txt = JSON.parse(dt.getData(HIGHLIGHT_TYPE) || "null")?.text || txt; } catch (_) {}
        if (insertPlain(input, e, txt)) return;
      }
      const at = dropOffset(input, e);
      const highlight = dt.getData(HIGHLIGHT_TYPE);
      if (highlight) {
        try {
          askQuoteOrMove(input, at, JSON.parse(highlight), { x: e.clientX, y: e.clientY });
          return;
        } catch (_) { /* not ours after all: quote the text */ }
      }
      insertQuote(input, at, dt.getData("text/plain"));
    });
  }

  let dropPlain = false;   // lnDropPlain (Settings › More options)
  chrome.storage.local.get("lnDropPlain", (r) => { dropPlain = r?.lnDropPlain === true; });
  chrome.storage.onChanged.addListener((c, a) => { if (a === "local" && "lnDropPlain" in c) dropPlain = c.lnDropPlain.newValue === true; });

  // The dropped words as ordinary typing, right where they were dropped.
  function insertPlain(input, e, rawText) {
    const text = String(rawText ?? "").replace(/\s+/g, " ").trim();
    if (!text) return false;
    if (input.isRich) {
      input.focus();
      const r = document.caretRangeFromPoint?.(e.clientX, e.clientY);
      if (r && input.contains(r.startContainer)) { const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); }
      document.execCommand("insertText", false, text);
      return true;
    }
    const pos = document.caretPositionFromPoint?.(e.clientX, e.clientY);
    const at = pos && pos.offsetNode === input ? pos.offset
      : document.activeElement === input ? input.selectionStart : input.value.length;
    input.setRangeText(text, at, at, "end");
    input.focus();
    input.dispatchEvent(new Event("input", { bubbles: true }));
    autoGrow(input);
    return true;
  }

  // Where the quote goes: after the line the drop landed on (a quote is a
  // line of its own, so it never splits what you typed), when the browser
  // can tell; else after the line with the caret; else at the end.
  function dropOffset(input, e) {
    if (input.isRich) return input.pointAt(e.clientX, e.clientY);   // { block, range }
    const pos = document.caretPositionFromPoint?.(e.clientX, e.clientY);
    const at = pos && pos.offsetNode === input ? pos.offset
      : document.activeElement === input ? input.selectionStart
      : input.value.length;
    const lineEnd = input.value.indexOf("\n", at);
    return lineEnd === -1 ? input.value.length : lineEnd;
  }

  // Put "> text" on its own line at `at`, caret on the line after it so you
  // can carry on typing. Returns the quote line.
  function insertQuote(input, at, rawText) {
    if (input.isRich) return input.insertQuoteAt(at, rawText);
    const text = String(rawText ?? "").replace(/\s+/g, " ").trim();
    if (!text) return null;

    const quote  = `> ${text}`;
    const before = input.value.slice(0, at);
    const after  = input.value.slice(at).replace(/^\n/, "");
    const lead   = before && !before.endsWith("\n") ? "\n" : "";
    const head   = `${before}${lead}${quote}\n`;

    input.value = head + after;
    input.focus();
    input.setSelectionRange(head.length, head.length);
    autoGrow(input);
    return quote;
  }

  // ---------------------------------------------------------------------------
  // A highlight from this page dropped where you type: quote it or move it?
  // ---------------------------------------------------------------------------
  // Move only happens when the note is saved, and only if the quote is still
  // in it, so abandoning the note never loses the highlight.

  const pendingMoves = new WeakMap();   // textarea -> [{ id, courseName, topicName, quote }]
  const movingIds    = new Set();       // highlights waiting to move (drawn faded)
  let pendingChoice  = null;            // { input, at, highlight }
  let lastChoice     = "quote";

  function askQuoteOrMove(input, at, highlight, point) {
    pendingChoice = { input, at, highlight };
    const short = squashSpaces(highlight.text);
    choiceText.textContent = `Add “${short.length > 60 ? short.slice(0, 57) + "…" : short}” to your note:`;

    // Next to what you're typing: above the composer, or under the note
    // being edited.
    if (editing?.input === input) editing.hint.after(choice);
    else composer.before(choice);
    choice.hidden = false;
    floatAt(choice, point);
    // Your last answer is ready: Enter repeats it; Q / M pick directly.
    $(lastChoice === "move" ? "drop-choice-move" : "drop-choice-quote").focus();
  }

  function closeChoice() {
    pendingChoice = null;
    choice.hidden = true;
    unfloat(choice);
    composer.before(choice);   // home position in the dock
  }

  function resolveChoice(action) {
    if (action === "quote" || action === "move") lastChoice = action;
    const c = pendingChoice;
    closeChoice();
    if (!c) return;
    if (action === "cancel") {
      c.input.focus();
      return;
    }

    const quote = insertQuote(c.input, c.at, c.highlight.text);
    if (action === "move" && quote) {
      const { id, courseName, topicName } = c.highlight;
      const list = pendingMoves.get(c.input) || [];
      list.push({ id, courseName, topicName, quote });
      pendingMoves.set(c.input, list);
      movingIds.add(id);
      markMoving();
    }
  }

  $("drop-choice-quote").addEventListener("click", () => resolveChoice("quote"));
  $("drop-choice-move").addEventListener("click", () => resolveChoice("move"));
  $("drop-choice-cancel").addEventListener("click", () => resolveChoice("cancel"));
  choice.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() === "q" || e.key.toLowerCase() === "m") {
      e.preventDefault();
      resolveChoice(e.key.toLowerCase() === "q" ? "quote" : "move");
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      resolveChoice("cancel");
    }
  });

  // Quote deleted from the draft again: that highlight isn't moving after all.
  function prunePendingMoves(input) {
    const list = pendingMoves.get(input);
    if (!list) return;
    const kept = list.filter((m) => input.value.includes(m.quote));
    list.filter((m) => !kept.includes(m)).forEach((m) => movingIds.delete(m.id));
    pendingMoves.set(input, kept);
    markMoving();
  }

  function dropPendingMoves(input) {
    (pendingMoves.get(input) || []).forEach((m) => movingIds.delete(m.id));
    pendingMoves.delete(input);
    markMoving();
  }

  // The note holding the quotes was saved: now remove the moved highlights.
  async function finishMoves(input, savedText) {
    const list = pendingMoves.get(input) || [];
    pendingMoves.delete(input);
    for (const m of list) {
      movingIds.delete(m.id);
      if (savedText.includes(m.quote)) {
        await send({ type: "DELETE_HIGHLIGHT", id: m.id, courseName: m.courseName, topicName: m.topicName });
      }
    }
    markMoving();
  }

  function markMoving() {
    noteList.querySelectorAll(".note[data-id]").forEach((el) => {
      el.classList.toggle("note--moving", movingIds.has(el.dataset.id));
    });
  }

  wireTextDrop(composerInput);

  // A note's source link: if that page is already open in a tab, go to that
  // tab (and to the right page/slide) instead of opening it again.
  noteList.addEventListener("click", async (e) => {
    const a = e.target.closest?.("a.note-source");
    if (!a || !a.href || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    e.stopPropagation();
    const url = a.href;
    const base = (u) => String(u || "").split("#")[0];
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((t) => base(t.url) === base(url)) || tabs.find((t) => base(t.pendingUrl) === base(url));
    if (!tab) { chrome.tabs.create({ url }); return; }
    await chrome.tabs.update(tab.id, { active: true, ...(tab.url !== url && url.includes("#") ? { url } : {}) });
    chrome.windows.update(tab.windowId, { focused: true });
  }, true);

  // ---------------------------------------------------------------------------
  // Text dropped on the page: save it like a highlight taken on a website
  // ---------------------------------------------------------------------------

  let dropZoneTimer = null;

  // Text dragged within the panel itself (say, out of a typed note) is
  // already in your notes: only text from a page is offered as a highlight.
  // The mark travels with the drag, so it can't go stale.
  const PANEL_TYPE = "application/x-lazy-notes-panel";
  document.addEventListener("dragstart", (e) => e.dataTransfer?.setData(PANEL_TYPE, "1"), true);

  function isPageTextDrop(e) {
    const dt = e.dataTransfer;
    return studyView.classList.contains("visible") && target &&
      hasText(dt) && !isHighlightDrag(dt) && ![...dt.types].includes(PANEL_TYPE) &&
      !e.target.closest?.("textarea, .rich-box");
  }

  scroller.addEventListener("dragover", (e) => {
    if (!isPageTextDrop(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    studyView.classList.add("drop-zone");
    // dragleave fires for every child crossed; drop the outline once
    // dragover stops coming instead.
    clearTimeout(dropZoneTimer);
    dropZoneTimer = setTimeout(() => studyView.classList.remove("drop-zone"), 150);
  });

  scroller.addEventListener("drop", async (e) => {
    studyView.classList.remove("drop-zone");
    if (!isPageTextDrop(e)) return;
    e.preventDefault();
    const text = e.dataTransfer.getData("text/plain");
    const point = { x: e.clientX, y: e.clientY };
    openCard(text, await sourceFor(text), point);
  });

  // content.js saved where the dragged text came from; it's this drop if the
  // text is the same (spacing aside) and the drag was recent.
  async function sourceFor(text) {
    const squash = (s) => String(s ?? "").replace(/\s+/g, "");
    const { lastDrag } = await chrome.storage.local.get("lastDrag");
    if (!lastDrag || Date.now() - lastDrag.at > LAST_DRAG_MAX_AGE) return null;
    return squash(lastDrag.text) === squash(text) ? lastDrag : null;
  }

  let draft = null;                       // { text, source, where, type }
  const lastTypeByTopic = new Map();      // remember the type, as the popup does

  function hostOf(url) {
    try {
      const u = new URL(url);
      return u.protocol.startsWith("http") ? u.hostname.replace(/^www\./, "") : null;
    } catch (_) {
      return null;
    }
  }

  // The drop's follow-up (type card, Quote/Move) opens where the mouse let
  // go, not down in the dock. Kept inside the panel; above the point if
  // there's no room below.
  function floatAt(el, point) {
    if (!point) return;
    el.classList.add("floating");
    const w = el.offsetWidth, h = el.offsetHeight;
    const left = Math.max(8, Math.min(point.x - 24, innerWidth - w - 8));
    const below = point.y + 14 + h <= innerHeight - 8;
    const top = below ? point.y + 14 : Math.max(8, point.y - h - 14);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }
  function unfloat(el) {
    el.classList.remove("floating");
    el.style.left = el.style.top = "";
  }

  function openCard(rawText, source, point) {
    const text = (source?.text ?? rawText ?? "").trim();
    if (!text || !target) return;
    closeChoice();

    const key = JSON.stringify([target.courseName, target.topicName]);
    draft = { text, source, where: { ...target }, key, type: guessType(text) || (lastTypeByTopic.get(key) === "list point" ? "list point" : "generic") };

    cardTopic.textContent = target.topicName;
    cardText.textContent = text;
    const from = source && (source.sourceTitle || hostOf(source.sourceUrl));
    cardSource.textContent = from ? `From ${from}` : "Saved without a link to where it came from";
    cardAnnotation.value = "";
    cardAnnotation.hidden = true;
    $("drop-card-ann-toggle").hidden = false;
    drawTypeChips();

    card.hidden = false;
    floatAt(card, point);
    cardTypes.querySelector('[aria-checked="true"]')?.focus();
  }

  // Compact chips, same as the save pop-up on pages: a short mark, its
  // number key, the full name on hover and in the caption. Clicking one (or
  // pressing its number) saves straight away; Enter saves the lit one.
  const CHIP_MARK = { "header": "H", "sub topic": "H2", "definition": "Def", "formula": "ƒx",
                      "list point": "•", "note": "!", "summary": "Σ", "list head": "≡", "table": "▦", "generic": "¶" };
  const CHIP_KEY  = { "header": "1", "sub topic": "2", "definition": "3", "formula": "4",
                      "list point": "5", "note": "6", "summary": "7", "list head": "8", "table": "T", "generic": "0" };

  // A first guess from the words alone (the page's tags aren't known here).
  function guessType(text) {
    const t = String(text || "").trim();
    const words = t.split(/\s+/).length;
    if (/^(note|nb|important|remember|exam|warning|tip)\b[:\s-]/i.test(t)) return "note";
    if (/[=≈≠≤≥∑∫√±×÷∝∂]/.test(t) && words <= 25) return "formula";
    if (/^(in summary|to summari[sz]e|in conclusion|overall|in short)\b/i.test(t)) return "summary";
    if (/^[^.:;]{1,50}?\s*(:|\s[-–—]\s)\s*\S/.test(t) && words >= 3) return "definition";
    if (/^[A-Za-z][\w\s'()-]{0,40}\s(is|are|refers to|means|is defined as)\s(a|an|the)?\s?\S/i.test(t) && words <= 40) return "definition";
    if (/^\s*([-•*▪◦]|\d+[.)])\s/.test(t)) return "list point";
    if (words <= 6 && !/[.!?,;]$/.test(t) && /^[A-Z0-9]/.test(t)) return "header";
    if (words > 60) return "summary";
    return null;
  }

  function drawTypeChips() {
    cardTypes.innerHTML = "";
    TYPES.forEach((type) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "type-chip";
      chip.setAttribute("role", "radio");
      chip.setAttribute("aria-checked", String(type === draft.type));
      chip.setAttribute("aria-label", CATEGORY_LABELS[type] || type);
      chip.title = `${CATEGORY_LABELS[type] || type} (${CHIP_KEY[type]})`;
      chip.tabIndex = type === draft.type ? 0 : -1;
      chip.dataset.type = type;
      const mark = document.createElement("span");
      mark.textContent = CHIP_MARK[type] || type;
      const key = document.createElement("span");
      key.className = "type-chip-key";
      key.textContent = CHIP_KEY[type] || "";
      chip.append(mark, key);
      chip.addEventListener("click", () => { pickType(type); saveCard(); });
      chip.addEventListener("mouseenter", () => showCaption(type));
      chip.addEventListener("mouseleave", () => draft && showCaption(draft.type));
      cardTypes.appendChild(chip);
    });
    showCaption(draft.type);
  }

  function showCaption(type) {
    $("drop-card-caption").textContent = `${CATEGORY_LABELS[type] || type} · Enter saves · 1–7, 0 = type`;
  }

  function pickType(type, { focus = false } = {}) {
    draft.type = type;
    showCaption(type);
    cardTypes.querySelectorAll(".type-chip").forEach((chip) => {
      const on = chip.dataset.type === type;
      chip.setAttribute("aria-checked", String(on));
      chip.tabIndex = on ? 0 : -1;
      if (on && focus) chip.focus();
    });
  }

  function closeCard() {
    draft = null;
    card.hidden = true;
    unfloat(card);
  }

  function saveCard() {
    const d = draft;
    if (!d) return;
    const s = d.source;

    chrome.runtime.sendMessage({
      type:        "NEW_HIGHLIGHT",
      id:          crypto.randomUUID(),
      text:        d.text,
      context:     CONTEXT_TYPES.includes(d.type) ? (s?.context ?? null) : null,
      category:    d.type,
      course:      d.where.courseName,
      topic:       d.where.topicName,
      annotation:  cardAnnotation.value.trim(),
      sourceUrl:   s?.sourceUrl ?? null,
      sourceTitle: s?.sourceTitle ?? null,
      anchor:      s?.anchor ?? null
    });

    lastTypeByTopic.set(d.key, d.type);
    closeCard();
  }

  $("drop-card-save").addEventListener("click", saveCard);
  $("drop-card-ann-toggle").addEventListener("click", () => {
    $("drop-card-ann-toggle").hidden = true;
    cardAnnotation.hidden = false;
    cardAnnotation.focus();
  });
  $("drop-card-cancel").addEventListener("click", closeCard);

  card.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeCard();
      return;
    }
    if (e.key === "Enter" && !e.target.closest("#drop-card-cancel")) {
      e.preventDefault();
      saveCard();
      return;
    }
    // A number picks that type and saves (not while typing an annotation).
    if (/^[0-7]$/.test(e.key) && e.target !== cardAnnotation && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const type = Object.keys(CHIP_KEY).find((t) => CHIP_KEY[t] === e.key);
      if (type && TYPES.includes(type)) {
        e.preventDefault();
        pickType(type);
        saveCard();
        return;
      }
    }
    // Arrow keys move between the type chips, like radio buttons.
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (step && e.target.classList.contains("type-chip")) {
      e.preventDefault();
      const i = TYPES.indexOf(draft.type);
      pickType(TYPES[(i + step + TYPES.length) % TYPES.length], { focus: true });
    }
  });

  return { init, render, clear, counts };
})();

// ---------------------------------------------------------------------------
// Typing lists in the note boxes: Shift+Enter on a point starts the next one
// ("- ", "• " or the next number); on an empty point it ends the list. Tab /
// Shift+Tab indent or outdent a point.
// ---------------------------------------------------------------------------
document.addEventListener("keydown", (e) => {
  const box = e.target;
  if (!(box instanceof HTMLTextAreaElement) || !box.matches("#composer-input, .typed-editor") || e.isComposing) return;
  if (box.selectionStart !== box.selectionEnd) return;
  const v = box.value, c = box.selectionStart;
  const lineStart = v.lastIndexOf("\n", c - 1) + 1;
  const line = v.slice(lineStart, c);
  const m = line.match(/^(\s*)([-*•]|(\d+)([.)]))\s+(.*)$/);
  if (!m) return;

  if (e.key === "Enter" && e.shiftKey && !(e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    if (!m[5].trim()) {                 // empty point: end the list
      box.setSelectionRange(lineStart, c);
      document.execCommand("delete");
      return;
    }
    const marker = m[3] ? `${Number(m[3]) + 1}${m[4]}` : m[2];
    document.execCommand("insertText", false, `\n${m[1]}${marker} `);
  } else if (e.key === "Tab") {
    e.preventDefault();
    if (e.shiftKey) {
      const cut = Math.min(2, m[1].length);
      if (!cut) return;
      box.setSelectionRange(lineStart, lineStart + cut);
      document.execCommand("delete");
      box.setSelectionRange(c - cut, c - cut);
    } else {
      box.setSelectionRange(lineStart, lineStart);
      document.execCommand("insertText", false, "  ");
      box.setSelectionRange(c + 2, c + 2);
    }
  }
}, true);


// Course › Topic picker: one Tab stop, ← / → between the two dropdowns.
(() => {
  const picker = document.getElementById("study-picker");
  if (!picker) return;
  // ✎ rename — appears when the mouse is over the picker (or a button has focus).
  const mk = (label, title, fn) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "pk-rename"; b.textContent = label; b.title = title; b.setAttribute("aria-label", title);
    b.addEventListener("click", fn);
    return b;
  };
  const courseSel = document.getElementById("study-course-select"), topicSel = document.getElementById("study-topic-select");
  const rc = mk("✎ course", "Rename this course", () => { if (courseSel.value) lnRenamePrompt({ type: "RENAME_COURSE", courseName: courseSel.value }, courseSel.value); });
  const rt = mk("✎ topic", "Rename this topic", () => { if (courseSel.value && topicSel.value) lnRenamePrompt({ type: "RENAME_TOPIC", courseName: courseSel.value, topicName: topicSel.value }, topicSel.value); });
  const wrap = document.createElement("span");
  wrap.className = "pk-rename-wrap";
  wrap.append(rc, rt);
  picker.appendChild(wrap);
  const buttons = () => [...picker.querySelectorAll(".hs:not([hidden]) .hs-button")];
  const sync = () => buttons().forEach((b, i) => { if (!b.closest(".hs--open")) b.tabIndex = i === 0 ? 0 : -1; });
  new MutationObserver(sync).observe(picker, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
  sync();
  picker.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const bs = buttons();
    const i = bs.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const next = bs[Math.max(0, Math.min(bs.length - 1, i + (e.key === "ArrowRight" ? 1 : -1)))];
    bs.forEach((b) => { b.tabIndex = b === next ? 0 : -1; });
    next.focus();
  });
})();
