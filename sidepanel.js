// Lazy Notes — Side Panel (rebuilt against local-storage schema)

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let courseTree = {};   // lazynotes.courses — { name: { level, semester, details, topics } }

let activeCourse = null;   // name string | null
let activeTopic  = null;   // name string | null

let homeSelectedCourse  = null;
let studySelectedCourse = null;
let studySelectedTopic  = null;

let homeTopicSort = "chronological";

// Pending topic creation — background tells us which course to attach to
let pendingTopicCourse = null;

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
const homeTopicSortSel  = document.getElementById("home-topic-sort");
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
const ccLevel           = document.getElementById("cc-level");
const ccSemester        = document.getElementById("cc-semester");
const ccDetails         = document.getElementById("cc-details");
const ccCancel          = document.getElementById("cc-cancel");
const ccSubmit          = document.getElementById("cc-submit");

// Create Topic modal
const createTopicModal  = document.getElementById("create-topic-modal");
const ctSubtitle        = document.getElementById("ct-subtitle");
const ctName            = document.getElementById("ct-name");
const ctCancel          = document.getElementById("ct-cancel");
const ctSubmit          = document.getElementById("ct-submit");

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init() {
  const stored = await storageGet([
    "lazynotes",
    "highlighterActive",
    "activeCourse",
    "activeTopic"
  ]);

  courseTree   = stored.lazynotes?.courses ?? {};
  activeCourse = stored.activeCourse ?? null;
  activeTopic  = stored.activeTopic ?? null;

  setToggleBtn(stored.highlighterActive ?? false);

  homeSelectedCourse  = activeCourse;
  studySelectedCourse = activeCourse;

  renderHomeCourseSelect();
  renderStudyCourseSelect();

  updateCreateTopicBtn();
  updateToggleBtnGuard();

  await loadHomeTopics();
  await loadStudyTopics();
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

function storageGet(keys) {
  return new Promise((resolve) =>
    chrome.storage.local.get(keys, (r) => resolve(r))
  );
}

async function refreshCourseTree() {
  const { lazynotes } = await storageGet("lazynotes");
  courseTree = lazynotes?.courses ?? {};
}

// ---------------------------------------------------------------------------
// Course select renders (shared pattern)
// ---------------------------------------------------------------------------

function populateCourseSelect(selectEl, selectedName) {
  selectEl.innerHTML = '<option value="">— select a course —</option>';

  Object.entries(courseTree).forEach(([name, course]) => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = `${name}${course.semester ? " · " + course.semester : ""}`;
    if (name === selectedName) opt.selected = true;
    selectEl.appendChild(opt);
  });

  // Sentinel at the bottom — opens the create-course modal
  const createOpt = document.createElement("option");
  createOpt.value = "__create_course__";
  createOpt.textContent = "+ Create Course";
  selectEl.appendChild(createOpt);
}

function renderHomeCourseSelect() {
  populateCourseSelect(homeCourseSelect, homeSelectedCourse);
}

function renderStudyCourseSelect() {
  populateCourseSelect(studyCourseSelect, studySelectedCourse);
}

// ---------------------------------------------------------------------------
// Home — topic list
// ---------------------------------------------------------------------------

async function loadHomeTopics() {
  homeTopicList.innerHTML = "";

  if (!homeSelectedCourse || !courseTree[homeSelectedCourse]) return;

  const topicsDict = courseTree[homeSelectedCourse].topics || {};
  const topics = Object.entries(topicsDict).map(([name, t]) => ({
    name,
    created: t.created,
    highlightCount: Object.keys(t.highlights || {}).length
  }));

  if (topics.length === 0) {
    const empty = document.createElement("div");
    empty.style.cssText = "font-size:12px;color:var(--dim);padding:4px 0;";
    empty.textContent = "No topics yet — create one below.";
    homeTopicList.appendChild(empty);
    return;
  }

  const sorted = sortTopics(topics, homeTopicSort);

  sorted.forEach((topic) => {
    const row = document.createElement("div");
    row.className = "topic-row";
    if (topic.name === activeTopic && homeSelectedCourse === activeCourse) {
      row.classList.add("active");
    }

    const name = document.createElement("span");
    name.className = "topic-name";
    name.textContent = topic.name;

    const meta = document.createElement("span");
    meta.className = "topic-meta";
    meta.textContent = `${topic.highlightCount} note${topic.highlightCount === 1 ? "" : "s"}`;

    row.appendChild(name);
    row.appendChild(meta);

    row.addEventListener("click", () => {
      chrome.runtime.sendMessage({
        type:       "SET_ACTIVE_TOPIC",
        courseName: homeSelectedCourse,
        topicName:  topic.name
      });
      activeCourse = homeSelectedCourse;
      activeTopic  = topic.name;
      renderHomeTopicActiveState();
      updateToggleBtnGuard();
    });

    homeTopicList.appendChild(row);
  });
}

function renderHomeTopicActiveState() {
  homeTopicList.querySelectorAll(".topic-row").forEach((row) => {
    const name = row.querySelector(".topic-name")?.textContent;
    row.classList.toggle(
      "active",
      name === activeTopic && homeSelectedCourse === activeCourse
    );
  });
}

homeCourseSelect.addEventListener("change", async () => {
  if (homeCourseSelect.value === "__create_course__") {
    // Reset select back to previous selection, then open modal
    homeCourseSelect.value = homeSelectedCourse || "";
    openCourseModal();
    return;
  }
  homeSelectedCourse = homeCourseSelect.value || null;
  updateCreateTopicBtn();
  await loadHomeTopics();
});

function updateCreateTopicBtn() {
  openCreateTopic.disabled = !homeSelectedCourse;
  openCreateTopic.title = homeSelectedCourse ? "" : "Select a course first";
}

homeTopicSortSel.addEventListener("change", async () => {
  homeTopicSort = homeTopicSortSel.value;
  await loadHomeTopics();
});

// ---------------------------------------------------------------------------
// Study — topic tabs + notes
// ---------------------------------------------------------------------------

async function loadStudyTopics() {
  topicTabs.innerHTML = "";
  noteList.innerHTML  = "";
  emptyStudy.style.display = "none";

  if (!studySelectedCourse || !courseTree[studySelectedCourse]) {
    emptyStudy.style.display = "block";
    emptyStudy.textContent   = "Select a course to view notes.";
    updateNoteCount(0);
    return;
  }

  const topicsDict = courseTree[studySelectedCourse].topics || {};
  const topicNames = Object.keys(topicsDict);

  if (topicNames.length === 0) {
    emptyStudy.style.display = "block";
    emptyStudy.textContent   = "No topics for this course yet.";
    updateNoteCount(0);
    return;
  }

  studySelectedTopic = topicNames.includes(studySelectedTopic)
    ? studySelectedTopic
    : topicNames[0];

  topicNames.forEach((name) => {
    const tab = document.createElement("button");
    tab.className = "topic-tab";
    if (name === studySelectedTopic) tab.classList.add("active");
    tab.textContent = name;

    tab.addEventListener("click", async () => {
      studySelectedTopic = name;
      topicTabs.querySelectorAll(".topic-tab").forEach((t) =>
        t.classList.toggle("active", t === tab)
      );
      await loadNotes();
    });

    topicTabs.appendChild(tab);
  });

  await loadNotes();
}

studyCourseSelect.addEventListener("change", async () => {
  studySelectedCourse = studyCourseSelect.value || null;
  studySelectedTopic  = null;
  await loadStudyTopics();
});

async function loadNotes() {
  noteList.innerHTML = "";
  emptyStudy.style.display = "none";

  if (!studySelectedCourse || !studySelectedTopic) {
    updateNoteCount(0);
    return;
  }

  const topic = courseTree[studySelectedCourse]?.topics?.[studySelectedTopic];
  const highlightsDict = topic?.highlights || {};

  const notes = Object.entries(highlightsDict).map(([id, fields]) => ({
    id,
    ...fields
  }));

  const sorted = sortHighlights(notes, "chronological");

  if (sorted.length === 0) {
    emptyStudy.style.display = "block";
    emptyStudy.textContent   = "No notes for this topic yet.";
    updateNoteCount(0);
    return;
  }

  sorted.forEach((note) => {
    const line = document.createElement("div");
    line.className = "note-line";
    line.textContent = stripHtml(note.text);

    line.addEventListener("mouseenter", (e) => showMeta(e, note));
    line.addEventListener("mouseleave", hideMeta);

    noteList.appendChild(line);
  });

  updateNoteCount(sorted.length);
}

function updateNoteCount(n) {
  noteCount.textContent = `${n} note${n === 1 ? "" : "s"}`;
}

// ---------------------------------------------------------------------------
// View tabs
// ---------------------------------------------------------------------------

viewTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    viewTabs.forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");

    const view = tab.dataset.view;
    homeView.classList.toggle("visible", view === "home");
    studyView.classList.toggle("visible", view === "study");
  });
});

// ---------------------------------------------------------------------------
// Toggle button
// ---------------------------------------------------------------------------

function setToggleBtn(active) {
  toggleBtn.textContent = active ? "Highlighter on" : "Highlighter off";
  toggleBtn.classList.toggle("active", active);
  updateToggleBtnGuard();
}

function updateToggleBtnGuard() {
  const isActive = toggleBtn.classList.contains("active");
  // Can always turn off; can only turn on if course+topic are set.
  const canEnable = isActive || (activeCourse && activeTopic);
  toggleBtn.disabled = !canEnable;
  toggleBtn.title = canEnable ? "" : "Select a course and topic first";
}

toggleBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "TOGGLE_HIGHLIGHTER_REQUEST" });
});

// ---------------------------------------------------------------------------
// Create Course modal
// ---------------------------------------------------------------------------

function openCourseModal() {
  ccName.value    = "";
  ccLevel.value   = "";
  ccSemester.value = "";
  ccDetails.value = "";

  createCourseModal.classList.add("visible");
  createCourseModal.setAttribute("aria-hidden", "false");
  setTimeout(() => ccName.focus(), 50);
}

function closeCourseModal() {
  createCourseModal.classList.remove("visible");
  createCourseModal.setAttribute("aria-hidden", "true");
}

openCreateCourse.addEventListener("click", openCourseModal);
ccCancel.addEventListener("click", closeCourseModal);

ccSubmit.addEventListener("click", () => {
  const name = ccName.value.trim();
  if (!name) return;

  chrome.runtime.sendMessage({
    type:     "CREATE_COURSE",
    name,
    level:    ccLevel.value || "",
    semester: ccSemester.value || "",
    details:  ccDetails.value.trim()
  });

  closeCourseModal();
});

// ---------------------------------------------------------------------------
// Create Topic modal
// ---------------------------------------------------------------------------

function openTopicModal(courseName) {
  pendingTopicCourse = courseName;

  ctSubtitle.textContent = courseName
    ? `Adding topic to: ${courseName}`
    : "Add a topic to the selected course.";

  ctName.value = "";

  createTopicModal.classList.add("visible");
  createTopicModal.setAttribute("aria-hidden", "false");
  setTimeout(() => ctName.focus(), 50);
}

function closeTopicModal() {
  createTopicModal.classList.remove("visible");
  createTopicModal.setAttribute("aria-hidden", "true");
  pendingTopicCourse = null;
}

openCreateTopic.addEventListener("click", () => {
  openTopicModal(homeSelectedCourse);
});

ctCancel.addEventListener("click", closeTopicModal);

ctSubmit.addEventListener("click", () => {
  const name = ctName.value.trim();
  if (!name || !pendingTopicCourse) return;

  chrome.runtime.sendMessage({
    type:       "CREATE_TOPIC",
    courseName: pendingTopicCourse,
    name
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
// Export — reads from storage, builds Markdown locally, no Flask
// ---------------------------------------------------------------------------

exportBtn.addEventListener("click", () => {
  if (!studySelectedCourse || !studySelectedTopic) return;

  const topic = courseTree[studySelectedCourse]?.topics?.[studySelectedTopic];
  const highlightsDict = topic?.highlights || {};
  const notes = sortHighlights(
    Object.entries(highlightsDict).map(([id, fields]) => ({ id, ...fields })),
    "chronological"
  );

  let md = `# ${studySelectedCourse} — ${studySelectedTopic}\n\n`;

  notes.forEach((note) => {
    md += `## ${note.category}\n\n${note.text}\n\n`;
    if (note.annotation) md += `> ${note.annotation}\n\n`;
    if (note.context)    md += `_Context: ${note.context}_\n\n`;
    md += `Source: ${note.sourceUrl}\n\n---\n\n`;
  });

  const blob = new Blob([md], { type: "text/markdown" });
  const url  = URL.createObjectURL(blob);
  const filename = `${studySelectedCourse} - ${studySelectedTopic}.md`.replace(/[\\/:*?"<>|]/g, "_");

  chrome.downloads.download({ url, filename }, () => {
    URL.revokeObjectURL(url);
  });
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

    if (note.sourceUrl) {
      try {
        const url = new URL(note.sourceUrl);
        rows.push({ label: "Source:", value: url.hostname + url.pathname });
      } catch (_) {
        rows.push({ label: "Source:", value: note.sourceUrl });
      }
    }

    if (note.timestamp) {
      const d = new Date(note.timestamp);
      rows.push({
        label: "Saved:",
        value: d.toLocaleString(undefined, {
          month: "short", day: "numeric",
          hour: "2-digit", minute: "2-digit"
        })
      });
    }

    if (note.edited) {
      const d = new Date(note.edited);
      rows.push({
        label: "Edited:",
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

    metaPanel.style.top  = `${event.clientY + 8}px`;
    metaPanel.style.left = `${event.clientX + 8}px`;
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
  if (message.type === "TOGGLE_HIGHLIGHTER") {
    setToggleBtn(message.active);
    return;
  }

  if (message.type === "NOTES_UPDATED") {
    await refreshCourseTree();
    renderHomeCourseSelect();
    renderStudyCourseSelect();
    if (studyView.classList.contains("visible")) await loadNotes();
    if (homeView.classList.contains("visible"))  await loadHomeTopics();
    return;
  }

  if (message.type === "SHOW_CREATE_COURSE") {
    if (message.defaults) {
      ccLevel.value    = message.defaults.level || "";
      ccSemester.value = message.defaults.semester || "";
    }
    openCourseModal();
    return;
  }

  if (message.type === "SHOW_CREATE_TOPIC") {
    const { courseName } = message;

    await refreshCourseTree();
    homeSelectedCourse = courseName;
    renderHomeCourseSelect();
    updateCreateTopicBtn();
    await loadHomeTopics();

    viewTabs.forEach((t) => t.classList.remove("active"));
    document.querySelector('[data-view="home"]').classList.add("active");
    homeView.classList.add("visible");
    studyView.classList.remove("visible");

    openTopicModal(courseName);
    return;
  }

  if (message.type === "TOPIC_CREATED") {
    const { courseName } = message;

    await refreshCourseTree();
    renderHomeCourseSelect();
    renderStudyCourseSelect();

    if (homeSelectedCourse === courseName)  await loadHomeTopics();
    if (studySelectedCourse === courseName) await loadStudyTopics();
    return;
  }

  if (message.type === "ACTIVE_COURSE_CHANGED") {
    activeCourse       = message.activeCourse ?? activeCourse;
    activeTopic        = message.activeTopic ?? null;
    homeSelectedCourse = activeCourse;

    await refreshCourseTree();
    renderHomeCourseSelect();
    renderStudyCourseSelect();
    updateCreateTopicBtn();
    updateToggleBtnGuard();
    await loadHomeTopics();
    return;
  }
});

// ---------------------------------------------------------------------------
// Storage change — direct listener on the lazynotes key
// ---------------------------------------------------------------------------

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;

  if (changes.lazynotes) {
    courseTree = changes.lazynotes.newValue?.courses ?? {};
    renderHomeCourseSelect();
    renderStudyCourseSelect();
    if (studyView.classList.contains("visible")) await loadNotes();
    if (homeView.classList.contains("visible"))  await loadHomeTopics();
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
