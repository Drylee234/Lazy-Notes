// Lazy Notes — Highlight Workflow Handlers

import { storageGet, storageSet, insertHighlight } from './bg_storage.js';
import { validateHighlight } from './bg_validators.js';
import { notifySidePanel } from './bg_sidepanel.js';
import { broadcastToAllTabs } from './bg_messaging.js';

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
  const items = { highlighterActive: active };
  if (!active) items.activeTopic = null;

  await storageSet(items);

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
}

export async function handleToggleTrigger() {
  const { highlighterActive = false } = await storageGet("highlighterActive");
  await setHighlighterActive(!highlighterActive);
}
