// QNotes — errors on this extension page go to the problem report
// (background/bg_diag.js). Load first on every page.
(() => {
  if (!globalThis.chrome?.runtime?.sendMessage) return;
  const where = location.pathname.replace(/^\//, "") + (location.search.includes("embedded") ? " (in reader)" : "");
  const send = (msg, stack) => {
    try { chrome.runtime.sendMessage({ type: "DIAG_ERROR", where, msg: String(msg || ""), stack: String(stack || "") }, () => void chrome.runtime.lastError); } catch (_) {}
  };
  addEventListener("error", (e) => {
    // A broken image or script tag has no message; skip those.
    if (e.message) send(e.message, e.error?.stack || `${e.filename}:${e.lineno}:${e.colno}`);
  });
  addEventListener("unhandledrejection", (e) => send(e.reason?.message || String(e.reason), e.reason?.stack));
})();
