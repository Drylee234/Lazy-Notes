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
// Our own panel on web pages (content/page-panel.js) unless switched off.
let ownPanel = true;
chrome.storage.local.get("lnPagePanelOwn", (r) => { ownPanel = r?.lnPagePanelOwn !== false; });
chrome.storage.onChanged.addListener((c, a) => { if (a === "local" && "lnPagePanelOwn" in c) ownPanel = c.lnPagePanelOwn.newValue !== false; });
export const usesOwnPanel = (tab) => ownPanel && /^https?:/i.test(tab?.url || "");

// Tell a tab's page panel to do something (toggle / open / focus). Calls back
// with whether it answered (the page may not hold it: no script there yet).
export function pagePanel(tabId, action, done) {
  chrome.tabs.sendMessage(tabId, { type: "LN_PAGE_PANEL", action }, (r) => {
    const ok = !chrome.runtime.lastError && r?.ok;
    if (ok || !chrome.scripting) { done?.(!!ok); return; }
    // An already-open tab that never got the script: add it, then ask again.
    chrome.scripting.executeScript({ target: { tabId }, files: ["content/page-panel.js"] })
      .then(() => setTimeout(() => chrome.tabs.sendMessage(tabId, { type: "LN_PAGE_PANEL", action }, (r2) => done?.(!chrome.runtime.lastError && !!r2?.ok)), 80))
      .catch(() => done?.(false));
  });
}

export function requestSidePanel(request, tab) {
  const own = usesOwnPanel(tab);
  if (own) {
    pagePanel(tab.id, "open");
  } else if (tab?.windowId != null) {
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
