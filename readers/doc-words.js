// Q-notes — the words of the document you're reading, for spell check and
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

// ---------------------------------------------------------------------------
// The document's own text, so the AI can read the document and not only your
// (much shorter) notes. Kept in chrome.storage.session "lnDocPages" =
// { title, kind, pages: [text per page/slide], at, totalPages, trimmed },
// so it goes when the browser session does: it never reaches your notes,
// your backup or the sync server.
//
//   LazyDocText.publish(pages, title)        pages = one string per page
//                                            (Word: a single entry)
//   LazyDocText.get({ scope, page })         scope "all" | "page" | "range"
//     → { title, kind, text, pages, from, to, totalPages, trimmed, note }
//
// Republished when the reader tab gets focus, exactly like the word list.
// ---------------------------------------------------------------------------

(() => {
  const CAP = 1500000;          // ~1.5 MB of text, to stay inside the quota
  const KEY = "lnDocPages";
  let last = null;              // what this reader published

  function kindOfReader() {
    const p = location.pathname;
    if (/pdfreader\.html$/.test(p)) return "pdf";
    if (/pptxreader\.html$/.test(p)) return "pptx";
    if (/docxreader\.html$/.test(p)) return "docx";
    return "doc";
  }

  // Same cheap join the save pop-up and background/bg_join.js already do, so
  // the AI doesn't read "mitochon- drion". Those functions are untouched.
  function joinBroken(text) {
    const lines = String(text || "").replace(/\r/g, "").split("\n").map((l) => l.replace(/\s+$/, ""));
    if (lines.length < 2) return lines.join("");
    const out = [];
    lines.forEach((raw) => {
      if (!raw.trim()) { out.push(""); return; }
      const l = raw.trim();
      const prev = out[out.length - 1];
      const startsPoint = /^\s*(?:[-*•▪◦·‣]|\(?\d{1,2}[.)]|[a-z][.)]|[ivxIVX]{1,4}[.)])\s+/.test(raw);
      if (prev && !startsPoint && !/[.!?:;]["\')\]]?$/.test(prev) && prev.length > 25) {
        out[out.length - 1] = /[A-Za-z]-$/.test(prev) && /^[a-z]/.test(l)
          ? prev.slice(0, -1) + l
          : `${prev} ${l}`;
      } else out.push(l);
    });
    return out.join("\n").replace(/\n{3,}/g, "\n\n");
  }

  // Keep whole pages from the start until the cap; say so when some were left
  // out, so the people reading this can tell the user the truth.
  function fit(pages) {
    const kept = [];
    let used = 0, trimmed = false;
    for (const page of pages) {
      const t = String(page || "");
      if (used + t.length <= CAP) { kept.push(t); used += t.length; continue; }
      const room = CAP - used;
      if (!kept.length && room > 0) { kept.push(t.slice(0, room)); used += room; }
      trimmed = true;
      break;
    }
    if (!kept.length && pages.length) { kept.push(String(pages[0] || "").slice(0, CAP)); trimmed = true; }
    return { kept, trimmed: trimmed || kept.length < pages.length };
  }

  function publish(pages, title = document.title) {
    if (!chrome.storage?.session) return;
    const all = (Array.isArray(pages) ? pages : [pages]).map((p) => joinBroken(p));
    if (!all.some((p) => p.trim())) return;
    const { kept, trimmed } = fit(all);
    last = { title, kind: kindOfReader(), pages: kept, at: Date.now(), totalPages: all.length, trimmed };
    chrome.storage.session.set({ [KEY]: last }).catch?.(() => {});
  }

  addEventListener("focus", () => { if (last) chrome.storage.session?.set({ [KEY]: last }).catch?.(() => {}); });

  // Closing the reader (or opening another document in it) must clear the
  // text: otherwise "Summarise this document" would quietly summarise the
  // one you read an hour ago. Session storage outlives the tab, so say so.
  addEventListener("pagehide", () => {
    try { chrome.storage.session?.remove(KEY); } catch (_) {}
  }, { capture: true });

  function read() {
    if (last) return Promise.resolve(last);
    if (!chrome.storage?.session) return Promise.resolve(null);
    return new Promise((done) => {
      try { chrome.storage.session.get(KEY, (r) => done(r?.[KEY] || null)); }
      catch (_) { done(null); }
    });
  }

  function get(opts = {}) {
    const scope = opts.scope || "all";
    return read().then((store) => {
      const empty = { title: "", kind: "", text: "", pages: 0, from: 0, to: 0, totalPages: 0, trimmed: false,
                      note: "No document is open, so there's nothing to read." };
      if (!store || !store.pages?.length) return empty;
      const pages = store.pages;
      const total = store.totalPages || pages.length;
      const notes = [];
      if (store.trimmed) {
        notes.push(pages.length < total
          ? `This document is too big to hold all of it, so only pages 1–${pages.length} of ${total} are here.`
          : "This document is too big to hold all of it, so the end is missing.");
      }

      let from = 1, to = pages.length;
      if (scope === "page" || scope === "range") {
        let a = Number(scope === "page" ? opts.page : opts.from) || 1;
        let b = scope === "page" ? a : (Number(opts.to) || a);
        if (pages.length === 1) {
          notes.push("This document isn't split into pages, so this is the whole thing.");
        } else if (a > pages.length) {
          notes.push(`Page ${a} isn't in what we could read, so this is pages 1–${pages.length} instead.`);
        } else {
          from = Math.max(1, Math.min(a, pages.length));
          to   = Math.max(from, Math.min(b, pages.length));
        }
      }

      const slice = pages.slice(from - 1, to);
      const text = slice.map((t, i) => (pages.length > 1 ? `[Page ${from + i}]\n${t}` : t)).join("\n\n").trim();
      return { title: store.title || "", kind: store.kind || "", text, pages: slice.length,
               from, to, totalPages: total, trimmed: !!store.trimmed, note: notes.join(" ") };
    });
  }

  globalThis.LazyDocText = { publish, get, KEY };

  // Slides and Word: read the pages once they're drawn (and if they change).
  // Slides split per slide so "this page" works; Word has no real pages, so
  // it publishes one entry and "this page" falls back to the whole document.
  if (!/pdfreader\.html$/.test(location.pathname)) {
    const viewer = document.getElementById("viewer");
    const perSlide = /pptxreader\.html$/.test(location.pathname);
    let t = null;
    if (viewer) new MutationObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => {
        if (perSlide) {
          const els = [...viewer.querySelectorAll("section.slide")];
          publish(els.length ? els.map((el) => el.innerText) : [viewer.innerText]);
        } else {
          publish([viewer.innerText]);
        }
      }, 1200);
    }).observe(viewer, { childList: true, subtree: true });
  }
})();
