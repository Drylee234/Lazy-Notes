// Lazy Notes — Background service worker

const FLASK_BASE_URL = "http://localhost:5000";

const STORAGE_KEYS = {
  OUTBOX:              "outbox",
  ACTIVE_COURSE:       "activeCourse",
  ACTIVE_COURSE_ID:    "activeCourseId",
  ACTIVE_TOPIC:        "activeTopic",       // { id, name } | null
  AVAILABLE_COURSES:   "availableCourses",  // [name, ...]  (for backward compat display)
  AVAILABLE_TOPICS:    "availableTopics",   // { [courseId]: [{ id, name }, ...] }
  LAST_HIGHLIGHTS:     "lastHighlights",
  LAST_COURSE_DEFAULTS:"lastCourseDefaults",
  HIGHLIGHTER_ACTIVE:  "highlighterActive",
  ALL_HIGHLIGHTS:      "allHighlights"
};

let flushInProgress = false;

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

function storageGet(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (result) => resolve(result));
  });
}

function storageSet(items) {
  return new Promise((resolve) => {
    chrome.storage.local.set(items, () => resolve());
  });
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(() => {
  refreshCourseContextMenuItems();
});

chrome.runtime.onStartup.addListener(() => {
  refreshCourseContextMenuItems();
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

refreshCourseContextMenuItems();

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

async function refreshCourseContextMenuItems() {
  const {
    availableCourses = [],
    availableTopics  = {},
    highlighterActive = false
  } = await storageGet([
    STORAGE_KEYS.AVAILABLE_COURSES,
    STORAGE_KEYS.AVAILABLE_TOPICS,
    STORAGE_KEYS.HIGHLIGHTER_ACTIVE
  ]);

  await new Promise((resolve) => chrome.contextMenus.removeAll(resolve));

  // Root
  chrome.contextMenus.create({
    id:    "lazy-notes-root",
    title: "Lazy Notes"
  });

  // Exit — only when active
  if (highlighterActive) {
    chrome.contextMenus.create({
      id:       "lazy-notes-exit",
      parentId: "lazy-notes-root",
      title:    "Exit Lazy Notes"
    });

    chrome.contextMenus.create({
      id:       "lazy-notes-exit-separator",
      parentId: "lazy-notes-root",
      type:     "separator"
    });
  }

  // Create course
  chrome.contextMenus.create({
    id:       "lazy-notes-create-course",
    parentId: "lazy-notes-root",
    title:    "Create Course"
  });

  chrome.contextMenus.create({
    id:       "lazy-notes-course-list-separator",
    parentId: "lazy-notes-root",
    type:     "separator"
  });

  // Course entries
  if (availableCourses.length === 0) {
    chrome.contextMenus.create({
      id:       "lazy-notes-no-courses",
      parentId: "lazy-notes-root",
      title:    "No available course",
      enabled:  false
    });
    return;
  }

  availableCourses.forEach((course) => {
    // Each course entry is clickable (sets active course, highlighter stays off)
    // AND acts as a parent for its topic sub-items.
    chrome.contextMenus.create({
      id:       `lazy-notes-course-${course.id}`,
      parentId: "lazy-notes-root",
      title:    course.name
    });

    const topics = availableTopics[String(course.id)] || [];

    // Create Topic option always appears first in the sub-menu
    chrome.contextMenus.create({
      id:       `lazy-notes-create-topic-${course.id}`,
      parentId: `lazy-notes-course-${course.id}`,
      title:    "Create Topic"
    });

    if (topics.length > 0) {
      chrome.contextMenus.create({
        id:       `lazy-notes-topic-separator-${course.id}`,
        parentId: `lazy-notes-course-${course.id}`,
        type:     "separator"
      });

      topics.forEach((topic) => {
        chrome.contextMenus.create({
          id:       `lazy-notes-topic-${topic.id}`,
          parentId: `lazy-notes-course-${course.id}`,
          title:    topic.name
        });
      });
    }
  });
}

function broadcastToAllTabs(message) {
  chrome.tabs.query(
    { url: ["http://*/*", "https://*/*"] },
    (tabs) => {
      tabs.forEach((tab) => {
        if (tab.id == null) return;
        chrome.tabs.sendMessage(tab.id, message, () => {
          if (chrome.runtime.lastError) { /* no content script */ }
        });
      });
    }
  );
}

// Sets the active course without turning the highlighter on.
// Fetches and stores that course's topics so the popup and menus are ready.
async function setActiveCourse(courseId, courseName) {
  await storageSet({
    [STORAGE_KEYS.ACTIVE_COURSE]:    courseName,
    [STORAGE_KEYS.ACTIVE_COURSE_ID]: courseId,
    [STORAGE_KEYS.ACTIVE_TOPIC]:     null
  });

  // Fetch topics for this course and store them
  await refreshTopicsForCourse(courseId);

  const { availableTopics = {} } = await storageGet(
    STORAGE_KEYS.AVAILABLE_TOPICS
  );

  const topics = availableTopics[String(courseId)] || [];

  broadcastToAllTabs({
    type:           "ACTIVE_COURSE_CHANGED",
    activeCourse:   courseName,
    activeCourseId: courseId,
    activeTopic:    null,
    availableTopics: topics
  });
}

// Sets the active topic AND turns the highlighter on.
async function setActiveTopic(topicId, topicName, courseId, courseName) {
  const { availableCourses = [] } = await storageGet(
    STORAGE_KEYS.AVAILABLE_COURSES
  );

  const { availableTopics = {} } = await storageGet(
    STORAGE_KEYS.AVAILABLE_TOPICS
  );

  const topics = availableTopics[String(courseId)] || [];

  await storageSet({
    [STORAGE_KEYS.ACTIVE_COURSE]:    courseName,
    [STORAGE_KEYS.ACTIVE_COURSE_ID]: courseId,
    [STORAGE_KEYS.ACTIVE_TOPIC]:     { id: topicId, name: topicName }
  });

  await setHighlighterActive(true, {
    activeCourse:    courseName,
    activeCourseId:  courseId,
    activeTopic:     { id: topicId, name: topicName },
    availableCourses,
    availableTopics:  topics
  });
}

// Fetch topics from Flask for a given courseId and persist to storage.
async function refreshTopicsForCourse(courseId) {
  try {
    const response = await fetch(
      `${FLASK_BASE_URL}/listTopics?courseId=${courseId}`
    );

    if (!response.ok) return;

    const topics = await response.json();

    const { availableTopics = {} } = await storageGet(
      STORAGE_KEYS.AVAILABLE_TOPICS
    );

    availableTopics[String(courseId)] = topics.map((t) => ({
      id:   t.id,
      name: t.name
    }));

    await storageSet({
      [STORAGE_KEYS.AVAILABLE_TOPICS]: availableTopics
    });
  } catch (err) {
    console.error("LazyNotes [Background]: refreshTopicsForCourse failed ->", err.message);
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  // Exit
  if (info.menuItemId === "lazy-notes-exit") {
    await storageSet({ [STORAGE_KEYS.HIGHLIGHTER_ACTIVE]: false });

    const {
      activeCourse    = null,
      activeCourseId  = null,
      activeTopic     = null,
      availableCourses = [],
      availableTopics  = {}
    } = await storageGet([
      STORAGE_KEYS.ACTIVE_COURSE,
      STORAGE_KEYS.ACTIVE_COURSE_ID,
      STORAGE_KEYS.ACTIVE_TOPIC,
      STORAGE_KEYS.AVAILABLE_COURSES,
      STORAGE_KEYS.AVAILABLE_TOPICS
    ]);

    const topics = availableTopics[String(activeCourseId)] || [];

    broadcastToAllTabs({
      type:            "TOGGLE_HIGHLIGHTER",
      active:          false,
      activeCourse,
      activeCourseId,
      activeTopic,
      availableCourses,
      availableTopics: topics
    });

    return;
  }

  // Create course
  if (info.menuItemId === "lazy-notes-create-course") {
    if (tab?.id != null) sendShowCreateCourse(tab.id);
    return;
  }

  // Create topic — "lazy-notes-create-topic-{courseId}"
  if (
    typeof info.menuItemId === "string" &&
    info.menuItemId.startsWith("lazy-notes-create-topic-")
  ) {
    const courseId = parseInt(
      info.menuItemId.replace("lazy-notes-create-topic-", ""),
      10
    );

    // Find course name from storage
    const { availableCourses = [] } = await storageGet(
      STORAGE_KEYS.AVAILABLE_COURSES
    );
    const course = availableCourses.find((c) => c.id === courseId);
    const courseName = course ? course.name : null;

    // Set course active (no highlighter), then tell side panel to open topic form
    if (courseName) await setActiveCourse(courseId, courseName);

    broadcastToAllTabs({
      type:     "SHOW_CREATE_TOPIC",
      courseId,
      courseName
    });

    return;
  }

  // Topic clicked — "lazy-notes-topic-{topicId}"
  if (
    typeof info.menuItemId === "string" &&
    info.menuItemId.startsWith("lazy-notes-topic-")
  ) {
    const topicId = parseInt(
      info.menuItemId.replace("lazy-notes-topic-", ""),
      10
    );

    // Find which course this topic belongs to from availableTopics
    const { availableTopics = {}, availableCourses = [] } = await storageGet([
      STORAGE_KEYS.AVAILABLE_TOPICS,
      STORAGE_KEYS.AVAILABLE_COURSES
    ]);

    let foundCourseId = null;
    let foundTopicName = null;

    for (const [cId, topics] of Object.entries(availableTopics)) {
      const match = topics.find((t) => t.id === topicId);
      if (match) {
        foundCourseId = parseInt(cId, 10);
        foundTopicName = match.name;
        break;
      }
    }

    if (!foundCourseId) return;

    const course = availableCourses.find((c) => c.id === foundCourseId);
    const courseName = course ? course.name : null;

    if (!courseName) return;

    await setActiveTopic(topicId, foundTopicName, foundCourseId, courseName);
    return;
  }

  // Course clicked directly — "lazy-notes-course-{courseId}"
  if (
    typeof info.menuItemId === "string" &&
    info.menuItemId.startsWith("lazy-notes-course-")
  ) {
    const courseId = parseInt(
      info.menuItemId.replace("lazy-notes-course-", ""),
      10
    );

    const { availableCourses = [] } = await storageGet(
      STORAGE_KEYS.AVAILABLE_COURSES
    );

    const course = availableCourses.find((c) => c.id === courseId);
    if (!course) return;

    // Just sets the course active — highlighter stays off
    await setActiveCourse(courseId, course.name);
  }
});

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === "toggle-highlighter") {
    await handleToggleTrigger();
    return;
  }

  if (command === "create-course") {
    if (tab?.id != null) sendShowCreateCourse(tab.id);
  }
});

// ---------------------------------------------------------------------------
// Highlighter toggle
// ---------------------------------------------------------------------------

// overrideState lets callers (like setActiveTopic) pass the full broadcast
// payload directly rather than re-reading storage.
async function setHighlighterActive(active, overrideState = null) {
  let state = overrideState;

  if (!state) {
    const {
      activeCourse    = null,
      activeCourseId  = null,
      activeTopic     = null,
      availableCourses = [],
      availableTopics  = {}
    } = await storageGet([
      STORAGE_KEYS.ACTIVE_COURSE,
      STORAGE_KEYS.ACTIVE_COURSE_ID,
      STORAGE_KEYS.ACTIVE_TOPIC,
      STORAGE_KEYS.AVAILABLE_COURSES,
      STORAGE_KEYS.AVAILABLE_TOPICS
    ]);

    const topics = availableTopics[String(activeCourseId)] || [];

    state = {
      activeCourse,
      activeCourseId,
      activeTopic,
      availableCourses,
      availableTopics: topics
    };
  }

  await storageSet({ [STORAGE_KEYS.HIGHLIGHTER_ACTIVE]: active });

  if (!active) {
    // Clear active topic on turn-off — topic selection is session-scoped
    await storageSet({ [STORAGE_KEYS.ACTIVE_TOPIC]: null });
    await flushOutbox();
    await pruneSavedFromAllHighlights();
  }

  broadcastToAllTabs({
    type: "TOGGLE_HIGHLIGHTER",
    active,
    ...state
  });
}

async function handleToggleTrigger() {
  const { highlighterActive = false } = await storageGet(
    STORAGE_KEYS.HIGHLIGHTER_ACTIVE
  );

  await setHighlighterActive(!highlighterActive);
}

function sendShowCreateCourse(tabId) {
  storageGet(STORAGE_KEYS.LAST_COURSE_DEFAULTS).then(
    ({ lastCourseDefaults }) => {
      chrome.tabs.sendMessage(
        tabId,
        {
          type:     "SHOW_CREATE_COURSE",
          defaults: lastCourseDefaults || null
        },
        () => { if (chrome.runtime.lastError) { /* no content script */ } }
      );
    }
  );
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "NEW_HIGHLIGHT") {
    handleNewHighlight(message);
    return;
  }

  if (message.type === "CREATE_COURSE") {
    handleCreateCourse(message);
    return;
  }

  if (message.type === "CREATE_TOPIC") {
    handleCreateTopic(message);
    return;
  }

  if (message.type === "SET_ACTIVE_COURSE") {
    setActiveCourse(message.courseId, message.courseName);
    return;
  }

  if (message.type === "SET_ACTIVE_TOPIC") {
    setActiveTopic(
      message.topicId,
      message.topicName,
      message.courseId,
      message.courseName
    );
    return;
  }

  if (message.type === "TOGGLE_HIGHLIGHTER_REQUEST") {
    handleToggleTrigger();
  }
});

// ---------------------------------------------------------------------------
// allHighlights helpers
// ---------------------------------------------------------------------------

async function addToAllHighlights(item) {
  const { allHighlights = [] } = await storageGet(
    STORAGE_KEYS.ALL_HIGHLIGHTS
  );

  allHighlights.push({
    ...item,
    status:        "pending",
    statusMessage: null
  });

  await storageSet({
    [STORAGE_KEYS.ALL_HIGHLIGHTS]: allHighlights
  });
}

async function updateAllHighlightsStatus(queuedAt, status, statusMessage = null) {
  const { allHighlights = [] } = await storageGet(
    STORAGE_KEYS.ALL_HIGHLIGHTS
  );

  const updated = allHighlights.map((h) =>
    h.queuedAt === queuedAt
      ? { ...h, status, statusMessage, statusAt: new Date().toISOString() }
      : h
  );

  await storageSet({
    [STORAGE_KEYS.ALL_HIGHLIGHTS]: updated
  });
}

async function pruneSavedFromAllHighlights() {
  const { allHighlights = [] } = await storageGet(
    STORAGE_KEYS.ALL_HIGHLIGHTS
  );

  const kept = allHighlights.filter((h) => h.status !== "saved");

  await storageSet({ [STORAGE_KEYS.ALL_HIGHLIGHTS]: kept });

  console.log(
    `LazyNotes [Background]: Highlighter off — pruned saved items. ` +
    `Kept ${kept.length} unsent/failed item(s) in allHighlights.`
  );
}

// ---------------------------------------------------------------------------
// Outbox
// ---------------------------------------------------------------------------

async function handleNewHighlight(payload) {
  const queuedAt = new Date().toISOString();
  const item     = { ...payload, queuedAt };

  const { outbox = [] } = await storageGet(STORAGE_KEYS.OUTBOX);

  outbox.push(item);

  await storageSet({ [STORAGE_KEYS.OUTBOX]: outbox });

  await addToAllHighlights(item);

  console.log("LazyNotes [Background]: Highlight queued. Outbox size:", outbox.length);
  flushOutbox();
}

async function flushOutbox() {
  if (flushInProgress) {
    console.log("LazyNotes [Background]: Flush already in progress, skipping.");
    return;
  }

  flushInProgress = true;

  try {
    const healthy = await checkFlaskHealth();

    if (!healthy) {
      console.warn("LazyNotes [Background]: Flask unreachable. Leaving outbox as pending.");
      return;
    }

    while (true) {
      const { outbox = [] } = await storageGet(STORAGE_KEYS.OUTBOX);

      if (outbox.length === 0) break;

      const remaining  = [];
      let anySucceeded = false;

      for (const item of outbox) {
        const result = await sendHighlight(item);

        if (result.ok) {
          anySucceeded = true;
          await recordLastHighlight(item);
          await updateAllHighlightsStatus(item.queuedAt, "saved");
        } else {
          remaining.push(item);
          await updateAllHighlightsStatus(item.queuedAt, "failed", result.message);
        }
      }

      const { outbox: currentOutbox = [] } = await storageGet(STORAGE_KEYS.OUTBOX);

      const processedIds = new Set(outbox.map((item) => item.queuedAt));
      const newlyQueued  = currentOutbox.filter(
        (item) => !processedIds.has(item.queuedAt)
      );

      await storageSet({
        [STORAGE_KEYS.OUTBOX]: [...remaining, ...newlyQueued]
      });

      if (anySucceeded) notifySidePanel();

      if (remaining.length === outbox.length && newlyQueued.length === 0) {
        console.warn("LazyNotes [Background]: All outbox items failed. Stopping flush.");
        break;
      }

      if (remaining.length > 0) break;
    }
  } finally {
    flushInProgress = false;
  }
}

async function checkFlaskHealth() {
  try {
    const response = await fetch(`${FLASK_BASE_URL}/health`);
    return response.ok;
  } catch (err) {
    console.error("LazyNotes [Background]: /health check failed ->", err.message);
    return false;
  }
}

async function sendHighlight(item) {
  const highlightPayload = {
    topicId:    item.topicId,
    text:       item.text,
    category:   item.category,
    context:    item.context,
    annotation: item.annotation,
    source:     item.sourceUrl
  };

  console.log("LazyNotes [Background]: Sending highlight to Flask ->", highlightPayload);

  try {
    const response = await fetch(
      `${FLASK_BASE_URL}/newhighlight`,
      {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(highlightPayload)
      }
    );

    if (!response.ok) {
      let body = null;
      try { body = await response.json(); } catch (_) {}
      const message = (body && body.message) || `HTTP ${response.status}`;
      console.error(
        `LazyNotes [Background]: /newhighlight returned ${response.status}.`,
        "Payload:", highlightPayload, "Flask response:", body
      );
      return { ok: false, message };
    }

    const data = await response.json();
    console.log("LazyNotes [Background]: Highlight saved ->", data);
    return { ok: true };
  } catch (err) {
    console.error("LazyNotes [Background]: fetch to /newhighlight failed ->", err.message);
    return { ok: false, message: err.message };
  }
}

async function recordLastHighlight(item) {
  const { lastHighlights = [] } = await storageGet(STORAGE_KEYS.LAST_HIGHLIGHTS);

  const updated = [item, ...lastHighlights].slice(0, 3);

  await storageSet({ [STORAGE_KEYS.LAST_HIGHLIGHTS]: updated });
}

function notifySidePanel() {
  chrome.storage.local.set({ notesUpdatedAt: Date.now() });

  chrome.runtime.sendMessage(
    { type: "NOTES_UPDATED" },
    () => { if (chrome.runtime.lastError) { /* side panel not open */ } }
  );
}

// ---------------------------------------------------------------------------
// Course creation
// ---------------------------------------------------------------------------

async function handleCreateCourse(message) {
  const { name, year, semester, details } = message;

  try {
    const response = await fetch(
      `${FLASK_BASE_URL}/createcourse`,
      {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ name, year, semester, details })
      }
    );

    if (!response.ok) return;

    const data = await response.json();

    const courseId = data.id;

    const { availableCourses = [] } = await storageGet(
      STORAGE_KEYS.AVAILABLE_COURSES
    );

    // availableCourses is now an array of { id, name } objects
    const alreadyExists = availableCourses.some((c) => c.id === courseId);
    const updatedCourses = alreadyExists
      ? availableCourses
      : [...availableCourses, { id: courseId, name }];

    await storageSet({
      [STORAGE_KEYS.AVAILABLE_COURSES]:    updatedCourses,
      [STORAGE_KEYS.ACTIVE_COURSE]:        name,
      [STORAGE_KEYS.ACTIVE_COURSE_ID]:     courseId,
      [STORAGE_KEYS.ACTIVE_TOPIC]:         null,
      // Highlighter stays OFF after course creation — user must create a topic first
      [STORAGE_KEYS.HIGHLIGHTER_ACTIVE]:   false,
      [STORAGE_KEYS.LAST_COURSE_DEFAULTS]: { year, semester }
    });

    refreshCourseContextMenuItems();

    // Tell the side panel to open the create-topic form for this new course
    chrome.runtime.sendMessage({
      type:       "SHOW_CREATE_TOPIC",
      courseId,
      courseName: name
    }, () => { if (chrome.runtime.lastError) { /* side panel not open */ } });

    // Also broadcast course change so content scripts know the active course
    broadcastToAllTabs({
      type:            "ACTIVE_COURSE_CHANGED",
      activeCourse:    name,
      activeCourseId:  courseId,
      activeTopic:     null,
      availableTopics: []
    });

  } catch (err) {
    console.error("LazyNotes [Background]: handleCreateCourse failed ->", err.message);
  }
}

// ---------------------------------------------------------------------------
// Topic creation
// ---------------------------------------------------------------------------

async function handleCreateTopic(message) {
  const { courseId, courseName, name, details } = message;

  try {
    const response = await fetch(
      `${FLASK_BASE_URL}/createtopic`,
      {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ courseId, name, details })
      }
    );

    if (!response.ok) return;

    const data = await response.json();

    const topicId   = data.id;
    const topicName = data.name;

    // Refresh stored topics for this course
    await refreshTopicsForCourse(courseId);

    // Rebuild context menus so the new topic appears
    refreshCourseContextMenuItems();

    // Notify side panel so it can refresh its topic list
    chrome.runtime.sendMessage({
      type:       "TOPIC_CREATED",
      courseId,
      topicId,
      topicName
    }, () => { if (chrome.runtime.lastError) { /* side panel not open */ } });

  } catch (err) {
    console.error("LazyNotes [Background]: handleCreateTopic failed ->", err.message);
  }
}

// ---------------------------------------------------------------------------
// Storage synchronization
// ---------------------------------------------------------------------------

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;

  if (changes.availableCourses || changes.highlighterActive || changes.availableTopics) {
    refreshCourseContextMenuItems();
  }

  if (changes.activeCourse || changes.activeTopic) {
    // Content scripts are notified via explicit broadcastToAllTabs calls
    // in setActiveCourse / setActiveTopic — no need to re-broadcast here.
  }
});
