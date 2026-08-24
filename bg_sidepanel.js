// Lazy Notes — Side Panel Notifications

import { storageGet } from './bg_storage.js';

export function notifySidePanel() {
  chrome.runtime.sendMessage(
    { type: "NOTES_UPDATED" },
    () => { if (chrome.runtime.lastError) { /* side panel not open */ } }
  );
}

export async function sendShowCreateCourse() {
  const { lastCourseDefaults = {} } = await storageGet("lastCourseDefaults");

  chrome.runtime.sendMessage(
    { type: "SHOW_CREATE_COURSE", defaults: lastCourseDefaults },
    () => { if (chrome.runtime.lastError) { /* side panel not open */ } }
  );
}
