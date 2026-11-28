// Q-notes — the app's name lives in ONE place: "name" in manifest.json.
// Change it there and every page picks it up (this swaps the default name in
// titles, labels and text when a page loads). Scripts can read window.LN_NAME.
(() => {
  const DEFAULT = "Q-notes";
  const name = (chrome.runtime?.getManifest?.().name || DEFAULT).trim() || DEFAULT;
  window.LN_NAME = name;
  if (name === DEFAULT) return;
  const swap = (s) => (s && s.includes(DEFAULT) ? s.split(DEFAULT).join(name) : s);
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
