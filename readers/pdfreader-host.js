// Lazy Notes — PDF reader ↔ highlighter bridge.
// Loaded before content.js on pdfreader.html. content.js checks
// globalThis.LazyNotesHost when saving a note, so notes taken in the reader
// point at the PDF and page instead of the reader's own extension URL.
//
// pdfreader.js fills in LazyNotesReader.source once a document is open:
//   { kind: "url",   url, name }   — a PDF opened from a link
//   { kind: "local", id,  name }   — a file from this computer (IndexedDB)

globalThis.LazyNotesReader = {
  source: null,

  // Index of a page's text layer for finding a note's text again later.
  // Whitespace is dropped: PDF text comes in line fragments and the spaces
  // and line breaks between them differ between the saved selection and the
  // rendered layer. Returns { text, chars } where chars[i] = { node, offset }
  // is where text[i] lives in the DOM.
  indexTextLayer(layer) {
    const chars = [];
    let text = "";
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const value = node.nodeValue;
      for (let i = 0; i < value.length; i++) {
        if (/\s/.test(value[i])) continue;
        text += value[i];
        chars.push({ node, offset: i });
      }
    }
    return { text, chars };
  },

  squash(str) {
    return String(str ?? "").replace(/\s+/g, "");
  }
};

globalThis.LazyNotesHost = {
  // The PDF outline section the selection is in: { title, depth } or null.
  sectionFor(el) {
    const page = this.pageOf(el);
    return page && globalThis.LazyNotesReader.sectionAt ? globalThis.LazyNotesReader.sectionAt(page) : null;
  },

  // Page number of the element the selection started in.
  pageOf(el) {
    const page = el?.closest?.(".page");
    return page ? Number(page.dataset.page) : null;
  },

  sourceUrl(el) {
    const src  = globalThis.LazyNotesReader.source;
    const page = this.pageOf(el);
    const hash = page ? `#page=${page}` : "";

    if (src?.kind === "url") return src.url.split("#")[0] + hash;
    if (src?.kind === "local") {
      return chrome.runtime.getURL(`pdfreader.html?local=${encodeURIComponent(src.id)}`) + hash;
    }
    return location.href;
  },

  // Where a selection sits on its page, so the note can be highlighted again
  // when the PDF is reopened: { page, occurrence } where occurrence says
  // which match of the same text on that page it was (a phrase can repeat).
  anchorFor(range) {
    if (!range) return null;
    const startEl = range.startContainer.nodeType === Node.ELEMENT_NODE
      ? range.startContainer
      : range.startContainer.parentElement;
    const layer = startEl?.closest?.(".textLayer");
    const page  = this.pageOf(startEl);
    if (!layer || !page) return null;

    const reader = globalThis.LazyNotesReader;
    const { text, chars } = reader.indexTextLayer(layer);
    const needle = reader.squash(range.toString());
    if (!needle) return { page, occurrence: 0 };

    // Position (in squashed text) of the first character inside the selection.
    const startAt = chars.findIndex((c) => range.comparePoint(c.node, c.offset) >= 0);
    if (startAt < 0) return { page, occurrence: 0 };

    // The selected match starts at startAt, so its number is how many
    // matches start before it.
    let occurrence = 0;
    for (let i = text.indexOf(needle); i !== -1 && i < startAt; i = text.indexOf(needle, i + 1)) {
      occurrence++;
    }
    return { page, occurrence };
  },

  sourceTitle(el) {
    const src  = globalThis.LazyNotesReader.source;
    const page = this.pageOf(el);
    if (!src) return null;
    return page ? `${src.name}, p. ${page}` : src.name;
  },

  // PDF text comes as one span per line fragment, so "the paragraph" the
  // highlighter would normally use is a single line. Use the few lines around
  // the selection instead.
  contextFor(el) {
    const layer = el?.closest?.(".textLayer");
    if (!layer) return el?.textContent ?? null;

    const spans = [...layer.querySelectorAll("span:not(.markedContent)")]
      .filter((s) => s.textContent.trim());
    const i = spans.indexOf(el.closest("span"));
    if (i < 0) return null;

    return spans
      .slice(Math.max(0, i - 3), i + 4)
      .map((s) => s.textContent)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }
};
