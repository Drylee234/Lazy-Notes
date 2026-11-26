// Lazy Notes — "Continue reading" on the All notes home (courses.html).
// Same data as the side panel's Home: chrome.storage.local.lnDocs (kept by
// readers/docs-recent.js) plus files the readers keep in IndexedDB.
(() => {
  const section = document.getElementById("recent-docs");
  const grid    = document.getElementById("recent-docs-grid");
  if (!section || !grid) return;

  // Only open a database that exists: opening a missing one creates it
  // without its store and would break the reader.
  async function storedFiles() {
    const out = [];
    let names = [];
    try { names = (await indexedDB.databases()).map((d) => d.name); } catch (_) { return out; }
    for (const [db, page, kind] of [["lazynotes-pdfs", "/pdfreader.html", "pdf"], ["lazynotes-slides", "/pptxreader.html", "pptx"], ["lazynotes-docs", "/docxreader.html", "docx"]]) {
      if (!names.includes(db)) continue;
      try {
        const records = await new Promise((resolve, reject) => {
          const req = indexedDB.open(db);
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            const conn = req.result;
            if (!conn.objectStoreNames.contains("files")) { conn.close(); resolve([]); return; }
            const all = conn.transaction("files").objectStore("files").getAll();
            all.onsuccess = () => { conn.close(); resolve(all.result || []); };
            all.onerror = () => { conn.close(); reject(all.error); };
          };
        });
        records.forEach((r) => out.push({ key: `${page}?local=${encodeURIComponent(r.id)}`, kind, name: r.name, openedAt: r.openedAt || 0, page: 1 }));
      } catch (_) { /* skip this store */ }
    }
    return out;
  }

  const unit = (d) => (d.kind === "pptx" ? "Slide" : "Page");
  const link = (d) => chrome.runtime.getURL(d.key.slice(1)) + `#${d.kind === "pptx" ? "slide" : "page"}=${d.page || 1}`;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  async function draw() {
    const { lnDocs = {} } = await chrome.storage.local.get("lnDocs");
    const all = { ...Object.fromEntries((await storedFiles()).map((d) => [d.key, d])), ...lnDocs };
    const docs = Object.values(all).sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0)).slice(0, 6);

    const cards = docs.map((d) => {
      const a = el("a", "rd-card");
      a.href = link(d);
      const icon = el("span", `rd-icon ${d.kind}`, d.kind === "pptx" ? "PPT" : d.kind === "docx" ? "DOC" : "PDF");
      const text = el("span", "rd-text");
      text.append(
        el("span", "rd-name", d.name),
        el("span", "rd-meta", `${unit(d)} ${d.page || 1}${d.pages ? ` of ${d.pages}` : ""}`),
        el("span", "rd-where", d.course && d.topic ? `${d.course} › ${d.topic}` : "Not saving to a topic yet")
      );
      const bar = el("span", "rd-bar");
      const fill = el("i");
      fill.style.width = `${d.pages ? Math.round(((d.page || 1) / d.pages) * 100) : 0}%`;
      bar.appendChild(fill);
      text.appendChild(bar);
      a.append(icon, text);
      return a;
    });

    const open = el("a", "rd-card rd-open");
    open.href = "pdfreader.html";
    open.append(el("span", "rd-plus", "+"), el("span", "rd-open-label", "Open a document…"));

    grid.replaceChildren(...cards, open);
    section.querySelector(".rd-empty").hidden = cards.length > 0;
  }

  draw();
  chrome.storage.onChanged.addListener((c, area) => { if (area === "local" && c.lnDocs) draw(); });
})();
