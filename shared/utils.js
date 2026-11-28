// Q-notes — Shared sort/filter helpers.
// Used by both sidepanel.js and viewer.js — do not duplicate this logic
// elsewhere.

// highlights: array of { id, text, category, timestamp, ... }
// by: "chronological" | "category" | "date"
// Where a note sits in its topic: its own "order" once moved (Study tab
// drag / Alt+arrows), else its time, so untouched notes keep time order.
function noteOrder(n) {
  return typeof n.order === "number" ? n.order : (Date.parse(n.timestamp) || 0);
}

function sortHighlights(highlights, by) {
  const list = [...highlights];

  if (by === "chronological") {
    return list.sort((a, b) => noteOrder(a) - noteOrder(b));
  }

  if (by === "category") {
    return list.sort((a, b) => {
      if (a.category === b.category) {
        return new Date(a.timestamp) - new Date(b.timestamp);
      }
      return a.category.localeCompare(b.category);
    });
  }

  if (by === "date") {
    return list.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  return list;
}

// topics: array of { name, created, highlightCount, ... }
// by: "chronological" | "name" | "highlights"
function sortTopics(topics, by) {
  const list = [...topics];

  if (by === "chronological") {
    return list.sort((a, b) => new Date(a.created) - new Date(b.created));
  }

  if (by === "name") {
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }

  if (by === "highlights") {
    return list.sort((a, b) => (b.highlightCount ?? 0) - (a.highlightCount ?? 0));
  }

  return list;
}

// A typed note's text as blocks: lines starting with ">" are quotes, the
// rest is the note's own words. Consecutive lines of the same kind stay
// together. "a\n> b\n> c\nd" -> [{quote:false,text:"a"}, {quote:true,
// text:"b\nc"}, {quote:false,text:"d"}]. Used to show and export notes.
function typedNoteBlocks(text) {
  const blocks = [];
  String(text ?? "").split("\n").forEach((line) => {
    const quote = /^>/.test(line);
    const content = quote ? line.replace(/^>\s?/, "") : line;
    const last = blocks[blocks.length - 1];
    if (last && last.quote === quote) last.text += "\n" + content;
    else blocks.push({ quote, text: content });
  });
  return blocks
    .map((b) => ({ quote: b.quote, text: b.text.replace(/^(\s*\n)+/, "").replace(/\s+$/, "") }))
    .filter((b) => b.text.trim() !== "");
}

// ---------------------------------------------------------------------------
// Typed notes: light formatting, written the way people already type it
//   # Heading   ## Sub heading   - point / * point / • point   1. point
//   indent points with 2 spaces   **bold**  *italic*  ==highlight==
//   > quote   (blank line = new paragraph)
// Returns safe HTML (everything is escaped first). Used by the Study tab,
// All notes and the HTML export.
// ---------------------------------------------------------------------------
function typedNoteHtml(text) {
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const inline = (s) => esc(s)
    .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, "<strong>$1</strong>")
    .replace(/==(?=\S)(.+?)(?<=\S)==/g, "<mark>$1</mark>")
    .replace(/(^|[^*\w])\*(?=\S)([^*]+?)(?<=\S)\*(?!\w)/g, "$1<em>$2</em>")
    .replace(/(^|[^_\w])_(?=\S)([^_]+?)(?<=\S)_(?!\w)/g, "$1<em>$2</em>");

  const out = [];
  let para = [];      // plain lines of the current paragraph
  let quote = [];
  let list = null;    // { tag, items: [{ level, html, n }] }

  const flushPara  = () => { if (para.length) out.push(`<p>${para.map(inline).join("<br>")}</p>`); para = []; };
  const flushQuote = () => { if (quote.length) out.push(`<blockquote>${quote.map(inline).join("<br>")}</blockquote>`); quote = []; };
  const flushList  = () => {
    if (!list) return;
    out.push(`<${list.tag} class="tn-list">` + list.items.map((it) =>
      `<li style="--lvl:${it.level}"${it.n != null ? ` value="${it.n}"` : ""}>${it.html}</li>`).join("") + `</${list.tag}>`);
    list = null;
  };
  const flushAll = () => { flushPara(); flushQuote(); flushList(); };

  String(text ?? "").split("\n").forEach((raw) => {
    const line = raw.replace(/\s+$/, "");
    let m;
    // A blank line keeps its room: one empty line typed = one empty line
    // shown (the notes sit tight, so without this blocks ran together).
    if (!line.trim()) { flushAll(); out.push('<div class="tn-blank"></div>'); return; }
    if ((m = line.match(/^>\s?(.*)$/))) { flushPara(); flushList(); quote.push(m[1]); return; }
    flushQuote();
    if ((m = line.match(/^(#{1,3})\s+(.+)$/))) {
      flushAll();
      out.push(`<div class="tn-h tn-h${m[1].length}">${inline(m[2])}</div>`);
      return;
    }
    if ((m = line.match(/^(\s*)([-*•]|\d+[.)])\s+(.+)$/))) {
      flushPara();
      const tag = /\d/.test(m[2]) ? "ol" : "ul";
      if (list && list.tag !== tag && Math.floor(m[1].length / 2) === 0) flushList();
      if (!list) list = { tag, items: [] };
      list.items.push({ level: Math.min(4, Math.floor(m[1].replace(/\t/g, "  ").length / 2)), html: inline(m[3]),
                        n: tag === "ol" ? parseInt(m[2], 10) : null });
      return;
    }
    // A plain line right under a point continues that point.
    if (list && /^\s+/.test(raw)) { list.items[list.items.length - 1].html += "<br>" + inline(line.trim()); return; }
    flushList();
    para.push(line);
  });
  flushAll();
  while (out[0] === '<div class="tn-blank"></div>') out.shift();
  while (out[out.length - 1] === '<div class="tn-blank"></div>') out.pop();
  return out.join("");
}

// The documents (PDF, slides, Word) a course's notes came from, newest
// first: [{ key, name, kind, open, notes, lastAt, topics: Set }].
// From each note's link (reader pages and .pdf/.pptx/.docx links), plus
// recently opened documents that were set to this course (lnDocs).
// `hidden` = keys the user removed from this course (lnCourseDocHide[course]);
// their notes are untouched, the document just stops being listed there.
function courseDocuments(courseName, course, lnDocs = {}, hidden = []) {
  const docs = new Map();
  const readerUrl = (p, q) => (globalThis.chrome?.runtime?.getURL ? chrome.runtime.getURL(`${p}?${q}`) : `${p}?${q}`);
  const kindOf = (u) => /pptxreader|\.pptx(\?|#|$)/i.test(u) ? "pptx" : /docxreader|\.docx(\?|#|$)/i.test(u) ? "docx"
    : /pdfreader|\.pdf(\?|#|$)/i.test(u) ? "pdf" : null;
  const add = (url, title, when, topic, notes = 1) => {
    if (!url) return;
    const kind = kindOf(url);
    if (!kind) return;                      // a web page, not a document
    const key = url.split("#")[0];
    let open = key;
    if (!/^chrome-extension:/.test(key) && !/reader\.html/.test(key)) {
      open = readerUrl(`${kind}reader.html`, `url=${encodeURIComponent(key)}`);
    }
    const d = docs.get(key) || { key, kind, open, name: "", notes: 0, lastAt: 0, topics: new Set() };
    const name = String(title || "").replace(/,\s*(page|slide|p\.)\s*\d+\s*$/i, "").trim();
    if (name && (!d.name || name.length < d.name.length)) d.name = name;
    d.notes += notes;
    d.lastAt = Math.max(d.lastAt, when || 0);
    if (topic) d.topics.add(topic);
    docs.set(key, d);
  };
  Object.entries(course?.topics || {}).forEach(([topicName, t]) =>
    Object.values(t.highlights || {}).forEach((h) => add(h.sourceUrl, h.sourceTitle, Date.parse(h.timestamp) || 0, topicName)));
  // Opened in a reader and set to this course, maybe no notes yet. A web
  // PDF's reader link (?url=…) counts as the same document as its notes.
  Object.values(lnDocs).forEach((d) => {
    if (d.course !== courseName || !d.key) return;
    const q = new URLSearchParams(d.key.split("?")[1] || "");
    const url = q.get("url") || (globalThis.chrome?.runtime?.getURL ? chrome.runtime.getURL(d.key.replace(/^\//, "")) : d.key);
    add(url, d.name, d.openedAt, d.topic, 0);
  });
  return [...docs.values()]
    .filter((d) => !hidden.includes(d.key))     // "Remove from this course" (notes stay)
    .map((d) => ({ ...d, name: d.name || decodeURIComponent(d.key.split(/[/?=]/).pop() || "Document") }))
    .sort((a, b) => b.lastAt - a.lastAt);
}

// Remove a document from a course's list (the notes stay where they are).
async function hideCourseDoc(courseName, key) {
  const { lnCourseDocHide = {} } = await chrome.storage.local.get("lnCourseDocHide");
  const list = new Set(lnCourseDocHide[courseName] || []);
  list.add(key);
  lnCourseDocHide[courseName] = [...list];
  await chrome.storage.local.set({ lnCourseDocHide });
}

// Rename a course or topic: asks for the new name, then the background does it
// (same notes, new name; the active course/topic and saved documents follow).
// message: { type: "RENAME_COURSE", courseName } or { type: "RENAME_TOPIC", courseName, topicName }
function lnRenamePrompt(message, current) {
  const next = prompt(message.type === "RENAME_COURSE" ? "Rename course" : "Rename topic", current);
  if (next === null) return;
  if (!next.trim() || next.trim() === current) return;
  chrome.runtime.sendMessage({ ...message, newName: next }, (reply) => {
    if (chrome.runtime.lastError || !reply?.ok) alert(`Couldn't rename: ${reply?.reason || chrome.runtime.lastError?.message || "unknown error"}`);
    // On success the storage listener redraws.
  });
}
