// Lazy Notes — Word (.docx) reader
// Shows a Word document as white pages of text: headings, paragraphs with
// light formatting, lists, tables and pictures (docx-parse.js reads the
// file). Pages follow the document's own page breaks. content.js, loaded by
// the page, does the highlighting exactly as on websites; docxreader-host.js
// tells it which document and page a note came from. Works like the slides
// reader (pptxreader.js).
//
// Opened as:
//   docxreader.html?url=<docx url>   a document on the web
//   docxreader.html?local=<id>       a file from this computer, kept in IndexedDB
// with an optional #page=N. Without either it goes to the document reader's
// start page (pdfreader.html), the one start page for every kind of file.

import { readDocx } from "./docx-parse.js";

const $ = (id) => document.getElementById(id);

const viewerEl     = $("viewer");
const messageEl    = $("message");
const docTitleEl   = $("doc-title");
const pageControls = $("page-controls");
const pageInput    = $("page-input");
const pageCountEl  = $("page-count");
const hlToggle     = $("hl-toggle");
const hlStatus     = $("hl-status");

const D = globalThis.LazyDocx;

let doc         = null;   // { pages } from readDocx
let pageEls     = [];     // <section class="doc-page"> per page
let currentPage = 1;
let imageUrls   = [];

// ---------------------------------------------------------------------------
// Local files — kept in IndexedDB so a reload or a note's link
// (docxreader.html?local=<id>) can reopen them. Same scheme as the other
// readers, in a database of its own.
// ---------------------------------------------------------------------------

const DB_NAME   = "lazynotes-docs";
const STORE     = "files";
const MAX_FILES = 20;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function dbRun(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const result = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(result?.result ?? result);
    tx.onerror    = () => reject(tx.error);
  });
}

const getLocalFile   = (id) => dbRun("readonly", (s) => s.get(id));
const listLocalFiles = async () =>
  ((await dbRun("readonly", (s) => s.getAll())) || []).sort((a, b) => b.openedAt - a.openedAt);

async function saveLocalFile(file) {
  const existing = (await listLocalFiles()).find((f) => f.name === file.name && f.size === file.size);
  const record = { id: existing?.id ?? crypto.randomUUID(), name: file.name, size: file.size, data: file, openedAt: Date.now() };
  await dbRun("readwrite", (s) => s.put(record));
  const all = await listLocalFiles();
  if (all.length > MAX_FILES) await dbRun("readwrite", (s) => all.slice(MAX_FILES).forEach((f) => s.delete(f.id)));
  return record;
}

const touchLocalFile = (record) => dbRun("readwrite", (s) => s.put({ ...record, openedAt: Date.now() }));

// ---------------------------------------------------------------------------
// Opening documents
// ---------------------------------------------------------------------------

function fileNameFromUrl(url) {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop();
    return decodeURIComponent(last || url);
  } catch (_) {
    return url;
  }
}

function pageFromHash() {
  const m = location.hash.match(/page=(\d+)/);
  return m ? Number(m[1]) : 1;
}

async function openFromUrl(url) {
  showMessage("Loading…");
  let data;
  try {
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) throw new Error(`the server answered ${res.status}`);
    data = await res.arrayBuffer();
  } catch (err) {
    showMessage(url.startsWith("file:")
      ? "Chrome blocked this local file. Either choose it with Open, or turn on " +
        "“Allow access to file URLs” for Lazy Notes in chrome://extensions."
      : `Couldn't download the document (${err.message}).`, true);
    return showStartScreen();
  }
  const clean = url.split("#")[0];
  D.source = { kind: "url", url: clean, name: fileNameFromUrl(clean) };
  await loadDoc(data, D.source.name);
}

async function openLocalRecord(record) {
  D.source = { kind: "local", id: record.id, name: record.name };
  await touchLocalFile(record);
  await loadDoc(await record.data.arrayBuffer(), record.name);
}

async function openPickedFile(file) {
  if (!file) return;
  if (/\.doc$/i.test(file.name)) {
    showMessage("Old .doc files can't be read: open it in Word or Google Docs and save as .docx or PDF.", true);
    return;
  }
  if (!/\.docx$/i.test(file.name)) {
    // Not a Word file: the document reader's start page knows the rest.
    location.href = "pdfreader.html";
    return;
  }
  const record = await saveLocalFile(file);
  history.replaceState(null, "", `?local=${encodeURIComponent(record.id)}`);
  await openLocalRecord(record);
}

async function loadDoc(data, name) {
  showMessage("Loading…");
  try {
    doc = await readDocx(data);
  } catch (err) {
    doc = null;
    // An unreadable file from this computer isn't kept in Recent.
    if (D.source?.kind === "local") await dbRun("readwrite", (st) => st.delete(D.source.id)).catch(() => {});
    showMessage(`Couldn't read this document (${err.message}).`, true);
    return showStartScreen();
  }

  document.title = `${name} — Lazy Notes`;
  docTitleEl.textContent = name;
  docTitleEl.title = name;
  D.pageCount = doc.pages.length;

  pageControls.hidden = doc.pages.length < 2;
  hideMessage();

  renderDoc();
  await loadDocNotes();
  goToPage(pageFromHash(), false);
  LazyDocs.opened({ kind: "docx", name, pages: doc.pages.length, page: currentPage });
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

function renderDoc() {
  imageUrls.forEach((u) => URL.revokeObjectURL(u));
  imageUrls = [];
  viewerEl.replaceChildren();

  pageEls = doc.pages.map((page) => {
    const el = document.createElement("section");
    el.className = "doc-page";
    el.id = `page-${page.number}`;
    el.dataset.page = String(page.number);

    // Everything a note can be taken from sits in .page-body (the host
    // bridge looks for it); the page label stays outside.
    const body = document.createElement("div");
    body.className = "page-body";
    renderBlocks(page.blocks).forEach((b) => body.appendChild(b));
    el.appendChild(body);

    if (doc.pages.length > 1) {
      const label = document.createElement("div");
      label.className = "page-label";
      label.textContent = `Page ${page.number}`;
      el.appendChild(label);
    }
    viewerEl.appendChild(el);
    return el;
  });

  pageCountEl.textContent = `of ${doc.pages.length}`;
}

// Runs → text with light formatting; "\n" is a line break, a tab a space.
function withRuns(el, runs) {
  runs.forEach((run) => {
    if (run.text === "\n") { el.appendChild(document.createElement("br")); return; }
    const text = run.text.replace(/\t/g, "  ");
    if (!run.b && !run.i && !run.u) { el.appendChild(document.createTextNode(text)); return; }
    const tag = run.b ? "strong" : run.i ? "em" : "span";
    const span = document.createElement(tag);
    span.textContent = text;
    if (run.b && run.i) span.style.fontStyle = "italic";
    if (run.u) span.style.textDecoration = "underline";
    el.appendChild(span);
  });
  return el;
}

// Blocks → elements; consecutive list paragraphs become one <ul>/<ol> with
// nested levels, markers drawn from the document's own numbering.
function renderBlocks(blocks) {
  const out = [];
  let list = null;   // { root, stack: [{ el, level }] }

  const endList = () => { list = null; };

  blocks.forEach((b) => {
    if (b.kind === "para" && b.list) {
      const li = withRuns(document.createElement("li"), b.runs);
      li.dataset.marker = b.list.marker;
      if (!b.list.marker) li.classList.add("no-marker");
      if (!list) {
        const root = document.createElement("ul");
        root.className = "d-list";
        out.push(root);
        list = { stack: [{ el: root, level: b.list.level }] };
      }
      let top = list.stack[list.stack.length - 1];
      while (list.stack.length > 1 && b.list.level < top.level) { list.stack.pop(); top = list.stack[list.stack.length - 1]; }
      if (b.list.level > top.level) {
        const sub = document.createElement("ul");
        sub.className = "d-list";
        (top.el.lastElementChild || top.el).appendChild(sub);
        list.stack.push({ el: sub, level: b.list.level });
        top = list.stack[list.stack.length - 1];
      }
      top.el.appendChild(li);
      return;
    }
    endList();

    switch (b.kind) {
      case "heading": {
        const h = withRuns(document.createElement(`h${Math.min(6, b.level + 1)}`), b.runs);
        h.className = `d-h d-h${b.level}`;
        out.push(h);
        break;
      }
      case "para": {
        const p = withRuns(document.createElement("p"), b.runs);
        p.className = "d-p";
        if (b.align) p.style.textAlign = b.align;
        out.push(p);
        break;
      }
      case "table": {
        const table = document.createElement("table");
        table.className = "d-table";
        b.rows.forEach((row) => {
          const tr = table.insertRow();
          row.forEach((cell) => {
            const td = tr.insertCell();
            if (cell.colSpan > 1) td.colSpan = cell.colSpan;
            cell.paras.forEach((runs, i) => {
              if (i) td.appendChild(document.createElement("br"));
              withRuns(td, runs);
            });
          });
        });
        out.push(table);
        break;
      }
      case "image": {
        const fig = document.createElement("figure");
        fig.className = "d-figure";
        const img = document.createElement("img");
        const url = URL.createObjectURL(b.blob);
        imageUrls.push(url);
        img.src = url;
        img.alt = b.alt;
        img.loading = "lazy";
        fig.appendChild(img);
        out.push(fig);
        break;
      }
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Saved highlights — notes taken from this document, marked on their pages
// ---------------------------------------------------------------------------
// A note belongs here if its link is this reader's link for the same file
// (same ?url= or ?local=). Its page is anchor.page or the #page=N in the
// link; its spot is found by searching that page's text, with
// anchor.occurrence picking between repeats. Drawn with the CSS Custom
// Highlight API, so the page's DOM (and selecting text) is untouched.

const HIGHLIGHT_NAME = "lazy-notes-saved";
let docNotes = [];                  // [{ id, text, page, occurrence }]
let showHighlights = true;
try { showHighlights = localStorage.getItem("ln-show-highlights") !== "0"; } catch (_) {}

function noteBelongsHere(note) {
  const src = D.source;
  if (!note.sourceUrl || !src) return false;
  try {
    const u = new URL(note.sourceUrl);
    if (!u.pathname.endsWith("/docxreader.html")) return false;
    return src.kind === "url" ? u.searchParams.get("url") === src.url : u.searchParams.get("local") === src.id;
  } catch (_) {
    return false;
  }
}

function pageOfNote(note) {
  if (note.anchor?.page) return note.anchor.page;
  const m = String(note.sourceUrl).match(/#page=(\d+)/);
  return m ? Number(m[1]) : 1;
}

async function loadDocNotes() {
  const { lazynotes } = await chrome.storage.local.get("lazynotes");
  setDocNotes(lazynotes?.courses ?? {});
}

function setDocNotes(courses) {
  const found = [];
  Object.values(courses).forEach((course) =>
    Object.values(course.topics || {}).forEach((topic) =>
      Object.entries(topic.highlights || {}).forEach(([id, n]) => {
        if (!noteBelongsHere(n)) return;
        found.push({ id, text: n.text, page: pageOfNote(n), occurrence: n.anchor?.occurrence ?? 0 });
      })
    )
  );
  docNotes = found;
  updateHighlightToggle();
  paintHighlights();
}

function nthIndexOf(hay, needle, n) {
  let i = hay.indexOf(needle);
  const first = i;
  for (let k = 0; k < n && i !== -1; k++) i = hay.indexOf(needle, i + 1);
  return i !== -1 ? i : first;
}

function paintHighlights() {
  if (!globalThis.Highlight || !CSS.highlights) return;
  CSS.highlights.delete(HIGHLIGHT_NAME);
  if (!showHighlights || !doc || !docNotes.length) return;

  const ranges = [];
  const indexes = new Map();
  docNotes.forEach((n) => {
    const body = pageEls[n.page - 1]?.querySelector(".page-body");
    if (!body) return;
    if (!indexes.has(n.page)) indexes.set(n.page, D.indexText(body));
    const { text, chars } = indexes.get(n.page);
    const needle = D.squash(n.text);
    const at = needle ? nthIndexOf(text, needle, n.occurrence) : -1;
    if (at === -1) return;   // edited since: nothing to mark
    const start = chars[at], end = chars[at + needle.length - 1];
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset + 1);
    ranges.push(range);
  });
  if (ranges.length) CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges));
}

function updateHighlightToggle() {
  hlToggle.hidden = docNotes.length === 0;
  hlToggle.textContent = `${docNotes.length} highlight${docNotes.length === 1 ? "" : "s"}`;
  hlToggle.setAttribute("aria-pressed", String(showHighlights));
  hlToggle.classList.toggle("off", !showHighlights);
  hlToggle.title = showHighlights ? "Hide saved highlights" : "Show saved highlights";
}

hlToggle.addEventListener("click", () => {
  showHighlights = !showHighlights;
  try { localStorage.setItem("ln-show-highlights", showHighlights ? "1" : "0"); } catch (_) {}
  updateHighlightToggle();
  paintHighlights();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.lazynotes || !doc) return;
  setDocNotes(changes.lazynotes.newValue?.courses ?? {});
});

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

let jumpingUntil = 0;

function goToPage(n, smooth = true) {
  if (!doc) return;
  n = Math.min(doc.pages.length, Math.max(1, n));
  jumpingUntil = performance.now() + (smooth ? 900 : 200);
  if (n > 1 || window.scrollY > 0) pageEls[n - 1].scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
  setCurrentPage(n);
  history.replaceState(null, "", `${location.search}#page=${n}`);
}

function setCurrentPage(n) {
  currentPage = n;
  LazyDocs.page(n);
  if (document.activeElement !== pageInput) pageInput.value = String(n);
}

// Current page = the one under a line a third of the way down the window.
let scrollRaf = null;
window.addEventListener("scroll", () => {
  if (scrollRaf || !doc || performance.now() < jumpingUntil) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = null;
    const line  = window.innerHeight / 3;
    const atEnd = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
    const hit = atEnd
      ? pageEls.findLast((el) => el.getBoundingClientRect().top < window.innerHeight - 40)
      : pageEls.find((el) => { const r = el.getBoundingClientRect(); return r.top <= line && r.bottom + 24 >= line; });
    const n = hit ? Number(hit.dataset.page) : null;
    if (n && n !== currentPage) {
      setCurrentPage(n);
      history.replaceState(null, "", `${location.search}#page=${n}`);
    }
  });
});

pageInput.addEventListener("change", () => {
  const n = parseInt(pageInput.value, 10);
  if (Number.isFinite(n)) goToPage(n);
  else pageInput.value = String(currentPage);
});
pageInput.addEventListener("focus", () => pageInput.select());
$("prev-page").addEventListener("click", () => goToPage(currentPage - 1));
$("next-page").addEventListener("click", () => goToPage(currentPage + 1));

// ---------------------------------------------------------------------------
// Start page, opening, dropping
// ---------------------------------------------------------------------------

// One start page for every kind of file: the document reader's. Any message
// (e.g. "Couldn't read this document") goes along to show there.
function showStartScreen() {
  const msg = messageEl.hidden ? "" : messageEl.textContent;
  location.replace("pdfreader.html" + (msg ? `?msg=${encodeURIComponent(msg)}` : ""));
}

$("open-btn").addEventListener("click", () => { location.href = "pdfreader.html"; });

["dragenter", "dragover"].forEach((type) =>
  document.addEventListener(type, (e) => {
    if ([...(e.dataTransfer?.types || [])].includes("Files")) e.preventDefault();
  })
);
document.addEventListener("drop", (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  e.preventDefault();
  openPickedFile(file);
});

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

function showMessage(text, isError = false) {
  messageEl.textContent = text;
  messageEl.classList.toggle("error", isError);
  messageEl.hidden = false;
}

function hideMessage() { messageEl.hidden = true; }

// ---------------------------------------------------------------------------
// Highlighter status chip — says where a selection will be saved
// ---------------------------------------------------------------------------

async function updateHighlighterStatus() {
  const { highlighterActive = false, activeCourse = null, activeTopic = null } =
    await chrome.storage.local.get(["highlighterActive", "activeCourse", "activeTopic"]);
  const on = highlighterActive && activeCourse && activeTopic;
  hlStatus.classList.toggle("on", !!on);
  hlStatus.textContent = on ? `Saving to ${activeCourse} › ${activeTopic}` : "Highlighter off";
  hlStatus.title = on
    ? "Select text to save it. Click to open the side panel."
    : "Pick a topic in the side panel to start saving notes. Click to open it.";
}

hlStatus.addEventListener("click", async () => {
  try {
    const win = await chrome.windows.getCurrent();
    await chrome.sidePanel.open({ windowId: win.id });
  } catch (_) { /* older Chrome: use the toolbar icon */ }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.highlighterActive || changes.activeCourse || changes.activeTopic)) {
    updateHighlighterStatus();
  }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot() {
  updateHighlighterStatus();
  const params = new URLSearchParams(location.search);
  const url    = params.get("url");
  const local  = params.get("local");

  if (url) {
    await openFromUrl(url);
  } else if (local) {
    const record = await getLocalFile(local).catch(() => null);
    if (record) await openLocalRecord(record);
    else {
      showMessage("That file isn't on this computer any more — open it again to keep reading.", true);
      showStartScreen();
    }
  } else {
    showStartScreen();
  }
}

boot();
