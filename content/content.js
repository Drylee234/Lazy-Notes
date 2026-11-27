// Lazy Notes — Highlighter Content Script
// Courses and topics are plain name strings (no numeric ids — those only
// existed for the old Flask backend). All data comes from chrome.storage.local.

// Wrapped in a function so the script can be injected again into a tab that
// already ran it (see Re-injection below) without redeclaring names.
(() => {

  // crypto.randomUUID only exists on https pages; on a plain http:// site it's
  // missing and every save threw "crypto.randomUUID is not a function".
  const newId = () => (typeof crypto.randomUUID === "function" ? crypto.randomUUID()
    : ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) =>
        (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));

  const REINIT_EVENT = "lazy-notes-reinit";

  // Pick order = number keys 1-7, Plain = 0. Stored names are unchanged
  // ("note" shows as Important, "generic" as Plain).
  const CATEGORIES = [
    "header",
    "sub topic",   // a heading inside a header's section
    "definition",
    "formula",
    "list point",
    "note",        // Important: something to remember, stands out
    "summary",
    "list head",   // introduces the list points under it (off: lnListHeadType = false)
    "table",       // rows and cells (key T)
    "generic"      // Plain: just the words
  ];
  // Compact chips: a short mark, the full name on hover and in the caption.
  const CHIP = {
    "header":     { mark: "H",   name: "Header",     key: "1" },
    "sub topic":  { mark: "H2",  name: "Sub topic",  key: "2" },
    "definition": { mark: "Def", name: "Definition", key: "3" },
    "formula":    { mark: "ƒx",  name: "Formula",    key: "4" },
    "list point": { mark: "•",   name: "List point", key: "5" },
    "note":       { mark: "!",   name: "Important",  key: "6" },
    "summary":    { mark: "Σ",   name: "Summary",    key: "7" },
    "list head":  { mark: "≡",   name: "List head",  key: "8" },
    "table":      { mark: "▦",   name: "Table",      key: "t" },
    "generic":    { mark: "¶",   name: "Plain",      key: "0" }
  };
  // The extension can be reloaded or updated while a page is open. The page
  // keeps a dead copy of this script: `chrome` is still there but
  // chrome.storage is gone, and touching it throws. Everything below goes
  // through these, so an orphaned script goes quiet instead of erroring.
  const storageAlive = () => {
    try { return !!(chrome?.runtime?.id && chrome.storage?.local); } catch (_) { return false; }
  };
  function storageGet(keys, done) {
    if (!storageAlive()) return;
    try { chrome.storage.local.get(keys, (r) => { void chrome.runtime.lastError; done(r || {}); }); }
    catch (_) { /* reloaded between the check and the call */ }
  }
  function storageSet(items) {
    if (!storageAlive()) return;
    try { chrome.storage.local.set(items, () => { void chrome.runtime.lastError; }); } catch (_) {}
  }
  function onStorageChanged(fn) {
    try { chrome.storage?.onChanged?.addListener(fn); } catch (_) {}
  }

  let chipEls = {};
  let handoffBtnEls = [];
  let handoffOn = true;   // lnQuickSelButtons: ✎ Note / ❝ Quote in the pop-up
  let listHeadOn = true;  // lnListHeadType: the List head chip (8)
  let pageNumOn = true;   // lnDropPageNums: drop lone page numbers from PDF text
  let dupWarnOn = true;   // lnDupWarn: say when these words are already saved
  let saveToast = "small"; // lnSaveToast: "small" (Saved · Undo) | "off" (Ctrl+Z still undoes) | "full" (old bar)
  let headSplitOn = true; // lnHeadSplit: offer "Heading" + "Definition" for "Heading: words…"
  storageGet(["lnQuickSelButtons", "lnListHeadType", "lnDropPageNums", "lnDupWarn", "lnHeadSplit", "lnSaveToast"], (r) => {
    if (r?.lnSaveToast) saveToast = r.lnSaveToast;
    handoffOn = r?.lnQuickSelButtons !== false;
    listHeadOn = r?.lnListHeadType !== false;
    pageNumOn = r?.lnDropPageNums !== false;
    dupWarnOn = r?.lnDupWarn !== false;
    headSplitOn = r?.lnHeadSplit !== false;
    showListHeadChip();
  });
  // Off: hidden from the chips, the number keys and ←/→.
  const typesOffered = () => CATEGORIES.filter((c) => c !== "list head" || listHeadOn);
  function showListHeadChip() {
    if (chipEls["list head"]) chipEls["list head"].style.display = listHeadOn ? "" : "none";
  }
  let chipCaptionEl = null;

  // A selection that's a list: { head, items } when 2+ lines start with a
  // bullet or number (PDF bullets are often private-use glyphs like ),
  // or it spans 2+ <li> on a web page. Lines without a marker continue the
  // point above (wrapped text); before the first point they're the head.
  const MARKER = /^\s*([-–—•●○◦▪■□►▸▹➢➤✓✔*·\uF0A7\uF0B7\uF076\uF0D8\uF0FC\uF0A8\uF06C\uF06E]|\(?\d{1,2}[.)]|\(?[a-z][.)]|\(?(?:i{1,3}|iv|v|vi{0,3}|ix|x)[.)])\s+/i;
  function parseList(text, range) {
    const lines = String(text || "").split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
    let lis = [];
    try {
      const root = range?.commonAncestorContainer;
      const el = root?.nodeType === 1 ? root : root?.parentElement;
      lis = el ? [...el.querySelectorAll("li")].filter((li) => range.intersectsNode(li)) : [];
    } catch (_) {}
    if (lis.length >= 2) {
      const items = lis.map((li) => (li.innerText || li.textContent).replace(/\s+/g, " ").trim()).filter(Boolean);
      if (items.length < 2) return null;
      // Selected text above the list (its heading) comes first in the lines.
      const firstAt = lines.findIndex((l) => l.includes(items[0].slice(0, 20)));
      const head = firstAt > 0 ? lines.slice(0, firstAt).join(" ").replace(/[:：]\s*$/, "") : "";
      return { head, items };
    }
    if (lines.filter((l) => MARKER.test(l)).length < 2) return null;
    let head = "";
    const items = [];
    lines.forEach((l) => {
      if (MARKER.test(l)) items.push(l.replace(MARKER, "").trim());
      else if (items.length) items[items.length - 1] += " " + l;
      else head += (head ? " " : "") + l;
    });
    return items.length >= 2 ? { head: head.replace(/[:：]\s*$/, ""), items } : null;
  }
  let listSplit = null;      // the parsed list for the open pop-up, or null
  let joinBtnEl = null;
  let headingToggleEl = null;
  let pendingHeading = null;   // { text, category } offered for this save

  // The PDF section this selection is in, if its heading isn't in the topic
  // yet: offered as "Add heading … first" (ticked).
  function offerHeading(el) {
    pendingHeading = null;
    if (!headingToggleEl) return;
    headingToggleEl.style.display = "none";
    const sec = globalThis.LazyNotesHost?.sectionFor?.(el);
    if (!sec?.title || !selectedCourse || !selectedTopic) return;
    const norm = (t) => String(t || "").replace(/\s+/g, " ").trim().toLowerCase();
    const topic = courseTree?.[selectedCourse]?.topics?.[selectedTopic];
    const have = Object.values(topic?.highlights || {}).some((h) => norm(h.text) === norm(sec.title));
    if (have) return;
    pendingHeading = { text: sec.title, category: sec.depth > 0 ? "sub topic" : "header" };
    headingToggleEl.querySelector("input").checked = true;
    headingToggleEl.querySelector("span").textContent =
      `Add ${pendingHeading.category === "header" ? "heading" : "sub-heading"} “${sec.title}” first`;
    headingToggleEl.style.display = "";
  }
  let joinTarget = null;     // { id, text } of the highlight "Join" would add to

  // ── Guards against easy slips ────────────────────────────────────────────
  // Page / slide numbers come along when a selection crosses a PDF page's
  // footer: a line that is only "8" or "10". Dropped when there are other
  // lines (a selection of just a number is kept).
  function dropPageNumbers(text) {
    const lines = String(text || "").replace(/\r/g, "").split("\n");
    const words = lines.filter((l) => l.trim() && !/^\s*\d{1,3}\s*$/.test(l));
    if (lines.length < 2 || !words.length) return String(text || "");
    // The number and the blank lines around it go, so the sentence it cut
    // can be joined back together.
    const out = [];
    lines.forEach((l) => {
      if (/^\s*\d{1,3}\s*$/.test(l)) { while (out.length && !out[out.length - 1].trim()) out.pop(); out.push("\u0000"); return; }
      if (!l.trim() && out[out.length - 1] === "\u0000") return;
      out.push(l);
    });
    return out.filter((l) => l !== "\u0000").join("\n");
  }

  // Same words already in this topic (saved twice by mistake)?
  let dupWarnEl = null;
  function updateDupWarning() {
    if (!dupWarnEl) return;
    dupWarnEl.style.display = "none";
    if (!dupWarnOn || !selectedCourse || !selectedTopic) return;
    const norm = (t) => String(t || "").replace(/\s+/g, " ").trim().toLowerCase();
    const mine = norm(currentSelectedText);
    if (mine.length < 4) return;
    const topic = courseTree?.[selectedCourse]?.topics?.[selectedTopic];
    const all = [...Object.values(topic?.highlights || {}), ...Object.values(topic?.notes || {})];
    const same = all.some((h) => norm(h.text) === mine);
    const inside = !same && mine.length >= 20 && all.some((h) => norm(h.text).includes(mine));
    if (!same && !inside) return;
    dupWarnEl.textContent = same
      ? "⚠ Already saved in this topic · Enter saves it again"
      : "⚠ These words are already inside a saved note · Enter saves anyway";
    dupWarnEl.style.display = "";
  }

  // "Membrane Proteins: are the proteins inside the membrane" saved as a
  // heading: offer the words before ":" as the heading and the rest as a
  // Definition under it.
  let headSplitEl = null;
  const HEADING_TYPES = ["header", "sub topic", "list head"];
  function headingSplit(text) {
    const m = String(text || "").replace(/\s+/g, " ").trim().match(/^([^:：]{2,60}?)\s*[:：]\s*(.+)$/);
    if (!m || m[2].split(" ").length < 3) return null;
    return { head: m[1].trim(), rest: m[2].trim() };
  }
  function updateHeadSplit() {
    if (!headSplitEl) return;
    const parts = headSplitOn && HEADING_TYPES.includes(selectedCategory) && !listSplit
      ? headingSplit(currentSelectedText) : null;
    headSplitEl.style.display = parts ? "" : "none";
    if (!parts) return;
    const kind = { header: "Header", "sub topic": "Sub topic", "list head": "List head" }[selectedCategory];
    const head = parts.head.length > 28 ? parts.head.slice(0, 28) + "…" : parts.head;
    headSplitEl.querySelector("span").textContent = `Save “${head}” as ${kind} + the rest as Definition`;
  }
  const headSplitWanted = () => headSplitEl && headSplitEl.style.display !== "none" &&
    headSplitEl.querySelector("input").checked ? headingSplit(currentSelectedText) : null;

  function askLastHighlight() {
    joinTarget = null;
    if (joinBtnEl) joinBtnEl.style.display = "none";
    if (!selectedCourse || !selectedTopic) return;
    try {
      chrome.runtime.sendMessage({ type: "GET_LAST_HIGHLIGHT", courseName: selectedCourse, topicName: selectedTopic }, (r) => {
        if (chrome.runtime.lastError || !r?.ok || !joinBtnEl) return;
        joinTarget = r;
        const tail = r.text.replace(/\s+/g, " ").trim();
        joinBtnEl.textContent = `⤴ Join to “…${tail.length > 28 ? tail.slice(-28) : tail}”`;
        joinBtnEl.title = "Add these words to the end of your last highlight (J)";
        joinBtnEl.insertAdjacentHTML("beforeend", ' <span class="lazy-notes-join-key">J</span>');
        joinBtnEl.style.display = "";
        if (popupAnchor) positionPopup();
      });
    } catch (_) {}
  }

  function joinToLast() {
    const text = String(currentSelectedText || "").trim();
    if (!joinTarget || !text) return;
    const course = selectedCourse, topic = selectedTopic;
    hidePopup();
    try {
      chrome.runtime.sendMessage({ type: "JOIN_TO_LAST", courseName: course, topicName: topic, text }, (r) => {
        if (chrome.runtime.lastError || !r?.ok) return;
        showUndoToast({ course, topic, message: "Joined to your last highlight",
          onUndo: () => chrome.runtime.sendMessage({ type: "UNJOIN", courseName: course, topicName: topic, id: r.id, before: r.before }) });
      });
    } catch (_) {}
  }
  let splitToggleEl = null;

  // A first guess at the type from the words and where they were selected.
  // Only pre-picks: Enter accepts it, a number or a click overrides it.
  function guessType(text, el) {
    const t = String(text || "").trim();
    const words = t.split(/\s+/).length;
    const tag = el?.closest?.("h1, h2, h3, h4, h5, h6, li, .s-title")?.tagName?.toLowerCase() || "";
    // A table: picked inside a <table>, or 2+ lines with tabs between cells.
    if (el?.closest?.("table") && /\t|\n/.test(t)) return "table";
    if (t.split("\n").filter((l) => l.includes("\t")).length >= 2) return "table";
    if (/^(note|nb|important|remember|exam|warning|tip)\b[:\s-]/i.test(t)) return "note";
    // Big or all-capital short lines are headings (before the "A - b" definition rule).
    if (words <= 12 && !/[.!?,;]$/.test(t) && /^[A-Z0-9]/.test(t) && !t.includes("\n")) {
      const node = el?.nodeType === 1 ? el : el?.parentElement || document.body;
      const fs = parseFloat(getComputedStyle(node).fontSize) || 16;
      // In the PDF reader the words sit in a text layer whose size follows
      // the zoom: compare with the page's usual text size, not the body's.
      const layer = node.closest?.(".textLayer");
      let base = parseFloat(getComputedStyle(document.body).fontSize) || 16;
      if (layer) {
        const sizes = [...layer.querySelectorAll("span")].slice(0, 400)
          .filter((x) => x.textContent.trim().length > 3).map((x) => parseFloat(getComputedStyle(x).fontSize)).filter(Boolean).sort((a, b) => a - b);
        if (sizes.length >= 3) base = sizes[Math.floor(sizes.length / 2)];
      }
      if (words <= 8 || layer) {
        if (fs >= base * 1.4) return "header";
        if (fs >= base * 1.12) return "sub topic";
      }
      // A short line all in capitals is a title, whatever its size.
      if (t === t.toUpperCase() && /[A-Z]{3}/.test(t) && words >= 2) return "header";
    }
    if (/[=≈≠≤≥∑∫√±×÷∝∂]/.test(t) && words <= 25) return "formula";
    if (/^(in summary|to summari[sz]e|in conclusion|overall|in short)\b/i.test(t)) return "summary";
    if (/^[^.:;]{1,50}?\s*(:|\s[-–—]\s)\s*\S/.test(t) && words >= 3) return "definition";
    if (/^[A-Za-z][\w\s'()-]{0,40}\s(is|are|refers to|means|is defined as)\s(a|an|the)?\s?\S/i.test(t) && words <= 40) return "definition";
    if (tag === "li" || /^\s*([-•*▪◦]|\d+[.)]|[a-z][.)])\s/.test(t)) return "list point";
    if (/^h[12]$/.test(tag) || tag === "div" && el.closest(".s-title")) return "header";
    if (/^h[3-6]$/.test(tag)) return "sub topic";
    if (words > 60) return "summary";
    return null;
  }

  const contextRequiredCategories = [
    "definition",
    "formula",
    "summary"
  ];

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  let highlighterActive = false;
  let currentCourse     = null;   // course name string | null
  let currentTopic      = null;   // topic name string | null — active session topic
  let courseTree        = {};     // lazynotes.courses, read straight from storage

  // Session-level: { [topicName]: lastUsedCategory }
  const sessionCategoryMemory = {};

  // Last topic used this session — default for popup on next selection.
  let lastUsedTopic = null;

  let selectedCourse     = null;   // name string | null
  let selectedTopic      = null;   // name string | null
  let selectedCategory   = CATEGORIES[0];
  let selectedAnnotation = "";

  let currentParagraphElement = null;
  let currentSelectedText     = "";
  let currentRange            = null;   // copy of the selection, for hosts that anchor notes

  // DOM refs
  let popupContainer    = null;
  let courseBtnEl       = null;
  let courseMenuEl      = null;
  let topicBtnEl        = null;
  let topicMenuEl       = null;
  let categoryBtnEl     = null;
  let whereEl           = null;
  let textEditEl        = null;
  let tidyBtnEl         = null;   // ✨ Tidy in the pop-up footer
  let toolsRowEl        = null;   // the row holding Note / Quote / Tidy
  let tidyBefore        = null;   // the words before the AI touched them
  let sideBox           = null;   // split layout: the text + annotation box
  let editGroup         = null;   // text box + annotation, moved between boxes
  let whereElHome       = null;
  let popupSide         = "above";   // above | below | left | right | split
  storageGet("lnPopupSide", (r) => { if (r?.lnPopupSide) popupSide = r.lnPopupSide; });
  const inPopup = (el) => !!el && ((popupContainer && popupContainer.contains(el)) || (sideBox && sideBox.contains(el)));
  let popupAnchor       = null;   // the selection's box in page coordinates
  let popupMouse        = null;   // where the mouse let go (page coordinates)

  function fitTextEdit() {
    if (!textEditEl) return;
    textEditEl.style.height = "auto";
    const h = Math.min(textEditEl.scrollHeight + 2, 110);
    textEditEl.style.height = `${h}px`;
    textEditEl.style.overflowY = textEditEl.scrollHeight + 2 > 110 ? "auto" : "hidden";
  }
  let categoryMenuEl    = null;
  let annotationInputEl = null;

  // ---------------------------------------------------------------------------
  // Data helpers
  // ---------------------------------------------------------------------------

  function courseNames() {
    return Object.keys(courseTree);
  }

  function topicNamesFor(courseName) {
    if (!courseName || !courseTree[courseName]) return [];
    return Object.keys(courseTree[courseName].topics || {});
  }

  // ---------------------------------------------------------------------------
  // Styles
  // ---------------------------------------------------------------------------

  function injectLazyNotesStyles() {
    if (document.getElementById("lazy-notes-styles")) return;

    const targetHead = document.head || document.documentElement;
    const style = document.createElement("style");
    style.id = "lazy-notes-styles";
    style.textContent = `
      .lazy-notes-popup {
        position: absolute;
        width: 280px;
        min-width: 280px;
        max-width: 420px;
        background-color: #1e1e24;
        color: #f0f0f0;
        border: 1px solid #33333d;
        border-radius: 8px;
        padding: 12px;
        box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        z-index: 2147483647;
        box-sizing: border-box;
        transition: width 0.15s ease;
      }

      .lazy-notes-chips { display: flex; flex-wrap: wrap; gap: 4px 4px; margin: 6px 0 4px; }
      .lazy-notes-chip {
        position: relative; min-width: 25px; height: 27px; padding: 0 5px; border-radius: 7px;
        border: 1px solid #3a3a44; background: #26262d; color: #e4e4e7; cursor: pointer;
        font: 600 12px/1 inherit; font-family: inherit; display: inline-flex; align-items: center; justify-content: center;
      }
      .lazy-notes-chip:hover { background: #30303a; border-color: #50505c; }
      .lazy-notes-chip:focus-visible { outline: 2px solid #a5b4fc; outline-offset: 1px; }
      .lazy-notes-chip.on { background: #4f46e5; border-color: #6d65f0; color: #fff; }
      .lazy-notes-chip-key {
        position: absolute; top: -5px; right: -4px; min-width: 11px; height: 11px; padding: 0 2px; border-radius: 3px;
        background: #3a3a44; color: #c4c4cc; font-size: 8.5px; line-height: 11px; text-align: center;
      }
      .lazy-notes-chip.on .lazy-notes-chip-key { background: #fff; color: #4f46e5; }
      .lazy-notes-join {
        display: flex; align-items: center; gap: 6px; width: 100%; margin: -4px 0 8px; padding: 4px 6px;
        border: 1px dashed #3a3a44; border-radius: 6px; background: transparent; color: #a1a1aa;
        font: 11.5px inherit; font-family: inherit; text-align: left; cursor: pointer; white-space: nowrap; overflow: hidden;
      }
      .lazy-notes-join:hover { color: #f0f0f0; border-color: #6d65f0; }
      .lazy-notes-join-key { margin-left: auto; padding: 0 4px; border-radius: 3px; background: #3a3a44; color: #c4c4cc; font-size: 9.5px; }
      .lazy-notes-split { display: flex; align-items: center; gap: 6px; margin: -2px 0 8px; font-size: 11.5px; color: #d4d4d8; cursor: pointer; }
      .lazy-notes-split input { accent-color: #6366f1; margin: 0; }
      .lazy-notes-dup { margin: -2px 0 8px; padding: 4px 6px; border-radius: 6px; background: #3a2f12; color: #fcd34d; font-size: 11.5px; }
      .lazy-notes-chip-caption { font-size: 10.5px; color: #8e8e99; margin-bottom: 8px; }
      .lazy-notes-popup-side { width: 260px; min-width: 0; }
      .lazy-notes-popup-side .lazy-notes-text-edit { margin-bottom: 8px; }
      .lazy-notes-fold { cursor: pointer; color: #a1a1aa; user-select: none; margin-bottom: 0 !important; }
      .lazy-notes-fold:hover, .lazy-notes-fold:focus-visible { color: #f0f0f0; outline: none; }
      .lazy-notes-annotation-row:not(.open) .lazy-notes-textarea { display: none; }
      .lazy-notes-annotation-row.open .lazy-notes-fold { margin-bottom: 6px !important; }
      .lazy-notes-text-edit {
        margin: 0 0 10px; resize: none; line-height: 1.4; font-size: 12.5px;
        border-left: 3px solid #fde047 !important; color: #f0f0f0;
      }
      .lazy-notes-where {
        margin: 0 0 10px; font-size: 11.5px; color: #a1a1aa;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .lazy-notes-where.none { color: #ef6461; white-space: normal; }
      .lazy-notes-popup-row {
        margin-bottom: 8px;
        position: relative;
      }

      .lazy-notes-inline-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }

      .lazy-notes-popup-label-inline {
        font-size: 11px;
        font-weight: 600;
        color: #a0a0b0;
        white-space: nowrap;
        min-width: 60px;
      }

      .lazy-notes-popup-label-block {
        display: block;
        font-size: 11px;
        font-weight: 600;
        color: #a0a0b0;
        margin-bottom: 4px;
      }

      .lazy-notes-dropdown-btn {
        flex: 1;
        width: 100%;
        background: #121216;
        border: 1px solid #33333d;
        border-radius: 6px;
        color: #ffffff;
        padding: 6px 8px;
        font-size: 12px;
        box-sizing: border-box;
        outline: none;
        text-transform: capitalize;
        text-align: left;
        cursor: pointer;
        display: flex;
        justify-content: space-between;
        align-items: center;
        user-select: none;
      }

      .lazy-notes-dropdown-btn:focus,
      .lazy-notes-popup textarea:focus {
        border-color: #4f46e5;
      }

      .lazy-notes-dropdown-btn::after {
        content: "▾";
        font-size: 10px;
        color: #a0a0b0;
        pointer-events: none;
      }

      .lazy-notes-dropdown-menu {
        position: absolute;
        top: 100%;
        left: 68px;
        right: 0;
        background: #18181c;
        border: 1px solid #33333d;
        border-radius: 6px;
        margin-top: 4px;
        padding: 4px;
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
        z-index: 10;
        display: none;
        max-height: 280px;   /* all nine types without scrolling */
        overflow-y: auto;
      }

      .lazy-notes-dropdown-menu.open {
        display: block;
      }

      .lazy-notes-dropdown-item {
        padding: 5px 8px;
        font-size: 12px;
        border-radius: 4px;
        color: #cccccc;
        cursor: pointer;
        text-transform: capitalize;
      }

      .lazy-notes-dropdown-item:hover,
      .lazy-notes-dropdown-item.focused {
        background-color: #4f46e5;
        color: #ffffff;
      }

      /* While the mouse is over a list only the hovered item is solid, so it's
         clear which one a click picks; the current one is just tinted. */
      .lazy-notes-dropdown-menu:hover .lazy-notes-dropdown-item.focused:not(:hover) {
        background-color: rgba(79, 70, 229, 0.3);
      }

      .lazy-notes-dropdown-empty {
        padding: 5px 8px;
        font-size: 12px;
        color: #666670;
        font-style: italic;
      }

      .lazy-notes-textarea {
        width: 100%;
        min-height: 32px;
        max-height: 120px;
        background: #121216;
        border: 1px solid #33333d;
        border-radius: 6px;
        color: #ffffff;
        padding: 6px 8px;
        font-size: 12px;
        font-family: inherit;
        box-sizing: border-box;
        outline: none;
        resize: none;
        overflow-y: hidden;
        line-height: 1.4;
      }

      .lazy-notes-popup-footer {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: flex-end;
        gap: 6px;
        margin-top: 10px;
      }
      /* "What to do with these words" keeps a line of its own, so a longer
         label (↩ Undo) never pushes Save onto its own row. */
      .lazy-notes-popup-tools { display: flex; gap: 6px; width: 100%; }

      .lazy-notes-handoff {
        padding: 5px 7px; border-radius: 4px; font-size: 10.5px;
        font-weight: 600; cursor: pointer; border: 1px solid #45456a;
        background: transparent; color: #a5b4fc;
      }
      .lazy-notes-tidy { border-color: #5b4a7a; color: #d8b4fe; white-space: nowrap; }
      .lazy-notes-tidy:hover:not(:disabled) { background: #332a44; color: #e9d5ff; }
      .lazy-notes-tidy:disabled { opacity: .6; cursor: default; }
      .lazy-notes-handoff:hover { background: #2a2a44; color: #c7d2fe; }

      .lazy-notes-btn {
        padding: 5px 10px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 500;
        cursor: pointer;
        border: none;
        transition: background-color 0.15s ease;
      }

      .lazy-notes-btn-primary {
        background-color: #4f46e5;
        color: #ffffff;
      }

      .lazy-notes-btn-primary:hover {
        background-color: #4338ca;
      }

      .lazy-notes-btn-secondary {
        background-color: #2a2a32;
        color: #cccccc;
      }

      .lazy-notes-btn-secondary:hover {
        background-color: #383842;
        color: #ffffff;
      }
    `;

    targetHead.appendChild(style);
  }

  // ---------------------------------------------------------------------------
  // Popup build
  // ---------------------------------------------------------------------------

  function buildPopup() {
    if (popupContainer) return;

    injectLazyNotesStyles();

    const container = document.createElement("div");
    container.className = "lazy-notes-popup";
    container.style.display = "none";

    // ── ROW 1: Course ─────────────────────────────────────────────────────────
    const row1 = document.createElement("div");
    row1.className = "lazy-notes-popup-row lazy-notes-inline-row";

    const courseLabel = document.createElement("span");
    courseLabel.className = "lazy-notes-popup-label-inline";
    courseLabel.textContent = "Course:";
    row1.appendChild(courseLabel);

    const courseBtn = document.createElement("button");
    courseBtn.type = "button";
    courseBtn.className = "lazy-notes-dropdown-btn";

    const courseMenu = document.createElement("div");
    courseMenu.className = "lazy-notes-dropdown-menu";

    courseBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      clickDropdown(courseMenu);
    });

    row1.appendChild(courseBtn);
    row1.appendChild(courseMenu);
    // Course and topic are picked in the side panel now (and each document
    // remembers its own), so these rows are hidden, not removed: a single
    // "Saving to …" line shows where the note goes instead.
    row1.style.display = "none";
    const where = document.createElement("div");
    where.className = "lazy-notes-where";
    container.appendChild(where);
    whereEl = where;

    // The highlighted words, editable: trim them, fix a typo or a broken
    // line break before saving. Enter saves, Shift+Enter is a new line.
    const textEdit = document.createElement("textarea");
    textEdit.className = "lazy-notes-textarea lazy-notes-text-edit";
    textEdit.rows = 2;
    textEdit.spellcheck = true;
    textEdit.setAttribute("aria-label", "Highlighted text (you can edit it)");
    textEdit.title = "You can edit this before saving";
    textEdit.addEventListener("input", () => {
      currentSelectedText = textEdit.value;
      // Edited: split the list as it now reads (bullets/numbers per line).
      if (splitToggleEl && splitToggleEl.style.display !== "none") {
        listSplit = parseList(textEdit.value, null);
        splitToggleEl.style.display = listSplit ? "" : "none";
        if (listSplit) splitToggleEl.querySelector("span").textContent =
          `Save as ${listSplit.items.length} list points${listSplit.head ? " + their heading" : ""}`;
      }
      updateDupWarning();
      updateHeadSplit();
      fitTextEdit();
      if (popupAnchor) positionPopup();
    });
    container.appendChild(textEdit);
    textEditEl = textEdit;

    container.appendChild(row1);

    // ── ROW 2: Topic ──────────────────────────────────────────────────────────
    const row2 = document.createElement("div");
    row2.className = "lazy-notes-popup-row lazy-notes-inline-row";

    const topicLabel = document.createElement("span");
    topicLabel.className = "lazy-notes-popup-label-inline";
    topicLabel.textContent = "Topic:";
    row2.appendChild(topicLabel);

    const topicBtn = document.createElement("button");
    topicBtn.type = "button";
    topicBtn.className = "lazy-notes-dropdown-btn";

    const topicMenu = document.createElement("div");
    topicMenu.className = "lazy-notes-dropdown-menu";

    topicBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      clickDropdown(topicMenu);
    });

    row2.appendChild(topicBtn);
    row2.appendChild(topicMenu);
    row2.style.display = "none";
    container.appendChild(row2);

    // ── ROW 3: Category ───────────────────────────────────────────────────────
    const row3 = document.createElement("div");
    row3.className = "lazy-notes-popup-row lazy-notes-inline-row";

    const categoryLabel = document.createElement("span");
    categoryLabel.className = "lazy-notes-popup-label-inline";
    categoryLabel.textContent = "Category:";
    row3.appendChild(categoryLabel);

    const categoryBtn = document.createElement("button");
    categoryBtn.type = "button";
    categoryBtn.className = "lazy-notes-dropdown-btn";

    const categoryMenu = document.createElement("div");
    categoryMenu.className = "lazy-notes-dropdown-menu";

    CATEGORIES.forEach((cat) => {
      const item = document.createElement("div");
      item.className = "lazy-notes-dropdown-item";
      item.dataset.value = cat;
      item.textContent = cat;

      item.addEventListener("click", (e) => {
        e.stopPropagation();
        selectCategoryOption(cat);
        categoryMenu.classList.remove("open");
      });

      categoryMenu.appendChild(item);
    });

    categoryBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      clickDropdown(categoryMenu);
    });

    row3.appendChild(categoryBtn);
    row3.appendChild(categoryMenu);
    container.appendChild(row3);
    row3.style.display = "none";   // the dropdown stays for its keyboard code; chips replace it

    // Type chips: click one to save as that type, or press its number.
    // The lit one is what Enter saves as.
    const chipRow = document.createElement("div");
    chipRow.className = "lazy-notes-chips";
    chipRow.setAttribute("role", "radiogroup");
    chipRow.setAttribute("aria-label", "Type");
    chipEls = {};
    CATEGORIES.forEach((cat) => {
      const c = CHIP[cat];
      const b = document.createElement("button");
      b.type = "button";
      b.className = "lazy-notes-chip";
      b.setAttribute("role", "radio");
      b.title = `${c.name} (${c.key})`;
      b.setAttribute("aria-label", c.name);
      b.innerHTML = `<span class="lazy-notes-chip-mark"></span><span class="lazy-notes-chip-key"></span>`;
      b.firstChild.textContent = c.mark;
      b.lastChild.textContent = c.key;
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        selectCategoryOption(cat);
        sendHighlight();
        hidePopup();
      });
      b.addEventListener("mouseenter", () => showChipCaption(cat));
      b.addEventListener("mouseleave", () => showChipCaption(selectedCategory));
      chipEls[cat] = b;
      chipRow.appendChild(b);
    });
    showListHeadChip();
    const caption = document.createElement("div");
    caption.className = "lazy-notes-chip-caption";
    chipCaptionEl = caption;
    container.insertBefore(chipRow, row4Placeholder(container, row3));
    chipRow.after(caption);
    const split = document.createElement("label");
    split.className = "lazy-notes-split";
    split.innerHTML = `<input type="checkbox" checked> <span></span>`;
    split.addEventListener("mousedown", (e) => e.stopPropagation());
    caption.after(split);
    splitToggleEl = split;

    // "Join to last": the words carry on the previous highlight (a sentence
    // split across columns or pages). Shown only when there's one.
    const join = document.createElement("button");
    join.type = "button";
    join.className = "lazy-notes-join";
    join.style.display = "none";
    join.addEventListener("mousedown", (e) => e.preventDefault());
    join.addEventListener("click", (e) => { e.stopPropagation(); joinToLast(); });
    split.after(join);
    joinBtnEl = join;

    const heading = document.createElement("label");
    heading.className = "lazy-notes-split lazy-notes-heading";
    heading.innerHTML = `<input type="checkbox" checked> <span></span>`;
    heading.style.display = "none";
    heading.addEventListener("mousedown", (e) => e.stopPropagation());
    join.after(heading);
    headingToggleEl = heading;

    const headSplit = document.createElement("label");
    headSplit.className = "lazy-notes-split lazy-notes-head-split";
    headSplit.innerHTML = `<input type="checkbox" checked> <span></span>`;
    headSplit.style.display = "none";
    headSplit.title = "The words before “:” become the heading; the rest is saved under it as a Definition";
    headSplit.addEventListener("mousedown", (e) => e.stopPropagation());
    heading.after(headSplit);
    headSplitEl = headSplit;

    const dup = document.createElement("div");
    dup.className = "lazy-notes-dup";
    dup.style.display = "none";
    headSplit.after(dup);
    dupWarnEl = dup;

    // ── ROW 4: Annotation ─────────────────────────────────────────────────────
    const row4 = document.createElement("div");
    row4.className = "lazy-notes-popup-row";

    const annotationLabel = document.createElement("span");
    // Minimized until wanted: "Annotation ›" opens the box.
    annotationLabel.className = "lazy-notes-popup-label-block lazy-notes-fold";
    annotationLabel.textContent = "Annotation ›";
    annotationLabel.tabIndex = 0;
    annotationLabel.setAttribute("role", "button");
    const openAnnotation = (e) => {
      e?.preventDefault();
      row4.classList.add("open");
      annotationLabel.textContent = "Annotation";
      annotationInputEl?.focus();
      if (popupAnchor) positionPopup();
    };
    annotationLabel.addEventListener("click", openAnnotation);
    annotationLabel.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); openAnnotation(e); } });
    row4.appendChild(annotationLabel);
    row4.classList.add("lazy-notes-annotation-row");

    const annotationInput = document.createElement("textarea");
    annotationInput.className = "lazy-notes-textarea";
    annotationInput.placeholder = "Add optional notes...";
    annotationInput.rows = 1;

    annotationInput.addEventListener("input", () => {
      selectedAnnotation = annotationInput.value;

      annotationInput.style.height = "auto";
      const newHeight = Math.min(annotationInput.scrollHeight, 120);
      annotationInput.style.height = `${newHeight}px`;
      annotationInput.style.overflowY = newHeight >= 120 ? "auto" : "hidden";

      const lineLen = Math.max(
        ...annotationInput.value.split("\n").map((l) => l.length)
      );
      container.style.width = lineLen > 25
        ? `${Math.min(280 + (lineLen - 25) * 3, 420)}px`
        : "280px";
      if (popupAnchor) positionPopup();
    });

    row4.appendChild(annotationInput);
    container.appendChild(row4);

    // ── ROW 5: Footer buttons ─────────────────────────────────────────────────
    const row5 = document.createElement("div");
    row5.className = "lazy-notes-popup-footer";

    const dismissBtn = document.createElement("button");
    dismissBtn.className = "lazy-notes-btn lazy-notes-btn-secondary";
    dismissBtn.textContent = "Dismiss";
    dismissBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      hidePopup();
    });

    const saveBtn = document.createElement("button");
    saveBtn.className = "lazy-notes-btn lazy-notes-btn-primary";
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      sendHighlight();
      hidePopup();
    });

    // In the readers: hand the words to the pop-up note box (quick-note.js),
    // to rewrite them as your own note or keep them as a quote with a note.
    const tools = document.createElement("div");
    tools.className = "lazy-notes-popup-tools";
    row5.appendChild(tools);

    const handoffBtns = [["note", "✎ Note", "Write your own note from these words"],
                         ["quote", "❝ Quote", "Keep these words as a quote and add your note (Ctrl+.)"]].map(([mode, label, tip]) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "lazy-notes-handoff";
      b.textContent = label;
      b.title = tip;
      b.style.display = "none";
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", (e) => { e.stopPropagation(); handOff(mode); });
      tools.appendChild(b);
      return b;
    });
    handoffBtnEls = handoffBtns;

    // ✨ Tidy — ask the AI to clean the highlighted words up before saving.
    // It only changes the box you can already edit, so you see what you're
    // saving and can put it back. Hidden unless Settings › AI is on.
    const tidyBtn = document.createElement("button");
    tidyBtn.type = "button";
    tidyBtn.className = "lazy-notes-handoff lazy-notes-tidy";
    tidyBtn.textContent = "✨ Tidy";
    tidyBtn.title = "Ask the AI to fix broken lines and typing in these words (Alt+T)";
    tidyBtn.style.display = "none";
    tidyBtn.addEventListener("mousedown", (e) => e.preventDefault());
    tidyBtn.addEventListener("click", (e) => { e.stopPropagation(); runTidy(); });
    tools.appendChild(tidyBtn);
    tidyBtnEl = tidyBtn;
    toolsRowEl = tools;
    row5.appendChild(dismissBtn);
    row5.appendChild(saveBtn);
    container.appendChild(row5);

    // The editable text with its annotation under it, as one group that the
    // split layout moves into a box of its own.
    const group = document.createElement("div");
    group.className = "lazy-notes-edit-group";
    textEdit.replaceWith(group);
    group.append(textEdit, row4);
    editGroup = group;

    const side = document.createElement("div");
    side.className = "lazy-notes-popup lazy-notes-popup-side";
    side.style.display = "none";
    sideBox = side;

    (document.body || document.documentElement).appendChild(container);
    (document.body || document.documentElement).appendChild(side);

    popupContainer    = container;
    courseBtnEl       = courseBtn;
    courseMenuEl      = courseMenu;
    topicBtnEl        = topicBtn;
    topicMenuEl       = topicMenu;
    categoryBtnEl     = categoryBtn;
    categoryMenuEl    = categoryMenu;
    annotationInputEl = annotationInput;

    openOnHover(row1, courseMenu);
    openOnHover(row2, topicMenu);
    openOnHover(row3, categoryMenu);

    // Picking an item closes its list, which can leave the mouse resting on
    // another dropdown: don't pop that one open. (Capture: items stop the
    // click from bubbling.)
    container.addEventListener("click", (e) => {
      if (e.target.closest?.(".lazy-notes-dropdown-item")) pauseHoverOpen(e);
    }, true);

    // Clicking a list item mustn't take keyboard focus out of the popup (list
    // items can't hold focus, so it would fall to the page): Enter has to
    // keep saving after picking with the mouse.
    [courseMenu, topicMenu, categoryMenu].forEach((menu) =>
      menu.addEventListener("mousedown", (e) => e.preventDefault())
    );
  }

  // ---------------------------------------------------------------------------
  // Dropdowns open on click, and when the mouse rests on them
  // ---------------------------------------------------------------------------
  // Opening waits a moment, so brushing past a button on the way to another
  // doesn't open it; closing waits a moment, so crossing the gap between a
  // button and its list doesn't close it. Each row (label + button + list)
  // is one hover area. Labels sit left of the lists, so an open list never
  // covers them: hovering a label is how to get past an open list.

  const HOVER_OPEN_MS  = 500;   // rest this long to open; passing over does nothing. Click opens at once.
  const HOVER_SWITCH_MS = 300;  // moving from one open list to the next
  const HOVER_CLOSE_MS = 400;   // hover-opened lists close this long after the mouse leaves

  // Something just moved under a still mouse (the popup appeared, a list
  // closed after a pick): events at that same spot aren't hover. The first
  // real move is.
  let stillMouseAt = null;

  function pauseHoverOpen(e) {
    stillMouseAt = { x: e.clientX, y: e.clientY };
  }

  function isStillMouse(e) {
    return !!stillMouseAt &&
      Math.abs(e.clientX - stillMouseAt.x) < 1 &&
      Math.abs(e.clientY - stillMouseAt.y) < 1;
  }

  // Closed on purpose (click, Esc) with the mouse on it: stays shut until the
  // mouse leaves the row, or the next nudge would open it straight back up.
  function shutMenu(menu) {
    menu.classList.remove("open");
    if (menu.parentElement?.matches(":hover")) menu.dataset.shutUntilLeave = "1";
  }

  function allMenus() {
    return [courseMenuEl, topicMenuEl, categoryMenuEl].filter(Boolean);
  }

  function openMenu(menu, { byHover = false } = {}) {
    if (byHover) delete menu.dataset.used; else menu.dataset.used = "1";
    allMenus().forEach((m) => m.classList.toggle("open", m === menu));
    menu.dataset.hoverOpenedAt = byHover ? String(performance.now()) : "";
  }

  function clickDropdown(menu) {
    // A click just after hover opened the list means "open", not "close".
    const justHoverOpened =
      performance.now() - Number(menu.dataset.hoverOpenedAt || 0) < 1000;

    if (menu.classList.contains("open") && !justHoverOpened) {
      shutMenu(menu);
    } else {
      openMenu(menu);
    }
  }

  function openOnHover(row, menu) {
    let openTimer  = null;
    let closeTimer = null;

    // pointermove as well as pointerenter: the mouse may already be inside
    // the row when it starts to count (resting there after a list closed).
    const intent = (e) => {
      if (e.pointerType !== "mouse") return;
      clearTimeout(closeTimer);
      if (openTimer || menu.classList.contains("open")) return;
      if (menu.dataset.shutUntilLeave || isStillMouse(e)) return;

      // With another list already open, switch at once, like a menu bar.
      const otherOpen = allMenus().some((m) => m !== menu && m.classList.contains("open"));
      openTimer = setTimeout(() => {
        openTimer = null;
        delete menu.dataset.used;
        openMenu(menu, { byHover: true });
      }, otherOpen ? HOVER_SWITCH_MS : HOVER_OPEN_MS);
    };

    row.addEventListener("pointerenter", intent);
    row.addEventListener("pointermove", intent);

    row.addEventListener("pointerleave", (e) => {
      if (e.pointerType !== "mouse") return;
      clearTimeout(openTimer);
      openTimer = null;
      delete menu.dataset.shutUntilLeave;
      clearTimeout(closeTimer);
      // Opened by hover: closes when the mouse leaves. Opened by a click
      // (dataset.used): stays until a pick, a click elsewhere or Esc.
      if (menu.dataset.used) return;
      closeTimer = setTimeout(() => menu.classList.remove("open"), HOVER_CLOSE_MS);
    });
  }

  // ---------------------------------------------------------------------------
  // Option selection helpers (course/topic are plain name strings)
  // ---------------------------------------------------------------------------

  function selectCourseOption(courseName) {
    selectedCourse = courseName;

    if (courseBtnEl) courseBtnEl.textContent = courseName || "No courses";

    if (courseMenuEl) {
      courseMenuEl.querySelectorAll(".lazy-notes-dropdown-item").forEach((item) => {
        item.classList.toggle("focused", item.dataset.value === courseName);
      });
    }

    const topics = topicNamesFor(courseName);
    populateTopicOptions(topics);

    const restored = lastUsedTopic && topics.includes(lastUsedTopic)
      ? lastUsedTopic
      : (topics[0] ?? null);

    selectTopicOption(restored);
  }

  function selectTopicOption(topicName) {
    selectedTopic = topicName;
    updateDupWarning();

    if (topicBtnEl) {
      topicBtnEl.textContent = topicName || "No topics";
    }

    if (topicMenuEl) {
      topicMenuEl.querySelectorAll(".lazy-notes-dropdown-item").forEach((item) => {
        item.classList.toggle("focused", topicName !== null && item.dataset.value === topicName);
      });
    }

    if (topicName) {
      const remembered = sessionCategoryMemory[topicName];
      selectCategoryOption(remembered || CATEGORIES[0]);
    }
  }

  function showChipCaption(cat) {
    if (!chipCaptionEl) return;
    const c = CHIP[cat] || CHIP.generic;
    chipCaptionEl.textContent = `${c.name} · Enter saves · ${listHeadOn ? "1–8" : "1–7"}, T, 0 = type`;
  }

  // Where the chip row goes: right after the hidden category row.
  function row4Placeholder(container, row3) { return row3.nextSibling; }

  function selectCategoryOption(cat) {
    if (!CHIP[cat] || (cat === "list head" && !listHeadOn)) cat = cat === "list head" ? "list point" : "generic";
    selectedCategory = cat;
    Object.entries(chipEls).forEach(([k, b]) => {
      b.classList.toggle("on", k === cat);
      b.setAttribute("aria-checked", String(k === cat));
    });
    showChipCaption(cat);
    updateHeadSplit();

    if (categoryBtnEl) categoryBtnEl.textContent = cat;

    if (categoryMenuEl) {
      categoryMenuEl.querySelectorAll(".lazy-notes-dropdown-item").forEach((item) => {
        item.classList.toggle("focused", item.dataset.value === cat);
      });
    }
  }

  function populateCourseOptions() {
    if (!courseMenuEl) return;
    courseMenuEl.innerHTML = "";

    courseNames().forEach((name) => {
      const item = document.createElement("div");
      item.className = "lazy-notes-dropdown-item";
      item.dataset.value = name;
      item.textContent = name;

      item.addEventListener("click", (e) => {
        e.stopPropagation();
        selectCourseOption(name);
        courseMenuEl.classList.remove("open");
      });

      courseMenuEl.appendChild(item);
    });
  }

  function populateTopicOptions(topics) {
    if (!topicMenuEl) return;
    topicMenuEl.innerHTML = "";

    if (!topics || topics.length === 0) {
      const empty = document.createElement("div");
      empty.className = "lazy-notes-dropdown-empty";
      empty.textContent = "No topics — create one in the side panel";
      topicMenuEl.appendChild(empty);
      return;
    }

    topics.forEach((name) => {
      const item = document.createElement("div");
      item.className = "lazy-notes-dropdown-item";
      item.dataset.value = name;
      item.textContent = name;

      item.addEventListener("click", (e) => {
        e.stopPropagation();
        selectTopicOption(name);
        topicMenuEl.classList.remove("open");
      });

      topicMenuEl.appendChild(item);
    });
  }

  // ---------------------------------------------------------------------------
  // Popup state reset (called on every new selection)
  // ---------------------------------------------------------------------------

  function resetPopupState() {
    selectedAnnotation = "";

    populateCourseOptions();

    const names = courseNames();
    const defaultCourse = (currentCourse && names.includes(currentCourse))
      ? currentCourse
      : (names[0] ?? null);

    selectCourseOption(defaultCourse);

    allMenus().forEach((m) => {
      m.classList.remove("open");
      delete m.dataset.shutUntilLeave;
    });

    const annRow = popupContainer?.ownerDocument.querySelector(".lazy-notes-annotation-row");
    if (annRow) { annRow.classList.remove("open"); annRow.querySelector(".lazy-notes-fold").textContent = "Annotation ›"; }
    if (annotationInputEl) {
      annotationInputEl.value = "";
      annotationInputEl.style.height = "32px";
    }

    if (popupContainer) popupContainer.style.width = "280px";
    if (whereEl) {
      whereEl.textContent = selectedCourse && selectedTopic
        ? `Saving to ${selectedCourse} › ${selectedTopic}`
        : "Pick a course and topic in the Lazy Notes side panel first";
      whereEl.classList.toggle("none", !(selectedCourse && selectedTopic));
      // Only shown when something's missing; the side panel says where notes go.
      whereEl.style.display = selectedCourse && selectedTopic ? "none" : "";
    }
  }

  // ---------------------------------------------------------------------------
  // Keyboard navigation
  // ---------------------------------------------------------------------------

  function handleKeyDown(event) {
    if (shutDownIfOrphaned()) return;
    if (!popupContainer || popupContainer.style.display === "none") return;

    const active          = document.activeElement;
    const isCourseOpen    = courseMenuEl?.classList.contains("open");
    const isTopicOpen     = topicMenuEl?.classList.contains("open");
    const isCategoryOpen  = categoryMenuEl?.classList.contains("open");

    if (event.key === "Escape") {
      event.preventDefault();
      if (isCourseOpen)   shutMenu(courseMenuEl);
      else if (isTopicOpen)    shutMenu(topicMenuEl);
      else if (isCategoryOpen) shutMenu(categoryMenuEl);
      else { habit("popup-dismissed"); hidePopup(); }
      return;
    }

    // Alt+T: ✨ Tidy, without reaching for the mouse (and again to undo).
    if (event.altKey && (event.key === "t" || event.key === "T") && aiOn && tidyBtnEl?.style.display !== "none") {
      event.preventDefault();
      runTidy();
      return;
    }

    // ── TYPE CHIPS ── a number saves as that type (not while typing in a
    // box: Tab out first); ←/→ move the lit chip; Tab from the text box
    // jumps to the chips.
    const typing = active && (active.tagName === "TEXTAREA" || active.tagName === "INPUT");
    if (!typing && inPopup(active) && /^[0-8t]$/i.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const cat = typesOffered().find((c) => CHIP[c].key === event.key.toLowerCase());
      if (cat) {
        event.preventDefault();
        selectCategoryOption(cat);
        sendHighlight();
        hidePopup();
        return;
      }
    }
    if (!typing && inPopup(active) && (event.key === "j" || event.key === "J") && joinTarget && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      joinToLast();
      return;
    }
    if (active?.classList?.contains("lazy-notes-chip") && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
      event.preventDefault();
      const offered = typesOffered();
      const i = offered.indexOf(selectedCategory);
      const next = offered[(i + (event.key === "ArrowRight" ? 1 : -1) + offered.length) % offered.length];
      selectCategoryOption(next);
      chipEls[next]?.focus();
      return;
    }
    if (active === textEditEl && event.key === "Tab" && !event.shiftKey) {
      event.preventDefault();
      chipEls[selectedCategory]?.focus();
      return;
    }
    // Enter on a chip: save as the lit type.
    if (active?.classList?.contains("lazy-notes-chip") && event.key === "Enter") {
      event.preventDefault();
      sendHighlight();
      hidePopup();
      return;
    }

    // ── COURSE BUTTON ──────────────────────────────────────────────────────────
    if (active === courseBtnEl) {
      const names = courseNames();

      if (event.key === " ") {
        event.preventDefault();
        topicMenuEl?.classList.remove("open");
        categoryMenuEl?.classList.remove("open");
        courseMenuEl.classList.toggle("open");
        return;
      }

      if (isCourseOpen && (event.key === "ArrowDown" || event.key === "ArrowUp") && names.length > 0) {
        event.preventDefault();
        const currentIndex = names.indexOf(selectedCourse);
        let newIndex = currentIndex < 0 ? 0 : currentIndex;
        if (event.key === "ArrowDown") newIndex = (newIndex + 1) % names.length;
        else newIndex = (newIndex - 1 + names.length) % names.length;
        selectCourseOption(names[newIndex]);
        return;
      }

      if (!isCourseOpen && (event.key === "Tab" || event.key === "ArrowDown")) {
        event.preventDefault();
        topicBtnEl?.focus();
        return;
      }
    }

    // ── TOPIC BUTTON ───────────────────────────────────────────────────────────
    if (active === topicBtnEl) {
      const topics = topicNamesFor(selectedCourse);

      if (event.key === " ") {
        event.preventDefault();
        courseMenuEl?.classList.remove("open");
        categoryMenuEl?.classList.remove("open");
        topicMenuEl.classList.toggle("open");
        return;
      }

      if (isTopicOpen && (event.key === "ArrowDown" || event.key === "ArrowUp") && topics.length > 0) {
        event.preventDefault();
        const currentIndex = topics.indexOf(selectedTopic);
        let newIndex = currentIndex < 0 ? 0 : currentIndex;
        if (event.key === "ArrowDown") newIndex = (newIndex + 1) % topics.length;
        else newIndex = (newIndex - 1 + topics.length) % topics.length;
        selectTopicOption(topics[newIndex]);
        return;
      }

      if (!isTopicOpen && (event.key === "Tab" || event.key === "ArrowDown")) {
        event.preventDefault();
        categoryBtnEl?.focus();
        return;
      }

      if (!isTopicOpen && event.key === "ArrowUp") {
        event.preventDefault();
        courseBtnEl?.focus();
        return;
      }
    }

    // ── CATEGORY BUTTON ────────────────────────────────────────────────────────
    if (active === categoryBtnEl) {
      if (event.key === " ") {
        event.preventDefault();
        courseMenuEl?.classList.remove("open");
        topicMenuEl?.classList.remove("open");
        categoryMenuEl.classList.toggle("open");
        return;
      }

      if (isCategoryOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        event.preventDefault();
        const currentIndex = CATEGORIES.indexOf(selectedCategory);
        let newIndex = currentIndex;
        if (event.key === "ArrowDown") newIndex = (currentIndex + 1) % CATEGORIES.length;
        else newIndex = (currentIndex - 1 + CATEGORIES.length) % CATEGORIES.length;
        selectCategoryOption(CATEGORIES[newIndex]);
        return;
      }

      if (!isCategoryOpen && (event.key === "Tab" || event.key === "ArrowDown")) {
        event.preventDefault();
        annotationInputEl?.focus();
        return;
      }

      if (!isCategoryOpen && event.key === "ArrowUp") {
        event.preventDefault();
        topicBtnEl?.focus();
        return;
      }
    }

    // ── ANNOTATION ─────────────────────────────────────────────────────────────
    if (active === annotationInputEl) {
      const isEmpty = !annotationInputEl.value;

      if ((event.shiftKey && event.key === "ArrowUp") || (isEmpty && event.key === "ArrowUp")) {
        event.preventDefault();
        categoryBtnEl?.focus();
        return;
      }

      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendHighlight();
        hidePopup();
        return;
      }
    }

    // Only save on Enter when focus is inside the popup — otherwise pressing
    // Enter in a page form while the popup is open would save a note. An open
    // list doesn't stop it (arrow keys already applied the pick, and a list
    // opened by hovering isn't being used); a focused Save or Dismiss button
    // keeps its own Enter, so Enter on Dismiss dismisses.
    if (
      event.key === "Enter" &&
      active !== annotationInputEl &&
      !(active === textEditEl && event.shiftKey) &&
      !active?.classList?.contains("lazy-notes-btn") &&
      inPopup(active)
    ) {
      event.preventDefault();
      sendHighlight();
      hidePopup();
    }
  }

  // ---------------------------------------------------------------------------
  // Activation
  // ---------------------------------------------------------------------------

  function activateHighlighter() {
    if (dead) return;
    document.addEventListener("mouseup", afterMouseUp);
    document.addEventListener("keydown", handleKeyDown);
  }

  function deactivateHighlighter() {
    document.removeEventListener("mouseup", afterMouseUp);
    document.removeEventListener("keydown", handleKeyDown);
    hidePopup();
  }

  // ---------------------------------------------------------------------------
  // Popup show / hide
  // ---------------------------------------------------------------------------

  // Where the pop-up sits around the selection, from the side panel's ⚙
  // ("lnPopupSide"): above (default), below, left, right, or split (the
  // text box on the left, type + Save on the right). A side without room
  // falls back to above/below. Re-run when the pop-up grows.
  function positionPopup(rect) {
    if (!popupContainer) return;
    if (rect) {
      popupAnchor = { top: rect.top + window.scrollY, bottom: rect.bottom + window.scrollY,
                      left: rect.left + window.scrollX, right: rect.right + window.scrollX };
    }
    const a = popupAnchor;
    if (!a) return;
    const vx = window.scrollX, vy = window.scrollY;
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    const GAP = 10;
    const place = (el, left, top) => {
      const w = el.offsetWidth, h = el.offsetHeight;
      el.style.left = `${Math.max(vx + 8, Math.min(left, vx + vw - w - 8))}px`;
      el.style.top  = `${Math.max(vy + 8, Math.min(top, vy + vh - h - 8))}px`;
    };
    const vertical = (el, prefer) => {
      const h = el.offsetHeight;
      const roomAbove = a.top - vy - GAP >= h;
      const roomBelow = vy + vh - a.bottom - GAP >= h;
      const above = prefer === "above" ? (roomAbove || !roomBelow) : (!roomBelow && roomAbove);
      place(el, a.left, above ? a.top - h - GAP : a.bottom + GAP);
    };
    const fitsLeft  = (el) => a.left - vx - GAP - el.offsetWidth >= 8;
    const fitsRight = (el) => vx + vw - a.right - GAP - el.offsetWidth >= 8;

    const mode = popupSide;
    // Split: the two boxes either side of where the mouse let go, so
    // neither needs a long trip. Without room on both sides: one above the
    // mouse, one below.
    if (mode === "split" && popupMouse) {
      const m = popupMouse, sw = sideBox.offsetWidth, cw = popupContainer.offsetWidth;
      const top = (el) => m.y - Math.min(40, el.offsetHeight / 2);
      if (m.x - vx - 16 - sw >= 8 && vx + vw - m.x - 16 - cw >= 8) {
        place(sideBox, m.x - 16 - sw, top(sideBox));
        place(popupContainer, m.x + 16, top(popupContainer));
      } else {
        place(sideBox, m.x - sw / 2, m.y - sideBox.offsetHeight - 16);
        place(popupContainer, m.x - cw / 2, m.y + 16);
      }
      return;
    }
    if (mode === "split") {
      if (fitsLeft(sideBox) && fitsRight(popupContainer)) {
        place(sideBox, a.left - sideBox.offsetWidth - GAP, a.top - 8);
        place(popupContainer, a.right + GAP, a.top - 8);
      } else {
        vertical(sideBox, "above");
        vertical(popupContainer, "below");
      }
      return;
    }
    if (mode === "left" && fitsLeft(popupContainer)) return place(popupContainer, a.left - popupContainer.offsetWidth - GAP, a.top - 8);
    if (mode === "right" && fitsRight(popupContainer)) return place(popupContainer, a.right + GAP, a.top - 8);
    vertical(popupContainer, mode === "below" ? "below" : "above");
  }

  // Split layout: the text box group lives in its own box; otherwise it sits
  // in the main pop-up under "Saving to".
  function arrangePopup() {
    if (!editGroup || !sideBox) return;
    const where = popupContainer.querySelector(".lazy-notes-where");
    if (popupSide === "split") {
      if (editGroup.parentNode !== sideBox) sideBox.appendChild(editGroup);
      sideBox.style.display = "block";
    } else {
      if (editGroup.parentNode !== popupContainer) where.after(editGroup);
      sideBox.style.display = "none";
    }
  }

  // Text selected in a PDF comes in broken lines: join them back into
  // sentences ("-" at a line end glues a split word), keep real line ends
  // (after . ! ? : ;) and blank lines. Same cleanup as pasting into the note
  // box (sidepanel/rich-box.js). Lists are left alone (they split into points).
  const BULLET_RE = /^\s*[•●○◦▪■□►▸▹➢➤✓✔·\uF0A7\uF0B7\uF076\uF0D8\uF0FC\uF0A8\uF06C\uF06E]\s*/;
  const POINT_RE = /^\s*([-*]|\d{1,2}[.)]|[a-z][.)])\s+/i;
  function joinBrokenLines(text) {
    const lines = String(text || "").replace(/\r/g, "").split("\n").map((l) => l.replace(/\s+$/, ""));
    if (lines.length < 2) return lines.join("");
    const out = [];
    lines.forEach((raw) => {
      const l = raw;
      if (!l.trim()) { out.push(""); return; }
      const prev = out[out.length - 1];
      const startsPoint = POINT_RE.test(l) || BULLET_RE.test(raw);
      if (prev && !startsPoint && !/[.!?:;]["')\]]?$/.test(prev) && prev.length > 25) {
        out[out.length - 1] = /[A-Za-z]-$/.test(prev) && /^[a-z]/.test(l.trim())
          ? prev.slice(0, -1) + l.trim()
          : `${prev} ${l.trim()}`;
      } else out.push(l.trim());
    });
    return out.join("\n").replace(/\n{3,}/g, "\n\n");
  }

  // ── ✨ Tidy (background/bg_ai.js does the talking) ───────────────────────
  let aiOn = false;
  function refreshAi() {
    try {
      chrome.runtime.sendMessage({ type: "AI_READY" }, (r) => {
        void chrome.runtime.lastError;
        aiOn = !!(r?.on && r?.hasKey);
        if (tidyBtnEl && popupContainer?.style.display === "block") tidyBtnEl.style.display = aiOn ? "" : "none";
      });
    } catch (_) { aiOn = false; }
  }
  try {
    onStorageChanged((c, area) => {
      if (area === "local" && (c.lnAiOn || c.lnAiKeys || c.lnAiProvider)) refreshAi();
    });
  } catch (_) { /* no storage on this page */ }
  refreshAi();

  function setTidyLabel(label, title, ms) {
    if (!tidyBtnEl) return;
    tidyBtnEl.textContent = label;
    if (title) tidyBtnEl.title = title;
    if (ms) setTimeout(() => {
      if (!tidyBtnEl) return;
      tidyBtnEl.textContent = "✨ Tidy";
      tidyBtnEl.title = "Ask the AI to fix broken lines and typing in these words (Alt+T)";
      tidyBtnEl.disabled = false;
    }, ms);
  }

  function runTidy() {
    if (!tidyBtnEl || !textEditEl) return;
    // A second press puts the original words back.
    if (tidyBefore != null) {
      textEditEl.value = tidyBefore;
      currentSelectedText = tidyBefore;
      tidyBefore = null;
      fitTextEdit();
      setTidyLabel("✨ Tidy", "Ask the AI to fix broken lines and typing in these words (Alt+T)");
      return;
    }
    const text = textEditEl.value.trim();
    if (!text) return;
    const before = textEditEl.value;
    tidyBtnEl.disabled = true;
    setTidyLabel("✨ …", "Asking the AI…");
    chrome.runtime.sendMessage({ type: "AI_RUN", task: "tidy", text }, (r) => {
      void chrome.runtime.lastError;
      tidyBtnEl.disabled = false;
      if (r?.ok && r.text) {
        tidyBefore = before;
        textEditEl.value = r.text;
        currentSelectedText = r.text;
        fitTextEdit();
        if (popupAnchor) positionPopup();
        setTidyLabel("↩ Undo", "Put the original words back");
      } else {
        setTidyLabel("✨ failed", r?.reason || "The AI couldn't be reached.", 5000);
      }
    });
  }

  function showPopup(rect, selectedText, paragraphElement) {
    if (!popupContainer) buildPopup();
    resetPopupState();
    if (pageNumOn && !/	/.test(selectedText)) selectedText = dropPageNumbers(selectedText);
    if (!parseList(selectedText, currentRange) && !/	/.test(selectedText)) selectedText = joinBrokenLines(selectedText);

    currentSelectedText     = selectedText;
    currentParagraphElement = paragraphElement;

    popupContainer.style.display = "block";
    // Readers: to their pop-up note box. Web pages: to the side panel's note box.
    const canHandOff = globalThis.LazyNotesQuick ? globalThis.LazyNotesQuick.enabled("lnQuickSelButtons") : handoffOn;
    handoffBtnEls.forEach((b) => { b.style.display = canHandOff ? "" : "none"; });
    tidyBefore = null;
    if (tidyBtnEl) {
      tidyBtnEl.style.display = aiOn ? "" : "none";
      tidyBtnEl.disabled = false;
      tidyBtnEl.textContent = "✨ Tidy";
    }
    // The tools row disappears entirely when it has nothing in it.
    if (toolsRowEl) toolsRowEl.style.display = (aiOn || canHandOff) ? "" : "none";
    arrangePopup();
    if (textEditEl) { textEditEl.value = selectedText; fitTextEdit(); }
    positionPopup(rect);

    // A clear guess wins; otherwise Plain. (The last saved type is kept
    // for list points, since those usually come in a row.)
    askLastHighlight();
    offerHeading(paragraphElement);
    listSplit = parseList(selectedText, currentRange);
    if (splitToggleEl) {
      splitToggleEl.style.display = listSplit ? "" : "none";
      splitToggleEl.querySelector("input").checked = true;
      if (listSplit) splitToggleEl.querySelector("span").textContent =
        `Save as ${listSplit.items.length} list points${listSplit.head ? " + their heading" : ""}`;
    }
    const guess = listSplit ? "list point" : guessType(selectedText, paragraphElement);
    const last = sessionCategoryMemory[selectedTopic];
    selectCategoryOption(guess || (last === "list point" ? last : "generic"));
    updateDupWarning();
    setTimeout(() => chipEls[selectedCategory]?.focus(), 50);
  }

  function hidePopup() {
    if (popupContainer) popupContainer.style.display = "none";
    if (sideBox) sideBox.style.display = "none";
    if (courseMenuEl)   courseMenuEl.classList.remove("open");
    if (topicMenuEl)    topicMenuEl.classList.remove("open");
    if (categoryMenuEl) categoryMenuEl.classList.remove("open");

    window.getSelection()?.removeAllRanges();
    currentParagraphElement = null;
    currentSelectedText     = "";
    currentRange            = null;
    popupAnchor             = null;
    popupMouse              = null;
  }

  function isEventInsidePopup(event) {
    return inPopup(event.target);
  }

  // ---------------------------------------------------------------------------
  // Mouse handlers
  // ---------------------------------------------------------------------------

  function findContextElement(node) {
    if (!node) return null;
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!element) return null;
    return element.closest("p, li, h1, h2, h3, h4, h5, h6") || element;
  }

  // Read the selection once the browser has finished with this click. A
  // click on text that's still selected only clears the selection after
  // mouseup, so reading it straight away brought the pop-up back for words
  // you'd just saved or dismissed (Enter then saved them a second time).
  function afterMouseUp(event) {
    setTimeout(() => { handleMouseUp(event); handleDocumentClick(event); }, 0);
  }

  function handleMouseUp(event) {
    if (shutDownIfOrphaned()) return;
    if (!highlighterActive) return;
    if (popupContainer && isEventInsidePopup(event)) return;
    if (event.target?.closest?.(".lnq-box")) return;   // the readers' pop-up note box

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const text = selection.toString().trim();
    if (text.length === 0) return;

    const range = selection.getRangeAt(0);
    currentRange = range.cloneRange();
    const rect  = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    const paragraphElement = findContextElement(selection.anchorNode);
    popupMouse = { x: event.clientX + window.scrollX, y: event.clientY + window.scrollY };
    showPopup(rect, text, paragraphElement);
    pauseHoverOpen(event);   // the popup may have appeared under the mouse
  }

  function handleDocumentClick(event) {
    if (!popupContainer || popupContainer.style.display === "none") return;
    if (isEventInsidePopup(event)) return;
    // If this mouseup produced a non-empty selection, handleMouseUp (which runs
    // first) just showed the popup — don't immediately dismiss it.
    const sel = window.getSelection();
    if (sel && sel.toString().trim().length > 0) return;
    habit("popup-dismissed");
    hidePopup();
  }

  // ---------------------------------------------------------------------------
  // Send
  // ---------------------------------------------------------------------------

  // The selection goes to the pop-up note box (readers only). Returns true
  // if there was a selection to hand over.
  function handOff(mode) {
    const quick = globalThis.LazyNotesQuick;
    if (!popupContainer || popupContainer.style.display !== "block") return false;
    const text = String(currentSelectedText ?? "").trim();
    if (!text) return false;
    if (!quick) {
      // A web page: the side panel's note box (opened if it's closed).
      try { chrome.runtime.sendMessage({ type: "SEND_TO_NOTE_BOX", mode, text }); } catch (_) { return false; }
      hidePopup();
      window.getSelection()?.removeAllRanges();
      return true;
    }
    const host = globalThis.LazyNotesHost;
    const base = {
      sourceUrl:   host?.sourceUrl ? host.sourceUrl(currentParagraphElement) : window.location.href,
      sourceTitle: host?.sourceTitle ? host.sourceTitle(currentParagraphElement) : document.title || null,
      anchor:      host?.anchorFor && currentRange ? host.anchorFor(currentRange) : null,
      context:     null
    };
    const rect = currentRange?.getBoundingClientRect?.();
    hidePopup();
    quick.open({ mode, text, base, rect: rect && (rect.width || rect.height) ? rect : null, category: selectedCategory });
    return true;
  }
  if (location.protocol === "chrome-extension:") globalThis.LazyNotesPopupHandOff = handOff;

  function sendHighlight() {
    currentSelectedText = String(currentSelectedText ?? "").trim();
    if (!currentSelectedText) {
      console.warn("LazyNotes: Cannot send highlight — missing text");
      return;
    }

    if (!selectedTopic || !selectedCourse) {
      console.warn("LazyNotes: Cannot send highlight — no course/topic selected");
      return;
    }

    lastUsedTopic = selectedTopic;
    sessionCategoryMemory[selectedTopic] = selectedCategory;   // remembered only once saved

    const includeContext = contextRequiredCategories.includes(selectedCategory);

    // An extension page that loads this script (the PDF reader) can set
    // globalThis.LazyNotesHost to supply a better source link and context.
    // Real content scripts run in an isolated world, so web pages can't.
    const host = globalThis.LazyNotesHost;
    const context = !includeContext ? null
      : host?.contextFor ? host.contextFor(currentParagraphElement)
      : currentParagraphElement?.textContent ?? null;

    const payload = {
      type:       "NEW_HIGHLIGHT",
      id:         newId(),
      text:       currentSelectedText,
      context,
      category:   selectedCategory,
      course:     selectedCourse,
      topic:      selectedTopic,
      annotation: selectedAnnotation,
      sourceUrl:  host?.sourceUrl ? host.sourceUrl(currentParagraphElement) : window.location.href,
      sourceTitle: host?.sourceTitle ? host.sourceTitle(currentParagraphElement) : document.title || null,
      anchor:     host?.anchorFor ? host.anchorFor(currentRange) : null
    };

    // "Heading: words…" saved as a heading → heading + Definition under it.
    const hs = headSplitWanted();
    if (hs) {
      const t0 = Date.now();
      const sent = [
        ...(pendingHeading && headingToggleEl?.querySelector("input").checked && pendingHeading.text !== hs.head
          ? [{ ...payload, id: newId(), text: pendingHeading.text, category: pendingHeading.category, context: null, annotation: "" }] : []),
        { ...payload, id: newId(), text: hs.head, context: null, annotation: "" },
        { ...payload, id: newId(), text: hs.rest, category: "definition" }
      ].map((m, i) => ({ ...m, timestamp: new Date(t0 + i).toISOString() }));
      pendingHeading = null;
      try { chrome.runtime.sendMessage({ type: "NEW_HIGHLIGHTS", items: sent }); } catch (err) { return; }
      showUndoToast({ ...payload, ids: sent.map((m) => m.id), message: `Saved “${hs.head}” + its definition` });
      return;
    }

    // A list saved as list points: one highlight per point (plus the line
    // above them as Plain, which shows as their heading), in order.
    const withHeading = pendingHeading && headingToggleEl?.querySelector("input").checked
      && !(pendingHeading.category === selectedCategory && pendingHeading.text === currentSelectedText)
      ? [{ text: pendingHeading.text, category: pendingHeading.category }] : [];
    pendingHeading = null;
    if (withHeading.length && !(listSplit && selectedCategory === "list point" && splitToggleEl?.querySelector("input").checked)) {
      const t0 = Date.now();
      const sent = [
        { ...payload, id: newId(), text: withHeading[0].text, category: withHeading[0].category, context: null, annotation: "", timestamp: new Date(t0).toISOString() },
        { ...payload, timestamp: new Date(t0 + 1).toISOString() }
      ];
      try { chrome.runtime.sendMessage({ type: "NEW_HIGHLIGHTS", items: sent }); } catch (err) { return; }
      showUndoToast({ ...payload, ids: sent.map((m) => m.id), message: `Saved with heading “${withHeading[0].text}”` });
      return;
    }
    if (listSplit && selectedCategory === "list point" && splitToggleEl?.querySelector("input").checked) {
      const parts = [
        ...withHeading,
        ...(listSplit.head ? [{ text: listSplit.head, category: "generic" }] : []),
        ...listSplit.items.map((t) => ({ text: t, category: "list point" }))
      ];
      const t0 = Date.now();
      const sent = parts.map((part, i) => ({
        ...payload, id: newId(), text: part.text, category: part.category, context: null,
        annotation: i === parts.length - 1 ? selectedAnnotation : "",
        timestamp: new Date(t0 + i).toISOString()
      }));
      try { chrome.runtime.sendMessage({ type: "NEW_HIGHLIGHTS", items: sent }); } catch (err) { console.error("LazyNotes: sendMessage failed:", err); return; }
      showUndoToast({ ...payload, ids: sent.map((m) => m.id), count: listSplit.items.length });
      listSplit = null;
      return;
    }

    try {
      chrome.runtime.sendMessage(payload);
    } catch (err) {
      console.error("LazyNotes: sendMessage failed:", err);
      return;
    }
    showUndoToast(payload);
  }

  // ---------------------------------------------------------------------------
  // Undo — a few seconds to take back a highlight saved by mistake
  // ---------------------------------------------------------------------------
  // The highlight is saved at once (closing the tab can't lose it); Undo, or
  // Ctrl/⌘+Z while the toast shows, deletes it again. Hovering the toast
  // pauses the countdown. A newer save replaces the toast.

  const UNDO_MS = 6000;
  let undoToast = null;   // { host, cancel }

  // A habit for the usage report (bg_habits.js): counts only, never text.
  function habit(name) { try { chrome.runtime.sendMessage({ type: "HABIT", name }); } catch (_) {} }

  function showUndoToast(saved) {
    undoToast?.cancel();

    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host { all: initial; position: fixed; right: calc(20px + var(--ln-embed-open-w, 0px)); bottom: 20px; z-index: 2147483647; }
        .toast {
          position: relative; overflow: hidden;
          display: flex; align-items: center; gap: 12px;
          padding: 10px 10px 10px 14px;
          background: #1e1e24; color: #f0f0f0;
          border: 1px solid #33333d; border-radius: 8px;
          box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);
          font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        .msg { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        /* Small (default): the note showing in your notes is the confirmation;
           this only offers Undo. */
        .small { gap: 8px; padding: 4px 4px 4px 10px; border-radius: 999px; font-size: 12px; opacity: .92; }
        .small button { padding: 3px 9px; border-radius: 999px; font-size: 11.5px; }
        .small .bar { height: 2px; }
        .off { display: none; }
        button {
          all: unset; cursor: pointer; padding: 5px 10px; border-radius: 5px;
          background: #4f46e5; color: #fff; font-weight: 600; font-size: 12px;
        }
        button:hover { background: #4338ca; }
        button:focus-visible { outline: 2px solid #818cf8; outline-offset: 1px; }
        .bar { position: absolute; left: 0; bottom: 0; height: 3px; width: 100%; background: #4f46e5;
               transform-origin: left; animation: run ${UNDO_MS}ms linear forwards; }
        .toast:hover .bar { animation-play-state: paused; }
        @keyframes run { to { transform: scaleX(0); } }
        @media (prefers-reduced-motion: reduce) { .bar { animation: none; opacity: 0; } }
      </style>
      <div class="toast" role="status">
        <span class="msg"></span>
        <button type="button" title="Undo (Ctrl+Z)">Undo</button>
        <div class="bar"></div>
      </div>`;
    // lnSaveToast: small pill (default), off (Ctrl+Z only), or the old full bar.
    root.querySelector(".toast").classList.add(saveToast === "full" ? "full" : saveToast === "off" ? "off" : "small");
    if (saveToast !== "full") {
      root.querySelector(".msg").textContent = saved.count ? `Saved ${saved.count} points` : saved.message && !/^Saved to/.test(saved.message) ? saved.message : "Saved";
    } else root.querySelector(".msg").textContent = saved.message ?? (saved.count
      ? `Saved ${saved.count} points to ${saved.course} › ${saved.topic}`
      : `Saved to ${saved.course} › ${saved.topic}`);

    // Countdown that pauses while hovered (the bar pauses with it).
    let left = UNDO_MS, startedAt = Date.now(), timer = setTimeout(close, left);
    const toast = root.querySelector(".toast");
    toast.addEventListener("mouseenter", () => { clearTimeout(timer); left -= Date.now() - startedAt; });
    toast.addEventListener("mouseleave", () => { startedAt = Date.now(); timer = setTimeout(close, Math.max(left, 800)); });

    function close() {
      clearTimeout(timer);
      document.removeEventListener("keydown", onKey, true);
      host.remove();
      if (undoToast?.host === host) undoToast = null;
    }

    function undo() {
      close();
      habit("undo-save");
      if (saved.onUndo) { try { saved.onUndo(); } catch (_) {} return; }
      try {
        (saved.ids || [saved.id]).forEach((id) =>
          chrome.runtime.sendMessage({ type: "DELETE_HIGHLIGHT", id, courseName: saved.course, topicName: saved.topic }));
      } catch (_) { /* extension reloaded: nothing to reach */ }
    }

    // Ctrl/⌘+Z undoes, unless the page's own undo is wanted (typing somewhere).
    function onKey(e) {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== "z") return;
      const t = document.activeElement;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      undo();
    }

    root.querySelector("button").addEventListener("click", undo);
    document.addEventListener("keydown", onKey, true);
    (document.body || document.documentElement).appendChild(host);
    undoToast = { host, cancel: close };
  }

  // ---------------------------------------------------------------------------
  // Drag to the side panel
  // ---------------------------------------------------------------------------
  // Selected text dropped on the side panel's Study tab is saved like a
  // highlight. A drop only carries the text, so note where it came from in
  // storage ("lastDrag"): the panel can read that whichever site the text was
  // dragged from, and matches it to the dropped text.

  function handleDragStart(event) {
    if (dead || shutDownIfOrphaned()) return;

    const selection = window.getSelection();
    const text = selection?.toString().trim();
    if (!text || selection.rangeCount === 0) return;

    // Dragging the selection itself, not a link or image somewhere else.
    if (event.dataTransfer?.types?.includes("text/uri-list")) return;
    const range = selection.getRangeAt(0);
    if (!(event.target instanceof Node) || !range.intersectsNode(event.target)) return;

    const el   = findContextElement(selection.anchorNode);
    const host = globalThis.LazyNotesHost;
    const lastDrag = {
      text,
      sourceUrl:   host?.sourceUrl   ? host.sourceUrl(el)   : window.location.href,
      sourceTitle: host?.sourceTitle ? host.sourceTitle(el) : document.title || null,
      context:     host?.contextFor  ? host.contextFor(el)  : el?.textContent ?? null,
      anchor:      host?.anchorFor   ? host.anchorFor(range) : null,
      at:          Date.now()
    };

    try {
      storageSet({ lastDrag });
    } catch (_) { /* extension reloaded: the panel falls back to the bare text */ }

    // The save popup for this selection would be left behind; hide it but
    // keep the selection, since that's what is being dragged.
    if (popupContainer && popupContainer.style.display !== "none") {
      popupContainer.style.display = "none";
      if (sideBox) sideBox.style.display = "none";
      allMenus().forEach((m) => m.classList.remove("open"));
    }
  }

  document.addEventListener("dragstart", handleDragStart, true);

  // ---------------------------------------------------------------------------
  // Message listener
  // ---------------------------------------------------------------------------

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (dead) return;
    if (message.type === "LAZY_NOTES_PING") {
      sendResponse(true);
      return;
    }

    if (message.type === "TOGGLE_HIGHLIGHTER") {
      highlighterActive = message.active;

      if (message.activeCourse !== undefined) currentCourse = message.activeCourse;
      if (message.activeTopic  !== undefined) {
        currentTopic  = message.activeTopic;
        lastUsedTopic = message.activeTopic;
      }

      if (!highlighterActive) {
        currentTopic  = null;
        lastUsedTopic = null;
      }

      if (highlighterActive) activateHighlighter();
      else deactivateHighlighter();
      return;
    }

    if (message.type === "ACTIVE_COURSE_CHANGED") {
      currentCourse = message.activeCourse ?? currentCourse;
      currentTopic  = null;
      lastUsedTopic = null;
      return;
    }
  });

  // ---------------------------------------------------------------------------
  // Storage sync — keep courseTree fresh without background having to push it
  // ---------------------------------------------------------------------------

  onStorageChanged((changes, areaName) => {
    if (dead) return;
    if (areaName !== "local") return;
    if (changes.lazynotes) {
      courseTree = changes.lazynotes.newValue?.courses || {};
    }
    if (changes.lnPopupSide) popupSide = changes.lnPopupSide.newValue || "above";
    if (changes.lnQuickSelButtons) handoffOn = changes.lnQuickSelButtons.newValue !== false;
    if (changes.lnDropPageNums) pageNumOn = changes.lnDropPageNums.newValue !== false;
    if (changes.lnDupWarn) dupWarnOn = changes.lnDupWarn.newValue !== false;
    if (changes.lnSaveToast) saveToast = changes.lnSaveToast.newValue || "small";
    if (changes.lnHeadSplit) headSplitOn = changes.lnHeadSplit.newValue !== false;
    if (changes.lnListHeadType) { listHeadOn = changes.lnListHeadType.newValue !== false; showListHeadChip(); }

    // Storage is the source of truth for on/off: extension pages (the PDF
    // reader) never get the background's tab broadcasts, and this also covers
    // a broadcast that was missed.
    if (changes.activeCourse) currentCourse = changes.activeCourse.newValue ?? null;
    if (changes.activeTopic) {
      currentTopic  = changes.activeTopic.newValue ?? null;
      lastUsedTopic = currentTopic;
    }
    if (changes.highlighterActive) {
      highlighterActive = changes.highlighterActive.newValue ?? false;
      if (highlighterActive) activateHighlighter();
      else deactivateHighlighter();
    }
  });

  // ---------------------------------------------------------------------------
  // Re-injection
  // ---------------------------------------------------------------------------
  // When the extension is reloaded, the copy already running in an open tab is
  // cut off from it (saves would fail) and the background injects a fresh copy.
  // The new copy tells the old one to remove itself; the old one also checks
  // on each mouseup/keydown in case it never got the signal.

  const instanceId = newId();
  let dead = false;  // set once this copy has been replaced; every entry point checks it

  function tearDown() {
    dead = true;
    deactivateHighlighter();
    popupContainer?.remove();
    popupContainer = null;
    sideBox?.remove();
    sideBox = null;
    document.removeEventListener(REINIT_EVENT, onReinit);
  }

  function shutDownIfOrphaned() {
    if (chrome.runtime?.id) return false;
    tearDown();
    return true;
  }

  function onReinit(event) {
    if (event.detail !== instanceId) tearDown();
  }

  document.addEventListener(REINIT_EVENT, onReinit);
  document.dispatchEvent(new CustomEvent(REINIT_EVENT, { detail: instanceId }));

  // A reader page's keyboard selection (the PDF reader's caret: Shift+arrows,
  // then Enter) opens the save pop-up just like letting go of the mouse.
  document.addEventListener("lazy-notes-keyboard-select", () => {
    if (dead || shutDownIfOrphaned() || !highlighterActive) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const text = selection.toString().trim();
    if (!text) return;
    const range = selection.getRangeAt(0);
    currentRange = range.cloneRange();
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    popupMouse = null;
    showPopup(rect, text, findContextElement(selection.anchorNode));
  });

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  function initializeScript() {
    if (dead) return;
    buildPopup();

    storageGet(
      ["lazynotes", "highlighterActive", "activeCourse", "activeTopic"],
      (result) => {
        courseTree       = result.lazynotes?.courses ?? {};
        highlighterActive = result.highlighterActive ?? false;
        currentCourse     = result.activeCourse ?? null;
        currentTopic      = result.activeTopic ?? null;
        lastUsedTopic     = currentTopic;

        if (highlighterActive) activateHighlighter();
      }
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeScript);
  } else {
    initializeScript();
  }

})();
