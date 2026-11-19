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

import * as pdfjsLib from "./lib/pdfjs/pdf.min.mjs";

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
let fitWidth   = true;      // follow the window width until the user zooms
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

async function openPickedFile(file) {
  if (!file) return;
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

  await buildPages();
  goToPage(initialPageFromHash(), false);
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
  if (fitWidth) scale = fitScale();
  layoutPages();

  observer = new IntersectionObserver(onIntersect, {
    root: null,
    rootMargin: "800px 0px"   // start rendering a little before it scrolls in
  });
  pages.forEach((p) => observer.observe(p.el));
}

function fitScale() {
  const widest = Math.max(...pages.map((p) => p.baseViewport.width));
  // Comfortable reading width: fill narrow windows, cap wide ones.
  const avail  = Math.min(window.innerWidth - 32, 920);
  return clampScale(avail / widest);
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
  zoomLabel.textContent = `${Math.round(scale * 100)}%`;
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
  } catch (err) {
    if (err?.name !== "RenderingCancelledException") {
      console.warn("LazyNotes: page render failed", p.num, err);
    }
  }
}

// Re-render everything at a new scale, keeping the same spot on screen.
function setScale(newScale, { fit = false } = {}) {
  newScale = clampScale(newScale);
  fitWidth = fit;
  if (!pdfDoc || Math.abs(newScale - scale) < 0.001) {
    zoomLabel.textContent = `${Math.round(scale * 100)}%`;
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
  resizeTimer = setTimeout(() => { if (fitWidth && pdfDoc) setScale(fitScale(), { fit: true }); }, 150);
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
$("zoom-fit").addEventListener("click", () => setScale(fitScale(), { fit: true }));

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
    if (e.key === "0")                  { e.preventDefault(); setScale(fitScale(), { fit: true }); }
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

async function renderRecent() {
  const list = $("recent-list");
  const files = await listLocalFiles().catch(() => []);
  $("recent").hidden = files.length === 0;
  list.innerHTML = "";

  files.forEach((f) => {
    const row = document.createElement("div");
    row.className = "recent-row";

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
      await deleteLocalFile(f.id);
      renderRecent();
    });

    row.append(name, meta, remove);
    row.addEventListener("click", () => {
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
