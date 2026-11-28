// Q-notes — open PowerPoint and Word downloads in their readers.
// (Word .docx files go to docxreader.html the same way.)
// Chrome can't show a .pptx, so clicking one just downloads it. When
// "Open PowerPoint (.pptx) downloads in Q-notes" is on (side panel ⚙,
// default on), a web .pptx download is cancelled and the deck opens in
// pptxreader.html instead, which fetches the same link itself.

const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// "pptxreader.html" / "docxreader.html" for a download we can show, else null.
function readerFor(item) {
  const name = (item.filename || item.finalUrl || item.url || "").split(/[?#]/)[0].toLowerCase();
  if (item.mime === PPTX_MIME || name.endsWith(".pptx")) return "pptxreader.html";
  if (item.mime === DOCX_MIME || name.endsWith(".docx")) return "docxreader.html";
  return null;
}

chrome.downloads.onCreated.addListener(async (item) => {
  const url = item.finalUrl || item.url || "";
  const reader = readerFor(item);
  if (!/^https?:/i.test(url) || !reader) return;
  const { pptxAutoOpen } = await chrome.storage.local.get("pptxAutoOpen");
  if (pptxAutoOpen === false) return;
  try {
    await chrome.downloads.cancel(item.id);
    await chrome.downloads.erase({ id: item.id });
  } catch (_) { /* already finished: still open it */ }
  chrome.tabs.create({ url: chrome.runtime.getURL(`${reader}?url=${encodeURIComponent(url)}`) });
});
