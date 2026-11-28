// Q-notes — Highlight Workflow Handlers

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
  updateBadge(active);

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

  // The "Exit Q-notes" item only exists while the highlighter is on.
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

// Highlighter on: a big green dot on the toolbar icon (the one beside the
// puzzle piece), the same green as the panel's Highlighter switch, so you see
// at a glance that selecting text will open the save pop-up. Chrome's badge
// can only draw a small square in the corner, so the dot is painted onto the
// icon itself. Off: the plain icon.
const ICON = { 16: "icons/icon-16.png", 32: "icons/icon-32.png" };
let dotIcons = null;   // { 16: ImageData, 32: ImageData }, made once

async function iconsWithDot() {
  if (dotIcons) return dotIcons;
  const out = {};
  for (const size of [16, 32]) {
    const blob = await (await fetch(chrome.runtime.getURL(ICON[size]))).blob();
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(size, size);
    const g = c.getContext("2d");
    g.drawImage(bmp, 0, 0, size, size);
    // Bottom-right, about half the icon wide, with a white ring so it shows
    // on the purple icon and on dark toolbars.
    const r = size * 0.25, cx = size - r - size * 0.03, cy = size - r - size * 0.03;
    g.beginPath(); g.arc(cx, cy, r + size * 0.07, 0, Math.PI * 2); g.fillStyle = "#ffffff"; g.fill();
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fillStyle = "#22c55e"; g.fill();
    out[size] = g.getImageData(0, 0, size, size);
  }
  return (dotIcons = out);
}

export async function updateBadge(active) {
  chrome.action.setBadgeText({ text: "" });
  chrome.action.setTitle({ title: active ? "Q-notes · highlighter on" : "Q-notes · highlighter off" });
  try {
    if (active) await chrome.action.setIcon({ imageData: await iconsWithDot() });
    else await chrome.action.setIcon({ path: ICON });
  } catch (_) {
    // Couldn't draw the icon: fall back to Chrome's small badge.
    chrome.action.setBadgeText({ text: active ? " " : "" });
    if (active) chrome.action.setBadgeBackgroundColor({ color: "#22c55e" });
  }
}

export async function restoreBadge() {
  const { highlighterActive = false } = await storageGet("highlighterActive");
  updateBadge(highlighterActive);
}
