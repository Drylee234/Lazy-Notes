// Lazy Notes — Context Menus

import { getCourses, storageGet } from './bg_storage.js';
import { setHighlighterActive } from './bg_highlights.js';
import { handleCourseSelection, handleTopicSelection } from './bg_courses.js';
import { requestSidePanel } from './bg_sidepanel.js';

// Dynamic menu ids carry the names JSON-encoded after a "|" separator, so
// they decode back exactly and can never collide (e.g. course "a-b" + topic
// "c" vs course "a" + topic "b-c", which both produced "a-b-c" before and
// made chrome.contextMenus.create throw on the duplicate id).
function courseMenuId(courseName) {
  return `lazy-notes-course|${JSON.stringify(courseName)}`;
}

function topicMenuId(courseName, topicName) {
  return `lazy-notes-topic|${JSON.stringify([courseName, topicName])}`;
}

function createTopicMenuId(courseName) {
  return `lazy-notes-create-topic|${JSON.stringify(courseName)}`;
}

function topicSeparatorId(courseName) {
  return `lazy-notes-topic-separator|${JSON.stringify(courseName)}`;
}

function decodeMenuId(id) {
  const bar = id.indexOf("|");
  if (bar < 0) return null;
  try {
    return { kind: id.slice(0, bar), value: JSON.parse(id.slice(bar + 1)) };
  } catch (_) {
    return null;
  }
}

// Default is "page" only, which hides the menu when right-clicking selected
// text, a link, an input or an image. Every item needs it: a child whose
// contexts don't match is hidden even if its parent shows.
const MENU_CONTEXTS = ["page", "selection", "link", "editable", "image"];

function createMenuItem(props) {
  chrome.contextMenus.create({ contexts: MENU_CONTEXTS, ...props }, () => {
    if (chrome.runtime.lastError) {
      console.warn("LazyNotes [Background]: menu item failed ->", chrome.runtime.lastError.message);
    }
  });
}

export function createStaticMenuItems(highlighterActive) {
  createMenuItem({
    id:    "lazy-notes-root",
    title: "Lazy Notes"
  });

  if (highlighterActive) {
    createMenuItem({
      id:       "lazy-notes-exit",
      parentId: "lazy-notes-root",
      title:    "Exit Lazy Notes"
    });

    createMenuItem({
      id:       "lazy-notes-exit-separator",
      parentId: "lazy-notes-root",
      type:     "separator"
    });
  }

  // Only on links that point at a PDF.
  createMenuItem({
    id:       "lazy-notes-open-pdf-link",
    parentId: "lazy-notes-root",
    title:    "Open PDF in Lazy Notes reader",
    contexts: ["link"],
    targetUrlPatterns: ["*://*/*.pdf", "*://*/*.PDF", "*://*/*.pdf?*", "*://*/*.pdf#*"]
  });

  createMenuItem({
    id:       "lazy-notes-create-course",
    parentId: "lazy-notes-root",
    title:    "Create Course"
  });

  createMenuItem({
    id:       "lazy-notes-course-list-separator",
    parentId: "lazy-notes-root",
    type:     "separator"
  });
}

export function createCourseMenuItems(courses) {
  const names = Object.keys(courses);

  if (names.length === 0) {
    createMenuItem({
      id:       "lazy-notes-no-courses",
      parentId: "lazy-notes-root",
      title:    "No available course",
      enabled:  false
    });
    return;
  }

  names.forEach((courseName) => {
    createMenuItem({
      id:       courseMenuId(courseName),
      parentId: "lazy-notes-root",
      title:    courseName
    });
  });
}

export function createTopicMenuItems(courses) {
  Object.entries(courses).forEach(([courseName, course]) => {
    createMenuItem({
      id:       createTopicMenuId(courseName),
      parentId: courseMenuId(courseName),
      title:    "Create Topic"
    });

    const topicNames = Object.keys(course.topics || {});

    if (topicNames.length > 0) {
      createMenuItem({
        id:       topicSeparatorId(courseName),
        parentId: courseMenuId(courseName),
        type:     "separator"
      });

      topicNames.forEach((topicName) => {
        createMenuItem({
          id:       topicMenuId(courseName, topicName),
          parentId: courseMenuId(courseName),
          title:    topicName
        });
      });
    }
  });
}

// Rebuilds are serialized: two overlapping removeAll/create passes would
// otherwise interleave and fail with "duplicate id" errors.
let menuRebuild = Promise.resolve();

export function refreshCourseContextMenuItems() {
  menuRebuild = menuRebuild.then(rebuildMenus).catch((err) => {
    console.warn("LazyNotes [Background]: context menu rebuild failed ->", err);
  });
  return menuRebuild;
}

async function rebuildMenus() {
  const { highlighterActive = false } = await storageGet("highlighterActive");
  const courses = await getCourses();

  await new Promise((resolve) => chrome.contextMenus.removeAll(resolve));

  createStaticMenuItems(highlighterActive);
  createCourseMenuItems(courses);
  createTopicMenuItems(courses);
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const id = info.menuItemId;

  // Panel requests go first and synchronously: opening the side panel is
  // only allowed while the click still counts as a user gesture.
  if (id === "lazy-notes-create-course") {
    requestSidePanel({ type: "SHOW_CREATE_COURSE" }, tab);
    return;
  }

  const decoded = typeof id === "string" ? decodeMenuId(id) : null;

  if (decoded?.kind === "lazy-notes-create-topic") {
    const courseName = decoded.value;
    requestSidePanel({ type: "SHOW_CREATE_TOPIC", courseName }, tab);
    await handleCourseSelection(courseName);
    return;
  }

  if (id === "lazy-notes-open-pdf-link" && info.linkUrl) {
    chrome.tabs.create({
      url: chrome.runtime.getURL(`pdfreader.html?url=${encodeURIComponent(info.linkUrl)}`),
      index: tab ? tab.index + 1 : undefined,
      openerTabId: tab?.id
    });
    return;
  }

  if (id === "lazy-notes-exit") {
    await setHighlighterActive(false);
    return;
  }

  if (!decoded) return;

  if (decoded.kind === "lazy-notes-topic") {
    const [courseName, topicName] = decoded.value;
    await handleTopicSelection(courseName, topicName);
    return;
  }

  if (decoded.kind === "lazy-notes-course") {
    await handleCourseSelection(decoded.value);
    return;
  }
});
