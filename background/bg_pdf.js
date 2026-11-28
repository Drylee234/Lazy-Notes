// QNotes — Opening PDFs in the QNotes reader

// The reader's link for a PDF. A #page=N on the PDF's link is carried over
// so the reader opens on the same page Chrome's viewer did.
function readerUrlFor(pdfUrl) {
  const url  = new URL(pdfUrl);
  const page = url.hash.match(/[#&]page=(\d+)/)?.[1];
  url.hash = "";
  return chrome.runtime.getURL(
    `pdfreader.html?url=${encodeURIComponent(url.href)}${page ? `#page=${page}` : ""}`
  );
}

// From pdf-prompt.js ("Highlight this PDF"): show the tab's PDF in the
// reader, either in place of Chrome's viewer (Back returns to it) or in a new
// tab right after it.
export function openPdfInReader(sender, { url: pdfUrl, newTab = false, active = true }) {
  const tab = sender.tab;
  if (tab?.id == null || sender.frameId !== 0) return;
  if (!/^(https?|file):/i.test(pdfUrl ?? "")) return;

  const url = readerUrlFor(pdfUrl);
  const opened = newTab
    ? chrome.tabs.create({ url, active, index: tab.index + 1, openerTabId: tab.id })
    : chrome.tabs.update(tab.id, { url });

  opened.catch((err) => {
    console.warn("LazyNotes [Background]: couldn't open the PDF in the reader ->", err);
  });
}
