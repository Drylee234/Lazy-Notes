// Lazy Notes — Slides reader
// Shows a PowerPoint (.pptx) deck as text: one card per slide with its
// title, bullets, tables, pictures and speaker notes (pptx-parse.js reads
// the file). content.js, loaded by the page, does the highlighting exactly
// as on websites; pptxreader-host.js tells it which deck and slide a note
// came from. Works like the PDF reader (pdfreader.js).
//
// Opened as:
//   pptxreader.html                  start screen (pick / drop / paste a link)
//   pptxreader.html?url=<pptx url>   a deck on the web
//   pptxreader.html?local=<id>       a file from this computer, kept in IndexedDB
// with an optional #slide=N.

import { readPptx } from "./pptx-parse.js";

const $ = (id) => document.getElementById(id);

const viewerEl      = $("viewer");
const startScreen   = $("start-screen");
const messageEl     = $("message");
const docTitleEl    = $("doc-title");
const slideControls = $("slide-controls");
const slideInput    = $("slide-input");
const slideCountEl  = $("slide-count");
const notesToggle   = $("notes-toggle");
const hlToggle      = $("hl-toggle");
const hlStatus      = $("hl-status");
const fileInput     = $("file-input");
const dropZone      = $("drop-zone");

const S = globalThis.LazySlides;

let deck         = null;   // { slides } from readPptx
let slideEls     = [];     // <section class="slide"> per slide
let currentSlide = 1;
let imageUrls    = [];     // object URLs, revoked when another deck opens

// ---------------------------------------------------------------------------
// Local files — kept in IndexedDB so a reload or a note's link
// (pptxreader.html?local=<id>) can reopen them. Same scheme as the PDF
// reader, in a database of its own.
// ---------------------------------------------------------------------------

const DB_NAME   = "lazynotes-slides";
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
  // Same name + size = same file: reuse its id so old notes keep working.
  const existing = (await listLocalFiles()).find((f) => f.name === file.name && f.size === file.size);
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

const touchLocalFile  = (record) => dbRun("readwrite", (s) => s.put({ ...record, openedAt: Date.now() }));
const deleteLocalFile = (id) => dbRun("readwrite", (s) => s.delete(id));

// ---------------------------------------------------------------------------
// Opening decks
// ---------------------------------------------------------------------------

function fileNameFromUrl(url) {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop();
    return decodeURIComponent(last || url);
  } catch (_) {
    return url;
  }
}

function slideFromHash() {
  const m = location.hash.match(/slide=(\d+)/);
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
    showMessage(url.startsWith("file:")
      ? "Chrome blocked this local file. Either choose it with Open, or turn on " +
        "“Allow access to file URLs” for Lazy Notes in chrome://extensions."
      : `Couldn't download the slides (${err.message}).`, true);
    await showStartScreen();
    return;
  }
  const clean = url.split("#")[0];
  S.source = { kind: "url", url: clean, name: fileNameFromUrl(clean) };
  await loadDeck(data, S.source.name);
}

async function openLocalRecord(record) {
  S.source = { kind: "local", id: record.id, name: record.name };
  await touchLocalFile(record);
  await loadDeck(await record.data.arrayBuffer(), record.name);
}

async function openPickedFile(file) {
  if (!file) return;
  if (!/\.pptx$/i.test(file.name)) {
    showMessage(/\.ppt$/i.test(file.name)
      ? "Older .ppt files can't be read. Save it as .pptx (or PDF) in PowerPoint first."
      : "That isn't a .pptx file.", true);
    return;
  }
  const record = await saveLocalFile(file);
  history.replaceState(null, "", `?local=${encodeURIComponent(record.id)}`);
  await openLocalRecord(record);
}

async function loadDeck(data, name) {
  showMessage("Loading…");
  try {
    deck = await readPptx(data);
  } catch (err) {
    deck = null;
    showMessage(`Couldn't read these slides (${err.message}).`, true);
    await showStartScreen();
    return;
  }

  document.title = `${name} — Lazy Notes`;
  docTitleEl.textContent = name;
  docTitleEl.title = name;

  startScreen.hidden = true;
  slideControls.hidden = false;
  notesToggle.hidden = !deck.slides.some((s) => s.notes.length);
  hideMessage();

  renderDeck();
  await loadDeckNotes();
  goToSlide(slideFromHash(), false);
}

// ---------------------------------------------------------------------------
// Slides
// ---------------------------------------------------------------------------

function renderDeck() {
  imageUrls.forEach((u) => URL.revokeObjectURL(u));
  imageUrls = [];
  viewerEl.replaceChildren();

  slideEls = deck.slides.map((slide) => {
    const el = document.createElement("section");
    el.className = "slide";
    el.id = `slide-${slide.number}`;
    el.dataset.slide = String(slide.number);

    const label = document.createElement("div");
    label.className = "slide-label";
    label.textContent = `Slide ${slide.number}${slide.hidden ? " · hidden in the show" : ""}`;

    // Everything a note can be taken from sits in .slide-body (the host
    // bridge looks for it), the label stays outside.
    const body = document.createElement("div");
    body.className = "slide-body";
    slide.blocks.forEach((b) => body.appendChild(renderBlock(b)));

    if (!slide.blocks.length) {
      const empty = document.createElement("p");
      empty.className = "slide-empty";
      empty.textContent = "No text on this slide.";
      body.appendChild(empty);
    }

    if (slide.notes.length) {
      const notes = document.createElement("div");
      notes.className = "s-notes";
      const head = document.createElement("div");
      head.className = "s-notes-label";
      head.textContent = "Speaker notes";
      notes.append(head, renderParas(slide.notes));
      body.appendChild(notes);
    }

    el.append(label, body);
    viewerEl.appendChild(el);
    return el;
  });

  slideCountEl.textContent = `of ${deck.slides.length}`;
}

// Text with line breaks kept as <br>.
function withLines(el, text) {
  text.split("\n").forEach((line, i) => {
    if (i) el.appendChild(document.createElement("br"));
    el.appendChild(document.createTextNode(line));
  });
  return el;
}

function renderParas(paras) {
  const wrap = document.createElement("div");
  wrap.className = "s-text";
  paras.forEach((p) => {
    const el = withLines(document.createElement("p"), p.text);
    el.className = "s-p";
    el.style.setProperty("--lvl", String(p.level));
    if (p.marker) {
      el.dataset.marker = p.marker;
      if (/\d|^[a-z]+[.)]$|^\(/i.test(p.marker)) el.classList.add("s-num");
    }
    wrap.appendChild(el);
  });
  return wrap;
}

function renderBlock(block) {
  switch (block.kind) {
    case "title": {
      const h = withLines(document.createElement("h2"), block.text);
      h.className = "s-title";
      return h;
    }
    case "subtitle": {
      const p = withLines(document.createElement("p"), block.text);
      p.className = "s-subtitle";
      return p;
    }
    case "text":
      return renderParas(block.paras);
    case "table": {
      const table = document.createElement("table");
      table.className = "s-table";
      block.rows.forEach((row, r) => {
        const tr = table.insertRow();
        row.forEach((cell) => {
          const td = withLines(document.createElement(block.header && r === 0 ? "th" : "td"), cell.text);
          if (cell.colSpan > 1) td.colSpan = cell.colSpan;
          if (cell.rowSpan > 1) td.rowSpan = cell.rowSpan;
          tr.appendChild(td);
        });
      });
      return table;
    }
    case "image": {
      const fig = document.createElement("figure");
      fig.className = "s-figure";
      const img = document.createElement("img");
      const url = URL.createObjectURL(block.blob);
      imageUrls.push(url);
      img.src = url;
      img.alt = block.alt;
      img.loading = "lazy";
      fig.appendChild(img);
      return fig;
    }
  }
  return document.createElement("div");
}

// ---------------------------------------------------------------------------
// Saved highlights — notes taken from this deck, marked on their slides
// ---------------------------------------------------------------------------
// A note belongs to this deck if its link is this reader's link for the same
// file (same ?url= or ?local=). Its slide is anchor.page or the #slide=N in
// the link; its spot is found by searching that slide's text, with
// anchor.occurrence picking between repeats. Drawn with the CSS Custom
// Highlight API, so the slides' DOM (and selecting text) is untouched.

const HIGHLIGHT_NAME = "lazy-notes-saved";
let deckNotes = [];                 // [{ id, text, slide, occurrence }]
let showHighlights = true;
try { showHighlights = localStorage.getItem("ln-show-highlights") !== "0"; } catch (_) {}

function noteBelongsHere(note) {
  const src = S.source;
  if (!note.sourceUrl || !src) return false;
  try {
    const u = new URL(note.sourceUrl);
    if (!u.pathname.endsWith("/pptxreader.html")) return false;
    return src.kind === "url"
      ? u.searchParams.get("url") === src.url
      : u.searchParams.get("local") === src.id;
  } catch (_) {
    return false;
  }
}

function slideOfNote(note) {
  if (note.anchor?.page) return note.anchor.page;
  const m = String(note.sourceUrl).match(/#slide=(\d+)/);
  return m ? Number(m[1]) : null;
}

async function loadDeckNotes() {
  const { lazynotes } = await chrome.storage.local.get("lazynotes");
  setDeckNotes(lazynotes?.courses ?? {});
}

function setDeckNotes(courses) {
  const found = [];
  Object.values(courses).forEach((course) =>
    Object.values(course.topics || {}).forEach((topic) =>
      Object.entries(topic.highlights || {}).forEach(([id, n]) => {
        if (!noteBelongsHere(n)) return;
        const slide = slideOfNote(n);
        if (slide) found.push({ id, text: n.text, slide, occurrence: n.anchor?.occurrence ?? 0 });
      })
    )
  );
  deckNotes = found;
  updateHighlightToggle();
  paintHighlights();
}

// The n-th match of needle in hay, or the first if there are fewer.
function nthIndexOf(hay, needle, n) {
  let i = hay.indexOf(needle);
  const first = i;
  for (let k = 0; k < n && i !== -1; k++) i = hay.indexOf(needle, i + 1);
  return i !== -1 ? i : first;
}

function paintHighlights() {
  if (!globalThis.Highlight || !CSS.highlights) return;  // Chrome before 105
  CSS.highlights.delete(HIGHLIGHT_NAME);
  if (!showHighlights || !deck || !deckNotes.length) return;

  const ranges = [];
  const indexes = new Map();  // slide → text index, built once per slide
  deckNotes.forEach((n) => {
    const body = slideEls[n.slide - 1]?.querySelector(".slide-body");
    if (!body) return;
    if (!indexes.has(n.slide)) indexes.set(n.slide, S.indexText(body));
    const { text, chars } = indexes.get(n.slide);

    const needle = S.squash(n.text);
    const at = needle ? nthIndexOf(text, needle, n.occurrence) : -1;
    if (at === -1) return;  // the note's text was edited since: nothing to mark

    const start = chars[at];
    const end   = chars[at + needle.length - 1];
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset + 1);
    ranges.push(range);
  });

  if (ranges.length) CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges));
}

function updateHighlightToggle() {
  hlToggle.hidden = deckNotes.length === 0;
  hlToggle.textContent = `${deckNotes.length} highlight${deckNotes.length === 1 ? "" : "s"}`;
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
  if (area !== "local" || !changes.lazynotes || !deck) return;
  setDeckNotes(changes.lazynotes.newValue?.courses ?? {});
});

// ---------------------------------------------------------------------------
// Speaker notes on/off (remembered)
// ---------------------------------------------------------------------------

let showNotes = true;
try { showNotes = localStorage.getItem("ln-show-speaker-notes") !== "0"; } catch (_) {}

function applyNotesToggle() {
  document.body.classList.toggle("notes-off", !showNotes);
  notesToggle.setAttribute("aria-pressed", String(showNotes));
  notesToggle.classList.toggle("off", !showNotes);
  notesToggle.title = showNotes ? "Hide speaker notes" : "Show speaker notes";
}

notesToggle.addEventListener("click", () => {
  showNotes = !showNotes;
  try { localStorage.setItem("ln-show-speaker-notes", showNotes ? "1" : "0"); } catch (_) {}
  applyNotesToggle();
});
applyNotesToggle();

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

// A jump owns the slide number until its scrolling settles; otherwise the
// scroll handler would name whatever slide passes under its line on the way.
let jumpingUntil = 0;

function goToSlide(n, smooth = true) {
  if (!deck) return;
  n = Math.min(deck.slides.length, Math.max(1, n));
  jumpingUntil = performance.now() + (smooth ? 900 : 200);
  slideEls[n - 1].scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
  setCurrentSlide(n);
  history.replaceState(null, "", `${location.search}#slide=${n}`);
}

function setCurrentSlide(n) {
  currentSlide = n;
  if (document.activeElement !== slideInput) slideInput.value = String(n);
}

// Current slide = the one under a line a third of the way down the window;
// scrolled all the way down, the last slide that shows.
let scrollRaf = null;
window.addEventListener("scroll", () => {
  if (scrollRaf || !deck || performance.now() < jumpingUntil) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = null;
    const line  = window.innerHeight / 3;
    const atEnd = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
    const hit = atEnd
      ? slideEls.findLast((el) => el.getBoundingClientRect().top < window.innerHeight - 40)
      : slideEls.find((el) => {
          const r = el.getBoundingClientRect();
          return r.top <= line && r.bottom + 20 >= line;
        });
    const n = hit ? Number(hit.dataset.slide) : null;
    if (n && n !== currentSlide) {
      setCurrentSlide(n);
      history.replaceState(null, "", `${location.search}#slide=${n}`);
    }
  });
});

slideInput.addEventListener("change", () => {
  const n = parseInt(slideInput.value, 10);
  if (Number.isFinite(n)) goToSlide(n);
  else slideInput.value = String(currentSlide);
});
slideInput.addEventListener("focus", () => slideInput.select());

$("prev-slide").addEventListener("click", () => goToSlide(currentSlide - 1));
$("next-slide").addEventListener("click", () => goToSlide(currentSlide + 1));

// ←/→ and PageUp/PageDown move a slide. Left alone while typing or while the
// save popup is open.
document.addEventListener("keydown", (e) => {
  if (!deck || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t.closest?.(".lazy-notes-popup") || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
  if (document.querySelector(".lazy-notes-popup")?.style.display === "block") return;

  if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); goToSlide(currentSlide + 1); }
  if (e.key === "ArrowLeft"  || e.key === "PageUp")   { e.preventDefault(); goToSlide(currentSlide - 1); }
});

// ---------------------------------------------------------------------------
// Start screen
// ---------------------------------------------------------------------------

async function showStartScreen() {
  startScreen.hidden = false;
  slideControls.hidden = true;
  await renderRecent();
}

async function renderRecent() {
  const list = $("recent-list");
  const files = await listLocalFiles().catch(() => []);
  $("recent").hidden = files.length === 0;
  list.replaceChildren();

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

$("url-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const url = $("url-input").value.trim();
  if (!url) return;
  history.replaceState(null, "", `?url=${encodeURIComponent(url)}`);
  openFromUrl(url);
});

// Drop a .pptx anywhere on the page.
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
