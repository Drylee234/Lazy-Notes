// Lazy Notes — open PowerPoint downloads in the slides reader.
// Chrome can't show a .pptx, so clicking one just downloads it. When
// "Open PowerPoint (.pptx) downloads in Lazy Notes" is on (side panel ⚙,
// default on), a web .pptx download is cancelled and the deck opens in
// pptxreader.html instead, which fetches the same link itself.

const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

function isPptx(item) {
  const name = (item.filename || item.finalUrl || item.url || "").split(/[?#]/)[0].toLowerCase();
  return item.mime === PPTX_MIME || name.endsWith(".pptx");
}

chrome.downloads.onCreated.addListener(async (item) => {
  const url = item.finalUrl || item.url || "";
  if (!/^https?:/i.test(url) || !isPptx(item)) return;
  const { pptxAutoOpen } = await chrome.storage.local.get("pptxAutoOpen");
  if (pptxAutoOpen === false) return;
  try {
    await chrome.downloads.cancel(item.id);
    await chrome.downloads.erase({ id: item.id });
  } catch (_) { /* already finished: still open it */ }
  chrome.tabs.create({ url: chrome.runtime.getURL(`pptxreader.html?url=${encodeURIComponent(url)}`) });
});
