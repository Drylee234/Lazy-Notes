// Lazy Notes — Side Panel Notifications + Requests

import { storageSet } from './bg_storage.js';

export function notifySidePanel() {
  chrome.runtime.sendMessage(
    { type: "NOTES_UPDATED" },
    () => { if (chrome.runtime.lastError) { /* side panel not open */ } }
  );
}

// Ask the side panel to do something (show a form), opening it if needed.
//
// A runtime message is lost when the panel is closed, so the request is left
// in storage under "panelRequest": an open panel sees the change, a panel
// that is just opening reads it on start. Either way it then deletes it.
//
// chrome.sidePanel.open only works inside a user gesture (context-menu click,
// keyboard shortcut), so call this synchronously from that handler, before
// any await. Pass tab = null when the panel is known to be open already.
export function requestSidePanel(request, tab) {
  if (tab?.windowId != null) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch((err) => {
      console.warn("LazyNotes [Background]: couldn't open side panel ->", err);
    });
  }

  return storageSet({
    panelRequest: {
      ...request,
      windowId: tab?.windowId ?? null,  // only that window's panel acts on it
      at: Date.now()
    }
  });
}
