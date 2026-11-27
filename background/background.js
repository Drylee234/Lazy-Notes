// Lazy Notes — Background Service Worker (thin entry point)

import './bg_diag.js';
import { togglePanelFor } from './bg_sidepanel.js';
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

// New tab pages: Chrome's own side panel (the full panel with Home, to pick
// a document) — the owner's choice; every other page uses ours.
const isNewTab = (url) => /^chrome:\/\/(newtab|new-tab-page)\b/i.test(url || "") || /^chrome-search:\/\/local-ntp/i.test(url || "");
function enableOnNewTab(tabId, url) {
  if (isNewTab(url)) { chrome.sidePanel.setOptions({ tabId, path: "sidepanel.html", enabled: true }).catch(() => {}); return; }
  // Left the new tab page for a normal page: Chrome's panel goes (ours takes over).
  if (url && !isReader(url)) chrome.storage.local.get("lnPagePanelOwn", (r) => {
    if (r?.lnPagePanelOwn !== false) chrome.sidePanel.setOptions({ tabId, enabled: false }).catch(() => {});
  });
}
chrome.tabs.onUpdated.addListener((tabId, _i, tab) => enableOnNewTab(tabId, tab.url || tab.pendingUrl));
chrome.tabs.onCreated.addListener((tab) => enableOnNewTab(tab.id, tab.pendingUrl || tab.url));

chrome.action.onClicked.addListener((tab) => {
  if (isNewTab(tab.url || tab.pendingUrl)) {
    enableOnNewTab(tab.id, tab.url || tab.pendingUrl);
    chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});   // inside the click: allowed
    return;
  }
  if (isReader(tab.url)) {
    chrome.tabs.sendMessage(tab.id, { type: "LN_TOGGLE_PANEL" }, () => void chrome.runtime.lastError);
  } else {
    togglePanelFor(tab);   // ours on the page (or in a small window on pages that can't hold it)
  }
});

// Chrome's own side panel: off everywhere while our own panel is in use
// (lnPagePanelOwn, default on). Readers can keep it with lnReaderNativePanel.
function applyGlobalPanel() {
  chrome.storage.local.get("lnPagePanelOwn", (r) => {
    chrome.sidePanel.setOptions({ enabled: r?.lnPagePanelOwn === false }).catch(() => {});
  });
}
applyGlobalPanel();
chrome.runtime.onInstalled.addListener(applyGlobalPanel);
chrome.runtime.onStartup.addListener(applyGlobalPanel);
chrome.storage.onChanged.addListener((c, a) => { if (a === "local" && "lnPagePanelOwn" in c) applyGlobalPanel(); });

function syncReaderPanel(tabId, url) {
  if (!isReader(url)) return;   // other tabs follow the global setting above
  chrome.storage.local.get(["lnReaderNativePanel", "lnPagePanelOwn"], (r) => {
    const keep = r?.lnReaderNativePanel === true || r?.lnPagePanelOwn === false;
    chrome.sidePanel.setOptions({ tabId, enabled: keep }).catch(() => {});
    if (!keep) chrome.sidePanel.close?.({ tabId })?.catch?.(() => {});   // already open: shut it
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
