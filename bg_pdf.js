// Lazy Notes — Opening PDFs in the Lazy Notes reader

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

// From pdf-prompt.js ("Highlight this PDF"): show the tab's PDF in the reader
// instead of Chrome's viewer. Same tab, so Back returns to Chrome's viewer.
export function openPdfInReader(sender, pdfUrl) {
  if (sender.tab?.id == null || sender.frameId !== 0) return;
  if (!/^(https?|file):/i.test(pdfUrl ?? "")) return;

  chrome.tabs.update(sender.tab.id, { url: readerUrlFor(pdfUrl) }).catch((err) => {
    console.warn("LazyNotes [Background]: couldn't open the PDF in the reader ->", err);
  });
}
