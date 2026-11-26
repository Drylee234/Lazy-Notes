// Lazy Notes — Course + Topic Workflow Handlers

import {
  storageGet, storageSet, createCourse, createTopic,
  deleteCourse, deleteTopic, deleteHighlight
} from './bg_storage.js';
import { validateCourse, validateTopic } from './bg_validators.js';
import { refreshCourseContextMenuItems } from './bg_context_menus.js';
import { broadcastToAllTabs } from './bg_messaging.js';
import { setHighlighterActive } from './bg_highlights.js';
import { requestSidePanel } from './bg_sidepanel.js';

// "BME213 (Physiology)" and "bme213 (physiology) " are the same course: a
// new course or topic whose name differs only in capitals or spaces from one
// you already have uses that one (so notes don't split across two).
const sameName = (a, b) => String(a || "").replace(/\s+/g, " ").trim().toLowerCase() ===
  String(b || "").replace(/\s+/g, " ").trim().toLowerCase();

export async function handleCreateCourse(message) {
  const { level, semester, details } = message;
  const { lazynotes } = await storageGet("lazynotes");
  const existing = Object.keys(lazynotes?.courses || {}).find((k) => sameName(k, message.name));
  const name = existing ?? String(message.name || "").trim();
  if (existing) {
    // Already there: open it instead of starting a second, empty copy.
    await handleCourseSelection(existing);
    await requestSidePanel({ type: "SHOW_CREATE_TOPIC", courseName: existing }, null);
    return;
  }

  const result = validateCourse(name, level, semester);
  if (!result.valid) {
    console.warn("LazyNotes [Background]: rejected course ->", result.reason);
    return;
  }

  await createCourse(name, level, semester, details);

  await storageSet({
    activeCourse:       name,
    activeTopic:        null,
    lastCourseDefaults: { level, semester }
  });

  await refreshCourseContextMenuItems();

  broadcastToAllTabs({
    type:         "ACTIVE_COURSE_CHANGED",
    activeCourse: name,
    activeTopic:  null
  });

  // Immediately prompt the user to create a topic for the new course. The
  // panel is open (the course form lives there), so no need to open it.
  await requestSidePanel({ type: "SHOW_CREATE_TOPIC", courseName: name }, null);
}

export async function handleCreateTopic(message) {
  const { courseName } = message;
  const { lazynotes } = await storageGet("lazynotes");
  const existing = Object.keys(lazynotes?.courses?.[courseName]?.topics || {}).find((k) => sameName(k, message.name));
  if (existing) { await handleTopicSelection(courseName, existing); return; }
  const name = String(message.name || "").trim();

  const result = await validateTopic(courseName, name);
  if (!result.valid) {
    console.warn("LazyNotes [Background]: rejected topic ->", result.reason);
    return;
  }

  await createTopic(courseName, name);

  chrome.runtime.sendMessage(
    { type: "TOPIC_CREATED", courseName, topicName: name },
    () => { if (chrome.runtime.lastError) { /* side panel not open */ } }
  );

  // A new topic is where you're about to take notes: select it and switch
  // the highlighter on, same as clicking it. (Also rebuilds the menu.)
  await handleTopicSelection(courseName, name);
}

export async function handleCourseSelection(courseName) {
  await storageSet({
    activeCourse: courseName,
    activeTopic:  null
  });

  await refreshCourseContextMenuItems();

  broadcastToAllTabs({
    type:         "ACTIVE_COURSE_CHANGED",
    activeCourse: courseName,
    activeTopic:  null
  });
}

export async function handleTopicSelection(courseName, topicName) {
  await storageSet({
    activeCourse: courseName,
    activeTopic:  topicName
  });

  await setHighlighterActive(true);
}

// ---------------------------------------------------------------------------
// Deletes
// ---------------------------------------------------------------------------

// If the course/topic being deleted is the active one, clear it and turn the
// highlighter off so content scripts stop offering a target that's gone.
async function clearActiveIfDeleted(courseName, topicName) {
  const { activeCourse = null, activeTopic = null, highlighterActive = false } =
    await storageGet(["activeCourse", "activeTopic", "highlighterActive"]);

  if (activeCourse !== courseName) return;

  const courseGone = topicName === null;
  const topicGone  = !courseGone && activeTopic === topicName;
  if (!courseGone && !topicGone) return;

  if (highlighterActive) await setHighlighterActive(false);

  await storageSet(courseGone
    ? { activeCourse: null, activeTopic: null }
    : { activeTopic: null });

  broadcastToAllTabs({
    type:         "ACTIVE_COURSE_CHANGED",
    activeCourse: courseGone ? null : courseName,
    activeTopic:  null
  });
}

export async function handleDeleteCourse({ courseName }) {
  if (!courseName) return { ok: false, reason: "Missing course." };

  await deleteCourse(courseName);
  await clearActiveIfDeleted(courseName, null);
  await refreshCourseContextMenuItems();
  return { ok: true };
}

export async function handleDeleteTopic({ courseName, topicName }) {
  if (!courseName || !topicName) return { ok: false, reason: "Missing course or topic." };

  const result = await deleteTopic(courseName, topicName);
  if (result === null) return { ok: false, reason: "Course not found." };

  await clearActiveIfDeleted(courseName, topicName);
  await refreshCourseContextMenuItems();
  return { ok: true };
}

export async function handleDeleteHighlight({ id, courseName, topicName }) {
  if (!id || !courseName || !topicName) return { ok: false, reason: "Missing note." };

  const result = await deleteHighlight(id, courseName, topicName);
  return result === null ? { ok: false, reason: "Topic not found." } : { ok: true };
}
