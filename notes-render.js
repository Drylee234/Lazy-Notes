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
function renderNote(note, { compact = false } = {}) {
  const el = document.createElement("div");
  el.className = `note note--${(note.category || "summary").replace(/\s+/g, "-")}`;
  if (compact) el.classList.add("note--compact");
  el.dataset.id = note.id ?? "";
  el.tabIndex = 0;

  const text = document.createElement("div");
  text.className = "note-text";
  text.textContent = note.text;
  el.appendChild(text);

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
