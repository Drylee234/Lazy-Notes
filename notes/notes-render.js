// Lazy Notes — shared note rendering for the side panel and the viewer.
// Plain script (no modules on these pages). Styles live in notes.css.
//
// Each category renders as what it is in a set of notes — a heading, a
// bullet, a formula — instead of a generic card with a label.

const CATEGORY_LABELS = {
  "header":     "Header",
  "sub topic":  "Sub topic",
  "definition": "Definition",
  "formula":    "Formula",
  "list head":  "List head",
  "list point": "List point",
  "summary":    "Summary",
  "generic":    "Plain",       // was "Generic"
  "note":       "Important",   // was "Note"
  "figure":     "Figure",      // a snipped picture (readers' Snip / Save image)
  "table":      "Table"        // rows and cells (tabs, | or 2+ spaces between cells)
};

// The types offered when saving or changing one, in pick order (number keys
// 1-8, Plain = 0). A Plain line right above list points also acts as their
// list head.
const PICK_TYPES = ["header", "sub topic", "definition", "formula", "list point", "note", "summary", "list head", "table", "generic"];

// A table's text → rows of cells. Rows are lines; cells are split by tabs
// (a table copied from a web page), else by "|", else by 2+ spaces.
function parseTable(text) {
  const lines = String(text ?? "").split(/\n/).map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim());
  const by = lines.some((l) => l.includes("\t")) ? /\t/
    : lines.filter((l) => l.includes("|")).length >= Math.ceil(lines.length / 2) ? /\|/ : /\s{2,}/;
  let rows = lines.map((l) => {
    let cells = l.split(by).map((c) => c.trim());
    if (by.source === "\\|") { if (cells[0] === "") cells.shift(); if (cells[cells.length - 1] === "") cells.pop(); }
    return cells;
  }).filter((r) => !(r.length && r.every((c) => /^:?-{2,}:?$/.test(c))));   // markdown |---| line
  const width = Math.max(1, ...rows.map((r) => r.length));
  return rows.map((r) => [...r, ...Array(width - r.length).fill("")]);
}

function renderTable(text) {
  const table = document.createElement("table");
  table.className = "note-table";
  parseTable(text).forEach((cells, i) => {
    const tr = table.insertRow();
    cells.forEach((c) => {
      const cell = document.createElement(i === 0 ? "th" : "td");
      cell.textContent = c;
      tr.appendChild(cell);
    });
  });
  const wrap = document.createElement("div");
  wrap.className = "note-table-wrap";
  wrap.appendChild(table);
  return wrap;
}

// A short readable name for where a note came from.
function sourceLabel(note) {
  if (note.sourceTitle) return note.sourceTitle;
  if (!note.sourceUrl) return null;
  try {
    const u = new URL(note.sourceUrl);
    return u.protocol.startsWith("http") ? u.hostname.replace(/^www\./, "") : note.sourceUrl;
  } catch (_) {
    return note.sourceUrl;
  }
}

function formatWhen(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" })
  });
}

// note: { text, category, annotation, sourceUrl, sourceTitle, timestamp, edited }
// Returns a <div class="note note--<category>"> with text, annotation and a
// meta line (category · source · date) that shows on hover/focus.
//
// page: draw it as part of a written page (the side panel's Study tab): the
// highlighted words get a marker, so they stand apart from typed notes; a
// definition shows its meaning (the sentence it came from) and a formula its
// context as a caption.
function renderNote(note, { compact = false, page = false } = {}) {
  const el = document.createElement("div");
  el.className = `note note--${(note.category || "summary").replace(/\s+/g, "-")}`;
  if (compact) el.classList.add("note--compact");
  if (page) el.classList.add("note--page");
  el.dataset.id = note.id ?? "";
  el.dataset.colon = /[:：]\s*$/.test(note.text || "") ? "1" : "";
  el.tabIndex = 0;

  // A figure: the picture, with its caption (the note's text) under it.
  if (note.category === "figure" && note.image) {
    const img = document.createElement("img");
    img.className = "note-figure";
    img.src = note.image;
    img.alt = note.text || "Figure";
    img.loading = "lazy";
    img.draggable = false;
    el.appendChild(img);
  }

  const text = document.createElement("div");
  text.className = "note-text";
  if (note.category === "figure") text.textContent = note.text || "";
  else if (note.category === "table") text.appendChild(renderTable(note.text));
  else if (page) fillPageText(text, note);
  else if (note.category === "definition" && splitTerm(note.text)) fillTermDefinition(text, splitTerm(note.text), false);
  else text.textContent = note.text;
  // A list head introduces its points: show it with a colon (display only).
  if (note.category === "list head" && !/[:：]\s*$/.test(note.text || "")) {
    const colon = document.createElement("span");
    colon.className = "note-colon";
    colon.textContent = ":";
    text.appendChild(colon);
  }
  el.appendChild(text);

  const caption = page && note.category === "formula" ? squashSpaces(note.context) : "";
  if (caption && caption !== squashSpaces(note.text)) {
    const cap = document.createElement("div");
    cap.className = "note-caption";
    cap.textContent = caption;
    el.appendChild(cap);
  }

  if (note.annotation) {
    const ann = document.createElement("div");
    ann.className = "note-annotation";
    ann.textContent = note.annotation;
    el.appendChild(ann);
  }

  const meta = document.createElement("div");
  meta.className = "note-meta";

  const cat = document.createElement("span");
  cat.className = "note-cat";
  cat.textContent = CATEGORY_LABELS[note.category] || note.category;
  meta.appendChild(cat);

  const label = sourceLabel(note);
  if (label) {
    const a = document.createElement(note.sourceUrl ? "a" : "span");
    a.className = "note-source";
    a.textContent = label;
    if (note.sourceUrl) {
      a.href = note.sourceUrl;
      a.target = "_blank";
      a.rel = "noopener";
      a.title = note.sourceUrl;
      a.addEventListener("click", (e) => e.stopPropagation());  // don't open the editor
    }
    meta.appendChild(a);
  }

  const when = document.createElement("span");
  when.textContent = formatWhen(note.timestamp) + (note.edited ? " · edited" : "");
  meta.appendChild(when);

  el.appendChild(meta);
  return el;
}

// ---------------------------------------------------------------------------
// Written-page mode (renderNote with page: true)
// ---------------------------------------------------------------------------

function squashSpaces(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

function markedText(text) {
  const mark = document.createElement("mark");
  mark.className = "hl-mark";
  mark.textContent = text;
  return mark;
}

function fillPageText(el, note) {
  const parts = note.category === "definition" ? splitTerm(note.text) : null;
  if (parts) fillTermDefinition(el, parts, true);
  else if (note.category === "definition") fillDefinition(el, note);
  else el.appendChild(markedText(note.text));
}

// "Viscosity: resistance to flow" / "Viscosity - resistance to flow" ->
// { term, rest }, or null when the text isn't written as term + meaning.
function splitTerm(text) {
  // "Man :" (or just "Man") on its own line, the meaning on the next lines.
  const lines = String(text ?? "").split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 2) {
    // Only when it's clearly a term: it ends with ":" (or a dash), or it's
    // at most 3 words (a wrapped PDF line is usually longer).
    const marked = /[:：\-–—]\s*$/.test(lines[0]);
    const head = lines[0].replace(/\s*[:：\-–—]\s*$/, "");
    if (head && head.length <= 60 && (marked || head.split(/\s+/).length <= 3) && !/[.!?]$/.test(head)) {
      return { term: head, rest: squashSpaces(lines.slice(1).join(" ")) };
    }
  }
  const m = squashSpaces(text).match(/^([^:\-–—]{1,60}?)\s*(?::|\s[-–—]\s)\s*(.+)$/);
  return m && m[2].length > 1 ? { term: m[1], rest: m[2] } : null;
}

// The term in bold, then its meaning: "**Viscosity**: resistance to flow".
function fillTermDefinition(el, { term, rest }, marked) {
  const b = document.createElement("strong");
  b.className = "note-term";
  b.appendChild(marked ? markedText(term) : document.createTextNode(term));
  el.append(b, ": ", marked ? markedText(rest) : rest);
}

// "Mitochondria" + context "… Mitochondria are the organelles that make
// ATP. …" -> "**Mitochondria** are the organelles that make ATP." with the
// term marked. Without the term in the context: "**Term** — context".
function fillDefinition(el, note) {
  const term    = squashSpaces(note.text);
  const context = squashSpaces(note.context);
  const bold = (text) => {
    const b = document.createElement("strong");
    b.appendChild(markedText(text));
    return b;
  };

  if (!context || context.toLowerCase() === term.toLowerCase()) {
    el.appendChild(bold(term));
    return;
  }

  const at = context.toLowerCase().indexOf(term.toLowerCase());
  if (at === -1) {
    el.append(bold(term), " — ", context);
    return;
  }

  let { start, end } = sentenceAround(context, at, term.length);

  // A "sentence" without full stops can be a whole paragraph: keep it short.
  const MAX_BEFORE = 120;
  const MAX_AFTER  = 200;
  const pre  = at - start > MAX_BEFORE ? "…" : "";
  const post = end - (at + term.length) > MAX_AFTER ? "…" : "";
  if (pre) start = context.lastIndexOf(" ", at - MAX_BEFORE) + 1;
  if (post) {
    const cut = context.indexOf(" ", at + term.length + MAX_AFTER);
    end = cut === -1 ? context.length : cut;
  }

  el.append(
    pre + context.slice(start, at),
    bold(context.slice(at, at + term.length)),
    context.slice(at + term.length, end) + post
  );
}

// Start and end of the sentence of `text` that holds text[at .. at+len).
function sentenceAround(text, at, len) {
  const before  = text.slice(0, at);
  const lastEnd = before.match(/^.*[.!?]\s+/s);
  const start   = lastEnd ? lastEnd[0].length : 0;

  const after   = text.slice(at + len);
  const nextEnd = after.match(/[.!?](\s|$)/);
  const end     = nextEnd ? at + len + nextEnd.index + 1 : text.length;
  return { start, end };
}

// ---------------------------------------------------------------------------
// Typed notes — written in the side panel, not highlighted
// ---------------------------------------------------------------------------

// note: { id, text, timestamp, edited }. Quotes (lines starting ">", often a
// highlight dragged in) show as block quotes. Returns a <div class="note
// note--typed"> with a meta line ("Your note · date") like a highlight's.
function renderTypedNote(note) {
  const el = document.createElement("div");
  el.className = "note note--typed";
  el.dataset.id = note.id ?? "";
  el.tabIndex = 0;

  const body = document.createElement("div");
  body.className = "note-text";
  body.innerHTML = typedNoteHtml(note.text);   // escaped first: see utils.js
  el.appendChild(body);

  const meta = document.createElement("div");
  meta.className = "note-meta";
  const kind = document.createElement("span");
  kind.className = "note-cat";
  kind.textContent = "Your note";
  const when = document.createElement("span");
  when.textContent = formatWhen(note.timestamp) + (note.edited ? " · edited" : "");
  meta.append(kind, when);
  el.appendChild(meta);

  return el;
}

// ---------------------------------------------------------------------------
// What belongs under what (in page order), and folding
// ---------------------------------------------------------------------------
// A Header holds everything down to the next Header; a Sub topic down to the
// next Sub topic or Header; a List head (or a Plain line right above list
// points, which shows as one) holds the list points straight after it.
// notes: [{ id, category, kind }] in the order they're shown. Typed notes
// (kind "typed") sit under the header/sub topic they follow.
// Returns Map(id → parent id or null).
function noteParents(notes) {
  const parent = new Map();
  let header = null, sub = null, head = null;
  // Indented notes belong to the nearest note above them that is less
  // indented ("Simple diffusion" owns what you indent under it), whatever
  // type either is. lastAt[level] = the latest note at that indent level.
  let lastAt = [];
  notes.forEach((n, i) => {
    const id = String(n.id);
    const c = n.kind === "typed" ? "typed" : n.category;
    const lvl = Math.max(0, Math.min(3, n.indent || 0));
    const isHead = c === "header" || c === "sub topic";
    if (c === "header") { parent.set(id, null); header = id; sub = null; head = null; }
    else if (c === "sub topic") { parent.set(id, header); sub = id; head = null; }
    else if (c === "list head" || (c === "generic" && notes[i + 1]?.category === "list point" && notes[i + 1]?.kind !== "typed")) {
      parent.set(id, sub || header); head = id;
    } else if (c === "list point") parent.set(id, head || sub || header);
    else { parent.set(id, sub || header); head = null; }
    if (isHead) { lastAt = []; return; }
    if (lvl > 0) {
      for (let k = lvl - 1; k >= 0; k--) if (lastAt[k] != null) { parent.set(id, lastAt[k]); break; }
    }
    lastAt[lvl] = id;
    lastAt.length = lvl + 1;
  });
  return parent;
}

// The heads among them, with how many notes each holds (all levels).
function noteChildren(parent) {
  const kids = new Map();
  parent.forEach((p, id) => {
    for (let a = p; a; a = parent.get(a)) kids.set(a, (kids.get(a) || 0) + 1);
    void id;
  });
  return kids;
}

// Folding: heads get a ▾ / ▸ button; a folded head hides what's under it.
// Folded heads are remembered in this browser (localStorage "ln-folded").
const LnFold = (() => {
  const KEY = "ln-folded";
  let folded;
  try { folded = new Set(JSON.parse(localStorage.getItem(KEY) || "[]")); } catch (_) { folded = new Set(); }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify([...folded].slice(-3000))); } catch (_) {} };

  // container: the element holding the .note[data-id] elements, in order.
  function apply(container, notes) {
    const parent = noteParents(notes);
    const kids = noteChildren(parent);
    const els = new Map([...container.querySelectorAll(".note[data-id]")].map((el) => [el.dataset.id, el]));
    const hiddenBy = (id) => { for (let a = parent.get(id); a; a = parent.get(a)) if (folded.has(a)) return a; return null; };
    // One step in for each sub topic it's under (and a sub topic's own
    // points under a list head keep their bullet indent on top).
    const cat = new Map(notes.map((n) => [String(n.id), n.kind === "typed" ? "typed" : n.category]));
    els.forEach((el, id) => {
      let subs = 0;
      for (let a = parent.get(id); a; a = parent.get(a)) if (cat.get(a) === "sub topic") subs++;
      if (subs) el.style.setProperty("--group-px", `${subs * 18}px`);
      else el.style.removeProperty("--group-px");
    });
    els.forEach((el, id) => {
      // Who owns it (for the nesting guides and their hover highlight).
      const owner = parent.get(id);
      if (owner) el.dataset.parent = owner; else delete el.dataset.parent;
    });
    els.forEach((el, id) => {
      el.querySelectorAll(".fold-btn, .fold-count").forEach((x) => x.remove());
      el.classList.toggle("note--folded-away", !!hiddenBy(id));
      const n = kids.get(id) || 0;
      el.classList.toggle("note--head", n > 0);
      el.classList.toggle("note--folded", n > 0 && folded.has(id));
      if (!n) return;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "fold-btn";
      b.tabIndex = -1;
      b.textContent = folded.has(id) ? "▸" : "▾";
      b.title = folded.has(id) ? `Show the ${n} note${n === 1 ? "" : "s"} under it (→)` : "Fold what's under it (←)";
      b.setAttribute("aria-label", b.title);
      b.setAttribute("aria-expanded", String(!folded.has(id)));
      b.addEventListener("mousedown", (e) => e.stopPropagation());
      b.addEventListener("click", (e) => { e.stopPropagation(); e.preventDefault(); set(container, notes, id, !folded.has(id)); });
      // Right after the heading's words (the left margin has the drag
      // handle and indent buttons).
      let at = el.querySelector(".note-text") || el;
      // A typed note is made of blocks: end of the last line, not a new line.
      while (at.lastElementChild && /^(P|UL|OL|LI|DIV|BLOCKQUOTE|SPAN)$/.test(at.lastElementChild.tagName) && !at.lastElementChild.matches(".fold-btn,.fold-count")) at = at.lastElementChild;
      at.appendChild(b);
      if (folded.has(id)) {
        const c = document.createElement("span");
        c.className = "fold-count";
        c.textContent = `${n} more`;
        c.addEventListener("click", (e) => { e.stopPropagation(); set(container, notes, id, false); });
        at.appendChild(c);
      }
    });
  }
  function set(container, notes, id, fold) {
    id = String(id);
    if (fold) folded.add(id); else folded.delete(id);
    save();
    apply(container, notes);
  }
  const isFolded = (id) => folded.has(String(id));
  return { apply, set, isFolded };
})();

// Settings › More options › "Indent notes under sub topics" (lnGroupIndent).
if (globalThis.chrome?.storage?.local) {
  const setGroupIndent = (on) => document.documentElement.classList.toggle("ln-no-group-indent", on === false);
  chrome.storage.local.get("lnGroupIndent", (r) => setGroupIndent(r?.lnGroupIndent));
  chrome.storage.onChanged.addListener((c, area) => { if (area === "local" && c.lnGroupIndent) setGroupIndent(c.lnGroupIndent.newValue); });
}
