// Lazy Notes — Highlight Workflow Handlers

import { storageGet, storageSet, insertHighlight } from './bg_storage.js';
import { validateHighlight } from './bg_validators.js';
import { notifySidePanel } from './bg_sidepanel.js';
import { broadcastToAllTabs } from './bg_messaging.js';
import { refreshCourseContextMenuItems } from './bg_context_menus.js';

export async function handleNewHighlight(payload) {
  const result = await validateHighlight(payload);

  if (!result.valid) {
    console.warn("LazyNotes [Background]: rejected highlight ->", result.reason);
    return;
  }

  await insertHighlight(payload.id, payload, payload.course, payload.topic);
  notifySidePanel();
}

export async function setHighlighterActive(active) {
  // Turning off keeps the selected topic, so the toggle button and
  // Alt+Shift+H can switch it straight back on.
  await storageSet({ highlighterActive: active });

  const { activeCourse = null, activeTopic = null } = await storageGet([
    "activeCourse",
    "activeTopic"
  ]);

  broadcastToAllTabs({
    type: "TOGGLE_HIGHLIGHTER",
    active,
    activeCourse,
    activeTopic: active ? activeTopic : null
  });

  // The "Exit Lazy Notes" item only exists while the highlighter is on.
  await refreshCourseContextMenuItems();
}

export async function handleToggleTrigger() {
  const { highlighterActive = false, activeCourse = null, activeTopic = null } =
    await storageGet(["highlighterActive", "activeCourse", "activeTopic"]);

  // Can always turn off. Can only turn on if a course AND topic are selected.
  if (!highlighterActive && (!activeCourse || !activeTopic)) {
    console.warn("LazyNotes [Background]: cannot enable highlighter — no course/topic selected.");
    return;
  }

  await setHighlighterActive(!highlighterActive);
}
