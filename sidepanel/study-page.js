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
    type.add(new Option("My note", ""));
    PICK_TYPES
      .forEach((t) => type.add(new Option(CATEGORY_LABELS[t] || t, t)));
    type.addEventListener("mousedown", (e) => e.stopPropagation());
    bar.appendChild(type);
    return box;
  })();
  const composerType = $("composer-type");
  composerType.addEventListener("keydown", async (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      await submitComposer();
      composerInput.focus();
    } else if (e.key === "Tab" && e.shiftKey) {
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

  function render({ courseName, topicName, topic }) {
    const sameTopic = target?.courseName === courseName && target?.topicName === topicName;
    if (editing && !sameTopic) closeEditor({ redraw: false });
    if (hlEditing && !sameTopic) closeHighlightEditor({ redraw: false });

    target = { courseName, topicName };
    setComposerEnabled(true);

    // Don't wipe a note that's being edited; draw again when it closes.
    if (editing || hlEditing) {
      renderSkipped = true;
      return;
    }

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
    const refocus = focusAfterDraw || hadFocus;
    if (refocus) noteList.querySelector(`.note[data-id="${CSS.escape(refocus)}"]`)?.focus({ preventScroll: true });
    if (focusAfterDraw && noteList.querySelector(`.note[data-id="${CSS.escape(focusAfterDraw)}"]`)) {
      noteList.querySelector(`.note[data-id="${CSS.escape(focusAfterDraw)}"]`).scrollIntoView({ block: "nearest" });
    }
    clearTimeout(render.focusTimer);
    render.focusTimer = setTimeout(() => { focusAfterDraw = null; }, 800);

    emptyStudy.textContent = "Nothing here yet. Type a note below, or drag text here from a page.";
    emptyStudy.style.display = entries.length ? "none" : "block";

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
    el.addEventListener("click", (e) => {
      if (!e.target.closest("button, a, .note-tools")) edit();
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
      if (!e.target.closest("button, a, textarea, .rich-box, .format-bar, .note-tools")) edit();
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

  // Indent by ±1 (0-3). Undo puts it back.
  function indentBy(note, delta) {
    const from = note.indent || 0;
    const to = Math.max(0, Math.min(3, from + delta));
    if (to === from) return;
    focusAfterDraw = note.id;
    send2([{ kind: kindOf(note), id: note.id, indent: to }], () =>
      arrangeToast(to > from ? "Indented" : "Outdented", [{ kind: kindOf(note), id: note.id, indent: from }]));
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

  // Keyboard, on a focused note (not while editing): Alt+↑/↓ moves, Tab /
  // Shift+Tab indents.
  noteList.addEventListener("keydown", (e) => {
    const el = e.target;
    if (!el.classList?.contains("note") || editing || hlEditing) return;
    const note = shown.find((n) => String(n.id) === el.dataset.id);
    if (!note) return;
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      moveTo(note, shown.indexOf(note) + (e.key === "ArrowUp" ? -1 : 1));
    } else if (e.key === "Tab" && !e.altKey && !e.ctrlKey && !e.metaKey) {
      const to = Math.max(0, Math.min(3, (note.indent || 0) + (e.shiftKey ? -1 : 1)));
      if (to === (note.indent || 0)) return;   // nothing to do: let Tab move focus as usual
      e.preventDefault();
      indentBy(note, e.shiftKey ? -1 : 1);
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
    u.addEventListener("click", () => { t.hidden = true; send2(undoItems); });
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

  async function submitComposer() {
    const text = composerInput.value.trim();
    if (!text || !target) return;

    // Saved as a highlight type: plain words, like a highlight without a link.
    if (composerType.value) {
      const id = crypto.randomUUID();
      const words = composerInput.innerText.replace(/\n{3,}/g, "\n\n").trim();
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
    if (e.key === "Tab" && !e.shiftKey && !atEl?.closest?.("li")) {
      e.preventDefault();
      composerType.focus();
      return;
    }
    if (isSaveKey(e)) {
      e.preventDefault();
      submitComposer();
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
    el.replaceWith(form);
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
                      "list point": "•", "note": "!", "summary": "Σ", "generic": "¶" };
  const CHIP_KEY  = { "header": "1", "sub topic": "2", "definition": "3", "formula": "4",
                      "list point": "5", "note": "6", "summary": "7", "generic": "0" };

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
