// Lazy Notes — slides reader ↔ highlighter bridge.
// Loaded before content.js on pptxreader.html, as pdfreader-host.js is for
// PDFs: notes taken here say which deck and slide they came from
// ("lecture3.pptx, slide 4"), and their link opens this reader at that
// slide, since the .pptx link itself would just download.
//
// pptxreader.js fills in LazySlides.source once a deck is open:
//   { kind: "url",   url, name }   — from a link
//   { kind: "local", id,  name }   — a file from this computer (IndexedDB)

globalThis.LazySlides = {
  source: null,

  // This reader's link for the open deck, without #slide.
  deckLink() {
    const src = this.source;
    if (src?.kind === "url")   return chrome.runtime.getURL(`pptxreader.html?url=${encodeURIComponent(src.url)}`);
    if (src?.kind === "local") return chrome.runtime.getURL(`pptxreader.html?local=${encodeURIComponent(src.id)}`);
    return location.href.split("#")[0];
  },

  // A slide's text with whitespace dropped, and where each character lives
  // (chars[i] = { node, offset }), for finding a note's text again. Same
  // idea as the PDF reader: spacing differs between a selection's text and
  // the page's, so it's ignored on both sides.
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
  slideOf(el) {
    const slide = el?.closest?.(".slide");
    return slide ? Number(slide.dataset.slide) : null;
  },

  sourceUrl(el) {
    const n = this.slideOf(el);
    return globalThis.LazySlides.deckLink() + (n ? `#slide=${n}` : "");
  },

  sourceTitle(el) {
    const src = globalThis.LazySlides.source;
    const n   = this.slideOf(el);
    if (!src) return null;
    return n ? `${src.name}, slide ${n}` : src.name;
  },

  // { page: slide number, occurrence }: which match of the selected text on
  // that slide was picked, so a phrase that appears twice is highlighted
  // where it was taken. "page" so notes from PDFs and slides share a shape.
  anchorFor(range) {
    if (!range) return null;
    const startEl = range.startContainer.nodeType === Node.ELEMENT_NODE
      ? range.startContainer
      : range.startContainer.parentElement;
    const body  = startEl?.closest?.(".slide-body");
    const slide = this.slideOf(startEl);
    if (!body || !slide) return null;

    const S = globalThis.LazySlides;
    const { text, chars } = S.indexText(body);
    const needle = S.squash(range.toString());
    if (!needle) return { page: slide, occurrence: 0 };

    const startAt = chars.findIndex((c) => range.comparePoint(c.node, c.offset) >= 0);
    if (startAt < 0) return { page: slide, occurrence: 0 };

    let occurrence = 0;
    for (let i = text.indexOf(needle); i !== -1 && i < startAt; i = text.indexOf(needle, i + 1)) {
      occurrence++;
    }
    return { page: slide, occurrence };
  }
};
