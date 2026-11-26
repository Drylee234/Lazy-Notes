// Lazy Notes — PDF Reader
// Renders a PDF with PDF.js: a canvas per page plus PDF.js's transparent text
// layer on top, so text can be selected. content.js (loaded by the page) does
// the highlighting exactly as on websites; pdfreader-host.js tells it which
// PDF and page a note came from.
//
// Opened as:
//   pdfreader.html                  start screen (pick / drop / paste a link)
//   pdfreader.html?url=<pdf url>    a PDF on the web (or file:// if allowed)
//   pdfreader.html?local=<id>       a file from this computer, kept in IndexedDB
// with an optional #page=N.

import * as pdfjsLib from "../lib/pdfjs/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "lib/pdfjs/pdf.worker.min.mjs";

const PDF_OPTIONS = {
  cMapUrl:             "lib/pdfjs/cmaps/",
  cMapPacked:          true,
  standardFontDataUrl: "lib/pdfjs/standard_fonts/",
  isEvalSupported:     false   // extension pages don't allow eval anyway
};

const MIN_SCALE = 0.4;
const MAX_SCALE = 4;
const PAGE_GAP  = 16;

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);

const viewerEl     = $("viewer");
const startScreen  = $("start-screen");
const messageEl    = $("message");
const docTitleEl   = $("doc-title");
const pageControls = $("page-controls");
const pageInput    = $("page-input");
const pageCountEl  = $("page-count");
const zoomLabel    = $("zoom-label");
const fileInput    = $("file-input");
const dropZone     = $("drop-zone");
const urlForm      = $("url-form");
const urlInput     = $("url-input");
const hlStatus     = $("hl-status");

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let pdfDoc     = null;
let pages      = [];        // [{ num, el, baseViewport, rendered, renderTask }]
let scale      = 1;
// "width" / "page": follow the window (and the outline panel) when it
// resizes; null after a manual zoom. Remembered between documents.
let fitMode    = "width";
try { const m = localStorage.getItem("ln-pdf-fit"); if (m === "width" || m === "page") fitMode = m; } catch (_) {}
let observer   = null;
let currentPage = 1;

// ---------------------------------------------------------------------------
// Local files — kept in IndexedDB so a reload or a note's source link
// (pdfreader.html?local=<id>) can reopen them.
// ---------------------------------------------------------------------------

const DB_NAME   = "lazynotes-pdfs";
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

const getLocalFile  = (id) => dbRun("readonly", (s) => s.get(id));
const listLocalFiles = async () =>
  ((await dbRun("readonly", (s) => s.getAll())) || [])
    .sort((a, b) => b.openedAt - a.openedAt);

async function saveLocalFile(file) {
  // Same name + size = same file: reuse its id so old notes keep working.
  const existing = (await listLocalFiles()).find(
    (f) => f.name === file.name && f.size === file.size
  );
  const record = {
    id:       existing?.id ?? crypto.randomUUID(),
    name:     file.name,
    size:     file.size,
    data:     file,
    openedAt: Date.now()
  };
  await dbRun("readwrite", (s) => s.put(record));

  const all = await listLocalFiles();
  if (all.length > MAX_FILES) {
    await dbRun("readwrite", (s) => all.slice(MAX_FILES).forEach((f) => s.delete(f.id)));
  }
  return record;
}

async function touchLocalFile(record) {
  await dbRun("readwrite", (s) => s.put({ ...record, openedAt: Date.now() }));
}

async function deleteLocalFile(id) {
  await dbRun("readwrite", (s) => s.delete(id));
}

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

function initialPageFromHash() {
  const m = location.hash.match(/page=(\d+)/);
  return m ? Number(m[1]) : 1;
}

async function openFromUrl(url) {
  showMessage("Loading…");
  let data;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`the server answered ${res.status}`);
    data = await res.arrayBuffer();
  } catch (err) {
    if (url.startsWith("file:")) {
      showMessage(
        "Chrome blocked this local file. Either choose it with Open, or turn on " +
        "“Allow access to file URLs” for Lazy Notes in chrome://extensions.",
        true
      );
    } else {
      showMessage(`Couldn't download the PDF (${err.message}).`, true);
    }
    showStartScreen();
    return;
  }

  globalThis.LazyNotesReader.source = { kind: "url", url, name: fileNameFromUrl(url) };
  await loadDocument(data, fileNameFromUrl(url));
}

async function openLocalRecord(record) {
  globalThis.LazyNotesReader.source = { kind: "local", id: record.id, name: record.name };
  await touchLocalFile(record);
  await loadDocument(await record.data.arrayBuffer(), record.name);
}

// Slides and Word documents go to their own readers: the file is handed
// over through that reader's IndexedDB store (same extension origin), then
// opened there by id.
const OTHER_READERS = {
  pptx: { db: "lazynotes-slides", page: "pptxreader.html", tag: "PPT" },
  docx: { db: "lazynotes-docs",   page: "docxreader.html", tag: "DOC" }
};

async function openInSlidesReader(file, kind = "pptx") {
  const { db: dbName, page } = OTHER_READERS[kind];
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("files", { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
  const store = db.transaction("files").objectStore("files");
  const all = await new Promise((r) => { const q = store.getAll(); q.onsuccess = () => r(q.result || []); });
  const id = all.find((f) => f.name === file.name && f.size === file.size)?.id ?? crypto.randomUUID();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("files", "readwrite");
    tx.objectStore("files").put({ id, name: file.name, size: file.size, data: file, openedAt: Date.now() });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  location.href = `${page}?local=${encodeURIComponent(id)}`;
}

async function openPickedFile(file) {
  if (!file) return;
  if (/\.pptx$/i.test(file.name)) return openInSlidesReader(file, "pptx");
  if (/\.docx$/i.test(file.name)) return openInSlidesReader(file, "docx");
  if (/\.doc$/i.test(file.name)) {
    showMessage("Old .doc files can't be read: open it in Word or Google Docs and save as .docx or PDF.", true);
    return;
  }
  if (/\.ppt$/i.test(file.name)) {
    showMessage("Older .ppt files can't be read. Save it as .pptx (or PDF) in PowerPoint first.", true);
    return;
  }
  if (file.type && file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) {
    showMessage("That isn't a PDF.", true);
    return;
  }
  const record = await saveLocalFile(file);
  history.replaceState(null, "", `?local=${encodeURIComponent(record.id)}`);
  await openLocalRecord(record);
}

async function loadDocument(data, name) {
  showMessage("Loading…");
  try {
    pdfDoc?.destroy();
    pdfDoc = await pdfjsLib.getDocument({ data, ...PDF_OPTIONS }).promise;
  } catch (err) {
    showMessage(`Couldn't open this PDF (${err.message}).`, true);
    showStartScreen();
    return;
  }

  let title = name;
  try {
    const meta = await pdfDoc.getMetadata();
    const t = meta?.info?.Title?.trim();
    // Many PDFs carry junk titles like "Microsoft Word - lec3.docx"; only
    // prefer the metadata title when it looks like a real one.
    if (t && !/\.(docx?|pptx?|tex|dvi)$/i.test(t) && !/^untitled/i.test(t)) title = t;
  } catch (_) { /* no metadata */ }

  document.title = `${title} — Lazy Notes`;
  docTitleEl.textContent = title;
  docTitleEl.title = name;

  startScreen.hidden = true;
  pageControls.hidden = false;
  hideMessage();

  await loadDocNotes();
  await buildPages();
  goToPage(initialPageFromHash(), false);
  LazyDocs.opened({ kind: "pdf", name: title, pages: pdfDoc.numPages, page: currentPage });
  buildOutline();
}

// ---------------------------------------------------------------------------
// Outline — the PDF's bookmarks in a left panel (a page list if it has none).
// Open/closed is remembered. The section you're in is marked as you scroll.
// ---------------------------------------------------------------------------

const outlineEl   = $("outline");
const outlineList = $("outline-list");
const outlineBtn  = $("outline-btn");
let outlineItems  = [];   // [{ page, el }] in document order

async function destPage(dest) {
  try {
    const d = typeof dest === "string" ? await pdfDoc.getDestination(dest) : dest;
    if (!Array.isArray(d) || !d[0]) return null;
    const ref = d[0];
    return (typeof ref === "number" ? ref : await pdfDoc.getPageIndex(ref)) + 1;
  } catch (_) { return null; }
}

async function buildOutline() {
  outlineItems = [];
  outlineList.replaceChildren();
  let outline = null;
  try { outline = await pdfDoc.getOutline(); } catch (_) {}

  const makeItem = (title, page, depth, kids) => {
    const row = document.createElement("div");
    row.className = "ol-item";
    row.style.setProperty("--depth", String(depth));
    const line = document.createElement("div");
    line.className = "ol-line";
    const twisty = document.createElement("button");
    twisty.type = "button";
    twisty.className = "ol-twisty";
    twisty.tabIndex = -1;
    if (kids) {
      twisty.textContent = "▸";
      twisty.setAttribute("aria-label", "Show sub-sections");
      twisty.addEventListener("click", (e) => {
        e.stopPropagation();
        row.classList.toggle("open");
      });
    } else twisty.classList.add("none");
    const link = document.createElement("button");
    link.type = "button";
    link.className = "ol-link";
    const name = document.createElement("span");
    name.className = "ol-title";
    name.textContent = title || "(untitled)";
    link.appendChild(name);
    link.title = title || "";
    const num = document.createElement("span");
    num.className = "ol-page";
    num.textContent = page ? String(page) : "";
    link.appendChild(num);
    link.addEventListener("click", () => { if (page) goToPage(page); });
    line.append(twisty, link);
    row.appendChild(line);
    if (page) outlineItems.push({ page, el: row });
    return row;
  };

  async function addLevel(items, parent, depth) {
    for (const it of items) {
      const page = await destPage(it.dest);
      const row = makeItem(it.title, page, depth, it.items?.length);
      parent.appendChild(row);
      if (it.items?.length) {
        const kids = document.createElement("div");
        kids.className = "ol-kids";
        row.appendChild(kids);
        await addLevel(it.items, kids, depth + 1);
      }
    }
  }

  if (outline?.length) {
    outlineEl.querySelector(".outline-head").textContent = "Outline";
    await addLevel(outline, outlineList, 0);
    // Top level opens by default, like Chrome's viewer.
    outlineList.querySelectorAll(":scope > .ol-item").forEach((r) => r.classList.add("open"));
  } else {
    outlineEl.querySelector(".outline-head").textContent = "Pages";
    for (let n = 1; n <= pdfDoc.numPages; n++) outlineList.appendChild(makeItem(`Page ${n}`, n, 0, 0));
  }
  outlineItems.sort((a, b) => a.page - b.page);
  outlineBtn.hidden = false;
  let open = false;
  try { open = localStorage.getItem("ln-pdf-outline") === "1"; } catch (_) {}
  setOutlineOpen(open, { refit: open });
  markOutline(currentPage);
}

function setOutlineOpen(open, { refit: doRefit = true } = {}) {
  document.documentElement.style.setProperty("--toolbar-h", `${toolbarHeight()}px`);
  outlineEl.hidden = !open;
  document.body.classList.toggle("outline-open", open);
  outlineBtn.setAttribute("aria-pressed", String(open));
  outlineBtn.classList.toggle("on", open);
  try { localStorage.setItem("ln-pdf-outline", open ? "1" : "0"); } catch (_) {}
  if (doRefit) refit();
}

outlineBtn.addEventListener("click", () => setOutlineOpen(outlineEl.hidden));

// The last entry starting at or before this page; its parents open so it shows.
function markOutline(num) {
  if (!outlineItems.length) return;
  let hit = null;
  for (const it of outlineItems) { if (it.page <= num) hit = it; else break; }
  outlineList.querySelectorAll(".ol-item.current").forEach((el) => el.classList.remove("current"));
  if (!hit) return;
  hit.el.classList.add("current");
  for (let p = hit.el.parentElement?.closest(".ol-item"); p; p = p.parentElement?.closest(".ol-item")) p.classList.add("open");
  if (!outlineEl.hidden) {
    const line = hit.el.querySelector(".ol-line");
    const r = line.getBoundingClientRect(), box = outlineEl.getBoundingClientRect();
    if (r.top < box.top + 30 || r.bottom > box.bottom - 10) line.scrollIntoView({ block: "nearest" });
  }
}

// ---------------------------------------------------------------------------
// Pages — empty placeholders sized up front, rendered when scrolled near
// ---------------------------------------------------------------------------

async function buildPages() {
  observer?.disconnect();
  viewerEl.innerHTML = "";
  pages = [];

  for (let num = 1; num <= pdfDoc.numPages; num++) {
    const page = await pdfDoc.getPage(num);
    const baseViewport = page.getViewport({ scale: 1 });

    const el = document.createElement("div");
    el.className = "page";
    el.dataset.page = String(num);

    viewerEl.appendChild(el);
    pages.push({ num, page, el, baseViewport, rendered: false, renderTask: null });
  }

  pageCountEl.textContent = `of ${pdfDoc.numPages}`;
  if (fitMode) scale = fitScale(fitMode);
  layoutPages();

  observer = new IntersectionObserver(onIntersect, {
    root: null,
    rootMargin: "800px 0px"   // start rendering a little before it scrolls in
  });
  pages.forEach((p) => observer.observe(p.el));
}

// Fit to width: the widest page fills the reading area (beside the outline
// when it's open). Fit to page: a whole page shows at once.
function fitScale(mode = "width") {
  const availW = viewerEl.clientWidth - 32;
  if (mode === "page") {
    const tallest = Math.max(...pages.map((p) => p.baseViewport.height));
    const widest  = Math.max(...pages.map((p) => p.baseViewport.width));
    const availH  = window.innerHeight - toolbarHeight() - 2 * PAGE_GAP;
    return clampScale(Math.min(availH / tallest, availW / widest));
  }
  const widest = Math.max(...pages.map((p) => p.baseViewport.width));
  return clampScale(availW / widest);
}

function clampScale(s) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

function layoutPages() {
  pages.forEach((p) => {
    const vp = p.baseViewport;
    p.el.style.setProperty("--scale-factor", String(scale));
    p.el.style.width  = `${Math.floor(vp.width * scale)}px`;
    p.el.style.height = `${Math.floor(vp.height * scale)}px`;
    p.el.style.marginBottom = `${PAGE_GAP}px`;
  });
  updateZoomUi();
}

function updateZoomUi() {
  zoomLabel.textContent = `${Math.round(scale * 100)}%`;
  const sel = $("zoom-mode");
  sel.value = fitMode || "custom";
  sel.querySelector('[value="custom"]').textContent = `${Math.round(scale * 100)}%`;
}

function onIntersect(entries) {
  entries.forEach((entry) => {
    const p = pages[Number(entry.target.dataset.page) - 1];
    if (entry.isIntersecting) renderPage(p);
  });
}

async function renderPage(p) {
  if (p.rendered) return;
  p.rendered = true;

  const viewport = p.page.getViewport({ scale });
  const dpr = window.devicePixelRatio || 1;

  const canvas = document.createElement("canvas");
  canvas.width  = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width  = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;

  const textLayerEl = document.createElement("div");
  textLayerEl.className = "textLayer";

  p.el.replaceChildren(canvas, textLayerEl);

  const ctx = canvas.getContext("2d");
  p.renderTask = p.page.render({
    canvasContext: ctx,
    viewport,
    transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null
  });

  try {
    await p.renderTask.promise;
    const textLayer = new pdfjsLib.TextLayer({
      textContentSource: p.page.streamTextContent(),
      container: textLayerEl,
      viewport
    });
    await textLayer.render();
    registerTextLayer(textLayerEl);
    p.textReady = true;
    drawHighlights(p);
  } catch (err) {
    if (err?.name !== "RenderingCancelledException") {
      console.warn("LazyNotes: page render failed", p.num, err);
    }
  }
}

// Re-render everything at a new scale, keeping the same spot on screen.
function setScale(newScale, { fit = null } = {}) {
  newScale = clampScale(newScale);
  fitMode = fit;
  if (fit) { try { localStorage.setItem("ln-pdf-fit", fit); } catch (_) {} }
  if (!pdfDoc || Math.abs(newScale - scale) < 0.001) {
    updateZoomUi();
    return;
  }

  // Remember how far into the current page we are.
  const cur = pages[currentPage - 1];
  const rect = cur.el.getBoundingClientRect();
  const offsetRatio = (-rect.top + toolbarHeight()) / rect.height;

  scale = newScale;
  pages.forEach((p) => {
    p.renderTask?.cancel();
    p.renderTask = null;
    p.rendered = false;
    p.textReady = false;
    p.el.replaceChildren();
  });
  layoutPages();

  const top = cur.el.offsetTop + offsetRatio * cur.el.offsetHeight - toolbarHeight();
  window.scrollTo({ top });

  // The observer only fires on changes; kick visible pages now.
  pages.forEach((p) => {
    const r = p.el.getBoundingClientRect();
    if (r.bottom > -800 && r.top < window.innerHeight + 800) renderPage(p);
  });
}

function toolbarHeight() {
  return $("toolbar").offsetHeight;
}

// ---------------------------------------------------------------------------
// Text selection — keep a drag from running on down the page
// ---------------------------------------------------------------------------
// From pdfjs-dist web/text_layer_builder.js (Apache-2.0): PDF.js's own viewer
// wraps TextLayer in this; we call TextLayer directly.
//
// A text layer is absolutely positioned spans with empty space between them.
// With the pointer over that space Chrome has no text under it and moves the
// end of the selection further down the layer, often to its end: a drag that
// strays past the end of a line, or into the gap under a paragraph, suddenly
// takes in the paragraphs below. So each layer gets an empty, unselectable
// .endOfContent div. While selecting, it covers the layer under the spans
// (see pdfreader.css), so the empty space is over it and the selection can
// only stop next to it. Moving it right after the span where the selection
// is changing (before it, when dragging backwards) keeps the selection there.
// PDF.js doesn't move it in Firefox, which doesn't need it; we're Chrome-only.

const textLayers = new Map();   // .textLayer → its .endOfContent

// Called once a page's text layer has rendered.
function registerTextLayer(layer) {
  const end = document.createElement("div");
  end.className = "endOfContent";
  layer.append(end);
  layer.addEventListener("mousedown", () => layer.classList.add("selecting"));

  textLayers.set(layer, end);
  // Zooming and opening another PDF replace the text layers; forget old ones
  // (this one too, if a zoom replaced it while it was rendering).
  textLayers.forEach((_, l) => { if (!l.isConnected) textLayers.delete(l); });
}

// Back to the end of its layer, no longer covering it.
function resetTextLayer(end, layer) {
  layer.append(end);
  end.style.width = "";
  end.style.height = "";
  layer.classList.remove("selecting");
}

const resetTextLayers = () => textLayers.forEach(resetTextLayer);

// A selection is done when the pointer comes up, the window loses focus, or
// a key (Shift+arrow) is released while no drag is going on.
let pointerIsDown = false;
document.addEventListener("pointerdown", () => { pointerIsDown = true; });
document.addEventListener("pointerup", () => { pointerIsDown = false; resetTextLayers(); });
window.addEventListener("blur", () => { pointerIsDown = false; resetTextLayers(); });
document.addEventListener("keyup", () => { if (!pointerIsDown) resetTextLayers(); });

let prevRange = null;
document.addEventListener("selectionchange", () => {
  if (textLayers.size === 0) return;
  const selection = document.getSelection();
  if (selection.rangeCount === 0) {
    resetTextLayers();
    return;
  }

  // Only the layers the selection is in get covered.
  const range = selection.getRangeAt(0);
  textLayers.forEach((end, layer) => {
    if (range.intersectsNode(layer)) layer.classList.add("selecting");
    else resetTextLayer(end, layer);
  });

  // The start is what's moving if the end stayed put, or if the drag went
  // back past where it began.
  const modifyStart = prevRange &&
    (range.compareBoundaryPoints(Range.END_TO_END, prevRange) === 0 ||
     range.compareBoundaryPoints(Range.START_TO_END, prevRange) === 0);
  let anchor = modifyStart ? range.startContainer : range.endContainer;
  if (anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode;

  const layer = anchor.parentElement?.closest(".textLayer");
  const end = textLayers.get(layer);
  if (end) {
    // Its new parent can be a markedContent span, which has no size.
    end.style.width  = layer.style.width;
    end.style.height = layer.style.height;
    anchor.parentElement.insertBefore(end, modifyStart ? anchor : anchor.nextSibling);
  }
  prevRange = range.cloneRange();
});

// ---------------------------------------------------------------------------
// Saved highlights — notes taken from this PDF, painted back onto the pages
// ---------------------------------------------------------------------------
// A note belongs to this document if its sourceUrl points at the same PDF
// (or, for a local file, the same ?local= id). Its page comes from
// note.anchor.page or the #page=N in the link; its spot on the page is found
// by searching that page's text, using anchor.occurrence when a phrase
// appears more than once.

const R = globalThis.LazyNotesReader;
let docNotes = [];                 // [{ id, text, page, occurrence, category }]
let showHighlights = true;
try { showHighlights = localStorage.getItem("ln-show-highlights") !== "0"; } catch (_) {}

const hlToggle = $("hl-toggle");

function noteBelongsHere(note, src) {
  if (!note.sourceUrl || !src) return false;
  if (src.kind === "url") return note.sourceUrl.split("#")[0] === src.url.split("#")[0];
  try {
    const u = new URL(note.sourceUrl);
    return u.pathname.endsWith("/pdfreader.html") && u.searchParams.get("local") === src.id;
  } catch (_) {
    return false;
  }
}

function pageFromNote(note) {
  if (note.anchor?.page) return note.anchor.page;
  const m = String(note.sourceUrl).match(/#page=(\d+)/);
  return m ? Number(m[1]) : null;
}

async function loadDocNotes() {
  const { lazynotes } = await chrome.storage.local.get("lazynotes");
  setDocNotes(lazynotes?.courses ?? {});
}

function setDocNotes(courses) {
  const src = R.source;
  const found = [];
  Object.values(courses).forEach((course) =>
    Object.values(course.topics || {}).forEach((topic) =>
      Object.entries(topic.highlights || {}).forEach(([id, n]) => {
        if (!noteBelongsHere(n, src)) return;
        const page = pageFromNote(n);
        if (!page) return;
        found.push({
          id,
          text: n.text,
          page,
          occurrence: n.anchor?.occurrence ?? 0,
          category: n.category
        });
      })
    )
  );
  docNotes = found;
  updateHighlightToggle();
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
  pages.forEach(drawHighlights);
});

// Find the n-th match of `needle` in `hay`; fall back to the first match if
// there are fewer (e.g. the text layer split differently this time).
function nthIndexOf(hay, needle, n) {
  let i = hay.indexOf(needle);
  const first = i;
  for (let k = 0; k < n && i !== -1; k++) i = hay.indexOf(needle, i + 1);
  return i !== -1 ? i : first;
}

// Merge a range's client rects into one box per line, relative to the page.
function lineBoxes(range, pageRect) {
  const rects = [...range.getClientRects()]
    .filter((r) => r.width > 0.5 && r.height > 0.5)
    .sort((a, b) => a.top - b.top || a.left - b.left);

  const lines = [];
  rects.forEach((r) => {
    const line = lines.find((l) => Math.abs(l.top - r.top) < Math.min(l.height, r.height) * 0.5);
    if (line) {
      const right = Math.max(line.left + line.width, r.right);
      line.left = Math.min(line.left, r.left);
      line.width = right - line.left;
      line.top = Math.min(line.top, r.top);
      line.height = Math.max(line.height, r.height);
    } else {
      lines.push({ left: r.left, top: r.top, width: r.width, height: r.height });
    }
  });

  return lines.map((l) => ({
    left: l.left - pageRect.left,
    top: l.top - pageRect.top,
    width: l.width,
    height: l.height
  }));
}

function drawHighlights(p) {
  p.el.querySelector(".hl-layer")?.remove();
  if (!p.textReady || !showHighlights) return;

  const notes = docNotes.filter((n) => n.page === p.num);
  if (notes.length === 0) return;

  const textLayerEl = p.el.querySelector(".textLayer");
  const { text, chars } = R.indexTextLayer(textLayerEl);
  const pageRect = p.el.getBoundingClientRect();

  const layer = document.createElement("div");
  layer.className = "hl-layer";

  notes.forEach((n) => {
    const needle = R.squash(n.text);
    if (!needle) return;
    const at = nthIndexOf(text, needle, n.occurrence);
    if (at === -1) return;  // text changed since (edited note) — nothing to draw

    const start = chars[at];
    const end   = chars[at + needle.length - 1];
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset + 1);

    lineBoxes(range, pageRect).forEach((b) => {
      const mark = document.createElement("div");
      mark.className = `hl-mark hl-mark--${(n.category || "").replace(/\s+/g, "-")}`;
      mark.dataset.noteId = n.id;
      mark.style.left   = `${b.left - 1}px`;
      mark.style.top    = `${b.top}px`;
      mark.style.width  = `${b.width + 2}px`;
      mark.style.height = `${b.height}px`;
      layer.appendChild(mark);
    });
  });

  // Under the text layer so selecting text still works.
  p.el.insertBefore(layer, textLayerEl);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.lazynotes || !pdfDoc) return;
  setDocNotes(changes.lazynotes.newValue?.courses ?? {});
  pages.forEach(drawHighlights);
});

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

function goToPage(num, smooth = true) {
  if (!pdfDoc) return;
  num = Math.min(pdfDoc.numPages, Math.max(1, num));
  const el = pages[num - 1].el;
  window.scrollTo({
    top: el.offsetTop - toolbarHeight() - 8,
    behavior: smooth ? "smooth" : "auto"
  });
  setCurrentPage(num);
}

function setCurrentPage(num) {
  currentPage = num;
  LazyDocs.page(num);
  markOutline(num);
  if (document.activeElement !== pageInput) pageInput.value = String(num);
}

// Current page = the one covering the middle of the screen.
let scrollRaf = null;
window.addEventListener("scroll", () => {
  if (scrollRaf || !pdfDoc) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = null;
    const mid = window.innerHeight / 2;
    const hit = pages.find((p) => {
      const r = p.el.getBoundingClientRect();
      return r.top <= mid && r.bottom + PAGE_GAP >= mid;
    });
    if (hit && hit.num !== currentPage) {
      setCurrentPage(hit.num);
      history.replaceState(null, "", `${location.search}#page=${hit.num}`);
    }
  });
});

let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(refit, 150);
});

pageInput.addEventListener("change", () => {
  const n = parseInt(pageInput.value, 10);
  if (Number.isFinite(n)) goToPage(n);
  else pageInput.value = String(currentPage);
});
pageInput.addEventListener("focus", () => pageInput.select());

$("prev-page").addEventListener("click", () => goToPage(currentPage - 1));
$("next-page").addEventListener("click", () => goToPage(currentPage + 1));
$("zoom-in").addEventListener("click",  () => setScale(scale * 1.2));
$("zoom-out").addEventListener("click", () => setScale(scale / 1.2));
function refit() {
  if (fitMode && pdfDoc) setScale(fitScale(fitMode), { fit: fitMode });
}
$("zoom-mode").addEventListener("change", (e) => {
  const m = e.target.value;
  if (m === "width" || m === "page") setScale(fitScale(m), { fit: m });
  e.target.blur();
});

// Keyboard: ←/→ pages, Ctrl/Cmd +/−/0 zoom. Leave keys alone while typing or
// while the save popup is open.
document.addEventListener("keydown", (e) => {
  if (!pdfDoc) return;
  const t = e.target;
  if (t.closest?.(".lazy-notes-popup") || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
  if (document.querySelector(".lazy-notes-popup")?.style.display === "block") return;

  if (e.ctrlKey || e.metaKey) {
    if (e.key === "=" || e.key === "+") { e.preventDefault(); setScale(scale * 1.2); }
    if (e.key === "-")                  { e.preventDefault(); setScale(scale / 1.2); }
    if (e.key === "0")                  { e.preventDefault(); setScale(fitScale("width"), { fit: "width" }); }
    return;
  }
  if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); goToPage(currentPage + 1); }
  if (e.key === "ArrowLeft"  || e.key === "PageUp")   { e.preventDefault(); goToPage(currentPage - 1); }
});

// ---------------------------------------------------------------------------
// Start screen
// ---------------------------------------------------------------------------

async function showStartScreen() {
  startScreen.hidden = false;
  pageControls.hidden = true;
  await renderRecent();
}

// Slides opened before live in the slides reader's own store; list them
// here too (only if that database exists: opening a missing one would
// create it without its store).
async function slidesStore(fn, dbName = "lazynotes-slides") {
  const names = (await indexedDB.databases().catch(() => [])).map((d) => d.name);
  if (!names.includes(dbName)) return null;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("files")) { db.close(); resolve(null); return; }
      const r = fn(db.transaction("files", "readwrite").objectStore("files"));
      r.onsuccess = () => { db.close(); resolve(r.result); };
      r.onerror = () => { db.close(); reject(r.error); };
    };
  });
}

async function renderRecent() {
  const list = $("recent-list");
  const pdfs   = (await listLocalFiles().catch(() => [])).map((f) => ({ ...f, kind: "pdf" }));
  const slides = ((await slidesStore((s) => s.getAll()).catch(() => null)) || []).map((f) => ({ ...f, kind: "pptx" }));
  const words  = ((await slidesStore((s) => s.getAll(), "lazynotes-docs").catch(() => null)) || []).map((f) => ({ ...f, kind: "docx" }));
  const files  = [...pdfs, ...slides, ...words].sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0));
  $("recent").hidden = files.length === 0;
  list.innerHTML = "";

  files.forEach((f) => {
    const row = document.createElement("div");
    row.className = "recent-row";

    const tag = document.createElement("span");
    tag.className = `recent-kind ${f.kind}`;
    tag.textContent = OTHER_READERS[f.kind]?.tag ?? "PDF";

    const name = document.createElement("span");
    name.className = "recent-name";
    name.textContent = f.name;

    const meta = document.createElement("span");
    meta.className = "recent-meta";
    meta.textContent = new Date(f.openedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });

    const remove = document.createElement("button");
    remove.className = "recent-remove";
    remove.textContent = "×";
    remove.title = "Remove from recent files (your notes stay)";
    remove.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (OTHER_READERS[f.kind]) await slidesStore((s) => s.delete(f.id), OTHER_READERS[f.kind].db).catch(() => {});
      else await deleteLocalFile(f.id);
      renderRecent();
    });

    row.append(tag, name, meta, remove);
    row.addEventListener("click", () => {
      if (OTHER_READERS[f.kind]) { location.href = `${OTHER_READERS[f.kind].page}?local=${encodeURIComponent(f.id)}`; return; }
      history.replaceState(null, "", `?local=${encodeURIComponent(f.id)}`);
      openLocalRecord(f);
    });
    list.appendChild(row);
  });
}

$("open-btn").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  openPickedFile(fileInput.files[0]);
  fileInput.value = "";
});

urlForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const url = urlInput.value.trim();
  if (!url) return;
  const path = url.split(/[?#]/)[0];
  if (/\.pptx$/i.test(path)) { location.href = `pptxreader.html?url=${encodeURIComponent(url)}`; return; }
  if (/\.docx$/i.test(path)) { location.href = `docxreader.html?url=${encodeURIComponent(url)}`; return; }
  if (/\.doc$/i.test(path)) {
    showMessage("Old .doc files can't be read: open it in Word or Google Docs and save as .docx or PDF.", true);
    return;
  }
  history.replaceState(null, "", `?url=${encodeURIComponent(url)}`);
  openFromUrl(url);
});

// Drop a PDF anywhere on the page.
["dragenter", "dragover"].forEach((type) =>
  document.addEventListener(type, (e) => {
    if (![...(e.dataTransfer?.types || [])].includes("Files")) return;
    e.preventDefault();
    dropZone.classList.add("dragging");
  })
);
["dragleave", "drop"].forEach((type) =>
  document.addEventListener(type, () => dropZone.classList.remove("dragging"))
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

function hideMessage() {
  messageEl.hidden = true;
}

// ---------------------------------------------------------------------------
// Highlighter status chip — says where a selection will be saved
// ---------------------------------------------------------------------------

async function updateHighlighterStatus() {
  const { highlighterActive = false, activeCourse = null, activeTopic = null } =
    await chrome.storage.local.get(["highlighterActive", "activeCourse", "activeTopic"]);

  const on = highlighterActive && activeCourse && activeTopic;
  hlStatus.classList.toggle("on", !!on);
  hlStatus.textContent = on
    ? `Saving to ${activeCourse} › ${activeTopic}`
    : "Highlighter off";
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
  if (area !== "local") return;
  if (changes.highlighterActive || changes.activeCourse || changes.activeTopic) {
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
  const msg    = params.get("msg");   // handed over by the slides reader
  if (msg) {
    history.replaceState(null, "", location.pathname);
    showMessage(msg, true);
  }

  if (url) {
    await openFromUrl(url);
  } else if (local) {
    const record = await getLocalFile(local).catch(() => null);
    if (record) {
      await openLocalRecord(record);
    } else {
      showMessage("That file isn't on this computer any more — open it again to keep reading.", true);
      await showStartScreen();
    }
  } else {
    await showStartScreen();
  }
}

boot();

// A note's link to this same PDF (side panel reuses the open tab): only the
// #page changes, so jump there.
window.addEventListener("hashchange", () => { if (pdfDoc) goToPage(initialPageFromHash()); });
