// Lazy Notes — New Tab Viewer
// Branches on document.body.dataset.page. Navigation is via URL query params.
// Reads/writes chrome.storage.local directly (this is a plain page script,
// not a module, so it keeps its own small storage helpers rather than
// importing bg_storage.js).

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, (r) => resolve(r)));
}

function storageSet(items) {
  return new Promise((resolve) => chrome.storage.local.set(items, () => resolve()));
}

async function getCourseTree() {
  const { lazynotes } = await storageGet("lazynotes");
  return lazynotes?.courses ?? {};
}

async function updateHighlightInStorage(id, courseName, topicName, fields) {
  const { lazynotes } = await storageGet("lazynotes");
  const data = lazynotes ?? { courses: {} };
  const topic = data.courses?.[courseName]?.topics?.[topicName];
  if (!topic || !topic.highlights || !topic.highlights[id]) return null;

  topic.highlights[id] = {
    ...topic.highlights[id],
    ...fields,
    edited: new Date().toISOString()
  };

  await storageSet({ lazynotes: data });
  return topic.highlights[id];
}

const CATEGORIES = ["header", "definition", "formula", "list head", "list point", "summary"];

// ---------------------------------------------------------------------------
// Delete helpers
// ---------------------------------------------------------------------------

// Deletes go through the background so it can also clear the active
// course/topic and rebuild the right-click menu.
function sendDelete(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (reply) => {
      if (chrome.runtime.lastError || !reply?.ok) {
        const reason = reply?.reason || chrome.runtime.lastError?.message || "unknown error";
        alert(`Couldn't delete: ${reason}`);
        resolve(false);
        return;
      }
      resolve(true);
    });
  });
}

// A delete button that needs a second click within a few seconds, so a stray
// click can't wipe anything. confirmText says what will be lost.
function makeDeleteButton(confirmText, onConfirm) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "delete-btn";
  btn.textContent = "Delete";
  btn.title = "Delete";

  let armed = false;
  let timer = null;

  const disarm = () => {
    armed = false;
    clearTimeout(timer);
    btn.classList.remove("armed");
    btn.textContent = "Delete";
  };

  btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!armed) {
      armed = true;
      btn.classList.add("armed");
      btn.textContent = confirmText;
      timer = setTimeout(disarm, 4000);
      return;
    }
    disarm();
    btn.disabled = true;
    const ok = await onConfirm();
    if (!ok) btn.disabled = false;
  });

  btn.addEventListener("blur", disarm);
  return btn;
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function countNotes(course) {
  return Object.values(course?.topics || {})
    .reduce((sum, t) => sum + Object.keys(t.highlights || {}).length, 0);
}

// Breadcrumb in the top bar: [{ label, href? }]; the last item is the page.
function setCrumbs(items) {
  const nav = document.getElementById("crumbs");
  if (!nav) return;
  nav.innerHTML = "";
  items.forEach((item, i) => {
    if (i > 0) {
      const sep = document.createElement("span");
      sep.className = "sep";
      sep.textContent = "/";
      nav.appendChild(sep);
    }
    const el = document.createElement(item.href ? "a" : "span");
    el.textContent = item.label;
    el.title = item.label;
    if (item.href) el.href = item.href;
    nav.appendChild(el);
  });
}

const coursesHref = () => "courses.html";
const topicsHref  = (course) => `topics.html?course=${encodeURIComponent(course)}`;

// ---------------------------------------------------------------------------
// Page 1 — courses.html
// ---------------------------------------------------------------------------

async function renderCourses() {
  const listEl    = document.getElementById("course-list");
  const resultsEl = document.getElementById("search-results");
  const searchEl  = document.getElementById("search-input");

  setCrumbs([{ label: "Courses" }]);
  let courses = await getCourseTree();

  function drawCourses() {
    listEl.innerHTML = "";
    const names = Object.keys(courses);

    if (names.length === 0) {
      listEl.innerHTML =
        '<div class="empty-state">No courses yet. Create one from the Lazy Notes side panel.</div>';
      return;
    }

    const card = document.createElement("div");
    card.className = "list-card";
    listEl.appendChild(card);

    names.forEach((name) => {
      const course = courses[name];
      const topicCount = Object.keys(course.topics || {}).length;

      const row = document.createElement("div");
      row.className = "list-row";

      const left = document.createElement("div");
      const title = document.createElement("div");
      title.className = "list-row-title";
      title.textContent = name;
      const meta = document.createElement("div");
      meta.className = "list-row-sub";
      meta.textContent = [course.level, course.semester].filter(Boolean).join(" · ");
      left.appendChild(title);
      if (meta.textContent) left.appendChild(meta);

      const right = document.createElement("div");
      right.className = "list-row-right";
      const count = document.createElement("span");
      count.className = "list-row-meta";
      count.textContent = plural(topicCount, "topic");
      const noteTotal = countNotes(course);
      right.appendChild(count);
      right.appendChild(makeDeleteButton(
        noteTotal ? `Delete ${plural(noteTotal, "note")}?` : "Confirm",
        () => sendDelete({ type: "DELETE_COURSE", courseName: name })
      ));

      row.appendChild(left);
      row.appendChild(right);

      row.addEventListener("click", () => {
        window.location.href = topicsHref(name);
      });

      card.appendChild(row);
    });
  }

  function drawSearch() {
    const query = searchEl.value.trim();
    const searching = query.length > 0;

    listEl.hidden    = searching;
    resultsEl.hidden = !searching;
    if (!searching) return;

    const results = searchNotes(courses, query);
    resultsEl.innerHTML = "";

    const summary = document.createElement("div");
    summary.className = "search-summary";
    summary.textContent = results.length === 0
      ? `No notes match "${query}".`
      : `${results.length} note${results.length === 1 ? " matches" : "s match"} "${query}"`;
    resultsEl.appendChild(summary);

    if (results.length === 0) return;
    const list = document.createElement("div");
    list.className = "list-card";
    resultsEl.appendChild(list);

    results.forEach((r) => {
      const item = document.createElement("div");
      item.className = "result";

      const line = document.createElement("div");
      line.className = "result-text";
      appendWithMarks(line, r.note.text, query);
      item.appendChild(line);

      // Show the annotation/context when that's where the match was.
      if (!matches(r.note.text, query)) {
        const extra = [r.note.annotation, r.note.context].find((t) => matches(t, query));
        if (extra) {
          const sub = document.createElement("div");
          sub.className = "result-sub";
          appendWithMarks(sub, snippet(extra, query), query);
          item.appendChild(sub);
        }
      }

      const path = document.createElement("div");
      path.className = "result-path";
      const cat = document.createElement("span");
      cat.className = "note-cat";
      cat.textContent = CATEGORY_LABELS[r.note.category] || r.note.category;
      path.append(cat, `${r.courseName} / ${r.topicName}`);
      item.appendChild(path);

      item.addEventListener("click", () => {
        window.location.href =
          `display.html?course=${encodeURIComponent(r.courseName)}` +
          `&topic=${encodeURIComponent(r.topicName)}` +
          `&focus=${encodeURIComponent(r.note.id)}`;
      });

      list.appendChild(item);
    });
  }

  // Keep the query in the URL so Back from a result returns to it.
  const initialQuery = new URLSearchParams(window.location.search).get("q");
  if (initialQuery) searchEl.value = initialQuery;

  searchEl.addEventListener("input", () => {
    const q = searchEl.value.trim();
    history.replaceState(null, "", q ? `?q=${encodeURIComponent(q)}` : "courses.html");
    drawSearch();
  });

  drawCourses();
  drawSearch();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.lazynotes) return;
    courses = changes.lazynotes.newValue?.courses ?? {};
    drawCourses();
    drawSearch();
  });
}

// ---------------------------------------------------------------------------
// Search helpers
// ---------------------------------------------------------------------------

function matches(text, query) {
  return !!text && text.toLowerCase().includes(query.toLowerCase());
}

// Every whitespace-separated term must appear somewhere in the note.
function searchNotes(courses, query) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const results = [];

  Object.entries(courses).forEach(([courseName, course]) => {
    Object.entries(course.topics || {}).forEach(([topicName, topic]) => {
      Object.entries(topic.highlights || {}).forEach(([id, fields]) => {
        const hay = [fields.text, fields.annotation, fields.context]
          .filter(Boolean).join("\n").toLowerCase();
        if (terms.every((t) => hay.includes(t))) {
          results.push({ courseName, topicName, note: { id, ...fields } });
        }
      });
    });
  });

  // Matches in the note text first, then newest first.
  return results.sort((a, b) => {
    const am = matches(a.note.text, terms[0]) ? 0 : 1;
    const bm = matches(b.note.text, terms[0]) ? 0 : 1;
    if (am !== bm) return am - bm;
    return new Date(b.note.timestamp) - new Date(a.note.timestamp);
  });
}

// Trim long context to a window around the first match.
function snippet(text, query, radius = 80) {
  const i = text.toLowerCase().indexOf(query.toLowerCase().split(/\s+/)[0]);
  if (i < 0 || text.length <= radius * 2) return text;
  const start = Math.max(0, i - radius);
  const end   = Math.min(text.length, i + radius);
  return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
}

// Appends text to el with each query term wrapped in <mark>, built from text
// nodes so note content is never parsed as HTML.
function appendWithMarks(el, text, query) {
  const terms = query.split(/\s+/).filter(Boolean)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (terms.length === 0) { el.textContent = text; return; }

  const re = new RegExp(`(${terms.join("|")})`, "gi");
  String(text).split(re).forEach((part, i) => {
    if (i % 2 === 1) {
      const m = document.createElement("mark");
      m.textContent = part;
      el.appendChild(m);
    } else if (part) {
      el.appendChild(document.createTextNode(part));
    }
  });
}

function wireExportButtons(getTarget) {
  document.querySelectorAll(".export-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const target = await getTarget();
      if (target) exportNotes({ format: btn.dataset.format, ...target });
    });
  });
}

// ---------------------------------------------------------------------------
// Page 2 — topics.html
// ---------------------------------------------------------------------------

async function renderTopics() {
  const params = new URLSearchParams(window.location.search);
  const courseName = params.get("course");

  document.getElementById("course-heading").textContent = courseName || "Unknown course";
  document.title = `${courseName} — Lazy Notes`;
  setCrumbs([{ label: "Courses", href: coursesHref() }, { label: courseName || "Unknown course" }]);

  let course = (await getCourseTree())[courseName];
  const listEl = document.getElementById("topic-list");
  const sortSel = document.getElementById("topic-sort");

  wireExportButtons(async () => {
    const c = (await getCourseTree())[courseName];
    return c ? { courseName, course: c, topicName: null } : null;
  });

  function draw() {
    document.querySelectorAll(".export-btn").forEach((b) => { b.disabled = !course; });
    document.getElementById("course-meta").textContent = course
      ? [course.level, course.semester, course.details].filter(Boolean).join(" · ")
      : "";

    listEl.innerHTML = "";

    if (!course) {
      listEl.innerHTML = '<div class="empty-state">Course not found.</div>';
      return;
    }

    const topics = Object.entries(course.topics || {}).map(([name, t]) => ({
      name,
      created: t.created,
      highlightCount: Object.keys(t.highlights || {}).length
    }));

    if (topics.length === 0) {
      listEl.innerHTML = '<div class="empty-state">No topics yet. Add one from the side panel.</div>';
      return;
    }

    const sorted = sortTopics(topics, sortSel.value);
    const card = document.createElement("div");
    card.className = "list-card";
    listEl.appendChild(card);

    sorted.forEach((topic) => {
      const row = document.createElement("div");
      row.className = "list-row";

      const title = document.createElement("div");
      title.className = "list-row-title";
      title.textContent = topic.name;

      const right = document.createElement("div");
      right.className = "list-row-right";
      const meta = document.createElement("span");
      meta.className = "list-row-meta";
      meta.textContent = plural(topic.highlightCount, "note");
      right.appendChild(meta);
      right.appendChild(makeDeleteButton(
        topic.highlightCount ? `Delete ${plural(topic.highlightCount, "note")}?` : "Confirm",
        () => sendDelete({ type: "DELETE_TOPIC", courseName, topicName: topic.name })
      ));

      row.appendChild(title);
      row.appendChild(right);

      row.addEventListener("click", () => {
        window.location.href =
          `display.html?course=${encodeURIComponent(courseName)}&topic=${encodeURIComponent(topic.name)}`;
      });

      card.appendChild(row);
    });
  }

  sortSel.addEventListener("change", draw);
  draw();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.lazynotes) return;
    course = changes.lazynotes.newValue?.courses?.[courseName];
    draw();
  });
}

// ---------------------------------------------------------------------------
// Page 3 — display.html
// ---------------------------------------------------------------------------

async function renderDisplay() {
  const params = new URLSearchParams(window.location.search);
  const courseName = params.get("course");
  const topicName  = params.get("topic");

  document.getElementById("topic-heading").textContent = topicName || "Unknown topic";
  document.title = `${topicName} — Lazy Notes`;
  setCrumbs([
    { label: "Courses", href: coursesHref() },
    { label: courseName || "Unknown course", href: topicsHref(courseName || "") },
    { label: topicName || "Unknown topic" }
  ]);

  const categoryFilter = document.getElementById("category-filter");
  const sortSel         = document.getElementById("highlight-sort");
  const listEl           = document.getElementById("highlight-list");

  let editingNoteId = null;  // id of the note currently open in the edit form, or null
  let focusId = params.get("focus");  // note to scroll to when arriving from search

  wireExportButtons(async () => {
    const course = (await getCourseTree())[courseName];
    return course?.topics?.[topicName] ? { courseName, course, topicName } : null;
  });

  async function draw() {
    if (editingNoteId !== null) return;  // don't wipe an open edit form

    const courses = await getCourseTree();
    const topic = courses[courseName]?.topics?.[topicName];
    listEl.innerHTML = "";

    if (!topic) {
      listEl.innerHTML = '<div class="empty-state">Topic not found.</div>';
      return;
    }

    let notes = Object.entries(topic.highlights || {}).map(([id, fields]) => ({ id, ...fields }));

    if (categoryFilter.value) {
      notes = notes.filter((n) => n.category === categoryFilter.value);
    }

    notes = sortHighlights(notes, sortSel.value);

    if (notes.length === 0) {
      listEl.innerHTML = categoryFilter.value
        ? '<div class="empty-state">No notes of this kind.</div>'
        : '<div class="empty-state">No notes yet. Turn the highlighter on and select text on a page.</div>';
      return;
    }

    notes.forEach((note) => {
      const el = renderNote(note);
      const edit = () => { if (editingNoteId === null) expandToEdit(el, note); };
      el.addEventListener("click", edit);
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && e.target === el) { e.preventDefault(); edit(); }
      });
      listEl.appendChild(el);
    });

    if (focusId) {
      const target = listEl.querySelector(`[data-id="${CSS.escape(focusId)}"]`);
      if (target) {
        target.classList.add("focused");
        target.scrollIntoView({ block: "center" });
      }
      focusId = null;  // only on first draw
    }
  }

  function expandToEdit(card, note) {
    editingNoteId = note.id;

    const field = (labelText, control) => {
      const label = document.createElement("label");
      label.textContent = labelText;
      form.append(label, control);
    };

    const textArea = document.createElement("textarea");
    textArea.value = note.text;
    textArea.rows = 3;

    const categorySel = document.createElement("select");
    CATEGORIES.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = CATEGORY_LABELS[c] || c;
      if (c === note.category) opt.selected = true;
      categorySel.appendChild(opt);
    });

    const annotationArea = document.createElement("textarea");
    annotationArea.placeholder = "Your own note about this (optional)";
    annotationArea.value = note.annotation || "";
    annotationArea.rows = 2;

    const contextArea = document.createElement("textarea");
    contextArea.placeholder = "Surrounding text (optional)";
    contextArea.value = note.context || "";
    contextArea.rows = 2;

    const form = document.createElement("div");
    form.className = "edit-form";
    form.addEventListener("click", (e) => e.stopPropagation());
    field("Text", textArea);
    field("Type", categorySel);
    field("Annotation", annotationArea);
    field("Context", contextArea);
    const footer = document.createElement("div");
    footer.className = "edit-form-footer";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "edit-btn";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      editingNoteId = null;
      draw();
    });

    const saveBtn = document.createElement("button");
    saveBtn.className = "edit-btn primary";
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await updateHighlightInStorage(note.id, courseName, topicName, {
        text:       textArea.value,
        category:   categorySel.value,
        context:    contextArea.value || null,
        annotation: annotationArea.value || null
      });
      editingNoteId = null;
      draw();
    });

    const deleteBtn = makeDeleteButton("Delete note?", async () => {
      const ok = await sendDelete({
        type: "DELETE_HIGHLIGHT", id: note.id, courseName, topicName
      });
      if (ok) {
        editingNoteId = null;
        draw();
      }
      return ok;
    });
    deleteBtn.classList.add("push-left");

    footer.appendChild(deleteBtn);
    footer.appendChild(cancelBtn);
    footer.appendChild(saveBtn);
    form.appendChild(footer);

    // Esc cancels, Ctrl/Cmd+Enter saves.
    form.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); cancelBtn.click(); }
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveBtn.click(); }
    });

    card.replaceWith(form);
    textArea.focus();
  }

  categoryFilter.addEventListener("change", draw);
  sortSel.addEventListener("change", draw);

  await draw();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.lazynotes) draw();
  });
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

const page = document.body.dataset.page;
if (page === "courses") renderCourses();
if (page === "topics")  renderTopics();
if (page === "display") renderDisplay();
