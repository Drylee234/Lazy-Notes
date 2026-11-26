// Lazy Notes — usage and error reports, so problems show up without the
// user having to describe them.
//
// Kept in chrome.storage.local "lnDiag":
//   errors: last 100 { t, where, msg, stack }   (from every extension page
//           via shared/diag.js, and from this service worker)
//   usage:  { "YYYY-MM-DD": { <action>: count } } for the last 30 days
//           (what was used: saves, quick notes, joins… never note text)
// It goes to the sync server with each sync (bg_sync.js: data.lnReport),
// unless Settings › More options › "Send usage & error reports" is off
// (lnSendReports = false), and Settings can copy it as a problem report.

const MAX_ERRORS = 100;
const KEEP_DAYS = 30;

let pending = { errors: [], usage: {} };
let timer = null;

function flushSoon() {
  clearTimeout(timer);
  timer = setTimeout(flush, 3000);
}

async function flush() {
  const add = pending;
  pending = { errors: [], usage: {} };
  if (!add.errors.length && !Object.keys(add.usage).length) return;
  const { lnDiag = {} } = await chrome.storage.local.get("lnDiag");
  const errors = [...(lnDiag.errors || []), ...add.errors].slice(-MAX_ERRORS);
  const usage = lnDiag.usage || {};
  Object.entries(add.usage).forEach(([day, counts]) => {
    const d = usage[day] || (usage[day] = {});
    Object.entries(counts).forEach(([k, n]) => { d[k] = (d[k] || 0) + n; });
  });
  Object.keys(usage).sort().slice(0, -KEEP_DAYS).forEach((d) => delete usage[d]);
  await chrome.storage.local.set({ lnDiag: { errors, usage } });
}

const today = () => new Date().toISOString().slice(0, 10);

export function countUsage(action) {
  if (!action) return;
  const d = pending.usage[today()] || (pending.usage[today()] = {});
  d[action] = (d[action] || 0) + 1;
  flushSoon();
}

export function logError(where, msg, stack) {
  const text = String(msg || "").slice(0, 500);
  if (!text) return;
  // The same error over and over (e.g. in a loop) is kept once a minute.
  const last = pending.errors[pending.errors.length - 1];
  if (last && last.msg === text && last.where === where && Date.now() - last.t < 60000) return;
  pending.errors.push({ t: Date.now(), where: String(where || "").slice(0, 200), msg: text, stack: String(stack || "").slice(0, 1500) });
  flushSoon();
}

// What's in a report: no notes, no sync key.
export async function buildReport() {
  await flush();
  const keys = ["lnDiag", "lnSyncState", "lnTheme", "lnPopupSide", "lnAutocorrectLevel", "lnDocAutoSelect", "pptxAutoOpen",
    "lnPanelMode", "lnQuickDblClick", "lnQuickSelButtons", "lnQuickMenu", "lnQuickFloat", "lnDocCaret", "lnDocWordsOn",
    "lnTypingHints", "lnListHeadType", "lnDropPageNums", "lnDupWarn", "lnHeadSplit", "lnGroupIndent", "lnTidyLog", "highlighterActive"];
  const r = await chrome.storage.local.get(keys);
  const { lazynotes } = await chrome.storage.local.get("lazynotes");
  let courses = 0, topics = 0, highlights = 0, notes = 0;
  Object.values(lazynotes?.courses || {}).forEach((c) => { courses++; Object.values(c.topics || {}).forEach((t) => {
    topics++; highlights += Object.keys(t.highlights || {}).length; notes += Object.keys(t.notes || {}).length; }); });
  const { lnDiag = {}, lnSyncState = null, ...settings } = r;
  return {
    madeAt: new Date().toISOString(),
    version: chrome.runtime.getManifest().version,
    browser: navigator.userAgent,
    counts: { courses, topics, highlights, notes },
    settings,
    sync: lnSyncState,
    usage: lnDiag.usage || {},
    errors: lnDiag.errors || []
  };
}

// This service worker's own errors.
self.addEventListener("error", (e) => logError("background", e.message, e.error?.stack));
self.addEventListener("unhandledrejection", (e) => logError("background", e.reason?.message || String(e.reason), e.reason?.stack));

// Pages report theirs (shared/diag.js). Not async: never answers, except
// for the report itself.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "DIAG_ERROR") { logError(msg.where || sender.url, msg.msg, msg.stack); return; }
  if (msg?.type === "DIAG_REPORT") { buildReport().then(sendResponse, (e) => sendResponse({ error: String(e) })); return true; }
});
