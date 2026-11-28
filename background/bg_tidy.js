// QNotes — bring old notes up to date with what new saves get.
//
// Highlights saved before 2.0 kept PDF line breaks in the middle of
// sentences ("…the concentration\ngradients that…"). New saves join them
// (content.js joinBrokenLines). This runs once (lnTidyDone = 1) and does the
// same to every old highlight:
//   • only highlights from a page or document (typed notes, and notes typed
//     in a note box but saved as a type, keep the lines you typed), not figures;
//   • lists stay lists: lines that start with a bullet or number are kept;
//   • the words as they were are kept on the note (textBefore), so
//     "Undo tidy" in Settings › More options puts every one of them back.
// The result is saved in lnTidyLog { at, count }.

import { storageGet, storageSet } from './bg_storage.js';

const TIDY_VERSION = 2;   // 2: notes typed in the note box are never tidied (and v1's are put back)

// Same rules as content.js joinBrokenLines / rich-box.js cleanPdfText.
const BULLET_RE = /^\s*[•●○◦▪■□►▸▹➢➤✓✔·]\s*/;
const POINT_RE = /^\s*([-*]|\d{1,2}[.)]|[a-z][.)])\s+/i;
export function joinBrokenLines(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n").map((l) => l.replace(/\s+$/, ""));
  if (lines.length < 2) return lines.join("");
  const out = [];
  lines.forEach((l) => {
    if (!l.trim()) { out.push(""); return; }
    const prev = out[out.length - 1];
    const startsPoint = POINT_RE.test(l) || BULLET_RE.test(l);
    if (prev && !startsPoint && !/[.!?:;]["')\]]?$/.test(prev) && prev.length > 25) {
      out[out.length - 1] = /[A-Za-z]-$/.test(prev) && /^[a-z]/.test(l.trim())
        ? prev.slice(0, -1) + l.trim()
        : `${prev} ${l.trim()}`;
    } else out.push(l.trim());
  });
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

function eachHighlight(lazynotes, fn) {
  Object.values(lazynotes?.courses || {}).forEach((c) =>
    Object.values(c.topics || {}).forEach((t) =>
      Object.values(t.highlights || {}).forEach(fn)));
}

export async function tidyOldNotes({ force = false } = {}) {
  const { lnTidyDone, lazynotes } = await storageGet(["lnTidyDone", "lazynotes"]);
  if (!lazynotes || (!force && lnTidyDone >= TIDY_VERSION)) return 0;
  let count = 0;
  // Typed in a note box and saved as a type (no page it came from): the
  // lines are yours. Put back any that version 1 joined.
  const typedHere = (h) => !h.sourceUrl && !h.anchor;
  eachHighlight(lazynotes, (h) => {
    if (typedHere(h) && h.textBefore !== undefined) {
      if (joinBrokenLines(h.textBefore) === h.text) h.text = h.textBefore;
      delete h.textBefore;
      count++;
    }
  });
  eachHighlight(lazynotes, (h) => {
    if (typedHere(h)) return;
    if (h.category === "figure" || typeof h.text !== "string" || !h.text.includes("\n")) return;
    const joined = joinBrokenLines(h.text);
    if (joined === h.text) return;
    if (h.textBefore === undefined) h.textBefore = h.text;
    h.text = joined;
    count++;
  });
  const items = { lnTidyDone: TIDY_VERSION };
  if (count) {
    items.lazynotes = lazynotes;
    items.lnTidyLog = { at: Date.now(), count };
  }
  await storageSet(items);
  return count;
}

// Undo: every tidied note gets its words back (unless you've edited it
// since — then your edit stays).
export async function undoTidy() {
  const { lazynotes } = await storageGet("lazynotes");
  let count = 0;
  eachHighlight(lazynotes, (h) => {
    if (h.textBefore === undefined) return;
    if (joinBrokenLines(h.textBefore) === h.text) { h.text = h.textBefore; count++; }
    delete h.textBefore;
  });
  await storageSet({ lazynotes, lnTidyLog: { at: Date.now(), count: 0, undone: count } });
  return count;
}

chrome.runtime.onInstalled.addListener(() => { tidyOldNotes().catch((e) => console.warn("LazyNotes: tidy failed", e)); });
chrome.runtime.onStartup.addListener(() => { tidyOldNotes().catch(() => {}); });
