// Lazy Notes — Course + Topic Workflow Handlers

import { storageSet, createCourse, createTopic } from './bg_storage.js';
import { validateCourse, validateTopic } from './bg_validators.js';
import { refreshCourseContextMenuItems } from './bg_context_menus.js';
import { broadcastToAllTabs } from './bg_messaging.js';
import { setHighlighterActive } from './bg_highlights.js';

export async function handleCreateCourse(message) {
  const { name, level, semester, details } = message;

  const result = validateCourse(name, level, semester);
  if (!result.valid) {
    console.warn("LazyNotes [Background]: rejected course ->", result.reason);
    return;
  }

  await createCourse(name, level, semester, details);

  await storageSet({
    lastCourseDefaults: { level, semester }
  });

  await refreshCourseContextMenuItems();

  broadcastToAllTabs({
    type:         "ACTIVE_COURSE_CHANGED",
    activeCourse: name,
    activeTopic:  null
  });
}

export async function handleCreateTopic(message) {
  const { courseName, name } = message;

  const result = await validateTopic(courseName, name);
  if (!result.valid) {
    console.warn("LazyNotes [Background]: rejected topic ->", result.reason);
    return;
  }

  await createTopic(courseName, name);
  await refreshCourseContextMenuItems();

  chrome.runtime.sendMessage(
    { type: "TOPIC_CREATED", courseName, topicName: name },
    () => { if (chrome.runtime.lastError) { /* side panel not open */ } }
  );
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
