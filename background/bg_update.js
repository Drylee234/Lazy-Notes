// Q-notes — "a newer version is out".
//
// The download page (GitHub Pages) publishes version.json = { sha, time } on
// every push to main; each downloaded zip carries build.json with its own.
// A few times a day (and when the panel opens: CHECK_UPDATE) we compare them.
// No build.json (a copy taken straight from git): compare with when this copy
// was loaded instead. Result in lnUpdate = { available, time, sha, checkedAt }.
// Off: Settings (lnUpdateAlert = false).

export const DOWNLOAD_PAGE = "https://drylee234.github.io/Lazy-Notes/";
const ALARM = "ln-update-check";

async function own() {
  try {
    const r = await fetch(chrome.runtime.getURL("build.json"), { cache: "no-store" });
    if (r.ok) return await r.json();
  } catch (_) {}
  return null;
}

export async function checkUpdate() {
  const { lnUpdateAlert, lnLoadedAt = 0 } = await chrome.storage.local.get(["lnUpdateAlert", "lnLoadedAt"]);
  if (lnUpdateAlert === false) return null;
  let latest = null;
  try {
    const r = await fetch(`${DOWNLOAD_PAGE}version.json?t=${Date.now()}`, { cache: "no-store" });
    if (r.ok) latest = await r.json();
  } catch (_) { return null; }   // offline: try later
  if (!latest?.sha || !latest.time) return null;
  const mine = await own();
  const latestAt = Date.parse(latest.time) || 0;
  const available = mine?.sha
    ? mine.sha !== latest.sha && latestAt > (Date.parse(mine.time) || 0)
    : latestAt > lnLoadedAt + 60 * 1000;
  const state = { available, sha: latest.sha, time: latest.time, checkedAt: Date.now() };
  await chrome.storage.local.set({ lnUpdate: state });
  return state;
}

// When this copy was loaded (install, or a reload after updating the folder).
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ lnLoadedAt: Date.now(), lnUpdate: { available: false } });
  chrome.alarms.create(ALARM, { delayInMinutes: 1, periodInMinutes: 6 * 60 });
});
chrome.runtime.onStartup.addListener(() => chrome.alarms.create(ALARM, { delayInMinutes: 1, periodInMinutes: 6 * 60 }));
chrome.alarms.onAlarm.addListener((a) => { if (a.name === ALARM) checkUpdate(); });
chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (msg?.type !== "CHECK_UPDATE") return;
  checkUpdate().then(reply, () => reply(null));
  return true;
});
