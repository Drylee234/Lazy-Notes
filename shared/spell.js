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
// • Words from the document you're reading (any open Lazy Notes reader
//   publishes them in storage.session "lnDocWords") count as spelled right
//   and are preferred as fixes (lnDocWordsOn === false turns it off).
// • Typing hints: while typing a word, a hint offers the full word from the
//   document or your notes; → (at the end of the word) accepts it
//   (lnTypingHints === false turns it off).
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
  let docOn = true, hintsOn = true;
  let punctOn = true;   // lnPunctFix: tidy stray punctuation while typing
  // Fixes you've picked yourself (a suggestion clicked): applied again next
  // time you make the same slip. lnSpellLearned = { typo: fix }.
  let learned = {};
  // The open document's words: lower case → { c: count, form: as written }.
  const DOCW = new Map();
  const setDocWords = (d) => {
    DOCW.clear();
    (d?.words || []).forEach(([form, c]) => DOCW.set(form.toLowerCase(), { c, form }));
  };

  if (globalThis.chrome?.storage?.local) {
    chrome.storage.local.get(["lnAutocorrect", "lnAutocorrectLevel", "lnSpellIgnore"], (r) => {
      level = typeof r.lnAutocorrectLevel === "number" ? r.lnAutocorrectLevel : r.lnAutocorrect === false ? 0 : 1;
      ignore = new Set(r.lnSpellIgnore || []);
      ignore.forEach((w) => speller?.add(w));
    });
    chrome.storage.local.get("lnSpellLearned", (r) => { learned = r?.lnSpellLearned || {}; });
    chrome.storage.local.get(["lnDocWordsOn", "lnTypingHints", "lnPunctFix"], (r) => {
      docOn = r.lnDocWordsOn !== false;
      hintsOn = r.lnTypingHints !== false;
      punctOn = r.lnPunctFix !== false;
    });
    chrome.storage.session?.get("lnDocWords", (r) => setDocWords(r?.lnDocWords));
    chrome.storage.onChanged.addListener((c, area) => {
      if (area === "session" && c.lnDocWords) { setDocWords(c.lnDocWords.newValue); return; }
      if (area !== "local") return;
      if (c.lnAutocorrectLevel) level = Number(c.lnAutocorrectLevel.newValue ?? 1);
      if (c.lnDocWordsOn) docOn = c.lnDocWordsOn.newValue !== false;
      if (c.lnSpellLearned) learned = c.lnSpellLearned.newValue || {};
      if (c.lnTypingHints) hintsOn = c.lnTypingHints.newValue !== false;
      if (c.lnPunctFix) punctOn = c.lnPunctFix.newValue !== false;
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
  const CAPS = new Set();
  function loadVocab() {
    if (!globalThis.chrome?.storage?.local) return;
    chrome.storage.local.get("lazynotes", ({ lazynotes }) => {
      VOCAB.clear();
      Object.values(lazynotes?.courses || {}).forEach((c) => {
        Object.entries(c.topics || {}).forEach(([name, t]) => {
          const texts = [name, ...Object.values(t.highlights || {}).flatMap((h) => [h.text, h.annotation, h.context]),
                         ...Object.values(t.notes || {}).map((n) => n.text)];
          const all = texts.join(" ");
          all.toLowerCase().match(/[a-z][a-z']+/g)?.forEach((w) => VOCAB.set(w, (VOCAB.get(w) || 0) + 1));
          all.match(/\b[A-Z]{2,}\b/g)?.forEach((w) => CAPS.add(w));   // GET, BME, ATP: your acronyms
        });
      });
    });
  }

  function learn(typo, fix) {
    const t = typo.toLowerCase();
    if (!t || t === fix.toLowerCase()) return;
    learned[t] = fix.toLowerCase();
    const keys = Object.keys(learned);
    if (keys.length > 1500) keys.slice(0, keys.length - 1500).forEach((k) => delete learned[k]);
    chrome.storage?.local.set({ lnSpellLearned: learned });
  }

  // Two words run together ("thecell" → "the cell"): only when both halves
  // are common words (or yours / the document's) and one split is clearly best.
  function splitFix(word) {
    const w = word.toLowerCase();
    if (w.length < 5) return null;
    const common = (x) => x === "a" || x === "i" ||
      (x.length >= 2 && ((RANK.get(x) || 1e9) <= 25000 || (VOCAB.get(x) || 0) >= 2 || docCount(x) >= 1) && speller.correct(x));
    const options = [];
    for (let i = 1; i < w.length; i++) {
      const a = w.slice(0, i), b = w.slice(i);
      if (common(a) && common(b)) options.push({ a, b, score: Math.log10(RANK.get(a) || 30000) + Math.log10(RANK.get(b) || 30000) });
    }
    if (!options.length) return null;
    options.sort((x, y) => x.score - y.score);
    if (options[1] && options[1].score - options[0].score < 0.6) return null;   // not clear which
    const { a, b } = options[0];
    const first = /^[A-Z]/.test(word) ? a[0].toUpperCase() + a.slice(1) : a;
    return `${first} ${b}`;
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
  const docCount = (w) => (docOn ? DOCW.get(w)?.c || 0 : 0);
  const isWord = (w) => COMMON.has(w.toLowerCase()) || (VOCAB.get(w.toLowerCase()) || 0) >= 2 || docCount(w.toLowerCase()) >= 1 ||
    speller.correct(w) || speller.correct(w.toLowerCase()) || ignore.has(w.toLowerCase());
  const misspelled = (w) => !!speller && !isWord(w);

  // ── The one clear fix, or null ──
  const LETTERS = "abcdefghijklmnopqrstuvwxyz";

  function oneSlipFixes(word) {
    const w = word.toLowerCase();
    const out = { swap: new Set(), double: new Set(), extra: new Set(), missing: new Set(), other: new Set() };
    const test = (cand, bucket) => { if (cand !== w && speller.correct(cand)) out[bucket].add(cand); };
    for (let i = 0; i < w.length; i++) {
      const del = w.slice(0, i) + w.slice(i + 1);
      // A letter too many (typing fast): a doubled one, or any extra one.
      test(del, i > 0 && w[i] === w[i - 1] ? "double" : "extra");
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
    f.double.forEach((c) => add(c, 0.4));
    f.extra.forEach((c) => add(c, 0.55));
    f.missing.forEach((c) => add(c, 0.6));   // a letter left out
    f.other.forEach((c) => add(c, 1));
    speller.suggest(w).forEach((c) => { const n = slips(c, w); if (n <= (far ? 2 : 1)) add(c.toLowerCase(), n === 1 ? 1 : 2); });
    VOCAB.forEach((n, c) => { if (n >= 2 && Math.abs(c.length - w.length) <= 2 && c[0] === w[0]) { const d = slips(c, w); if (d <= (far ? 2 : 1)) add(c, d === 1 ? 0.8 : 1.8); } });
    if (docOn) DOCW.forEach((_, c) => { if (Math.abs(c.length - w.length) <= 2 && c[0] === w[0]) { const d = slips(c, w); if (d <= (far ? 2 : 1)) add(c, d === 1 ? 0.8 : 1.8); } });
    const out = [];
    cost.forEach((k, c) => {
      const rank = RANK.get(c);
      const mine = (VOCAB.get(c) || 0) + docCount(c);
      if (!rank && !mine) return;                               // rare: skip
      const rarity = rank ? Math.log10(rank) * 0.45 : 2;        // "the" ≈ 0, rank 50,000 ≈ 2.1
      out.push({ word: c, slips: k >= 1.5 ? 2 : 1, score: k + rarity - Math.min(1.2, mine * 0.3) });
    });
    return out.sort((a, b) => a.score - b.score);
  }

  // A word the document writes with capitals (Nernst, ATPase) keeps them.
  const keepCase = (word, fix) => {
    const form = docOn ? DOCW.get(fix)?.form : null;
    if (form && /[A-Z]/.test(form)) return form;
    return /^[A-Z]/.test(word) ? fix[0].toUpperCase() + fix.slice(1) : fix;
  };

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
    const split = splitFix(word);
    const list = ranked(word, { far: true }).slice(0, split ? 3 : 4).map((c) => keepCase(word, c.word));
    return split ? [split, ...list] : list;
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

  // ── Missing apostrophes: didnt → didn't, im → I'm. Only words that
  //    aren't words without it ("cant", "wont", "ill", "well" stay). ──
  const APOS = Object.fromEntries(("didn't don't doesn't isn't aren't wasn't weren't hasn't haven't hadn't " +
    "wouldn't couldn't shouldn't mustn't needn't ain't i'm i've i'd i'll you're you've you'll you'd " +
    "they're they've they'll they'd we've we'd she's he's it'll that's what's who's where's there's here's " +
    "let's how's when's why's would've could've should've might've y'all").split(" ")
    .map((w) => [w.replace(/'/g, ""), w]).filter(([bare]) => !["cant", "wont", "ill", "well", "were", "shed", "hell", "shell", "its", "lets", "whos", "id", "wed", "hed", "wheres", "hows", "whens", "whys"].includes(bare)));
  function apostropheFix(word, atStart) {
    const fixed = APOS[word.toLowerCase()];
    if (!fixed) return null;
    let out = fixed.startsWith("i'") ? "I" + fixed.slice(1) : fixed;
    if (atStart || /^[A-Z]/.test(word) && word !== word.toUpperCase()) out = out[0].toUpperCase() + out.slice(1);
    return out;
  }

  // ── ALL-CAPS ordinary words ("A MAN BUT") → lower case. Acronyms you use in
  //    your notes (GET, ATP…) stay, and so does anything that isn't a common
  //    word. Mild: small everyday words; Strong: the ~3,000 commonest;
  //    Toxic: ~8,000, and a lone "A". ──
  function allCapsFix(word, atStart, lvl) {
    if (word !== word.toUpperCase() || !/[A-Z]/.test(word)) return null;
    if (CAPS.has(word) || (word.length === 1 && (word !== "A" || lvl < 3))) return null;
    const low = word.toLowerCase();
    if (NAMEY.has(low)) return null;
    const ok = SMALL.has(low) || (lvl >= 2 && (RANK.get(low) || 1e9) <= (lvl >= 3 ? 8000 : 3000));
    if (!ok || !speller.correct(low)) return null;
    return atStart ? low[0].toUpperCase() + low.slice(1) : low;
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

  // ── Stray punctuation (seen in real notes: "membrane ,plasma",
  //    "Pergamum : discovered", "(1791)discovered", "( not yet named )",
  //    "produc[tion", "selectively  permeable"). Fixed as you type; Ctrl+Z
  //    undoes a fix like any typing. Off: lnPunctFix = false. ──
  const STRAY = /([A-Za-z]{2,})[\[\]{}|\\`^~]([A-Za-z]{2,})$/;
  function punctFix(e, field) {
    if (!punctOn || !level || e.inputType !== "insertText") return false;
    const ch = e.data;
    if (!ch || ch.length !== 1) return false;
    const v = view(field);
    if (!v || v.empty || !v.collapsed) return false;
    const c = v.caret;
    if (v.text[c - 1] !== ch && !(ch === " " && v.text[c - 1] === "\u00a0")) return false;
    const before = v.text.slice(0, c - 1);

    // A space before , ; : ! ? )  →  "membrane," / "Pergamum:" / "though)"
    if (/^[,;:!?)]$/.test(ch)) {
      const m = before.match(/[A-Za-z0-9)\]"'’] +$/);
      if (m && !/\n/.test(m[0])) {
        const sp = m[0].length - 1;
        replace(field, v, c - 1 - sp, c, ch);
        return true;
      }
    }
    if (/^[A-Za-z]$/.test(ch)) {
      // No space after , ; : or a closing bracket  →  ", plasma" / ") discovered"
      const needsSpace = /[A-Za-z)][,;]$/.test(before) ||
        (/[A-Za-z]{2}:$/.test(before) && !/(https?|file|mailto):$/i.test(before)) ||
        (/\)$/.test(before) && /\([^()]{2,}\)$/.test(before));
      if (needsSpace) { replace(field, v, c - 1, c, " " + ch); return true; }
      // A space just inside an opening bracket  →  "(not"
      const open = before.match(/\( +$/);
      if (open) { replace(field, v, c - 1 - open[0].length, c, "(" + ch); return true; }
    }
    if (ch === " " || /^[.,;:!?]$/.test(ch)) {
      // A stray symbol inside a word  →  "production" (only if that's a word)
      const m = before.match(STRAY);
      if (m && speller && (speller.correct(m[1] + m[2]) || speller.correct((m[1] + m[2]).toLowerCase()))) {
        replace(field, v, c - 1 - m[0].length, c - 1, m[1] + m[2], 1);
        return true;
      }
    }
    // Two spaces between words  →  one
    if (ch === " " && /[A-Za-z,;:)] $/.test(before.replace(/\u00a0$/, " "))) {
      replace(field, v, c - 1, c, "");
      return true;
    }
    return false;
  }

  // ── Autocorrect ──
  let lastFix = null;   // { field, original, fixed, sep }

  function onInput(e) {
    const field = e.target;
    lastFix = null;
    if (punctFix(e, field)) return;
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
    // A link being typed ("https:", "www."): not a word to fix.
    if (/^(https?|ftp|file|mailto|www)$/i.test(word) && /[:.]/.test(e.data)) return;
    // Odd capitals inside a word ("DIDnt") first, then the other fixes on
    // the result, so "DIDnt" ends up "didn't".
    const mixed = /[a-z]/.test(word) && /[A-Z]/.test(word.slice(1));
    const base = mixed ? (atStart ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word.toLowerCase()) : word;
    // Letters held down ("helllo"): runs of 3+ count as one or two.
    const runFix = /(.)\1\1/i.test(word)
      ? [word.replace(/(.)\1{2,}/gi, "$1$1"), word.replace(/(.)\1{2,}/gi, "$1")].find((c) => speller.correct(c) || speller.correct(c.toLowerCase()))
      : null;
    const learnedFix = learned[word.toLowerCase()] ? keepCase(word, learned[word.toLowerCase()]) : null;
    let fixed = learnedFix || runFix || apostropheFix(base, atStart) || capsFix(word, atStart) || midCapFix(word, atStart, level) ||
                allCapsFix(word, atStart, level);
    if (!fixed) {
      if (checkable(word, atStart, level) && misspelled(word)) {
        fixed = (level >= 2 ? bestFix(word, level) : clearFix(word)) || splitFix(word);
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
    if (hint && hint.field === e.target) {
      if (e.key === "ArrowRight" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (acceptHint()) { e.preventDefault(); e.stopPropagation(); return; }
      } else if (!["Shift", "Control", "Meta", "Alt"].includes(e.key)) {
        clearHint();
        if (!lastFix) hideBar();
      }
    }
    if (!lastFix || lastFix.field !== e.target) return;
    const undoKey = (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z";
    if (e.key === "Backspace" || undoKey) {
      if (undoFix()) e.preventDefault();
    } else if (!["Shift", "Control", "Meta", "Alt"].includes(e.key)) {
      lastFix = null;
    }
  }

  // ── Typing hints: the rest of the word, from the document or your notes ──
  // Shown in the bar while the caret is at the end of a word being typed
  // (3+ letters); → accepts it, typing on ignores it.
  let hint = null;   // { field, start, typed, word }

  function bestCompletion(prefix) {
    const p = prefix.toLowerCase();
    let best = null, bestScore = 0;
    const consider = (w, n, bonus) => {
      if (w.length < p.length + 2 || !w.startsWith(p) || w === p) return;
      const score = n * bonus + (w.length >= 6 ? 0.5 : 0);
      if (score > bestScore) { best = w; bestScore = score; }
    };
    if (docOn) DOCW.forEach((d, w) => consider(w, d.c, 2));
    VOCAB.forEach((n, w) => consider(w, n, 1));
    if (!best) return null;
    const form = docOn ? DOCW.get(best)?.form : null;
    // Keep what was typed; finish it as the document writes it.
    return prefix + (form && form.toLowerCase() === best ? form : best).slice(prefix.length);
  }

  function updateHint(field) {
    clearHint();
    if (!hintsOn || (!DOCW.size && !VOCAB.size)) return;
    const v = view(field);
    if (!v || !v.collapsed || v.empty) return;
    const atEnd = v.caret === v.text.length || !/[A-Za-z']/.test(v.text[v.caret]);
    if (!atEnd) return;
    const m = v.text.slice(0, v.caret).match(/[A-Za-z][A-Za-z'-]*$/);
    if (!m || m[0].length < 3) return;
    const word = bestCompletion(m[0]);
    if (!word) return;
    hint = { field, start: v.caret - m[0].length, typed: m[0], word };
    // A box with room of its own for the hint (the readers' pop-up note
    // box) takes the "ln-typing-hint" event and shows it there instead.
    if (!field.dispatchEvent(new CustomEvent("ln-typing-hint", { cancelable: true, detail: { word, accept: acceptHint } }))) return;
    showBar(field, { hint });
  }
  function clearHint() {
    if (!hint) return;
    hint.field.dispatchEvent(new CustomEvent("ln-typing-hint", { detail: null }));
    hint = null;
  }

  function acceptHint() {
    const h = hint;
    clearHint();
    if (!h) return false;
    const v = view(h.field);
    if (!v || !v.collapsed || v.text.slice(h.start, v.caret) !== h.typed) return false;
    replace(h.field, v, h.start, v.caret, h.word);
    hideBar();
    return true;
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
.ln-spell-bar { position: fixed; z-index: 2147483000; display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
  max-width: calc(100vw - 16px); padding: 6px 8px; border-radius: 10px; border: 1.5px solid var(--accent, #4f46e5);
  background: var(--bg, #fff); color: var(--sec, #55555f); box-shadow: 0 6px 24px rgba(0,0,0,.18);
  font: 13.5px/1.3 var(--font, system-ui, sans-serif); animation: ln-spell-in .14s ease-out; }
@keyframes ln-spell-in { from { opacity: 0; transform: translateY(4px); } }
.ln-spell-bar[hidden] { display: none; }
.ln-spell-bar .w { color: var(--dim, #8e8e99); text-decoration: line-through; margin-right: 2px; }
.ln-spell-bar button { border: 0; border-radius: 6px; padding: 5px 10px; font: inherit; cursor: pointer;
  background: var(--surface, #f7f7f8); color: var(--pri, #16161a); }
.ln-spell-bar button:hover { background: var(--hover, #efeff2); }
.ln-spell-bar button.fix { color: var(--accent, #4f46e5); font-weight: 650; background: var(--accent-soft, rgba(79,70,229,.08)); }
.ln-spell-bar button.quiet { background: transparent; color: var(--dim, #8e8e99); }
.ln-spell-bar .k { font-size: 11px; padding: 1px 5px; border-radius: 4px; border: 1px solid var(--border, #e3e3e8); color: var(--dim, #8e8e99); }`;
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

  function showBar(field, { undo, word, start, hint: h }) {
    ensureBar();
    bar.replaceChildren();
    if (h) {
      const k = document.createElement("span");
      k.className = "k";
      k.textContent = "→";
      bar.append(k, button(h.word, "fix", () => { hint = h; acceptHint(); }));
    } else if (undo) {
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
        if (!/\s/.test(s)) learn(word, s);   // next time it's fixed by itself
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
      if (!lastFix && !hint) hideBar();
      return;
    }
    clearHint();
    showBar(field, { word, start: s });
  }

  // ── Wiring: every textarea and text input on the page, as it's used ──
  const isField = (el) => el && !el.closest?.("#toolbar") && (el.tagName === "TEXTAREA" || el.classList?.contains("rich-box") ||
    (el.tagName === "INPUT" && (el.type === "text" || el.type === "search")));

  document.addEventListener("focusin", (e) => {
    if (!isField(e.target)) return;
    e.target.spellcheck = true;
    load();
  });
  document.addEventListener("input", (e) => {
    if (!isField(e.target)) return;
    onInput(e);
    if (!lastFix && e.inputType === "insertText" && /[A-Za-z'-]/.test(e.data || "")) updateHint(e.target);
    else if (!lastFix && hint) { clearHint(); hideBar(); }
  }, true);
  document.addEventListener("keydown", (e) => { if (isField(e.target)) onKeydown(e); }, true);
  document.addEventListener("selectionchange", () => {
    const el = document.activeElement;
    if (!isField(el)) { if (!lastFix) hideBar(); return; }
    clearTimeout(checkCaret.t);
    checkCaret.t = setTimeout(() => checkCaret(el), 250);
  });
  document.addEventListener("focusout", (e) => { if (isField(e.target)) { lastFix = null; clearHint(); hideBar(); } });
  addEventListener("scroll", () => hideBar(), true);

  globalThis.LazySpell = { load, isReady: () => !!speller };
})();
