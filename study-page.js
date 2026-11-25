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
  const TYPES = ["header", "sub topic", "definition", "formula", "list head", "list point", "summary", "generic", "note"];
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
  const composerInput  = $("composer-input");
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

    noteList.innerHTML = "";
    entries.forEach((entry) => {
      noteList.appendChild(entry.kind === "typed" ? typedNoteEl(entry) : highlightEl(entry));
    });

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
      if (!e.target.closest("button, a")) edit();
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
      if (!e.target.closest("button, a, textarea")) edit();
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target === el) {
        e.preventDefault();
        edit();
      }
    });
    return el;
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

    const id = crypto.randomUUID();
    if (!await saveTypedNote({ id, ...target, text })) return;

    await finishMoves(composerInput, text);
    composerInput.value = "";
    autoGrow(composerInput);
    scrollToId = id;
  }

  composerInput.addEventListener("keydown", (e) => {
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

    const input = document.createElement("textarea");
    input.className = "typed-editor";
    input.value = note.text;
    input.setAttribute("aria-label", "Edit note");

    const hint = document.createElement("div");
    hint.className = "typed-editor-hint";
    hint.textContent = "Enter saves · Shift+Enter new line · Esc cancels";

    el.querySelector(".note-text").replaceWith(input);
    input.after(hint);
    el.classList.add("editing");
    el.removeAttribute("title");
    editing = { id: note.id, el, input, hint, where };

    autoGrow(input);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);

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
    $("drop-choice-quote").focus();
  }

  function closeChoice() {
    pendingChoice = null;
    choice.hidden = true;
    unfloat(choice);
    composer.before(choice);   // home position in the dock
  }

  function resolveChoice(action) {
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
      !e.target.closest?.("textarea");
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
    draft = { text, source, where: { ...target }, key, type: lastTypeByTopic.get(key) || TYPES[0] };

    cardTopic.textContent = target.topicName;
    cardText.textContent = text;
    const from = source && (source.sourceTitle || hostOf(source.sourceUrl));
    cardSource.textContent = from ? `From ${from}` : "Saved without a link to where it came from";
    cardAnnotation.value = "";
    drawTypeChips();

    card.hidden = false;
    floatAt(card, point);
    cardTypes.querySelector('[aria-checked="true"]')?.focus();
  }

  function drawTypeChips() {
    cardTypes.innerHTML = "";
    TYPES.forEach((type) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "type-chip";
      chip.setAttribute("role", "radio");
      chip.setAttribute("aria-checked", String(type === draft.type));
      chip.tabIndex = type === draft.type ? 0 : -1;
      chip.dataset.type = type;
      chip.textContent = CATEGORY_LABELS[type] || type;
      chip.addEventListener("click", () => pickType(type));
      cardTypes.appendChild(chip);
    });
  }

  function pickType(type, { focus = false } = {}) {
    draft.type = type;
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
