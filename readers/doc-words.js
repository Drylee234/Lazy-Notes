// Lazy Notes — the words of the document you're reading, for spell check and
// typing hints in every note box (shared/spell.js reads them).
// Kept in chrome.storage.session "lnDocWords" = { title, words: [[form, count], …] }
// (gone when Chrome closes). The reader you used last wins: it publishes
// again whenever its tab gets focus.
//
// The PDF reader hands over its text (pdfreader.js: LazyDocWords.publish);
// the slides and Word readers are read from the page once it's drawn.

(() => {
  const MAX_WORDS = 8000;
  let last = null;   // what this reader published

  function count(text) {
    const seen = new Map();   // lower → { c, forms: Map(form → n) }
    for (const m of String(text).matchAll(/[A-Za-z][A-Za-z'’-]{2,}/g)) {
      const form = m[0].replace(/[’]/g, "'").replace(/['-]+$/, "");
      if (form.length < 3) continue;
      const k = form.toLowerCase();
      const e = seen.get(k) || { c: 0, forms: new Map() };
      e.c++;
      e.forms.set(form, (e.forms.get(form) || 0) + 1);
      seen.set(k, e);
    }
    // As the document writes it most (lower case wins ties: "The" at a
    // sentence start shouldn't make "the" a capitalised word).
    return [...seen.entries()]
      .sort((a, b) => b[1].c - a[1].c)
      .slice(0, MAX_WORDS)
      .map(([k, e]) => {
        let form = k, best = -1;
        e.forms.forEach((n, f) => { if (n > best || (n === best && f === k)) { form = f; best = n; } });
        if ((e.forms.get(k) || 0) > 0 && /^[A-Z][a-z]/.test(form)) form = k;   // seen lower case too: a normal word
        return [form, e.c];
      });
  }

  function publish(text, title = document.title) {
    if (!text || !chrome.storage?.session) return;
    last = { title, words: count(text) };
    chrome.storage.session.set({ lnDocWords: last }).catch?.(() => {});
  }

  addEventListener("focus", () => { if (last) chrome.storage.session?.set({ lnDocWords: last }).catch?.(() => {}); });

  // Slides and Word: read the pages once they're drawn (and if they change).
  if (!/pdfreader\.html$/.test(location.pathname)) {
    const viewer = document.getElementById("viewer");
    let t = null;
    if (viewer) new MutationObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => publish(viewer.innerText), 1200);
    }).observe(viewer, { childList: true, subtree: true });
  }

  globalThis.LazyDocWords = { publish };
})();
