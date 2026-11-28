// Q-notes — "+ Open a document…": the computer's file picker, then the
// file opens in its reader in a new tab. The file goes to the reader through
// that reader's IndexedDB store (same scheme as readers/pdfreader.js).
//
//   LazyOpenDoc.pick({ course, onMessage })   course: open it "in" this course,
//   so "Where do these notes go?" has the course picked and only asks the topic.

globalThis.LazyOpenDoc = (() => {
  const READERS = {
    pdf:  { db: "lazynotes-pdfs",   page: "pdfreader.html" },
    pptx: { db: "lazynotes-slides", page: "pptxreader.html" },
    docx: { db: "lazynotes-docs",   page: "docxreader.html" }
  };

  async function open(file, { course } = {}) {
    const kind = /\.pptx$/i.test(file.name) ? "pptx" : /\.docx$/i.test(file.name) ? "docx"
      : (/\.pdf$/i.test(file.name) || file.type === "application/pdf") ? "pdf" : null;
    if (!kind) {
      throw new Error(/\.(doc|ppt)$/i.test(file.name)
        ? "Old .doc / .ppt files can't be read: save it as .docx / .pptx or PDF first."
        : "Pick a PDF, .pptx or .docx file.");
    }
    const { db: dbName, page } = READERS[kind];
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => req.result.createObjectStore("files", { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
    const all = await new Promise((r) => { const q = db.transaction("files").objectStore("files").getAll(); q.onsuccess = () => r(q.result || []); });
    const id = all.find((f) => f.name === file.name && f.size === file.size)?.id ?? crypto.randomUUID();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("files", "readwrite");
      tx.objectStore("files").put({ id, name: file.name, size: file.size, data: file, openedAt: Date.now() });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    const q = `local=${encodeURIComponent(id)}${course ? `&course=${encodeURIComponent(course)}` : ""}`;
    chrome.tabs.create({ url: chrome.runtime.getURL(`${page}?${q}`) });
  }

  function pick({ course = null, onMessage = () => {} } = {}) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pdf,.pptx,.docx,application/pdf";
    input.hidden = true;
    document.body.appendChild(input);
    input.addEventListener("change", async () => {
      const file = input.files[0];
      input.remove();
      if (!file) return;
      try { onMessage(""); await open(file, { course }); }
      catch (err) { onMessage(err?.message ? (/^(Old|Pick)/.test(err.message) ? err.message : `Couldn't open that file: ${err.message}`) : "Couldn't open that file."); }
    });
    input.click();
  }

  return { pick, open };
})();
