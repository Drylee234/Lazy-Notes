// Q-notes — the app's name lives in ONE place: "name" in manifest.json.
// Change it there and every page picks it up (this swaps the default name in
// titles, labels and text when a page loads). Scripts can read window.LN_NAME.
(() => {
  const DEFAULT = "Q-notes";
  const name = (chrome.runtime?.getManifest?.().name || DEFAULT).trim() || DEFAULT;
  window.LN_NAME = name;
  // Same files run in Chrome and Microsoft Edge: words about the browser
  // ("Chrome blocked…", "chrome://extensions") follow the one it's in.
  const edge = /\bEdg\//.test(navigator.userAgent);
  window.LN_BROWSER = edge ? "Edge" : "Chrome";
  window.LN_EXT_PAGE = edge ? "edge://extensions" : "chrome://extensions";
  if (name === DEFAULT && !edge) return;
  const swap = (s) => {
    if (!s) return s;
    if (name !== DEFAULT && s.includes(DEFAULT)) s = s.split(DEFAULT).join(name);
    if (edge && /chrome/i.test(s)) s = s.replace(/chrome:\/\//g, "edge://").replace(/\bChrome\b/g, "Edge");
    return s;
  };
  const run = (root) => {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      if (n.parentElement?.closest("script, style")) continue;
      const v = swap(n.nodeValue);
      if (v !== n.nodeValue) n.nodeValue = v;
    }
    root.querySelectorAll?.("[title],[alt],[aria-label],[placeholder]").forEach((el) => {
      ["title", "alt", "aria-label", "placeholder"].forEach((a) => { const v = el.getAttribute(a); if (v && v.includes(DEFAULT)) el.setAttribute(a, swap(v)); });
    });
  };
  const all = () => { document.title = swap(document.title); if (document.body) run(document.body); };
  document.addEventListener("DOMContentLoaded", () => { all(); setTimeout(all, 800); });
  const t = document.querySelector("title");
  if (t) new MutationObserver(() => { const v = swap(document.title); if (v !== document.title) document.title = v; }).observe(t, { childList: true });
})();
