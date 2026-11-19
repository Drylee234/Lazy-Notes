// Lazy Notes — offer to open PDFs in the Lazy Notes reader.
//
// Chrome's own PDF viewer doesn't let extensions add anything to the page, so
// when a tab opens a PDF there we show a Chrome notification instead:
//   [Open in Lazy Notes]  [Don't ask again]
// Clicking the notification itself also opens it.
//
// A PDF is spotted by its Content-Type (so links without ".pdf" count too);
// file:// PDFs don't go through webRequest, so those are caught by URL.
//
// Setting: storage.local "pdfPrompt" (default true). The reader's "⋯" menu
// turns it back on after "Don't ask again".

import { storageGet, storageSet } from './bg_storage.js';

const READER_URL = chrome.runtime.getURL("pdfreader.html");

// Notification ids carry the tab and URL so a click still works after the
// service worker has been restarted.
const NOTE_PREFIX = "lazy-notes-pdf|";
const noteId = (tabId, url) => NOTE_PREFIX + JSON.stringify([tabId, url]);

function parseNoteId(id) {
  if (!id.startsWith(NOTE_PREFIX)) return null;
  try {
    const [tabId, url] = JSON.parse(id.slice(NOTE_PREFIX.length));
    return { tabId, url };
  } catch (_) {
    return null;
  }
}

function fileName(url) {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop();
    return decodeURIComponent(last || url);
  } catch (_) {
    return url;
  }
}

// Session-only memory (cleared when the browser closes):
//   prompted: "tabId|url" already offered, so reloads don't nag
//   skip:     URLs the user chose "Open in Chrome's viewer" for
async function sessionGet() {
  const { pdfPromptSession = { prompted: [], skip: [] } } =
    await chrome.storage.session.get("pdfPromptSession");
  return pdfPromptSession;
}
async function sessionSet(value) {
  // Keep it small.
  value.prompted = value.prompted.slice(-200);
  value.skip = value.skip.slice(-200);
  await chrome.storage.session.set({ pdfPromptSession: value });
}

export async function skipPromptFor(url) {
  const s = await sessionGet();
  s.skip.push(url.split("#")[0]);
  await sessionSet(s);
}

async function maybePrompt(tabId, url) {
  if (tabId < 0 || !url) return;
  const { pdfPrompt = true } = await storageGet("pdfPrompt");
  if (!pdfPrompt) return;

  const bare = url.split("#")[0];
  const s = await sessionGet();
  const key = `${tabId}|${bare}`;
  if (s.skip.includes(bare) || s.prompted.includes(key)) return;
  s.prompted.push(key);
  await sessionSet(s);

  chrome.notifications.create(noteId(tabId, url), {
    type: "basic",
    iconUrl: "icons/icon-128.png",
    title: "Take notes on this PDF?",
    message: fileName(url),
    contextMessage: "Lazy Notes can't highlight in Chrome's PDF viewer — open it in the Lazy Notes reader.",
    buttons: [{ title: "Open in Lazy Notes" }, { title: "Don't ask again" }],
    priority: 0
  });
}

async function openInReader(tabId, url) {
  const readerUrl = `${READER_URL}?url=${encodeURIComponent(url)}`;
  try {
    const tab = await chrome.tabs.update(tabId, { url: readerUrl, active: true });
    if (tab?.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
  } catch (_) {
    // The tab is gone — open it in a new one.
    await chrome.tabs.create({ url: readerUrl });
  }
}

// ── Spotting PDFs ──────────────────────────────────────────────────────────

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.frameId !== 0) return;
    const header = (name) =>
      details.responseHeaders?.find((h) => h.name.toLowerCase() === name)?.value || "";

    if (!header("content-type").toLowerCase().includes("application/pdf")) return;
    // "attachment" means Chrome downloads it rather than showing it.
    if (/^\s*attachment/i.test(header("content-disposition"))) return;

    maybePrompt(details.tabId, details.url);
  },
  { urls: ["http://*/*", "https://*/*"], types: ["main_frame"] },
  ["responseHeaders"]
);

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (!info.url) return;
  // Local files never hit webRequest.
  if (/^file:.*\.pdf$/i.test(info.url.split(/[?#]/)[0])) maybePrompt(tabId, info.url);

  // The tab moved somewhere else: its offer is out of date.
  clearNotificationsForTab(tabId, info.url);
});

chrome.tabs.onRemoved.addListener((tabId) => clearNotificationsForTab(tabId, null));

function clearNotificationsForTab(tabId, currentUrl) {
  chrome.notifications.getAll((all) => {
    Object.keys(all || {}).forEach((id) => {
      const n = parseNoteId(id);
      if (n && n.tabId === tabId && n.url.split("#")[0] !== currentUrl?.split("#")[0]) {
        chrome.notifications.clear(id);
      }
    });
  });
}

// ── Responding ─────────────────────────────────────────────────────────────

chrome.notifications.onButtonClicked.addListener(async (id, buttonIndex) => {
  const n = parseNoteId(id);
  if (!n) return;
  chrome.notifications.clear(id);
  if (buttonIndex === 0) await openInReader(n.tabId, n.url);
  if (buttonIndex === 1) await storageSet({ pdfPrompt: false });
});

chrome.notifications.onClicked.addListener(async (id) => {
  const n = parseNoteId(id);
  if (!n) return;
  chrome.notifications.clear(id);
  await openInReader(n.tabId, n.url);
});
