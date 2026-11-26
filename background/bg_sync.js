import { buildReport } from './bg_diag.js';
// Lazy Notes — sync your notes to your own server, so the phone site can
// read them. The server is often asleep (free hosts) or off, so this is
// patient and quiet: changes are marked pending, pushed after a short pause,
// and retried later with chrome.alarms (which survive the service worker
// stopping) until the server answers.
//
// Settings (shared/settings.js): lnSyncUrl, lnSyncKey.
// State, for the settings' status line:
//   lnSyncState = { lastOkAt, lastTryAt, lastError, pending, nextTryAt, failures, stopped }
// Server API: GET /api/health, PUT /api/snapshot (Bearer key).

const ALARM_RETRY = "ln-sync-retry";
const ALARM_SOON  = "ln-sync-soon";      // the ~20s pause after a change
const ALARM_DAILY = "ln-sync-periodic";  // every 6 hours anyway
const BACKOFF_MIN = [1, 5, 15, 30, 60];  // then every 60 min
const DEBOUNCE_MS = 20 * 1000;

let running = false;
let again   = false;

async function getState() {
  const { lnSyncState } = await chrome.storage.local.get("lnSyncState");
  return { pending: false, failures: 0, ...(lnSyncState || {}) };
}
async function setState(patch) {
  const state = { ...(await getState()), ...patch };
  await chrome.storage.local.set({ lnSyncState: state });
  return state;
}

async function config() {
  const { lnSyncUrl, lnSyncKey } = await chrome.storage.local.get(["lnSyncUrl", "lnSyncKey"]);
  const url = String(lnSyncUrl || "").trim().replace(/\/+$/, "");
  const key = String(lnSyncKey || "").trim();
  return url && key ? { url, key } : null;
}

function fetchWithTimeout(url, opts, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  return fetch(url, { ...opts, signal: ctl.signal }).finally(() => clearTimeout(t));
}

const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

async function scheduleRetry(failures, message) {
  const mins = BACKOFF_MIN[Math.min(failures - 1, BACKOFF_MIN.length - 1)];
  const at = Date.now() + mins * 60 * 1000;
  await chrome.alarms.create(ALARM_RETRY, { when: at });
  return setState({ pending: true, failures, nextTryAt: at, lastError: `${message} — will retry at ${clock(at)}` });
}

// Push the notes now (if configured). Only one at a time; a change during a
// push queues one more.
async function push({ manual = false } = {}) {
  if (running) { again = true; return getState(); }
  const cfg = await config();
  if (!cfg) return setState({ lastError: "Sync isn't set up" });
  const st = await getState();
  if (st.stopped && !manual) return st;   // wrong key: wait for new settings or "Sync now"

  running = true;
  again = false;
  await setState({ lastTryAt: Date.now() });
  try {
    // Wake a sleeping host first (can take up to a minute).
    try {
      await fetchWithTimeout(`${cfg.url}/api/health`, {}, 60000);
    } catch (_) {
      return await scheduleRetry((st.failures || 0) + 1, "Server not reachable");
    }

    const { lazynotes = null, lnDocs = {}, lnSendReports } = await chrome.storage.local.get(["lazynotes", "lnDocs", "lnSendReports"]);
    // Usage + error report (no note text, no key) rides along unless it's switched off.
    const lnReport = lnSendReports === false ? null : await buildReport().catch(() => null);
    const body = JSON.stringify({ app: "lazy-notes", version: 1, sentAt: new Date().toISOString(), data: { lazynotes, lnDocs, lnReport } });
    let res;
    try {
      res = await fetchWithTimeout(`${cfg.url}/api/snapshot`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${cfg.key}` },
        body
      }, 30000);
    } catch (_) {
      return await scheduleRetry((st.failures || 0) + 1, "Server not reachable");
    }

    if (res.status === 401 || res.status === 403) {
      await chrome.alarms.clear(ALARM_RETRY);
      return await setState({ pending: true, stopped: true, nextTryAt: null, lastError: "Wrong sync key" });
    }
    if (res.status === 413) {
      await chrome.alarms.clear(ALARM_RETRY);
      return await setState({ pending: true, stopped: true, nextTryAt: null, lastError: "Backup too big for the server" });
    }
    if (!res.ok) return await scheduleRetry((st.failures || 0) + 1, `Server error (${res.status})`);

    await chrome.alarms.clear(ALARM_RETRY);
    return await setState({ pending: false, stopped: false, failures: 0, nextTryAt: null, lastError: null, lastOkAt: Date.now() });
  } finally {
    running = false;
    if (again) { again = false; markPending(); }
  }
}

// Something changed: push after a short pause (changes come in bursts).
async function markPending() {
  if (!(await config())) return;
  await setState({ pending: true });
  await chrome.alarms.create(ALARM_SOON, { when: Date.now() + DEBOUNCE_MS });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.lazynotes || changes.lnDocs) {
    if (running) again = true; else markPending();
  }
  // New address or key: start fresh (and clear a "wrong key" stop).
  if (changes.lnSyncUrl || changes.lnSyncKey) {
    setState({ stopped: false, failures: 0, lastError: null }).then(markPending);
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_SOON || alarm.name === ALARM_RETRY) push();
  if (alarm.name === ALARM_DAILY) push();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "SYNC_NOW") return;
  setState({ stopped: false }).then(() => push({ manual: true })).then(sendResponse, (e) => sendResponse({ lastError: String(e) }));
  return true;
});

// Startup: the periodic push, and anything left pending.
chrome.alarms.get(ALARM_DAILY, (a) => { if (!a) chrome.alarms.create(ALARM_DAILY, { periodInMinutes: 6 * 60 }); });
getState().then((st) => {
  if (st.pending && !st.stopped && !st.nextTryAt) markPending();
  else if (st.pending && st.nextTryAt && st.nextTryAt < Date.now()) push();
});
