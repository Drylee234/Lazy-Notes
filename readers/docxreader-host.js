// Q-notes — Word reader ↔ highlighter bridge.
// Loaded before content.js on docxreader.html, as pptxreader-host.js is for
// slides: notes taken here say which document and page they came from
// ("notes.docx, page 2"), and their link opens this reader at that page,
// since the .docx link itself would just download.
//
// docxreader.js fills in LazyDocx.source once a document is open, and
// pageCount (a one-page document is named without "page 1"):
//   { kind: "url",   url, name }   — from a link
//   { kind: "local", id,  name }   — a file from this computer (IndexedDB)

globalThis.LazyDocx = {
  source: null,
  pageCount: 1,

  // This reader's link for the open document, without #page.
  docLink() {
    const src = this.source;
    if (src?.kind === "url")   return chrome.runtime.getURL(`docxreader.html?url=${encodeURIComponent(src.url)}`);
    if (src?.kind === "local") return chrome.runtime.getURL(`docxreader.html?local=${encodeURIComponent(src.id)}`);
    return location.href.split("#")[0];
  },

  // A page's text with whitespace dropped, and where each character lives
  // (chars[i] = { node, offset }), for finding a note's text again. Spacing
  // differs between a selection's text and the page's, so it's ignored on
  // both sides (same as the PDF and slides readers).
  indexText(root) {
    const chars = [];
    let text = "";
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
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
  pageOf(el) {
    const page = el?.closest?.(".doc-page");
    return page ? Number(page.dataset.page) : null;
  },

  sourceUrl(el) {
    const n = this.pageOf(el);
    return globalThis.LazyDocx.docLink() + (n ? `#page=${n}` : "");
  },

  sourceTitle(el) {
    const D = globalThis.LazyDocx;
    const n = this.pageOf(el);
    if (!D.source) return null;
    return n && D.pageCount > 1 ? `${D.source.name}, page ${n}` : D.source.name;
  },

  // { page, occurrence }: which match of the selected text on that page was
  // picked, so a phrase that appears twice is highlighted where it was taken.
  anchorFor(range) {
    if (!range) return null;
    const startEl = range.startContainer.nodeType === Node.ELEMENT_NODE
      ? range.startContainer
      : range.startContainer.parentElement;
    const body = startEl?.closest?.(".page-body");
    const page = this.pageOf(startEl);
    if (!body || !page) return null;

    const D = globalThis.LazyDocx;
    const { text, chars } = D.indexText(body);
    const needle = D.squash(range.toString());
    if (!needle) return { page, occurrence: 0 };

    const startAt = chars.findIndex((c) => range.comparePoint(c.node, c.offset) >= 0);
    if (startAt < 0) return { page, occurrence: 0 };

    let occurrence = 0;
    for (let i = text.indexOf(needle); i !== -1 && i < startAt; i = text.indexOf(needle, i + 1)) {
      occurrence++;
    }
    return { page, occurrence };
  }
};
