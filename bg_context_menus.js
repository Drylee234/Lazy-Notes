// Lazy Notes — Context Menus

import { getCourses, storageGet } from './bg_storage.js';
import { setHighlighterActive } from './bg_highlights.js';
import { handleCourseSelection, handleTopicSelection } from './bg_courses.js';
import { sendShowCreateCourse } from './bg_sidepanel.js';

function courseMenuId(courseName) {
  return `lazy-notes-course-${courseName}`;
}

function topicMenuId(courseName, topicName) {
  return `lazy-notes-topic-${courseName}-${topicName}`;
}

function createTopicMenuId(courseName) {
  return `lazy-notes-create-topic-${courseName}`;
}

export function createStaticMenuItems(highlighterActive) {
  chrome.contextMenus.create({
    id:    "lazy-notes-root",
    title: "Lazy Notes"
  });

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
}

export function createCourseMenuItems(courses) {
  const names = Object.keys(courses);

  if (names.length === 0) {
    chrome.contextMenus.create({
      id:       "lazy-notes-no-courses",
      parentId: "lazy-notes-root",
      title:    "No available course",
      enabled:  false
    });
    return;
  }

  names.forEach((courseName) => {
    chrome.contextMenus.create({
      id:       courseMenuId(courseName),
      parentId: "lazy-notes-root",
      title:    courseName
    });
  });
}

export function createTopicMenuItems(courses) {
  Object.entries(courses).forEach(([courseName, course]) => {
    chrome.contextMenus.create({
      id:       createTopicMenuId(courseName),
      parentId: courseMenuId(courseName),
      title:    "Create Topic"
    });

    const topicNames = Object.keys(course.topics || {});

    if (topicNames.length > 0) {
      chrome.contextMenus.create({
        id:       `lazy-notes-topic-separator-${courseName}`,
        parentId: courseMenuId(courseName),
        type:     "separator"
      });

      topicNames.forEach((topicName) => {
        chrome.contextMenus.create({
          id:       topicMenuId(courseName, topicName),
          parentId: courseMenuId(courseName),
          title:    topicName
        });
      });
    }
  });
}

export async function refreshCourseContextMenuItems() {
  const { highlighterActive = false } = await storageGet("highlighterActive");
  const courses = await getCourses();

  await new Promise((resolve) => chrome.contextMenus.removeAll(resolve));

  createStaticMenuItems(highlighterActive);
  createCourseMenuItems(courses);
  createTopicMenuItems(courses);
}

chrome.contextMenus.onClicked.addListener(async (info) => {
  const id = info.menuItemId;

  if (id === "lazy-notes-exit") {
    await setHighlighterActive(false);
    return;
  }

  if (id === "lazy-notes-create-course") {
    sendShowCreateCourse();
    return;
  }

  if (typeof id === "string" && id.startsWith("lazy-notes-create-topic-")) {
    const courseName = id.slice("lazy-notes-create-topic-".length);
    await handleCourseSelection(courseName);
    chrome.runtime.sendMessage(
      { type: "SHOW_CREATE_TOPIC", courseName },
      () => { if (chrome.runtime.lastError) { /* side panel not open */ } }
    );
    return;
  }

  if (typeof id === "string" && id.startsWith("lazy-notes-topic-") && !id.startsWith("lazy-notes-topic-separator-")) {
    // Course/topic names can contain hyphens, so resolve the click back to
    // real names by matching against the ids we actually generated, rather
    // than parsing the string.
    const courses = await getCourses();
    const match = findCourseTopicFromId(courses, id);
    if (match) {
      await handleTopicSelection(match.courseName, match.topicName);
    }
    return;
  }

  if (typeof id === "string" && id.startsWith("lazy-notes-course-")) {
    const courseName = id.slice("lazy-notes-course-".length);
    await handleCourseSelection(courseName);
    return;
  }
});

// Menu IDs are built from raw names, which may contain hyphens themselves —
// so resolve the click back to real course/topic names by matching against
// the ids we actually generated, rather than parsing the string blindly.
function findCourseTopicFromId(courses, id) {
  for (const [courseName, course] of Object.entries(courses)) {
    for (const topicName of Object.keys(course.topics || {})) {
      if (topicMenuId(courseName, topicName) === id) {
        return { courseName, topicName };
      }
    }
  }
  return null;
}
