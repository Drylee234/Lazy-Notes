// Q-notes — sending a document again when a phone asks for it.
//
// The server only passes documents on to the phone (server/app.py /api/docs):
// once a phone keeps one, the server deletes its copy. If a phone loses it
// (cache cleared, a new phone), it marks the document "wanted"; after each
// sync we look for those and send them again from this computer: a file you
// opened from disk is in the reader's IndexedDB, a web PDF is fetched again.

const READER_DB = { pdf: "lazynotes-pdfs", pptx: "lazynotes-slides", docx: "lazynotes-docs" };

async function bytesFor(doc) {
  const q = new URLSearchParams(String(doc.key || "").split("?")[1] || "");
  if (q.get("local") && READER_DB[doc.kind]) {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open(READER_DB[doc.kind], 1);
      r.onupgradeneeded = () => r.result.createObjectStore("files", { keyPath: "id" });
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    const rec = await new Promise((res) => { const g = db.transaction("files").objectStore("files").get(q.get("local")); g.onsuccess = () => res(g.result); g.onerror = () => res(null); });
    db.close();
    return rec?.data ? rec.data.arrayBuffer() : null;
  }
  if (q.get("url")) {
    const r = await fetch(q.get("url")).catch(() => null);
    return r?.ok ? r.arrayBuffer() : null;
  }
  return null;
}

export async function sendWantedDocs(base, key) {
  const { lnDocBackup, lnDocs = {} } = await chrome.storage.local.get(["lnDocBackup", "lnDocs"]);
  if (lnDocBackup === false) return;
  const auth = { Authorization: `Bearer ${key}` };
  const list = await fetch(`${base}/api/docs`, { headers: auth }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  for (const item of (list?.items || []).filter((i) => i.state === "wanted")) {
    const doc = Object.values(lnDocs).find((d) => d.sha === item.sha);
    if (!doc) continue;   // not on this computer
    const bytes = await bytesFor(doc).catch(() => null);
    if (!bytes) continue;
    await fetch(`${base}/api/docs/${item.sha}?name=${encodeURIComponent(doc.name || item.name || "document")}&kind=${doc.kind || item.kind || "pdf"}`,
      { method: "PUT", headers: auth, body: bytes }).catch(() => {});
  }
}
