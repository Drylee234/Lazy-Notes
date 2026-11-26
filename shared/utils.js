// Lazy Notes — Shared sort/filter helpers.
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
    if (!line.trim()) { flushAll(); return; }
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
  return out.join("");
}
