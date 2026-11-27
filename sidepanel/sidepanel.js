// Lazy Notes — Side Panel (rebuilt against local-storage schema)

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let courseTree = {};   // lazynotes.courses — { name: { level, semester, details, topics } }

let activeCourse = null;   // name string | null
let activeTopic  = null;   // name string | null

// One course for both tabs, so Topics and Study always show the same one.
let selectedCourse     = null;
let studySelectedTopic = null;

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
const studyTopicSelect  = document.getElementById("study-topic-select");
const noteList          = document.getElementById("note-list");
const emptyStudy        = document.getElementById("empty-study");

// Footer
const noteCount         = document.getElementById("note-count");
const exportBtn         = document.getElementById("export-btn");


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

  selectedCourse = activeCourse;
  renderCourseSelects();

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
  selectEl.innerHTML = '<option value="">Select a course</option>';

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

function renderCourseSelects() {
  populateCourseSelect(homeCourseSelect, selectedCourse);
  populateCourseSelect(studyCourseSelect, selectedCourse);
  try { fillSavingTo(activeCourse, activeTopic); } catch (_) { /* top bar not built yet */ }
}

// Picking a course in either tab, or outside the panel (right-click menu, a
// new course), shows it in both. Study then opens on the active topic if it's
// in this course, else the first one.
async function selectCourse(name) {
  selectedCourse     = name;
  studySelectedTopic = null;
  renderCourseSelects();
  updateCreateTopicBtn();
  await loadHomeTopics();
  await loadStudyTopics();
}

async function onCourseSelectChange(selectEl) {
  if (selectEl.value === "__create_course__") {
    selectEl.value = selectedCourse || "";
    openCourseModalWithDefaults();
    return;
  }
  await selectCourse(selectEl.value || null);
}

homeCourseSelect.addEventListener("change", () => onCourseSelectChange(homeCourseSelect));
// The Study tab shows where you're writing, so picking there also makes it
// where highlights save ("Saving to …" in the readers and side panel).
studyCourseSelect.addEventListener("change", async () => {
  await onCourseSelectChange(studyCourseSelect);
  makeStudyTopicActive();
});

function makeStudyTopicActive() {
  if (!selectedCourse || !studySelectedTopic) return;
  if (activeCourse === selectedCourse && activeTopic === studySelectedTopic) return;
  chrome.runtime.sendMessage({ type: "SET_ACTIVE_TOPIC", courseName: selectedCourse, topicName: studySelectedTopic });
  activeCourse = selectedCourse;
  activeTopic  = studySelectedTopic;
  renderHomeTopicActiveState();
  updateToggleBtnGuard();
}

// ---------------------------------------------------------------------------
// Dynamic Footer Count
// ---------------------------------------------------------------------------

function updateFooterCount() {
  updateExportBtn();
  updateStartHint();
  if (homeView.classList.contains("visible")) {
    if (!selectedCourse || !courseTree[selectedCourse]) {
      noteCount.textContent = "0 topics";
      return;
    }
    const numTopics = Object.keys(courseTree[selectedCourse].topics || {}).length;
    noteCount.textContent = `${numTopics} topic${numTopics === 1 ? "" : "s"}`;
  } else {
    const topic = selectedCourse && studySelectedTopic
      ? courseTree[selectedCourse]?.topics?.[studySelectedTopic]
      : null;
    const { highlights, notes } = StudyPage.counts(topic);
    noteCount.textContent =
      `${highlights} highlight${highlights === 1 ? "" : "s"} · ${notes} note${notes === 1 ? "" : "s"}`;
  }
}

// ---------------------------------------------------------------------------
// Home — topic list
// ---------------------------------------------------------------------------

// The documents this course's notes came from (shared/utils.js
// courseDocuments); a click opens one in its reader.
const DOC_ICON = { pdf: "PDF", pptx: "PPT", docx: "DOC" };
async function loadCourseDocs() {
  const box = document.getElementById("course-docs");
  const list = document.getElementById("course-docs-list");
  if (!box) return;
  const course = selectedCourse && courseTree[selectedCourse];
  const { lnDocs = {}, lnCourseDocHide = {} } = await chrome.storage.local.get(["lnDocs", "lnCourseDocHide"]);
  const docs = course ? courseDocuments(selectedCourse, course, lnDocs, lnCourseDocHide[selectedCourse] || []) : [];
  list.replaceChildren(...docs.slice(0, 12).map((d) => {
    const wrap = document.createElement("div");
    wrap.className = "course-doc-wrap";
    const row = document.createElement("button");
    row.type = "button";
    row.className = "course-doc";
    row.title = `Open ${d.name}${d.topics.size ? ` · topics: ${[...d.topics].join(", ")}` : ""}`;
    row.innerHTML = `<span class="course-doc-kind"></span><span class="course-doc-name"></span><span class="course-doc-meta"></span>`;
    row.children[0].textContent = DOC_ICON[d.kind] || "DOC";
    row.children[0].dataset.kind = d.kind;
    row.children[1].textContent = d.name;
    row.children[2].textContent = d.notes ? `${d.notes} note${d.notes === 1 ? "" : "s"}` : "opened";
    row.addEventListener("click", () => chrome.tabs.create({ url: d.open }));
    const x = document.createElement("button");
    x.type = "button";
    x.className = "course-doc-x";
    x.textContent = "✕";
    x.title = "Remove from this course (your notes stay)";
    x.setAttribute("aria-label", `Remove ${d.name} from ${selectedCourse}`);
    const course0 = selectedCourse;
    x.addEventListener("click", async () => { await hideCourseDoc(course0, d.key); loadCourseDocs(); });
    wrap.append(row, x);
    return wrap;
  }));
  box.hidden = docs.length === 0;
}

async function loadHomeTopics() {
  homeTopicList.innerHTML = "";
  loadCourseDocs();

  if (!selectedCourse || !courseTree[selectedCourse]) {
    updateFooterCount();
    return;
  }

  const topicsDict = courseTree[selectedCourse].topics || {};
  // Highlights and typed notes together: "3 notes" on a row means everything
  // in the topic (also what "Most notes" sorts by and a delete removes).
  const topics = Object.entries(topicsDict).map(([name, t]) => ({
    name,
    created: t.created,
    highlightCount: Object.keys(t.highlights || {}).length + Object.keys(t.notes || {}).length
  }));

  if (topics.length === 0) {
    const empty = document.createElement("div");
    empty.className = "topic-empty";
    empty.textContent = "No topics yet.";
    homeTopicList.appendChild(empty);
    updateFooterCount();
    return;
  }

  const sorted = sortTopics(topics, homeTopicSort);

  sorted.forEach((topic) => {
    const row = document.createElement("div");
    row.className = "topic-row";
    if (topic.name === activeTopic && selectedCourse === activeCourse) {
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
    right.appendChild(makeTopicDeleteButton(selectedCourse, topic));

    row.appendChild(name);
    row.appendChild(right);

    row.addEventListener("click", () => {
      chrome.runtime.sendMessage({
        type:       "SET_ACTIVE_TOPIC",
        courseName: selectedCourse,
        topicName:  topic.name
      });
      activeCourse = selectedCourse;
      activeTopic  = topic.name;
      renderHomeTopicActiveState();
      updateToggleBtnGuard();

      // Study opens on the topic just picked.
      studySelectedTopic = topic.name;
      loadStudyTopics();
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
      name === activeTopic && selectedCourse === activeCourse
    );
  });
}

function updateCreateTopicBtn() {
  openCreateTopic.disabled = !selectedCourse;
  openCreateTopic.title = selectedCourse ? "" : "Select a course first";
}

homeTopicSortSel.addEventListener("change", async () => {
  homeTopicSort = homeTopicSortSel.value;
  await loadHomeTopics();
});

// ---------------------------------------------------------------------------
// Study — topic tabs + notes
// ---------------------------------------------------------------------------

// No topic to show: say why, and park the page (study-page.js).
function showStudyEmpty(text) {
  StudyPage.clear();
  emptyStudy.style.display = "block";
  emptyStudy.textContent   = text;
  updateFooterCount();
}

async function loadStudyTopics() {
  studyTopicSelect.innerHTML = "";
  studyTopicSelect.hidden = true;

  if (!selectedCourse || !courseTree[selectedCourse]) {
    showStudyEmpty("Pick a course to read its notes.");
    return;
  }

  const topicsDict = courseTree[selectedCourse].topics || {};
  const topicNames = sortTopics(
    Object.entries(topicsDict).map(([name, t]) => ({ name, created: t.created })),
    "chronological"
  ).map((t) => t.name);

  // "+ New topic" is always last (hover-select puts "__" actions after a divider).
  const addNewTopicOption = () => {
    const opt = document.createElement("option");
    opt.value = "__create_topic__";
    opt.textContent = "+ New topic";
    studyTopicSelect.appendChild(opt);
  };

  if (topicNames.length === 0) {
    addNewTopicOption();
    studyTopicSelect.value = "";
    studyTopicSelect.hidden = false;
    showStudyEmpty("No topics for this course yet. Use “+ New topic” above.");
    return;
  }

  // Study shows what's picked (on Home, or here): the topic being
  // highlighted into, if it's in this course. Nothing picked: nothing shown
  // (it used to open the course's first topic, which looked like a pick).
  if (!topicNames.includes(studySelectedTopic)) {
    studySelectedTopic = selectedCourse === activeCourse && topicNames.includes(activeTopic) ? activeTopic : null;
  }

  topicNames.forEach((name) => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    if (name === studySelectedTopic) opt.selected = true;
    studyTopicSelect.appendChild(opt);
  });
  addNewTopicOption();
  studyTopicSelect.hidden = false;

  if (!studySelectedTopic) {
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "Pick a topic";
    none.selected = true;
    none.hidden = true;
    studyTopicSelect.prepend(none);
    showStudyEmpty("Pick a topic on the Home tab (or above) to see its notes.");
    return;
  }

  await loadNotes();
}

studyTopicSelect.addEventListener("change", async () => {
  if (studyTopicSelect.value === "__create_topic__") {
    studyTopicSelect.value = studySelectedTopic || "";
    topicFromStudy = true;
    openTopicModal(selectedCourse);
    return;
  }
  studySelectedTopic = studyTopicSelect.value;
  makeStudyTopicActive();
  await loadNotes();
});

// The open topic as a written page: highlights and typed notes, with the
// composer under it. Drawing it is study-page.js's job.
async function loadNotes() {
  const topic = selectedCourse && studySelectedTopic
    ? courseTree[selectedCourse]?.topics?.[studySelectedTopic]
    : null;

  if (!topic) {
    showStudyEmpty("No notes for this topic yet.");
    return;
  }

  StudyPage.render({ courseName: selectedCourse, topicName: studySelectedTopic, topic });
  updateFooterCount();
}

StudyPage.init({ onRequestRender: () => loadNotes() });

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
    aiView?.classList.toggle("visible", view === "ai");
    if (view === "ai") mountAiPanel();
    
    // Switch the footer depending on which tab is active
    updateFooterCount();
  });
});

// ---------------------------------------------------------------------------
// AI answers (shared/ai-panel.js)
// ---------------------------------------------------------------------------
// The tab only exists once the AI is set up, so nobody meets an empty feature
// they didn't ask for. Answers are scratch: they live in storage.session and
// only reach your notes through "Keep as note".

// Opening the panel means you're at the computer: anything waiting to sync
// goes now, so you don't have to press Sync now yourself.
try {
  chrome.runtime.sendMessage({ type: "SYNC_IF_PENDING" }, () => { void chrome.runtime.lastError; });
} catch (_) {}

const aiView = document.getElementById("ai-view");
const aiTab  = document.getElementById("ai-tab");
let aiPanel  = null;

function mountAiPanel() {
  if (aiPanel || !aiView || !globalThis.LazyAIPanel) return;
  aiPanel = LazyAIPanel.mount(aiView, {
    onKeep: async (entry) => {
      const { activeCourse, activeTopic } = await chrome.storage.local.get(["activeCourse", "activeTopic"]);
      if (!activeCourse || !activeTopic) return false;   // the panel says "Not saved"
      const reply = await new Promise((done) => {
        try {
          chrome.runtime.sendMessage({
            type: "AI_SAVE_NOTE",
            text: entry.text,
            category: /quiz/.test(entry.task) ? "generic" : /summarise/.test(entry.task) ? "summary" : "note",
            courseName: activeCourse,
            topicName: activeTopic
          }, (r) => { void chrome.runtime.lastError; done(r); });
        } catch (_) { done(null); }
      });
      return !!reply?.ok;
    }
  });
  globalThis.LazyAIAnswers = aiPanel;   // so other parts of the panel can add to it
  // Ask about the document, the page you're on, or your notes (shared/ai-ask.js).
  if (globalThis.LazyAIAsk) globalThis.LazyAIAskBar = LazyAIAsk.mount(aiView, aiPanel);
}

// Show the tab only while the AI is switched on and has a key.
function refreshAiTab() {
  if (!aiTab || !globalThis.LazyAIProviders) return;
  LazyAIProviders.ready().then((st) => {
    const on = !!(st.on && st.hasKey);
    aiTab.hidden = !on;
    if (on) mountAiPanel();
    // If the AI goes off while you're looking at it, fall back to Home.
    if (!on && aiView?.classList.contains("visible")) {
      const noHome = document.body.classList.contains("embedded") && !document.body.classList.contains("ln-show-home");
      document.querySelector(`.view-tab[data-view="${noHome ? "study" : "home"}"]`)?.click();
    }
  });
}
chrome.storage.onChanged.addListener((c, area) => {
  if (area === "local" && (c.lnAiOn || c.lnAiKeys || c.lnAiProvider || c.lnAiOffline)) refreshAiTab();
});
refreshAiTab();

// ---------------------------------------------------------------------------
// Toggle button
// ---------------------------------------------------------------------------

function setToggleBtn(active) {
  // "on" is a green dot (grey when off); the words stay for screen readers.
  document.getElementById("toggle-label").textContent = "Highlighter";
  toggleBtn.setAttribute("aria-label", active ? "Highlighter on" : "Highlighter off");
  toggleBtn.title = active ? "Highlighter on: select text on a page to save it" : "Highlighter off";
  toggleBtn.setAttribute("aria-pressed", String(active));
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
    } else if (!selectedCourse) {
      text = "Pick a course, then click a topic to start highlighting.";
    } else if (Object.keys(courseTree[selectedCourse]?.topics || {}).length === 0) {
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
    if (!name) { ccName.focus(); return; }

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

let topicFromStudy = false;   // the modal was opened from the Study tab's topic list

function closeTopicModal() {
  createTopicModal.classList.remove("visible");
  createTopicModal.setAttribute("aria-hidden", "true");
  pendingTopicCourse = null;
  topicFromStudy = false;
}

openCreateTopic.addEventListener("click", () => {
  openTopicModal(selectedCourse);
});

ctCancel.addEventListener("click", closeTopicModal);

ctSubmit.addEventListener("click", () => {
  const name = ctName.value.trim();
  if (!name) { ctName.focus(); return; }
  if (!pendingTopicCourse) return;

  // Made from the Study tab: open it there once it exists.
  if (topicFromStudy && pendingTopicCourse === selectedCourse) studySelectedTopic = name;
  topicFromStudy = false;

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

// Enter saves a form, Esc closes it. The Details box takes several lines,
// so there Enter starts a new line and Ctrl/⌘+Enter saves. A focused
// button keeps its own Enter (Cancel cancels).
function saveOnEnter(modal, submitBtn, close) {
  modal.addEventListener("keydown", (e) => {
    if (e.isComposing) return;  // Enter that confirms an IME composition
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== "Enter" || e.target.tagName === "BUTTON") return;
    if (e.target.tagName === "TEXTAREA" && !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    submitBtn.click();
  });
}

saveOnEnter(createCourseModal, ccSubmit, closeCourseModal);
saveOnEnter(createTopicModal, ctSubmit, closeTopicModal);

// ---------------------------------------------------------------------------
// Export — Study view exports the open topic, Home view the selected course.
// Formatting lives in exporter.js.
// ---------------------------------------------------------------------------

function exportTarget() {
  if (homeView.classList.contains("visible")) {
    const course = courseTree[selectedCourse];
    return course ? { courseName: selectedCourse, course, topicName: null } : null;
  }
  const course = courseTree[selectedCourse];
  if (!course || !studySelectedTopic || !course.topics?.[studySelectedTopic]) return null;
  return { courseName: selectedCourse, course, topicName: studySelectedTopic };
}

function updateExportBtn() {
  updateShareBtn();
  const target = exportTarget();
  exportBtn.disabled = !target;
  exportBtn.textContent = homeView.classList.contains("visible") ? "Export course" : "Export topic";
  exportBtn.title = target
    ? `Download ${target.topicName ? `"${target.topicName}"` : `all of "${target.courseName}"`} as Markdown`
    : (homeView.classList.contains("visible") ? "Select a course first" : "Select a topic first");
}

// ── Share a topic (server/app.py /api/share): needs sync set up. ──
const shareBtn = document.getElementById("share-btn");
let sharePop = null;
async function updateShareBtn() {
  const { lnSyncUrl, lnSyncKey } = await chrome.storage.local.get(["lnSyncUrl", "lnSyncKey"]);
  const t = exportTarget();
  shareBtn.hidden = !(lnSyncUrl && lnSyncKey && t?.topicName && studyView.classList.contains("visible"));
}
function closeSharePop() { sharePop?.remove(); sharePop = null; }
shareBtn.addEventListener("click", () => {
  if (sharePop) { closeSharePop(); return; }
  const t = exportTarget();
  if (!t?.topicName) return;
  sharePop = document.createElement("form");
  sharePop.className = "share-pop";
  sharePop.innerHTML = `<div class="share-title"></div>
    <label class="share-row"><span>Send to</span><input type="text" class="share-to" placeholder="username (optional)" spellcheck="false" autocomplete="off"></label>
    <div class="share-row"><button type="submit" class="share-go">Make link</button><button type="button" class="share-cancel">Cancel</button></div>
    <div class="share-out" aria-live="polite"></div>`;
  sharePop.querySelector(".share-title").textContent = `Share “${t.topicName}” (a copy, as it is now)`;
  document.getElementById("footer").appendChild(sharePop);
  sharePop.querySelector(".share-to").focus();
  sharePop.querySelector(".share-cancel").addEventListener("click", closeSharePop);
  sharePop.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); closeSharePop(); shareBtn.focus(); } });
  sharePop.addEventListener("submit", async (e) => {
    e.preventDefault();
    const out = sharePop.querySelector(".share-out");
    const to = sharePop.querySelector(".share-to").value.trim();
    out.textContent = "Sharing… (a sleeping server can take a minute)";
    const { lnSyncUrl, lnSyncKey } = await chrome.storage.local.get(["lnSyncUrl", "lnSyncKey"]);
    const topic = t.course.topics[t.topicName];
    try {
      const r = await fetch(`${lnSyncUrl.replace(/\/+$/, "")}/api/share`, {
        method: "POST", headers: { Authorization: `Bearer ${lnSyncKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ course: t.courseName, topic: t.topicName, to, notes: { highlights: topic.highlights || {}, notes: topic.notes || {} } })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(`${j.reason || `The server answered ${r.status}.`}${j.code ? ` [${j.code}]` : ""}`);
      let copied = false;
      try { await navigator.clipboard.writeText(j.url); copied = true; } catch (_) {}
      out.replaceChildren(document.createTextNode(`${to ? `Sent to ${to}. ` : ""}${copied ? "Link copied: " : "Link: "}`));
      const link = document.createElement("input");
      link.className = "share-link"; link.readOnly = true; link.value = j.url;
      link.addEventListener("focus", () => link.select());
      out.appendChild(link);
    } catch (err) {
      out.textContent = err.message;
    }
  });
});
chrome.storage.onChanged.addListener((c, a) => { if (a === "local" && (c.lnSyncUrl || c.lnSyncKey)) updateShareBtn(); });

exportBtn.addEventListener("click", () => {
  const target = exportTarget();
  if (!target) return;
  exportNotes({ format: "md", ...target });
});

// ---------------------------------------------------------------------------
// Messages from background
// ---------------------------------------------------------------------------

// Not an async listener: Chrome takes a returned promise as a reply, which
// would answer (with nothing) messages meant for the background, e.g. the
// pop-up's "Join" or "last highlight" questions.
chrome.runtime.onMessage.addListener((message) => { onPanelMessage(message); });
async function onPanelMessage(message) {
  if (message.type === "TOGGLE_HIGHLIGHTER") {
    setToggleBtn(message.active);
    return;
  }

  if (message.type === "NOTES_UPDATED") {
    await refreshCourseTree();
    renderCourseSelects();
    if (studyView.classList.contains("visible")) await loadNotes();
    if (homeView.classList.contains("visible"))  await loadHomeTopics();
    return;
  }
  
  if (message.type === "TOPIC_CREATED") {
    const { courseName } = message;

    await refreshCourseTree();
    renderCourseSelects();

    if (selectedCourse === courseName) {
      await loadHomeTopics();
      await loadStudyTopics();
    }
    return;
  }
}

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
  // Web-page requests are for Chrome's side panel, not a reader's built-in one.
  if (new URLSearchParams(location.search).has("embedded") && !new URLSearchParams(location.search).has("page") && request.type === "FILL_COMPOSER") return;
  chrome.storage.local.remove("panelRequest");
  if (Date.now() - request.at > 60000) return;  // stale, e.g. panel never opened

  if (request.type === "SHOW_CREATE_COURSE") {
    closeTopicModal();
    await openCourseModalWithDefaults();
    return;
  }

  if (request.type === "SHOW_CREATE_TOPIC") {
    await showCreateTopic(request.courseName);
    return;
  }

  // ✎ Note / ❝ Quote from a web page's save pop-up: the words go into the
  // Study tab's note box, as your own words to edit or as a quote line.
  if (request.type === "FILL_COMPOSER") {
    document.querySelector('.view-tab[data-view="study"]')?.click();
    await new Promise((r) => setTimeout(r, 60));
    const box = document.getElementById("composer-input");
    if (!box || box.disabled || !request.text) return;
    if (request.mode === "quote" && box.insertQuoteAt) {
      box.insertQuoteAt(null, request.text);
    } else {
      if (box.caretToEnd) box.caretToEnd(); else box.focus();
      const sep = (box.isRich ? box.textContent : box.value).trim() ? " " : "";
      document.execCommand("insertText", false, sep + request.text.replace(/\s+/g, " ").trim());
    }
    if (box.caretToEnd) box.caretToEnd(); else box.focus();
  }
}

async function showCreateTopic(courseName) {
  await refreshCourseTree();
  await selectCourse(courseName);

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
  if (changes.lnDocs && !changes.lazynotes) loadCourseDocs();

  if (changes.lazynotes) {
    courseTree = changes.lazynotes.newValue?.courses ?? {};

    // A course or topic may have been deleted from the viewer.
    if (selectedCourse && !courseTree[selectedCourse]) {
      selectedCourse     = null;
      studySelectedTopic = null;
      updateCreateTopicBtn();
    }
    // Both tabs, not just the visible one, so switching never shows stale lists.
    renderCourseSelects();
    await loadHomeTopics();
    await loadStudyTopics();
  }

  if (changes.activeCourse || changes.activeTopic) {
    if (changes.activeCourse) activeCourse = changes.activeCourse.newValue ?? null;
    if (changes.activeTopic)  activeTopic  = changes.activeTopic.newValue ?? null;

    // Picked outside the panel (right-click menu, a new course): show it here
    // too. Deletes clear these to null, which leaves the panel's choice alone.
    if (activeCourse && activeCourse !== selectedCourse) {
      await selectCourse(activeCourse);
    } else if (activeTopic && activeTopic !== studySelectedTopic) {
      studySelectedTopic = activeTopic;
      await loadStudyTopics();
    }

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
// PDF tabs — Chrome's built-in PDF viewer doesn't let extensions in, so when
// the active tab is a PDF offer to reopen it in the Lazy Notes reader.
// ---------------------------------------------------------------------------

const pdfBanner     = document.getElementById("pdf-banner");
const pdfBannerOpen = document.getElementById("pdf-banner-open");
let pdfTab = null;

function looksLikePdf(url) {
  if (!url || !/^(https?|file):/.test(url)) return false;
  try {
    return /\.pdf$/i.test(new URL(url).pathname);
  } catch (_) {
    return false;
  }
}

async function updatePdfBanner() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  pdfTab = tab && looksLikePdf(tab.url) ? tab : null;
  pdfBanner.hidden = !pdfTab;
}

pdfBannerOpen.addEventListener("click", () => {
  if (!pdfTab) return;
  chrome.tabs.update(pdfTab.id, {
    url: chrome.runtime.getURL(`pdfreader.html?url=${encodeURIComponent(pdfTab.url)}`)
  });
});

// ---------------------------------------------------------------------------
// Reading now / Continue reading (docs-recent.js keeps lnDocs)
// ---------------------------------------------------------------------------

const readingNowEl = document.getElementById("reading-now");
const continueEl   = document.getElementById("continue");
const continueList = document.getElementById("continue-list");
const READER_PAGES = ["/pdfreader.html", "/pptxreader.html", "/docxreader.html"];

function docKeyOf(url) {
  try {
    const u = new URL(url);
    if (u.origin !== location.origin || !READER_PAGES.includes(u.pathname)) return null;
    return u.pathname + u.search;
  } catch (_) { return null; }
}

function docLink(doc) {
  const unit = doc.kind === "pptx" ? "slide" : "page";
  return chrome.runtime.getURL(doc.key.slice(1)) + `#${unit}=${doc.page || 1}`;
}

// Files the readers already keep (opened from this computer before
// lnDocs existed, or never re-opened since): shown too. Only opened if the
// database exists, since opening a missing one would create it without its
// store and break the reader.
async function storedFiles() {
  const out = [];
  let names = [];
  try { names = (await indexedDB.databases()).map((d) => d.name); } catch (_) { return out; }
  for (const [db, page, kind] of [["lazynotes-pdfs", "/pdfreader.html", "pdf"], ["lazynotes-slides", "/pptxreader.html", "pptx"], ["lazynotes-docs", "/docxreader.html", "docx"]]) {
    if (!names.includes(db)) continue;
    try {
      const records = await new Promise((resolve, reject) => {
        const req = indexedDB.open(db);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const conn = req.result;
          if (!conn.objectStoreNames.contains("files")) { conn.close(); resolve([]); return; }
          const all = conn.transaction("files").objectStore("files").getAll();
          all.onsuccess = () => { conn.close(); resolve(all.result || []); };
          all.onerror = () => { conn.close(); reject(all.error); };
        };
      });
      records.forEach((r) => out.push({ key: `${page}?local=${encodeURIComponent(r.id)}`, kind, name: r.name, openedAt: r.openedAt || 0, page: 1 }));
    } catch (_) { /* skip this store */ }
  }
  return out;
}

const unitName = (doc) => (doc.kind === "pptx" ? "Slide" : "Page");

async function updateReading() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const { lnDocs = {}, activeCourse: c, activeTopic: t } =
    await chrome.storage.local.get(["lnDocs", "activeCourse", "activeTopic"]);
  const key = tab && docKeyOf(tab.url);
  const doc = key && lnDocs[key];

  readingNowEl.hidden = !key;
  continueEl.hidden = false;
  document.getElementById("continue-label").textContent = key ? "Other documents" : "Continue reading";
  fillSavingTo(c, t);
  // "Saving to …" only while a document is open here; with none, just Open / Continue.
  document.getElementById("saving-bar").classList.toggle("no-doc", !key);

  if (key) {
    const icon = document.getElementById("rn-icon");
    const kind = doc?.kind ?? (key.startsWith("/pptx") ? "pptx" : key.startsWith("/docx") ? "docx" : "pdf");
    icon.textContent = kind === "pptx" ? "PPT" : kind === "docx" ? "DOC" : "PDF";
    icon.className = `doc-icon ${kind}`;
    document.getElementById("rn-name").textContent = doc?.name ?? tab.title.replace(/ — Lazy Notes$/, "");
    document.getElementById("rn-meta").textContent = doc
      ? `${unitName(doc)} ${doc.page || 1}${doc.pages ? ` of ${doc.pages}` : ""}` : "";
  }

  const all = { ...Object.fromEntries((await storedFiles()).map((d) => [d.key, d])), ...lnDocs };
  if (key) delete all[key];   // the one open now is in the card above
  const docs = Object.values(all).sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0)).slice(0, 3);
  if (!docs.length) {
    const empty = document.createElement("div");
    empty.className = "cr-empty";
    empty.textContent = "PDFs and slides you open will show here.";
    continueList.replaceChildren(empty);
    return;
  }
  continueList.replaceChildren(...docs.map((doc) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "cr-item";
    const icon = document.createElement("span");
    icon.className = `doc-icon ${doc.kind}`;
    icon.textContent = doc.kind === "pptx" ? "PPT" : doc.kind === "docx" ? "DOC" : "PDF";
    const text = document.createElement("span");
    text.className = "cr-text";
    const name = document.createElement("div");
    name.className = "cr-name";
    name.textContent = doc.name;
    const meta = document.createElement("div");
    meta.className = "cr-meta";
    meta.textContent = [`${unitName(doc)} ${doc.page || 1}${doc.pages ? ` of ${doc.pages}` : ""}`,
                        doc.course && doc.topic ? `${doc.course} › ${doc.topic}` : null].filter(Boolean).join(" · ");
    const bar = document.createElement("div");
    bar.className = "cr-bar";
    const fill = document.createElement("i");
    fill.style.width = `${doc.pages ? Math.round(((doc.page || 1) / doc.pages) * 100) : 0}%`;
    bar.appendChild(fill);
    text.append(name, meta, bar);
    const go = document.createElement("span");
    go.className = "cr-go";
    go.textContent = "Open ›";
    b.append(icon, text, go);
    b.addEventListener("click", () => {
      chrome.tabs.create({ url: docLink(doc) });
      document.querySelector('.view-tab[data-view="study"]')?.click();   // straight to writing notes
    });
    return b;
  }));
}

// "Saving to [Course ▾] › [Topic ▾]" on the document card: pick where this
// document's notes go without leaving it.
const rnCourse = document.getElementById("rn-course");
const rnTopic  = document.getElementById("rn-topic");
enhanceSelect(rnCourse);
enhanceSelect(rnTopic);

function fillOptions(select, names, value, placeholder, action) {
  select.replaceChildren();
  if (!value || !names.includes(value)) {
    const o = new Option(placeholder, "");
    o.disabled = true;
    select.add(o);
  }
  names.forEach((n) => select.add(new Option(n, n)));
  if (action) select.add(new Option(action[1], action[0]));   // "+ New …", listed last
  select.value = value && names.includes(value) ? value : "";
  select.dispatchEvent(new Event("input"));   // redraw the dropdown's button
}

function fillSavingTo(course, topic) {
  const topics = Object.keys(courseTree[course]?.topics ?? {});
  fillOptions(rnCourse, Object.keys(courseTree), course, "Pick a course", ["__create_course__", "+ New course"]);
  fillOptions(rnTopic, topics, topic, topics.length ? "Pick a topic" : "No topics yet", ["__create_topic__", "+ New topic"]);
  rnTopic.closest(".hs").hidden = !course;
  document.getElementById("rn-where").hidden = !!(course && topic);
}

function setSavingTo(course, topic) {
  if (topic) {
    chrome.runtime.sendMessage({ type: "SET_ACTIVE_TOPIC", courseName: course, topicName: topic });
    activeCourse = course;
    activeTopic  = topic;
  }
  if (course !== selectedCourse) selectCourse(course);   // the topic list below follows
  else { renderHomeTopicActiveState(); }
  updateToggleBtnGuard();
  fillSavingTo(course, topic);
}

rnCourse.addEventListener("change", async () => {
  if (rnCourse.value === "__create_course__") {
    fillSavingTo(activeCourse, activeTopic);
    openCourseModalWithDefaults();
    return;
  }
  await refreshCourseTree();
  const course = rnCourse.value;
  const topics = Object.keys(courseTree[course]?.topics ?? {});
  setSavingTo(course, topics[0] ?? null);
});
rnTopic.addEventListener("change", () => {
  if (rnTopic.value === "__create_topic__") {
    const course = rnCourse.value;
    fillSavingTo(activeCourse, activeTopic);
    openTopicModal(course);
    return;
  }
  setSavingTo(rnCourse.value, rnTopic.value);
});

// "+ Open a document…": the computer's file picker right away. The file is
// handed to its reader through that reader's IndexedDB store (same scheme as
// readers/pdfreader.js openInSlidesReader) and opened in a new tab.
const openDocFile = document.getElementById("open-doc-file");
const openDocMsg  = document.getElementById("open-doc-msg");
document.getElementById("open-doc-btn").addEventListener("click", () => { openDocMsg.hidden = true; openDocFile.click(); });
openDocFile.addEventListener("change", async () => {
  const file = openDocFile.files[0];
  openDocFile.value = "";
  if (!file) return;
  const say = (t) => { openDocMsg.textContent = t; openDocMsg.hidden = !t; };
  const kind = /\.pptx$/i.test(file.name) ? "pptx" : /\.docx$/i.test(file.name) ? "docx"
    : (/\.pdf$/i.test(file.name) || file.type === "application/pdf") ? "pdf" : null;
  if (!kind) {
    say(/\.(doc|ppt)$/i.test(file.name)
      ? "Old .doc / .ppt files can't be read: save it as .docx / .pptx or PDF first."
      : "Pick a PDF, .pptx or .docx file.");
    return;
  }
  try {
    const { db: dbName, page } = { pdf: { db: "lazynotes-pdfs", page: "pdfreader.html" },
      pptx: { db: "lazynotes-slides", page: "pptxreader.html" },
      docx: { db: "lazynotes-docs", page: "docxreader.html" } }[kind];
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => req.result.createObjectStore("files", { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
    const all = await new Promise((r) => { const q = db.transaction("files").objectStore("files").getAll(); q.onsuccess = () => r(q.result || []); });
    const id = all.find((f) => f.name === file.name && f.size === file.size)?.id ?? crypto.randomUUID();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("files", "readwrite");
      tx.objectStore("files").put({ id, name: file.name, size: file.size, data: file, openedAt: Date.now() });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    say("");
    chrome.tabs.create({ url: chrome.runtime.getURL(`${page}?local=${encodeURIComponent(id)}`) });
  } catch (err) {
    say("Couldn't open that file: " + (err?.message || err));
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.lnDocs || changes.activeCourse || changes.activeTopic)) updateReading();
});
chrome.tabs.onActivated.addListener(updateReading);
chrome.tabs.onUpdated.addListener((_id, info, tab) => {
  if (tab.active && (info.url || info.status === "complete" || info.title)) updateReading();
});
updateReading();

chrome.tabs.onActivated.addListener(updatePdfBanner);
chrome.tabs.onUpdated.addListener((_id, info, tab) => {
  if (tab.active && (info.url || info.status === "complete")) updatePdfBanner();
});
updatePdfBanner();

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

// Settings: look (Auto/Light/Dark, applied by theme.js) and auto-opening
// .pptx downloads (bg_pptx.js).
(function initSettings() {
  // The controls themselves live in shared/settings.js (also used by All notes).
  const settings = document.getElementById("settings");
  LazySettings.build(document.getElementById("settings-menu"));
  document.addEventListener("click", (e) => { if (!settings.contains(e.target)) settings.open = false; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") settings.open = false; });
})();

// In a window of its own (?window=1) the window's title already says the name.
if (new URLSearchParams(location.search).has("window")) document.body.classList.add("ln-win");

// Built into a reader (readers/embedded-panel.js loads sidepanel.html?embedded=1
// in an iframe): open on Study, and hand the keyboard back and forth.
//   parent → "ln-focus-composer": go to Study and put the cursor in the note box
//   → parent "ln-panel-done": Ctrl/⌘+. here, or Esc in an empty note box
(function embeddedMode() {
  if (!new URLSearchParams(location.search).has("embedded")) return;
  document.body.classList.add("embedded");
  // The built-in panel shows Study and AI only (Home is for the Chrome-side
  // view); "Show Home" in Settings › More options brings it back.
  const showHome = (on) => document.body.classList.toggle("ln-show-home", on === true);
  chrome.storage.local.get("lnEmbedHome", (r) => showHome(r?.lnEmbedHome));
  chrome.storage.onChanged.addListener((c, a) => { if (a === "local" && "lnEmbedHome" in c) showHome(c.lnEmbedHome.newValue); });
  const toStudy = () => document.querySelector('.view-tab[data-view="study"]')?.click();
  setTimeout(toStudy, 0);
  setTimeout(toStudy, 500);   // after init() has drawn the tabs
  // In a web page (page=1) the parent is that page, not an extension page.
  const inPage = new URLSearchParams(location.search).has("page");
  const toParent = (m) => parent.postMessage(m, inPage ? "*" : location.origin);
  const done = () => toParent({ type: "ln-panel-done" });
  // The host's title bar shows which view you're in (Study / AI / Home) and
  // switches on click, so the tab row inside is hidden (CSS).
  const NAMES = { home: "Home", study: "Study", ai: "AI" };
  const tabsNow = () => [...document.querySelectorAll(".view-tab")].filter((t) => !t.hidden);
  const announce = () => {
    const act = document.querySelector(".view-tab.active");
    const views = tabsNow().map((t) => ({ view: t.dataset.view, name: NAMES[t.dataset.view] || t.textContent.trim() }));
    toParent({ type: "ln-view", name: NAMES[act?.dataset.view] || "Study", active: act?.dataset.view || "study", views, count: views.length });
  };
  new MutationObserver(announce).observe(document.getElementById("view-tabs"), { subtree: true, attributes: true, attributeFilter: ["class", "hidden"] });
  setTimeout(announce, 100); setTimeout(announce, 700);
  addEventListener("message", (e) => {
    if (e.source !== parent || (!inPage && e.origin !== location.origin)) return;
    if (e.data?.type === "ln-set-view") {
      document.querySelector(`.view-tab[data-view="${String(e.data.view).replace(/[^a-z]/g, "")}"]`)?.click();
      return;
    }
    if (e.data?.type === "ln-next-view") {
      const ts = tabsNow();
      const i = ts.findIndex((t) => t.classList.contains("active"));
      ts[(i + 1) % ts.length]?.click();
      return;
    }
    if (e.data?.type !== "ln-focus-composer") return;
    toStudy();
    setTimeout(() => {
      const box = document.getElementById("composer-input");
      if (!box) return;
      if (box.caretToEnd) box.caretToEnd(); else box.focus();
    }, 30);
  });
  addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key === "/") {
      e.preventDefault();
      toParent({ type: "ln-toggle-panel" });
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key === ".") {
      e.preventDefault();
      done();
    } else if (e.key === "Escape" && e.target.id === "composer-input" && !e.target.textContent.trim()) {
      e.preventDefault();
      done();
    }
  }, true);
})();

// ---------------------------------------------------------------------------
// Sync not working? Say so, in plain words, with what to do (bg_sync.js
// keeps lnSyncState). Shown after 2 failed tries in a row, or at once for a
// wrong key / too big; ✕ hides it until the problem changes.
// ---------------------------------------------------------------------------
(function syncWarning() {
  const box = document.getElementById("sync-warn");
  if (!box) return;
  const text = box.querySelector(".sync-warn-text");
  const why = (err) => {
    if (/wrong sync key/i.test(err)) return "the sync key in Settings doesn't match LAZYNOTES_KEY on your server.";
    if (/too big/i.test(err)) return "your notes are over the server's 30 MB limit (big figures?).";
    if (/server error \(5/i.test(err)) return "the server had a problem (is its database connected? check DATABASE_URL on Render).";
    if (/server error/i.test(err)) return `the server refused it (${err.replace(/ —.*$/, "")}).`;
    if (/not reachable/i.test(err)) return navigator.onLine === false
      ? "you're offline. It'll sync when you're back."
      : "the server didn't answer (it may be asleep or down, or the address in Settings is wrong).";
    return err.replace(/ —.*$/, "") + ".";
  };
  let hiddenFor = null;
  async function show() {
    const { lnSyncState: st = {}, lnSyncUrl, lnSyncKey } = await chrome.storage.local.get(["lnSyncState", "lnSyncUrl", "lnSyncKey"]);
    const err = st.lastError || "";
    const bad = lnSyncUrl && lnSyncKey && err && !/isn't set up/.test(err) && (st.stopped || (st.failures || 0) >= 2);
    if (!bad || hiddenFor === err.replace(/ —.*$/, "")) { box.hidden = true; return; }
    const retry = err.match(/will retry at (.+)$/)?.[1];
    text.textContent = `⚠ Sync isn't working: ${why(err)}${retry ? ` Next try ${retry}.` : ""}`;
    box.hidden = false;
  }
  box.querySelector(".sync-warn-retry").addEventListener("click", () => {
    text.textContent = "Syncing… (a sleeping server can take a minute)";
    chrome.runtime.sendMessage({ type: "SYNC_NOW" }, () => { void chrome.runtime.lastError; show(); });
  });
  box.querySelector(".sync-warn-fix").addEventListener("click", () => {
    const settings = document.getElementById("settings");
    settings.open = true;
    const sync = settings.querySelector(".set-sync:not(.set-more)");
    if (sync) { sync.open = true; sync.scrollIntoView({ block: "nearest" }); }
  });
  box.querySelector(".sync-warn-x").addEventListener("click", async () => {
    const { lnSyncState: st = {} } = await chrome.storage.local.get("lnSyncState");
    hiddenFor = (st.lastError || "").replace(/ —.*$/, "");
    box.hidden = true;
  });
  chrome.storage.onChanged.addListener((c, area) => { if (area === "local" && (c.lnSyncState || c.lnSyncUrl || c.lnSyncKey)) show(); });
  addEventListener("online", show);
  addEventListener("offline", show);
  show();
})();

init();


// ---------------------------------------------------------------------------
// Online status (header): is this computer online, and are notes reaching
// your server? Click it for Settings › Sync. Off: Settings (lnOnlineStatus).
// ---------------------------------------------------------------------------
(() => {
  const btn = document.getElementById("online");
  if (!btn) return;
  const label = btn.querySelector(".online-label");
  const ago = (ms) => {
    const s = Math.round((Date.now() - ms) / 1000);
    return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(ms).toLocaleDateString();
  };
  async function show() {
    const { lnSyncUrl, lnSyncKey, lnSyncUser, lnSyncState: st = {}, lnOnlineStatus } =
      await chrome.storage.local.get(["lnSyncUrl", "lnSyncKey", "lnSyncUser", "lnSyncState", "lnOnlineStatus"]);
    btn.hidden = lnOnlineStatus === false;
    let tone, text, tip;
    const who = lnSyncUser ? ` · logged in as ${lnSyncUser}` : "";
    if (!navigator.onLine) {
      tone = "off"; text = "Offline";
      tip = "No internet. Your notes are saved on this computer and sync when you're back online. The AI's offline helpers still work.";
    } else if (!lnSyncUrl || !lnSyncKey) {
      tone = "local"; text = "Not syncing";
      tip = "Your notes are only on this computer. Settings › Sync: log in to back them up and read them on your phone.";
    } else if (st.stopped || /key|too big/i.test(st.lastError || "")) {
      tone = "bad"; text = "Sync problem"; tip = `${st.lastError || "Sync stopped."} Click for Settings › Sync.`;
    } else if (st.waking) {
      tone = "wait"; text = "Waking server"; tip = "Your server was asleep (free plan). It takes about a minute to wake.";
    } else if (st.pending) {
      tone = "wait"; text = st.lastError ? "Waiting" : "Syncing";
      tip = st.lastError ? `Can't reach your server yet: ${st.lastError}` : "Changes are on their way to your server.";
    } else if (st.lastOkAt) {
      tone = "ok"; text = "Online"; tip = `Synced ${ago(st.lastOkAt)}${who}.`;
    } else {
      tone = "wait"; text = "Online"; tip = `Not synced yet${who}.`;
    }
    btn.dataset.tone = tone;
    label.textContent = text;
    btn.title = tip;
    btn.setAttribute("aria-label", `${text}: ${tip}`);
  }
  btn.addEventListener("click", () => setTimeout(() => {   // after the "click outside closes settings" handler
    const settings = document.getElementById("settings");
    if (!settings) return;
    settings.open = true;
    const sync = settings.querySelector(".set-sync:not(.set-more)");
    if (sync) { sync.open = true; sync.scrollIntoView({ block: "nearest" }); }
  }, 0));
  chrome.storage.onChanged.addListener((c, a) => {
    if (a === "local" && (c.lnSyncState || c.lnSyncUrl || c.lnSyncKey || c.lnSyncUser || c.lnOnlineStatus)) show();
  });
  addEventListener("online", show);
  addEventListener("offline", show);
  setInterval(show, 60000);   // "Synced 3 min ago" stays true
  show();
})();
