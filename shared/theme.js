// QNotes — Light / Dark / Auto for every extension page.
// The choice lives in chrome.storage.local.lnTheme ("auto" | "light" | "dark")
// and is copied to localStorage so the page gets it before first paint.
// theme.css reads <html data-theme>; no attribute = follow the computer.
(() => {
  const apply = (t) => {
    if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
  };
  try { apply(localStorage.getItem("lnTheme")); } catch (_) {}
  if (!globalThis.chrome?.storage?.local) return;
  chrome.storage.local.get("lnTheme", ({ lnTheme }) => {
    apply(lnTheme);
    try { localStorage.setItem("lnTheme", lnTheme || "auto"); } catch (_) {}
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.lnTheme) return;
    apply(changes.lnTheme.newValue);
    try { localStorage.setItem("lnTheme", changes.lnTheme.newValue || "auto"); } catch (_) {}
  });
})();
