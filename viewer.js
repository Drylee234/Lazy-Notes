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
// Page 1 — courses.html
// ---------------------------------------------------------------------------

async function renderCourses() {
  const courses = await getCourseTree();
  const listEl = document.getElementById("course-list");
  listEl.innerHTML = "";

  const names = Object.keys(courses);

  if (names.length === 0) {
    listEl.innerHTML = '<div class="empty-state">No courses yet.</div>';
    return;
  }

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
    meta.className = "list-row-meta";
    meta.textContent = [course.level, course.semester].filter(Boolean).join(" · ") || "—";
    left.appendChild(title);
    left.appendChild(meta);

    const right = document.createElement("div");
    right.className = "list-row-meta";
    right.textContent = `${topicCount} topic${topicCount === 1 ? "" : "s"}`;

    row.appendChild(left);
    row.appendChild(right);

    row.addEventListener("click", () => {
      window.location.href = `topics.html?course=${encodeURIComponent(name)}`;
    });

    listEl.appendChild(row);
  });
}

// ---------------------------------------------------------------------------
// Page 2 — topics.html
// ---------------------------------------------------------------------------

async function renderTopics() {
  const params = new URLSearchParams(window.location.search);
  const courseName = params.get("course");

  document.getElementById("course-heading").textContent = courseName || "Unknown course";

  const courses = await getCourseTree();
  const course = courses[courseName];
  const listEl = document.getElementById("topic-list");
  const sortSel = document.getElementById("topic-sort");

  function draw() {
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
      listEl.innerHTML = '<div class="empty-state">No topics for this course yet.</div>';
      return;
    }

    const sorted = sortTopics(topics, sortSel.value);

    sorted.forEach((topic) => {
      const row = document.createElement("div");
      row.className = "list-row";

      const title = document.createElement("div");
      title.className = "list-row-title";
      title.textContent = topic.name;

      const meta = document.createElement("div");
      meta.className = "list-row-meta";
      meta.textContent = `${topic.highlightCount} note${topic.highlightCount === 1 ? "" : "s"}`;

      row.appendChild(title);
      row.appendChild(meta);

      row.addEventListener("click", () => {
        window.location.href =
          `display.html?course=${encodeURIComponent(courseName)}&topic=${encodeURIComponent(topic.name)}`;
      });

      listEl.appendChild(row);
    });
  }

  sortSel.addEventListener("change", draw);
  draw();
}

// ---------------------------------------------------------------------------
// Page 3 — display.html
// ---------------------------------------------------------------------------

async function renderDisplay() {
  const params = new URLSearchParams(window.location.search);
  const courseName = params.get("course");
  const topicName  = params.get("topic");

  document.getElementById("topic-heading").textContent = topicName || "Unknown topic";
  document.getElementById("back-link").href =
    `topics.html?course=${encodeURIComponent(courseName || "")}`;

  const categoryFilter = document.getElementById("category-filter");
  const sortSel         = document.getElementById("highlight-sort");
  const listEl           = document.getElementById("highlight-list");
  const metaPanel        = document.getElementById("meta-panel");

  let metaTimeout = null;
  let editingNoteId = null;  // id of the note currently open in the edit form, or null

  function showMeta(event, note) {
    clearTimeout(metaTimeout);
    metaTimeout = setTimeout(() => {
      metaPanel.innerHTML = "";
      const rows = [{ label: "Category:", value: note.category }];

      if (note.sourceUrl) {
        try {
          const u = new URL(note.sourceUrl);
          rows.push({ label: "Source:", value: u.hostname + u.pathname });
        } catch (_) {
          rows.push({ label: "Source:", value: note.sourceUrl });
        }
      }

      if (note.timestamp) {
        rows.push({ label: "Saved:", value: new Date(note.timestamp).toLocaleString() });
      }
      if (note.edited) {
        rows.push({ label: "Edited:", value: new Date(note.edited).toLocaleString() });
      }
      if (note.context)    rows.push({ label: "Context:",    value: note.context });
      if (note.annotation) rows.push({ label: "Annotation:", value: note.annotation });

      rows.forEach(({ label, value }) => {
        const row = document.createElement("div");
        row.className = "mp-row";
        const l = document.createElement("span");
        l.className = "mp-row-label";
        l.textContent = label;
        const v = document.createElement("span");
        v.className = "mp-row-value";
        v.textContent = value;
        row.appendChild(l);
        row.appendChild(v);
        metaPanel.appendChild(row);
      });

      metaPanel.style.top  = `${event.clientY + 12}px`;
      metaPanel.style.left = `${event.clientX + 12}px`;
      metaPanel.classList.remove("mp-hidden");
    }, 250);
  }

  function hideMeta() {
    clearTimeout(metaTimeout);
    metaPanel.classList.add("mp-hidden");
  }

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
      listEl.innerHTML = '<div class="empty-state">No notes match this filter.</div>';
      return;
    }

    notes.forEach((note) => {
      const card = document.createElement("div");
      card.className = "highlight-card";

      const tag = document.createElement("div");
      tag.className = "highlight-category-tag";
      tag.textContent = note.category;

      const line = document.createElement("div");
      line.className = "highlight-line";
      line.textContent = note.text;

      card.appendChild(tag);
      card.appendChild(line);

      card.addEventListener("mouseenter", (e) => showMeta(e, note));
      card.addEventListener("mouseleave", hideMeta);

      card.addEventListener("click", () => {
        if (card.dataset.editing === "true") return;
        hideMeta();
        expandToEdit(card, note);
      });

      listEl.appendChild(card);
    });
  }

  function expandToEdit(card, note) {
    card.dataset.editing = "true";
    editingNoteId = note.id;
    card.innerHTML = "";

    const textArea = document.createElement("textarea");
    textArea.value = note.text;
    textArea.rows = 3;

    const categorySel = document.createElement("select");
    CATEGORIES.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      if (c === note.category) opt.selected = true;
      categorySel.appendChild(opt);
    });

    const contextArea = document.createElement("textarea");
    contextArea.placeholder = "Context (optional)";
    contextArea.value = note.context || "";
    contextArea.rows = 2;

    const annotationArea = document.createElement("textarea");
    annotationArea.placeholder = "Annotation (optional)";
    annotationArea.value = note.annotation || "";
    annotationArea.rows = 2;

    const form = document.createElement("div");
    form.className = "edit-form";
    form.appendChild(textArea);
    form.appendChild(categorySel);
    form.appendChild(contextArea);
    form.appendChild(annotationArea);

    const footer = document.createElement("div");
    footer.className = "edit-form-footer";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "edit-btn";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      card.dataset.editing = "false";
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
      card.dataset.editing = "false";
      editingNoteId = null;
      draw();
    });

    footer.appendChild(cancelBtn);
    footer.appendChild(saveBtn);
    form.appendChild(footer);

    card.appendChild(form);
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
