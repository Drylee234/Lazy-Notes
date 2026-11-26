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
  // Autocorrect strength (side panel ⚙ slider, "lnAutocorrectLevel"):
  // 0 off · 1 mild (one clear one-slip fix) · 2 strong · 3 toxic.
  let level = 1;
  let ignore = new Set();

  if (globalThis.chrome?.storage?.local) {
    chrome.storage.local.get(["lnAutocorrect", "lnAutocorrectLevel", "lnSpellIgnore"], (r) => {
      level = typeof r.lnAutocorrectLevel === "number" ? r.lnAutocorrectLevel : r.lnAutocorrect === false ? 0 : 1;
      ignore = new Set(r.lnSpellIgnore || []);
      ignore.forEach((w) => speller?.add(w));
    });
    chrome.storage.onChanged.addListener((c, area) => {
      if (area !== "local") return;
      if (c.lnAutocorrectLevel) level = Number(c.lnAutocorrectLevel.newValue ?? 1);
    });
  }

  function load() {
    if (speller || loading) return loading;
    const url = (p) => (globalThis.chrome?.runtime?.getURL ? chrome.runtime.getURL(p) : p);
    loading = Promise.all([fetch(url("lib/dict/en.aff")), fetch(url("lib/dict/en.dic")), fetch(url("lib/dict/en-freq.txt"))])
      .then((rs) => Promise.all(rs.map((r) => r.text())))
      .then(([aff, dic, freq]) => {
        speller = NSpell(aff, dic);
        ignore.forEach((w) => speller.add(w));
        freq.split("\n").forEach((w, i) => { if (w && !RANK.has(w)) RANK.set(w, i + 1); });
        loadVocab();
      })
      .catch(() => { loading = null; });
    return loading;
  }

  // How common a word is (1 = "the"), from wordfreq's English list
  // (lib/dict/en-freq.txt, top 60,000). Words missing from it are rare:
  // never suggested or autocorrected to, unless you've used them yourself.
  const RANK = new Map();
  // Your own words: everything in your notes. They count as spelled right,
  // and are preferred when guessing what you meant.
  const VOCAB = new Map();
  function loadVocab() {
    if (!globalThis.chrome?.storage?.local) return;
    chrome.storage.local.get("lazynotes", ({ lazynotes }) => {
      VOCAB.clear();
      Object.values(lazynotes?.courses || {}).forEach((c) => {
        Object.entries(c.topics || {}).forEach(([name, t]) => {
          const texts = [name, ...Object.values(t.highlights || {}).flatMap((h) => [h.text, h.annotation, h.context]),
                         ...Object.values(t.notes || {}).map((n) => n.text)];
          texts.join(" ").toLowerCase().match(/[a-z][a-z']+/g)?.forEach((w) => VOCAB.set(w, (VOCAB.get(w) || 0) + 1));
        });
      });
    });
  }

  function remember(word) {
    const w = word.toLowerCase();
    ignore.add(w);
    speller?.add(w);
    chrome.storage?.local.set({ lnSpellIgnore: [...ignore].slice(-2000) });
  }

  // ── Which words are checked ──
  const WORD = /[A-Za-z][A-Za-z']*$/;

  function checkable(word, atSentenceStart, lvl = 1) {
    if (word.length < (lvl >= 3 ? 2 : 3) || /[^A-Za-z']/.test(word)) return false;
    if (word === word.toUpperCase()) return false;                 // GET, BME
    if (/[A-Z]/.test(word.slice(1))) return false;                 // iPhone, McDonald
    if (/^[A-Z]/.test(word) && !atSentenceStart && lvl < 2) return false;     // names (mild only)
    return true;
  }

  // Short words people type that the dictionary may not know.
  const COMMON = new Set(["ok", "okay", "eg", "ie", "vs", "etc", "hi", "lol", "pls", "tbh", "idk", "ur", "u", "na", "sha", "yh", "ya"]);
  const isWord = (w) => COMMON.has(w.toLowerCase()) || (VOCAB.get(w.toLowerCase()) || 0) >= 2 ||
    speller.correct(w) || speller.correct(w.toLowerCase()) || ignore.has(w.toLowerCase());
  const misspelled = (w) => !!speller && !isWord(w);

  // ── The one clear fix, or null ──
  const LETTERS = "abcdefghijklmnopqrstuvwxyz";

  function oneSlipFixes(word) {
    const w = word.toLowerCase();
    const out = { swap: new Set(), double: new Set(), missing: new Set(), other: new Set() };
    const test = (cand, bucket) => { if (cand !== w && speller.correct(cand)) out[bucket].add(cand); };
    for (let i = 0; i < w.length; i++) {
      const del = w.slice(0, i) + w.slice(i + 1);
      test(del, i > 0 && w[i] === w[i - 1] ? "double" : "other");
      if (i < w.length - 1) test(w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2), "swap");
      for (const c of LETTERS) test(w.slice(0, i) + c + w.slice(i + 1), "other");
    }
    for (let i = 0; i <= w.length; i++) for (const c of LETTERS) test(w.slice(0, i) + c + w.slice(i), "missing");
    return out;
  }

  // Damerau-Levenshtein distance (small words only, so plain DP is fine).
  function slips(a, b) {
    a = a.toLowerCase(); b = b.toLowerCase();
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
    return d[a.length][b.length];
  }

  // Candidate fixes, best first: [{ word, score, slips }]. Lower score is
  // better: the kind of slip (swapped letters and doubled letters are the
  // likeliest typos) plus how rare the word is, minus a bonus for words you
  // use in your notes. Rare words (not in the frequency list) are dropped
  // unless they're yours, so nothing odd that Chrome would underline.
  function ranked(word, { far = false } = {}) {
    const w = word.toLowerCase();
    const f = oneSlipFixes(w);
    const cost = new Map();
    const add = (c, k) => { if (!cost.has(c) || cost.get(c) > k) cost.set(c, k); };
    f.swap.forEach((c) => add(c, 0.4));
    f.double.forEach((c) => add(c, 0.5));
    f.missing.forEach((c) => add(c, 0.6));   // a letter left out
    f.other.forEach((c) => add(c, 1));
    speller.suggest(w).forEach((c) => { const n = slips(c, w); if (n <= (far ? 2 : 1)) add(c.toLowerCase(), n === 1 ? 1 : 2); });
    VOCAB.forEach((n, c) => { if (n >= 2 && Math.abs(c.length - w.length) <= 2 && c[0] === w[0]) { const d = slips(c, w); if (d <= (far ? 2 : 1)) add(c, d === 1 ? 0.8 : 1.8); } });
    const out = [];
    cost.forEach((k, c) => {
      const rank = RANK.get(c);
      const mine = VOCAB.get(c) || 0;
      if (!rank && !mine) return;                               // rare: skip
      const rarity = rank ? Math.log10(rank) * 0.45 : 2;        // "the" ≈ 0, rank 50,000 ≈ 2.1
      out.push({ word: c, slips: k >= 1.5 ? 2 : 1, score: k + rarity - Math.min(1.2, mine * 0.3) });
    });
    return out.sort((a, b) => a.score - b.score);
  }

  const keepCase = (word, fix) => (/^[A-Z]/.test(word) ? fix[0].toUpperCase() + fix.slice(1) : fix);

  // The fix to apply, or null. Mild: one slip, and clearly the best (well
  // ahead of the next). Strong: one slip, ahead of the next. Toxic: up to
  // two slips, the best guess.
  function autoFix(word, lvl) {
    const list = ranked(word, { far: lvl >= 3 });
    const [best, next] = list;
    if (!best) return null;
    const gap = next ? next.score - best.score : 9;
    if (lvl <= 1 && (best.slips > 1 || gap < 0.9)) return null;
    if (lvl === 2 && (best.slips > 1 || gap < 0.25)) return null;
    return keepCase(word, best.word);
  }
  const clearFix = (word) => autoFix(word, 1);
  const bestFix = (word, lvl) => autoFix(word, lvl);

  function suggestions(word) {
    return ranked(word, { far: true }).slice(0, 4).map((c) => keepCase(word, c.word));
  }

  // ── A capital in the middle of a sentence ("the rock Is hard"): lower it.
  //    Mild: small everyday words only. Strong: the ~1,500 commonest words.
  //    Toxic: the ~5,000 commonest. Words often used as names stay. ──
  const SMALL = new Set(("the a an is are was were be been being am and or but nor of to in on at by for from with " +
    "into onto over under about as than then so if it its this that these those there here they them their " +
    "we our you your he him his she her i me my not no also very more most some any all each both such " +
    "has have had do does did can could would should might must which who whom whose what when where why how " +
    "just only even still too because while after before since until between through during against without").split(" "));
  const NAMEY = new Set(("will may june april august bill mark rose grace jack frank art sun earth god moon march " +
    "sat sun mon tue wed thu fri christmas english french african america bob pat dawn faith joy hope").split(" "));
  function midCapFix(word, atStart, lvl) {
    if (atStart || !/^[A-Z][a-z']+$/.test(word)) return null;
    const low = word.toLowerCase();
    if (NAMEY.has(low) || ignore.has(word.toLowerCase() + "^")) return null;
    if (SMALL.has(low)) return low;
    if (lvl < 2) return null;
    const rank = RANK.get(low);
    if (!rank || rank > (lvl >= 3 ? 5000 : 1500)) return null;
    // Not one you write capitalised in your notes (a name or a term).
    if ((VOCAB.get(low) || 0) === 0 && RANK.has(low) && !speller.correct(low)) return null;
    return low;
  }

  // ── Mistaken capitals: "THe" → "The", "wATER" (caps lock) → "Water",
  //    "i" / "i'm" → "I" / "I'm". Only when the fixed word is a real word,
  //    and not acronym plurals like "IDs" / "PCs". ──
  function capsFix(word, atStart) {
    if (/^i('(m|ll|d|ve))?$/.test(word)) return "I" + word.slice(1);
    if (!speller || word.length < 3) return null;
    const title = word[0].toUpperCase() + word.slice(1).toLowerCase();
    const real = (w) => speller.correct(w.toLowerCase()) || speller.correct(w);
    if (/^[A-Z]{2}[a-z]+$/.test(word) && !(word.length <= 4 && /^[A-Z]+s$/.test(word)) && real(title)) return title;
    if (/^[a-z][A-Z]{2,}$/.test(word) && real(title)) return atStart ? title : word.toLowerCase();
    // Any other mix of capitals inside a real word ("sHe", "tHE"): lower-case
    // it (a capital first letter only at a sentence start).
    if (/[a-z]/.test(word) && /[A-Z]/.test(word.slice(1)) && real(word.toLowerCase()) &&
        !(word.length <= 4 && /^[A-Z]+s$/.test(word))) return atStart ? title : word.toLowerCase();
    return null;
  }

  // ── Editing the box: a textarea / input, or the rich note box
  //    (contenteditable). For the rich box, positions are within the text
  //    node holding the caret. ──
  function view(field) {
    if (!field.isContentEditable) {
      return { text: field.value, caret: field.selectionStart, collapsed: field.selectionStart === field.selectionEnd, node: null };
    }
    const sel = getSelection();
    if (!sel.rangeCount || !field.contains(sel.anchorNode)) return null;
    let node = sel.anchorNode, off = sel.anchorOffset;
    if (node.nodeType !== Node.TEXT_NODE) {
      const prev = node.childNodes[off - 1];
      if (!prev || prev.nodeType !== Node.TEXT_NODE) return { text: "", caret: 0, collapsed: sel.isCollapsed, node: null, empty: true };
      node = prev;
      off = prev.nodeValue.length;
    }
    return { text: node.nodeValue.replace(/ /g, " "), caret: off, collapsed: sel.isCollapsed, node };
  }

  // Replace text[start, end) with `text`; the caret ends after it plus `skip`
  // characters (the space or punctuation just typed).
  function replace(field, v, start, end, text, skip = 0) {
    field.focus();
    if (v.node) {
      const r = document.createRange();
      r.setStart(v.node, start);
      r.setEnd(v.node, end);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      document.execCommand("insertText", false, text);
      if (skip) {
        const n = sel.anchorNode, o = sel.anchorOffset;
        if (n.nodeType === Node.TEXT_NODE && o + skip <= n.nodeValue.length) sel.collapse(n, o + skip);
      }
      return;
    }
    field.setSelectionRange(start, end);
    // execCommand keeps the browser's own undo history and fires "input".
    if (!document.execCommand("insertText", false, text)) field.setRangeText(text, start, end, "end");
    const c = start + text.length + skip;
    field.setSelectionRange(c, c);
  }

  const sentenceStartAt = (text, i) => /(^|[.!?]\s+|\n\s*)$/.test(text.slice(0, i));

  // ── Autocorrect ──
  let lastFix = null;   // { field, original, fixed, sep }

  function onInput(e) {
    const field = e.target;
    lastFix = null;
    if (!level || !speller || e.inputType !== "insertText" || !/^[\s.,;:!?)\]]$/.test(e.data || "")) return;
    const v = view(field);
    if (!v || v.empty) return;
    const caret = v.caret;
    const before = v.text.slice(0, caret - 1);
    const m = before.match(WORD);
    if (!m) return;
    const word = m[0].replace(/'+$/, "");
    const start = caret - 1 - m[0].length;
    // In the rich box a text node can start mid-sentence (after bold text):
    // only treat it as a sentence start if it's also the start of its block.
    const atStart = sentenceStartAt(v.text, start) && (!v.node || !v.node.previousSibling);
    if (ignore.has(word.toLowerCase()) && word !== "i") return;
    let fixed = capsFix(word, atStart) || midCapFix(word, atStart, level);
    if (!fixed) {
      if (checkable(word, atStart, level) && misspelled(word)) {
        fixed = level >= 2 ? bestFix(word, level) : clearFix(word);
      } else if (level >= 2 && atStart && /^[a-z]/.test(word) && word.length > 1 && speller.correct(word)) {
        fixed = word[0].toUpperCase() + word.slice(1);   // capitalise a sentence's first word
      }
    }
    // Strong+: a misspelled word at a sentence start also gets its capital.
    if (fixed && level >= 2 && atStart && /^[a-z]/.test(fixed)) fixed = fixed[0].toUpperCase() + fixed.slice(1);
    if (!fixed || fixed === word) return;
    replace(field, v, start, start + word.length, fixed, 1);
    lastFix = { field, original: word, fixed, sep: e.data };
    showBar(field, { undo: lastFix });
  }

  // Undo works while the caret is right after "<fixed><separator>".
  function undoFix() {
    const f = lastFix;
    lastFix = null;
    if (!f) return false;
    const v = view(f.field);
    if (!v || !v.collapsed) return false;
    const end = v.caret - f.sep.length;
    const start = end - f.fixed.length;
    if (start < 0 || v.text.slice(start, end) !== f.fixed || v.text.slice(end, v.caret) !== f.sep.replace(/ /g, " ")) return false;
    replace(f.field, v, start, end, f.original, f.sep.length);
    remember(f.original);
    hideBar();
    return true;
  }

  function onKeydown(e) {
    if (!lastFix || lastFix.field !== e.target) return;
    const undoKey = (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z";
    if (e.key === "Backspace" || undoKey) {
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
        const v = view(field);
        if (v && v.text.slice(start, start + word.length) === word) replace(field, v, start, start + word.length, s);
        hideBar();
      })));
      bar.append(button("Add to dictionary", "quiet", () => { remember(word); hideBar(); }));
    }
    place(field);
  }

  // The caret sits on (or just after) a misspelled word: offer fixes.
  function checkCaret(field) {
    const cur = speller && document.activeElement === field ? view(field) : null;
    if (!cur || !cur.collapsed || cur.empty) {
      if (!lastFix) hideBar();
      return;
    }
    const v = cur.text, c = cur.caret;
    let s = c, e = c;
    while (s > 0 && /[A-Za-z']/.test(v[s - 1])) s--;
    while (e < v.length && /[A-Za-z']/.test(v[e])) e++;
    const word = v.slice(s, e).replace(/^'+|'+$/g, "");
    // Still typing this word (caret at its end, nothing after): wait.
    const typing = c === e && e === v.length && (!cur.node || !cur.node.nextSibling);
    if (!word || typing || !checkable(word, sentenceStartAt(v, s)) || !misspelled(word)) {
      if (!lastFix) hideBar();
      return;
    }
    showBar(field, { word, start: s });
  }

  // ── Wiring: every textarea and text input on the page, as it's used ──
  const isField = (el) => el && (el.tagName === "TEXTAREA" || el.classList?.contains("rich-box") ||
    (el.tagName === "INPUT" && (el.type === "text" || el.type === "search")));

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
