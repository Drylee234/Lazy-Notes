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
const startHint         = document.getElementById("start-hint");
const viewTabs          = document.querySelectorAll(".view-tab");
const homeView          = document.getElementById("home-view");
const studyView         = document.getElementById("study-view");

// Home
const homeCourseSelect  = document.getElementById("home-course-select");
const homeTopicList     = document.getElementById("home-topic-list");
const homeTopicSortSel  = document.getElementById("home-topic-sort");
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

  // Append context to chronological sorting options in the dropdown
  if (homeTopicSortSel) {
    Array.from(homeTopicSortSel.options).forEach(opt => {
      if (opt.value === 'chronological' && !opt.text.includes('(')) {
         opt.text += ' (Oldest First)';
      }
      if (opt.value === 'reverse-chronological' && !opt.text.includes('(')) {
         opt.text += ' (Latest First)';
      }
    });
  }

  renderHomeCourseSelect();
  renderStudyCourseSelect();

  updateCreateTopicBtn();
  updateToggleBtnGuard();

  await loadHomeTopics();
  await loadStudyTopics();
  updateFooterCount();

  // Opened by a context-menu / shortcut request?
  const { panelRequest } = await storageGet("panelRequest");
  await handlePanelRequest(panelRequest);
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

  Object.entries(courseTree).forEach(([name]) => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    if (name === selectedName) opt.selected = true;
    selectEl.appendChild(opt);
  });

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
// Dynamic Footer Count
// ---------------------------------------------------------------------------

function updateFooterCount() {
  updateExportBtn();
  updateStartHint();
  if (homeView.classList.contains("visible")) {
    if (!homeSelectedCourse || !courseTree[homeSelectedCourse]) {
      noteCount.textContent = "0 topics";
      return;
    }
    const numTopics = Object.keys(courseTree[homeSelectedCourse].topics || {}).length;
    noteCount.textContent = `${numTopics} topic${numTopics === 1 ? "" : "s"}`;
  } else {
    if (!studySelectedCourse || !studySelectedTopic) {
      noteCount.textContent = "0 notes";
      return;
    }
    const topic = courseTree[studySelectedCourse]?.topics?.[studySelectedTopic];
    const numNotes = Object.keys(topic?.highlights || {}).length;
    noteCount.textContent = `${numNotes} note${numNotes === 1 ? "" : "s"}`;
  }
}

// ---------------------------------------------------------------------------
// Home — topic list
// ---------------------------------------------------------------------------

async function loadHomeTopics() {
  homeTopicList.innerHTML = "";

  if (!homeSelectedCourse || !courseTree[homeSelectedCourse]) {
    updateFooterCount();
    return;
  }

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
    updateFooterCount();
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

    const right = document.createElement("span");
    right.className = "topic-row-right";
    right.appendChild(meta);
    right.appendChild(makeTopicDeleteButton(homeSelectedCourse, topic));

    row.appendChild(name);
    row.appendChild(right);

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

  updateFooterCount();
}

// "×" that needs a second click within 4s; the armed label says how many
// notes go with the topic. The background clears the active topic and turns
// the highlighter off if this was the topic being highlighted into.
function makeTopicDeleteButton(courseName, topic) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "topic-delete-btn";
  btn.textContent = "×";
  btn.title = `Delete "${topic.name}"`;
  btn.setAttribute("aria-label", `Delete topic ${topic.name}`);

  let armed = false;
  let timer = null;

  const disarm = () => {
    armed = false;
    clearTimeout(timer);
    btn.classList.remove("armed");
    btn.textContent = "×";
  };

  btn.addEventListener("click", (e) => {
    e.stopPropagation();  // don't select the topic

    if (!armed) {
      armed = true;
      btn.classList.add("armed");
      const n = topic.highlightCount;
      btn.textContent = n ? `Delete ${n} note${n === 1 ? "" : "s"}?` : "Delete?";
      timer = setTimeout(disarm, 4000);
      return;
    }

    disarm();
    btn.disabled = true;
    chrome.runtime.sendMessage(
      { type: "DELETE_TOPIC", courseName, topicName: topic.name },
      (reply) => {
        if (chrome.runtime.lastError || !reply?.ok) {
          btn.disabled = false;
          alert(`Couldn't delete: ${reply?.reason || chrome.runtime.lastError?.message || "unknown error"}`);
        }
        // On success the storage listener redraws the list.
      }
    );
  });

  btn.addEventListener("blur", disarm);
  return btn;
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
    homeCourseSelect.value = homeSelectedCourse || "";
    openCourseModalWithDefaults();
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
    updateFooterCount();
    return;
  }

  const topicsDict = courseTree[studySelectedCourse].topics || {};
  const topicNames = Object.keys(topicsDict);

  if (topicNames.length === 0) {
    emptyStudy.style.display = "block";
    emptyStudy.textContent   = "No topics for this course yet.";
    updateFooterCount();
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
  if (studyCourseSelect.value === "__create_course__") {
    studyCourseSelect.value = studySelectedCourse || "";
    openCourseModalWithDefaults();
    return;
  }
  studySelectedCourse = studyCourseSelect.value || null;
  studySelectedTopic  = null;
  await loadStudyTopics();
});

async function loadNotes() {
  noteList.innerHTML = "";
  emptyStudy.style.display = "none";

  if (!studySelectedCourse || !studySelectedTopic) {
    updateFooterCount();
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
    updateFooterCount();
    return;
  }

  sorted.forEach((note) => {
    const line = document.createElement("div");
    line.className = "note-line";
    line.textContent = note.text;

    line.addEventListener("mouseenter", (e) => showMeta(e, note));
    line.addEventListener("mouseleave", hideMeta);

    noteList.appendChild(line);
  });

  updateFooterCount();
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
    
    // Switch the footer depending on which tab is active
    updateFooterCount();
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
  updateStartHint();
}

// Say on screen what's needed before the highlighter can start — the
// disabled button's tooltip alone was too easy to miss.
function updateStartHint() {
  if (!startHint) return;
  const isActive = toggleBtn.classList.contains("active");
  let text = "";

  if (!isActive && !(activeCourse && activeTopic)) {
    if (Object.keys(courseTree).length === 0) {
      text = "Create a course to get started.";
    } else if (!homeSelectedCourse) {
      text = "Pick a course, then click a topic to start highlighting.";
    } else if (Object.keys(courseTree[homeSelectedCourse]?.topics || {}).length === 0) {
      text = "Create a topic, then click it to start highlighting.";
    } else {
      text = "Click a topic to start highlighting.";
    }
  }

  startHint.textContent = text;
  startHint.hidden = !text;
}

toggleBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "TOGGLE_HIGHLIGHTER_REQUEST" });
});

// ---------------------------------------------------------------------------
// Create Course modal
// ---------------------------------------------------------------------------

function openCourseModal(defaults = {}) {
  if (!createCourseModal) return;
  ccName.value     = "";
  ccLevel.value    = defaults.level || "";
  ccSemester.value = defaults.semester || "";
  ccDetails.value  = "";

  createCourseModal.classList.add("visible");
  createCourseModal.setAttribute("aria-hidden", "false");
  setTimeout(() => ccName.focus(), 50);
}

// Pre-fill level/semester with whatever the last course used.
async function openCourseModalWithDefaults() {
  const { lastCourseDefaults = {} } = await storageGet("lastCourseDefaults");
  openCourseModal(lastCourseDefaults);
}

function closeCourseModal() {
  if (!createCourseModal) return;
  createCourseModal.classList.remove("visible");
  createCourseModal.setAttribute("aria-hidden", "true");
}

if (ccCancel) ccCancel.addEventListener("click", closeCourseModal);

if (ccSubmit) {
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
}

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
// Export — Study view exports the open topic, Home view the selected course.
// Formatting lives in exporter.js.
// ---------------------------------------------------------------------------

function exportTarget() {
  if (homeView.classList.contains("visible")) {
    const course = courseTree[homeSelectedCourse];
    return course ? { courseName: homeSelectedCourse, course, topicName: null } : null;
  }
  const course = courseTree[studySelectedCourse];
  if (!course || !studySelectedTopic || !course.topics?.[studySelectedTopic]) return null;
  return { courseName: studySelectedCourse, course, topicName: studySelectedTopic };
}

function updateExportBtn() {
  const target = exportTarget();
  exportBtn.disabled = !target;
  exportBtn.textContent = homeView.classList.contains("visible") ? "Export course" : "Export topic";
  exportBtn.title = target
    ? `Download ${target.topicName ? `"${target.topicName}"` : `all of "${target.courseName}"`} as Markdown`
    : (homeView.classList.contains("visible") ? "Select a course first" : "Select a topic first");
}

exportBtn.addEventListener("click", () => {
  const target = exportTarget();
  if (!target) return;
  exportNotes({ format: "md", ...target });
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
// Requests from the background ("panelRequest" in storage)
// ---------------------------------------------------------------------------
// The background leaves these in storage (rather than messaging) so they
// survive the panel being closed: it opens the panel and we pick the request
// up on start, or straight away if we're already open.

let myWindowId = null;
const windowIdReady = new Promise((resolve) => {
  chrome.windows.getCurrent((w) => { myWindowId = w?.id ?? null; resolve(); });
});

async function handlePanelRequest(request) {
  if (!request) return;
  await windowIdReady;

  if (request.windowId != null && request.windowId !== myWindowId) return;  // another window's panel
  chrome.storage.local.remove("panelRequest");
  if (Date.now() - request.at > 60000) return;  // stale, e.g. panel never opened

  if (request.type === "SHOW_CREATE_COURSE") {
    closeTopicModal();
    await openCourseModalWithDefaults();
    return;
  }

  if (request.type === "SHOW_CREATE_TOPIC") {
    await showCreateTopic(request.courseName);
  }
}

async function showCreateTopic(courseName) {
  await refreshCourseTree();
  homeSelectedCourse = courseName;
  renderHomeCourseSelect();
  updateCreateTopicBtn();
  await loadHomeTopics();

  viewTabs.forEach((t) => t.classList.remove("active"));
  document.querySelector('[data-view="home"]').classList.add("active");
  homeView.classList.add("visible");
  studyView.classList.remove("visible");
  updateFooterCount();

  closeCourseModal();
  openTopicModal(courseName);
}

// ---------------------------------------------------------------------------
// Storage change — direct listener on the lazynotes key
// ---------------------------------------------------------------------------

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;

  if (changes.lazynotes) {
    courseTree = changes.lazynotes.newValue?.courses ?? {};

    // A course or topic may have been deleted from the viewer.
    if (homeSelectedCourse && !courseTree[homeSelectedCourse]) {
      homeSelectedCourse = null;
      updateCreateTopicBtn();
    }
    if (studySelectedCourse && !courseTree[studySelectedCourse]) {
      studySelectedCourse = null;
      studySelectedTopic  = null;
    }
    if (studyView.classList.contains("visible")) await loadStudyTopics();

    renderHomeCourseSelect();
    renderStudyCourseSelect();
    if (homeView.classList.contains("visible"))  await loadHomeTopics();
  }

  if (changes.activeCourse || changes.activeTopic) {
    if (changes.activeCourse) activeCourse = changes.activeCourse.newValue ?? null;
    if (changes.activeTopic)  activeTopic  = changes.activeTopic.newValue ?? null;
    renderHomeTopicActiveState();
    updateToggleBtnGuard();
  }

  if (changes.highlighterActive) {
    setToggleBtn(changes.highlighterActive.newValue ?? false);
  }

  if (changes.panelRequest?.newValue) {
    await handlePanelRequest(changes.panelRequest.newValue);
  }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

init();