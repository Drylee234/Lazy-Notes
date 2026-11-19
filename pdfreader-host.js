// Lazy Notes — PDF reader ↔ highlighter bridge.
// Loaded before content.js on pdfreader.html. content.js checks
// globalThis.LazyNotesHost when saving a note, so notes taken in the reader
// point at the PDF and page instead of the reader's own extension URL.
//
// pdfreader.js fills in LazyNotesReader.source once a document is open:
//   { kind: "url",   url, name }   — a PDF opened from a link
//   { kind: "local", id,  name }   — a file from this computer (IndexedDB)

globalThis.LazyNotesReader = { source: null };

globalThis.LazyNotesHost = {
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
