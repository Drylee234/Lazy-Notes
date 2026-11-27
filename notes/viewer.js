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

// ✎ — rename (shows on hover, like Delete).
function makeRenameButton(title, onRename) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "delete-btn rename-btn";
  btn.textContent = "✎";
  btn.title = title;
  btn.setAttribute("aria-label", title);
  btn.addEventListener("click", (e) => { e.stopPropagation(); onRename(); });
  return btn;
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

// Highlights and notes typed in the side panel.
function countNotes(course) {
  return Object.values(course?.topics || {})
    .reduce((sum, t) => sum + Object.keys(t.highlights || {}).length + Object.keys(t.notes || {}).length, 0);
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
      right.appendChild(makeRenameButton(`Rename "${name}"`, () => lnRenamePrompt({ type: "RENAME_COURSE", courseName: name }, name)));
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

    const home = document.getElementById("home-sections") || listEl;
    home.hidden      = searching;
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

  // "Recent notes": the topics you last took notes in, newest first, to
  // carry on where you left off.
  function drawRecentNotes() {
    const grid = document.getElementById("recent-notes-grid");
    if (!grid) return;
    const tops = [];
    Object.entries(courses).forEach(([courseName, course]) => {
      Object.entries(course.topics || {}).forEach(([topicName, topic]) => {
        const all = [
          ...Object.values(topic.highlights || {}).map((n) => ({ ...n, kind: "highlight" })),
          ...Object.values(topic.notes || {}).map((n) => ({ ...n, kind: "typed" }))
        ].filter((n) => n.timestamp);
        if (!all.length) return;
        const last = all.reduce((a, b) => (Date.parse(b.edited || b.timestamp) > Date.parse(a.edited || a.timestamp) ? b : a));
        tops.push({ courseName, topicName, count: all.length, last, at: Date.parse(last.edited || last.timestamp) || 0 });
      });
    });
    tops.sort((a, b) => b.at - a.at);
    grid.replaceChildren();
    document.querySelector(".rn-empty").hidden = tops.length > 0;
    const cards = [];
    tops.slice(0, 30).forEach((t) => {
      const a = document.createElement("a");
      a.className = "rnote-card";
      a.href = `display.html?course=${encodeURIComponent(t.courseName)}&topic=${encodeURIComponent(t.topicName)}`;
      const head = document.createElement("div");
      head.className = "rnote-head";
      const topic = document.createElement("span");
      topic.className = "rnote-topic";
      topic.textContent = t.topicName;
      const when = document.createElement("span");
      when.className = "rnote-when";
      when.textContent = timeAgo(t.at);
      head.append(topic, when);
      const course = document.createElement("div");
      course.className = "rnote-course";
      course.textContent = `${t.courseName} · ${plural(t.count, "note")}`;
      const snip = document.createElement("div");
      snip.className = "rnote-snip";
      const txt = String(t.last.text || "")
        .replace(/^\s*(#{1,3}|[-*•>]|\d+[.)])\s+/gm, "")   // line markers: headings, points, quotes
        .replace(/\*\*|==/g, "")                         // **bold**, ==mark==
        .replace(/(^|\s)[*_](?=\S)|(?<=\S)[*_](?=\s|$)/g, "$1")   // *italic*
        .replace(/\s+/g, " ").trim();
      snip.textContent = txt.length > 110 ? txt.slice(0, 107) + "…" : txt;
      a.append(head, course, snip);
      grid.appendChild(a);
      cards.push(a);
    });
    if (typeof seeMore === "function") seeMore(grid, cards, "topics");
  }

  drawCourses();
  drawRecentNotes();
  drawSearch();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.lazynotes) return;
    courses = changes.lazynotes.newValue?.courses ?? {};
    drawCourses();
    drawRecentNotes();
    drawSearch();
  });
}

function timeAgo(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) { const d = Math.floor(s / 86400); return d === 1 ? "yesterday" : `${d} days ago`; }
  return formatWhen(new Date(ms).toISOString());
}

// ---------------------------------------------------------------------------
// Settings (⚙ in the top bar): the same controls as the side panel's menu
// ---------------------------------------------------------------------------

(function initSettingsDialog() {
  const btn = document.getElementById("open-settings");
  if (!btn || !globalThis.LazySettings) return;
  const dlg = document.createElement("dialog");
  dlg.className = "settings-dialog";
  dlg.setAttribute("aria-label", "Settings");
  const head = document.createElement("div");
  head.className = "settings-head";
  const h = document.createElement("h2");
  h.textContent = "Settings";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "settings-close";
  close.textContent = "×";
  close.setAttribute("aria-label", "Close settings");
  close.addEventListener("click", () => dlg.close());
  head.append(h, close);
  dlg.appendChild(head);
  LazySettings.build(dlg);
  const note = document.createElement("p");
  note.className = "settings-note";
  note.textContent = "Saved straight away, and the same in the side panel's ⚙ menu.";
  dlg.appendChild(note);
  document.body.appendChild(dlg);
  btn.addEventListener("click", () => dlg.showModal());
  // Click on the backdrop closes it.
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
})();

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

  // The PDFs / slides / Word files this course's notes came from.
  async function drawDocs() {
    const box = document.getElementById("course-docs-page");
    const grid = document.getElementById("course-docs-page-list");
    if (!box) return;
    const c = (await getCourseTree())[courseName];
    const { lnDocs = {}, lnCourseDocHide = {} } = await chrome.storage.local.get(["lnDocs", "lnCourseDocHide"]);
    const docs = c ? courseDocuments(courseName, c, lnDocs, lnCourseDocHide[courseName] || []) : [];
    grid.replaceChildren(...docs.map((d) => {
      const wrap = document.createElement("div");
      wrap.className = "course-doc-wrap";
      const a = document.createElement("a");
      a.className = "course-doc-card";
      a.href = d.open;
      a.innerHTML = `<span class="course-doc-kind"></span><span class="course-doc-name"></span><span class="course-doc-meta"></span>`;
      a.children[0].textContent = { pdf: "PDF", pptx: "PPT", docx: "DOC" }[d.kind] || "DOC";
      a.children[0].dataset.kind = d.kind;
      a.children[1].textContent = d.name;
      a.children[2].textContent = [d.notes ? `${d.notes} note${d.notes === 1 ? "" : "s"}` : "opened", [...d.topics].join(", ")].filter(Boolean).join(" · ");
      const x = document.createElement("button");
      x.type = "button";
      x.className = "course-doc-x";
      x.textContent = "✕";
      x.title = "Remove from this course (your notes stay)";
      x.setAttribute("aria-label", `Remove ${d.name} from this course`);
      x.addEventListener("click", () => hideCourseDoc(courseName, d.key));   // redraws on storage change
      wrap.append(a, x);
      return wrap;
    }));
    // The section stays for its "+ Open a document…" button.
    box.hidden = !c;
  }
  document.getElementById("course-open-doc")?.addEventListener("click", () => {
    const msg = document.getElementById("course-open-doc-msg");
    LazyOpenDoc.pick({ course: courseName, onMessage: (t) => { msg.textContent = t; msg.hidden = !t; } });
  });
  drawDocs();
  chrome.storage.onChanged.addListener((c, area) => { if (area === "local" && (c.lazynotes || c.lnDocs || c.lnCourseDocHide)) drawDocs(); });
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
      highlightCount: Object.keys(t.highlights || {}).length + Object.keys(t.notes || {}).length
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
      right.appendChild(makeRenameButton(`Rename "${topic.name}"`, () => lnRenamePrompt({ type: "RENAME_TOPIC", courseName, topicName: topic.name }, topic.name)));
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
  let shown = [];            // the notes on screen, in order
  let canArrange = false;    // move / indent only while showing everything "As taken"
  let refocusId = null;      // note to give the keyboard back to after a redraw
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

    const highlights = Object.entries(topic.highlights || {}).map(([id, fields]) => ({ id, ...fields }));
    // Notes typed in the side panel: shown in time order among the
    // highlights (after them when sorted by type), edited in the panel.
    const typed = Object.entries(topic.notes || {}).map(([id, fields]) => ({ id, kind: "typed", ...fields }));

    // What sits under what (headers, sub topics, list heads), in page order.
    const inOrder = sortHighlights([...highlights, ...typed], "chronological");
    const parent = noteParents(inOrder);
    const contextIds = new Set();

    let notes;
    if (categoryFilter.value) {
      // A filter shows the matches under the heads they belong to (quietly).
      let match = inOrder.filter((n) => n.kind !== "typed" && n.category === categoryFilter.value);
      if (categoryFilter.value === "list head") {
        // List heads come with their points (a Plain line over points counts as one).
        const heads = new Set();
        parent.forEach((p, id) => { const n = inOrder.find((x) => String(x.id) === id); if (n?.category === "list point" && p) heads.add(p); });
        match = inOrder.filter((n) => n.kind !== "typed" && (n.category === "list head" || heads.has(String(n.id)) ||
          (n.category === "list point" && heads.has(parent.get(String(n.id))))));
      }
      const keep = new Set(match.map((n) => String(n.id)));
      match.forEach((n) => {
        for (let a = parent.get(String(n.id)); a; a = parent.get(a)) if (!keep.has(a)) { keep.add(a); contextIds.add(a); }
      });
      notes = sortSel.value === "category" ? sortHighlights(match, "category")
        : inOrder.filter((n) => keep.has(String(n.id)));
      if (sortSel.value !== "category" && sortSel.value !== "chronological") notes = sortHighlights(notes, sortSel.value);
    } else {
      notes = sortSel.value === "category"
        ? [...sortHighlights(highlights, "category"), ...sortHighlights(typed, "chronological")]
        : sortHighlights([...highlights, ...typed], sortSel.value);
    }

    shown = notes;
    canArrange = !categoryFilter.value && sortSel.value === "chronological";
    listEl.classList.toggle("can-arrange", canArrange);
    if (notes.length === 0) {
      listEl.innerHTML = categoryFilter.value
        ? '<div class="empty-state">No notes of this kind.</div>'
        : '<div class="empty-state">No notes yet. Turn the highlighter on and select text on a page.</div>';
      return;
    }

    notes.forEach((note) => {
      if (note.kind === "typed") {
        const el = renderTypedNote(note);
        el.title = "Click to edit";
        const editT = () => { if (editingNoteId === null) editTyped(el, note); };
        el.addEventListener("click", (e) => { if (!e.target.closest("button, a, .note-tools")) editT(); });
        el.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && e.target === el) { e.preventDefault(); editT(); }
        });
        arrangeable(el, note);
        // × then "Delete?" (4s to confirm), like the Study tab.
        const del = document.createElement("button");
        del.type = "button";
        del.className = "typed-del";
        del.textContent = "×";
        del.title = "Delete this note";
        let armed = null;
        del.addEventListener("click", async (e) => {
          e.stopPropagation();
          if (!armed) {
            del.textContent = "Delete?";
            del.classList.add("armed");
            armed = setTimeout(() => { armed = null; del.textContent = "×"; del.classList.remove("armed"); }, 4000);
            return;
          }
          clearTimeout(armed);
          del.disabled = true;
          const ok = await sendDelete({ type: "DELETE_TYPED_NOTE", id: note.id, courseName, topicName });
          if (!ok) { del.disabled = false; armed = null; del.textContent = "×"; del.classList.remove("armed"); }
        });
        el.appendChild(del);
        listEl.appendChild(el);
        return;
      }

      const el = renderNote(note);
      arrangeable(el, note);
      if (contextIds.has(String(note.id))) el.classList.add("note--context");
      const edit = () => { if (editingNoteId === null) expandToEdit(el, note); };
      el.addEventListener("click", edit);
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && e.target === el) { e.preventDefault(); edit(); }
      });
      listEl.appendChild(el);
    });

    // Fold / unfold under heads (page order only; not while filtering).
    if (!categoryFilter.value && sortSel.value === "chronological") LnFold.apply(listEl, notes);

    if (refocusId) {
      listEl.querySelector(`.note[data-id="${CSS.escape(refocusId)}"]`)?.focus({ preventScroll: false });
      refocusId = null;
    }
    if (focusId) {
      const target = listEl.querySelector(`[data-id="${CSS.escape(focusId)}"]`);
      if (target) {
        target.classList.add("focused");
        target.scrollIntoView({ block: "center" });
      }
      focusId = null;  // only on first draw
    }
  }

  // The shared editor (note-editor.js): only the text shows at first.
  function expandToEdit(card, note) {
    editingNoteId = note.id;
    const close = () => {
      editingNoteId = null;
      draw();
    };

    const form = noteEditor(note, {
      onSave: async (fields) => {
        await saveHighlightEdit(note.id, courseName, topicName, fields);
        close();
      },
      onCancel: close,
      // 📖 Define: the definition becomes its own note in this topic.
      onAiNote: async ({ text, category }) => {
        const reply = await new Promise((r) => {
          try {
            chrome.runtime.sendMessage({ type: "AI_SAVE_NOTE", text, category, courseName, topicName }, (x) => {
              void chrome.runtime.lastError;
              r(x);
            });
          } catch (_) { r(null); }
        });
        return !!reply?.ok;
      },
      // Type "My note": becomes one of your typed notes (annotation kept as
      // a line under it), in the same place; the highlight goes.
      onConvert: async (fields) => {
        const text = fields.annotation ? `${fields.text}\n${fields.annotation}` : fields.text;
        const id = crypto.randomUUID();
        const r = await ask({ type: "SAVE_TYPED_NOTE", id, courseName, topicName, text });
        if (r?.ok) {
          await ask({ type: "SET_ARRANGEMENT", courseName, topicName,
            items: [{ kind: "typed", id, order: noteOrder(note), indent: note.indent || 0 }] });
          await ask({ type: "DELETE_HIGHLIGHT", id: note.id, courseName, topicName });
        }
        close();
      },
      onDelete: async () => {
        const ok = await sendDelete({ type: "DELETE_HIGHLIGHT", id: note.id, courseName, topicName });
        if (ok) close();
        return ok;
      }
    });

    card.replaceWith(form);
    form.focusText();
  }

  // ── Total control, like the Study tab ─────────────────────────────────
  // Typed notes edit in place (the same formatted box as Study: Enter saves,
  // Shift+Enter new line, Esc cancels, a click elsewhere saves). Every note
  // can be moved and indented: hover its left margin for ↑ ↓ ⇤ ⇥, or focus
  // it and press Alt+↑ ↓ ← →. Only while showing everything "As taken".
  function ask(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (r) => resolve(chrome.runtime.lastError ? { ok: false, reason: chrome.runtime.lastError.message } : r));
      } catch (err) { resolve({ ok: false, reason: String(err) }); }
    });
  }

  function editTyped(el, note) {
    if (!globalThis.createRichBox) return;
    editingNoteId = note.id;
    const input = createRichBox();
    input.classList.add("typed-editor");
    input.value = note.text;
    input.setAttribute("aria-label", "Edit note");
    const bar = createFormatBar(input);
    const hint = document.createElement("div");
    hint.className = "typed-editor-hint";
    hint.textContent = "Enter saves · Shift+Enter new line · Esc cancels";
    el.querySelector(".note-text").replaceWith(input);
    input.before(bar);
    input.after(hint);
    el.querySelectorAll(".typed-del, .note-tools, .fold-btn, .fold-count").forEach((x) => x.remove());
    el.classList.add("editing");
    el.removeAttribute("title");
    input.focus();
    input.caretToEnd?.();
    let done = false;
    const finish = async (save) => {
      if (done) return;
      done = true;
      document.removeEventListener("pointerdown", outside, true);
      const text = input.value.trim();
      if (save && text && text !== note.text) {
        const r = await ask({ type: "SAVE_TYPED_NOTE", id: note.id, courseName, topicName, text });
        if (!r?.ok) alert(`Couldn't save your note: ${r?.reason || "unknown error"}`);
      }
      editingNoteId = null;
      refocusId = note.id;
      draw();
    };
    const outside = (e) => { if (!el.contains(e.target) && !e.target.closest?.(".ln-spell-bar")) finish(true); };
    setTimeout(() => document.addEventListener("pointerdown", outside, true), 0);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); finish(false); }
      else if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); finish(true); }
    });
  }

  const kindOf = (n) => (n.kind === "typed" ? "typed" : "highlight");
  function arrangeable(el, note) {
    const nest = Math.max(0, Math.min(3, note.indent || 0));
    if (nest && canArrange) {
      el.dataset.nest = String(nest);
      el.style.setProperty("--nest-px", `${nest * 18}px`);
    }
    if (!canArrange) return;
    const tools = document.createElement("span");
    tools.className = "note-tools";
    const btn = (label, title, run) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "note-indent";
      b.tabIndex = -1;
      b.textContent = label;
      b.title = title;
      b.setAttribute("aria-label", title);
      b.addEventListener("click", (e) => { e.stopPropagation(); run(); });
      return b;
    };
    tools.append(
      btn("↑", "Move up (Alt+↑)", () => moveBy(note, -1)),
      btn("↓", "Move down (Alt+↓)", () => moveBy(note, 1)),
      btn("⇤", "Outdent (Alt+←)", () => indentBy(note, -1)),
      btn("⇥", "Indent: nest under the note above (Alt+→)", () => indentBy(note, 1)));
    el.prepend(tools);
    el.addEventListener("keydown", (e) => {
      if (!e.altKey || e.target !== el) return;
      const act = { ArrowUp: () => moveBy(note, -1), ArrowDown: () => moveBy(note, 1),
        ArrowLeft: () => indentBy(note, -1, e.shiftKey), ArrowRight: () => indentBy(note, 1, e.shiftKey) }[e.key];
      if (act) { e.preventDefault(); act(); }
    });
  }

  function arrange(items, id) {
    refocusId = id;
    ask({ type: "SET_ARRANGEMENT", courseName, topicName, items }).then((r) => {
      if (!r?.ok) alert(`Couldn't arrange: ${r?.reason || "unknown error"}`);
    });
  }
  // Same as the Study tab: the notes under it come along (Alt+Shift+arrow,
  // or Settings › Old ways › lnIndentAlone: just this one).
  let indentAlone = false;
  chrome.storage.local.get("lnIndentAlone", (r) => { indentAlone = r?.lnIndentAlone === true; });
  chrome.storage.onChanged.addListener((c, a) => { if (a === "local" && "lnIndentAlone" in c) indentAlone = c.lnIndentAlone.newValue === true; });
  function indentBy(note, delta, alone = false) {
    const plan = indentPlan(shown, [note], delta, alone || indentAlone);
    if (plan.items.length) arrange(plan.items, note.id);
    else if (plan.stuck && delta > 0) alert("Can't indent further: notes go 3 levels deep at most.");
  }
  // Same as the Study tab: the note's order goes between its new
  // neighbours, or the topic is renumbered when they're too close.
  function moveBy(note, step) {
    const was = shown.indexOf(note);
    const rest = shown.filter((n) => n !== note);
    const to = Math.max(0, Math.min(rest.length, was + step));
    if (was < 0 || to === was) return;
    const prev = rest[to - 1], next = rest[to];
    const o = (n) => noteOrder(n);
    let order = prev && next ? (o(prev) + o(next)) / 2 : prev ? o(prev) + 1000 : o(next) - 1000;
    let items = [{ kind: kindOf(note), id: note.id, order }];
    if (prev && next && (o(next) - o(prev) < 0.01 || order === o(prev) || order === o(next))) {
      const list = [...rest.slice(0, to), note, ...rest.slice(to)];
      const base = o(list[0]);
      items = list.map((n, i) => ({ kind: kindOf(n), id: n.id, order: base + i * 1000 }));
    }
    arrange(items, note.id);
  }

  // The ↑ ↓ ⇤ ⇥ card shows while the mouse is in a note's left margin.
  let toolsNear = null;
  listEl.addEventListener("mousemove", (e) => {
    const el = e.target.closest?.(".note[data-id]");
    const near = el && (e.clientX - el.getBoundingClientRect().left < 44 || e.target.closest(".note-tools")) ? el : null;
    if (near === toolsNear) return;
    toolsNear?.classList.remove("tools-near");
    near?.classList.add("tools-near");
    toolsNear = near;
  });
  listEl.addEventListener("mouseleave", () => { toolsNear?.classList.remove("tools-near"); toolsNear = null; });

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
