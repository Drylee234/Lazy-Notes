// Lazy Notes — shared note rendering for the side panel and the viewer.
// Plain script (no modules on these pages). Styles live in notes.css.
//
// Each category renders as what it is in a set of notes — a heading, a
// bullet, a formula — instead of a generic card with a label.

const CATEGORY_LABELS = {
  "header":     "Header",
  "definition": "Definition",
  "formula":    "Formula",
  "list head":  "List head",
  "list point": "List point",
  "summary":    "Summary"
};

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
  el.tabIndex = 0;

  const text = document.createElement("div");
  text.className = "note-text";
  if (page) fillPageText(text, note);
  else text.textContent = note.text;
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
  if (note.category === "definition") fillDefinition(el, note);
  else el.appendChild(markedText(note.text));
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
  typedNoteBlocks(note.text).forEach(({ quote, text }) => {
    const block = document.createElement(quote ? "blockquote" : "p");
    block.textContent = text;
    body.appendChild(block);
  });
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
