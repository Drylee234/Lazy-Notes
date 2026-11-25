// Lazy Notes — mild spell checking for the note boxes (side panel, All notes).
//
// • Autocorrect: when a word is finished (space or punctuation), an obvious
//   typo is fixed: only when there's one clear fix, one slip away (a swapped,
//   missing, extra, doubled or wrong letter: "teh" → "the", "recieve" →
//   "receive"). Names, ACRONYMS, short words and words with digits are left
//   alone. Backspace or Ctrl/⌘+Z right after puts your word back and stops
//   correcting it ("lnSpellIgnore"). Off switch: side panel ⚙
//   ("lnAutocorrect" === false).
// • Suggestions: with the caret on a misspelled word, a small bar under the
//   box offers fixes and "Add to dictionary".
// Chrome's own red underlines stay on too.
//
// Dictionary: Hunspell en (lib/dict, from the dictionary-en package) read by
// nspell (lib/nspell.js), loaded the first time a box is focused.

(() => {
  let speller = null;
  let loading = null;
  let autocorrect = true;
  let ignore = new Set();

  if (globalThis.chrome?.storage?.local) {
    chrome.storage.local.get(["lnAutocorrect", "lnSpellIgnore"], (r) => {
      autocorrect = r.lnAutocorrect !== false;
      ignore = new Set(r.lnSpellIgnore || []);
      ignore.forEach((w) => speller?.add(w));
    });
    chrome.storage.onChanged.addListener((c, area) => {
      if (area !== "local") return;
      if (c.lnAutocorrect) autocorrect = c.lnAutocorrect.newValue !== false;
    });
  }

  function load() {
    if (speller || loading) return loading;
    const url = (p) => (globalThis.chrome?.runtime?.getURL ? chrome.runtime.getURL(p) : p);
    loading = Promise.all([fetch(url("lib/dict/en.aff")), fetch(url("lib/dict/en.dic"))])
      .then((rs) => Promise.all(rs.map((r) => r.text())))
      .then(([aff, dic]) => {
        speller = NSpell(aff, dic);
        ignore.forEach((w) => speller.add(w));
      })
      .catch(() => { loading = null; });
    return loading;
  }

  function remember(word) {
    const w = word.toLowerCase();
    ignore.add(w);
    speller?.add(w);
    chrome.storage?.local.set({ lnSpellIgnore: [...ignore].slice(-2000) });
  }

  // ── Which words are checked ──
  const WORD = /[A-Za-z][A-Za-z']*$/;

  function checkable(word, atSentenceStart) {
    if (word.length < 3 || /[^A-Za-z']/.test(word)) return false;
    if (word === word.toUpperCase()) return false;                 // GET, BME
    if (/[A-Z]/.test(word.slice(1))) return false;                 // iPhone, McDonald
    if (/^[A-Z]/.test(word) && !atSentenceStart) return false;     // names
    return true;
  }

  const isWord = (w) => speller.correct(w) || speller.correct(w.toLowerCase()) || ignore.has(w.toLowerCase());
  const misspelled = (w) => !!speller && !isWord(w);

  // ── The one clear fix, or null ──
  const LETTERS = "abcdefghijklmnopqrstuvwxyz";

  function oneSlipFixes(word) {
    const w = word.toLowerCase();
    const out = { swap: new Set(), double: new Set(), other: new Set() };
    const test = (cand, bucket) => { if (cand !== w && speller.correct(cand)) out[bucket].add(cand); };
    for (let i = 0; i < w.length; i++) {
      const del = w.slice(0, i) + w.slice(i + 1);
      test(del, i > 0 && w[i] === w[i - 1] ? "double" : "other");
      if (i < w.length - 1) test(w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2), "swap");
      for (const c of LETTERS) test(w.slice(0, i) + c + w.slice(i + 1), "other");
    }
    for (let i = 0; i <= w.length; i++) for (const c of LETTERS) test(w.slice(0, i) + c + w.slice(i), "other");
    return out;
  }

  function clearFix(word) {
    const f = oneSlipFixes(word);
    let fix = null;
    if (f.swap.size === 1) fix = [...f.swap][0];
    else if (f.double.size === 1 && f.swap.size === 0) fix = [...f.double][0];
    else if (f.swap.size + f.double.size + f.other.size === 1) fix = [...f.swap, ...f.double, ...f.other][0];
    if (!fix) return null;
    return /^[A-Z]/.test(word) ? fix[0].toUpperCase() + fix.slice(1) : fix;
  }

  function suggestions(word) {
    const f = oneSlipFixes(word);
    const list = [...f.swap, ...f.double, ...speller.suggest(word), ...f.other];
    const seen = new Set();
    return list.filter((s) => {
      const k = s.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).slice(0, 4).map((s) => (/^[A-Z]/.test(word) ? s[0].toUpperCase() + s.slice(1) : s));
  }

  // ── Editing the box ──
  function replace(field, start, end, text) {
    field.focus();
    field.setSelectionRange(start, end);
    // execCommand keeps the browser's own undo history and fires "input".
    if (!document.execCommand("insertText", false, text)) field.setRangeText(text, start, end, "end");
  }

  const sentenceStartAt = (text, i) => /(^|[.!?]\s+|\n\s*)$/.test(text.slice(0, i));

  // ── Autocorrect ──
  let lastFix = null;   // { field, start, original, fixed, caret }

  function onInput(e) {
    const field = e.target;
    if (lastFix && lastFix.field === field && field.selectionStart !== lastFix.caret) lastFix = null;
    if (!autocorrect || !speller || e.inputType !== "insertText" || !/^[\s.,;:!?)\]]$/.test(e.data || "")) return;
    const caret = field.selectionStart;
    const before = field.value.slice(0, caret - 1);
    const m = before.match(WORD);
    if (!m) return;
    const word = m[0].replace(/'+$/, "");
    const start = caret - 1 - m[0].length;
    if (!checkable(word, sentenceStartAt(field.value, start)) || !misspelled(word)) return;
    const fixed = clearFix(word);
    if (!fixed) return;
    replace(field, start, start + word.length, fixed);
    const newCaret = caret + fixed.length - word.length;
    field.setSelectionRange(newCaret, newCaret);
    lastFix = { field, start, original: word, fixed, caret: newCaret };
    showBar(field, { undo: lastFix });
  }

  function undoFix() {
    const f = lastFix;
    lastFix = null;
    if (f.field.value.slice(f.start, f.start + f.fixed.length) !== f.fixed) return false;
    replace(f.field, f.start, f.start + f.fixed.length, f.original);
    const caret = f.caret + f.original.length - f.fixed.length;
    f.field.setSelectionRange(caret, caret);
    remember(f.original);
    hideBar();
    return true;
  }

  function onKeydown(e) {
    if (!lastFix || lastFix.field !== e.target) return;
    const undoKey = (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z";
    if ((e.key === "Backspace" || undoKey) && e.target.selectionStart === lastFix.caret && e.target.selectionEnd === lastFix.caret) {
      if (undoFix()) e.preventDefault();
    } else if (!["Shift", "Control", "Meta", "Alt"].includes(e.key)) {
      lastFix = null;
    }
  }

  // ── Suggestion bar ──
  let bar = null;
  let barTimer = null;

  function ensureBar() {
    if (bar) return bar;
    bar = document.createElement("div");
    bar.className = "ln-spell-bar";
    bar.hidden = true;
    bar.addEventListener("mousedown", (e) => e.preventDefault());   // keep the caret in the box
    document.body.appendChild(bar);
    if (!document.getElementById("ln-spell-style")) {
      const st = document.createElement("style");
      st.id = "ln-spell-style";
      st.textContent = `
.ln-spell-bar { position: fixed; z-index: 2147483000; display: flex; flex-wrap: wrap; align-items: center; gap: 4px;
  max-width: calc(100vw - 16px); padding: 4px 6px; border-radius: 8px; border: 1px solid var(--border, #e3e3e8);
  background: var(--bg, #fff); color: var(--sec, #55555f); box-shadow: var(--shadow, 0 4px 20px rgba(0,0,0,.1));
  font: 12px/1.3 var(--font, system-ui, sans-serif); }
.ln-spell-bar[hidden] { display: none; }
.ln-spell-bar .w { color: var(--dim, #8e8e99); text-decoration: line-through; margin-right: 2px; }
.ln-spell-bar button { border: 0; border-radius: 5px; padding: 3px 7px; font: inherit; cursor: pointer;
  background: var(--surface, #f7f7f8); color: var(--pri, #16161a); }
.ln-spell-bar button:hover { background: var(--hover, #efeff2); }
.ln-spell-bar button.fix { color: var(--accent, #4f46e5); font-weight: 600; }
.ln-spell-bar button.quiet { background: transparent; color: var(--dim, #8e8e99); }`;
      document.head.appendChild(st);
    }
    return bar;
  }

  function hideBar() { if (bar) bar.hidden = true; clearTimeout(barTimer); }

  function place(field) {
    const r = field.getBoundingClientRect();
    bar.hidden = false;
    const h = bar.offsetHeight;
    const below = r.bottom + 4 + h < innerHeight;
    bar.style.top = `${below ? r.bottom + 4 : Math.max(4, r.top - h - 4)}px`;
    bar.style.left = `${Math.max(8, Math.min(r.left, innerWidth - bar.offsetWidth - 8))}px`;
  }

  const button = (label, cls, fn) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.textContent = label;
    b.addEventListener("click", fn);
    return b;
  };

  function showBar(field, { undo, word, start }) {
    ensureBar();
    bar.replaceChildren();
    if (undo) {
      const t = document.createElement("span");
      t.textContent = `Fixed “${undo.original}” → “${undo.fixed}”`;
      bar.append(t, button("Undo", "fix", () => { lastFix = undo; undoFix(); }));
      clearTimeout(barTimer);
      barTimer = setTimeout(hideBar, 3500);
    } else {
      const sugg = suggestions(word);
      const w = document.createElement("span");
      w.className = "w";
      w.textContent = word;
      bar.append(w);
      sugg.forEach((s) => bar.append(button(s, "fix", () => {
        replace(field, start, start + word.length, s);
        hideBar();
      })));
      bar.append(button("Add to dictionary", "quiet", () => { remember(word); hideBar(); }));
    }
    place(field);
  }

  // The caret sits on (or just after) a misspelled word: offer fixes.
  function checkCaret(field) {
    if (!speller || document.activeElement !== field || field.selectionStart !== field.selectionEnd) {
      if (!lastFix) hideBar();
      return;
    }
    const v = field.value, c = field.selectionStart;
    let s = c, e = c;
    while (s > 0 && /[A-Za-z']/.test(v[s - 1])) s--;
    while (e < v.length && /[A-Za-z']/.test(v[e])) e++;
    const word = v.slice(s, e).replace(/^'+|'+$/g, "");
    // Still typing this word (caret at its end, nothing after): wait.
    const typing = c === e && e === v.length;
    if (!word || typing || !checkable(word, sentenceStartAt(v, s)) || !misspelled(word)) {
      if (!lastFix) hideBar();
      return;
    }
    showBar(field, { word, start: s });
  }

  // ── Wiring: every textarea and text input on the page, as it's used ──
  const isField = (el) => el && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && (el.type === "text" || el.type === "search")));

  document.addEventListener("focusin", (e) => {
    if (!isField(e.target)) return;
    e.target.spellcheck = true;
    load();
  });
  document.addEventListener("input", (e) => { if (isField(e.target)) onInput(e); }, true);
  document.addEventListener("keydown", (e) => { if (isField(e.target)) onKeydown(e); }, true);
  document.addEventListener("selectionchange", () => {
    const el = document.activeElement;
    if (!isField(el)) { if (!lastFix) hideBar(); return; }
    clearTimeout(checkCaret.t);
    checkCaret.t = setTimeout(() => checkCaret(el), 250);
  });
  document.addEventListener("focusout", (e) => { if (isField(e.target)) { lastFix = null; hideBar(); } });
  addEventListener("scroll", () => hideBar(), true);

  globalThis.LazySpell = { load, isReady: () => !!speller };
})();
