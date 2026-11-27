// Lazy Notes — Background Service Worker (thin entry point)

import './bg_diag.js';
import { usesOwnPanel, pagePanel } from './bg_sidepanel.js';
import './bg_storage.js';
import './bg_validators.js';
import './bg_highlights.js';
import './bg_courses.js';
import './bg_context_menus.js';
import './bg_messaging.js';
import './bg_sidepanel.js';
import './bg_pptx.js';
import './bg_sync.js';
import './bg_arrange.js';
import './bg_tidy.js';
import './bg_ai.js';

import { refreshCourseContextMenuItems } from './bg_context_menus.js';
import { ensureContentScripts } from './bg_messaging.js';
import { restoreBadge } from './bg_highlights.js';

// Our readers (PDF / slides / Word) have the Notes panel built in, so Chrome's
// own side panel is switched off there (lnReaderNativePanel = true keeps it)
// and the toolbar button toggles the built-in one. Everywhere else the button
// opens Chrome's side panel as before.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });

const READER_RE = new RegExp("^" + chrome.runtime.getURL("").replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(pdf|pptx|docx)reader\\.html");
const isReader = (url) => READER_RE.test(url || "");

chrome.action.onClicked.addListener((tab) => {
  if (isReader(tab.url)) {
    chrome.tabs.sendMessage(tab.id, { type: "LN_TOGGLE_PANEL" }, () => void chrome.runtime.lastError);
  } else if (usesOwnPanel(tab)) {
    // Our own panel in the page; if the page can't hold it (script blocked),
    // fall back to Chrome's (we're still inside the click here only if fast, so best effort).
    pagePanel(tab.id, "toggle", (ok) => { if (!ok && tab.windowId != null) chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {}); });
  } else if (tab.windowId != null) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});   // inside the click: allowed
  }
});

function syncReaderPanel(tabId, url) {
  if (!isReader(url)) { chrome.sidePanel.setOptions({ tabId, enabled: true }).catch(() => {}); return; }
  chrome.storage.local.get("lnReaderNativePanel", (r) => {
    const keep = r?.lnReaderNativePanel === true;
    chrome.sidePanel.setOptions({ tabId, enabled: keep }).catch(() => {});
    if (!keep) chrome.sidePanel.close?.({ tabId })?.catch?.(() => {});   // already open from the page before: shut it
  });
}
chrome.tabs.onUpdated.addListener((tabId, _info, tab) => syncReaderPanel(tabId, tab.url || tab.pendingUrl));
chrome.tabs.onActivated.addListener(({ tabId }) => chrome.tabs.get(tabId, (t) => { if (t) syncReaderPanel(tabId, t.url); }));

// A reader says it's open (on load and whenever it gets focus): make sure
// Chrome's panel is off for it, whatever the tab events did.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === "READER_READY" && sender.tab?.id != null) syncReaderPanel(sender.tab.id, sender.tab.url);
});

// A reader asks for its window to go full screen (the API needs no click).
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== "READER_FULLSCREEN" || sender.tab?.windowId == null) return;
  chrome.windows.get(sender.tab.windowId, (w) => {
    if (chrome.runtime.lastError || !w || w.type !== "normal" || w.state === "fullscreen") return;
    chrome.windows.update(w.id, { state: "fullscreen" }, () => void chrome.runtime.lastError);
  });
});

chrome.runtime.onInstalled.addListener(() => {
  refreshCourseContextMenuItems();
  ensureContentScripts();  // tabs opened before install/reload
  restoreBadge();
});

chrome.runtime.onStartup.addListener(() => {
  refreshCourseContextMenuItems();
  restoreBadge();
});
