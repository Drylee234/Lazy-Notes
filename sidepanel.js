// Lazy Notes — Side Panel

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let allCourses        = [];   // [{ id, name, year, semester, details, topicCount }, ...]
let availableTopics   = {};   // { [courseId]: [{ id, name }, ...] }

let activeCourseId    = null;
let activeTopicId     = null;

// Which course is selected in each view's dropdown
let homeSelectedCourseId  = null;
let studySelectedCourseId = null;

// Which topic is selected in the study view tab strip
let studySelectedTopicId  = null;

// Pending topic creation — set when background tells us to open the topic
// modal for a specific course (after course creation or context menu)
let pendingTopicCourseId   = null;
let pendingTopicCourseName = null;

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const toggleBtn         = document.getElementById("toggle-btn");
const viewTabs          = document.querySelectorAll(".view-tab");
const homeView          = document.getElementById("home-view");
const studyView         = document.getElementById("study-view");

// Home
const homeCourseSelect  = document.getElementById("home-course-select");
const homeTopicList     = document.getElementById("home-topic-list");
const lastHighlightsEl  = document.getElementById("last-highlights");
const openCreateCourse  = document.getElementById("open-create-course");
const openCreateTopic   = document.getElementById("open-create-topic");

// Study
const studyCourseSelect = document.getElementById("study-course-select");
const topicTabs         = document.getElementById("topic-tabs");
const noteList          = document.getElementById("note-list");
const emptyStudy        = document.getElementById("empty-study");

// Footer
const noteCount         = document.getElementById("note-count");
const exportBtn         = document.getElementById("export-btn");

// Meta panel
const metaPanel         = document.getElementById("meta-panel");

// Create Course modal
const createCourseModal = document.getElementById("create-course-modal");
const ccName            = document.getElementById("cc-name");
const ccYear            = document.getElementById("cc-year");
const ccSemester        = document.getElementById("cc-semester");
const ccDetails         = document.getElementById("cc-details");
const ccCancel          = document.getElementById("cc-cancel");
const ccSubmit          = document.getElementById("cc-submit");

// Create Topic modal
const createTopicModal  = document.getElementById("create-topic-modal");
const ctSubtitle        = document.getElementById("ct-subtitle");
const ctName            = document.getElementById("ct-name");
const ctDetails         = document.getElementById("ct-details");
const ctCancel          = document.getElementById("ct-cancel");
const ctSubmit          = document.getElementById("ct-submit");

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init() {
  const stored = await storageGet([
    "highlighterActive",
    "activeCourse",
    "activeCourseId",
    "activeTopic",
    "availableTopics",
    "lastHighlights",
    "notesUpdatedAt"
  ]);

  activeCourseId  = stored.activeCourseId ?? null;
  activeTopicId   = stored.activeTopic?.id ?? null;
  availableTopics = stored.availableTopics ?? {};

  setToggleBtn(stored.highlighterActive ?? false);
  renderLastHighlights(stored.lastHighlights ?? []);

  await loadCourses();

  homeSelectedCourseId  = activeCourseId;
  studySelectedCourseId = activeCourseId;

  renderHomeCourseSelect();
  renderStudyCourseSelect();

  await loadHomeTopics(homeSelectedCourseId);
  await loadStudyTopics(studySelectedCourseId);
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

function storageGet(keys) {
  return new Promise((resolve) =>
    chrome.storage.local.get(keys, (r) => resolve(r))
  );
}

// ---------------------------------------------------------------------------
// Courses — load from Flask
// ---------------------------------------------------------------------------

async function loadCourses() {
  try {
    const response = await fetch("http://localhost:5000/listCourses");
    if (!response.ok) return;
    allCourses = await response.json();

    // Keep storage mirror of { id, name } pairs for background + content scripts
    const coursesMirror = allCourses.map((c) => ({ id: c.id, name: c.name }));
    chrome.storage.local.set({ availableCourses: coursesMirror });
  } catch (err) {
    console.error("LazyNotes [Panel]: loadCourses failed ->", err.message);
  }
}

// ---------------------------------------------------------------------------
// Course select renders (shared pattern)
// ---------------------------------------------------------------------------

function populateCourseSelect(selectEl, selectedId) {
  const currentVal = selectEl.value;
  selectEl.innerHTML = '<option value="">— select a course —</option>';

  allCourses.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = String(c.id);
    opt.textContent = `${c.name} · Y${c.year} S${c.semester}`;
    if (c.id === selectedId) opt.selected = true;
    selectEl.appendChild(opt);
  });

  // Restore selection if it was set before allCourses loaded
  if (!selectedId && currentVal) selectEl.value = currentVal;
}

function renderHomeCourseSelect() {
  populateCourseSelect(homeCourseSelect, homeSelectedCourseId);
}

function renderStudyCourseSelect() {
  populateCourseSelect(studyCourseSelect, studySelectedCourseId);
}

// ---------------------------------------------------------------------------
// Home — topic list
// ---------------------------------------------------------------------------

async function loadHomeTopics(courseId) {
  homeTopicList.innerHTML = "";

  if (!courseId) return;

  const topics = await fetchTopics(courseId);

  if (topics.length === 0) {
    const empty = document.createElement("div");
    empty.style.cssText = "font-size:12px;color:var(--dim);padding:4px 0;";
    empty.textContent = "No topics yet — create one below.";
    homeTopicList.appendChild(empty);
    return;
  }

  topics.forEach((topic) => {
    const row = document.createElement("div");
    row.className = "topic-row";
    if (topic.id === activeTopicId) row.classList.add("active");

    const name = document.createElement("span");
    name.className = "topic-name";
    name.textContent = topic.name;

    const meta = document.createElement("span");
    meta.className = "topic-meta";
    meta.textContent = `${topic.highlightCount ?? 0} note${topic.highlightCount === 1 ? "" : "s"}`;

    row.appendChild(name);
    row.appendChild(meta);

    row.addEventListener("click", () => {
      chrome.runtime.sendMessage({
        type:       "SET_ACTIVE_TOPIC",
        topicId:    topic.id,
        topicName:  topic.name,
        courseId,
        courseName: allCourses.find((c) => c.id === courseId)?.name ?? ""
      });
      activeTopicId = topic.id;
      renderHomeTopicList(topics);
    });

    homeTopicList.appendChild(row);
  });
}

function renderHomeTopicList(topics) {
  // Re-render just the active state, not a full reload
  homeTopicList.querySelectorAll(".topic-row").forEach((row, i) => {
    row.classList.toggle("active", topics[i]?.id === activeTopicId);
  });
}

// ---------------------------------------------------------------------------
// Study — topic tabs + notes
// ---------------------------------------------------------------------------

async function loadStudyTopics(courseId) {
  topicTabs.innerHTML = "";
  noteList.innerHTML  = "";
  emptyStudy.style.display = "none";

  if (!courseId) {
    emptyStudy.style.display = "block";
    emptyStudy.textContent   = "Select a course to view notes.";
    return;
  }

  const topics = await fetchTopics(courseId);

  if (topics.length === 0) {
    emptyStudy.style.display = "block";
    emptyStudy.textContent   = "No topics for this course yet.";
    return;
  }

  // Select first topic if none active for this course, or restore the active one
  const topicForCourse = topics.find((t) => t.id === studySelectedTopicId)
    ?? topics[0];

  studySelectedTopicId = topicForCourse.id;

  topics.forEach((topic) => {
    const tab = document.createElement("button");
    tab.className = "topic-tab";
    tab.textContent = topic.name;
    if (topic.id === studySelectedTopicId) tab.classList.add("active");

    tab.addEventListener("click", () => {
      studySelectedTopicId = topic.id;
      topicTabs.querySelectorAll(".topic-tab").forEach((t) =>
        t.classList.toggle("active", t === tab)
      );
      loadNotes(topic.id);
    });

    topicTabs.appendChild(tab);
  });

  await loadNotes(studySelectedTopicId);
}

// ---------------------------------------------------------------------------
// Notes — load from Flask
// ---------------------------------------------------------------------------

async function loadNotes(topicId) {
  noteList.innerHTML      = "";
  emptyStudy.style.display = "none";

  if (!topicId) {
    emptyStudy.style.display = "block";
    return;
  }

  try {
    const response = await fetch(
      `http://localhost:5000/displayNotes?topicId=${topicId}`
    );

    if (!response.ok) {
      emptyStudy.style.display = "block";
      emptyStudy.textContent   = "Could not load notes.";
      return;
    }

    const notes = await response.json();

    if (notes.length === 0) {
      emptyStudy.style.display = "block";
      emptyStudy.textContent   = "No notes for this topic yet.";
      noteCount.textContent    = "";
      return;
    }

    noteCount.textContent = `${notes.length} note${notes.length === 1 ? "" : "s"}`;
    emptyStudy.style.display = "none";

    notes.forEach((note) => {
      const line = document.createElement("div");
      line.className = "note-line";
      line.textContent = stripHtml(note.html);
      line.dataset.id  = note.id;

      line.addEventListener("mouseenter", (e) => showMeta(e, note));
      line.addEventListener("mouseleave", hideMeta);

      noteList.appendChild(line);
    });
  } catch (err) {
    console.error("LazyNotes [Panel]: loadNotes failed ->", err.message);
    emptyStudy.style.display = "block";
    emptyStudy.textContent   = "Flask unreachable.";
  }
}

// ---------------------------------------------------------------------------
// Topics — fetch + cache
// ---------------------------------------------------------------------------

async function fetchTopics(courseId) {
  if (!courseId) return [];

  try {
    const response = await fetch(
      `http://localhost:5000/listTopics?courseId=${courseId}`
    );

    if (!response.ok) return [];

    const topics = await response.json();

    // Update local cache and storage
    availableTopics[String(courseId)] = topics.map((t) => ({
      id:   t.id,
      name: t.name
    }));

    chrome.storage.local.set({ availableTopics });

    return topics;
  } catch (err) {
    console.error("LazyNotes [Panel]: fetchTopics failed ->", err.message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Last highlights
// ---------------------------------------------------------------------------

function renderLastHighlights(highlights) {
  lastHighlightsEl.innerHTML = "";

  if (!highlights || highlights.length === 0) {
    const empty = document.createElement("div");
    empty.style.cssText = "font-size:12px;color:var(--dim);";
    empty.textContent   = "Nothing highlighted yet.";
    lastHighlightsEl.appendChild(empty);
    return;
  }

  highlights.forEach((h) => {
    const el = document.createElement("div");
    el.className = "last-highlight";

    const course = document.createElement("div");
    course.className = "lh-course";
    course.textContent = [h.course, h.topicName].filter(Boolean).join(" · ");

    el.appendChild(course);
    el.appendChild(document.createTextNode(h.text));
    lastHighlightsEl.appendChild(el);
  });
}

// ---------------------------------------------------------------------------
// Toggle button
// ---------------------------------------------------------------------------

function setToggleBtn(active) {
  toggleBtn.textContent = active ? "Highlighter on" : "Highlighter off";
  toggleBtn.classList.toggle("active", active);
}

toggleBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "TOGGLE_HIGHLIGHTER_REQUEST" });
});

// ---------------------------------------------------------------------------
// View tabs
// ---------------------------------------------------------------------------

viewTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    viewTabs.forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");

    const view = tab.dataset.view;
    homeView.classList.toggle("visible",  view === "home");
    studyView.classList.toggle("visible", view === "study");

    if (view === "study") {
      renderStudyCourseSelect();
      loadStudyTopics(studySelectedCourseId);
    }
  });
});

// ---------------------------------------------------------------------------
// Course select — home
// ---------------------------------------------------------------------------

homeCourseSelect.addEventListener("change", async () => {
  const id = parseInt(homeCourseSelect.value, 10) || null;
  homeSelectedCourseId = id;

  if (id) {
    const name = allCourses.find((c) => c.id === id)?.name ?? "";
    chrome.runtime.sendMessage({
      type:       "SET_ACTIVE_COURSE",
      courseId:   id,
      courseName: name
    });
  }

  await loadHomeTopics(id);
});

// ---------------------------------------------------------------------------
// Course select — study
// ---------------------------------------------------------------------------

studyCourseSelect.addEventListener("change", async () => {
  const id = parseInt(studyCourseSelect.value, 10) || null;
  studySelectedCourseId = id;
  studySelectedTopicId  = null;
  await loadStudyTopics(id);
});

// ---------------------------------------------------------------------------
// Create Course modal
// ---------------------------------------------------------------------------

openCreateCourse.addEventListener("click", () => openCourseModal());

function openCourseModal() {
  ccName.value     = "";
  ccYear.value     = "";
  ccSemester.value = "";
  ccDetails.value  = "";
  createCourseModal.classList.add("visible");
  createCourseModal.setAttribute("aria-hidden", "false");
  setTimeout(() => ccName.focus(), 50);
}

function closeCourseModal() {
  createCourseModal.classList.remove("visible");
  createCourseModal.setAttribute("aria-hidden", "true");
}

ccCancel.addEventListener("click", closeCourseModal);

ccSubmit.addEventListener("click", async () => {
  const name     = ccName.value.trim();
  const year     = ccYear.value;
  const semester = ccSemester.value;
  const details  = ccDetails.value.trim() || null;

  if (!name || !year || !semester) return;

  chrome.runtime.sendMessage({
    type: "CREATE_COURSE",
    name,
    year,
    semester,
    details
  });

  closeCourseModal();
});

// ── Prefill year/semester from last used defaults ──
chrome.storage.local.get("lastCourseDefaults", ({ lastCourseDefaults }) => {
  if (!lastCourseDefaults) return;
  if (lastCourseDefaults.year)     ccYear.value     = lastCourseDefaults.year;
  if (lastCourseDefaults.semester) ccSemester.value = lastCourseDefaults.semester;
});

// ---------------------------------------------------------------------------
// Create Topic modal
// ---------------------------------------------------------------------------

openCreateTopic.addEventListener("click", () => {
  const courseId = homeSelectedCourseId;
  if (!courseId) {
    // No course selected — nudge user to pick one first
    homeCourseSelect.focus();
    return;
  }
  const courseName = allCourses.find((c) => c.id === courseId)?.name ?? "";
  openTopicModal(courseId, courseName);
});

function openTopicModal(courseId, courseName) {
  pendingTopicCourseId   = courseId;
  pendingTopicCourseName = courseName;

  ctSubtitle.textContent = courseName
    ? `Adding topic to: ${courseName}`
    : "Add a topic to the selected course.";

  ctName.value    = "";
  ctDetails.value = "";

  createTopicModal.classList.add("visible");
  createTopicModal.setAttribute("aria-hidden", "false");
  setTimeout(() => ctName.focus(), 50);
}

function closeTopicModal() {
  createTopicModal.classList.remove("visible");
  createTopicModal.setAttribute("aria-hidden", "true");
  pendingTopicCourseId   = null;
  pendingTopicCourseName = null;
}

ctCancel.addEventListener("click", closeTopicModal);

ctSubmit.addEventListener("click", () => {
  const name    = ctName.value.trim();
  const details = ctDetails.value.trim() || null;

  if (!name || !pendingTopicCourseId) return;

  chrome.runtime.sendMessage({
    type:       "CREATE_TOPIC",
    courseId:   pendingTopicCourseId,
    courseName: pendingTopicCourseName,
    name,
    details
  });

  closeTopicModal();
});

// Close modals on backdrop click
createCourseModal.addEventListener("click", (e) => {
  if (e.target === createCourseModal) closeCourseModal();
});
createTopicModal.addEventListener("click", (e) => {
  if (e.target === createTopicModal) closeTopicModal();
});

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

exportBtn.addEventListener("click", async () => {
  const topicId = studySelectedTopicId;
  if (!topicId) return;

  try {
    const response = await fetch(
      `http://localhost:5000/export?topicId=${topicId}`
    );

    if (!response.ok) return;

    const data = await response.json();

    const blob = new Blob([data.md], { type: "text/markdown" });
    const url  = URL.createObjectURL(blob);

    chrome.downloads.download({ url, filename: data.filename }, () => {
      URL.revokeObjectURL(url);
    });
  } catch (err) {
    console.error("LazyNotes [Panel]: export failed ->", err.message);
  }
});

// ---------------------------------------------------------------------------
// Meta panel
// ---------------------------------------------------------------------------

let metaTimeout = null;

function showMeta(event, note) {
  clearTimeout(metaTimeout);
  metaTimeout = setTimeout(() => {
    metaPanel.innerHTML = "";

    const rows = [];

    rows.push({ label: "Category:", value: note.category });

    if (note.source) {
      try {
        const url  = new URL(note.source);
        rows.push({ label: "Source:", value: url.hostname + url.pathname });
      } catch (_) {
        rows.push({ label: "Source:", value: note.source });
      }
    }

    if (note["last modified"]) {
      const d = new Date(note["last modified"]);
      rows.push({
        label: "Saved:",
        value: d.toLocaleString(undefined, {
          month: "short", day: "numeric",
          hour: "2-digit", minute: "2-digit"
        })
      });
    }

    if (note.context)    rows.push({ label: "Context:",    value: note.context });
    if (note.annotation) rows.push({ label: "Annotation:", value: note.annotation });

    rows.forEach(({ label, value }) => {
      const row = document.createElement("div");
      row.className = "mp-row";

      const lbl = document.createElement("span");
      lbl.className   = "mp-row-label";
      lbl.textContent = label;

      const val = document.createElement("span");
      val.className   = "mp-row-value";
      val.textContent = value;

      row.appendChild(lbl);
      row.appendChild(val);
      metaPanel.appendChild(row);
    });

    const panelRect = document.getElementById("body").getBoundingClientRect();
    metaPanel.style.top  = `${event.clientY + 8}px`;
    metaPanel.style.left = `${panelRect.left + 16}px`;
    metaPanel.classList.add("visible");
  }, 300);
}

function hideMeta() {
  clearTimeout(metaTimeout);
  metaPanel.classList.remove("visible");
}

// ---------------------------------------------------------------------------
// Messages from background
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener(async (message) => {
  // Highlighter toggled
  if (message.type === "TOGGLE_HIGHLIGHTER") {
    setToggleBtn(message.active);
    return;
  }

  // Notes saved to Flask — refresh study view if open
  if (message.type === "NOTES_UPDATED") {
    if (studyView.classList.contains("visible") && studySelectedTopicId) {
      await loadNotes(studySelectedTopicId);
    }
    const { lastHighlights = [] } = await storageGet("lastHighlights");
    renderLastHighlights(lastHighlights);
    return;
  }

  // Background tells us to open the topic form (after course creation or
  // context menu "Create Topic" click)
  if (message.type === "SHOW_CREATE_TOPIC") {
    const { courseId, courseName } = message;

    // Refresh course list first so the new course is available
    await loadCourses();
    homeSelectedCourseId = courseId;
    renderHomeCourseSelect();
    await loadHomeTopics(courseId);

    // Switch to home view
    viewTabs.forEach((t) => t.classList.remove("active"));
    document.querySelector('[data-view="home"]').classList.add("active");
    homeView.classList.add("visible");
    studyView.classList.remove("visible");

    openTopicModal(courseId, courseName);
    return;
  }

  // A topic was successfully created
  if (message.type === "TOPIC_CREATED") {
    const { courseId } = message;

    // Refresh topic list for this course
    if (homeSelectedCourseId === courseId) {
      await loadHomeTopics(courseId);
    }

    if (studySelectedCourseId === courseId) {
      await loadStudyTopics(courseId);
    }

    return;
  }

  // Active course changed (e.g. context menu course click)
  if (message.type === "ACTIVE_COURSE_CHANGED") {
    activeCourseId       = message.activeCourseId ?? activeCourseId;
    homeSelectedCourseId = activeCourseId;

    await loadCourses();
    renderHomeCourseSelect();
    await loadHomeTopics(activeCourseId);
    return;
  }
});

// ---------------------------------------------------------------------------
// Storage change — handle notesUpdatedAt fallback trigger
// ---------------------------------------------------------------------------

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;

  if (changes.notesUpdatedAt) {
    if (studyView.classList.contains("visible") && studySelectedTopicId) {
      await loadNotes(studySelectedTopicId);
    }
    const { lastHighlights = [] } = await storageGet("lastHighlights");
    renderLastHighlights(lastHighlights);
  }

  if (changes.highlighterActive) {
    setToggleBtn(changes.highlighterActive.newValue ?? false);
  }
});

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function stripHtml(html) {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent || div.innerText || "";
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

init();
